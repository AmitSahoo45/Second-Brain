import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import probe from '../../src/probe';
import { createHarness } from '../support/harness';
import {
  commitConcurrentSyntheticUpdate,
  openSyntheticNote,
  signInSyntheticOwner,
} from './fixtures';

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

test('stale edit shows a reconciliation path', async () => {
  const h = await createHarness();
  try {
    const session = await signInSyntheticOwner(h);
    const note = await openSyntheticNote(h);
    await commitConcurrentSyntheticUpdate(h, note.memory_id, note.revision);
    const page = await dispatch(new Request(origin + '/admin'));
    const html = await page.text();
    expect(html).toContain('aria-label="Body"');
    expect(html).toContain('Save changes');
    expect(html).toContain('Reload current version');
    expect(html).toContain('role="alert"');
    const script = await dispatch(new Request(origin + '/admin/app.js'));
    const js = await script.text();
    expect(js).toContain('REVISION_CONFLICT');
    expect(js).toContain('Your draft is preserved');
    expect(js).toContain('kind: record.kind');
    expect(js).toContain('x-csrf-token');
    expect(js).toContain('&query=');
    expect(js).not.toContain("kind: 'fact'");
    const stale = await dispatch(
      new Request(origin + `/api/admin/memories/${note.memory_id}`, {
        method: 'PUT',
        headers: {
          cookie: `owner_session=${session.raw}`,
          origin,
          'x-csrf-token': session.csrf,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          project_id: h.projectId,
          expected_revision: note.revision,
          reason: 'correction: dashboard stale edit',
          operation_id: crypto.randomUUID(),
          note: h.note({
            title: 'Synthetic dashboard note',
            body: 'My proposed correction',
          }),
        }),
      }),
    );
    const body = (await stale.json()) as {
      ok: boolean;
      error?: { code: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('REVISION_CONFLICT');
  } finally {
    await h.dispose();
  }
});
