# Diagram notes

These editable Mermaid files describe the proposed v1 design. They are planning artifacts, not evidence of an implemented service. [BASELINE.md](../docs/BASELINE.md), the [MCP contract](../docs/contracts/MCP-CONTRACT.md) and [data model](../docs/contracts/DATA-MODEL.md) are authoritative when more detail is needed.

## Architecture

`architecture.mmd` shows one deployed Worker and one primary D1 database. OAuth KV, canonical memory and the FTS index have different responsibilities. D1 stores the authorization overlay because eventual KV consistency cannot provide the required newly-admitted-request revocation behavior. Each protected request checks current owner state, grant, scopes and project membership. Authorization storage failure denies access.

The dashboard uses a separate owner session with CSRF protection and a server-derived `owner_admin` actor, while AI clients use independent MCP grants. Administration never requires a fabricated OAuth grant. The identity arrow summarizes GitHub login through application handlers; it does not mean a GitHub access token is accepted directly as a memory token. Upstream tokens are discarded after identity resolution. No global mutable current-project setting is shared between clients.

Canonical note changes, immutable revisions, relation/index effects, success audit and receipt commit together. The two D1 storage shapes are logical groupings in one database, not separate databases or separately committed transactions. FTS is derived and rebuildable. The drawing omits configuration, maintenance/import tables and static asset details for readability.

## Write sequence

`write-sequence.mmd` focuses on update/CAS, retry and conflict outcomes. The client-generated `operation_id` is stable across retries; the server-generated `mutation_attempt_id` is fresh for each database attempt. Hash scope includes the operation and project. An UPDATE affecting zero rows does not fail SQL automatically: the batch's explicit tail assertion and conditional dependent writes prevent false success.

On any uncertain database response, the server checks for the scoped persisted receipt when possible. It does not infer rollback or success from a network timeout. A competing identical retry may have committed; its matching receipt is returned. Other storage/maintenance/key errors must be classified, not all relabeled as revision conflicts. Existing purged receipts yield `PURGED`. Expired operation IDs are never replayed automatically.

The retry branch repeats authorization. A revoked client does not recover access merely because a receipt exists. Newly admitted operations after revocation commits must fail; requests admitted earlier may finish. A stale-revision conflict requires a fresh read and reconciliation before a new operation ID, not an automatic overwrite.

## Recovery

`recovery.mmd` shows consistent application export while FTS and reads remain available. Canonical mutations check the maintenance barrier atomically. Pages contain at most 100 records and 256 KiB; the entire canonical export is capped at 25 MiB. A lease expiry invalidates the export even if every downloaded page individually looks valid. Release operations match the lease ID so an old exporter cannot release a newer lease.

P0 export/import is exclusively through browser owner sessions. There is no remote backup CLI or issued admin API credential. The browser downloads canonical JSONL/manifest records of types `project`, `memory`, `revision`, `relation` and `deletion`, with evidence nested in snapshots. Local planned commands `backup:verify`, `backup:encrypt` and `backup:decrypt` operate only on files. Encryption/decryption wrap installed system `age` with its interactive passphrase handling; they do not take passphrases as CLI arguments.

Status separates server checksum/export completion from the owner's reported local verification/encryption. The latter includes an owner-supplied verification timestamp and server receipt time; it is not server-attested proof that a CLI ran or an encrypted copy survives. Manual daily exports are necessary for the proposed 24-hour recovery-point target; automated offsite backup is P1.

Restore provisions a separate recovery staging instance for the same owner. The owner decrypts locally, logs in to the recovery browser dashboard and imports there. A backup older than a later permanent deletion can contain erased material. The owner separately downloads the current deletion ledger and merges it during recovery. Production restore needs that newest trusted ledger, or an explicit owner review of missing-ledger resurrection risk. The exception branch is a documented owner decision, never an assistant default or an assertion that missing deletions were recovered.

Promotion follows isolated checksum/count/search checks and separate authorization revalidation. Application exports exclude OAuth grants, sessions and secrets. The diagram does not authorize a production restore. Time Travel needs additional preservation/reconciliation of current revocations and deletion state because it can roll those tables back too; see the [recovery runbook](../docs/operations/DEPLOYMENT-AND-RECOVERY.md).

## Whimsical status

Whimsical was requested, but its connection required reauthentication. No Whimsical board was created. These `.mmd` sources remain editable and can be imported or recreated in Whimsical after reconnection; reconnecting it is optional and does not block implementation. No additional Whimsical calls were made for these files.

`architecture.svg` and `architecture.png` are equivalent simplified drawings generated from the same design. They are not pixel-for-pixel Mermaid renders. The `.mmd` files retain the detailed editable topology and sequence/recovery diagrams.
