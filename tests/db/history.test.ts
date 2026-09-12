import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { listProjects } from '../../src/db/search';
import { syntheticHmacSecret } from '../support/fixtures';
import { createHarness } from '../support/harness';

test('current and explicit revision reads distinguish history', async () => {
  const h = await createHarness();
  try {
    const seed = await h.seed({
      title: 'history seed',
      body: 'revision one',
      fact_key: 'synthetic.history',
    });
    const updated = await h.service.update(h.ctx, {
      project_id: h.projectId,
      memory_id: seed.memory_id,
      expected_revision: seed.revision,
      note: h.note({
        title: 'history seed',
        body: 'revision two',
        fact_key: 'synthetic.history',
        provenance: 'user_stated',
      }),
      reason: 'correction: synthetic history',
      operation_id: crypto.randomUUID(),
    });
    expect(updated.ok).toBe(true);
    const current = await h.service.read(h.ctx, {
      project_id: h.projectId,
      memory_id: seed.memory_id,
    });
    expect(current.ok).toBe(true);
    if (!current.ok) return;
    expect(current.data.historical).toBe(false);
    expect(current.data.record.body).toBe('revision two');
    expect(current.data.record.revision).toBe(2);
    expect(current.data.record.actor_client_label).toBe('Synthetic');
    const old = await h.service.read(h.ctx, {
      project_id: h.projectId,
      memory_id: seed.memory_id,
      revision: 1,
    });
    expect(old.ok).toBe(true);
    if (!old.ok) return;
    expect(old.data.historical).toBe(true);
    expect(old.data.record.body).toBe('revision one');
    expect(old.data.record.revision).toBe(1);
    const namedCurrent = await h.service.read(h.ctx, {
      project_id: h.projectId,
      memory_id: seed.memory_id,
      revision: 2,
    });
    expect(namedCurrent.ok).toBe(true);
    if (!namedCurrent.ok) return;
    expect(namedCurrent.data.historical).toBe(false);
  } finally {
    await h.dispose();
  }
});

test('history paginates metadata newest first', async () => {
  const h = await createHarness();
  try {
    const seed = await h.seed({
      title: 'paged history',
      body: 'r1',
      fact_key: 'synthetic.hist.page',
    });
    for (const body of ['r2', 'r3']) {
      const current = await h.service.read(h.ctx, {
        project_id: h.projectId,
        memory_id: seed.memory_id,
      });
      expect(current.ok).toBe(true);
      if (!current.ok) return;
      const updated = await h.service.update(h.ctx, {
        project_id: h.projectId,
        memory_id: seed.memory_id,
        expected_revision: current.data.record.revision,
        note: h.note({
          title: 'paged history',
          body,
          fact_key: 'synthetic.hist.page',
        }),
        reason: `correction: ${body}`,
        operation_id: crypto.randomUUID(),
      });
      expect(updated.ok).toBe(true);
    }
    const page = await h.service.history(h.ctx, {
      project_id: h.projectId,
      memory_id: seed.memory_id,
      limit: 2,
    });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.data.revisions.map((item) => item.revision)).toEqual([3, 2]);
    expect(page.data.revisions[0]?.reason).toBe('correction: r3');
    expect(page.data.next_before_revision).toBe(2);
    const before = page.data.next_before_revision;
    if (before === undefined) return;
    const rest = await h.service.history(h.ctx, {
      project_id: h.projectId,
      memory_id: seed.memory_id,
      limit: 2,
      before_revision: before,
    });
    expect(rest.ok).toBe(true);
    if (!rest.ok) return;
    expect(rest.data.revisions.map((item) => item.revision)).toEqual([1]);
    expect(rest.data.revisions[0]?.reason).toBe('create');
    expect(rest.data.next_before_revision).toBeUndefined();
  } finally {
    await h.dispose();
  }
});

test('archived notes and projects remain readable with history', async () => {
  const h = await createHarness();
  try {
    const seed = await h.seed({
      title: 'keep reading',
      body: 'alive',
      fact_key: 'synthetic.keep',
    });
    const archived = await h.service.update(h.ctx, {
      project_id: h.projectId,
      memory_id: seed.memory_id,
      expected_revision: seed.revision,
      note: h.note({
        title: 'keep reading',
        body: 'archived body',
        lifecycle: 'archived',
        fact_key: 'synthetic.keep',
      }),
      reason: 'correction: archive note',
      operation_id: crypto.randomUUID(),
    });
    expect(archived.ok).toBe(true);
    await h.archiveProject();
    const read = await h.service.read(h.ctx, {
      project_id: h.projectId,
      memory_id: seed.memory_id,
    });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.data.record.lifecycle).toBe('archived');
    expect(read.data.record.body).toBe('archived body');
    const history = await h.service.history(h.ctx, {
      project_id: h.projectId,
      memory_id: seed.memory_id,
    });
    expect(history.ok).toBe(true);
    if (!history.ok) return;
    expect(history.data.revisions).toHaveLength(2);
  } finally {
    await h.dispose();
  }
});

test('unauthorized and missing reads hide existence', async () => {
  const h = await createHarness();
  try {
    const seed = await h.seed({ title: 'secret' });
    const other = await h.service.read(h.otherCtx, {
      project_id: h.projectId,
      memory_id: seed.memory_id,
    });
    expect(other.ok).toBe(false);
    if (!other.ok) {
      expect(other.error.code).toBe('NOT_FOUND');
      expect(other.error.current_revision).toBeUndefined();
    }
    const missing = await h.service.read(h.ctx, {
      project_id: h.projectId,
      memory_id: '00000000-0000-4000-8000-000000000099',
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('NOT_FOUND');
    const history = await h.service.history(h.otherCtx, {
      project_id: h.projectId,
      memory_id: seed.memory_id,
    });
    expect(history.ok).toBe(false);
    if (!history.ok) expect(history.error.code).toBe('NOT_FOUND');
  } finally {
    await h.dispose();
  }
});

test('listProjects hides archived and foreign projects', async () => {
  const h = await createHarness();
  try {
    const extraId = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO projects (project_id, owner_id, name, normalized_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(extraId, h.ctx.owner_id, 'Extra', 'extra', now, now),
      env.DB.prepare(
        'INSERT INTO grant_projects (grant_id, owner_id, project_id) VALUES (?, ?, ?)',
      ).bind(h.ctx.grant_id, h.ctx.owner_id, extraId),
    ]);
    const granted = {
      ...h.ctx,
      project_ids: [h.projectId, extraId, h.otherProjectId],
    };
    const listed = await listProjects(
      env.DB,
      granted,
      { limit: 1 },
      syntheticHmacSecret,
    );
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.data.projects).toHaveLength(1);
    const cursor = listed.data.next_cursor;
    expect(cursor).toEqual(expect.any(String));
    if (!cursor) return;
    const rest = await listProjects(
      env.DB,
      granted,
      {
        limit: 10,
        cursor,
      },
      syntheticHmacSecret,
    );
    expect(rest.ok).toBe(true);
    if (!rest.ok) return;
    const ids = [...listed.data.projects, ...rest.data.projects].map(
      (item) => item.project_id,
    );
    expect(ids.sort()).toEqual([extraId, h.projectId].sort());
    expect(ids).not.toContain(h.otherProjectId);
    await h.archiveProject();
    const after = await listProjects(
      env.DB,
      granted,
      { limit: 50 },
      syntheticHmacSecret,
    );
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.data.projects.map((item) => item.project_id)).toEqual([
      extraId,
    ]);
    const foreign = await listProjects(
      env.DB,
      h.otherCtx,
      {},
      syntheticHmacSecret,
    );
    expect(foreign.ok).toBe(true);
    if (!foreign.ok) return;
    expect(foreign.data.projects.map((item) => item.project_id)).toEqual([
      h.otherProjectId,
    ]);
    const tampered =
      cursor.slice(0, -2) + (cursor.endsWith('aa') ? 'bb' : 'aa');
    const bad = await listProjects(
      env.DB,
      granted,
      { cursor: tampered },
      syntheticHmacSecret,
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('VALIDATION_ERROR');
  } finally {
    await h.dispose();
  }
});
