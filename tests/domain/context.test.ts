import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { packContext, type ContextCandidate } from '../../src/domain/context';
import { encodeToolResult } from '../../src/mcp/response';
import type { MemoryRecord, SearchCard } from '../../src/domain/types';
import { createHarness } from '../support/harness';

function id(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function record(n: number, body: string): MemoryRecord {
  return {
    memory_id: id(n + 10),
    project_id: id(1),
    revision: n,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    actor_id: id(2),
    actor_kind: 'oauth_grant',
    actor_client_label: 'Synthetic',
    title: `বাংলা quote "${n}"`,
    body,
    kind: 'fact',
    lifecycle: 'active',
    provenance: n % 2 === 0 ? 'inference' : 'unverified',
    tags: ['synthetic', 'context'],
    aliases: [`alias-${n}`],
    evidence: [
      {
        kind: 'user_message',
        excerpt: `qualifier ${n} uncertain`,
      },
    ],
    related: [],
    valid_from: '2026-01-01T00:00:00.000Z',
    fact_key: `synthetic.context.${n}`,
  };
}

function cardFrom(
  rec: MemoryRecord,
  match_reason: SearchCard['match_reason'],
  snippet = `search-window-${rec.revision}`,
): SearchCard {
  const card: SearchCard = {
    memory_id: rec.memory_id,
    project_id: rec.project_id,
    revision: rec.revision,
    title: rec.title,
    snippet,
    snippet_is_excerpt: true,
    kind: rec.kind,
    lifecycle: rec.lifecycle,
    provenance: rec.provenance,
    updated_at: rec.updated_at,
    evidence: rec.evidence,
    match_reason,
  };
  if (rec.valid_from) card.valid_from = rec.valid_from;
  if (rec.valid_until) card.valid_until = rec.valid_until;
  return card;
}

function candidate(
  n: number,
  body: string,
  match_reason: SearchCard['match_reason'],
  from_profile = false,
  snippet?: string,
): ContextCandidate {
  const rec = record(n, body);
  return {
    record: rec,
    match_reason,
    from_profile,
    card: cardFrom(rec, match_reason, snippet),
  };
}

function longSyntheticRecords(): ContextCandidate[] {
  const reasons: SearchCard['match_reason'][] = [
    'fact_key',
    'title',
    'alias',
    'full_text',
  ];
  const body = 'He said "yes" — বাংলা. ' + 'x'.repeat(3500);
  return Array.from({ length: 8 }, (_, index) =>
    candidate(
      index + 1,
      body,
      reasons[index % reasons.length] ?? 'full_text',
      index === 7,
    ),
  );
}

test('context honors the final envelope budget', () => {
  const pack = packContext(longSyntheticRecords(), 2048);
  const result = encodeToolResult(
    {
      ok: true,
      data: pack,
      request_id: '00000000-0000-4000-8000-000000000001',
    },
    2048,
  );
  expect(
    new TextEncoder().encode(JSON.stringify(result)).length,
  ).toBeLessThanOrEqual(2048);
  expect(result.isError).toBe(false);
  const parsed = JSON.parse((result.content[0] as { text: string }).text) as {
    ok: true;
    data: typeof pack;
  };
  expect(parsed.ok).toBe(true);
  expect(parsed.data.items.length).toBeGreaterThan(0);
  for (const item of parsed.data.items) {
    if (item.representation === 'excerpt') {
      expect(item.expand_with).toBe('read_memory');
      expect(item.card.snippet_is_excerpt).toBe(true);
      expect(item.card.memory_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(item.card.provenance).toMatch(/inference|unverified/);
      expect(item.card.evidence.length).toBeGreaterThan(0);
      expect(item.card.snippet).toMatch(/^search-window-/);
    } else {
      expect(item.record.memory_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(item.record.provenance).toMatch(/inference|unverified/);
    }
  }
  expect(pack.truncated).toBe(true);
});

test('prefers full notes when they fit', () => {
  const pack = packContext(
    [candidate(1, 'short synthetic body', 'title')],
    8192,
  );
  expect(pack.truncated).toBe(false);
  expect(pack.profile_included).toBe(false);
  expect(pack.items).toEqual([
    { representation: 'full', record: record(1, 'short synthetic body') },
  ]);
});

test('omits oversized excerpts rather than dropping labels', () => {
  const rec = {
    ...record(9, 'tiny'),
    evidence: Array.from({ length: 8 }, (_, index) => ({
      kind: 'document' as const,
      locator: `https://example.test/${'a'.repeat(2000)}-${index}`,
      excerpt: 'q'.repeat(500),
    })),
  };
  const huge: ContextCandidate = {
    record: rec,
    match_reason: 'full_text',
    from_profile: false,
    card: cardFrom(rec, 'full_text'),
  };
  const pack = packContext([huge], 2048);
  expect(pack.items).toEqual([]);
  expect(pack.truncated).toBe(true);
});

test('profile opt-in requires its own grant', async () => {
  const h = await createHarness();
  try {
    const profileId = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO projects (project_id, owner_id, name, normalized_name, is_profile, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
      ).bind(
        profileId,
        h.ctx.owner_id,
        'Synthetic Profile',
        'synthetic profile',
        now,
        now,
      ),
      env.DB.prepare(
        'INSERT INTO grant_projects (grant_id, owner_id, project_id) VALUES (?, ?, ?)',
      ).bind(h.ctx.grant_id, h.ctx.owner_id, profileId),
    ]);
    const granted = {
      ...h.ctx,
      project_ids: [h.projectId, profileId],
    };
    await h.service.save(granted, {
      project_id: h.projectId,
      note: h.note({
        title: 'synthetic.context.shared',
        fact_key: 'synthetic.context.project',
      }),
      operation_id: crypto.randomUUID(),
    });
    await h.service.save(granted, {
      project_id: profileId,
      note: h.note({
        title: 'synthetic.context.shared',
        fact_key: 'synthetic.context.profile',
      }),
      operation_id: crypto.randomUUID(),
    });
    const denied = await h.service.context(h.ctx, {
      project_id: h.projectId,
      query: 'synthetic.context.shared',
      include_profile: true,
    });
    expect(denied.ok).toBe(true);
    if (!denied.ok) return;
    expect(denied.data.profile_included).toBe(false);
    expect(
      denied.data.items.some((item) =>
        item.representation === 'full'
          ? item.record.project_id === profileId
          : item.card.project_id === profileId,
      ),
    ).toBe(false);
    const allowed = await h.service.context(granted, {
      project_id: h.projectId,
      query: 'synthetic.context.shared',
      include_profile: true,
      max_bytes: 8192,
    });
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) return;
    expect(allowed.data.profile_included).toBe(true);
    expect(
      allowed.data.items.some((item) =>
        item.representation === 'full'
          ? item.record.project_id === profileId
          : item.card.project_id === profileId,
      ),
    ).toBe(true);
    const off = await h.service.context(granted, {
      project_id: h.projectId,
      query: 'synthetic.context.shared',
    });
    expect(off.ok).toBe(true);
    if (!off.ok) return;
    expect(off.data.profile_included).toBe(false);
  } finally {
    await h.dispose();
  }
});

test('archived project context stays empty even with profile opt-in', async () => {
  const h = await createHarness();
  try {
    const profileId = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO projects (project_id, owner_id, name, normalized_name, is_profile, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
      ).bind(
        profileId,
        h.ctx.owner_id,
        'Synthetic Profile',
        'synthetic profile',
        now,
        now,
      ),
      env.DB.prepare(
        'INSERT INTO grant_projects (grant_id, owner_id, project_id) VALUES (?, ?, ?)',
      ).bind(h.ctx.grant_id, h.ctx.owner_id, profileId),
    ]);
    const granted = {
      ...h.ctx,
      project_ids: [h.projectId, profileId],
    };
    await h.service.save(granted, {
      project_id: h.projectId,
      note: h.note({
        title: 'synthetic.context.archived',
        fact_key: 'synthetic.context.archived.project',
      }),
      operation_id: crypto.randomUUID(),
    });
    await h.service.save(granted, {
      project_id: profileId,
      note: h.note({
        title: 'synthetic.context.archived',
        fact_key: 'synthetic.context.archived.profile',
      }),
      operation_id: crypto.randomUUID(),
    });
    await env.DB.prepare(
      'UPDATE projects SET archived_at = ? WHERE project_id = ?',
    )
      .bind(now, h.projectId)
      .run();
    const packed = await h.service.context(granted, {
      project_id: h.projectId,
      query: 'synthetic.context.archived',
      include_profile: true,
      max_bytes: 8192,
    });
    expect(packed.ok).toBe(true);
    if (!packed.ok) return;
    expect(packed.data.items).toEqual([]);
    expect(packed.data.profile_included).toBe(false);
  } finally {
    await h.dispose();
  }
});

test('invalid context budget is rejected', async () => {
  const h = await createHarness();
  try {
    const r = await h.service.context(h.ctx, {
      project_id: h.projectId,
      query: 'synthetic',
      max_bytes: 2047,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('VALIDATION_ERROR');
  } finally {
    await h.dispose();
  }
});

test('context excerpts reuse the search match-window snippet', async () => {
  const h = await createHarness();
  try {
    await h.seed({
      title: 'unrelated heading',
      body: `${'x'.repeat(3500)} synthetic.window.token`,
      fact_key: 'synthetic.window.other',
    });
    const r = await h.service.context(h.ctx, {
      project_id: h.projectId,
      query: 'synthetic.window.token',
      max_bytes: 2048,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const excerpts = r.data.items.filter(
      (item) => item.representation === 'excerpt',
    );
    expect(excerpts.length).toBeGreaterThan(0);
    expect(
      excerpts.every(
        (item) =>
          item.representation === 'excerpt' &&
          item.card.snippet.includes('synthetic.window.token'),
      ),
    ).toBe(true);
  } finally {
    await h.dispose();
  }
});

test('profile opt-in does not depend on list_projects page size', async () => {
  const h = await createHarness();
  try {
    const profileId = crypto.randomUUID();
    const extras = Array.from({ length: 50 }, () => crypto.randomUUID());
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO projects (project_id, owner_id, name, normalized_name, is_profile, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
      ).bind(profileId, h.ctx.owner_id, 'zzz-profile', 'zzz-profile', now, now),
      env.DB.prepare(
        'INSERT INTO grant_projects (grant_id, owner_id, project_id) VALUES (?, ?, ?)',
      ).bind(h.ctx.grant_id, h.ctx.owner_id, profileId),
      ...extras.flatMap((projectId, index) => {
        const name = `Aaa-${String(index).padStart(2, '0')}`;
        return [
          env.DB.prepare(
            'INSERT INTO projects (project_id, owner_id, name, normalized_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          ).bind(projectId, h.ctx.owner_id, name, name.toLowerCase(), now, now),
          env.DB.prepare(
            'INSERT INTO grant_projects (grant_id, owner_id, project_id) VALUES (?, ?, ?)',
          ).bind(h.ctx.grant_id, h.ctx.owner_id, projectId),
        ];
      }),
    ]);
    const granted = {
      ...h.ctx,
      project_ids: [h.projectId, profileId, ...extras],
    };
    await h.service.save(granted, {
      project_id: h.projectId,
      note: h.note({
        title: 'synthetic.context.paged',
        fact_key: 'synthetic.context.paged.project',
      }),
      operation_id: crypto.randomUUID(),
    });
    await h.service.save(granted, {
      project_id: profileId,
      note: h.note({
        title: 'synthetic.context.paged',
        fact_key: 'synthetic.context.paged.profile',
      }),
      operation_id: crypto.randomUUID(),
    });
    const allowed = await h.service.context(granted, {
      project_id: h.projectId,
      query: 'synthetic.context.paged',
      include_profile: true,
      max_bytes: 8192,
    });
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) return;
    expect(allowed.data.profile_included).toBe(true);
  } finally {
    await h.dispose();
  }
});
