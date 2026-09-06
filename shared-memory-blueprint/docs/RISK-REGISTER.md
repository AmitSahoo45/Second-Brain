# Risk register and decision triggers

Proposed design, 6 September 2026. “Owner” below means the party responsible during implementation, not an extra account or process to create.

| ID | Risk / observable trigger | Prevention and response | Responsible task |
|---|---|---|---|
| R01 | One target account cannot attach or write through custom MCP. | Test actual account before full build; record unavailable surface; use supported connection/account path or obtain an explicit scope decision. Never claim instruction text enables a tool. | T01,T11 |
| R02 | Authenticated Worker exceeds Free CPU budget. | Measure before full features and at final maximum payload. Optimize measured cost; present priced host/plan alternative if necessary. No paid upgrade by default. | T01,T02,T10 |
| R03 | SDK/handler/provider released versions do not work together. | Inspect installed exports, pin compatible releases and current notices; retain probe. Do not mix moving-main demo code and incompatible imports. | T01 |
| R04 | Concurrent agents overwrite or duplicate memory. | CAS expected_revision, immutable revisions, actor-scoped operation hash and database-enforced receipt uniqueness; race/fault tests. | T04 |
| R05 | Revoked grant still admitted through eventual KV reads. | Primary D1 auth overlay each operation, fail closed, no auth cache; test post-commit admission boundary. | T02 |
| R06 | Prompt injection stored as a note becomes an instruction. | Tool descriptions and global instructions treat notes as data; no arbitrary fetch/execute; plain text UI and provenance; adversarial fixtures. This reduces exposure, not a guarantee of model behavior. | T06,T07,T11 |
| R07 | Global instructions fail to load/save a particular chat. | Measure adherence separately; expose last received calls/receipts; user can explicitly invoke tools; optional verified local hooks later. Server cannot count unseen chats. | T11,T13 |
| R08 | Export is inconsistent or cannot run with FTS. | Application canonical pages under bounded atomic write barrier; checksums; keep FTS live; fail overflow/expiry, no truncated success. | T09 |
| R09 | Restore resurrects later-deleted content or old grants. | Independent newest deletion ledger; isolated import; auth excluded; preserve/reconcile revoke state for Time Travel; explicit promotion. | T08,T09,T12 |
| R10 | Accepted note cannot fit a client's serialized read result. | Admission proves all supported encodings fit 24 KiB; worst-case escaping and upgrade tests; bounded labels/evidence. | T03,T06 |
| R11 | Logs/CI/previews reveal private notes or credentials. | Typed metadata allowlist, synthetic fixtures, redaction tests, no-store, separate environments and minimal deploy permissions. | T02,T06,T12 |
| R12 | Lexical search misses paraphrases or old/current distinction. | Evaluate aliases and temporal cases separately; preserve uncertainty; direct IDs/history; add semantic retrieval only if measured need justifies cost. | T05,T10 |
| R13 | Owner loses only backup or encryption passphrase. | Verify/decrypt/restore rehearsal, independent encrypted copy, honest last verification age; owner manages key custody. Automatic backup remains P1. | T09,T14 |
| R14 | Abuse consumes free quotas before legitimate work. | Bounded requests/registration/rates, platform rules, primary admission, approximate usage thresholds; fail visibly, never bypass auth. | T02,T10,T12 |
| R15 | Plan treated as verified software. | All evidence starts unpassed; write exact observed tests/environment/version; no deployment/availability claim until actually demonstrated. | All |

## Decisions that legitimately need new facts

Actual immutable GitHub owner identity; accessible target-client account features; stable endpoint and hosting account; existing/new repository location; deployment authorization; any paid upgrade; an authorized destination for future automated backup. Everything else has a proposed baseline to avoid blocking routine implementation.

## Incident response order

1. Identify whether the incident is confidentiality, integrity or availability using metadata and known receipts.
2. Contain the affected grant/environment. For uncertain authorization, close admission; preserve content-free evidence and newest deletion/revocation state.
3. Diagnose against the pinned version and last compatible schema. Do not overwrite live data just to reproduce a bug.
4. Restore or roll back in isolation, reconcile deletion/auth state and verify canonical/history/search correctness.
5. Reopen deliberately, rerun affected client/security checks, document cause and one focused prevention change.

No specific incident is alleged here. These procedures are part of the requested development and operations plan.
