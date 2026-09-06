import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStaging } from '../../scripts/preflight-staging.mts';

const config = {
  account_id: 'b'.repeat(32),
  name: 'synthetic-probe-staging',
  main: 'src/probe.ts',
  compatibility_date: '2026-09-06',
  workers_dev: false,
  routes: [{ pattern: 'probe.example.com', custom_domain: true }],
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

const workersDev = {
  ...config,
  workers_dev: true,
  routes: [],
  vars: {
    ...config.vars,
    STAGING_WORKERS_SUBDOMAIN: 'synthetic-owner',
    MCP_RESOURCE_URL:
      'https://synthetic-probe-staging.synthetic-owner.workers.dev/mcp',
  },
};
test('accepts the explicitly selected stable workers.dev endpoint', () => {
  assert.doesNotThrow(() => validateStaging(workersDev));
});
test('rejects absent or mismatched custom routes and ambiguous routing', () => {
  for (const routes of [
    undefined,
    [],
    [{ pattern: 'unrelated.example.com', custom_domain: true }],
    [{ pattern: '*.example.com/*' }],
  ])
    assert.throws(() => validateStaging({ ...config, routes }));
  assert.throws(() =>
    validateStaging({ ...workersDev, routes: config.routes }),
  );
});
test('requires account identity and exact worker/subdomain correspondence without previews or tracing', () => {
  for (const bad of [
    { ...workersDev, account_id: undefined },
    { ...workersDev, account_id: '<ACCOUNT>' },
    { ...workersDev, name: 'other-staging' },
    {
      ...workersDev,
      vars: { ...workersDev.vars, STAGING_WORKERS_SUBDOMAIN: 'other' },
    },
    {
      ...workersDev,
      vars: { ...workersDev.vars, STAGING_WORKERS_SUBDOMAIN: '' },
    },
    {
      ...workersDev,
      vars: {
        ...workersDev.vars,
        MCP_RESOURCE_URL:
          'https://preview-synthetic-probe-staging.synthetic-owner.workers.dev/mcp',
      },
    },
    { ...workersDev, preview_urls: true },
    {
      ...workersDev,
      observability: { enabled: false, traces: { enabled: true } },
    },
    {
      ...workersDev,
      observability: { enabled: false, logs: { enabled: true } },
    },
  ])
    assert.throws(() => validateStaging(bad));
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
