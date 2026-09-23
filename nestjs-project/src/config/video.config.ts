import { registerAs } from '@nestjs/config';

export default registerAs('video', () => ({
  maxBytes: Number(process.env.VIDEO_MAX_BYTES ?? 10_000_000_000),
  partBytes: Number(process.env.VIDEO_PART_BYTES ?? 16_777_216),
  uploadTtlSeconds: Number(process.env.VIDEO_UPLOAD_TTL_SECONDS ?? 86400),
  presignTtlSeconds: Number(process.env.VIDEO_PRESIGN_TTL_SECONDS ?? 900),
  workerConcurrency: Number(process.env.VIDEO_WORKER_CONCURRENCY ?? 1),
  tempDir: process.env.VIDEO_TEMP_DIR ?? '/tmp/video-processing',
  tempMinFreeBytes: Number(
    process.env.VIDEO_TEMP_MIN_FREE_BYTES ?? 12_884_901_888,
  ),
  jobTimeoutMs: Number(process.env.VIDEO_JOB_TIMEOUT_MS ?? 7_200_000),
  ffprobeTimeoutMs: Number(process.env.VIDEO_FFPROBE_TIMEOUT_MS ?? 60_000),
  ffmpegTimeoutMs: Number(process.env.VIDEO_FFMPEG_TIMEOUT_MS ?? 120_000),
  dispatchIntervalMs: Number(process.env.VIDEO_DISPATCH_INTERVAL_MS ?? 30_000),
}));
