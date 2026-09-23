import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import { Queue, Worker } from 'bullmq';
import { rm, statfs, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { envValidationSchema } from './config/env.validation';
import storageConfig from './config/storage.config';
import queueConfig from './config/queue.config';
import videoConfig from './config/video.config';
import { AppDataSource } from './database/data-source';
import { VideoConsumer } from './videos/video-consumer';
import { VideoDispatcher, VideoJob } from './videos/video-dispatcher';
import { VideoMedia } from './videos/video-media';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [storageConfig, queueConfig, videoConfig],
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
  ],
})
class VideoWorkerModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(VideoWorkerModule);
  const storage = app.get<ConfigType<typeof storageConfig>>(storageConfig.KEY);
  const configuredQueue = app.get<ConfigType<typeof queueConfig>>(
    queueConfig.KEY,
  );
  const video = app.get<ConfigType<typeof videoConfig>>(videoConfig.KEY);
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
  const s3 = new S3Client({
    endpoint: storage.internalEndpoint,
    region: storage.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: storage.worker.accessKey!,
      secretAccessKey: storage.worker.secretKey!,
    },
  });
  const queue = new Queue(configuredQueue.name, {
    connection: {
      host: configuredQueue.host,
      port: configuredQueue.port,
      maxRetriesPerRequest: null,
    },
  });
  await AppDataSource.initialize();
  await rm('/tmp/video-processing/worker-health', { force: true });
  let waitingForSchema = false;
  while (true) {
    const rows = await AppDataSource.query<Array<{ relation: string | null }>>(
      "SELECT to_regclass('public.video_processing_outbox') AS relation",
    );
    if (rows[0]?.relation) break;
    if (!waitingForSchema) {
      console.log('Video worker waiting for database migrations');
      waitingForSchema = true;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 2000));
  }
  const dispatcher = new VideoDispatcher(
    AppDataSource,
    queue as Queue<VideoJob>,
  );
  const consumer = new VideoConsumer(
    AppDataSource,
    new VideoMedia(
      s3,
      video.tempDir,
      video.tempMinFreeBytes,
      video.jobTimeoutMs,
      video.ffprobeTimeoutMs,
      video.ffmpegTimeoutMs,
    ),
    storage.thumbnailsBucket,
  );
  const worker = new Worker<VideoJob>(
    configuredQueue.name,
    (job) => consumer.process(job),
    {
      connection: {
        host: configuredQueue.host,
        port: configuredQueue.port,
        maxRetriesPerRequest: null,
      },
      concurrency: video.workerConcurrency,
      maxStalledCount: 1,
    },
  );
  worker.on('error', (error) =>
    console.error('Video queue worker error', error),
  );
  const check = async () => {
    const disk = await statfs(video.tempDir);
    const freeBytes = disk.bavail * disk.bsize;
    const requiredBytes = video.tempMinFreeBytes * video.workerConcurrency;
    if (freeBytes < requiredBytes) {
      throw new Error('Insufficient worker temporary disk');
    }
    await Promise.all([
      s3.send(new HeadBucketCommand({ Bucket: storage.originalsBucket })),
      queue.getJobCounts(),
      AppDataSource.query('SELECT 1'),
    ]);
    await writeFile('/tmp/video-processing/worker-health', String(Date.now()));
  };
  await check();
  const sweep = async () => {
    await dispatcher.reconcile();
    await dispatcher.dispatch();
    const metrics = await dispatcher.metrics();
    console.log(
      `video_queue pending=${metrics.pending} oldestPendingSeconds=${metrics.oldestPendingSeconds} processing=${metrics.processing} oldestProcessingSeconds=${metrics.oldestProcessingSeconds} waiting=${metrics.waiting} active=${metrics.active} delayed=${metrics.delayed} failed=${metrics.failed}`,
    );
  };
  await sweep();
  const timer = setInterval(() => {
    check().catch((error: unknown) => {
      console.error('Worker infrastructure check failed', error);
    });
  }, 10000);
  const dispatchTimer = setInterval(() => {
    void sweep().catch(() => console.error('Video dispatcher sweep failed'));
  }, video.dispatchIntervalMs);
  const stop = async () => {
    clearInterval(timer);
    clearInterval(dispatchTimer);
    await worker.close();
    await queue.close();
    s3.destroy();
    await AppDataSource.destroy();
    await app.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void stop());
  process.once('SIGINT', () => void stop());
  console.log('Video worker and dispatcher ready');
}

void bootstrap().catch((error: unknown) => {
  console.error('Video worker bootstrap failed', error);
  process.exit(1);
});
