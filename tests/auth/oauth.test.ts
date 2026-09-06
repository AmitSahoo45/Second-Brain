import { env } from 'cloudflare:workers';
import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { beforeAll, expect, test, vi } from 'vitest';
import probe from '../../src/probe';
import production from '../../src/index';
import { getOAuthApi } from '@cloudflare/workers-oauth-provider';
import { providerOptions } from '../../src/auth/provider';
import { loadConfig } from '../../src/config';
import migration from '../../src/db/migrations/0001_auth.sql?raw';
import boundsMigration from '../../src/db/migrations/0002_probe_auth_bounds.sql?raw';
import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthTokens,
} from '@modelcontextprotocol/client';

const fixtureEnv = {
  ...env,
  APP_ENV: 'local',
  MCP_RESOURCE_URL: 'http://127.0.0.1:8787/mcp',
  GITHUB_OWNER_ID: '123456789',
  GITHUB_CLIENT_ID: 'synthetic-client',
  GITHUB_CLIENT_SECRET: 'synthetic-secret',
};
const origin = 'http://127.0.0.1:8787';
let clientId: string;
const verifier = 'A'.repeat(64);
let challenge: string;
const redirectUri = 'https://client.example/callback';

async function request(path: string, init?: RequestInit) {
  const ctx = createExecutionContext();
  const response = await probe.fetch(
    new Request(new URL(path, origin), init),
    fixtureEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

beforeAll(async () => {
  for (const statement of (migration + boundsMigration)
    .split(';')
    .map((value) => value.trim())
    .filter(Boolean))
    await env.DB.prepare(statement).run();
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  );
  challenge = btoa(String.fromCharCode(...digest))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  const api = getOAuthApi(providerOptions(loadConfig(fixtureEnv)), fixtureEnv);
  clientId = (
    await api.createClient({
      clientName: 'Synthetic protocol client',
      redirectUris: [redirectUri],
      tokenEndpointAuthMethod: 'none',
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
    })
  ).clientId;
});

function authorization(overrides: Record<string, string> = {}) {
  return (
    '/authorize?' +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state: 'synthetic-client-state',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      scope: 'memory:read memory:write',
      resource: origin + '/mcp',
      ...overrides,
    })
  );
}

function cookie(response: Response) {
  return response.headers.get('set-cookie')!.split(';')[0]!;
}

async function start(
  scope = 'memory:read memory:write',
  overrides: Record<string, string> = {},
) {
  const response = await request(authorization({ scope, ...overrides }));
  expect(response.status).toBe(302);
  const githubUrl = new URL(response.headers.get('location')!);
  return {
    state: githubUrl.searchParams.get('state')!,
    cookie: cookie(response),
  };
}

async function login(
  subject = 123456789,
  scope = 'memory:read memory:write',
  responses: { token?: () => Response; identity?: () => Response } = {},
  overrides: Record<string, string> = {},
) {
  const started = await start(scope, overrides);
  const outgoing: Request[] = [];
  const upstream = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input, init) => {
      // Exercise native Workers option validation before returning a fixture.
      const outbound = new Request(input, init);
      outgoing.push(outbound);
      const url = outbound.url;
      if (url === 'https://github.com/login/oauth/access_token')
        return (
          responses.token?.() ??
          Response.json({
            access_token: 'synthetic-upstream-only',
            token_type: 'bearer',
            scope: '',
          })
        );
      if (url === 'https://api.github.com/user')
        return (
          responses.identity?.() ??
          Response.json({
            id: subject,
            login: 'synthetic-owner',
            name: null,
          })
        );
      throw new Error('Unexpected external request');
    });
  try {
    const response = await request(
      '/oauth/callback?' +
        new URLSearchParams({ state: started.state, code: 'synthetic-code' }),
      { headers: { cookie: started.cookie } },
    );
    return { response, started, outgoing };
  } finally {
    upstream.mockRestore();
  }
}

function completionUrl(html: string) {
  const href = html.match(/<a href="([^"]+)"/)?.[1];
  expect(href).toBeDefined();
  return new URL(
    href!.replace(
      /&(amp|quot|#39|lt|gt);/g,
      (entity) =>
        ({
          '&amp;': '&',
          '&quot;': '"',
          '&#39;': "'",
          '&lt;': '<',
          '&gt;': '>',
        })[entity]!,
    ),
  );
}

async function grant(scope = 'memory:read memory:write') {
  const { response } = await login(123456789, scope);
  expect(response.status).toBe(200);
  const html = await response.text();
  const csrf = html.match(/name="csrf" value="([^"]+)"/)![1]!;
  const consentCookie = cookie(response);
  const consent = await request('/oauth/consent', {
    method: 'POST',
    headers: {
      origin,
      cookie: consentCookie,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ csrf, approve: 'yes' }),
  });
  expect(consent.status).toBe(200);
  const code = completionUrl(await consent.text()).searchParams.get('code')!;
  const tokenResponse = await request('/oauth/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code,
      code_verifier: verifier,
      resource: origin + '/mcp',
    }),
  });
  expect(tokenResponse.status).toBe(200);
  return (await tokenResponse.json()) as {
    access_token: string;
    refresh_token: string;
  };
}

test('production serves no probe or functioning-memory health claim', async () => {
  const response = await production.fetch(
    new Request('https://example.com/mcp'),
  );
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('probe_write');
});

test('unauthenticated protected route has canonical OAuth challenge', async () => {
  const response = await request('/mcp', { method: 'POST', body: '{}' });
  expect(response.status).toBe(401);
  expect(response.headers.get('www-authenticate')).toContain(
    'oauth-protected-resource',
  );
});

test('official SDK normal OAuth discovery requests the writable probe permissions without a forced scope', async () => {
  const saved: {
    authorization?: URL;
    verifier?: string;
    discovery?: OAuthDiscoveryState;
    tokens?: StoredOAuthTokens;
  } = {};
  const authProvider: OAuthClientProvider = {
    redirectUrl: redirectUri,
    clientMetadata: {
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
    clientInformation: () => ({ client_id: clientId }),
    tokens: () => saved.tokens,
    saveTokens: (tokens) => {
      saved.tokens = tokens;
    },
    redirectToAuthorization: (authorizationUrl) => {
      saved.authorization = authorizationUrl;
    },
    saveCodeVerifier: (value) => {
      saved.verifier = value;
    },
    codeVerifier: () => saved.verifier!,
    state: () => 'synthetic-sdk-state',
    discoveryState: () => saved.discovery,
    saveDiscoveryState: (value) => {
      saved.discovery = value;
    },
  };
  const client = new Client({
    name: 'synthetic-discovery-consumer',
    version: '1.0.0',
  });
  const transport = new StreamableHTTPClientTransport(
    new URL(origin + '/mcp'),
    {
      authProvider,
      requestInit: { headers: { Host: '127.0.0.1:8787' } },
      fetch: async (input, init) => {
        const req = new Request(input, init);
        if (new URL(req.url).origin !== origin)
          throw new Error('Unexpected external discovery request');
        const ctx = createExecutionContext();
        const response = await probe.fetch(req, fixtureEnv, ctx);
        await waitOnExecutionContext(ctx);
        return response;
      },
    },
  );
  try {
    await expect(client.connect(transport)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(saved.authorization?.origin).toBe(origin);
    expect(saved.authorization?.searchParams.get('scope')).toBe(
      'memory:read memory:write',
    );
    expect(saved.authorization?.searchParams.get('resource')).toBe(
      origin + '/mcp',
    );
    expect(saved.authorization?.searchParams.get('code_challenge_method')).toBe(
      'S256',
    );
    expect((await request(saved.authorization!.href)).status).toBe(302);
  } finally {
    await client.close();
  }
});

test('an explicitly read-only authorization remains readable and cannot write', async () => {
  const tokens = await grant('memory:read');
  const project = await env.DB.prepare(
    'SELECT project_id FROM projects LIMIT 1',
  ).first<{ project_id: string }>();
  const call = async (name: string, args: Record<string, string>) => {
    const response = await request('/mcp', {
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
        params: { name, arguments: args },
      }),
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    return response.headers.get('content-type')?.includes('text/event-stream')
      ? JSON.parse(
          text
            .split('\n')
            .find((line) => line.startsWith('data: '))!
            .slice(6),
        )
      : JSON.parse(text);
  };
  expect(
    await call('probe_read', { project_id: project!.project_id }),
  ).toHaveProperty('result.structuredContent');
  expect(
    await call('probe_write', {
      project_id: project!.project_id,
      value: 'synthetic:denied',
    }),
  ).toMatchObject({ result: { isError: true } });
});

test.each([
  { resource: 'http://127.0.0.1:8787/other' },
  { redirect_uri: 'https://evil.example/callback' },
  { code_challenge: '' },
  { code_challenge: 'too-short' },
  { code_challenge_method: 'plain' },
  { scope: 'memory:read admin' },
])(
  'denies invalid authorization parameters %j before login',
  async (overrides) => {
    const response = await request(authorization(overrides));
    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
  },
);

test('DCR and URL client metadata are disabled', async () => {
  expect(
    (await request('/register', { method: 'POST', body: '{}' })).status,
  ).toBe(404);
  expect(
    (
      await request(
        authorization({ client_id: 'https://evil.example/metadata.json' }),
      )
    ).status,
  ).toBe(400);
});

test('native loopback allows a different port but rejects credentials and fragments', async () => {
  const api = getOAuthApi(providerOptions(loadConfig(fixtureEnv)), fixtureEnv);
  const native = await api.createClient({
    clientName: 'Synthetic native client',
    redirectUris: ['http://127.0.0.1:3000/callback'],
    tokenEndpointAuthMethod: 'none',
    grantTypes: ['authorization_code', 'refresh_token'],
    responseTypes: ['code'],
  });
  for (const redirect_uri of [
    'http://user@127.0.0.1:4567/callback',
    'http://user:password@127.0.0.1:4567/callback',
    'http://127.0.0.1:4567/callback#fragment',
  ]) {
    expect(
      (
        await request(
          authorization({ client_id: native.clientId, redirect_uri }),
        )
      ).status,
    ).toBe(400);
  }
  expect(
    (
      await request(
        authorization({
          client_id: native.clientId,
          redirect_uri: 'http://127.0.0.1:4567/callback',
        }),
      )
    ).status,
  ).toBe(302);
});

test('rejects oversized streamed body regardless of declared length', async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(32769));
      controller.close();
    },
  });
  expect((await request('/oauth/token', { method: 'POST', body })).status).toBe(
    413,
  );
});

test('rejects wrong browser state without contacting upstream', async () => {
  const a = await start();
  const b = await start();
  const response = await request(
    '/oauth/callback?' +
      new URLSearchParams({ state: a.state, code: 'synthetic' }),
    { headers: { cookie: b.cookie } },
  );
  expect(response.status).toBe(400);
});

test('rejects a second GitHub account', async () => {
  expect((await login(987654321)).response.status).toBe(403);
});

const sensitiveCanary =
  'synthetic-private-body Bearer synthetic-private-token client_secret=synthetic-private-secret https://synthetic.example/oauth/callback?code=synthetic-private-code&state=synthetic-private-state';

async function expectPrivateCallbackFailure(
  attempt: () => Promise<{ response: Response }>,
  expectedCode: string,
) {
  const logs = (['debug', 'info', 'log', 'warn', 'error'] as const).map(
    (method) => vi.spyOn(console, method).mockImplementation(() => {}),
  );
  try {
    const { response } = await attempt();
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ error: expectedCode });
    expect(response.headers.get('cache-control')).toBe('no-store');
    const exposed = body + JSON.stringify([...response.headers]);
    expect(exposed).not.toContain('synthetic-private');
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  } finally {
    for (const log of logs) log.mockRestore();
  }
}

test.each([
  ['token', 'fetch', 'callback_token_fetch_failed'],
  ['token', 'json', 'callback_token_json_failed'],
  ['identity', 'fetch', 'callback_identity_fetch_failed'],
  ['identity', 'json', 'callback_identity_json_failed'],
] as const)(
  'callback identifies %s %s failure without exposing upstream details',
  async (dependency, failure, expectedCode) => {
    const ownersBefore = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM owners',
    ).first('n');
    await expectPrivateCallbackFailure(
      () =>
        login(123456789, 'memory:read memory:write', {
          [dependency]: () => {
            if (failure === 'fetch') throw new Error(sensitiveCanary);
            return new Response(sensitiveCanary, {
              headers: { 'content-type': 'application/json' },
            });
          },
        }),
      expectedCode,
    );
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS n FROM owners').first('n'),
    ).toBe(ownersBefore);
  },
);

test.each([
  [
    'DELETE FROM probe_auth_flows WHERE state =',
    'callback_state_consume_failed',
  ],
  ['INSERT OR IGNORE INTO owners', 'callback_owner_store_failed'],
] as const)(
  'callback identifies storage failure at %s without exposing query details',
  async (queryPrefix, expectedCode) => {
    const prepare = env.DB.prepare.bind(env.DB);
    const storage = vi.spyOn(env.DB, 'prepare').mockImplementation((query) => {
      if (query.startsWith(queryPrefix)) throw new Error(sensitiveCanary);
      return prepare(query);
    });
    try {
      await expectPrivateCallbackFailure(() => login(), expectedCode);
    } finally {
      storage.mockRestore();
    }
  },
);

test.each(['token', 'identity'] as const)(
  'callback preserves access denial for unsuccessful %s responses',
  async (dependency) => {
    const { response } = await login(123456789, 'memory:read memory:write', {
      [dependency]: () => new Response(sensitiveCanary, { status: 401 }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'access_denied' });
  },
);

test.each([
  ['token', 302],
  ['identity', 307],
] as const)(
  'callback denies a %s redirect without forwarding credentials to its target',
  async (dependency, status) => {
    const redirectTarget = 'https://synthetic-untrusted.example/collect';
    const { response, outgoing } = await login(
      123456789,
      'memory:read memory:write',
      {
        [dependency]: () =>
          new Response(null, {
            status,
            headers: { location: redirectTarget },
          }),
      },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'access_denied' });
    expect(response.headers.get('location')).toBeNull();
    expect(outgoing.map((request) => request.url)).toEqual(
      dependency === 'token'
        ? ['https://github.com/login/oauth/access_token']
        : [
            'https://github.com/login/oauth/access_token',
            'https://api.github.com/user',
          ],
    );
    // Native Requests carry a policy that never follows the credential-bearing
    // POST or Authorization header to a Location supplied by the upstream.
    for (const outbound of outgoing) expect(outbound.redirect).toBe('manual');
  },
);

test.each(['token', 'identity'] as const)(
  'callback denies null %s JSON without an unclassified exception',
  async (dependency) => {
    const { response } = await login(123456789, 'memory:read memory:write', {
      [dependency]: () => Response.json(null),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'access_denied' });
  },
);

test('callback preserves disabled-owner denial inside the storage stage', async () => {
  expect((await login()).response.status).toBe(200);
  await env.DB.prepare('UPDATE owners SET active = 0').run();
  try {
    const { response } = await login();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'access_denied' });
  } finally {
    await env.DB.prepare('UPDATE owners SET active = 1').run();
  }
});

test('callback preserves bounded consent admission status', async () => {
  expect((await login()).response.status).toBe(200);
  await env.DB.prepare('DELETE FROM probe_consents').run();
  await env.DB.batch(
    Array.from({ length: 8 }, (_, index) =>
      env.DB.prepare(
        'INSERT INTO probe_consents SELECT ?, ?, ?, owner_id, project_id, ? FROM projects LIMIT 1',
      ).bind(`pending-${index}`, 'synthetic-csrf', '{}', Date.now() + 600000),
    ),
  );
  try {
    const { response } = await login();
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'temporarily_unavailable' });
  } finally {
    await env.DB.prepare('DELETE FROM probe_consents').run();
  }
});

test('consent requires exact Origin and CSRF value', async () => {
  const { response } = await login();
  expect(response.status).toBe(200);
  const csrf = (await response.text()).match(
    /name="csrf" value="([^"]+)"/,
  )![1]!;
  const headers = {
    cookie: cookie(response),
    'content-type': 'application/x-www-form-urlencoded',
  };
  expect(
    (
      await request('/oauth/consent', {
        method: 'POST',
        headers: { ...headers, origin: 'https://evil.example' },
        body: new URLSearchParams({ csrf, approve: 'yes' }),
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await request('/oauth/consent', {
        method: 'POST',
        headers: { ...headers, origin },
        body: new URLSearchParams({ csrf: 'wrong', approve: 'yes' }),
      })
    ).status,
  ).toBe(403);
});

test('only the consent document preserves form Origin and completion escapes the validated client URL', async () => {
  const redirect =
    "https://client.example/callback?label='quoted'&other=%3Cscript%3E";
  const api = getOAuthApi(providerOptions(loadConfig(fixtureEnv)), fixtureEnv);
  const client = await api.createClient({
    clientName: 'Synthetic <script>client</script>',
    redirectUris: [redirect],
    tokenEndpointAuthMethod: 'none',
    grantTypes: ['authorization_code'],
    responseTypes: ['code'],
  });
  const { response } = await login(
    123456789,
    'memory:read memory:write',
    {},
    {
      client_id: client.clientId,
      redirect_uri: redirect,
    },
  );
  expect(response.headers.get('referrer-policy')).toBe('strict-origin');
  const html = await response.text();
  expect(html).toContain('&lt;script&gt;client&lt;/script&gt;');
  expect(html).not.toContain('<script>');
  const csrf = html.match(/name="csrf" value="([^"]+)"/)![1]!;
  const init = {
    method: 'POST',
    headers: {
      origin,
      cookie: cookie(response),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ csrf, approve: 'yes' }),
  };
  const completed = await request('/oauth/consent', init);
  expect(completed.status).toBe(200);
  expect(completed.headers.get('location')).toBeNull();
  expect(completed.headers.get('referrer-policy')).toBe('no-referrer');
  expect(completed.headers.get('content-security-policy')).toContain(
    "form-action 'none'",
  );
  const document = await completed.text();
  expect(document.includes('http-equiv="refresh"')).toBe(true);
  expect(document.includes('label=%27quoted%27&amp;other=')).toBe(true);
  expect(document.includes('rel="noreferrer"')).toBe(true);
  expect(document.includes('<script>')).toBe(false);
  const target = completionUrl(document);
  expect(target.origin + target.pathname).toBe(
    'https://client.example/callback',
  );
  expect(target.searchParams.get('label')).toBe("'quoted'");
  expect(target.searchParams.get('other')).toBe('<script>');
  expect(target.searchParams.get('state')).toBe('synthetic-client-state');
  expect(target.searchParams.get('code')).toBeTruthy();
  expect((await request('/oauth/consent', init)).status).toBe(403);
  expect((await request('/health')).headers.get('referrer-policy')).toBe(
    'no-referrer',
  );
});

test.each([undefined, 'null', 'https://evil.example'])(
  'consent still rejects Origin %s without consuming the consent',
  async (originHeader) => {
    const { response } = await login();
    const csrf = (await response.text()).match(
      /name="csrf" value="([^"]+)"/,
    )![1]!;
    const before = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM probe_consents',
    ).first('n');
    const headers: Record<string, string> = {
      cookie: cookie(response),
      'content-type': 'application/x-www-form-urlencoded',
    };
    if (originHeader !== undefined) headers.origin = originHeader;
    const denied = await request('/oauth/consent', {
      method: 'POST',
      headers,
      body: new URLSearchParams({ csrf, approve: 'yes' }),
    });
    expect(denied.status).toBe(403);
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS n FROM probe_consents').first(
        'n',
      ),
    ).toBe(before);
    await env.DB.prepare('DELETE FROM probe_consents').run();
  },
);

test('denying consent consumes it once and creates no grant', async () => {
  const { response } = await login();
  const csrf = (await response.text()).match(
    /name="csrf" value="([^"]+)"/,
  )![1]!;
  const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM grants').first(
    'n',
  );
  const init = {
    method: 'POST',
    headers: {
      origin,
      cookie: cookie(response),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ csrf, approve: 'no' }),
  };
  expect((await request('/oauth/consent', init)).status).toBe(403);
  init.body.set('approve', 'yes');
  expect((await request('/oauth/consent', init)).status).toBe(403);
  expect(
    await env.DB.prepare('SELECT COUNT(*) AS n FROM grants').first('n'),
  ).toBe(before);
});

test('official SDK authenticates, discovers, writes and reads synthetic D1 probe data', async () => {
  const tokens = await grant();
  const client = new Client({ name: 'synthetic-sdk-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(
    new URL(origin + '/mcp'),
    {
      requestInit: {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Host: '127.0.0.1:8787',
        },
      },
      fetch: async (input, init) => {
        const req = new Request(input, init);
        const ctx = createExecutionContext();
        const response = await probe.fetch(req, fixtureEnv, ctx);
        await waitOnExecutionContext(ctx);
        return response;
      },
    },
  );
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      'probe_read',
      'probe_write',
    ]);
    const project = await env.DB.prepare(
      'SELECT project_id FROM projects LIMIT 1',
    ).first<{ project_id: string }>();
    expect(project).not.toBeNull();
    const result = await client.callTool({
      name: 'probe_write',
      arguments: { project_id: project!.project_id, value: 'synthetic:sample' },
    });
    expect(result.isError).not.toBe(true);
    const read = await client.callTool({
      name: 'probe_read',
      arguments: { project_id: project!.project_id },
    });
    expect(read.structuredContent).toMatchObject({ value: 'synthetic:sample' });
    const maxValue = 'synthetic:' + 'a'.repeat(8182);
    expect(
      (
        await client.callTool({
          name: 'probe_write',
          arguments: { project_id: project!.project_id, value: maxValue },
        })
      ).isError,
    ).not.toBe(true);
    const maxRead = await client.callTool({
      name: 'probe_read',
      arguments: { project_id: project!.project_id },
    });
    expect(
      new TextEncoder().encode(JSON.stringify(maxRead)).byteLength,
    ).toBeLessThan(24576);
    expect(maxRead.structuredContent).toMatchObject({ value: maxValue });
    expect(
      (
        await client.callTool({
          name: 'probe_write',
          arguments: {
            project_id: project!.project_id,
            value: 'synthetic:' + '\u0000'.repeat(4200),
          },
        })
      ).isError,
    ).toBe(true);
    const denied = await client.callTool({
      name: 'probe_read',
      arguments: { project_id: crypto.randomUUID() },
    });
    expect(denied.isError).toBe(true);
    await env.DB.prepare('UPDATE grants SET revoked_at = ?')
      .bind(new Date().toISOString())
      .run();
    expect(
      (
        await request('/mcp', {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokens.access_token}` },
          body: '{}',
        })
      ).status,
    ).toBe(401);
  } finally {
    await client.close();
  }
});

test('callback state cannot be replayed', async () => {
  const { started, response } = await login();
  expect(response.status).toBe(200);
  expect(
    (
      await request(
        '/oauth/callback?' +
          new URLSearchParams({ state: started.state, code: 'synthetic-code' }),
        { headers: { cookie: started.cookie } },
      )
    ).status,
  ).toBe(400);
});

test('effective downscoped token cannot write even when its grant can', async () => {
  const tokens = await grant();
  const refreshed = await request('/oauth/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: tokens.refresh_token,
      scope: 'memory:read',
      resource: origin + '/mcp',
    }),
  });
  expect(refreshed.status).toBe(200);
  const narrowed = (await refreshed.json()) as {
    access_token: string;
    scope: string;
  };
  expect(narrowed.scope).toBe('memory:read');
  const project = await env.DB.prepare(
    'SELECT project_id FROM projects LIMIT 1',
  ).first<{ project_id: string }>();
  const response = await request('/mcp', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${narrowed.access_token}`,
      Host: '127.0.0.1:8787',
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'probe_write',
        arguments: {
          project_id: project!.project_id,
          value: 'synthetic:denied',
        },
      },
    }),
  });
  expect(response.status).toBe(200);
  const text = await response.text();
  const json = response.headers
    .get('content-type')
    ?.includes('text/event-stream')
    ? JSON.parse(
        text
          .split('\n')
          .find((line) => line.startsWith('data: '))!
          .slice(6),
      )
    : JSON.parse(text);
  expect(json).toMatchObject({ result: { isError: true } });
});

test('token endpoint rejects audience substitution and malformed body', async () => {
  const tokens = await grant();
  const response = await request('/oauth/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: tokens.refresh_token,
      resource: origin + '/other',
    }),
  });
  expect(response.status).toBe(400);
  expect(
    (
      await request('/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      })
    ).status,
  ).toBe(400);
});

test('bounds echoed MCP request IDs before dispatch', async () => {
  const tokens = await grant();
  const response = await request('/mcp', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      Host: '127.0.0.1:8787',
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'x'.repeat(2048),
      method: 'tools/list',
      params: {},
    }),
  });
  expect(response.status).toBe(400);
});

test('indexed expiry lookups avoid scanning pending auth tables', async () => {
  for (const table of ['probe_auth_flows', 'probe_consents']) {
    const plan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN SELECT rowid FROM ${table} WHERE expires_at <= ? ORDER BY expires_at LIMIT 4`,
    )
      .bind(Date.now())
      .all<{ detail: string }>();
    expect(plan.results.map((item) => item.detail).join(' ')).toContain(
      `INDEX ${table}_expiry`,
    );
    expect(plan.results.map((item) => item.detail).join(' ')).not.toContain(
      'SCAN ' + table,
    );
  }
});

test('auth admission has a finite pending limit and bounded expiry cleanup', async () => {
  await env.DB.prepare('DELETE FROM probe_auth_flows').run();
  const insert = (state: string, expires: number) =>
    env.DB.prepare('INSERT INTO probe_auth_flows VALUES (?, ?, ?, ?)').bind(
      state,
      'synthetic-browser-hash',
      '{}',
      expires,
    );
  await env.DB.batch(
    Array.from({ length: 8 }, (_, index) =>
      insert(`pending-${index}`, Date.now() + 600000),
    ),
  );
  expect((await request(authorization())).status).toBe(429);
  expect(
    await env.DB.prepare('SELECT COUNT(*) AS n FROM probe_auth_flows').first(
      'n',
    ),
  ).toBe(8);
  await env.DB.prepare('DELETE FROM probe_auth_flows').run();
  await env.DB.batch(
    Array.from({ length: 5 }, (_, index) =>
      insert(`expired-${index}`, Date.now() - 1000),
    ),
  );
  expect((await request(authorization())).status).toBe(302);
  expect(
    await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM probe_auth_flows WHERE expires_at <= ?',
    )
      .bind(Date.now())
      .first('n'),
  ).toBe(1);
  await env.DB.prepare('DELETE FROM probe_auth_flows').run();
});

test('two ordinary simultaneous authorizations cannot overfill the last pending slot', async () => {
  await env.DB.prepare('DELETE FROM probe_auth_flows').run();
  await env.DB.batch(
    Array.from({ length: 7 }, (_, index) =>
      env.DB.prepare('INSERT INTO probe_auth_flows VALUES (?, ?, ?, ?)').bind(
        `pending-${index}`,
        'synthetic-browser-hash',
        '{}',
        Date.now() + 600000,
      ),
    ),
  );
  const responses = await Promise.all([
    request(authorization()),
    request(authorization()),
  ]);
  expect(responses.map((item) => item.status).sort()).toEqual([302, 429]);
  expect(
    await env.DB.prepare('SELECT COUNT(*) AS n FROM probe_auth_flows').first(
      'n',
    ),
  ).toBe(8);
  await env.DB.prepare('DELETE FROM probe_auth_flows').run();
});
