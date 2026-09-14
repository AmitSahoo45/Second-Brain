import type { AuthContext, ErrorCode, Outcome } from '../domain/types';

export interface AdminGrant {
  grant_id: string;
  client_label: string;
  scopes: string[];
  project_ids: string[];
  revoked: boolean;
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
      retryable: false,
      request_id: requestId,
    },
  };
}

export async function listAdminGrants(
  db: D1Database,
  ctx: AuthContext,
): Promise<Outcome<{ grants: AdminGrant[] }>> {
  const requestId = crypto.randomUUID();
  if (ctx.actor_kind !== 'owner_admin')
    return fail(requestId, 'NOT_FOUND', 'not found');
  const grants = await db
    .prepare(
      'SELECT grant_id, client_label, scopes_json, revoked_at FROM grants WHERE owner_id = ? ORDER BY created_at ASC, grant_id ASC',
    )
    .bind(ctx.owner_id)
    .all<{
      grant_id: string;
      client_label: string;
      scopes_json: string;
      revoked_at: string | null;
    }>();
  const membership = await db
    .prepare(
      'SELECT grant_id, project_id FROM grant_projects WHERE owner_id = ?',
    )
    .bind(ctx.owner_id)
    .all<{ grant_id: string; project_id: string }>();
  const projects = new Map<string, string[]>();
  for (const row of membership.results) {
    const list = projects.get(row.grant_id) ?? [];
    list.push(row.project_id);
    projects.set(row.grant_id, list);
  }
  return {
    ok: true,
    request_id: requestId,
    data: {
      grants: grants.results.map((row) => ({
        grant_id: row.grant_id,
        client_label: row.client_label,
        scopes: JSON.parse(row.scopes_json) as string[],
        project_ids: projects.get(row.grant_id) ?? [],
        revoked: Boolean(row.revoked_at),
      })),
    },
  };
}
