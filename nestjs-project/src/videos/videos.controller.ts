import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { VideoUploadService } from './video-upload.service';
import {
  CompleteVideoUploadDto,
  InitiateVideoUploadDto,
  SignVideoPartsDto,
} from './video-upload.dto';
import { VideosService } from './videos.service';

@ApiTags('videos')
@ApiBearerAuth('access-token')
@Controller('videos')
export class VideosController {
  constructor(
    private readonly uploads: VideoUploadService,
    private readonly videos: VideosService,
  ) {}

  @Post('uploads')
  @ApiOperation({
    summary: 'Create a draft and initiate direct multipart upload',
  })
  @ApiResponse({
    status: 201,
    description: 'Draft created; transfer bytes directly to storage',
    schema: {
      type: 'object',
      properties: {
        videoId: { type: 'string', format: 'uuid' },
        publicId: { type: 'string' },
        status: { type: 'string', enum: ['draft'] },
        partSize: { type: 'integer' },
        partCount: { type: 'integer' },
        expiresAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  initiate(
    @CurrentUser() user: JwtPayload,
    @Body() dto: InitiateVideoUploadDto,
  ) {
    return this.uploads.initiate(user.sub, dto);
  }

  @Post(':videoId/upload-parts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign a batch of direct S3 UploadPart URLs' })
  @ApiResponse({
    status: 200,
    description: 'Short-lived signed URLs for requested part numbers',
    schema: {
      type: 'object',
      properties: {
        parts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              partNumber: { type: 'integer' },
              url: { type: 'string', format: 'uri' },
              expiresAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  })
  sign(
    @CurrentUser() user: JwtPayload,
    @Param('videoId') videoId: string,
    @Body() dto: SignVideoPartsDto,
  ) {
    return this.uploads.sign(user.sub, videoId, dto.partNumbers);
  }

  @Get(':videoId/upload')
  @ApiOperation({ summary: 'Resume upload and list completed parts' })
  @ApiResponse({
    status: 200,
    description: 'Owner upload status and stored part ETags',
  })
  resume(@CurrentUser() user: JwtPayload, @Param('videoId') videoId: string) {
    return this.uploads.resume(user.sub, videoId);
  }

  @Post(':videoId/upload/complete')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Confirm uploaded object and persist processing intent',
  })
  @ApiResponse({
    status: 202,
    description: 'Confirmed; processing intent persisted',
  })
  complete(
    @CurrentUser() user: JwtPayload,
    @Param('videoId') videoId: string,
    @Body() dto: CompleteVideoUploadDto,
  ) {
    return this.uploads.complete(user.sub, videoId, dto.parts);
  }

  @Delete(':videoId/upload')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel incomplete multipart upload' })
  @ApiResponse({ status: 204, description: 'Upload cancelled' })
  cancel(@CurrentUser() user: JwtPayload, @Param('videoId') videoId: string) {
    return this.uploads.cancel(user.sub, videoId);
  }

  @Get(':videoId')
  @ApiOperation({ summary: 'Read owner video status' })
  @ApiResponse({
    status: 200,
    description: 'Owner status without storage identifiers',
  })
  async get(
    @CurrentUser() user: JwtPayload,
    @Param('videoId') videoId: string,
  ) {
    const video = await this.videos.getOwnedById(user.sub, videoId);
    return {
      videoId: video.id,
      publicId: video.public_id,
      title: video.title,
      status: video.status,
      confirmed: !!video.upload_confirmed_at,
      sizeBytes: video.uploaded_bytes ? Number(video.uploaded_bytes) : null,
      durationMs: video.duration_ms ? Number(video.duration_ms) : null,
      metadata: video.media_metadata,
      failureCode: video.failure_code,
      createdAt: video.created_at,
      updatedAt: video.updated_at,
    };
  }

  @Post(':videoId/reprocess')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Request processing retry for a confirmed failed video',
  })
  @ApiResponse({
    status: 202,
    description: 'New processing generation persisted',
  })
  async reprocess(
    @CurrentUser() user: JwtPayload,
    @Param('videoId') videoId: string,
  ) {
    const generation = await this.videos.prepareReprocess(user.sub, videoId);
    return { videoId, status: 'error', generation };
  }
}
