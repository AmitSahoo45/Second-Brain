# Shared Memory — T01 synthetic feasibility probe

This repository currently provides an authenticated, disposable MCP probe. It does not yet implement the memory service or dashboard. `src/index.ts`, the production entry, returns HTTP 503. Only `src/probe.ts` exposes `probe_read` and `probe_write`; it rejects `APP_ENV=production`.

The four required live surfaces are **ChatGPT web, Codex VS Code, Grok web and Claude web**. Local workerd/D1 tests and the official MCP SDK client are automated evidence only. Their actual connections and Cloudflare CPU measurements remain pending. G1 must pass before full memory features begin; T02 admission then requires a second live CPU/client checkpoint.

## Local verification

Use Node **22.20.0** and npm **11.19.1**. The host's global npm 10.9.3 can remain unchanged. npm 10.9.3 and 10.9.9 crash while resolving current optional Vite devtools peers; temporary npm 11.19.1 installs the exact compatible graph without overrides:

```powershell
npm exec --yes --offline=false --package=npm@11.19.1 -- npm ci --offline=false
npm run check
npm test -- tests/auth/config.test.ts
```

`check` runs strict types, ESLint/Prettier, real workerd/KV/D1 authentication and SDK tests, Node tooling tests, dependency/license inventory, and both production/probe dry-run bundles. No live resources are created. Windows sandbox restrictions may require allowing workerd child processes. npm 11 currently prints lifecycle-script approval advisories for bundled esbuild/workerd and core-js-pure; they are disclosed in the implementation evidence, and the actual runtime/build checks are required.

`npm run types` regenerates `worker-configuration.d.ts`. `npm run check:dependencies` regenerates ignored `evidence/dependencies.json` from the lock and installed artifacts. `node scripts/check-dependencies.mts --write-notices` regenerates full bundled third-party texts; immutable Workers SDK supplements use `evidence/research/upstream-licenses/` when available. Preserve those supplements when refreshing notices on a clean checkout (see their exact source URLs in `THIRD_PARTY_NOTICES.md`).

## Run the authenticated probe locally

1. Copy `.dev.vars.example` to ignored `.dev.vars`; supply your verified immutable GitHub numeric subject and GitHub OAuth app ID/secret. Set that app's callback to `http://127.0.0.1:8787/oauth/callback`. No model or embedding key is used.
2. Apply the local migration: `npx wrangler d1 migrations apply probe-local-only --local --config wrangler.probe.jsonc`.
3. Run `npm run dev`. The canonical local resource is `http://127.0.0.1:8787/mcp`; missing identity/secrets/bindings fail closed. Tests use synthetic upstream responses only inside test files.
4. Preregister an exact client redirect using the following local utility. Registration and CIMD fetching are disabled on the probe's public routes.

In a separate terminal:

```powershell
npx wrangler dev --config wrangler.registration.jsonc --local --port 8792
```

Then:

```powershell
npm run register:client -- "My local diagnostic client" "http://127.0.0.1:3000/callback"
npx wrangler kv bulk put .dev.vars.client-registration.json --binding OAUTH_KV --local --config wrangler.probe.jsonc
```

The utility invokes the maintained provider's `createClient` in local workerd and exports its actual public-client KV record. It prints the client ID; no client secret is issued. It refuses remote serving, wildcard redirects and non-loopback HTTP redirects. The ignored output uses exclusive-create mode, so review/archive each artifact before generating the next client. Stop the setup Worker afterwards. No registration helper is imported by either application entry.

Each client needs its own registered client ID and **observed exact redirect**. The provider supports RFC 8252 loopback port flexibility; hosted redirects are exact. A required vendor UI that cannot use a preregistered public client is an explicit compatibility blocker; do not enable unrestricted registration to bypass it.

Login checks GitHub's numeric ID, then shows explicit client, synthetic project ID and scopes on a CSRF-protected consent page. Reuse the displayed project ID in tools. Only `synthetic:`-prefixed values are admitted, bounded to 8 KiB UTF-8 and a conservative serialized response budget. The disposable write increments a probe revision but is **not** a production memory write, immutable history, or idempotent receipt.

## Staging preparation and live gate

No Cloudflare resource has been provisioned or deployed. The account is currently unauthenticated. Deployment requires session authorization plus these actual prerequisites:

- A selected Cloudflare account, separate staging D1/KV, and stable HTTPS hostname for the exact `/mcp` resource.
- Verified owner subject, a GitHub OAuth app whose callback is that hostname's `/oauth/callback`, and its secret installed as `GITHUB_CLIENT_SECRET` using Wrangler's secret mechanism. Never put secrets into the tracked example or command arguments.
- Each required vendor account/plan available, its actual redirect URI, and a supported preregistered public-client setup method.

Copy `wrangler.staging.example.json` to ignored `.dev.vars.staging.json` and replace every placeholder with actual authorized staging configuration. `npm run preflight:staging` refuses absent/invalid configuration; the deployed handler separately refuses missing secrets/bindings. The preflight validates configuration structure, not Cloudflare account access, actual resource ownership or installed remote secrets.

After authorization, use the chosen staging configuration for Wrangler login/resource setup, remote migration application, secret installation and the reviewed public-client KV artifact import. Remote import is `npx wrangler kv bulk put .dev.vars.client-registration.json --binding OAUTH_KV --remote --config .dev.vars.staging.json`. `npm run deploy:staging` performs preflight and deploys only this isolated probe. These remote commands are not part of `check` or CI and have not been run.

Record each required surface's actual login, discovery, synthetic shared write/read/update, reconnect/refresh and revoked-grant result. Report failures and unavailable account features plainly. Never substitute Codex CLI or Claude Code for the required UI surfaces. The local detailed packet is `evidence/live-gate-runbook.md`; observations belong in redacted `evidence/` reports.

Measure authenticated cold/warm CPU and wall latency, token issuance/refresh, KV/D1 activity, ordinary maximum bytes and escaping boundary failures. Use Cloudflare aggregate CPU/outcome metrics, not unredacted invocation URLs: callback URLs contain sensitive code/state. Logging and tracing remain disabled in supplied deployment configs. The Free 10 ms CPU limit and desired p95 <=7 ms / p99 <10 ms are **unverified**. Do not infer CPU from local wall time. Repeat after T02; preserve a failed gate and propose a concrete package/host/client tradeoff before continuing features or spending.

The current probe performs provider verification plus an effective-token unwrap and primary D1 admission per request. Opaque provider grant IDs map separately to server-created UUID actor IDs. This extra cost is intentional evidence for the spike, not a production CPU claim.
