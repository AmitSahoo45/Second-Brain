import { env } from 'cloudflare:workers';
import { createOwnerSession } from '../../src/db/owner-session-store';
import type { Harness } from '../support/harness';

export async function signInSyntheticOwner(h: Harness) {
  const session = await createOwnerSession(
    env.DB,
    h.ctx.owner_id,
    1,
    Date.now(),
  );
  if (!session) throw new Error('session');
  return session;
}

export async function openSyntheticNote(h: Harness) {
  return h.seed({
    title: 'Synthetic dashboard note',
    body: 'Original body',
  });
}

export async function commitConcurrentSyntheticUpdate(
  h: Harness,
  memoryId: string,
  revision: number,
) {
  return h.service.update(h.ctx, {
    project_id: h.projectId,
    memory_id: memoryId,
    expected_revision: revision,
    note: h.note({
      title: 'Synthetic dashboard note',
      body: 'server won',
    }),
    reason: 'correction: concurrent synthetic update',
    operation_id: crypto.randomUUID(),
  });
}
