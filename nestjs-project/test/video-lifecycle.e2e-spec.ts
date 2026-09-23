import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Channel } from '../src/channels/entities/channel.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import queueConfig from '../src/config/queue.config';
import storageConfig from '../src/config/storage.config';
import { User } from '../src/users/entities/user.entity';
import { Video } from '../src/videos/entities/video.entity';
import { VideoProcessingOutbox } from '../src/videos/entities/video-processing-outbox.entity';
import {
  VideoDispatcher,
  VideoJob,
  VIDEO_QUEUE,
  videoJobId,
} from '../src/videos/video-dispatcher';

function binary(
  response: SupertestResponse,
  callback: (error: Error | null, body?: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
  response.on('error', callback);
}

function putSigned(urlString: string, bytes: Buffer): Promise<string> {
  const url = new URL(urlString);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: 'minio',
        port: 9000,
        method: 'PUT',
        path: `${url.pathname}${url.search}`,
        headers: { Host: url.host, 'Content-Length': bytes.length },
      },
      (response) => {
        response.resume();
        response.on('end', () => {
          if (response.statusCode !== 200 || !response.headers.etag)
            return reject(
              new Error(`S3 UploadPart status ${response.statusCode}`),
            );
          resolve(response.headers.etag);
        });
      },
    );
    req.on('error', reject);
    req.end(bytes);
  });
}

describe('Video lifecycle (real API, PostgreSQL, MinIO, Redis and worker)', () => {
  let app: INestApplication<App>;
  let db: DataSource;
  let queue: Queue<VideoJob>;
  let s3: S3Client;
  let userId: string;
  let channelId: string;
  let token: string;
  let videoId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();
    db = module.get(DataSource);
    const email = `${randomUUID()}@example.com`;
    const user = await db.getRepository(User).save({ email, password: 'hash' });
    userId = user.id;
    token = module.get(JwtService).sign({ sub: userId, email });
    const channel = await db.getRepository(Channel).save({
      user_id: userId,
      name: 'Lifecycle',
      nickname: `l${randomUUID().replaceAll('-', '').slice(0, 20)}`,
    });
    channelId = channel.id;
    const redis = queueConfig();
    queue = new Queue<VideoJob>(VIDEO_QUEUE, {
      connection: { host: redis.host, port: redis.port },
    });
    const storage = storageConfig();
    s3 = new S3Client({
      endpoint: storage.internalEndpoint,
      region: storage.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.MINIO_ROOT_USER!,
        secretAccessKey: process.env.MINIO_ROOT_PASSWORD!,
      },
    });
  });

  afterAll(async () => {
    if (videoId && db?.isInitialized) {
      const video = await db.getRepository(Video).findOneBy({ id: videoId });
      const job = await queue?.getJob(videoJobId(videoId, 1));
      await job?.remove();
      if (video) {
        await s3.send(
          new DeleteObjectCommand({
            Bucket: video.original_bucket,
            Key: video.original_key,
          }),
        );
        if (video.thumbnail_bucket && video.thumbnail_key)
          await s3.send(
            new DeleteObjectCommand({
              Bucket: video.thumbnail_bucket,
              Key: video.thumbnail_key,
            }),
          );
        await db
          .getRepository(VideoProcessingOutbox)
          .delete({ video_id: videoId });
        await db.getRepository(Video).delete(videoId);
      }
    }
    if (channelId) await db.getRepository(Channel).delete(channelId);
    if (userId) await db.getRepository(User).delete(userId);
    await queue?.close();
    s3?.destroy();
    await app?.close();
  });

  it('uploads directly, processes once and delivers exact media bytes', async () => {
    const bytes = await readFile(
      join(__dirname, '../src/videos/fixtures/video-fixture.mp4'),
    );
    const created = await request(app.getHttpServer())
      .post('/videos/uploads')
      .auth(token, { type: 'bearer' })
      .send({
        title: 'Full lifecycle',
        filename: 'fixture.mp4',
        mimeType: 'video/mp4',
        sizeBytes: bytes.length,
      })
      .expect(201);
    videoId = (created.body as { videoId: string }).videoId;
    const signed = await request(app.getHttpServer())
      .post(`/videos/${videoId}/upload-parts`)
      .auth(token, { type: 'bearer' })
      .send({ partNumbers: [1] })
      .expect(200);
    const url = (signed.body as { parts: Array<{ url: string }> }).parts[0].url;
    const eTag = await putSigned(url, bytes);
    await request(app.getHttpServer())
      .post(`/videos/${videoId}/upload/complete`)
      .auth(token, { type: 'bearer' })
      .send({ parts: [{ partNumber: 1, eTag }] })
      .expect(202);
    await request(app.getHttpServer())
      .post(`/videos/${videoId}/upload/complete`)
      .auth(token, { type: 'bearer' })
      .send({ parts: [{ partNumber: 1, eTag }] })
      .expect(202);
    expect(
      await db
        .getRepository(VideoProcessingOutbox)
        .countBy({ video_id: videoId }),
    ).toBe(1);

    const dispatcher = new VideoDispatcher(db, queue);
    await dispatcher.dispatch();
    const deadline = Date.now() + 40_000;
    let video: Video | null = null;
    while (Date.now() < deadline) {
      video = await db.getRepository(Video).findOneBy({ id: videoId });
      if (video?.status === 'ready') break;
      if (video?.status === 'error')
        throw new Error(`Processing failed: ${video.failure_code}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(video?.status).toBe('ready');
    expect(Number(video?.duration_ms)).toBeGreaterThan(0);
    const publicId = video!.public_id;
    const metadata = await request(app.getHttpServer())
      .get(`/watch/${publicId}`)
      .expect(200);
    expect(metadata.body).toMatchObject({ publicId, sizeBytes: bytes.length });
    const stream = await request(app.getHttpServer())
      .get(`/watch/${publicId}/stream`)
      .set('Range', 'bytes=0-63')
      .buffer(true)
      .parse(binary)
      .expect(206);
    expect(stream.body).toEqual(bytes.subarray(0, 64));
    const download = await request(app.getHttpServer())
      .get(`/watch/${publicId}/download`)
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(download.body).toEqual(bytes);
    const thumbnail = await request(app.getHttpServer())
      .get(`/watch/${publicId}/thumbnail`)
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect((thumbnail.body as Buffer).subarray(0, 3)).toEqual(
      Buffer.from([0xff, 0xd8, 0xff]),
    );
  }, 55_000);
});
