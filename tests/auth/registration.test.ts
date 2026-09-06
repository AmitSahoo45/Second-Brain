import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import registration from '../../scripts/registration-worker';

test('local setup creates a provider public client with exact redirect and exports its KV record', async () => {
  const response = await registration.fetch(
    new Request('http://127.0.0.1/setup', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Synthetic setup',
        redirect_uri: 'https://client.example/callback',
      }),
    }),
    env,
  );
  expect(response.status).toBe(200);
  const client = (await response.json()) as {
    client_id: string;
    records: { key: string; value: string }[];
  };
  expect(client.records[0]!.key).toBe('client:' + client.client_id);
  expect(JSON.parse(client.records[0]!.value)).toMatchObject({
    redirectUris: ['https://client.example/callback'],
    tokenEndpointAuthMethod: 'none',
    grantTypes: ['authorization_code', 'refresh_token'],
  });
  expect(client.records[0]!.value).not.toContain('clientSecret');
});

test('registration utility rejects remote hosts, wildcard and insecure redirects', async () => {
  expect(
    (
      await registration.fetch(
        new Request('https://remote.example/setup', {
          method: 'POST',
          body: '{}',
        }),
        env,
      )
    ).status,
  ).toBe(403);
  for (const uri of [
    'https://client.example/*',
    'http://evil.example/callback',
    'javascript:alert(1)',
  ])
    expect(
      (
        await registration.fetch(
          new Request('http://127.0.0.1/setup', {
            method: 'POST',
            body: JSON.stringify({ name: 'Synthetic', redirect_uri: uri }),
          }),
          env,
        )
      ).status,
    ).toBe(400);
});
