# Research and reuse decisions

Checked 6 September 2026. [BASELINE.md](../BASELINE.md) is normative. This note records supporting evidence and tradeoffs; no benchmark was reproduced and no proposed service was tested.

## What the research supports

Three papers were searched through Consensus, their records fetched, and primary publication metadata checked. They motivate the [test strategy](../testing/TEST-STRATEGY.md), without predicting any current model's performance.

| Paper | Relevant evidence | Design consequence |
|---|---|---|
| [LongMemEval](https://arxiv.org/abs/2410.10813), Wu et al., ICLR 2025 | Separates indexing, retrieval and reading; evaluates extraction, multi-session reasoning, temporal reasoning, knowledge updates and abstention. | Store provenance and revisions; separately test current facts, history, missing evidence and complete multi-note support. |
| [Evaluating Very Long-Term Conversational Memory of LLM Agents](https://aclanthology.org/2024.acl-long.747/), Maharana et al., ACL 2024 | LoCoMo studies long conversations, event summaries and temporal/causal understanding; retrieval alone does not establish reliable reasoning. | Include multi-session handoffs, changed plans and unsupported-causality cases. |
| [Lost in the Middle](https://aclanthology.org/2024.tacl-1.9/), Liu et al., TACL 2024 | The evaluated models/tasks showed sensitivity to relevant information's position in long contexts. | Prefer bounded evidence packs with explicit expansion; measure client evidence use among distractors. |

Fetched discovery records: [LongMemEval on Consensus](https://consensus.app/papers/longmemeval-benchmarking-chat-assistants-on-longterm-wu-wang/f21077163ddb59b4bdb781c6fc23082c/?utm_source=chatgpt), [LoCoMo on Consensus](https://consensus.app/papers/evaluating-very-longterm-conversational-memory-of-llm-maharana-lee/bd906fd3704f50f1a0f7dce8b3ebef67/?utm_source=chatgpt), [Lost in the Middle on Consensus](https://consensus.app/papers/lost-in-the-middle-how-language-models-use-long-contexts-liu-lin/e1b180f71d3555a5b4b10bfddc86ae63/?utm_source=chatgpt).

Use final publications for metadata: the discovery record's LoCoMo dataset description differs from the published ACL abstract, and Lost in the Middle's earlier record uses 2023 rather than the TACL publication year 2024. Any later public benchmark run must pin dataset/version, preprocessing, question subset and grading. The project's synthetic tests are not LongMemEval or LoCoMo benchmark scores.

## Reuse assessment

| Component | Decision and evidence |
|---|---|
| Basic Memory | Study its readable Markdown, evidence and memory workflows; do not fork by default. Its [README](https://github.com/basicmachines-co/basic-memory/blob/main/README.md) describes a broader Python application, optional semantic search and synchronization. The [license](https://github.com/basicmachines-co/basic-memory/blob/main/LICENSE) is AGPL-3.0, so copying/forking requires an explicit license decision. |
| Official MCP TypeScript SDK | Reuse the protocol implementation. Current [README](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/README.md) identifies stable v2 and split server/client packages. The [migration guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md) documents the web-standard handler and legacy stateless support. Pin compatible releases after actual-client testing. |
| Cloudflare OAuth starter | Reuse maintained OAuth primitives and studied patterns, adapting identity and authorization to the baseline. Its [source](https://github.com/cloudflare/ai/blob/main/demos/remote-mcp-github-oauth/src/index.ts) is a demo, not the product's access policy. The repository [license](https://github.com/cloudflare/ai/blob/main/LICENSE) is MIT. |

Concrete diligence findings:

- The SDK repository [LICENSE](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/LICENSE) describes an Apache-2.0 transition with retained MIT contributions; the inspected server manifest still declared MIT. Review the pinned distributed package's LICENSE/NOTICE and retain required notices, rather than labeling the entire repository uniformly.
- Cloudflare's starter [README](https://github.com/cloudflare/ai/blob/main/demos/remote-mcp-github-oauth/README.md) still shows `/sse` while current source serves `/mcp`. Its source imports v1-style SDK paths. Reconcile APIs with the selected v2-compatible handler; do not mix tutorial snippets across generations.
- The starter's allowlist gates only image generation; basic tools admit any authenticated GitHub user. Its [callback](https://github.com/cloudflare/ai/blob/main/demos/remote-mcp-github-oauth/src/github-handler.ts) uses login text and retains an upstream token for a demo tool. Replace these with an immutable numeric owner subject, global authorization checks and no retained upstream token. Remove unrelated demo tools and AI bindings.
- Basic Memory's [concurrency issue 1208](https://github.com/basicmachines-co/basic-memory/issues/1208) is closed; it motivates real concurrent-write testing, not a claim that current Basic Memory is broken. Its [Retry-After issue 1378](https://github.com/basicmachines-co/basic-memory/issues/1378) was open when checked and motivates structured retry behavior. These reports were not independently reproduced.

**T01 output:** select actual released packages only after the runtime/client spike, then record exact installed versions, tarball integrity hashes and the licenses/notices shipped in those tarballs. Record copied snippet paths and their upstream commits, documentation URL/check date, and the tested SDK/provider compatibility combination. Include required notices in the repository/distribution. Moving `main` URLs below are research pointers, not permanent compatibility evidence or promises that a particular package is available. The [source register](../SOURCES.md) separates documentary support from untested product decisions.

## Own the memory rules

The product should implement explicit projects, truth labels, immutable revisions, operation receipts, dispute handling, safe full-text search and bounded context packs. These are the important user-facing guarantees; a generic graph or vector store does not automatically provide them.

Start with parameterized FTS5 plus exact keys/titles/aliases. This avoids a required paid model API and keeps retrieval explainable. It is a cost/simplicity choice, not research proof that keyword search is universally best. Measure paraphrase failures before adding embeddings or reranking.

Keep the existing assistants responsible for drafting memories. Never treat a writer's `source_supported` label as server verification that a source was read. The server records who wrote, when, which revision committed and which explicit evidence was supplied.

Global instructions and supported client hooks can improve memory use. Neither the papers nor MCP guarantee that all web conversations invoke the service. No shared-memory design grants access to chats or projects that were not explicitly connected and authorized.
