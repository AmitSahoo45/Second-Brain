import { getOAuthApi } from '@cloudflare/workers-oauth-provider';
import probe from '../../src/probe';
import { providerOptions } from '../../src/auth/provider';
import { loadConfig } from '../../src/config';
import type { ProbeEnv } from '../../src/auth/types';

// Test-only entry. Production/probe configs never import this fixture route.
export default {
  async fetch(request: Request, env: ProbeEnv, ctx: ExecutionContext) {
    if (new URL(request.url).pathname === '/__fixture/client') {
      if (env.APP_ENV !== 'local' || request.method !== 'POST')
        return new Response(null, { status: 403 });
      const { redirect } = await request.json<{ redirect: string }>();
      const api = getOAuthApi(
        providerOptions(loadConfig(env as unknown as Record<string, unknown>)),
        env,
      );
      const client = await api.createClient({
        clientName: 'Synthetic browser <client>',
        redirectUris: [redirect],
        tokenEndpointAuthMethod: 'none',
        grantTypes: ['authorization_code'],
        responseTypes: ['code'],
      });
      return Response.json({ clientId: client.clientId });
    }
    return probe.fetch(request, env, ctx);
  },
};
