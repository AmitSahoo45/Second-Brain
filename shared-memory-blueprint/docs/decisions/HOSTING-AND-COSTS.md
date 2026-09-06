# Hosting and costs

Status: proposed decision, 6 September 2026. [BASELINE.md](../BASELINE.md) is normative. No service has been implemented, deployed or measured.

## Decision

Use one Cloudflare Worker for the remote MCP endpoint and owner dashboard, one D1 database for canonical memory and authorization checks, and one KV namespace required by the maintained Workers OAuth Provider. Authenticate the owner through GitHub, issue separate memory-service OAuth tokens, and restrict ownership to the configured immutable GitHub numeric ID.

Use the current stateless SDK v2-compatible handler. Cloudflare documents `createMcpHandler` from `agents/mcp/server`, taking a fresh `@modelcontextprotocol/server` factory; `McpAgent` is deprecated. Task 1 must select compatible released packages and commit exact versions in the npm lockfile. Documentation examples are not proof that an arbitrary combination of latest packages works. [Cloudflare handler API](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/)

This provides one managed hosting account, relational integrity and FTS5 without a separate vector database, AI API, Redis or permanent protocol session. Keep the business/repository boundary portable. The fallback is a decision to change hosting, not an instruction to build or deploy two systems.

## Free-tier conditions

| Resource | Published free allowance | Consequence for this project |
|---|---|---|
| Workers | 100,000 requests/day; 10 ms CPU per invocation | OAuth and SDK CPU are the first feasibility gate. |
| D1 | 5M rows read/day; 100k rows written/day; 500 MB per database; 5 GB total/account | Indexes, FTS, revisions and audit history consume space and operations. |
| OAuth KV | 100k reads/day; 1k writes/day; 1k deletes/day; 1k lists/day; 1 GB storage | Count authorization, registration, refresh and cleanup activity. |
| D1 Time Travel | Seven days on Free | Recovery window, not an independent backup. |

These are published limits, not achieved measurements. Other services in the account may share allowances. D1 counts scanned rows rather than only returned rows; indexing can reduce reads but adds writes. Free quota exhaustion returns failures rather than guaranteeing continuous availability. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/)

**Do not claim a $0 operating cost until the authenticated staging spike passes.** Official Workers documentation says heavier authentication/payload workloads can use 10–20 ms CPU; Free permits only 10 ms. Network/database wait is excluded from CPU, but processing still matters. Measure authorization, callback, token exchange/refresh, discovery, initialization, tool listing and maximum-size accepted read/write/search payloads. Record cold and warm runs, concurrent clients, p95/p99 CPU and every quota error. Require no Free CPU failures in the measured matrix and report remaining headroom. A small sample is evidence only for that sample. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

Actual reasons to reconsider Free include CPU failures, sustained database/KV quota pressure, a database approaching 500 MB, the need for longer recovery retention, and availability requirements beyond a personal service. Workers Paid has a minimum $5/month account charge with included usage and excess-usage rates. Never enable it automatically. A custom domain, selected backup destination or later inference service can introduce separate costs. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)

### Workload budget to fill with measured counters

The implementation report must calculate daily Worker requests as tool invocations + OAuth/discovery + dashboard calls + retry/export traffic. Calculate D1 reads and writes from actual reported rows for each operation, including admission, indexes, revisions, FTS and receipts. Calculate KV operations from provider registration/login/refresh and retention cleanup. Do not equate one tool call to one DB read or one note update to one billed row.

For each resource, report `remaining = published account allowance - other account usage - measured project usage`, and project month-end storage from retained note/revision/index/audit growth. Record a normal-day and a busiest-tested-day scenario. The application's 70%/85% warning levels are chosen operating thresholds; they are not provider-enforced reservations. Include the encrypted export size and how close it is to the v1 25 MiB recovery cap.

The core service's required inference bill is zero because it calls no model or embedding API. This says nothing about the owner's assistant subscription cost, engineering time, Internet/hardware, optional domain or chosen future backup destination. Show those separately instead of folding them into an unconditional “free” claim.

## Alternatives

| Alternative | Verified fit and limits | Decision |
|---|---|---|
| Vercel Hobby + Neon Free | Vercel supplies Node hosting: 4 CPU-hours, 360 GB-hours memory, 1M function invocations and a 300-second function maximum. Hobby is personal/noncommercial only. Neon Free provides 100 CU-hours/project/month, 0.5 GB/project, 5 GB public egress/project/month, compulsory idle suspension after five minutes and six-hour restore history. | Fallback if the Cloudflare CPU/SDK gate fails and personal-use terms fit. Requires a tested Node OAuth authorization-server design; `withMcpAuth` alone is not the complete login/token service. |
| Local Docker + SQLite/Postgres | Docker Engine is open source. Owner supplies uptime, persistent volumes, TLS, reachable OAuth endpoint, upgrades and backups. Laptop sleep or Internet loss interrupts web-client access. | Useful development/recovery option; do not label it free reliable always-on hosting. |

[Vercel Hobby](https://vercel.com/docs/plans/hobby), [Vercel MCP guide](https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel), [Neon plans](https://neon.com/docs/introduction/plans), [Docker Engine](https://docs.docker.com/engine/install/)

Vercel and Neon limits can pause service or require an upgrade. Neon paid plans meter database usage from zero; Free quotas do not continue as paid-plan allowances. A hosting switch requires a reviewed decision, revised environment/auth configuration and the same integrity/client/recovery gates. [Neon pricing](https://neon.com/pricing)

## Constraints retained regardless of host

- Stable issuer and canonical resource URL ending in `/mcp`; all clients connect to the same production resource.
- Primary database authorization checks before admission. KV is eventually consistent, with propagation taking 60 seconds or more; it cannot alone guarantee prompt grant denial. [KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/)
- Atomic CAS, immutable revision, FTS, success audit and idempotency receipt. D1 batches are transactional, but a zero-row update is not an error; dependent writes require explicit guards. [D1 API](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- FTS remains derived. Raw D1 export is unsupported with virtual tables present, so v1 uses the bounded application export specified in [Deployment and recovery](../operations/DEPLOYMENT-AND-RECOVERY.md). [D1 export restrictions](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- No guaranteed automated client recall, service SLA or free-forever promise. AI client subscription eligibility remains separate from hosting.

The included `workers.dev` hostname avoids purchasing a domain for personal use. Cloudflare describes it as intended for personal/hobby projects that are not business critical and recommends custom domains/routes for production. Choose the intended stable URL before registering clients. [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
