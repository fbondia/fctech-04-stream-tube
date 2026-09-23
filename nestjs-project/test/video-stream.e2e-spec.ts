import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Channel } from '../src/channels/entities/channel.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import storageConfig from '../src/config/storage.config';
import { User } from '../src/users/entities/user.entity';
import { Video } from '../src/videos/entities/video.entity';
import { VideoProcessingOutbox } from '../src/videos/entities/video-processing-outbox.entity';
import { S3VideoStorage } from '../src/videos/video-storage';
import { VideosService } from '../src/videos/videos.service';

function binary(
  response: SupertestResponse,
  callback: (error: Error | null, body?: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
  response.on('error', callback);
}

describe('Ready video watch API (real PostgreSQL and MinIO)', () => {
  let app: INestApplication<App>;
  let db: DataSource;
  let apiS3: S3Client;
  let adminS3: S3Client;
  let storage: S3VideoStorage;
  let userId: string;
  let channelId: string;
  let otherUserId: string;
  let otherChannelId: string;
  let token: string;
  let otherToken: string;
  let ready: Video;
  let draft: Video;
  let bytes: Buffer;
  const thumbnail = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const settings = storageConfig();

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
    const jwt = module.get(JwtService);
    const videos = module.get(VideosService);
    storage = new S3VideoStorage(settings);
    apiS3 = new S3Client({
      endpoint: settings.internalEndpoint,
      region: settings.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: settings.api.accessKey!,
        secretAccessKey: settings.api.secretKey!,
      },
    });
    adminS3 = new S3Client({
      endpoint: settings.internalEndpoint,
      region: settings.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.MINIO_ROOT_USER!,
        secretAccessKey: process.env.MINIO_ROOT_PASSWORD!,
      },
    });
    for (const owner of [true, false]) {
      const email = `${randomUUID()}@example.com`;
      const user = await db
        .getRepository(User)
        .save({ email, password: 'hash' });
      const channel = await db.getRepository(Channel).save({
        user_id: user.id,
        name: 'Watch test',
        nickname: `v${randomUUID().replaceAll('-', '').slice(0, 20)}`,
      });
      if (owner) {
        userId = user.id;
        channelId = channel.id;
        token = jwt.sign({ sub: user.id, email });
      } else {
        otherUserId = user.id;
        otherChannelId = channel.id;
        otherToken = jwt.sign({ sub: user.id, email });
      }
    }
    bytes = await readFile(
      join(__dirname, '../src/videos/fixtures/video-fixture.mp4'),
    );
    ready = await videos.createDraft(userId, {
      title: 'Watch fixture',
      filename: 'ação "final".mp4',
      mime: 'video/mp4',
      expectedBytes: bytes.length,
    });
    draft = await videos.createDraft(userId, {
      title: 'Draft fixture',
      filename: 'draft.mp4',
      mime: 'video/mp4',
      expectedBytes: 1,
    });
    const uploadId = await storage.initiate(
      ready.original_bucket,
      ready.original_key,
      ready.declared_mime,
    );
    const part = await apiS3.send(
      new UploadPartCommand({
        Bucket: ready.original_bucket,
        Key: ready.original_key,
        UploadId: uploadId,
        PartNumber: 1,
        Body: bytes,
      }),
    );
    await storage.complete(
      ready.original_bucket,
      ready.original_key,
      uploadId,
      [{ partNumber: 1, eTag: part.ETag!, sizeBytes: bytes.length }],
    );
    const object = await storage.head(
      ready.original_bucket,
      ready.original_key,
    );
    const thumbnailKey = `channels/${channelId}/videos/${ready.id}/thumbnails/1.jpg`;
    await adminS3.send(
      new PutObjectCommand({
        Bucket: settings.thumbnailsBucket,
        Key: thumbnailKey,
        Body: thumbnail,
        ContentType: 'image/jpeg',
      }),
    );
    await db.getRepository(Video).update(ready.id, {
      status: 'ready',
      upload_confirmed_at: new Date(),
      uploaded_bytes: String(bytes.length),
      object_etag: object!.eTag,
      duration_ms: '1000',
      thumbnail_bucket: settings.thumbnailsBucket,
      thumbnail_key: thumbnailKey,
      thumbnail_bytes: String(thumbnail.length),
    });
    ready = (await db.getRepository(Video).findOneBy({ id: ready.id }))!;
  });

  afterAll(async () => {
    if (ready) {
      await adminS3.send(
        new DeleteObjectCommand({
          Bucket: ready.original_bucket,
          Key: ready.original_key,
        }),
      );
      await adminS3.send(
        new DeleteObjectCommand({
          Bucket: ready.thumbnail_bucket!,
          Key: ready.thumbnail_key!,
        }),
      );
    }
    if (db) {
      for (const video of [ready, draft])
        if (video) {
          await db
            .getRepository(VideoProcessingOutbox)
            .delete({ video_id: video.id });
          await db.getRepository(Video).delete(video.id);
        }
      await db.getRepository(Channel).delete([channelId, otherChannelId]);
      await db.getRepository(User).delete([userId, otherUserId]);
    }
    apiS3?.destroy();
    adminS3?.destroy();
    await app?.close();
  });

  it('shows only ready metadata and hides private states', async () => {
    const result = await request(app.getHttpServer())
      .get(`/watch/${ready.public_id}`)
      .expect(200);
    expect(result.body).toEqual({
      publicId: ready.public_id,
      title: ready.title,
      durationMs: 1000,
      sizeBytes: bytes.length,
      mimeType: 'video/mp4',
      streamUrl: `/watch/${ready.public_id}/stream`,
      downloadUrl: `/watch/${ready.public_id}/download`,
      thumbnailUrl: `/watch/${ready.public_id}/thumbnail`,
    });
    for (const path of ['', '/stream', '/download', '/thumbnail'])
      await request(app.getHttpServer())
        .get(`/watch/${draft.public_id}${path}`)
        .expect(404);
    await request(app.getHttpServer()).get('/watch/invalid').expect(404);
    await request(app.getHttpServer())
      .get(`/videos/${draft.id}`)
      .auth(otherToken, { type: 'bearer' })
      .expect(404);
    await request(app.getHttpServer())
      .get(`/videos/${draft.id}`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    for (const status of ['processing', 'error'] as const) {
      await db.getRepository(Video).update(draft.id, { status });
      for (const path of ['', '/stream', '/download', '/thumbnail'])
        await request(app.getHttpServer())
          .get(`/watch/${draft.public_id}${path}`)
          .expect(404);
    }
  });

  it('streams exact full and partial bytes with headers and HEAD', async () => {
    const url = `/watch/${ready.public_id}/stream`;
    const head = await request(app.getHttpServer())
      .head(url)
      .set('Range', 'bytes=1-2')
      .expect(200);
    expect(head.headers['content-length']).toBe(String(bytes.length));
    expect(head.headers.etag).toBe(ready.object_etag);
    expect(head.headers['accept-ranges']).toBe('bytes');
    const full = await request(app.getHttpServer())
      .get(url)
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(full.body).toEqual(bytes);
    for (const [range, start, end] of [
      ['bytes=0-9', 0, 9],
      ['bytes=20-29', 20, 29],
      [`bytes=${bytes.length - 10}-`, bytes.length - 10, bytes.length - 1],
      ['bytes=-10', bytes.length - 10, bytes.length - 1],
    ] as const) {
      const result = await request(app.getHttpServer())
        .get(url)
        .set('Range', range)
        .buffer(true)
        .parse(binary)
        .expect(206);
      expect(result.body).toEqual(bytes.subarray(start, end + 1));
      expect(result.headers['content-range']).toBe(
        `bytes ${start}-${end}/${bytes.length}`,
      );
      expect(result.headers['content-length']).toBe(String(end - start + 1));
    }
    const ignored = await request(app.getHttpServer())
      .get(url)
      .set('Range', 'bytes=0-1')
      .set('If-Range', '"wrong"')
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(ignored.body).toEqual(bytes);
    await request(app.getHttpServer())
      .get(url)
      .set('Range', 'bytes=0-1')
      .set('If-Range', ready.object_etag!)
      .expect(206);
    await request(app.getHttpServer())
      .get(url)
      .set('Range', 'bytes=0-1,3-4')
      .expect(400);
    const invalid = await request(app.getHttpServer())
      .get(url)
      .set('Range', `bytes=${bytes.length}-`)
      .expect(416);
    expect(invalid.headers['content-range']).toBe(`bytes */${bytes.length}`);
  });

  it('downloads the same bytes and proxies thumbnail without internal keys', async () => {
    const download = await request(app.getHttpServer())
      .get(`/watch/${ready.public_id}/download`)
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(download.body).toEqual(bytes);
    expect(download.headers['content-disposition']).toContain(
      "filename*=UTF-8''a%C3%A7%C3%A3o",
    );
    const partial = await request(app.getHttpServer())
      .get(`/watch/${ready.public_id}/download`)
      .set('Range', 'bytes=0-3')
      .buffer(true)
      .parse(binary)
      .expect(206);
    expect(partial.body).toEqual(bytes.subarray(0, 4));
    const image = await request(app.getHttpServer())
      .get(`/watch/${ready.public_id}/thumbnail`)
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(image.body).toEqual(thumbnail);
    expect(image.headers['content-type']).toMatch(/^image\/jpeg/);
    expect(JSON.stringify(download.headers)).not.toContain(ready.original_key);
  });
});
