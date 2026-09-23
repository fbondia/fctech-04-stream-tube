---
kind: phase
name: phase-03-videos
status: complete
sources_checked: 2026-09-23
---

# phase-03-videos — Context

## Scope and authority

Primary source: BIAWS improvement `desafio-04`, attachment `desafio04.html` (SHA-256 `398218579b2dcb3eb69c97daa67efb5984ffd1d5a53e17975cbe51544b396e64`, matching `../índice/desafio04.html`). The 2026-09-23 BIAWS notes override older TXT-only instructions and assign durable confirmation intent to F03-06 and sole queue publication to F03-07. `docs/project-plan.md` §Fase 03 adds resumable upload; `docs/diagrams/software-arch.mermaid` is a target architecture. F03-01 and F03-02 are `Concluído` in BIAWS; F03-03 is the current task. The decided source for technical choices is `docs/decisions/technical-decisions-phase-03-videos.md`.

**Capabilities to deliver:** private S3-compatible object storage with local MinIO, queue and separate worker in Compose; draft video created on upload start; direct resumable upload up to 10 GB without routing bytes through the API; automatic metadata/thumbnail processing; unique stable video URL; partial streaming and download; migration and channel ownership; unit/integration/e2e coverage and complete phase artifacts.

**Out of scope:** video frontend, category/description editing, public/unlisted controls and publication UI (Fase 04), video watch page (Fase 05), changing the existing authentication stack, replacing MinIO/S3 or implementing unrelated social features. The HTTP upload protocol is exercised by tests/HTTP clients in this phase.

## Decisions index

| Ref | Decision | Plan consequence |
| --- | --- | --- |
| TD-01 | BullMQ + persistent Redis; worker container separate from API | Add real queue/worker/healthchecks; finite retry, backoff, idempotent consumer. |
| TD-02 | Client uploads S3 multipart parts via presigned URLs; API initiates/completes | Define initiate, sign, resume, complete, cancel contracts and 10 GB checks. |
| TD-03 | Private originals and thumbnails buckets with server keys per channel/video | No public object ACLs or storage keys in API responses. |
| TD-04 | Worker streams original to bounded temp file, ffprobe/FFmpeg, deterministic thumbnail | Concurrency, disk, timeout, cleanup and real fixture tests. |
| TD-05 | 128-bit opaque public ID; API streams S3 ranges with 206/416 | Unique DB index; partial bytes and owner/public rules. |
| TD-06 | PostgreSQL durable intent/outbox; F03-07 publishes once logically and reconciles | Atomic confirmation/intent, leases and idempotent worker. |

## Existing patterns and baseline

- Backend lives in `nestjs-project/`; current branch `feature/phase-03-videos` was created from local `dev` at `8459b2f3a9c0dcad4bd0f31972761c00c52609a1`. F03-02 commit is `09f922c`. No video code or new infrastructure exists yet.
- NestJS 11, TypeORM 0.3, PostgreSQL 17, Node 25.6.0 development image. `AuthModule` registers a global JWT guard; `@Public()` bypasses it. `@CurrentUser()` yields JWT `sub`, which is user ID. `Channel.user_id` is unique; videos must link to `Channel.id` and resolve ownership via user ID. Keep existing class-validator DTOs, global ValidationPipe, domain-error shape `{statusCode,error,message}`, `@nestjs/config` `registerAs` namespaces and Joi env validation.
- Versioned migrations are discovered from `src/database/migrations/*.ts`; runtime entities use TypeORM modules. Backend `npm`/`npx`/Jest/TS commands run inside `nestjs-api` per `nestjs-project/AGENTS.md`. Containers use Compose service names, and host access may use localhost.
- F03-01 baseline: `npm test -- --runInBand --forceExit` failed 1 of 144 tests due to a residual PostgreSQL enum in `migrations.integration-spec.ts`; `npm run lint` had 150 errors/40 warnings. E2E and `tsc --noEmit` passed. These inherited failures remain visible and must be fixed before final DoD, without claiming the current phase is green.

## Capability coverage and sequencing

| Project-plan capability | Decision | BIAWS tasks |
| --- | --- | --- |
| Object storage | TD-02, TD-03 | F03-04, F03-06, F03-08 |
| Queue and worker | TD-01, TD-04, TD-06 | F03-04, F03-07 |
| Upload up to 10 GB without API blocking | TD-02 | F03-06, F03-09 |
| Automatic draft on upload start | TD-02, TD-06 | F03-05, F03-06 |
| Metadata extraction | TD-04, TD-06 | F03-07, F03-09 |
| Thumbnail from frame | TD-03, TD-04 | F03-07, F03-09 |
| Unique URL | TD-05 | F03-05, F03-08 |
| Streaming without full download | TD-05 | F03-08, F03-09 |
| Download | TD-05 | F03-08, F03-09 |

F03-04 and F03-05 can run independently after this clean plan because infrastructure and schema share only the documented env/key/event contracts. F03-06 depends on both; F03-07 depends on F03-06; F03-08 depends on F03-05 and F03-07; F03-09 validates the integrated system; F03-10 audits the DoD. The plan must fix every contract before implementation.
