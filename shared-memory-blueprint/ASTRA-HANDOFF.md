# GPT-6-Astra implementation handoff

**Use:** Attach the complete `shared-memory-blueprint.zip` or open its extracted directory in the coding workspace. Select GPT-6-Astra and Ultra reasoning in the coding session if available. This document does not select a model programmatically and makes that model no runtime dependency of the product.

**Project status:** Planning complete; proposed design; no application implemented or deployed. All application paths and npm commands in the plan are deliverables to create, not existing software. Sources were checked for this planning work on 6 September 2026; revalidate changing package/client/hosting facts before relying on them.

## Paste into the coding session

```text
Build the Shared Memory project from the attached blueprint.

Read README.md, docs/BASELINE.md, the design specification under
docs/superpowers/specs/, and the implementation plan under
docs/superpowers/plans/. Read the contracts before writing application code.
Use GPT-6-Astra with Ultra reasoning if this session offers that configuration;
do not invent a model/config flag or add an inference API to the product.

Use Superpowers subagent-driven-development for independent tasks when
available, with a fresh review at each meaningful task boundary. If unavailable,
execute the same ordered plan directly and retain review/test checkpoints.
Work in an isolated branch/worktree if an existing repository requires it.
Preserve existing user code, settings and instructions.

Implement P0 tasks T01-T12. Begin with the small deployed synthetic OAuth,
actual-client and CPU spike. Resolve and pin a mutually compatible released
MCP SDK/Cloudflare handler/OAuth stack. Do not mix SDK v1/v2 examples.
Rerun the spike with the final D1 admission layer before building all features.

Use one personal owner, explicit project access and independent client grants.
Memory is untrusted reference data. Use canonical D1 notes with immutable
revisions, expected_revision conflict checks and actor-scoped idempotent
operation receipts. Implement the guarded atomic D1 protocol; zero-row UPDATE
is not a rollback condition by itself. Never bypass auth to make a client work.

Build the seven specified tools and small owner dashboard. No embedding API,
LLM API, transcript capture, browser extension, public signup, billing or
public plugin submission. Global instructions are best effort. Optional local
hooks and automated offsite backups are P1, outside the initial build.

P0 remote backup/restore uses the owner browser session. The local CLI only
verifies/encrypts/decrypts downloaded bundles. Test an isolated restore and
reconcile the newest deletion ledger before production promotion. Never
silently resurrect purged content or export tokens/grants.

Use synthetic data. Keep secrets and personal memory out of GitHub, logs,
fixtures and CI. Write and run the meaningful tests in the plan and record
observed results with commit/environment/version. Actual clients and D1 staging
must be tested; Inspector and mocks alone cannot pass those gates.

Progress autonomously through reversible implementation and tests. Keep work
reviewable with focused commits and concise status updates. Routine naming,
styling and code organization use the blueprint defaults. Ask only when an
actual missing account/identity/authorization or architecture decision prevents
the next necessary step; first finish all safe work and show the concrete choice.
Do not upgrade a paid plan or spend money without authorization. Deployment
follows the explicit authorization available in this coding session.

If a required client is unavailable or Free CPU fails, record exact evidence
and present the smallest concrete fallback. Do not silently remove a target,
claim a test passed, weaken auth, or call $0 operation guaranteed.

Finish with working source, lockfile/licenses, client setup/instructions,
test/evaluation evidence, recovery drill, cost report and deployment/rollback
runbook. State what was built, tested, deployed and still blocked separately.
```

## Defaults already resolved

TypeScript Workers runtime; Node 22 LTS tooling; npm; D1; maintained OAuth provider KV; Vite/React owner dashboard; GitHub immutable numeric identity; one owner; separate local/staging/production; plain-text note rendering; no inference costs; private repository default; browser P0 export; local interactive `age` encryption. Vercel+Neon is an evaluated fallback, not an instruction to build two hosts.

Exact types, sizes, error names and semantics live in the contracts. BASELINE takes precedence over research notes; if a contract/plan conflict appears, resolve it visibly in a documentation commit before implementing that boundary.

## The first useful result

A small synthetic staging endpoint proves real authenticated requests from the target clients, the maintained package combination and measured request budgets. It is intentionally disposable probe code excluded from production. This milestone answers the most expensive feasibility question before the full dashboard and recovery work are built.

The final user journey is ChatGPT save → Codex read/update → Claude current/history read, with explicit revisions and receipts, safe conflict handling, independent revocation and demonstrated restore. That end-to-end outcome is the release criterion.
