// A personal probe admits at most eight pending flows/consents. Each admission
// removes at most four expired rows. LIMIT also bounds reads of older backlog.
const pendingLimit = 8;
const cleanupLimit = 4;

async function insertBounded(
  db: D1Database,
  table: 'probe_auth_flows' | 'probe_consents',
  values: readonly (string | number)[],
  now: number,
): Promise<boolean> {
  const results = await db.batch([
    db
      .prepare(
        `DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE expires_at <= ? ORDER BY expires_at LIMIT ?)`,
      )
      .bind(now, cleanupLimit),
    db
      .prepare(
        `INSERT INTO ${table} SELECT ${values.map(() => '?').join(', ')} WHERE (SELECT COUNT(*) FROM (SELECT 1 FROM ${table} LIMIT ?)) < ?`,
      )
      .bind(...values, pendingLimit, pendingLimit),
  ]);
  return results[1]!.meta.changes === 1;
}

export function createAuthFlow(
  db: D1Database,
  state: string,
  browserHash: string,
  requestJson: string,
  now: number,
): Promise<boolean> {
  return insertBounded(
    db,
    'probe_auth_flows',
    [state, browserHash, requestJson, now + 600000],
    now,
  );
}

export function consumeAuthFlow(
  db: D1Database,
  state: string,
  browserHash: string,
  now: number,
) {
  return db
    .prepare(
      'DELETE FROM probe_auth_flows WHERE state = ? AND browser_hash = ? AND expires_at > ? RETURNING request_json',
    )
    .bind(state, browserHash, now)
    .first<{ request_json: string }>();
}

export function createConsent(
  db: D1Database,
  sessionHash: string,
  csrf: string,
  requestJson: string,
  ownerId: string,
  projectId: string,
  now: number,
): Promise<boolean> {
  return insertBounded(
    db,
    'probe_consents',
    [sessionHash, csrf, requestJson, ownerId, projectId, now + 600000],
    now,
  );
}

export function consumeConsent(
  db: D1Database,
  sessionHash: string,
  csrf: string,
  now: number,
) {
  return db
    .prepare(
      'DELETE FROM probe_consents WHERE session_hash = ? AND csrf = ? AND expires_at > ? RETURNING request_json, owner_id, project_id',
    )
    .bind(sessionHash, csrf, now)
    .first<{ request_json: string; owner_id: string; project_id: string }>();
}
