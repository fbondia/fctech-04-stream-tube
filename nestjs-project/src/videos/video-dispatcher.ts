import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

export const VIDEO_QUEUE = 'video-processing';
export const VIDEO_JOB = 'process-video-v1';

export interface VideoJob {
  schemaVersion: 1;
  videoId: string;
  generation: number;
  outboxId: string;
}

export function videoJobId(videoId: string, generation: number): string {
  return `video-${videoId}-g${generation}`;
}

interface Intent {
  id: string;
  video_id: string;
  generation: number;
  lease_token: string;
}

export class VideoDispatcher {
  private readonly logger = new Logger(VideoDispatcher.name);

  constructor(
    private readonly db: DataSource,
    private readonly queue: Queue<VideoJob>,
  ) {}

  private async claim(): Promise<Intent | undefined> {
    const token = randomUUID();
    return this.db.transaction(async (manager) => {
      const rows: Omit<Intent, 'lease_token'>[] = await manager.query(
        `SELECT o.id, o.video_id, o.generation FROM video_processing_outbox o
         JOIN videos v ON v.id = o.video_id AND v.generation = o.generation
         WHERE o.status = 'pending' AND (o.lease_until IS NULL OR o.lease_until < now())
           AND v.upload_confirmed_at IS NOT NULL AND v.status <> 'ready'
           AND (v.status <> 'error' OR v.failure_code IS NULL)
         ORDER BY o.created_at FOR UPDATE OF o SKIP LOCKED LIMIT 1`,
      );
      const row = rows[0];
      if (!row) return undefined;
      await manager.query(
        `UPDATE video_processing_outbox SET lease_token = $1,
           lease_until = now() + interval '2 minutes',
           dispatch_attempts = dispatch_attempts + 1,
           last_attempt_at = now(), updated_at = now() WHERE id = $2`,
        [token, row.id],
      );
      return { ...row, lease_token: token };
    });
  }

  async dispatch(limit = 50): Promise<number> {
    let count = 0;
    for (let index = 0; index < limit; index++) {
      const intent = await this.claim();
      if (!intent) break;
      try {
        const payload: VideoJob = {
          schemaVersion: 1,
          videoId: intent.video_id,
          generation: intent.generation,
          outboxId: intent.id,
        };
        await this.queue.add(VIDEO_JOB, payload, {
          jobId: videoJobId(payload.videoId, payload.generation),
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: { age: 7 * 86400, count: 1000 },
          removeOnFail: { age: 14 * 86400, count: 1000 },
        });
        await this.db.query(
          `UPDATE video_processing_outbox SET status = 'published',
             published_at = now(), lease_token = NULL, lease_until = NULL, updated_at = now()
           WHERE id = $1 AND lease_token = $2 AND status = 'pending'`,
          [intent.id, intent.lease_token],
        );
        count++;
      } catch (error) {
        await this.db.query(
          `UPDATE video_processing_outbox SET lease_token = NULL, lease_until = NULL,
             updated_at = now() WHERE id = $1 AND lease_token = $2`,
          [intent.id, intent.lease_token],
        );
        this.logger.warn(
          `dispatch failed videoId=${intent.video_id} outboxId=${intent.id} code=QUEUE_UNAVAILABLE`,
        );
        throw error;
      }
    }
    return count;
  }

  async reconcile(limit = 50): Promise<void> {
    const rows: {
      id: string;
      video_id: string;
      generation: number;
      status: string;
    }[] = await this.db.query(
      `SELECT o.id, o.video_id, o.generation, v.status FROM video_processing_outbox o
         JOIN videos v ON v.id = o.video_id AND v.generation = o.generation
         WHERE o.status = 'published' AND o.published_at < now() - interval '2 minutes'
           AND v.status <> 'ready' AND (v.status <> 'error' OR v.failure_code IS NULL)
         ORDER BY o.published_at LIMIT $1`,
      [limit],
    );
    for (const row of rows) {
      const job = await this.queue.getJob(
        videoJobId(row.video_id, row.generation),
      );
      if (!job) {
        await this.db.query(
          `UPDATE video_processing_outbox SET status = 'pending', published_at = NULL,
             updated_at = now() WHERE id = $1 AND status = 'published'`,
          [row.id],
        );
        continue;
      }
      const state = await job.getState();
      if (state === 'failed') {
        await this.markTerminalFailure(row.video_id, row.generation);
      } else if (state === 'completed') {
        this.logger.error(
          `completed job without ready videoId=${row.video_id} outboxId=${row.id} jobId=${job.id}`,
        );
      }
    }
  }

  async markTerminalFailure(
    videoId: string,
    generation: number,
  ): Promise<void> {
    await this.db.query(
      `UPDATE videos SET status = 'error', failure_stage = 'processing',
         failure_code = 'PROCESSING_RETRIES_EXHAUSTED', processing_token = NULL,
         processing_lease_until = NULL, updated_at = now()
       WHERE id = $1 AND generation = $2 AND upload_confirmed_at IS NOT NULL
         AND status IN ('draft', 'processing')
         AND (processing_token IS NULL OR processing_lease_until < now())`,
      [videoId, generation],
    );
  }

  async metrics(): Promise<{
    pending: number;
    oldestPendingSeconds: number;
    processing: number;
    oldestProcessingSeconds: number;
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
  }> {
    const metricsRows = await this.db.query<
      Array<{
        pending: number;
        oldest: number;
        processing: number;
        processing_age: number;
      }>
    >(
      `SELECT count(*) FILTER (WHERE o.status = 'pending')::int AS pending,
        coalesce(extract(epoch FROM now() - min(o.created_at) FILTER (WHERE o.status = 'pending')), 0)::int AS oldest,
        (SELECT count(*)::int FROM videos WHERE status = 'processing') AS processing,
        coalesce((SELECT extract(epoch FROM now() - min(updated_at))::int
          FROM videos WHERE status = 'processing'), 0) AS processing_age
       FROM video_processing_outbox o`,
    );
    const row = metricsRows[0];
    const counts = await this.queue.getJobCounts(
      'waiting',
      'active',
      'delayed',
      'failed',
    );
    return {
      pending: row.pending,
      oldestPendingSeconds: row.oldest,
      processing: row.processing,
      oldestProcessingSeconds: row.processing_age,
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      failed: counts.failed ?? 0,
    };
  }
}

export function isVideoJob(job: Job<unknown>): job is Job<VideoJob> {
  const data = job.data as Partial<VideoJob> | null;
  return (
    job.name === VIDEO_JOB &&
    data?.schemaVersion === 1 &&
    typeof data.videoId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(data.videoId) &&
    Number.isSafeInteger(data.generation) &&
    data.generation! > 0 &&
    typeof data.outboxId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(data.outboxId) &&
    job.id === videoJobId(data.videoId, data.generation!)
  );
}
