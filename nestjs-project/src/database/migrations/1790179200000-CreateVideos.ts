import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideos1790179200000 implements MigrationInterface {
  name = 'CreateVideos1790179200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE videos (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE RESTRICT,
        public_id varchar(22) NOT NULL,
        title varchar(200) NOT NULL,
        status varchar(16) NOT NULL DEFAULT 'draft',
        generation integer NOT NULL DEFAULT 1,
        declared_mime varchar(100) NOT NULL,
        safe_filename varchar(255) NOT NULL,
        expected_bytes bigint NOT NULL,
        uploaded_bytes bigint,
        original_bucket varchar(100) NOT NULL,
        original_key text NOT NULL,
        thumbnail_bucket varchar(100),
        thumbnail_key text,
        thumbnail_bytes bigint,
        upload_id text,
        upload_expires_at timestamptz,
        upload_confirmed_at timestamptz,
        completion_token uuid,
        completion_lease_until timestamptz,
        object_etag text,
        duration_ms bigint,
        media_metadata jsonb,
        failure_stage varchar(32),
        failure_code varchar(64),
        processing_token uuid,
        processing_lease_until timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT CK_videos_status CHECK (status IN ('draft', 'processing', 'ready', 'error')),
        CONSTRAINT CK_videos_generation CHECK (generation >= 1),
        CONSTRAINT CK_videos_expected_bytes CHECK (expected_bytes BETWEEN 1 AND 10000000000),
        CONSTRAINT CK_videos_uploaded_bytes CHECK (uploaded_bytes IS NULL OR uploaded_bytes BETWEEN 1 AND 10000000000),
        CONSTRAINT CK_videos_thumbnail_bytes CHECK (thumbnail_bytes IS NULL OR thumbnail_bytes > 0),
        CONSTRAINT CK_videos_duration_ms CHECK (duration_ms IS NULL OR duration_ms > 0),
        CONSTRAINT CK_videos_failure_stage CHECK (failure_stage IS NULL OR failure_stage IN ('upload', 'processing')),
        CONSTRAINT CK_videos_media_metadata CHECK (media_metadata IS NULL OR (
          jsonb_typeof(media_metadata) = 'object' AND
          media_metadata ?& ARRAY['format', 'width', 'height', 'codec', 'streamCount'] AND
          media_metadata - ARRAY['format', 'width', 'height', 'codec', 'streamCount'] = '{}'::jsonb AND
          jsonb_typeof(media_metadata->'format') = 'string' AND
          jsonb_typeof(media_metadata->'width') = 'number' AND
          jsonb_typeof(media_metadata->'height') = 'number' AND
          jsonb_typeof(media_metadata->'codec') = 'string' AND
          jsonb_typeof(media_metadata->'streamCount') = 'number'
        ))
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX UQ_videos_public_id ON videos(public_id)',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX UQ_videos_original_location ON videos(original_bucket, original_key)',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX UQ_videos_upload_id ON videos(upload_id) WHERE upload_id IS NOT NULL',
    );
    await queryRunner.query(
      'CREATE INDEX IDX_videos_channel_created ON videos(channel_id, created_at)',
    );
    await queryRunner.query(
      'CREATE INDEX IDX_videos_status_confirmed ON videos(status, upload_confirmed_at)',
    );
    await queryRunner.query(
      'CREATE INDEX IDX_videos_status_processing_lease ON videos(status, processing_lease_until)',
    );
    await queryRunner.query(`
      CREATE TABLE video_processing_outbox (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        generation integer NOT NULL,
        event_name varchar(32) NOT NULL DEFAULT 'process-video-v1',
        schema_version integer NOT NULL DEFAULT 1,
        status varchar(16) NOT NULL DEFAULT 'pending',
        dispatch_attempts integer NOT NULL DEFAULT 0,
        lease_token uuid,
        lease_until timestamptz,
        last_attempt_at timestamptz,
        published_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT CK_video_outbox_generation CHECK (generation >= 1),
        CONSTRAINT CK_video_outbox_event CHECK (event_name = 'process-video-v1' AND schema_version = 1),
        CONSTRAINT CK_video_outbox_status CHECK (status IN ('pending', 'published')),
        CONSTRAINT CK_video_outbox_attempts CHECK (dispatch_attempts >= 0),
        CONSTRAINT UQ_video_outbox_generation UNIQUE (video_id, generation)
      )
    `);
    await queryRunner.query(
      'CREATE INDEX IDX_video_outbox_dispatch ON video_processing_outbox(status, lease_until, created_at)',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE video_processing_outbox');
    await queryRunner.query('DROP TABLE videos');
  }
}
