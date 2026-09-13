import type { CallToolResult } from '@modelcontextprotocol/server';
import { mcpToolResultWireBytes } from '../domain/encoding';
import type { Outcome } from '../domain/types';

function payload<T>(result: Outcome<T>): CallToolResult {
  return {
    isError: !result.ok,
    structuredContent: result,
    content: [{ type: 'text', text: JSON.stringify(result) }],
  };
}

export function encodeToolResult<T>(
  result: Outcome<T>,
  limitBytes: number,
): CallToolResult {
  const encoded = payload(result);
  if (mcpToolResultWireBytes(encoded) <= limitBytes) return encoded;
  const requestId = result.ok ? result.request_id : result.error.request_id;
  return payload({
    ok: false,
    error: {
      code: 'RESPONSE_TOO_LARGE',
      message: 'response exceeds budget',
      retryable: false,
      request_id: requestId,
    },
  });
}
