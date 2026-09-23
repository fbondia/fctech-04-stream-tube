import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import storageConfig from '../config/storage.config';
import { createTestDataSource } from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Channel } from '../channels/entities/channel.entity';
import { Video } from './entities/video.entity';
import { VideoProcessingOutbox } from './entities/video-processing-outbox.entity';
import { TypeOrmVideosRepository } from './typeorm-videos.repository';
import { VideosService } from './videos.service';

describe('VideosService (integration)', () => {
  let db: DataSource;
  let service: VideosService;
  beforeAll(async () => {
    db = createTestDataSource([User, Channel, Video, VideoProcessingOutbox], {
      synchronize: false,
    });
    await db.initialize();
    service = new VideosService(
      new TypeOrmVideosRepository(db),
      storageConfig(),
    );
  });
  afterAll(async () => db.destroy());

  it('creates a draft for the owner and masks it from another channel and public lookup', async () => {
    const user = await db
      .getRepository(User)
      .save({ email: `owner-${randomUUID()}@example.com`, password: 'hash' });
    const other = await db
      .getRepository(User)
      .save({ email: `other-${randomUUID()}@example.com`, password: 'hash' });
    const channel = await db.getRepository(Channel).save({
      user_id: user.id,
      name: 'Owner',
      nickname: `a${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    });
    const otherChannel = await db.getRepository(Channel).save({
      user_id: other.id,
      name: 'Other',
      nickname: `b${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    });
    let video: Video | undefined;
    try {
      video = await service.createDraft(user.id, {
        title: 'My video',
        filename: 'a.mp4',
        mime: 'video/mp4',
        expectedBytes: 1024,
      });
      expect(video.channel_id).toBe(channel.id);
      expect(video.status).toBe('draft');
      expect((await service.getOwnedById(user.id, video.id)).id).toBe(video.id);
      await expect(
        service.getOwnedById(other.id, video.id),
      ).rejects.toMatchObject({ errorCode: 'VIDEO_NOT_FOUND' });
      await expect(
        service.getReadyByPublicId(video.public_id),
      ).rejects.toMatchObject({ errorCode: 'VIDEO_NOT_FOUND' });

      await expect(
        service.claimProcessing(
          video.id,
          1,
          randomUUID(),
          new Date(Date.now() + 60_000),
        ),
      ).rejects.toMatchObject({ errorCode: 'INVALID_VIDEO_STATE' });
      await db
        .getRepository(Video)
        .update(video.id, { upload_confirmed_at: new Date() });
      await expect(
        service.claimProcessing(
          video.id,
          1,
          randomUUID(),
          new Date(Date.now() + 60_000),
        ),
      ).rejects.toMatchObject({ errorCode: 'INVALID_VIDEO_STATE' });
      await db
        .getRepository(VideoProcessingOutbox)
        .insert({ video_id: video.id, generation: 1 });
      const token = randomUUID();
      await service.claimProcessing(
        video.id,
        1,
        token,
        new Date(Date.now() + 60_000),
      );
      await expect(
        service.claimProcessing(
          video.id,
          1,
          randomUUID(),
          new Date(Date.now() + 60_000),
        ),
      ).rejects.toMatchObject({ errorCode: 'INVALID_VIDEO_STATE' });
      await expect(
        service.markReady({
          videoId: video.id,
          generation: 2,
          processingToken: token,
          durationMs: 1000,
          metadata: {
            format: 'mp4',
            codec: 'h264',
            width: 640,
            height: 360,
            streamCount: 1,
          },
          thumbnailBucket: 'videos-thumbnails',
          thumbnailKey: 'thumb.jpg',
          thumbnailBytes: 100,
        }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_VIDEO_STATE' });
      await service.markReady({
        videoId: video.id,
        generation: 1,
        processingToken: token,
        durationMs: 1000,
        metadata: {
          format: 'mp4',
          codec: 'h264',
          width: 640,
          height: 360,
          streamCount: 1,
        },
        thumbnailBucket: 'videos-thumbnails',
        thumbnailKey: 'thumb.jpg',
        thumbnailBytes: 100,
      });
      expect((await service.getReadyByPublicId(video.public_id)).id).toBe(
        video.id,
      );
      await expect(
        service.markProcessingError(video.id, 1, token, 'PROBE_FAILED'),
      ).rejects.toMatchObject({ errorCode: 'INVALID_VIDEO_STATE' });
    } finally {
      if (video) await db.getRepository(Video).delete(video.id);
      await db.getRepository(Channel).delete([channel.id, otherChannel.id]);
      await db.getRepository(User).delete([user.id, other.id]);
    }
  });

  it('reprocesses a confirmed error once and rejects stale generations', async () => {
    const user = await db
      .getRepository(User)
      .save({ email: `retry-${randomUUID()}@example.com`, password: 'hash' });
    const channel = await db.getRepository(Channel).save({
      user_id: user.id,
      name: 'Retry',
      nickname: `r${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    });
    const video = await service.createDraft(user.id, {
      title: 'Retry',
      filename: 'a.mp4',
      mime: 'video/mp4',
      expectedBytes: 10,
    });
    try {
      await db
        .getRepository(Video)
        .update(video.id, { upload_confirmed_at: new Date() });
      await db
        .getRepository(VideoProcessingOutbox)
        .insert({ video_id: video.id, generation: 1 });
      const firstToken = randomUUID();
      await service.claimProcessing(
        video.id,
        1,
        firstToken,
        new Date(Date.now() + 60_000),
      );
      await service.markProcessingError(
        video.id,
        1,
        firstToken,
        'PROBE_FAILED',
      );
      await expect(
        service.claimProcessing(
          video.id,
          1,
          randomUUID(),
          new Date(Date.now() + 60_000),
        ),
      ).rejects.toMatchObject({ errorCode: 'INVALID_VIDEO_STATE' });
      expect(await service.prepareReprocess(user.id, video.id)).toBe(2);
      await expect(
        service.prepareReprocess(user.id, video.id),
      ).rejects.toMatchObject({ errorCode: 'INVALID_VIDEO_STATE' });
      expect(
        await db
          .getRepository(VideoProcessingOutbox)
          .countBy({ video_id: video.id, generation: 2 }),
      ).toBe(1);
      const secondToken = randomUUID();
      await service.claimProcessing(
        video.id,
        2,
        secondToken,
        new Date(Date.now() + 60_000),
      );
      await expect(
        service.markProcessingError(video.id, 1, firstToken, 'PROBE_FAILED'),
      ).rejects.toMatchObject({ errorCode: 'INVALID_VIDEO_STATE' });
      await service.markProcessingError(
        video.id,
        2,
        secondToken,
        'PROBE_FAILED',
      );
      await expect(
        service.claimProcessing(
          video.id,
          2,
          randomUUID(),
          new Date(Date.now() + 60_000),
        ),
      ).rejects.toMatchObject({ errorCode: 'INVALID_VIDEO_STATE' });
    } finally {
      await db.getRepository(Video).delete(video.id);
      await db.getRepository(Channel).delete(channel.id);
      await db.getRepository(User).delete(user.id);
    }
  });
});
