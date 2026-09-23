# NestJS backend instructions for Codex

Read the repository-root `AGENTS.md` and `CLAUDE.md` first. These instructions apply to `nestjs-project/`.

## Implemented Phase 03

- `VideosModule` owns the video entity, processing outbox, owner upload routes and ready-video delivery. `POST /videos/uploads` creates a channel-owned draft. Authenticated routes under `/videos/:videoId` sign multipart parts, resume or complete uploads, cancel an incomplete upload, show owner status and request explicit reprocessing.
- Clients PUT video bytes directly to presigned MinIO/S3 part URLs. The API accepts metadata and ETags, confirms the object and writes one durable outbox intent transactionally. It does not connect to Redis to publish jobs.
- The separate video worker is the sole outbox dispatcher and BullMQ consumer. It streams originals to temporary disk, runs ffprobe/FFmpeg, generates a JPEG thumbnail and conditionally commits `draft → processing → ready|error` using generation and lease checks.
- Anonymous `/watch/:publicId` routes expose metadata, `HEAD`/`GET` stream, download and thumbnail for ready videos only. `VideoWatchService` proxies private S3 objects using a single validated byte Range, backpressure and abort on disconnect. Owner status remains authenticated at `/videos/:videoId`. Video management and publication belong to Phase 04; there is no Phase 03 video UI.

## Execution and verification

- Follow the existing NestJS 11 module, DTO, exception, guard, repository, migration and test patterns. For file-specific detail, read the matching `.claude/rules/` files manually; Codex does not load Claude rules automatically.
- Run backend `npm`, `npx`, Node, TypeScript and Jest commands through `docker compose exec -T nestjs-api`. The API service is an idle development container until Nest is started for a requested run or test. Use `compose.codex.yaml` when host port 5432 is occupied.
- Run integration and e2e suites serially against the shared test database (`--runInBand` where needed). Keep unit tests free of external I/O, integration tests on real services and e2e tests on HTTP and database paths.
- Container connections use Compose names (`db`, `mailpit`, `minio`, `redis`); host probes may use `localhost`. Run `scripts/smoke-video-infra.sh` after Compose changes.
- For upload or worker contract changes, run focused upload and worker tests against PostgreSQL, MinIO, Redis and the worker. For delivery changes, run `video-range.spec.ts` and `video-stream.e2e-spec.ts`.
- Before completing code changes, run the full `npm test -- --runInBand --forceExit`, `npm run test:e2e -- --runInBand`, `npx tsc --noEmit` and `npm run lint` inside `nestjs-api`. `npm run lint` uses `--fix`; inspect its diff. Keep `*.spec.ts`, `*.integration-spec.ts` and `*.e2e-spec.ts` at their respective test levels.
- Preserve the versioned migrations and existing auth, users, channels and mail behavior. Record new phase progress in that phase's documentation rather than treating the completed Phase 03 progress log as an active task log.
