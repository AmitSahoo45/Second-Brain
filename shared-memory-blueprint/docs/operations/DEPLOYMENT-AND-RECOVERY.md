# Deployment and recovery

Status: implementation runbook specification, 6 September 2026. [BASELINE.md](../BASELINE.md) takes precedence. Commands below are proposed interfaces that the implementation must supply; they do not exist merely because they appear here. This planning task performs no deployment or account mutation.

## Environments and configuration

Use Node 22 LTS and npm with a committed lockfile. Proposed Workers compatibility date: `2026-09-06`, revalidated with the selected packages. Preserve separate local, staging and production configurations.

| Name | Type | Contract |
|---|---|---|
| `MEMORY_DB` | D1 binding | Separate database in each environment; no read replicas in v1. |
| `OAUTH_KV` | KV binding | Separate provider namespace per environment. |
| `ASSETS` | Static-assets binding | Owner dashboard assets only; protected APIs still enforce server authorization. |
| `APP_ENV` | Nonsecret variable | `local`, `staging` or `production`. |
| `MCP_RESOURCE_URL` | Nonsecret variable | Exact stable HTTPS resource including `/mcp`; local loopback permitted only for development. |
| `OAUTH_ISSUER_URL` | Nonsecret variable | Exact configured authorization-server issuer for that environment. |
| `OWNER_GITHUB_ID` | Nonsecret variable | Expected immutable numeric GitHub subject; never infer owner from a username. |
| `GITHUB_CLIENT_ID` | Nonsecret variable | Environment-specific upstream login registration. |
| `GITHUB_CLIENT_SECRET` | Worker secret | Upstream login secret; never returned or stored in memory. |
| `ADMIN_SESSION_SECRET` | Worker secret | Cryptographically generated owner-session protection secret, separate per environment. |
| `CLOUDFLARE_ACCOUNT_ID` | Deployment configuration | Actual owner account identifier, supplied during implementation. |
| `CLOUDFLARE_API_TOKEN` | CI/deployer secret | Minimum required deployment/migration permissions; never sent to MCP clients. |

Document placeholders in `.env.example` and binding configuration; ignore local `.dev.vars` and credentials. Do not commit actual secret values. Use distinct upstream login registrations where callback configuration requires them. Local tests use synthetic fixtures and local Workerd storage; ordinary staging uses synthetic data, a separate remote D1/KV pair and separate OAuth grants. Production data must never be copied into CI or ordinary staging for convenience. Recovery instead provisions a dedicated isolated staging instance for the same owner, with no ordinary test clients or external MCP access.

A stable personal `workers.dev` URL is sufficient for the initial service. Do not use changing deployment previews or a random Quick Tunnel as production OAuth identity. Quick Tunnels offer no uptime guarantee and do not support SSE. [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/), [Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)

## Command interfaces

| Proposed command | Required behavior |
|---|---|
| `npm run check` | Locked-dependency install assumed; type checking, lint, meaningful tests and production build validation; nonzero exit on any gate failure. No cloud mutations. |
| `npm run deploy:staging` | Refuse missing staging bindings/URL; deploy only staging resources after authorized provisioning. |
| `npm run smoke:staging` | Synthetic authorized/unauthorized read/write, CAS retry, persistence, isolation and revocation checks; emit redacted machine-readable evidence. |
| `npm run deploy:production` | Require explicit production selection and authorized release context; never fall back from absent staging config to production. |
| `npm run backup:verify -- <bundle-dir>` | Local files only: validate manifest/schema, allowed record types, counts, checksums and bounds; exit nonzero on failure. No service credentials or network access. |
| `npm run backup:encrypt -- <bundle-dir> --output <file>` | Local files only: verify first, safely package the allowlisted files, then invoke installed system `age` in interactive passphrase mode. Never accept a CLI/environment passphrase or overwrite an existing output silently. |
| `npm run backup:decrypt -- <file> --output <bundle-dir>` | Local files only: invoke system `age` decryption with its interactive prompt; extract safely into a fresh directory and verify before success. Reject path traversal, links, unknown files and decompression beyond limits. |

P0 remote export/import occurs only in the owner browser session through CSRF-protected admin APIs. There is no remote backup CLI, admin API key or new admin-credential issuance flow. The local commands are proposed implementation deliverables, not available executables in this planning package. `age` is an explicit local prerequisite; its documented passphrase mode prompts interactively and is automatically recognized during decryption. Keep the terminal attached, and never capture/log its passphrase output. [age passphrases](https://github.com/FiloSottile/age#passphrases)

CI runs read-only checks for untrusted PRs without production secrets. Gate deployment jobs by trusted branch/environment and the session's authorization. Pin action versions and minimum token permissions. Separate provisioning, schema migrations and application deployment so their effects can be reviewed.

## Deployment sequence

1. **Compatibility spike first:** pin compatible released MCP/Cloudflare/OAuth dependencies. Establish synthetic staging OAuth and `/mcp` using the maintained provider. Prove actual supported ChatGPT, Codex and Claude clients can authorize, discover and perform one read/write. Record registration mode, client/account eligibility and reconnect results. Do not substitute an Inspector-only result for actual-client evidence.
2. **CPU gate:** measure the authenticated paths and accepted payload limits described in [Hosting and costs](../decisions/HOSTING-AND-COSTS.md). If Free CPU fails, optimize with evidence or record a hosting/paid-plan decision. No weakened auth and no automatic upgrade.
3. **Integrity and security:** pass the baseline's complete mandatory scenarios, including stale concurrent writes, lost response after commit, idempotency hash mismatch, zero-row CAS, rollback on derived-write failure, cross-project denial and revoked-grant denial. Admitted requests may finish; newly admitted requests after revocation commits must fail.
4. **Recovery rehearsal:** export with FTS present, restore into a fresh isolated database, reconcile tombstones and verify history/search. Measure recovery duration. Validate migration on synthetic staging data and retain the previous application artifact.
5. **Authorized production release:** configure actual isolated bindings/secrets, create/apply reviewed schema, deploy to the chosen stable URL, authenticate the owner and run a clearly labeled synthetic canary. Then connect each real client to explicit project grants. Record release commit, schema version, resource URL and gate evidence without secrets.

## Application backup

Raw D1 export is unsupported for databases with virtual tables, including FTS5. Keep FTS live and export canonical data through owner-only application endpoints. D1 Free Time Travel covers seven days, but is not an owner-held independent backup. [Export restrictions](https://developers.cloudflare.com/d1/best-practices/import-export-data/), [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)

The v1 format is JSONL plus a versioned manifest: schema/export versions, export ID, creation time, source environment, entity counts, byte counts, ordered chunk names and SHA-256 checksums. The only record types are `project`, `memory`, `revision`, `relation` and `deletion`; evidence is nested in memory/revision snapshots, not a separate record type. Include required nonsecret provenance and tombstones. Exclude FTS tables, OAuth material, sessions and secrets. Reauthorize clients on a fresh restore rather than restoring credentials through a memory backup.

The owner logs into the production dashboard and chooses Export. The server derives an `owner_admin` actor from that session; it never fabricates an OAuth client grant for administration. The browser downloads the canonical JSONL/manifest archive under that authenticated session. Export IDs alone are not credentials. Browser completion acknowledges the server manifest/checksum result, not independently verified local storage.

**Snapshot contract:** atomically acquire an owner-scoped maintenance lease with a unique export ID and expiry no later than ten minutes. Every canonical data mutation, including purge/import/project changes, checks that lease inside its write transaction. Reads and emergency grant revocation continue. Paginate deterministically, at most 100 records and 256 KiB per page. These are owner-admin export limits, separate from ordinary MCP output limits. Reject exports exceeding 25 MiB total canonical backup size; do not produce a truncated archive.

Complete only if all pages were read under the same unexpired lease and manifest counts/checksums match. Always release using the matching lease ID; expiry safely ends abandoned leases. An expired/failed export is unusable and cannot update the successful-export timestamp. Test concurrent mutation, timeout, disconnect, size overflow and completion/expiry races. Increasing corpus/backup limits requires a measured streaming/chunking revision before accepting larger backups.

The owner safely extracts the downloaded bundle, runs local `backup:verify`, then `backup:encrypt` and retains the encrypted archive. `backup:encrypt` packages only manifest-allowlisted regular files and wraps system `age -p`; `backup:decrypt` unwraps with `age -d` before bounded extraction. Use maintained local archive tooling; do not implement cryptography. Never send backup passphrases to the browser application or service. The owner is responsible for retaining the passphrase separately and deciding when to remove temporary plaintext copies.

Health distinguishes **server export completed** from **owner reported local verification/encryption**. The first records server completion time, export ID and manifest checksum. The second is an explicit owner-supplied confirmation with the owner-reported local verification time plus server recording time. Label it owner-reported; the browser/server cannot attest that a separate CLI ran or that an encrypted copy remains recoverable. Display the two ages/statuses separately. A server-created manifest alone is not proof of an owner-held usable copy.

**v1 backup responsibility:** owner-held encrypted exports, performed manually. The proposed recovery-point target of 24 hours holds only when the owner actually completes daily verified exports. Display backup age and missed target clearly. Automated offsite backup is P1 and requires a chosen authorized destination; nothing schedules or uploads it in v1.

## Restore, purge and reconciliation

Provision a fresh dedicated recovery staging instance with separate D1/KV/secrets and the same configured immutable owner. Keep external MCP access disabled. The owner decrypts and verifies the local backup, logs into the recovery dashboard through the browser and uploads the canonical bundle using bounded owner-session import APIs. The import cannot create an owner account or connect to production implicitly. Validate format/schema support, limits, checksums and references before promotion; rebuild FTS and compare entity/revision counts plus representative exact/alias/search results. Validate authorization configuration independently. Proposed isolated recovery target: 60 minutes, subject to a measured rehearsal.

Permanent deletion removes current content, history/evidence, FTS entries and receipts containing that content, retaining only non-content deletion tombstones. Old exports and D1 Time Travel can still contain deleted data. The owner must maintain the latest deletion ledger alongside retained backups and remove obsolete backups according to their intended retention. Do not claim physical erasure from all existing copies.

Before promotion, the owner separately downloads the current deletion ledger from the production owner dashboard, retains its provenance/generation, and uploads it into the recovery instance through the owner session. If production is unavailable, use the newest independently retained trusted ledger. Merge it with the backup ledger and apply tombstones to imported canonical/history data; rebuild or reconcile FTS again. Reusing the older backup's own tombstones alone cannot detect later purges. If the latest ledger is unavailable, block production promotion until the owner explicitly reviews potential resurrection. A deleted record must not silently return through either application import or Time Travel.

After validation, the owner explicitly authorizes production promotion. Provisioning/binding changes are a separately authorized deployment action, not a side effect of browser import. Revalidate/reset sessions and grants as required by the target configuration, then reconnect intended clients. Record the `owner_admin` actor for import, ledger reconciliation and owner approval, separately from any deployer identity executing infrastructure changes.

Time Travel can cancel in-flight work and roll back memory, authorization state and tombstones together. Before such a restore, isolate traffic and preserve current deletion/revocation state. Reconcile it afterward, invalidate/reset relevant sessions/grants and rerun authorization checks before reopening. [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)

## Migration, rollback and resource failures

Use numbered immutable schema migrations. Prefer additive changes and preserve compatibility with the previous application release until validation completes. Back up before destructive schema/data work. Application rollback is safe only with a compatible schema; do not assume an older binary can run against an arbitrary newer database. A destructive migration requires a tested restore/reconciliation procedure. Keep maintenance state until recovery is verified, then reopen traffic deliberately.

Track Worker CPU/failures, D1 rows/storage, OAuth KV activity, failed authorization/write attempts, backup age and last successful receipts. Show warnings at proposed 70% and 85% budget thresholds; these are application alert policies, not platform guarantees. Preserve resource reserves for owner recovery where practical.

On quota exhaustion, unavailable primary authorization checks or uncertain write results, fail closed with stable redacted errors. Never bypass auth, return stale cached memory as current, or acknowledge an uncommitted save. Retry transient operations with bounded backoff and the original unexpired operation ID; expired IDs are not replayed automatically. Rate limiting and per-client bounds must reduce abuse without turning unauthenticated metadata endpoints into unrestricted KV-write generators.

## Launch and routine checklist

- Confirm one production resource URL, correct owner identity, isolated bindings, no public signup and no secrets in assets/logs.
- Attach actual-client, integrity, CPU, retrieval and recovery evidence; distinguish targets from observed results.
- Verify fresh-read persistence after deployment/restart and deny newly admitted revoked grants.
- Complete an encrypted owner-held export and isolated restore; record backup-age and recovery measurements.
- Review usage and failures after launch and after dependency/schema changes; perform manual daily exports while the 24-hour target matters.
- Rehearse restore periodically and before destructive migrations; keep the latest deletion ledger available independently of older data backups.
