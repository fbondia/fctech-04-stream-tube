import { Injectable } from '@nestjs/common';
import { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { Video } from './entities/video.entity';
import { attachmentDisposition } from './video-download';
import {
  ByteRange,
  parseVideoRange,
  RangeNotSatisfiableException,
} from './video-range';
import { VideoStorage } from './video-storage';
import { VideoNotFoundException } from './videos.errors';
import { VideosService } from './videos.service';

@Injectable()
export class VideoWatchService {
  constructor(
    private readonly videos: VideosService,
    private readonly storage: VideoStorage,
  ) {}

  async metadata(publicId: string) {
    const video = await this.videos.getReadyByPublicId(publicId);
    return {
      publicId: video.public_id,
      title: video.title,
      durationMs: Number(video.duration_ms),
      sizeBytes: Number(video.uploaded_bytes),
      mimeType: video.declared_mime,
      streamUrl: `/watch/${publicId}/stream`,
      downloadUrl: `/watch/${publicId}/download`,
      thumbnailUrl: `/watch/${publicId}/thumbnail`,
    };
  }

  async original(
    publicId: string,
    response: Response,
    options: {
      head?: boolean;
      download?: boolean;
      range?: string;
      ifRange?: string;
    },
  ): Promise<void> {
    const video = await this.videos.getReadyByPublicId(publicId);
    const size = Number(video.uploaded_bytes);
    if (!Number.isSafeInteger(size) || size < 1 || !video.object_etag)
      throw new VideoNotFoundException();

    let selected: ByteRange | undefined;
    if (
      !options.head &&
      options.range &&
      (!options.ifRange || options.ifRange === video.object_etag)
    ) {
      try {
        selected = parseVideoRange(options.range, size);
      } catch (error) {
        if (error instanceof RangeNotSatisfiableException)
          response.setHeader('Content-Range', `bytes */${size}`);
        throw error;
      }
    }
    const headers: Record<string, string> = {
      'Accept-Ranges': 'bytes',
      'Content-Type': video.declared_mime,
      'Content-Length': String(
        selected ? selected.end - selected.start + 1 : size,
      ),
      ETag: video.object_etag,
    };
    if (selected)
      headers['Content-Range'] =
        `bytes ${selected.start}-${selected.end}/${size}`;
    if (options.download)
      headers['Content-Disposition'] = attachmentDisposition(
        video.safe_filename,
      );
    if (options.head) {
      response.status(200).set(headers).end();
      return;
    }
    await this.sendObject(
      video.original_bucket,
      video.original_key,
      response,
      headers,
      selected ? 206 : 200,
      selected ? `bytes=${selected.start}-${selected.end}` : undefined,
    );
  }

  async thumbnail(publicId: string, response: Response): Promise<void> {
    const video: Video = await this.videos.getReadyByPublicId(publicId);
    const size = Number(video.thumbnail_bytes);
    if (
      !video.thumbnail_bucket ||
      !video.thumbnail_key ||
      !Number.isSafeInteger(size) ||
      size < 1
    )
      throw new VideoNotFoundException();
    await this.sendObject(
      video.thumbnail_bucket,
      video.thumbnail_key,
      response,
      { 'Content-Type': 'image/jpeg', 'Content-Length': String(size) },
      200,
    );
  }

  private async sendObject(
    bucket: string,
    key: string,
    response: Response,
    headers: Record<string, string>,
    status: number,
    range?: string,
  ): Promise<void> {
    const abort = new AbortController();
    const onClose = () => {
      if (!response.writableFinished) abort.abort();
    };
    response.once('close', onClose);
    try {
      const body = await this.storage.read(bucket, key, range, abort.signal);
      response.status(status).set(headers);
      await pipeline(body, response);
    } catch (error) {
      if (response.headersSent || abort.signal.aborted) {
        response.destroy();
        return;
      }
      throw error;
    } finally {
      response.off('close', onClose);
    }
  }
}
