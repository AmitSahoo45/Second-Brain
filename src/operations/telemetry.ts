export interface TelemetryEvent {
  request_id: string;
  actor_id: string;
  operation: string;
  outcome: string;
  duration_ms: number;
  cpu_ms?: number;
  db_statements?: number;
}

export function serializeTelemetry(
  event: TelemetryEvent,
  _untrusted?: unknown,
): string {
  const payload: Record<string, string | number> = {
    request_id: event.request_id,
    actor_id: event.actor_id,
    operation: event.operation,
    outcome: event.outcome,
    duration_ms: event.duration_ms,
  };
  if (event.cpu_ms !== undefined) payload.cpu_ms = event.cpu_ms;
  if (event.db_statements !== undefined)
    payload.db_statements = event.db_statements;
  return JSON.stringify(payload);
}
