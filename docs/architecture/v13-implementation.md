# v13 第一批实现方案 · R1 全局开关 / R3 Tools 域 / R4 MCP 来源 / R5 文案 / Jev 纳入 Tools

| 项 | 值 |
|---|---|
| 文档 | `docs/architecture/v13-implementation.md`（新建，本任务唯一落盘产物） |
| 角色 | architect（只写架构文档）· task-9 |
| 日期 | 2026-10-29 |
| 仓库基线 | 工作树 `f454a03` + 未跟踪文档 `docs/ux/capability-v13.md`（**v1.8**，2026-10-29 17:29 升版）、`docs/research/capability-v13-evidence.md` |
| 上游规格 | `docs/ux/capability-v13.md`（下称 **UX**）、`docs/research/capability-v13-evidence.md`（下称 **证据**） |
| R2 | `docs/architecture/agent-capability-inheritance.md`（提案 v0.1，**未实现**；本批只确认边界，不实现） |
| 下游 | backend（宿主域/RPC）、frontend（三域 UI）、tester（§10 用例）、pm/chronicler（文案与复盘） |
| 写作用域 | 仅本文；不改 `src/**`、不改设计稿、不动 `~/.dsh`、不安装、不推送 |

**阅读约定**：`文件:行号` 指工作树当前内容；`证据 §x` / `UX §x` 指上述两份上游文档的章节；`[待验证]` = 必须真机或单测确认，且同段给出验证方式；`[需拍板]` = 本方案已给推荐值，但需 Lead/用户确认后才能验收。

**本方案不含实现代码**。类型/JSON 片段是**契约**（字段名、可选性、信封形状），实现方按此写代码，不得自行改名。

---

## 0. 结论摘要（先看这一页）

1. **第一批范围**=R1 + R3 + R4 + R5 + Jev 纳入 Tools；R2 只确认交互/业务逻辑、**零代码**（§1.4）。R1 走**新增宿主批量端点** `session.setBulk`（不是前端 150+ 条并发），见 §6。
2. **域边界**：工具名以 `mcp__` 开头 → 永远归 **MCP 域**；否则若属"插件直接注册的非 mcp 工具" → **Tools 域**。宿主内建工具**不进入任何域**（排除清单自维护，证据 §3.2 #5）。与 UX v1.8 §2.4 / D11 一致。见 §2。
3. **Tools 域的开关单元 = 插件**（一个插件 = 一个单元，无单工具开关，UX §5.1/D8）。关闭 = 对该插件在本会话全部可继承工具调 `tools.restrict({deny})`；restrict 失败 → 降级为状态可见但不阻断，agent 自身层工具则不出现（§2.2）。见 §5。
4. **持久化**：`session-capabilities.json` 的会话记录追加 `tools` 域（`plugin:<unit>` → boolean），`version` 仍为 1（additive）；**不做** `capability-overrides.json` 的 Tools 项目默认（理由见 §3.3）。
5. **R4 的第三条发现路径**：全局工具视图里 `mcp__<ns>__*` 若没有 mcp-client 实例 → 合成一条 `origin:"namespace"` 的外部行，来源用映射表解析成插件展示名（`figma` → `dsh-to-figma`），识别不到标「未识别」；UI 出 `插件` + 插件名两枚标签。**注意**：本机 `figma` 现在**已经**以"无来源外部行"出现在 MCP 列表/首屏（与证据 §4.3 措辞不同，见 §7.1），所以 R4 的真实缺口是**来源/标签/合成标记**，不是"让行出现"。
6. **Jev 纳入 Tools**：一个插件 = 一个评分/应用单元（`kind:"tool"`），选中=整插件开、未选=整插件关；复用现有 `jev.apply` 的筛选语义/回滚/冷会话排队，只新增一个 `write.type:"tools"`。见 §8。
7. **R2 不实现**：默认「继承」会改变现有行为，本批**不得**把"默认继承"写成现状；第一批必须为 R2 预留的只有一条：Tools 域的 restrict/shadow **可按任意 agent 作用域重复应用**（不绑定创建路径）。见 §1.4、§11。
8. **总工作量粗估 8.5 人日**（含验收；净开发 ≈7.0），按 8 个可独立验证的阶段提交（§12）。

### 0.1 本方案内的架构决定（可被评审/实现引用）

| id | 决定 | 位置 | 状态 |
|---|---|---|---|
| A1 | `mcp__*` 恒归 MCP；Tools 只收非 mcp 前缀的插件直接注册工具；宿主内建工具不入域 | §2 | 采纳（用户已拍板） |
| A2 | `tools` 域落 `session-capabilities.json` 会话记录，键 `plugin:<unit>`，`version` 不变 | §3 | 采纳 |
| A3 | 第一批不做 Tools 的项目级默认（不改 `capability-overrides.json`） | §3.3 | 采纳（用户已拍板，理由本文补全） |
| A4 | 「来源未识别」合成一个单元；**可开关、计入分母、但不进 Jev 候选** | §4.4/§8.2 | **[需拍板]**（UX v1.8 §5.2 示例卡已无未识别卡，§5.4 仍保留该分组；备选：只读，代价是 0/30、30/30 不可达） |
| A5 | 能力面板 Tools 页**只读**（主面板无 sessionId，无法写会话开关）；开关只在 hero / 会话「能力」Tab | §9.4 | **[需拍板]**（UX v1.8 §5.3 仍写"开关 + 已启用/已关闭"，与该实现约束冲突；备选 = 新增 activeSession RPC，不推荐） |
| A6 | 同一 agent 上 Tools restrict 与 MCP restrict **叠加为交集**，各自持有 disposer、各自幂等短路 | §5.4 | 采纳 |
| A7 | R1 = 单一宿主批量端点 `session.setBulk`，支持 `enable`/`disable`/`reset`，**部分失败不回滚**、幂等、按会话串行 | §6 | 采纳 |
| A8 | R4 用 `origin:"namespace"` 扩展联合类型 + 新增 `channel` 字段（additive，旧客户端按 fiber 文案回落） | §7 | 采纳 |
| A9 | Jev Tools 单元：`kind:"tool"`、`id=cap(sha256("tool:plugin:<unit>"))`、`toolCount` additive 字段 | §8 | 采纳 |
| A10 | R5 副标题「仅发送能力名称与描述」与实现（发送草稿）冲突，必须 ux 改文案或改实现 | §9.6、§11-R7 | **[需拍板]** |

---

## 1. 现状 → 目标差距清单

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

### 1.3 明确**不改**的部分（防越界）

- `src/mcp/loader.ts` 的挂载/换代号、项目级 overrides 语义、`skills/**` 的 shadow 机制、`sessions-capabilities` 的对账策略：**不改语义**；只为 Tools 域补一条 restrict 通路，为批量端点补 `setSessionEnabledMany` 内部方法。
- `capability-overrides.json` 的 schema 与读写：**不改**（A3）。
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
- 作用域/继承语义：Tools 域**无项目 / 工作区维度**（UX v1.8 §2.4 域边界 / §2.5 Tools 页 / §5.3）。全局工具注册与项目无关；开关只作用于会话。`tools.list` 因此不需要 `cwd`。
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

- 值 `false` = 本会话**显式关闭**该单元；值 `true` = 显式开启（一般不需要写，见 §6.2）；**键缺失 = 默认开启**（Tools 域没有项目级默认，A3）。
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

### 3.2 内存态（宿主运行时）

沿用 MCP loader 的"内存权威 + 懒 hydrate"模型（`src/mcp/loader.ts:244-260, 298-319`）：

- `src/tools/manager.ts` 内部：`sessionToggles: Map<sessionId, Map<unitKey, boolean>>`、`hydratedSessions: Set<sessionId>`。
- `hydrateToggles(sessionId, meta)`：先 `state.ready()` → `state.verifySession(...)`（防 sessionId 复用）→ 只补内存里没有的键（同运行内用户刚改的不被磁盘旧值覆盖）。每次 hydrate 一次。
- `agent/disposed`：只清内存（`sessionToggles`、`hydratedSessions`、restrict 记录），**不清磁盘**（与 `:742-749` 一致；重启后要靠磁盘恢复）。
- `agent/created` + 插件加载时对 `ctx.get("agents").list()` 的存量 agent 补应用（与 `:715-763` 同款；resume 场景必须补）。

### 3.3 为什么第一批**不做** `capability-overrides.json` 的 Tools 项目默认

1. **语义不对齐**：overrides 是"项目级默认关闭"（新建对话按它），而 Tools 是全局工具注册、UX 明确"不区分项目 / 工作区"（UX v1.8 §2.4、§2.5、§5.3）。给一个无项目维度的域挂项目维度默认，会让"同一插件在不同项目默认不同"，与 header 文案和用户心智冲突。
2. **与 R1/R2 冲突**：R1「全部关闭」是会话级、R2「继承」是会话树级；再叠一层项目默认会造出三层优先级（显式会话 > 项目默认 > 插件安装态），而 Tools 没有"安装后默认该不该开"的产品答案。
3. **实现成本与风险**：overrides 按项目根分 key，需为 Tools 补一套"默认关闭 → 新会话拒绝该插件工具"的投影与热应用（MCP 那套 restrict 逻辑的翻版），并新增 reconcile；本批 ROI 低。
4. **回滚语义**：「恢复默认」对 Tools 会变得有歧义（恢复到项目默认还是插件全开？）。本批 `reset` = 清除会话覆盖 = 回到"全开"（§6.2）。

→ **A3 采纳**：Tools 只有会话级开关。若未来要项目默认，另立任务并评估与 R2 的交互。

### 3.4 与会话对账（`session-state-reconcile.ts`）的关系

- `tools` 字段不参与新的对账维度：整个会话记录仍按"存在性 + 24h 宽限"清理（`src/session-state-reconcile.ts:1-22` 的策略），Tools 开关随记录一起生灭。
- 不需要为"已卸载插件"做键清理：插件卸载后 `tools.list` 不再产出该单元，旧键保留是无害的（不会命中）；如要清理，放在 R2 的派生快照清理任务里一起做，**本批不做**。

---

## 4. 归属启发式（插件 → 工具映射）

### 4.1 新增共享模块（建议路径）

`src/shared/plugin-attribution.ts` —— **单一事实源**，Tools 域与 MCP R4 共用（避免两套映射表漂移；先例：`src/skills/registry.ts:211-227` 的 `KNOWN_PLUGIN_SOURCES` / `KNOWN_RUNTIME_NAME_PREFIXES` / `RUNTIME_CHANNEL`）。

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

### 4.4 未识别策略（A4，**需拍板**）

**推荐（默认）**：

- 所有"非 mcp、非内建、无映射"的工具合并为**一个**单元：`unit = "__unattributed__"`，展示名 `来源未识别`，标签 `未识别`（琥珀；UX v1.8 §5.4 保留该分组，但 §5.2 的 6 张示例卡已改为**全部已知插件**，无未识别卡 → 该单元只在真机出现未知工具时生成，是第 7 个单元）。
- 该单元**可开关**（技术上全部来自全局视图 → 可 restrict），**计入** hero/控制条的"可开关单元"分母（示例 6；出现未知工具时变 7），参与 R1 批量。
- 该单元**不进入 Jev 候选**（§8.2）：无法给出有意义的插件描述，且可能混入未来宿主内建工具，让模型去"推荐关闭"风险高。
- 开关文案与 tooltip（新增，UX 未定义，frontend 直接用）：
  - 关闭影响：`关闭后本会话模型看不到这 N 个工具；它们未能识别来源，可能包含宿主内建工具，关闭前请确认`
  - 卡片描述：`N 个工具 · 来源未识别`

**备选（更保守，代价明确）**：该单元只读（`lockedReason:"来源未识别，无法确认是否为宿主内建工具"`），不参与批量。代价：UX §3.3 的 `30/30`（S1）与 `0/30`（S3/帧 04）**永远不可达**，验收需改口径——因此推荐方案 A4-推荐值。

**判定依据不足时的行为**：[待验证] 真机上 `ctx.get("tools").schemas()` 的准确条数/名单（证据 §10 #1 仍未取到）。验证方式：实现 `tools.list` 后，在 `web` profile 里调用一次并落 `notes/verify/out-tools-enumeration.json`，人工核对"每个非 mcp 工具都被 rules 或 builtin 清单覆盖"；若有遗漏 → 按"来源未识别"处理并评估补映射。

---

## 5. Tools 域开关实现（插件级）

### 5.1 宿主服务形状（`ctx.capabilityPanel.tools`）

```ts
// src/tools/types.ts（宿主与客户端各镜像一份，字段同名同义）
export interface HostToolBrief {
  /** 完整工具名（restrict 用这个名字；UI 只读展示） */
  name: string;
  /** 一句话说明（截断到 200 码点，与 Jev 的 DESCRIPTION_LIMIT 同口径） */
  description?: string;
}

export interface ToolsUnitView {
  /** 开关单元 id（持久化键 = `plugin:<unit>`；未识别 = "__unattributed__"） */
  unit: string;
  /** 展示名（卡片标题 / 详情标题） */
  name: string;
  /** plugin = 已识别插件；unattributed = 来源未识别 */
  kind: "plugin" | "unattributed";
  /** 该单元当前可见的全部工具 */
  tools: HostToolBrief[];
  /** 工具数（卡片描述与 Jev toolCount 用） */
  toolCount: number;
  /** 归属判定（详情「来源判定」文案） */
  attribution: {
    matchedBy: "prefix" | "exact" | "unknown";
    /** 命中的模式原文（未识别缺省） */
    pattern?: string;
    /** 包名（已识别才有） */
    packageName?: string;
  };
  /** 本会话生效开关（显式覆盖 > 默认 true） */
  enabledInSession: boolean;
  /** 是否有显式会话覆盖（"恢复默认"是否可点） */
  explicit: boolean;
  /**
   * 不可开关原因；正常缺省。第一批唯一可能来源 = 该 unit 含被契约禁止的名字
   * （run_code 等，理论不会出现）或 restrict 不可用（宿主旧版）。
   */
  lockedReason?: string;
  /** 上一次 restrict 的降级状态（仅传了 sessionId 时；诊断/文案用） */
  restriction?: { state: "applied" | "skipped" | "failed"; error?: string };
}

export interface ToolsListView {
  units: ToolsUnitView[];
  /** 全局工具总数（诊断） */
  totalGlobalTools: number;
  /** 被判定为宿主内建而排除的条数（诊断；不下发名单） */
  excludedBuiltinCount: number;
  /** 服务缺失/异常时的原因（不阻断其它域） */
  errors: string[];
  /** 本次查询绑定的会话（没传 sessionId 时缺省；enabledInSession 恒为默认值） */
  sessionId?: string;
}
```

`setSessionEnabled` 入参（**batch-first**：单条 = 长度 1 的数组；这样 R1 批量与单条开关共用一条服务路径，只重算一次 restrict）：

```ts
export interface ToolsSetSessionInput {
  sessionId: string;
  /** 单元 id 列表（客户端只传 unit，宿主自己重算工具名，防止客户端注入任意 deny 名单） */
  units: string[];
  /** true=开启（清除覆盖或写 true，见 §5.3）；false=关闭；undefined=清除显式覆盖 */
  enabled: boolean | undefined;
}
export type ToolsSetSessionResult =
  | { ok: true; applied: number }
  | { ok: false; errors: string[] };
```

- 服务实现位置：`src/tools/manager.ts`（`createToolsManager(ctx, deps)`），组合根 `src/index.ts` 注入 `{ dshHome, state: sessionState, logger }`。
- `list` 的 `enabledInSession`：内存 toggles（已 hydrate）有该键 → 该值；否则 `true`。
- 未传 `sessionId`（主面板调用）：`enabledInSession` 恒默认 `true`、`explicit` 恒 `false`、`restriction` 缺省——**主面板据此渲染只读开关**（A5）。

### 5.2 关闭 = 插件级 `tools.restrict({deny})`

**deny 名单计算**（每次重算，不缓存跨代）：

```
targets = 本会话显式 false 的单元集合
deny = ∪ unit.tools[].name  − {run_code}  − 非全局视图名字
```

- 名字必须来自**当前全局视图**：`tools.restrict` 对未知/scope-local 名字**直接抛错**（证据 §3.1 第 3 条）；因此 deny 只从 `tools.list` 的当前枚举里取，不落盘工具名（**持久化只存 unit id，不存工具名**——插件升级增减工具后自动跟随）。
- 空名单 → **不调用** restrict（空 filter 抛错，证据 §3.1 第 2 条），状态记 `skipped`（与 `src/mcp/loader.ts:542-579` 同款降级）。
- 名单与上一代等价 → 直接返回（幂等短路，防止 `tools/change` 自激；先例 `src/mcp/loader.ts:567`）。
- 失败 → `restriction.state:"failed"` + warn，**不影响**其它开关与 UI（UX E8 的降级预期）。
- 释放：dispose 全部旧 disposer 后再提交新名单（先例 `:515-527`）。

**必须由 agent.ctx 调用**：`record.agent.ctx.get("tools").restrict(...)`（无 scoped ctx 会抛 "requires a scoped context"，证据 §3.1 第 1 条）。与 MCP loader 一样，从 `ctx.get("tools")` 取不到 scoped 时降级 `skipped`。

**记录结构**（`src/tools/manager.ts`）：

```ts
interface ToolsSessionRecord {
  agent: any;
  cwd?: string;
  /** 本代会话显式关单元 → 期望 deny 名单（unit 列表） */
  targets: Array<{ unit: string; name: string }>;
  restrictDisposers: Array<() => void>;
  appliedDeny: string[];
  restrictions: Array<{ unit: string; state: "applied" | "skipped" | "failed"; error?: string }>;
  queue: Promise<void>;   // 串行化本 session 的重算（与 mcp loader 同款）
}
```

### 5.3 写入语义（`enabled` 三种取值）

| 输入 | 宿主行为 | 存储 |
|---|---|---|
| `false` | 写显式 false → 重算 deny → restrict | `state.setTool(sessionId, "plugin:<unit>", false)` |
| `true` | 当前生效态为 false → 写显式 true → 重算；当前已是 true → 视为已完成（`applied` 不计，仅重算一次幂等短路） | `state.setTool(..., true)` |
| `undefined` | 清除显式覆盖（恢复默认开启）→ 重算 | `setTool(..., undefined)` |

**约定**：`true` 的落盘采用"**写 true**"而不是"删键"，理由是 R1「全部开启」必须能压过将来的项目默认（本批没有，但保持语义稳定）；`undefined` 才是"恢复默认"。`applied` = 真正改变了 `enabledInSession` 的单元数。"清除"只有 `undefined` 一条路径，避免两种写法共存。

### 5.4 与 MCP restrict 的协同（A6）

- 同一 agent 上会有**两条独立 restrict**：MCP loader 的（`mcp__*`）+ Tools 的（非 mcp 插件工具）。托管契约是 **restrictions intersect**（`src/mcp/loader.ts:31-36` 引用宿主原文），所以两条互不干扰，各自 disposer 只释放自己那条。
- **不得**把两域名单合并成一条 restrict：合并后任一方重算都要动另一方的名单，容易在 `tools/change` 里形成互相触发；分开后各自幂等短路即可收敛。
- 重算触发：
  1. `agent/created` → 首轮应用；
  2. 本域 `setSessionEnabled` → 该 agent 重算（串行队列）；
  3. `tools/change` → 微任务合并 → 所有有 targets 的 agent 重算（先例 `:581-602`）；
  4. `agent/disposed` → 清记录（disposer 随 agent ctx 回收）。
- **边界**：若某工具同时被 MCP loader 与 Tools 域 deny（当前不可能，因两域名单互斥），交集语义仍是"关"。不需要额外仲裁。

### 5.5 不可 restrict / 降级矩阵

| 情形 | 表现 | 依据 |
|---|---|---|
| 旧外壳无 `tools.restrict` | 宿主在 `tools.list({sessionId})` 时探测该 agent 的 `tools.restrict` 是否存在 → 缺省则 `lockedReason:"当前外壳不支持按会话关闭"`（开关一开始就置灰，不等用户点了才失败）；若运行中才失败则 `restriction.state="skipped"` | `src/mcp/loader.ts:548-558` 同款 |
| deny 名单为空（工具全部注销） | `skipped`，开关显示"已关闭"但实际无副作用 | 契约（空 filter 抛错） |
| restrict 抛错 | `failed` + warn，UI 保留开关状态并标"未生效"（tooltip 带 error 摘要） | 降级不阻断 |
| agent 自身层工具 | **不出现**在 Tools 域（枚举不到），无置灰行 | §2.2；与 UX §5.4 的差异见 §11-R5 |
| `run_code` | 永不出现在 deny 名单（排除清单 + 提交前过滤） | 宿主 `dsh-tools:2999` 显式抛错 |

---

## 6. R1 批量端点

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
| tools | 对所有单元（含未识别）`enabled:true` | `enabled:false` | 对有显式覆盖的单元 `enabled:undefined` | `tools.list({sessionId})`（§5.1）；显式名单取 `state.entries()[sessionId].tools` 的键 |

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

### 6.3 宿主实现落点

- 新模块 `src/session-bulk.ts`：`createSessionBulk(deps)`，`deps = { skills, mcp, tools, state, ctx }`（全部用现有服务接口，组合根注入）。
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
| 乐观回显 | 开始时把该域所有可开关行 `pending=target`；响应后按 `failed[]` 回滚对应行 |

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

### 8.2 候选构造（枚举第 4 段，`src/jev/apply.ts:227-354` 追加）

```ts
// —— 4. Tools 插件单元 ——
const toolsView = service.tools === undefined
  ? undefined
  : await service.tools.list({ sessionId }).catch(() => undefined);
for (const unit of toolsView?.units ?? []) {
  if (unit.kind === "unattributed") continue;          // A4：不进 Jev 候选
  const applicable = unit.lockedReason === undefined;  // 正常恒 true
  const capability: JevCapability = {
    id: capabilityId(`tool:plugin:${unit.unit}`),      // 稳定 id（§8.6）
    kind: "tool",
    name: unit.name,                                   // 插件展示名（= 卡片标题）
    description: truncateCodepoints(
      `${unit.toolCount} 个工具 · 插件注入`,
      DESCRIPTION_LIMIT,                               // 200 码点，rank.ts:30
    ),
    source: "external",          // 不在项目/全局配置文件里；语义与"外部注入"一致
    origin: "plugin",            // 诊断用（结果行的「插件」标签来自 kind，不依赖 origin，见 §8.5）
    channel: unit.name,
    toolCount: unit.toolCount,
    tools: unit.tools,           // name + description（无 parameters，隐私口径见下）
    applicable,
    enabledInSession: unit.enabledInSession,
    write: { type: "tools", unit: unit.unit, unitName: unit.name },
  };
  if (!applicable) capability.reason = "not-restrictable";
  add(capability);
}
```

- **排序**：枚举返回仍按 `kind`（`src/jev/apply.ts:350-353`）→ 改为固定序 `skill → mcp → tool`（`compareRankItems` §8.4 同步）。
- **上限**：`MAX_RANK_CAPABILITIES = 300`（`src/jev/manager.ts:107`）不变；本机 Tools 单元 ≈ 6，无风险。
- **隐私**：只发插件名 + 工具**名与一句话说明**（`HostToolBrief.description` 截断），**不发**工具参数 schema（`parameters` 不下发，Tools 域视图本身就不带 parameters，避免界面/传输冗余）。
- **冷会话**：`tools.list({sessionId})` 不需要 live agent（读磁盘 + 内存 hydrate）→ 冷会话也能枚举；`applicable` 不看 live（与 skills 的 `not-toggleable` 例外不同：Tools 的写入支持冷写，见 §8.3）。

### 8.3 `jev.apply` 写入/回滚（`writeOne` / `restoreOne` / `runWritePhase`）

1. `writeOne`（`:383-408`）加分支：

```
if (capability.write.type === "tools")
  → service.tools.setSessionEnabled({ sessionId, units: [unit], enabled: desired })
```

2. `restoreOne`（`:436-465`）加分支：用 `prev.enabled`（`true|false|undefined`）还原；`prev.type !== "tools"` 时按 `undefined`（清除）兜底。
3. `snapshotPrev`（`:363-367`）加 `{ type:"tools", enabled: capability.unitExplicitToggle }`：需要内部快照字段（与 MCP 的 `mcpExplicitToggle` 同构，`src/jev/types.ts:320-346`）：

```ts
/** 仅 Tools：是否存在显式会话覆盖；undefined = 跟随默认（开启）。 */
toolsExplicitToggle?: boolean;
```

由枚举时从 `ToolsUnitView.explicit` + `enabledInSession` 计算：`explicit ? enabledInSession : undefined`。
4. `runWritePhase`（`:672-700`）：把 Tools 写入并入 **MCP 并发限流组**（`MCP_WRITE_CONCURRENCY = 4`，`:147`）——Tools 写入会触发 restrict 重算，不宜同一 tick 全发；或单列 `TOOLS_WRITE_CONCURRENCY = 4`（推荐后者，便于日志区分）。
5. `rollback`（`:473-497`）：分组加 tools，限流同上，保持"逆序"语义。
6. **筛选语义不变**（`:531-548`）：选中插件 → 开；未选中且当前开的可应用单元 → 关；不可应用（locked）不动也不进 skipped。
7. **只收窄**：Jev 不扩权——`applicable=false` 的单元永不写；用户已关闭的单元若未选中则保持关闭（`already-applied`/`consistent` 路径不会反向打开）。
8. 计数：`enabled` / `disabled` / `applied` 语义不变；一个插件 = 1 条（UX E19）。`selectedCount` 与 `应用所选（x）` 用同一集合（`:1369-1372`）。

### 8.4 评分请求改造（`src/jev/rank.ts`）

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

### 8.5 客户端决策面板改造（`src/client/composer-capability.tsx`）

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

- **无新增持久化**：Jev 不落 rank 结果（现状：只写会话开关；`pendingOutcome` 在内存）。Tools 的开关状态由 `session-capabilities.json` 的 `tools` 域承载，Jev 的"应用"= 写该域。
- **缓存**：Jev 没有 rank 结果缓存（`jev.json` 只有配置，`src/jev/manager.ts:142-171` 每次现读）；本批**不引入**评分缓存，Tools 单元每次 rank 都从 `tools.list` 现枚举（工具集随时可变，缓存会与 `tools/change` 冲突）。
- 「快照字段 extensions」：本批**不新增** Jev 侧快照字段。若 R2 的 auto 需要 `selected` 快照（提案 §4.2 `derivedAgents`），那是 R2 任务，届时在会话记录里加 `derivedAgents`，与 `tools` 域并列（互不依赖）。
- **失败降级**：
  - `tools.list` 失败 → Tools 段跳过 + warn（评分照常，"capabilitiesTotal"少一段）；客户端不会看到 Tools 行。
  - Tools 写入失败 → 走全局回滚（现状语义 `:909-933`），返回 `failed[{id, reason}]` + `errors`；UI 行内错误条重试。
  - 旧宿主（无 `tools` 服务）→ 枚举跳过；plan 里若意外收到 `kind:"tool"` → `unknown-id` skipped（`isCapabilityId` + `byId` 查找自然兜底，`:872-876`）。

---

## 9. 客户端改造清单

> 文件级清单 + 每处改动 + 新增类名。所有新文案可直抄；**不得**自行改词（UX 定稿口径）。括号内为现行号（`src/` 当前工作树）。

### 9.1 `src/client/api.ts`（类型镜像）

| 位置 | 改动 |
|---|---|
| `ClientMcpRuntimeServer`（`:348-369`） | 加 `channel?` / `attribution?` / `synthesized?`；`origin` 加 `"namespace"` |
| 新增 `ClientToolsUnit` / `ClientToolsList` / `ToolsApi` | 与 §5.1 宿主类型同形（`tools: [{name, description?}]`；不带 parameters） |
| `McpApi`（`:413-470`） | 不变（R4 只走 runtime 字段） |
| 新增 `SessionApi` | `setBulk(input: SessionBulkInput): Promise<SessionBulkResult>` |
| `CapabilityPanelApi`（`:752-777`） | 加 `tools: ToolsApi; session: SessionApi;` |
| `JevRankItem` / `JevApplyPlanItem` | `kind` 加 `"tool"`；`toolCount?: number` |

### 9.2 `src/client/api-adapter.ts`

| 位置 | 改动 |
|---|---|
| `createPanelApi` 返回对象 | 新增 `tools.list({sessionId?})` → `tools.list`；`tools.setSessionEnabled({units,enabled})` → `tools.setSessionEnabled`；`session.setBulk` → `session.setBulk` |
| RPC 解信封 | 复用现有 `rpc()` / `unwrap()`（`:60-105`）；bulk 的 `failed[]` 属成功 value，不抛错 |
| 错误语义 | `tools.setSessionEnabled` 业务失败 → 抛 `Error(errors.join("; "))`（与 skills 单条一致）；bulk 永不抛（页面级错误条用 `failed[]`） |

### 9.3 `src/client/composer-capability.tsx`（hero + 会话「能力」Tab）

| 位置 | 改动 |
|---|---|
| `CapabilitySnapshot`（`:76-82`） | 加 `tools: ClientToolsUnit[]`；`fetchSnapshot`（`:173-193`）并行拉 `api.tools.list()`，失败降级 `[]`（不阻断两域） |
| 新增 `ToolRow` | `id:"tool:"+unit`、`kind:"tool"`、`name`、`tag`（`插件`/`未识别`）、`tone`（`plugin`/`unattributed`）、`meta`（`N 个工具`）、`enabled`、`disabled`（`lockedReason !== undefined`）、`unit` |
| `Row`（`:121`） | `SkillRow \| McpRow \| ToolRow`；`Toggle` 的写路径加 tools 分支（`api.tools.setSessionEnabled({units:[row.unit], enabled:next})`） |
| 新增 `buildToolRows(snapshot, pending)` | 与 `buildMcpRows` 同形；排序按名称，未识别排最后 |
| controller（`:1791-1895`） | `toolRows` + pending/busy 合并；`toggle` 三分支；`reset` 改用 `api.session.setBulk({action:"reset"})`（A7） |
| Tab（`:1620-1656`） | 第三 Tab：`Tools` + `<span class="skp-dock-tab-count">{toolRows.filter(enabled).length} / {toolRows.length}</span>`；`TabId` 加 `"tools"`；空态文案 `本会话暂无可配置的插件工具` |
| **新增行 3 控制条**（插在 Tab 行之后、错误条之前） | 结构：`<div class="skp-dock-rail">` 左 `全部开启` / `全部关闭` + 计数 + 范围说明；右侧**本批不渲染任何 R2 控件与弱提示**（`派生 agent 整体继承三域` / `继承\|不继承` 属 R2，未实现，见 §1.4；布局留空位）。禁用条件见 UX §3.3 |
| 计数（`:1576-1588`） | `total = skillRows.length + mcpRows.length + toolRows.length`；`totalOn = 三域 enabled 之和`；`injectedOn` 逻辑保持（只统计 skills 注入） |
| 底栏（`:1687-1708`） | 文案扩展为三域口径；`恢复默认` 走 bulk reset（loading 态禁用） |
| `CapabilityBar`（`:1717-1785`） | chips 加 tools（`skp-dock-chip-tool` 小圆点色）；`total` 含 tools |
| `CapabilityPanel` props | 加 `toolRows`、`onBulk(action)`、`bulkState`（`idle/running/partial`） |
| `SessionCapabilityView`（`:2149-2211`） | 透传新 props（hero 与 view 同一组件，两处自动一致） |
| `totalCapabilities`（`:1966`） | `skillRows.length + mcpRows.length + toolRows.length` |
| `switchableCapabilities`（`:1969`） | 加 `toolRows.filter(row => !row.disabled).length` |
| `applyOptimistic`（`:1817-1837`） | 加 tools 分支 |
| `DecisionPanel`（`:1158-1379`） | 见 §8.5 |

**行 3 精确文案与状态（直接抄）**：

| 元素 | 值 |
|---|---|
| 按钮 | `全部开启` / `全部关闭`；执行中 `全部开启中…` / `全部关闭中…` |
| 计数 | `已启用 {n} / {m}`（m = 三域可开关单元总数） |
| 范围说明 | `仅当前会话 · 不改项目默认` |
| 按钮 tooltip | `作用于本会话的 Skills · MCP · Tools 三域整体` |
| 目标态禁用 tooltip | `已全部开启` / `已全部关闭` |
| 失败 | `{n} 项失败 · 重试`（红字；点击只重放失败域） |
| 进度 | `正在关闭 {done} / 3 个域…`（done = 已完成域数；**不**显示逐条进度，见 §6.2-8） |

### 9.4 `src/client/tools-panel.tsx`（**新增文件**）与 `panel.tsx`

> 任务书把"Tools 面板"列在 `mcp-panel.tsx` 下；本方案建议**新文件**：`mcp-panel.tsx` 已 1964 行且被 R4 占用，Tools 页复用 `.skp-list/.skp-row/.skp-detail` 类即可，不共享组件状态。若 Lead 要求合并，实现方可以等价放进 `mcp-panel.tsx`，契约不变。

| 部分 | 内容 |
|---|---|
| header | `全局工具注册 · 不区分项目 / 工作区`（UX §5.3）；右侧下拉 `全局工具 ▾`（禁用态占位，只有一项） |
| 左/中列 | 单元列表：插件名（单行 ellipsis）+ 标签（`插件` 紫 / `未识别` 琥珀）+ `N 个工具`；选中行蓝条；计数 `· {enabled} 启用 · 插件级开关（整插件生效）` |
| 右列详情 | 标题（示例 `dsh-univer-office`）+ 两枚标签（`插件` + 插件名/*未识别*）；右侧 `复制插件名`；meta `来源判定：前缀 univer_ → dsh-univer-office（插件清单映射表）· 注入方式：插件运行时注册的非 MCP 工具（不落盘）`；统计行 `工具数 {n} · 开关为插件级：关闭后该插件全部工具在本会话不可见`；**工具清单（只读）** `工具清单（{n}）· 只读`（行：工具名 Menlo 11 + 一句话说明；无参数表、无逐工具开关）；关闭影响琥珀条（文案见下） |
| 开关 | **只读（A5，与 v1.8 §5.3「开关 + `已启用`/`已关闭`」冲突，需 ux 确认）**：显示当前状态点/文字 `会话内开关在对话首屏设置`；不渲染可点开关（主面板无 sessionId，`src/client.ts:105-120`）。若最终选择"可写"，必须新增宿主 `activeSession` RPC（成本 +0.5d 且引入"改哪个会话"歧义，不推荐） |
| 空态 | `尚未发现插件工具` / 读不到 tools 服务：`当前外壳未提供工具注册表，无法列出插件工具` |
| `panel.tsx`（`:60, 94-100, 183, 223-245`） | `DomainTab` 加 `"tools"`；`DOMAIN_ORDER = ["skills","mcp","tools","jev"]`；`DOMAIN_LABEL.tools = "Tools"`；`counts.tools`（由 ToolsView 回填）；搜索 placeholder `搜索插件工具`；tools/Jev 域隐藏项目下拉；渲染分支 `domain === "tools" ? <ToolsView .../>` |
| `client.ts` locale | 若走 locale：补 `panel.domain.tools: "Tools"`；当前 `DOMAIN_LABEL` 硬编码在 panel.tsx（`:94-99`），**按现状加硬编码即可**（不改 locale 机制） |

**新增文案（frontend 直接抄）**：

- 关闭影响：`关闭该插件后，本会话模型看不到它的全部 {n} 个工具；能力决策（Jev）以插件整体计分，选中才会启用该插件全部工具；不改项目默认`
- 只有只读原因说明：`插件级开关，不提供单工具开关；宿主内建基础工具不进入本域`

### 9.5 `src/client/mcp-panel.tsx`（R4，详见 §7.6）

- `McpExternalRow`：两枚标签 / 单一 `外部注入` / `未识别`。
- `McpExternalDetail`：`来源判定`、`注入方式`（含"工具命名空间合成"）、只读说明补会话开关指引。
- 组内排序：`channel` 升序 → 无 channel 后置。

### 9.6 `src/client/jev-panel.tsx`（R5）

| 位置 | 改动 |
|---|---|
| `COPY.securityLead/securityPath/securityTail`（`:64-66`） | **删除三个键** |
| `COPY.batch` / `COPY.scope` / `COPY.privacy`（`:62-63, :67`） | 随 callout 一起删除（说明并入副标题） |
| `COPY.subtitle`（`:60`） | 改为两段（渲染为两行 `<p>`/`<span>`）：① `用 Jev 模型给 Skills、MCP 与 Tools 打分，自动选出与本轮草稿最相关的能力。` ② `一次请求完成；仅发送能力名称与描述（Tools 为插件名与工具说明摘要），草稿内容不落盘，结果只写当前会话。` ⚠️ ② 与实现冲突，**见 §11-R7 / A10** |
| `.skp-jev-note` 渲染块（`:600-606`） | 整块删除（删掉 4 个 span）；版面整体上移，卡片高 `740 → 672`（UX §7.1；实际高度由 CSS 决定，验收以"无 callout + Base URL 上移"为断言） |
| API Key ⓘ（`:710-760` 区域） | 在 `API Key` 标签右侧加 `ⓘ`（`aria-label="密钥存储说明"`，tooltip/`aria-describedby`：`密钥仅存宿主，不下发浏览器`）；保留现有 `apiKeyHint` 行（`:757`，另一处语义） |
| 其余 | Base URL / 模型 / 密钥模式 / 测试连接 / 恢复默认 / 保存配置语义**不改**（UX §7.1） |

### 9.7 `src/client/styles.ts`

| 新增类 | 用途 / 要点 |
|---|---|
| `.skp-dock-rail` | 行 3 容器：flex + gap 8 + min-height 36 + padding 6px 10px + radius 8 + `--dsw-alias-bg-module-platform` 底（**用 token，不抄 Figma 深色 `#1B1F27`**；本插件 dock 全量走主题 token，见 `:324-390`） |
| `.skp-dock-rail-btn` / `.skp-dock-rail-btn-primary` / `[aria-disabled="true"]` | 64×24 / 12px / 蓝描边强调 / 禁用白 4% 底 |
| `.skp-dock-rail-count` / `.skp-dock-rail-note` | 计数（tabular-nums）/ 弱说明 |
| `.skp-dock-rail-fail` | 红字 + 可点重试 |
| `.skp-dock-tag-unattributed` | 琥珀（与 `-bundled` 同色系） |
| `.skp-dock-tag-count` | 灰底小标签（`17 个工具`；dock 卡片里现有 desc 已够，只用于决策行/详情） |
| `.skp-dock-chip-tool` | 收起条 chips 圆点色（区别于 skill/mcp） |
| `.skp-decision-kind-tool` | 决策行 kind 标签（紫/琥珀） |
| `.skp-decision-toolcount` | 决策行 `N 个工具` 灰标签 |
| `.skp-tools-*`（可选，优先复用） | `.skp-list/.skp-row/.skp-detail` 已满足两栏；仅当"只读工具清单"需要区分运行时新增 `.skp-tool-list/.skp-tool-item` |

> 响应式：新增控件不得进"更多"菜单（UX §9 不变量）；920 内宽下 Tab 轨 3 个 + `能力决策`（112）+ `管理全部`（59）已占满（证据 §8），所以 R1 控件必须**换行到行 3**（本方案已如此），Tab 行不加重。窄容器（≤820/600）沿用现有容器查询；行 3 允许 `flex-wrap`（与 `skp-dock-tab-row` 当前无 wrap 不同，`styles.ts:337`）。

### 9.8 全站命名统一（UX §2.1 / E15，本批必做，可独立提交）

UX §2.1 的命名是**第四轮统一、全站生效**，不随某一个 R 走；本批必须一并完成，否则 E15/C-04 无法通过。范围 = **用户可见文案**（注释、内部变量名不动）：

| 旧 | 新 | 位置（用户可见） |
|---|---|---|
| `技能` | `Skills` | `panel.tsx:95` 域 Tab 标签、`:107` 搜索占位 `搜索技能…`、`composer-capability.tsx:1289` 决策行 kind 标签、`:615`/`:2041` 空态与 tooltip 里的"技能" |
| `MCP 服务器` | `MCP` | `mcp-panel.tsx` 的空态/分组标题/aria-label/弹窗标题（`grep -n "MCP 服务器" src/client`，当前 22 处，逐条判断是否用户可见）、`panel.tsx:108` 搜索占位、`composer-capability.tsx` 的空态文案 |
| `插件工具` | `Tools` | 本批新增文案不得出现旧词；历史文案若出现一并改 |
| `Jev 模型` | 不变 | — |

- 度量：`grep -rnE "MCP 服务器|插件工具|技能" src/client/*.tsx src/client.ts` 命中数中，**用户可见字符串**必须为 0（注释/文档字符串允许保留）；E15/C-04 的自动断言用该 grep + 白名单文件。
- 实现细节：`DOMAIN_LABEL` 仍硬编码在 `panel.tsx:94-99`（locale 机制未接管，见 `client.ts:35` 注释），直接在 map 里改 `skills: "Skills"` 并补 `tools: "Tools"`；`DOMAIN_SEARCH_PLACEHOLDER` 同步。
- 估时：0.5d（含 22 处 `MCP 服务器` 的逐条判断与两个空态回归）。

### 9.9 客户端改造顺序（与宿主解耦）

1. 先接 `api.tools`（类型 + adapter）+ 只读渲染 Tools Tab（宿主已就绪即可联调）。
2. 再上 control rail（R1）与 `session.setBulk`。
3. 再改 MCP 两枚标签（R4 宿主字段就绪后）。
4. 最后 Jev 结果行/apply plan。
5. R5 独立（只动 `jev-panel.tsx` + COPY）。

---

## 10. 测试设计（交给 tester）

### 10.1 测试载体与运行方式

- 仓库**没有**单测框架（`package.json` 无 test 脚本）；本地回归套件是 `notes/verify/run-all.sh` + `notes/verify/*.mjs`（gitignore，见 `AGENTS.md`「本地回归套件」与 `notes/verify/run-all.sh`）。
- 约定沿用：脚本内 `check(id, desc, pass, detail)` 收集断言，失败非零退出；编译到 `notes/verify/tmp/build`（`npx tsc -p notes/verify/tsconfig.verify.json`），宿主侧用假 ctx（参考 `notes/verify/loader-behavior.mjs`），客户端用 `react-dom/server` SSR + jsdom（参考 `notes/verify/capability-dock-render.mjs`）。
- 新增脚本（建议命名，全部落 `notes/verify/`，不进版本库）：
  - `v13-tools-domain.mjs`（TH/TU 段）
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

### 10.4 Tools UI（TU，SSR + 真机点选）

| # | 断言 |
|---|---|
| TU-01 | `CapabilityPanel` SSR：三 Tab（`Skills` / `MCP` / `Tools`），计数各为 `x / y`；Tools 计数按**插件数** |
| TU-02 | Tools 卡片：标题单行 ellipsis、描述 `{n} 个工具 · 插件注入`、只有一枚 `插件` 标签（未识别卡为 `未识别`）、整插件开关 |
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
| J-01 | 枚举：`capabilitiesTotal` = skills + mcp + tools（Tools 候选 = **已识别**插件数，本机 6；未识别单元被剔除）；Tools 项 `kind:"tool"`、`toolCount` 正确 |
| J-02 | 请求体：Tools 题 `capability.kind="tool"`、`capability.tools` ≤ 8 条且总码点 ≤ 500；不含 `parameters`；不含草稿以外的隐私内容（除 draft 外无新字段） |
| J-03 | 结果：Tools 行按分数降序混排；`已选 x / total` 与勾选数一致；`toolCount` 标签渲染 |
| J-04 | apply 选中插件：整插件写 `enabled:true`（一个 unit 一次调用）；未选中插件 → `enabled:false`；`enabled/disabled` 计数 = 单元数 |
| J-05 | 只收窄：用户先手动关闭的插件不在选中集 → 不因 apply 被打开（`already-applied`）；不可应用锁定项不被写 |
| J-06 | 回滚：注入 tools 写入失败 → 前面已写项按前态逆序恢复（含 tools 的 `enabled` 快照）；`failed[]` 给出该 unit |
| J-07 | 冷会话：apply 入队（`pending:true`），`agent/created` 后重放，Tools 开关落盘且 restrict 生效 |
| J-08 | 旧宿主/无 tools 服务：枚举跳过（无 Tools 行），skills/mcp 仍可评分应用 |
| J-09 | 计划校验：伪造 `kind:"tool"` 但 id 不存在 → `unknown-id` skipped，不写任何状态 |
| J-10 | 阈值：改动阈值只改预勾选，不改变已手动勾选行；`应用所选（x）` 与 `已选` 同步 |

### 10.7 R5 文案（C）

| # | 断言 |
|---|---|
| C-01 | Jev 配置页无 callout：DOM 不含 `~/.dsh/dsh-capability-settings/jev.json`、`目录 700`、`一次请求给全部能力打分`、`全局配置 · 所有项目和会话共享` 等旧串 |
| C-02 | 副标题两行文案逐字匹配（含 Skills / MCP / Tools 与 Tools 隐私说明）；**若 A10 未决，本用例暂按待定文案跳过并在报告标 open** |
| C-03 | API Key 标签右侧 `ⓘ` 存在，tooltip 含 `密钥仅存宿主，不下发浏览器`；`apiKeyHint` 行仍在 |
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
| E2E-08 | 能力面板 Tools 页 | 两栏、无左导航、插件行+详情、工具清单只读、（A5）开关只读并说明 |
| E2E-09 | 能力决策含 Tools | 结果行三域混排（Tools 行为插件单元）、`已选 x / total` 一致、应用后插件开关生效（含"未选中=关"） |
| E2E-10 | Jev 配置页 | 无 callout、副标题两行、API Key ⓘ、其余项语义不变 |
| E2E-11 | 收缩窗口（920 / 1080 / 窄屏） | 行 3 四控件可见（R2 未实现时只有批量控件）、无截断/溢出 |
| E2E-12 | 命名统一走查 | 会话面板/主面板/决策面板/Jev 页均无 `技能` / `MCP 服务器` / `插件工具`（历史段落除外）；`Skills`/`MCP`/`Tools`/`Jev 模型` 四处一致 |

---

## 11. 风险与降级

| # | 风险 | 严重度 | 触发条件 | 缓解 / 降级 |
|---|---|---|---|---|
| R1 | **restrict 失败或名单过期**：工具在 restrict 之后才注册（插件懒加载），首轮名单漏网 | 中 | `restrict` 抛错 / 工具后注册 | 已设计 `tools/change` 重算 + 幂等短路（§5.2）；失败只降级 `failed` 状态，不阻断。验收 TH-08/TH-10 |
| R2 | **错误关闭宿主内建工具**：排除清单漏项（宿主升级新增工具）→ 落入"未识别"单元 → 用户可关掉基础工具 | **高** | 宿主版本升级 | ①排除清单随宿主版本复核（release checklist）；②`tools.list.excludedBuiltinCount` + 金丝雀测试 TH-03；③A4 若拍板为"未识别只读"则彻底消除；④未识别单元关闭文案显式警告 |
| R3 | **归属误判**：前缀规则过宽（如未来 `rwx_*` 被 `rw_` 吃掉）→ 归错插件、关错工具 | 中 | 新插件命名冲突 | 分隔符边界匹配（`_`/`-`）+ exact 优先 + 单测边界用例；误判只影响展示分组，关闭影响该插件全部工具（用户可识别） |
| R4 | **枚举不到工具**（无 tools 服务/旧外壳/agent 作用域工具） | 中 | 旧外壳、headless | `tools.list` 返回空 + `errors`，UI 空态说明；不阻断 skills/mcp；agent 作用域工具**不显示**（与 UX §5.4 的置灰差异已在 §2.2 标注；E8 走查改法 = TU-11） |
| R5 | **UX §5.4「无法 restrict → 置灰」在本批不可达**：agent 自身层工具枚举不到 | 低（规格偏差） | — | 记为规格修正，需 ux 同步（A5 同批沟通）；本批保留 `lockedReason` 渲染路径，R2 后可能用上 |
| R6 | **批量部分失败留下中间态** | 中 | 单项失败 | 明确"不回滚"（A7）+ 失败项可重试 + 幂等重放；UI 显示失败计数（UX S5）；不弹模态 |
| R7 | **R5 文案与实现冲突**：副标题称"仅发送能力名称与描述"，实际 `rank` 发送输入框草稿（`src/jev/rank.ts:229` `state.request = draft`） | **高**（隐私口径） | 文案定稿 | **A10 待拍板**：①改文案为「仅发送能力名称、描述与输入框草稿（不落盘）」；②或改实现（会破坏相关性评分，不推荐）。未定前 C-02 标 open |
| R8 | **降级旧版插件**：旧版读同一 `session-capabilities.json` 会忽略 `tools`，但**旧版写回时可能只保留已知字段**（提案 §4.2 已警告）→ 用旧版改过开关后 `tools` 丢失 | 中 | 用户回退旧版或混装 | 文档标注"降级会丢 Tools 开关（回默认开启）"，不承诺降级保状态；与 R2 的 `agentPolicy` 同一处理 |
| R9 | **展示名即持久化键**：映射表改名 → 旧会话状态成孤儿（回默认） | 低 | 未来改名 | 映射表冻结 + 改名走 CHANGELOG「设置迁移」说明；孤儿键无害（不命中） |
| R10 | **`session.setBulk` 与单条 RPC 并发**：用户点批量时另有行开关写入 | 低 | 并发点击 | 宿主同 session 串行队列（§6.3）；UI 执行中置灰行开关（UX S4） |
| R11 | **Jev 插件级语义误解**：用户以为"选中插件 = 用它的某个工具" | 低 | — | 结果行 `N 个工具` 标签 + 底部说明 + 应用 toast（"启用 N 项"）；UX E17/E19 |
| R12 | **性能**：三域批量 150+ 写；mcp 每条重挂 | 中 | R1 首次执行 | mcp 批量写后只重挂一次（§6.2-4）、state 批量落盘（§3.1）；`dryRun` 与 `elapsedMs` 可观测；B-12 设 3s 基线 |
| R13 | **`tools.list` 体积**：17 插件 × 工具清单下发给浏览器 | 低 | 插件很多时 | 只下发 name + 200 码点 description；工具清单仅在详情页需要 → 也可拆 `tools.list`（单元摘要）+ `tools.detail`（工具清单）；本批数据量小，**不拆**，留扩展点 |

---

## 12. 分阶段提交建议与工作量

### 12.1 阶段（每阶段可独立验证、独立回滚）

| 阶段 | 内容 | 涉及文件 | 验证 | 估时 |
|---|---|---|---|---|
| P1 | **归属表 + Tools 宿主域 + 持久化 + `tools.*` RPC**（无 UI） | 新增 `src/shared/plugin-attribution.ts`、`src/tools/{types,manager,restrict}.ts`；改 `src/session-state.ts`、`src/index.ts`、`src/remote.ts` | TH-01..TH-12；REG-05/06；`pnpm typecheck` | 1.5d |
| P2 | **R1 `session.setBulk`**（含 `state.setToggles`、`loader.setSessionEnabledMany`、skills/mcp/tools 三域批量） | 新增 `src/session-bulk.ts`；改 `src/remote.ts`、`src/mcp/loader.ts`（内部批量方法）、`src/index.ts` | B-01..B-12；REG-01..04 | 1.0d |
| P3 | **R4 第三发现路径 + 字段**（宿主 + MCP 面板/首屏标签） | 改 `src/mcp/runtime.ts`、`src/mcp/manager.ts`、`src/mcp/types.ts`、`src/client/api.ts`、`src/client/mcp-panel.tsx`、`src/client/composer-capability.tsx`（McpRow/channel） | R4-01..R4-08；REG-02/03 | 0.5d |
| P4 | **首屏/会话 Tab 第三域 + 行 3 控制条**（R1 UI + R3 UI） | 改 `src/client/composer-capability.tsx`、`src/client/api-adapter.ts`、`src/client/api.ts`、`src/client/styles.ts` | TU-01..TU-09、TU-12/TU-13；E2E-01..03 | 1.5d |
| P5 | **能力面板 Tools 页**（两栏 + 详情 + 只读工具清单） | 新增 `src/client/tools-panel.tsx`；改 `src/client/panel.tsx`、`src/client/styles.ts` | TU-10、TU-11、E2E-08 | 0.75d |
| P6 | **Jev 纳入 Tools**（宿主枚举/写入/请求 + 客户端结果行/apply） | 改 `src/jev/{types,apply,rank}.ts`、`src/index.ts`、`src/client/api.ts`、`src/client/composer-capability.tsx`、`src/client/styles.ts` | J-01..J-10；REG-07；E2E-09 | 1.0d |
| P7 | **R5 文案 + 全站命名统一**（jev-panel 删 callout / 副标题 / ⓘ；`技能→Skills`、`MCP 服务器→MCP`、`插件工具→Tools`） | 改 `src/client/jev-panel.tsx`、`panel.tsx`、`mcp-panel.tsx`、`composer-capability.tsx`（文案）+ `styles.ts`（若高度相关） | C-01..C-04；E2E-10/E2E-12 | 0.75d |
| P8 | **回归 + 真机验收** | `notes/verify/*.mjs`、`notes/real-gui-evidence/v13/`、README/CHANGELOG | REG-01..08；E2E-01..12 | 1.5d |

**合计 ≈ 8.5d**（含验收），净开发 ≈ 7.0d。若 P1 的 `schemas()` 真机枚举（[待验证]）发现大量未识别工具，P1 追加 0.25–0.5d 补映射。

### 12.2 提交切分与依赖

```
P1 ──▶ P2 ──▶ P4 ──▶ P5 ──┐
 └──▶ P3 ──────────┘        ├──▶ P8
 └──────────────────▶ P6 ──┤
P7 独立（只动 jev-panel）───┘
```

- 每个阶段**一次提交**（中文 commit，正文写根因/方案/验证命令与真实输出，仓库纪律见 `AGENTS.md`「变更纪律」）。
- P1/P2 是纯宿主，可先合入并跑回归；P3 的 MCP 字段 additive，旧 UI 不崩；P4/P5 UI 依赖 P1–P3；P6 依赖 P1（tools 服务）与 P4（UI 行渲染）。
- **R2 不在本批任何阶段**；P1 的 `applyForAgent` 抽取是唯一为它留的接口约束。

### 12.3 文档同步（实现阶段，不在本任务）

- `README.md`：三域说明（Skills / MCP / Tools）、插件级开关语义、R1 批量、MCP 来源两枚标签、Jev 含 Tools；**明确写"R2 派生继承未实现"**（避免把提案当现状）。
- `CHANGELOG.md` `[Unreleased]`：按新增 / 修复 / 变更 / 内部 分节；必须写清降级路径（旧版丢 `tools` 字段、agent 层工具不可见、批量不回滚）。
- 若 Figma 帧 03/06 与本方案有偏差（主面板 Tools 开关只读 = A5），按仓库纪律在实现后同步设计稿，并在 CHANGELOG 注明设计变更。

---

## 附录 A · RPC 与类型契约汇总（实现对照表）

| endpoint | 方向 | 入参 | value 成功 | value 业务失败 | 状态 |
|---|---|---|---|---|---|
| `tools.list` | 新 | `{sessionId?: string}` | `ToolsListView` | `{ok:false,errors}` | P1 |
| `tools.setSessionEnabled` | 新 | `{sessionId:string, units:string[], enabled:boolean\|undefined}` | `{ok:true,applied:number}` | `{ok:false,errors}` | P1 |
| `session.setBulk` | 新 | `SessionBulkInput` | `SessionBulkResult` | `{ok:false,errors}` | P2 |
| `mcp.runtime` | 改（additive） | 现有 `{cwd?,sessionId?}` | 现有 + `channel?/attribution?/synthesized?`、`origin:"namespace"` | 不变 | P3 |
| `skills.*` / `mcp.*` / `overrides.*` / `jev.*` | 不变 | — | — | — | — |

**宿主内部新增（非 RPC）**：

| 方法 | 位置 | 用途 |
|---|---|---|
| `SessionStateStore.tools(sessionId)` / `setTool(...)` / `setToggles(...)` | `src/session-state.ts` | Tools 持久化 + 批量落盘 |
| `loader.setSessionEnabledMany(input)` | `src/mcp/loader.ts` | R1 mcp 域批量（一次 hydrate + 一次重挂） |
| `createSessionBulk(deps)` | `src/session-bulk.ts` | R1 实现 |
| `scanInjectedMcpNamespaces(ctx, exclude)` | `src/mcp/runtime.ts` | R4 第三路径 |
| `attributeTool` / `attributeMcpNamespace` / `displayNameOfSource` / `isHostBuiltinTool` | `src/shared/plugin-attribution.ts` | 归属单一事实源 |
| `applyForAgent(agent, sessionId, toggles)` | `src/tools/manager.ts`（内部导出） | Tools restrict 应用（R2 复用点） |

## 附录 B · 文件级改动矩阵（实现清单，防漏改）

| 文件 | 类型 | 改动摘要 | 阶段 |
|---|---|---|---|
| `src/session-state.ts` | 改 | `tools` 域 + `tools/setTool/setToggles` + sanitize/empty/writeToggle | P1 |
| `src/shared/plugin-attribution.ts` | 新 | 映射表 / 归属 / 内建清单 / 命名空间表 | P1 |
| `src/tools/types.ts` | 新 | `ToolsListView` 等（宿主） | P1 |
| `src/tools/manager.ts` | 新 | 枚举、会话记录、hydrate、restrict 应用、`tools/change`、生命周期 | P1 |
| `src/tools/restrict.ts` | 新（可选拆分） | deny 计算 + 幂等短路（照 `loader.ts:486-579` 范式） | P1 |
| `src/index.ts` | 改 | 装配 `tools` 服务、注入 jev、`applyForAgent` 依赖 | P1 |
| `src/remote.ts` | 改 | 3 个 endpoint + `PanelRpcService` 扩展 | P1/P2 |
| `src/session-bulk.ts` | 新 | 批量端点实现（三域 + reset + dryRun + 串行） | P2 |
| `src/mcp/loader.ts` | 改 | `setSessionEnabledMany`（只加方法，不改现有语义） | P2 |
| `src/mcp/runtime.ts` | 改 | 第三路径 + `origin` 联合扩展 + 合并顺序 | P3 |
| `src/mcp/manager.ts` | 改 | `runtime()` 合成行/来源/channel/attribution | P3 |
| `src/mcp/types.ts` | 改 | `McpRuntimeServerView` additive 字段 + 联合值 | P3 |
| `src/client/api.ts` | 改 | 类型镜像 + `ToolsApi`/`SessionApi` + Jev kind/toolCount | P3/P6 |
| `src/client/api-adapter.ts` | 改 | 新方法接线 | P3/P4 |
| `src/client/mcp-panel.tsx` | 改 | R4 两枚标签/来源判定/合成文案 | P3 |
| `src/client/composer-capability.tsx` | 改 | ToolRow/Tab/rail/controller/bulk/McpRow.channel/Jev 行/apply | P4/P6 |
| `src/client/tools-panel.tsx` | 新 | 主面板 Tools 两栏只读页 | P5 |
| `src/client/panel.tsx` | 改 | 第四域 Tab（Skills/MCP/Tools/Jev） | P5 |
| `src/client/jev-panel.tsx` | 改 | R5 文案 | P7 |
| `src/client/styles.ts` | 改 | rail / tag-unattributed / kind-tool / toolcount / chips | P4–P6 |
| `src/jev/types.ts` | 改 | kind/write/prev/toolCount 扩展 | P6 |
| `src/jev/apply.ts` | 改 | 枚举第 4 段 + 写入/回滚/并发组 | P6 |
| `src/jev/rank.ts` | 改 | kind 联合、guidance、toolCount、三档排序 | P6 |
| `README.md` / `CHANGELOG.md` | 改 | 行为与降级说明（R2 未实现必须写明） | P8 |

## 附录 C · 待验证清单（谁验 / 怎么验 / 降级）

| # | 待验证 | owner | 验证方式 | 降级口径 |
|---|---|---|---|---|
| V1 | `ctx.get("tools").schemas()` 真机条数与名单（证据 §10 #1 仍未取到） | tester（P1 后） | `tools.list` 落 JSON 证据（`notes/verify/out-tools-enumeration.json`） | 未覆盖名字归"来源未识别"；A4 按推荐值 |
| V2 | `tools.restrict` 对插件工具实测成功（非 MCP） | tester（P1） | TH-08 + 真机 E2E-04（模型侧 UNKNOWN_TOOL） | 失败 → `failed` 状态 + UI 提示；不阻断其它域 |
| V3 | R1 批量耗时（150+ 条） | tester（P2） | B-12 真机计时 | >5s → 排查逐条重挂/逐条写盘（§6.2-4/5） |
| V4 | hero 实际宽度（920/952）与行 3 是否溢出 | tester（P4） | `getBoundingClientRect` + E2E-11 | 窄容器下行 3 允许换行（`flex-wrap`），不得进"更多"菜单 |
| V5 | 旧版插件读回 `tools` 是否丢字段（R8） | backend/tester（P2） | 用旧 `lib/` 版插件写一次开关后检查文件 | 标注为已知降级，不修 |
| V6 | `figma` namespace 行在真机的 `calls`/工具清单是否完整 | tester（P3） | E2E-07 + 主面板详情 | 工具清单为空时仍显示来源两枚标签（信息不全但不错标） |
| V7 | R5 文案定稿（A10） | ux/Lead | 用户确认 | 未定前 C-02 open |

---

## 附录 D · 参考

- UX：`docs/ux/capability-v13.md`（**v1.8**；§2.1 命名 / §2.3 三域 / **§2.4 域边界** / §3 R1 / §4 R2 布尔继承 / §5 R3 / §6 R4 / §7 Jev / §10 E1–E21 / §12 D1–D11）
- 证据：`docs/research/capability-v13-evidence.md`（§2 枚举与归属 / §3 restrict 契约 / §4 MCP 来源 / §5 首屏 / §6 R2 / §7 R5 / §9 结论 / §10 待验证）
- R2 提案：`docs/architecture/agent-capability-inheritance.md`（§1.2 / §4.2 / §5.1）
- 既有范式：`src/mcp/loader.ts`（restrict + 会话记录）、`src/session-state.ts`（持久化）、`src/jev/apply.ts`（批量/回滚/冷会话排队）、`src/skills/registry.ts`（来源 channel 分类表）
- 设计源：Figma 页 `Capability Panel · 全局开关与派生 v13`（帧 01–08；与本文 A5/A10 的偏差需同步设计稿）
