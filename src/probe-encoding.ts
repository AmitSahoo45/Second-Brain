// T01-only encoding shared by storage admission and the MCP adapter.
export const maximumProbeInputBytes = 8192;
export const maximumProbeOutputBytes = 24576;
export const maximumRpcIdBytes = 256;
export const maximumProbeRevision = Number.MAX_SAFE_INTEGER;

const encoder = new TextEncoder();
const reservedId = 'x'.repeat(maximumRpcIdBytes - 2);

export function encodeProbeResult(data: {
  value?: string | null;
  revision: number;
}) {
  if (!Number.isSafeInteger(data.revision) || data.revision < 0)
    throw new Error('Invalid probe revision');
  const structuredContent =
    data.value === undefined
      ? { revision: data.revision }
      : { value: data.value, revision: data.revision };
  const result = {
    isError: false,
    structuredContent,
    content: [
      { type: 'text' as const, text: JSON.stringify(structuredContent) },
    ],
  };
  // The current stateless SDK emits this fixed SSE frame despite responseMode:
  // 'json'. Reserve it too; a plain JSON response is smaller. No event store,
  // event IDs, progress notifications, or additional output metadata are used.
  const wire =
    'event: message\ndata: ' +
    JSON.stringify({ jsonrpc: '2.0', id: reservedId, result }) +
    '\n\n';
  if (encoder.encode(wire).byteLength > maximumProbeOutputBytes)
    throw new Error('Probe response exceeds budget');
  return result;
}

export function assertProbeValueFits(value: string): void {
  if (
    !value.startsWith('synthetic:') ||
    encoder.encode(value).byteLength > maximumProbeInputBytes
  )
    throw new Error('Probe value exceeds budget');
  // A successful write must remain readable at every supported future revision.
  encodeProbeResult({ value, revision: maximumProbeRevision });
}
