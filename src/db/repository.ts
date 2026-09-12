import type { Relation } from '../domain/types';

export interface MemoryCounts {
  current: number;
  revisions: number;
  fts: number;
  receipts: number;
}

export async function insertRelation(
  db: D1Database,
  ownerId: string,
  projectId: string,
  sourceMemoryId: string,
  targetMemoryId: string,
  relation: Relation,
): Promise<void> {
  const target = await db
    .prepare(
      'SELECT memory_id FROM memories WHERE owner_id = ? AND project_id = ? AND memory_id = ?',
    )
    .bind(ownerId, projectId, targetMemoryId)
    .first();
  if (!target) throw new Error('cross-project relation');
  await db
    .prepare(
      'INSERT INTO memory_relations (owner_id, project_id, source_memory_id, target_memory_id, relation) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(ownerId, projectId, sourceMemoryId, targetMemoryId, relation)
    .run();
}

export async function memoryCounts(
  db: D1Database,
  ownerId: string,
  memoryId: string,
): Promise<MemoryCounts> {
  const row = await db
    .prepare(
      'SELECT (SELECT COUNT(*) FROM memories WHERE owner_id = ? AND memory_id = ?) AS current, (SELECT COUNT(*) FROM memory_revisions WHERE owner_id = ? AND memory_id = ?) AS revisions, (SELECT COUNT(*) FROM memory_fts WHERE rowid = (SELECT rowid FROM memories WHERE owner_id = ? AND memory_id = ?)) AS fts, (SELECT COUNT(*) FROM mutation_receipts WHERE owner_id = ? AND memory_id = ?) AS receipts',
    )
    .bind(
      ownerId,
      memoryId,
      ownerId,
      memoryId,
      ownerId,
      memoryId,
      ownerId,
      memoryId,
    )
    .first<MemoryCounts>();
  if (!row) throw new Error('count query failed');
  return row;
}

export async function archiveProject(
  db: D1Database,
  ownerId: string,
  projectId: string,
): Promise<void> {
  const result = await db
    .prepare(
      'UPDATE projects SET archived_at = ?, revision = revision + 1 WHERE owner_id = ? AND project_id = ? AND archived_at IS NULL',
    )
    .bind(new Date().toISOString(), ownerId, projectId)
    .run();
  if (!result.meta.changes) throw new Error('archive failed');
}

export async function revokeGrantRow(
  db: D1Database,
  ownerId: string,
  grantId: string,
): Promise<void> {
  const result = await db
    .prepare(
      'UPDATE grants SET revoked_at = ? WHERE owner_id = ? AND grant_id = ? AND revoked_at IS NULL',
    )
    .bind(new Date().toISOString(), ownerId, grantId)
    .run();
  if (!result.meta.changes) throw new Error('revoke failed');
}
