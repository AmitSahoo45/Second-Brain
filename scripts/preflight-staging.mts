import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function validateStaging(value: unknown) {
  const config = value as Record<string, unknown>;
  const vars = config.vars as Record<string, string> | undefined;
  const db = (
    config.d1_databases as
      { binding: string; database_id: string }[] | undefined
  )?.find((item) => item.binding === 'DB');
  const kv = (
    config.kv_namespaces as { binding: string; id: string }[] | undefined
  )?.find((item) => item.binding === 'OAUTH_KV');
  if (
    !vars ||
    config.main !== 'src/probe.ts' ||
    !String(config.name).endsWith('-staging') ||
    vars.APP_ENV !== 'staging' ||
    config.workers_dev !== false ||
    config.preview_urls !== false ||
    (config.observability as { enabled?: boolean } | undefined)?.enabled !==
      false
  )
    throw new Error(
      'Staging must use the isolated probe entry, explicit routing and disabled invocation logging.',
    );
  const resource = new URL(vars.MCP_RESOURCE_URL!);
  if (
    resource.href !== vars.MCP_RESOURCE_URL ||
    resource.protocol !== 'https:' ||
    resource.pathname !== '/mcp' ||
    resource.search ||
    resource.hash ||
    resource.username ||
    resource.password ||
    ['localhost', '127.0.0.1', '[::1]'].includes(resource.hostname) ||
    resource.hostname.includes('REPLACE')
  )
    throw new Error('A real canonical HTTPS /mcp resource is required.');
  if (
    !/^[1-9][0-9]{0,19}$/.test(vars.GITHUB_OWNER_ID ?? '') ||
    !vars.GITHUB_CLIENT_ID ||
    /[<>]/.test(vars.GITHUB_CLIENT_ID)
  )
    throw new Error('Verified owner ID and GitHub OAuth app ID are required.');
  if (
    !db ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      db.database_id,
    ) ||
    !kv ||
    !/^[0-9a-f]{32}$/i.test(kv.id)
  )
    throw new Error('Real staging D1 and OAuth KV bindings are required.');
  if (config.compatibility_date !== '2026-09-06')
    throw new Error('Use the locally verified compatibility date.');
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    validateStaging(
      JSON.parse(await readFile('.dev.vars.staging.json', 'utf8')),
    );
    console.log(
      'Staging configuration validated. G1 still requires authorized deployment, installed secret, client registration and live evidence.',
    );
  } catch {
    console.error(
      'Staging preflight failed. Provide a complete ignored .dev.vars.staging.json using wrangler.staging.example.json and the README prerequisites.',
    );
    process.exitCode = 1;
  }
}
