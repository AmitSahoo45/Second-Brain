import { getOAuthApi } from '@cloudflare/workers-oauth-provider';

export default {
  async fetch(
    request: Request,
    env: { OAUTH_KV: KVNamespace },
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1')
      return new Response('Local setup only', { status: 403 });
    if (request.method !== 'POST')
      return new Response('POST required', { status: 405 });
    try {
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > 4096)
        return new Response('Too large', { status: 413 });
      const input = JSON.parse(new TextDecoder().decode(bytes)) as {
        name?: string;
        redirect_uri?: string;
      };
      if (
        typeof input.name !== 'string' ||
        !input.name ||
        Array.from(input.name).length > 80 ||
        typeof input.redirect_uri !== 'string' ||
        input.redirect_uri.includes('*')
      )
        throw new Error();
      const redirect = new URL(input.redirect_uri);
      if (
        redirect.href !== input.redirect_uri ||
        redirect.username ||
        redirect.password ||
        redirect.hash ||
        !(
          redirect.protocol === 'https:' ||
          (redirect.protocol === 'http:' &&
            ['127.0.0.1', '[::1]'].includes(redirect.hostname))
        )
      )
        throw new Error();
      const api = getOAuthApi(
        {
          apiRoute: '/never',
          apiHandler: { fetch: () => new Response(null, { status: 404 }) },
          defaultHandler: { fetch: () => new Response(null, { status: 404 }) },
          authorizeEndpoint: '/authorize',
          tokenEndpoint: '/oauth/token',
          clientIdMetadataDocumentEnabled: false,
        },
        env,
      );
      const client = await api.createClient({
        clientName: input.name,
        redirectUris: [input.redirect_uri],
        tokenEndpointAuthMethod: 'none',
        grantTypes: ['authorization_code', 'refresh_token'],
        responseTypes: ['code'],
      });
      const key = 'client:' + client.clientId;
      const value = await env.OAUTH_KV.get(key);
      return Response.json(
        { client_id: client.clientId, records: [{ key, value }] },
        { headers: { 'cache-control': 'no-store' } },
      );
    } catch {
      return new Response('Invalid client profile', { status: 400 });
    }
  },
};
