export function publicHealth(version: string): {
  status: 'ok';
  version: string;
} {
  return { status: 'ok', version };
}

export function ownerStatus(input: {
  version: string;
  observed_calls: number;
  observed_errors: number;
}): {
  version: string;
  observed_calls: number;
  observed_errors: number;
  missed_chats: { observed: false; reason: 'impossible_to_observe' };
} {
  return {
    version: input.version,
    observed_calls: input.observed_calls,
    observed_errors: input.observed_errors,
    missed_chats: {
      observed: false,
      reason: 'impossible_to_observe',
    },
  };
}
