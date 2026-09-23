import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VideoMedia } from './video-media';

describe('VideoMedia', () => {
  it('aborts a stalled S3 download at the job deadline and removes its temporary directory', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'media-test-'));
    const s3 = {
      send: (
        _command: unknown,
        options: { abortSignal: AbortSignal },
      ): Promise<never> =>
        new Promise((_resolve, reject) => {
          options.abortSignal.addEventListener(
            'abort',
            () => reject(new Error('aborted')),
            { once: true },
          );
        }),
    };
    try {
      const media = new VideoMedia(s3 as never, parent, 0, 20, 1000, 1000);
      await expect(
        media.process('originals', 'source', 1, 'thumbnails', 'thumb.jpg'),
      ).rejects.toMatchObject({ code: 'PROCESSING_TIMEOUT' });
      expect(await readdir(parent)).toEqual([]);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
