# StreamTube instructions for Codex

## Scope and sources

- This repository is the public fork used for challenge 04. The canonical challenge statement is the `desafio04.html` attachment on BIAWS improvement `desafio-04`; its TXT attachment is only a transcription. Read the improvement, its notes, and the relevant task before changing the phase.
- Continue phases 01 and 02. For phase 03, change the backend, worker, infrastructure, tests, and process documents. The video frontend is out of scope.
- Read `docs/project-plan.md`, `docs/diagrams/software-arch.mermaid`, the applicable phase 02 artifacts, and the current code. Treat the architecture diagram's future components as a target, not as implemented services.
- Keep requirements and technical decisions traceable to the challenge, the project plan, a decisions document, or existing code.

## Git and execution

- Work on `feature/*` branched from this fork's `dev`; integrate into `dev`. Never commit directly on `main` or push to `upstream`.
- Use Docker Compose service names for connections between containers. `localhost` is appropriate only for commands running on the host.
- Run backend `npm`, `npx`, Node, TypeScript, and Jest commands inside `nestjs-api`; see `nestjs-project/AGENTS.md`. For Codex work on a host using port 5432, start the stack with `docker compose -f compose.yaml -f compose.codex.yaml up -d` from `nestjs-project/`; it exposes this project's database at host port 15432 for its PostgreSQL MCP.
- Record branch/base SHA, decisions, commands, exit codes, results, and blockers in `docs/phases/phase-03-videos/progress.md`.

## Required phase 03 workflow

Follow `docs/phases/phase-03-videos/codex-workflow.md`: research → plan-context → plan-validate → plan-resolve (repeat validation and resolution until `clean`) → plan-build → implement each SI → final audit. Keep the same artifacts and formats as the project workflow under `.claude/skills/`; those Claude skills and `.claude/agents/` are reference material, not automatically loaded Codex capabilities. Read the relevant source files manually when a stage needs them. Do not claim a Claude hook, sub-agent, or MCP ran when it did not.

Before using a new library, check its installed version and official documentation. Use Context7 when actually available; otherwise use the official documentation directly and record the source/version in `library-refs.md`. The project MCP configuration is in `.codex/config.toml`; verify availability in the active session before relying on it.

## Definition of Done

- Each SI's relevant unit, integration, and e2e tests pass before advancing. At phase completion, run the full backend tests, e2e suite, `npx tsc --noEmit`, and lint inside the container. Failures block completion.
- Use `*.spec.ts` for isolated unit tests, `*.integration-spec.ts` for real database/service tests, and `*.e2e-spec.ts` for HTTP tests. Use real Compose infrastructure when practical.
- Update the plan, progress, documentation, and instructions to match implemented behavior. Do not claim that the phase is complete from planning alone.
