import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { QueryFailedError } from 'typeorm';
import storageConfig from '../config/storage.config';
import { Video, VideoMediaMetadata } from './entities/video.entity';
import {
  InvalidVideoInputException,
  InvalidVideoStateException,
  VideoNotFoundException,
} from './videos.errors';
import { ReadyVideoInput, VideosRepository } from './videos.repository';

export interface CreateDraftInput {
  title: string;
  filename: string;
  mime: string;
  expectedBytes: number;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
};
const FAILURE_CODES = new Set([
  'UPLOAD_CANCELLED',
  'UPLOAD_EXPIRED',
  'UPLOAD_INVALID',
  'INVALID_MEDIA',
  'PROBE_FAILED',
  'THUMBNAIL_FAILED',
  'PROCESSING_TIMEOUT',
  'PROCESSING_RETRIES_EXHAUSTED',
  'STORAGE_FAILURE',
]);

function validateDraft(input: CreateDraftInput): void {
  if (
    typeof input.title !== 'string' ||
    input.title.trim().length < 1 ||
    input.title.length > 200 ||
    typeof input.filename !== 'string' ||
    input.filename.length < 1 ||
    input.filename.length > 255 ||
    input.filename === '.' ||
    input.filename === '..' ||
    input.filename.includes('/') ||
    input.filename.includes('\\') ||
    [...input.filename].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    !Number.isSafeInteger(input.expectedBytes) ||
    input.expectedBytes < 1 ||
    input.expectedBytes > 10_000_000_000
  ) {
    throw new InvalidVideoInputException();
  }
  const extension = input.filename
    .slice(input.filename.lastIndexOf('.'))
    .toLowerCase();
  if (MIME_BY_EXTENSION[extension] !== input.mime)
    throw new InvalidVideoInputException();
}

function validateMetadata(metadata: VideoMediaMetadata): void {
  if (
    !metadata ||
    Object.keys(metadata).sort().join(',') !==
      'codec,format,height,streamCount,width' ||
    typeof metadata.format !== 'string' ||
    metadata.format.length < 1 ||
    metadata.format.length > 100 ||
    typeof metadata.codec !== 'string' ||
    metadata.codec.length < 1 ||
    metadata.codec.length > 100 ||
    !Number.isSafeInteger(metadata.width) ||
    metadata.width < 1 ||
    metadata.width > 16384 ||
    !Number.isSafeInteger(metadata.height) ||
    metadata.height < 1 ||
    metadata.height > 16384 ||
    !Number.isSafeInteger(metadata.streamCount) ||
    metadata.streamCount < 1 ||
    metadata.streamCount > 100
  ) {
    throw new InvalidVideoInputException();
  }
}

@Injectable()
export class VideosService {
  constructor(
    private readonly repository: VideosRepository,
    @Inject(storageConfig.KEY)
    private readonly storage: ConfigType<typeof storageConfig>,
  ) {}

  async createDraft(userId: string, input: CreateDraftInput): Promise<Video> {
    validateDraft(input);
    const channelId = await this.repository.findChannelIdByUserId(userId);
    if (!channelId) throw new VideoNotFoundException();
    for (let attempt = 0; attempt < 5; attempt++) {
      const videoId = randomUUID();
      const publicId = randomBytes(16).toString('base64url');
      try {
        return await this.repository.createDraft({
          id: videoId,
          channelId,
          publicId,
          title: input.title.trim(),
          mime: input.mime,
          filename: input.filename,
          expectedBytes: input.expectedBytes,
          originalBucket: this.storage.originalsBucket,
          originalKey: `channels/${channelId}/videos/${videoId}/original/source`,
        });
      } catch (error) {
        if (
          !(error instanceof QueryFailedError) ||
          (error.driverError as { code?: string; constraint?: string }).code !==
            '23505' ||
          (error.driverError as { constraint?: string }).constraint !==
            'uq_videos_public_id'
        )
          throw error;
      }
    }
    throw new InvalidVideoStateException();
  }

  async getOwnedById(userId: string, videoId: string): Promise<Video> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        videoId,
      )
    )
      throw new VideoNotFoundException();
    const [channelId, video] = await Promise.all([
      this.repository.findChannelIdByUserId(userId),
      this.repository.findById(videoId),
    ]);
    if (!video || video.channel_id !== channelId)
      throw new VideoNotFoundException();
    return video;
  }

  async getReadyByPublicId(publicId: string): Promise<Video> {
    if (!/^[A-Za-z0-9_-]{22}$/.test(publicId))
      throw new VideoNotFoundException();
    const video = await this.repository.findByPublicId(publicId);
    if (!video || video.status !== 'ready') throw new VideoNotFoundException();
    return video;
  }

  async markUploadError(
    videoId: string,
    generation: number,
    code: string,
  ): Promise<void> {
    if (
      !FAILURE_CODES.has(code) ||
      !(await this.repository.markUploadError(videoId, generation, code))
    )
      throw new InvalidVideoStateException();
  }

  async claimProcessing(
    videoId: string,
    generation: number,
    token: string,
    leaseUntil: Date,
  ): Promise<void> {
    if (
      !(await this.repository.claimProcessing(
        videoId,
        generation,
        token,
        leaseUntil,
      ))
    )
      throw new InvalidVideoStateException();
  }

  async markReady(input: ReadyVideoInput): Promise<void> {
    validateMetadata(input.metadata);
    if (
      !Number.isSafeInteger(input.durationMs) ||
      input.durationMs < 1 ||
      !Number.isSafeInteger(input.thumbnailBytes) ||
      input.thumbnailBytes < 1 ||
      !input.thumbnailBucket ||
      !input.thumbnailKey ||
      !(await this.repository.markReady(input))
    )
      throw new InvalidVideoStateException();
  }

  async markProcessingError(
    videoId: string,
    generation: number,
    token: string,
    code: string,
  ): Promise<void> {
    if (
      !FAILURE_CODES.has(code) ||
      !(await this.repository.markProcessingError(
        videoId,
        generation,
        token,
        code,
      ))
    )
      throw new InvalidVideoStateException();
  }

  async prepareReprocess(userId: string, videoId: string): Promise<number> {
    const video = await this.getOwnedById(userId, videoId);
    const generation = await this.repository.prepareReprocess(
      video.channel_id,
      video.id,
    );
    if (generation === null) throw new InvalidVideoStateException();
    return generation;
  }
}
