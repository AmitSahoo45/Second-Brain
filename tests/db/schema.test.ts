import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { insertRelation } from '../../src/db/repository';
import memorySql from '../../src/db/migrations/0004_memory.sql?raw';
import opsSql from '../../src/db/migrations/0005_ops.sql?raw';
import { createHarness } from '../support/harness';

test('memory migrations are additive', () => {
  expect(memorySql).not.toMatch(/\bDROP\b/i);
  expect(opsSql).not.toMatch(/\bDROP\b/i);
  expect(memorySql).toMatch(/CREATE VIRTUAL TABLE memory_fts/i);
});

test('empty local D1 migrates and seeds canonical plus FTS rows', async () => {
  const h = await createHarness();
  try {
    const receipt = await h.seed({
      fact_key: 'synthetic.alpha',
      title: 'SYNTHETIC-ALPHA',
    });
    expect(receipt.revision).toBe(1);
    expect(receipt.replayed).toBe(false);
    const counts = await h.counts(receipt.memory_id);
    expect(counts).toEqual({
      current: 1,
      revisions: 1,
      fts: 1,
      receipts: 1,
    });
    const title = await env.DB.prepare(
      'SELECT m.title AS title FROM memories m JOIN memory_fts f ON f.rowid = m.rowid WHERE m.memory_id = ?',
    )
      .bind(receipt.memory_id)
      .first<{ title: string }>();
    expect(title?.title).toBe('SYNTHETIC-ALPHA');
  } finally {
    await h.dispose();
  }
});

test('fact keys are unique per owner and project', async () => {
  const h = await createHarness();
  try {
    await h.seed({ fact_key: 'synthetic.shared' });
    await expect(h.seed({ fact_key: 'synthetic.shared' })).rejects.toThrow();
  } finally {
    await h.dispose();
  }
});

test('revision must be at least 1', async () => {
  const h = await createHarness();
  try {
    await expect(
      env.DB.prepare(
        "INSERT INTO memories (memory_id, owner_id, project_id, revision, title, body, kind, lifecycle, provenance, tags_json, aliases_json, evidence_json, related_json, created_at, updated_at, actor_id, actor_kind, actor_client_label, mutation_attempt_id) VALUES (?, ?, ?, 0, 't', 'b', 'fact', 'active', 'unverified', '[]', '[]', '[]', '[]', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', ?, 'oauth_grant', 'Synthetic', ?)",
      )
        .bind(
          crypto.randomUUID(),
          h.ctx.owner_id,
          h.projectId,
          h.ctx.actor_id,
          crypto.randomUUID(),
        )
        .run(),
    ).rejects.toThrow();
  } finally {
    await h.dispose();
  }
});

test('relations cannot cross projects', async () => {
  const h = await createHarness();
  try {
    const source = await h.seed();
    const other = await createHarness();
    try {
      const target = await other.seed();
      await expect(
        insertRelation(
          env.DB,
          h.ctx.owner_id,
          h.projectId,
          source.memory_id,
          target.memory_id,
          'related_to',
        ),
      ).rejects.toThrow();
    } finally {
      await other.dispose();
    }
  } finally {
    await h.dispose();
  }
});

test('two-owner fixtures stay isolated', async () => {
  const h = await createHarness();
  try {
    expect(h.ctx.owner_id).not.toBe(h.otherCtx.owner_id);
    expect(h.projectId).not.toBe(h.otherProjectId);
    const seeded = await h.seed({ title: 'Owner one note' });
    const otherCounts = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM memories WHERE owner_id = ?',
    )
      .bind(h.otherCtx.owner_id)
      .first<{ n: number }>();
    expect(otherCounts?.n).toBe(0);
    expect(seeded.project_id).toBe(h.projectId);
  } finally {
    await h.dispose();
  }
});
