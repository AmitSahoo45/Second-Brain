import {
  canonicalJson,
  canonicalRequest,
  hashRequest,
} from '../domain/canonical';
import { validateNote } from '../domain/validation';
import type {
  AuthContext,
  NoteFields,
  Relation,
  WriteReceipt,
} from '../domain/types';

export interface MemoryCounts {
  current: number;
  revisions: number;
  fts: number;
  receipts: number;
}

export interface SeedMemoryInput {
  db: D1Database;
  auth: AuthContext;
  projectId: string;
  note: NoteFields;
}

function ftsText(values: string[]): string {
  return values.join(' ');
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

export async function seedMemory(
  input: SeedMemoryInput,
): Promise<WriteReceipt> {
  const note = validateNote(input.note);
  const memoryId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  const now = new Date();
  const committed = now.toISOString();
  const expires = new Date(
    now.getTime() + 90 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const fields = canonicalJson(note);
  const requestHash = await hashRequest(
    canonicalRequest('save_memory', input.projectId, {
      note,
      operation_id: operationId,
      project_id: input.projectId,
    }),
  );
  const inserted = await input.db
    .prepare(
      'INSERT INTO memories (memory_id, owner_id, project_id, revision, title, body, kind, lifecycle, provenance, fact_key, tags_json, aliases_json, evidence_json, related_json, valid_from, valid_until, created_at, updated_at, actor_id, actor_kind, actor_client_label, mutation_attempt_id) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      memoryId,
      input.auth.owner_id,
      input.projectId,
      note.title,
      note.body,
      note.kind,
      note.lifecycle,
      note.provenance,
      note.fact_key ?? null,
      JSON.stringify(note.tags),
      JSON.stringify(note.aliases),
      JSON.stringify(note.evidence),
      JSON.stringify(note.related),
      note.valid_from ?? null,
      note.valid_until ?? null,
      committed,
      committed,
      input.auth.actor_id,
      input.auth.actor_kind,
      input.auth.actor_client_label,
      attemptId,
    )
    .run();
  const rowid = inserted.meta.last_row_id;
  if (!rowid) throw new Error('memory insert failed');
  const statements = [
    input.db
      .prepare(
        'INSERT INTO memory_revisions (owner_id, project_id, memory_id, revision, fields_json, reason, recorded_at, actor_id, actor_kind, actor_client_label, mutation_attempt_id) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        input.auth.owner_id,
        input.projectId,
        memoryId,
        fields,
        'create: synthetic fixture',
        committed,
        input.auth.actor_id,
        input.auth.actor_kind,
        input.auth.actor_client_label,
        attemptId,
      ),
    input.db
      .prepare(
        'INSERT INTO memory_fts (rowid, title, body, tags, aliases) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(
        rowid,
        note.title,
        note.body,
        ftsText(note.tags),
        ftsText(note.aliases),
      ),
    input.db
      .prepare(
        'INSERT INTO mutation_receipts (owner_id, actor_id, operation_id, actor_kind, request_hash, mutation_attempt_id, result_kind, memory_id, project_id, revision, committed_at, expires_at, purged) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0)',
      )
      .bind(
        input.auth.owner_id,
        input.auth.actor_id,
        operationId,
        input.auth.actor_kind,
        requestHash,
        attemptId,
        'write',
        memoryId,
        input.projectId,
        committed,
        expires,
      ),
  ];
  for (const related of note.related) {
    statements.push(
      input.db
        .prepare(
          'INSERT INTO memory_relations (owner_id, project_id, source_memory_id, target_memory_id, relation) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(
          input.auth.owner_id,
          input.projectId,
          memoryId,
          related.memory_id,
          related.relation,
        ),
    );
  }
  await input.db.batch(statements);
  return {
    operation_id: operationId,
    memory_id: memoryId,
    project_id: input.projectId,
    revision: 1,
    committed_at: committed,
    replayed: false,
  };
}
