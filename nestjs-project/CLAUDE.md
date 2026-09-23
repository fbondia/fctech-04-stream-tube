# NestJS backend and video worker

Read the repository root `CLAUDE.md` and `AGENTS.md` first. The backend runs in Docker Compose. Run all backend `npm`, `npx`, Node, TypeScript and Jest commands inside `nestjs-api`; run integration and e2e suites serially against the shared PostgreSQL database.

## Start and verify

Copy `.env.example` to ignored `.env` and replace the example storage credentials. From `nestjs-project/`:

```bash
docker compose -f compose.yaml -f compose.codex.yaml up -d --build
docker compose -f compose.yaml -f compose.codex.yaml ps -a
docker compose -f compose.yaml -f compose.codex.yaml exec -T db pg_isready -U streamtube
docker compose -f compose.yaml -f compose.codex.yaml exec -T nestjs-api npm run migration:run
./scripts/smoke-video-infra.sh
```

The optional `compose.codex.yaml` exposes PostgreSQL at host port 15432 when 5432 is occupied. Containers still use `db:5432`, `minio:9000`, `redis:6379` and `mailpit:1025`. Without a host port conflict, plain `docker compose` is sufficient. `nestjs-api` is an idle development container until Nest is started explicitly; tests start the application in process. `video-worker` starts independently and must be healthy. `minio-init` exits 0 after idempotent private bucket and policy setup.

## Phase 03 implementation

`VideosModule` owns the video entity, outbox, owner upload routes, and ready-video delivery. `POST /videos/uploads` creates a channel-owned `draft` and S3 multipart upload. Authenticated `/videos/:videoId/upload-parts`, `/videos/:videoId/upload`, `/videos/:videoId/upload/complete`, `DELETE /videos/:videoId/upload`, `/videos/:videoId` and `/videos/:videoId/reprocess` handle signing, resume, confirmation, cancellation, owner status and explicit retry. Clients PUT bytes directly to presigned MinIO/S3 part URLs; the API accepts metadata and ETags only. Confirmation inserts one durable outbox intent transactionally and does not connect to Redis.

The separate worker owns the sole outbox dispatcher and BullMQ consumer. It downloads to bounded temporary disk, runs ffprobe/FFmpeg, uploads a deterministic JPEG thumbnail, and conditionally changes `draft → processing → ready|error` with leases and generation checks. `GET /watch/:publicId`, `HEAD/GET /watch/:publicId/stream`, `GET /watch/:publicId/download`, and `GET /watch/:publicId/thumbnail` serve `ready` videos by an opaque stable ID. Streaming proxies a single validated S3 byte range with backpressure, 206/416 handling and abort on client disconnect; private storage keys are not returned.

The API video source is in `src/videos/`, the worker entrypoint in `src/video-worker.ts`, the versioned schema in `src/database/migrations/`, and Compose/storage scripts in this project. The canonical phase contract and evidence are in `../docs/phases/phase-03-videos/`.

## Definition of Done

```bash
docker compose -f compose.yaml -f compose.codex.yaml exec -T nestjs-api npm test -- --runInBand --forceExit
docker compose -f compose.yaml -f compose.codex.yaml exec -T nestjs-api npm run test:e2e -- --runInBand
docker compose -f compose.yaml -f compose.codex.yaml exec -T nestjs-api npx tsc --noEmit
docker compose -f compose.yaml -f compose.codex.yaml exec -T nestjs-api npm run lint
```

`npm run lint` uses `--fix`, so inspect its diff. `*.spec.ts` are isolated unit tests, `*.integration-spec.ts` exercise real services, and `*.e2e-spec.ts` exercise HTTP. Run focused video tests when changing the matching behavior and the full suites before completion. Templates and other runtime assets must be declared in `nest-cli.json` so `nest build` includes them. Do not start a persistent API server for a read-only environment check.
