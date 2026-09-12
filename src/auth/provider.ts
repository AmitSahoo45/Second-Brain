import {
  OAuthProvider,
  type OAuthProviderOptions,
} from '@cloudflare/workers-oauth-provider';
import type { AppConfig } from '../config';
import { handleStatelessMcp, resolveRequestDependencies } from '../mcp/server';
import { handleAdminRequest } from './admin-session';
import { ownerLogin } from './owner-login';
import { registrationPolicy } from './registration';
import { exchangeTokenContext, verifiedTokenContext } from './token-context';
import { HttpError, type ProbeEnv } from './types';

export function providerOptions(
  config: AppConfig,
): OAuthProviderOptions<ProbeEnv> {
  return {
    apiRoute: '/mcp',
    apiHandler: {
      async fetch(request, env, ctx) {
        const summary = await verifiedTokenContext(
          ctx.props,
          request,
          env,
          config,
        );
        const deps = await resolveRequestDependencies(summary, env, config);
        return handleStatelessMcp(request, deps);
      },
    },
    defaultHandler: {
      async fetch(request, env) {
        if (!env.OAUTH_PROVIDER) throw new HttpError(503, 'unavailable');
        return (
          (await handleAdminRequest(request, env)) ??
          ownerLogin(request, env, config, env.OAUTH_PROVIDER)
        );
      },
    },
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/oauth/token',
    allowImplicitFlow: false,
    allowPlainPKCE: false,
    allowTokenExchangeGrant: false,
    clientIdMetadataDocumentEnabled:
      registrationPolicy.clientIdMetadataDocument,
    resourceMatchOriginOnly: false,
    scopesSupported: ['memory:read', 'memory:write'],
    resourceMetadata: {
      resource: config.resource,
      ...(config.environment === 'local'
        ? {}
        : { authorization_servers: [config.origin] }),
      // Normal SDK discovery takes these advertised capabilities (and the
      // provider's matching 401 challenge) as its requested consent scopes.
      // Actual grants may still explicitly request only memory:read.
      scopes_supported: ['memory:read', 'memory:write'],
      bearer_methods_supported: ['header'],
      resource_name: 'Synthetic T01 probe',
    },
    accessTokenTTL: 900,
    refreshTokenTTL: 86400,
    tokenExchangeCallback: (options) => exchangeTokenContext(options, config),
    onError: ({ status, headers }) =>
      Response.json(
        { error: status === 401 ? 'invalid_token' : 'invalid_request' },
        { status, headers },
      ),
  };
}

export function createProvider(config: AppConfig) {
  return new OAuthProvider(providerOptions(config));
}
