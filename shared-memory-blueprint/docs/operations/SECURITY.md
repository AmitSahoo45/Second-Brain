# Security design and release requirements

Status: proposed design, 6 September 2026. **No account or permission changes, implementation, deployment, security tests, or successful results exist yet.** [BASELINE.md](../BASELINE.md) is normative; this document specifies implementation requirements.

## Boundaries and threat model

Assets are private note content, immutable revisions, project membership, owner/admin sessions, OAuth grants, export files and deletion records. Trust boundaries separate external assistant clients, the public Worker endpoint, GitHub login, OAuth KV, D1, and the owner dashboard.

| Threat | Required control | Acceptance evidence |
|---|---|---|
| Unrelated person signs in | Preconfigured immutable GitHub numeric owner subject; no signup | Second GitHub identity denied |
| Client guesses another project/note | Server-derived owner/grant and authorization on every lookup | Direct-ID, FTS, history and context isolation tests |
| Token theft or stale KV revocation | Provider token validation plus primary D1 authorization admission | New requests fail after revoke commit |
| OAuth redirect/code attack | S256, code/client/resource binding, constrained redirects, one-time provider code handling | Wrong verifier, reused code, wrong resource and redirect rejected |
| Malicious client metadata | Maintained provider's public-fetch protection and verified CIMD metadata | Private-network/redirect SSRF cases denied |
| Poisoned memory steers model | Return notes as bounded untrusted data; no executing or fetching note content | Injection fixture cannot authorize export or project switching |
| Concurrent assistants corrupt history | expected_revision plus transactional revision/index/receipt changes | Racing update and timeout-after-commit tests |
| Cross-site dashboard request/XSS | Secure cookies, server CSRF checks, CSP, sanitized rendering | Forged-origin/CSRF and stored-XSS tests |
| Accidental disclosure through backups/logs | Owner-controlled exports; redact content/tokens from telemetry | Artifact/log inspection and isolated restore |
| Quota exhaustion | Input/output bounds, endpoint limits, measured CPU and fail-closed auth | Maximum-payload and quota/error tests |

These controls reduce risks; they do not prove a model's summary is correct or a client will follow instructions.

## Owner bootstrap and grants

Before exposing sign-in, configure the intended GitHub numeric user ID through deployment configuration. GitHub login only establishes identity; it does not automatically grant memory access. Resolve and verify the numeric identity, then discard the upstream GitHub token. Never persist it in notes, logs or exports. No first-arrival-becomes-owner behavior, mutable-name allowlist, or email-based account linking.

The Worker derives `owner_id`, `actor_id`, `actor_kind` and the bounded `actor_client_label` from validated admission. Tools do not accept them as authority. An MCP actor is its OAuth grant UUID; an owner-admin actor is a stable separately provisioned UUID and never an OAuth grant. Each connection receives its own grant with explicit projects and scopes:

- `memory:read`: list authorized projects and read/search/context/history within them.
- `memory:write`: create/update/archive within expressly permitted projects, in addition to read.
- Owner dashboard session: separate authority for project/grant administration, import/export and permanent purge. These are not ordinary MCP capabilities.

The profile project is opt-in. A project ID never bypasses membership checks. No mutable global current project and no implicit owner-wide search. Store immutable actor snapshots separately from client-provided model names and evidence assertions; exported historical actor IDs do not grant access. Archived projects are hidden from tools' project lists/search/context, including profile inclusion; authorized direct read/history remains possible, while new note writes reject `PROJECT_ARCHIVED`. The owner can unarchive through the dashboard. Physical grant/project deletion is excluded from v1; revocation/archival preserves non-authorizing identifiers and history.

## OAuth flow and discovery

Use the maintained Workers OAuth Provider and its KV binding, pinned to a released compatible version. The first spike verifies the chosen release contains required ChatGPT/CIMD behavior. Prefer preregistration or CIMD; enable DCR only for an observed client requirement. The provider documents token storage and refresh-recovery behavior; do not replace it with ad hoc cryptography. [Workers OAuth Provider](https://github.com/cloudflare/workers-oauth-provider)

Canonical resource/audience is exactly `https://<stable-host>/mcp`. Publish protected-resource metadata and authorization-server discovery with the real issuer, authorization endpoint, token endpoint, scopes, PKCE methods and supported registration/auth methods. Example protected-resource shape:

```json
{
  "resource": "https://memory.example.com/mcp",
  "authorization_servers": ["https://memory.example.com"],
  "scopes_supported": ["memory:read", "memory:write"]
}
```

The example domain is a placeholder. An unauthenticated protected request returns HTTP 401 and a `WWW-Authenticate` challenge pointing to its HTTPS resource metadata. Public discovery may expose schema/version information, never owner or memory data. Authorize all protected MCP operations, not only mutations.

1. Client discovers metadata and supplies its registered identity/CIMD, redirect, resource and PKCE challenge.
2. Owner authenticates with GitHub and sees client identity, redirect host, projects and requested scopes.
3. Provider issues a short-lived authorization code bound to that request.
4. Client exchanges code plus verifier; `/token` accepts form-urlencoded input.
5. Provider validates the access token and resource; the application performs its D1 admission check before executing the requested operation.

OpenAI documents OAuth discovery, resource binding, PKCE S256 and exact connection-specific/stable redirects. Claude requires resource metadata to match the entered URL including `/mcp`; CIMD needs `none` in token authentication methods and advertised CIMD support. [OpenAI auth](https://developers.openai.com/plugins/build/auth), [Claude auth](https://claude.com/docs/connectors/building/authentication)

Match hosted redirects exactly. Accept varying ports only for the registered native loopback host and exact callback path. Do not generalize that exception into wildcard redirects. Never claim issuer-response support unless the provider returns matching `iss` on the required responses. Validate CIMD using the provider's documented `global_fetch_strictly_public` protection and verified metadata; do not fetch arbitrary client URLs yourself. [Client registration](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration), [provider documentation](https://github.com/cloudflare/workers-oauth-provider)

## Tokens and revocation

Candidate access-token lifetime: 15 minutes, configurable after compatibility/CPU measurement. Select and document a provider-supported refresh expiry policy during the spike. These are proposed settings, not current configuration or promises. Secrets stay in deployment secret storage; token/code/client-secret storage uses the provider's documented protections.

Reuse maintained refresh rotation and its recovery grace. Do not promise strict single-use previous refresh tokens or implement aggressive revoke-on-reuse logic against KV. Test simultaneous refresh, a lost response, allowed recovery, replay outside permitted grace and client reconnection. MCP requires secure token handling, audience validation and public-client refresh protections; compatibility must be assessed against the pinned provider behavior. [MCP authorization security](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations), [provider rotation policy](https://github.com/cloudflare/workers-oauth-provider)

KV is eventually consistent, so it cannot independently implement the service's revocation guarantee. [KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/)

**Mandatory D1 overlay:** after token validation, read the primary to check owner active state, grant revocation, project membership and scopes before admitting every protected MCP operation. Owner-admin operations likewise require a valid owner session plus primary owner-active/epoch admission and explicit domain project permissions. Only the admin adapter can construct that context; `grant_id` is null only for admitted owner-admin sessions. No replicas, protected authorization cache, or fallback to KV when D1 fails. Missing/failed D1 authorization means denial. The grant ID is authenticated provider state, not a request argument.

Owner revocation commits the D1 denial first, then performs provider cleanup. After that commit, newly admitted requests fail even if KV still accepts a token. Requests admitted before the commit may finish. If provider cleanup fails, show cleanup pending while D1 continues blocking. Test revocation concurrently with reads and writes. Removing a connector in an assistant UI is not assumed to prove server-side revocation.

## Memory and transaction safety

Every data tool takes explicit `project_id`; apply authorization before returning search snippets, histories or context. Use parameterized SQL and safe bounded FTS, not client SQL or unrestricted FTS syntax. Enforce all byte/result limits in BASELINE before expensive processing.

Treat note body, title, aliases, evidence and tool-returned metadata as untrusted reference data. No raw HTML, remote images, arbitrary URL fetches, shell actions, or automatic promotion into AGENTS/CLAUDE policies. Stored evidence links are references, not proof that a source was inspected. Writer labels remain assertions; only authentication/time/revision are server-verified.

Updates require expected revision and reason. A write atomically changes the current record, immutable revision, FTS entry, success audit and owner+actor+operation idempotency receipt. A zero-row conditional update must not allow dependent success inserts. Conflicts never produce success receipts or silently overwrite newer data. Reuse operation IDs only for identical uncertain retries; the same ID with different normalized payload fails. Receipt retention is 90 days. Every evidence reference contains a nonempty locator or excerpt; `source_supported` requires at least one reference while remaining a writer assertion. Reject a note before mutation if any supported read-result encoding would exceed its output cap.

## Dashboard, endpoints and delivery

Use a separate owner session with HttpOnly, Secure, appropriately scoped SameSite cookies, session rotation after login and server-side expiry. Validate CSRF token plus request origin for dashboard mutations; state-changing GETs are forbidden. OAuth state/callback protections remain separate from dashboard CSRF.

Serve static dashboard assets from the Worker. Start CSP with `default-src 'self'`, restricted script/style sources, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, and same-origin connection/form policies appropriate to the implemented login flow. No unsafe inline scripts or eval. Escape text and sanitize any rendered Markdown. Protected responses use no-store; OAuth/browser responses must not leak secrets via referrers.

Validate Origin when present on MCP requests without requiring a browser Origin from legitimate server clients. Do not make bearer-token MCP authorization depend on dashboard cookies. Apply rate limits, request deadlines and content-type validation. Log IDs, latency and result codes only, excluding credentials, note bodies, snippets and prompts. Stage/prod databases, OAuth KV and secrets remain separate. CI has no real memories or secrets in untrusted PR jobs.

## Archive, purge, backups and recovery

Archiving is a reversible lifecycle update with revision history; it is not erasure. MCP cannot permanently purge. Owner dashboard purge identifies the project/note and requires deliberate confirmation.

Purge uses a separate guarded CAS transaction: validate owner/title/revision, create an attempt-specific tombstone, delete its corresponding content, mark prior retained write receipts purged, and commit a content-free PurgeReceipt/audit under the owner-admin actor. Identical uncertain purge retries replay that receipt before trying to read the deleted record. Retain non-content deletion tombstone IDs. Existing owner exports and D1 Time Travel can still retain earlier data. Clearly state those retention limits; do not claim deletion from already-distributed chats or backups.

Canonical JSONL exports preserve non-authorizing actor snapshots, exclude OAuth secrets/grants/sessions and FTS, and follow BASELINE's bounded write barrier and size limits. P0 download/upload uses the owner browser session; export IDs alone never authorize access. No remote admin CLI credential exists. A local CLI only verifies/encrypts/decrypts downloaded files. Restore reconciles the latest deletion ledger before production use. If that ledger is unavailable, an old backup stays isolated until the owner reviews resurrection risk. Rebuild FTS, verify checksums and expected counts, and validate isolation before reopening writes. No automatic import of employer material or chat histories.

Release requires all auth/isolation/integrity scenarios to pass, plus actual-client revocation and refresh tests. Critical authorization failures block release; provider/client limitations must be recorded rather than hidden behind an “always secure” claim.
