import type { NoteFields } from '../../src/domain/types';

export function validSyntheticNote(
  overrides: Partial<NoteFields> = {},
): NoteFields {
  const note: NoteFields = {
    title: overrides.title ?? 'Synthetic probe fact',
    body: overrides.body ?? 'A short unverified synthetic fact for tests.',
    kind: overrides.kind ?? 'fact',
    lifecycle: overrides.lifecycle ?? 'active',
    provenance: overrides.provenance ?? 'unverified',
    tags: overrides.tags ?? [],
    aliases: overrides.aliases ?? [],
    evidence: overrides.evidence ?? [],
    related: overrides.related ?? [],
  };
  if (overrides.fact_key !== undefined) note.fact_key = overrides.fact_key;
  if (overrides.valid_from !== undefined)
    note.valid_from = overrides.valid_from;
  if (overrides.valid_until !== undefined)
    note.valid_until = overrides.valid_until;
  return note;
}
