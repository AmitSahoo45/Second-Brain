import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { createHarness } from '../support/harness';

test('identical save retries replay the receipt', async () => {
  const h = await createHarness();
  try {
    const operationId = crypto.randomUUID();
    const note = h.note({ fact_key: 'synthetic.retry' });
    const first = await h.service.save(h.ctx, {
      project_id: h.projectId,
      note,
      operation_id: operationId,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.replayed).toBe(false);
    const retry = await h.service.save(h.ctx, {
      project_id: h.projectId,
      note,
      operation_id: operationId,
    });
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.data).toEqual({ ...first.data, replayed: true });
    expect((await h.counts(first.data.memory_id)).revisions).toBe(1);
  } finally {
    await h.dispose();
  }
});

test('changed payload with the same operation rejects', async () => {
  const h = await createHarness();
  try {
    const operationId = crypto.randomUUID();
    const first = await h.service.save(h.ctx, {
      project_id: h.projectId,
      note: h.note({ body: 'one' }),
      operation_id: operationId,
    });
    expect(first.ok).toBe(true);
    const second = await h.service.save(h.ctx, {
      project_id: h.projectId,
      note: h.note({ body: 'two' }),
      operation_id: operationId,
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe('IDEMPOTENCY_CONFLICT');
  } finally {
    await h.dispose();
  }
});

test('injected failures roll back current, revision, fts and receipt', async () => {
  const h = await createHarness();
  try {
    const seed = await h.seed();
    const before = await h.counts(seed.memory_id);
    for (const stage of ['revision', 'fts', 'audit', 'receipt'] as const) {
      h.failNext(stage);
      const result = await h.service.update(h.ctx, {
        project_id: h.projectId,
        memory_id: seed.memory_id,
        expected_revision: seed.revision,
        note: h.note({ body: `inject ${stage}` }),
        reason: 'correction: synthetic inject',
        operation_id: crypto.randomUUID(),
      });
      expect(result.ok).toBe(false);
      expect(await h.counts(seed.memory_id)).toEqual(before);
    }
  } finally {
    await h.dispose();
  }
});

test('100 lost-response retries stay at one revision', async () => {
  const h = await createHarness();
  try {
    const operationId = crypto.randomUUID();
    const note = h.note({ fact_key: 'synthetic.lost' });
    const input = {
      project_id: h.projectId,
      note,
      operation_id: operationId,
    };
    const first = await h.service.save(h.ctx, input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    for (let i = 0; i < 100; i++) {
      const retry = await h.service.save(h.ctx, input);
      expect(retry.ok).toBe(true);
      if (!retry.ok) return;
      expect(retry.data.replayed).toBe(true);
      expect(retry.data.memory_id).toBe(first.data.memory_id);
      expect(retry.data.revision).toBe(1);
    }
    expect((await h.counts(first.data.memory_id)).revisions).toBe(1);
  } finally {
    await h.dispose();
  }
}, 120000);

test('expired receipts are not auto-replayed', async () => {
  const h = await createHarness();
  try {
    const operationId = crypto.randomUUID();
    const first = await h.service.save(h.ctx, {
      project_id: h.projectId,
      note: h.note({ fact_key: 'synthetic.expired' }),
      operation_id: operationId,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await env.DB.prepare(
      'UPDATE mutation_receipts SET expires_at = ? WHERE operation_id = ?',
    )
      .bind('2000-01-01T00:00:00.000Z', operationId)
      .run();
    const retry = await h.service.save(h.ctx, {
      project_id: h.projectId,
      note: h.note({ fact_key: 'synthetic.expired' }),
      operation_id: operationId,
    });
    expect(retry.ok).toBe(false);
    if (retry.ok) return;
    expect(retry.error.code).not.toBeUndefined();
    expect((await h.counts(first.data.memory_id)).revisions).toBe(1);
  } finally {
    await h.dispose();
  }
});

test('duplicate fact keys conflict and actor snapshots stay on revisions', async () => {
  const h = await createHarness();
  try {
    const first = await h.service.save(h.ctx, {
      project_id: h.projectId,
      note: h.note({ fact_key: 'synthetic.dup', body: 'one' }),
      operation_id: crypto.randomUUID(),
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const dup = await h.service.save(h.ctx, {
      project_id: h.projectId,
      note: h.note({ fact_key: 'synthetic.dup', body: 'two' }),
      operation_id: crypto.randomUUID(),
    });
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.error.code).toBe('FACT_KEY_EXISTS');
    const updated = await h.service.update(h.ctx, {
      project_id: h.projectId,
      memory_id: first.data.memory_id,
      expected_revision: first.data.revision,
      note: h.note({
        fact_key: 'synthetic.dup',
        body: 'corrected',
        evidence: [{ kind: 'document', excerpt: 'synthetic excerpt' }],
      }),
      reason: 'correction: synthetic evidence',
      operation_id: crypto.randomUUID(),
    });
    expect(updated.ok).toBe(true);
    const rows = await env.DB.prepare(
      'SELECT revision, actor_client_label, fields_json FROM memory_revisions WHERE memory_id = ? ORDER BY revision',
    )
      .bind(first.data.memory_id)
      .all<{
        revision: number;
        actor_client_label: string;
        fields_json: string;
      }>();
    expect(rows.results).toHaveLength(2);
    expect(rows.results[0]?.actor_client_label).toBe('Synthetic');
    expect(rows.results[1]?.actor_client_label).toBe('Synthetic');
    expect(rows.results[1]?.fields_json).toContain('synthetic excerpt');
  } finally {
    await h.dispose();
  }
});

test('archived projects reject new writes', async () => {
  const h = await createHarness();
  try {
    await h.archiveProject();
    const result = await h.service.save(h.ctx, {
      project_id: h.projectId,
      note: h.note(),
      operation_id: crypto.randomUUID(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PROJECT_ARCHIVED');
  } finally {
    await h.dispose();
  }
});

test('oauth writes require live grant_projects membership', async () => {
  const h = await createHarness();
  try {
    const extraId = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      'INSERT INTO projects (project_id, owner_id, name, normalized_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(extraId, h.ctx.owner_id, 'Ungranted', 'ungranted', now, now)
      .run();
    const result = await h.service.save(
      { ...h.ctx, project_ids: [h.projectId, extraId] },
      {
        project_id: extraId,
        note: h.note(),
        operation_id: crypto.randomUUID(),
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  } finally {
    await h.dispose();
  }
});

test('same operation id and different payload conflict', async () => {
  const h = await createHarness();
  try {
    const operationId = crypto.randomUUID();
    const results = await Promise.all([
      h.service.save(h.ctx, {
        project_id: h.projectId,
        note: h.note({ body: 'alpha', fact_key: 'synthetic.payload.a' }),
        operation_id: operationId,
      }),
      h.service.save(h.ctx, {
        project_id: h.projectId,
        note: h.note({ body: 'beta', fact_key: 'synthetic.payload.b' }),
        operation_id: operationId,
      }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(
      results.filter((r) => !r.ok).map((r) => (r.ok ? '' : r.error.code)),
    ).toEqual(['IDEMPOTENCY_CONFLICT']);
  } finally {
    await h.dispose();
  }
});

test('related targets must exist in the same project', async () => {
  const h = await createHarness();
  try {
    const target = await h.seed();
    const related = await h.service.save(h.ctx, {
      project_id: h.projectId,
      note: h.note({
        related: [{ memory_id: target.memory_id, relation: 'related_to' }],
      }),
      operation_id: crypto.randomUUID(),
    });
    expect(related.ok).toBe(true);
    if (!related.ok) return;
    const edges = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM memory_relations WHERE source_memory_id = ?',
    )
      .bind(related.data.memory_id)
      .first<{ n: number }>();
    expect(edges?.n).toBe(1);
    const other = await h.service.save(h.ctx, {
      project_id: h.projectId,
      note: h.note({
        related: [
          {
            memory_id: '00000000-0000-4000-8000-000000000099',
            relation: 'supports',
          },
        ],
      }),
      operation_id: crypto.randomUUID(),
    });
    expect(other.ok).toBe(false);
    if (other.ok) return;
    expect(other.error.code).toBe('NOT_FOUND');
  } finally {
    await h.dispose();
  }
});
