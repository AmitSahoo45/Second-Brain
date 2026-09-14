import type { MemoryRecord, NoteFields } from './types';

export const maximumMemoryOutputBytes = 24576;
export const maximumRpcIdBytes = 256;
export const maximumMemoryRevision = Number.MAX_SAFE_INTEGER;

const encoder = new TextEncoder();
const reservedId = 'x'.repeat(maximumRpcIdBytes - 2);
const reservedActorLabel = '\u0800'.repeat(80);
const reservedInstant = '9999-12-31T23:59:59.999Z';
const reservedIdValue = 'ffffffff-ffff-4fff-bfff-ffffffffffff';

export function prospectiveRecord(note: NoteFields): MemoryRecord {
  return {
    ...note,
    memory_id: reservedIdValue,
    project_id: reservedIdValue,
    revision: maximumMemoryRevision,
    created_at: reservedInstant,
    updated_at: reservedInstant,
    actor_id: reservedIdValue,
    actor_kind: 'oauth_grant',
    actor_client_label: reservedActorLabel,
  };
}

export function mcpToolResultWireBytes(result: unknown): number {
  const wire =
    'event: message\ndata: ' +
    JSON.stringify({ jsonrpc: '2.0', id: reservedId, result }) +
    '\n\n';
  return encoder.encode(wire).byteLength;
}

export function encodeToolOutcome(data: unknown) {
  const structuredContent = {
    ok: true as const,
    data,
    request_id: reservedIdValue,
  };
  const result = {
    isError: false,
    structuredContent,
    content: [
      { type: 'text' as const, text: JSON.stringify(structuredContent) },
    ],
  };
  if (mcpToolResultWireBytes(result) > maximumMemoryOutputBytes)
    throw new Error(
      'RESPONSE_TOO_LARGE: complete read cannot fit the 24 KiB envelope',
    );
  return result;
}

export function encodeMemoryRead(data: {
  record: MemoryRecord;
  historical: boolean;
}) {
  if (!Number.isSafeInteger(data.record.revision) || data.record.revision < 1)
    throw new Error('Invalid memory revision');
  return encodeToolOutcome(data);
}

export function assertNoteFitsRead(note: NoteFields): void {
  encodeMemoryRead({
    record: prospectiveRecord(note),
    historical: false,
  });
}
