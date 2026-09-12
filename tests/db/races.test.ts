import { expect, test } from 'vitest';
import { createHarness } from '../support/harness';

test('only one stale-revision contender commits', async () => {
  const h = await createHarness();
  try {
    const seed = await h.seed();
    const write = (body: string) =>
      h.service.update(h.ctx, {
        project_id: h.projectId,
        memory_id: seed.memory_id,
        expected_revision: seed.revision,
        note: h.note({ body }),
        reason: 'correction: synthetic race',
        operation_id: crypto.randomUUID(),
      });
    const results = await Promise.all([write('A'), write('B')]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(
      results.filter((r) => !r.ok).map((r) => (r.ok ? '' : r.error.code)),
    ).toEqual(['REVISION_CONFLICT']);
    expect((await h.counts(seed.memory_id)).revisions).toBe(2);
  } finally {
    await h.dispose();
  }
});

test('100 concurrent pairs leave one winner each', async () => {
  const h = await createHarness();
  try {
    for (let i = 0; i < 100; i++) {
      const seed = await h.seed({
        fact_key: `synthetic.race.${i}`,
        body: `seed ${i}`,
      });
      const write = (body: string) =>
        h.service.update(h.ctx, {
          project_id: h.projectId,
          memory_id: seed.memory_id,
          expected_revision: seed.revision,
          note: h.note({ body, fact_key: `synthetic.race.${i}` }),
          reason: 'correction: synthetic race',
          operation_id: crypto.randomUUID(),
        });
      const results = await Promise.all([write(`A${i}`), write(`B${i}`)]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok)[0]?.ok).toBe(false);
      expect((await h.counts(seed.memory_id)).revisions).toBe(2);
    }
  } finally {
    await h.dispose();
  }
}, 120000);
