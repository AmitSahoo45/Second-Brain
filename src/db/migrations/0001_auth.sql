CREATE TABLE owners (
  owner_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider = 'github'),
  provider_subject TEXT NOT NULL UNIQUE,
  admin_actor_id TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  auth_epoch INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE projects (
  project_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(owner_id),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  is_profile INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_id, normalized_name),
  UNIQUE (owner_id, project_id)
);
CREATE TABLE grants (
  grant_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(owner_id),
  provider_grant_id TEXT UNIQUE,
  client_id TEXT NOT NULL,
  client_label TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  issued_epoch INTEGER NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (owner_id, grant_id)
);
CREATE TABLE grant_projects (
  grant_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  PRIMARY KEY (grant_id, project_id),
  FOREIGN KEY (owner_id, grant_id) REFERENCES grants(owner_id, grant_id),
  FOREIGN KEY (owner_id, project_id) REFERENCES projects(owner_id, project_id)
);
CREATE TABLE probe_auth_flows (
  state TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  request_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE probe_consents (
  session_hash TEXT PRIMARY KEY,
  csrf TEXT NOT NULL,
  request_json TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES owners(owner_id),
  project_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE probe_values (
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  value TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (owner_id, project_id),
  FOREIGN KEY (owner_id, project_id) REFERENCES projects(owner_id, project_id)
);
