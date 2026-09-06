import { loadConfig } from './config';
import { createProvider } from './auth/provider';
import { HttpError, type ProbeEnv } from './auth/types';
import { maximumRpcIdBytes } from './probe-encoding';

async function bounded(request: Request): Promise<Request> {
  if (request.url.length > 8192) throw new HttpError(414, 'request_too_large');
  if (!request.body) return request;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > 32768) {
      await reader.cancel();
      throw new HttpError(413, 'request_too_large');
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (new URL(request.url).pathname === '/mcp') {
    let message: { id?: unknown };
    try {
      message = JSON.parse(new TextDecoder().decode(bytes)) as { id?: unknown };
    } catch {
      throw new HttpError(400, 'invalid_request');
    }
    if (
      !message ||
      typeof message !== 'object' ||
      Array.isArray(message) ||
      (message.id !== undefined &&
        new TextEncoder().encode(JSON.stringify(message.id)).byteLength >
          maximumRpcIdBytes)
    )
      throw new HttpError(400, 'invalid_request');
  }
  return new Request(request, { body: bytes });
}

export default {
  async fetch(
    request: Request,
    env: ProbeEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    let response: Response;
    try {
      const config = loadConfig(env as unknown as Record<string, unknown>);
      if (config.environment === 'production')
        throw new HttpError(503, 'probe_disabled');
      const url = new URL(request.url);
      if (
        url.origin !== config.origin ||
        (request.headers.get('origin') &&
          request.headers.get('origin') !== config.origin)
      )
        throw new HttpError(403, 'access_denied');
      if (url.pathname === '/mcp' && (url.search || url.hash))
        throw new HttpError(400, 'invalid_request');
      if (url.pathname === '/health')
        response = Response.json({
          status: 'ok',
          service: 'synthetic-probe',
          version: '0.1.0',
        });
      else
        response = await createProvider(config).fetch(
          await bounded(request),
          env,
          ctx,
        );
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 503;
      const headers: Record<string, string> = {};
      if (status === 401)
        headers['www-authenticate'] = 'Bearer error="invalid_token"';
      response = Response.json(
        { error: error instanceof HttpError ? error.code : 'unavailable' },
        { status, headers },
      );
    }
    const safe = new Response(response.body, response);
    safe.headers.set('cache-control', 'no-store');
    if (!safe.headers.has('referrer-policy'))
      safe.headers.set('referrer-policy', 'no-referrer');
    safe.headers.set('x-content-type-options', 'nosniff');
    return safe;
  },
};
