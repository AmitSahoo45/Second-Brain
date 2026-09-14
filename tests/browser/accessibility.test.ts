import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import probe from '../../src/probe';

const fixtureEnv = {
  ...env,
  APP_ENV: 'local',
  MCP_RESOURCE_URL: 'http://127.0.0.1:8787/mcp',
  GITHUB_OWNER_ID: '123456789',
  GITHUB_CLIENT_ID: 'synthetic-client',
  GITHUB_CLIENT_SECRET: 'synthetic-secret',
  HMAC_SECRET: 'synthetic-hmac-secret-for-local-tests!',
};

test('admin shell is labeled and uses no-store CSP', async () => {
  const ctx = createExecutionContext();
  const response = await probe.fetch(
    new Request('http://127.0.0.1:8787/admin'),
    fixtureEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('content-security-policy')).toContain(
    "img-src 'none'",
  );
  const html = await response.text();
  expect(html).toContain('Skip to content');
  expect(html).toContain('aria-label="Project"');
  expect(html).toContain('aria-label="Connected clients"');
  expect(html).not.toContain('color-only');
});
