import { expect, test } from 'vitest';
import { ownerStatus, publicHealth } from '../../src/operations/status';
import { serializeTelemetry } from '../../src/operations/telemetry';

const canary = 'CANARY-SECRET-TOKEN-DO-NOT-LOG';

test('telemetry allowlist omits canary secrets', () => {
  const encoded = serializeTelemetry(
    {
      request_id: '00000000-0000-4000-8000-000000000001',
      actor_id: '00000000-0000-4000-8000-000000000002',
      operation: 'search_memory',
      outcome: 'ok',
      duration_ms: 4,
      cpu_ms: 1,
      db_statements: 3,
    },
    {
      query: canary,
      input: { note: { body: canary, title: canary } },
      evidence: [{ excerpt: canary }],
    },
  );
  expect(encoded).not.toContain(canary);
  expect(JSON.parse(encoded)).toEqual({
    request_id: '00000000-0000-4000-8000-000000000001',
    actor_id: '00000000-0000-4000-8000-000000000002',
    operation: 'search_memory',
    outcome: 'ok',
    duration_ms: 4,
    cpu_ms: 1,
    db_statements: 3,
  });
});

test('public health exposes version and status only', () => {
  expect(publicHealth('0.1.0')).toEqual({ status: 'ok', version: '0.1.0' });
  expect(Object.keys(publicHealth('0.1.0')).sort()).toEqual([
    'status',
    'version',
  ]);
});

test('owner status separates observed calls from missed chats', () => {
  expect(
    ownerStatus({
      version: '0.1.0',
      observed_calls: 12,
      observed_errors: 1,
    }),
  ).toEqual({
    version: '0.1.0',
    observed_calls: 12,
    observed_errors: 1,
    missed_chats: { observed: false, reason: 'impossible_to_observe' },
  });
});
