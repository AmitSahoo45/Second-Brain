import { env } from 'cloudflare:workers';
import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { expect, test } from 'vitest';
import { createOwnerSession } from '../../src/db/owner-session-store';
import probe from '../../src/probe';
import type { Outcome, WriteReceipt } from '../../src/domain/types';
import { createHarness } from '../support/harness';

const fixtureEnv = {
  ...env,
  APP_ENV: 'local',
  MCP_RESOURCE_URL: 'http://127.0.0.1:8787/mcp',
  GITHUB_OWNER_ID: '123456789',
  GITHUB_CLIENT_ID: 'synthetic-client',
  GITHUB_CLIENT_SECRET: 'synthetic-secret',
  HMAC_SECRET: 'synthetic-hmac-secret-for-local-tests!',
};
const origin = 'http://127.0.0.1:8787';

async function dispatch(request: Request) {
  const ctx = createExecutionContext();
  const response = await probe.fetch(request, fixtureEnv, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function signed(h: Awaited<ReturnType<typeof createHarness>>) {
  const session = await createOwnerSession(
    env.DB,
    h.ctx.owner_id,
    1,
    Date.now(),
  );
  if (!session) throw new Error('session');
  return {
    session,
    send(path: string, method: string, body?: unknown) {
      const headers: Record<string, string> = {
        cookie: `owner_session=${session.raw}`,
        origin: origin,
        'x-csrf-token': session.csrf,
        'content-type': 'application/json',
      };
      return dispatch(
        new Request(
          origin + path,
          body
            ? { method, headers, body: JSON.stringify(body) }
            : { method, headers },
        ),
      );
    },
  };
}

test('admin mutations require CSRF and Origin', async () => {
  const h = await createHarness();
  try {
    const s = await signed(h);
    const denied = await dispatch(
      new Request(origin + '/api/admin/projects', {
        method: 'POST',
        headers: {
          cookie: `owner_session=${s.session.raw}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: 'Blocked' }),
      }),
    );
    expect(denied.status).toBe(403);
  } finally {
    await h.dispose();
  }
});

test('owner can create list and archive projects', async () => {
  const h = await createHarness();
  try {
    const s = await signed(h);
    const created = await s.send('/api/admin/projects', 'POST', {
      name: 'Dashboard Alpha',
    });
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as Outcome<{
      project_id: string;
      revision: number;
    }>;
    expect(createdBody.ok).toBe(true);
    if (!createdBody.ok) return;
    const listed = await s.send('/api/admin/projects', 'GET');
    const listBody = (await listed.json()) as Outcome<{
      projects: { name: string; archived: boolean }[];
    }>;
    expect(listBody.ok).toBe(true);
    if (!listBody.ok) return;
    expect(
      listBody.data.projects.some((item) => item.name === 'Dashboard Alpha'),
    ).toBe(true);
    const archived = await s.send(
      `/api/admin/projects/${createdBody.data.project_id}`,
      'PATCH',
      { expected_revision: createdBody.data.revision, archived: true },
    );
    const archivedBody = (await archived.json()) as Outcome<{
      archived: boolean;
    }>;
    expect(archivedBody.ok).toBe(true);
    if (!archivedBody.ok) return;
    expect(archivedBody.data.archived).toBe(true);
  } finally {
    await h.dispose();
  }
});

test('stale note update returns conflict without overwrite', async () => {
  const h = await createHarness();
  try {
    const seed = await h.seed({ title: 'Dashboard note' });
    const s = await signed(h);
    const second = await h.service.update(h.ctx, {
      project_id: h.projectId,
      memory_id: seed.memory_id,
      expected_revision: seed.revision,
      note: h.note({ title: 'Dashboard note', body: 'server won' }),
      reason: 'correction: concurrent synthetic update',
      operation_id: crypto.randomUUID(),
    });
    expect(second.ok).toBe(true);
    const stale = await s.send(`/api/admin/memories/${seed.memory_id}`, 'PUT', {
      project_id: h.projectId,
      expected_revision: seed.revision,
      reason: 'correction: stale dashboard edit',
      operation_id: crypto.randomUUID(),
      note: h.note({ title: 'Dashboard note', body: 'My proposed correction' }),
    });
    const body = (await stale.json()) as Outcome<WriteReceipt>;
    expect(body.ok).toBe(false);
    if (body.ok) return;
    expect(body.error.code).toBe('REVISION_CONFLICT');
    const current = await h.service.read(h.ctx, {
      project_id: h.projectId,
      memory_id: seed.memory_id,
    });
    expect(current.ok).toBe(true);
    if (!current.ok) return;
    expect(current.data.record.body).toBe('server won');
  } finally {
    await h.dispose();
  }
});

test('admin note list can search by query', async () => {
  const h = await createHarness();
  try {
    await h.seed({
      title: 'synthetic.dashboard.search',
      fact_key: 'synthetic.dashboard.search',
    });
    const s = await signed(h);
    const listed = await s.send(
      `/api/admin/memories?project_id=${h.projectId}&query=synthetic.dashboard.search`,
      'GET',
    );
    const body = (await listed.json()) as {
      ok: boolean;
      data?: { items: { title: string }[] };
    };
    expect(body.ok).toBe(true);
    expect(
      body.data?.items.some(
        (item) => item.title === 'synthetic.dashboard.search',
      ),
    ).toBe(true);
  } finally {
    await h.dispose();
  }
});

test('grants list omits tokens and status hides missed chats as unobservable', async () => {
  const h = await createHarness();
  try {
    const s = await signed(h);
    const grants = await s.send('/api/admin/grants', 'GET');
    const grantBody = (await grants.json()) as Outcome<{
      grants: { client_label: string }[];
    }>;
    expect(grantBody.ok).toBe(true);
    expect(JSON.stringify(grantBody)).not.toContain('access_token');
    const status = await s.send('/api/admin/status', 'GET');
    const statusBody = (await status.json()) as {
      observed_calls: number;
      missed_chats: { observed: false };
    };
    expect(statusBody.missed_chats.observed).toBe(false);
    expect(typeof statusBody.observed_calls).toBe('number');
  } finally {
    await h.dispose();
  }
});
