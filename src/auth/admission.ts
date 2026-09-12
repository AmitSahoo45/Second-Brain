import type { AppConfig } from '../config';
import { loadConfig } from '../config';
import { admitProbe } from '../db/auth-store';
import { loadOwnerSession } from '../db/owner-session-store';
import { cookieValue } from './cookies';
import { hash } from './hash';
import {
  verifiedTokenContext,
  type VerifiedTokenSummary,
} from './token-context';
import {
  HttpError,
  type AuthContext,
  type OAuthGrantContext,
  type OwnerAdminContext,
  type ProbeEnv,
} from './types';

const grantIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function admitGrantedToken(
  summary: VerifiedTokenSummary,
  env: ProbeEnv,
  config: AppConfig,
): Promise<OAuthGrantContext> {
  try {
    return await admitProbe(summary, env, config);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(401, 'invalid_token');
  }
}

async function granted(request: Request, env: ProbeEnv): Promise<AuthContext> {
  const config = loadConfig(env as unknown as Record<string, unknown>);
  const token = request.headers
    .get('authorization')
    ?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!token || !env.OAUTH_PROVIDER) throw new HttpError(401, 'invalid_token');
  let unwrapped;
  try {
    unwrapped = await env.OAUTH_PROVIDER.unwrapToken(token);
  } catch {
    throw new HttpError(401, 'invalid_token');
  }
  if (!unwrapped || unwrapped.audience !== config.resource)
    throw new HttpError(401, 'invalid_token');
  return admitGrantedToken(
    await verifiedTokenContext(unwrapped.grant.props, request, env, config),
    env,
    config,
  );
}

export async function admitMcp(
  request: Request,
  env: ProbeEnv,
): Promise<AuthContext> {
  const auth = await granted(request, env);
  if (auth.actor_kind !== 'oauth_grant')
    throw new HttpError(401, 'invalid_token');
  return auth;
}

export async function admitAdmin(
  request: Request,
  env: ProbeEnv,
  mutation: boolean,
): Promise<OwnerAdminContext> {
  const config = loadConfig(env as unknown as Record<string, unknown>);
  const raw = cookieValue(request, 'owner_session');
  if (!raw) throw new HttpError(403, 'access_denied');
  let row;
  try {
    row = await loadOwnerSession(env.DB, await hash(raw), Date.now());
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(403, 'access_denied');
  }
  if (!row) throw new HttpError(403, 'access_denied');
  if (mutation) {
    if (
      request.headers.get('origin') !== config.origin ||
      request.headers.get('x-csrf-token') !== row.csrf
    )
      throw new HttpError(403, 'access_denied');
  }
  let projects;
  try {
    projects = await env.DB.prepare(
      'SELECT project_id FROM projects WHERE owner_id = ? AND archived_at IS NULL',
    )
      .bind(row.owner_id)
      .all<{ project_id: string }>();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(403, 'access_denied');
  }
  return {
    owner_id: row.owner_id,
    actor_id: row.admin_actor_id,
    actor_kind: 'owner_admin',
    actor_client_label: 'Owner admin',
    grant_id: null,
    project_ids: projects.results.map((item) => item.project_id),
    scopes: [],
  };
}

export async function revokeGrant(
  ctx: AuthContext,
  grantId: string,
  env: ProbeEnv,
): Promise<'revoked' | 'cleanup_pending'> {
  if (ctx.actor_kind !== 'owner_admin' || !grantIdPattern.test(grantId))
    throw new HttpError(403, 'access_denied');
  let row;
  try {
    row = await env.DB.prepare(
      'UPDATE grants SET revoked_at = ? WHERE grant_id = ? AND owner_id = ? AND revoked_at IS NULL RETURNING provider_grant_id',
    )
      .bind(new Date().toISOString(), grantId, ctx.owner_id)
      .first<{ provider_grant_id: string | null }>();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(403, 'access_denied');
  }
  if (!row) throw new HttpError(403, 'access_denied');
  if (!row.provider_grant_id) return 'revoked';
  if (!env.OAUTH_PROVIDER) return 'cleanup_pending';
  try {
    await env.OAUTH_PROVIDER.revokeGrant(row.provider_grant_id, ctx.owner_id);
  } catch {
    return 'cleanup_pending';
  }
  return 'revoked';
}
