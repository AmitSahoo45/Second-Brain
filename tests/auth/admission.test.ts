import { env } from 'cloudflare:workers';
import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { getOAuthApi } from '@cloudflare/workers-oauth-provider';
import { beforeAll, expect, test } from 'vitest';
import { admitAdmin, admitMcp, revokeGrant } from '../../src/auth/admission';
import { providerOptions } from '../../src/auth/provider';
import { registrationPolicy } from '../../src/auth/registration';
import { HttpError, type ProbeEnv } from '../../src/auth/types';
import { loadConfig } from '../../src/config';
import { createGrant, provisionOwner } from '../../src/db/auth-store';
import { createOwnerSession } from '../../src/db/owner-session-store';
import { ProbeStore } from '../../src/db/probe-store';
import probe from '../../src/probe';
import migration from '../../src/db/migrations/0001_auth.sql?raw';
import boundsMigration from '../../src/db/migrations/0002_probe_auth_bounds.sql?raw';
import sessionMigration from '../../src/db/migrations/0003_owner_sessions.sql?raw';

const fixtureEnv = {
  ...env,
  APP_ENV: 'local',
  MCP_RESOURCE_URL: 'http://127.0.0.1:8787/mcp',
  GITHUB_OWNER_ID: '123456789',
  GITHUB_CLIENT_ID: 'synthetic-client',
  GITHUB_CLIENT_SECRET: 'synthetic-secret',
};
const config = loadConfig(fixtureEnv);
const redirectUri = 'https://client.example/callback';
const verifier = 'A'.repeat(64);
let challenge: string;

beforeAll(async () => {
  for (const statement of (migration + boundsMigration + sessionMigration)
    .split(';')
    .map((value) => value.trim())
    .filter(Boolean))
    await env.DB.prepare(statement).run();
  challenge = btoa(
    String.fromCharCode(
      ...new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(verifier),
        ),
      ),
    ),
  )
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
});

async function dispatch(request: Request) {
  const ctx = createExecutionContext();
  const response = await probe.fetch(request, fixtureEnv, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function makeAuthFixture() {
  const api = getOAuthApi(providerOptions(config), fixtureEnv);
  const boundEnv = { ...fixtureEnv, OAUTH_PROVIDER: api };
  const client = await api.createClient({
    clientName: 'Synthetic admission fixture',
    redirectUris: [redirectUri],
    tokenEndpointAuthMethod: 'none',
    grantTypes: ['authorization_code', 'refresh_token'],
    responseTypes: ['code'],
  });
  const owner = await provisionOwner(env.DB, config.ownerSubject);
  const authRequest = {
    clientId: client.clientId,
    redirectUri,
    responseType: 'code',
    scope: ['memory:read', 'memory:write'],
    state: 'synthetic-admission-state',
    codeChallenge: challenge,
    codeChallengeMethod: 'S256',
    resource: config.resource,
  };
  const grantId = await createGrant(
    env.DB,
    owner.owner_id,
    owner.project_id,
    authRequest,
    'Synthetic',
  );
  const authorization = await api.completeAuthorization({
    request: authRequest,
    userId: owner.owner_id,
    metadata: {},
    scope: authRequest.scope,
    props: { actorId: grantId },
  });
  const tokenResponse = await dispatch(
    new Request(config.origin + '/oauth/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: client.clientId,
        redirect_uri: redirectUri,
        code: new URL(authorization.redirectTo).searchParams.get('code')!,
        code_verifier: verifier,
        resource: config.resource,
      }),
    }),
  );
  expect(tokenResponse.status).toBe(200);
  const tokens = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token: string;
  };
  const session = await createOwnerSession(
    env.DB,
    owner.owner_id,
    owner.auth_epoch,
    Date.now(),
  );
  expect(session).toBeTruthy();
  const adminRequest = () =>
    new Request(config.origin + '/api/admin/session', {
      headers: { cookie: `owner_session=${session!.raw}` },
    });
  const admin = await admitAdmin(adminRequest(), boundEnv, false);
  return {
    admin,
    grantId,
    env: boundEnv,
    projectId: owner.project_id,
    ownerId: owner.owner_id,
    session: session!,
    tokens,
    clientId: client.clientId,
    request: () =>
      new Request(config.resource, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Host: '127.0.0.1:8787',
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'probe_read',
            arguments: { project_id: owner.project_id },
          },
        }),
      }),
  };
}

test('registration policy keeps DCR and CIMD disabled', () => {
  expect(registrationPolicy).toEqual({
    dynamicClientRegistration: false,
    clientIdMetadataDocument: false,
  });
  expect(providerOptions(config).clientIdMetadataDocumentEnabled).toBe(false);
});

test('a committed revoke denies a newly admitted request', async () => {
  const f = await makeAuthFixture();
  await revokeGrant(f.admin, f.grantId, f.env);
  await expect(admitMcp(f.request(), f.env)).rejects.toMatchObject({
    status: 401,
  });
});

test('a request admitted before revoke may finish and new admits fail', async () => {
  const f = await makeAuthFixture();
  const admitted = await admitMcp(f.request(), f.env);
  const store = new ProbeStore(env.DB, admitted);
  await revokeGrant(f.admin, f.grantId, f.env);
  await expect(store.read(f.projectId)).resolves.toMatchObject({
    revision: 0,
  });
  await expect(admitMcp(f.request(), f.env)).rejects.toMatchObject({
    status: 401,
  });
});

test('MCP bearer cannot construct owner-admin admission', async () => {
  const f = await makeAuthFixture();
  await expect(admitAdmin(f.request(), f.env, false)).rejects.toMatchObject({
    status: 403,
  });
});

test('admin cookie cannot authenticate MCP admission', async () => {
  const f = await makeAuthFixture();
  const request = new Request(config.resource, {
    method: 'POST',
    headers: { cookie: `owner_session=${f.session.raw}` },
  });
  await expect(admitMcp(request, f.env)).rejects.toMatchObject({ status: 401 });
  expect((await dispatch(request)).status).toBe(401);
});

test('injected D1 failure during admission denies a KV-valid token', async () => {
  const f = await makeAuthFixture();
  const failing = {
    ...f.env,
    DB: {
      prepare() {
        throw new Error('synthetic d1 failure');
      },
    },
  } as unknown as ProbeEnv;
  await expect(admitMcp(f.request(), failing)).rejects.toMatchObject({
    status: 401,
  });
});

test('denied admin callers get a generic deny without grant enumeration', async () => {
  const f = await makeAuthFixture();
  const response = await dispatch(
    new Request(config.origin + `/api/admin/grants/${f.grantId}/revoke`, {
      method: 'POST',
      headers: {
        origin: config.origin,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ csrf: f.session.csrf }),
    }),
  );
  expect(response.status).toBe(403);
  const body = await response.text();
  expect(body).toContain('access_denied');
  expect(body).not.toContain(f.grantId);
  expect(body).not.toContain(f.projectId);
});

test('owner-admin revoke requires CSRF and exact Origin', async () => {
  const f = await makeAuthFixture();
  const path = config.origin + `/api/admin/grants/${f.grantId}/revoke`;
  const cookie = `owner_session=${f.session.raw}`;
  expect(
    (
      await dispatch(
        new Request(path, {
          method: 'POST',
          headers: {
            origin: 'https://evil.example',
            cookie,
            'x-csrf-token': f.session.csrf,
          },
        }),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await dispatch(
        new Request(path, {
          method: 'POST',
          headers: { origin: config.origin, cookie, 'x-csrf-token': 'wrong' },
        }),
      )
    ).status,
  ).toBe(403);
  const admitted = await admitMcp(f.request(), f.env);
  expect(admitted.actor_kind).toBe('oauth_grant');
});

test('admin session plus CSRF Origin revoke blocks subsequent MCP admits', async () => {
  const f = await makeAuthFixture();
  const response = await dispatch(
    new Request(config.origin + `/api/admin/grants/${f.grantId}/revoke`, {
      method: 'POST',
      headers: {
        origin: config.origin,
        cookie: `owner_session=${f.session.raw}`,
        'x-csrf-token': f.session.csrf,
      },
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'revoked' });
  await expect(admitMcp(f.request(), f.env)).rejects.toBeInstanceOf(HttpError);
});

test('zero-row revoke is not success and provider cleanup failure stays denied', async () => {
  const f = await makeAuthFixture();
  await revokeGrant(f.admin, f.grantId, f.env);
  await expect(revokeGrant(f.admin, f.grantId, f.env)).rejects.toMatchObject({
    status: 403,
  });
  const g = await makeAuthFixture();
  await admitMcp(g.request(), g.env);
  const helpers = g.env.OAUTH_PROVIDER!;
  const original = helpers.revokeGrant.bind(helpers);
  helpers.revokeGrant = async () => {
    throw new Error('synthetic provider cleanup failure');
  };
  try {
    await expect(revokeGrant(g.admin, g.grantId, g.env)).resolves.toBe(
      'cleanup_pending',
    );
    await expect(admitMcp(g.request(), g.env)).rejects.toMatchObject({
      status: 401,
    });
  } finally {
    helpers.revokeGrant = original;
  }
});

test('oauth_grant contexts cannot revoke and epoch bump invalidates admin sessions', async () => {
  const f = await makeAuthFixture();
  const granted = await admitMcp(f.request(), f.env);
  await expect(revokeGrant(granted, f.grantId, f.env)).rejects.toMatchObject({
    status: 403,
  });
  await env.DB.prepare(
    'UPDATE owners SET auth_epoch = auth_epoch + 1 WHERE owner_id = ?',
  )
    .bind(f.ownerId)
    .run();
  await expect(
    admitAdmin(
      new Request(config.origin + '/api/admin/session', {
        headers: { cookie: `owner_session=${f.session.raw}` },
      }),
      f.env,
      false,
    ),
  ).rejects.toMatchObject({ status: 403 });
});

test('refresh recovers a lost previous token and denies replay beyond that window', async () => {
  const f = await makeAuthFixture();
  const refresh = (token: string) =>
    dispatch(
      new Request(config.origin + '/oauth/token', {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: f.clientId,
          refresh_token: token,
          resource: config.resource,
        }),
      }),
    );
  const rotated = await refresh(f.tokens.refresh_token);
  expect(rotated.status).toBe(200);
  const next = (await rotated.json()) as { refresh_token: string };
  const recovered = await refresh(f.tokens.refresh_token);
  expect(recovered.status).toBe(200);
  const recoveredTokens = (await recovered.json()) as { refresh_token: string };
  const second = await refresh(recoveredTokens.refresh_token);
  expect(second.status).toBe(200);
  expect((await refresh(next.refresh_token)).status).toBe(400);
});

test('parallel refresh of the same token leaves at least one usable access token', async () => {
  const f = await makeAuthFixture();
  const refresh = () =>
    dispatch(
      new Request(config.origin + '/oauth/token', {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: f.clientId,
          refresh_token: f.tokens.refresh_token,
          resource: config.resource,
        }),
      }),
    );
  const [first, second] = await Promise.all([refresh(), refresh()]);
  const successes = [first, second].filter(
    (response) => response.status === 200,
  );
  expect(successes.length).toBeGreaterThanOrEqual(1);
  const token = (await successes[0]!.json()) as { access_token: string };
  const admitted = await admitMcp(
    new Request(config.resource, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    }),
    f.env,
  );
  expect(admitted.actor_kind).toBe('oauth_grant');
  expect(admitted.grant_id).toBe(f.grantId);
});

test('GET admin session returns csrf without listing grants', async () => {
  const f = await makeAuthFixture();
  const response = await dispatch(
    new Request(config.origin + '/api/admin/session', {
      headers: { cookie: `owner_session=${f.session.raw}` },
    }),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { csrf: string };
  expect(body.csrf).toBe(f.session.csrf);
  expect(JSON.stringify(body)).not.toContain(f.grantId);
  expect(JSON.stringify(body)).not.toContain(f.projectId);
});
