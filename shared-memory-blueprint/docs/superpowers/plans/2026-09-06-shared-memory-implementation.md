# Shared Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. GPT-6-Astra with Ultra reasoning is the user's requested coding-session configuration.

**Goal:** Build a personal, inspectable memory service that ChatGPT web, Codex and Claude can read and update through one authenticated MCP endpoint.

**Architecture:** A Cloudflare Worker serves stateless MCP and a small owner dashboard. Maintained OAuth components handle protocol authentication; primary D1 admission enforces owner, grant and project scope. D1 stores versioned canonical notes, atomic receipts and a rebuildable FTS5 index; browser exports provide a portable recovery route.

**Tech Stack:** TypeScript; Node 22 LTS development tooling; npm lockfile; released compatible MCP SDK v2, Cloudflare Agents handler, Workers OAuth Provider and Wrangler; D1; provider KV; Vite/React dashboard; Vitest/Workers test pool; Playwright; local `age` encryption.

**Spec:** [2026-09-06-shared-memory-design.md](../specs/2026-09-06-shared-memory-design.md). Read it with [BASELINE.md](../../BASELINE.md), [MCP-CONTRACT.md](../../contracts/MCP-CONTRACT.md) and [DATA-MODEL.md](../../contracts/DATA-MODEL.md) before editing. This is a proposed plan, not evidence of implemented or passing software.

## Global Constraints

- One personal owner, no public signup or team sharing in v1.
- Target ChatGPT web, Codex CLI, Codex IDE, Claude web and Claude Code; report eligibility and actual test evidence per surface.
- Tool-only MCP; no widget, LLM API, embeddings, transcript scraping or browser extension in P0.
- Node 22 LTS is development/CI tooling; runtime is Workers. Compatibility date `2026-09-06` is revalidated in T01.
- Released mutually compatible packages only, exact versions and lockfile; do not mix SDK v1 examples with v2 imports.
- Primary D1 authorization on every protected operation; no auth read means denial; no read replicas or protected content cache.
- Explicit project ID, server-derived actor, expected revision on update, operation UUID on every note mutation.
- Ordinary input <=32 KiB; editable note <=12 KiB, body <=8 KiB; all accepted notes must fit a <=24 KiB read response.
- Search default 5/max20; context default 8 KiB/max16 KiB; exact remaining limits are normative in the MCP contract.
- Atomic current row, revision, index, success audit and receipt; no silent overwrite or partial success.
- Browser-session P0 export/import; local CLI only verifies/encrypts/decrypts downloaded files; no model admin credential.
- Export <=25 MiB, <=256 KiB/100 records per page, write barrier <=10 minutes; preserve latest deletion ledger independently.
- All fixtures synthetic. No production data, tokens, note/query bodies or source excerpts in logs, repository or CI.
- Paid upgrades and production deployment follow the authorization of the implementation session; no automatic spending.

## 1. Execution map and review boundaries

Execute T01 → T02 → T03 → T04. T05 and dashboard shell work in T07 may then proceed independently against frozen interfaces; complete T06 before connecting dashboard services. T08 and T09 depend on the mutation rules. T10 and T11 can run independently after feature completion. T12 consumes all gate evidence. T13 and T14 are optional P1 work and are not required for the personal P0 release.

T01 has an intentional two-stage result: first a minimal authenticated synthetic client/CPU experiment; after T02 it is rerun with the final D1 authorization overlay. This resolves the dependency without pretending the initial experiment proves full production security. Stop building features if either gate fails. A supported SDK combination, a client connection and an authenticated request budget are architecture requirements.

Each task ends with a reviewed commit. Run its focused tests during the task, then `npm run check` at integration boundaries. Do not rerun the entire load/client matrix for a prose edit. Record what was actually run, command exit status, environment, commit, package versions and observed result in `evidence/`; redact account secrets and personal content.

## 2. Planned repository layout

These paths are future application files. Only documentation and diagrams exist in this planning package.

```text
.github/workflows/check.yml       trusted-independent PR validation
.github/workflows/staging.yml     authorized staging deployment
.github/workflows/release.yml     production release gate
.github/ISSUE_TEMPLATE/bug.yml    redacted reproducible bug intake
package.json                     explicit scripts and pinned dependencies
package-lock.json                exact resolved dependency graph
tsconfig.json                    strict Worker/domain types
wrangler.jsonc                   environment-specific bindings
vite.config.ts                   dashboard build
vitest.config.ts                 Worker test pool configuration
playwright.config.ts             browser tests against local/staging app
.env.example                     variable names, no real credentials
src/index.ts                     route entry and environment construction
src/config.ts                    validated environment settings
src/auth/provider.ts             maintained OAuth provider integration
src/auth/owner-login.ts          GitHub immutable-subject check
src/auth/admission.ts            D1 owner/grant/project admission
src/auth/admin-session.ts        owner session and CSRF
src/auth/registration.ts         bounded client registration policy
src/domain/types.ts              shared public/domain types
src/domain/validation.ts         exact bounds and evidence rules
src/domain/canonical.ts          normalization and request hashing
src/domain/memory-service.ts     application methods from MCP contract
src/domain/context.ts            full/excerpt packing with byte budgets
src/db/migrations/0001_auth.sql   owner, grants, admission indexes
src/db/migrations/0002_memory.sql canonical memory, revisions and FTS
src/db/migrations/0003_ops.sql    leases, receipts, audit, import and ledger
src/db/repository.ts             bound read/write operations
src/db/write-batch.ts            attempt marker, CAS and tail assertion
src/db/search.ts                 scoped literal FTS and exact aliases
src/db/purge.ts                  tombstone-driven purge transaction
src/mcp/server.ts                fresh SDK server factory
src/mcp/tools.ts                 seven tool registrations
src/mcp/response.ts              SDK response/error and size mapping
src/admin/routes.ts              owner-only HTTP endpoints
src/admin/projects.ts            project create/rename/archive rules
src/admin/grants.ts              list/revoke, no bearer-token output
src/operations/export.ts         lease and canonical page production
src/operations/import.ts         bounded isolated restore
src/operations/retention.ts      metadata/import cleanup
src/operations/status.ts         redacted health/usage/backup state
src/operations/telemetry.ts      content-free event serialization
web/src/App.tsx                  route shell and project navigation
web/src/api.ts                   CSRF, owner-session requests, typed errors
web/src/screens/Memory.tsx       search/detail/editor/history
web/src/screens/Connections.tsx  independent project grants/revoke
web/src/screens/Recovery.tsx     browser download/import/verification status
web/src/screens/Status.tsx       observed calls, quotas, version
web/src/styles.css              responsive, accessible plain presentation
scripts/check-dependencies.mts   installed artifact/license inventory
scripts/staging-smoke.mts        authorized synthetic staging scenarios
scripts/backup-verify.mts        local manifest/checksum validation
scripts/backup-crypt.mts         interactive local age wrapper
scripts/evaluate.mts             frozen retrieval metrics
scripts/eval-metrics.mts         independently testable metric formulas
scripts/load.mts                 latency/CPU workload runner
tests/support/harness.ts         real local D1 test harness
tests/support/fixtures.ts        synthetic owners, projects and notes
tests/auth/*.test.ts             protocol/admission negative scenarios
tests/db/*.test.ts               migration/atomicity/search/purge tests
tests/domain/*.test.ts           bounds, normalization and context
tests/operations/*.test.ts       export/import/recovery faults
tests/browser/*.spec.ts          owner workflows and accessibility
eval/cases.jsonl                 fixed 200-query corpus
eval/notes.jsonl                 gold evidence plus seeded distractors
evidence/                       redacted reports, never auth/notes/log dumps
docs/                           this plan, contracts, runbooks and decisions
```

Use one repository and one Worker deployable. A monorepo framework, queue, vector store and separate API host are unnecessary here. Split a module further when it has two independent responsibilities; do not reorganize working code just for symmetry.

## 3. Shared test and implementation interfaces

T03 implements these test-only interfaces. All later code examples import them; `createHarness` uses workerd/local D1 migrations, never an in-memory repository mock. Fault injection exists only through a test-injected repository adapter and is absent from the production route bundle.

```ts
// tests/support/harness.ts; contract implemented in T03
import type { AuthContext, MemoryService, NoteFields, WriteReceipt }
  from '../../src/domain/types';

export interface Harness {
  service: MemoryService;
  ctx: AuthContext;
  otherCtx: AuthContext;
  projectId: string;
  otherProjectId: string;
  note(overrides?: Partial<NoteFields>): NoteFields;
  seed(note?: Partial<NoteFields>): Promise<WriteReceipt>;
  counts(memoryId: string): Promise<{current:number;revisions:number;fts:number;receipts:number}>;
  failNext(stage:'revision'|'fts'|'audit'|'receipt'): void;
  archiveProject(): Promise<void>;
  revokeActor(): Promise<void>;
  dispose(): Promise<void>;
}
export declare function createHarness(): Promise<Harness>;
```

Before T04, `seed` writes a validated fixture directly through test-only prepared statements; after T04, it calls the production save path. Return synthetic UUIDs from fixtures, not example real account IDs. Examples below are the smallest meaningful assertions; the test strategy supplies the additional mandatory case matrix.

## T01: Prove the runtime, packages and actual client path

**Files:** create package/config/CI files from the layout, `src/index.ts`, `src/config.ts`, `src/mcp/server.ts`, `src/auth/provider.ts`, `scripts/check-dependencies.mts`, `tests/auth/config.test.ts`, `evidence/compatibility-spike.md`, `evidence/dependencies.json`, `THIRD_PARTY_NOTICES.md`.

**Consumes:** deployment prerequisites in the spec; current primary documentation in `docs/SOURCES.md`.

**Produces:** `loadConfig(env: Record<string,unknown>): AppConfig`; `createMcpServer(deps: ServerDependencies): McpServer` as a fresh instance per supported stateless request; scripts `check`, `test`, `typecheck`, `lint`, `build`, `dev`, `deploy:staging`; frozen released package inventory. `ServerDependencies` initially contains the synthetic probe store and later the `MemoryService` plus admission context. Do not publish the probe in production.

- [ ] Resolve current released SDK/handler/OAuth compatibility from installed package exports and primary docs. Record exact package version, integrity hash, source release/commit, license and checked date. Inspect LICENSE/NOTICE in the actual artifacts, including copied snippets. Commit the lockfile; do not invent version numbers from this plan.
- [ ] Write `config.test.ts` before configuration parsing:

```ts
import { expect, test } from 'vitest';
import { loadConfig } from '../../src/config';
test('production refuses a loopback MCP audience', () => {
  expect(() => loadConfig({ APP_ENV:'production',
    MCP_RESOURCE_URL:'http://127.0.0.1:8787/mcp' })).toThrow();
});
```

- [ ] Run `npm test -- tests/auth/config.test.ts`; confirm the missing/incorrect implementation fails. Implement strict environment parsing and separation. Parse the URL with `new URL`; compare full resource identity; reject missing bindings and production localhost rather than silently defaulting.
- [ ] Wire the SDK's current released API following the installed types. The application adapter must keep this shape:

```ts
const config = loadConfig(env);
// resolveRequestDependencies authenticates through the provider before the handler.
const deps = await resolveRequestDependencies(request, env, config);
return handleStatelessMcp(request, createMcpServer(deps));
```

`resolveRequestDependencies(request, env, config): Promise<ServerDependencies>` and `handleStatelessMcp(request, server): Promise<Response>` are wrappers implemented in this task around the selected provider and `agents/mcp/server` API. Use its documented factory lifecycle; this pseudocode fixes separation, not a fabricated SDK method signature.

- [ ] On an authorized synthetic staging environment, complete real login/tool discovery/probe read/write in ChatGPT web, Codex CLI/IDE and Claude web/Code. Record unsupported account/plan surfaces as failed or unavailable, never passed. Exclude the experiment from production build entry points.
- [ ] Measure authenticated warm/cold CPU, latency, OAuth/KV/D1 activity and maximum-body serialization. Record the Free 10 ms constraint and observed failures. Repeat after T02 with final admission. If incompatible, preserve evidence and propose a concrete package/host/client tradeoff; do not continue full features.
- [ ] Run focused tests, typecheck and build. Commit: `chore: establish authenticated runtime compatibility baseline`.

**Gate G1:** released package combination builds; all target surfaces have documented connection results; actual authenticated CPU evidence exists. User-account access is a prerequisite for a missing real-client test, not something synthetic tests can replace.

## T02: Admit only the owner and selected projects

**Files:** create `src/auth/owner-login.ts`, `admission.ts`, `admin-session.ts`, `registration.ts`, `src/db/migrations/0001_auth.sql`, `tests/auth/admission.test.ts`, `tests/auth/oauth.test.ts`; modify provider/config wiring and evidence report.

**Consumes:** T01 provider and stable resource URL. **Produces:** `admitMcp(request:Request,env:Env):Promise<AuthContext>`; `admitAdmin(request:Request,env:Env,mutation:boolean):Promise<AuthContext>`; `revokeGrant(ctx:AuthContext,grantId:string):Promise<void>`. `Env` is the generated Worker binding type; `AuthContext` follows the MCP contract's discriminated server actor. Admin admission rejects MCP bearer tokens.

- [ ] Write negative fixtures for wrong GitHub subject, wrong resource audience, absent PKCE, redirect mismatch, insufficient scope, second owner, guessed project and revoked grant. OAuth tests run through the provider's supported public endpoints, not only mocked JWT parsing.
- [ ] Add the decisive revocation assertion:

```ts
test('a committed revoke denies a newly admitted request', async () => {
  const f = await makeAuthFixture(); // implemented in this test file: real local D1 + provider-issued synthetic grant
  await revokeGrant(f.admin, f.grantId);
  await expect(admitMcp(f.request(), f.env)).rejects.toMatchObject({ status:401 });
});
```

`makeAuthFixture(): Promise<{admin:AuthContext;grantId:string;request:()=>Request;env:Env}>` provisions only synthetic local provider and D1 state. Requests admitted before the revoke may finish; test that boundary separately.

- [ ] Run `npm test -- tests/auth`; observe failing cases. Implement immutable numeric owner matching, one owner-admin actor, independent OAuth grant actors, selected project rows and epoch/revocation checks against primary D1 on each operation. Never derive actor identity from tool arguments.
- [ ] Configure PKCE S256 and canonical resource discovery through the maintained provider. Prefer preregistration/CIMD; allow bounded DCR only when a target client demonstrably needs it. Exact hosted redirects; native loopback exceptions limited to registered path/host patterns observed in real clients.
- [ ] Use provider refresh rotation with its documented grace window; test replay beyond grace, parallel refresh and lost response. Owner web sessions use Secure/HttpOnly/SameSite cookies, session expiry, CSRF token and exact Origin on mutations. Verify denied callers cannot enumerate target details.
- [ ] Rerun T01 authenticated CPU and actual-client login/revoke results with the final D1 overlay. `npm test -- tests/auth` must pass. Commit: `feat: enforce owner and project authorization`.

**Gate G2:** all mandatory auth scenarios pass; no KV-only revocation or auth bypass during D1 failure. A working protocol connection without G2 is not releaseable.

## T03: Canonical schema, validation and test harness

**Files:** create `src/domain/types.ts`, `validation.ts`, `canonical.ts`, `src/db/migrations/0002_memory.sql`, `0003_ops.sql`, `src/db/repository.ts`, `tests/support/harness.ts`, `fixtures.ts`, `tests/db/schema.test.ts`, `tests/domain/validation.test.ts`.

**Consumes:** domain tables/types and T02 actor scope. **Produces:** concrete public interfaces from MCP-CONTRACT, `validateNote(input:unknown):NoteFields`, `canonicalRequest(operation:string,projectId:string,args:unknown):string`, `hashRequest(canonical:string):Promise<string>`, and the complete `Harness` above. Later tasks use repository prepared statements, not arbitrary SQL passed through tools.

- [ ] Write validation tests for unknown identity fields, empty evidence, unsupported lifecycle, over-limit Unicode/bytes, invalid validity interval, cross-project relation and source_supported without evidence:

```ts
test('support labels require a usable reference', () => {
  expect(() => validateNote({ ...validSyntheticNote(),
    provenance:'source_supported', evidence:[] })).toThrow();
});
```

`validSyntheticNote(): NoteFields` is exported from `tests/support/fixtures.ts`, with one short unverified synthetic fact and empty optional arrays. Never use a real user's biography as a convenient fixture.

- [ ] Run `npm test -- tests/domain/validation.test.ts tests/db/schema.test.ts`. Implement migrations with composite owner/project FKs, unique fact key, revision>=1, explicit actor snapshots, indexes and FTS5. Test migration from empty DB and rollback-compatible additive changes using actual local D1.
- [ ] Implement normalized hashing: reject duplicate JSON keys at the bounded HTTP input layer; CRLF→LF; title trim; Unicode NFC for title/tags/aliases; preserve meaningful body text and evidence order; sort unordered tags/aliases after deduplication. Stable recursively sorted object keys precede SHA-256 through Web Crypto. Fix the exact normalization in tests before receipts exist.
- [ ] Validate full supported read serialization at admission, reserving bounded server metadata. Test worst-case JSON escaping and duplicated text encoding. A note within raw field caps may still be rejected if the complete read cannot fit; explain that field error clearly.

For a retry, current authentication and bounded parse/hash precede retained receipt lookup. Replay a matching committed receipt before new-mutation-only state/read-feasibility checks, so an archived project, deleted relation, export lease or changed label does not invalidate an already committed result. Revoked actors still fail authentication first.
- [ ] Implement harness migrations, two-owner fixtures and isolated cleanup. Keep fault injection/test factories out of production bundles. Compare FTS/canonical rows after seeded inserts.
- [ ] Run focused migration/validation tests and typecheck. Commit: `feat: define canonical memory schema and bounds`.

## T04: Atomic saves, corrections and safe retries

**Files:** create `src/db/write-batch.ts`, `src/domain/memory-service.ts`, `tests/db/mutations.test.ts`, `tests/db/races.test.ts`; modify repository/harness.

**Consumes:** validated `NoteFields`, `AuthContext`, hashing, migrations. **Produces:** `MemoryService.save` and `.update` with exact signatures in MCP-CONTRACT, backed by `executeMutation(ctx,input):Promise<Outcome<WriteReceipt>>`; discriminated `input` is `{operation:'save';value:SaveInput}|{operation:'update';value:UpdateInput}`.

- [ ] Write the race and rollback tests before mutation SQL:

```ts
test('only one stale-revision contender commits', async () => {
  const h = await createHarness();
  try {
    const seed = await h.seed();
    const write = (body:string) => h.service.update(h.ctx, {
      project_id:h.projectId, memory_id:seed.memory_id,
      expected_revision:seed.revision, note:h.note({body}),
      reason:'correction: synthetic race', operation_id:crypto.randomUUID()
    });
    const results = await Promise.all([write('A'), write('B')]);
    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(results.filter(r => !r.ok).map(r => r.ok ? '' : r.error.code))
      .toEqual(['REVISION_CONFLICT']);
    expect((await h.counts(seed.memory_id)).revisions).toBe(2);
  } finally { await h.dispose(); }
});
```

- [ ] Run `npm test -- tests/db/mutations.test.ts tests/db/races.test.ts`; confirm the missing transaction implementation fails.
- [ ] Implement the exact attempt-marker/conditional `INSERT … SELECT`/tail-assertion protocol in DATA-MODEL. Check canonical write barrier in SQL; place no unconditional success audit/receipt after a zero-row CAS. Actor-scoped receipt uniqueness and fact-key uniqueness remain database constraints.
- [ ] Return only persisted receipt fields. On batch error reread same-scoped receipt and compare request hash; distinguish known guard/unique error from storage unavailability. Same operation changed payload rejects; stale revision requires a new deliberate operation after reread.
- [ ] Add test injections at revision, FTS, audit and receipt stages; assert no partial current/revision/index/success receipt remains. Run 100 concurrent pairs and 100 lost-response retries locally and on staging. Test expired-receipt behavior without automatic old replay.
- [ ] Verify full note readability, immutable actor labels, evidence and same-project relationships. Run focused tests and `npm run check`. Commit: `feat: commit versioned memory mutations atomically`.

**Gate G3:** mandatory integrity suite passes on actual D1, including zero-row CAS guard failure and concurrency. Do not infer transactional correctness from JavaScript unit tests alone.

## T05: Scoped search, explicit reads and history

**Files:** create `src/db/search.ts`, `tests/db/search.test.ts`, `tests/db/history.test.ts`; modify repository/service.

**Consumes:** current canonical rows, revisions, authorized contexts. **Produces:** `MemoryService.search`, `.read`, `.history`; `listProjects(ctx:AuthContext,input:{cursor?:string;limit?:number}):Promise<Outcome<{projects:ProjectCard[];next_cursor?:string}>>`, with `ProjectCard` exactly matching MCP-CONTRACT's project output.

- [ ] Write search isolation and archive tests:

```ts
test('another owner cannot retrieve a seeded exact title', async () => {
  const h = await createHarness();
  try {
    await h.seed({title:'SYNTHETIC-ALPHA'});
    const r = await h.service.search(h.otherCtx,
      {project_id:h.projectId, query:'SYNTHETIC-ALPHA'});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
  } finally { await h.dispose(); }
});
```

- [ ] Run `npm test -- tests/db/search.test.ts tests/db/history.test.ts` and observe failure before implementing the read methods.
- [ ] Implement parameterized owner/project joins before result ranking. Parse <=24 literal tokens; never accept caller FTS operators. Rank exact fact key, title, aliases, then weighted FTS. Fix deterministic tie breaks and use a signed cursor bound to actor/query/filter/project with 15-minute expiry.
- [ ] Implement current/explicit-revision reads, history metadata pagination and authorized project listing. Hide archived projects from ordinary list/search/context; explicit granted read/history remains available. Distinguish archived note access from project write admission.
- [ ] Add quoted punctuation, C#/.NET, UUID, Bengali and romanized alias fixtures. Verify only permitted IDs/counts/snippets and source claims escape serialization. Test cursor tampering, changed filters and multiple result pages during concurrent updates.
- [ ] Run focused tests and commit: `feat: retrieve scoped memory and revision history`.

## T06: Bounded context, seven tools and safe observability

**Files:** create `src/domain/context.ts`, `src/mcp/tools.ts`, `response.ts`, `src/operations/telemetry.ts`, `status.ts`, `tests/domain/context.test.ts`, `tests/domain/response.test.ts`; modify server/service/entry.

**Consumes:** T05 search/read/history, T04 writes, T02 admission. **Produces:** `MemoryService.context`; `registerMemoryTools(server:McpServer,service:MemoryService,ctx:AuthContext):void`; `encodeToolResult<T>(result:Outcome<T>,limitBytes:number):CallToolResult`; `packContext(records:ContextCandidate[],budget:number):ContextPack`. `ContextCandidate` is `{record:MemoryRecord;match_reason:SearchCard['match_reason'];from_profile:boolean}` in `src/domain/context.ts`, assembled from a ranked search hit and authorized full read. `CallToolResult` comes from installed SDK, `ContextPack` and its full/excerpt union from the MCP contract. `profile_included` is true only when at least one profile item is returned, and its final value is included before size calculation.

- [ ] Write a byte-bound test with long Unicode and escaped strings, requiring parseable output, IDs, provenance and explicit excerpt markers:

```ts
test('context honors the final envelope budget', () => {
  const pack = packContext(longSyntheticRecords(), 2048);
  const result = encodeToolResult({ok:true,data:pack,
    request_id:'00000000-0000-4000-8000-000000000001'}, 2048);
  expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThanOrEqual(2048);
});
```

`longSyntheticRecords(): ContextCandidate[]` is a fixture in this test module built from the accepted maximum shapes, including qualifiers and their real match reasons. Budgeting reserves the response envelope before packing and computes final `used_bytes` to stability.

- [ ] Run `npm test -- tests/domain/context.test.ts tests/domain/response.test.ts`; then implement greedy ranked packing: full notes that fit, otherwise labeled excerpts/cards, otherwise omit and mark truncated. Never return malformed JSON or drop a provenance/uncertainty label to fit.
- [ ] Register exactly seven tools, strict schemas and contract annotations. Use SDK structured content plus short text, or the bounded compatibility encoding proved in T01. Map auth to 401, domain errors to `isError:true`, inaccessible IDs to NOT_FOUND. No export/purge/admin tools.
- [ ] Add explicit profile opt-in requiring its own grant. Mark memory as untrusted reference data in server instructions and descriptions. Transport carries no raw chat history by default.
- [ ] Implement a typed allowlist telemetry serializer: request ID, actor ID, operation, outcome, duration, CPU/DB counters only. Tests place canary secrets into input/query/evidence and assert no log serialization contains them. Public health exposes version/status only; owner status distinguishes observed calls from impossible-to-observe missed chats.
- [ ] Run focused tests, Inspector schema checks and `npm run check`. Commit: `feat: expose bounded shared memory tools`.

## T07: Owner dashboard, projects and connected clients

**Files:** create `src/admin/routes.ts`, `projects.ts`, `grants.ts`, `web/src/App.tsx`, `api.ts`, Memory/Connections/Status screens, styles, `tests/browser/owner.spec.ts`, `tests/browser/accessibility.spec.ts`.

**Consumes:** T02 admin admission; T04-T06 domain service; exact admin endpoint table. **Produces:** owner-only CRUD/inspection routes and accessible desktop/mobile flows, plus `adminFetch<T>(path:string,init:RequestInit):Promise<Outcome<T>>` in browser API code. All owner note mutations receive the stable owner_admin actor through server admission.

- [ ] Write a browser workflow assertion before the screen implementation:

```ts
test('stale edit shows a reconciliation path', async ({ page }) => {
  await signInSyntheticOwner(page);
  await openSyntheticNote(page);
  await commitConcurrentSyntheticUpdate();
  await page.getByRole('textbox', {name:'Body'}).fill('My proposed correction');
  await page.getByRole('button', {name:'Save changes'}).click();
  await expect(page.getByRole('alert')).toContainText('changed');
  await expect(page.getByRole('button', {name:'Reload current version'})).toBeVisible();
});
```

Implement these three test setup functions in `tests/browser/fixtures.ts` against a local test owner/service fixture; no public bypass route ships. Test setup supplies a valid local owner cookie through the server's session utility, never disables production middleware.

- [ ] Run `npx playwright test tests/browser/owner.spec.ts`. Implement project selector, searchable list, escaped plain-text detail, editor and version history. Fetch the version before editing; on conflict preserve unsaved text and offer manual reconciliation. No overwrite-without-revision action.
- [ ] Implement project create/rename/archive/unarchive with explicit revisions and write-barrier checks. Profile is unique and separately granted. Connected-clients screen lists nonsecret labels, scopes and projects; revoke an individual grant and verify newly admitted calls fail.
- [ ] Apply owner auth/CSRF/Origin checks to every admin mutation. Escape text and restrict explicit link schemes to safe http/https references; no automatic URL fetch or remote images. Add CSP and no-store responses. Render errors without raw request bodies.
- [ ] Test 390 px and desktop layout, keyboard navigation, focus restoration, accessible labels, empty/loading/error states and no color-only provenance. Run an accessibility scan on core screens.
- [ ] Run browser/auth tests and build. Commit: `feat: add owner memory and connection dashboard`.

## T08: Archive and permanent deletion without retry resurrection

**Files:** create `src/db/purge.ts`, `tests/db/purge.test.ts`; modify admin routes, Memory screen and deletion ledger/repository code.

**Consumes:** T04 CAS/receipts, admin actor, lifecycle rules. **Produces:** `purgeMemory(ctx:AuthContext,input:{project_id:string;memory_id:string;expected_revision:number;typed_title:string;operation_id:string}):Promise<Outcome<PurgeReceipt>>`; `PurgeReceipt` contains memory/project/operation IDs, purged_at and replayed, no note content. Only admin admission can call it.

- [ ] Write purge rollback, duplicate retry, concurrent update and content absence assertions. The decisive invariant:

```ts
expect(await inspectPurgedState(memoryId)).toEqual({
  current:0, revisions:0, fts:0, relations:0,
  tombstones:1, contentBearingReceipts:0
});
```

`inspectPurgedState(memoryId)` is a test-only prepared-query helper in `tests/db/purge.test.ts` against its local D1 binding. It checks all data tables, not only tool output.

- [ ] Run `npm test -- tests/db/purge.test.ts`. Implement the dedicated tombstone-driven transaction in DATA-MODEL: check title/revision/barrier, insert attempt-tagged tombstone and purge receipt conditionally, remove canonical/revision/index/relations, mark existing metadata receipts purged, assert the purge-specific receipt exists. The generic live-row success insertion is invalid after deletion.
- [ ] Test that an old retained save/update retry returns PURGED, old memory IDs stay reserved, and replay after the documented 90-day receipt window is never automated. Ledger cannot prove unknown expired save operation IDs; do not claim otherwise.
- [ ] Add owner typed-title confirmation explaining old backups/Time Travel retention. Archive uses normal update/revision and is reversible; purge removes content and reserves IDs. Download latest ledger from the recovery screen after purge.
- [ ] Run purge/race/browser focused tests. Commit: `feat: add deletion ledger and atomic permanent purge`.

## T09: Browser exports, isolated restore and local encrypted copies

**Files:** create `src/operations/export.ts`, `import.ts`, `retention.ts`, `web/src/screens/Recovery.tsx`, `scripts/backup-verify.mts`, `backup-crypt.mts`, `tests/operations/backup.test.ts`, `tests/operations/restore.test.ts`, `tests/browser/recovery.spec.ts`.

**Consumes:** canonical tables, admin session, write barriers and tombstones. **Produces:** admin export/import endpoints from MCP-CONTRACT; local scripts `backup:verify`, `backup:encrypt`, `backup:decrypt`; `verifyBundle(directory:string):Promise<BackupManifest>`; `BackupManifest` exactly matches DATA-MODEL. The browser assembles bounded archive entries without sending encryption passphrases to the server.

- [ ] Write a recovery fixture before exporting code: create two revisions, export, purge one memory afterward, import the old export into a fresh isolated database with the newest ledger, and assert the purged ID is absent and retained history/FTS match.

```ts
test('restore applies deletion knowledge newer than the backup', async () => {
  const f = await createRecoveryFixture();
  const restored = await f.restore(f.oldBundle, f.latestLedger);
  expect(await restored.readPurgedId()).toEqual({code:'NOT_FOUND'});
  expect(await restored.canonicalDigest()).toBe(f.expectedRetainedDigest);
});
```

`createRecoveryFixture()` in `tests/operations/fixtures.ts` owns separate migrated source/target D1 bindings, synthetic admin sessions and bundle fixtures; returned methods invoke actual application export/import paths.

- [ ] Run `npm test -- tests/operations/backup.test.ts tests/operations/restore.test.ts`. Implement lease acquisition, deterministic <=100-record/256-KiB pages, SHA-256 manifest, <=25-MiB total and finish only under same unexpired lease. Every canonical writer checks lease in its SQL. Reads and emergency revocation continue. Do not drop FTS or call raw D1 export.
- [ ] Implement browser download/verify status backed by `export_records`, separating server completion from owner-reported local verification. Use the contract's verification-report endpoint, store no content in this metadata record, and provide the separate owner-only deletion-ledger export. Preserve names/checksums exactly; reject zip traversal, duplicate paths/records, decompression bombs, unknown types and invalid relationships on local/server import.
- [ ] Implement local `backup:verify` over extracted files, then `backup:encrypt -- bundle-dir --output backup.age` and `backup:decrypt -- backup.age --output bundle-dir`. Wrap installed `age` with inherited interactive stdin; no passphrase argument/env/log. Refuse unsafe overwrite. No remote admin credential or network fetch in these scripts.
- [ ] Implement isolated import with external MCP closed, owner namespace validation, bounded idempotent chunks, no auth/grants restore, immutable actor snapshots, FTS rebuild and ledger merge. A missing newest ledger blocks promotion unless owner explicitly reviews resurrection risk. Restore never silently changes production bindings.
- [ ] Exercise lease expiry, finish race, truncated/corrupt files, overflow, browser disconnect, purge/export races, import replay and abandoned-run cleanup after 24 h. Time a full isolated drill and keep the measured result.
- [ ] Run focused tests, browser recovery and local CLI verification. Commit: `feat: add portable encrypted backup and recovery workflow`.

**Gate G4:** one demonstrated canonical/history/search-equivalent isolated restore, newest ledger applied, independently held encrypted copy and truthful verification state. Manual backups do not establish an automatic 24-hour RPO.

## T10: Evaluate retrieval and prove resource headroom

**Files:** create `eval/cases.jsonl`, `notes.jsonl`, `scripts/evaluate.mts`, `eval-metrics.mts`, `load.mts`, `tests/domain/evaluation.test.ts`, `evidence/retrieval.json`, `evidence/performance.json`.

**Consumes:** finished service and TEST-STRATEGY. **Produces:** scripts `eval:retrieval`, `eval:load`; versioned synthetic corpus; independently calculated metrics and Free-budget recommendation.

- [ ] Freeze 200 queries: 80 exact/alias, 40 temporal/correction, 20 multi-note, 20 contradiction, 20 no-answer, 20 ambiguous. Seed 10,000 distractor notes with fixed random seed and realistic accepted sizes. Tag expected current revision, required evidence IDs and answerability; do not tune gold after seeing results.
- [ ] Test metric math with a known fixture before the evaluation runner:

```ts
test('macro recall averages each query, not all hit counts', () => {
  expect(macroRecall([[1],[2,3]], [[1],[]])).toBe(0.5);
});
```

Export `macroRecall<T extends string|number>(gold:T[][],returned:T[][]):number` from `scripts/eval-metrics.mts`, with per-query intersection/gold length and equal nonzero query counts; real evaluator uses string ID+revision pairs. The fixture uses integers only to make the expected math easy to inspect. Exclude no-answer cases from recall. TEST-STRATEGY fixes denominators for all reports.

- [ ] Run `npm test -- tests/domain/evaluation.test.ts`, then `npm run eval:retrieval`. Report Recall@5>=90% on exact/alias target, full evidence coverage@10>=80% on 20 multi-note cases, precision/MRR and separate temporal/contradiction/no-answer/ambiguous/paraphrase breakdowns. Targets are proposed thresholds, never assumed results.
- [ ] Run warm/cold load with five concurrent clients at largest admitted payload, 10k-note retrieval, writes, refresh, startup, export and revoked-grant denial. Report p50/p95/p99 wall time, measured CPU, DB rows/indexing and KV calls. Warm search target p95<500ms; Free headroom target p95 CPU<=7ms, p99<10ms with zero observed CPU-limit failures in the test matrix.
- [ ] If a target fails, use a trace to identify query/index/serialization cost and make one measured correction at a time. Do not add embeddings automatically. If Free viability fails, write a priced decision with evidence and stop before paid upgrade or unsupported client removal.
- [ ] Commit: `test: establish retrieval and runtime acceptance evidence`.

## T11: Install instructions and verify the five-client handoff

**Files:** update `docs/integrations/CLIENT-SETUP.md`; create `examples/instructions/chatgpt.txt`, `codex-AGENTS.txt`, `claude-personal.txt`, `claude-code-CLAUDE.txt`, `examples/projects.example.json`, `evidence/client-matrix.md`.

**Consumes:** stable actual resource URL, project IDs, independent grants and P0 tools. **Produces:** copyable instructions, account-specific installation record and observed handoff evidence. Instruction examples are data/documentation, not installed global settings until the owner applies them.

- [ ] Copy the common instruction text from CLIENT-SETUP and adapt only supported placement per client. Examples contain clearly labeled nonsecret endpoint/project variables, never tokens. Require project resolution, relevant retrieval, user-correction handling, source uncertainty and receipt-confirmed saves.
- [ ] Verify each actual surface: connect/login, list projects, read, save, update, refresh/restart, revoke. Record app version/account eligibility and tested date. Codex CLI success does not automatically pass Codex IDE; Claude Code success does not pass Claude web.
- [ ] Run the same cross-client scenario: ChatGPT saves synthetic decision revision1; Codex reads and updates to revision2; Claude reads revision2 and history; concurrent update gets conflict; revoked grant cannot newly access records. Save IDs/revisions and redacted observations in evidence.
- [ ] Separately run implicit-use prompts and count whether the model loaded/saved when expected. Score server correctness only for received calls. Global instructions are best effort; inability to enforce browser lifecycle hooks is a documented platform boundary.
- [ ] Test outage responses: assistant states memory unavailable and does not claim a save. Restore connection and reconcile explicitly before writing. Do not poll server status on every model token or transcript event.
- [ ] Commit: `docs: verify cross-client shared-memory setup`.

**Gate G5:** required actual-client capabilities are demonstrated or clearly identified as blocked by account/platform availability. No unconditional “all connected” release claim while a target remains untested.

## T12: Release, operate and preserve a rollback route

**Files:** finalize `.github/workflows/staging.yml`, `release.yml`, `scripts/staging-smoke.mts`, ops runbooks, `CHANGELOG.md`, `evidence/release-checklist.md`.

**Consumes:** G1-G5, retrieval/load reports, exact pinned build and deployment authorization. **Produces:** commands `deploy:staging`, `smoke:staging`, `deploy:production`; released version and operational record when authorized. Plan completion itself does not authorize a paid plan.

- [ ] Write a smoke check that fails if protected calls succeed unauthenticated, persisted synthetic receipt disappears after deployment, or staging bindings equal production bindings. No destructive cleanup of owner notes; canaries use a dedicated synthetic project.
- [ ] Run `npm run check`. Run deployment workflow validation against trusted staging. Pin actions, minimum permissions and environment secrets; no production secrets or deploy jobs on untrusted PR code. Protect canonical source branch and require the declared checks.
- [ ] Verify pre-release export and additive migration compatibility. Document exact previous artifact/schema pair and rollback command from the installed Wrangler version. Never assume application rollback restores data or reverses schema changes.
- [ ] With production authorization, provision isolated resources and secrets, deploy stable URL, run synthetic smoke, reconnect the owner's actual grants, and capture release commit/schema/package/resource evidence. If not authorized, produce the reviewable deployment diff and commands, then request only the missing final action.
- [ ] Exercise quota exhaustion and D1 outage handling: closed auth, no fake success, bounded retries, owner-visible recovery path. Configure available free usage notifications and application thresholds at 70%/85%; distinguish measured counters from approximate/provider-delayed usage.
- [ ] Review incident runbook: revoke a compromised grant, rotate leaked deployment/owner secret, isolate Time Travel restore, preserve latest ledger, diagnose partial availability, recover then reopen. Keep manual export responsibility and restore rehearsal visible.
- [ ] Commit and version: `chore: prepare verified personal-service release`. Create a release only after authorization and all evidence; otherwise retain a release candidate.

## T13: Optional P1 local hooks

**Files:** only after P0, create `integrations/codex/`, `integrations/claude-code/`, hook tests and an instruction-adherence comparison report.

**Consumes:** a verified local CLI/IDE hook capability from current docs and the owner's explicit project mapping. **Produces:** optional context loader/checkpoint helper with bounded runtime and loop guard, no raw transcript upload.

- [ ] Recheck exact supported events and MCP readiness. Codex SessionStart may precede connection readiness; SessionEnd does not support direct MCP hooks in the reviewed docs. Do not fabricate hook support for ChatGPT/Claude web.
- [ ] Write timeout/reentry tests before hook code. A repeated stop event with the same checkpoint must produce one operation ID and at most one receipt. Implement a local checkpoint file written atomically with 0600 permissions, per project/client; store only pending operation metadata and the owner-approved bounded note.
- [ ] Compare hook-enabled/disabled adherence on the same synthetic prompts; report latency and failures. Default timeout is 2 s for a context attempt and no blocking retries during shutdown; pending writes require explicit next-session reconciliation within receipt retention.
- [ ] Commit: `feat: add optional local memory lifecycle helpers`. Ship only the clients/events actually verified.

## T14: Optional P1 automated offsite recovery

**Files:** only after destination authorization, add one backup scheduler/worker adapter, destination-specific secret configuration and recovery tests.

**Consumes:** T09 verified format and chosen authorized destination, retention, budget and encryption-key custody. **Produces:** scheduled encrypted backups with delivery verification and failure notification selected by owner.

- [ ] Choose one destination and record exact pricing/retention before provisioning; this is a real external dependency, not a choice the plan fabricates.
- [ ] Test destination failure, missing encryption key, truncated upload and duplicate scheduled run before implementation. Reuse canonical export and newest ledger rules; enforce a separate least-privilege backup identity outside normal MCP grants.
- [ ] Implement encrypted upload, receipt verification and notification through authorized channels. Rotate keys without losing old-backup readability; rehearse restoring a previous scheduled copy.
- [ ] Measure daily success and prove 24 h recovery points before claiming automated RPO. Commit: `feat: add verified scheduled offsite backups`.

## 4. Release evidence and completion definition

Required files: dependency/licenses inventory; actual-client matrix; auth/isolation test report; D1 mutation race/fault report; retrieval metrics/corpus digest; runtime/quota report; accessibility/browser report; canonical backup/restore and ledger report; versioned release/rollback checklist. Link each to a commit and environment. These are generated implementation evidence, not prefilled pass statuses.

P0 is complete when G1-G5 and required security/integrity cases pass, retrieval/resource targets are met or a concrete user-approved scope/cost change is recorded, all five target surfaces have truthful evidence, and recovery works. The package must still be useful with no LLM API key and no embeddings.

Suggested effort planning range: 15-25 focused engineering days for P0 including client/account integration, security review and recovery drills; an agent can accelerate code writing but cannot guarantee external eligibility or eliminate observed test time. This is an estimate, not a schedule commitment. Review gate results before refining it. Ongoing work is dependency/advisory checks, quota review and actual backups; $0 infrastructure does not mean zero maintenance.

## 5. Plan self-review record

- Spec coverage: FR01-FR18 each map to T01-T12; NF01-NF08 map to G1-G5 and T07/T09/T10/T12. P1 is isolated in T13/T14.
- Interface check: domain signatures defer to one MCP contract; harness functions and test fixtures are defined here with exact paths. Public tool names, enum names and byte caps are shared constants.
- Foundation risks retained as gates: SDK release compatibility, actual client eligibility, OAuth Free CPU, D1 transactional guard, safe bounded exports. No placeholder account IDs, fabricated package versions or assumed benchmark results.
- Planning code snippets specify intended assertions and algorithms; the implementation must write/run them and record evidence. No test has passed merely because its example appears in this document.
