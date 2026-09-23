---
kind: phase
name: phase-03-videos
checked: 2026-09-23
status: verified-for-planning
---

# phase-03-videos — Library and service references

Context7 and PostgreSQL MCPs were not exposed during planning. Package metadata was queried read-only through `npm view` **inside `nestjs-api`** on 2026-09-23; no package was installed during F03-03. Official upstream documentation and package registries supplied the behavior references. F03-04 installed the chosen versions; F03-07 removed the unused Nest BullMQ adapter. The final lockfile and real Compose tests verify the versions and service behavior below.

| Component | Version for plan | Evidence and compatibility | Use |
| --- | --- | --- | --- |
| Existing `@nestjs/core` | 11.1.16 | Current `package-lock.json`; [Nest queues guide](https://docs.nestjs.com/application/queues). | DI/modules/worker bootstrap. |
| Existing `@nestjs/config` | 4.0.3 | Current lockfile; [Nest configuration](https://docs.nestjs.com/techniques/configuration). | Namespaced config and Joi. |
| Existing TypeORM | 0.3.28 | Current lockfile; [TypeORM transactions](https://typeorm.io/docs/advanced-topics/transactions/). | Entity, migration, outbox transaction. |
| `@nestjs/bullmq` | **11.0.5 evaluated; removed in F03-07** | `npm view @nestjs/bullmq@11.0.5 peerDependencies --json` returned `@nestjs/core` and `@nestjs/common` `^10 || ^11`, BullMQ `^3 || ^4 || ^5 || ^6`; [official Nest integration](https://docs.nestjs.com/application/queues), [package](https://www.npmjs.com/package/@nestjs/bullmq/v/11.0.5). | F03-04 bootstrap installed it. F03-07 uses BullMQ directly inside the worker context; API confirmation has no Redis client. |
| `bullmq` | **5.81.5** | `npm view bullmq@5.81.5 version engines --json` returned Node `>=12.22.0`; it satisfies Nest adapter peer; [retries](https://docs.bullmq.io/guide/retrying-failing-jobs), [job IDs](https://docs.bullmq.io/guide/jobs/job-ids), [unrecoverable errors](https://docs.bullmq.io/patterns/stop-retrying-jobs), [auto-removal](https://docs.bullmq.io/guide/queues/auto-removal-of-jobs). Chosen v5 despite a newer v6 to limit change during this phase. | Retry/backoff, `jobId`, consumer. |
| `@aws-sdk/client-s3` | **3.1136.0** | `npm view ... version engines --json` returned Node `>=20`; current container is Node 25.6.0; [AWS JS SDK v3 S3](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrate-s3.html), [multipart API](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html). | S3 commands, Head/Get/List/Abort/Complete. |
| `@aws-sdk/s3-request-presigner` | **3.1136.0** | Same metadata/Node requirement as S3 client; versions intentionally match; [official package](https://github.com/aws/aws-sdk-js-v3/tree/main/packages/s3-request-presigner). | Per-part presigned `UploadPart` URLs. |
| Redis | **7.4.7-alpine** Docker Official Image | [Docker Official Image tag](https://hub.docker.com/_/redis/tags?name=7-alpine), [AOF persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/). Container registry DNS was unavailable during `docker manifest inspect`; F03-04 must pull and inspect before committing Compose. | BullMQ backend with named volume, AOF. |
| MinIO Community | **RELEASE.2025-10-15T17-29-55Z**, source commit `9e49d5e` | [Upstream release](https://github.com/minio/minio/releases) fixes a security issue. Upstream archived the repository in 2026 and instructs container users to build from the tagged source; do **not** silently substitute an unverified third-party image. F03-04 builds a local image from this tag and records digest, then tests S3 compatibility. [S3-compatible endpoint reference](https://docs.min.io/aistor/reference/aistor-server/http-endpoints/) is product documentation, so compatibility must be demonstrated on the chosen Community build. | Local object storage. Production target is S3-compatible storage. |
| FFmpeg/ffprobe | **5.1.9 Debian package candidate** (`7:5.1.9-0+deb12u1`) | `apt-cache policy ffmpeg` inside current `node:25.6.0-slim` development container returned this candidate on Debian bookworm arm64. F03-04 pins worker package version or Debian snapshot and checks `ffmpeg -version`/`ffprobe -version`; [ffprobe](https://ffmpeg.org/ffprobe.html), [FFmpeg](https://ffmpeg.org/ffmpeg.html). | Metadata and JPEG thumbnail. |
| PostgreSQL | **17** existing image | Current Compose; [row locking/SKIP LOCKED](https://www.postgresql.org/docs/17/sql-select.html). | Video state and durable intent. |
| HTTP semantics | **RFC 9110** | [Range, 206, 416, If-Range](https://www.rfc-editor.org/rfc/rfc9110.html); [S3 GetObject Range](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html). | Streaming contract. |

## Verification to carry into implementation

F03-04 observed that `mc cors set` is unsupported by the pinned Community server (`NotImplemented`); bucket CORS instructions in AIStor documentation do not apply to it. Local Compose uses global `MINIO_API_CORS_ALLOW_ORIGIN` and the smoke checks browser-readable `ETag`. [Community answer](https://github.com/minio/minio/discussions/20841), [server configuration](https://github.com/minio/minio/blob/master/docs/config/README.md).
Community also rejected an abort-only bucket lifecycle rule during F03-04. Its documented `MINIO_API_STALE_UPLOADS_EXPIRY` and `MINIO_API_STALE_UPLOADS_CLEANUP_INTERVAL` settings provide local orphan cleanup; Compose fixes them at 48 hours and one hour. Production S3 needs bucket lifecycle configuration.

F03-04 pulled Redis `7.4.7-alpine` (`sha256:02f2cc4882f8bf87c79a220ac958f58c700bdec0dfb9b9ea61b62fb0e8f1bfcf`) and `mc` `RELEASE.2025-08-13T08-35-41Z` (`sha256:a7fe349ef4bd8521fb8497f55c6042871b2ae640607cf99d9bede5e9bdf11727`). Local MinIO image ID `sha256:f995d98c6fc143f14818d4fa4dd8248f583ffd102e893f48f76a2c7e6031d425` reports `RELEASE.2025-10-15T17-29-55Z` and full commit `9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a`; local worker image ID `sha256:0d5961ff659b3f5926297a8c01ec03d6606316ae43cd2fabe1ad6bc51f1a4c6f` contains Debian FFmpeg/ffprobe `5.1.9-0+deb12u1`. S3 multipart, presign, CORS/`ETag`, Range and abort passed against these services.

1. F03-04 uses `npm install --save-exact` for the four new Node packages, checks `npm ls` and `npm ci` in the container, and records the lockfile versions. No `@aws-sdk/lib-storage` is needed: the **client** sends bytes directly and the API only orchestrates commands.
2. F03-04 proves MinIO image build/pull and S3 commands, not just Compose parsing. Test `CreateMultipartUpload`, presigned `UploadPart` against a browser-reachable host, CORS `ETag`, paginated `ListParts`, `CompleteMultipartUpload`, `HeadObject`, `GetObject(Range)`, abort and bucket restart.
3. F03-07 tests the real FFmpeg binary and a small valid/invalid fixture. Any source/build change in these versions requires updating this file, the plan and validation before the affected SI.

## F03-10 installed-version audit

`npm ls --depth=0` inside `nestjs-api` exited 0 with `@nestjs/core@11.1.16`, `typeorm@0.3.28`, `bullmq@5.81.5`, `@aws-sdk/client-s3@3.1136.0`, and `@aws-sdk/s3-request-presigner@3.1136.0`. The unused Nest BullMQ adapter is absent. Fresh Compose build and real MinIO/Redis/worker smoke passed with the pinned images and worker FFmpeg package. No package version changed during F03-10.
