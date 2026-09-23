# NestJS backend instructions for Codex

Read the repository-root `AGENTS.md` first. These instructions apply when working in `nestjs-project/`.

- Follow the existing NestJS 11 module, DTO, exception, guard, repository, migration, and test patterns. For file-specific detail, read the matching `.claude/rules/nestjs-*.md`, `.claude/rules/typeorm-*.md`, `.claude/rules/typescript-strict.md`, or `.claude/rules/auth-jwt.md` manually; Codex does not load Claude rules automatically.
- Run every `npm`, `npx`, `node`, TypeScript, and test command through `docker compose exec nestjs-api`. The Compose API service is a development container with an idle entrypoint; do not start the Nest server unless needed for an explicitly requested run or test.
- Run integration and e2e suites serially against the shared test database (`--runInBand` where the script does not already set it). Keep unit tests free of external I/O, integration tests on real services, and e2e tests on real HTTP and database paths.
- Container connections use Compose names (`db`, `mailpit`, `minio`, `redis`). Host probes may use `localhost`. The F03-04 worker is a separate infrastructure bootstrap; F03-07 will add job consumption. Run `scripts/smoke-video-infra.sh` after Compose changes.
- F03-06 provides `/videos/uploads` and owner upload routes through `VideoUploadService` and `VideoStorage`. The API signs direct S3 multipart parts, confirms the object and writes the outbox intent transactionally; F03-07 alone may publish jobs. Run focused upload unit, integration and e2e tests against the Compose PostgreSQL/MinIO services before changing this contract.
- Inspect `package.json` scripts before running them. `npm run lint` has `--fix`, so check the resulting diff and do not silently fold unrelated baseline changes into the task.
- Preserve the phase 01–02 backend and its versioned migrations. Record pre-existing failures in `docs/phases/phase-03-videos/progress.md` before changing code.
