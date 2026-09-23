import { ConfigType } from '@nestjs/config';
import { QueryFailedError } from 'typeorm';
import storageConfig from '../config/storage.config';
import { Video, VideoMediaMetadata } from './entities/video.entity';
import { DraftVideoInput, VideosRepository } from './videos.repository';
import { VideosService } from './videos.service';

describe('VideosService', () => {
  const repository: jest.Mocked<VideosRepository> = {
    findChannelIdByUserId: jest.fn(),
    createDraft: jest.fn(),
    findById: jest.fn(),
    findByPublicId: jest.fn(),
    markUploadError: jest.fn(),
    claimProcessing: jest.fn(),
    markReady: jest.fn(),
    markProcessingError: jest.fn(),
    markFailure: jest.fn(),
    prepareReprocess: jest.fn(),
  };
  const service = new VideosService(repository, {
    originalsBucket: 'videos-originals',
  } as ConfigType<typeof storageConfig>);
  beforeEach(() => jest.resetAllMocks());

  it('rejects invalid metadata before persistence', async () => {
    await expect(
      service.createDraft('user', {
        title: 'A',
        filename: '../x.mp4',
        mime: 'video/mp4',
        expectedBytes: 1,
      }),
    ).rejects.toMatchObject({ errorCode: 'VALIDATION_ERROR' });
    await expect(
      service.createDraft('user', {
        title: 'A',
        filename: 'x.mp4',
        mime: 'video/mp4',
        expectedBytes: 10_000_000_001,
      }),
    ).rejects.toMatchObject({ errorCode: 'VALIDATION_ERROR' });
    expect(repository.createDraft.mock.calls).toHaveLength(0);
  });

  it('creates an opaque 128-bit public ID and a channel-scoped key', async () => {
    repository.findChannelIdByUserId.mockResolvedValue(
      '8d9bebdd-6418-451c-9c1d-1fc07da48348',
    );
    repository.createDraft.mockImplementation((input: DraftVideoInput) =>
      Promise.resolve(input as unknown as Video),
    );
    await service.createDraft('user', {
      title: ' Video ',
      filename: 'x.mp4',
      mime: 'video/mp4',
      expectedBytes: 100,
    });
    const input = repository.createDraft.mock.calls[0][0];
    expect(input.publicId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(input.title).toBe('Video');
    expect(input.originalKey).toBe(
      `channels/${input.channelId}/videos/${input.id}/original/source`,
    );
  });

  it('retries a public ID collision in a fresh insert', async () => {
    repository.findChannelIdByUserId.mockResolvedValue(
      '8d9bebdd-6418-451c-9c1d-1fc07da48348',
    );
    repository.createDraft
      .mockRejectedValueOnce(
        new QueryFailedError(
          'INSERT',
          [],
          Object.assign(new Error('collision'), {
            code: '23505',
            constraint: 'uq_videos_public_id',
          }),
        ),
      )
      .mockImplementation((input: DraftVideoInput) =>
        Promise.resolve(input as unknown as Video),
      );
    await service.createDraft('user', {
      title: 'Video',
      filename: 'x.mp4',
      mime: 'video/mp4',
      expectedBytes: 100,
    });
    expect(repository.createDraft.mock.calls).toHaveLength(2);
  });

  it('masks non-owner and non-ready records', async () => {
    repository.findChannelIdByUserId.mockResolvedValue('owner-channel');
    repository.findById.mockResolvedValue({
      channel_id: 'other-channel',
    } as Video);
    await expect(
      service.getOwnedById('user', '8d9bebdd-6418-451c-9c1d-1fc07da48348'),
    ).rejects.toMatchObject({ errorCode: 'VIDEO_NOT_FOUND' });
    repository.findByPublicId.mockResolvedValue({ status: 'draft' } as Video);
    await expect(
      service.getReadyByPublicId('1234567890123456789012'),
    ).rejects.toMatchObject({ errorCode: 'VIDEO_NOT_FOUND' });
  });

  it('validates a bounded metadata whitelist before marking ready', async () => {
    await expect(
      service.markReady({
        videoId: 'id',
        generation: 1,
        processingToken: 'token',
        durationMs: 1,
        metadata: {
          format: 'mp4',
          width: 1920,
          height: 1080,
          codec: 'h264',
          streamCount: 1,
          extra: 'raw',
        } as unknown as VideoMediaMetadata,
        thumbnailBucket: 'thumbs',
        thumbnailKey: 'key',
        thumbnailBytes: 10,
      }),
    ).rejects.toMatchObject({ errorCode: 'VALIDATION_ERROR' });
    expect(repository.markReady.mock.calls).toHaveLength(0);
  });
});
