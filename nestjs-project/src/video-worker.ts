import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import { Queue } from 'bullmq';
import { statfs, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { envValidationSchema } from './config/env.validation';
import storageConfig from './config/storage.config';
import queueConfig from './config/queue.config';
import videoConfig from './config/video.config';

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
    ]);
    await writeFile('/tmp/video-processing/worker-health', String(Date.now()));
  };
  await check();
  const timer = setInterval(() => {
    check().catch((error: unknown) => {
      console.error('Worker infrastructure check failed', error);
    });
  }, 10000);
  const stop = async () => {
    clearInterval(timer);
    await queue.close();
    s3.destroy();
    await app.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void stop());
  process.once('SIGINT', () => void stop());
  console.log('Video worker infrastructure ready; consumer starts in F03-07');
}

void bootstrap().catch((error: unknown) => {
  console.error('Video worker bootstrap failed', error);
  process.exitCode = 1;
});
