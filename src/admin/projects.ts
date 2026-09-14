import type {
  AuthContext,
  ErrorCode,
  Outcome,
  ProjectCard,
} from '../domain/types';

const maximumNameCodePoints = 80;

export interface AdminProject extends ProjectCard {
  archived: boolean;
  revision: number;
}

function fail(
  requestId: string,
  code: ErrorCode,
  message: string,
): Outcome<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable: code === 'MAINTENANCE_RETRY' || code === 'STORAGE_UNAVAILABLE',
      request_id: requestId,
    },
  };
}

function ok<T>(requestId: string, data: T): Outcome<T> {
  return { ok: true, request_id: requestId, data };
}

function normalizeName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid name');
  const name = value.normalize('NFC').replaceAll('\r\n', '\n').trim();
  if (!name || [...name].length > maximumNameCodePoints)
    throw new Error('invalid name');
  return name;
}

async function blocked(
  db: D1Database,
  ctx: AuthContext,
  requestId: string,
): Promise<Outcome<never> | undefined> {
  const now = Date.now();
  const lease = await db
    .prepare(
      'SELECT deadline FROM maintenance_leases WHERE owner_id = ? AND deadline > ?',
    )
    .bind(ctx.owner_id, now)
    .first<{ deadline: number }>();
  if (lease) return fail(requestId, 'MAINTENANCE_RETRY', 'maintenance');
  return undefined;
}

export async function listAdminProjects(
  db: D1Database,
  ctx: AuthContext,
): Promise<Outcome<{ projects: AdminProject[] }>> {
  const requestId = crypto.randomUUID();
  const ids = ctx.project_ids;
  if (ids.length === 0) return ok(requestId, { projects: [] });
  const rows = await db
    .prepare(
      `SELECT project_id, name, is_profile, archived_at, revision FROM projects WHERE owner_id = ? AND project_id IN (${ids.map(() => '?').join(', ')}) ORDER BY name ASC, project_id ASC`,
    )
    .bind(ctx.owner_id, ...ids)
    .all<{
      project_id: string;
      name: string;
      is_profile: number;
      archived_at: string | null;
      revision: number;
    }>();
  return ok(requestId, {
    projects: rows.results.map((row) => ({
      project_id: row.project_id,
      name: row.name,
      is_profile: row.is_profile === 1,
      archived: Boolean(row.archived_at),
      revision: row.revision,
    })),
  });
}

export async function createAdminProject(
  db: D1Database,
  ctx: AuthContext,
  input: { name: unknown; is_profile?: unknown },
): Promise<Outcome<AdminProject>> {
  const requestId = crypto.randomUUID();
  const busy = await blocked(db, ctx, requestId);
  if (busy) return busy;
  let name: string;
  try {
    name = normalizeName(input.name);
  } catch {
    return fail(requestId, 'VALIDATION_ERROR', 'invalid name');
  }
  const profile = input.is_profile === true;
  if (profile) {
    const existing = await db
      .prepare(
        'SELECT project_id FROM projects WHERE owner_id = ? AND is_profile = 1',
      )
      .bind(ctx.owner_id)
      .first();
    if (existing) return fail(requestId, 'VALIDATION_ERROR', 'profile exists');
  }
  const now = new Date().toISOString();
  const projectId = crypto.randomUUID();
  try {
    const result = await db
      .prepare(
        'INSERT INTO projects (project_id, owner_id, name, normalized_name, is_profile, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        projectId,
        ctx.owner_id,
        name,
        name.toLowerCase(),
        profile ? 1 : 0,
        now,
        now,
      )
      .run();
    if (!result.meta.changes)
      return fail(requestId, 'STORAGE_UNAVAILABLE', 'create failed');
  } catch {
    return fail(requestId, 'VALIDATION_ERROR', 'name exists');
  }
  return ok(requestId, {
    project_id: projectId,
    name,
    is_profile: profile,
    archived: false,
    revision: 1,
  });
}

export async function patchAdminProject(
  db: D1Database,
  ctx: AuthContext,
  projectId: string,
  input: {
    expected_revision?: unknown;
    name?: unknown;
    archived?: unknown;
  },
): Promise<Outcome<AdminProject>> {
  const requestId = crypto.randomUUID();
  if (!ctx.project_ids.includes(projectId))
    return fail(requestId, 'NOT_FOUND', 'not found');
  const busy = await blocked(db, ctx, requestId);
  if (busy) return busy;
  if (
    typeof input.expected_revision !== 'number' ||
    !Number.isSafeInteger(input.expected_revision) ||
    input.expected_revision < 1
  )
    return fail(requestId, 'VALIDATION_ERROR', 'invalid revision');
  const current = await db
    .prepare(
      'SELECT name, is_profile, archived_at, revision FROM projects WHERE owner_id = ? AND project_id = ?',
    )
    .bind(ctx.owner_id, projectId)
    .first<{
      name: string;
      is_profile: number;
      archived_at: string | null;
      revision: number;
    }>();
  if (!current) return fail(requestId, 'NOT_FOUND', 'not found');
  if (current.revision !== input.expected_revision)
    return fail(requestId, 'REVISION_CONFLICT', 'revision conflict');
  let name = current.name;
  if (input.name !== undefined) {
    try {
      name = normalizeName(input.name);
    } catch {
      return fail(requestId, 'VALIDATION_ERROR', 'invalid name');
    }
  }
  let archivedAt = current.archived_at;
  if (input.archived === true) archivedAt = new Date().toISOString();
  if (input.archived === false) archivedAt = null;
  const now = new Date().toISOString();
  try {
    const result = await db
      .prepare(
        'UPDATE projects SET name = ?, normalized_name = ?, archived_at = ?, revision = revision + 1, updated_at = ? WHERE owner_id = ? AND project_id = ? AND revision = ?',
      )
      .bind(
        name,
        name.toLowerCase(),
        archivedAt,
        now,
        ctx.owner_id,
        projectId,
        input.expected_revision,
      )
      .run();
    if (!result.meta.changes)
      return fail(requestId, 'REVISION_CONFLICT', 'revision conflict');
  } catch {
    return fail(requestId, 'VALIDATION_ERROR', 'name exists');
  }
  return ok(requestId, {
    project_id: projectId,
    name,
    is_profile: current.is_profile === 1,
    archived: Boolean(archivedAt),
    revision: current.revision + 1,
  });
}
