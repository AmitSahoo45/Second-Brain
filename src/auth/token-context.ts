import {
  OAuthError,
  type TokenExchangeCallbackOptions,
  type TokenExchangeCallbackResult,
} from '@cloudflare/workers-oauth-provider';
import type { AppConfig } from '../config';
import { HttpError, type ProbeEnv } from './types';

// Trusted only after OAuthProvider validates the token and decrypts ctx.props.
// This is token-specific: grant scope alone is not sufficient for admission.
export interface VerifiedTokenSummary {
  actorId: string;
  userId: string;
  grantId: string;
  clientId: string;
  scope: string[];
  audience: string;
}

interface AccessTokenProps extends VerifiedTokenSummary {
  version: 1;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function actor(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function legacyProps(value: unknown): value is { actorId: string } {
  return (
    record(value) && Object.keys(value).length === 1 && actor(value.actorId)
  );
}

function scopes(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((scope) => scope === 'memory:read' || scope === 'memory:write')
  );
}

function tokenProps(
  value: unknown,
  config: AppConfig,
): value is AccessTokenProps {
  return (
    record(value) &&
    Object.keys(value).length === 7 &&
    value.version === 1 &&
    actor(value.actorId) &&
    actor(value.userId) &&
    typeof value.grantId === 'string' &&
    value.grantId.length > 0 &&
    typeof value.clientId === 'string' &&
    value.clientId.length > 0 &&
    scopes(value.scope) &&
    value.audience === config.resource
  );
}

export function exchangeTokenContext(
  options: TokenExchangeCallbackOptions,
  config: AppConfig,
): TokenExchangeCallbackResult {
  const props: unknown = options.props;
  if (
    !legacyProps(props) ||
    (options.grantType !== 'authorization_code' &&
      options.grantType !== 'refresh_token') ||
    !scopes(options.scope) ||
    !scopes(options.requestedScope) ||
    !options.requestedScope.every((scope) => options.scope.includes(scope))
  ) {
    throw new OAuthError('invalid_grant', {
      description: 'Invalid grant context',
    });
  }
  const accessTokenProps: AccessTokenProps = {
    version: 1,
    actorId: props.actorId,
    userId: options.userId,
    grantId: options.grantId,
    clientId: options.clientId,
    scope: [...options.requestedScope],
    audience: config.resource,
  };
  if (!tokenProps(accessTokenProps, config))
    throw new OAuthError('invalid_grant', {
      description: 'Invalid grant context',
    });
  // Do not change canonical grant props, token scopes, TTLs or refresh policy.
  return { accessTokenProps };
}

// Call only from OAuthProvider's protected apiHandler, never from HTTP claims.
// Audience and expiry are checked by the maintained provider before this point.
export async function verifiedTokenContext(
  props: unknown,
  request: Request,
  env: ProbeEnv,
  config: AppConfig,
): Promise<VerifiedTokenSummary> {
  if (tokenProps(props, config)) return props;
  // Only exact legacy props may use the old path. Unknown/malformed versions deny.
  if (!legacyProps(props)) throw new HttpError(401, 'invalid_token');
  const token = request.headers
    .get('authorization')
    ?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!token || !env.OAUTH_PROVIDER) throw new HttpError(401, 'invalid_token');
  const summary = await env.OAUTH_PROVIDER.unwrapToken<unknown>(token);
  if (
    !summary ||
    summary.audience !== config.resource ||
    !legacyProps(summary.grant.props) ||
    summary.grant.props.actorId !== props.actorId
  )
    throw new HttpError(401, 'invalid_token');
  return {
    actorId: summary.grant.props.actorId,
    userId: summary.userId,
    grantId: summary.grantId,
    clientId: summary.grant.clientId,
    scope: summary.scope,
    audience: summary.audience,
  };
}
