import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';

export interface ProbeEnv {
  APP_ENV: string;
  MCP_RESOURCE_URL: string;
  GITHUB_OWNER_ID: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  DB: D1Database;
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER?: OAuthHelpers;
}

export interface AuthContext {
  owner_id: string;
  actor_id: string;
  actor_kind: 'oauth_grant';
  actor_client_label: string;
  grant_id: string;
  provider_grant_id: string;
  project_ids: readonly string[];
  scopes: readonly string[];
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
