import { admitAdmin, revokeGrant } from '../auth/admission';
import { loadConfig } from '../config';
import { createMemoryService } from '../domain/memory-service';
import { parseBoundedJson } from '../domain/canonical';
import { idPattern } from '../domain/validation';
import { cookieValue } from '../auth/cookies';
import { hash } from '../auth/hash';
import { loadOwnerSession } from '../db/owner-session-store';
import { HttpError, type ProbeEnv } from '../auth/types';
import type { AuthContext, NoteFields, Outcome } from '../domain/types';
import { ownerStatus } from '../operations/status';
import {
  createAdminProject,
  listAdminProjects,
  patchAdminProject,
} from './projects';
import { listAdminGrants } from './grants';
import { adminShell, adminScript, adminStyles } from './shell';

const memoryPath = /^\/api\/admin\/memories\/([^/]+)(?:\/(history))?$/;
const projectPath = /^\/api\/admin\/projects\/([^/]+)$/;
const grantPath = /^\/api\/admin\/grants\/([^/]+)\/revoke$/;

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

function asDomain(ctx: {
  owner_id: string;
  actor_id: string;
  actor_kind: 'owner_admin';
  actor_client_label: string;
  grant_id: null;
  project_ids: readonly string[];
  scopes: readonly string[];
}): AuthContext {
  return {
    owner_id: ctx.owner_id,
    actor_id: ctx.actor_id,
    actor_kind: 'owner_admin',
    actor_client_label: ctx.actor_client_label,
    grant_id: null,
    project_ids: ctx.project_ids,
    scopes: ctx.scopes,
  };
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text) return {};
  const value = parseBoundedJson(text);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new HttpError(400, 'invalid_request');
  return value as Record<string, unknown>;
}

function outcome(result: Outcome<unknown>): Response {
  return json(result);
}

async function listMemories(
  env: ProbeEnv,
  ctx: AuthContext,
  projectId: string | null,
): Promise<
  Outcome<{
    items: {
      memory_id: string;
      title: string;
      kind: string;
      lifecycle: string;
      provenance: string;
      revision: number;
      updated_at: string;
    }[];
  }>
> {
  const requestId = crypto.randomUUID();
  if (
    !projectId ||
    !idPattern.test(projectId) ||
    !ctx.project_ids.includes(projectId)
  )
    return {
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'not found',
        retryable: false,
        request_id: requestId,
      },
    };
  const rows = await env.DB.prepare(
    'SELECT memory_id, title, kind, lifecycle, provenance, revision, updated_at FROM memories WHERE owner_id = ? AND project_id = ? ORDER BY updated_at DESC, memory_id ASC LIMIT 50',
  )
    .bind(ctx.owner_id, projectId)
    .all<{
      memory_id: string;
      title: string;
      kind: string;
      lifecycle: string;
      provenance: string;
      revision: number;
      updated_at: string;
    }>();
  return { ok: true, request_id: requestId, data: { items: rows.results } };
}

export async function handleAdminRoutes(
  request: Request,
  env: ProbeEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === '/admin' && request.method === 'GET')
    return adminShell();
  if (url.pathname === '/admin/app.css' && request.method === 'GET')
    return adminStyles();
  if (url.pathname === '/admin/app.js' && request.method === 'GET')
    return adminScript();
  if (!url.pathname.startsWith('/api/admin/')) return null;
  if (url.pathname === '/api/admin/session' && request.method === 'GET') {
    await admitAdmin(request, env, false);
    const raw = cookieValue(request, 'owner_session');
    const row = await loadOwnerSession(env.DB, await hash(raw), Date.now());
    if (!row) throw new HttpError(403, 'access_denied');
    return json({ csrf: row.csrf });
  }
  const config = loadConfig(env as unknown as Record<string, unknown>);
  const mutation = request.method !== 'GET';
  const admitted = await admitAdmin(request, env, mutation);
  const admin = asDomain(admitted);
  const service = createMemoryService(env.DB, config.hmacSecret);
  if (url.pathname === '/api/admin/projects' && request.method === 'GET')
    return outcome(await listAdminProjects(env.DB, admin));
  if (url.pathname === '/api/admin/projects' && request.method === 'POST') {
    const body = await readJson(request);
    const created: { name: unknown; is_profile?: unknown } = {
      name: body.name,
    };
    if (body.is_profile !== undefined) created.is_profile = body.is_profile;
    return outcome(await createAdminProject(env.DB, admin, created));
  }
  const project = url.pathname.match(projectPath);
  if (project && request.method === 'PATCH') {
    const body = await readJson(request);
    return outcome(await patchAdminProject(env.DB, admin, project[1]!, body));
  }
  if (url.pathname === '/api/admin/memories' && request.method === 'GET') {
    const query = url.searchParams.get('query');
    if (query)
      return outcome(
        await service.search(admin, {
          project_id: url.searchParams.get('project_id') ?? '',
          query,
        }),
      );
    return outcome(
      await listMemories(env, admin, url.searchParams.get('project_id')),
    );
  }
  if (url.pathname === '/api/admin/memories' && request.method === 'POST') {
    const body = await readJson(request);
    return outcome(
      await service.save(admin, {
        project_id: String(body.project_id ?? ''),
        note: body.note as NoteFields,
        operation_id: String(body.operation_id ?? ''),
      }),
    );
  }
  const memory = url.pathname.match(memoryPath);
  if (memory && memory[2] === 'history' && request.method === 'GET')
    return outcome(
      await service.history(admin, {
        project_id: url.searchParams.get('project_id') ?? '',
        memory_id: memory[1]!,
      }),
    );
  if (memory && !memory[2] && request.method === 'GET')
    return outcome(
      await service.read(admin, {
        project_id: url.searchParams.get('project_id') ?? '',
        memory_id: memory[1]!,
      }),
    );
  if (memory && !memory[2] && request.method === 'PUT') {
    const body = await readJson(request);
    return outcome(
      await service.update(admin, {
        project_id: String(body.project_id ?? ''),
        memory_id: memory[1]!,
        expected_revision: Number(body.expected_revision),
        note: body.note as NoteFields,
        reason: String(body.reason ?? ''),
        operation_id: String(body.operation_id ?? ''),
      }),
    );
  }
  if (url.pathname === '/api/admin/grants' && request.method === 'GET')
    return outcome(await listAdminGrants(env.DB, admin));
  const grant = url.pathname.match(grantPath);
  if (grant && request.method === 'POST') {
    const status = await revokeGrant(admitted, grant[1]!, env);
    return json({ status });
  }
  if (url.pathname === '/api/admin/status' && request.method === 'GET') {
    const counts = await env.DB.prepare(
      "SELECT COUNT(*) AS calls, SUM(CASE WHEN outcome != 'ok' THEN 1 ELSE 0 END) AS errors FROM audit_events WHERE owner_id = ?",
    )
      .bind(admin.owner_id)
      .first<{ calls: number; errors: number | null }>();
    return json(
      ownerStatus({
        version: '0.1.0',
        observed_calls: Number(counts?.calls ?? 0),
        observed_errors: Number(counts?.errors ?? 0),
      }),
    );
  }
  return new Response('Not found', {
    status: 404,
    headers: { 'cache-control': 'no-store' },
  });
}
