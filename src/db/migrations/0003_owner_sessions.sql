CREATE TABLE owner_sessions (
  session_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(owner_id),
  csrf TEXT NOT NULL,
  issued_epoch INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX owner_sessions_expiry ON owner_sessions(expires_at);
