import { Job, UnrecoverableError } from 'bullmq';
import { VideoConsumer } from './video-consumer';
import { VideoJob, videoJobId } from './video-dispatcher';
import { MediaFailure, VideoMedia } from './video-media';
import { TypeOrmVideosRepository } from './typeorm-videos.repository';

const videoId = 'b6a96398-82de-4d18-9bf2-71563ed89911';
const outboxId = '7c80516f-d932-46d7-8185-f3cb988a52d2';

function job(data: Partial<VideoJob> = {}): Job<VideoJob> {
  const payload = {
    schemaVersion: 1 as const,
    videoId,
    generation: 1,
    outboxId,
    ...data,
  };
  return {
    id: videoJobId(videoId, 1),
    name: 'process-video-v1',
    data: payload,
    attemptsMade: 0,
    opts: { attempts: 3 },
  } as Job<VideoJob>;
}

describe('VideoConsumer', () => {
  afterEach(() => jest.restoreAllMocks());

  it('rejects a poisoned message before reading the database', async () => {
    const query = jest.fn();
    const consumer = new VideoConsumer(
      { query } as never,
      {} as VideoMedia,
      'thumbnails',
    );
    await expect(
      consumer.process(job({ schemaVersion: 2 as 1 })),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(query).not.toHaveBeenCalled();
  });

  it('does no work when the current generation is already ready', async () => {
    const query = jest.fn().mockResolvedValue([{ id: outboxId }]);
    jest
      .spyOn(TypeOrmVideosRepository.prototype, 'findById')
      .mockResolvedValue({
        id: videoId,
        generation: 1,
        status: 'ready',
      } as never);
    const media = { process: jest.fn() };
    const consumer = new VideoConsumer(
      { query } as never,
      media as never,
      'thumbnails',
    );
    await consumer.process(job());
    expect(media.process).not.toHaveBeenCalled();
  });

  it('releases a lease so a transient failure can be retried', async () => {
    const query = jest.fn().mockResolvedValue([{ id: outboxId }]);
    jest
      .spyOn(TypeOrmVideosRepository.prototype, 'findById')
      .mockResolvedValue({
        id: videoId,
        generation: 1,
        status: 'draft',
        channel_id: videoId,
        original_bucket: 'originals',
        original_key: 'source',
        uploaded_bytes: '123',
      } as never);
    jest
      .spyOn(TypeOrmVideosRepository.prototype, 'claimProcessing')
      .mockResolvedValue(true);
    const fail = jest.spyOn(
      TypeOrmVideosRepository.prototype,
      'markProcessingError',
    );
    const media = {
      process: jest
        .fn()
        .mockRejectedValue(new MediaFailure('TEMP_DISK_LOW', false)),
    };
    const consumer = new VideoConsumer(
      { query } as never,
      media as never,
      'thumbnails',
    );
    await expect(consumer.process(job())).rejects.toThrow('TEMP_DISK_LOW');
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('processing_token = NULL'),
      expect.any(Array),
    );
    expect(fail).not.toHaveBeenCalled();
  });
});
