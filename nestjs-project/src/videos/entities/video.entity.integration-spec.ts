import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CreateVideos1790179200000 } from '../../database/migrations/1790179200000-CreateVideos';
import { createTestDataSource } from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Channel } from '../../channels/entities/channel.entity';
import { Video, VideoStatus } from './video.entity';
import { VideoProcessingOutbox } from './video-processing-outbox.entity';

describe('Video schema (integration)', () => {
  let dataSource: DataSource;
  beforeAll(async () => {
    dataSource = createTestDataSource(
      [User, Channel, Video, VideoProcessingOutbox],
      { synchronize: false },
    );
    await dataSource.initialize();
  });
  afterAll(async () => dataSource.destroy());

  it('applies and reverts only its own tables in an isolated schema', async () => {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query('CREATE SCHEMA phase03_migration_check');
      await runner.query(
        'SET LOCAL search_path TO phase03_migration_check, public',
      );
      await runner.query('CREATE TABLE channels (id uuid PRIMARY KEY)');
      const migration = new CreateVideos1790179200000();
      await migration.up(runner);
      expect(
        await runner.query(
          "SELECT to_regclass('phase03_migration_check.videos') IS NOT NULL AS videos, to_regclass('phase03_migration_check.video_processing_outbox') IS NOT NULL AS outbox",
        ),
      ).toEqual([{ videos: true, outbox: true }]);
      await migration.down(runner);
      expect(
        await runner.query(
          "SELECT to_regclass('phase03_migration_check.videos') AS videos, to_regclass('phase03_migration_check.video_processing_outbox') AS outbox",
        ),
      ).toEqual([{ videos: null, outbox: null }]);
      expect(
        await runner.query("SELECT to_regclass('channels') AS channels"),
      ).toEqual([{ channels: 'channels' }]);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });

  it('enforces channel FK, public/location uniqueness, bounds, and status', async () => {
    const user = await dataSource.getRepository(User).save({
      email: `video-schema-${randomUUID()}@example.com`,
      password: 'hash',
    });
    const channel = await dataSource.getRepository(Channel).save({
      user_id: user.id,
      name: 'Video',
      nickname: `v${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    });
    const input = {
      channel_id: channel.id,
      public_id: 'abcdefghijklmnopqrstuv',
      title: 'A',
      declared_mime: 'video/mp4',
      safe_filename: 'a.mp4',
      expected_bytes: '1',
      original_bucket: 'videos-originals',
      original_key: `key-${randomUUID()}`,
    };
    const repository = dataSource.getRepository(Video);
    const video = await repository.save(repository.create(input));
    try {
      await expect(
        repository.insert({ ...input, original_key: `key-${randomUUID()}` }),
      ).rejects.toMatchObject({ driverError: { code: '23505' } });
      await expect(
        repository.insert({
          ...input,
          public_id: '1234567890123456789012',
          original_key: randomUUID(),
          channel_id: randomUUID(),
        }),
      ).rejects.toMatchObject({ driverError: { code: '23503' } });
      await expect(
        repository.insert({
          ...input,
          public_id: '1234567890123456789012',
          original_key: randomUUID(),
          expected_bytes: '10000000001',
        }),
      ).rejects.toMatchObject({ driverError: { code: '23514' } });
      await expect(
        repository.insert({
          ...input,
          public_id: '1234567890123456789012',
          original_key: randomUUID(),
          status: 'bad' as VideoStatus,
        }),
      ).rejects.toMatchObject({ driverError: { code: '23514' } });
      await expect(
        dataSource.getRepository(Channel).delete(channel.id),
      ).rejects.toMatchObject({ driverError: { code: '23503' } });
    } finally {
      await repository.delete(video.id);
      await dataSource.getRepository(Channel).delete(channel.id);
      await dataSource.getRepository(User).delete(user.id);
    }
  });
});
