import { readMemory, searchMemory } from '../db/search';
import { encodeToolResult } from '../mcp/response';
import { mcpToolResultWireBytes } from './encoding';
import { idPattern } from './validation';
import type {
  AuthContext,
  ContextInput,
  ContextItem,
  ContextPack,
  ErrorCode,
  MemoryRecord,
  Outcome,
  SearchCard,
} from './types';

export interface ContextCandidate {
  record: MemoryRecord;
  match_reason: SearchCard['match_reason'];
  from_profile: boolean;
  card: SearchCard;
}

export const defaultContextBudget = 8192;
export const minimumContextBudget = 2048;
export const maximumContextBudget = 16384;

const encoder = new TextEncoder();
const reservedRequestId = '00000000-0000-4000-8000-000000000001';

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

function stabilize(
  items: ContextItem[],
  truncated: boolean,
  profile_included: boolean,
): ContextPack {
  let used_bytes = 0;
  let pack: ContextPack = {
    items,
    used_bytes,
    truncated,
    profile_included,
  };
  for (let i = 0; i < 16; i++) {
    const next = encoder.encode(JSON.stringify(pack)).byteLength;
    if (next === used_bytes) return pack;
    used_bytes = next;
    pack = { items, used_bytes, truncated, profile_included };
  }
  return pack;
}

function encodedBytes(pack: ContextPack): number {
  return mcpToolResultWireBytes(
    encodeToolResult(
      { ok: true, data: pack, request_id: reservedRequestId },
      Number.MAX_SAFE_INTEGER,
    ),
  );
}

function fits(
  items: ContextItem[],
  truncated: boolean,
  profile_included: boolean,
  budget: number,
): boolean {
  return encodedBytes(stabilize(items, truncated, profile_included)) <= budget;
}

export function packContext(
  records: ContextCandidate[],
  budget: number,
): ContextPack {
  const items: ContextItem[] = [];
  let omitted = false;
  let profileIncluded = false;
  for (const candidate of records) {
    const full: ContextItem = {
      representation: 'full',
      record: candidate.record,
    };
    const excerpt: ContextItem = {
      representation: 'excerpt',
      card: candidate.card,
      expand_with: 'read_memory',
    };
    const nextProfile: boolean = profileIncluded || candidate.from_profile;
    if (fits([...items, full], false, nextProfile, budget)) {
      items.push(full);
      profileIncluded = nextProfile;
      continue;
    }
    if (fits([...items, excerpt], false, nextProfile, budget)) {
      items.push(excerpt);
      profileIncluded = nextProfile;
      continue;
    }
    omitted = true;
  }
  return stabilize(items, omitted, profileIncluded);
}

async function grantedProfileId(
  db: D1Database,
  ctx: AuthContext,
): Promise<string | undefined> {
  const ids = ctx.project_ids.filter((id) => idPattern.test(id));
  if (ids.length === 0) return undefined;
  const sql =
    ctx.actor_kind === 'oauth_grant'
      ? `SELECT p.project_id FROM projects p JOIN grant_projects gp ON gp.owner_id = p.owner_id AND gp.project_id = p.project_id JOIN grants g ON g.owner_id = gp.owner_id AND g.grant_id = gp.grant_id WHERE p.owner_id = ? AND p.is_profile = 1 AND p.archived_at IS NULL AND g.grant_id = ? AND g.revoked_at IS NULL AND p.project_id IN (${ids.map(() => '?').join(', ')}) LIMIT 1`
      : `SELECT p.project_id FROM projects p WHERE p.owner_id = ? AND p.is_profile = 1 AND p.archived_at IS NULL AND p.project_id IN (${ids.map(() => '?').join(', ')}) LIMIT 1`;
  const binds =
    ctx.actor_kind === 'oauth_grant'
      ? [ctx.owner_id, ctx.grant_id, ...ids]
      : [ctx.owner_id, ...ids];
  const row = await db
    .prepare(sql)
    .bind(...binds)
    .first<{ project_id: string }>();
  return row?.project_id;
}

function parseBudget(value: number | undefined): number {
  if (value === undefined) return defaultContextBudget;
  if (
    !Number.isSafeInteger(value) ||
    value < minimumContextBudget ||
    value > maximumContextBudget
  )
    throw new Error('invalid budget');
  return value;
}

async function candidatesFor(
  db: D1Database,
  ctx: AuthContext,
  projectId: string,
  query: string,
  hmacSecret: string,
  fromProfile: boolean,
): Promise<Outcome<{ candidates: ContextCandidate[]; truncated: boolean }>> {
  const found = await searchMemory(
    db,
    ctx,
    { project_id: projectId, query, limit: 20 },
    hmacSecret,
  );
  if (!found.ok) return found;
  const candidates: ContextCandidate[] = [];
  for (const card of found.data.items) {
    const read = await readMemory(db, ctx, {
      project_id: card.project_id,
      memory_id: card.memory_id,
    });
    if (!read.ok) continue;
    candidates.push({
      record: read.data.record,
      match_reason: card.match_reason,
      from_profile: fromProfile,
      card,
    });
  }
  return ok(found.request_id, {
    candidates,
    truncated: found.data.truncated,
  });
}

export async function buildContext(
  db: D1Database,
  ctx: AuthContext,
  input: ContextInput,
  hmacSecret: string,
): Promise<Outcome<ContextPack>> {
  const requestId = crypto.randomUUID();
  if (
    input.include_profile !== undefined &&
    typeof input.include_profile !== 'boolean'
  )
    return fail(requestId, 'VALIDATION_ERROR', 'invalid include_profile');
  let budget: number;
  try {
    budget = parseBudget(input.max_bytes);
  } catch {
    return fail(requestId, 'VALIDATION_ERROR', 'invalid max_bytes');
  }
  const primary = await candidatesFor(
    db,
    ctx,
    input.project_id,
    input.query,
    hmacSecret,
    false,
  );
  if (!primary.ok) return primary;
  const selected = await db
    .prepare(
      'SELECT archived_at FROM projects WHERE owner_id = ? AND project_id = ?',
    )
    .bind(ctx.owner_id, input.project_id)
    .first<{ archived_at: string | null }>();
  if (selected?.archived_at) {
    return ok(primary.request_id, packContext([], budget));
  }
  let truncated = primary.data.truncated;
  const candidates = primary.data.candidates;
  if (input.include_profile) {
    const profileId = await grantedProfileId(db, ctx);
    if (profileId && profileId === input.project_id) {
      for (const candidate of candidates) candidate.from_profile = true;
    } else if (profileId) {
      const extra = await candidatesFor(
        db,
        ctx,
        profileId,
        input.query,
        hmacSecret,
        true,
      );
      if (!extra.ok) return extra;
      truncated = truncated || extra.data.truncated;
      const seen = new Set(candidates.map((item) => item.record.memory_id));
      for (const candidate of extra.data.candidates) {
        if (seen.has(candidate.record.memory_id)) continue;
        candidates.push(candidate);
      }
    }
  }
  const pack = packContext(candidates, budget);
  return ok(
    primary.request_id,
    stabilize(pack.items, truncated || pack.truncated, pack.profile_included),
  );
}
