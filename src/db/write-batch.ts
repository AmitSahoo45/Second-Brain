import {
  canonicalJson,
  canonicalRequest,
  hashRequest,
} from '../domain/canonical';
import { assertNoteFitsRead, maximumMemoryRevision } from '../domain/encoding';
import { idPattern, validateNote } from '../domain/validation';
import type {
  AuthContext,
  ErrorCode,
  ErrorInfo,
  NoteFields,
  Outcome,
  SaveInput,
  UpdateInput,
  WriteReceipt,
} from '../domain/types';

export type FailStage = 'revision' | 'fts' | 'audit' | 'receipt';

export type WriteFault = {
  before?(
    stage: FailStage,
    attemptId: string,
    db: D1Database,
  ): D1PreparedStatement | undefined;
};

export type MutationInput =
  | { operation: 'save'; value: SaveInput }
  | { operation: 'update'; value: UpdateInput };

const receiptMs = 90 * 24 * 60 * 60 * 1000;
const maximumReasonCodePoints = 500;
const uuid = idPattern;

function ftsText(values: string[]): string {
  return values.join(' ');
}

function retryable(code: ErrorCode): boolean {
  return (
    code === 'MAINTENANCE_RETRY' ||
    code === 'STORAGE_UNAVAILABLE' ||
    code === 'RATE_LIMITED'
  );
}

function fail(
  requestId: string,
  code: ErrorCode,
  message: string,
  extra: Partial<ErrorInfo> = {},
): Outcome<WriteReceipt> {
  const error: ErrorInfo = {
    code,
    message,
    retryable: retryable(code),
    request_id: requestId,
  };
  if (extra.current_revision !== undefined)
    error.current_revision = extra.current_revision;
  if (extra.retry_after_ms !== undefined)
    error.retry_after_ms = extra.retry_after_ms;
  return { ok: false, error };
}

function errorText(error: unknown): string {
  if (error instanceof Error)
    return `${error.message} ${String(error.cause ?? '')}`;
  return String(error);
}

function applyFault(
  db: D1Database,
  statements: D1PreparedStatement[],
  fault: WriteFault | undefined,
  name: FailStage,
  attemptId: string,
): void {
  const extra = fault?.before?.(name, attemptId, db);
  if (extra) statements.push(extra);
}

async function lookupReceipt(
  db: D1Database,
  ctx: AuthContext,
  operationId: string,
) {
  return db
    .prepare(
      'SELECT request_hash, result_kind, purged, memory_id, project_id, revision, committed_at, expires_at, operation_id FROM mutation_receipts WHERE owner_id = ? AND actor_id = ? AND operation_id = ?',
    )
    .bind(ctx.owner_id, ctx.actor_id, operationId)
    .first<{
      request_hash: string;
      result_kind: string;
      purged: number;
      memory_id: string;
      project_id: string;
      revision: number;
      committed_at: string;
      expires_at: string;
      operation_id: string;
    }>();
}

async function authorize(
  db: D1Database,
  ctx: AuthContext,
  projectId: string,
  requestId: string,
): Promise<Outcome<WriteReceipt> | null> {
  if (!uuid.test(projectId) || !ctx.project_ids.includes(projectId))
    return fail(requestId, 'NOT_FOUND', 'not found');
  if (!ctx.scopes.includes('memory:write'))
    return fail(requestId, 'NOT_FOUND', 'not found');
  if (ctx.actor_kind === 'oauth_grant') {
    const grant = await db
      .prepare(
        'SELECT g.revoked_at FROM grants g JOIN grant_projects gp ON gp.owner_id = g.owner_id AND gp.grant_id = g.grant_id WHERE g.owner_id = ? AND g.grant_id = ? AND gp.project_id = ?',
      )
      .bind(ctx.owner_id, ctx.grant_id, projectId)
      .first<{ revoked_at: string | null }>();
    if (!grant || grant.revoked_at)
      return fail(requestId, 'NOT_FOUND', 'not found');
  }
  const owner = await db
    .prepare('SELECT active FROM owners WHERE owner_id = ?')
    .bind(ctx.owner_id)
    .first<{ active: number }>();
  if (!owner?.active) return fail(requestId, 'NOT_FOUND', 'not found');
  return null;
}

async function relatedOk(
  db: D1Database,
  ctx: AuthContext,
  projectId: string,
  note: NoteFields,
  requestId: string,
): Promise<Outcome<WriteReceipt> | null> {
  for (const item of note.related) {
    const row = await db
      .prepare(
        'SELECT memory_id FROM memories WHERE owner_id = ? AND project_id = ? AND memory_id = ?',
      )
      .bind(ctx.owner_id, projectId, item.memory_id)
      .first();
    if (!row) return fail(requestId, 'NOT_FOUND', 'not found');
  }
  return null;
}

function classifyExisting(
  existing: NonNullable<Awaited<ReturnType<typeof lookupReceipt>>>,
  hash: string,
  now: number,
  requestId: string,
): Outcome<WriteReceipt> {
  if (new Date(existing.expires_at).getTime() <= now)
    return fail(requestId, 'VALIDATION_ERROR', 'operation_id expired');
  if (existing.request_hash !== hash)
    return fail(requestId, 'IDEMPOTENCY_CONFLICT', 'idempotency conflict');
  if (existing.purged || existing.result_kind !== 'write')
    return fail(requestId, 'PURGED', 'purged');
  return {
    ok: true,
    request_id: requestId,
    data: {
      operation_id: existing.operation_id,
      memory_id: existing.memory_id,
      project_id: existing.project_id,
      revision: existing.revision,
      committed_at: existing.committed_at,
      replayed: true,
    },
  };
}

async function classifyGuard(
  db: D1Database,
  ctx: AuthContext,
  input: MutationInput,
  now: number,
  requestId: string,
): Promise<Outcome<WriteReceipt>> {
  const projectId = input.value.project_id;
  const lease = await db
    .prepare(
      'SELECT deadline FROM maintenance_leases WHERE owner_id = ? AND deadline > ?',
    )
    .bind(ctx.owner_id, now)
    .first<{ deadline: number }>();
  if (lease) {
    return fail(requestId, 'MAINTENANCE_RETRY', 'maintenance', {
      retry_after_ms: Math.max(0, lease.deadline - now),
    });
  }
  const project = await db
    .prepare(
      'SELECT archived_at FROM projects WHERE owner_id = ? AND project_id = ?',
    )
    .bind(ctx.owner_id, projectId)
    .first<{ archived_at: string | null }>();
  if (!project) return fail(requestId, 'NOT_FOUND', 'not found');
  if (project.archived_at)
    return fail(requestId, 'PROJECT_ARCHIVED', 'project archived');
  if (input.operation === 'update') {
    const mem = await db
      .prepare(
        'SELECT revision FROM memories WHERE owner_id = ? AND project_id = ? AND memory_id = ?',
      )
      .bind(ctx.owner_id, projectId, input.value.memory_id)
      .first<{ revision: number }>();
    if (!mem) return fail(requestId, 'NOT_FOUND', 'not found');
    if (mem.revision !== input.value.expected_revision)
      return fail(requestId, 'REVISION_CONFLICT', 'revision conflict', {
        current_revision: mem.revision,
      });
  }
  return fail(requestId, 'STORAGE_UNAVAILABLE', 'write not applied');
}

export async function executeMutation(
  db: D1Database,
  ctx: AuthContext,
  input: MutationInput,
  fault?: WriteFault,
): Promise<Outcome<WriteReceipt>> {
  const requestId = crypto.randomUUID();
  const denied = await authorize(db, ctx, input.value.project_id, requestId);
  if (denied) return denied;
  if (!uuid.test(input.value.operation_id))
    return fail(requestId, 'VALIDATION_ERROR', 'invalid operation_id');
  let note: NoteFields;
  try {
    note = validateNote(input.value.note);
    assertNoteFitsRead(note);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid note';
    const code: ErrorCode = message.includes('RESPONSE_TOO_LARGE')
      ? 'RESPONSE_TOO_LARGE'
      : 'VALIDATION_ERROR';
    return fail(requestId, code, message);
  }
  if (input.operation === 'update') {
    if (!uuid.test(input.value.memory_id))
      return fail(requestId, 'VALIDATION_ERROR', 'invalid memory_id');
    if (
      !Number.isSafeInteger(input.value.expected_revision) ||
      input.value.expected_revision < 1
    )
      return fail(requestId, 'VALIDATION_ERROR', 'invalid revision');
    if (input.value.expected_revision >= maximumMemoryRevision)
      return fail(requestId, 'VALIDATION_ERROR', 'revision ceiling');
    const reason = input.value.reason.replaceAll('\r\n', '\n').trim();
    if (!reason || [...reason].length > maximumReasonCodePoints)
      return fail(requestId, 'VALIDATION_ERROR', 'invalid reason');
    input = {
      operation: 'update',
      value: { ...input.value, note, reason },
    };
  } else {
    input = { operation: 'save', value: { ...input.value, note } };
  }
  const hash = await hashRequest(
    canonicalRequest(
      input.operation === 'save' ? 'save_memory' : 'update_memory',
      input.value.project_id,
      input.value,
    ),
  );
  const now = Date.now();
  const committed = new Date(now).toISOString();
  const expires = new Date(now + receiptMs).toISOString();
  const existing = await lookupReceipt(db, ctx, input.value.operation_id);
  if (existing) return classifyExisting(existing, hash, now, requestId);
  const project = await db
    .prepare(
      'SELECT archived_at FROM projects WHERE owner_id = ? AND project_id = ?',
    )
    .bind(ctx.owner_id, input.value.project_id)
    .first<{ archived_at: string | null }>();
  if (!project) return fail(requestId, 'NOT_FOUND', 'not found');
  if (project.archived_at)
    return fail(requestId, 'PROJECT_ARCHIVED', 'project archived');
  const lease = await db
    .prepare(
      'SELECT deadline FROM maintenance_leases WHERE owner_id = ? AND deadline > ?',
    )
    .bind(ctx.owner_id, now)
    .first<{ deadline: number }>();
  if (lease)
    return fail(requestId, 'MAINTENANCE_RETRY', 'maintenance', {
      retry_after_ms: Math.max(0, lease.deadline - now),
    });
  const related = await relatedOk(
    db,
    ctx,
    input.value.project_id,
    note,
    requestId,
  );
  if (related) return related;
  if (input.operation === 'update') {
    const mem = await db
      .prepare(
        'SELECT revision FROM memories WHERE owner_id = ? AND project_id = ? AND memory_id = ?',
      )
      .bind(ctx.owner_id, input.value.project_id, input.value.memory_id)
      .first<{ revision: number }>();
    if (!mem) return fail(requestId, 'NOT_FOUND', 'not found');
    if (mem.revision !== input.value.expected_revision)
      return fail(requestId, 'REVISION_CONFLICT', 'revision conflict', {
        current_revision: mem.revision,
      });
  }
  const attemptId = crypto.randomUUID();
  const memoryId =
    input.operation === 'save' ? crypto.randomUUID() : input.value.memory_id;
  const fields = canonicalJson(note);
  const reason = input.operation === 'update' ? input.value.reason : 'create';
  const statements: D1PreparedStatement[] = [];
  if (input.operation === 'save') {
    statements.push(
      db
        .prepare(
          'INSERT INTO memories (memory_id, owner_id, project_id, revision, title, body, kind, lifecycle, provenance, fact_key, tags_json, aliases_json, evidence_json, related_json, valid_from, valid_until, created_at, updated_at, actor_id, actor_kind, actor_client_label, mutation_attempt_id) SELECT ?, p.owner_id, p.project_id, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM projects p WHERE p.owner_id = ? AND p.project_id = ? AND p.archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM maintenance_leases l WHERE l.owner_id = p.owner_id AND l.deadline > ?)',
        )
        .bind(
          memoryId,
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
          ctx.actor_id,
          ctx.actor_kind,
          ctx.actor_client_label,
          attemptId,
          ctx.owner_id,
          input.value.project_id,
          now,
        ),
    );
  } else {
    statements.push(
      db
        .prepare(
          'UPDATE memories SET revision = revision + 1, title = ?, body = ?, kind = ?, lifecycle = ?, provenance = ?, fact_key = ?, tags_json = ?, aliases_json = ?, evidence_json = ?, related_json = ?, valid_from = ?, valid_until = ?, updated_at = ?, actor_id = ?, actor_kind = ?, actor_client_label = ?, mutation_attempt_id = ? WHERE owner_id = ? AND project_id = ? AND memory_id = ? AND revision = ? AND EXISTS (SELECT 1 FROM projects p WHERE p.owner_id = memories.owner_id AND p.project_id = memories.project_id AND p.archived_at IS NULL) AND NOT EXISTS (SELECT 1 FROM maintenance_leases l WHERE l.owner_id = memories.owner_id AND l.deadline > ?)',
        )
        .bind(
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
          ctx.actor_id,
          ctx.actor_kind,
          ctx.actor_client_label,
          attemptId,
          ctx.owner_id,
          input.value.project_id,
          memoryId,
          input.value.expected_revision,
          now,
        ),
    );
  }
  applyFault(db, statements, fault, 'revision', attemptId);
  statements.push(
    db
      .prepare(
        'INSERT INTO memory_revisions (owner_id, project_id, memory_id, revision, fields_json, reason, recorded_at, actor_id, actor_kind, actor_client_label, mutation_attempt_id) SELECT owner_id, project_id, memory_id, revision, ?, ?, ?, actor_id, actor_kind, actor_client_label, mutation_attempt_id FROM memories WHERE mutation_attempt_id = ?',
      )
      .bind(fields, reason, committed, attemptId),
  );
  applyFault(db, statements, fault, 'fts', attemptId);
  statements.push(
    db
      .prepare(
        'DELETE FROM memory_fts WHERE rowid IN (SELECT rowid FROM memories WHERE mutation_attempt_id = ?)',
      )
      .bind(attemptId),
    db
      .prepare(
        'INSERT INTO memory_fts (rowid, title, body, tags, aliases) SELECT rowid, ?, ?, ?, ? FROM memories WHERE mutation_attempt_id = ?',
      )
      .bind(
        note.title,
        note.body,
        ftsText(note.tags),
        ftsText(note.aliases),
        attemptId,
      ),
    db
      .prepare(
        'DELETE FROM memory_relations WHERE owner_id = ? AND project_id = ? AND source_memory_id = ? AND EXISTS (SELECT 1 FROM memories WHERE mutation_attempt_id = ? AND memory_id = ?)',
      )
      .bind(
        ctx.owner_id,
        input.value.project_id,
        memoryId,
        attemptId,
        memoryId,
      ),
  );
  for (const item of note.related) {
    statements.push(
      db
        .prepare(
          'INSERT INTO memory_relations (owner_id, project_id, source_memory_id, target_memory_id, relation) SELECT m.owner_id, m.project_id, m.memory_id, t.memory_id, ? FROM memories m JOIN memories t ON t.owner_id = m.owner_id AND t.project_id = m.project_id AND t.memory_id = ? WHERE m.mutation_attempt_id = ?',
        )
        .bind(item.relation, item.memory_id, attemptId),
    );
  }
  applyFault(db, statements, fault, 'audit', attemptId);
  statements.push(
    db
      .prepare(
        'INSERT INTO audit_events (event_id, owner_id, actor_id, actor_kind, project_id, target_id, operation, outcome, request_id, recorded_at) SELECT ?, owner_id, actor_id, actor_kind, project_id, memory_id, ?, ?, ?, ? FROM memories WHERE mutation_attempt_id = ?',
      )
      .bind(
        crypto.randomUUID(),
        input.operation === 'save' ? 'save_memory' : 'update_memory',
        'ok',
        requestId,
        committed,
        attemptId,
      ),
  );
  applyFault(db, statements, fault, 'receipt', attemptId);
  statements.push(
    db
      .prepare(
        'INSERT INTO mutation_receipts (owner_id, actor_id, operation_id, actor_kind, request_hash, mutation_attempt_id, result_kind, memory_id, project_id, revision, committed_at, expires_at, purged) SELECT owner_id, actor_id, ?, actor_kind, ?, mutation_attempt_id, ?, memory_id, project_id, revision, ?, ?, 0 FROM memories WHERE mutation_attempt_id = ?',
      )
      .bind(
        input.value.operation_id,
        hash,
        'write',
        committed,
        expires,
        attemptId,
      ),
    db
      .prepare(
        'INSERT INTO write_assertions (attempt_id, applied) SELECT ?, EXISTS (SELECT 1 FROM mutation_receipts WHERE mutation_attempt_id = ?)',
      )
      .bind(attemptId, attemptId),
    db
      .prepare('DELETE FROM write_assertions WHERE attempt_id = ?')
      .bind(attemptId),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    const text = errorText(error);
    const again = await lookupReceipt(db, ctx, input.value.operation_id);
    if (again) return classifyExisting(again, hash, now, requestId);
    if (/UNIQUE/i.test(text) && /fact_key/i.test(text))
      return fail(requestId, 'FACT_KEY_EXISTS', 'fact key exists');
    if (/CHECK constraint failed/i.test(text))
      return classifyGuard(db, ctx, input, now, requestId);
    return fail(requestId, 'STORAGE_UNAVAILABLE', 'storage unavailable');
  }
  const saved = await db
    .prepare(
      'SELECT operation_id, memory_id, project_id, revision, committed_at FROM mutation_receipts WHERE mutation_attempt_id = ?',
    )
    .bind(attemptId)
    .first<{
      operation_id: string;
      memory_id: string;
      project_id: string;
      revision: number;
      committed_at: string;
    }>();
  if (!saved) return fail(requestId, 'STORAGE_UNAVAILABLE', 'missing receipt');
  return {
    ok: true,
    request_id: requestId,
    data: { ...saved, replayed: false },
  };
}
