import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { VideoMediaMetadata } from './entities/video.entity';

const exec = promisify(execFile);

export class MediaFailure extends Error {
  constructor(
    readonly code: string,
    readonly permanent: boolean,
  ) {
    super(code);
  }
}

export interface ProcessedMedia {
  durationMs: number;
  metadata: VideoMediaMetadata;
  thumbnailBytes: number;
}

export class VideoMedia {
  constructor(
    private readonly s3: S3Client,
    private readonly tempDir: string,
    private readonly minFreeBytes: number,
    private readonly jobTimeoutMs: number,
    private readonly probeTimeoutMs: number,
    private readonly ffmpegTimeoutMs: number,
  ) {}

  async process(
    originalBucket: string,
    originalKey: string,
    expectedBytes: number,
    thumbnailBucket: string,
    thumbnailKey: string,
  ): Promise<ProcessedMedia> {
    const disk = await statfs(this.tempDir);
    if (
      disk.bavail * disk.bsize <
      Math.max(this.minFreeBytes, expectedBytes + 100_000_000)
    )
      throw new MediaFailure('TEMP_DISK_LOW', false);
    const dir = await mkdtemp(join(this.tempDir, 'video-'));
    const source = join(dir, 'source');
    const thumbnail = join(dir, 'thumbnail.jpg');
    const deadline = Date.now() + this.jobTimeoutMs;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.jobTimeoutMs);
    try {
      const object = await this.s3.send(
        new GetObjectCommand({ Bucket: originalBucket, Key: originalKey }),
        { abortSignal: abort.signal },
      );
      if (!object.Body || !(object.Body instanceof Readable))
        throw new MediaFailure('STORAGE_FAILURE', false);
      let bytes = 0;
      const limit = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          if (bytes > expectedBytes)
            callback(new MediaFailure('INVALID_MEDIA', true));
          else callback(null, chunk);
        },
      });
      try {
        await pipeline(object.Body, limit, createWriteStream(source), {
          signal: abort.signal,
        });
      } catch (error) {
        if (abort.signal.aborted)
          throw new MediaFailure('PROCESSING_TIMEOUT', false);
        throw error;
      }
      if (bytes !== expectedBytes)
        throw new MediaFailure('INVALID_MEDIA', true);
      const remaining = () => Math.max(1, deadline - Date.now());
      let probe: {
        format?: { duration?: string; format_name?: string };
        streams?: Array<{
          codec_type?: string;
          codec_name?: string;
          width?: number;
          height?: number;
        }>;
      };
      try {
        const result = await exec(
          'ffprobe',
          [
            '-v',
            'error',
            '-show_format',
            '-show_streams',
            '-of',
            'json',
            source,
          ],
          {
            timeout: Math.min(this.probeTimeoutMs, remaining()),
            maxBuffer: 1_000_000,
          },
        );
        probe = JSON.parse(result.stdout) as typeof probe;
      } catch (error) {
        if ((error as { killed?: boolean }).killed || remaining() <= 1)
          throw new MediaFailure('PROCESSING_TIMEOUT', false);
        throw new MediaFailure('INVALID_MEDIA', true);
      }
      const videoStream = probe.streams?.find(
        (stream) => stream.codec_type === 'video',
      );
      const seconds = Number(probe.format?.duration);
      if (
        !videoStream?.width ||
        !videoStream.height ||
        !Number.isFinite(seconds) ||
        seconds <= 0 ||
        !probe.format?.format_name ||
        !videoStream.codec_name
      )
        throw new MediaFailure('INVALID_MEDIA', true);
      if (
        !Number.isSafeInteger(videoStream.width) ||
        videoStream.width > 16_384 ||
        !Number.isSafeInteger(videoStream.height) ||
        videoStream.height > 16_384 ||
        !Number.isSafeInteger(probe.streams?.length) ||
        (probe.streams?.length ?? 0) > 100 ||
        !Number.isSafeInteger(Math.round(seconds * 1000))
      )
        throw new MediaFailure('INVALID_MEDIA', true);
      const metadata: VideoMediaMetadata = {
        format: probe.format.format_name.slice(0, 100),
        width: videoStream.width,
        height: videoStream.height,
        codec: videoStream.codec_name.slice(0, 100),
        streamCount: probe.streams?.length ?? 1,
      };
      const durationMs = Math.max(1, Math.round(seconds * 1000));
      const thumbnailAt = Math.max(0, seconds * 0.25);
      const makeThumbnail = (at: number) =>
        exec(
          'ffmpeg',
          [
            '-nostdin',
            '-hide_banner',
            '-loglevel',
            'error',
            '-y',
            '-ss',
            String(at),
            '-i',
            source,
            '-map',
            '0:v:0',
            '-frames:v',
            '1',
            '-vf',
            'scale=512:-2',
            '-q:v',
            '3',
            thumbnail,
          ],
          {
            timeout: Math.min(this.ffmpegTimeoutMs, remaining()),
            maxBuffer: 100_000,
          },
        );
      try {
        await makeThumbnail(thumbnailAt);
        if ((await stat(thumbnail)).size === 0)
          throw new Error('empty thumbnail');
      } catch (error) {
        if ((error as { killed?: boolean }).killed || remaining() <= 1)
          throw new MediaFailure('PROCESSING_TIMEOUT', false);
        try {
          await makeThumbnail(0);
        } catch (fallback) {
          if ((fallback as { killed?: boolean }).killed || remaining() <= 1)
            throw new MediaFailure('PROCESSING_TIMEOUT', false);
          throw new MediaFailure('THUMBNAIL_FAILED', true);
        }
      }
      const jpeg = await readFile(thumbnail);
      if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8)
        throw new MediaFailure('THUMBNAIL_FAILED', true);
      await this.s3.send(
        new PutObjectCommand({
          Bucket: thumbnailBucket,
          Key: thumbnailKey,
          Body: jpeg,
          ContentType: 'image/jpeg',
          ContentLength: jpeg.length,
        }),
        { abortSignal: abort.signal },
      );
      return { durationMs, metadata, thumbnailBytes: jpeg.length };
    } catch (error) {
      if (abort.signal.aborted && !(error instanceof MediaFailure))
        throw new MediaFailure('PROCESSING_TIMEOUT', false);
      throw error;
    } finally {
      clearTimeout(timer);
      await rm(dir, { recursive: true, force: true });
    }
  }
}
