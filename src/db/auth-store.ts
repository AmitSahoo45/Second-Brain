import type { AuthRequest } from '@cloudflare/workers-oauth-provider';
import type { AppConfig } from '../config';
import { HttpError, type AuthContext, type ProbeEnv } from '../auth/types';

export async function provisionOwner(db: D1Database, subject: string) {
  const now = new Date().toISOString();
  await db
    .prepare(
      'INSERT OR IGNORE INTO owners (owner_id, provider, provider_subject, admin_actor_id, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(crypto.randomUUID(), 'github', subject, crypto.randomUUID(), now)
    .run();
  const owner = await db
    .prepare(
      'SELECT owner_id, active, auth_epoch FROM owners WHERE provider_subject = ?',
    )
    .bind(subject)
    .first<{ owner_id: string; active: number; auth_epoch: number }>();
  if (!owner?.active) throw new HttpError(403, 'access_denied');
  await db
    .prepare(
      'INSERT OR IGNORE INTO projects (project_id, owner_id, name, normalized_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(
      crypto.randomUUID(),
      owner.owner_id,
      'Synthetic T01 probe',
      'synthetic-t01-probe',
      now,
      now,
    )
    .run();
  const project = await db
    .prepare(
      'SELECT project_id FROM projects WHERE owner_id = ? AND normalized_name = ? AND archived_at IS NULL',
    )
    .bind(owner.owner_id, 'synthetic-t01-probe')
    .first<{ project_id: string }>();
  if (!project) throw new HttpError(403, 'access_denied');
  return { ...owner, ...project };
}

export async function createGrant(
  db: D1Database,
  owner: string,
  project: string,
  request: AuthRequest,
  label: string,
) {
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        'INSERT INTO grants (grant_id, owner_id, client_id, client_label, scopes_json, issued_epoch, created_at) SELECT ?, owner_id, ?, ?, ?, auth_epoch, ? FROM owners WHERE owner_id = ? AND active = 1',
      )
      .bind(
        id,
        request.clientId,
        label,
        JSON.stringify(request.scope),
        new Date().toISOString(),
        owner,
      ),
    db
      .prepare(
        'INSERT INTO grant_projects (grant_id, owner_id, project_id) VALUES (?, ?, ?)',
      )
      .bind(id, owner, project),
  ]);
  return id;
}

export async function admitProbe(
  request: Request,
  env: ProbeEnv,
  config: AppConfig,
): Promise<AuthContext> {
  const token = request.headers
    .get('authorization')
    ?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!token || !env.OAUTH_PROVIDER) throw new HttpError(401, 'invalid_token');
  const summary = await env.OAUTH_PROVIDER.unwrapToken<{ actorId?: string }>(
    token,
  );
  if (
    !summary ||
    summary.audience !== config.resource ||
    !summary.scope.includes('memory:read') ||
    !summary.grant.props?.actorId
  )
    throw new HttpError(401, 'invalid_token');
  const id = summary.grant.props.actorId;
  await env.DB.prepare(
    'UPDATE grants SET provider_grant_id = ? WHERE grant_id = ? AND owner_id = ? AND client_id = ? AND provider_grant_id IS NULL AND revoked_at IS NULL',
  )
    .bind(summary.grantId, id, summary.userId, summary.grant.clientId)
    .run();
  const row = await env.DB.prepare(
    'SELECT g.owner_id, g.grant_id, g.client_label, g.scopes_json FROM grants g JOIN owners o ON o.owner_id = g.owner_id WHERE g.grant_id = ? AND g.provider_grant_id = ? AND g.client_id = ? AND g.owner_id = ? AND g.revoked_at IS NULL AND o.active = 1 AND o.provider_subject = ? AND o.auth_epoch = g.issued_epoch',
  )
    .bind(
      id,
      summary.grantId,
      summary.grant.clientId,
      summary.userId,
      config.ownerSubject,
    )
    .first<{
      owner_id: string;
      grant_id: string;
      client_label: string;
      scopes_json: string;
    }>();
  if (!row) throw new HttpError(401, 'invalid_token');
  const memberships = await env.DB.prepare(
    'SELECT gp.project_id FROM grant_projects gp JOIN projects p ON p.owner_id = gp.owner_id AND p.project_id = gp.project_id WHERE gp.owner_id = ? AND gp.grant_id = ? AND p.archived_at IS NULL',
  )
    .bind(row.owner_id, id)
    .all<{ project_id: string }>();
  const scopes = JSON.parse(row.scopes_json) as string[];
  return {
    owner_id: row.owner_id,
    actor_id: id,
    actor_kind: 'oauth_grant',
    actor_client_label: row.client_label,
    grant_id: id,
    provider_grant_id: summary.grantId,
    project_ids: memberships.results.map((item) => item.project_id),
    scopes: summary.scope.filter((scope) => scopes.includes(scope)),
  };
}
