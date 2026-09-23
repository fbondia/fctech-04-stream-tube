import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Channel } from '../src/channels/entities/channel.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { User } from '../src/users/entities/user.entity';
import { Video } from '../src/videos/entities/video.entity';

describe('Video upload API (e2e)', () => {
  let app: INestApplication<App>;
  let db: DataSource;
  let ownerId: string;
  let otherId: string;
  let ownerToken: string;
  let otherToken: string;
  let videoId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();
    db = module.get(DataSource);
    const jwt = module.get(JwtService);
    for (const isOwner of [true, false]) {
      const email = `${randomUUID()}@example.com`;
      const user = await db
        .getRepository(User)
        .save({ email, password: 'hash' });
      await db.getRepository(Channel).save({
        user_id: user.id,
        name: 'Video test',
        nickname: `u${randomUUID().replaceAll('-', '').slice(0, 20)}`,
      });
      if (isOwner) {
        ownerId = user.id;
        ownerToken = jwt.sign({ sub: user.id, email });
      } else {
        otherId = user.id;
        otherToken = jwt.sign({ sub: user.id, email });
      }
    }
  });

  afterAll(async () => {
    if (videoId) await db.getRepository(Video).delete(videoId);
    if (ownerId && otherId) {
      const channels = await db
        .getRepository(Channel)
        .find({ where: [{ user_id: ownerId }, { user_id: otherId }] });
      await db
        .getRepository(Channel)
        .delete(channels.map((channel) => channel.id));
      await db.getRepository(User).delete([ownerId, otherId]);
    }
    await app?.close();
  });

  it('enforces JWT, ownership, DTO validation, and cancellation', async () => {
    await request(app.getHttpServer())
      .post('/videos/uploads')
      .send({
        title: 'A',
        filename: 'a.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 1,
      })
      .expect(401);
    await request(app.getHttpServer())
      .post('/videos/uploads')
      .auth(ownerToken, { type: 'bearer' })
      .send({
        title: 'A',
        filename: 'a.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 10_000_000_001,
      })
      .expect(400);
    const created = await request(app.getHttpServer())
      .post('/videos/uploads')
      .auth(ownerToken, { type: 'bearer' })
      .send({
        title: 'A',
        filename: 'a.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 1,
      })
      .expect(201);
    videoId = (created.body as { videoId: string }).videoId;
    expect(created.body).toMatchObject({
      status: 'draft',
      partCount: 1,
      partSize: 16_777_216,
    });
    await request(app.getHttpServer())
      .get(`/videos/${videoId}`)
      .auth(otherToken, { type: 'bearer' })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/videos/${videoId}/upload-parts`)
      .auth(ownerToken, { type: 'bearer' })
      .send({ partNumbers: [2] })
      .expect(400);
    const signed = await request(app.getHttpServer())
      .post(`/videos/${videoId}/upload-parts`)
      .auth(ownerToken, { type: 'bearer' })
      .send({ partNumbers: [1] })
      .expect(200);
    expect(
      (signed.body as { parts: Array<{ url: string }> }).parts[0].url,
    ).toContain('X-Amz-Signature=');
    await request(app.getHttpServer())
      .delete(`/videos/${videoId}/upload`)
      .auth(ownerToken, { type: 'bearer' })
      .expect(204);
    await request(app.getHttpServer())
      .delete(`/videos/${videoId}/upload`)
      .auth(ownerToken, { type: 'bearer' })
      .expect(204);
    const metadata = await request(app.getHttpServer())
      .get(`/videos/${videoId}`)
      .auth(ownerToken, { type: 'bearer' })
      .expect(200);
    expect(metadata.body).toMatchObject({
      status: 'error',
      failureCode: 'UPLOAD_CANCELLED',
      confirmed: false,
    });
  });
});
