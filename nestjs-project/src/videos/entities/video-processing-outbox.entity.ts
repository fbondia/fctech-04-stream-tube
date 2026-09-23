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
import { Video } from './video.entity';

@Entity('video_processing_outbox')
@Index('UQ_video_outbox_generation', ['video_id', 'generation'], {
  unique: true,
})
@Index('IDX_video_outbox_dispatch', ['status', 'lease_until', 'created_at'])
export class VideoProcessingOutbox {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) video_id: string;
  @ManyToOne(() => Video, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'video_id' })
  video: Video;
  @Column({ type: 'integer' }) generation: number;
  @Column({ type: 'varchar', length: 32, default: 'process-video-v1' })
  event_name: string;
  @Column({ type: 'integer', default: 1 }) schema_version: number;
  @Column({ type: 'varchar', length: 16, default: 'pending' }) status:
    | 'pending'
    | 'published';
  @Column({ type: 'integer', default: 0 }) dispatch_attempts: number;
  @Column({ type: 'uuid', nullable: true }) lease_token: string | null;
  @Column({ type: 'timestamptz', nullable: true }) lease_until: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) last_attempt_at: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) published_at: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at: Date;
}
