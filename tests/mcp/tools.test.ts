import { expect, test } from 'vitest';
import type {
  AuthContext,
  MemoryService,
  Outcome,
} from '../../src/domain/types';
import {
  createMemoryMcpServer,
  MEMORY_INSTRUCTIONS,
  MEMORY_TOOL_CATALOG,
  MEMORY_TOOL_NAMES,
} from '../../src/mcp/tools';

function denied<T>(): Promise<Outcome<T>> {
  return Promise.resolve({
    ok: false,
    error: {
      code: 'NOT_FOUND',
      message: 'not found',
      retryable: false,
      request_id: '00000000-0000-4000-8000-000000000001',
    },
  });
}

const ctx: AuthContext = {
  owner_id: '00000000-0000-4000-8000-000000000001',
  actor_id: '00000000-0000-4000-8000-000000000002',
  actor_kind: 'oauth_grant',
  actor_client_label: 'Synthetic',
  grant_id: '00000000-0000-4000-8000-000000000002',
  project_ids: ['00000000-0000-4000-8000-000000000003'],
  scopes: ['memory:read', 'memory:write'],
};

const service: MemoryService = {
  save: () => denied(),
  update: () => denied(),
  read: () => denied(),
  search: () => denied(),
  context: () => denied(),
  history: () => denied(),
};

test('registers exactly seven contract tools', () => {
  expect([...MEMORY_TOOL_NAMES]).toEqual([
    'list_projects',
    'search_memory',
    'read_memory',
    'save_memory',
    'update_memory',
    'get_context',
    'get_history',
  ]);
  expect(MEMORY_TOOL_CATALOG).toHaveLength(7);
  expect(MEMORY_TOOL_NAMES).not.toContain('export_memory');
  expect(MEMORY_TOOL_NAMES).not.toContain('purge_memory');
  expect(MEMORY_TOOL_CATALOG.map((tool) => tool.name)).toEqual([
    ...MEMORY_TOOL_NAMES,
  ]);
  expect(MEMORY_INSTRUCTIONS).toMatch(/untrusted reference data/);
  expect(MEMORY_INSTRUCTIONS).toMatch(/successful receipt/);
  const server = createMemoryMcpServer({
    service,
    ctx,
    listProjects: () => denied(),
  });
  expect(server).toBeDefined();
});

test('catalog annotations match the MCP contract', () => {
  expect(
    MEMORY_TOOL_CATALOG.find((tool) => tool.name === 'save_memory'),
  ).toMatchObject({
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  expect(
    MEMORY_TOOL_CATALOG.find((tool) => tool.name === 'update_memory'),
  ).toMatchObject({
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  });
  for (const tool of MEMORY_TOOL_CATALOG) {
    if (tool.name === 'save_memory' || tool.name === 'update_memory') continue;
    expect(tool).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
  }
});
