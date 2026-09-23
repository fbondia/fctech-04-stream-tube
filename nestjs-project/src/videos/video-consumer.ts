import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Video } from './entities/video.entity';
import { VideoMedia, MediaFailure } from './video-media';
import { TypeOrmVideosRepository } from './typeorm-videos.repository';
import { isVideoJob, VideoJob } from './video-dispatcher';

export class VideoConsumer {
  private readonly logger = new Logger(VideoConsumer.name);
  private readonly repository: TypeOrmVideosRepository;

  constructor(
    private readonly db: DataSource,
    private readonly media: VideoMedia,
    private readonly thumbnailBucket: string,
  ) {
    this.repository = new TypeOrmVideosRepository(db);
  }

  async process(job: Job<VideoJob>): Promise<void> {
    if (!isVideoJob(job)) throw new UnrecoverableError('INVALID_JOB');
    const { videoId, generation, outboxId } = job.data;
    const intents = await this.db.query<Array<{ id: string }>>(
      `SELECT id FROM video_processing_outbox WHERE id = $1 AND video_id = $2
       AND generation = $3 AND event_name = 'process-video-v1' AND schema_version = 1`,
      [outboxId, videoId, generation],
    );
    const intent = intents[0];
    if (!intent) throw new UnrecoverableError('INVALID_JOB');
    const current = await this.repository.findById(videoId);
    if (
      !current ||
      current.generation !== generation ||
      current.status === 'ready' ||
      (current.status === 'error' && current.failure_code)
    )
      return;
    const token = randomUUID();
    if (
      !(await this.repository.claimProcessing(
        videoId,
        generation,
        token,
        new Date(Date.now() + 120_000),
      ))
    ) {
      const latest = await this.repository.findById(videoId);
      if (
        latest?.status === 'ready' ||
        latest?.generation !== generation ||
        (latest?.status === 'error' && latest.failure_code)
      )
        return;
      throw new Error('PROCESSING_LEASE_BUSY');
    }
    let leaseLost = false;
    let renewing = false;
    const renew = setInterval(() => {
      if (renewing) return;
      renewing = true;
      void this.db
        .query(
          `UPDATE videos SET processing_lease_until = now() + interval '2 minutes'
         WHERE id = $1 AND generation = $2 AND processing_token = $3
           AND status = 'processing' AND processing_lease_until > now() RETURNING id`,
          [videoId, generation, token],
        )
        .then((result: [{ id: string }[], number]) => {
          if (result[0].length !== 1) leaseLost = true;
        })
        .catch(() => {
          leaseLost = true;
        })
        .finally(() => {
          renewing = false;
        });
    }, 30_000);
    try {
      const video = (await this.repository.findById(videoId)) as Video;
      const thumbnailKey = `channels/${video.channel_id}/videos/${video.id}/thumbnails/${generation}.jpg`;
      const processed = await this.media.process(
        video.original_bucket,
        video.original_key,
        Number(video.uploaded_bytes),
        this.thumbnailBucket,
        thumbnailKey,
      );
      if (
        leaseLost ||
        !(await this.repository.markReady({
          videoId,
          generation,
          processingToken: token,
          durationMs: processed.durationMs,
          metadata: processed.metadata,
          thumbnailBucket: this.thumbnailBucket,
          thumbnailKey,
          thumbnailBytes: processed.thumbnailBytes,
        }))
      )
        throw new Error('PROCESSING_LEASE_LOST');
      this.logger.log(
        `ready videoId=${videoId} outboxId=${outboxId} jobId=${job.id} attempt=${job.attemptsMade + 1}`,
      );
    } catch (error) {
      const failure = error instanceof MediaFailure ? error : null;
      const code = failure?.code ?? 'STORAGE_FAILURE';
      const terminal =
        failure?.permanent || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (terminal) {
        await this.repository.markProcessingError(
          videoId,
          generation,
          token,
          failure?.permanent
            ? code === 'THUMBNAIL_FAILED'
              ? code
              : 'INVALID_MEDIA'
            : 'PROCESSING_RETRIES_EXHAUSTED',
        );
      } else {
        await this.db.query(
          `UPDATE videos SET processing_token = NULL, processing_lease_until = NULL,
             updated_at = now() WHERE id = $1 AND generation = $2 AND processing_token = $3
             AND status = 'processing'`,
          [videoId, generation, token],
        );
      }
      this.logger.warn(
        `failed videoId=${videoId} outboxId=${outboxId} jobId=${job.id} attempt=${job.attemptsMade + 1} code=${code}`,
      );
      if (failure?.permanent) throw new UnrecoverableError(code);
      throw error;
    } finally {
      clearInterval(renew);
    }
  }
}
