import { env } from 'cloudflare:workers';
import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import {
  getOAuthApi,
  OAuthProvider,
  type OAuthProviderOptions,
  type Token,
} from '@cloudflare/workers-oauth-provider';
import { beforeAll, expect, test, vi } from 'vitest';
import { providerOptions } from '../../src/auth/provider';
import type { ProbeEnv } from '../../src/auth/types';
import { loadConfig } from '../../src/config';
import { createGrant, provisionOwner } from '../../src/db/auth-store';
import probe from '../../src/probe';
import migration from '../../src/db/migrations/0001_auth.sql?raw';
import boundsMigration from '../../src/db/migrations/0002_probe_auth_bounds.sql?raw';

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
  for (const statement of (migration + boundsMigration).split(';')) {
    if (statement.trim()) await env.DB.prepare(statement).run();
  }
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

async function dispatch(
  request: Request,
  options?: OAuthProviderOptions<ProbeEnv>,
) {
  const ctx = createExecutionContext();
  const response = options
    ? await new OAuthProvider(options).fetch(request, fixtureEnv, ctx)
    : await probe.fetch(request, fixtureEnv, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function issue(
  overrides: Partial<OAuthProviderOptions<ProbeEnv>> | 'legacy' = {},
  props?: (actorId: string) => unknown,
  scope?: string,
) {
  const options = {
    ...providerOptions(config),
    ...(overrides === 'legacy' ? {} : overrides),
  };
  if (overrides === 'legacy') delete options.tokenExchangeCallback;
  const api = getOAuthApi(options, fixtureEnv);
  const client = await api.createClient({
    clientName: 'Synthetic token context fixture',
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
    state: 'synthetic-state',
    codeChallenge: challenge,
    codeChallengeMethod: 'S256',
    resource: config.resource,
  };
  const actorId = await createGrant(
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
    props: props ? props(actorId) : { actorId },
  });
  const response = await dispatch(
    new Request(config.origin + '/oauth/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: client.clientId,
        redirect_uri: redirectUri,
        code: new URL(authorization.redirectTo).searchParams.get('code')!,
        code_verifier: verifier,
        resource: config.resource,
        ...(scope === undefined ? {} : { scope }),
      }),
    }),
    options,
  );
  return { response, actorId, owner, clientId: client.clientId, api };
}

async function minted(
  overrides: Partial<OAuthProviderOptions<ProbeEnv>> | 'legacy' = {},
) {
  const fixture = await issue(overrides);
  expect(fixture.response.status).toBe(200);
  const tokens = (await fixture.response.json()) as {
    access_token: string;
    refresh_token: string;
  };
  return { ...fixture, ...tokens };
}

async function read(
  token: string,
  projectId: string,
  name: 'probe_read' | 'probe_write' = 'probe_read',
) {
  return dispatch(
    new Request(config.resource, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Host: '127.0.0.1:8787',
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name,
          arguments: {
            project_id: projectId,
            ...(name === 'probe_write'
              ? { value: 'synthetic:scope-check' }
              : {}),
          },
        },
      }),
    }),
  );
}

async function message(response: Response) {
  const text = await response.text();
  return JSON.parse(
    response.headers.get('content-type')?.includes('text/event-stream')
      ? text
          .split('\n')
          .find((line) => line.startsWith('data: '))!
          .slice(6)
      : text,
  ) as unknown;
}

test('fresh code token performs one real token KV read through protected MCP admission', async () => {
  const fixture = await minted();
  const reads = vi.spyOn(fixtureEnv.OAUTH_KV, 'get');
  try {
    const response = await read(fixture.access_token, fixture.owner.project_id);
    expect(response.status).toBe(200);
    expect(await message(response)).toMatchObject({
      result: { isError: false },
    });
    expect(
      reads.mock.calls.filter(
        ([key]: readonly unknown[]) =>
          typeof key === 'string' && key.startsWith('token:'),
      ),
    ).toHaveLength(1);
  } finally {
    reads.mockRestore();
  }
});

test('code-exchange downscope stays token-specific and does not narrow the canonical refresh grant', async () => {
  const fixture = await issue({}, undefined, 'memory:read');
  expect(fixture.response.status).toBe(200);
  const token = (await fixture.response.json()) as {
    access_token: string;
    refresh_token: string;
  };
  const summary = (await fixture.api.unwrapToken(token.access_token))!;
  expect(summary.grant.props).toEqual({
    version: 1,
    actorId: fixture.actorId,
    userId: fixture.owner.owner_id,
    grantId: summary.grantId,
    clientId: fixture.clientId,
    scope: ['memory:read'],
    audience: config.resource,
  });
  expect(
    await message(
      await read(token.access_token, fixture.owner.project_id, 'probe_write'),
    ),
  ).toMatchObject({ result: { isError: true } });
  const refreshed = await dispatch(
    new Request(config.origin + '/oauth/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: fixture.clientId,
        refresh_token: token.refresh_token,
        resource: config.resource,
      }),
    }),
  );
  expect(refreshed.status).toBe(200);
  const full = (await refreshed.json()) as {
    access_token: string;
    scope: string;
  };
  expect(full.scope).toBe('memory:read memory:write');
  expect(
    await message(
      await read(full.access_token, fixture.owner.project_id, 'probe_write'),
    ),
  ).toMatchObject({ result: { isError: false } });
});

test('current D1 scopes still narrow an optimized writable token', async () => {
  const fixture = await minted();
  expect(
    await message(
      await read(fixture.access_token, fixture.owner.project_id, 'probe_write'),
    ),
  ).toMatchObject({ result: { isError: false } });
  await env.DB.prepare('UPDATE grants SET scopes_json = ? WHERE grant_id = ?')
    .bind('["memory:read"]', fixture.actorId)
    .run();
  expect(
    await message(
      await read(fixture.access_token, fixture.owner.project_id, 'probe_write'),
    ),
  ).toMatchObject({ result: { isError: true } });
  expect(
    await message(await read(fixture.access_token, fixture.owner.project_id)),
  ).toMatchObject({ result: { isError: false } });
});

test('legacy tokens retain the real two-read compatibility path and refresh to one read', async () => {
  const fixture = await minted('legacy');
  const reads = vi.spyOn(fixtureEnv.OAUTH_KV, 'get');
  try {
    expect(
      (await read(fixture.access_token, fixture.owner.project_id)).status,
    ).toBe(200);
    expect(
      reads.mock.calls.filter(
        ([key]: readonly unknown[]) =>
          typeof key === 'string' && key.startsWith('token:'),
      ),
    ).toHaveLength(2);
    const refreshed = await dispatch(
      new Request(config.origin + '/oauth/token', {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: fixture.clientId,
          refresh_token: fixture.refresh_token,
          scope: 'memory:read',
          resource: config.resource,
        }),
      }),
    );
    expect(refreshed.status).toBe(200);
    const token = (await refreshed.json()) as {
      access_token: string;
      scope: string;
    };
    expect(token.scope).toBe('memory:read');
    reads.mockClear();
    expect(
      (await read(token.access_token, fixture.owner.project_id)).status,
    ).toBe(200);
    expect(
      reads.mock.calls.filter(
        ([key]: readonly unknown[]) =>
          typeof key === 'string' && key.startsWith('token:'),
      ),
    ).toHaveLength(1);
  } finally {
    reads.mockRestore();
  }
});

test.each([
  { version: 2 },
  { version: 1 },
  { extra: true },
  { actorId: 'not-an-actor' },
])(
  'malformed encrypted props do not downgrade to legacy %#',
  async (changes) => {
    const fixture = await issue('legacy', (actorId) => ({
      actorId,
      ...changes,
    }));
    expect(fixture.response.status).toBe(200);
    const tokens = (await fixture.response.json()) as { access_token: string };
    const response = await read(tokens.access_token, fixture.owner.project_id);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'invalid_token' });
  },
);

test('token minting denies malformed canonical actor props without leaking them', async () => {
  const fixture = await issue({}, (actorId) => ({
    actorId,
    unexpected: 'synthetic-private-detail',
  }));
  expect(fixture.response.status).toBe(400);
  expect(await fixture.response.text()).not.toContain(
    'synthetic-private-detail',
  );
});

test.each([
  { version: 2 },
  { scope: 'memory:read' },
  { scope: ['memory:read', 'unknown'] },
  { audience: config.origin + '/other' },
  { userId: '' },
  { grantId: 123 },
  { clientId: false },
  { unexpected: true },
])(
  'versioned encrypted context rejects invalid field %# without legacy fallback',
  async (changes) => {
    const fixture = await minted({
      tokenExchangeCallback: (options) => ({
        accessTokenProps: {
          version: 1,
          actorId: (options.props as { actorId: string }).actorId,
          userId: options.userId,
          grantId: options.grantId,
          clientId: options.clientId,
          scope: options.requestedScope,
          audience: config.resource,
          ...changes,
        },
      }),
    });
    expect(
      (await read(fixture.access_token, fixture.owner.project_id)).status,
    ).toBe(401);
  },
);

test.each(['kv', 'd1'] as const)(
  'storage failure in %s cannot bypass optimized admission',
  async (storage) => {
    const fixture = await minted();
    const failure =
      storage === 'kv'
        ? vi
            .spyOn(fixtureEnv.OAUTH_KV, 'get')
            .mockRejectedValue(new Error('synthetic failure'))
        : vi.spyOn(fixtureEnv.DB, 'prepare').mockImplementation(() => {
            throw new Error('synthetic failure');
          });
    try {
      const response = await read(
        fixture.access_token,
        fixture.owner.project_id,
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'unavailable' });
    } finally {
      failure.mockRestore();
    }
  },
);

test.each(['wrong', 'missing', 'expired'] as const)(
  'provider still denies %s token audience/expiry before admission',
  async (variant) => {
    const fixture = await minted();
    const summary = (await fixture.api.unwrapToken(fixture.access_token))!;
    const key = `token:${summary.userId}:${summary.grantId}:${summary.id}`;
    const token = (await env.OAUTH_KV.get<Token>(key, 'json'))!;
    if (variant === 'wrong') token.audience = config.origin + '/wrong';
    else if (variant === 'missing') delete token.audience;
    else token.expiresAt = Math.floor(Date.now() / 1000) - 1;
    await env.OAUTH_KV.put(key, JSON.stringify(token));
    expect(
      (await read(fixture.access_token, fixture.owner.project_id)).status,
    ).toBe(401);
  },
);

test.each(['revoked', 'inactive', 'epoch', 'client', 'binding'] as const)(
  'optimized admission observes current D1 %s denial',
  async (variant) => {
    const fixture = await minted();
    expect(
      (await read(fixture.access_token, fixture.owner.project_id)).status,
    ).toBe(200);
    const statements = {
      revoked:
        'UPDATE grants SET revoked_at = CURRENT_TIMESTAMP WHERE grant_id = ?',
      inactive: 'UPDATE owners SET active = 0 WHERE owner_id = ?',
      epoch: 'UPDATE owners SET auth_epoch = auth_epoch + 1 WHERE owner_id = ?',
      client: "UPDATE grants SET client_id = 'other-client' WHERE grant_id = ?",
      binding:
        "UPDATE grants SET provider_grant_id = 'other-grant' WHERE grant_id = ?",
    };
    await env.DB.prepare(statements[variant])
      .bind(
        variant === 'inactive' || variant === 'epoch'
          ? fixture.owner.owner_id
          : fixture.actorId,
      )
      .run();
    try {
      expect(
        (await read(fixture.access_token, fixture.owner.project_id)).status,
      ).toBe(401);
    } finally {
      if (variant === 'inactive')
        await env.DB.prepare('UPDATE owners SET active = 1').run();
    }
  },
);

test('distinct optimized grants keep current project membership isolated', async () => {
  const first = await minted();
  const second = await minted();
  expect((await read(first.access_token, first.owner.project_id)).status).toBe(
    200,
  );
  expect(
    (await read(second.access_token, second.owner.project_id)).status,
  ).toBe(200);
  await env.DB.prepare('DELETE FROM grant_projects WHERE grant_id = ?')
    .bind(first.actorId)
    .run();
  const denied = await read(first.access_token, first.owner.project_id);
  expect(await message(denied)).toMatchObject({ result: { isError: true } });
  const allowed = await read(second.access_token, second.owner.project_id);
  expect(await message(allowed)).toMatchObject({ result: { isError: false } });
});
