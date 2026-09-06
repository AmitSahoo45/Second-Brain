# Data model, consistency and recovery contract

Proposed v1. D1 is authoritative; FTS is derived; OAuth KV is not memory storage. Every data table carries owner scope, and every query obtains owner/actor from the authenticated server context. The SQL migration is written and tested during implementation. This schema inventory and write protocol define the required behavior.

## 1. Canonical tables

| Table | Columns and constraints | Indexes / use |
|---|---|---|
| `owners` | `owner_id` UUID PK; `provider` = github; `provider_subject` immutable numeric ID string UNIQUE; `admin_actor_id` UUID UNIQUE, provisioned once; `active` bool; `auth_epoch` integer; `created_at`. Exactly one configured owner. | Subject lookup; emergency deny; stable admin idempotency namespace. |
| `projects` | `project_id` UUID PK; `owner_id` FK; `name` <=80; `is_profile` bool; `archived_at` nullable; `revision`; server timestamps. | UNIQUE(owner_id, normalized_name); partial unique profile per owner. |
| `grants` | `grant_id` UUID PK; `owner_id`; OAuth provider grant identifier UNIQUE; verified client ID; display label; scope list; `issued_epoch`; `revoked_at`; server timestamps. | Owner+active state; no bearer tokens here. |
| `grant_projects` | `grant_id`, `owner_id`, `project_id`; PK(grant_id,project_id). | Composite FKs prevent cross-owner membership. |
| `memories` | `memory_id` UUID PK; `owner_id`; `project_id`; `revision` positive safe integer <=Number.MAX_SAFE_INTEGER; editable fields from NoteFields; server timestamps; immutable-per-revision snapshot `actor_id`, `actor_kind`, `actor_client_label` <=80 Unicode code points; `mutation_attempt_id`. | UNIQUE(owner_id,project_id,fact_key) where key non-null; scope+lifecycle+time; numeric internal rowid for FTS. |
| `memory_revisions` | `owner_id`, `project_id`, `memory_id`, `revision`; complete canonical editable-fields JSON; `reason`; `recorded_at`; snapshot `actor_id`, `actor_kind`, `actor_client_label`; `mutation_attempt_id`; PK(memory_id,revision). | Scope+memory+revision descending. Includes initial revision. Historical actors grant no access. |
| `memory_relations` | owner/project/source_memory/target_memory/relation; unique tuple. | Same-project FKs; per-source lookup. Revision JSON preserves past relation state. |
| `mutation_receipts` | owner/actor/operation_id PK; actor kind; `request_hash`; `mutation_attempt_id` UNIQUE; `result_kind` = write or purge; memory/project IDs; `revision`; `committed_at`; expiry; `purged` bool for earlier write receipts. For a purge result, revision/time map to PurgeReceipt.purged_revision/purged_at. | No FK to a live memory/grant; survive deletion/revocation within retention; never note bodies, title or evidence. |
| `audit_events` | UUID event ID; owner/actor/project/target IDs as allowed; actor kind; operation/outcome/error code; request ID; timestamp; duration and aggregate DB counters. | Owner+time. No raw query, note, token or evidence text. |
| `deletion_ledger` | owner/project/memory IDs UNIQUE; purge time; purge actor ID and operation ID; `mutation_attempt_id`; generation/sequence. | Deleted memory IDs reserved indefinitely; no erased content, title or fact value. Original operation protection uses retained actor-scoped receipts. |
| `maintenance_leases` | owner PK; export ID; generation; deadline; created_at. | One live export per owner; maximum 10 minutes. |
| `export_records` | owner/export ID PK; snapshot generation; created_at/deadline; status; bounded ordered file descriptors/counts; completed_at and manifest SHA-256 nullable until valid finish; nullable owner_reported_verified_at, verification_method, verification_recorded_at. | Durable content-free completion/attestation metadata, retained until explicit whole-service reset; no note content, token or encryption secret. Expired transfer capabilities do not remove completed metadata. |
| `import_runs` | run ID; owner; destination generation; manifest digest; status; last chunk; deadline; counts. | Isolated destination, resumable only inside a <=10-minute run deadline; abandoned data cleaned within 24 hours. |

Tag/alias/evidence lists can live in canonical JSON columns with validation. Search gets normalized text derived from them, not a second mutable copy. If a dedicated index table is needed for exact aliases, its regeneration must be deterministic and atomic with the note update. Auth tables and secret material are excluded from ordinary memory exports.

All foreign keys that traverse owner/project boundaries need composite uniqueness matching the referenced tuple. A UUID's global uniqueness is not a substitute for authorization. Include a second synthetic owner in tests even though public signup does not exist.

Actor snapshots are non-authorizing provenance, not foreign keys that require live OAuth grants. The server copies the admitted actor ID/kind and bounded server-defined client label into every committed snapshot; later grant-label changes do not rewrite history. Export/import includes these snapshots without tokens, scopes, sessions or grant tables. Imported historical actors never become valid AuthContext principals. The isolated restore explicitly maps the authenticated source owner namespace to the already configured destination owner after owner confirmation; reject any other owner namespace, retain historical actor snapshots and use the destination's own admin actor for subsequent writes. Verify original file hashes before mapping; compare post-import canonical digests against the deterministically owner-remapped expected records, rather than incorrectly demanding unchanged bytes after namespace mapping.

Project archival preserves records and grants. Tool project lists/search/context hide archived projects; read/history remains available with read permission and project membership. New writes reject `PROJECT_ARCHIVED` after authorization. An owner can list/unarchive projects through the dashboard. An archived profile is not included in context. Physical project/grant deletion is excluded in v1: retain revoked grant identifiers as non-authorizing metadata rather than cascade-delete provenance or receipts.

## 2. Revision and truth semantics

- `revision=1` is the original saved note. Every successful update increments exactly once and stores the complete new snapshot and reason.
- The `memories` row points to the latest revision; prior snapshots are immutable except permanent deletion.
- Current lifecycle is active, disputed or archived. Explicit history remains readable for an authorized read grant. Normal search/context excludes archived notes.
- Provenance is writer-reported: user_stated, source_supported, inference or unverified. Stored evidence is not an independently checked fact. A tool cannot set an arbitrary server-attested verified flag.
- `recorded_at` means when the service saved the claim. `event_at`/validity fields describe the source/event, if known. Missing time stays missing, never inferred from upload time.
- An explicit correction has reason `correction: ...`; a changed real-world state has reason `state_change: ...` and validity metadata where supplied. Other reasons are free text within bounds. These prefixes aid inspection; they do not create a semantic verifier.
- For unresolved incompatible assertions, mark disputed and use a same-project `contradicts` relation. Latest timestamp is not an automatic truth rule. Relationship creation requires access to both endpoints.
- No universal natural-language as-of query is promised in v1. Historical reads explicitly name a revision. Rich bitemporal queries are later work after an evaluation set justifies them.

## 3. Atomic write protocol

Use supported D1 prepared statements plus `batch()`. Its transaction rollback applies when a statement fails; a zero-row UPDATE succeeds as SQL and therefore needs an explicit guard. [D1 batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/).

The selected implementation pattern is a unique internal `mutation_attempt_id` per database attempt plus a tail assertion. The externally supplied `operation_id` remains stable across client retries. They are different IDs.

1. Apply current authentication and owner/actor/project authorization, then bounded structural parsing and canonical normalization. Hash operation name, project and arguments before adding server time/IDs. Look up owner+actor+operation_id before prospective-state validation: a mismatched hash returns `IDEMPOTENCY_CONFLICT`; a matching retained write receipt returns its original result or `PURGED` if marked purged. This step does not inspect current revision, archive state, relationship targets, write lease or prospective response size. Revoked callers are denied before the lookup.
2. Only when no retained receipt exists, validate prospective note/replacement state, including related-target authorization, revision increment bounds, project archive status and the worst-case supported read-result size using bounded server metadata. Prepare a fresh attempt ID and timestamp. Recheck the write barrier and applicable state conditions in SQL, so a lease acquired after an earlier JavaScript check still blocks a new write. A replay is not a new write and does not acquire a lease or fail these new-write checks.
3. Insert a new memory or update only the authorized matching current revision; set `mutation_attempt_id` and the authenticated actor snapshot on the changed row. The WHERE clause includes owner, project, memory ID, expected revision, an unarchived project and absence of an unexpired maintenance lease. A save uses equivalent project/barrier conditions.
4. Insert a complete immutable revision with `INSERT ... SELECT` restricted to that newly written attempt. Rebuild/update exact aliases and FTS for the same matching row. Reconcile relations only for that successfully marked row.
5. Insert success audit and receipt from the same operation-marked row. Scoped operation uniqueness is a database constraint; a race after preflight must still roll back safely.
6. Execute a guard that fails the batch if the attempt-specific receipt is absent. One valid shape is a temporary assertion row with `CHECK(applied=1)`, inserted with `applied=EXISTS(...)`, then deleted in the same batch. Another validated shape is a trigger raising a known write-not-applied error. Do not merely inspect zero affected rows after unconditional inserts already committed.
7. Commit through D1 batch and return the persisted receipt. If a connection error occurs after commit, an identical retry resolves through the receipt.

Example guard shape to implement and test on D1, not use as an unverified SQL migration:

```sql
CREATE TABLE write_assertions (
  attempt_id TEXT PRIMARY KEY,
  applied INTEGER NOT NULL CHECK (applied = 1)
);
-- Tail statements within the same D1 batch, after conditional receipt insert:
INSERT INTO write_assertions(attempt_id, applied)
SELECT ?, EXISTS(SELECT 1 FROM mutation_receipts
                 WHERE mutation_attempt_id = ?);
DELETE FROM write_assertions WHERE attempt_id = ?;
```

On a batch error, first re-read the scoped receipt to recognize a committed competing identical retry, using the same hash, result-kind and purged-state rules as preflight. A matching prior write receipt marked purged still returns `PURGED`, never an ordinary success. Distinguish the known guard/unique errors from storage faults; do not map every SQL exception to a revision conflict. For a guard failure with no receipt, authorized re-read determines maintenance, archived project, missing target or current revision; the response contains no success receipt. Log failed-attempt metadata separately, and never let telemetry failure turn a committed mutation into an ambiguous false rollback claim.

The exact SQL is an implementation deliverable of T04 and must pass workerd/local D1 plus staging race/fault tests. No JavaScript interactive transaction callback is assumed. Read replicas are off in v1; future replication requires explicit session/bookmark semantics.

## 4. Idempotence and conflict cases

| Situation | Required result |
|---|---|
| Same actor, operation ID and canonical payload | Original memory ID/revision/time; `replayed:true`; no extra revision. |
| Same scoped ID, different payload/tool/project | `IDEMPOTENCY_CONFLICT`; no changes. |
| Different actor happens to use same operation ID | Independent namespace; normal fact-key/revision checks still apply. Owner-admin has its own stable actor namespace. |
| Two updates to revision 7 | One revision 8. The other gets conflict and refetches before deciding a new operation. |
| Success response lost | Identical retry finds committed receipt. |
| FTS/revision/audit/receipt write fails | Whole mutation rolls back. |
| Receipt expired after 90 days | Client must not auto-replay it. Reconcile live state and choose a new explicit action. |
| Purged memory receives an old retry within receipt retention | Retained write receipt yields `PURGED`; never recreate. Permanent tombstones reserve known memory IDs, but cannot identify expired save-operation IDs. |
| Identical purge retry | Original PurgeReceipt; no repeated deletion/tombstone. Changed purge payload rejects. |

Canonical hashing sorts object keys and unordered tags/aliases, normalizes strings consistently (CRLF to LF, title trim, Unicode normalization policy recorded), preserves meaningful body/evidence order, and excludes server-generated timestamps, attempt IDs and replay flags. Duplicate-key JSON is rejected before hashing. A reused operation ID with a changed expected revision is a different payload and must reject.

## 5. Search index

Use FTS5 with weighted title/body/tag/alias text. Current note ID, scope, lifecycle and canonical revision are joined from the source row. The index never contains the only copy of data. Migrations explicitly create/rebuild the virtual table and its synchronization mechanism. Tests compare FTS revision and current row after create/update/archive/purge/restore.

All result IDs, snippets, counts and relevance explanations are scoped before serialization. Permission filters cannot be postponed until after a global top-k result. FTS query grammar is constructed from escaped literal terms; prepared parameters alone do not neutralize FTS operators. A per-grant project default is not trusted as a substitute for the required project argument.

## 6. Retention, purge and recovery

| Data | Proposed retention |
|---|---|
| Current notes and revisions | Until owner purges; archive retains history. |
| Success receipt keys/results | 90 days; minimal purged receipt protects against retries during that period. |
| Audit metadata | 30 days; aggregate daily counts 90 days. |
| Deletion ledger | Indefinite until owner resets the whole service with explicit backup consequences; no content. |
| Abandoned import staging data | Purge after 24 hours. |
| Export lease | At most 10 minutes; explicit finish or failure release. |
| OAuth state | Maintained provider policy, independently documented; never in memory exports. |

Hard purge uses a separate owner-admin transaction, not the live-row revision-write protocol:

1. Admit the owner session and primary owner-active/epoch check; verify CSRF/Origin. Normalize/hash operation name, project, memory ID, typed title and expected revision. Check the stable owner-admin actor's scoped receipt first: identical purge returns its original PurgeReceipt; changed payload returns `IDEMPOTENCY_CONFLICT`.
2. In one D1 batch, insert a tombstone with a fresh mutation_attempt_id using `INSERT ... SELECT` from the authorized current row matching expected revision and typed title, and no live export lease. Purge may operate on an archived project because it is explicit owner administration.
3. Restrict every dependent delete/update to that newly inserted attempt-specific tombstone. Remove relations, revision content and FTS/alias material in validated foreign-key-safe order, then the current record and other content-bearing auxiliary data; mark prior retained write receipts for that memory purged. Do not rely on deferred constraints that the selected D1 schema has not established.
4. Insert a purge success audit and PurgeReceipt from the attempt-specific tombstone. The receipt stores the request hash and deletion result, not typed title or content. Assert the attempt-specific purge receipt exists using the same tail constraint technique; any failure rolls the entire batch back.
5. On uncertainty or concurrent uniqueness failure, re-read the scoped receipt before classifying the result. An already-purged ID without this matching purge receipt returns `PURGED`; no title lookup is needed for an identical acknowledged operation replay.

Test simultaneous purge/update, simultaneous identical purge, wrong title/revision, export barrier, lost response after commit, altered retry payload and retention cleanup. Tombstones reserve memory IDs indefinitely. Existing write/purge receipts protect their owner+actor+operation keys for the specified 90 days; do not claim recognition of arbitrary expired save operation IDs. Metadata-only audit may retain target ID and action. Do not claim erasure from old downloaded exports or provider point-in-time history. Restore must merge the newest deletion ledger before importing old records. If the latest ledger is missing, isolate the restore and ask the owner to review possible resurrection before promotion.

## 7. Portable backup and deletion-ledger format

Canonical export JSONL record types are `project`, `memory`, `revision`, `relation`, `deletion`. Memory/revision records include immutable actor ID/kind/client-label snapshots. OAuth secrets/grants/sessions, audit queries, operational attempt IDs, export/verification metadata and FTS are excluded. Exports include revision history and represent private data; the owner retains them encrypted. Import only accepts this schema in v1, rejects unknown record types, verifies all foreign-key/owner bounds, and cannot create a new owner account or authorize an imported historical actor.

```ts
type ExportRecordType = 'project' | 'memory' | 'revision' | 'relation' | 'deletion';
type Sha256 = string; // exactly 64 lowercase hexadecimal characters
type RecordCounts = Record<ExportRecordType, number>;

interface BackupFile {
  name: string; // chunk-000001.jsonl, increasing contiguous six-digit sequence
  bytes: number; // exact UTF-8 file length including terminating newlines
  record_count: number;
  record_counts: RecordCounts; // all five keys, including zero counts
  sha256: Sha256;
}

interface BackupManifest {
  schema_version: 1;
  export_version: 1;
  service_version: string;
  export_id: Id;
  captured_at: Instant;
  source_environment: string; // configured nonsecret label, <=80 code points
  owner_namespace: Id;
  snapshot_generation: number;
  deletion_generation: number;
  files: BackupFile[]; // authoritative archive/content iteration order
  record_counts: RecordCounts;
  total_bytes: number; // sum of files[].bytes, excludes manifest/ZIP overhead
}

interface LedgerFile {
  name: string; // same sequence convention as BackupFile
  bytes: number;
  record_count: number;
  sha256: Sha256;
}

interface LedgerManifest {
  schema_version: 1;
  ledger_version: 1;
  service_version: string;
  ledger_id: Id;
  captured_at: Instant;
  source_environment: string;
  owner_namespace: Id;
  deletion_generation: number; // captured inclusive committed sequence watermark
  files: LedgerFile[]; // ordered; contains only deletion records
  record_count: number;
  total_bytes: number;
}
```

All counts/byte totals/generations are nonnegative safe integers. `record_count` equals the sum of that file's type counts; manifest counts and byte totals equal the sums of file descriptors. Canonical JSON uses recursively sorted object keys and UTF-8 without BOM. Each JSONL line is `{type:<ExportRecordType>,data:<canonical record>}` followed by LF, including the last line. Canonical records use the corresponding table's stable data fields, retain owner/project IDs, and omit the excluded operational fields above. Every field and record-type schema is versioned and validated; unknown fields/types reject. File order is record type in the declaration order above, then each type's stable primary-key tuple in ascending order; revisions sort numerically within memory ID. A file may cross a type boundary, but records are never split across files. Pages become deterministic files of at most 100 records and 256 KiB each.

The archive is ZIP with stored entries only in v1. Its exact entry list is `manifest.json` followed by the ordered files, or `ledger-manifest.json` followed by ordered ledger files. Manifest JSON is canonical UTF-8 with one final LF; its SHA-256 is computed over those exact bytes and stored outside the manifest in completion metadata. No directories, absolute paths, separators, traversal, duplicate names, symlinks, encrypted ZIP entries, unlisted files or compressed entries are accepted. The archive and the sum of extracted manifest/content bytes must each be <=25 MiB; the manifest itself is <=256 KiB. Reject before marking complete if counts, archive overhead or the manifest exceed these bounds. The local verifier checks exact names/order, schema, byte counts and hashes before local encryption. Plain ZIP is the portable format; `age` encrypts it outside the application.

The deletion ledger is append-only within an owner namespace. Each committed purge receives a strictly increasing owner-scoped sequence in its transaction; `deletion_generation` is the highest included committed sequence, or zero for an empty ledger. `GET /api/admin/deletions/export` captures that watermark from primary D1 and serializes only immutable entries at or below it, in sequence order, under the same archive/chunk bounds. It may stream the bounded archive and must finish within ten minutes. Concurrent later purges cannot modify the captured ledger, so this read needs no canonical write barrier; the manifest reports its capture time/watermark and never claims to include later purges. Import validates source namespace and ledger checksum, merges tombstones from the backup and independently supplied ledger, and applies deletion knowledge before promotion. A checksum detects corruption; trusted owner custody and source confirmation establish provenance, not the checksum alone.

Write-barrier acquisition is serialized before export pagination; every canonical writer tests that barrier atomically. A deadline expires safely, but any export that crosses it fails and cannot be labeled consistent. Export cap is 25 MiB; each page <=256 KiB and <=100 records. Check total size before marking it complete, and do not retain full export contents in Worker memory. Local download assembles pages and verifies manifest. Rebuild FTS and compare canonical checksums in an isolated destination; only the owner can promote a restored environment.

An export's stable metadata records its owner, ID, snapshot generation, page descriptors, deadline and status. Finish atomically checks the matching unexpired lease, expected descriptors/counts and exact manifest digest, then sets `completed_at` and releases only that lease. Retries replay that committed finish metadata; failed or expired exports never gain a successful completion time. The owner may report local verification/encryption later through the authenticated verification-report endpoint. Persist the matched manifest digest, owner-reported local time, method and server recording time separately; identical report retries retain the first recording time. No service field attests that the local CLI ran or that an encrypted file still exists. Isolated import runs also have a maximum ten-minute active deadline; expiry cannot leave external MCP enabled on a partial destination, and abandoned staging data is removed within 24 hours.

The live FTS table is not dropped for backup. D1 documents unsupported raw exports when virtual tables exist, so `wrangler d1 export` is not the baseline backup command. [D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/).
