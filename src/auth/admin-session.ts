import { HttpError, type ProbeEnv } from './types';
import { admitAdmin, revokeGrant } from './admission';
import { loadOwnerSession } from '../db/owner-session-store';
import { cookieValue } from './cookies';
import { hash } from './hash';

const grantPath = /^\/api\/admin\/grants\/([^/]+)\/revoke$/;

export async function handleAdminRequest(
  request: Request,
  env: ProbeEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/admin/')) return null;
  if (url.pathname === '/api/admin/session' && request.method === 'GET') {
    await admitAdmin(request, env, false);
    const raw = cookieValue(request, 'owner_session');
    const row = await loadOwnerSession(env.DB, await hash(raw), Date.now());
    if (!row) throw new HttpError(403, 'access_denied');
    return Response.json(
      { csrf: row.csrf },
      { headers: { 'cache-control': 'no-store' } },
    );
  }
  const match = url.pathname.match(grantPath);
  if (match && request.method === 'POST') {
    const admin = await admitAdmin(request, env, true);
    const status = await revokeGrant(admin, match[1]!, env);
    return Response.json(
      { status },
      { headers: { 'cache-control': 'no-store' } },
    );
  }
  return new Response('Not found', { status: 404 });
}
