# v13 第一批实现方案 · R1 全局开关 / R3 Tools 域 / R4 MCP 来源 / R5 文案 / Jev 纳入 Tools

| 项 | 值 |
|---|---|
| 文档 | `docs/architecture/v13-implementation.md`（本任务唯一落盘产物） |
| 角色 | architect（只写架构文档）· 初版 task-9；本轮同步 **task-25** |
| 日期 | 2026-10-29 |
| 仓库基线 | 设计稿 `f454a03`；**实现提交 `d6723d7`**（feat(panel): v13 三域能力面板…）+ 本轮工作树（Tools 两层语义 / `tools.inspect` / 面板细节）；UX 依据 `docs/ux/capability-v13.md` **v1.8** |
| 上游规格 | `docs/ux/capability-v13.md`（下称 **UX**）、`docs/research/capability-v13-evidence.md`（下称 **证据**） |
| R2 | `docs/architecture/agent-capability-inheritance.md`（提案 v0.1，**未实现**；本批只确认边界，不实现） |
| 下游 | backend / frontend（已完成第一轮实现）、tester（§10 用例 + 真机验收）、pm/chronicler（文案与复盘） |
| 同步轮次 | **2026-10-29 晚（task-25）**：把本文与 `src/**` 实际实现对齐；A3 / A5 标 SUPERSEDED，新增 A11–A15 |
| 写作用域 | 仅本文；不改 `src/**`、不改设计稿、不动 `~/.dsh`、不安装、不推送 |

**阅读约定**：`文件:行号` 指工作树当前内容；`证据 §x` / `UX §x` 指上述两份上游文档的章节；`[待验证]` = 必须真机或单测确认，且同段给出验证方式；`[需拍板]` = 本方案已给推荐值，但需 Lead/用户确认后才能验收。

**本方案不含实现代码**。类型/JSON 片段是**契约**（字段名、可选性、信封形状），实现方按此写代码，不得自行改名。

> **本文现状**：§1–§12 保留设计期推演（作为决策依据与回归对照），其中已被实现取代的结论统一在 §0.1 用 **SUPERSEDED** 标注，并在对应章节写「实现现状」。以 `src/**` 为准；引用行号以本轮工作树为准。

---

## 0. 结论摘要（先看这一页）

1. **第一批范围**=R1 + R3 + R4 + R5 + Jev 纳入 Tools；R2 只确认交互/业务逻辑、**零代码**（§1.4）。R1 走**新增宿主批量端点** `session.setBulk`（不是前端 150+ 条并发），见 §6。
2. **域边界**：工具名以 `mcp__` 开头 → 永远归 **MCP 域**；否则若属"插件直接注册的非 mcp 工具" → **Tools 域**。宿主内建工具**不进入任何域**（排除清单自维护，证据 §3.2 #5）。与 UX v1.8 §2.4 / D11 一致。见 §2。
3. **Tools 域的开关单元 = 插件**（一个插件 = 一个单元，无单工具开关，UX §5.1/D8）。关闭 = 该单元 **effective=false**（会话覆盖关，或全局默认关）时，对该插件全部可继承工具调 `tools.restrict({deny})`；restrict 失败 → 降级为状态可见但不阻断，agent 自身层工具则不出现（§2.2）。两层语义见 §5.3。
4. **持久化（两层）**：**能力面板 = 全局默认**，写 `<dshHome>/dsh-capability-settings/tools-global.json`（`{version:1,disabled:[unit]}`，0700/0600、原子写+文件锁）；**会话首屏/「能力」Tab = 本会话覆盖**，仍写 `session-capabilities.json` 的 `tools` 域（`plugin:<unit>` → boolean，`version` 不变）。生效值 `effective = 会话覆盖 ?? !globalDisabled`；**不复用** `capability-overrides.json`（无 workspace 维度，A3→SUPERSEDED，见 §3.3）。
5. **R4 的第三条发现路径**：全局工具视图里 `mcp__<ns>__*` 若没有 mcp-client 实例 → 合成一条 `origin:"namespace"` 的外部行，来源用映射表解析成插件展示名（`figma` → `dsh-to-figma`），识别不到标「未识别」；UI 出 `插件` + 插件名两枚标签。**注意**：本机 `figma` 现在**已经**以"无来源外部行"出现在 MCP 列表/首屏（与证据 §4.3 措辞不同，见 §7.1），所以 R4 的真实缺口是**来源/标签/合成标记**，不是"让行出现"。
6. **Jev 纳入 Tools**：一个插件 = 一个评分/应用单元（`kind:"tool"`）；**候选 = 本会话 effective 启用的插件**（全局关闭或会话关闭的单元不参与，结构性保证"只收窄不扩权"）；选中=整插件开、未选=整插件关；复用现有 `jev.apply` 的筛选语义/回滚/冷会话排队，只新增 `write.type:"tools"`。见 §8。
7. **R2 不实现**：默认「继承」会改变现有行为，本批**不得**把"默认继承"写成现状；第一批必须为 R2 预留的只有一条：Tools 域的 restrict/shadow **可按任意 agent 作用域重复应用**（不绑定创建路径），实现为 `applyForAgent`（`src/tools/manager.ts:357-375`）。见 §1.4、§11。
8. **本轮已落地**：P1–P7（宿主域 / 批量端点 / R4 / 首屏三域 / 面板 / Jev / 文案与命名）随 `d6723d7` + 工作树实现；**剩余 = P8 真机验收 + 文档/设计稿同步 + tools-global 的懒清理**（§12）。新增 RPC `tools.inspect` / `tools.setGlobalEnabled`，见附录 A。
9. **能力面板与首屏的开关语义不同**（最易误解）：面板 Tools 页开关写**全局默认**（`tools.setGlobalEnabled`，影响所有会话默认）；首屏 rail / 卡片只写**本会话覆盖**（`tools.setSessionEnabled` / `session.setBulk`）；「恢复默认」= 清会话覆盖 → 回落到全局默认。见 §5.3、§9.4。
10. **`tools.list` 保持轻量**（tool name + 200 码点说明），完整 JSON Schema 只在详情按需 `tools.inspect`（懒加载，成功支无 `ok` 字段）。见 §5.1。

### 0.1 本方案内的架构决定（可被评审/实现引用）

| id | 决定 | 位置 | 状态 |
|---|---|---|---|
| A1 | `mcp__*` 恒归 MCP；Tools 只收非 mcp 前缀的插件直接注册工具；宿主内建工具不入域 | §2 | 已实现（用户已拍板） |
| A2 | `tools` 域落 `session-capabilities.json` 会话记录，键 `plugin:<unit>`，`version` 不变（该域 = **会话覆盖层**；全局默认见 A11） | §3.1 | 已实现 |
| A3 | ~~第一批不做 Tools 的项目级默认（不改 `capability-overrides.json`）~~ → **SUPERSEDED**：见 A11（仍不改 overrides，但新增独立全局默认文件） | §3.3 | **SUPERSEDED（A11 取代）** |
| A4 | 「来源未识别」合成一个单元；**可开关、计入分母、但不进 Jev 候选** | §4.4/§8.2 | **已实现**（`__unattributed__`；Jev 枚举显式跳过，`src/jev/apply.ts:388`） |
| A5 | ~~能力面板 Tools 页只读~~ → **SUPERSEDED**：见 A12（面板改为写全局默认，不需要 sessionId） | §9.4 | **SUPERSEDED（A12 取代）** |
| A6 | 同一 agent 上 Tools restrict 与 MCP restrict **叠加为交集**，各自持有 disposer、各自幂等短路 | §5.4 | 已实现 |
| A7 | R1 = 单一宿主批量端点 `session.setBulk`，支持 `enable`/`disable`/`reset`，**部分失败不回滚**、幂等、按会话串行 | §6 | 已实现 |
| A8 | R4 用 `origin:"namespace"` 扩展联合类型 + 新增 `channel` 字段（additive，旧客户端按 fiber 文案回落） | §7 | 已实现 |
| A9 | Jev Tools 单元：`kind:"tool"`、`id=cap(sha256("tool:plugin:<unit>"))`、`toolCount` additive 字段 | §8 | 已实现（候选另按 A14 过滤） |
| A10 | R5 副标题与实现冲突（隐私口径） | §9.6、§11-R7 | **已解决**：实现采用准确文案（`发送输入框草稿与能力名称、描述…草稿仅用于本次评分、不落盘`，`src/client/jev-panel.tsx:63`） |
| **A11** | **Tools 两层语义**（取代 A3/A5）：能力面板 = 全局默认（`tools-global.json`）；会话首屏/「能力」Tab = 本会话覆盖；`effective = 会话覆盖 ?? !globalDisabled`；无 workspace 维度；不改 `capability-overrides.json` | §3.3/§5.3 | **已实现**（`src/tools/global-state.ts`、`effectiveEnabled` `src/tools/manager.ts:292-300`） |
| **A12** | 能力面板 Tools 页开关**可写**，写全局默认 `tools.setGlobalEnabled`；全局变化**异步扇出**所有 live agent 重算 restrict（不等写完即返回）；新 agent 在 `agent/created` 按 effective 应用 | §5.3/§9.4 | **已实现**（`manager.ts:580-592, 794-822`） |
| **A13** | `tools.list` 保持轻量（name + 200 码点 description，无 parameters）；完整 schema 走按需 `tools.inspect`（懒加载；成功支 `{unit,tools}` **无 `ok` 字段**，业务失败 `{ok:false,errors}`） | §5.1 | **已实现**（`manager.ts:685-725`；`src/client/tools-panel.tsx` 手风琴） |
| **A14** | Jev Tools 候选 = **本会话 effective 启用**的插件；全局关闭/会话关闭的单元不进候选（结构上不扩权） | §8.2 | **已实现**（`src/jev/apply.ts:387-417`） |
| **A15** | `tools.list` 下发 `defaultEnabled`（全局默认）/ `enabled`（本会话生效）；`enabledInSession` 为**恒等 legacy 等名**，客户端以 `enabled` 为准 | §5.1/§9.1 | **已实现**（宿主恒发三字段；客户端把三个字段都设为 optional 兼容旧宿主） |

---

## 1. 现状 → 目标差距清单

> 本节是**设计期**的差距推演（保留作决策依据）。第一轮实现已随 `d6723d7` 落地，逐项状态见 §1.0；H13–H15 / C11–C13 是**实现后新增**的差距项（两层语义、inspect、面板细节）。

### 1.0 实现落点（本轮，对照 `src/**`）

| 设计项 | 实现位置 | 状态 |
|---|---|---|
| H1 宿主 tools 域 | `src/tools/{types,manager,restrict,global-state}.ts`；`src/index.ts:143-144,273` | ✅ 已实现 |
| H2 RPC | `src/remote.ts`：`tools.list` / `tools.setSessionEnabled` / `tools.inspect` / `tools.setGlobalEnabled` / `session.setBulk` | ✅ 已实现 |
| H3 会话 `tools` 域 | `src/session-state.ts:113-115,179,192-204,242-246,271`（`tools()`/`setTool()`/`setToggles()`） | ✅ 已实现 |
| H4 restrict 骨架 | `src/tools/restrict.ts`（`computeDenyNames`/`applyRestrict`/`sameDenyNames`） | ✅ 已实现 |
| H5 per-session 记录 | `src/tools/manager.ts:100-112,383-635`（hydrate / 生命周期 / `tools/change`） | ✅ 已实现 |
| H6–H8 R4 三路发现 | `src/mcp/runtime.ts` + `src/mcp/manager.ts`（`origin:"namespace"`、`channel`、`synthesized`） | ✅ 已实现 |
| H9–H11 Jev Tools | `src/jev/types.ts`（`kind:"tool"`/`write`/`prev`/`toolCount`）、`src/jev/apply.ts:373-425,446+`、`src/jev/rank.ts` | ✅ 已实现 |
| H12 工具名解析复用 | `src/mcp/usage.ts:57-66` | ✅ 已实现 |
| C1–C10 客户端 | `api.ts` / `api-adapter.ts` / `composer-capability.tsx` / `tools-panel.tsx` / `panel.tsx` / `mcp-panel.tsx` / `styles.ts` | ✅ 已实现（细节见 §9） |
| **H13** 全局默认存储 | **新增** `src/tools/global-state.ts`（`tools-global.json`，A11） | ✅ 已实现 |
| **H14** `tools.inspect` 懒加载 | `src/tools/manager.ts:685-725` + `tools-panel.tsx` 手风琴 | ✅ 已实现 |
| **H15** effective 扇出 | `src/tools/manager.ts:432-455,573-592,794-822` | ✅ 已实现 |
| **C11** 面板 Tools 可写全局 | `tools-panel.tsx:251-262,430-455`（`setGlobalEnabled`） | ✅ 已实现（A12，A5 SUPERSEDED） |
| **C12** 详情滚动 + 手风琴 | `tools-panel.tsx:323,408-506`；`styles.ts:230,467-481,767-770` | ✅ 已实现 |
| **C13** 外部注入行分行 + 全局 Skills 开关 | `mcp-panel.tsx:200-340`；`panel.tsx:926-927` | ✅ 已实现 |

### 1.1 宿主侧（`src/**`，只读分析）

| # | 位置 | 现状（引用） | 目标 | 差距/动作 |
|---|---|---|---|---|
| H1 | `src/index.ts:218-267` | 服务只有 `skills` / `mcp` / `overrides` / `jev` / `mcpTools` | 新增 `tools` 域服务（`list` / `setSessionEnabled`），并把 `tools` 注入 Jev 的 `JevCapabilityService` | 新增 `src/tools/**`；组合根装配 |
| H2 | `src/remote.ts:50-119, 128-216` | endpoint 表只有 `skills.*` / `mcp.*` / `overrides.*` / `jev.*`，**无批量端点**（证据 §5.3） | 新增 `tools.list` / `tools.setSessionEnabled` / `session.setBulk` | 路由表 + `PanelRpcService` 接口 |
| H3 | `src/session-state.ts:91-104, 201-215, 232-236, 388-398` | 会话记录只有 `skills` / `mcp` 两域；`sanitizeEntry` / `isEmptyEntry` 只认这两域 | 追加 `tools` 域（`Record<string,boolean>`）+ `tools()` / `setTool()` / `setToggles()` 批量写 | 见 §3.1 |
| H4 | `src/mcp/loader.ts:486-512, 542-579, 593-602` | 现成的"全局视图取名单 → 空名单降级 → `tools.restrict({deny})` → 失败 warning"骨架，只服务 `mcp__` 前缀 | 抽出同样的骨架给 Tools 域（名字来源 = 任意非 mcp 工具名集合） | 证据 §3.5 已指明；建议 `src/tools/restrict.ts` 复用同一套短路/重算逻辑（代码可复制，不强制抽象） |
| H5 | `src/mcp/loader.ts:185-190, 700-706, 772-798` | 每个 session 的开关落盘 + 重挂（MCP） | Tools 域需要同构的 per-session 记录、hydrate、生命周期监听、`tools/change` 重算 | 新增 `src/tools/manager.ts`（结构照抄 loader 的会话记录模式） |
| H6 | `src/mcp/runtime.ts:72-136` | 两条发现路径（fiber / loader 条目）并集 | 加第三条 `namespace`（全局工具视图里 `mcp__<ns>__*` 无实例） | 见 §7.1 |
| H7 | `src/mcp/types.ts:216-246`（客户端镜像 `src/client/api.ts:348-369`） | `McpRuntimeServerView` 有 `source`/`origin:"entry"\|"fiber"`，**无 channel 字段** | 加 `channel?`、`origin` 追加 `"namespace"`、`attribution?`、`synthesized?` | 见 §7.3 |
| H8 | `src/mcp/manager.ts:396-476` | `runtime()` 已用全局工具视图反推出"无实例的 mcp 命名空间"（`ensure(...,"fiber")`），但**不给 source**，所以 `figma` 现在表现为"外部、无来源" | 改成命名空间合成行 + 来源解析 | 见 §7.1（同时纠正证据 §4.3 的措辞） |
| H9 | `src/jev/apply.ts:227-354` | 枚举只有 skills / MCP 配置条目 / 外部 MCP 实例 | 追加第 4 段：Tools 插件单元 | 见 §8.2 |
| H10 | `src/jev/types.ts:320-354, 178-199, 239-246` + `src/jev/apply.ts:383-408, 436-465` | `JevCapability.kind: "skill"\|"mcp"`、`write` 只有 skills/mcp、`JevPrevState` 只有两种 | 加 `kind:"tool"`、`write:{type:"tools"}`、`JevPrevState:{type:"tools"}`、`toolCount?` | 见 §8.1/§8.3 |
| H11 | `src/jev/rank.ts:89-96, 57-65, 329-335` | `SystemOneCapability.kind` 只允许 skill/mcp；guidance 只提 MCP；排序把 kind 二分 | 加 `"tool"`、补一句 Tools 判据、排序改成三档全序 | §8.4 |
| H12 | `src/mcp/usage.ts:57-66` | `parseMcpToolName` 可复用于解析 `mcp__<ns>__<tool>` | 第三条发现路径与 Tools 归属共用 | 直接复用 |
| H13 | 设计期无 | Tools 只有会话级开关（A3） | **两层语义**：新增全局默认存储 `tools-global.json` + `tools.setGlobalEnabled` + effective 计算 | 见 §3.3 / §5.3（A11） |
| H14 | `src/tools/manager.ts`（设计期无） | `tools.list` 下发全部 `tools[].name/description`，**无 parameters** | 详情需要完整 schema：新增 `tools.inspect` 懒加载（`parameters` 原样、不裁剪；成功支无 `ok`） | 见 §5.1（A13） |
| H15 | 设计期无「全局变化」概念 | 只能在会话内改开关 | 全局默认变化 → 扇出所有 live agent 重算 restrict（异步、fire-and-forget）；`tools/change` 重算前先 hydrate 全局 | 见 §5.4（A12） |

### 1.2 客户端侧

| # | 位置 | 现状 | 目标 | 差距 |
|---|---|---|---|---|
| C1 | `src/client/composer-capability.tsx:104-119` `McpRow` | 没有 `channel`，只有 `tag/tone` | 加 `channel?: string`（第二枚标签） | R4 |
| C2 | 同文件 `:1413-1467` `buildMcpRows` | 外部行 `tag:"外部"`、`source` 只在无工具时折进 `meta`（证据 §4.2） | 有 channel → `插件` + channel；无 → `外部注入`；namespace 无映射 → `未识别` | R4 |
| C3 | 同文件 `:1570-1711` `CapabilityPanel` | 两域 Tab（`:1620-1656`）；计数 `totalOn/total` 只相加两域（`:1576-1588`）；底栏文案（`:1687-1708`） | 第三域 Tab + 行 3 控制条（R1）+ 计数含三域 + Tools 卡片 | R1/R3 |
| C4 | 同文件 `:1791-1895` controller | `toggle` 逐条 RPC；`reset` 前端 `Promise.all` 150+ 条（`:1871-1892`）；无批量动作 | 三域 toggle（tools 一条 `tools.setSessionEnabled`）；批量走 `session.setBulk` | R1 |
| C5 | 同文件 `:1158-1379` `DecisionPanel` | 结果行 kind 只有 skill/mcp（`:1289` 文案硬编码"技能"/"MCP"）；apply plan（`:1019-1023`）只带 skill/mcp | Tools 行（插件名 + `插件` 标签 + `N 个工具`）、plan 带 `kind:"tool"` | Jev |
| C6 | `src/client/panel.tsx:60, 94-100, 183, 223-245` | 域 Tab 只有 skills/mcp/jev；`counts` 只有两域 | 第三域 `tools`（主面板四 Tab：Skills/MCP/Tools/Jev 模型） | R3 |
| C7 | `src/client/mcp-panel.tsx:221-286, 636-664, 853-940` | 外部行/组/详情的标签只有「外部」/「只读」，来源只作为 `skp-tag-flat` 显示 | 两枚标签 + 来源判定 meta + 合成标记 | R4 |
| C8 | `src/client/api.ts:348-369` + `src/client/api-adapter.ts` | 客户端无 Tools 域 API、无批量 API | 新增 `ToolsApi`、`SessionApi`（bulk）与类型镜像 | R1/R3/R4 |
| C9 | `src/client/jev-panel.tsx:59-110, 600-606` | callout 四行（`batch` / `scope` / 密钥路径+权限 / `privacy`）仍在（证据 §7） | 删 callout，说明并入副标题两行；删 `securityLead/Path/Tail`；密钥安全承诺收进 API Key ⓘ | R5 |
| C10 | `src/client/styles.ts:305-390, 653-730` | 无控制条（rail）样式、无 Tools 域专用类、决策行 grid 只有 5 列 | 新增 `skp-dock-rail*`、`skp-dock-tag-count`、`skp-dock-tag-unattributed`、`skp-decision-kind-tool`、`skp-decision-toolcount`（决策行不加 grid 列，见 §8.5） | R1/R3/Jev |
| C11 | 设计期无 | 面板 Tools 页开关原定只读（A5） | 改为写**全局默认**（`tools.setGlobalEnabled`），行/详情开关展示 `defaultEnabled`，文案改「默认已启用/已关闭 · 本会话可在对话首屏单独覆盖」 | A12（A5 SUPERSEDED） |
| C12 | 设计期无 | 详情为普通文档流，工具清单无参数 | 详情整块可滚动（`.skp-body.skp-tools-body` + `.skp-detail-fixed`）；工具清单改**手风琴**（参数表 + 原始 JSON，`tools.inspect` 懒加载）；删除「关闭该插件后…」与「无参数表」文案 | A13 / UX 修复 |
| C13 | `src/client/mcp-panel.tsx:221-286`、`panel.tsx:926` | 外部注入行把两枚标签放名称行（挤掉 serverName）；全局 Skills 仅在钉选项目时可开关 | 名称行只放状态点 + serverName，两枚标签移到 meta 行；`hasWorkspace = pinned ?? workspace`（跟随会话时全局 Skills 也可开关） | R4 / 面板细节 |

### 1.3 明确**不改**的部分（防越界）

- `src/mcp/loader.ts` 的挂载/换代号、项目级 overrides 语义、`skills/**` 的 shadow 机制、`sessions-capabilities` 的对账策略：**不改语义**；只为 Tools 域补一条 restrict 通路，为批量端点补 `setSessionEnabledMany` 内部方法。
- `capability-overrides.json` 的 schema 与读写：**不改**（A3 的保留部分；Tools 的全局默认走独立 `tools-global.json`，见 §3.3）。
- Figma 设计稿、`~/.dsh` profile、安装脚本：本批不动。
- `README.md` / `CHANGELOG.md`：实现阶段按仓库纪律更新，本方案只给要点（§12.3）。

### 1.4 R2 派生继承：本批只确认，零实现（用户已拍板）

**已定的交互与业务逻辑（UX v1.8 §4，D3）**，本批**不写任何代码、不落任何字段、不渲染任何 R2 UI 控件/弱提示**，实现时**不得**把这些当现状写进 README/CHANGELOG：

1. 首屏行 3 右侧一个布尔开关 `继承` / `不继承`（**默认「继承」**）+ 弱提示 `派生 agent 整体继承三域`；作用对象 = subagent + teammate 共用同一个开关，**Skills·MCP·Tools 三域整体**，不按模块分；**无分型链接 / 弹层 / 第三态**（UX v1.8 §4.1/D3）。
2. **默认「继承」会改变现有行为**：今天子 agent 拿到的是"项目默认"（提案 §1.2、证据 §6）；上线必须在 README/CHANGELOG 明示，并提供「不继承」一键回退。
3. 已运行的 child 不因策略切换被重算（toast 说明）；继承基线 = **直接父 agent 的生效集合**，UI 不承诺"等于本会话"。
4. 与 Jev 正交：auto 只在父级已启用范围内收窄（`∩ snapshot`），永不扩权；本版 UI 不承诺 workflow / ralph 的逐 child 自动选择。
5. 策略持久化位置（提案 §4.2）：`session-capabilities.json` 会话记录的 `agentPolicy` / `derivedAgents`（additive）；**读顺序**：会话记录 > 项目 `agent-inheritance.json` > 全局 defaults > 代码默认。

**本批唯一必须为它预留的接口约束（写进实现要点的"禁止事项"）**：

- `src/tools/manager.ts` 的"应用副作用"（restrict 计算 + deny 列表）必须抽成**纯函数 + 按 agent 作用域执行**的形式：`applyForAgent(agent, sessionId, toggles)`，由 `agent/created` 监听调用，内部不得假设自己只被"会话创建者"调用。R2 实施时，child 侧就是再调一次同一个函数（提案 §5.1 的做法），无需改 Tools 域。
- `session-capabilities.json` 的 `tools` 域必须挂在**记录级**（`sessions.<id>.tools`），不允许做成全局单例——否则 R2 的 child 继承无法按会话投影。
- 不得在 `tools.list` 的语义里写入"继承/派生"概念（留给 R2 的新端点）。

R2 的实现任务在第一批完成后另立（建议 Lead 建 `task-10`，`blocked_by` = 第一批合并）。

---

## 2. 域边界：MCP vs Tools（两域互斥）

### 2.1 判定规则（唯一事实源，按顺序短路）

| 顺序 | 条件 | 归属 | 说明 |
|---|---|---|---|
| 1 | 工具名以 `mcp__` 开头且可解析为 `mcp__<ns>__<tool>`（`parseMcpToolName`，`src/mcp/usage.ts:57-66`） | **MCP 域** | 无论背后是 mcp-client 实例、插件自注册命名空间，还是未知来源；一律不在 Tools 出现 |
| 2 | 名字命中宿主内建清单（§4.3） | **不入域** | 宿主内建基础工具，不能按会话关闭（证据 §3.2 #5），连"只读行"都不给（UX §3.2/§5.4） |
| 3 | 命中插件归属映射表（§4.2） | **Tools 域**（插件单元） | 一个插件一个单元 |
| 4 | 其余（非 mcp、非内建、无映射） | **Tools 域 · `来源未识别` 单元** | 不猜成宿主内建（UX §5.4、证据 §2.4） |

- **互斥性**：规则 1 在规则 3/4 之前，所以 `mcp__figma__*` **永不出现在 Tools 域**；`univer_*`/`rw_*`/`dsh_im_*` 等**永不进入 MCP 域**。
- 同一插件若同时注册 `mcp__<ns>__*` 与非 mcp 工具（当前本机无实例，属未来情况）：MCP 域出现一条命名空间行、Tools 域出现一个插件单元，两行的开关互不影响（MCP 行 deny 该命名空间全部工具；Tools 行 deny 该插件非 mcp 工具）。这是**预期**行为，不是重复。
- 已知本机实例（证据 §2.2、本会话真实工具清单核对；UX v1.8 §5.2 的 6 张 Tools 示例卡 = 下表 6 个已识别插件，无未识别卡）：

| 工具名（实读） | 归属 |
|---|---|
| `mcp__figma__*`（17 个） | MCP（命名空间合成来源 → `dsh-to-figma`） |
| `mcp__AnySearch__*` / `mcp__context7__*` / `mcp__tavily__*` / `mcp__playwright__*` / `mcp__deepwiki__*` / `mcp__open-computer-use__*` / `mcp__Parallel-Search__*` / `mcp__jev-browser-chrome__*` | MCP（配置文件 server，本插件自己挂载） |
| `univer_*`（`univer`/`univer_new`/`univer_import`/`univer_inspect`/`univer_execute`/`univer_export`/`univer_screenshot`/`univer_api`/`univer_resources`/`univer_compile_svg`/`univer_lint`/`univer_print_pdf`/`univer_worktree`） | Tools → `dsh-univer-office` |
| `rw_*`（`rw_connect`/`rw_machines`/`rw_pick_workspace`/`rw_list_dir`/`rw_read_file`/`rw_edit`/`rw_push`…） | Tools → `dsh-remote` |
| `dsh_im_*`（`dsh_im_context`/`dsh_im_files`/`dsh_im_group_file`/`dsh_im_group_history`/`dsh_im_reply_to`/`dsh_im_return_file`/`dsh_im_source`/`dsh_im_source_guidance`） | Tools → `@xmanrui/dsh-im`（展示名 `dsh-im`） |
| `sidebar_open` | Tools → `dsh-better-sidebar` |
| `open_in_popout` | Tools → `dsh-popout-window` |
| `dsh-diff-approval-annotate` | Tools → `dsh-diff-approval` |
| `bash`/`read`/`write`/`edit`/`glob`/`grep`/`web_search`/`web_fetch`/`skill`/`todo_write`/`present`/`subagent`/`workflow`/`ralph`/`create_goal`/… | 排除（宿主内建） |

### 2.2 枚举来源与作用域

- **唯一枚举源**：`ctx.root.get("tools").schemas()`（全局视图）。与现实现一致：`src/mcp/loader.ts:494-512` 的 `globalToolNames` 用同一取数口径；`src/index.ts:248-266` 的 `mcpTools` 同源。
- 为什么必须用 root/全局视图：`restrict` 的契约是"只能屏蔽**继承层**（global + 祖先层）"，而 agent 自身层注册的工具 **不可** restrict（证据 §3.1、§3.2 #1/#2）。全局视图天然 = 可继承层，既是枚举源也是开关前提。
- **因此"注册在 agent 自身层的插件工具"不会出现在 Tools 域**：它们是"枚举不到 → 不显示"，不是"显示但置灰"。这与 UX §5.4「无法 restrict 的插件开关置灰」**不完全一致**，属于本批的**规格修正**（见 §11-R5、§10.4 TU-11 的走查改法）。
- 作用域/继承语义：Tools 域**无项目 / 工作区维度**（UX v1.8 §2.4 域边界 / §2.5 Tools 页 / §5.3）。全局工具注册与项目无关。**开关有两层但不含项目维度**：能力面板 = 全局默认；会话首屏/「能力」Tab = 本会话覆盖（A11）。`tools.list` 因此不需要 `cwd`。
- 工具集变化：监听 `tools/change`（loader `:593-602` 同款）→ 微任务合并 → 重算（新增/消失的插件单元、deny 名单变化）。
- `schemas()` 调用失败/服务缺失（headless/旧外壳）：`tools.list` 返回 `{units:[],errors:[...]}`，面板显示空态 + 说明；**不阻断**其它两域。

### 2.3 与 R2 的关系（一句话）

R2 的"三域整体继承"要求 Tools 域可以被**重复应用**到任意 agent 作用域；本方案的 `applyForAgent` 抽取（§1.4）已为此预留，但**本批不实现**继承本身。

---

## 3. 数据与持久化

### 3.1 `session-capabilities.json` 新域 `tools`

文件位置与封装**不变**（`src/session-state.ts:73-80`；目录 0700 / 文件 0600、原子写 + 文件锁）：

```jsonc
{
  "version": 1,
  "sessions": {
    "<sessionId>": {
      "updatedAt": 1761328800000,
      "headerCreatedAt": 1761000000000,
      "cwd": "/path/to/project",
      "skills": { "figma-workbench": false },
      "mcp": { "project:github": false, "server:figma": true },
      // 新增（additive，version 不变）
      "tools": {
        "plugin:dsh-univer-office": false,
        "plugin:dsh-remote": true,
        "plugin:__unattributed__": false
      }
    }
  }
}
```

**键规范**（`tools` 域的键 = "开关单元 id"，写入端负责规范化，读取端宽松）：

| 单元 | key | 备注 |
|---|---|---|
| 已识别插件 | `plugin:<unit>` | `unit` = 展示名（§4.2 的 `display`），例：`plugin:dsh-to-figma` |
| 来源未识别 | `plugin:__unattributed__` | 固定常量，双下划线避免与插件名冲突（插件名不含 `__` 前缀惯例） |
| 未来 per-tool 覆盖 | `tool:<fullToolName>` | **本批不写**，只留前缀；读取端忽略未知前缀，避免旧版把新键当真 |

**语义**：

- 本文件的 `tools` 域 = **会话覆盖层**（不是生效值）：值 `false` = 本会话显式关闭；值 `true` = 本会话显式开启（可压过全局默认关闭，见 §5.3）；**键缺失 = 跟随全局默认**（`tools-global.json`，§3.3）。生效值不落盘，读取时用 `effective = 覆盖 ?? !globalDisabled` 计算（`src/tools/manager.ts:292-300`）。
- 与 skills / mcp 域**完全独立**：同一会话记录里三个字段各写各的；任何一个域的读写失败都不影响其它域（复用现有 `writeSnapshot`：锁内读盘合并，只覆盖本进程改过的会话，`src/session-state.ts:317-345`）。
- 读路径健壮性不变：文件缺失/损坏/版本不认识 → 空表 + warn（`:266-274`）；`sanitizeEntry` 只收 boolean 值（`:191-198`），未知字段忽略（旧版插件读本文件会忽略 `tools`——降级语义见 §11-R8）。

**存储层新增 API（additive，`src/session-state.ts`）**：

```ts
export interface SessionStateStore {
  // …现有成员不变…
  /** 某会话的 Tools 开关（同步；调用方先 await ready()）。 */
  tools(sessionId: string): Readonly<Record<string, boolean>>;
  /** 写/清除一个 Tools 开关（enabled === undefined = 清除）。 */
  setTool(sessionId: string, unitKey: string, enabled: boolean | undefined, meta?: SessionStateMeta): Promise<void>;
  /**
   * 批量写/清除同一域的多个键（一次落盘）。
   * 供 R1 批量端点与 MCP 批量写使用；domain 只允许 "skills" | "mcp" | "tools"。
   * 空表 = 不改（不是"清空全部"）。
   */
  setToggles(
    sessionId: string,
    domain: "skills" | "mcp" | "tools",
    entries: Readonly<Record<string, boolean | undefined>>,
    meta?: SessionStateMeta,
  ): Promise<void>;
}
```

**必须同步修改的内部函数**（否则新域会被静默丢弃，这是本批最容易漏的回归点）：

| 函数 | 位置 | 改动 |
|---|---|---|
| `SessionStateEntry` | `:91-104` | 加 `tools?: Record<string, boolean>` |
| `sanitizeEntry` | `:201-215` | 加 `tools = sanitizeToggles(source.tools)`；"完全空记录"判定加 `tools` |
| `isEmptyEntry` | `:232-236` | 加 `Object.keys(entry.tools ?? {}).length === 0` |
| `writeToggle` | `:294-314` | `field` 联合加 `"tools"` |
| 新增 `setToggles` / `setTool` | 新增 | 内部合并到 `writeToggle` 语义后**一次** `persist()` |

> **写盘次数**：现状 `setSkill` / `setMcp` 每条都 `await persist()`（`:388-398`）。R1 一次要写 ~150 条 → 必须用 `setToggles` 批量一次落盘，否则 150 次"读盘-合并-原子写"会明显卡顿（[待验证]：真机量一次批量耗时；降级 = 接受更慢，但不能退回前端逐条 RPC）。

### 3.2 内存态（宿主运行时；实现现状）

沿用 MCP loader 的"内存权威 + 懒 hydrate"模型（`src/mcp/loader.ts:244-260, 298-319`），另加**全局默认镜像**：

- `src/tools/manager.ts` 内部状态（`:395-409`）：
  - `sessionToggles: Map<sessionId, Map<"plugin:<unit>", boolean>>`（会话覆盖，写穿到 `session-capabilities.json`）；
  - `hydratedSessions: Set<sessionId>`（每会话只 hydrate 一次）；
  - `globalDisabled: Set<unit>`（`tools-global.json` 的内存镜像）+ `globalHydrated`；
  - `sessions: Map<sessionId, ToolsSessionRecord>`（agent + targets + restrictDisposers + appliedDeny + restrictions + queue）。
- `hydrateGlobal()`（`:432-455`）：首次使用前 `store.ready()` → 复制 `store.disabled()`；读失败 → 空集合 + warn（按"全部启用"降级，不阻断）。
- `hydrateToggles(sessionId, meta)`（`:463-479`）：先 `state.ready()` → `verifySession(...)`（防 sessionId 复用）→ 只补内存没有的键（同运行内刚改的不被磁盘旧值覆盖）。
- `agent/created` → `mountAgent` → `scheduleRefresh`（先 hydrate 全局+会话覆盖，再按 effective 应用 restrict）；插件加载时对 `ctx.get("agents").list()` 的存量 agent 补挂（`:594-635`；resume 场景必须补）。
- `agent/disposed`：只清内存（记录 / 覆盖 / hydrate 标记），**不清磁盘**。
- `tools/change` → `scheduleRefreshAll`（`:551-571`）：**重算前必须先 `hydrateGlobal()`**——用空集合重算会把"全局默认关闭"的 deny 误释放（代码注释原话）。
- 全局默认变化 → `scheduleGlobalFanout`（`:573-592`）：微任务里对每个 live agent 调 `scheduleRefresh`（各自串行队列），fire-and-forget。

### 3.3 全局默认存储 `tools-global.json`（A11；**A3 SUPERSEDED**）

> **A3 已 SUPERSEDED**：「Tools 只有会话级开关 / 不做任何默认层」被用户澄清推翻。**结论仍保留的部分**：不改 `capability-overrides.json`（overrides 继续只服务 Skills/MCP 的项目维度）。新增的是**独立的全局默认层**，不带 workspace 维度。

**文件契约**（`src/tools/global-state.ts`）：

- 路径：`<dshHome>/dsh-capability-settings/tools-global.json`（与 `session-capabilities.json` / `jev.json` 同目录；目录 0700 / 文件 0600；`shared/atomic-write.ts` + `shared/file-lock.ts`）。
- 形状：`{ "version": 1, "disabled": ["<unit>", …] }`。`disabled` = **全局默认关闭**的单元 id 列表；缺省空表 = 全部启用。`version` 不认识 → 整份忽略 + warn（按全部启用降级），不猜测迁移。
- 写入 `setEnabled(units, enabled)`（`:185-229`）：`enabled=false` 加入、`true` 移出；**幂等**（无变化 `applied:0` 且不写盘、不刷 mtime）；锁内重读磁盘合并其它写者（多标签页）；写失败 → `warn` + `{ok:false,errors}`，内存镜像仍生效（本次运行内）。
- 读：`ready()` 懒加载；`disabled()` 返回副本。**stale unit（插件已卸载/改名）读取时忽略、不主动删**（用户数据不清理，懒清理留后续任务，见 §3.4）。
- 组合根单例（`src/index.ts:143`），`tools` manager 与 `tools.list` 共用；`dispose()` 随插件卸载。

**为什么不复用 `capability-overrides.json`**（A3 的原始理由仍成立，只是不再推出"没有默认层"）：

1. overrides 的粒度是**项目根**，而 Tools 明确"不区分项目 / 工作区"（UX v1.8 §2.4/§2.5）；挂项目维度会造出"同一插件在不同项目默认不同"。
2. 三层优先级（会话覆盖 > 项目默认 > 插件安装态）会让「恢复默认」语义歧义；全局默认层只有两层，`reset` 定义干净。
3. 复用 overrides 需要新增 `projects.<root>.tools` 的投影与热应用；独立文件更小、风险更低。

→ **A11**：两层语义 = 全局默认（本文件）+ 会话覆盖（§3.1）；`effective = 覆盖 ?? !disabled`；无 workspace 维度。

### 3.4 与会话对账 / 懒清理的关系（实现现状）

- `tools` 字段不参与新的对账维度：整个会话记录仍按"存在性 + 24h 宽限"清理（`src/session-state-reconcile.ts:1-22`），Tools 会话覆盖随记录一起生灭。
- **会话键**：插件卸载后 `tools.list` 不再产出该单元，旧键保留无害（不命中）；**不主动删**。
- **全局默认文件**：`tools-global.json` 的 `disabled` 里可能有已卸载插件的历史 unit；读取端只在**当前枚举出的 unit** 上匹配（`computeTargets` 只遍历枚举结果，`src/tools/manager.ts:308-322`），stale unit 自然忽略；**不主动删用户数据**（任务明确要求）。后续若要清理，另立"全局默认懒清理"任务（建议：连续 N 次启动都未命中才移除，仍需用户确认口径）。

---

## 4. 归属启发式（插件 → 工具映射）

### 4.1 共享模块（已实现：`src/shared/plugin-attribution.ts`）

**单一事实源**，Tools 域与 MCP R4 共用（避免两套映射表漂移；先例：`src/skills/registry.ts:211-227` 的 `KNOWN_PLUGIN_SOURCES` / `KNOWN_RUNTIME_NAME_PREFIXES` / `RUNTIME_CHANNEL`）。

```ts
export interface ToolRule {
  /** 匹配方式 */
  match: "exact" | "prefix";
  /** 精确名 或 前缀（含分隔符，如 "univer_" / "dsh-diff-approval"） */
  pattern: string;
  /** 展示名（= Tools 单元 id 与卡片标题；与 Skills 的 channel 同口径） */
  display: string;
  /** npm 包名（详情「来源判定」文案 / 诊断用） */
  packageName?: string;
}
export const TOOL_RULES: readonly ToolRule[];         // §4.2
export const MCP_NAMESPACE_RULES: readonly {          // §7.2
  namespace: string; display: string; packageName?: string;
}[];
/**
 * fiber/loader 的 source（插件 runtime 名或 loader 条目 id）→ 展示名。
 * 命中映射表 → 映射后的展示名；未命中 → **原样返回**（source 本身就是可读标识，
 * 可能形如 `dsh-figma` 或条目 id `mcp-figma`；详情「来源判定」会写明它是哪种）。
 */
export function displayNameOfSource(source: string): string;
/** 工具名归属；未命中返回 undefined（调用方归入"来源未识别"） */
export function attributeTool(name: string): ToolRule | undefined;
export function attributeMcpNamespace(ns: string): { display: string; packageName?: string } | undefined;
/** 宿主内建工具判定（§4.3） */
export function isHostBuiltinTool(name: string): boolean;
```

**匹配顺序**：`exact` 优先于 `prefix`；同层取**最长前缀**；分隔符边界（前缀必须以 `_`/`-` 结尾，或与名字全等），避免 `rw_` 误伤未来 `rwx_*`。

### 4.2 内置映射表（第一批必须覆盖；新增插件只需追加此表）

| 匹配 | 模式 | 展示名（unit） | 包名 | 证据 |
|---|---|---|---|---|
| prefix | `univer_` | `dsh-univer-office` | `dsh-univer-office` | 证据 §2.2 |
| prefix | `rw_` | `dsh-remote` | `dsh-remote` | 证据 §2.2 |
| prefix | `dsh_im_` | `dsh-im` | `@xmanrui/dsh-im` | 证据 §2.2；UX §5.2 卡片示例用 `dsh-im` |
| exact | `sidebar_open` | `dsh-better-sidebar` | `dsh-better-sidebar` | 证据 §2.2 |
| exact | `open_in_popout` | `dsh-popout-window` | `@local/dsh-popout-window` | 证据 §2.2 |
| exact | `dsh-diff-approval-annotate` | `dsh-diff-approval` | `dsh-diff-approval` | 证据 §2.2 |
| prefix | `dsh-diff-approval` | `dsh-diff-approval` | 同上 | 防御性前缀（未来多工具） |

**MCP 命名空间映射表**（R4 用，§7.2）：

| 命名空间 | 展示名 | 包名 | 证据 |
|---|---|---|---|
| `figma` | `dsh-to-figma` | `dsh-to-figma`（插件内部 `name='dsh-figma'`，展示名用 Skills 侧同款 `dsh-to-figma`，`src/skills/registry.ts:510`） | 证据 §2.2、§4.3 |

**source → 展示名**（R4 的 mcp-client 实例来源归一）：

| source（fiber name / entry id） | 展示名 |
|---|---|
| `dsh-figma` / `dsh-to-figma` | `dsh-to-figma` |
| `dsh-univer-office` / `dsh-remote` / `dsh-better-sidebar` / `dsh-diff-approval` | 同名 |
| 其它 | 原样返回（不猜） |

> 展示名一旦进入持久化键（`plugin:<unit>`），**改名 = 丢失旧会话状态**（回落到默认开启）。本批冻结上表；未来改名需在 CHANGELOG 标注并考虑映射迁移（见 §11-R9）。

### 4.3 宿主内建工具排除清单（必须自维护）

宿主**不提供**任何"来源/危险等级"标注（证据 §2.2 三层理由、§3.2 #5、§9-4），所以排除清单只能由本插件维护；**这是版本敏感项**，每次升级宿主（当前 0.2.1-rc.3，证据 §0）都要复核。

清单（来自证据 §2.2 的实读名单，按"精确 + 前缀"两段）：

| 类型 | 内容 |
|---|---|
| 精确 | `bash` `pwsh` `read` `write` `edit` `read_image` `glob` `grep` `str_replace_editor` `web_search` `web_fetch` `skill` `todo_write` `present` `create_goal` `get_goal` `update_goal` `ralph` `load_workspace_dependencies` `working_directory` `ask_user_question` `list_subagent_models` `cordis_inspect_list` `cordis_inspect_query` `interrupt_agent` `send_message` `list_agents` `wait_agent` `spawn_teammate` `subagent` `subagent_fork` `workflow` `run_code` |
| 前缀 | `job_`（4 个）`schedule_`（4 个）`session_`（5 个）`terminal_`（6 个）`team_task_`（团队任务板）`cordis_inspect_`（兜底） |

- `run_code` 必须同时出现在排除清单与 deny 前置断言里：`restrict({deny:[...]})` 若含 `run_code` **直接抛错**（证据 §3.1 第 3 条、宿主 `dsh-tools:2999`），所以任何 Tools deny 名单在提交前都要过滤 `run_code`（防御性，正常不会命中）。
- 排除清单**不进 UI**（不列"宿主工具"分组），只用于"不把内建工具当插件工具"。
- 维护机制：`tools.list` 返回 `excludedBuiltinCount`（诊断）；单测加一条"金丝雀"断言：证据 §2.2 名单里的每个名字都**不得**出现在 `tools.list` 的任何 unit 里（§10 TH-03）。宿主升级后新增的内建工具若未进清单，会落进 `来源未识别` 单元 → 触发 A4 的拍板问题（这也是 A4 需要保守选项的原因）。

### 4.4 未识别策略（A4；已实现：可开关 / 计分母 / 不进 Jev 候选）

**推荐（默认）**：

- 所有"非 mcp、非内建、无映射"的工具合并为**一个**单元：`unit = "__unattributed__"`，展示名 `来源未识别`，标签 `未识别`（琥珀；UX v1.8 §5.4 保留该分组，但 §5.2 的 6 张示例卡已改为**全部已知插件**，无未识别卡 → 该单元只在真机出现未知工具时生成，是第 7 个单元）。
- 该单元**可开关**（技术上全部来自全局视图 → 可 restrict），**计入** hero/控制条的"可开关单元"分母（示例 6；出现未知工具时变 7），参与 R1 批量。
- 该单元**不进入 Jev 候选**（§8.2）：无法给出有意义的插件描述，且可能混入未来宿主内建工具，让模型去"推荐关闭"风险高。
- 开关文案与 tooltip（新增，UX 未定义，frontend 直接用）：
  - 关闭影响：`关闭后本会话模型看不到这 N 个工具；它们未能识别来源，可能包含宿主内建工具，关闭前请确认`
  - 卡片描述：`N 个工具 · 来源未识别`

**实现现状**：推荐方案已落地（`unit="__unattributed__"`、可开关、计入分母、Jev 枚举显式跳过，`src/jev/apply.ts:388`）。**备选（更保守，未采纳，需产品再定）**：该单元只读（`lockedReason`），代价是 UX §3.3 的 `30/30`（S1）与 `0/30`（S3/帧 04）永远不可达。

**判定依据不足时的行为**：[待验证] 真机上 `ctx.get("tools").schemas()` 的准确条数/名单（证据 §10 #1 仍未取到）。验证方式：实现 `tools.list` 后，在 `web` profile 里调用一次并落 `notes/verify/out-tools-enumeration.json`，人工核对"每个非 mcp 工具都被 rules 或 builtin 清单覆盖"；若有遗漏 → 按"来源未识别"处理并评估补映射。

---

## 5. Tools 域开关实现（插件级；两层语义，实现现状）

> 本节已按实现重写。`A3/A5 → SUPERSEDED`；新决定见 §0.1 的 **A11/A12/A13/A15**。

### 5.1 宿主服务形状（`ctx.capabilityPanel.tools`；`src/tools/types.ts`）

```ts
export const UNATTRIBUTED_UNIT = "__unattributed__";       // 未识别单元 id
export const UNATTRIBUTED_DISPLAY = "来源未识别";
export const PLUGIN_UNIT_KEY_PREFIX = "plugin:";           // 持久化键前缀
export function unitKeyOf(unit: string): string;           // unit → "plugin:<unit>"
export function unitOfKey(key: string): string | undefined; // 只认 plugin: 前缀

export interface HostToolBrief {
  /** 完整工具名（restrict 用；UI 只读展示） */
  name: string;
  /** 一句话说明（**截断到 200 码点**；`tools.list` 轻量契约） */
  description?: string;
}

export interface ToolsUnitView {
  unit: string;                        // 裸 unit（未识别 = "__unattributed__"）
  name: string;                        // 展示名
  kind: "plugin" | "unattributed";
  tools: HostToolBrief[];              // 当前可见工具（**无 parameters**）
  toolCount: number;
  attribution: {
    matchedBy: "prefix" | "exact" | "unknown";
    pattern?: string;
    packageName?: string;
  };
  /** 全局默认（能力面板开关 / `tools-global.json`；恒下发） */
  defaultEnabled: boolean;
  /** 本会话生效值 = 会话覆盖 ?? 全局默认（恒下发；推荐客户端用这个） */
  enabled: boolean;
  /** **legacy 等名**：恒等于 `enabled`（保留只为旧客户端/Jev 兼容） */
  enabledInSession: boolean;
  /** 是否有显式会话覆盖（「恢复默认」是否可点 / 诊断） */
  explicit: boolean;
  /** 不可开关原因（agent 作用域缺少 restrict 时由 list 提前给出） */
  lockedReason?: string;
  /** 上一次 restrict 的降级状态（仅传 sessionId 时） */
  restriction?: { state: "applied" | "skipped" | "failed"; error?: string };
}

export interface ToolsListView {
  units: ToolsUnitView[];
  totalGlobalTools: number;
  excludedBuiltinCount: number;
  errors: string[];
  sessionId?: string;
}
```

**读投影规则**（`src/tools/manager.ts:637-683`）：

- 传 `sessionId`：先 hydrate 全局 + 会话覆盖 → `defaultEnabled = !globalDisabled.has(unit)`、`enabled = 覆盖 ?? defaultEnabled`。
- **不传 `sessionId`**（能力面板调用）：`enabled = defaultEnabled`、`explicit = false`、`restriction` 缺省 —— 面板视图只投影全局态，**不伪造会话开关**（写全局默认走 `setGlobalEnabled`）。
- `lockedReason`：该会话有记录且 `agent.ctx.get("tools").restrict` 缺失时，由 `list` 直接给出（开关一开始就置灰，不等点了才失败）。
- 空注册表 / `schemas()` 抛错 / 服务缺失 → `units:[]` + `errors`，**不抛**、不阻断其它域。

**写会话覆盖**（batch-first；单条 = 长度 1 的数组）：

```ts
export interface ToolsSetSessionInput {
  sessionId: string;
  units: string[];                 // 只接受当前枚举出的 unit id（宿主重算工具名）
  enabled: boolean | undefined;    // true=写覆盖开；false=写覆盖关；undefined=清除覆盖
}
export type ToolsSetSessionResult = { ok: true; applied: number } | { ok: false; errors: string[] };
```

**写全局默认**（能力面板；`tools-global.json`）：

```ts
export interface ToolsSetGlobalInput {
  units: string[];                 // 兼容裸 unit 与 "plugin:<unit>" 两种写法
  enabled: boolean;                // true=移出 disabled；false=加入 disabled
}
export type ToolsSetGlobalResult = { ok: true; applied: number } | { ok: false; errors: string[] };
```

行为（`manager.ts:794-822`）：只接受当前枚举出的 unit；写成功后刷新内存镜像并 **异步扇出** 所有 live agent（不等重算完成）；写盘失败返回 `{ok:false,errors}`（内存镜像仍生效）。

**懒加载工具 schema**（A13）：

```ts
export interface ToolsInspectInput {
  sessionId?: string;   // 目前仅入参兼容，不参与枚举（保留给未来按会话裁剪）
  unit: string;         // 裸 unit 或 "plugin:<unit>"
}
export interface ToolsInspectedTool {
  name: string;
  description?: string;                        // **完整**说明（不截断）
  parameters?: Record<string, unknown>;        // 原始 JSON Schema（原样透传）
}
export interface ToolsInspectView { unit: string; tools: ToolsInspectedTool[] }
// 成功 = ToolsInspectView（**无 ok 字段**）；业务失败 = { ok: false, errors }
```

- 懒加载理由：`tools.list` 每个会话首屏都拉，必须轻量；`parameters` 只在详情打开时按 unit 取（`src/client/tools-panel.tsx:214-232` 懒加载并按 unit 缓存）。
- `inspect` 复用 `tools.list` 的同一枚举（同一归属/边界口径），完整 description 与原始 `parameters` 在同一次 `schemas()` 扫描里顺带收集；**不裁剪 schema**（用户要求可看原始 JSON），只在输出 > **1 MiB** 时 warn（`TOOL_INSPECT_WARN_BYTES`，`manager.ts:68,712-723`），从不裁剪。
- unit 未知 / 枚举失败 → `{ok:false, errors}`；`sessionId` 目前不参与（文档写清，避免客户端误以为按会话裁剪）。

### 5.2 关闭 = 插件级 `tools.restrict({deny})`（按 effective）

**目标与名单**（`src/tools/manager.ts:302-322` + `src/tools/restrict.ts`）：

```
targets = { 所有 effective=false 的单元 }      // 不区分"会话关"还是"全局默认关"
deny    = ∪ unit.tools[].name
           − 非当前全局视图名字                 // restrict 只接受这些名字
           − isRestrictForbiddenToolName(name)  // run_code 等（防御）
```

- `effective=false` 来自**两层组合**：会话覆盖 `false`，或（无覆盖时）全局默认关闭。派生/继承（R2）以后复用同一纯函数 `computeTargets`。
- 名字必须来自**当前全局视图**：`restrict` 对未知/scope-local 名字直接抛错（证据 §3.1 第 3 条）；因此 deny 每次重算、**持久化只存 unit id，不存工具名**（插件升级增减工具后自动跟随）。
- 空名单 → **不调用** restrict（空 filter 抛错），状态 `skipped` + `TOOLS_RESTRICT_NO_TOOLS`。
- 名单与上一代等价 → 直接返回（幂等短路；`tools.restrict` 自身触发 `tools/change`，这条短路是刷新不形成循环的关键）。
- 失败 → `state:"failed"` + warn（每会话只告警一次）；**不影响**其它开关与 UI。
- 释放：`releaseRestrictions` 先 dispose 全部旧 disposer 再提交新名单；插件卸载时 `dispose()` 也会 best-effort 释放（避免"插件已卸载、工具仍被隐藏"的 ghost restrict）。

**必须由 agent.ctx 调用**：`record.agent.ctx.get("tools").restrict(...)`（无 scoped ctx 抛 "requires a scoped context"）。缺失 `restrict` → `skipped` + `lockedReason`（见 §5.5）。

**记录结构**（`src/tools/manager.ts:100-112`）：

```ts
interface ToolsSessionRecord {
  agent: any;
  cwd?: string;
  /** 本代 effective=false 的单元（重算/日志用） */
  targets: Array<{ unit: string; name: string }>;
  restrictDisposers: Array<() => void>;
  appliedDeny: string[];
  restrictions: Array<{ unit: string; state: "applied" | "skipped" | "failed"; error?: string }>;
  queue: Promise<void>;          // 串行化本 session 的重算
  restrictWarned?: boolean;      // 降级 warning 只打一次
}
```

**R2 复用点**（已按实现落成）：`applyForAgent(agent, sessionId, toggles, { globalTools?, logger?, globallyDisabled? })`（`manager.ts:357-375`）——纯函数式、只通过 `agent.ctx` 施加 restrict，不依赖本模块会话记录；`globallyDisabled` 由调用方投影（R2 的 child 侧只需再调一次）。**本批不调用它实现继承**。

### 5.3 写入语义（两层；`enabled` 三种取值）

| 输入 | 宿主行为 | 存储 |
|---|---|---|
| `false` | 当前 effective 已 false → 幂等跳过；否则写会话覆盖 `false` → 重算 deny | `state.setTool(sessionId, "plugin:<unit>", false)` |
| `true` | 当前 effective 已 true → 幂等跳过；否则写会话覆盖 `true`（**可压过全局默认关闭**）→ 重算 | `state.setTool(..., true)` |
| `undefined` | 无显式覆盖 → 跳过；否则清除覆盖（回落到全局默认）→ 重算 | `setTool(..., undefined)` |

- **面板写全局默认**：`tools.setGlobalEnabled({units, enabled})` → `tools-global.json`（不写会话覆盖）。所以"全局关闭 + 单会话开启"是合法组合（`enabled=true`、`defaultEnabled=false`、`explicit=true`）。
- **首屏 / 会话「能力」Tab 只写会话覆盖**：rail 的 `全部开启/全部关闭` 走 `session.setBulk`（tools 域内部调 `setSessionEnabled`，`src/session-bulk.ts:370-422`）；**不触碰全局默认**。
- **「恢复默认」**：`session.setBulk({action:"reset"})` → 对 `explicit===true` 的单元写 `enabled:undefined`（清覆盖）→ 回落到全局默认（可能仍是关闭）。
- `applied` = 真正改变了 `enabled`（effective）的单元数；"清除"只有 `undefined` 一条路径。
- 落盘：一次 `state.setToggles(sessionId,"tools",writes)`（批量、一次写盘）；失败只 warn（本次运行内仍生效，不向 RPC 抛）。

### 5.4 生效、扇出与 MCP restrict 的协同（A6/A12）

- **同一 agent 两条独立 restrict**：MCP loader（`mcp__*`）+ Tools（非 mcp 插件工具）。契约是 **restrictions intersect**（`src/mcp/loader.ts:31-36`），互不干扰，各自 disposer 只释放自己那条。不得合并成一条（合并后任一方重算都要动另一方名单，易在 `tools/change` 里互相触发）。
- **重算触发**（实现现状）：
  1. `agent/created` → `mountAgent` → `scheduleRefresh`（hydrate 全局+会话 → 按 effective 应用）；
  2. `tools.setSessionEnabled` → 该 agent `scheduleRefresh`（串行队列）；
  3. `tools.setGlobalEnabled` → 刷新内存镜像 → `scheduleGlobalFanout`：微任务里对**所有 live agent** 逐个 `scheduleRefresh`（fire-and-forget，写 RPC 不等重算；`tools.list` 读内存镜像即时反映新默认）；
  4. `tools/change`（工具注册/注销/restriction 变化）→ 微任务合并 → **先 `hydrateGlobal()` 再重算**所有有记录的 agent（用空集合重算会误释放全局关闭的 deny）；
  5. `agent/disposed` → 清内存记录（磁盘保留）。
- **边界**：两域名单互斥（`mcp__*` 不属 Tools），交集语义仍是"关"，无需额外仲裁。
- **一致性窗口**：全局默认写入返回后，live agent 的 restrict 可能在微任务/队列里稍后收敛（与 mcp loader 的"写入不等重挂"同款）；面板靠内存镜像立即正确，模型侧下一轮工具视图收敛。

### 5.5 不可 restrict / 降级矩阵（实现现状）

| 情形 | 表现 | 依据 |
|---|---|---|
| 旧外壳无 `tools.restrict` | `tools.list({sessionId})` 提前给 `lockedReason`（开关置灰）；运行中失败则 `restriction.state="skipped"` | `manager.ts:646-650`；`restrict.ts:76-91` |
| deny 名单为空（工具全部注销） | `skipped` + `TOOLS_RESTRICT_NO_TOOLS`，开关显示"已关闭"但无副作用 | 契约（空 filter 抛错） |
| restrict 抛错 | `failed` + 每会话一次 warn；UI 保留状态、tooltip 带 error 摘要 | 降级不阻断 |
| agent 自身层工具 | **不出现**在 Tools 域（枚举不到），无置灰行 | §2.2；与 UX §5.4 的差异见 §11-R5 |
| `run_code` | 永不出现在 deny 名单（内建排除清单 + `isRestrictForbiddenToolName` 二次过滤） | 宿主 `dsh-tools:2999` |
| 全局默认文件损坏 / 版本不认识 | 按"全部启用"降级 + warn（不阻断任何域） | `src/tools/global-state.ts:151-160` |
| stale unit（已卸载插件） | 读取端忽略、**不主动删**用户数据（懒清理留后续） | `manager.ts:302-322`、`global-state.ts` 模块头 |

---

## 6. R1 批量端点（实现现状：`src/session-bulk.ts` 已落地）

> 本轮实现后语义补充：批量只写**会话层**。对 Tools 而言，`enable/disable` 写的是会话覆盖（可显式压过全局默认），`reset` 清覆盖后**回落到全局默认**（可能仍是关闭）。全局默认只能从能力面板 Tools 页改（`tools.setGlobalEnabled`，§5.3）。

### 6.1 端点契约

| 项 | 内容 |
|---|---|
| endpoint | `session.setBulk`（新） |
| 通道 | 现有 `/capability-panel`（`src/channel.ts` 唯一来源） |
| 信封 | 传输层恒 `{ok:true,value}`；业务失败 `value={ok:false,errors}`（`src/remote.ts:39-47`） |
| 幂等 | 是：同一 `action` 重放 = `applied:0` + `unchanged:N` |
| 并发 | 同一 session 的批量请求**串行化**（宿主队列）；不同 session 互不影响 |
| 兼容 | 现有单条 `skills.setSessionEnabled` / `mcp.setSessionEnabled` 全部保留不变 |

**入参**：

```ts
export interface SessionBulkInput {
  /** 必填；空 → 业务失败 */
  sessionId: string;
  /** 目标态：enable=全部打开；disable=全部关闭；reset=清除显式会话覆盖（回默认） */
  action: "enable" | "disable" | "reset";
  /** 缺省 = 三域全部；客户端按域串行调用以取得粗粒度进度 */
  domains?: Array<"skills" | "mcp" | "tools">;
  /** 项目作用域（skills 列表 / mcp 项目条目需要）；缺省由宿主从 session header.cwd 解析 */
  cwd?: string;
  /** 仅测试/诊断：只计算不写入，返回将改变的数量 */
  dryRun?: boolean;
}
```

**成功 value**：

```ts
export interface SessionBulkFailure {
  domain: "skills" | "mcp" | "tools";
  /** skills = skill 名；mcp = target（项目 key / serverName）；tools = unit id */
  target: string;
  /** 细分种类，便于 UI 只重试某类 */
  kind: "skill" | "mcp-project" | "mcp-server" | "plugin";
  error: string;
}
export interface SessionBulkResult {
  ok: true;
  action: "enable" | "disable" | "reset";
  /** 状态实际改变数（dryRun 时为"将要改变"数） */
  applied: number;
  /** 已是目标态、无需写入 */
  unchanged: number;
  /** 不可参与（locked / 非 live 的 skills / 无 deny 名单的插件） */
  skipped: number;
  /** 逐项失败（不阻断其它项） */
  failed: SessionBulkFailure[];
  byDomain: Record<"skills" | "mcp" | "tools", { changed: number; unchanged: number; skipped: number; failed: number }>;
  /** 非 live 会话里仍有写入只落盘的域（mcp/tools）时的提示位 */
  coldSession?: boolean;
  elapsedMs: number;
}
```

**业务失败**（`value.ok=false`）：`sessionId` 空/非字符串、`action` 非法、`domains` 含未知域名、`domains` 为空数组。

**不新增传输层错误码**：与现有约定一致（`src/remote.ts:28-38` 解释：插件的业务失败不能直出传输信封，否则客户端 zod 判非法）。

### 6.2 三域批量语义

| 域 | enable | disable | reset | 数据来源（宿主自己枚举，不信任客户端列表） |
|---|---|---|---|---|
| skills | 对 `enabledInSession !== true` 且可切换的行 `setSessionEnabled({enabled:true})` | 对 `enabledInSession !== false` 的行 `setSessionEnabled({enabled:false})` | 对**有显式覆盖**的名字 `setSessionEnabled({enabled:undefined})` | `skills.sessionList(cwd, sessionId)`（`src/skills/session.ts:621-657`）；显式名单取 `sessionState.entries()[sessionId].skills` 的键 |
| mcp | 对所有可开关单元写 `enabled:true` | 写 `enabled:false` | 对**有显式覆盖**的单元写 `enabled:undefined` | `mcp.list(cwd, sessionId)` + `mcp.runtime({cwd,sessionId})`（restrictable 的才参与）；显式名单取 `loader.sessionToggleState(sessionId)`（`src/mcp/loader.ts:800-804`） |
| tools | 对所有 effective=false 且非 locked 的单元写会话覆盖 `true`（**可显式开启全局默认关闭的单元**） | 对 effective=true 且非 locked 的单元写 `false` | 对 `explicit===true` 的单元 `enabled:undefined`（回全局默认） | `tools.list({sessionId})`（§5.1；`enabled`=effective、`explicit`=是否有覆盖）；宿主内 batch-first 一次写盘 + 一次 restrict 重算（`session-bulk.ts:370-422`） |

**细节点**：

0. 端点实现开始时必须先 `await state.ready()`（读盘完成），再读 `entries()` 拿显式覆盖名单；否则冷启动首批请求会误判"无显式覆盖"。
1. **skills 必须 live**：`setEnabled` 对冷会话返回 `session not found`（`src/skills/session.ts:666-670`）。冷会话时 skills 项记 `skipped`（reason 文案 `会话未激活，技能开关需在会话内设置`），mcp/tools 仍写着落盘（它们支持冷写），结果带 `coldSession:true`。
2. **"全部开启"对 mcp 项目条目 = 显式 true**（不是清覆盖）：项目默认可能被 overrides 关闭，清覆盖会让它回到"关"，与"全部开启"矛盾。对 mcp 的 `enabled:true` 必须走 `setSessionEnabled({kind,enabled:true})`（现有 loader 会用 `server:` / `project:` 键写 true，`src/mcp/loader.ts:790-795`）。
3. **不可开关项不参与**：`tools` 的 `lockedReason`、`mcp` 的 `restrictable===false`、skills 的 `canToggleInSession===false` → 计入 `skipped`，不产生失败。
4. **restrict 只重算一次**：tools 域必须在宿主内**批量写 toggles 后只调一次 apply**（`setSessionEnabled({units:[...]})` 已 batch-first）；mcp 域需要新增内部方法 `loader.setSessionEnabledMany(input: { sessionId: string; cwd?: string; entries: Array<{ target: string; kind: "project" | "server"; enabled: boolean | undefined }> })`：一次 hydrate → 写全部 toggle → **一次** `scheduleRemount(record)`（现状 `:796-797` 每条都触发重挂，150 条会排队 150 次）。skills 保持逐条（每条的 shadow 注册本来就必须逐条）。
5. **写盘批量化**：mcp/tools 用 §3.1 的 `state.setToggles(...)` 一次落盘；skills 沿用逐条 `setSkill`（每条一次落盘——与 Jev apply 现状一致，`src/jev/apply.ts:683-700` 证明 145 条同 tick 发起可接受；若 B-12 实测偏慢，再加 skills 侧批量入口，成本 +0.25d，见 §11-R12）。
6. **执行顺序**：`enable` 先写（打开优先，避免中途失败把会话留在"更差"的状态）；`disable` 逆序无关（同一 tick 批量）；`reset` 按域独立。域之间顺序：`skills → mcp → tools`（客户端串行调用时自然如此）。
7. **失败不回滚**（A7）：某条失败只进 `failed[]`，已成功的保留。理由：三域机制不同、回滚 150 条本身可能失败，且用户可见目标态与"部分关闭"是可理解的中间态（UX S5）；重试 = 重放同一 `action`（幂等，已成功项进 `unchanged`）。
8. **进度**：宿主一次性完成一个域（无流式进度）；客户端按域串行调用 3 次，得到"第几个域"级进度。UX S4 的"正在关闭 87 / 156…"逐条进度**作废**（那是逐条 RPC 时代的产物），UI 改为 `正在关闭…` + 域级进度（如 `正在关闭 2 / 3 个域…`），验收按 §10.4 TU-05 改。
9. **两层语义不混写**：`session.setBulk` 三域都**只碰会话层**；Tools 的全局默认变更必须走 `tools.setGlobalEnabled`。因此"全部开启"不会把全局默认打开，"全部关闭"也不会关全局默认——只影响当前会话，与 rail 文案 `仅当前会话 · 不改项目默认` 一致。

### 6.3 宿主实现落点

- 新模块 `src/session-bulk.ts`（**已实现**）：`createSessionBulk(deps)`，`deps = { skills, mcp, tools, state, ctx }`（组合根 `src/index.ts:276` 延迟构造，避免与 service 循环）。
- `remote.ts`：`PanelRpcService` 新增 `session: { setBulk(input: unknown): Promise<unknown> }`；`handleEndpoint` 加 `case "session.setBulk"`。
- 会话串行化：模块内 `Map<sessionId, Promise<unknown>>`（同 session 排队，先例 `src/mcp/loader.ts:708-713` 的 record.queue）。
- **并发上限**：端点级 = 每 session 1 个（宿主串行队列，重复调用排队而非拒绝）；域内 = skills 全部同 tick 发起（无额外限流，受事件循环约束）、mcp / tools 写入 ≤4（先例 `src/jev/apply.ts:147` 的 `MCP_WRITE_CONCURRENCY`）；域间 = 客户端串行调用（一次一个域）。
- 超时：不设额外超时（沿用通道与 HTTP 的既有行为）；`elapsedMs` 供排查。

### 6.4 客户端数据需求（R1 UI）

| 需求 | 数据来源 |
|---|---|
| 目标态按钮可用性（S1/S3） | 由三域 rows 的 `enabled` 聚合：全开 → 全部开启禁用；全关 → 全部关闭禁用 |
| 计数 `已启用 16 / 30` | `skills.length + mcpRows.length + toolRows.length` 为分母；`enabled` 数为分子（UX §3.5；未识别单元计入） |
| 执行中进度 | 本地状态：当前域序号 + 每域返回的 `changed` 数；不依赖宿主流 |
| 部分失败 | 合并三次响应的 `failed[]`；显示 `N 项失败 · 重试`；重试只重放**失败所在域**的同一 `action` |
| 乐观回显 | 开始时把该域所有可开关行 `pending=target`；响应后按 `failed[]` 回滚对应行（reset 不做乐观：回默认值未知） |
| 「恢复默认」 | `session.setBulk({action:"reset"})`；Tools 项只有 `explicit===true` 才参与，清覆盖后 UI 显示全局默认态 |

> 客户端**不**自己计算"要写哪些条"（避免与宿主枚举口径漂移）；只渲染宿主返回的计数与失败项（失败项用 `target` 对回行 id）。

---

## 7. R4：MCP 来源标签与第三条发现路径

### 7.1 现状修正（先纠正证据里的一处措辞）

证据 §4.3 写「`figma` 在本机**不会被** `mcp.runtime` 列为外部实例，因此**不会出现在 MCP 面板**」。**按当前代码复核，这句不准确**：

- `src/mcp/manager.ts:437-451` 会用**全局工具视图**把任意 `mcp__<serverName>__*` 分组（`ensure(parsed.serverName, "fiber")`），所以 `figma` **已经**出现为一条外部行：`restrictable:true`、`tools` 有 17 条、`source` 缺失。
- 证据 §4.2 的另一句是对的：`source` 只在"该实例没有可见工具"时折进 `meta`（`src/client/composer-capability.tsx:1450-1457`）→ 所以现状 `figma` 卡片的标签是 `外部`，**看不到插件名**，详情「来源」显示"运行时注入（来源不可识别）"（`src/client/mcp-panel.tsx:884-887`）。

→ **R4 的真实缺口**：不是"让行出现"，而是 **①来源解析（channel）②两枚标签 ③`origin:"namespace"` 合成标记与详情文案**。验收断言按此写（§10 R4-01/02），不要写成"R4 之前 figma 不存在"。

### 7.2 第三条发现路径（宿主）

新增到 `src/mcp/runtime.ts`（与两条现有路径并列，**只读**）：

```ts
/**
 * 第三条：全局工具视图里 `mcp__<ns>__*` 的命名空间，如果没有对应 mcp-client
 * 实例（fiber / loader 条目都没有），视为"插件自注册的工具命名空间"。
 */
export function scanInjectedMcpNamespaces(
  ctx: any,
  exclude: ReadonlySet<string>,   // 已被 fiber/条目/本插件配置占用的 serverName
): InjectedMcpInstance[];
```

实现要点：

1. 取数：`ctx.root.get?.("tools")?.schemas?.()`（同 §2.2 口径；异常 → `[]`）。
2. 用 `parseMcpToolName`（`src/mcp/usage.ts:57-66`）分组出 `serverName` 集合；`exclude` 内的跳过。
3. 每条产出 `{ serverName, origin: "namespace" }`，`source`：命中映射表 → **直接放映射表展示名**（`figma` → `dsh-to-figma`）；未命中 → **不带 `source`**（视图层据此标"未识别"）。
4. 无 `config`（没有实例配置）；`transport`/`summary` 保持缺省。
5. 合并顺序（`scanInjectedMcpInstances`，`:132-136`）：fiber → loader 条目 → **namespace（仅缺失名字）**。已有实例的命名空间不会被 namespace 路径覆盖。

`InjectedMcpInstance` 类型扩展（`src/mcp/runtime.ts:27-36`）：`origin: "entry" | "fiber" | "namespace"`。

### 7.3 视图字段（宿主类型 + 客户端镜像）

`McpRuntimeServerView`（`src/mcp/types.ts:216-246`）/ `ClientMcpRuntimeServer`（`src/client/api.ts:348-369`）additive 扩展：

```ts
{
  // 现有：serverName / source? / origin / transport? / summary? / disabledInProject? /
  //       restrictable / tools / enabledInSession? / calls
  /** R4 新增：注入方展示名（映射表归一后的插件名；无来源缺省）。卡片第二枚标签用它。 */
  channel?: string;
  /** R4 新增：来源判定（详情「来源判定」文案与诊断）。 */
  attribution?: {
    matchedBy: "namespace" | "source" | "unknown";
    /** 命中的命名空间 / source 原文 */
    pattern?: string;
  };
  /** R4 新增：true = 由工具命名空间合成（没有 mcp-client 实例，无 `config`）。 */
  synthesized?: boolean;
}
```

- `source` 保留原语义（fiber name / entry id 原文），**不覆盖**；`channel` 是展示名。两者都可能缺省。
- 旧客户端（只读现有字段）不受影响：新增字段可选；`origin` 新增枚举值 `"namespace"` 时，旧客户端按 `!=="entry"` 落到"动态 fiber"文案（可接受，属同版本内自洽）。
- `restrictable` 判定**不变**：`tools.length > 0`（`src/mcp/manager.ts:462`）。namespace 行天然有工具 → 可 restrict（契约允许，因为它的工具在全局视图里）。

### 7.4 `runtime()` 合并改造（`src/mcp/manager.ts:396-476`）

1. `deps.scanInjected?.()` 之前/之后加 namespace 扫描（顺序见 §7.2），`owned` 排除逻辑不变。
2. `ensure(serverName, origin)`：origin 由发现来源决定；工具注册表反推路径在**没有**发现记录时使用 `origin:"namespace"`、`synthesized:true`（现状写死 `"fiber"`）。
3. `channel`/`attribution` 填充：
   - 有 namespace 映射 → `channel = display`、`attribution.matchedBy = "namespace"`；
   - 有 `source`（fiber/entry）→ `channel = displayNameOfSource(source)`、`matchedBy="source"`；
   - 都没有 → `matchedBy="unknown"`（`channel` 缺省）。
4. 名字归一：详情文案需要"原文 → 展示名"（如 `dsh-figma` → `dsh-to-figma`），两者都放视图里（`source` + `channel`）。

### 7.5 首屏 MCP 行（composer）改造

`McpRow`（`src/client/composer-capability.tsx:104-119`）additive：

```ts
{
  // 现有字段不变
  /** 插件展示名（R4：第二枚标签；缺省 = 无插件来源） */
  channel?: string;
  /** true = 命名空间合成行（详情/卡片可加"合成"说明） */
  synthesized?: boolean;
}
```

`buildMcpRows`（`:1413-1467`）外部行改法：

| 情形 | tag | tone | 第二枚标签 | 占位 meta |
|---|---|---|---|---|
| `channel` 有值 | `插件` | `plugin` | `channel`（`skp-dock-tag-channel`，max-width 96px + ellipsis，与 SkillRow 同形 `:1523-1527`） | 当前 meta 计算不变（`N 个工具` 优先；无工具时 `source`） |
| `channel` 缺省但 origin=namespace | `未识别` | `unattributed`（新 tone，琥珀） | 无 | `N 个工具 · 来源未识别` |
| `channel` 缺省且 origin=entry/fiber | `外部注入` | `external` | 无 | `N 个工具`；无工具时 `source`/`外部实例` |

- `TagTone`（`:85`）新增 `"unattributed"`；样式 `.skp-dock-tag-unattributed`（琥珀，与 `skp-dock-tag-bundled` 同色系但独立类，便于后续调整）。
- 项目/全局配置条目的标签**不变**（`项目`/`全局`）。
- `CapabilityCard`（`:1490-1536`）里第二枚标签的渲染同 SkillRow 的 `channel` 分支：只在 `kind === "mcp" && row.channel` 时渲染。

### 7.6 主面板 MCP 页（`src/client/mcp-panel.tsx`）改造

| 位置 | 改动 |
|---|---|
| `McpExternalRow`（`:221-286`） | 行内标签：`channel` → `插件` + `插件名`（`skp-tag-plugin` + `skp-tag-channel`）；否则 `外部注入`（`skp-tag-readonly`）；namespace 无来源 → `未识别`（`skp-tag-warn`）。来源 `skp-tag-flat` 的 `source` 小标签保留（诊断价值），但**不与两枚标签重复**：有 `channel` 时不再单独渲染 source 小标签 |
| 分组标题「外部注入 · 运行时注入 · 只读」（`:636-664`） | 文案不变；组内行按 `channel` 升序、无 channel 的排后面 |
| `McpExternalDetail`（`:853-940`） | 标题右侧两枚标签同上；`来源` dd：`channel ?? source ?? "来源未识别"`；新增/调整 `来源判定` dd（见文案表）；`注入方式` dd：`origin === "namespace"` → `工具命名空间合成（插件直接注册 mcp__ 工具，没有 mcp-client 实例）`；`synthesized` 时补一句"无实例配置，传输方式未知"；工具与参数/使用记录两块**不变**（namespace 行 tools 来自全局视图，可查看） |
| 只读说明 | 保留"只读"标签（面板不提供编辑/删除），但补一句：`按会话开关请到对话首屏「本会话能力」区（工具命名空间无法在这里编辑或卸载）` |

**新增文案（frontend 直接抄）**：

- 来源判定（namespace 命中）：`前缀 mcp__{ns}__ → {channel}（插件清单映射表）`
- 来源判定（source 命中）：`运行时注入来源：{source} → {channel}`
- 来源判定（未知）：`来源未识别（不是宿主内置）`
- 注入方式（namespace）：`工具命名空间合成（不落盘、无 mcp-client 实例）`
- 详情 meta（合成行补充）：`由工具命名空间合成`

### 7.7 与 Jev / R1 / Tools 的联动

- Jev 的 MCP 候选枚举（`src/jev/apply.ts:319-344`）会把 namespace 行当外部实例（`source:"external"`），`applicable = restrictable === true` → 可评分/可应用，**行为已经正确**，R4 只改展示字段，不改枚举语义。
- R1 的 mcp 域批量把 namespace 行视为 `kind:"mcp-server"`（`target = serverName`），与已有一致。
- Tools 域**不含**这些工具（§2.1 规则 1）。

---

## 8. Jev 纳入 Tools（插件级计分与应用）

### 8.1 契约扩展（宿主 + 客户端镜像）

`src/jev/types.ts`：

```ts
// 现有 JevRankItem.kind: "skill" | "mcp"  ⇒ 扩为 "skill" | "mcp" | "tool"
// JevApplyPlanItem.kind 同上
export interface JevRankItem {
  // …现有字段…
  /** Tools 单元的工具数（additive；kind==="tool" 时必有） */
  toolCount?: number;
}
// JevCapability（宿主内部）
{
  kind: "skill" | "mcp" | "tool";
  // …
  /** Tools 单元的工具清单（复用 MCP 的 tools 字段语义，进入 rank 的 question） */
  tools?: Array<{ name: string; description?: string }>;
  toolCount?: number;
  /** 仅 Tools：是否存在显式会话覆盖（回滚前态用；与 mcpExplicitToggle 同构）。 */
  toolsExplicitToggle?: boolean;
  write: JevCapabilityWrite;
}
export type JevCapabilityWrite =
  | { type: "skills"; name: string }
  | { type: "mcp"; target: string; targetKind: "project" | "server"; serverName: string }
  | { type: "tools"; unit: string; unitName: string };   // 新增
export type JevPrevState =
  | { type: "skills"; enabled: boolean }
  | { type: "mcp"; enabled: boolean | undefined }
  | { type: "tools"; enabled: boolean | undefined };     // 新增
```

- `JevApplySkipReason` 复用现有枚举，不新增（Tools 不可开关时用 `not-restrictable`）→ 客户端 `RANK_REASON_TEXT`（`src/client/composer-capability.tsx:623-629`）无需新增文案。
- `JevCapabilityService`（`src/jev/apply.ts:59-83`）additive 加：

```ts
tools?: {
  list(input: { sessionId?: string }): Promise<ToolsListView>;
  setSessionEnabled(input: { sessionId: string; units: string[]; enabled: boolean | undefined }):
    Promise<{ ok: true; applied: number } | { ok: false; errors: string[] }>;
};
```

缺省（旧装配/未注入）时枚举跳过 Tools 段并 warn 一次（不报错），保证插件半升级不炸。

### 8.2 候选构造（枚举第 4 段，`src/jev/apply.ts:373-425`；已实现）

> **关键变更（A14）**：候选 = **本会话 effective 启用**的插件。全局默认关闭或会话已关闭的单元**不参与评分/应用**，因此 Jev 结构上无法把它们重新打开（只收窄不扩权，比"应用时再过滤"更强）。

```ts
// —— 4. Tools 插件单元（实现形状，节选）——
const toolsService = service.tools;
if (toolsService === undefined) warnToolsUnavailable(logger);   // 旧装配：跳过并只 warn 一次
else {
  const toolsView = await toolsService.list({ sessionId }).catch(...);   // 冷会话也能枚举
  for (const unit of toolsView?.units ?? []) {
    if (unit.kind === "unattributed") continue;                  // A4：未识别不进候选
    const effective = unit.enabled;                              // = 覆盖 ?? 全局默认
    if (effective !== true) continue;                            // A14：全局/会话关闭都不候选
    const capability: JevCapability = {
      id: capabilityId(`tool:plugin:${unit.unit}`),              // 稳定 id（sha256 前 36 hex）
      kind: "tool",
      name: unit.name,
      description: truncateCodepoints(`${unit.toolCount} 个工具 · 插件注入`, DESCRIPTION_LIMIT),
      source: "external",
      origin: "plugin",                                          // 诊断用；结果行标签来自 kind
      channel: unit.name,
      toolCount: unit.toolCount,
      tools: unit.tools,                                         // name + 200 码点说明（无 parameters）
      applicable: unit.lockedReason === undefined,
      enabledInSession: true,                                    // 已按 effective 过滤，进来必然生效
      toolsExplicitToggle: unit.explicit ? true : undefined,     // 回滚前态（见 §8.3）
      write: { type: "tools", unit: unit.unit, unitName: unit.name },
    };
    if (capability.applicable === false) capability.reason = "not-restrictable";
    add(capability);
  }
}
```

- **排序**：枚举返回按固定序 `skill → mcp → tool`（`src/jev/apply.ts:420-425` 的 `KIND_ORDER`；`compareRankItems` §8.4 同步）。
- **上限**：`MAX_RANK_CAPABILITIES = 300`（`src/jev/manager.ts:107`）不变；本机 Tools 单元 ≤ 6，无风险。
- **隐私**：只发插件名 + 工具**名与一句话说明**（`HostToolBrief.description`，200 码点），**不发**参数 schema——Jev 用的是轻量 `tools.list`，不调用 `tools.inspect`（A13）。
- **冷会话**：`tools.list({sessionId})` 不需要 live agent（读磁盘 + 内存 hydrate）→ 冷会话也能枚举；`applicable` 不看 live（Tools 写入支持冷写，见 §8.3）。

### 8.3 `jev.apply` 写入/回滚（`src/jev/apply.ts`；已实现）

1. `writeOne` Tools 分支（`:481-497` 附近）：`service.tools.setSessionEnabled({ sessionId, units: [write.unit], enabled: desired })`——**仍只写会话覆盖**，不碰全局默认。
2. `restoreOne` Tools 分支（`:547-560` 附近）：按 `prev.type === "tools" ? prev.enabled : undefined` 还原；`prev.enabled === undefined` = **清除会话覆盖**（回落到全局默认，而不是写死 true 覆盖全局关闭）。
3. `snapshotPrev`（`:446-449`）：Tools 用 `capability.toolsExplicitToggle`——枚举时算 `unit.explicit ? true : undefined`（有显式覆盖 → 回滚写 true；跟随全局默认 → 回滚清覆盖）。**按来源区分回滚**：会话覆盖的变更只恢复会话层，全局默认本就不由 Jev 修改。
4. `runWritePhase`：Tools 单列 `TOOLS_WRITE_CONCURRENCY = 4`（`src/jev/apply.ts:170`），不与 MCP 同组——Tools 写入会触发 restrict 重算，不宜同一 tick 全发；skills 仍整批同 tick、MCP 仍 `MCP_WRITE_CONCURRENCY = 4`。
5. `rollback`：分组加 tools，限流同上，保持"逆序"语义；回滚失败进 `errors`。
6. **筛选语义不变**：选中插件 → 开；未选中且当前开的可应用单元 → 关；不可应用（locked）不动也不进 skipped。
7. **只收窄（A14 双重保证）**：候选阶段已排除 effective=false 的单元；应用阶段 `applicable=false` 永不写；用户已关闭的单元若未选中则保持关闭。
8. 计数：`enabled` / `disabled` / `applied` 语义不变；一个插件 = 1 条（UX E19）。`selectedCount` 与 `应用所选（x）` 用同一集合。

### 8.4 评分请求改造（`src/jev/rank.ts`；已实现）

| 位置 | 改动 |
|---|---|
| `SystemOneCapability.kind`（`:89-96`） | `"skill" \| "mcp" \| "tool"` |
| `.tools` 注释（`:94-95`） | 「仅 MCP」→「MCP / Tools：工具名 + 简述」 |
| `SYSTEM_ONE_GUIDANCE`（`:57-65`） | 在 MCP 那句后追加一句（英文，保持风格）：`For plugin tool groups (kind "tool"), use the listed tools to judge what the plugin can actually do; a plugin is enabled or disabled as a whole.` |
| `buildQuestionTools`（`:178-197`） | **不改**（截断预算 8 个工具 / 500 码点总长，对插件工具组够用；超出按序截断） |
| `toRankItem`（`:305-324`） | 加 `if (capability.toolCount !== undefined) item.toolCount = capability.toolCount;` |
| `compareRankItems`（`:329-335`） | 二分改三档：`const order = { skill: 0, mcp: 1, tool: 2 }`；`order[a.kind] - order[b.kind]`（其余 score/name/id 规则不变，保证"同分排序稳定"仍成立） |

**阈值/计数口径（UX §7.3）**：

- 阈值滑杆默认 `0.50` 不变（`DECISION_DEFAULT_THRESHOLD = 0.5`，`src/client/composer-capability.tsx:368`）；只影响预勾选，不改已选项。
- `已选 x / total` 的 `total` = `rank` 响应的 `capabilitiesTotal`（宿主实枚举数），**不是硬编码 30**；`estimateTotal`（加载中）用客户端三域可开关单元数（`:1966` 扩展后）。
- 结果行：Tools 行 = 插件名（Menlo 风格）+ `插件` 紫标签 + `N 个工具` 灰标签 + 描述 + 分数条；不逐工具出行。

### 8.5 客户端决策面板改造（`src/client/composer-capability.tsx`；已实现）

| 位置 | 改动 |
|---|---|
| `DecisionData.total`/`capabilitiesTotal` | 不变（宿主已含 Tools） |
| `rankSourceTag`（`:646-661`） | **`item.kind === "tool"` 直接返回 `undefined`**（不渲染来源小标签）：Tools 行名称就是插件名，再挂一枚同名 channel 标签会重复（UX 帧 08 只有 `插件` + `N 个工具` 两枚）；`origin/channel` 仍写进数据供诊断与未来复用 |
| 结果行 kind 标签（`:1289`） | `item.kind === "skill" ? "Skills" : item.kind === "mcp" ? "MCP" : "插件"`（UX §2.1/§7.3 全站英文口径）；样式 `.skp-decision-kind-tool` 新增 |
| Tools 行附加 `N 个工具` 标签 | 在 name cell 后加（`:1290-1299`），仅 `kind==="tool" && toolCount`；样式 `.skp-decision-toolcount`（灰底，10px） |
| 决策行 grid（`styles.ts:730` 容器查询 5 列） | 加一个 `N 个工具` 标签会挤；按 UX 帧 08 把 desc cell 内联（工具数标签放在 name 行右侧，不新增 grid 列）——**不改 grid 模板**，避免 5 列布局回归 |
| apply plan（`:1019-1023`） | 透传 `kind`（`JevApplyPlanItem.kind` 扩为三值）；`name` 用插件名（仅诊断） |
| 底部说明（UX §7.3） | 结果列表下方补一行弱文案：`Tools 以插件整体计分与启用：选中即开启该插件全部工具；Jev 只收窄，不重新打开已关闭的能力。` |
| `empty-capabilities` 文案（`:614-615`） | `当前会话没有可评分的技能或 MCP 服务器` → `当前会话没有可评分的 Skills / MCP / Tools`（见 §9.8 命名统一） |
| entry tooltip（`:2006-2010`） | `为技能和 MCP 打分` → `为 Skills、MCP 与插件工具打分`（全站命名同步 UX §2.1） |
| `applyOptimistic`（`:1817-1837`） | 扩展 tools：`{ kind:"tool", name:插件名 }` → `optimistic.tools[unitName]=true`，row 回显同现逻辑 |

### 8.6 缓存/持久化/失败降级

- **无新增持久化**：Jev 不落 rank 结果（`pendingOutcome` 在内存）。Tools 的"应用"= 写 `session-capabilities.json` 的 `tools` 域（会话覆盖）；**不改** `tools-global.json`（全局默认只由能力面板写，A11/A12）。
- **缓存**：Jev 没有 rank 结果缓存（`jev.json` 只有配置，`src/jev/manager.ts:142-171` 每次现读）；本批**不引入**评分缓存，Tools 单元每次 rank 都从 `tools.list` 现枚举（工具集随时可变，缓存会与 `tools/change` 冲突）。
- 「快照字段 extensions」：本批**不新增** Jev 侧快照字段。若 R2 的 auto 需要 `selected` 快照（提案 §4.2 `derivedAgents`），那是 R2 任务，届时在会话记录里加 `derivedAgents`，与 `tools` 域并列（互不依赖）。
- **失败降级**：
  - `tools.list` 失败 → Tools 段跳过 + warn（评分照常，"capabilitiesTotal"少一段）；客户端不会看到 Tools 行。
  - Tools 写入失败 → 走全局回滚（现状语义 `:909-933`），返回 `failed[{id, reason}]` + `errors`；UI 行内错误条重试。
  - 旧宿主（无 `tools` 服务）→ 枚举跳过；plan 里若意外收到 `kind:"tool"` → `unknown-id` skipped（`isCapabilityId` + `byId` 查找自然兜底，`:872-876`）。

---

## 9. 客户端改造清单（实现现状）

> 本节已按落地代码重写（行号为当前工作树）。所有新文案可直抄；**不得**自行改词（UX v1.8 定稿口径）。

### 9.1 `src/client/api.ts`（类型镜像；已实现）

| 位置 | 内容 |
|---|---|
| `ClientMcpRuntimeServer`（`:348-369`） | 已加 `channel?` / `attribution?` / `synthesized?`；`origin` 含 `"namespace"` |
| `ClientToolsUnit`（`:490-532`） | `unit/name/kind/tools/toolCount/attribution` + **`defaultEnabled?` / `enabled?` / `enabledInSession?`（三者 optional，兼容旧宿主）** + `explicit/lockedReason/restriction`。客户端统一读 `enabled`，`enabledInSession` 只作旧宿主回退 |
| `ClientToolsList` / `ClientToolBrief`（`:533-559`） | 与宿主 `ToolsListView` 同形（`tools` 无 parameters） |
| `ClientToolsInspect` / `ClientToolInspectTool`（`:560-566`） | `inspect` 的完整 schema 形状（`parameters` 原样） |
| `ToolsApi`（`:568-596`） | `list({sessionId?})` / `setSessionEnabled({units,enabled,sessionId?})` / **`setGlobalEnabled({units,enabled})`** / **`inspect({unit,sessionId?})`** |
| `SessionApi`（`:664+`） | `setBulk`（不变） |
| `CapabilityPanelApi`（`:973-980`） | `tools: ToolsApi; session: SessionApi;` |
| `JevRankItem`（`:814+`）/ `JevApplyPlanItem`（`:883+`） | `kind` 含 `"tool"`；`toolCount?: number` |

### 9.2 `src/client/api-adapter.ts`（已实现）

| 位置 | 内容 |
|---|---|
| `tools.list`（`:462-475`） | `sessionId` 缺省取 `deps.sessionId`（composer api 自动带；主面板不带）；**业务失败不抛**：返回 `{units:[],errors}` 由 UI 显示空态 |
| `tools.inspect`（`:475-501`） | `sessionId` 同上；成功 value **无 `ok` 字段**，解信封后投影；业务失败/空结果 → **抛错**（UI 降级为「仅名称+说明」并提示参数不可用） |
| `tools.setGlobalEnabled`（`:503-510`） | 业务失败抛 `Error(errors)`；成功返回 `{ok:true,applied}` |
| `tools.setSessionEnabled`（`:512-521`） | 无会话上下文直接抛「需要当前会话」；业务失败抛错；成功 `{ok:true,applied}` |
| `session.setBulk` | 与 R1 契约一致；`failed[]` 属成功 value，**不抛**（页面级错误条用 `failed[]`） |
| 解信封 | 复用 `rpc()` / `unwrap()`（`:60-105`）；`unwrap` 对 `{unit,tools}` 不命中 `ok` 判定，因此 `inspect` 成功原样返回 |
| 错误语义 | `tools.setSessionEnabled` / `setGlobalEnabled` 业务失败 → 抛（与 skills 单条一致）；`inspect` 失败 → 抛，UI 降级为 list 的 name/description |

### 9.3 `src/client/composer-capability.tsx`（hero + 会话「能力」Tab；已实现）

| 位置 | 内容 |
|---|---|
| `CapabilitySnapshot`（`:~200`） | 含 `tools: ClientToolsUnit[]`；`fetchSnapshot` 与 skills/mcp 并行拉 `api.tools.list()`（失败降级 `[]`，不阻断两域） |
| `ToolRow`（`:137-155`） | `id:"tool:"+unit`、`kind:"tool"`、`name`、`tag`（`插件`/`未识别`）、`tone`（`plugin`/`unattributed`）、`meta`（`N 个工具`）、`enabled`（读 `enabled ?? enabledInSession`）、`disabled`（`lockedReason`）、`unit` |
| `Row` | `SkillRow \| McpRow \| ToolRow`；toggle 写路径：tools → `api.tools.setSessionEnabled({units:[row.unit], enabled:next})`（**只写会话覆盖**） |
| `buildToolRows`（`:1564+`） | 与 `buildMcpRows` 同形；未识别排最后 |
| controller（`:2112-2309`） | `toolRows` + pending/busy；`toggle` 三分支；`reset` = `session.setBulk({action:"reset"})`；`runBulk` 按域串行 `session.setBulk({action, domains:[domain]})`，失败域聚合 `{n} 项失败 · 重试`，重试只重放失败域（`:2208-2299`） |
| Tab（`:~1890`） | 第三 Tab `Tools` + 计数 `enabled / units.length`；空态 `本会话暂无可配置的 Tools` |
| 行 3 rail（`:1916-1952`） | `<div class="skp-dock-rail">`：左 `全部开启`/`全部关闭` + `已启用 n / m` + `仅当前会话 · 不改项目默认` + 域级进度 + 失败重试；**右侧不渲染任何 R2 控件/弱提示**（R2 未实现，见 §1.4） |
| 计数/底栏/收起条 | 三域口径（`total = skills + mcp + tools`；chips 含 tools）；`恢复默认` tooltip 写明「Tools 回落到全局默认」 |
| `totalCapabilities` / `switchableCapabilities` | 均含 toolRows（`:2406,2412`） |
| `DecisionPanel` | 见 §8.5 |

**行 3 精确文案**（已实现）：

| 元素 | 值 |
|---|---|
| 按钮 | `全部开启` / `全部关闭`；执行中 `全部开启中…` / `全部关闭中…` |
| 计数 | `已启用 {n} / {m}`（m = 三域可开关单元总数） |
| 范围说明 | `仅当前会话 · 不改项目默认` |
| 按钮 tooltip | `作用于本会话的 Skills · MCP · Tools 三域整体` |
| 目标态禁用 tooltip | `已全部开启` / `已全部关闭` |
| 失败 | `{n} 项失败 · 重试`（红字；点击只重放失败域） |
| 进度 | `正在关闭 {done} / 3 个域…`（域级，不显示逐条） |

### 9.4 `src/client/tools-panel.tsx`（新增文件；已实现）+ `panel.tsx`

> 实现采纳了新文件（未塞进 `mcp-panel.tsx`）；复用 `.skp-list/.skp-row/.skp-detail` 类。**A5 已 SUPERSEDED**：面板开关写**全局默认**，不再是只读。

| 部分 | 内容 |
|---|---|
| 布局 | `<div className="skp-body skp-tools-body">` 两栏；**无左导航**；header `全局工具注册 · 不区分项目 / 工作区` + 下拉 `全局工具 ▾` |
| 列表 | 插件名（单行 ellipsis）+ 标签（`插件` 紫 / `未识别` 琥珀）+ `N 个工具`；行尾**「默认」开关**（写全局默认）；计数 `· {n} 默认启用 · 插件级开关（整插件生效）` |
| 数据 | 主面板 `api.tools.list()` **不传 sessionId**（只看全局默认）；详情 `api.tools.inspect({unit})` **懒加载**并按 unit 缓存（失败降级为 list 的 name/description，提示"参数不可用"） |
| 开关（A12） | 行尾与详情都是 `defaultEnabled`（`tools.setGlobalEnabled`）；详情文案 `默认已启用 / 默认已关闭 · 本会话可在对话首屏单独覆盖`；tooltip 写明"关闭后所有会话默认不可用；单个会话仍可在首屏单独开启" |
| 详情滚动 | `.skp-detail.skp-detail-fixed` 整块滚动（`styles.ts:467-481,767-770`），工具清单手风琴自身有 `max-height` 兜底 |
| 工具清单（手风琴） | 行 = 工具名 + `N 个参数/无参数`；展开显示完整说明、**参数表**（参数 / 类型 / 必填 / 说明）与可折叠**原始 JSON**（pretty）。**已删除**「关闭该插件后…」琥珀条与「无参数表」文案；保留 `工具数 {n} · 开关为插件级：关闭后该插件全部工具在所有会话默认不可见（不改已有会话的显式覆盖）` 与底部「插件级开关，不提供单工具开关；宿主内建基础工具不进入本域」 |
| 空态 | `选择一个插件查看工具清单与参数。`；读不到 tools 服务时列表空 + 错误说明 |
| `panel.tsx`（`:96-114`） | `DomainTab` 含 `"tools"`；`DOMAIN_LABEL = { skills:"Skills", mcp:"MCP", tools:"Tools", jev:"Jev 模型" }`；`DOMAIN_ORDER = ["skills","mcp","tools","jev"]`；`DOMAIN_SEARCH_PLACEHOLDER.tools = "搜索插件或工具…"`；tools/Jev 域隐藏项目下拉 |

**新增文案（已实现，直接抄）**：

- 详情统计：`工具数 {n} · 开关为插件级：关闭后该插件全部工具在所有会话默认不可见（不改已有会话的显式覆盖）`
- 底部说明：`插件级开关，不提供单工具开关；无法 restrict 的插件开关置灰并说明原因；宿主内建基础工具不进入本域。`
- 手风琴提示：`点击工具查看参数与原始 JSON` / `收起原始 JSON`

### 9.5 `src/client/mcp-panel.tsx`（R4；已实现）

- `ExternalSourceTags`（`:200-256`）：有 `channel` → `插件` + 插件名（第二枚等宽小标签，`title` 全名）；namespace 合成且无映射 → `未识别` 一枚；其余 → `外部注入` 一枚。`externalAttributionText` 生成 `来源判定：前缀 mcp__<ns>__ → <channel>（插件清单映射表）` / `运行时注入来源：…` / `来源未识别（不是宿主内置）`。
- `McpExternalRow`（`:264-340`）：**名称行只放状态点 + serverName**（修复两枚标签把名字挤没）；两枚标签移到 meta 行；有 channel 时不再重复渲染 `source` 小标签；合成行 summary = `由工具命名空间合成 · 无 mcp-client 实例（只读）`。
- 组内排序：有 `channel` 的按展示名升序在前，无 channel 的按 serverName 在后。
- `McpExternalDetail`：两枚标签 + `来源判定` + `注入方式`（namespace → 工具命名空间合成）+ 只读说明补会话开关指引。

### 9.6 `src/client/jev-panel.tsx`（R5；已实现，A10 已解决）

| 位置 | 实现现状 |
|---|---|
| 副标题 | 两行：`COPY.subtitle`（`:62`）+ `COPY.subtitle2`（`:63`，**准确隐私口径**）：`一次请求完成；发送输入框草稿与能力名称、描述（Tools 为插件名与工具说明摘要）；草稿仅用于本次评分、不落盘，结果只写当前会话。` |
| callout | `.skp-jev-note` 整块 + `securityLead/securityPath/securityTail/batch/scope/privacy` 全删 |
| API Key ⓘ | `COPY.keySafety = "密钥仅存宿主，不下发浏览器"`（`:65`），渲染在 API Key 标签的 `ⓘ`（`:713`）；`apiKeyHint` 保留 |
| 其余 | Base URL / 模型 / 密钥模式 / 测试连接 / 恢复默认 / 保存配置语义不变 |

### 9.7 `src/client/styles.ts`（已实现）

| 类 | 用途 |
|---|---|
| `.skp-dock-rail`（`:740`） | 行 3 容器（`flex-wrap`、min-height 36、padding 6×10、radius 8、token 底） |
| `.skp-dock-rail-btn` / `-btn-primary` / `:disabled` / `[aria-disabled]`（`:741-746`） | 64×24、蓝描边强调、禁用态 |
| `.skp-dock-rail-count` / `-note` / `-progress` / `-fail`（`:747-752`） | 计数（tabular-nums）/ 弱说明 / 进度 / 红色失败+重试 |
| `.skp-tool-accordion`（`:230`） | 手风琴容器（`max-height:min(52vh,520px)` 内滚） |
| `.skp-detail-fixed`（`:467-481`） | 详情整块可滚动布局 + `skp-detail-meta`（来源判定行） |
| `.skp-tools-body`（`:762`）/ `.skp-detail-fixed`（`:767-770`） | Tools 页覆盖：`overflow-y:auto`、手风琴不限高（页面整体滚动） |
| `.skp-dock-tag-unattributed` / `.skp-dock-tag-count` / `.skp-dock-chip-tool` / `.skp-decision-kind-tool` / `.skp-decision-toolcount` | 未识别标签 / 工具数标签 / 收起条 chips / 决策行 kind 与工具数 |

> 响应式：行 3 允许 `flex-wrap`（与 `skp-dock-tab-row` 无 wrap 不同）；新增控件不得进"更多"菜单（UX §9 不变量）。

### 9.8 全站命名统一（UX §2.1 / E15；已实现）

`panel.tsx:96-102` 已是 `Skills` / `MCP` / `Tools` / `Jev 模型`；搜索占位 `搜索 Skills…` / `搜索 MCP…` / `搜索插件或工具…`（`:110-114`）；决策行 kind 标签 `Skills` / `MCP` / `插件`；空态与 tooltip 同步。度量：`grep -rnE "MCP 服务器|插件工具|技能" src/client/*.tsx` 剩余命中仅注释/文档字符串（用户可见字符串为 0）。

### 9.9 客户端改造顺序（历史，已全部落地）

1. `api.tools`（类型 + adapter）→ 2. rail/R1 + `session.setBulk` → 3. MCP 两枚标签（R4）→ 4. Jev 结果行/apply → 5. R5/命名 → 6.（本轮追加）面板全局默认开关 + `tools.inspect` 懒加载 + 详情滚动/手风琴 + MCP 行分行 + 全局 Skills 开关。

---

## 10. 测试设计（交给 tester）

### 10.1 测试载体与运行方式

- 仓库**没有**单测框架（`package.json` 无 test 脚本）；本地回归套件是 `notes/verify/run-all.sh` + `notes/verify/*.mjs`（gitignore，见 `AGENTS.md`「本地回归套件」与 `notes/verify/run-all.sh`）。
- 约定沿用：脚本内 `check(id, desc, pass, detail)` 收集断言，失败非零退出；编译到 `notes/verify/tmp/build`（`npx tsc -p notes/verify/tsconfig.verify.json`），宿主侧用假 ctx（参考 `notes/verify/loader-behavior.mjs`），客户端用 `react-dom/server` SSR + jsdom（参考 `notes/verify/capability-dock-render.mjs`）。
- 新增脚本（建议命名，全部落 `notes/verify/`，不进版本库）：
  - `v13-tools-domain.mjs`（TH/TU 段）
  - `v13-tools-global.mjs`（TH-G/TU-G 段：两层语义 + `tools.inspect` + 扇出）
  - `v13-session-bulk.mjs`（B 段）
  - `v13-mcp-namespace.mjs`（R4 段）
  - `v13-jev-tools.mjs`（J 段）
  - `v13-regression.mjs`（REG 段）
- 真机验收（用户已同意）：`bash scripts/push-and-reinstall.sh --profile web` + 重启 DSH，按 E2E 段走查；证据截图落 `notes/real-gui-evidence/v13/`。

> 用例编号规则：`V13-<组>-<序号>`；组 = B（批量）/ TH（Tools 宿主）/ TU（Tools UI）/ R4（MCP 来源）/ J（Jev）/ C（R5 文案）/ REG（回归）/ E2E（真机）。

### 10.2 Tools 宿主（TH）

| # | 断言 | 方法/夹具 |
|---|---|---|
| TH-01 | 枚举：给定假工具注册表（含本机实读名单：8 个 `mcp__*` server、`univer_*` 13、`rw_*` ≥3、`dsh_im_*` 8、`sidebar_open`、`open_in_popout`、`dsh-diff-approval-annotate`、若干宿主内建），`tools.list()` 的 units = 映射表命中的插件数（本机 6：univer/remote/im/sidebar/popout/diff-approval）+ 0 或 1 个未识别单元；每个 `toolCount` 与夹具一致。**断言按「夹具命中的插件集合」写，不写死 6**（UX 示例 6 张卡含未识别，属示例口径） | 假 ctx：`root.get("tools").schemas()` 返回夹具 |
| TH-02 | 互斥：`mcp__*` 不出现在任何 unit.tools；未识别 unit 不含宿主内建名 | 同上 |
| TH-03 | 内建金丝雀：证据 §2.2 名单每个名字都不在任何 unit 里；`excludedBuiltinCount > 0` | 同上 |
| TH-04 | 归属：`univer_*`→`dsh-univer-office`、`rw_*`→`dsh-remote`、`dsh_im_*`→`dsh-im`、`sidebar_open`→`dsh-better-sidebar`、`open_in_popout`→`dsh-popout-window`、`dsh-diff-approval-annotate`→`dsh-diff-approval`（逐条 exact/prefix 边界：`rwx_x` 不命中 `rw_`） | 直接调 `attributeTool` |
| TH-05 | 空白注册表 / `schemas()` 抛错 / tools 服务缺失 → `units:[]` + `errors` 非空，不抛 | 假 ctx 变体 |
| TH-06 | 持久化：`setSessionEnabled({unit,enabled:false})` 后 `state.entries()[sid].tools["plugin:<unit>"]===false`；`enabled:undefined` 后键消失 | 假 SessionState（或真实 tmp dshHome + `createSessionState`） |
| TH-07 | sanitize：手写含 `tools` 的文件 → 读到；`tools` 值非 boolean 的键被丢弃；旧版形状（无 tools）照常读；`isEmptyEntry` 不再把"只有 tools"的记录当空 | `session-state` 直测（tmp 文件） |
| TH-08 | restrict 生效：假 agent ctx 的 `tools.restrict` 记录入参；关闭某插件 → 恰好一次 `restrict({deny:[该插件全部工具]})`；重复关闭 → 无第二次调用（幂等短路） | 假 agent ctx + 假 tools 服务 |
| TH-09 | 不可关闭降级：`restrict` 缺失 → `restriction.state="skipped"`；`restrict` 抛错 → `"failed"` + warn，其余单元不受影响 | 假 ctx 变体 |
| TH-10 | `tools/change` 重算：新增一个此前不存在的工具到该单元 → 微任务后 deny 名单包含它；名单不变时不重复 restrict | 手动 emit `tools/change` |
| TH-11 | 冷写：无 live agent 时 `setSessionEnabled` 仍落盘（`applied:1`），不抛 | — |
| TH-12 | `run_code` 防御：夹具里塞一个 `run_code`（模拟）→ 不出现在 deny 名单（且被排除清单过滤） | — |
| TH-13 | **全局默认存储**：`createToolsGlobalStore(tmp)` → `setEnabled([u],false)` 后文件 `{version:1,disabled:[u]}`（0600/0700）；重复设置 `applied:0` 且不写盘；`enabled:true` 移出；损坏文件/未知 version → 按全部启用 + warn | tmp dshHome 直测 |
| TH-14 | **两层 effective 矩阵**：`(覆盖,全局默认)` = (无,开)→true；(无,关)→false；(true,关)→true；(false,开)→false；`tools.list` 三字段一致（`enabled === enabledInSession`、`defaultEnabled = !disabled`、`explicit` 正确） | 假 state + 假 global store |
| TH-15 | **`tools.inspect`**：成功支 `{unit,tools}` **无 ok 字段**；description 不截断、`parameters` 原样；未知 unit → `{ok:false,errors}`；`unit` 兼容裸 unit 与 `plugin:<unit>`；`sessionId` 不参与枚举 | 假 tools 服务 |
| TH-16 | **全局变化扇出**：`setGlobalEnabled` 后微任务内对所有 live agent 重算 restrict；`tools.list` 在 RPC 返回时已是新默认（内存镜像）；不 await 重算 | 假 agent 记录 + 计数 restrict 调用 |
| TH-17 | **`tools/change` 前 hydrate**：先写全局关闭 u，再 emit `tools/change` → restrict 仍包含 u 的 deny（不能因空集合重算而释放） | 假 ctx + 假 global store |

### 10.3 R1 批量（B）

| # | 断言 | 方法 |
|---|---|---|
| B-01 | 信封：传输层 `{ok:true}`；业务失败（缺 sessionId/bad action）为 `value.ok=false` + `errors` | 直调 `handleEndpoint("session.setBulk", ...)` |
| B-02 | `disable` 三域全关：`applied = 三域可开关单元数`；`unchanged=0`；`failed=[]`；随后三域"生效态全 false" | 假三域服务 + `loadState` |
| B-03 | `enable` 全开：先置若干 false（含显式 true/项目默认关闭项），`enable` 后全开；mcp 项目默认关闭项 = 显式 true（不是清覆盖） | 同上 |
| B-04 | 幂等：连续两次 `disable` → 第二次 `applied:0`、`unchanged=总数`（不重复写盘） | 同上 |
| B-05 | `reset`：只清有显式覆盖的键；无覆盖项不变；mcp 项目默认仍生效（不会被 reset 打开） | 同上 |
| B-06 | 部分失败：注入一条 `setSessionEnabled` 抛错 → 该条进 `failed[]`（含 domain/target/kind/error），其余成功；`applied` 不含失败项 | 假服务按名字抛错 |
| B-07 | 冷会话：skills 项进 `skipped`（reason 含"会话未激活"），mcp/tools 落盘；`coldSession:true` | 假 `agents.list()=[]` |
| B-08 | `domains` 过滤 + 顺序：`domains:["tools"]` 只动 tools；返回 `byDomain` 其余为 0 | — |
| B-09 | 同 session 并发两次 bulk → 串行（第二次数 unchanged，不交错）；不同 session 并行不互斥 | 并发调用 + 计时 |
| B-10 | 写盘次数：`disable` 一个域（150 skills）时 `state.setSkill` 调用数 = 变更条数，`setToggles` 调用数 = 1（mcp/tools 批量）；`dryRun:true` 时零写入 | 假 state 计数 |
| B-11 | `dryRun`：返回 planned 计数，状态不变 | — |
| B-12 | 性能基线 [待验证]：web profile 下 三域 disable 总耗时 < 3s（记录实测；>5s 视为 HIGH，需查是否有逐条重挂/逐条写盘残留） | 真机 RPC 计时 |
| B-13 | **两层语义**：全局默认关闭 u + 会话 `enable` → 写会话覆盖 true（`effective=true`）；`disable` 后再 `reset` → 覆盖清除、`effective` 回全局默认 false | 假 tools 服务 + global store |
| B-14 | **bulk 不写全局默认**：三域 `disable` 后 `tools-global.json` 的 `disabled` 不变；只有 `tools.setGlobalEnabled` 能改它 | 同上 |
| B-15 | `reset` 的 tools 项只取 `explicit===true` 的单元；无覆盖项计入 `unchanged` 而不是 `changed` | 同上 |

### 10.4 Tools UI（TU，SSR + 真机点选）

| # | 断言 |
|---|---|
| TU-01 | `CapabilityPanel` SSR：三 Tab（`Skills` / `MCP` / `Tools`），计数各为 `x / y`；Tools 计数按**插件数** |
| TU-02 | Tools 卡片：标题单行 ellipsis、描述 `{n} 个工具 · 插件注入`、只有一枚 `插件` 标签（未识别卡为 `未识别`）、整插件开关展示**本会话 effective**（`enabled`，不是 `defaultEnabled`） |
| TU-03 | 行 3 控制条存在且不换出可视区：`全部开启`/`全部关闭` 按钮 + `已启用 n / m` + `仅当前会话 · 不改项目默认`；Tab 行不新增控件 |
| TU-04 | 状态矩阵（S1/S2/S3/S6）：全开 → 全部开启禁用；全关 → 全部关闭禁用；加载中 → 双禁用 |
| TU-05 | 执行中：按钮文案 `全部关闭中…`、行开关置灰防抖、输入框不阻塞（真机） |
| TU-06 | 部分失败：注入一次失败 → `1 项失败 · 重试`；点重试只重放该域；失败行保持原状态 |
| TU-07 | 无二次确认、无提醒条：点「全部关闭」后直接进入执行态（真机点选，不静态分析）；全关后 0/m、无横幅（帧 04） |
| TU-08 | 切换 Tab 保持状态；hero 与「能力」Tab 整页 控件一致（同一组件） |
| TU-09 | 收起条 chips 含 Tools 项，计数 `enabled / total` 含三域 |
| TU-10 | 键盘可达：Tab → 批量按钮 → 卡片 → 底栏（顺序符合 UX §11） |
| TU-11 | **E8 规格修正走查**：不存在"agent 自身层工具"的置灰行（它们枚举不到、根本不渲染）；若通过夹具注入一个 `lockedReason` 单元，则开关置灰 + tooltip 显示原因，且不参与批量（渲染路径单独单测） |
| TU-12 | **域边界（v1.8 E20）**：Tools 三处（hero / 面板 / 决策结果）均无 `mcp__*` 行；`figma` 只在 MCP 出现一次（合成行），两域不重复收录 |
| TU-13 | **分型策略已删除（v1.8 E21）**：行 3 无 `分型策略…` 链接 / 无第三态 / 无 `派生继承` 控件（R2 未实现）；不得出现任何 R2 弱提示 |
| TU-14 | **面板全局默认开关（A12）**：Tools 页行/详情开关展示 `defaultEnabled`，点击调 `tools.setGlobalEnabled`；文案 `默认已启用/默认已关闭 · 本会话可在对话首屏单独覆盖`；主面板 `tools.list` **不传 sessionId** |
| TU-15 | **详情滚动 + 手风琴（A13）**：详情整块可滚动；工具行点击展开参数表（参数/类型/必填/说明）与原始 JSON（可折叠）；同一时间只展开一个；切换插件自动收起 |
| TU-16 | **文案删除**：详情不含「关闭该插件后…」与「无参数表」文案；统计行改为「所有会话默认不可见（不改已有会话的显式覆盖）」 |
| TU-17 | **MCP 外部行分行（R4 修复）**：名称行只有状态点 + serverName（figma 行能看到名字）；两枚标签在 meta 行；有 channel 时不重复渲染 source 小标签 |

### 10.5 R4 来源（R4）

| # | 断言 |
|---|---|
| R4-01 | 主面板 MCP 列表：`figma` 外部行显示两枚标签（`插件` + `dsh-to-figma`）；`origin:"namespace"`、`synthesized:true`；工具数 17 |
| R4-02 | 首屏 MCP 行（SSR `buildMcpRows`）：`channel` 存在 → tag `插件` + channel 小标签；无 channel → `外部注入`；未映射 namespace → `未识别` |
| R4-03 | 详情：`来源判定` = `前缀 mcp__figma__ → dsh-to-figma（插件清单映射表）`；`注入方式` = `工具命名空间合成（不落盘、无 mcp-client 实例）` |
| R4-04 | 合并去重：真实例（假 fiber `source:"dsh-to-figma"`, serverName `figma`）+ 同名命名空间 → 只出一条，origin 保持 `fiber`，channel 归一 |
| R4-05 | 未知命名空间（`mcp__mystery__x`）：出现在列表 → `未识别` 一枚标签；详情 `来源未识别（不是宿主内置）` |
| R4-06 | 旧字段兼容：只读 `source`/`origin` 的旧渲染路径（不改动分支）仍工作；`origin:"entry"/"fiber"` 文案不变 |
| R4-07 | 配置条目（AnySearch 等）标签仍 `全局`/`项目`，不被 R4 影响到 |
| R4-08 | namespace 行可 restrict：首屏关掉 `figma` → 产生 `mcp__figma__*` deny（与现状行为一致，回归保护） |

### 10.6 Jev（J）

| # | 断言 |
|---|---|
| J-01 | 枚举：`capabilitiesTotal` = skills + mcp + tools（Tools 候选 = **已识别且本会话 effective 启用**的插件；未识别单元、全局关闭、会话关闭均被剔除）；Tools 项 `kind:"tool"`、`toolCount` 正确 |
| J-02 | 请求体：Tools 题 `capability.kind="tool"`、`capability.tools` ≤ 8 条且总码点 ≤ 500；不含 `parameters`；不含草稿以外的隐私内容（除 draft 外无新字段） |
| J-03 | 结果：Tools 行按分数降序混排；`已选 x / total` 与勾选数一致；`toolCount` 标签渲染 |
| J-04 | apply 选中插件：整插件写 `enabled:true`（一个 unit 一次调用）；未选中插件 → `enabled:false`；`enabled/disabled` 计数 = 单元数 |
| J-05 | 只收窄：用户先手动关闭的插件不在选中集 → 不因 apply 被打开（`already-applied`）；不可应用锁定项不被写 |
| J-06 | 回滚：注入 tools 写入失败 → 前面已写项按前态逆序恢复（含 tools 的 `enabled` 快照）；`failed[]` 给出该 unit |
| J-07 | 冷会话：apply 入队（`pending:true`），`agent/created` 后重放，Tools 开关落盘且 restrict 生效 |
| J-08 | 旧宿主/无 tools 服务：枚举跳过（无 Tools 行），skills/mcp 仍可评分应用 |
| J-09 | 计划校验：伪造 `kind:"tool"` 但 id 不存在 → `unknown-id` skipped，不写任何状态 |
| J-10 | 阈值：改动阈值只改预勾选，不改变已手动勾选行；`应用所选（x）` 与 `已选` 同步 |
| J-11 | **不扩权（A14）**：全局默认关闭的插件不在 rank 结果里；即使伪造其 id 提交 apply → `unknown-id`/不可应用 skipped，不写会话覆盖 | 假 tools 服务 |
| J-12 | **回滚按来源**：会话覆盖=true 的单元写入失败回滚 → 恢复 true；跟随全局默认（无覆盖）的单元回滚 → **清除覆盖**（不是写 true）；全局默认不被 Jev 修改 | 假 tools 服务 + 断言调用序列 |
| J-13 | **请求体仍轻量**：Tools 题不含 `parameters`（Jev 用 `tools.list`，不调 `tools.inspect`） | 抓 body |

### 10.7 R5 文案（C）

| # | 断言 |
|---|---|
| C-01 | Jev 配置页无 callout：DOM 不含 `~/.dsh/dsh-capability-settings/jev.json`、`目录 700`、`一次请求给全部能力打分`、`全局配置 · 所有项目和会话共享` 等旧串 |
| C-02 | 副标题两行**逐字**匹配：`用 Jev 模型给 Skills、MCP 与 Tools 打分，自动选出与本轮草稿最相关的能力。` + `一次请求完成；发送输入框草稿与能力名称、描述（Tools 为插件名与工具说明摘要）；草稿仅用于本次评分、不落盘，结果只写当前会话。`（A10 已解决） |
| C-03 | API Key 标签右侧 `ⓘ` 存在（`aria-label` 可读），tooltip 含 `密钥仅存宿主，不下发浏览器`；`apiKeyHint` 行仍在 |
| C-04 | 全站命名：会话面板 / 主面板不出现 `MCP 服务器` / `插件工具` / `技能`（历史段落除外）；`Tools` 与 `Jev 模型` 入口正确 |

### 10.8 回归（REG，现有行为不得变）

| # | 断言 |
|---|---|
| REG-01 | skills 会话开关：单条开/关、落盘、重启恢复（现有 `skills.setSessionEnabled` 行为不变） |
| REG-02 | MCP 单条开关：项目条目挂载/卸载、全局 restrict、`status().restrictions` 形状不变 |
| REG-03 | MCP 挂载代际：全局层 `conflict`/`failed` 状态、`settling` 轮询不变 |
| REG-04 | `恢复默认`（旧路径）：若 R1 接管 reset，则旧行为等价（只清显式覆盖）；skills/mcp 归位一致 |
| REG-05 | 会话状态文件：旧版文件（无 `tools`）读取无 warn、无丢数据；新版写回后旧版读仍正常（忽略 `tools`） |
| REG-06 | 对账：`session/disposed`/`agent/disposed` 不删记录；24h 两阶段策略不变（`session-state-reconcile` 现有用例重跑） |
| REG-07 | Jev 现有 skills/MCP 评分/应用：数量、阈值、回滚、冷会话排队全不变 |
| REG-08 | 类型与构建：`pnpm typecheck` 退出 0；`pnpm build` 后 `lib/**` 与 `src/**` 同步（`git status` 干净） |
| REG-09 | **旧版插件降级**：旧 `lib/` 读 `session-capabilities.json` 忽略 `tools`、读不到 `tools-global.json`（不存在即全开）；旧版写回会丢 `tools` 字段（已知降级，文档标注，不修） |
| REG-10 | **会话覆盖与全局默认互不污染**：只有 `tools.setSessionEnabled` 时 `tools-global.json` 不变；只有 `tools.setGlobalEnabled` 时 `session-capabilities.json` 的 `tools` 不变 |

### 10.9 真机（E2E，`web` profile）

| # | 场景 | 断言 |
|---|---|---|
| E2E-01 | 首屏 hero 三 Tab 切换 | Tools 卡数 = 宿主 `tools.list` 的 unit 数（本机示例 6 插件，可能有 1 个未识别）、计数按插件数、无横向溢出 |
| E2E-02 | 点「全部关闭」 | 一步生效（无确认）、行 3 计数归 0、三域卡片全灰、无提醒条；刷新页面/切会话后状态仍在 |
| E2E-03 | 点「全部开启」 | 恢复计数、卡片恢复；已全部开启时按钮禁用 |
| E2E-04 | 关闭 `dsh-remote` 插件 | 该插件工具本会话不可见（模型侧验证：让 agent 尝试 `rw_*` 工具，应 UNKNOWN_TOOL） |
| E2E-05 | 关闭 `figma`（MCP 命名空间） | `mcp__figma__*` 不可见；MCP Tab 行状态同步 |
| E2E-06 | 重启宿主后恢复 | 同一 session resume 后开关态一致（`session-capabilities.json` 生效） |
| E2E-07 | MCP 两枚标签 | figma 行显示 `插件` + `dsh-to-figma`；详情来源判定/注入方式文案正确 |
| E2E-08 | 能力面板 Tools 页 | 两栏、无左导航、插件行+详情；**开关写全局默认**（关掉后新建会话默认不可用）；详情整块滚动 + 工具手风琴（参数表 + 原始 JSON） |
| E2E-09 | 能力决策含 Tools | 结果行三域混排（Tools 行为插件单元）、`已选 x / total` 一致、应用后插件开关生效（含"未选中=关"） |
| E2E-10 | Jev 配置页 | 无 callout、副标题两行、API Key ⓘ、其余项语义不变 |
| E2E-11 | 收缩窗口（920 / 1080 / 窄屏） | 行 3 四控件可见（R2 未实现时只有批量控件）、无截断/溢出 |
| E2E-12 | 命名统一走查 | 会话面板/主面板/决策面板/Jev 页均无 `技能` / `MCP 服务器` / `插件工具`（历史段落除外）；`Skills`/`MCP`/`Tools`/`Jev 模型` 四处一致 |
| E2E-13 | **两层语义真机**：面板关掉 `dsh-remote` 全局默认 → 新建会话 Tools 卡片默认关；旧会话若之前改过会话覆盖则保持原状；首屏把该会话单独开启 → 面板全局默认仍关 |
| E2E-14 | **全局变化扇出**：面板关掉某插件后，已打开的 live 会话里该插件工具下一次调用即不可用（模型侧 UNKNOWN_TOOL / 工具视图消失） |
| E2E-15 | **MCP 外部行**：figma 行名称可见（`figma`），标签在 meta 行两枚；详情来源判定/注入方式正确 |
| E2E-16 | **Skills 全局开关**：能力面板跟随会话（未钉选项目）时，全局 Skills 行开关可点（`hasWorkspace = pinned ?? workspace`） |

---

## 11. 风险与降级（含实现后的新风险）

| # | 风险 | 严重度 | 触发条件 | 缓解 / 降级（实现现状） |
|---|---|---|---|---|
| R1 | **restrict 失败或名单过期**：工具在 restrict 之后才注册（插件懒加载），首轮名单漏网 | 中 | `restrict` 抛错 / 工具后注册 | 已实现 `tools/change` 重算 + 幂等短路（§5.2/§5.4）；失败只降级 `failed` 状态。验收 TH-08/TH-10 |
| R2 | **错误关闭宿主内建工具**：排除清单漏项（宿主升级新增工具）→ 落入"未识别"单元 → 用户可关掉基础工具 | **高** | 宿主版本升级 | ①排除清单随宿主版本复核（release checklist）；②`excludedBuiltinCount` + 金丝雀测试 TH-03；③未识别单元**可开关**（A4 已实现）且关闭文案显式警告——若要更保守需产品再定（改成只读会让 0/30、30/30 不可达）；④**全局默认关闭**会把风险放大到所有会话（新增：面板关闭前列出工具清单供确认） |
| R3 | **归属误判**：前缀规则过宽（如未来 `rwx_*` 被 `rw_` 吃掉）→ 归错插件、关错工具 | 中 | 新插件命名冲突 | 分隔符边界匹配（`_`/`-`）+ exact 优先 + 单测边界用例；误判只影响展示分组 |
| R4 | **枚举不到工具**（无 tools 服务/旧外壳/agent 作用域工具） | 中 | 旧外壳、headless | `tools.list` 返回空 + `errors`，UI 空态说明；不阻断 skills/mcp；agent 作用域工具**不显示**（规格修正，TU-11） |
| R5 | **UX §5.4「无法 restrict → 置灰」部分不可达**：agent 自身层工具枚举不到 | 低（规格偏差） | — | 记为规格修正；`lockedReason` 渲染路径已实现（旧外壳/无 restrict 时生效），R2 后可能用上 |
| R6 | **批量部分失败留下中间态** | 中 | 单项失败 | 明确"不回滚"（A7）+ 失败域可重试 + 幂等重放；UI `{n} 项失败 · 重试` |
| R7 | ~~R5 文案与实现冲突~~ | — | — | **已关闭（A10）**：实现采用准确文案（`发送输入框草稿与能力名称、描述…草稿仅用于本次评分、不落盘`，`jev-panel.tsx:63`）；C-02 按逐字文案验收 |
| R8 | **降级旧版插件**：旧版读同一 `session-capabilities.json` 会忽略 `tools`，且**旧版写回可能只保留已知字段**；旧版完全读不到 `tools-global.json` | 中 | 用户回退旧版或混装 | 文档标注两条降级：①会话 Tools 覆盖丢失（回全局默认）；②全局默认丢失（= 全开）。不承诺降级保状态 |
| R9 | **展示名即持久化键**：映射表改名 → 旧会话/全局状态成孤儿（回默认/被忽略） | 低 | 未来改名 | 映射表冻结 + 改名走 CHANGELOG「设置迁移」；孤儿键无害（不命中、不主动删） |
| R10 | **`session.setBulk` 与单条 RPC 并发** | 低 | 并发点击 | 宿主同 session 串行队列；UI 执行中置灰行开关 |
| R11 | **Jev 插件级语义误解**：用户以为"选中插件 = 用它的某个工具" | 低 | — | 结果行 `N 个工具` 标签 + 底部说明 + 应用 toast |
| R12 | **性能**：三域批量 150+ 写；mcp 逐条重挂 | 中 | R1 首次执行 | mcp 批量写后只重挂一次、state 批量落盘；`dryRun` 与 `elapsedMs` 可观测；B-12 设 3s 基线 |
| R13 | ~~`tools.list` 体积~~ | — | — | **已缓解（A13）**：`tools.list` 只下发 name + 200 码点说明；完整 schema 走 `tools.inspect` 懒加载（按 unit 缓存）。剩余风险：单 unit schema 极大时 inspect 响应大（只 warn 不裁剪，`manager.ts:712-723`），可后续加折叠/分页 |
| **R14** | **两层语义误读**：用户以为首屏 rail「全部关闭」会关掉所有会话 / 以为面板开关只影响当前会话 | **高**（产品语义） | 任意 | UI 文案硬约束：rail `仅当前会话 · 不改项目默认`；面板详情 `默认已启用/已关闭 · 本会话可在对话首屏单独覆盖`；`恢复默认` tooltip 写明回全局默认。验收 TU-14、E2E-13 |
| **R15** | **全局变化扇出窗口**：`setGlobalEnabled` 返回时 live agent 的 restrict 可能尚未重算（fire-and-forget 微任务/队列） | 中 | 面板改全局后立刻让模型调用工具 | 与 mcp loader 的"写入不等重挂"同语义：面板读内存镜像即时正确；模型侧下一轮工具视图收敛。真机验收 E2E-14（记录收敛时间；若 >2s 视为 HIGH，需改为 await 或加 settling 提示） |
| **R16** | **双默认概念混淆**：`capability-overrides.json`（Skills/MCP 项目默认）与 `tools-global.json`（Tools 全局默认）是两套 | 中 | 用户/维护者 | 文档与详情文案明确：Tools 无项目维度、默认在能力面板；overrides 只管 Skills/MCP 项目维度 |
| **R17** | **`tools-global.json` 与 `session-capabilities.json` 双写时序**：两文件独立，极端情况下（面板写全局 + 首屏写会话）没有跨文件事务 | 低 | 并发操作 | 两层语义本身允许二者独立（`effective = 覆盖 ?? 全局`）；UI 不做"同时改两层"的动作；`tools.list` 每次读内存镜像（各自串行队列收敛） |
| **R18** | **全局默认关闭 + 会话覆盖开** 的组合对用户不直观（面板关、首屏开） | 中 | — | 首屏卡片 `<title>`/详情可加"全局默认关闭，本会话已单独开启"（[待验证] 文案是否已覆盖；若未覆盖在 P8 补） |

---

## 12. 分阶段提交建议与工作量（进度回填）

### 12.1 阶段（每阶段可独立验证）

| 阶段 | 内容 | 涉及文件 | 验证 | 估时 | 状态 |
|---|---|---|---|---|---|
| P1 | 归属表 + Tools 宿主域 + 持久化 + `tools.*` RPC | `src/shared/plugin-attribution.ts`、`src/tools/{types,manager,restrict}.ts`、`src/session-state.ts`、`src/index.ts`、`src/remote.ts` | TH-01..TH-12；REG-05/06 | 1.5d | ✅（`d6723d7`） |
| P2 | R1 `session.setBulk`（三域批量 + `state.setToggles` + `loader.setSessionEnabledMany`） | `src/session-bulk.ts`、`src/remote.ts`、`src/mcp/loader.ts`、`src/index.ts` | B-01..B-15；REG-01..04 | 1.0d | ✅ |
| P3 | R4 第三发现路径 + 字段 + 标签 | `src/mcp/{runtime,manager,types}.ts`、`src/client/{api,mcp-panel,composer-capability}.tsx` | R4-01..R4-08；REG-02/03 | 0.5d | ✅ |
| P4 | 首屏 / 会话 Tab 第三域 + 行 3 控制条 | `composer-capability.tsx`、`api-adapter.ts`、`api.ts`、`styles.ts` | TU-01..TU-09、TU-12/13；E2E-01..03 | 1.5d | ✅ |
| P5 | 能力面板 Tools 页（两栏 + 详情 + 工具清单） | `tools-panel.tsx`（新增）、`panel.tsx`、`styles.ts` | TU-10/11、E2E-08 | 0.75d | ✅（第一版；本轮追加全局默认/滚动/手风琴） |
| P6 | Jev 纳入 Tools | `src/jev/{types,apply,rank}.ts`、`src/index.ts`、`src/client/{api,composer-capability}.tsx` | J-01..J-10；REG-07；E2E-09 | 1.0d | ✅（本轮追加 effective 候选/回滚按来源） |
| P7 | R5 文案 + 全站命名统一 | `jev-panel.tsx`、`panel.tsx`、`mcp-panel.tsx`、`composer-capability.tsx` | C-01..C-04；E2E-10/E2E-12 | 0.75d | ✅（A10 已解决） |
| **P7.5** | **（本轮追加）Tools 两层语义**：`tools-global.json` + `tools.setGlobalEnabled` + effective + 扇出 + `tools.inspect` + 面板/详情/行修复 | `src/tools/{global-state,manager,types}.ts`、`src/remote.ts`、`src/index.ts`、`src/jev/apply.ts`、`src/session-bulk.ts`、`src/client/{api,api-adapter,tools-panel,composer-capability,mcp-panel,panel,styles}` | TH-13..TH-17、B-13..15、TU-14..17、J-11..13、E2E-13..16 | 2.0d | ✅（工作树，待提交） |
| P8 | **回归 + 真机验收 + 文档/设计稿同步** | `notes/verify/*.mjs`、`notes/real-gui-evidence/v13/`、README/CHANGELOG/Figma | REG-01..10；E2E-01..16 | 1.0–1.5d | ⏳ **剩余** |

**累计**：设计期估 8.5d；实际 P1–P7.5 ≈ 6.5–7d（含两层语义返工）。**剩余 ≈ 1–1.5d**（真机验收 + 文档/设计稿 + 懒清理另立）。

### 12.2 提交切分与依赖（已按实际落地）

```
P1 ──▶ P2 ──▶ P4 ──▶ P5 ──┐
 └──▶ P3 ──────────┘        ├──▶ P8
 └──────────────────▶ P6 ──┤
P7（独立）─────────────────┤
P7.5（依赖 P1/P5/P6；覆盖 A3/A5）──┘
```

- 每个阶段一次提交（中文 commit + 验证命令与真实输出，仓库纪律见 `AGENTS.md`「变更纪律」）；P7.5 的 `lib/**` 需随源码一起提交。
- **R2 仍不在任何阶段**；`applyForAgent` 已按实现落地（`src/tools/manager.ts:357-375`），是唯一为 R2 预留的接口。

### 12.3 文档/设计稿同步（其余剩余项）

- `README.md`：三域说明、**两层语义（面板=全局默认 / 首屏=会话覆盖 / 恢复默认回全局）**、R1 批量、MCP 两枚标签、Jev 含 Tools；**明确写"R2 派生继承未实现"**。
- `CHANGELOG.md` `[Unreleased]`：补两层语义与 `tools-global.json` / `tools.inspect`；写清降级路径（旧版丢 Tools 会话覆盖与全局默认、agent 层工具不可见、批量不回滚）。
- Figma：帧 03/06 的 Tools 开关语义由"只读（A5）"改为"全局默认开关（A12）"；详情多手风琴与滚动布局——需同步设计稿并在 CHANGELOG 注明设计变更。
- 后续可选任务：`tools-global` 懒清理（R2 后评估）、R2 实现（另立 task）、A4 未识别单元产品确认。

---

## 附录 A · RPC 与类型契约汇总（实现对照表）

| endpoint | 方向 | 入参 | value 成功 | value 业务失败 | 状态 |
|---|---|---|---|---|---|
| `tools.list` | 新 | `{sessionId?: string}` | `ToolsListView`（`units[]` 含 `defaultEnabled` / `enabled` / `enabledInSession`(legacy) / `explicit` / `lockedReason` / `restriction`） | `{ok:false,errors}` | ✅ P1/P7.5 |
| `tools.setSessionEnabled` | 新 | `{sessionId:string, units:string[], enabled:boolean\|undefined}` | `{ok:true,applied:number}` | `{ok:false,errors}` | ✅ P1 |
| **`tools.setGlobalEnabled`** | **新（P7.5）** | `{units:string[], enabled:boolean}`（兼容 `plugin:` 前缀） | `{ok:true,applied:number}` | `{ok:false,errors}` | ✅ P7.5 |
| **`tools.inspect`** | **新（P7.5）** | `{unit:string, sessionId?:string}`（`sessionId` 暂不参与） | `{unit:string, tools:[{name,description?,parameters?}]}`（**无 `ok` 字段**） | `{ok:false,errors}` | ✅ P7.5 |
| `session.setBulk` | 新 | `SessionBulkInput` | `SessionBulkResult` | `{ok:false,errors}` | ✅ P2 |
| `mcp.runtime` | 改（additive） | 现有 `{cwd?,sessionId?}` | 现有 + `channel?/attribution?/synthesized?`、`origin:"namespace"` | 不变 | ✅ P3 |
| `skills.*` / `mcp.*` / `overrides.*` / `jev.*` | 不变 | — | — | — | 不变 |

**宿主内部新增（非 RPC）**：

| 方法 | 位置 | 用途 |
|---|---|---|
| `SessionStateStore.tools(sessionId)` / `setTool(...)` / `setToggles(...)` | `src/session-state.ts` | Tools 持久化 + 批量落盘 |
| `loader.setSessionEnabledMany(input)` | `src/mcp/loader.ts` | R1 mcp 域批量（一次 hydrate + 一次重挂） |
| `createSessionBulk(deps)` | `src/session-bulk.ts` | R1 实现 |
| `scanInjectedMcpNamespaces(ctx, exclude)` | `src/mcp/runtime.ts` | R4 第三路径 |
| `attributeTool` / `attributeMcpNamespace` / `displayNameOfSource` / `isHostBuiltinTool` | `src/shared/plugin-attribution.ts` | 归属单一事实源 |
| **`createToolsGlobalStore(deps)` / `ready()` / `disabled()` / `setEnabled(units, enabled)`** | **`src/tools/global-state.ts`** | **全局默认存储（`tools-global.json`）；setEnabled 幂等 + 锁内合并 + 写失败降级（A11）** |
| **`effectiveEnabled(unit, toggles, globallyDisabled)` / `computeTargets(...)`** | **`src/tools/manager.ts:292-322`** | **两层生效值纯函数（会话覆盖 ?? 全局默认）（A11/A14）** |
| `applyForAgent(agent, sessionId, toggles, { globalTools?, logger?, globallyDisabled? })` | `src/tools/manager.ts:357-375` | Tools restrict 应用（R2 复用点；已按 effective 计算） |
| **扇出 `scheduleGlobalFanout()` / 全局镜像 `hydrateGlobal()`** | **`src/tools/manager.ts:432-455,573-592`** | **全局默认变化 → 所有 live agent 重算（A12/R15）** |

## 附录 B · 文件级改动矩阵（实现清单，防漏改）

> 状态：除 `README.md` / `CHANGELOG.md` / Figma 外，下表均已落地（`d6723d7` + P7.5 工作树）。

| 文件 | 类型 | 改动摘要 | 阶段 |
|---|---|---|---|
| `src/session-state.ts` | 改 | `tools` 域 + `tools/setTool/setToggles` + sanitize/empty/writeToggle | P1 |
| `src/shared/plugin-attribution.ts` | 新 | 映射表 / 归属 / 内建清单 / 命名空间表 | P1 |
| `src/tools/types.ts` | 新 | `ToolsListView` 等（宿主） | P1 |
| `src/tools/manager.ts` | 新 | 枚举、会话记录、hydrate、restrict 应用、`tools/change`、生命周期 | P1 |
| `src/tools/restrict.ts` | 新（可选拆分） | deny 计算 + 幂等短路（照 `loader.ts:486-579` 范式） | P1 |
| `src/index.ts` | 改 | 装配 `tools` 服务、注入 jev、`applyForAgent` 依赖 | P1 |
| `src/remote.ts` | 改 | 5 个 endpoint（`tools.list`/`setSessionEnabled`/`inspect`/`setGlobalEnabled`/`session.setBulk`）+ `PanelRpcService` 扩展 | P1/P2/P7.5 |
| `src/session-bulk.ts` | 新 | 批量端点实现（三域 + reset + dryRun + 串行；tools 域按 effective 判定，只写会话覆盖） | P2/P7.5 |
| **`src/tools/global-state.ts`** | **新（P7.5）** | **`tools-global.json` 全局默认存储：形状 `{version:1,disabled[]}`、0700/0600、原子写+锁、幂等、stale unit 不删** | **P7.5** |
| `src/mcp/loader.ts` | 改 | `setSessionEnabledMany`（只加方法，不改现有语义） | P2 |
| `src/mcp/runtime.ts` | 改 | 第三路径 + `origin` 联合扩展 + 合并顺序 | P3 |
| `src/mcp/manager.ts` | 改 | `runtime()` 合成行/来源/channel/attribution | P3 |
| `src/mcp/types.ts` | 改 | `McpRuntimeServerView` additive 字段 + 联合值 | P3 |
| `src/client/api.ts` | 改 | 类型镜像 + `ToolsApi`/`SessionApi` + Jev kind/toolCount | P3/P6 |
| `src/client/api-adapter.ts` | 改 | 新方法接线 | P3/P4 |
| `src/client/mcp-panel.tsx` | 改 | R4 两枚标签/来源判定/合成文案 | P3 |
| `src/client/composer-capability.tsx` | 改 | ToolRow/Tab/rail/controller/bulk/McpRow.channel/Jev 行/apply | P4/P6 |
| `src/client/tools-panel.tsx` | 新 | 主面板 Tools 两栏页：全局默认开关（`setGlobalEnabled`）+ 详情滚动 + 工具手风琴（`inspect`）+ 未识别标签 | P5/P7.5 |
| `src/client/panel.tsx` | 改 | 第四域 Tab（Skills/MCP/Tools/Jev） | P5 |
| `src/client/jev-panel.tsx` | 改 | R5 文案 | P7 |
| `src/client/styles.ts` | 改 | rail / tag-unattributed / kind-tool / toolcount / chips / `skp-tool-accordion` / `skp-detail-fixed` / `skp-tools-body` | P4–P7.5 |
| `src/jev/types.ts` | 改 | kind/write/prev/toolCount 扩展 | P6 |
| `src/jev/apply.ts` | 改 | 枚举第 4 段（effective 候选）+ 写入/回滚（按来源）/并发组 `TOOLS_WRITE_CONCURRENCY` | P6/P7.5 |
| `src/jev/rank.ts` | 改 | kind 联合、guidance、toolCount、三档排序 | P6 |
| `README.md` / `CHANGELOG.md` / Figma | 改 | 两层语义 + `tools.inspect` + 降级说明；R2 未实现必须写明；Figma 帧 03/06 同步 A12 | P8（剩余） |

## 附录 C · 待验证清单（谁验 / 怎么验 / 降级）

| # | 待验证 | owner | 验证方式 | 降级口径 |
|---|---|---|---|---|
| V1 | `ctx.get("tools").schemas()` 真机条数与名单（证据 §10 #1 仍未取到） | tester（P8） | `tools.list` 落 JSON 证据（`notes/verify/out-tools-enumeration.json`） | 未覆盖名字归"来源未识别"（A4 已实现） |
| V2 | `tools.restrict` 对插件工具实测成功（非 MCP） | tester（P1） | TH-08 + 真机 E2E-04（模型侧 UNKNOWN_TOOL） | 失败 → `failed` 状态 + UI 提示；不阻断其它域 |
| V3 | R1 批量耗时（150+ 条） | tester（P2） | B-12 真机计时 | >5s → 排查逐条重挂/逐条写盘（§6.2-4/5） |
| V4 | hero 实际宽度（920/952）与行 3 是否溢出 | tester（P4） | `getBoundingClientRect` + E2E-11 | 窄容器下行 3 允许换行（`flex-wrap`），不得进"更多"菜单 |
| V5 | 旧版插件读回 `tools` 是否丢字段（R8） | backend/tester（P2） | 用旧 `lib/` 版插件写一次开关后检查文件 | 标注为已知降级，不修 |
| V6 | `figma` namespace 行在真机的 `calls`/工具清单是否完整 | tester（P3） | E2E-07/E2E-15 + 主面板详情 | 工具清单为空时仍显示来源两枚标签（信息不全但不错标） |
| ~~V7~~ | ~~R5 文案定稿（A10）~~ | — | **已关闭**：实现采用准确文案，C-02 逐字验收 | — |
| **V8** | **两层语义真机对账**：面板全局默认 / 首屏会话覆盖 / 恢复默认回全局（E2E-13） | tester（P8） | 真机按 E2E-13 操作，落 `tools-global.json` + `session-capabilities.json` 证据 | 语义不符 → HIGH；先修 `tools.list` 投影 |
| **V9** | **`tools.inspect` 响应体积 / 详情滚动性能**（大 schema 如 univer/figma） | tester（P7.5 后） | 打开每个插件详情，记录响应字节与展开耗时（`TOOL_INSPECT_WARN_BYTES` 日志） | >1MB 或明显卡顿 → 折叠/分页（后续任务），不裁剪 schema |
| **V10** | **全局变化扇出收敛时间**（R15） | tester（P8） | 面板改全局后，记录 live 会话工具视图/调用失败的最长收敛时间 | >2s 视为 HIGH：改为 await 重算或加 settling 提示 |
| **V11** | **旧版插件降级（全局默认）**：旧版完全读不到 `tools-global.json`（= 全开） | backend/tester（P8） | 旧 `lib/` 启动后检查行为与文件不被旧版改写 | 标注为已知降级，不修 |

---

## 附录 D · 参考

- UX：`docs/ux/capability-v13.md`（**v1.8**；§2.1 命名 / §2.3 三域 / **§2.4 域边界** / §3 R1 / §4 R2 布尔继承 / §5 R3 / §6 R4 / §7 Jev / §10 E1–E21 / §12 D1–D11）
- 证据：`docs/research/capability-v13-evidence.md`（§2 枚举与归属 / §3 restrict 契约 / §4 MCP 来源 / §5 首屏 / §6 R2 / §7 R5 / §9 结论 / §10 待验证）
- R2 提案：`docs/architecture/agent-capability-inheritance.md`（§1.2 / §4.2 / §5.1）
- 既有范式：`src/mcp/loader.ts`（restrict + 会话记录）、`src/session-state.ts`（持久化）、`src/jev/apply.ts`（批量/回滚/冷会话排队）、`src/skills/registry.ts`（来源 channel 分类表）
- 实现：`src/tools/{types,manager,restrict,global-state}.ts`、`src/session-bulk.ts`、`src/jev/{types,apply,rank}.ts`、`src/client/{tools-panel,composer-capability,mcp-panel,panel,jev-panel,api,api-adapter,styles}`
- 设计源：Figma 页 `Capability Panel · 全局开关与派生 v13`（帧 01–08；与实现的偏差需同步设计稿：**A5→A12 面板开关语义、A10 文案、A11/A12/A13 两层语义与 inspect**）
