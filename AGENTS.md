# StreamTube instructions for Codex

## Current project scope

- StreamTube is under development. Through Phase 03, authenticated users can upload videos and anyone with a link can watch a video after processing completes. Video management and publication are planned for Phase 04; social features are planned for later phases.
- `nestjs-project/` contains the NestJS API, video worker and Docker Compose stack. Implemented modules include auth, users, channels, mail and videos. `next-frontend/` covers the earlier phases; Phase 03 has no video UI.
- The implemented stack uses PostgreSQL 17 for application data and the processing outbox, private MinIO/S3 buckets for originals and thumbnails, Redis/BullMQ for the queue, a separate FFmpeg worker, and Mailpit for local email.
- The API orchestrates direct multipart uploads and writes durable processing intent. It does not receive video bytes or publish BullMQ jobs. The worker alone dispatches outbox rows, consumes jobs, extracts metadata, generates thumbnails and commits video state. Ready videos are served by link with streaming and download.
- This file is the canonical repository instruction file for Codex. Use `docs/project-plan.md` for product scope, the relevant phase artifacts for contracts and the current code for implemented behavior. `docs/diagrams/software-arch.mermaid` describes a target architecture that also includes future components. See `nestjs-project/README.md` for implemented video routes and verification commands.

## Working principles

- Keep modules, services and functions focused on their own responsibilities. Follow existing patterns before creating new abstractions, and use strict TypeScript across the stack.
- Use relevant unit, integration and e2e tests to check behavior. Follow the project's ESLint and Prettier conventions, and keep architecture and setup documentation in `docs/` and the project READMEs accurate.
- Keep each change focused on one feature, fix or refactoring. Record unrelated findings separately. Avoid mixing cosmetic edits with functional changes.

## Git and execution

- `main` is the stable branch and `dev` is the integration branch. Create `feature/*`, `bugfix/*`, `hotfix/*` or `docs/*` branches from `dev` and integrate them into `dev`; merge stable `dev` into `main` through the project flow. Never commit directly on `main` or push to `upstream`. Keep commits short, descriptive and focused.
- Run the stack with Docker Compose. Use Compose service names (`db`, `minio`, `redis`, `mailpit`) for container connections; use `localhost` only for commands running on the host.
- Run backend `npm`, `npx`, Node, TypeScript and Jest commands inside `nestjs-api`; see `nestjs-project/AGENTS.md`. When host port 5432 is occupied, include `nestjs-project/compose.codex.yaml` to expose PostgreSQL on host port 15432 without changing container connections.
- Before using a new library, check its installed version and version-compatible official documentation. Cross-check APIs rather than relying on memory; use Context7 when available in the active session, otherwise consult official documentation directly and record the source in the applicable phase's `library-refs.md`. The project MCP declarations are in `.codex/config.toml`; verify availability before relying on them. Trivial language operations and established project CRUD patterns do not require a new lookup.

## Planning and documentation

- `docs/phases/phase-03-videos/` records the completed Phase 03 decisions, clean validation, executable plan, implementation progress and library references. For future phases, use its workflow and the project skills under `.claude/` as references when relevant; Claude skills, hooks and agents are not automatically available in Codex. Apply available Codex skills when they fit the task.
- For new phase work, record decisions and requirements with traceable sources, validate the plan before implementation, and update progress and instructions as behavior changes. Do not claim a hook, sub-agent, MCP, test or command ran unless it actually did.

## Definition of Done

- Run relevant unit, integration and e2e tests for changed behavior, then the full backend and e2e suites, `npx tsc --noEmit` and lint inside the container before completing code changes. Failures block completion.
- Use `*.spec.ts` for isolated unit tests, `*.integration-spec.ts` for real database/service tests and `*.e2e-spec.ts` for HTTP tests. Use real Compose infrastructure when practical.
- Keep documentation consistent with the code. `npm run lint` uses `--fix`; inspect the diff after running it.
