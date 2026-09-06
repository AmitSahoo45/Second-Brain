# Source register

Research date: **6 September 2026**. Collected from the research and final planning documents. Sources support the stated external capabilities and constraints; product choices and acceptance thresholds remain proposed. No application was deployed, client matrix executed or paper experiment reproduced during planning.

Official documentation and repository files can change after this date. In T01, recheck relevant documentation and record its URL/date plus release or commit where available. Select compatible **released** packages, then capture exact versions, tarball integrity and shipped LICENSE/NOTICE. A moving `main` link or documentation example is not proof that a package combination works.

## Client integration and instruction behavior

| ID | Canonical source | Supports / limit |
|---|---|---|
| C01 | [OpenAI developer mode](https://developers.openai.com/api/docs/guides/developer-mode) | Documented remote tool access and account eligibility. Actual account/workspace availability must be tested. |
| C02 | [Connect to ChatGPT](https://developers.openai.com/plugins/deploy/connect-chatgpt) | Connection, authentication and testing workflow. Does not prove this server connects or that a model calls every tool. |
| C03 | [OpenAI authentication](https://developers.openai.com/plugins/build/auth) | OAuth discovery, resource binding, PKCE and redirects. Pin provider behavior and test actual clients. |
| C04 | [OpenAI MCP server guidance](https://developers.openai.com/plugins/build/mcp-server) | Tool definitions and response guidance. Client rendering/confirmation behavior remains compatibility evidence. |
| C05 | [ChatGPT personalization](https://learn.chatgpt.com/docs/personalize) | User instruction location. Instructions are not deterministic lifecycle enforcement. |
| C06 | [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp), [callback rules](https://learn.chatgpt.com/docs/extend/mcp#oauth-client-registration-and-callbacks) | Configuration, CLI/IDE boundaries and callback behavior. Revalidate installed commands and the actual emitted redirect. |
| C07 | [Codex AGENTS instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [Codex hooks](https://learn.chatgpt.com/docs/hooks) | Global/project instruction files and documented hook capabilities. A local hook does not configure ChatGPT web or guarantee successful remote writes. |
| C08 | [Claude remote connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) | Hosted connector setup, account/workspace and network requirements. Limits and UI paths can change. |
| C09 | [Claude connector authentication](https://claude.com/docs/connectors/building/authentication) | Hosted/native callback differences and resource/CIMD requirements. This is not evidence of automatic refresh/reconnection in the proposed service. |
| C10 | [Claude personalization](https://support.claude.com/en/articles/10185728-understanding-claude-s-personalization-features), [Claude Code memory](https://code.claude.com/docs/en/memory) | Profile instructions and CLAUDE.md behavior. These are separate configuration surfaces. |
| C11 | [Claude Code MCP quickstart](https://code.claude.com/docs/en/mcp-quickstart), [MCP reference](https://code.claude.com/docs/en/mcp) | Registration scope, tools and authentication commands. Validate the installed client version. |
| C12 | [Claude Code hooks](https://code.claude.com/docs/en/hooks), [hook guide](https://code.claude.com/docs/en/hooks-guide) | Event-specific hook outputs and limitations. Stop does not cover every interruption; hooks remain P1. |

## Protocol, authentication and reusable code

| ID | Canonical source | Supports / limit |
|---|---|---|
| P01 | [Official SDK README](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/README.md), [protocol migration guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md) | The inspected source describes v2 packages and supported handler/protocol paths. SDK major and wire revision differ; T01 must prove released-package compatibility. |
| P02 | [SDK LICENSE](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/LICENSE) | Inspected repository licensing transition. It does not replace checking licenses in exact installed tarballs and copied source. |
| P03 | [Cloudflare stateless handler](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/) | Worker-compatible MCP adapter guidance. Documentation alone does not establish CPU cost or successful interoperability. |
| P04 | [Workers OAuth Provider](https://github.com/cloudflare/workers-oauth-provider) | Maintained provider API, client metadata and refresh recovery semantics. Select a released compatible version; do not promise stricter single-use refresh behavior than it provides. |
| P05 | [MCP client registration](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration), [authorization security](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations) | Normative registration and security requirements for this revision. Real client revisions must be negotiated/tested. |
| P06 | [Cloudflare demo README](https://github.com/cloudflare/ai/blob/main/demos/remote-mcp-github-oauth/README.md), [server](https://github.com/cloudflare/ai/blob/main/demos/remote-mcp-github-oauth/src/index.ts), [callback](https://github.com/cloudflare/ai/blob/main/demos/remote-mcp-github-oauth/src/github-handler.ts), [license](https://github.com/cloudflare/ai/blob/main/LICENSE) | Reuse assessment: inspected routing/API-generation mismatch, demo-specific allowlist/token retention, MIT repository license. This was source inspection, not a security audit; do not deploy the demo unchanged. |
| P07 | [Basic Memory README](https://github.com/basicmachines-co/basic-memory/blob/main/README.md), [license](https://github.com/basicmachines-co/basic-memory/blob/main/LICENSE) | Alternative workflow, implementation scope and AGPL-3.0 reuse constraint. These do not establish its fit for this hosting budget. |
| P08 | [Basic Memory issue 1208](https://github.com/basicmachines-co/basic-memory/issues/1208), [issue 1378](https://github.com/basicmachines-co/basic-memory/issues/1378) | Reported concurrency/retry failure shapes informing tests. The first was closed and second open when checked; neither was independently reproduced. |

## Hosting, quotas, consistency and recovery

| ID | Canonical source | Supports / limit |
|---|---|---|
| H01 | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [limits](https://developers.cloudflare.com/workers/platform/limits/) | Published free/paid allowance and CPU constraints. No $0 guarantee or achieved latency; account-wide usage and tested workloads matter. |
| H02 | [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [limits](https://developers.cloudflare.com/d1/platform/limits/) | Published storage/read/write bounds. Returned rows are not equivalent to billed/scanned rows; seed/index cost must be measured. |
| H03 | [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/), [KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/) | Provider-storage quotas and eventual consistency. The D1 revocation overlay is a product design response, not a guarantee supplied by KV. |
| H04 | [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/) | Prepared statements and transactional batches. The proposed zero-row CAS guard still requires executable D1 tests. |
| H05 | [D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/) | Virtual-table export restrictions motivating canonical application backups. Custom manifests, barriers and reconciliation are project requirements to implement/test. |
| H06 | [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) | Provider recovery behavior and retention. Time Travel is not an independent owner-held backup or universal deletion mechanism. |
| H07 | [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/), [Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) | Included host option and temporary tunnel limitations. Stable URL selection remains a deployment decision. |
| H08 | [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Vercel MCP deployment](https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel) | Documented fallback hosting surface and plan restrictions. No Vercel deployment or compatibility claim is made by this plan. |
| H09 | [Neon plans](https://neon.com/docs/introduction/plans), [Neon pricing](https://neon.com/pricing) | Fallback database plan/usage constraints. Recheck price, suspension and compute behavior before choosing it. |
| H10 | [Docker Engine installation](https://docs.docker.com/engine/install/) | Alternative self-hosting prerequisite. A container alone does not provide public OAuth reachability, backups or availability. |

## Memory research

The review used abstracts and publication metadata. Consensus search results were individually fetched before citation, then cross-checked against primary publication records. No full benchmark implementation or experiment was reproduced. The proposed 200 synthetic queries, retrieval targets, limits and latency goals are product acceptance choices, not published findings.

| ID | Primary publication | Supports / limit |
|---|---|---|
| R01 | [LongMemEval](https://arxiv.org/abs/2410.10813), Wu et al., ICLR 2025; [DOI](https://doi.org/10.48550/arXiv.2410.10813) | Memory evaluation categories and separation of indexing/retrieval/reading. No inference about this product's accuracy or a current model's behavior. |
| R02 | [Evaluating Very Long-Term Conversational Memory of LLM Agents](https://aclanthology.org/2024.acl-long.747/), Maharana et al., ACL 2024; [DOI](https://doi.org/10.18653/v1/2024.acl-long.747) | Long-conversation/event evaluation motivation. Use the final publication if reporting dataset size; discovery metadata differs. |
| R03 | [Lost in the Middle](https://aclanthology.org/2024.tacl-1.9/), Liu et al., TACL 2024; [DOI](https://doi.org/10.1162/tacl_a_00638) | Position sensitivity in the studied tasks/models. It motivates compact-context tests, not a universal claim about later models. |

Fetched discovery records are linked in [Research and reuse](decisions/RESEARCH-AND-REUSE.md). The earlier 2023 record for Lost in the Middle is distinguished from its 2024 journal publication. Do not compare synthetic product scores with these papers unless dataset/version, preprocessing, model and grading protocols actually match.
