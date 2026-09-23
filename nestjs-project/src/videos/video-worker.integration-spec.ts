import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Channel } from '../channels/entities/channel.entity';
import storageConfig from '../config/storage.config';
import queueConfig from '../config/queue.config';
import { Video } from './entities/video.entity';
import { VideoProcessingOutbox } from './entities/video-processing-outbox.entity';
import { TypeOrmVideosRepository } from './typeorm-videos.repository';
import { VideosService } from './videos.service';
import { S3VideoStorage } from './video-storage';
import {
  VideoDispatcher,
  VideoJob,
  VIDEO_QUEUE,
  videoJobId,
} from './video-dispatcher';

describe('Video processing (PostgreSQL + Redis + MinIO + worker)', () => {
  let db: DataSource;
  let queue: Queue<VideoJob>;
  let s3: S3Client;
  let cleanupS3: S3Client;
  let originalStorage: S3VideoStorage;
  const settings = storageConfig();
  let userId: string;
  let channelId: string;
  const videoIds: string[] = [];

  beforeAll(async () => {
    db = createTestDataSource([User, Channel, Video, VideoProcessingOutbox], {
      synchronize: false,
    });
    await db.initialize();
    const user = await db
      .getRepository(User)
      .save({ email: `worker-${randomUUID()}@example.com`, password: 'hash' });
    userId = user.id;
    const channel = await db.getRepository(Channel).save({
      user_id: userId,
      name: 'Worker',
      nickname: `w${randomUUID().replaceAll('-', '').slice(0, 20)}`,
    });
    channelId = channel.id;
    const redis = queueConfig();
    queue = new Queue<VideoJob>(VIDEO_QUEUE, {
      connection: { host: redis.host, port: redis.port },
    });
    s3 = new S3Client({
      endpoint: settings.internalEndpoint,
      region: settings.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: settings.api.accessKey!,
        secretAccessKey: settings.api.secretKey!,
      },
    });
    cleanupS3 = new S3Client({
      endpoint: settings.internalEndpoint,
      region: settings.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.MINIO_ROOT_USER!,
        secretAccessKey: process.env.MINIO_ROOT_PASSWORD!,
      },
    });
    originalStorage = new S3VideoStorage(settings);
  });

  afterAll(async () => {
    for (const id of videoIds) {
      const video = await db.getRepository(Video).findOneBy({ id });
      if (!video) continue;
      await queue
        .getJob(videoJobId(id, 1))
        .then((job) => job?.remove())
        .catch(() => undefined);
      await s3.send(
        new DeleteObjectCommand({
          Bucket: video.original_bucket,
          Key: video.original_key,
        }),
      );
      if (video.thumbnail_key)
        await cleanupS3.send(
          new DeleteObjectCommand({
            Bucket: video.thumbnail_bucket!,
            Key: video.thumbnail_key,
          }),
        );
      await db.getRepository(VideoProcessingOutbox).delete({ video_id: id });
      await db.getRepository(Video).delete(id);
    }
    await db.getRepository(Channel).delete(channelId);
    await db.getRepository(User).delete(userId);
    await Promise.all([queue.close(), db.destroy()]);
    s3.destroy();
    cleanupS3.destroy();
  });

  async function submit(bytes: Buffer): Promise<Video> {
    const repository = new TypeOrmVideosRepository(db);
    const video = await new VideosService(repository, settings).createDraft(
      userId,
      {
        title: 'Processing fixture',
        filename: 'fixture.mp4',
        mime: 'video/mp4',
        expectedBytes: bytes.length,
      },
    );
    videoIds.push(video.id);
    const uploadId = await originalStorage.initiate(
      video.original_bucket,
      video.original_key,
      'video/mp4',
    );
    expect(
      await repository.setUpload(
        video.id,
        uploadId,
        new Date(Date.now() + 60_000),
      ),
    ).toBe(true);
    const part = await s3.send(
      new UploadPartCommand({
        Bucket: video.original_bucket,
        Key: video.original_key,
        UploadId: uploadId,
        PartNumber: 1,
        Body: bytes,
      }),
    );
    await originalStorage.complete(
      video.original_bucket,
      video.original_key,
      uploadId,
      [{ partNumber: 1, eTag: part.ETag!, sizeBytes: bytes.length }],
    );
    const token = randomUUID();
    expect(
      await repository.claimCompletion(
        video.id,
        token,
        new Date(Date.now() + 60_000),
      ),
    ).toBe(true);
    expect(
      await repository.confirmUpload(video.id, token, bytes.length, part.ETag!),
    ).toBe(true);
    return video;
  }

  async function awaitStatus(
    id: string,
    status: 'ready' | 'error',
  ): Promise<Video> {
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline) {
      const video = (await db.getRepository(Video).findOneBy({ id }))!;
      if (video.status === status) return video;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Video ${id} did not reach ${status}`);
  }

  it('processes a real MP4 once, stores a JPEG, and preserves ready on redelivery', async () => {
    const bytes = await readFile(join(__dirname, 'fixtures/video-fixture.mp4'));
    const video = await submit(bytes);
    const dispatcher = new VideoDispatcher(db, queue);
    expect(await dispatcher.dispatch()).toBe(1);
    const ready = await awaitStatus(video.id, 'ready');
    expect(Number(ready.duration_ms)).toBeGreaterThan(0);
    expect(ready.media_metadata).toMatchObject({
      width: 128,
      height: 72,
      codec: 'mpeg4',
    });
    const jpeg = await s3.send(
      new GetObjectCommand({
        Bucket: ready.thumbnail_bucket!,
        Key: ready.thumbnail_key!,
      }),
    );
    expect(jpeg.ContentType).toBe('image/jpeg');
    expect(jpeg.ContentLength).toBeGreaterThan(0);
    expect(await dispatcher.dispatch()).toBe(0);
    const job = await queue.getJob(videoJobId(video.id, 1));
    await job?.remove();
    await queue.add(
      'process-video-v1',
      {
        schemaVersion: 1,
        videoId: video.id,
        generation: 1,
        outboxId: (
          await db
            .getRepository(VideoProcessingOutbox)
            .findOneByOrFail({ video_id: video.id })
        ).id,
      },
      { jobId: videoJobId(video.id, 1) },
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(
      (await db.getRepository(Video).findOneByOrFail({ id: video.id })).status,
    ).toBe('ready');
  }, 55_000);

  it('rejects invalid media and records a sanitized failure', async () => {
    const video = await submit(Buffer.from('not an MP4'));
    expect(await new VideoDispatcher(db, queue).dispatch()).toBe(1);
    const failed = await awaitStatus(video.id, 'error');
    expect(failed.failure_code).toBe('INVALID_MEDIA');
    expect(failed.thumbnail_key).toBeNull();
  }, 55_000);

  it('reconciles a published intent whose Redis job was lost', async () => {
    const bytes = await readFile(join(__dirname, 'fixtures/video-fixture.mp4'));
    const video = await submit(bytes);
    await db
      .getRepository(VideoProcessingOutbox)
      .update(
        { video_id: video.id },
        { status: 'published', published_at: new Date(Date.now() - 180_000) },
      );
    const dispatcher = new VideoDispatcher(db, queue);
    await dispatcher.reconcile();
    await dispatcher.dispatch();
    expect((await awaitStatus(video.id, 'ready')).thumbnail_key).toContain(
      '/thumbnails/1.jpg',
    );
  }, 55_000);
});
