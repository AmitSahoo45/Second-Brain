import { canonicalJson, hashRequest } from '../domain/canonical';
import { encodeMemoryRead, encodeToolOutcome } from '../domain/encoding';
import { idPattern } from '../domain/validation';
import type {
  AuthContext,
  ErrorCode,
  EvidenceRef,
  HistoryInput,
  Instant,
  Kind,
  Lifecycle,
  MemoryRecord,
  NoteFields,
  Outcome,
  ProjectCard,
  Provenance,
  ReadInput,
  SearchCard,
  SearchInput,
} from '../domain/types';

const maximumQueryCodePoints = 512;
const maximumTokens = 24;
const maximumSnippetCodePoints = 240;
const maximumCursorBytes = 2048;
const maximumFtsCandidates = 128;
const cursorTtlMs = 15 * 60 * 1000;
const encoder = new TextEncoder();
const kinds = new Set<Kind>([
  'fact',
  'preference',
  'decision',
  'progress',
  'next_step',
  'question',
]);

type Ranked = {
  group: number;
  score: number;
  updated_at: string;
  memory_id: string;
  card: SearchCard;
};

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
      retryable: code === 'STORAGE_UNAVAILABLE',
      request_id: requestId,
    },
  };
}

function ok<T>(requestId: string, data: T): Outcome<T> {
  return { ok: true, request_id: requestId, data };
}

function denied<T>(
  value: { archived: boolean } | Outcome<T>,
): value is Outcome<T> {
  return 'ok' in value;
}

function stripQuotes(token: string): string {
  if (token.length >= 2 && token.startsWith('"') && token.endsWith('"'))
    return token.slice(1, -1);
  return token;
}

function escapeFts(token: string): string {
  return `"${token.replaceAll('"', '""')}"`;
}

function parseQuery(query: unknown): {
  normalized: string;
  tokens: string[];
  fts: string;
} {
  if (typeof query !== 'string') throw new Error('invalid query');
  const normalized = query.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!normalized) throw new Error('invalid query');
  if ([...normalized].length > maximumQueryCodePoints)
    throw new Error('invalid query');
  const tokens = normalized.split(' ').map(stripQuotes).filter(Boolean);
  if (tokens.length === 0 || tokens.length > maximumTokens)
    throw new Error('invalid query');
  return {
    normalized,
    tokens,
    fts: tokens.map(escapeFts).join(' AND '),
  };
}

function parseLimit(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > max)
    throw new Error('invalid limit');
  return value;
}

function parseKinds(value: Kind[] | undefined): Kind[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0)
    throw new Error('invalid kinds');
  const selected: Kind[] = [];
  const seen = new Set<Kind>();
  for (const kind of value) {
    if (!kinds.has(kind) || seen.has(kind)) throw new Error('invalid kinds');
    seen.add(kind);
    selected.push(kind);
  }
  return selected;
}

function snippet(title: string, body: string, tokens: string[]): string {
  const haystack = `${title}\n${body}`;
  const lower = haystack.toLowerCase();
  let start = 0;
  for (const token of tokens) {
    const found = lower.indexOf(token.toLowerCase());
    if (found >= 0) {
      start = Math.max(0, found - 40);
      break;
    }
  }
  return [...haystack.slice(start)].slice(0, maximumSnippetCodePoints).join('');
}

function reasonOf(group: number): SearchCard['match_reason'] {
  if (group === 0) return 'fact_key';
  if (group === 1) return 'title';
  if (group === 2) return 'alias';
  return 'full_text';
}

function compare(left: Ranked, right: Ranked): number {
  if (left.group !== right.group) return left.group - right.group;
  if (left.score !== right.score) return left.score - right.score;
  if (left.updated_at !== right.updated_at)
    return left.updated_at < right.updated_at ? 1 : -1;
  if (left.memory_id === right.memory_id) return 0;
  return left.memory_id < right.memory_id ? -1 : 1;
}

async function cursorKey(
  ctx: AuthContext,
  kind: string,
  secret: string,
): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(
      `${secret}\0${kind}:${ctx.owner_id}:${ctx.actor_id}:${ctx.grant_id ?? 'admin'}`,
    ),
  );
  return crypto.subtle.importKey(
    'raw',
    material,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function b64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function unb64url(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/');
  const pad =
    padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function signCursor(
  ctx: AuthContext,
  kind: string,
  secret: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const body = canonicalJson({ ...payload, v: 1 });
  const mac = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      await cursorKey(ctx, kind, secret),
      encoder.encode(body),
    ),
  );
  const cursor = `${b64url(encoder.encode(body))}.${b64url(mac)}`;
  if (encoder.encode(cursor).byteLength > maximumCursorBytes)
    throw new Error('invalid cursor');
  return cursor;
}

async function readCursor(
  ctx: AuthContext,
  kind: string,
  secret: string,
  cursor: string | undefined,
): Promise<Record<string, unknown> | undefined> {
  if (cursor === undefined) return undefined;
  if (
    typeof cursor !== 'string' ||
    encoder.encode(cursor).byteLength > maximumCursorBytes
  )
    throw new Error('invalid cursor');
  const parts = cursor.split('.');
  if (parts.length !== 2) throw new Error('invalid cursor');
  let payload: string;
  let mac: Uint8Array;
  try {
    payload = new TextDecoder().decode(unb64url(parts[0] ?? ''));
    mac = unb64url(parts[1] ?? '');
  } catch {
    throw new Error('invalid cursor');
  }
  const good = await crypto.subtle.verify(
    'HMAC',
    await cursorKey(ctx, kind, secret),
    mac,
    encoder.encode(payload),
  );
  if (!good) throw new Error('invalid cursor');
  const data = JSON.parse(payload) as Record<string, unknown>;
  if (data.v !== 1 || typeof data.exp !== 'number' || data.exp <= Date.now())
    throw new Error('invalid cursor');
  return data;
}

async function admit(
  db: D1Database,
  ctx: AuthContext,
  requestId: string,
  projectId: string | null,
): Promise<{ archived: boolean } | Outcome<never>> {
  if (!ctx.scopes.includes('memory:read'))
    return fail(requestId, 'NOT_FOUND', 'not found');
  if (projectId !== null) {
    if (!idPattern.test(projectId) || !ctx.project_ids.includes(projectId))
      return fail(requestId, 'NOT_FOUND', 'not found');
  }
  const owner = await db
    .prepare('SELECT active FROM owners WHERE owner_id = ?')
    .bind(ctx.owner_id)
    .first<{ active: number }>();
  if (!owner?.active) return fail(requestId, 'NOT_FOUND', 'not found');
  if (ctx.actor_kind === 'oauth_grant') {
    if (projectId) {
      const grant = await db
        .prepare(
          'SELECT g.revoked_at FROM grants g JOIN grant_projects gp ON gp.owner_id = g.owner_id AND gp.grant_id = g.grant_id WHERE g.owner_id = ? AND g.grant_id = ? AND gp.project_id = ?',
        )
        .bind(ctx.owner_id, ctx.grant_id, projectId)
        .first<{ revoked_at: string | null }>();
      if (!grant || grant.revoked_at)
        return fail(requestId, 'NOT_FOUND', 'not found');
    } else {
      const grant = await db
        .prepare(
          'SELECT revoked_at FROM grants WHERE owner_id = ? AND grant_id = ?',
        )
        .bind(ctx.owner_id, ctx.grant_id)
        .first<{ revoked_at: string | null }>();
      if (!grant || grant.revoked_at)
        return fail(requestId, 'NOT_FOUND', 'not found');
    }
  }
  if (!projectId) return { archived: false };
  const project = await db
    .prepare(
      'SELECT archived_at FROM projects WHERE owner_id = ? AND project_id = ?',
    )
    .bind(ctx.owner_id, projectId)
    .first<{ archived_at: string | null }>();
  if (!project) return fail(requestId, 'NOT_FOUND', 'not found');
  return { archived: Boolean(project.archived_at) };
}

function scopeClause(
  selected: Kind[] | undefined,
  lifecycle: 'active' | 'disputed' | undefined,
): { sql: string; binds: unknown[] } {
  const binds: unknown[] = [];
  let sql = '';
  if (lifecycle) {
    sql += ' AND m.lifecycle = ?';
    binds.push(lifecycle);
  } else sql += " AND m.lifecycle IN ('active', 'disputed')";
  if (selected) {
    sql += ` AND m.kind IN (${selected.map(() => '?').join(', ')})`;
    binds.push(...selected);
  }
  return { sql, binds };
}

type MemoryRow = {
  memory_id: string;
  project_id: string;
  revision: number;
  title: string;
  body: string;
  kind: Kind;
  lifecycle: Lifecycle;
  provenance: Provenance;
  fact_key: string | null;
  tags_json: string;
  aliases_json: string;
  evidence_json: string;
  related_json: string;
  valid_from: string | null;
  valid_until: string | null;
  created_at: string;
  updated_at: string;
  actor_id: string;
  actor_kind: MemoryRecord['actor_kind'];
  actor_client_label: string;
};

function noteFromRow(row: MemoryRow): NoteFields {
  const note: NoteFields = {
    title: row.title,
    body: row.body,
    kind: row.kind,
    lifecycle: row.lifecycle,
    provenance: row.provenance,
    tags: JSON.parse(row.tags_json) as string[],
    aliases: JSON.parse(row.aliases_json) as string[],
    evidence: JSON.parse(row.evidence_json) as EvidenceRef[],
    related: JSON.parse(row.related_json) as NoteFields['related'],
  };
  if (row.fact_key) note.fact_key = row.fact_key;
  if (row.valid_from) note.valid_from = row.valid_from;
  if (row.valid_until) note.valid_until = row.valid_until;
  return note;
}

function recordOf(
  note: NoteFields,
  row: {
    memory_id: string;
    project_id: string;
    revision: number;
    created_at: string;
    updated_at: string;
    actor_id: string;
    actor_kind: MemoryRecord['actor_kind'];
    actor_client_label: string;
  },
): MemoryRecord {
  return {
    ...note,
    memory_id: row.memory_id,
    project_id: row.project_id,
    revision: row.revision,
    created_at: row.created_at,
    updated_at: row.updated_at,
    actor_id: row.actor_id,
    actor_kind: row.actor_kind,
    actor_client_label: row.actor_client_label,
  };
}

function toCard(
  row: {
    memory_id: string;
    project_id: string;
    revision: number;
    title: string;
    body: string;
    kind: Kind;
    lifecycle: Lifecycle;
    provenance: Provenance;
    updated_at: string;
    valid_from: string | null;
    valid_until: string | null;
    evidence_json: string;
    fact_key: string | null;
    aliases_json: string;
  },
  group: number,
  tokens: string[],
): SearchCard {
  const card: SearchCard = {
    memory_id: row.memory_id,
    project_id: row.project_id,
    revision: row.revision,
    title: row.title,
    snippet: snippet(row.title, row.body, tokens),
    snippet_is_excerpt: true,
    kind: row.kind,
    lifecycle: row.lifecycle,
    provenance: row.provenance,
    updated_at: row.updated_at,
    evidence: JSON.parse(row.evidence_json) as EvidenceRef[],
    match_reason: reasonOf(group),
  };
  if (row.valid_from) card.valid_from = row.valid_from;
  if (row.valid_until) card.valid_until = row.valid_until;
  return card;
}

function groupOf(
  row: { fact_key: string | null; title: string; aliases_json: string },
  query: string,
): number {
  if (row.fact_key === query) return 0;
  if (row.title === query) return 1;
  const aliases = JSON.parse(row.aliases_json) as string[];
  if (aliases.includes(query)) return 2;
  return 3;
}

function fitItems<T>(items: T[], envelope: (page: T[]) => unknown): T[] {
  let page = items;
  while (page.length > 0) {
    try {
      encodeToolOutcome(envelope(page));
      return page;
    } catch {
      page = page.slice(0, -1);
    }
  }
  encodeToolOutcome(envelope(page));
  return page;
}

export async function searchMemory(
  db: D1Database,
  ctx: AuthContext,
  input: SearchInput,
  hmacSecret: string,
): Promise<
  Outcome<{ items: SearchCard[]; truncated: boolean; next_cursor?: string }>
> {
  const requestId = crypto.randomUUID();
  const admitted = await admit(db, ctx, requestId, input.project_id);
  if (denied(admitted)) return admitted;
  let parsed;
  let selected: Kind[] | undefined;
  let limit: number;
  try {
    parsed = parseQuery(input.query);
    selected = parseKinds(input.kinds);
    limit = parseLimit(input.limit, 5, 20);
    if (
      input.lifecycle !== undefined &&
      input.lifecycle !== 'active' &&
      input.lifecycle !== 'disputed'
    )
      throw new Error('invalid lifecycle');
  } catch {
    return fail(requestId, 'VALIDATION_ERROR', 'invalid search');
  }
  const digest = await hashRequest(
    canonicalJson({
      kinds: selected ?? null,
      lifecycle: input.lifecycle ?? null,
      project_id: input.project_id,
      query: parsed.normalized,
    }),
  );
  let cursor;
  try {
    cursor = await readCursor(ctx, 'search', hmacSecret, input.cursor);
    if (
      cursor &&
      (cursor.digest !== digest || cursor.project_id !== input.project_id)
    )
      throw new Error('invalid cursor');
  } catch {
    return fail(requestId, 'VALIDATION_ERROR', 'invalid cursor');
  }
  if (admitted.archived) return ok(requestId, { items: [], truncated: false });
  const scope = scopeClause(selected, input.lifecycle);
  const exactSql = `SELECT m.memory_id, m.project_id, m.revision, m.title, m.body, m.kind, m.lifecycle, m.provenance, m.updated_at, m.valid_from, m.valid_until, m.evidence_json, m.fact_key, m.aliases_json FROM memories m WHERE m.owner_id = ? AND m.project_id = ?${scope.sql} AND (m.fact_key = ? OR m.title = ? OR EXISTS (SELECT 1 FROM json_each(m.aliases_json) AS a WHERE a.value = ?))`;
  const ftsSql = `SELECT m.memory_id, m.project_id, m.revision, m.title, m.body, m.kind, m.lifecycle, m.provenance, m.updated_at, m.valid_from, m.valid_until, m.evidence_json, m.fact_key, m.aliases_json, bm25(memory_fts, 10.0, 1.0, 3.0, 5.0) AS rank_score FROM memories m JOIN memory_fts ON memory_fts.rowid = m.rowid WHERE m.owner_id = ? AND m.project_id = ?${scope.sql} AND memory_fts MATCH ? ORDER BY rank_score ASC LIMIT ?`;
  type Hit = Parameters<typeof toCard>[0] & { rank_score?: number };
  let exact: { results: Hit[] };
  let fts: { results: Hit[] };
  try {
    exact = await db
      .prepare(exactSql)
      .bind(
        ctx.owner_id,
        input.project_id,
        ...scope.binds,
        parsed.normalized,
        parsed.normalized,
        parsed.normalized,
      )
      .all<Hit>();
    fts = await db
      .prepare(ftsSql)
      .bind(
        ctx.owner_id,
        input.project_id,
        ...scope.binds,
        parsed.fts,
        maximumFtsCandidates + 1,
      )
      .all<Hit>();
  } catch {
    return fail(requestId, 'STORAGE_UNAVAILABLE', 'storage unavailable');
  }
  const ftsOverflow = fts.results.length > maximumFtsCandidates;
  const ftsHits = ftsOverflow
    ? fts.results.slice(0, maximumFtsCandidates)
    : fts.results;
  const merged = new Map<string, Ranked>();
  for (const row of exact.results) {
    const group = groupOf(row, parsed.normalized);
    merged.set(row.memory_id, {
      group,
      score: 0,
      updated_at: row.updated_at,
      memory_id: row.memory_id,
      card: toCard(row, group, parsed.tokens),
    });
  }
  for (const row of ftsHits) {
    if (merged.has(row.memory_id)) continue;
    merged.set(row.memory_id, {
      group: 3,
      score: Number(row.rank_score ?? 0),
      updated_at: row.updated_at,
      memory_id: row.memory_id,
      card: toCard(row, 3, parsed.tokens),
    });
  }
  const ranked = [...merged.values()].sort(compare);
  const start = cursor
    ? ranked.findIndex(
        (item) =>
          compare(
            {
              group: Number(cursor.group),
              score: Number(cursor.score),
              updated_at: String(cursor.updated_at),
              memory_id: String(cursor.memory_id),
              card: item.card,
            },
            item,
          ) < 0,
      )
    : 0;
  const from = start < 0 ? ranked.length : start;
  const page = ranked.slice(from, from + limit + 1);
  const extra = page.length > limit;
  const reservedCursor = 'x'.repeat(maximumCursorBytes);
  const fitted = fitItems(extra ? page.slice(0, limit) : page, (rows) => ({
    items: rows.map((item) => item.card),
    truncated: true,
    next_cursor: reservedCursor,
  }));
  const dropped = fitted.length < (extra ? limit : page.length);
  const result: {
    items: SearchCard[];
    truncated: boolean;
    next_cursor?: string;
  } = {
    items: fitted.map((item) => item.card),
    truncated: extra || dropped || ftsOverflow,
  };
  const last = fitted.at(-1);
  if ((extra || dropped) && last) {
    result.next_cursor = await signCursor(ctx, 'search', hmacSecret, {
      digest,
      exp: Date.now() + cursorTtlMs,
      group: last.group,
      memory_id: last.memory_id,
      project_id: input.project_id,
      score: last.score,
      updated_at: last.updated_at,
    });
  }
  return ok(requestId, result);
}

export async function readMemory(
  db: D1Database,
  ctx: AuthContext,
  input: ReadInput,
): Promise<Outcome<{ record: MemoryRecord; historical: boolean }>> {
  const requestId = crypto.randomUUID();
  const admitted = await admit(db, ctx, requestId, input.project_id);
  if (denied(admitted)) return admitted;
  if (!idPattern.test(input.memory_id))
    return fail(requestId, 'VALIDATION_ERROR', 'invalid memory_id');
  if (input.revision !== undefined) {
    if (!Number.isSafeInteger(input.revision) || input.revision < 1)
      return fail(requestId, 'VALIDATION_ERROR', 'invalid revision');
  }
  const current = await db
    .prepare(
      'SELECT memory_id, project_id, revision, title, body, kind, lifecycle, provenance, fact_key, tags_json, aliases_json, evidence_json, related_json, valid_from, valid_until, created_at, updated_at, actor_id, actor_kind, actor_client_label FROM memories WHERE owner_id = ? AND project_id = ? AND memory_id = ?',
    )
    .bind(ctx.owner_id, input.project_id, input.memory_id)
    .first<MemoryRow>();
  if (!current) return fail(requestId, 'NOT_FOUND', 'not found');
  let record: MemoryRecord;
  let historical = false;
  if (input.revision === undefined || input.revision === current.revision) {
    record = recordOf(noteFromRow(current), current);
  } else {
    const revision = await db
      .prepare(
        'SELECT revision, fields_json, recorded_at, actor_id, actor_kind, actor_client_label FROM memory_revisions WHERE owner_id = ? AND project_id = ? AND memory_id = ? AND revision = ?',
      )
      .bind(ctx.owner_id, input.project_id, input.memory_id, input.revision)
      .first<{
        revision: number;
        fields_json: string;
        recorded_at: string;
        actor_id: string;
        actor_kind: MemoryRecord['actor_kind'];
        actor_client_label: string;
      }>();
    if (!revision) return fail(requestId, 'NOT_FOUND', 'not found');
    historical = true;
    record = recordOf(JSON.parse(revision.fields_json) as NoteFields, {
      memory_id: current.memory_id,
      project_id: current.project_id,
      revision: revision.revision,
      created_at: current.created_at,
      updated_at: revision.recorded_at,
      actor_id: revision.actor_id,
      actor_kind: revision.actor_kind,
      actor_client_label: revision.actor_client_label,
    });
  }
  try {
    encodeMemoryRead({ record, historical });
  } catch {
    return fail(requestId, 'RESPONSE_TOO_LARGE', 'read exceeds 24 KiB');
  }
  return ok(requestId, { record, historical });
}

export async function historyMemory(
  db: D1Database,
  ctx: AuthContext,
  input: HistoryInput,
): Promise<
  Outcome<{
    revisions: {
      revision: number;
      recorded_at: Instant;
      reason: string;
      provenance: Provenance;
    }[];
    next_before_revision?: number;
  }>
> {
  const requestId = crypto.randomUUID();
  const admitted = await admit(db, ctx, requestId, input.project_id);
  if (denied(admitted)) return admitted;
  if (!idPattern.test(input.memory_id))
    return fail(requestId, 'VALIDATION_ERROR', 'invalid memory_id');
  let limit: number;
  try {
    limit = parseLimit(input.limit, 10, 20);
    if (
      input.before_revision !== undefined &&
      (!Number.isSafeInteger(input.before_revision) ||
        input.before_revision < 1)
    )
      throw new Error('invalid revision');
  } catch {
    return fail(requestId, 'VALIDATION_ERROR', 'invalid history');
  }
  const exists = await db
    .prepare(
      'SELECT memory_id FROM memories WHERE owner_id = ? AND project_id = ? AND memory_id = ?',
    )
    .bind(ctx.owner_id, input.project_id, input.memory_id)
    .first();
  if (!exists) return fail(requestId, 'NOT_FOUND', 'not found');
  const before = input.before_revision ?? Number.MAX_SAFE_INTEGER + 1;
  const rows = await db
    .prepare(
      'SELECT revision, recorded_at, reason, fields_json FROM memory_revisions WHERE owner_id = ? AND project_id = ? AND memory_id = ? AND revision < ? ORDER BY revision DESC LIMIT ?',
    )
    .bind(ctx.owner_id, input.project_id, input.memory_id, before, limit + 1)
    .all<{
      revision: number;
      recorded_at: string;
      reason: string;
      fields_json: string;
    }>();
  const extra = rows.results.length > limit;
  const mapped = (extra ? rows.results.slice(0, limit) : rows.results).map(
    (row) => ({
      revision: row.revision,
      recorded_at: row.recorded_at,
      reason: row.reason,
      provenance: (JSON.parse(row.fields_json) as NoteFields).provenance,
    }),
  );
  const revisions = fitItems(mapped, (page) => ({
    revisions: page,
    next_before_revision: Number.MAX_SAFE_INTEGER,
  }));
  const dropped = revisions.length < mapped.length;
  const result: {
    revisions: typeof revisions;
    next_before_revision?: number;
  } = { revisions };
  const last = extra || dropped ? revisions.at(-1) : undefined;
  if (last) result.next_before_revision = last.revision;
  return ok(requestId, result);
}

export async function listProjects(
  db: D1Database,
  ctx: AuthContext,
  input: { cursor?: string; limit?: number },
  hmacSecret: string,
): Promise<Outcome<{ projects: ProjectCard[]; next_cursor?: string }>> {
  const requestId = crypto.randomUUID();
  const admitted = await admit(db, ctx, requestId, null);
  if (denied(admitted)) return admitted;
  let limit: number;
  let cursor;
  try {
    limit = parseLimit(input.limit, 20, 50);
    cursor = await readCursor(ctx, 'projects', hmacSecret, input.cursor);
  } catch {
    return fail(requestId, 'VALIDATION_ERROR', 'invalid cursor');
  }
  const ids = ctx.project_ids.filter((id) => idPattern.test(id));
  if (ids.length === 0) return ok(requestId, { projects: [] });
  const sql =
    ctx.actor_kind === 'oauth_grant'
      ? `SELECT p.project_id, p.name, p.is_profile FROM projects p JOIN grant_projects gp ON gp.owner_id = p.owner_id AND gp.project_id = p.project_id JOIN grants g ON g.owner_id = gp.owner_id AND g.grant_id = gp.grant_id WHERE p.owner_id = ? AND p.archived_at IS NULL AND g.grant_id = ? AND g.revoked_at IS NULL AND p.project_id IN (${ids.map(() => '?').join(', ')}) ORDER BY p.name ASC, p.project_id ASC`
      : `SELECT p.project_id, p.name, p.is_profile FROM projects p WHERE p.owner_id = ? AND p.archived_at IS NULL AND p.project_id IN (${ids.map(() => '?').join(', ')}) ORDER BY p.name ASC, p.project_id ASC`;
  const binds =
    ctx.actor_kind === 'oauth_grant'
      ? [ctx.owner_id, ctx.grant_id, ...ids]
      : [ctx.owner_id, ...ids];
  const rows = await db
    .prepare(sql)
    .bind(...binds)
    .all<{ project_id: string; name: string; is_profile: number }>();
  const cards: ProjectCard[] = rows.results.map((row) => ({
    project_id: row.project_id,
    name: row.name,
    is_profile: row.is_profile === 1,
  }));
  const start = cursor
    ? cards.findIndex((item) => {
        const name = String(cursor.name);
        const id = String(cursor.project_id);
        return item.name > name || (item.name === name && item.project_id > id);
      })
    : 0;
  const from = start < 0 ? cards.length : start;
  const page = cards.slice(from, from + limit + 1);
  const extra = page.length > limit;
  const reservedCursor = 'x'.repeat(maximumCursorBytes);
  const projects = fitItems(extra ? page.slice(0, limit) : page, (rows) => ({
    projects: rows,
    next_cursor: reservedCursor,
  }));
  const dropped = projects.length < (extra ? limit : page.length);
  const result: { projects: ProjectCard[]; next_cursor?: string } = {
    projects,
  };
  const last = projects.at(-1);
  if ((extra || dropped) && last) {
    result.next_cursor = await signCursor(ctx, 'projects', hmacSecret, {
      exp: Date.now() + cursorTtlMs,
      name: last.name,
      project_id: last.project_id,
    });
  }
  return ok(requestId, result);
}
