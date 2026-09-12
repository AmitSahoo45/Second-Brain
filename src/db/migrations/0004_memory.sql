CREATE TABLE memories (
  memory_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1 AND revision <= 9007199254740991),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fact', 'preference', 'decision', 'progress', 'next_step', 'question')),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('active', 'disputed', 'archived')),
  provenance TEXT NOT NULL CHECK (provenance IN ('user_stated', 'source_supported', 'inference', 'unverified')),
  fact_key TEXT,
  tags_json TEXT NOT NULL,
  aliases_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  related_json TEXT NOT NULL,
  valid_from TEXT,
  valid_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('oauth_grant', 'owner_admin')),
  actor_client_label TEXT NOT NULL,
  mutation_attempt_id TEXT NOT NULL UNIQUE,
  UNIQUE (owner_id, project_id, memory_id),
  FOREIGN KEY (owner_id, project_id) REFERENCES projects (owner_id, project_id)
);
CREATE UNIQUE INDEX memories_fact_key ON memories (owner_id, project_id, fact_key) WHERE fact_key IS NOT NULL;
CREATE INDEX memories_scope_lifecycle ON memories (owner_id, project_id, lifecycle, updated_at);
CREATE TABLE memory_revisions (
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1 AND revision <= 9007199254740991),
  fields_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('oauth_grant', 'owner_admin')),
  actor_client_label TEXT NOT NULL,
  mutation_attempt_id TEXT NOT NULL,
  PRIMARY KEY (memory_id, revision),
  FOREIGN KEY (owner_id, project_id, memory_id) REFERENCES memories (owner_id, project_id, memory_id)
);
CREATE INDEX memory_revisions_scope ON memory_revisions (owner_id, project_id, memory_id, revision);
CREATE TABLE memory_relations (
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  source_memory_id TEXT NOT NULL,
  target_memory_id TEXT NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN ('supports', 'contradicts', 'related_to')),
  PRIMARY KEY (owner_id, project_id, source_memory_id, target_memory_id, relation),
  FOREIGN KEY (owner_id, project_id, source_memory_id) REFERENCES memories (owner_id, project_id, memory_id),
  FOREIGN KEY (owner_id, project_id, target_memory_id) REFERENCES memories (owner_id, project_id, memory_id)
);
CREATE INDEX memory_relations_source ON memory_relations (owner_id, project_id, source_memory_id);
CREATE VIRTUAL TABLE memory_fts USING fts5(
  title,
  body,
  tags,
  aliases,
  tokenize='unicode61'
);
