import { hash } from '../auth/hash';

const cleanupLimit = 4;
const lifetimeMs = 3600000;

export async function createOwnerSession(
  db: D1Database,
  ownerId: string,
  epoch: number,
  now: number,
) {
  const raw = crypto.randomUUID();
  const csrf = crypto.randomUUID();
  const results = await db.batch([
    db
      .prepare(
        'DELETE FROM owner_sessions WHERE rowid IN (SELECT rowid FROM owner_sessions WHERE expires_at <= ? ORDER BY expires_at LIMIT ?)',
      )
      .bind(now, cleanupLimit),
    db.prepare('DELETE FROM owner_sessions WHERE owner_id = ?').bind(ownerId),
    db
      .prepare(
        'INSERT INTO owner_sessions (session_hash, owner_id, csrf, issued_epoch, expires_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(await hash(raw), ownerId, csrf, epoch, now + lifetimeMs),
  ]);
  if (results[2]!.meta.changes !== 1) return null;
  return { raw, csrf };
}

export function loadOwnerSession(
  db: D1Database,
  sessionHash: string,
  now: number,
) {
  return db
    .prepare(
      'SELECT s.owner_id, s.csrf, o.admin_actor_id FROM owner_sessions s JOIN owners o ON o.owner_id = s.owner_id WHERE s.session_hash = ? AND s.expires_at > ? AND o.active = 1 AND o.auth_epoch = s.issued_epoch',
    )
    .bind(sessionHash, now)
    .first<{ owner_id: string; csrf: string; admin_actor_id: string }>();
}
