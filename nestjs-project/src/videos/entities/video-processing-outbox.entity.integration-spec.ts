import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Channel } from '../../channels/entities/channel.entity';
import { Video } from './video.entity';
import { VideoProcessingOutbox } from './video-processing-outbox.entity';

describe('VideoProcessingOutbox schema (integration)', () => {
  let db: DataSource;
  beforeAll(async () => {
    db = createTestDataSource([User, Channel, Video, VideoProcessingOutbox], {
      synchronize: false,
    });
    await db.initialize();
  });
  afterAll(async () => db.destroy());

  it('allows one intent per video generation and constrains event/status', async () => {
    const user = await db
      .getRepository(User)
      .save({ email: `outbox-${randomUUID()}@example.com`, password: 'hash' });
    const channel = await db.getRepository(Channel).save({
      user_id: user.id,
      name: 'Outbox',
      nickname: `o${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    });
    const video = await db.getRepository(Video).save({
      channel_id: channel.id,
      public_id: randomUUID().replace(/-/g, '').slice(0, 22),
      title: 'A',
      declared_mime: 'video/mp4',
      safe_filename: 'a.mp4',
      expected_bytes: '1',
      original_bucket: 'videos-originals',
      original_key: randomUUID(),
    });
    const outbox = db.getRepository(VideoProcessingOutbox);
    try {
      const intent = await outbox.save({ video_id: video.id, generation: 1 });
      expect(intent.status).toBe('pending');
      await expect(
        outbox.insert({ video_id: video.id, generation: 1 }),
      ).rejects.toMatchObject({ driverError: { code: '23505' } });
      await expect(
        outbox.insert({
          video_id: video.id,
          generation: 2,
          event_name: 'other',
        }),
      ).rejects.toMatchObject({ driverError: { code: '23514' } });
    } finally {
      await db.getRepository(Video).delete(video.id);
      await db.getRepository(Channel).delete(channel.id);
      await db.getRepository(User).delete(user.id);
    }
  });
});
