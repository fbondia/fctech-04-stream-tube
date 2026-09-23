# phase-03-videos — Progress

**Current task:** F03-02 — technical research and decisions
**Status:** F03-02 research documented; inherited quality failures remain open; implementation has not started
**Canonical source:** BIAWS improvement `desafio-04`, attachment `desafio04.html`
**Workflow management:** [biaws](https://biaws.bondia.com.br/) tracks improvement `desafio-04`, its F03 tasks, statuses, notes, and execution handoffs. This file records the corresponding repository evidence and test results.

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
