# Shared Memory — complete project blueprint

**Prepared for Amit | 6 September 2026 | Proposed for implementation by GPT-6-Astra with Ultra reasoning**

Build one personal service that ChatGPT web, Codex CLI/IDE and Claude web/Code can use to read, save and update the same persistent project knowledge. Start with TypeScript, Cloudflare Workers, D1 and maintained OAuth components. The service needs no LLM API, embedding subscription or vector database for its first release.

The key limitation remains: a hosted memory store cannot force another company's assistant to call it. Global instructions make read/write behavior more consistent; actual use remains subject to the app, account, tool permissions and model behavior. Optional local CLI hooks can improve automation after the core service works. This project does not synchronize vendors' built-in memory or invisibly capture every chat.

This is a complete planning and coding-handoff package. No app has been built, no service deployed, and no actual-client/benchmark tests have passed yet. Implementation gates explicitly distinguish proposed targets from observed evidence.

## Start here

1. Read [the product and architecture specification](docs/superpowers/specs/2026-09-06-shared-memory-design.md).
2. Give the coding agent [ASTRA-HANDOFF.md](ASTRA-HANDOFF.md) with this whole directory or ZIP.
3. Execute [the ordered implementation plan](docs/superpowers/plans/2026-09-06-shared-memory-implementation.md), beginning with the authenticated runtime/client/CPU spike.

## What is decided

| Topic | Proposed decision |
|---|---|
| Ownership | One personal GitHub owner; no public signup; independent client grants. |
| Scope | Explicit projects; personal profile context only with explicit opt-in and access. |
| Interfaces | Seven MCP tools plus a separate owner dashboard. |
| Hosting | Cloudflare Workers + D1 + OAuth-provider KV; static dashboard on the same Worker. |
| Free operation | Conditional on actual quotas/CPU measurements; no automatic paid upgrade. |
| Search | Bounded lexical/title/alias/FTS search, evaluated against synthetic cases. |
| Updates | Immutable revisions, expected-revision checks and retry-safe operation receipts. |
| Trust | Writer-reported provenance and server-recorded actor/time; memory is reference data. |
| Recovery | Browser exports/imports; locally verified and encrypted owner copies; restore reconciles newer deletions. |
| Automatic behavior | Global instructions P0; supported local hooks and offsite backup P1. |
| Alternative host | Vercel + Neon assessed; switch only on measured need and a concrete cost/architecture decision. |

## Package index

| File | What it resolves |
|---|---|
| [BASELINE.md](docs/BASELINE.md) | Shared constants, boundaries and authoritative decisions. |
| [Design specification](docs/superpowers/specs/2026-09-06-shared-memory-design.md) | User requirements, assumptions, scope, UX, architecture and success criteria. |
| [Implementation plan](docs/superpowers/plans/2026-09-06-shared-memory-implementation.md) | Exact future files, interfaces, test examples, tasks, commits and release gates. |
| [MCP-CONTRACT.md](docs/contracts/MCP-CONTRACT.md) | Seven tools, typed inputs/outputs, actor types, errors and byte limits. |
| [DATA-MODEL.md](docs/contracts/DATA-MODEL.md) | Canonical tables, atomic CAS/receipt protocol, search, retention and export format. |
| [CLIENT-SETUP.md](docs/integrations/CLIENT-SETUP.md) | Per-client setup, copyable global instructions and automation limits. |
| [SECURITY.md](docs/operations/SECURITY.md) | OAuth, ownership, prompt injection, isolation and incident boundaries. |
| [DEPLOYMENT-AND-RECOVERY.md](docs/operations/DEPLOYMENT-AND-RECOVERY.md) | Environments, commands, deployment, backup, restore and rollback. |
| [HOSTING-AND-COSTS.md](docs/decisions/HOSTING-AND-COSTS.md) | Free quotas, actual-client CPU risk, cost model and alternatives. |
| [RESEARCH-AND-REUSE.md](docs/decisions/RESEARCH-AND-REUSE.md) | Memory research, upstream projects and license-aware reuse. |
| [TEST-STRATEGY.md](docs/testing/TEST-STRATEGY.md) | Synthetic dataset, auth/integrity gates, metric definitions and client tests. |
| [SOURCES.md](docs/SOURCES.md) | Primary source URLs and scope of supported claims. |
| [RISK-REGISTER.md](docs/RISK-REGISTER.md) | Risk triggers, mitigations and decisions required if a gate fails. |
| [TASKS.csv](TASKS.csv) | Flat task backlog with dependencies, outputs and acceptance gates. |
| [ASTRA-HANDOFF.md](ASTRA-HANDOFF.md) | Ready-to-paste instructions for the implementation session. |
| [Diagram notes](diagrams/diagram-notes.md) | Editable architecture, write sequence and recovery Mermaid sources. |

## First-release acceptance

An authenticated ChatGPT connection saves a synthetic decision. Codex reads it and commits a new revision. Claude retrieves the update and history. Concurrent updates produce one winner and an explicit conflict. Revoking a grant denies subsequent admitted requests. An export restores into a fresh isolated database with equivalent canonical history/search and no resurrection of subsequently purged notes.

The tests must run on real D1 and each actual client surface. Model statements such as “saved” are not evidence; persisted receipts and subsequent reads are. Security/integrity scenarios require 100% passing coverage of the declared cases. Retrieval/latency/free-budget figures are development targets, not promised results.

## Cost, effort and open prerequisites

The proposed baseline avoids mandatory paid infrastructure within verified Free quotas, but existing assistant subscriptions, hardware, optional domains and engineering time are separate. Workers Free's documented 10 ms CPU ceiling makes the deployed authenticated-path spike the first architecture gate. A free plan offers no availability guarantee. See the cost decision for current primary sources and calculations.

P0 planning estimate: 15-25 focused engineering days including integration, review, evidence and recovery drills. This is a sizing estimate rather than a promised duration; coding-agent speed does not remove account eligibility or real testing requirements.

Implementation needs actual Cloudflare access, GitHub immutable owner ID/login registration, a stable chosen endpoint, repository location and available target client accounts. These were not fabricated during planning. Routine implementation choices should follow this package without repeated permission questions; deployment and spending use the authorization given in the coding session.

## Selected plugins and research

Superpowers structured the design and implementation plan. GitHub supplied public upstream/reuse evidence. Consensus supplied research-paper discovery and summaries. Firecrawl and OpenAI Developers supported current documentation research. Vercel documentation informed hosting comparison. Whimsical returned a reauthentication requirement; editable Mermaid and a portable rendered architecture diagram are supplied, and no Whimsical board was created.

Only material needed for this project was used. The app itself does not depend on any of these planning plugins. Source review does not reproduce published experiments or prove undocumented future client behavior.
