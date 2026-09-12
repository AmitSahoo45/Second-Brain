CREATE TABLE mutation_receipts (
  owner_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('oauth_grant', 'owner_admin')),
  request_hash TEXT NOT NULL,
  mutation_attempt_id TEXT NOT NULL UNIQUE,
  result_kind TEXT NOT NULL CHECK (result_kind IN ('write', 'purge')),
  memory_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1 AND revision <= 9007199254740991),
  committed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  purged INTEGER NOT NULL DEFAULT 0 CHECK (purged IN (0, 1)),
  PRIMARY KEY (owner_id, actor_id, operation_id)
);
CREATE TABLE audit_events (
  event_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('oauth_grant', 'owner_admin')),
  project_id TEXT,
  target_id TEXT,
  operation TEXT NOT NULL,
  outcome TEXT NOT NULL,
  error_code TEXT,
  request_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  duration_ms INTEGER,
  db_statements INTEGER
);
CREATE INDEX audit_events_owner_time ON audit_events (owner_id, recorded_at);
CREATE TABLE deletion_ledger (
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  purged_at TEXT NOT NULL,
  purge_actor_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  mutation_attempt_id TEXT NOT NULL UNIQUE,
  deletion_sequence INTEGER NOT NULL,
  PRIMARY KEY (owner_id, project_id, memory_id),
  UNIQUE (owner_id, deletion_sequence)
);
CREATE TABLE maintenance_leases (
  owner_id TEXT PRIMARY KEY REFERENCES owners (owner_id),
  export_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  deadline INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE export_records (
  owner_id TEXT NOT NULL,
  export_id TEXT NOT NULL,
  snapshot_generation INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  deadline INTEGER NOT NULL,
  status TEXT NOT NULL,
  files_json TEXT NOT NULL,
  completed_at TEXT,
  manifest_sha256 TEXT,
  owner_reported_verified_at TEXT,
  verification_method TEXT,
  verification_recorded_at TEXT,
  PRIMARY KEY (owner_id, export_id)
);
CREATE TABLE import_runs (
  run_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners (owner_id),
  destination_generation INTEGER NOT NULL,
  manifest_digest TEXT NOT NULL,
  status TEXT NOT NULL,
  last_chunk INTEGER NOT NULL DEFAULT 0,
  deadline INTEGER NOT NULL,
  counts_json TEXT NOT NULL
);
CREATE TABLE write_assertions (
  attempt_id TEXT PRIMARY KEY,
  applied INTEGER NOT NULL CHECK (applied = 1)
);
