import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { Video } from './entities/video.entity';
import { VideoProcessingOutbox } from './entities/video-processing-outbox.entity';
import { TypeOrmVideosRepository } from './typeorm-videos.repository';
import { VideosRepository } from './videos.repository';
import { VideosService } from './videos.service';

@Module({
  imports: [TypeOrmModule.forFeature([Channel, Video, VideoProcessingOutbox])],
  providers: [
    VideosService,
    { provide: VideosRepository, useClass: TypeOrmVideosRepository },
  ],
  exports: [VideosService, VideosRepository, TypeOrmModule],
})
export class VideosModule {}
