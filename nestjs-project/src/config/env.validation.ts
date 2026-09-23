import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  JWT_SECRET: Joi.string().required(),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_ACCESS_EXPIRATION: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRATION: Joi.string().default('7d'),
  CONFIRMATION_TOKEN_EXPIRATION_HOURS: Joi.number().default(1),
  PASSWORD_RESET_TOKEN_EXPIRATION_HOURS: Joi.number().default(1),
  APP_URL: Joi.string().uri().default('http://localhost:3000'),
  MAIL_HOST: Joi.string().default('mailpit'),
  MAIL_PORT: Joi.number().default(1025),
  MAIL_FROM: Joi.string().default('"StreamTube" <noreply@streamtube.com>'),
  SWAGGER_ENABLED: Joi.string().valid('true', 'false').default('false'),
  VIDEO_INFRA_ENABLED: Joi.string().valid('true', 'false').default('false'),
  S3_INTERNAL_ENDPOINT: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .default('http://minio:9000'),
  S3_PUBLIC_ENDPOINT: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .default('http://localhost:9000'),
  S3_REGION: Joi.string().min(1).default('us-east-1'),
  S3_CORS_ALLOWED_ORIGIN: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .default('http://localhost:3000'),
  S3_ORIGINALS_BUCKET: Joi.string()
    .pattern(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
    .default('videos-originals'),
  S3_THUMBNAILS_BUCKET: Joi.string()
    .pattern(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
    .default('videos-thumbnails'),
  S3_API_ACCESS_KEY: Joi.string().when('VIDEO_INFRA_ENABLED', {
    is: 'true',
    then: Joi.required(),
  }),
  S3_API_SECRET_KEY: Joi.string().when('VIDEO_INFRA_ENABLED', {
    is: 'true',
    then: Joi.required(),
  }),
  S3_WORKER_ACCESS_KEY: Joi.string().when('VIDEO_INFRA_ENABLED', {
    is: 'true',
    then: Joi.required(),
  }),
  S3_WORKER_SECRET_KEY: Joi.string().when('VIDEO_INFRA_ENABLED', {
    is: 'true',
    then: Joi.required(),
  }),
  REDIS_HOST: Joi.string().hostname().default('redis'),
  REDIS_PORT: Joi.number().port().default(6379),
  VIDEO_MAX_BYTES: Joi.number()
    .integer()
    .min(1)
    .max(10_000_000_000)
    .default(10_000_000_000),
  VIDEO_PART_BYTES: Joi.number().valid(16_777_216).default(16_777_216),
  VIDEO_UPLOAD_TTL_SECONDS: Joi.number()
    .integer()
    .min(3600)
    .max(86400)
    .default(86400),
  VIDEO_PRESIGN_TTL_SECONDS: Joi.number()
    .integer()
    .min(60)
    .max(3600)
    .default(900),
  VIDEO_WORKER_CONCURRENCY: Joi.number().integer().min(1).max(4).default(1),
  VIDEO_TEMP_DIR: Joi.string().min(1).default('/tmp/video-processing'),
  VIDEO_TEMP_MIN_FREE_BYTES: Joi.number()
    .integer()
    .min(12_884_901_888)
    .default(12_884_901_888),
  VIDEO_JOB_TIMEOUT_MS: Joi.number()
    .integer()
    .min(60_000)
    .max(7_200_000)
    .default(7_200_000),
  VIDEO_FFPROBE_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1_000)
    .max(60_000)
    .default(60_000),
  VIDEO_FFMPEG_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1_000)
    .max(120_000)
    .default(120_000),
  VIDEO_DISPATCH_INTERVAL_MS: Joi.number()
    .integer()
    .min(1_000)
    .max(60_000)
    .default(30_000),
});
