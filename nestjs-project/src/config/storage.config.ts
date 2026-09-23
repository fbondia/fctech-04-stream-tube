import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  internalEndpoint: process.env.S3_INTERNAL_ENDPOINT ?? 'http://minio:9000',
  publicEndpoint: process.env.S3_PUBLIC_ENDPOINT ?? 'http://localhost:9000',
  region: process.env.S3_REGION ?? 'us-east-1',
  corsAllowedOrigin:
    process.env.S3_CORS_ALLOWED_ORIGIN ?? 'http://localhost:3000',
  originalsBucket: process.env.S3_ORIGINALS_BUCKET ?? 'videos-originals',
  thumbnailsBucket: process.env.S3_THUMBNAILS_BUCKET ?? 'videos-thumbnails',
  api: {
    accessKey: process.env.S3_API_ACCESS_KEY,
    secretKey: process.env.S3_API_SECRET_KEY,
  },
  worker: {
    accessKey: process.env.S3_WORKER_ACCESS_KEY,
    secretKey: process.env.S3_WORKER_SECRET_KEY,
  },
}));
