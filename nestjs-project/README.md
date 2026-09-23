# StreamTube backend — NestJS 11

This backend provides phase 02 authentication and phase 03 video upload, processing and delivery. It uses PostgreSQL 17, private MinIO buckets, Redis/BullMQ, a separate FFmpeg worker and Mailpit. The video frontend is outside phase 03.

## Local setup

Copy `.env.example` to `.env` and replace the example MinIO credentials. `.env` is ignored by Git. From this directory:

```bash
docker compose -f compose.yaml -f compose.codex.yaml up -d --build
docker compose -f compose.yaml -f compose.codex.yaml exec -T nestjs-api npm run migration:run
docker compose -f compose.yaml -f compose.codex.yaml ps -a
./scripts/smoke-video-infra.sh
```

Use plain `docker compose` if host port 5432 is free. The optional Codex override binds the database to host port 15432; container connections always use service names (`db`, `minio`, `redis`, `mailpit`). The API development container is idle by default; tests start Nest in process. To serve the API deliberately, run `docker compose ... exec -d nestjs-api npm run start:dev`. `video-worker` runs independently and `minio-init` exits after creating private buckets and scoped users.

MinIO uses persistent private `videos-originals` and `videos-thumbnails` buckets. Redis uses an AOF volume. The worker checks storage, queue, FFmpeg/ffprobe and temporary disk health. Local MinIO Community uses `S3_CORS_ALLOWED_ORIGIN` and stale multipart cleanup; production S3 needs an equivalent bucket lifecycle policy.

## Video HTTP routes

| Route | Access | Behavior |
| --- | --- | --- |
| `POST /videos/uploads` | JWT owner | Create draft and multipart upload. |
| `POST /videos/:videoId/upload-parts` | JWT owner | Return presigned direct PUT URLs for requested parts. |
| `GET /videos/:videoId/upload` | JWT owner | Resume and list uploaded parts. |
| `POST /videos/:videoId/upload/complete` | JWT owner | Validate and confirm the object; persist one processing intent. |
| `DELETE /videos/:videoId/upload` | JWT owner | Cancel an incomplete upload. |
| `GET /videos/:videoId` | JWT owner | Read upload and processing status. |
| `POST /videos/:videoId/reprocess` | JWT owner | Retry a confirmed errored video with a new generation. |
| `GET /watch/:publicId` | Public | Read ready-video metadata. |
| `HEAD/GET /watch/:publicId/stream` | Public | Stream full or single-range bytes from private storage. |
| `GET /watch/:publicId/download` | Public | Download full or partial bytes with a safe filename. |
| `GET /watch/:publicId/thumbnail` | Public | Proxy the generated JPEG. |

The API never receives the video body or publishes a queue job. Clients PUT parts directly to S3/MinIO; API confirmation writes a PostgreSQL outbox row. The separate worker dispatches BullMQ jobs, extracts duration and metadata with ffprobe, generates a thumbnail with FFmpeg, and commits `ready` or `error` with generation and lease guards. The public URL uses a database-unique opaque ID. Ready videos are accessible by link in phase 03; visibility controls belong to phase 04.

## Verification

Run backend commands inside `nestjs-api`:

```bash
docker compose -f compose.yaml -f compose.codex.yaml exec -T nestjs-api npm test -- --runInBand --forceExit
docker compose -f compose.yaml -f compose.codex.yaml exec -T nestjs-api npm run test:e2e -- --runInBand
docker compose -f compose.yaml -f compose.codex.yaml exec -T nestjs-api npx tsc --noEmit
docker compose -f compose.yaml -f compose.codex.yaml exec -T nestjs-api npm run lint
```

Integration and e2e tests use real Compose services and must run serially. `npm run lint` fixes formatting, so inspect the diff. `test/video-lifecycle.e2e-spec.ts` covers direct upload through the real worker and delivery; `src/videos/video-worker.integration-spec.ts` covers publication recovery. See `../docs/phases/phase-03-videos/progress.md` for the phase audit and actual command results. The generated API contract is `openapi.json`; Swagger UI is optional under `/api/docs` when `SWAGGER_ENABLED=true` and the API is running.
