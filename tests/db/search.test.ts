import { expect, test } from 'vitest';
import { createHarness } from '../support/harness';

test('another owner cannot retrieve a seeded exact title', async () => {
  const h = await createHarness();
  try {
    await h.seed({ title: 'SYNTHETIC-ALPHA' });
    const r = await h.service.search(h.otherCtx, {
      project_id: h.projectId,
      query: 'SYNTHETIC-ALPHA',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
  } finally {
    await h.dispose();
  }
});

test('same-project search from another owner is empty', async () => {
  const h = await createHarness();
  try {
    await h.seed({ title: 'SYNTHETIC-ALPHA' });
    const r = await h.service.search(h.otherCtx, {
      project_id: h.otherProjectId,
      query: 'SYNTHETIC-ALPHA',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.items).toEqual([]);
    expect(r.data.truncated).toBe(false);
  } finally {
    await h.dispose();
  }
});

test('authorized search of an archived project is empty', async () => {
  const h = await createHarness();
  try {
    await h.seed({ title: 'SYNTHETIC-ARCHIVE' });
    await h.archiveProject();
    const r = await h.service.search(h.ctx, {
      project_id: h.projectId,
      query: 'SYNTHETIC-ARCHIVE',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.items).toEqual([]);
    const invalid = await h.service.search(h.ctx, {
      project_id: h.projectId,
      query: 'x'.repeat(513),
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.code).toBe('VALIDATION_ERROR');
  } finally {
    await h.dispose();
  }
});

test('archived notes are excluded from search', async () => {
  const h = await createHarness();
  try {
    const seed = await h.seed({ title: 'SYNTHETIC-NOTE-ARCHIVE' });
    const archived = await h.service.update(h.ctx, {
      project_id: h.projectId,
      memory_id: seed.memory_id,
      expected_revision: seed.revision,
      note: h.note({ title: 'SYNTHETIC-NOTE-ARCHIVE', lifecycle: 'archived' }),
      reason: 'correction: archive synthetic note',
      operation_id: crypto.randomUUID(),
    });
    expect(archived.ok).toBe(true);
    const r = await h.service.search(h.ctx, {
      project_id: h.projectId,
      query: 'SYNTHETIC-NOTE-ARCHIVE',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.items).toEqual([]);
  } finally {
    await h.dispose();
  }
});

test('revoked grant cannot search', async () => {
  const h = await createHarness();
  try {
    await h.seed({ title: 'SYNTHETIC-REVOKED' });
    await h.revokeActor();
    const r = await h.service.search(h.ctx, {
      project_id: h.projectId,
      query: 'SYNTHETIC-REVOKED',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
  } finally {
    await h.dispose();
  }
});

test('write-only scopes cannot search', async () => {
  const h = await createHarness();
  try {
    await h.seed({ title: 'SYNTHETIC-SCOPE' });
    const r = await h.service.search(
      { ...h.ctx, scopes: ['memory:write'] },
      { project_id: h.projectId, query: 'SYNTHETIC-SCOPE' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('NOT_FOUND');
      expect(r.error.current_revision).toBeUndefined();
    }
  } finally {
    await h.dispose();
  }
});

test('ranking is fact key, title, alias, then full text', async () => {
  const h = await createHarness();
  try {
    const fts = await h.seed({
      title: 'unrelated fts',
      body: 'contains synthetic.rank token',
      fact_key: 'synthetic.rank.fts',
    });
    const alias = await h.seed({
      title: 'unrelated alias',
      aliases: ['synthetic.rank'],
      fact_key: 'synthetic.rank.alias',
    });
    const title = await h.seed({
      title: 'synthetic.rank',
      fact_key: 'synthetic.rank.title',
    });
    const key = await h.seed({
      title: 'unrelated key',
      fact_key: 'synthetic.rank',
    });
    const r = await h.service.search(h.ctx, {
      project_id: h.projectId,
      query: 'synthetic.rank',
      limit: 20,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.items.map((item) => item.memory_id)).toEqual([
      key.memory_id,
      title.memory_id,
      alias.memory_id,
      fts.memory_id,
    ]);
    expect(r.data.items.map((item) => item.match_reason)).toEqual([
      'fact_key',
      'title',
      'alias',
      'full_text',
    ]);
  } finally {
    await h.dispose();
  }
});

test('literal punctuation, UUID, Bengali and romanized aliases match', async () => {
  const h = await createHarness();
  try {
    const punct = await h.seed({
      title: 'C#/.NET',
      fact_key: 'synthetic.punct',
    });
    const uuid = await h.seed({
      title: 'uuid carrier',
      body: 'id 550e8400-e29b-41d4-a716-446655440000',
      fact_key: 'synthetic.uuid',
    });
    const bengali = await h.seed({
      title: 'কৃত্রিম তথ্য',
      aliases: ['kritrim'],
      fact_key: 'synthetic.bn',
    });
    const quoted = await h.seed({
      title: 'hello-world',
      body: 'quoted punctuation "hello, world!"',
      fact_key: 'synthetic.quoted',
    });
    const cases = [
      { query: 'C#/.NET', id: punct.memory_id, reason: 'title' },
      {
        query: '550e8400-e29b-41d4-a716-446655440000',
        id: uuid.memory_id,
        reason: 'full_text',
      },
      { query: 'কৃত্রিম তথ্য', id: bengali.memory_id, reason: 'title' },
      { query: 'kritrim', id: bengali.memory_id, reason: 'alias' },
      { query: 'hello-world', id: quoted.memory_id, reason: 'title' },
    ] as const;
    for (const item of cases) {
      const r = await h.service.search(h.ctx, {
        project_id: h.projectId,
        query: item.query,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.data.items[0]?.memory_id).toBe(item.id);
      expect(r.data.items[0]?.match_reason).toBe(item.reason);
      expect(r.data.items[0]?.snippet_is_excerpt).toBe(true);
      expect([...(r.data.items[0]?.snippet ?? '')].length).toBeLessThanOrEqual(
        240,
      );
      expect(r.data.items[0]).not.toHaveProperty('owner_id');
      expect(r.data.items[0]).not.toHaveProperty('body');
    }
  } finally {
    await h.dispose();
  }
});

test('FTS prefix operators do not widen same-project recall', async () => {
  const h = await createHarness();
  try {
    await h.seed({
      title: 'prefix-only',
      body: 'foobarqux',
      fact_key: 'synthetic.fts.prefix',
    });
    const r = await h.service.search(h.ctx, {
      project_id: h.projectId,
      query: 'foo*',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.items).toEqual([]);
  } finally {
    await h.dispose();
  }
});

test('caller FTS operators are literal terms', async () => {
  const h = await createHarness();
  try {
    await h.seed({
      title: 'operator alpha',
      body: 'alpha only',
      fact_key: 'synthetic.op.alpha',
    });
    const r = await h.service.search(h.ctx, {
      project_id: h.projectId,
      query: 'alpha OR zzzz-not-present',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.items).toEqual([]);
  } finally {
    await h.dispose();
  }
});

test('search defaults to five, paginates, and rejects tampered cursors', async () => {
  const h = await createHarness();
  try {
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const seed = await h.seed({
        title: `page ${String(i).padStart(2, '0')}`,
        body: 'SYNTHETIC-PAGE token',
        fact_key: `synthetic.page.${i}`,
      });
      ids.push(seed.memory_id);
    }
    const first = await h.service.search(h.ctx, {
      project_id: h.projectId,
      query: 'SYNTHETIC-PAGE',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.items).toHaveLength(5);
    expect(first.data.truncated).toBe(true);
    const cursor = first.data.next_cursor;
    expect(cursor).toEqual(expect.any(String));
    if (!cursor) return;
    expect(first.data.items.every((item) => ids.includes(item.memory_id))).toBe(
      true,
    );
    const second = await h.service.search(h.ctx, {
      project_id: h.projectId,
      query: 'SYNTHETIC-PAGE',
      cursor,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.items.length).toBeGreaterThan(0);
    const overlap = second.data.items.filter((item) =>
      first.data.items.some((prior) => prior.memory_id === item.memory_id),
    );
    expect(overlap).toEqual([]);
    const changed = await h.service.search(h.ctx, {
      project_id: h.projectId,
      query: 'SYNTHETIC-PAGE',
      kinds: ['decision'],
      cursor,
    });
    expect(changed.ok).toBe(false);
    if (!changed.ok) expect(changed.error.code).toBe('VALIDATION_ERROR');
    const tampered =
      cursor.slice(0, -2) + (cursor.endsWith('aa') ? 'bb' : 'aa');
    const bad = await h.service.search(h.ctx, {
      project_id: h.projectId,
      query: 'SYNTHETIC-PAGE',
      cursor: tampered,
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('VALIDATION_ERROR');
    const lastId = ids[7];
    if (!lastId) return;
    await h.service.update(h.ctx, {
      project_id: h.projectId,
      memory_id: lastId,
      expected_revision: 1,
      note: h.note({
        title: 'page 07 updated',
        body: 'SYNTHETIC-PAGE token',
        fact_key: 'synthetic.page.7',
      }),
      reason: 'correction: concurrent page',
      operation_id: crypto.randomUUID(),
    });
    const after = await h.service.search(h.ctx, {
      project_id: h.projectId,
      query: 'SYNTHETIC-PAGE',
      cursor,
    });
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(
      [...first.data.items, ...after.data.items].every(
        (item) =>
          item.snippet_is_excerpt &&
          item.lifecycle !== 'archived' &&
          ids.includes(item.memory_id),
      ),
    ).toBe(true);
  } finally {
    await h.dispose();
  }
});

test('oversize queries and archived lifecycle filters are rejected', async () => {
  const h = await createHarness();
  try {
    const long = await h.service.search(h.ctx, {
      project_id: h.projectId,
      query: 'x'.repeat(513),
    });
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.error.code).toBe('VALIDATION_ERROR');
    const tokens = await h.service.search(h.ctx, {
      project_id: h.projectId,
      query: Array.from({ length: 25 }, (_, i) => `t${i}`).join(' '),
    });
    expect(tokens.ok).toBe(false);
    if (!tokens.ok) expect(tokens.error.code).toBe('VALIDATION_ERROR');
    const archived = await h.service.search(h.ctx, {
      project_id: h.projectId,
      query: 'alpha',
      lifecycle: 'archived' as 'active',
    });
    expect(archived.ok).toBe(false);
    if (!archived.ok) expect(archived.error.code).toBe('VALIDATION_ERROR');
    const tooMany = await h.service.search(h.ctx, {
      project_id: h.projectId,
      query: 'alpha',
      limit: 21,
    });
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.error.code).toBe('VALIDATION_ERROR');
  } finally {
    await h.dispose();
  }
});
