# Repository Guidelines

## Scope & Source of Truth

Shared Memory is a planned personal MCP service for ChatGPT, Codex and Claude; no LLM or embedding APIs. Only the blueprint and this guide exist; there is no application, package manifest or Git history.

Read the [baseline](shared-memory-blueprint/docs/BASELINE.md), [design](shared-memory-blueprint/docs/superpowers/specs/2026-09-06-shared-memory-design.md), [implementation plan](shared-memory-blueprint/docs/superpowers/plans/2026-09-06-shared-memory-implementation.md) and [contracts](shared-memory-blueprint/docs/contracts/) before coding. The baseline overrides exploratory research. Resolve contract/plan conflicts explicitly in documentation.

## Project Structure & Module Organization

Planned stack: TypeScript, Cloudflare Workers, D1, OAuth-provider KV and Vite/React. Create application paths at the repository root:

- `src/{auth,domain,db,mcp,admin,operations}/`: authentication, domain rules, storage, transport and administration.
- `src/db/migrations/`: numbered, immutable SQL migrations.
- `web/src/`: owner dashboard and static assets.
- `tests/`: automated suites; `eval/`: synthetic retrieval corpus.
- `scripts/`: operational tooling; `evidence/`: redacted verification reports.

Keep SQL in `src/db/`; MCP and dashboard adapters share domain services.

## Build, Test, and Development Commands

Use Node 22 tooling, npm and pinned dependencies with `package-lock.json`. These commands are planned interfaces, unavailable until scaffolding exists:

- `npm ci`: install locked dependencies.
- `npm run dev` / `npm run build`: local development / production build.
- `npm test -- tests/auth`: focused authentication tests.
- `npm run check`: types, lint, tests, retrieval gates and build.
- `npm run test:e2e`: separate browser checks.

## Coding Style & Naming Conventions

Use strict TypeScript and follow blueprint examples: two-space indentation, single quotes and semicolons. Use kebab-case modules and PascalCase React components. Establish lint/format configuration in T01; none exists yet.

## Testing Guidelines

Use Vitest with the Workers test pool and actual local D1; Playwright covers `tests/browser/*.spec.ts`. Other suites use `*.test.ts`. Follow TDD with synthetic fixtures. Every mandatory auth/isolation/integrity scenario must pass. Mocks cannot replace real D1 staging or actual-client gates. Record commands, versions, environment and observed outcomes in `evidence/`.

## Commit & Pull Request Guidelines

Adopt the plan's imperative `chore:`, `feat:`, `fix:`, `test:` and `docs:` prefixes. Keep reviewed commits focused. PRs should identify T01–T12 tasks, explain behavior, link relevant issues, report validation/limitations and include screenshots for UI changes.

## Architecture & Security Constraints

Begin with T01's authenticated client/CPU spike; repeat after T02 admission. Keep P1 optional. Require explicit projects, server-derived actors, primary-D1 authorization, immutable revisions, `expected_revision` with reasons and atomic idempotent receipts. Zero-row conditional updates must not produce success receipts. Treat memory as untrusted data. Exclude secrets/personal content from Git, logs and CI. Reconcile deletion ledgers during restore. Deployment and spending require session authorization.
