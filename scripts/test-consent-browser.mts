import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Entirely local: real bundled app, D1/KV, native browser, synthetic GitHub.
// No application test route or production bypass is added.
const executable =
  process.env.BROWSER_EXECUTABLE ??
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
await access(executable).catch(() => {
  throw new Error(
    'Browser missing: set BROWSER_EXECUTABLE to an installed Chromium/Edge executable. This gate cannot skip.',
  );
});
const resultsRoot = resolve('test-results');
await mkdir(resultsRoot, { recursive: true });
const profile = await mkdtemp(resolve(resultsRoot, 'consent-browser-'));
const listen = (server: Server) =>
  new Promise<string>((done) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert(address && typeof address !== 'string');
      done(`http://127.0.0.1:${address.port}`);
    });
  });
const until = async (condition: () => boolean | Promise<boolean>) => {
  for (let n = 0; n < 100; n++) {
    if (await condition()) return;
    await delay(100);
  }
  throw new Error('Browser condition timed out; no request data is included.');
};
type Callback = { url: URL; referer: string | undefined };
const callbacks: Callback[] = [];
const posts: {
  origin: string | undefined;
  referer: string | undefined;
  status: number;
}[] = [];
let suppressRefresh = false;
let bridgeFailed = false;
let mf: Miniflare | undefined;
const callback = createServer((req, res) => {
  if (!req.url?.startsWith('/callback?')) {
    res.writeHead(404);
    res.end();
    return;
  }
  callbacks.push({
    url: new URL(req.url!, 'http://' + req.headers.host),
    referer: req.headers.referer,
  });
  res.writeHead(200, {
    'content-type': 'text/html',
    'referrer-policy': 'no-referrer',
  });
  res.end(
    '<!doctype html><title>Synthetic client received authorization</title>Done',
  );
});
const clientOrigin = await listen(callback);
const app = createServer(async (req, res) => {
  try {
    const parts: Buffer[] = [];
    for await (const part of req) parts.push(Buffer.from(part));
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers))
      if (value !== undefined)
        headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    const response = await mf!.dispatchFetch(
      'http://' + req.headers.host + req.url,
      {
        method: req.method!,
        redirect: 'manual',
        headers: Object.fromEntries(headers),
        ...(parts.length ? { body: Buffer.concat(parts) } : {}),
      },
    );
    if (req.url === '/oauth/consent' && req.method === 'POST')
      posts.push({
        origin: req.headers.origin,
        referer: req.headers.referer,
        status: response.status,
      });
    let body = await response.text();
    // Simulate a browser preference suppressing auto-refresh; retain the actual
    // app-generated fallback link and all response security headers.
    if (suppressRefresh && req.url === '/oauth/consent')
      body = body.replace(/<meta http-equiv="refresh"[^>]*>/, '');
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(body);
  } catch {
    bridgeFailed = true;
    res.writeHead(500);
    res.end('Local browser fixture failed');
  }
});
const appOrigin = await listen(app);
let ws: WebSocket | undefined;
let browser: ReturnType<typeof spawn> | undefined;
let stage = 'local runtime setup';
try {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'synthetic-consent-browser',
          modules: true,
          scriptPath: resolve('dist/browser/worker.js'),
          compatibilityDate: '2026-09-06',
          compatibilityFlags: ['global_fetch_strictly_public'],
          bindings: {
            APP_ENV: 'local',
            MCP_RESOURCE_URL: appOrigin + '/mcp',
            GITHUB_OWNER_ID: '123456789',
            GITHUB_CLIENT_ID: 'synthetic-client',
            GITHUB_CLIENT_SECRET: 'synthetic-secret',
          },
          d1Databases: { DB: 'synthetic-browser-db' },
          kvNamespaces: ['OAUTH_KV'],
          outboundService: (request) => {
            if (request.url === 'https://github.com/login/oauth/access_token')
              return Response.json({
                access_token: 'synthetic-upstream-token',
              });
            if (request.url === 'https://api.github.com/user')
              return Response.json({ id: 123456789 });
            throw new Error('Unexpected outbound destination in local fixture');
          },
        },
      ],
    }),
  );
  const db = await mf.getD1Database('DB');
  for (const file of ['0001_auth.sql', '0002_probe_auth_bounds.sql'])
    for (const sql of (
      await readFile(resolve('src/db/migrations', file), 'utf8')
    )
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean))
      await db.prepare(sql).run();
  stage = 'isolated browser startup';
  browser = spawn(
    executable,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--disable-extensions',
      '--disable-sync',
      '--disable-background-networking',
      '--disable-component-update',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
  let launchFailed = false;
  browser.on('error', () => {
    launchFailed = true;
  });
  let port = 0;
  await until(async () => {
    if (launchFailed) throw new Error('Browser launch failed');
    try {
      port = Number(
        (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split(
          '\n',
        )[0],
      );
    } catch {
      /* starting */
    }
    return port > 0;
  });
  const version = (await (
    await fetch(`http://127.0.0.1:${port}/json/version`)
  ).json()) as { Browser: string };
  const tab = (await (
    await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
      method: 'PUT',
    })
  ).json()) as { webSocketDebuggerUrl: string };
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise<void>((done, reject) => {
    ws!.addEventListener('open', () => done(), { once: true });
    ws!.addEventListener(
      'error',
      () => reject(new Error('Browser control connection failed')),
      { once: true },
    );
  });
  let id = 0;
  let cspBlocked = false;
  const pending = new Map<
    number,
    {
      done: (value: unknown) => void;
      reject: (reason: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const cdp = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<unknown>((done, reject) => {
      const current = ++id;
      const timer = setTimeout(() => {
        pending.delete(current);
        reject(new Error('Browser command timed out'));
      }, 10000);
      pending.set(current, { done, reject, timer });
      ws!.send(JSON.stringify({ id: current, method, params }));
    });
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number;
      error?: unknown;
      result?: unknown;
      method?: string;
      params?: {
        entry?: { source: string };
        requestId: string;
        request: { url: string; headers: Record<string, string> };
      };
    };
    if (message.id && pending.has(message.id)) {
      const action = pending.get(message.id)!;
      pending.delete(message.id);
      clearTimeout(action.timer);
      if (message.error)
        action.reject(
          new Error('Browser command failed; request data omitted'),
        );
      else action.done(message.result);
    }
    if (
      message.method === 'Log.entryAdded' &&
      message.params?.entry?.source === 'security'
    )
      cspBlocked = true;
    if (message.method === 'Fetch.requestPaused') {
      const p = message.params!;
      if (new URL(p.request.url).pathname === '/callback')
        callbacks.push({
          url: new URL(p.request.url),
          referer: Object.entries(p.request.headers).find(
            ([key]) => key.toLowerCase() === 'referer',
          )?.[1],
        });
      void cdp('Fetch.fulfillRequest', {
        requestId: p.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/html' }],
        body: Buffer.from(
          '<!doctype html><title>Synthetic HTTPS client received authorization</title>',
        ).toString('base64'),
      }).catch(() => {
        bridgeFailed = true;
      });
    }
  });
  const evaluate = async (expression: string) => {
    const result = (await cdp('Runtime.evaluate', {
      expression,
      returnByValue: true,
    })) as { result: { value?: unknown } };
    return result.result.value;
  };
  await cdp('Page.enable');
  await cdp('Network.enable');
  await cdp('Log.enable');
  // Intercept only the registered synthetic HTTPS client; no DNS/network call.
  await cdp('Fetch.enable', {
    patterns: [
      { urlPattern: 'https://client.example/*', requestStage: 'Request' },
    ],
  });
  const verifier = 'A'.repeat(64);
  const state = 'synthetic-browser-client-state';
  const cases = [
    { target: clientOrigin, action: 'approve', fallback: false },
    { target: 'https://client.example', action: 'approve', fallback: false },
    { target: clientOrigin, action: 'approve', fallback: true },
    { target: clientOrigin, action: 'deny', fallback: false },
    { target: clientOrigin, action: 'bad-csrf', fallback: false },
  ];
  for (const item of cases) {
    stage = `${item.action}/${item.fallback ? 'fallback' : item.target === clientOrigin ? 'loopback' : 'https'}`;
    suppressRefresh = item.fallback;
    const callbackCount = callbacks.length;
    const postCount = posts.length;
    const grantsBefore = await db
      .prepare('SELECT COUNT(*) AS n FROM grants')
      .first('n');
    const redirect =
      item.target +
      "/callback?label='quoted'&marker=%22%3E%3Cscript%3E&joined=a%26b";
    stage = `${item.action}/client-registration`;
    const registration = await mf.dispatchFetch(
      appOrigin + '/__fixture/client',
      {
        method: 'POST',
        body: JSON.stringify({ redirect }),
      },
    );
    assert(
      registration.status === 200,
      'Synthetic client registration must succeed',
    );
    const client = (await registration.json()) as { clientId: string };
    stage = `${item.action}/authorization-start`;
    const authorization = await mf.dispatchFetch(
      appOrigin +
        '/authorize?' +
        new URLSearchParams({
          client_id: client.clientId,
          redirect_uri: redirect,
          response_type: 'code',
          state,
          code_challenge: createHash('sha256')
            .update(verifier)
            .digest('base64url'),
          code_challenge_method: 'S256',
          scope: 'memory:read memory:write',
          resource: appOrigin + '/mcp',
        }),
      { redirect: 'manual' },
    );
    assert(authorization.status === 302, 'Synthetic authorization must start');
    const upstreamState = new URL(
      authorization.headers.get('location')!,
    ).searchParams.get('state')!;
    const flowCookie = authorization.headers
      .get('set-cookie')!
      .split(';')[0]!
      .split('=');
    await cdp('Network.setCookie', {
      name: flowCookie[0],
      value: flowCookie[1],
      url: appOrigin,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    });
    stage = `${item.action}/consent-render`;
    await cdp('Page.navigate', {
      url:
        appOrigin +
        '/oauth/callback?' +
        new URLSearchParams({
          state: upstreamState,
          code: 'synthetic-browser-code-canary',
        }),
    });
    await until(
      async () =>
        (await evaluate('!!document.querySelector("button[value=yes]")')) ===
        true,
    );
    if (item.action === 'bad-csrf')
      await evaluate(
        'document.querySelector("input[name=csrf]").value="synthetic-wrong-csrf"',
      );
    await evaluate(
      `document.querySelector('button[value="${item.action === 'deny' ? 'no' : 'yes'}"]').click()`,
    );
    await until(() => posts.length > postCount);
    stage = `${item.action}/native-post-headers`;
    const post = posts[postCount]!;
    assert(
      post.origin === appOrigin,
      'Native consent Origin must be canonical',
    );
    assert(
      post.referer === appOrigin + '/',
      'Referer must omit callback path and query',
    );
    if (item.action === 'approve') {
      stage = 'approve/completion-status';
      assert(
        post.status === 200,
        'Successful consent must render a completion document',
      );
      if (item.fallback) {
        await until(
          async () =>
            (await evaluate('!!document.querySelector("a")')) === true,
        );
        await evaluate('document.querySelector("a").click()');
      }
      await until(() => callbacks.length > callbackCount);
      stage = 'approve/client-callback';
      const received = callbacks[callbackCount]!;
      stage = 'approve/client-referrer';
      assert(
        received.referer === undefined,
        'Client handoff must omit Referer',
      );
      stage = 'approve/client-destination';
      assert(
        received.url.origin === item.target &&
          received.url.pathname === '/callback',
        'Handoff must use registered destination',
      );
      stage = 'approve/client-code-state';
      assert(
        received.url.searchParams.get('state') === state &&
          !!received.url.searchParams.get('code'),
        'Handoff must preserve OAuth code/state',
      );
      stage = 'approve/client-query-escaping';
      assert(
        received.url.searchParams.get('label') === "'quoted'" &&
          received.url.searchParams.get('marker') === '"><script>' &&
          received.url.searchParams.get('joined') === 'a&b',
        'Escaping must preserve registered query values',
      );
      stage = 'approve/token-exchange';
      const tokens = await mf.dispatchFetch(appOrigin + '/oauth/token', {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: client.clientId,
          redirect_uri: redirect,
          code: received.url.searchParams.get('code')!,
          code_verifier: verifier,
          resource: appOrigin + '/mcp',
        }),
      });
      assert(
        tokens.status === 200,
        'Browser-delivered authorization code must exchange successfully',
      );
      await tokens.arrayBuffer();
    } else {
      assert(
        post.status === 403,
        'Denied or invalid consent must remain forbidden',
      );
      assert(
        callbacks.length === callbackCount,
        'Denied consent must not reach a client',
      );
      assert(
        (await db.prepare('SELECT COUNT(*) AS n FROM grants').first('n')) ===
          grantsBefore,
        'Denied consent must not create a grant',
      );
    }
    assert(
      !cspBlocked && !bridgeFailed,
      'Browser must complete without CSP or bridge failures',
    );
  }
  console.log(
    JSON.stringify({
      browser: version.Browser,
      syntheticOnly: true,
      cases: cases.length,
      passed: true,
    }),
  );
  await cdp('Browser.close').catch(() => {});
} catch {
  throw new Error(
    `Consent browser gate failed at ${stage}; request data omitted.`,
  );
} finally {
  ws?.close();
  browser?.kill();
  app.closeAllConnections();
  callback.closeAllConnections();
  await Promise.all([
    new Promise<void>((done) => app.close(() => done())),
    new Promise<void>((done) => callback.close(() => done())),
  ]);
  await mf?.dispose();
  // Verify the generated profile is inside the intended test-results root.
  assert(
    profile.startsWith(resultsRoot + '\\') ||
      profile.startsWith(resultsRoot + '/'),
  );
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
