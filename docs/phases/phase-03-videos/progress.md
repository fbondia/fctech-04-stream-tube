# phase-03-videos — Progress

**Current task:** F03-04 — MinIO, Redis and worker infrastructure
**Status:** F03-04 implementation and SI-03.1 checks complete; inherited phase-wide quality failures remain open for F03-10
**Canonical source:** BIAWS improvement `desafio-04`, attachment `desafio04.html`
**Workflow management:** [biaws](https://biaws.bondia.com.br/) tracks improvement `desafio-04`, its F03 tasks, statuses, notes, and execution handoffs. This file records the corresponding repository evidence and test results.

## F03-04 — Infrastructure and typed configuration

- Confirmed in BIAWS that F03-03 is `Concluído`, F03-04 was `Pendente`; moved F03-04 to `Andamento`. Read the canonical HTML copy and current notes, SI-03.1, decisions and library references. Branch `feature/phase-03-videos` began clean at `1f5865b`.
- Added Redis 7.4.7 Alpine with AOF and named volume; tagged-source MinIO Community build (`RELEASE.2025-10-15T17-29-55Z`, commit `9e49d5e`) with persistent data; idempotent private-bucket/user/policy initializer; separate FFmpeg-equipped worker image, startup and health probe; API queue producer registration; namespaced S3/queue/video configuration and Joi bounds; safe example values. Local `.env` is ignored and uses randomly generated credentials.
- Installed exact `@nestjs/bullmq@11.0.5`, `bullmq@5.81.5`, `@aws-sdk/client-s3@3.1136.0`, and `@aws-sdk/s3-request-presigner@3.1136.0` inside `nestjs-api`; manifest and lockfile changed. Worker image packages its own lockfile dependencies for clean checkout startup.
- Validation (all exit 0): `compose config --quiet`; `compose up -d --build --remove-orphans`; `compose ps -a` showed MinIO, Redis, DB and worker healthy, API running (idle development entrypoint), initializer exited 0; `compose exec -T nestjs-api npm ci --no-audit --no-fund` installed 1,059 packages from lockfile; `npm ls` resolved all four exact new versions; `npm test -- --runInBand --forceExit config` passed 3 suites/9 tests; `npx tsc --noEmit` passed; targeted ESLint on F03-04 TypeScript files passed; `./scripts/smoke-video-infra.sh` passed against real services. `git diff --check` passed.
- The bootstrap worker checks Redis, private originals bucket, FFmpeg/ffprobe binaries and free temporary disk. It intentionally does not consume video jobs; job publication and processing belong to F03-07.
- First real MinIO run created buckets and scoped users, then `mc cors set` exited 1 with `NotImplemented`: bucket CORS is AIStor-only for this release. Replaced it with Community-supported global `MINIO_API_CORS_ALLOW_ORIGIN` and updated decision, plan and refs. Browser-readable `ETag` remains a smoke gate.
- A standalone abort-only S3 lifecycle rule was rejected with `InvalidArgument` by this Community build. Compose instead sets documented stale multipart expiry to 48 hours and cleanup interval to one hour; this leaves the 24-hour application TTL intact. S3 production bucket lifecycle remains a deployment requirement.
- Smoke exercised S3 `CreateMultipartUpload`, presigned `UploadPart` at the browser host, CORS preflight and browser-readable `ETag`, `ListParts`, `CompleteMultipartUpload`, `HeadObject`, worker-role `GetObject(Range)`, abort and cleanup, Redis PING and worker health. First smoke exposed missing API `DeleteObject` for cleanup; scoped policy was corrected and repeated smoke passed. MinIO initializer also exited 0 on repeated Compose runs.
- Restart check: Redis key `video-infra-restart-smoke` persisted through `compose restart minio redis video-worker` (`GET` returned `persisted`); post-restart smoke passed and the key was deleted. Buckets stayed available. This proves local volume persistence and reconnect behavior, not F03-07 job processing.
- Runtime versions: FFmpeg/ffprobe `5.1.9-0+deb12u1`; Redis `7.4.7-alpine`; MinIO `RELEASE.2025-10-15T17-29-55Z` at commit `9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a` (Go 1.24.8); `mc` `RELEASE.2025-08-13T08-35-41Z`. The source build embeds the release tag through upstream `gen-ldflags.go` with `MINIO_RELEASE=RELEASE`. Local image IDs: MinIO `sha256:f995d98c6fc143f14818d4fa4dd8248f583ffd102e893f48f76a2c7e6031d425`, worker `sha256:0d5961ff659b3f5926297a8c01ec03d6606316ae43cd2fabe1ad6bc51f1a4c6f`. Redis image digest `sha256:02f2cc4882f8bf87c79a220ac958f58c700bdec0dfb9b9ea61b62fb0e8f1bfcf`; `mc` digest `sha256:a7fe349ef4bd8521fb8497f55c6042871b2ae640607cf99d9bede5e9bdf11727`.
- The final release-tagged MinIO and typed-config worker rebuilds were redeployed; `minio --version`, `compose ps -a` and `./scripts/smoke-video-infra.sh` all exited 0. All declared healthchecks were healthy; API remained an idle development container as in baseline. No video processing was claimed or tested in this task.

## F03-01 — Baseline and setup

| Item | Evidence / result |
| --- | --- |
| Repository | Public fork `git@github.com:fbondia/fctech-04-stream-tube.git` in this directory; `upstream` is `git@github.com:devfullcycle/mba-ia-greenfield-project.git` with push disabled. |
| Starting branch | Clean `main` at `8459b2f3a9c0dcad4bd0f31972761c00c52609a1`, matching `origin/main` and `upstream/main`. |
| Integration base | The fork did not advertise `origin/dev`. `upstream/dev` at `0b82246ff8fa9937f556c52ea6bb15357309d289` is an ancestor of `main` and lacks later phase 01–02 work. Created local `dev` at `8459b2f3a9c0dcad4bd0f31972761c00c52609a1` to retain the completed baseline. |
| Work branch | Created local `feature/phase-03-videos` directly from local `dev`; no commit on `main`. |
| Existing backend | NestJS 11 / TypeORM / PostgreSQL 17; `auth`, `users`, `channels`, `mail`, `common`, `config`, `database`, `swagger` are present. Phase 02 progress reports 18/18 SIs complete; independently rechecking tests below. |
| Codex port | Added root and backend `AGENTS.md`, `.codex/config.toml`, and `codex-workflow.md`. Existing Claude skills/rules/agents are manual references. The project MCP servers are declared but were not exposed to this already-running task (whose workspace root is the parent directory); verify them in a new trusted Codex session opened at this repository. |
| Local environment | Docker Compose v5.5.1, `postgres:17`, `axllent/mailpit`, API built from `node:25.6.0-slim`. Created ignored `nestjs-project/.env` from `.env.example`, changing local `MAIL_FROM` to a bare address so the environment file parses safely. No project secret was committed. |
| Port collision | Host port 5432 was owned by unrelated `postgres_rag`. Plain `docker compose up -d` exited 1. Added optional `compose.codex.yaml` to bind this project's DB to host port 15432 while container-to-container DB access remains `db:5432`; its `config --quiet` exited 0. |

## Baseline commands and results

Run from `nestjs-project/`. For commands below, `compose` means `docker compose -f compose.yaml -f compose.codex.yaml`.

| Command | Exit | Evidence |
| --- | ---: | --- |
| `docker compose up -d` | 1 | Images downloaded and API built, but DB could not bind host port 5432 (`port is already allocated`). |
| `compose config --quiet` | 0 | Optional local port override is valid. |
| `compose up -d` | 0 | `db` healthy, `mailpit` healthy, `nestjs-api` running with its idle entrypoint; Nest server was not started. |
| `compose ps` | 0 | Three services running; DB exposed on host port 15432. |
| `compose exec -T db pg_isready -U streamtube` | 0 | `accepting connections`. |
| `compose exec -T nestjs-api npm ci --no-audit --no-fund` | 0 | Installed 1,020 packages from `package-lock.json`; deprecation warnings only. |
| `compose exec -T nestjs-api npm run migration:run` | 0 | Applied `CreateUsersAndChannels1775687773260` and `CreateAuthTokens1777579850478` in a clean DB. |
| `compose exec -T nestjs-api npm test -- --runInBand` | interrupted after reported failure | Jest reported 22/23 suites and 143/144 tests passing; `migrations.integration-spec.ts` failed on pre-existing PostgreSQL enum. Jest stayed open, so it was interrupted (exit 130). |
| `compose exec -T nestjs-api npm test -- --runInBand --forceExit` | 1 | Reproduced 22/23 suites and 143/144 tests passing. `migrations.integration-spec.ts` fails with `type "verification_tokens_type_enum" already exists`; see `src/database/migrations.integration-spec.ts` setup and `CreateAuthTokens1777579850478`. `--forceExit` avoids the hanging Jest process but does not make the test pass. |
| `compose exec -T nestjs-api npm run test:e2e -- --runInBand` | 0 | 3/3 suites, 52/52 tests passed after restoring the test DB. |
| `compose exec -T nestjs-api npx tsc --noEmit` | 0 | No type errors. |
| `compose exec -T nestjs-api npm run lint` | 1 | Existing code produced 190 findings: 150 errors, 40 warnings. The `--fix` script made no tracked-file changes. |

The integration migration test drops managed tables and the `migrations` table, but leaves the `verification_tokens_type_enum` type. Its next migration run then attempts to create the existing type. The test also left this local database inconsistent after failure. We dropped and recreated only the disposable `public` schema in this newly created challenge database, then reran the two versioned migrations successfully (both commands exited 0). The DB is now ready for subsequent work.

## F03-01 handoff

- The branch and Codex instructions are ready for F03-02 research. No video module or phase 03 technical decision was implemented here.
- The inherited migration test failure, Jest open handle, and lint findings block a green final Definition of Done. Resolve them in an explicit follow-up before F03-10 completion; keep their origin visible rather than treating this baseline as green.
- Verify the declared PostgreSQL and Context7 MCPs in a new trusted Codex session. Until then, do not claim either is active; official library documentation can be used directly when Context7 is unavailable.

## F03-02 — Research and decisions (2026-09-23)

- Confirmed in BIAWS that F03-01 is `Concluído`, F03-02 was `Pendente`, and the 2026-09-23 notes supersede older TXT-only guidance. Checked the canonical `desafio04.html` attachment checksum against `../índice/desafio04.html` (`398218579b2dcb3eb69c97daa67efb5984ffd1d5a53e17975cbe51544b396e64`). Read F03-02 specification, phase 02 context/decisions, project plan, target architecture, current Compose and backend patterns.
- Read `package.json` and `package-lock.json`: Nest core 11.1.16, Nest config 4.0.3, Nest TypeORM 11.0.1, TypeORM 0.3.28; no queue or S3 client dependency installed. Context7/PostgreSQL MCPs are not exposed in this task; official NestJS, BullMQ, Redis, AWS S3 SDK/API, MinIO, FFmpeg, RabbitMQ, PostgreSQL and RFC 9110 documentation was consulted directly on 2026-09-23. Links and scope are in `docs/decisions/technical-decisions-phase-03-videos.md`.
- Produced six decided TDs: BullMQ/Redis with separate worker; S3 multipart directly from client with API-owned completion and 10 GB validation; private originals/thumbnail buckets; ffprobe/FFmpeg with streamed temporary file; opaque unique ID and API proxy streaming with Range/206 and download; PostgreSQL processing intent with F03-07 as sole publisher and reconciliation/idempotence. Alternatives, trade-offs, consequences and F03-03 contracts to fix are documented. No code or dependency changed in F03-02.
- Verification commands from repo root: `shasum -a 256 ../índice/desafio04.html` exited 0 and matched BIAWS; `rg`/`cat`/`python3` read-only inspection commands exited 0; `git diff --check` exited 0. No npm or runtime tests were run because this task changes only research documentation. The inherited test/lint failures recorded above remain open for later tasks.
- Handoff to F03-03: pin versions in `library-refs.md` and lockfile/Compose; define Data Model, API/authorization/error/event contracts, upload part and reconciliation limits, status transitions, default visibility, timeout/disc policies and SI tests; validate until `clean`. MinIO-specific S3 behavior and browser-reachable presign hostname require integration proof. Preserve the F03-06/F03-07 publisher boundary.

## F03-03 — Plan and clean validation (2026-09-23)

- Reconfirmed the BIAWS task and canonical HTML checksum. Wrote `context.md` to map the Fase 03 capabilities and scope, and `library-refs.md` to fix package/service versions with official references and compatibility checks. No application code or dependency was changed.
- Ran a manual plan validation pass against the canonical HTML, BIAWS notes, F03-02 decisions, current backend and phase 02 conventions. It found six planning gaps: multipart limits and crash recovery, ready-video access, state transitions, durable DB→queue handoff, Range semantics, and dependency versions. Added the contract resolutions to the decisions file and produced `phase-03-videos.md` with Data Model, API Contracts, Authorization Matrix, Error Catalog, Events/Messages, dependency map and eleven SI steps. The second pass found zero unresolved planning issues; `validation.md` is `clean` for the plan only.
- Read-only compatibility checks: `npm view` confirmed `@nestjs/bullmq@11.0.5` peers with current Nest 11 and BullMQ 5.81.5, AWS SDK 3.1136.0 supports the container's Node 25; `apt-cache policy ffmpeg` returned Debian's 5.1.9 candidate. Registry DNS prevented `docker manifest inspect`; F03-04 must prove the pinned Redis pull, MinIO tagged-source build, S3/CORS behavior and FFmpeg runtime before closing. The archived MinIO source route and any build changes must be recorded in `library-refs.md`.
- Verification: `git diff --check` passed; static plan audit found the required sections, sequential SI-03.1..11 with input/files/commands/exit, no TODO/TBD markers and `validation.md` clean. No runtime tests were run because F03-03 only writes planning documents. The inherited migration-test and lint failures from F03-01 remain open and cannot be treated as green.
- Handoff: F03-04 may implement infrastructure/config and F03-05 may implement persistence/domain from this shared plan. F03-06 owns completion and durable outbox insertion; F03-07 alone publishes and processes jobs. Record actual command results and any plan deviations here before advancing tasks.
