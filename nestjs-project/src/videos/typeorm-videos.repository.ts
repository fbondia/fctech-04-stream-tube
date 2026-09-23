import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { Video, VideoFailureStage } from './entities/video.entity';
import { VideoProcessingOutbox } from './entities/video-processing-outbox.entity';
import {
  DraftVideoInput,
  ReadyVideoInput,
  VideosRepository,
} from './videos.repository';

@Injectable()
export class TypeOrmVideosRepository extends VideosRepository {
  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async findChannelIdByUserId(userId: string): Promise<string | null> {
    const channel = await this.dataSource
      .getRepository(Channel)
      .findOne({ where: { user_id: userId }, select: { id: true } });
    return channel?.id ?? null;
  }

  async createDraft(input: DraftVideoInput): Promise<Video> {
    const repository = this.dataSource.getRepository(Video);
    return repository.save(
      repository.create({
        id: input.id,
        channel_id: input.channelId,
        public_id: input.publicId,
        title: input.title,
        declared_mime: input.mime,
        safe_filename: input.filename,
        expected_bytes: String(input.expectedBytes),
        original_bucket: input.originalBucket,
        original_key: input.originalKey,
        status: 'draft',
        generation: 1,
      }),
    );
  }

  async setUpload(
    id: string,
    uploadId: string,
    expiresAt: Date,
  ): Promise<boolean> {
    const result = await this.dataSource
      .getRepository(Video)
      .createQueryBuilder()
      .update()
      .set({ upload_id: uploadId, upload_expires_at: expiresAt })
      .where('id = :id AND status = :status AND upload_id IS NULL', {
        id,
        status: 'draft',
      })
      .execute();
    return result.affected === 1;
  }

  findExpiredUploads(limit: number): Promise<Video[]> {
    return this.dataSource
      .getRepository(Video)
      .createQueryBuilder('video')
      .where(
        'video.status = :status AND video.upload_confirmed_at IS NULL AND video.upload_id IS NOT NULL AND video.upload_expires_at <= now() AND (video.completion_token IS NULL OR video.completion_lease_until < now())',
        { status: 'draft' },
      )
      .orderBy('video.upload_expires_at', 'ASC')
      .take(limit)
      .getMany();
  }

  findOrphanDrafts(olderThan: Date, limit: number): Promise<Video[]> {
    return this.dataSource
      .getRepository(Video)
      .createQueryBuilder('video')
      .where(
        'video.status = :status AND video.upload_confirmed_at IS NULL AND video.upload_id IS NULL AND video.created_at < :olderThan',
        { status: 'draft', olderThan },
      )
      .orderBy('video.created_at', 'ASC')
      .take(limit)
      .getMany();
  }

  async expireOrphanDraft(
    id: string,
    generation: number,
    olderThan: Date,
  ): Promise<boolean> {
    const result = await this.dataSource
      .getRepository(Video)
      .createQueryBuilder()
      .update()
      .set({
        status: 'error',
        failure_stage: 'upload',
        failure_code: 'UPLOAD_EXPIRED',
        updated_at: new Date(),
      })
      .where(
        'id = :id AND generation = :generation AND status = :status AND upload_confirmed_at IS NULL AND upload_id IS NULL AND created_at < :olderThan',
        { id, generation, status: 'draft', olderThan },
      )
      .execute();
    return result.affected === 1;
  }

  async claimExpiredUpload(
    id: string,
    token: string,
    leaseUntil: Date,
  ): Promise<boolean> {
    const result = await this.dataSource
      .getRepository(Video)
      .createQueryBuilder()
      .update()
      .set({ completion_token: token, completion_lease_until: leaseUntil })
      .where(
        'id = :id AND status = :status AND upload_confirmed_at IS NULL AND upload_id IS NOT NULL AND upload_expires_at <= now() AND (completion_token IS NULL OR completion_lease_until < now())',
        { id, status: 'draft' },
      )
      .execute();
    return result.affected === 1;
  }

  async claimCompletion(
    id: string,
    token: string,
    leaseUntil: Date,
  ): Promise<boolean> {
    const result = await this.dataSource
      .getRepository(Video)
      .createQueryBuilder()
      .update()
      .set({ completion_token: token, completion_lease_until: leaseUntil })
      .where(
        'id = :id AND status = :status AND upload_confirmed_at IS NULL AND upload_id IS NOT NULL AND upload_expires_at > now() AND (completion_token IS NULL OR completion_lease_until < now())',
        { id, status: 'draft' },
      )
      .execute();
    return result.affected === 1;
  }

  async renewCompletion(
    id: string,
    token: string,
    leaseUntil: Date,
  ): Promise<boolean> {
    const result = await this.dataSource
      .getRepository(Video)
      .createQueryBuilder()
      .update()
      .set({ completion_lease_until: leaseUntil })
      .where(
        'id = :id AND completion_token = :token AND status = :status AND upload_confirmed_at IS NULL',
        { id, token, status: 'draft' },
      )
      .execute();
    return result.affected === 1;
  }

  async releaseCompletion(id: string, token: string): Promise<void> {
    await this.dataSource
      .getRepository(Video)
      .createQueryBuilder()
      .update()
      .set({ completion_token: null, completion_lease_until: null })
      .where('id = :id AND completion_token = :token', { id, token })
      .execute();
  }

  async confirmUpload(
    id: string,
    token: string,
    bytes: number,
    eTag: string,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const result = await manager
        .getRepository(Video)
        .createQueryBuilder()
        .update()
        .set({
          upload_confirmed_at: new Date(),
          uploaded_bytes: String(bytes),
          object_etag: eTag,
          completion_token: null,
          completion_lease_until: null,
        })
        .where(
          'id = :id AND status = :status AND upload_confirmed_at IS NULL AND completion_token = :token AND expected_bytes = :bytes',
          { id, status: 'draft', token, bytes: String(bytes) },
        )
        .execute();
      if (result.affected !== 1) return false;
      await manager.getRepository(VideoProcessingOutbox).insert({
        video_id: id,
        generation: 1,
        event_name: 'process-video-v1',
        schema_version: 1,
        status: 'pending',
      });
      return true;
    });
  }

  findById(id: string): Promise<Video | null> {
    return this.dataSource.getRepository(Video).findOneBy({ id });
  }
  findByPublicId(publicId: string): Promise<Video | null> {
    return this.dataSource
      .getRepository(Video)
      .findOneBy({ public_id: publicId });
  }

  async markUploadError(
    id: string,
    generation: number,
    code: string,
  ): Promise<boolean> {
    const result = await this.dataSource
      .getRepository(Video)
      .createQueryBuilder()
      .update()
      .set({
        status: 'error',
        failure_stage: 'upload',
        failure_code: code,
        updated_at: new Date(),
      })
      .where(
        'id = :id AND generation = :generation AND status = :status AND upload_confirmed_at IS NULL',
        { id, generation, status: 'draft' },
      )
      .execute();
    return result.affected === 1;
  }

  async claimProcessing(
    id: string,
    generation: number,
    token: string,
    leaseUntil: Date,
  ): Promise<boolean> {
    const result = await this.dataSource
      .getRepository(Video)
      .createQueryBuilder()
      .update()
      .set({
        status: 'processing',
        processing_token: token,
        processing_lease_until: leaseUntil,
        failure_stage: null,
        failure_code: null,
        updated_at: new Date(),
      })
      .where(
        'id = :id AND generation = :generation AND upload_confirmed_at IS NOT NULL AND (processing_token IS NULL OR processing_lease_until < now()) AND EXISTS (SELECT 1 FROM video_processing_outbox o WHERE o.video_id = videos.id AND o.generation = videos.generation)',
        { id, generation },
      )
      .andWhere(
        "(status IN ('draft', 'processing') OR (status = 'error' AND failure_code IS NULL))",
      )
      .execute();
    return result.affected === 1;
  }

  async markReady(input: ReadyVideoInput): Promise<boolean> {
    const result = await this.dataSource
      .getRepository(Video)
      .createQueryBuilder()
      .update()
      .set({
        status: 'ready',
        duration_ms: String(input.durationMs),
        media_metadata: input.metadata,
        thumbnail_bucket: input.thumbnailBucket,
        thumbnail_key: input.thumbnailKey,
        thumbnail_bytes: String(input.thumbnailBytes),
        processing_token: null,
        processing_lease_until: null,
        updated_at: new Date(),
      })
      .where(
        'id = :id AND generation = :generation AND status = :status AND processing_token = :token AND processing_lease_until > now()',
        {
          id: input.videoId,
          generation: input.generation,
          status: 'processing',
          token: input.processingToken,
        },
      )
      .execute();
    return result.affected === 1;
  }

  async markProcessingError(
    id: string,
    generation: number,
    token: string,
    code: string,
  ): Promise<boolean> {
    return this.markFailure(id, generation, token, 'processing', code);
  }

  async prepareReprocess(
    channelId: string,
    videoId: string,
  ): Promise<number | null> {
    return this.dataSource.transaction(async (manager) => {
      const video = await manager
        .getRepository(Video)
        .createQueryBuilder('video')
        .setLock('pessimistic_write')
        .where('video.id = :videoId AND video.channel_id = :channelId', {
          videoId,
          channelId,
        })
        .getOne();
      if (
        !video ||
        video.status !== 'error' ||
        !video.upload_confirmed_at ||
        !video.failure_code
      )
        return null;
      const nextGeneration = video.generation + 1;
      await manager.getRepository(Video).update(video.id, {
        generation: nextGeneration,
        failure_stage: null,
        failure_code: null,
        processing_token: null,
        processing_lease_until: null,
      });
      await manager.getRepository(VideoProcessingOutbox).insert({
        video_id: video.id,
        generation: nextGeneration,
        event_name: 'process-video-v1',
        schema_version: 1,
        status: 'pending',
      });
      return nextGeneration;
    });
  }

  async markFailure(
    id: string,
    generation: number,
    token: string | null,
    stage: VideoFailureStage,
    code: string,
  ): Promise<boolean> {
    const query = this.dataSource
      .getRepository(Video)
      .createQueryBuilder()
      .update()
      .set({
        status: 'error',
        failure_stage: stage,
        failure_code: code,
        processing_token: null,
        processing_lease_until: null,
        updated_at: new Date(),
      })
      .where('id = :id AND generation = :generation AND status = :status', {
        id,
        generation,
        status: stage === 'upload' ? 'draft' : 'processing',
      });
    if (token)
      query.andWhere(
        'processing_token = :token AND processing_lease_until > now()',
        { token },
      );
    else query.andWhere('processing_token IS NULL');
    const result = await query.execute();
    return result.affected === 1;
  }
}
