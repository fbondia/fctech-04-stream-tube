import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Channel } from '../channels/entities/channel.entity';
import { Video } from './entities/video.entity';
import { VideoProcessingOutbox } from './entities/video-processing-outbox.entity';
import { createTestDataSource } from '../test/create-test-data-source';
import storageConfig from '../config/storage.config';
import videoConfig from '../config/video.config';
import { TypeOrmVideosRepository } from './typeorm-videos.repository';
import { VideosService } from './videos.service';
import { S3VideoStorage } from './video-storage';
import { VideoUploadService } from './video-upload.service';

describe('VideoUploadService (PostgreSQL + MinIO integration)', () => {
  let db: DataSource;
  let uploads: VideoUploadService;
  let repository: TypeOrmVideosRepository;
  let ownerId: string;
  let otherId: string;
  const ids: string[] = [];
  const config = videoConfig();
  const storage = new S3VideoStorage(storageConfig());
  const storageSettings = storageConfig();
  const cleanupClient = new S3Client({
    endpoint: storageSettings.internalEndpoint,
    region: storageSettings.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: storageSettings.api.accessKey!,
      secretAccessKey: storageSettings.api.secretKey!,
    },
  });

  function putSigned(
    urlString: string,
    bytes: Buffer,
  ): Promise<{ status: number; eTag: string | undefined }> {
    const url = new URL(urlString);
    return new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: 'minio',
          port: 9000,
          method: 'PUT',
          path: `${url.pathname}${url.search}`,
          headers: { Host: url.host, 'Content-Length': bytes.length },
        },
        (response) => {
          response.resume();
          response.on('end', () =>
            resolve({
              status: response.statusCode ?? 0,
              eTag: response.headers.etag,
            }),
          );
        },
      );
      req.on('error', reject);
      req.end(bytes);
    });
  }

  beforeAll(async () => {
    db = createTestDataSource([User, Channel, Video, VideoProcessingOutbox], {
      synchronize: false,
    });
    await db.initialize();
    repository = new TypeOrmVideosRepository(db);
    uploads = new VideoUploadService(
      new VideosService(repository, storageConfig()),
      repository,
      storage,
      config,
    );
    for (const isOwner of [true, false]) {
      const user = await db
        .getRepository(User)
        .save({ email: `${randomUUID()}@example.com`, password: 'hash' });
      await db.getRepository(Channel).save({
        user_id: user.id,
        name: 'Upload test',
        nickname: `v${randomUUID().replaceAll('-', '').slice(0, 20)}`,
      });
      if (isOwner) ownerId = user.id;
      else otherId = user.id;
    }
  });

  afterAll(async () => {
    if (!db?.isInitialized) return;
    for (const id of ids) {
      const video = await db.getRepository(Video).findOneBy({ id });
      if (video?.upload_id && !video.upload_confirmed_at)
        await storage
          .abort(video.original_bucket, video.original_key, video.upload_id)
          .catch(() => undefined);
      if (video?.upload_confirmed_at)
        await cleanupClient.send(
          new DeleteObjectCommand({
            Bucket: video.original_bucket,
            Key: video.original_key,
          }),
        );
      await db.getRepository(VideoProcessingOutbox).delete({ video_id: id });
      await db.getRepository(Video).delete(id);
    }
    const channels = await db
      .getRepository(Channel)
      .find({ where: [{ user_id: ownerId }, { user_id: otherId }] });
    await db
      .getRepository(Channel)
      .delete(channels.map((channel) => channel.id));
    await db.getRepository(User).delete([ownerId, otherId]);
    await db.destroy();
    cleanupClient.destroy();
  });

  it('uploads directly, resumes, confirms once, and masks another owner', async () => {
    const bytes = Buffer.from('small real MinIO upload');
    const started = await uploads.initiate(ownerId, {
      title: 'Demo',
      filename: 'demo.mp4',
      mimeType: 'video/mp4',
      sizeBytes: bytes.length,
    });
    ids.push(started.videoId);
    expect(started.partCount).toBe(1);
    await expect(
      uploads.resume(otherId, started.videoId),
    ).rejects.toMatchObject({ errorCode: 'VIDEO_NOT_FOUND' });
    const signed = await uploads.sign(ownerId, started.videoId, [1]);
    const uploaded = await putSigned(signed.parts[0].url, bytes);
    expect(uploaded.status).toBe(200);
    const eTag = uploaded.eTag;
    expect(eTag).toBeTruthy();
    const resumed = await uploads.resume(ownerId, started.videoId);
    expect(resumed.parts).toMatchObject([
      { partNumber: 1, eTag, sizeBytes: bytes.length },
    ]);
    const parts = [{ partNumber: 1, eTag: eTag! }];
    await expect(
      uploads.complete(ownerId, started.videoId, [
        { partNumber: 1, eTag: '"wrong"' },
      ]),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_PARTS_MISMATCH' });
    expect(
      await uploads.complete(ownerId, started.videoId, parts),
    ).toMatchObject({ confirmed: true, status: 'draft' });
    expect(
      await uploads.complete(ownerId, started.videoId, parts),
    ).toMatchObject({ confirmed: true });
    const video = await db
      .getRepository(Video)
      .findOneByOrFail({ id: started.videoId });
    expect(video.uploaded_bytes).toBe(String(bytes.length));
    expect(video.upload_confirmed_at).toBeTruthy();
    expect(
      await db
        .getRepository(VideoProcessingOutbox)
        .countBy({ video_id: started.videoId }),
    ).toBe(1);
    await expect(
      uploads.cancel(ownerId, started.videoId),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_ALREADY_CONFIRMED' });
  });

  it('rejects size mismatch and supports cancellation', async () => {
    const started = await uploads.initiate(ownerId, {
      title: 'Cancel',
      filename: 'cancel.webm',
      mimeType: 'video/webm',
      sizeBytes: 100,
    });
    ids.push(started.videoId);
    const signed = await uploads.sign(ownerId, started.videoId, [1]);
    const response = await putSigned(signed.parts[0].url, Buffer.from('short'));
    expect(response.status).toBe(200);
    await expect(
      uploads.complete(ownerId, started.videoId, [
        { partNumber: 1, eTag: response.eTag! },
      ]),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_PARTS_MISMATCH' });
    await uploads.cancel(ownerId, started.videoId);
    await uploads.cancel(ownerId, started.videoId);
    expect(
      (await db.getRepository(Video).findOneByOrFail({ id: started.videoId }))
        .status,
    ).toBe('error');
  });

  it('recovers after S3 completion when the database confirmation fails once', async () => {
    const bytes = Buffer.from('recovery');
    const started = await uploads.initiate(ownerId, {
      title: 'Recover',
      filename: 'recover.mp4',
      mimeType: 'video/mp4',
      sizeBytes: bytes.length,
    });
    ids.push(started.videoId);
    const signed = await uploads.sign(ownerId, started.videoId, [1]);
    const response = await putSigned(signed.parts[0].url, bytes);
    expect(response.status).toBe(200);
    const parts = [{ partNumber: 1, eTag: response.eTag! }];
    const interrupted = jest
      .spyOn(repository, 'confirmUpload')
      .mockRejectedValueOnce(new Error('database unavailable'));
    await expect(
      uploads.complete(ownerId, started.videoId, parts),
    ).rejects.toThrow('database unavailable');
    interrupted.mockRestore();
    expect(
      await uploads.complete(ownerId, started.videoId, parts),
    ).toMatchObject({ confirmed: true });
    expect(
      await db
        .getRepository(VideoProcessingOutbox)
        .countBy({ video_id: started.videoId }),
    ).toBe(1);
  });

  it('enforces the 10 GB metadata ceiling and cleans expired multipart uploads', async () => {
    await expect(
      uploads.initiate(ownerId, {
        title: 'Too large',
        filename: 'big.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 10_000_000_001,
      }),
    ).rejects.toMatchObject({ errorCode: 'VALIDATION_ERROR' });
    const started = await uploads.initiate(ownerId, {
      title: 'Largest allowed',
      filename: 'big.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 10_000_000_000,
    });
    ids.push(started.videoId);
    expect(started.partCount).toBe(597);
    await db.getRepository(Video).update(started.videoId, {
      upload_expires_at: new Date(Date.now() - 1000),
    });
    await expect(
      uploads.sign(ownerId, started.videoId, [1]),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_EXPIRED' });
    await uploads.sweepExpired();
    const video = await db
      .getRepository(Video)
      .findOneByOrFail({ id: started.videoId });
    expect(video).toMatchObject({
      status: 'error',
      failure_code: 'UPLOAD_EXPIRED',
    });
  });

  it('expires an orphan draft left before S3 initiation was saved', async () => {
    const channelId = await repository.findChannelIdByUserId(ownerId);
    const id = randomUUID();
    await repository.createDraft({
      id,
      channelId: channelId!,
      publicId: 'A'.repeat(22),
      title: 'Orphan',
      filename: 'orphan.mp4',
      mime: 'video/mp4',
      expectedBytes: 1,
      originalBucket: storageSettings.originalsBucket,
      originalKey: `channels/${channelId}/videos/${id}/original/source`,
    });
    ids.push(id);
    await db
      .getRepository(Video)
      .update(id, { created_at: new Date(Date.now() - 90_000_000) });
    await uploads.sweepExpired();
    expect(await db.getRepository(Video).findOneByOrFail({ id })).toMatchObject(
      { status: 'error', failure_code: 'UPLOAD_EXPIRED' },
    );
  });
});
