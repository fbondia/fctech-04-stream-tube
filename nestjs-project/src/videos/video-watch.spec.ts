import type { Response } from 'express';
import { Readable, Writable } from 'node:stream';
import { Video } from './entities/video.entity';
import { VideoStorage } from './video-storage';
import { VideoWatchService } from './video-watch.service';
import { VideosService } from './videos.service';

class ClosingResponse extends Writable {
  headersSent = false;
  status(): this {
    return this;
  }
  set(): this {
    this.headersSent = true;
    return this;
  }
  _write(
    _chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    callback();
    this.destroy();
  }
}

describe('video proxy cancellation', () => {
  it('aborts the upstream S3 request when the client disconnects', async () => {
    const video = {
      public_id: 'A'.repeat(22),
      status: 'ready',
      uploaded_bytes: '100',
      object_etag: '"etag"',
      original_bucket: 'originals',
      original_key: 'source',
      declared_mime: 'video/mp4',
    } as Video;
    const videos = {
      getReadyByPublicId: () => Promise.resolve(video),
    } as unknown as VideosService;
    let signal: AbortSignal | undefined;
    const storage = {
      read: (
        _bucket: string,
        _key: string,
        _range?: string,
        abort?: AbortSignal,
      ) => {
        signal = abort;
        return Promise.resolve(
          new Readable({
            read() {
              this.push(Buffer.alloc(10));
            },
          }),
        );
      },
    } as VideoStorage;
    const response = new ClosingResponse();
    const watch = new VideoWatchService(videos, storage);
    await watch.original(video.public_id, response as unknown as Response, {});
    expect(signal?.aborted).toBe(true);
  });
});
