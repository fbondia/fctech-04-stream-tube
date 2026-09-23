import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';

export type VideoStatus = 'draft' | 'processing' | 'ready' | 'error';
export type VideoFailureStage = 'upload' | 'processing';

export interface VideoMediaMetadata {
  format: string;
  width: number;
  height: number;
  codec: string;
  streamCount: number;
}

@Entity('videos')
@Index('UQ_videos_public_id', ['public_id'], { unique: true })
@Index('UQ_videos_original_location', ['original_bucket', 'original_key'], {
  unique: true,
})
@Index('UQ_videos_upload_id', ['upload_id'], {
  unique: true,
  where: 'upload_id IS NOT NULL',
})
@Index('IDX_videos_channel_created', ['channel_id', 'created_at'])
@Index('IDX_videos_status_confirmed', ['status', 'upload_confirmed_at'])
@Index('IDX_videos_status_processing_lease', [
  'status',
  'processing_lease_until',
])
export class Video {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) channel_id: string;
  @ManyToOne(() => Channel, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;
  @Column({ type: 'varchar', length: 22 }) public_id: string;
  @Column({ type: 'varchar', length: 200 }) title: string;
  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status: VideoStatus;
  @Column({ type: 'integer', default: 1 }) generation: number;
  @Column({ type: 'varchar', length: 100 }) declared_mime: string;
  @Column({ type: 'varchar', length: 255 }) safe_filename: string;
  @Column({ type: 'bigint' }) expected_bytes: string;
  @Column({ type: 'bigint', nullable: true }) uploaded_bytes: string | null;
  @Column({ type: 'varchar', length: 100 }) original_bucket: string;
  @Column({ type: 'text' }) original_key: string;
  @Column({ type: 'varchar', length: 100, nullable: true }) thumbnail_bucket:
    | string
    | null;
  @Column({ type: 'text', nullable: true }) thumbnail_key: string | null;
  @Column({ type: 'bigint', nullable: true }) thumbnail_bytes: string | null;
  @Column({ type: 'text', nullable: true }) upload_id: string | null;
  @Column({ type: 'timestamptz', nullable: true })
  upload_expires_at: Date | null;
  @Column({ type: 'timestamptz', nullable: true })
  upload_confirmed_at: Date | null;
  @Column({ type: 'uuid', nullable: true }) completion_token: string | null;
  @Column({ type: 'timestamptz', nullable: true })
  completion_lease_until: Date | null;
  @Column({ type: 'text', nullable: true }) object_etag: string | null;
  @Column({ type: 'bigint', nullable: true }) duration_ms: string | null;
  @Column({ type: 'jsonb', nullable: true })
  media_metadata: VideoMediaMetadata | null;
  @Column({ type: 'varchar', length: 32, nullable: true })
  failure_stage: VideoFailureStage | null;
  @Column({ type: 'varchar', length: 64, nullable: true }) failure_code:
    | string
    | null;
  @Column({ type: 'uuid', nullable: true }) processing_token: string | null;
  @Column({ type: 'timestamptz', nullable: true })
  processing_lease_until: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at: Date;
}
