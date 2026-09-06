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
import {
  Client,
  StreamableHTTPClientTransport,
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
  for (const statement of migration
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

async function start() {
  const response = await request(authorization());
  expect(response.status).toBe(302);
  const githubUrl = new URL(response.headers.get('location')!);
  return {
    state: githubUrl.searchParams.get('state')!,
    cookie: cookie(response),
  };
}

async function login(subject = 123456789) {
  const started = await start();
  const upstream = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url === 'https://github.com/login/oauth/access_token')
        return Response.json({
          access_token: 'synthetic-upstream-only',
          token_type: 'bearer',
          scope: '',
        });
      if (url === 'https://api.github.com/user')
        return Response.json({
          id: subject,
          login: 'synthetic-owner',
          name: null,
        });
      throw new Error('Unexpected external request');
    });
  try {
    const response = await request(
      '/oauth/callback?' +
        new URLSearchParams({ state: started.state, code: 'synthetic-code' }),
      { headers: { cookie: started.cookie } },
    );
    return { response, started };
  } finally {
    upstream.mockRestore();
  }
}

async function grant() {
  const { response } = await login();
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
  expect(consent.status).toBe(302);
  const code = new URL(consent.headers.get('location')!).searchParams.get(
    'code',
  )!;
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
