# Phase 03 workflow in Codex

The canonical assignment is the BIAWS `desafio-04` attachment `desafio04.html`. Read its latest notes and the current F03 task before each stage. This file maps the Claude-specific workflow to steps that Codex can carry out manually; it does not assert that Claude skills, hooks, or sub-agents execute in Codex.

| Stage | Inputs and action | Required output |
| --- | --- | --- |
| Research | Compare the open choices using the challenge, `docs/project-plan.md`, existing decisions and official version-matched documentation. Use `.claude/skills/research/SKILL.md` as a format reference. | `docs/decisions/technical-decisions-phase-03-videos.md` |
| Plan context | Consolidate requirements, phase 02 patterns, code baseline, decisions, constraints and out-of-scope items. Read `.claude/skills/plan-context/SKILL.md` and `plan-pipeline/SKILL.md` as format references. | `context.md` |
| Validate | Find missing decisions, inconsistent contracts, dependencies and untraceable requirements. Read `.claude/skills/plan-validate/SKILL.md` as a reference. | `validation.md` with `clean` or `dirty` |
| Resolve | Resolve each finding with evidence; check new library versions and official documentation. Re-run validation until `clean`. Read `.claude/skills/plan-resolve/SKILL.md` as a reference. | Updated decisions/context/validation and `library-refs.md` |
| Build | Only after a clean validation, define SI-03.x, Data Model, API Contracts, Authorization Matrix, Error Catalog, Events/Messages, Dependency Map and Deliverables. Read `.claude/skills/plan-build/` for format. | `phase-03-videos.md` |
| Implement | Follow the SI dependency order; run each SI's relevant tests before proceeding. Read `.claude/skills/implement/SKILL.md` and relevant backend rules manually. | Code, tests and `progress.md` |
| Close | Run the complete Definition of Done, verify Compose services and audit every acceptance criterion against files and test evidence. | Updated instructions, docs, progress and final evidence |

The existing `.claude/agents/` files describe read-only helper roles. Codex can perform those reads directly; do not report a sub-agent invocation that did not happen. If the active Codex session exposes parallel agents, use them only when task instructions allow it and their results are verified against the source files.

The project `.codex/config.toml` declares PostgreSQL and Context7 MCP servers for future trusted sessions. Their availability depends on the local Codex runtime and services; check active tools before use. PostgreSQL uses host port 15432 exposed by `nestjs-project/compose.codex.yaml` because the MCP process runs on the host. Docker containers still use `db` as their database host. When Context7 is unavailable, consult official documentation directly and record the fallback.
