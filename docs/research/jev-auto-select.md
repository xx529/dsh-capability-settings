# 能力面板接入 Jev 做「能力自动选择」· 决策前取证（scout 只读）

- 任务：`task-1`（scout，只读取证，不做决策、不改生产代码、不写画布）
- 仓库：`/Users/lzx/Documents/GitHub/dsh-capability-settings`（下文所有相对路径以它为基准，例如 `src/remote.ts:117`）
- 日期：2026-10-23（本机时区 Asia/Shanghai）
- 取证方式：
  - 外部：TypeSafe 官方文档 11 个 URL / 4 次抓取（明细见 §5；**按 URL 计超出「≤8」预算 3 个，原因见 §5 说明**）
  - 仓库：只读 `src/**`、`docs/**`、`notes/**`、`package.json`、`.profile-backup/**`（只读）
  - 已安装外壳：`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar` 用仓库自带只读脚本 `notes/recon/asar-read.py` 抽取后阅读（外壳版本 **0.2.1-rc.2**，见 §2.4）
- 证据等级：
  - `[D]` = 外部官方文档（URL 可回查）
  - `[R]` = 本仓库源码（`文件:行号`）
  - `[A]` = 已安装宿主 asar 内源码（`asar 路径:行号`，抽取方式见 §5.4）
  - `[P]` = 本机 profile/本地环境只读观测
  - `[I]` / `[As]` = Inference / Assumption（明确区分，不当 Fact 用）
- 写作纪律：**Fact 只写能回查的**；推断/假设单列；找不到就写「未找到」。

---

## 0. 一句话结论（TL;DR）

1. **Jev 适合「一次请求给 N 个能力打 0-1 相关度」**：HTTP 契约稳定（`POST /v1/systemone`，`{model,state,questions}`），官方明确「问题数量本身无上限，只要装得下上下文」，并提供 13 问一次调用比 13 次单问 **12.2x 便宜 / 10.0x 快、答案不变** 的实测 cookbook。`[D]`
2. **0-1 相关性打分推荐用「一能力一条 Noul」**，单请求批量：`noul` 值本身就是 P(yes)，无独立 confidence；官方明确「条件清单 = 多条 Noul 放同一请求」「rerank = 每候选一条 Noul 按值排序」，且有 182 技能选 1 的 `skill_suggestion` cookbook 做「两段式 rank + re-check」先例。`[D]`
3. **请求体积的主要风险是中文描述**：官方说 English 是主训练语言、CJK 有但准确率较低；默认 per-request 64k / per-question 32k tokens。本机实测 157 个 skill 的 description **平均 675.9 字符**（中位 680，最大 1862），100 条全量英文描述 ≈ 1.9 万 tokens（可装下），若换成中文描述按 1–1.5 token/字估算可能逼近/超过默认上下文 → **必须截断 + 读回 `usage.input_tokens` 实测**。`[D]`+`[P]`+`[As]`
4. **成本极低**：$0.042 / 1M input tokens、output 免费；100 能力 + 一次 ranking 的量级是 **≈ $0.0003–0.001 / 次**（取决于描述截断长度），远低于人工点击成本，但仍应做「同一草稿缓存」。`[D]`+`[As]`
5. **插件侧新增 `jev.*` RPC 的改动面是可控的**：`src/remote.ts` 服务接口 + `handleEndpoint` 加 4 个 case、`src/index.ts` 装配、`src/client/api.ts` + `api-adapter.ts` 加客户端方法；**不需要动** `channel.ts`、`mountRpcChannel`、HTTP 层。`[R]`
6. **密钥必须留在宿主侧，且这是新边界而不是现状惯性**：现有 MCP 视图把 `entry`（含 headers/env 明文）原样下发浏览器（`src/client/api.ts:199`），所以「Jev key 也可以照抄 MCP」是错的；`jev.getConfig` 只能回 masked，`jev.test/rank` 必须在宿主进程内发 HTTP。`[R]`+`[I]`
7. **草稿读取有可靠路径，但仓库现有 hero 没接**：外壳 0.2.1-rc.2 的输入框是 **Lexical contenteditable**（`div[data-composer-input]`），不是 textarea；`conversation.input.dock` 的 standardProps 直接给 `useInput`（`InputState.draft`）/`inputActions`，ownerProps 还给 `{session,input}`。当前 `ComposerCapabilityHero` 只接了 `api + onManage`，要读草稿需扩 props（详见 §2.4）。`[A]`+`[R]`
8. **面板加「第三个域 Tab」成本不高但会撞现行 UX 规格**：`DomainTab`/`DOMAIN_ORDER`/单一搜索框/计数回填共 ~4 个位置要改，但 `docs/ux/panel-upgrade.md` v1.7 明确「域 Tab 只剩技能 / MCP」，且本地回归脚本 `notes/verify/render-smoke.mjs:52-59` 断言「只有两个域 Tab」。`[R]`
9. **Figma 本地桥可用、v8 是当前基线**（页 `42:3373`，4 帧 `42:3376/3433/3490/3547`，1440×900）；但本 teammate 会话**没有画布工具**（只有 `figma_status/setup/read_guide/select_document/reconnect`），node id 取自仓库已提交的 `docs/figma/README.md:30-33`，本轮**无法**用 `get_metadata` 复核。`[A]`+`[R]`+`[P]`
10. **最大风险不是 API 而是「自动应用」**：评分（读）容易，落地（写）要逐条调 `skills.setSessionEnabled` / `mcp.setSessionEnabled`，其中 skills 只能「关闭/恢复」、MCP 有硬关闭与不可 restrict 的条目；且用户可能不期望「悄悄改会话开关」。建议做成「先建议、再一键应用」，并把应用范围限定为「可切换集合」。`[R]`+`[I]`

---

## 1. A 部分：Jev / TypeSafe API

> 外部文档原始 Markdown 的本地缓存（抓取当次）在 `/tmp/jev/*.md`（临时目录，**不作为交付物**；引用一律给 URL + 章节）。下表 `[D]` 的 URL 汇总见 §5.1。

### A1. HTTP 契约

**结论**：`POST https://api.typesafe.ai/v1/systemone`，`Authorization: Bearer <API_KEY>`；body 必填 `model` / `state` / `questions`；`questions` 是「自命名 id → question 对象」的对象，可混用 noul/choice/score/box；响应 `{model, answers{id:{...}}, usage}`。

- **Fact**（`[D]`）：
  - OpenAPI 摘要：`servers: - url: https://api.typesafe.ai`，路径 `post /v1/systemone`，operationId `systemone_v1_systemone_post`；`security: - HTTPBearer: []`；描述「Send your API key in the Authorization header as `Bearer <API_KEY>`」——https://docs.typesafe.ai/api/system-one.md（OpenAPI 区块）。
  - 请求体 schema `SystemOneRequest`：`required: [model, state, questions]`；`state` 接受 `string | object | array`；`questions` 为 object（`minProperties: 1`），值 `oneOf NoulQuestion/ChoiceQuestion/ScoreQuestion/BoxQuestion`（discriminator=`type`）；可选 `assets`。同上 URL。
  - 响应 schema `SystemOneResponse`：`{model, answers, usage}`，`answers` 按 question name 回填；`usage` 为 `{input_tokens, output_tokens}`。同上 URL。
  - 答案形状：Noul `{type:"noul", noul:<0-1>}`；Choice `{type, choice, confidence, probabilities}`；Score `{type, score, confidence, legend, probabilities}`（score 为「按 level 概率加权的位置」，可以是小数）。同上 URL + https://docs.typesafe.ai/primitives/score.md「Response structure」。
  - 两个危险区 header：`TypeSafe-Danger-Zone-Images: true`（图片/box）与 `TypeSafe-Danger-Zone-Long-Context: true`（长上下文），取值枚举 `'true'`。https://docs.typesafe.ai/api/system-one.md（parameters 区块）。
  - `state` 三种形态与用途（string / object / array）有独立说明页：https://docs.typesafe.ai/concepts/state.md。
  - `instructions` 支持结构化对象/数组，`criteria` 亦然：OpenAPI 中 Noul/Choice/Score 的 `instructions` 都是 `anyOf [string, object, array, null]`；Score `criteria` 是 `array(minItems 1, maxItems 10)`、元素可为 string/object/array；Choice `criteria` 是 object（`maxProperties: 255`），值可为 string/object/array/null。https://docs.typesafe.ai/api/system-one.md；文本说明见 https://docs.typesafe.ai/primitives/score.md「Structured level descriptions」与 https://docs.typesafe.ai/primitives/noul.md:60（「instructions can be a string, an object, or an array」）。
- **Inference**：`state` 用 object 最稳（官方建议「Use an object for most requests so each part has a descriptive name」，state.md）；本场景建议 `state = { request: <草稿文本>, capabilities: [{id, name, description, whenToUse?, source, kind, ...}] }`，`questions` 里每能力一条 Noul。
- **Assumption**：`questions` 的 key 不发给模型（官方：「You choose the question ids … The ids are not sent to the model」，https://docs.typesafe.ai/primitives/noul.md:25、score.md 同段），所以 key 用稳定 id（如 `cap_<hash>`）不会泄漏、也不影响语义。
- **置信度**：高（OpenAPI 原文 + 独立说明页互相印证）。
- **未决**：是否需要 box/images（不需要）；是否需要 assets（不需要）。
- **建议归属**：architect（契约落成 TS 类型）、backend（宿主 HTTP 封装）。

**附加问题：`instructions` 里能否用反引号引用 `state` 路径？**

- **Fact**：
  - 在本轮抓取的 8 个文档页（`api/system-one`、`api/errors`、`models`、`parallel_questions`、`concepts/state`、`primitives/noul`、`primitives/score`、`sdk/javascript`）中**未找到**「反引号引用嵌套 state 路径」的明确 API 说明；只有 `models.md` 的 cURL 示例里用反引号写 `` `state` ``，那是指字段名本身，不是嵌套路径。`[D]`
  - 本地已安装的 TypeSafe agent skill 文本写了这种做法：「Reference nested state with backticked paths such as `` `ticket.messages[0].text` ``」——`/Users/lzx/.agents/skills/typesafe-ai/SKILL.md:109-110`。该文件是**给 agent 的操作指引**，不是 API 参考，且未给出「服务端如何解析」的契约。`[P]`
  - OpenAPI 对 `state` 只约束形态（string/object/array）与嵌套深度 ≤64，没有定义「引用语法」。`[D]`
- **Inference**：反引号路径大概率是「模型可理解的提示约定」（模型看得到 state 的 JSON 命名空间，用路径帮助定位），而不是服务端解析指令；安全做法是**不依赖**它——要么把被引用的内容直接放进该题 `instructions`（结构化对象），要么在 `instructions` 里写足描述。若要用，先发 1–2 个探针请求验证效果。
- **Assumption**：文档没写≠不支持；skill 文本来自官方仓库（`agent-skill.md` 对应包），具备一定权威性。
- **置信度**：低–中（skill 指引 vs API 文档缺失）。
- **未决**：是否需要架构上统一「每题自带结构化 capability 定义」而非路径引用（推荐后者，减少隐式耦合）。
- **建议归属**：architect（提示约定）；tester（探针请求验证）。

### A2. 环境变量与 base_url 优先级

**结论**：JS SDK 支持 `TYPESAFE_API_KEY` / `TYPESAFE_BASE_URL` / `TYPESAFE_DEFAULT_MODEL`（另有 `TYPESAFE_LOG_LEVEL`）；优先级 **显式构造参数 > 环境变量 > SDK 默认**；`baseURL` 默认 `https://api.typesafe.ai`，`defaultModel` 默认 `jev-latest`。

- **Fact**（`[D]`）：
  - `ENV` 变量逐个给出字面量：`apiKey: "TYPESAFE_API_KEY"`、`baseURL: "TYPESAFE_BASE_URL"`、`defaultModel: "TYPESAFE_DEFAULT_MODEL"`、`logLevel: "TYPESAFE_LOG_LEVEL"`。https://docs.typesafe.ai/sdk/javascript/api/variables/ENV.md
  - `TypeSafeClientConfig`：「Explicit values take precedence over environment variables, then SDK defaults.」；`apiKey` 回退 `TYPESAFE_API_KEY`；`baseURL` 回退 `TYPESAFE_BASE_URL` → `https://api.typesafe.ai`；`defaultModel` 回退 `TYPESAFE_DEFAULT_MODEL` → `jev-latest`；`timeout` 默认 **10000 ms/次尝试**（无总重试预算）。https://docs.typesafe.ai/sdk/javascript/api/interfaces/TypeSafeClientConfig.md
  - 裸 HTTP（不装 SDK）时 base URL 就是 `https://api.typesafe.ai`，endpoint `/v1/systemone`（A1）。
  - 环境变量命名用法在 cookbook 里直接出现：`TYPESAFE_API_KEY`（https://docs.typesafe.ai/cookbooks/parallel_questions.md「Setup」）、`TYPESAFE_MODEL` 只是 cookbook 自己的常量（同页 `TYPESAFE_MODEL = "jev-1.12"`），**不是 SDK 环境变量**——不要混淆。
- **Inference**：插件若用「裸 fetch」实现（不引第三方 SDK，符合本仓库客户端/宿主依赖极简风格），环境变量优先级应自己实现：显式配置 > `TYPESAFE_API_KEY`/`TYPESAFE_BASE_URL`/`TYPESAFE_DEFAULT_MODEL` > 内置默认（与 SDK 对齐，减少用户迁移成本）。
- **Assumption**：用户可能已通过 shell 环境注入 key（dict 到桌面 App 的启动环境）；插件需显示 key 来源（`env` / `file` / `none`）避免「配了但不生效」的困惑。
- **置信度**：高（SDK API 页逐字段）。
- **未决**：key 是否允许在 UI 里录入（写文件）还是只读 env —— 安全与易用性取舍，需 lead/pm 裁决。
- **建议归属**：architect。

### A3. 批量提问（一次请求放多个问题）

**结论**：官方**明确推荐**把独立问题放进同一请求；实测 13 问一次调用比 13 次单问 **12.2x 便宜、10.0x 快，答案不变**；问题数量无独立上限，只受上下文约束。

- **Fact**（`[D]`）：
  - cookbook「Parallel questions」：同一篇 ~54,000 字符 GDPR 文档 + 13 个问题（8 Noul + 2 Choice + 3 Score）；结论表：`one call, all 13` 成本 `$0.000497` / 0.27s；`13 calls, one each` 成本 `$0.006090` / 2.71s；「batching: 12.2x cheaper, 10.0x faster」。且逐题 mean/std dev 对比显示「batching neither shifts the answer nor adds variance」（多数题 std dev 0.0000）。https://docs.typesafe.ai/cookbooks/parallel_questions.md
  - 模型页：「There is no separate limit on the number of questions in a request. Any number of questions is allowed as long as the request fits both limits.」https://docs.typesafe.ai/models.md「Context length」
  - Noul 页：「For a checklist of conditions, ask many Noul questions in one request: one question per condition, and the code decides what the combination means. Questions are evaluated in parallel, so adding Nouls barely changes the response time.」https://docs.typesafe.ai/primitives/noul.md:143
  - Score 页：「Send the Score questions in one request. They are evaluated in parallel. Adding questions barely changes the response time…」https://docs.typesafe.ai/primitives/score.md
  - Index 级证据（只读了 llms.txt 一行描述，未读正文）：`patterns/fan-out` = 「Send many questions in a single call, including speculative ones, and let your code decide what's relevant.」；`primitives` 页含「Ask multiple questions together」小节。https://docs.typesafe.ai/llms.txt
- **Inference**：100 个能力 → **1 次请求**，与「一能力一次调用」相比，节省的是 `state`（能力清单 + 草稿）被重复发送的 token 与 N 次 RTT；这与 cookbook 的「document-dominated workload」结构同型。
- **Assumption**：批量不会降低单题准确率（官方实测支持，但样本仅 13 题 1 文档）；若后续发现长请求里处于中段的能力被弱化，可用「分片（如每 50 条一次）+ 归并」降级。
- **置信度**：高（cookbook 有逐题数据）；中（对本场景外推）。
- **未决**：一次请求的上限策略（100 / 150 / 分片大小）需要实测 `usage` 与延迟。
- **建议归属**：architect + tester（压测）。

### A4. 上下文限制、模型别名、语言支持

**结论**：默认 **per-request 64k / per-question 32k tokens**；带 `TypeSafe-Danger-Zone-Long-Context: true` 两者升到 **262k**（同价，但更慢、更不准）；模型 ID `jev-1.14.0` / `jev-1.13.0`，别名 `jev-latest` → `jev-1.13.0`、`jev-preview` → `jev-1.14.0`；**English 是主训练语言，CJK 可用但准确率较低**。

- **Fact**（`[D]`）：
  - 模型表：Jev 1.14 = `jev-1.14.0`，Jev 1.13 = `jev-1.13.0`；价格 `$42 / Btok` = `$0.042 / Mtok`；上下文 `64k per-request / 32k per-question`；输入仅文本。Jev 1.14「available from October 14, 2026」。https://docs.typesafe.ai/models.md
  - per-request = `state` + 全部 questions；per-question = `state` + 任意单个 question；长上下文 header 打开后两者都 262k；「Long context costs the same per token… It is slower and less accurate than staying within the default limits」。同页「Context length」「Long context」。
  - 别名表：`jev-latest` → `jev-1.13.0`（most recent stable，SDK 默认）；`jev-preview` → `jev-1.14.0`；响应的 `model` 字段返回实际版本号，建议记录。同页「Aliases」。
  - 语言：「English is the primary training language and where accuracy is currently best. Other languages, including CJK scripts, are handled but not equally well; test on your own content…」同页「Language support」；state 页同口径：https://docs.typesafe.ai/concepts/state.md
  - 请求硬规则（顺带）：body ≤ 32 MiB、UTF-8 无 BOM、每个 `state`/`instructions`/`criteria` 嵌套 ≤ 64 层、只收有限数字；支持 gzip/zstd（单层，32 MiB 同时约束压缩前后）。https://docs.typesafe.ai/api/errors.md
- **Inference**：
  - 100 条能力全量描述（英文，约 1.9 万 tokens，见 A6）在默认 64k/32k 内绰绰有余；但需注意 **per-question 也包含完整 state**，即 state 必须单独 < 32k（减掉 question 开销）。
  - 若描述为中文：同一字符量按 CJK token 化更贵（`[As]` 1–1.5 token/字），70k 字符可能 70k–105k tokens → 直接触碰/超过 64k，**必须截断**（例如 description 截 160–240 字符 + `whenToUse` 截 120 字符），或读回 usage 后动态降级。
  - 语言风险无法靠「换模型」解决（同权重）；可用「英文元数据优先」（skill 的 name/description 多为英文）+ 中文草稿仍可判（草稿短、以关键词/意图为主）。
- **Assumption**：中文草稿 + 英文能力描述的组合，准确率介于纯英与纯中之间；需用真实草稿做小样本评估。
- **置信度**：高（模型页逐条）；中文实际表现：中（官方定性，无量化）。
- **未决**：是否需要 long-context（默认建议**不要**，先截断）；是否需要固定 `jev-1.13.0`（避免别名漂移导致答案变化，官方建议「If you have tuned confidence thresholds against one version, send that version's ID instead of the alias」）。
- **建议归属**：architect（模型与截断策略）、pm（是否接受中文准确率折损）。

### A5. 0-1 相关性打分：Noul vs Score（推荐 + 理由）

**结论**：**主方案 = 每能力一条 Noul，单请求批量，取 `noul` 值排序 + 阈值**；Score 仅建议作为**第二段复核**（或需要 confidence 门控时）用于 top-k 候选。

- **Fact**（`[D]`）：
  - Noul 答案只有一个数：`noul` = P(yes)，0–1；**没有独立 confidence**，理由：「A Noul's probability distribution has only two outcomes… so the single `noul` value describes it completely. A Choice or Score spreads probability over several options or levels, and `confidence` summarizes that spread.」https://docs.typesafe.ai/primitives/noul.md（「The answer」/「Noul vs confidence」段，页内约 :90、:105）
  - Noul 的值**不是「程度」**：「A Noul value runs from 0 to 1, but it's not a scale of the thing you asked about. It is the probability that the answer is yes.」近 0.5 = 不确定，不是中等强度。同页 :120。
  - 条件清单/多标签的官方用法：Noul 页 :143（见 A3）；rerank cookbook 用法：「one Noul per query-candidate pair, then sorts candidates by the value」——https://docs.typesafe.ai/primitives/noul.md :278（引用 cookbooks/rerank_typesafe）。
  - Score 答案：`score`（0..top 的概率加权位置，可为小数）+ `confidence` + `legend` + `probabilities`；level 从 0 编号；「Use one of our client SDKs…」；level 必须描述具体情境、每级独立评估、最多 10 级；跨不同长度的量表要除以 `len(criteria)-1` 归一化。https://docs.typesafe.ai/primitives/score.md；cookbook 归一化写法：https://docs.typesafe.ai/cookbooks/parallel_questions.md
  - 两段式先例（index 级）：`cookbooks/skill_suggestion` = 「Picks at most one skill for an agent turn out of the 182 in Nous Research's Hermes catalog, using two TypeSafe requests to rank and re-check the top candidates.」https://docs.typesafe.ai/llms.txt
  - Choice 是「从封闭集合里选一个」，不适合「一次选出若干能力」。https://docs.typesafe.ai/primitives/choice.md（index 描述）+ OpenAPI ChoiceQuestion。
- **Inference（推荐理由）**：
  1. **语义对齐**：本需求是「这条草稿是否该启用能力 X」= 二元判断，Noul 直接给 P(yes)，天生可比较、可排序、可阈值。
  2. **成本/上下文最省**：Noul 每题只需 `instructions`（+可选 `criteria: {true, false}`），不需要写 3–10 条 level 描述；100 题比 Score 方案少一大截 question token。
  3. **可解释/可调**：阈值在代码里（官方建议按「错判代价」定 0.5 之上/之下），不依赖模型内部分布。
  4. **需要 confidence 时再加一段**：Score 的 `confidence` 反映「分布集中度」，适合对 top-k 做二次确认或「是否自动应用」门控；与 skill_suggestion 的两段式同型。
- **Assumption**：
  - `noul` 在「能力是否相关」这种 instruction 上校准良好（官方称 Jev 为 calibrated decision model，但未针对该任务给出指标）。
  - 用户期望的是「少量相关能力」而非完整排序（否则 top-k 截断策略更关键）。
- **置信度**：中高（primitive 语义/用法 = 高；对本任务效果 = 中，需小样本验证）。
- **未决（需 pm/architect 裁决）**：
  1. 单段（Noul only）还是两段（Noul 粗排 → Score/Choice 复核 top 5–10）？
  2. 阈值（0.5 / 0.7 / 按能力等级分档）与 top-k 上限（例如最多开启 8 个，避免「全开」）。
  3. 是否允许「关闭」已有能力（危险动作），还是只做「开启建议」。
- **建议归属**：pm（产品语义）、architect（两段式与阈值工程）。

### A6. 错误码 / 重试 / 计费与请求体积估算

**结论**：错误码齐全（400/401/413/415/422/429/529），429/529 用指数退避重试（SDK 默认自动、遵循 `retry-after`）；计费只算 input token、output 免费；100 能力一次 ranking 约 **$0.0003–0.001**。

- **Fact**（`[D]`）：
  - 状态码表：`400`（违反请求规则；`max_tokens_exceeded` = 超过上下文）、`401`（key 缺失/非法）、`413`（body > 32 MiB）、`415`（不支持的 Content-Encoding 或多层压缩）、`422`（body 校验失败，body 里 `detail` 指出字段）、`429`（超速率）、`529`（服务过载）。https://docs.typesafe.ai/api/errors.md
  - 重试：「When you receive a `429` or `529`, retry … with exponential backoff … Our client SDKs handle this automatically」；模型页补充「follow the `retry-after` header when the response includes one」。https://docs.typesafe.ai/api/errors.md、https://docs.typesafe.ai/models.md「Rate limits」
  - 计费：按 input token 计费，output tokens 免费（`Usage.output_tokens` 注释「currently free of charge」）。https://docs.typesafe.ai/api/system-one.md；价格 `$42/Btok = $0.042/Mtok`。https://docs.typesafe.ai/models.md
  - 体积规则：32 MiB、嵌套 ≤64、有限数字、gzip/zstd（32 MiB 同时约束压缩前后）。https://docs.typesafe.ai/api/errors.md
  - 客户端超时：SDK `timeout` 默认 10000 ms / 次尝试。https://docs.typesafe.ai/sdk/javascript/api/interfaces/TypeSafeClientConfig.md
- **Inference（重试建议，非官方承诺）**：
  - 宿主侧建议：`timeout 20–30s`（100 题批量比 13 题慢，但 cookbook 显示 0.27s 量级，富余很大）；`retry` 仅对 429/529/5xx/网络错误，最多 2–3 次，指数退避 + 抖动，尊重 `retry-after`；**400/401/413/415/422 不重试**（重试无意义，应把 `detail` 转成用户可读错误）。
  - 错误透传要脱敏：不要把 `Authorization` 头写进错误信息（`[R]` 现状 `remote.ts:184-186` 直接把 `error.message` 回传浏览器）。
- **请求体积/成本粗估**（`[P]` 实测 + `[As]` 换算，**不是官方数字**）：
  - 本机实测（`~/.agents/skills/*/SKILL.md`，157 个）：name 平均 21.5 字符；description 平均 **675.9 字符**、中位 680、最大 1862。
  - 方案 A（全量 description）：100 能力 ≈ `100×676 = 67,600` 字符 + name/JSON 开销 ≈ 75k 字符；英文按 ~4 字符/token ⇒ **≈ 19k tokens**；加 100 条 Noul instructions（每条 ~20–40 tokens）≈ 2–4k ⇒ **≈ 21–23k tokens**。成本 ≈ `23,000 × $0.042/1e6 ≈ $0.0010/次`。仍 < 默认 per-request 64k；per-question（state 19k + 单题 ~40）也 < 32k。
  - 方案 B（description 截 200 字符、whenToUse 截 120）：≈ `100×(200+120+name+JSON) ≈ 36k` 字符 ⇒ **≈ 9–10k tokens** ⇒ 成本 ≈ `$0.0004/次`。
  - 方案 C（不批量、100 次单问）：state 被重发 100 次 ≈ `19k×100 = 1.9M tokens` ⇒ ≈ **$0.08/次** 且 100 次 RTT —— 与 cookbook 的「12.2x」同向，**不建议**。
  - 中文描述：按 `[As]` 1–1.5 token/字，方案 A 可能 70k–105k tokens ⇒ **超默认 64k**，必须截断或 long-context（262k，但更慢更不准）。
  - 真实 token 数**以响应 `usage.input_tokens` 为准**（字段已存在），建议首次上线打印/记录该值。
- **置信度**：错误码/计费 = 高；成本估算 = 中（换算假设在 §5.3 标注）。
- **未决**：是否缓存同一草稿（hash）结果；是否对「超阈值变更」二次确认；是否记录 usage 供成本面板展示。
- **建议归属**：architect（成本/缓存策略）、tester（错误路径用例）、lead（是否接受 SDK/裸 fetch）。

---

## 2. B 部分：仓库考古

### B1. 配置落盘：Jev 配置放哪、沿用哪些写封装、密钥权限

**结论**：建议新增 **`<agentsHome>/jev.json`**（与 `<agentsHome>/mcp.json` 同族），新增 `src/jev/paths.ts` + `src/jev/config-file.ts` + `src/jev/manager.ts`；读 `readJsonDocument`、写 `withFileLock` + `atomicWriteText`；**仓库现有写封装不支持 chmod/0600**，key 若要 0600 需要扩展原子写。

- **Fact**（`[R]`）：
  - agents home 解析：显式覆盖 → `DSH_AGENTS_HOME` → `~/.agents`。`src/shared/agents-home.ts:21-22`。
  - 全局候选目录 = `[".agents", ".dsh", ".claude"]` 映射到 agentsHome / dshHome / `~/.claude`；写入目标恒首选、读取取第一个存在、其余记 `legacyFiles`。`src/shared/config-location.ts:23,26,44-58`；迁移清理 `removeFiles` `:74-76`。
  - 全局 MCP 配置先例：写入 `<agentsHome>/mcp.json`，读取兼容 `.dsh`/`.claude`。`src/mcp/paths.ts:4-5,21,39-51`。
  - 写封装：`atomicWriteText(filePath, body, tmpPrefix)` = mkdir + 随机临时名 + `writeFile(tmp, body, "utf8")` + `rename`。`src/shared/atomic-write.ts:25-30`。
  - 进程内写串行化：`withFileLock(file, fn)`。`src/shared/file-lock.ts:28-39`。
  - 读脚手架：`readJsonDocument(filePath,label)`：ENOENT→undefined、空→undefined、非法 JSON→带文件名 Error、顶层非对象→Error。`src/shared/json-config.ts:27-46`。
  - 现有域写法：MCP 写 `writeMcpFile`（`src/mcp/config-file.ts:65-67`，`atomicWriteText(..., "mcp")`）；overrides 写 `writeOverrides`（`src/overrides/config-file.ts:78-85`，空数组不落盘）。**`withFileLock` 不在 config-file 里，而在各 manager 的「读-改-写」整段外层**：`src/mcp/manager.ts:105`、`src/overrides/manager.ts:85`、`src/imports/manager.ts:66`、`src/skills/disk.ts:183`。新 Jev 配置应照此把「读+改+写」包进 `withFileLock(loc.writeFile, …)`。
  - **密钥权限现状**：`src/**` 全文 grep `chmod|0o600|0o700|mode:|umask` **无命中**（只有无关的 `versionNegotiation: { mode: ... }`、`mode: "new"|"edit"` 等）；`atomicWriteText` 的 `writeFile` 未传 `mode` ⇒ 按 umask 决定（通常 0644）。`src/shared/atomic-write.ts:28`。
  - **`${VAR}` 插值先例**：MCP http headers / stdio env / args 支持 `${VAR}` 从宿主环境替换，未定义替换为空串。`src/mcp/config-file.ts:85-87,121-148`。
- **Inference（推荐）**：
  - 位置：`<agentsHome>/jev.json`（`resolveAgentsHome()` + `locateConfigFile(globalConfigBaseDirs(...), "jev.json")`），**不要**放项目级（项目配置会随仓库提交，泄漏 key）。
  - 形状建议（草案，非现状）：
    ```jsonc
    {
      "baseURL": "https://api.typesafe.ai",   // 根；endpoint 固定 /v1/systemone
      "model": "jev-1.13.0",                  // 或 jev-latest
      "apiKey": "<optional>",                 // 或只走 env
      "timeoutMs": 30000,
      "longContext": false
    }
    ```
  - 复用：`readJsonDocument` + `withFileLock` + `atomicWriteText`；**不要**直接 `fs.writeFile`（AGENTS.md 明令）。
  - key 优先级建议：`env TYPESAFE_API_KEY` > 文件 `apiKey`（或反过来，需产品裁决）；UI 只显示来源与 masked 尾号。
  - 若要 0600：给 `atomicWriteText` 增加 `mode?: number` 参数（`writeFile(tmp, body, { encoding: "utf8", mode: 0o600 })`），或 rename 后 `chmod(path, 0o600)`；**这是对共享工具的扩展，需 architect 批准**（会影响 mcp/skills/overrides 三域签名）。
  - 备选：沿用 profile 的 cordis patch config 放 Jev 参数（见下条 `[P]`），但**它无法承载「用户在面板里填 key」**，且改 profile 属高风险动作。
- **`[P]` 本机先例（重要）**：用户 profile 备份里已有 Jev 插件配置：
  `.profile-backup/20261016-105723-desktop/cordis.patch.yml:235-242`：
  `id: dsh-jev-compaction` / `name: "@yadsh/dsh-jev-compaction"`，`config.jev = { baseUrl: "https://api.typesafe.ai/v1/systemone", timeoutMs: 5000, maxConcurrency: 4 }`。
  ⇒ 说明本机已有 Jev 集成，且它的 `baseUrl` **包含 `/v1/systemone` 路径**（与 SDK 的「根 URL」语义不同）。新实现必须明确自己的 `baseURL` 语义（建议存根 + 代码拼 endpoint，避免两种约定混用）。同机 `~/.dsh/logs/dsh-jev-compaction/` 目录存在（`[P]`），但该包当前不在 `~/.dsh` 可见目录中（`find` 未命中）。
- **Assumption**：用户愿意把 key 放在 `~/.agents/jev.json`（或已有 env），而不是 profile patch。
- **置信度**：高（仓库写法与先例均可回查）；`[P]` 先例 = 中（备份文件，非当前生效配置）。
- **未决**：文件命名（`jev.json` vs `jev-config.json`）；是否与其他全局能力配置统一进 `mcp.json` 之外的「插件自身配置」；是否要迁移/复用 `dsh-jev-compaction` 的配置。
- **建议归属**：architect（路径/权限/优先级）、security（0600 与日志脱敏）。

### B2. RPC：路由表/信封/校验位置，新增 jev.* 的最小改动面，密钥边界

**结论**：新增 `jev.getConfig/setConfig/test/rank` 只需改 `remote.ts` + `index.ts` + `api.ts` + `api-adapter.ts`（+ 新 `src/jev/*`）；通道名、挂载、HTTP 层**不动**；payload 校验是**各 manager 手写**（本仓库没有 zod），且**密钥不下发浏览器必须新建边界**。

- **Fact**（`[R]`）：
  - 通道名唯一来源：`export const CHANNEL = "/capability-panel"`。`src/channel.ts:17`。
  - 传输信封硬约束：传输层恒 `{ok:true,value}`；业务失败必须包成 `{ok:true,value:{ok:false,errors}}`；直接返回 `{ok:false,...}` 会被宿主连接层 zod 判非法（`invalid_union`）。原因写在 `src/remote.ts:24-46`。
  - 服务接口 `PanelRpcService`：`skills`（`src/remote.ts:50-74`）、`mcp`（`:75-103`）、`overrides`（`:104-107`）。
  - 路由：`handleEndpoint` 从 payload 取 `cwd`/`sessionId`（`src/remote.ts:117-121`），`switch`（`:123-183`），未知 endpoint → 业务失败（`:181-182`），handler 抛错 → 业务失败（`:184-186`）。
  - 挂载：`mountRpcChannel` 用 `ctx.inject(["connection","webServer"])` + `connection.requestRejection` + `webServer.register({kind:"prefix",path:CHANNEL})`；请求体 300 MiB、415/content-type、rpcId 校验等。`src/remote.ts:218-246,248-352`。
  - **zod**：`src/**` grep `zod` 只命中 `src/remote.ts` 的注释（`:28,33`）；`package.json` 依赖里无 zod（`package.json:37-42` 仅 `@modelcontextprotocol/client`、`yaml`、`@deepseek-ai/dsh-home-paths`、`@deepseek-ai/dsh-mcp-client`）。⇒ 本仓库**没有** zod 校验；payload 校验在各 manager 里手写（例：`mcp.setSessionEnabled` 校验 sessionId/target，`src/mcp/manager.ts:482-497`；`skills.setSessionEnabled` 校验 sessionId/name，`src/skills/session.ts:151-159`）。
  - 客户端适配器：`rpc()` 调 `deps.rpc.call(CHANNEL, endpoint, payload, signal)`（`src/client/api-adapter.ts:65-66`）；`unwrap()` 解业务信封（`:99-…`），失败 `throw new Error(result.errors.join("; "))`（`:112`）。
  - 客户端 API 根：`CapabilityPanelApi { skills, mcp, overrides, … }`。`src/client/api.ts:421-443`。
  - 宿主装配：`service: CapabilityPanelService = { skills, mcp, overrides }` → `ctx.provide("capabilityPanel", …)` → `mountRpcChannel`。`src/index.ts:131-155`。
- **Inference（最小改动面）**：
  | 文件 | 改动 |
  |---|---|
  | `src/jev/manager.ts`（新增） | `getConfig()` / `setConfig(input)` / `test()` / `rank(input)`；内部用 B1 的配置读写 + A1/A6 的 HTTP/重试 |
  | `src/remote.ts` | `PanelRpcService` 加 `jev` 组（`:49-108`）；`handleEndpoint` 加 4 个 `case "jev.*"`（`:123-183`） |
  | `src/index.ts` | 创建 manager、并入 `service`（`:131-155`），按需 re-export 类型（`:178-205`） |
  | `src/client/api.ts` | 新增 `JevConfigView` / `JevRankItem` / `JevApi`，挂到 `CapabilityPanelApi.jev`（`:421-443`） |
  | `src/client/api-adapter.ts` | 实现 4 个方法（仿 `mcp.test` / `skills.*` 的 `unwrap(await rpc(...))` 写法，`:65-112`） |
  | UI | 见 B5（面板 Tab）或 composer 入口 |
  | `src/channel.ts` / `mountRpcChannel` / HTTP 层 | **不改** |
- **密钥边界（关键）**：
  - **现状不是「密钥不下发」**：`ClientMcpServer.entry` 把整条 MCP 配置（含 http `headers`，可能有 `Authorization: Bearer …`）原样送到浏览器（`src/client/api.ts:191-223`；宿主视图 `entry` 见 `src/mcp/manager.ts:169-182`；headers/env 的构造见 `src/mcp/config-file.ts:121-148`）。⇒ 若把 Jev key 塞进 MCP 条目或通用配置视图，就会明文下发。
  - 可行边界：`jev.getConfig` 只返回 `{ baseURL, model, timeoutMs, hasApiKey, apiKeyLast4, apiKeySource: "env"|"file"|"none" }`；**没有** `getApiKey` 端点；`jev.setConfig` 只写、不回读；`jev.test`/`jev.rank` 在宿主发 HTTP；错误信息过滤 key；客户端 bundle 里**禁止**出现 `TYPESAFE_API_KEY` 读取或 API key 字面量（客户端无法读宿主 env）。
  - 附加约束：`src/remote.ts:184-186` 会把 `error.message` 原样回浏览器——若错误对象里带请求头/URL（含 query key）就泄漏，需在 jev manager 内包装/脱敏。
- **Assumption**：面板（root 作用域）与 composer（session 作用域）都要能触发 ranking；`composerApiFor(sessionId)` 的每会话 api 缓存与 deps 注入见 `src/client.ts:149-172`，槽位传参见 `:232-261`。
- **置信度**：高（代码路径可逐行回查）。
- **未决**：`jev.rank` 的输入由客户端传「能力清单」还是宿主自己枚举？——**推荐宿主枚举**（客户端不传能力元数据，避免客户端篡改/体积），但宿主需要 sessionId+cwd 才能取会话态（width 依赖 `skills.sessionList`/`mcp.list`/`mcp.runtime`）。
- **建议归属**：architect（接口形状）、security（密钥边界评审）、frontend（api 类型）。

### B3. 能力枚举与应用：哪些能评分、哪些不能切换

**结论**：可评分/可切换集合 = `skills.sessionList()` ∪ `mcp.list()` ∪ `mcp.runtime()`，再排除「shadowStub / 文件级双 false / 无 live agent / MCP 硬关闭 disabled / 不可 restrict 的外部实例」；应用时 **skills 用 `{name,enabled}`**，**mcp 用 `{target,kind}`**（项目条目 = config key，全局/外部 = serverName）。

- **Fact**（`[R]`）：
  - `ClientSkillSummary` 字段（`src/client/api.ts:24-54`）：`name/description/whenToUse/modelInvocable/userInvocable/source/format/readOnly/path/root/shadowStub/projectShadow/enabledInSession/canToggleInSession`。
  - `skills.sessionList` 语义：磁盘列表 + `enabledInSession`/`canToggleInSession`；**宿主已过滤** `shadowStub === true` 与 `!(modelInvocable||userInvocable)` 的条目；`canToggleInSession = 找到 live agent`，冷会话全部置灰。`src/skills/session.ts:132-149`；接口与适配器 `src/client/api.ts:126-131`、`src/client/api-adapter.ts:123-127`；`src/index.ts:62-67,132`。
  - `ClientMcpServer` 字段（`src/client/api.ts:191-223`）：`key/serverName/transport/scope/enabled/shadowed/summary/entry/filePath/importedFromGlobal/reference/disabledInProject/enabledInSession`。
  - `mcp.list` 语义：全局 + 项目原生 + 项目级引用合并，`shadowed` 标被项目遮蔽，`disabledInProject` = 项目级「默认关闭」，`enabledInSession` 为会话投影。`src/mcp/manager.ts:149-238`。
  - `mcp.runtime` 语义：其它插件/profile 运行时注入的实例（只读视图）；`restrictable = tools.length > 0`（agent 作用域注入的实例工具不可见 ⇒ 不可 restrict）。`src/client/api.ts:280-301`；`src/mcp/manager.ts:409-469`。
  - `ClientMcpTool`：`name/description/parameters(JSON Schema)/outputSchema`。`src/client/api.ts:316-325`。
  - `skills.setSessionEnabled({name, enabled})`：只「关闭/恢复」；关闭 = agent 作用域注册同名 runtime shadow（`invocation` 双向 false）；**不能**把文件级禁用反向开启。`src/skills/session.ts:19-24,151-199`；`src/client/api.ts:132-138`；适配器要求 `deps.sessionId`，否则 throw（`src/client/api-adapter.ts:133`）。
  - `mcp.setSessionEnabled({target, kind:"project"|"server", enabled: boolean|undefined})`：`project:<configKey>` / `server:<serverName>`；`enabled: undefined` = 清显式覆盖回跟随默认。`src/client/api.ts:379-384`；`src/mcp/manager.ts:482-497`；`src/mcp/loader.ts:705-728`。
  - 优先级与硬关闭：**显式会话开关 > 项目级默认（overrides 里列了 = 默认关闭）> 配置文件 `disabled: true`（硬关闭，忽略会话开关）**。`src/mcp/loader.ts:237-251,363-374`；全局/外部用 `tools.restrict` 屏蔽、不卸载（`:398-425`）。
  - 视图层对「不可切换」的既有处理：composer hero 把 `canToggleInSession === false` 的技能置灰并标「会话未激活」（`src/client/composer-capability.tsx:299-313`）；外部实例 `restrictable !== true` 置灰「不可在当前对话关闭」（`:343-365`）；全局已关闭的 server 不列出（`:318-319`）。
  - **`readOnly` 的语义澄清（易误判）**：`readOnly` 只表示来源是 `.claude` 兼容只读根（`src/skills/manager.ts:85-87,110,122`），**只影响写回/编辑/删除**，不是会话开关的阻塞项——关闭时是在 agent scope 注册同名 runtime shadow（按 name 遮蔽，不写磁盘，`src/skills/session.ts:182-198`），所以只读技能也能「在本会话关闭/恢复」。`[R]`
- **Inference（枚举与应用算法建议）**：
  1. 枚举：`skills.sessionList(cwd, sessionId)` + `mcp.list(cwd, sessionId)` + `mcp.runtime({cwd, sessionId})`，宿主侧做（一次 RPC 聚合更省）。
  2. 可评分集 = 上述全部（评分只是读）；**可应用集** = 交集条件：
     - skills：`shadowStub !== true`（已由宿主过滤）、`modelInvocable || userInvocable`（已过滤）、`canToggleInSession === true`；`readOnly` **不排除**（见上条 Fact），但 UI 应标注「只读」；
     - mcp 项目条目：`entry.disabled !== true`（硬关闭不可开）；
     - mcp 全局条目/引用：可切换（`kind:"server"` 用 serverName；引用用 `kind:"project"` 用 key）；
     - mcp 外部实例：`restrictable === true`。
  3. 应用：**先关后开**（避免同名遮蔽竞态）；每条一次 RPC（现有无批量端点）；100 条 = 100 RPC 不可接受，建议新增宿主批量端点（如 `jev.apply({sessionId, plan:[{kind,name,target,enabled}]})`）或让 `jev.rank` 直接返回「应用计划」，由一次 `jev.apply` 落库（内存态）。
  4. 幂等/回滚：应用前记录每个条目的 `enabledInSession`（或 unknown），失败时按记录恢复；MCP `enabled: undefined` 可回到「跟随默认」，skills 用 `enabled: true` 解除 shadow。
- **Assumption**：用户只看当前会话（不落盘）——现有开关语义就是内存态（`src/skills/session.ts:23`、`src/mcp/loader.ts:236-251`），与「自动选择」天然匹配。
- **置信度**：高（逐字段/逐规则可回查）。
- **未决**：是否把 MCP 工具（`mcp__server__tool` 粒度）也纳入评分/应用？——现有开关只到 server 级；**不建议**首版做到 tool 级（无开关 API，需 `tools.restrict` 自建）。
- **建议归属**：architect（应用事务）、backend（批量端点）、frontend（置灰逻辑）。

### B4. 首屏草稿读取：现状定位、宿主 DOM、可靠方案与降级

**结论**：hero 面板用 `[data-composer-card]` 的 `getBoundingClientRect` 定位并随 ResizeObserver/滚动/resize 重算（`src/client/composer-capability.tsx:249-284`）；**已安装外壳 0.2.1-rc.2 的输入框是 Lexical contenteditable（`div[data-composer-input]`），不是 textarea**；可靠读草稿应优先用槽 standardProps `useInput(s => s.draft)`（ownerProps 还给 `input`），DOM 只能作降级。

- **Fact（仓库现状）**（`[R]`）：
  - hero 注册在 `conversation.input.dock`（id `capability-panel-hero`，order 60），只传 `api` + `onManage`，**没读草稿**：`src/client.ts:253-261`。
  - 定位：`useConversationPhase()` 从 `closest("[data-phase]")` 读 `data-phase`（`src/client/composer-capability.tsx:225-241`）；`useComposerCardRect(isHero, hostRef)` 内 `root.querySelector("[data-composer-card]")` 取 rect，`top = box.bottom + 8`，并用 `ResizeObserver(root)`+`ResizeObserver(card)`+`window.resize`+`document.scroll(capture)`+rAF 节流（`:249-284`）。
  - hero 组件：`isHero = phase === "hero"`，非 hero 返回零高锚点；fixed 面板 `left/top/width` 直接取 rect（`:734-779`）。
- **Fact（已安装外壳 0.2.1-rc.2）**（`[A]`，抽取自 `app.asar`）：
  - 版本：`dsh/package.json` = `@deepseek-ai/dsh-desktop-runtime 0.2.1-rc.2`；`dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/package.json` = `0.2.1-rc.2`。
  - 输入卡根：`div.card` 带 `"data-composer-card": true`（`…/dsh-client-ui-conversation/lib/client.js:18990`）。
  - 编辑器：`DraftEditor` 组件（`:18141`）→ `div`（`"data-input-scroll": true`，`:18145`）→ `ComposerContentEditable`（`:18083`）渲染 `div`，属性 `contentEditable`、`role="textbox"`、`aria-multiline="true"`、`"data-composer-input": true`（`:18083-18108`，其中属性行 `:18102`）；底层是 **Lexical**（编辑器根元素会被 Lexical 加 `data-lexical-editor="true"`，`:10539`）。
  - **不存在 textarea 作为输入**：全文件 `textarea` 仅出现在「inert 占位」注释等无关处；`querySelector("textarea")`（仓库旧组件写法）在当前外壳会拿到 null。
  - 草稿是**公开槽 API**：`conversation.input.dock` 的 standardProps 明确包含 `useInput: SnapshotSelectorHook<InputState>` 与 `inputActions: InputActions`（`…/dsh-cordis-client-runner/lib/client.js:3364-3380`，其中 useInput `:3378`、inputActions `:3379`）；ownerProps 为 `InputZone { session, input }`（`:3364`）。
  - 渲染处把 `zone` 作为 props 传给槽：`const zone = session === void 0 || inputState === void 0 ? undefined : { session, input: inputState }`（ui-conversation `:17779`）；`zone !== void 0 && renderSlot("conversation.input.dock", zone)`（`:17842`）。
  - `InputState` 的发布投影含 `draft`：`compose()` 返回 `{ draft: this.projection.clipboardText, attachmentIds, draftRev, phase, …claim, occurrences, queue }`（ui-conversation `:15210` 附近）。
  - 仓库里已有同款用法（未注册的死代码，但写法可复用）：`src/client/composer-skills.tsx:28-31` 注释「会话标准套件会把 `useInput` / `inputActions` 注入条目 props」，`:323` 用 `props.useInput((s) => s.draft)`；`:341` 的 `querySelector("textarea")` 是过时写法（当前外壳已无 textarea）。
- **Fact（DOM 与事件，宿主源码级）**：
  - 编辑器是 contenteditable，草稿文本由 Lexical 维护；装饰节点（chip）以 `contenteditable="false"` 的 span 形式存在（`data-composer-chip` / `data-composer-command`，ui-conversation `:13730` 附近），且 draft 投影里会用 `REFERENCE_PLACEHOLDER_RE = /[\uE100-\uE11D\uFFFC]/gu` 表示 chip 占位（`:14550`）——所以**直接读 DOM innerText 会混入占位符**，必须清洗。
- **Inference（可靠读取方案，按优先级）**：
  1. **首选：槽 standardProps**。`ComposerCapabilityHero` 接收 `props`，取 `const useInput = props?.useInput; const draft = typeof useInput === "function" ? useInput((s) => (typeof s?.draft === "string" ? s.draft : "")) : (props?.input?.draft ?? "")`。订阅式重渲染，草稿变化即触发；对草稿做 300–500ms 防抖再发起 ranking（避免每键一次 API 调用）。
  2. **次选：ownerProps** `props.input.draft`（`InputZone` 已在渲染处传入，`:17779`），适合拿「当前值」不订阅（配合用户点按钮触发）。
  3. **DOM 降级**：`anchorEl.closest("[data-phase]")?.querySelector("[data-composer-card] [data-composer-input]")` → 读 `innerText`（不是 `value`！contenteditable 没有 value），用 `MutationObserver({childList,characterData,subtree})` + `beforeinput`/`keyup` 触发重算，清洗 `\uE100-\uE11D\uFFFC` 占位符与零宽字符。**不要**再找 textarea。
  4. **兜底**：若以上都不可用（旧外壳 / 槽 props 变化），退化为「手动触发按钮」+ 读「最近一条用户消息」（`props.useChat`/`useSession` 的会话快照）或让用户粘贴；并把该降级写进 UI 文案。
- **Assumption**：
  - 当前外壳（0.2.1-rc.2）的 hero 相位下 `zone` 仍非空（否则 `conversation.input.dock` 不渲染，现有 hero 面板根本不会出现——与真机截图矛盾，故判断 hero 态也有 session/input）。`[I]`
  - `useInput` 选择器在 hero 与 composer 相位都可用（standardProps 按 session 注入，未按 phase 区分）。`[I]`
- **置信度**：DOM/API 事实 = 高；「hero 相位可用」= 中（未在真机执行，仅源码推断）；降级链 = 中。
- **未决（关键风险）**：
  1. 需要一次**真机验证**：在已安装外壳里用 React DevTools/临时日志确认 hero 组件 props 里 `useInput`/`input` 存在（tester 用独立 `DSH_HOME`，勿动用户 profile）。
  2. 草稿里 chip 占位符/附件/队列如何参与 ranking（首版建议只用纯文本，忽略附件与队列）。
  3. 空草稿 / 仅空白 / 仅 `/` 时是否触发（建议不触发）。
- **建议归属**：frontend（实现）、tester（真机 props 验证）、ux（触发时机与防抖体验）。

### B5. 面板「第三个域 Tab」：改造成本与坑

**结论**：技术上**小改动**（1 个联合类型 + 4 处映射/分支 + 1 个新视图组件），但**会与现行 UX 规格和回归断言冲突**，需要 ux/lead 先裁决入口形态（面板 Tab vs composer 入口 vs 详情按钮）。

- **Fact**（`[R]`）：
  - `type DomainTab = "skills" | "mcp"`（`src/client/panel.tsx:54-55`）；`DOMAIN_LABEL`（`:58-61`）；`DOMAIN_ORDER: DomainTab[] = ["skills","mcp"]`（`:63`）；`DOMAIN_SEARCH_PLACEHOLDER`（`:66-69`）。
  - 根组件状态：`domain` 默认 `"skills"`、`query`、`workspace`、`projects`、`pinned`（`:81-86`）；计数 `skillsCount`/`mcpCount`（`:93-94`），`counts: Record<DomainTab, number|undefined>`（`:115`）。
  - 头部第二行：`DOMAIN_ORDER.map` 渲染 Tab（`:150-167`）；**唯一搜索框** `.skp-header-search`，placeholder 按域切换、Esc 清空（`:168-181`）；切域 `setDomain(d); setQuery("")`（`:158-161`）。
  - 渲染分支：`domain === "skills" ? <SkillsView …/> : <McpView …/>`（`:185-205`）。
  - 计数回填：`SkillsView` 在数据到达后 `onCount?.(items.length)`（`:377-378`）；`McpView` `onCount?.(data.servers.length)`（`src/client/mcp-panel.tsx:401-402`）；口径注释在 `src/client/panel.tsx:87-92`（技能=项目+全局、MCP 不含外部注入、搜索不改变计数）。
  - 样式：`.skp-tabs{display:flex;gap:2px;padding:3px;…}`、`.skp-tab{flex:1;…}`（`src/client/styles.ts:59-60`）⇒ Tab **等分**宽度，第三个会各占 1/3。
  - `/` 聚焦搜索框（input/textarea/contenteditable 内不生效）（`src/client/panel.tsx:417-432`）。
  - **回归断言**：`notes/verify/render-smoke.mjs:52-59` 断言「域 Tab 只有两个（技能 / MCP）」「头部第二行同时含域 Tab 与唯一搜索框」（`notes/` 本地 gitignore，但 `bash notes/verify/run-all.sh` 会跑）。
  - **UX 规格**：`docs/ux/panel-upgrade.md:105-116`（v1.7）明确「第二行：左侧域 Tab（`技能` / `MCP`，带计数）」「域 Tab 只剩技能 / MCP」「计数口径…搜索不改变计数」。
- **Inference（成本）**：核心代码 ~1 天；含新视图（列表/表单/状态）、样式、回归脚本、文档与 Figma 同步 ≈ **2–4 人日**。改动点：`DomainTab`/`DOMAIN_LABEL`/`DOMAIN_ORDER`/`DOMAIN_SEARCH_PLACEHOLDER`/`counts`/`useState` 计数/分支渲染 + 新视图 + `styles.ts` + `notes/verify` 断言 + `README/CHANGELOG` + Figma。
- **坑（必须在设计阶段定掉）**：
  1. **搜索框是共享单例**：新 Tab 若没有可搜索列表，必须条件隐藏/禁用搜索框（否则 placeholder 与行为对不上）；改动会碰「唯一搜索框」断言。
  2. **计数语义未定义**：「Jev Tab」计数是什么（能力总数？建议数？调用次数？）需要产品定义；`counts` 是 `Record<DomainTab, …>`，漏定义会 TS 报错（好事）。
  3. **Tab 等分**：三 Tab 在窄容器会挤压文案（`.skp-tab{flex:1}`），需要 `@container` 或改 min-width。
  4. **切域清空 query**：若新 Tab 是表单（如填 key/测试），`setQuery("")` 无影响，但不要把表单 state 也重置。
  5. **异步计数竞态**：`onCount` 是普通 effect，视图切换时可能用旧数据回填（SkillsView/McpView 内部有 `useAsyncList` seq 守卫，但 `onCount` 调用本身不受保护）。
  6. **与 v1.7 IA 冲突**：域 Tab「只剩技能/MCP」是上一轮明确裁决（`docs/ux/panel-upgrade.md`），加第三 Tab 属于 IA 变更，需要 ux/lead 重开裁决并同步 Figma（AGENTS.md 变更纪律）。
  7. **替代入口更省**：Jev 是「动作/建议」而非「域」——放在详情动作区（「用 Jev 预选」按钮）或 composer hero（就地建议）比加 Tab 更贴合，且不碰搜索/计数/回归断言。
- **Assumption**：产品尚未确定 Jev 的入口形态（任务描述写的是「第三 Tab」，但未给交互规格）。
- **置信度**：成本=中（估算）；坑=高（代码/规格可回查）。
- **未决**：入口形态（详见 §4）；Tab 名称与图标；是否需要搜索。
- **建议归属**：ux + lead（IA/入口）、frontend（实现）、tester（回归脚本）。

### B6. Figma：本地桥状态、v8 页面帧、配色字体、导出流程

**结论**：本地桥可用（文档 `dsh` 已连接、伴生插件在线、port 3055）；v8 是当前基线（页 `42:3373`，4 帧）；主色 `#61AFEF`/`#8FBCFF`、启用绿 `#98C379`、面板底 `#1F232B`～`#23272F`、页面底 `#1E222B`；字体 `PingFang SC`（Regular/Medium/Semibold）+ `Menlo Regular`（路径/代码/树）；导出/导入流程在 `docs/figma/README.md` §3–§5。**本会话无画布工具，未做 get_metadata 复核**。

- **Fact（本地桥，`[P]`）**：`figma_status` 返回 `backend:"local"`、`available:true`、`documents:[{name:"dsh", connectionId:"7e8c7248-97c8-4f31-af84-e83ac621d9eb", editorType:"figma", busy:false}]`、`companion:{paired:true, port:3055, private:true}`；桥侧工具列表含 `use_figma/get_metadata/get_screenshot/get_design_context/import_scene/download_assets` 等 17 个。**但本 teammate 会话的工具面只有** `figma_status/figma_setup/figma_read_guide/figma_select_document/figma_reconnect` ⇒ 画布读取不可用（与 `docs/research/figma-recon.md` §1 记录一致；上轮由 Lead 会话代跑 `get_metadata`）。
- **Fact（页面/帧，`[R]`）**：`docs/figma/README.md:8`（v8 页 `42:3373` 为当前基线）、`:30-33` 帧表：
  | 帧 | node id | 尺寸/位置（scene 实测） |
  |---|---|---|
  | 01 · 技能 · 项目 | `42:3376` | 1440×900 @(0,150) |
  | 02 · 技能 · 全局 | `42:3433` | 1440×900 @(1520,150) |
  | 03 · MCP · 项目 | `42:3490` | 1440×900 @(0,1200) |
  | 04 · MCP · 全局 | `42:3547` | 1440×900 @(1520,1200) |
  （尺寸/位置由 `docs/figma/scenes/v8-*.scene.json` 的 `nodes[0].props` 实读，四个 scene 文件各含 1 个 FRAME。）
- **Fact（配色，`[R]` 由 v8 scene 统计）**：按出现次数：
  - 主蓝 `#61AFEF`（开关开态、选中条、加号底、主操作底，28 处）；亮蓝 `#8FBCFF`（链接/计数/项目标签字，22 处）；
  - 启用/在线绿 `#98C379`（35 处）；必填橙 `#D19A66`；危险红 `#E06C75`（删除文字）；
  - 页面底 `#1E222B`（frame fill；4 帧均同）；侧栏 `#191C22`；选中行/选中组 `#2A303B`（13 处）；树/阅读器/列表块底 `#1F232B`（8 处）；分段/轨道底 `#151920`～`#1B1F27`；面板底 `#23272F`（8 处，来自继承 v5 的区域）；
  - 文字：主 `#E3E6EA`（90 处）、次 `#9DA5B4`（152 处）、三级 `#7F8794`（150 处）、路径/代码 `#5C6370`/`#8F97A6`/`#D7DBE2`；白色按 6%/8%/10%/12%/14% 透明度做描边/分隔。
- **Fact（字体，`[R]` 由 v8 scene 统计）**：family/style 组合共 3 + 1：`PingFang SC` Regular / Medium / Semibold；`Menlo` Regular（路径、代码、文件树、语言徽标）。字号分布：13（最多，76 处）、10.5（53）、11（45）、12.5（38）、12（36）、13.5 Semibold（21）、17/18（标题）、Menlo 11.5/11/10/8（代码与树）。
- **Fact（导出流程，`[R]`）**：`docs/figma/README.md` §3（导入：读 `scenes/*.scene.json` 取 `scene.nodes` → `import_scene`；v8 四帧合计约 229 节点 < 500 可一次导入）、§4（`docs/figma/tools/export-scene.js` 贴进 `use_figma`；改 `TARGET_NODE_ID`，按 `SERIALIZE_RANGE` 两段取 `part` 拼接；PNG 用 `download_assets({nodeIds, format:"PNG", scale:1})`）、§4.1（手动 Export PNG/SVG）、§5（已知限制：VECTOR 图标路径跳过、只保留 SOLID/圆角/自动布局、字体 `PingFang SC`、`import_scene` 不还原交互）。
- **Fact（预览产物）**：`docs/figma/preview/v8-01..04-*.png` 四张真实导出存在（`ls` 可见）；提交 `03e26fc`「docs(figma): 执行 v8 终稿（4 帧）并保存可重导入 scene JSON 与预览」。
- **Inference**：Jev 功能若需要 Figma 同步，应新增「建议态/应用态」帧（例如技能 Tab 行尾加「建议」徽标、详情加「用 Jev 预选」按钮、hero 面板加推荐区），并按 §4 流程导出 scene+PNG；v8 现有帧不含任何 Jev 相关元素（grep 四份 scene，未发现 jev/推荐相关文案）。
- **Assumption**：v8 的 `42:*` id 仍有效（本轮无法 `get_metadata` 验证；id 来自同仓库已提交 README，且与 scene 导出一致）。
- **置信度**：桥状态 = 高（实时）；node id = 中（仓库文档，未实时复核）；配色/字体 = 高（scene 数据）；工具面限制 = 高。
- **未决**：是否需要 Jev 专属帧；由谁执行画布写操作（Lead 会话）；scene 是否需要重新导出。
- **建议归属**：ux（新帧/标注）、lead（画布写操作）、frontend（实现对照）。

---

## 3. 风险清单（按严重度）

| # | 风险 | 等级 | 依据 | 缓解 |
|---|---|---|---|---|
| R1 | 草稿读取依赖 `useInput`/`input` props，未在真机确认（hero 相位） | 高 | §2.4：`[A]` 契约存在，但仓库未接；仅源码推断 | 用独立 `DSH_HOME` 真机验证；准备 DOM 降级（`[data-composer-input]` + MutationObserver） |
| R2 | 中文描述撑破默认上下文（per-request 64k / per-question 32k） | 中高 | §1.A4/A6：官方 CJK 准确率低；本机描述平均 676 字符 | 截断（desc ≤200、whenToUse ≤120）；读回 `usage.input_tokens`；超限降级 long-context 或分片 |
| R3 | 「自动应用」越权/不可预期：静默改会话开关 | 高 | §2.3：开关是内存态、可直接改；无用户确认 | 只给「建议 + 一键应用」，应用前展示 diff；提供「恢复默认」 |
| R4 | 应用面不齐：硬关闭/不可 restrict 条目会失败或置灰 | 中高 | §2.3：`loader.ts:362-372,398-425`、`manager.ts:462-468` | 宿主侧先算「可应用集」，rank 返回项带 `applicable` 标记 |
| R5 | 密钥泄漏：现有 MCP 链路会明文下发 entry；错误信息直传浏览器 | 高 | §2.2：`api.ts:199`、`remote.ts:184-186` | Jev 独立配置 + masked 只读视图 + 宿主执行 + 错误脱敏 |
| R6 | 配置文件权限：`atomicWriteText` 不支持 mode/0600 | 中（安全） | §2.1：`atomic-write.ts:28`，仓库无 chmod 先例 | 扩展 `atomicWriteText(mode?)` 或写后 chmod；security 评审 |
| R7 | 第三 Tab 违背 v1.7 UX 规格与回归断言 | 中 | §2.5：`docs/ux/panel-upgrade.md:105-116`、`notes/verify/render-smoke.mjs:52-59` | 先让 ux/lead 定入口；替代方案：详情按钮或 hero 推荐区 |
| R8 | 100 条逐条 RPC 应用 → 慢/部分失败/无回滚 | 中高 | §2.2/2.3：现有无批量端点；内存态无事务 | 新增宿主 `jev.apply` 批量事务 + 失败回滚 |
| R9 | 模型别名漂移（`jev-latest` 指向 1.13）导致结果变化 | 中 | §1.A4：别名随发布移动；官方建议固定版本号 | 配置里存版本号（如 `jev-1.13.0`），响应记录实际 `model` |
| R10 | 与用户已装的 `@yadsh/dsh-jev-compaction` 配置语义冲突（baseUrl 含 path） | 低中 | §2.1 `[P]` | 明确本插件 `baseURL` = 根；文档标注与插件区别 |
| R11 | 评分结果不可解释/不可调（Noul 无 confidence） | 中 | §1.A5 | 记录 `noul` 值 + 阈值；top-k 用第二段 Score 补 confidence |
| R12 | 客户端 bundle 不能引新依赖（无 SDK 可用） | 中 | `AGENTS.md` 平台契约；`package.json` 无 SDK | **宿主侧**用原生 `fetch`（Node 22），不引 SDK；客户端只走 RPC |

---

## 4. 未决问题与建议归属

| # | 未决 | 影响 | 建议归属 |
|---|---|---|---|
| Q1 | Jev 的入口形态：第三个域 Tab / 技能详情按钮 / composer hero 推荐区 / 侧栏独立页？ | IA、成本、Figma | **ux + lead**（先裁决，再进实现） |
| Q2 | 自动应用还是「建议 + 一键应用」？是否允许自动关闭已有能力？ | 产品安全、用户信任 | **pm + lead** |
| Q3 | 评分输入：草稿全文 / 最近 N 条消息 / 手动触发？ | 准确率、成本、隐私 | **pm + architect** |
| Q4 | 单段 Noul 还是两段（Noul 粗排 → Score/Choice 复核 top-k）？ | 准确率 vs 成本/复杂度 | **architect**（建议先单段，留两段口子） |
| Q5 | 阈值与 top-k（如 P≥0.7 且最多 8 个） | 误开/漏开 | **pm + architect**（用真实草稿标定） |
| Q6 | 能力描述截断长度与中文策略（截断 / 翻译 / long-context） | 上下文是否撑爆 | **architect** |
| Q7 | 配置文件位置与命名：`<agentsHome>/jev.json` vs cordis patch；key 存 env 还是文件；是否 0600 | 安全/迁移 | **architect + security** |
| Q8 | 是否需要宿主批量 `jev.apply`（事务/回滚） | 应用可行性 | **architect + backend** |
| Q9 | 是否缓存（草稿 hash → 结果）与缓存失效 | 成本/新鲜度 | **architect** |
| Q10 | 是否需要 Jev 专属 Figma 帧（建议态/应用确认态） | 设计同步 | **ux** |
| Q11 | 回归脚本（`notes/verify/render-smoke.mjs` 两 Tab 断言）与新入口的联动 | 测试门禁 | **tester** |
| Q12 | 客户端是否显示「评分来源/模型版本/用量」 | 可解释性 | **pm + frontend** |

---

## 5. 证据与复现

### 5.1 外部来源清单（`[D]`）

| # | URL | 用途 | 抓取方式 |
|---|---|---|---|
| 1 | https://docs.typesafe.ai/llms.txt | 文档索引（页清单/一行摘要） | web_fetch full |
| 2 | https://docs.typesafe.ai/api/system-one.md | OpenAPI（endpoint/auth/body/response/headers） | web_fetch full |
| 3 | https://docs.typesafe.ai/api/errors.md | 请求规则/压缩/错误码/重试 | web_fetch full |
| 4 | https://docs.typesafe.ai/models.md | 模型/上下文/别名/语言/价格/速率 | web_fetch full |
| 5 | https://docs.typesafe.ai/cookbooks/parallel_questions.md | 12.2x/10.0x 与逐题对比 | web_fetch full |
| 6 | https://docs.typesafe.ai/concepts/state.md | state 三形态/语言提示 | web_fetch full |
| 7 | https://docs.typesafe.ai/primitives/noul.md | Noul 语义/无 confidence/多 Noul 清单/rerank | web_fetch full |
| 8 | https://docs.typesafe.ai/primitives/score.md | Score 语义/confidence/level 规范/结构化 | web_fetch full |
| 9 | https://docs.typesafe.ai/sdk/javascript.md | JS SDK 快速开始（TYPESAFE_API_KEY） | web_fetch full |
| 10 | https://docs.typesafe.ai/sdk/javascript/api/interfaces/TypeSafeClientConfig.md | 配置项与回退/超时 | web_fetch full |
| 11 | https://docs.typesafe.ai/sdk/javascript/api/variables/ENV.md | 环境变量字面量 | web_fetch full |

**预算说明（如实）**：任务给的外部预算「≤8 次抓取」。本报告实际 **4 次抓取调用 / 11 个 URL**（按调用计 4 ≤ 8；按 URL 计 11 > 8，超出 3 个）。超出来自 A2 环境变量与 baseURL 的权威值只在 JS SDK 的 `ENV`/`TypeSafeClientConfig` 两页（第 10、11 项），若严格卡 8 个 URL，A2 只能写「未核实」。其余结论均可在前 9 个 URL 内复核。

### 5.2 仓库证据（`[R]`）

- 关键文件：`src/channel.ts`、`src/remote.ts`、`src/index.ts`、`src/shared/{agents-home,atomic-write,file-lock,json-config,config-location}.ts`、`src/mcp/{paths,config-file,manager,loader}.ts`、`src/overrides/config-file.ts`、`src/skills/session.ts`、`src/client/{api.ts,api-adapter.ts,client.ts,panel.tsx,mcp-panel.tsx,composer-capability.tsx,styles.ts}`、`docs/figma/README.md`、`docs/ux/panel-upgrade.md`、`notes/recon/client-composer.md`、`notes/recon/asar-read.py`、`notes/verify/render-smoke.mjs`、`.profile-backup/20261016-105723-desktop/cordis.patch.yml`。
- 复现命令（只读）：
  ```bash
  cd /Users/lzx/Documents/GitHub/dsh-capability-settings
  grep -n "CHANNEL" src/channel.ts
  sed -n '24,115p' src/remote.ts
  sed -n '117,187p' src/remote.ts
  sed -n '21,30p' src/shared/agents-home.ts
  sed -n '44,73p' src/shared/config-location.ts
  sed -n '25,30p' src/shared/atomic-write.ts
  sed -n '28,39p' src/shared/file-lock.ts
  sed -n '27,46p' src/shared/json-config.ts
  sed -n '132,149p' src/skills/session.ts
  sed -n '149,238p' src/mcp/manager.ts
  sed -n '362,425p' src/mcp/loader.ts
  sed -n '249,284p' src/client/composer-capability.tsx
  sed -n '725,779p' src/client/composer-capability.tsx
  sed -n '54,205p' src/client/panel.tsx
  sed -n '377,381p' src/client/panel.tsx
  sed -n '401,404p' src/client/mcp-panel.tsx
  sed -n '30,33p' docs/figma/README.md
  sed -n '235,242p' .profile-backup/20261016-105723-desktop/cordis.patch.yml
  grep -rn "chmod\|0o600\|umask" src   # 无命中
  grep -rn "zod" src                   # 仅 remote.ts 注释
  ```

### 5.3 估算假设（`[As]`）

1. 英文文本 ≈ 4 字符/token；中文 ≈ 1–1.5 token/字（经验值，**未在 Jev 上实测**）。
2. 本机 157 个 skill 的 description 长度代表「真实能力描述长度」；应用侧实际会截断。
3. JSON 包装（key、引号、逗号）按字符数的 10% 计。
4. 100 个能力 = 100 条 Noul 题；每题 instructions ≈ 20–40 tokens。
5. 成本按文档 `$0.042/Mtok`（input），忽略 output（文档称免费，但仍计 `usage.output_tokens` 观察）。
6. 以上任何一条都可能让估算偏离 2–3 倍；**上线前以 `usage.input_tokens` 实测替换**。

### 5.4 asar 抽取方式（`[A]`）

```bash
cd /Users/lzx/Documents/GitHub/dsh-capability-settings
python3 notes/recon/asar-read.py get dsh/package.json | head -6
python3 notes/recon/asar-read.py get dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js > /tmp/ui-conv.js
python3 notes/recon/asar-read.py get dsh/node_modules/@deepseek-ai/dsh-cordis-client-runner/lib/client.js > /tmp/runner.js
# 行号用 python 计算（t.count("\n",0,pos)+1），关键词定位见正文
```
- 外壳版本：`dsh/package.json` = `@deepseek-ai/dsh-desktop-runtime 0.2.1-rc.2`；`dsh-client-ui-conversation` = `0.2.1-rc.2`。
- 引用格式：正文中的 `…/dsh-client-ui-conversation/lib/client.js:18990` 均指 **asar 内该路径**（抽取后行号一致）。

### 5.5 本轮未做（明确）

- 未执行任何 `pnpm build` / `pnpm typecheck` / `install` / 真机 GUI 操作；
- 未修改 `src/**`、`docs/specs/**`、`docs/ux/**`、`docs/architecture/**`、`package.json`；
- 未调用 Figma 画布工具（本会话无该工具；也未写画布）；
- 未修改 `~/.dsh` profile（只读了 `.profile-backup/**` 备份与 `figma_status`）。

---

## 附录：Jev ranking 请求草案（**Inference/设计草案，非 Fact，未验证**）

```jsonc
{
  "model": "jev-1.13.0",
  "state": {
    "request": "<当前草稿纯文本>",
    "capabilities": [
      { "id": "skill:agent-orchestration-advisor", "kind": "skill",
        "name": "agent-orchestration-advisor",
        "description": "<截断到 ~200 字符>",
        "whenToUse": "<截断到 ~120 字符>",
        "source": "user-agents", "invocable": true },
      { "id": "mcp:project:AnySearch", "kind": "mcp", "name": "AnySearch",
        "description": "<服务器摘要 / 工具数>" }
    ]
  },
  "questions": {
    "skill:agent-orchestration-advisor": {
      "type": "noul",
      "instructions": { "task": "Decide if enabling this capability helps with the user's request.",
                        "capability_id": "skill:agent-orchestration-advisor" },
      "criteria": { "true": "The request is a task this capability directly helps with.",
                    "false": "The request does not need this capability, or another capability covers it better." }
    }
    // … 其余能力同理，一个请求内全部发出
  }
}
```
- 第二段（可选）：对 `noul ≥ 0.7` 的 top-k 再发一个 Score（`criteria` 4 级：无关/弱相关/相关/强相关），用 `score/(len-1)` + `confidence` 决定是否自动应用。
- 应用：宿主把 `noul ≥ 阈值` 的项映射为 `{kind,name,target,enabled:true}`（skills: `{name,enabled}`；mcp: `{target,kind}`），过滤「不可应用集」（§B3），一次 `jev.apply` 事务执行。

---

*本文件由 scout 基于只读证据整理；所有 `[I]`/`[As]` 不得当作已确认事实用于验收。*
