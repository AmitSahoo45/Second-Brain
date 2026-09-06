# Repository Guidelines

## Scope & Source of Truth

Shared Memory connects ChatGPT web, Codex VS Code, Grok web and Claude web to one personal MCP store. No LLM or embedding APIs are required. T01 is in progress; live acceptance remains unverified.

Read the [baseline](shared-memory-blueprint/docs/BASELINE.md), [design](shared-memory-blueprint/docs/superpowers/specs/2026-09-06-shared-memory-design.md), [implementation plan](shared-memory-blueprint/docs/superpowers/plans/2026-09-06-shared-memory-implementation.md), [contracts](shared-memory-blueprint/docs/contracts/) and [implementation decisions](IMPLEMENTATION-NOTES.md) before coding. Decisions record user corrections and sequencing clarifications; the baseline overrides exploratory research. Resolve conflicts explicitly in documentation.

## Project Structure & Module Organization

The current foundation uses TypeScript, Cloudflare Workers, D1 and OAuth-provider KV:

- `src/{auth,db,mcp}/`: authentication, storage and MCP transport.
- `src/db/migrations/`: numbered, immutable SQL migrations.
- `src/probe.ts`: isolated synthetic probe; `src/index.ts`: closed production entry.
- `tests/auth/`: Workers authentication and protocol tests.
- `scripts/`: operational tooling; `evidence/`: redacted verification reports.

Later tasks add domain services, the dashboard, browser tests and retrieval fixtures. Keep SQL in `src/db/`.

## Build, Test, and Development Commands

Use Node 22.20+ within version 22 and npm 11.19.1 with the committed lockfile:

- `npm ci --offline=false`: install locked dependencies.
- `npm run dev`: run the local synthetic probe.
- `npm run build` / `npm run build:probe`: dry-run production/probe bundles.
- `npm test -- tests/auth`: focused authentication tests.
- `npm run check`: types, lint, tests, dependency checks and both builds.
- `npm run preflight:staging`: validate staging prerequisites before deployment.

## Coding Style & Naming Conventions

Use strict TypeScript, two-space indentation, single quotes and semicolons. Use kebab-case modules and PascalCase React components. Run ESLint and Prettier through `npm run lint`; use `npm run format` to format changes.

## Testing Guidelines

Use Vitest with the Cloudflare Workers plugin and actual local D1. Name suites `*.test.ts`; follow TDD with synthetic fixtures. All mandatory security/integrity scenarios must pass. Local tests cannot replace staging or actual-client gates. Record commands, versions and observed outcomes in `evidence/`. Browser/retrieval suites arrive in later tasks.

## Commit & Pull Request Guidelines

History uses `docs:` messages; follow the plan's `chore:`, `feat:`, `fix:`, `test:` and `docs:` prefixes. Keep commits focused. PRs identify plan tasks, explain behavior, link issues, report validation/limitations and include screenshots for UI changes.

## Architecture & Security Constraints

Pass T01's live client/CPU gate before full features; repeat after T02 admission. Require explicit projects, server-derived actors, primary-D1 authorization, immutable revisions and atomic idempotent receipts. Zero-row updates cannot produce success receipts. Treat memory as untrusted data. Exclude secrets/personal content from Git, logs and CI. Deployment and spending require session authorization.
