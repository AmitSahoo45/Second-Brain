export interface AppConfig {
  environment: 'local' | 'staging' | 'production';
  resource: string;
  origin: string;
  ownerSubject: string;
  githubClientId: string;
  githubClientSecret: string;
}

function required(env: Record<string, unknown>, key: string): string {
  const value = env[key];
  if (typeof value !== 'string' || !value || value.trim() !== value)
    throw new Error(`Invalid ${key}`);
  return value;
}

export function loadConfig(env: Record<string, unknown>): AppConfig {
  const environment = required(env, 'APP_ENV');
  if (!['local', 'staging', 'production'].includes(environment))
    throw new Error('Invalid APP_ENV');
  const resource = required(env, 'MCP_RESOURCE_URL');
  const url = new URL(resource);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.href !== resource ||
    url.pathname !== '/mcp' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    (environment === 'local'
      ? !loopback || !['http:', 'https:'].includes(url.protocol)
      : loopback || url.protocol !== 'https:')
  )
    throw new Error('Invalid MCP_RESOURCE_URL');
  for (const binding of ['DB', 'OAUTH_KV']) {
    if (!env[binding] || typeof env[binding] !== 'object')
      throw new Error(`Missing ${binding}`);
  }
  if (
    typeof (env.DB as { prepare?: unknown }).prepare !== 'function' ||
    typeof (env.OAUTH_KV as { get?: unknown }).get !== 'function' ||
    typeof (env.OAUTH_KV as { put?: unknown }).put !== 'function'
  )
    throw new Error('Invalid storage bindings');
  const ownerSubject = required(env, 'GITHUB_OWNER_ID');
  if (!/^[1-9][0-9]{0,19}$/.test(ownerSubject))
    throw new Error('Invalid GITHUB_OWNER_ID');
  return {
    environment: environment as AppConfig['environment'],
    resource,
    origin: url.origin,
    ownerSubject,
    githubClientId: required(env, 'GITHUB_CLIENT_ID'),
    githubClientSecret: required(env, 'GITHUB_CLIENT_SECRET'),
  };
}
