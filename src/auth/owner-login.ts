import type {
  AuthRequest,
  OAuthHelpers,
} from '@cloudflare/workers-oauth-provider';
import type { AppConfig } from '../config';
import { createGrant, provisionOwner } from '../db/auth-store';
import { HttpError, type ProbeEnv } from './types';

export async function hash(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}
function cookieValue(request: Request, name: string) {
  return (
    request.headers
      .get('cookie')
      ?.split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith(name + '='))
      ?.slice(name.length + 1) ?? ''
  );
}
function sessionCookie(
  name: string,
  value: string,
  config: AppConfig,
  expires = false,
) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${expires ? 0 : 600}${config.origin.startsWith('https:') ? '; Secure' : ''}`;
}
function escape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
}

export async function ownerLogin(
  request: Request,
  env: ProbeEnv,
  config: AppConfig,
  api: OAuthHelpers,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/authorize' && request.method === 'GET') {
    for (const key of url.searchParams.keys())
      if (url.searchParams.getAll(key).length !== 1)
        throw new HttpError(400, 'invalid_request');
    let auth: AuthRequest;
    try {
      auth = await api.parseAuthRequest(request);
    } catch {
      throw new HttpError(400, 'invalid_request');
    }
    if (
      auth.codeChallengeMethod !== 'S256' ||
      !auth.codeChallenge ||
      !/^[A-Za-z0-9_-]{43}$/.test(auth.codeChallenge) ||
      !auth.scope.includes('memory:read') ||
      auth.scope.some(
        (scope) => !['memory:read', 'memory:write'].includes(scope),
      )
    )
      throw new HttpError(400, 'invalid_request');
    const state = crypto.randomUUID();
    const browser = crypto.randomUUID();
    await env.DB.prepare('DELETE FROM probe_auth_flows WHERE expires_at <= ?')
      .bind(Date.now())
      .run();
    await env.DB.prepare('INSERT INTO probe_auth_flows VALUES (?, ?, ?, ?)')
      .bind(
        state,
        await hash(browser),
        JSON.stringify(auth),
        Date.now() + 600000,
      )
      .run();
    const github = new URL('https://github.com/login/oauth/authorize');
    github.search = new URLSearchParams({
      client_id: config.githubClientId,
      redirect_uri: config.origin + '/oauth/callback',
      state,
    }).toString();
    return new Response(null, {
      status: 302,
      headers: {
        location: github.href,
        'set-cookie': sessionCookie('probe_flow', browser, config),
      },
    });
  }
  if (url.pathname === '/oauth/callback' && request.method === 'GET') {
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const browser = cookieValue(request, 'probe_flow');
    if (
      !state ||
      !code ||
      !browser ||
      url.searchParams.getAll('state').length !== 1 ||
      url.searchParams.getAll('code').length !== 1
    )
      throw new HttpError(400, 'invalid_request');
    const flow = await env.DB.prepare(
      'DELETE FROM probe_auth_flows WHERE state = ? AND browser_hash = ? AND expires_at > ? RETURNING request_json',
    )
      .bind(state, await hash(browser), Date.now())
      .first<{ request_json: string }>();
    if (!flow) throw new HttpError(400, 'invalid_request');
    const tokenResponse = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: config.githubClientId,
          client_secret: config.githubClientSecret,
          code,
          redirect_uri: config.origin + '/oauth/callback',
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!tokenResponse.ok) throw new HttpError(403, 'access_denied');
    const token = (await tokenResponse.json()) as { access_token?: unknown };
    if (typeof token.access_token !== 'string' || !token.access_token)
      throw new HttpError(403, 'access_denied');
    const identityResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'shared-memory-probe',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    // Upstream credentials remain only in this request's memory; never persisted.
    if (!identityResponse.ok) throw new HttpError(403, 'access_denied');
    const identity = (await identityResponse.json()) as { id?: unknown };
    if (
      typeof identity.id !== 'number' ||
      !Number.isSafeInteger(identity.id) ||
      String(identity.id) !== config.ownerSubject
    )
      throw new HttpError(403, 'access_denied');
    const owner = await provisionOwner(env.DB, config.ownerSubject);
    const session = crypto.randomUUID();
    const csrf = crypto.randomUUID();
    await env.DB.prepare('DELETE FROM probe_consents WHERE expires_at <= ?')
      .bind(Date.now())
      .run();
    await env.DB.prepare('INSERT INTO probe_consents VALUES (?, ?, ?, ?, ?, ?)')
      .bind(
        await hash(session),
        csrf,
        flow.request_json,
        owner.owner_id,
        owner.project_id,
        Date.now() + 600000,
      )
      .run();
    const auth = JSON.parse(flow.request_json) as AuthRequest;
    const client = await api.lookupClient(auth.clientId);
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Authorize synthetic probe</title><h1>Authorize synthetic probe</h1><p>Client: ${escape(client?.clientName ?? auth.clientId)}</p><p>Project: Synthetic T01 probe (${escape(owner.project_id)})</p><p>Permissions: ${escape(auth.scope.join(', '))}</p><p>This experiment stores only synthetic test data.</p><form method="post" action="/oauth/consent"><input type="hidden" name="csrf" value="${csrf}"><button name="approve" value="yes">Approve</button><button name="approve" value="no">Deny</button></form></html>`;
    return new Response(html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'set-cookie': sessionCookie('probe_consent', session, config),
        'content-security-policy':
          "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      },
    });
  }
  if (url.pathname === '/oauth/consent' && request.method === 'POST') {
    if (
      request.headers.get('origin') !== config.origin ||
      !request.headers
        .get('content-type')
        ?.startsWith('application/x-www-form-urlencoded')
    )
      throw new HttpError(403, 'access_denied');
    const session = cookieValue(request, 'probe_consent');
    const form = new URLSearchParams(
      new TextDecoder().decode(await request.arrayBuffer()),
    );
    if (
      !session ||
      form.getAll('csrf').length !== 1 ||
      form.getAll('approve').length !== 1
    )
      throw new HttpError(403, 'access_denied');
    const consent = await env.DB.prepare(
      'DELETE FROM probe_consents WHERE session_hash = ? AND csrf = ? AND expires_at > ? RETURNING *',
    )
      .bind(await hash(session), form.get('csrf'), Date.now())
      .first<{ request_json: string; owner_id: string; project_id: string }>();
    if (!consent || form.get('approve') !== 'yes')
      throw new HttpError(403, 'access_denied');
    const auth = JSON.parse(consent.request_json) as AuthRequest;
    const client = await api.lookupClient(auth.clientId);
    if (!client) throw new HttpError(400, 'invalid_request');
    const label = Array.from(client.clientName ?? 'Preregistered client')
      .slice(0, 80)
      .join('');
    const actorId = await createGrant(
      env.DB,
      consent.owner_id,
      consent.project_id,
      auth,
      label,
    );
    const completed = await api.completeAuthorization({
      request: auth,
      userId: consent.owner_id,
      scope: auth.scope,
      metadata: { actorId },
      props: { actorId },
    });
    return new Response(null, {
      status: 302,
      headers: {
        location: completed.redirectTo,
        'set-cookie': sessionCookie('probe_consent', '', config, true),
      },
    });
  }
  return new Response('Not found', { status: 404 });
}
