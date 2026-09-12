import type {
  AuthRequest,
  OAuthHelpers,
} from '@cloudflare/workers-oauth-provider';
import type { AppConfig } from '../config';
import { createGrant, provisionOwner } from '../db/auth-store';
import {
  consumeAuthFlow,
  consumeConsent,
  createAuthFlow,
  createConsent,
} from '../db/auth-flow-store';
import { createOwnerSession } from '../db/owner-session-store';
import { cookieValue, sessionCookie } from './cookies';
import { hash } from './hash';
import { HttpError, type ProbeEnv } from './types';
function escape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
}

// Probe diagnostics identify only a fixed dependency step, never exception data.
async function callbackStep<T>(
  stage:
    | 'state_consume'
    | 'token_fetch'
    | 'token_json'
    | 'identity_fetch'
    | 'identity_json'
    | 'owner_store',
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, `callback_${stage}_failed`);
  }
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
      const redirect = new URL(url.searchParams.get('redirect_uri') ?? '');
      if (redirect.username || redirect.password || redirect.hash)
        throw new Error('Invalid redirect grammar');
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
    if (
      !(await createAuthFlow(
        env.DB,
        state,
        await hash(browser),
        JSON.stringify(auth),
        Date.now(),
      ))
    )
      throw new HttpError(429, 'temporarily_unavailable');
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
    const flow = await callbackStep('state_consume', async () =>
      consumeAuthFlow(env.DB, state, await hash(browser), Date.now()),
    );
    if (!flow) throw new HttpError(400, 'invalid_request');
    const tokenResponse = await callbackStep('token_fetch', () =>
      fetch('https://github.com/login/oauth/access_token', {
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
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      }),
    );
    if (!tokenResponse.ok) throw new HttpError(403, 'access_denied');
    const token = await callbackStep('token_json', async () => {
      const parsed = (await tokenResponse.json()) as {
        access_token?: unknown;
      } | null;
      if (typeof parsed?.access_token !== 'string' || !parsed.access_token)
        throw new HttpError(403, 'access_denied');
      return parsed.access_token;
    });
    const identityResponse = await callbackStep('identity_fetch', () =>
      fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'shared-memory-probe',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      }),
    );
    // Upstream credentials remain only in this request's memory; never persisted.
    if (!identityResponse.ok) throw new HttpError(403, 'access_denied');
    await callbackStep('identity_json', async () => {
      const identity = (await identityResponse.json()) as {
        id?: unknown;
      } | null;
      if (
        typeof identity?.id !== 'number' ||
        !Number.isSafeInteger(identity.id) ||
        String(identity.id) !== config.ownerSubject
      )
        throw new HttpError(403, 'access_denied');
    });
    const owner = await callbackStep('owner_store', () =>
      provisionOwner(env.DB, config.ownerSubject),
    );
    const session = crypto.randomUUID();
    const csrf = crypto.randomUUID();
    if (
      !(await createConsent(
        env.DB,
        await hash(session),
        csrf,
        flow.request_json,
        owner.owner_id,
        owner.project_id,
        Date.now(),
      ))
    )
      throw new HttpError(429, 'temporarily_unavailable');
    const auth = JSON.parse(flow.request_json) as AuthRequest;
    const client = await api.lookupClient(auth.clientId);
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Authorize synthetic probe</title><h1>Authorize synthetic probe</h1><p>Client: ${escape(client?.clientName ?? auth.clientId)}</p><p>Project: Synthetic T01 probe (${escape(owner.project_id)})</p><p>Permissions: ${escape(auth.scope.join(', '))}</p><p>This experiment stores only synthetic test data.</p><form method="post" action="/oauth/consent"><input type="hidden" name="csrf" value="${csrf}"><button name="approve" value="yes">Approve</button><button name="approve" value="no">Deny</button></form></html>`;
    return new Response(html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'referrer-policy': 'strict-origin',
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
    const consent = await consumeConsent(
      env.DB,
      await hash(session),
      form.get('csrf')!,
      Date.now(),
    );
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
    let ownerSession: Awaited<ReturnType<typeof createOwnerSession>> = null;
    try {
      const owner = await env.DB.prepare(
        'SELECT auth_epoch FROM owners WHERE owner_id = ? AND active = 1',
      )
        .bind(consent.owner_id)
        .first<{ auth_epoch: number }>();
      ownerSession = owner
        ? await createOwnerSession(
            env.DB,
            consent.owner_id,
            owner.auth_epoch,
            Date.now(),
          )
        : null;
    } catch {
      ownerSession = null;
    }
    const destination = escape(completed.redirectTo);
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Authorization complete</title><meta http-equiv="refresh" content="0; URL=${destination}"><h1>Authorization complete</h1><p><a href="${destination}" rel="noreferrer">Continue to client</a></p></html>`;
    const headers = new Headers({
      'content-type': 'text/html; charset=utf-8',
      'referrer-policy': 'no-referrer',
      'content-security-policy':
        "default-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
      'set-cookie': sessionCookie('probe_consent', '', config, true),
    });
    if (ownerSession)
      headers.append(
        'set-cookie',
        sessionCookie('owner_session', ownerSession.raw, config, false, 3600),
      );
    return new Response(html, { headers });
  }
  return new Response('Not found', { status: 404 });
}
