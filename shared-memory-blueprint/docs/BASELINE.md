# Shared Memory: normative planning baseline

Status: proposed design for Amit's personal service, 6 September 2026. Planning only; no implementation or deployed service exists. These decisions take precedence over exploratory research notes. The user requested a complete implementation handoff for GPT-6-Astra with Ultra reasoning.

## Scope and architecture

- One personal owner, multiple explicitly isolated projects; personal projects and preferences first. No automatic import of employer/client material or old chats.
- Target ChatGPT web, Codex CLI/IDE, Claude web/Code. All connect to the same authenticated remote MCP resource. Per-client connection/grant setup remains necessary.
- TypeScript, Cloudflare Workers, D1, and the maintained Workers OAuth Provider's KV binding. Current stateless SDK v2-compatible MCP handler, exact compatible released dependencies pinned in Task 1. Node 22 LTS tooling and npm with lockfile; Workers compatibility date 2026-09-06, revalidated at implementation.
- Mandatory synthetic staging OAuth/client/CPU spike before building full memory features. Workers Free 10 ms CPU is a material constraint; no $0 claim until measured. No automatic paid upgrades. Vercel+Neon is a documented fallback decision, not a second implementation.
- Tool-only MCP; separate small owner dashboard served by same Worker using static assets. No embedded ChatGPT widget, public directory listing, chat UI, LLM API, embedding service, crawler, browser extension, billing, multiuser sharing, or transcript capture in v1.

## Exact domain choices

- `owner_id`, `actor_id`, `actor_kind` and actor display label are always server-derived. An OAuth actor uses its grant UUID; owner administration uses a stable owner-admin actor UUID. Store immutable actor snapshots with revisions so attribution survives export without auth records. GitHub immutable numeric subject bootstraps the one owner; no public signup. Never retain upstream GitHub tokens after identity resolution.
- `project_id` is explicit on every data tool. A separate profile project is opt-in and never implicitly searched across other projects. No server-wide mutable current-project state.
- Memory kinds: `fact`, `preference`, `decision`, `progress`, `next_step`, `question`.
- Lifecycle: `active`, `disputed`, `archived`. Supersession lives in revisions and explicit same-project relationships, not a second mutable truth store.
- Provenance labels: `user_stated`, `source_supported`, `inference`, `unverified`. Labels are assertions by the writer; evidence refs do not prove source inspection. Server separately records authenticated client, write time, revision and receipt.
- Optional `fact_key` unique among nonpurged notes in a project, normalized ASCII lowercase slug. Same key collision returns `FACT_KEY_EXISTS`; never silent overwrite.
- `memory_id` opaque UUID; `revision` positive integer, starting at 1. Every update requires `expected_revision` and a reason. Last-write-wins is prohibited. Unresolved semantic conflicts are marked disputed, not auto-resolved by recency.
- Each write requires a client-generated UUID `operation_id`. Uniqueness is owner+actor+operation_id; request hash covers operation name, project and canonical normalized arguments. Same key/same payload returns original receipt. Same key/different payload returns `IDEMPOTENCY_CONFLICT`. Receipts retained 90 days; expired operation IDs must never be replayed automatically.
- ISO-8601 UTC server timestamps; optional source event time and validity interval separate. Historical lookup shows recorded history and validity labels without claiming automatic bitemporal reasoning.
- Input: request body <=32 KiB; note body <=8 KiB UTF-8; title <=160 Unicode code points; query <=512 code points; <=12 tags/aliases each <=64 code points; <=8 evidence refs with excerpt <=500 code points each; all note editable fields together <=12 KiB UTF-8; relationship count <=8.
- Admission also proves the note can fit the full read envelope under 24 KiB using the supported response encoding; worst-case JSON escaping and any duplicated text count. Every evidence reference needs a nonempty locator or excerpt; source_supported requires at least one such reference, still writer-reported.
- Search: safe parameterized FTS5, exact key/title/alias fallback; auth and active/disputed filters before returned results. Default 5 results, max 20, snippet <=240 code points, serialized output <=24 KiB. Disputed results clearly labeled. Archived notes excluded from search/context; explicit read/history uses ordinary authorized memory:read. Archived projects are hidden from tools list/search/context, permit explicit authorized read/history, and reject new writes with PROJECT_ARCHIVED; owner can unarchive.
- Context pack: default 8 KiB, max 16 KiB serialized JSON, approximate token estimate only. Entire notes only when they fit; otherwise return labeled excerpt cards preserving IDs, labels and evidence references. No silently truncated qualifiers. No generated answers.

## Tool contract names

- `list_projects`: authorized project IDs/names, max 50.
- `search_memory`: explicit project, query, filters, page cursor.
- `read_memory`: explicit project+memory ID; current revision or explicit historic revision.
- `save_memory`: explicit project, editable note fields, operation_id.
- `update_memory`: explicit project+memory ID, expected_revision, replacement editable fields, reason, operation_id. Archive is a lifecycle update; cannot purge via MCP.
- `get_context`: explicit project, query, byte budget, opt-in profile project flag if grant permits.
- `get_history`: explicit project+memory ID, revision page.

The v1 goal is general tool use, not ChatGPT company-knowledge/deep-research search/fetch compatibility. Add those adapters only as a separate validated feature.

## Security and consistency

- Canonical resource/audience: exact stable HTTPS URL including `/mcp`. OAuth discovery, PKCE S256, exact hosted redirects, constrained native loopback ports, maintained provider semantics. Prefer preregistration/CIMD; enable DCR only for proven client need.
- D1 authorization overlay for owner active state, grant revocation, project membership and scopes, checked against the primary before admitting each protected operation. No D1 auth read means denial. KV alone cannot provide immediate revocation. Requests admitted before revocation may finish; after revoke commits, newly admitted requests must fail.
- Ordinary MCP grant: memory:read plus optionally memory:write, explicit project grants. Admin session separately permits project/grant administration, purge, import and export. No owner-wide export or arbitrary URL fetch tools.
- Reuse provider refresh rotation and documented recovery grace; do not promise strict one-use refresh behavior if library differs. Test replay outside permitted grace, simultaneous refresh, and lost refresh response.
- All mutations atomically update current row, immutable revision, derived FTS, success audit, and receipt. D1 batch is transactional; zero-row UPDATE is not an error. Guard dependent inserts with operation-tagged successful mutation, and fail the batch with a constraint if no expected write occurred. Persist conflict/failed-attempt telemetry separately without a success receipt.
- No read replicas in v1. No cache of protected content, no untrusted raw HTML/remote images, no client-supplied SQL, no fetching stored evidence URLs. Memory is reference data, not instructions.
- Owner-only dashboard handles project creation, grants/revocation, note browse/edit/history/archive, permanent deletion, application export/import, health and last receipts. Server-side CSRF protection and secure cookies for owner writes.
- P0 export/import uses the browser owner session. Local backup CLI only verifies/encrypts/decrypts downloaded bundles; it has no remote admin credential. Owner-reported local verification and server export completion are distinct status fields.

## Operations and release

- FTS virtual tables prevent normal D1 raw export. Use canonical JSONL+manifest under a bounded maintenance write barrier; permit reads. Export all canonical memory tables, omit FTS/auth secrets; rebuild FTS on restore. Barrier <=10 minutes; fail export and release safely if exceeded. Export max total 25 MiB in v1, bounded pages <=256 KiB and <=100 records; larger corpus requires measured streaming/chunked upgrade before accepting larger backups.
- Purge immediately removes active DB content, revisions/evidence/index entries/receipts that contain content; retain non-content deletion tombstone IDs. Existing owner backups and D1 Time Travel may retain old data for their documented windows. Restore must reconcile latest deletion ledger; if unavailable, do not restore old data into production until owner explicitly reviews resurrection risk.
- Owner-held encrypted exports are the v1 backup route; show last verified export age. Daily backup target RPO <=24h requires the owner to actually export daily; manual v1 does not claim automated RPO. Verified isolated restore target RTO <=60min. Automated offsite backups are P1 and require a chosen authorized destination.
- Auth/isolation/integrity gates are mandatory 100% scenarios. 200 synthetic queries, 10k-note distractor corpus. Proposed recall@5 >=90% exact+alias; complete-evidence coverage@10 >=80%; report paraphrase separately. Proposed warm p95 search <500ms and no Free CPU failures in measured matrix; targets are not achieved results.
- Local workerd tests and D1 staging tests; explicit actual-client OAuth/read/write/restart/revocation tests; observed instruction adherence measured separately from server correctness. Hooks optional P1 with timeout, loop guard, no raw transcript capture and no unsupported browser-hook claims.
- GitHub private repository default; CI least-privilege, no secrets on untrusted PRs, no personal content in fixtures or repository. Deployment and spending require the authorization present in the implementation session; this planning task deploys nothing.
