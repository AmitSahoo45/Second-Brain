import { expect, test } from 'vitest';
import {
  canonicalRequest,
  hashRequest,
  parseBoundedJson,
} from '../../src/domain/canonical';
import { assertNoteFitsRead } from '../../src/domain/encoding';
import { validateNote } from '../../src/domain/validation';
import { validSyntheticNote } from '../support/fixtures';

test('support labels require a usable reference', () => {
  expect(() =>
    validateNote({
      ...validSyntheticNote(),
      provenance: 'source_supported',
      evidence: [],
    }),
  ).toThrow();
});

test('unknown identity fields reject', () => {
  expect(() =>
    validateNote({
      ...validSyntheticNote(),
      owner_id: crypto.randomUUID(),
    } as unknown),
  ).toThrow();
  expect(() =>
    validateNote({ ...validSyntheticNote(), revision: 1 } as unknown),
  ).toThrow();
});

test('empty evidence objects reject', () => {
  expect(() =>
    validateNote({
      ...validSyntheticNote(),
      evidence: [{ kind: 'document' }],
    }),
  ).toThrow();
});

test('unsupported lifecycle rejects', () => {
  expect(() =>
    validateNote({
      ...validSyntheticNote(),
      lifecycle: 'published',
    } as unknown),
  ).toThrow();
});

test('over-limit Unicode code points and bytes reject', () => {
  expect(() =>
    validateNote(validSyntheticNote({ title: 'é'.repeat(161) })),
  ).toThrow();
  expect(
    validateNote(validSyntheticNote({ title: 'é'.repeat(160) })).title.length,
  ).toBeGreaterThan(0);
  expect(() =>
    validateNote(validSyntheticNote({ body: 'a'.repeat(8193) })),
  ).toThrow();
  validateNote(validSyntheticNote({ body: 'a'.repeat(8192) }));
});

test('invalid validity interval rejects', () => {
  expect(() =>
    validateNote(
      validSyntheticNote({
        valid_from: '2026-09-12T15:00:00Z',
        valid_until: '2026-09-12T15:00:00Z',
      }),
    ),
  ).toThrow();
});

test('cross-project relation fields reject', () => {
  expect(() =>
    validateNote({
      ...validSyntheticNote(),
      related: [
        {
          memory_id: '00000000-0000-4000-8000-000000000001',
          relation: 'related_to',
          project_id: '00000000-0000-4000-8000-000000000002',
        },
      ],
    } as unknown),
  ).toThrow();
});

test('normalization is stable for hashing', async () => {
  const left = validateNote(
    validSyntheticNote({
      title: '  Café\r\n',
      tags: ['Beta', 'alpha', 'alpha'],
      aliases: ['e\u0301tude', 'other'],
    }),
  );
  const right = validateNote(
    validSyntheticNote({
      title: 'Café',
      tags: ['alpha', 'Beta'],
      aliases: ['étude', 'other'],
    }),
  );
  expect(left.title).toBe('Café');
  expect(left.tags).toEqual(['Beta', 'alpha']);
  expect(await hashRequest(canonicalRequest('save_memory', 'p', left))).toBe(
    await hashRequest(canonicalRequest('save_memory', 'p', right)),
  );
});

test('duplicate JSON keys reject at the bounded input layer', () => {
  expect(() => parseBoundedJson('{"title":"a","title":"b"}')).toThrow();
});

test('prototype keys cannot pollute parsed or validated notes', () => {
  expect(() => parseBoundedJson('{"__proto__":{"title":"x"}}')).toThrow();
  expect(() =>
    validateNote(
      Object.assign(Object.create({ title: 'x', body: 'y' }), {
        kind: 'fact',
        lifecycle: 'active',
        provenance: 'unverified',
        tags: [],
        aliases: [],
        evidence: [],
        related: [],
      }),
    ),
  ).toThrow();
});

test('CRLF body order is preserved and tags sort after dedupe', () => {
  const note = validateNote(
    validSyntheticNote({
      body: 'line1\r\nline2\r\n',
      tags: ['z', 'a', 'z'],
    }),
  );
  expect(note.body).toBe('line1\nline2\n');
  expect(note.tags).toEqual(['a', 'z']);
});

test('worst-case escaping can exceed the read envelope', () => {
  expect(() =>
    assertNoteFitsRead(
      validateNote(
        validSyntheticNote({
          title: '"'.repeat(160),
          body: '"'.repeat(5000),
        }),
      ),
    ),
  ).toThrow(/RESPONSE_TOO_LARGE|complete read cannot fit/i);
});

test('an accepted synthetic note remains readable', () => {
  const note = validateNote(validSyntheticNote());
  expect(note.provenance).toBe('unverified');
  expect(note.evidence).toEqual([]);
});
