import { assertNoteFitsRead } from './encoding';
import { canonicalJson } from './canonical';
import type {
  EvidenceKind,
  EvidenceRef,
  Kind,
  Lifecycle,
  NoteFields,
  Provenance,
  RelatedRef,
  Relation,
} from './types';

export const maximumTitleCodePoints = 160;
export const maximumBodyBytes = 8192;
export const maximumNoteBytes = 12288;
export const maximumEvidence = 8;
export const maximumRelated = 8;
export const maximumTags = 12;
export const maximumTagCodePoints = 64;
export const maximumExcerptCodePoints = 500;
export const maximumLocatorCodePoints = 2048;
export const factKeyPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/;
export const idPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const instantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

const kinds = new Set<Kind>([
  'fact',
  'preference',
  'decision',
  'progress',
  'next_step',
  'question',
]);
const lifecycles = new Set<Lifecycle>(['active', 'disputed', 'archived']);
const provenances = new Set<Provenance>([
  'user_stated',
  'source_supported',
  'inference',
  'unverified',
]);
const evidenceKinds = new Set<EvidenceKind>([
  'user_message',
  'document',
  'code',
  'test_result',
  'assistant_report',
]);
const relations = new Set<Relation>(['supports', 'contradicts', 'related_to']);
const noteKeys = new Set([
  'title',
  'body',
  'kind',
  'lifecycle',
  'provenance',
  'fact_key',
  'tags',
  'aliases',
  'evidence',
  'valid_from',
  'valid_until',
  'related',
]);
const encoder = new TextEncoder();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function codePoints(value: string): number {
  return [...value].length;
}

function lineEnds(value: string): string {
  return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function nfc(value: string): string {
  return value.normalize('NFC');
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  return value;
}

function instant(value: unknown, label: string): string {
  const text = requiredString(value, label);
  if (!instantPattern.test(text) || Number.isNaN(Date.parse(text)))
    throw new Error(`invalid ${label}`);
  return text;
}

function uniqueSorted(values: unknown, label: string): string[] {
  if (!Array.isArray(values)) throw new Error(`${label} must be an array`);
  if (values.length > maximumTags) throw new Error(`${label} exceed limit`);
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of values) {
    const text = nfc(lineEnds(requiredString(item, label)).trim());
    if (!text) throw new Error(`${label} cannot be empty`);
    if (codePoints(text) > maximumTagCodePoints)
      throw new Error(`${label} exceed 64 code points`);
    if (seen.has(text)) continue;
    seen.add(text);
    normalized.push(text);
  }
  return normalized.sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function evidenceRef(value: unknown): EvidenceRef {
  if (!isRecord(value)) throw new Error('invalid evidence');
  for (const key of Object.keys(value)) {
    if (
      key !== 'kind' &&
      key !== 'locator' &&
      key !== 'excerpt' &&
      key !== 'event_at'
    )
      throw new Error('unknown field');
  }
  const kind = value.kind;
  if (typeof kind !== 'string' || !evidenceKinds.has(kind as EvidenceKind))
    throw new Error('unsupported evidence kind');
  const result: EvidenceRef = { kind: kind as EvidenceKind };
  if ('locator' in value) {
    const locator = nfc(
      lineEnds(requiredString(value.locator, 'locator')).trim(),
    );
    if (!locator) throw new Error('empty evidence');
    if (codePoints(locator) > maximumLocatorCodePoints)
      throw new Error('locator exceeds 2048 code points');
    result.locator = locator;
  }
  if ('excerpt' in value) {
    const excerpt = nfc(
      lineEnds(requiredString(value.excerpt, 'excerpt')).trim(),
    );
    if (!excerpt) throw new Error('empty evidence');
    if (codePoints(excerpt) > maximumExcerptCodePoints)
      throw new Error('excerpt exceeds 500 code points');
    result.excerpt = excerpt;
  }
  if ('event_at' in value)
    result.event_at = instant(value.event_at, 'event_at');
  if (!result.locator && !result.excerpt) throw new Error('empty evidence');
  return result;
}

function relatedRef(value: unknown): RelatedRef {
  if (!isRecord(value)) throw new Error('invalid related');
  for (const key of Object.keys(value)) {
    if (key !== 'memory_id' && key !== 'relation')
      throw new Error('unknown field');
  }
  const memoryId = requiredString(value.memory_id, 'memory_id');
  if (!idPattern.test(memoryId)) throw new Error('invalid memory_id');
  const relation = value.relation;
  if (typeof relation !== 'string' || !relations.has(relation as Relation))
    throw new Error('unsupported relation');
  return { memory_id: memoryId, relation: relation as Relation };
}

export function validateNote(input: unknown): NoteFields {
  if (!isRecord(input)) throw new Error('invalid note');
  for (const key of Object.keys(input)) {
    if (!noteKeys.has(key)) throw new Error('unknown field');
  }
  const title = nfc(lineEnds(requiredString(input.title, 'title')).trim());
  if (!title) throw new Error('title cannot be empty');
  if (codePoints(title) > maximumTitleCodePoints)
    throw new Error('title exceeds 160 code points');
  const body = lineEnds(requiredString(input.body, 'body'));
  if (encoder.encode(body).byteLength > maximumBodyBytes)
    throw new Error('body exceeds 8 KiB');
  const kind = input.kind;
  if (typeof kind !== 'string' || !kinds.has(kind as Kind))
    throw new Error('unsupported kind');
  const lifecycle = input.lifecycle;
  if (typeof lifecycle !== 'string' || !lifecycles.has(lifecycle as Lifecycle))
    throw new Error('unsupported lifecycle');
  const provenance = input.provenance;
  if (
    typeof provenance !== 'string' ||
    !provenances.has(provenance as Provenance)
  )
    throw new Error('unsupported provenance');
  if (!Array.isArray(input.evidence))
    throw new Error('evidence must be an array');
  if (input.evidence.length > maximumEvidence)
    throw new Error('evidence exceeds limit');
  const evidence = input.evidence.map(evidenceRef);
  if (provenance === 'source_supported' && evidence.length === 0)
    throw new Error('source_supported requires evidence');
  if (!Array.isArray(input.related))
    throw new Error('related must be an array');
  if (input.related.length > maximumRelated)
    throw new Error('related exceeds limit');
  const related = input.related.map(relatedRef);
  const note: NoteFields = {
    title,
    body,
    kind: kind as Kind,
    lifecycle: lifecycle as Lifecycle,
    provenance: provenance as Provenance,
    tags: uniqueSorted(input.tags, 'tags'),
    aliases: uniqueSorted(input.aliases, 'aliases'),
    evidence,
    related,
  };
  if ('fact_key' in input) {
    const factKey = requiredString(input.fact_key, 'fact_key').toLowerCase();
    if (!factKeyPattern.test(factKey)) throw new Error('invalid fact_key');
    note.fact_key = factKey;
  }
  if ('valid_from' in input)
    note.valid_from = instant(input.valid_from, 'valid_from');
  if ('valid_until' in input)
    note.valid_until = instant(input.valid_until, 'valid_until');
  if (
    note.valid_from &&
    note.valid_until &&
    Date.parse(note.valid_until) <= Date.parse(note.valid_from)
  )
    throw new Error('invalid validity interval');
  if (encoder.encode(canonicalJson(note)).byteLength > maximumNoteBytes)
    throw new Error('note exceeds 12 KiB');
  assertNoteFitsRead(note);
  return note;
}
