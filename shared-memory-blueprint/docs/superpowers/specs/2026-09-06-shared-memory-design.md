# Shared Memory: product and architecture specification

Version 1.0 | 6 September 2026 | Proposed for review before implementation

This specification turns Amit's request into a personal service that ChatGPT, Codex and Claude can use to read, save and update the same project knowledge. GPT-6-Astra with Ultra reasoning is the requested implementation agent. That model selection belongs to the coding session; it is not a runtime dependency of the product.

No application, connection, hosting account, repository on GitHub, or production database has been created by this planning work. Source research verifies documented capabilities; actual client compatibility, performance and cost remain development gates.

## 1. The result we are building

Amit discusses a personal project in ChatGPT and saves a decision. Codex retrieves the decision, implements a change and records progress. Claude reads the same updated record and reviews the result. Amit can inspect and correct the records in a small browser dashboard and recover them from an export.

The service stores explicit, inspectable knowledge. It does not automatically gain access to every conversation, synchronize vendors' built-in memory, run a language model, or guarantee that a client follows an instruction on every message.

### Success scenario

1. Connect the same canonical `/mcp` endpoint to the five target surfaces: ChatGPT web, Codex CLI, Codex IDE, Claude web and Claude Code.
2. All connections identify the same immutable owner, with independent grants and selected project access.
3. Save a synthetic project decision in ChatGPT and receive memory ID plus revision 1.
4. Read that ID in Codex, update with expected revision 1, and receive revision 2.
5. Read revision 2 in Claude, including provenance and the prior revision when explicitly requested.
6. Submit conflicting updates from two clients. One succeeds; the other receives a version conflict, preserving both the original and winning revision.
7. Revoke one client. New protected requests through that grant fail after revocation commits.
8. Export, restore into an isolated database, and reproduce the same canonical records and searchable state.

## 2. User requirements and planning assumptions

| ID | Requirement or assumption | Status |
|---|---|---|
| U01 | Share persistent read/write/update memory between ChatGPT web, Codex and Claude. | User requirement |
| U02 | Prefer free, reliable operation, with the ability to build and host the service. | User requirement |
| U03 | Use global instructions to reduce repeated memory prompts. | User requirement |
| U04 | Provide complete requirements, development plan and implementation handoff. | User requirement |
| U05 | GPT-6-Astra with Ultra reasoning will implement it. | User requirement |
| A01 | One personal owner, no public signup or team sharing in v1. | Proposed default |
| A02 | Use GitHub for human login; match the immutable numeric account ID. | Proposed default |
| A03 | Cloudflare is the primary host; Vercel is evaluated as a fallback. Mentioning Vercel does not establish an exclusive host requirement. | Proposed default |
| A04 | Use synthetic/personal material initially. No automatic import of employer/client material or all previous chats. | Proposed default |
| A05 | Free quota exhaustion produces visible unavailability; paid upgrades require a separate spending decision. | Proposed default |
| A06 | Dashboard uses one simple light theme, responsive layout, accessible controls and plain text by default. Visual polish follows core reliability. | Proposed default |

These defaults let implementation proceed coherently once the plan is accepted. Only actual account identity, connection availability, deployment authorization and any spending choice are external prerequisites. The implementer must not turn routine naming or styling decisions into repeated blocking questions.

## 3. Scope and release boundaries

### P0: complete first personal release

- Stable HTTPS MCP endpoint with OAuth, selected projects, independent client grants and owner-only administration.
- Seven tools: `list_projects`, `search_memory`, `read_memory`, `save_memory`, `update_memory`, `get_context`, `get_history`.
- Explicit fact keys, provenance labels, validity metadata, immutable revisions, atomic conflict protection and retry-safe write receipts.
- Safe full-text, title, tag and alias search; compact context packs with visible bounds.
- Browser dashboard: inspect/search, create/edit, history, archive, permanent deletion, projects, grants, exports/imports and service status.
- Reviewed canonical JSONL import/export, FTS reconstruction, deletion-ledger reconciliation and one demonstrated recovery drill.
- Global instructions for each client, repeatable real-client acceptance scenarios and CI based on synthetic data.
- Documented cost, quota, upgrade, incident, rollback and maintenance procedures.

### P1: after measured P0 release

- Optional Codex and Claude Code hooks, with timeout and loop guards and no full-transcript capture.
- Scheduled encrypted offsite backups after selecting and authorizing a destination.
- Measured semantic search if lexical/alias evaluation misses an agreed target.
- Reviewed adapters for ChatGPT/Claude conversation exports and larger chunked backups.
- Standard `search`/`fetch` adapters if company-knowledge or deep-research compatibility becomes a requirement.

### Excluded until separately designed

Multiuser collaboration, public signup, billing, public plugin submission, raw transcript scraping, browser extensions, arbitrary document crawling, tool execution from memory content, vector infrastructure, a chat model/router, mobile apps and graph visualization. All add cost or trust boundaries beyond the requested personal memory service.

## 4. Approach decision

| Approach | Advantage | Main cost/risk | Decision |
|---|---|---|---|
| Custom narrow MCP domain on maintained SDK/OAuth components | Precise ownership, conflict and export rules; compact personal scope. | We own application correctness and operations. | Recommended |
| Self-host Basic Memory | Existing notes, search and interfaces. | Different Python/storage stack, broader operations and AGPL reuse considerations. | Reference and fallback, not forked by default |
| Hosted Supermemory/Basic Memory | Less engineering and maintenance. | Provider quotas/pricing and less control over exact behavior. | Useful alternative if build effort outweighs control |

Research is an input, not proof that custom code is inherently more reliable than a maintained service. See the research/reuse and hosting decisions for exact sources and limitations.

## 5. Architecture

One Cloudflare Worker receives MCP and dashboard traffic. Its maintained OAuth provider handles MCP authorization flow using KV. An application authorization layer checks the immutable owner, scopes, grants and project membership against the primary D1 database. The MCP adapter and dashboard call the same domain services. The domain repository owns canonical records, revisions and receipts; FTS5 is a rebuildable index.

| Boundary | Responsibility | Must not do |
|---|---|---|
| `src/mcp` | Tool metadata, schemas, transport results and safe error mapping. | Embed business SQL or trust model-supplied identity. |
| `src/auth` | Upstream login, OAuth integration, primary D1 grant checks, admin session/CSRF. | Treat any successful GitHub login as the owner. |
| `src/domain` | Typed memory rules, canonical normalization, conflict policies and context budgets. | Call a model API or a hosting-specific global. |
| `src/db` | Bound SQL, atomic write protocol, migrations, FTS and export reads. | Use KV for canonical memory or assume zero-row updates fail. |
| `src/admin` and `web` | Owner administration and inspection through the same domain rules. | Bypass revision checks or expose raw Markdown HTML. |
| `src/operations` | Maintenance barriers, export/import and aggregate health. | Restore secrets or silently resurrect purged memory. |

The runtime is Workers, not Node. Node 22 LTS is development/CI tooling. Use released compatible packages, pin exact versions and lockfile after the initial runtime spike. Current official sources describe SDK v2 and stateless handlers; some older demos remain on v1/McpAgent. Do not mix imports from different API generations. [Cloudflare handler](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/), [official SDK](https://github.com/modelcontextprotocol/typescript-sdk).

## 6. Functional requirements and acceptance

| ID | Requirement | Acceptance evidence | Task |
|---|---|---|---|
| FR01 | All selected clients authenticate to one resource. | Real-client matrix includes login, tools/list, read/write, restart and refresh. | T01, T02, T11 |
| FR02 | Only the configured owner can use the service. | Second-account and forged-owner cases fail before data access. | T02 |
| FR03 | Every operation is scoped to authorized projects. | Cross-owner/project IDs, search snippets, counts and history reveal nothing. | T02, T03, T05 |
| FR04 | Notes preserve source claims and server-controlled provenance. | Source labels are required; server actor/time/revision cannot be edited. | T03, T04 |
| FR05 | New notes return committed receipts and enforce fact-key uniqueness. | One note and revision per successful operation; collisions are explicit. | T04 |
| FR06 | Updates reject stale revisions without side effects. | At least 100 conflicting pairs yield one winner each. | T04 |
| FR07 | Retries are idempotent. | Lost-response retry returns the original receipt; changed payload rejects. | T04 |
| FR08 | Search returns bounded relevant records. | Safe FTS grammar, deterministic ranking, byte caps and retrieval evaluation. | T05, T10 |
| FR09 | Context packs preserve project boundaries and evidence. | Profile inclusion requires grant and explicit opt-in; cap never breaks JSON. | T06 |
| FR10 | History distinguishes current records from earlier claims. | Current/historical correction cases show proper revision and validity labels. | T03, T04, T05 |
| FR11 | Disputed claims remain visible as disputed. | No timestamp-only truth resolution; current clients receive the label. | T04, T05 |
| FR12 | Dashboard supports owner inspection, edits and project/grant management. | Authenticated browser tests include conflict/revocation/accessibility paths. | T07 |
| FR13 | Archive and purge have distinct effects. | Archive excludes normal retrieval; purge removes canonical content and index, with honest backup retention. | T08 |
| FR14 | Exports are consistent and restorable with FTS present. | Canonical checksum/count/search equivalence after isolated restore. | T09 |
| FR15 | Failures and receipts are observable without content logging. | Redaction tests; dashboard reports received calls, errors and export age. | T06, T07, T12 |
| FR16 | Global instructions support cross-client handoff. | Copyable instructions plus measured implicit-load/save adherence. | T11 |
| FR17 | GitHub CI and deployments preserve environments and secrets. | PR checks, independent staging/prod bindings, documented rollback. | T01, T12 |
| FR18 | Costs and unsupported client behavior are explicit. | Resource report, $0 viability result, no silent upgrade or false support claim. | T01, T10, T11, T12 |

## 7. Nonfunctional requirements

| ID | Proposed objective | How it is verified |
|---|---|---|
| NF01 Integrity | No silent lost updates, duplicate revisions or partial success records. | Actual D1 transaction/race/fault tests, not SQLite mocks alone. |
| NF02 Security | All mandatory authorization cases pass; no protected records in public responses. | Negative tests, scope fixtures, browser review and real revoke test. |
| NF03 Search | Recall@5 >=90% on exact/alias cases; complete evidence@10 >=80% on multi-note cases. | Frozen 200-query synthetic dataset; paraphrase results separately reported. |
| NF04 Latency | Warm staging p95 search <500 ms at 10,000 modest notes and five concurrent clients. | Repeated measurements with CPU and DB rows; cold timing separately shown. |
| NF05 Free budget | No CPU/quota errors in the largest admitted-payload and OAuth test matrix. | Deployed metrics; target p95 CPU <=7 ms and p99 <10 ms as headroom, not SLA. |
| NF06 Recovery | Demonstrated isolated restore <=60 min; daily recovery point only if daily exports occur. | Timed restore and backup-age reporting. |
| NF07 Accessibility | Keyboard-only core flows, visible focus, semantic labels and no color-only statuses. | Browser checks and automated accessibility scan. |
| NF08 Portability | Canonical JSONL export independent of SDK/host and FTS index. | Fresh import plus documented schema-version migration. |

No uptime percentage or flawless recall is promised. External clients, network access and free-tier quota affect availability. Service correctness and client/model compliance are separate acceptance reports.

## 8. Data behavior

`docs/contracts/DATA-MODEL.md` defines persistence. `docs/contracts/MCP-CONTRACT.md` defines public shapes and exact limits. `docs/BASELINE.md` holds shared constants.

Keep one fact or decision per note where practical. Updates create immutable revisions. Explicit user corrections change the current note while retaining recorded history. A change of real-world state uses a validity interval and reason; it must not rewrite when an event occurred. Contradictory unresolved assertions are marked disputed. The first release does not promise automatic semantic contradiction detection or correct answers to arbitrary historical natural-language questions.

Current facts, progress, preferences and next steps belong to explicit projects. A profile is an ordinary separately granted project. Client hooks or instructions can map a repository to an ID, but cannot set a globally shared current project. This prevents simultaneous chats from moving each other's scope.

Archived projects disappear from ordinary MCP listing/search/context and reject new note writes with `PROJECT_ARCHIVED`. Explicit authorized note/history reads remain possible; the owner can unarchive through the dashboard. OAuth and owner-admin actors share the domain service but have distinct server-derived identities. Revision snapshots retain their nonsecret attribution after restore. `source_supported` requires a nonempty evidence reference; it still means writer-reported support. Note admission proves the complete supported read response fits its byte cap, including JSON escaping.

## 9. Owner dashboard requirements

Use a compact list-and-detail layout. At desktop width the selected note appears beside results; at 390 px it becomes a separate detail screen with a clear Back control. Project selector stays visible. A search result shows title, kind, status, updated time and provenance label. Avoid a graph or ornamental metrics page.

Core screens: sign in; projects/search; note detail/editor/history; connected clients and grants; export/import/recovery; status. Note editing fetches a revision, shows changes, and submits `expected_revision`. A conflict offers reload and manual reconciliation, never a blind overwrite button. Permanent delete requires owner interaction and a typed note title, describes retained external backups, and shows its tombstone receipt. Archive is reversible and separate.

All note bodies are rendered as escaped plain text in v1. Links are explicit clickable references, never fetched automatically. No remote images, Markdown raw HTML or app-generated instruction injection. Content is excluded from page title/analytics/error reporting. URLs use opaque IDs, never personal note titles or snippets.

Status includes last successful received read/write, failure counts, last generated/verified export, quota aggregates and version. It must not claim to count missed chats that never called the service. Unsupported platform/account state is visible in the setup checklist, not hidden behind a green generic Connected badge.

## 10. Main flows and failure handling

### Read and context

Authenticate, admit via primary D1 grant check, validate bounded arguments, resolve explicit project, retrieve authorized current/disputed records, enforce byte budget and return evidence cards. Missing data returns an empty result, not an invented answer. Expired credentials use OAuth 401; denied project access remains indistinguishable from a nonexistent target ID.

### Write and retry

Validate; compute canonical request hash; look up scoped operation receipt; compare the expected revision; execute atomic current/revision/index/audit/receipt write; return only committed IDs and revision. On a timed-out response, retry the same operation ID and unchanged payload within its retention window. On conflict, refetch, reconcile and issue a new operation ID. A revision conflict is not retryable unchanged.

### Backup and restore

An owner-admin export acquires a bounded write barrier, captures manifest metadata, pages canonical tables, hashes output, and releases the barrier. Readers continue. FTS remains intact. Import validates schema/counts/checksum/limits and deletion ledger in isolation, writes bounded batches, rebuilds FTS and verifies representative searches. Production restore additionally resets/revalidates auth grants and reconciles tombstones. No routine backup drops live FTS. [D1 export limitation](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

P0 remote export/import runs through the browser's owner session. The local backup CLI verifies and encrypts/decrypts files already downloaded; it never receives a remote admin credential. Server export completion and owner-reported local verification appear separately. Use interactive `age` passphrase encryption without putting passphrases in shell arguments or sending them to the server.

### Graceful failure

Errors are typed, bounded and content-free. Authentication failure is a protocol-level denial. Domain failures return an MCP tool error with stable code and retry guidance. Maximum client retry policy is three total attempts for transient failures, exponential backoff with jitter and `Retry-After` where exposed, using the same operation ID for writes. Validation, authorization, conflicts and quota exhaustion are not blindly retried.

## 11. Build and release order

1. T01-T02: runtime/dependency/CPU spike and identity/grants, using synthetic data only.
2. T03-T04: persistence schema and transactional memory mutations.
3. T05-T06: search, history, context packs and tool transport.
4. T07-T09: owner dashboard, deletion, export/import and recovery.
5. T10-T12: retrieval/load evidence, five-client handoff and operational release.
6. T13-T14: optional local hooks and automated offsite backups after P0.

Each task is independently reviewable, with exact files, interfaces, tests and commit boundaries in the implementation plan. A coding agent must stop feature work at an unresolved foundation gate, fix it or present a concrete fallback decision, and preserve its work. It must not silently remove a target client, disable auth, enlarge budgets or switch on paid services.

## 12. External prerequisites before deployment

The planning package is complete without account changes. Deployment later requires an accessible Cloudflare account, verified immutable GitHub owner ID and OAuth app credentials, selected stable host/resource URL, and the user's actual target client availability. A private GitHub repository can be created when implementation is authorized, or an existing repository can be chosen. None of these values belongs in generated example secrets or fabricated resource IDs.

Whimsical was selected for editable diagrams, but its connection returned a reauthentication requirement. This package includes editable Mermaid sources and rendered diagrams; no Whimsical board was created. Reconnecting Whimsical is optional and does not block coding.
