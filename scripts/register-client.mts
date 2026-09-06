import { writeFile } from 'node:fs/promises';

// Run the separate local-only setup Worker first. No Cloudflare mutation occurs here.
const [name, redirect_uri] = process.argv.slice(2);
if (!name || !redirect_uri)
  throw new Error(
    'Usage: npm run register:client -- "Client label" "exact redirect URI". First run the local registration Worker on port 8792.',
  );
const response = await fetch('http://127.0.0.1:8792/setup', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name, redirect_uri }),
});
if (!response.ok)
  throw new Error(
    'Local client registration failed. Check the exact redirect and local setup Worker.',
  );
const client = (await response.json()) as {
  client_id: string;
  records: unknown[];
};
await writeFile(
  '.dev.vars.client-registration.json',
  JSON.stringify(client.records, null, 2) + '\n',
  { flag: 'wx' },
);
console.log(
  `Created public client ID: ${client.client_id}. KV import artifact: .dev.vars.client-registration.json. Import into the selected local/staging KV only after reviewing the exact redirect.`,
);
