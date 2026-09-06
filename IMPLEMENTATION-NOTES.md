# Implementation decisions

These notes apply the supplied blueprint to the actual workspace. The original package remains byte-preserved for traceability. Explicit user changes below supersede its client list; all other security, integrity and release gates remain binding.

## Required clients — user correction, 6 September 2026

The latest user correction requires **ChatGPT web, the Codex VS Code extension and Claude web** sharing one common brain. Grok is removed from required clients. These three surfaces replace the blueprint's five-surface acceptance matrix and the earlier four-client correction. Codex CLI and Claude Code are optional diagnostics, not substitute evidence for a required surface.

Every required client uses the same canonical HTTPS `/mcp` resource, with independent authorization grants to explicit projects. Required clients must prove actual login, tool discovery, read, write, update, reconnect/refresh and revocation. The service does not automatically capture chats or synchronize vendor-native memory.

V1 stays **text-only**: text memory through MCP, without image/audio/video ingestion or rich tool widgets. The immediate user-requested milestone is to finish the current browser consent regression fix, then demonstrate a shared write/read between two actual target clients. Use ChatGPT web and Claude web for this initial proof. Report compatibility blockers explicitly before expanding implementation; SDK diagnostics do not satisfy this milestone. The remaining Codex and security/CPU gates are not implicitly waived.

The user confirmed custom-connector forms are available in Claude web and Grok, but this is only feature-availability evidence. Grok needs no v1 registration or acceptance run. Record the actual registration method and exact hosted redirect URI for required clients; do not infer a wildcard allowlist from examples.

## T01/T02 sequencing

The first staging OAuth experiment must already restrict human login to the configured immutable GitHub owner, validate upstream state, protect consent against CSRF, require PKCE, validate redirect/resource identity, and isolate synthetic probe data. Bring the minimum owner-login and consent controls into T01 instead of exposing an insecure probe while waiting for T02.

T02 needs actor types and owner/project/grant schema before T03's full memory model. Define the shared authentication context once, and introduce owners, projects, grants and grant-project membership in the authentication migration. T03 extends these definitions instead of recreating incompatible tables or actor shapes. The final primary-D1 admission overlay is still rerun through T01's live client/CPU matrix before full memory features.

T01 probe tools are disposable, synthetic and isolated from production entry points. They are not the seven production memory tools. A safe closed production entry may exist before the production implementation; it must not expose probes or claim a healthy memory service.

## Released-package compatibility

Use the exact published dependency set and inspected APIs recorded in the local [runtime compatibility research](evidence/research/runtime-compatibility.md). SDK v2 is split into `@modelcontextprotocol/server` and `@modelcontextprotocol/client`; do not invent `@modelcontextprotocol/sdk@2`. Agents currently also requires a legacy SDK peer, which is not permission to mix v1 and v2 application imports. The upstream released tooling's pinned prerelease Miniflare dependency is retained, disclosed and tested, not silently replaced; direct packages must be released versions.

Use the current Cloudflare Vitest plugin with its supported Vitest version, preserving real workerd and local D1 tests. The older test-pool package name is not a security requirement. Set the Workers compatibility date to a date actually supported by the pinned runtime and record the result; the blueprint explicitly requires this revalidation. Preserve actual shipped license text and disclose missing or inconsistent package license metadata.

The OAuth provider's grant identifier is opaque, not necessarily a UUID. Preserve it separately from the application's server-created grant UUID. The application UUID is the OAuth actor ID; never parse an opaque provider ID as a UUID or trust a client-supplied actor. This follows the data model's separate provider-grant column.

## Observed text-result compatibility

The actual ChatGPT web client read `structuredContent` successfully, but the connected Claude web client exposed only the generic `content` status string and no value/revision. This establishes the contract's text-compatibility branch: return the same result as structured data and serialized JSON text. Count both representations, second-level escaping and the JSON-RPC envelope against the 24 KiB response limit before accepting writes. Reserve bounded request-ID and revision overhead; never silently truncate a saved value. This is an existing-probe compatibility repair, not approval to expand full memory features. Repeat the actual Claude read against the unchanged ChatGPT-written value after deployment.

## Preflight contract rulings

The independent local [preflight review](evidence/reviews/security-preflight.md) records the detailed task/interface checks and findings. Generated `docs/` and `evidence/` are ignored by the current working-tree settings; preserve those exclusions. These binding decisions live at the repository root so they remain available with the source. Test evidence can be regenerated and is not a claim embedded in a release.

- **Surviving relationships after purge:** preserve nonpurged notes' canonical current and immutable historic snapshots, including historical related IDs. Delete all live relation edges to the purged target. Reads may retain those non-content IDs; resolving them cannot reveal purged content. New writes must remove or replace references to absent targets. Import accepts an absent snapshot target only with a matching same-owner/project tombstone, and never recreates a live edge to it. A missing target without that tombstone, or a foreign-scope tombstone, is invalid. Test source exports both before and after purge against the newest ledger. This favors immutable, recoverable history; the cost is an explicit reference correction when editing an affected note.
- **Project-list injection:** pass a typed project-list service/function through the MCP dependency bundle alongside memory methods. Do not add hidden unscoped SQL to the `list_projects` adapter.
- **Response encoding:** define pure shared encoding/budget helpers before T03 admission. T06 transport consumes the same helpers so a note accepted at write time fits every supported final read encoding. The concrete encoding must be validated by the client spike.
- **Purge receipt:** use the full MCP contract, including `purged_revision`; shortened plan prose does not remove a field.
- **Race-test volume:** run the plan's 100 local race/retry pairs. Before staging, calculate its quota cost and use a documented representative remote matrix at least as strong as the test strategy requires; record exact counts rather than implying local runs occurred remotely.
- **Incremental harness/checks:** introduce only the interfaces and checks that exist at each task. Unimplemented operations must fail visibly, never return successful mocks or prefilled test evidence. Expand the integration check as later gates become executable; a T01 local pass is not P0 acceptance.

## Evidence and release boundaries

Local tests, mocked external identity responses, protocol clients and dry-run bundles do not establish actual vendor-client compatibility, deployed D1 behavior or Cloudflare CPU headroom. Keep each of these statuses separate. T01 remains incomplete while its live gate is unverified; do not start full memory features by treating missing access as a passing result.

No account identifiers, OAuth credentials or endpoints are fabricated for deployment. Configuration examples use unmistakable placeholders. Cloud provisioning, deployment and spending require the authorization available in this session. Routine local work, dependencies, testing, task commits and independent review proceed autonomously.
