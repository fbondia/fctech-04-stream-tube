import { Controller, Get, Head, Headers, Param, Res } from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { VideoWatchService } from './video-watch.service';

@Public()
@Throttle({ default: { limit: 600, ttl: 60_000 } })
@ApiTags('watch')
@ApiParam({ name: 'publicId', description: 'Opaque 22-character video ID' })
@Controller('watch/:publicId')
export class VideoWatchController {
  constructor(private readonly watch: VideoWatchService) {}

  @Get()
  @ApiOperation({ summary: 'Get metadata for a ready video by public URL' })
  @ApiResponse({
    status: 200,
    description: 'Ready video and media URLs',
    schema: {
      type: 'object',
      properties: {
        publicId: { type: 'string' },
        title: { type: 'string' },
        durationMs: { type: 'integer' },
        sizeBytes: { type: 'integer' },
        mimeType: { type: 'string' },
        streamUrl: { type: 'string' },
        downloadUrl: { type: 'string' },
        thumbnailUrl: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Unknown or non-ready video' })
  metadata(@Param('publicId') publicId: string) {
    return this.watch.metadata(publicId);
  }

  @Head('stream')
  @ApiOperation({ summary: 'Read full video stream headers' })
  @ApiResponse({ status: 200, description: 'Full-object headers without body' })
  head(@Param('publicId') publicId: string, @Res() response: Response) {
    return this.watch.original(publicId, response, { head: true });
  }

  @Get('stream')
  @ApiOperation({
    summary: 'Stream ready video bytes, with optional single byte Range',
  })
  @ApiHeader({
    name: 'Range',
    required: false,
    description: 'One range: bytes=start-end, bytes=start-, or bytes=-suffix',
  })
  @ApiHeader({
    name: 'If-Range',
    required: false,
    description:
      'Exact strong ETag to permit partial response; mismatch returns full 200',
  })
  @ApiResponse({ status: 200, description: 'Full video stream' })
  @ApiResponse({ status: 206, description: 'Partial video stream' })
  @ApiResponse({ status: 400, description: 'Malformed or unsupported Range' })
  @ApiResponse({ status: 416, description: 'Unsatisfiable byte Range' })
  stream(
    @Param('publicId') publicId: string,
    @Headers('range') range: string | undefined,
    @Headers('if-range') ifRange: string | undefined,
    @Res() response: Response,
  ) {
    return this.watch.original(publicId, response, { range, ifRange });
  }

  @Get('download')
  @ApiOperation({ summary: 'Download ready video bytes, with optional Range' })
  @ApiHeader({ name: 'Range', required: false, description: 'One byte range' })
  @ApiHeader({
    name: 'If-Range',
    required: false,
    description: 'Exact strong ETag to permit partial response',
  })
  @ApiResponse({ status: 200, description: 'Video download' })
  @ApiResponse({ status: 206, description: 'Partial video download' })
  @ApiResponse({ status: 400, description: 'Malformed or unsupported Range' })
  @ApiResponse({ status: 416, description: 'Unsatisfiable byte Range' })
  download(
    @Param('publicId') publicId: string,
    @Headers('range') range: string | undefined,
    @Headers('if-range') ifRange: string | undefined,
    @Res() response: Response,
  ) {
    return this.watch.original(publicId, response, {
      range,
      ifRange,
      download: true,
    });
  }

  @Get('thumbnail')
  @ApiOperation({ summary: 'Stream the ready video JPEG thumbnail' })
  @ApiResponse({ status: 200, description: 'JPEG thumbnail' })
  thumbnail(@Param('publicId') publicId: string, @Res() response: Response) {
    return this.watch.thumbnail(publicId, response);
  }
}
