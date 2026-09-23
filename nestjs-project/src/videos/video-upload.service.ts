import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import videoConfig from '../config/video.config';
import { Video } from './entities/video.entity';
import { VideoStorage, StoredObject, StoredPart } from './video-storage';
import { VideosService } from './videos.service';
import { VideosRepository } from './videos.repository';
import {
  InvalidVideoInputException,
  InvalidVideoStateException,
  VideoUploadException,
} from './videos.errors';

@Injectable()
export class VideoUploadService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VideoUploadService.name);
  private sweepTimer?: ReturnType<typeof setInterval>;
  constructor(
    private readonly videos: VideosService,
    private readonly repository: VideosRepository,
    private readonly storage: VideoStorage,
    @Inject(videoConfig.KEY)
    private readonly config: ConfigType<typeof videoConfig>,
  ) {}

  onModuleInit(): void {
    this.sweepTimer = setInterval(() => {
      void this.sweepExpired().catch((error: unknown) =>
        this.logger.warn(
          `Upload expiry sweep failed: ${error instanceof Error ? error.name : 'unknown'}`,
        ),
      );
    }, 60_000);
    this.sweepTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  async sweepExpired(): Promise<void> {
    const orphanCutoff = new Date(
      Date.now() - this.config.uploadTtlSeconds * 1000,
    );
    for (const video of await this.repository.findOrphanDrafts(
      orphanCutoff,
      100,
    )) {
      await this.repository.expireOrphanDraft(
        video.id,
        video.generation,
        orphanCutoff,
      );
    }
    for (const video of await this.repository.findExpiredUploads(100)) {
      const token = randomUUID();
      if (
        !(await this.repository.claimExpiredUpload(
          video.id,
          token,
          new Date(Date.now() + 900_000),
        ))
      )
        continue;
      try {
        await this.storage.abort(
          video.original_bucket,
          video.original_key,
          video.upload_id!,
        );
        await this.repository.markUploadError(
          video.id,
          video.generation,
          'UPLOAD_EXPIRED',
        );
      } catch (error) {
        this.logger.warn(
          `Could not clean expired upload ${video.id}: ${error instanceof Error ? error.name : 'unknown'}`,
        );
      } finally {
        await this.repository.releaseCompletion(video.id, token);
      }
    }
  }

  private count(video: Video): number {
    return Math.ceil(Number(video.expected_bytes) / this.config.partBytes);
  }
  private active(video: Video): void {
    if (video.upload_confirmed_at)
      throw new VideoUploadException('UPLOAD_ALREADY_CONFIRMED');
    if (video.status !== 'draft' || !video.upload_id)
      throw new InvalidVideoStateException();
    if (
      !video.upload_expires_at ||
      video.upload_expires_at.getTime() <= Date.now()
    )
      throw new VideoUploadException('UPLOAD_EXPIRED');
  }
  private storageError(): VideoUploadException {
    return new VideoUploadException('STORAGE_UNAVAILABLE', 503);
  }

  async initiate(
    userId: string,
    input: {
      title: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
    },
  ) {
    if (input.sizeBytes > this.config.maxBytes)
      throw new InvalidVideoInputException();
    const video = await this.videos.createDraft(userId, {
      title: input.title,
      filename: input.filename,
      mime: input.mimeType,
      expectedBytes: input.sizeBytes,
    });
    let uploadId: string | undefined;
    try {
      uploadId = await this.storage.initiate(
        video.original_bucket,
        video.original_key,
        video.declared_mime,
      );
      const expiresAt = new Date(
        Date.now() + this.config.uploadTtlSeconds * 1000,
      );
      if (!(await this.repository.setUpload(video.id, uploadId, expiresAt)))
        throw new InvalidVideoStateException();
      return {
        videoId: video.id,
        publicId: video.public_id,
        status: 'draft' as const,
        partSize: this.config.partBytes,
        partCount: this.count(video),
        expiresAt,
      };
    } catch (error) {
      if (uploadId)
        await this.storage
          .abort(video.original_bucket, video.original_key, uploadId)
          .catch(() => undefined);
      await this.repository.markUploadError(
        video.id,
        video.generation,
        'STORAGE_FAILURE',
      );
      if (error instanceof InvalidVideoStateException) throw error;
      throw this.storageError();
    }
  }

  async sign(userId: string, videoId: string, partNumbers: number[]) {
    const video = await this.videos.getOwnedById(userId, videoId);
    this.active(video);
    if (
      video.completion_token &&
      video.completion_lease_until &&
      video.completion_lease_until.getTime() > Date.now()
    )
      throw new VideoUploadException('UPLOAD_COMPLETION_IN_PROGRESS');
    if (
      !Array.isArray(partNumbers) ||
      partNumbers.length < 1 ||
      partNumbers.length > 20 ||
      partNumbers.some(
        (n, i) =>
          !Number.isInteger(n) ||
          n < 1 ||
          n > this.count(video) ||
          (i > 0 && n <= partNumbers[i - 1]),
      )
    )
      throw new InvalidVideoInputException();
    const expiresAt = new Date(
      Date.now() + this.config.presignTtlSeconds * 1000,
    );
    try {
      const parts = await Promise.all(
        partNumbers.map(async (partNumber) => ({
          partNumber,
          url: await this.storage.sign(
            video.original_bucket,
            video.original_key,
            video.upload_id!,
            partNumber,
            this.config.presignTtlSeconds,
          ),
          expiresAt,
        })),
      );
      return { parts };
    } catch {
      throw this.storageError();
    }
  }

  async resume(userId: string, videoId: string) {
    const video = await this.videos.getOwnedById(userId, videoId);
    if (video.upload_confirmed_at)
      return {
        videoId,
        status: video.status,
        confirmed: true,
        expiresAt: video.upload_expires_at,
        partSize: this.config.partBytes,
        partCount: this.count(video),
        parts: [],
      };
    this.active(video);
    try {
      return {
        videoId,
        status: video.status,
        confirmed: false,
        expiresAt: video.upload_expires_at,
        partSize: this.config.partBytes,
        partCount: this.count(video),
        parts: await this.storage.listParts(
          video.original_bucket,
          video.original_key,
          video.upload_id!,
        ),
      };
    } catch {
      throw this.storageError();
    }
  }

  async cancel(userId: string, videoId: string): Promise<void> {
    const video = await this.videos.getOwnedById(userId, videoId);
    if (video.upload_confirmed_at)
      throw new VideoUploadException('UPLOAD_ALREADY_CONFIRMED');
    if (video.status === 'error') return;
    this.active(video);
    const token = randomUUID();
    if (
      !(await this.repository.claimCompletion(
        videoId,
        token,
        new Date(Date.now() + 900_000),
      ))
    )
      throw new VideoUploadException('UPLOAD_COMPLETION_IN_PROGRESS');
    try {
      await this.storage.abort(
        video.original_bucket,
        video.original_key,
        video.upload_id!,
      );
      if (
        !(await this.repository.markUploadError(
          video.id,
          video.generation,
          'UPLOAD_CANCELLED',
        ))
      )
        throw new InvalidVideoStateException();
    } catch (error) {
      if (error instanceof InvalidVideoStateException) throw error;
      throw this.storageError();
    } finally {
      await this.repository.releaseCompletion(videoId, token);
    }
  }

  async complete(
    userId: string,
    videoId: string,
    clientParts: Array<{ partNumber: number; eTag: string }>,
  ) {
    const video = await this.videos.getOwnedById(userId, videoId);
    if (video.upload_confirmed_at)
      return { videoId, status: video.status, confirmed: true as const };
    this.active(video);
    const count = this.count(video);
    if (
      !Array.isArray(clientParts) ||
      clientParts.length !== count ||
      clientParts.some(
        (part, i) =>
          !part ||
          part.partNumber !== i + 1 ||
          typeof part.eTag !== 'string' ||
          !/^(?:"[A-Za-z0-9_-]{1,128}(?:-[0-9]+)?"|[A-Za-z0-9_-]{1,128}(?:-[0-9]+)?)$/.test(
            part.eTag,
          ),
      )
    )
      throw new VideoUploadException('UPLOAD_PARTS_MISMATCH');
    const token = randomUUID();
    if (
      !(await this.repository.claimCompletion(
        videoId,
        token,
        new Date(Date.now() + 900_000),
      ))
    )
      throw new VideoUploadException('UPLOAD_COMPLETION_IN_PROGRESS');
    const renewal = setInterval(() => {
      void this.repository
        .renewCompletion(videoId, token, new Date(Date.now() + 900_000))
        .catch(() => undefined);
    }, 60_000);
    renewal.unref();
    try {
      let object: StoredObject | null;
      try {
        object = await this.storage.head(
          video.original_bucket,
          video.original_key,
        );
        if (!object) {
          const parts = await this.storage.listParts(
            video.original_bucket,
            video.original_key,
            video.upload_id!,
          );
          this.verifyParts(video, clientParts, parts);
          await this.storage.complete(
            video.original_bucket,
            video.original_key,
            video.upload_id!,
            parts,
          );
          object = await this.storage.head(
            video.original_bucket,
            video.original_key,
          );
        }
      } catch (error) {
        if (error instanceof VideoUploadException) throw error;
        throw this.storageError();
      }
      if (!object || object.sizeBytes !== Number(video.expected_bytes))
        throw new VideoUploadException('UPLOAD_PARTS_MISMATCH');
      if (
        !(await this.repository.confirmUpload(
          videoId,
          token,
          object.sizeBytes,
          object.eTag,
        ))
      )
        throw new InvalidVideoStateException();
      return { videoId, status: 'draft' as const, confirmed: true as const };
    } finally {
      clearInterval(renewal);
      await this.repository.releaseCompletion(videoId, token);
    }
  }

  private verifyParts(
    video: Video,
    clientParts: Array<{ partNumber: number; eTag: string }>,
    parts: StoredPart[],
  ): void {
    if (parts.length !== clientParts.length)
      throw new VideoUploadException('UPLOAD_PARTS_MISMATCH');
    let total = 0;
    for (let i = 0; i < parts.length; i++) {
      const expected =
        i === parts.length - 1
          ? Number(video.expected_bytes) - i * this.config.partBytes
          : this.config.partBytes;
      if (
        parts[i].partNumber !== i + 1 ||
        parts[i].eTag !== clientParts[i].eTag ||
        parts[i].sizeBytes !== expected
      )
        throw new VideoUploadException('UPLOAD_PARTS_MISMATCH');
      total += parts[i].sizeBytes;
    }
    if (total !== Number(video.expected_bytes))
      throw new VideoUploadException('UPLOAD_PARTS_MISMATCH');
  }
}
