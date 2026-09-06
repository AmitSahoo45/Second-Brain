import { env } from 'cloudflare:workers';
import { beforeAll, expect, test } from 'vitest';
import migration from '../../src/db/migrations/0001_auth.sql?raw';
import boundsMigration from '../../src/db/migrations/0002_probe_auth_bounds.sql?raw';
import {
  consumeAuthFlow,
  consumeConsent,
  createAuthFlow,
  createConsent,
} from '../../src/db/auth-flow-store';

beforeAll(async () => {
  for (const statement of (migration + boundsMigration)
    .split(';')
    .map((value) => value.trim())
    .filter(Boolean))
    await env.DB.prepare(statement).run();
  await env.DB.prepare(
    'INSERT INTO owners (owner_id, provider, provider_subject, admin_actor_id, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(
      'synthetic-owner',
      'github',
      '123456789',
      'synthetic-admin',
      '2026-09-06T00:00:00Z',
    )
    .run();
});

test('state consume remains browser-bound, expiring and atomic single use', async () => {
  expect(
    await createAuthFlow(env.DB, 'synthetic-state', 'browser-hash', '{}', 1000),
  ).toBe(true);
  expect(
    await consumeAuthFlow(env.DB, 'synthetic-state', 'other-browser', 1001),
  ).toBeNull();
  const consumed = await Promise.all([
    consumeAuthFlow(env.DB, 'synthetic-state', 'browser-hash', 1001),
    consumeAuthFlow(env.DB, 'synthetic-state', 'browser-hash', 1001),
  ]);
  expect(consumed.filter(Boolean)).toHaveLength(1);
  expect(
    await createAuthFlow(env.DB, 'expired-state', 'browser-hash', '{}', 1000),
  ).toBe(true);
  expect(
    await consumeAuthFlow(env.DB, 'expired-state', 'browser-hash', 601000),
  ).toBeNull();
});

test('consent consume remains CSRF-bound, expiring and single use', async () => {
  expect(
    await createConsent(
      env.DB,
      'session-hash',
      'csrf-value',
      '{}',
      'synthetic-owner',
      'synthetic-project',
      1000,
    ),
  ).toBe(true);
  expect(
    await consumeConsent(env.DB, 'session-hash', 'wrong-csrf', 1001),
  ).toBeNull();
  expect(
    await consumeConsent(env.DB, 'session-hash', 'csrf-value', 1001),
  ).toMatchObject({ owner_id: 'synthetic-owner' });
  expect(
    await consumeConsent(env.DB, 'session-hash', 'csrf-value', 1001),
  ).toBeNull();
  expect(
    await createConsent(
      env.DB,
      'expired-session',
      'csrf-value',
      '{}',
      'synthetic-owner',
      'synthetic-project',
      1000,
    ),
  ).toBe(true);
  expect(
    await consumeConsent(env.DB, 'expired-session', 'csrf-value', 601000),
  ).toBeNull();
});

test('consent storage shares bounded cleanup and pending admission', async () => {
  await env.DB.prepare('DELETE FROM probe_consents').run();
  await env.DB.batch(
    Array.from({ length: 8 }, (_, index) =>
      env.DB.prepare(
        'INSERT INTO probe_consents VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(
        `session-${index}`,
        'csrf-value',
        '{}',
        'synthetic-owner',
        'synthetic-project',
        601000,
      ),
    ),
  );
  expect(
    await createConsent(
      env.DB,
      'extra-session',
      'csrf-value',
      '{}',
      'synthetic-owner',
      'synthetic-project',
      1001,
    ),
  ).toBe(false);
  expect(
    await env.DB.prepare('SELECT COUNT(*) AS n FROM probe_consents').first('n'),
  ).toBe(8);
  expect(
    await createConsent(
      env.DB,
      'new-session',
      'csrf-value',
      '{}',
      'synthetic-owner',
      'synthetic-project',
      601000,
    ),
  ).toBe(true);
  expect(
    await env.DB.prepare('SELECT COUNT(*) AS n FROM probe_consents').first('n'),
  ).toBe(5);
});
