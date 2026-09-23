import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { Video } from './entities/video.entity';
import { VideoProcessingOutbox } from './entities/video-processing-outbox.entity';
import { TypeOrmVideosRepository } from './typeorm-videos.repository';
import { VideosRepository } from './videos.repository';
import { VideosService } from './videos.service';
import { VideoUploadService } from './video-upload.service';
import { S3VideoStorage, VideoStorage } from './video-storage';
import { VideosController } from './videos.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Channel, Video, VideoProcessingOutbox])],
  providers: [
    VideosService,
    VideoUploadService,
    { provide: VideoStorage, useClass: S3VideoStorage },
    { provide: VideosRepository, useClass: TypeOrmVideosRepository },
  ],
  controllers: [VideosController],
  exports: [VideosService, VideosRepository, TypeOrmModule],
})
export class VideosModule {}
