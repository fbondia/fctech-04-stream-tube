import videoConfig from '../config/video.config';
import { Video } from './entities/video.entity';
import { VideoStorage } from './video-storage';
import { VideoUploadService } from './video-upload.service';
import { VideosRepository } from './videos.repository';
import { VideosService } from './videos.service';

describe('VideoUploadService', () => {
  const video = {
    id: '70d79eea-9a59-4d59-afc7-f1dc589bed94',
    status: 'draft',
    generation: 1,
    expected_bytes: '16777217',
    original_bucket: 'originals',
    original_key: 'channels/a/videos/b/original/source',
    upload_id: 'private-upload-id',
    upload_expires_at: new Date(Date.now() + 60_000),
    upload_confirmed_at: null,
    completion_token: null,
    completion_lease_until: null,
  } as Video;
  const getOwnedById = jest.fn();
  const claimCompletion = jest.fn();
  const confirmUpload = jest.fn();
  const head = jest.fn();
  const videos = { getOwnedById } as unknown as VideosService;
  const repository = {
    claimCompletion,
    releaseCompletion: jest.fn(),
    confirmUpload,
    renewCompletion: jest.fn(),
  } as unknown as VideosRepository;
  const storage = {
    head,
    listParts: jest.fn(),
    complete: jest.fn(),
  } as unknown as VideoStorage;
  const uploads = new VideoUploadService(
    videos,
    repository,
    storage,
    videoConfig(),
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(videos, 'getOwnedById').mockResolvedValue(video);
  });

  it('rejects an active competing confirmation before touching S3', async () => {
    jest.spyOn(repository, 'claimCompletion').mockResolvedValue(false);
    await expect(
      uploads.complete('owner', video.id, [
        { partNumber: 1, eTag: '"a"' },
        { partNumber: 2, eTag: '"b"' },
      ]),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_COMPLETION_IN_PROGRESS' });
    expect(head).not.toHaveBeenCalled();
    expect(confirmUpload).not.toHaveBeenCalled();
  });

  it('rejects missing and reordered parts before claiming completion', async () => {
    await expect(
      uploads.complete('owner', video.id, [{ partNumber: 2, eTag: '"b"' }]),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_PARTS_MISMATCH' });
    expect(claimCompletion).not.toHaveBeenCalled();
  });

  it('returns a confirmed upload without reusing S3 or inserting an intent', async () => {
    jest.spyOn(videos, 'getOwnedById').mockResolvedValue({
      ...video,
      upload_confirmed_at: new Date(),
      status: 'processing',
    } as Video);
    await expect(
      uploads.complete('owner', video.id, []),
    ).resolves.toMatchObject({ confirmed: true, status: 'processing' });
    expect(head).not.toHaveBeenCalled();
    expect(confirmUpload).not.toHaveBeenCalled();
  });
});
