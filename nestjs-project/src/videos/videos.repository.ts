import {
  Video,
  VideoFailureStage,
  VideoMediaMetadata,
} from './entities/video.entity';

export interface DraftVideoInput {
  id: string;
  channelId: string;
  publicId: string;
  title: string;
  mime: string;
  filename: string;
  expectedBytes: number;
  originalBucket: string;
  originalKey: string;
}

export interface ReadyVideoInput {
  videoId: string;
  generation: number;
  processingToken: string;
  durationMs: number;
  metadata: VideoMediaMetadata;
  thumbnailBucket: string;
  thumbnailKey: string;
  thumbnailBytes: number;
}

export abstract class VideosRepository {
  abstract findChannelIdByUserId(userId: string): Promise<string | null>;
  abstract createDraft(input: DraftVideoInput): Promise<Video>;
  abstract findById(id: string): Promise<Video | null>;
  abstract findByPublicId(publicId: string): Promise<Video | null>;
  abstract markUploadError(
    id: string,
    generation: number,
    code: string,
  ): Promise<boolean>;
  abstract claimProcessing(
    id: string,
    generation: number,
    token: string,
    leaseUntil: Date,
  ): Promise<boolean>;
  abstract markReady(input: ReadyVideoInput): Promise<boolean>;
  abstract markProcessingError(
    id: string,
    generation: number,
    token: string,
    code: string,
  ): Promise<boolean>;
  abstract prepareReprocess(
    channelId: string,
    videoId: string,
  ): Promise<number | null>;
  abstract markFailure(
    id: string,
    generation: number,
    token: string | null,
    stage: VideoFailureStage,
    code: string,
  ): Promise<boolean>;
}
