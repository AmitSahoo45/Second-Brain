import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStaging } from '../../scripts/preflight-staging.mts';

const config = {
  name: 'synthetic-probe-staging',
  main: 'src/probe.ts',
  compatibility_date: '2026-09-06',
  workers_dev: false,
  preview_urls: false,
  observability: { enabled: false },
  vars: {
    APP_ENV: 'staging',
    MCP_RESOURCE_URL: 'https://probe.example.com/mcp',
    GITHUB_OWNER_ID: '123456789',
    GITHUB_CLIENT_ID: 'synthetic-app',
  },
  d1_databases: [
    {
      binding: 'DB',
      database_id: '550e8400-e29b-41d4-a716-446655440000',
      database_name: 'synthetic-staging',
    },
  ],
  kv_namespaces: [{ binding: 'OAUTH_KV', id: 'a'.repeat(32) }],
};
test('accepts only an explicit staging configuration', () => {
  assert.doesNotThrow(() => validateStaging(config));
});
test('refuses placeholders, production entry, local bindings and invocation logging', () => {
  for (const bad of [
    { ...config, main: 'src/index.ts' },
    { ...config, vars: { ...config.vars, APP_ENV: 'production' } },
    {
      ...config,
      vars: { ...config.vars, MCP_RESOURCE_URL: 'http://localhost/mcp' },
    },
    { ...config, vars: { ...config.vars, GITHUB_OWNER_ID: '<owner>' } },
    { ...config, d1_databases: [{ binding: 'DB', database_id: 'local-only' }] },
    { ...config, observability: { enabled: true } },
  ])
    assert.throws(() => validateStaging(bad));
});
