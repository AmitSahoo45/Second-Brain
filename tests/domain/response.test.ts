import { expect, test } from 'vitest';
import { mcpToolResultWireBytes } from '../../src/domain/encoding';
import { encodeToolResult } from '../../src/mcp/response';

test('domain errors use isError and JSON text', () => {
  const result = encodeToolResult(
    {
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'not found',
        retryable: false,
        request_id: '00000000-0000-4000-8000-000000000001',
      },
    },
    24576,
  );
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({
    ok: false,
    error: { code: 'NOT_FOUND' },
  });
  expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(
    result.structuredContent,
  );
});

test('oversized success becomes RESPONSE_TOO_LARGE', () => {
  const result = encodeToolResult(
    {
      ok: true,
      data: { value: 'x'.repeat(4000) },
      request_id: '00000000-0000-4000-8000-000000000001',
    },
    256,
  );
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({
    ok: false,
    error: { code: 'RESPONSE_TOO_LARGE' },
  });
});

test('tool results reserve the SSE jsonrpc envelope', () => {
  const encoder = new TextEncoder();
  let n = 11800;
  let outcome = {
    ok: true as const,
    data: { value: 'x'.repeat(n) },
    request_id: '00000000-0000-4000-8000-000000000001',
  };
  let encoded = {
    isError: false,
    structuredContent: outcome,
    content: [{ type: 'text' as const, text: JSON.stringify(outcome) }],
  };
  while (
    encoder.encode(JSON.stringify(encoded)).byteLength <= 24576 &&
    mcpToolResultWireBytes(encoded) <= 24576
  ) {
    n += 20;
    outcome = {
      ok: true,
      data: { value: 'x'.repeat(n) },
      request_id: '00000000-0000-4000-8000-000000000001',
    };
    encoded = {
      isError: false,
      structuredContent: outcome,
      content: [{ type: 'text' as const, text: JSON.stringify(outcome) }],
    };
  }
  expect(
    encoder.encode(JSON.stringify(encoded)).byteLength,
  ).toBeLessThanOrEqual(24576);
  expect(mcpToolResultWireBytes(encoded)).toBeGreaterThan(24576);
  const result = encodeToolResult(outcome, 24576);
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({
    ok: false,
    error: { code: 'RESPONSE_TOO_LARGE' },
  });
});
