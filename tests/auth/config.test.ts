import { expect, test } from 'vitest';
import { loadConfig } from '../../src/config';

test('production refuses a loopback MCP audience', () => {
  expect(() =>
    loadConfig({
      APP_ENV: 'production',
      MCP_RESOURCE_URL: 'http://127.0.0.1:8787/mcp',
    }),
  ).toThrow();
});

const configured = {
  APP_ENV: 'local',
  MCP_RESOURCE_URL: 'http://127.0.0.1:8787/mcp',
  GITHUB_OWNER_ID: '123456789',
  GITHUB_CLIENT_ID: 'synthetic-client',
  GITHUB_CLIENT_SECRET: 'synthetic-upstream-secret',
  DB: { prepare() {} },
  OAUTH_KV: { get() {}, put() {} },
};

test('accepts a fully explicit local resource and bindings', () => {
  expect(loadConfig(configured).resource).toBe('http://127.0.0.1:8787/mcp');
});

test.each([
  'DB',
  'OAUTH_KV',
  'GITHUB_OWNER_ID',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'APP_ENV',
  'MCP_RESOURCE_URL',
])('rejects missing %s', (key) => {
  expect(() => loadConfig({ ...configured, [key]: undefined })).toThrow();
});

test.each([
  'http://example.com/mcp',
  'https://example.com/mcp/',
  'https://example.com/mcp?x=1',
  'https://example.com/mcp#fragment',
  'https://user@example.com/mcp',
  'https://localhost/mcp',
  'https://127.0.0.1/mcp',
  'https://example.com/other',
])('rejects unsafe staging resource %s', (resource) => {
  expect(() =>
    loadConfig({
      ...configured,
      APP_ENV: 'staging',
      MCP_RESOURCE_URL: resource,
    }),
  ).toThrow();
});

test.each(['', '0', '-1', '1e3', '123.4', 'owner-name', '00123'])(
  'requires canonical immutable numeric subject %s',
  (id) => {
    expect(() => loadConfig({ ...configured, GITHUB_OWNER_ID: id })).toThrow();
  },
);

test.each(['DB', 'OAUTH_KV'])('rejects unusable %s bindings', (key) => {
  expect(() => loadConfig({ ...configured, [key]: {} })).toThrow();
});
