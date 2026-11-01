# 能力套装（Capability Pack）· 设计（提案 v4）

- 状态：**提案，未实现**（2026-10-30 修订）
- 证据约定：`[宿主]` = 已安装 `app.asar`（DSH 0.2.1-rc.3）解包实读；`[本仓]` = 本仓库源码；
  `[外部]` = 官方文档/仓库（URL 见 §12）

**v4 的核心变化**（按「dsh-to-figma 是一个套装」这条纠正）：

- 套装有两种来源，**同一个概念**：
  - **派生套装（derived）**：一个插件/来源一次性带来的整组能力（skill + mcp + tool），
    按归属自动成组，**零配置、随安装/卸载出现与消失**；
  - **用户套装（user）**：用户自己挑的跨来源组合，存盘、可编辑。
- 派生套装**不落盘、不持有状态**：它的成员每次实时计算，所以插件改名/卸载不会留残留。
- 归因不需要新造：`src/shared/plugin-attribution.ts` 已经是三域共用的单一事实源，
  三域对 `dsh-to-figma` 的口径本来就一致（§1）。
- Jev 的评分集合按「套装 + 未归属能力」折叠，`dsh-to-figma` 从 3 条候选变成 1 条。

---

## 0. 结论（TL;DR）

1. **套装 = 一组能力的具名分组**：`{ id, title, description, members[] }`。
   members 是 skill / mcp / tool（将来 prompt）的引用；套装**不持有**任何会话状态。
2. **两种来源**：`derived`（按插件归属自动聚合，只读）与 `user`（用户手配，落盘）。
   二者在面板、会话开关、Jev 里**表现为同一类东西**。
3. **勾套装 = 勾成员**：应用就是把成员逐个打开（**additive**，不动非成员）；取消逐个关闭。
   会话里仍然只有成员自己的显式开关（`session-capabilities.json`），没有 pack 状态。
4. **成员可多归属**：一个能力可以同时出现在派生套装和用户套装里，勾选多套 = 并集。
5. **Jev 里是一等候选**：`kind:"pack"`。被单一套装覆盖的成员**折叠**（不再单独评分），
   多归属或未归属的能力照常单独评分。
6. **元数据边界**：`title` / `description` 只进面板 UI 与 `jev.rank` 请求体，
   **不进 coding model 上下文**。

---

## 1. 为什么 `dsh-to-figma` 这个例子定住了设计

仓库里其实已经做完了"三域同源"这件事，只是没有把它呈现成一个单元：

| 域 | 归属字段 | `dsh-to-figma` 的取值 | 代码 |
|---|---|---|---|
| Skills | `provider` / `channel` | `dsh-figma` → `channel = "dsh-to-figma"` | `[本仓]` `src/skills/registry.ts:534-536` |
| MCP | `source` / `channel` | `dsh-figma` → `"dsh-to-figma"`（`SOURCE_DISPLAY` 映射；无实例时按命名空间 `figma` 归组） | `[本仓]` `src/shared/plugin-attribution.ts:96-97`、`MCP_NAMESPACE_RULES` |
| Tools | `unit` / `attribution.packageName` | `dsh-to-figma`（`figma` / `figma_*` 规则） | `[本仓]` `src/shared/plugin-attribution.ts:50-51` |

`plugin-attribution.ts` 的注释写得很明确：Tools 的 `display` 是
「Tools 单元 id 与卡片标题；**与 Skills 的 channel 同口径**」，MCP 的 `display` 也
「与 Skills 侧 `dsh-to-figma` 同口径」。也就是说——

> **"插件 = 一个套装"这件事，归因层已经成立；缺的是把它们收成一个可开关、可评分、
> 可见的单元。**

反过来说，如果只做"用户手配套装"，`dsh-to-figma` 的能力会继续散在三个域里，
用户仍然要记住"这个插件的技能在这里、MCP 在那里、工具又在第三处"——那正是
这套面板要解决的问题，而不是绕开它。

---

## 2. 分层与定位

| 概念 | 层级 | 作用 | 和套装的关系 |
|---|---|---|---|
| 宿主 **agentPreset** `[宿主]` | 部署/进程 | 一整棵隔离插件树 | 不复用：重、要重装、引用不到面板现有条目 |
| DSH **bundle**（`dsh.bundle`）`[宿主]` | 包管理 | 装插件包 | 无关，只是名字不能占 |
| 本插件三域 skill / mcp / tool `[本仓]` | 能力项 | 单项开关 | 套装的成员 |
| **套装** | 用户数据 + 选择层 | 一组能力的具名分组（自动或手配） | 新增 |
| **Jev** `[本仓]` | 决策层 | 对草稿打分，勾选后应用 | 套装是一类候选单元 |

**边界**：套装是"选择集"，不是容器、不是状态。删掉套装不改变任何能力开关；
改套装不影响已经应用过的会话；派生套装随插件存在，插件没了它就没了（无需清理）。

---

## 3. 数据模型

### 3.1 两种套装，一套形状

| | 派生套装（derived） | 用户套装（user） |
|---|---|---|
| 定义 | 同一归属键下的全部能力 | 用户手挑的成员 |
| 成员来源 | 实时计算（`skills/mcp/tools` 的归属字段） | 存盘 |
| 存储 | **不落盘** | `~/.dsh/dsh-capability-settings/capability-packs.json` |
| `id` | `ds:<packageName>`（稳定、可读） | `pk_<12 位 hex>` |
| `title` | 包名（`dsh-to-figma`） | 用户填 |
| `description` | 插件 `package.json` 的 `description`（attribution 扫描已读） | 用户填 |
| 可编辑 | 只读（可隐藏） | 可增删改 |
| 生命周期 | 随插件安装/卸载自动出现/消失 | 用户删除才消失 |

两者共享 `members[]` 与可用性模型，所以在 UI/开关/评分里是同一类东西。

### 3.2 用户套装文件

```
~/.dsh/dsh-capability-settings/capability-packs.json
```

```jsonc
{
  "schemaVersion": 1,
  "packs": [
    {
      "id": "pk_9f3c2a17b4e0",
      "title": "前端排障",
      "description": "React/Vite 构建与运行时问题：先定位再复现，读日志并用浏览器验证。",
      "members": [
        { "kind": "skill", "ref": "react-debugging" },
        { "kind": "mcp",   "ref": "server:playwright" },
        { "kind": "tool",  "ref": "plugin:dsh-remote" }
      ],
      "createdAt": "2026-10-30T13:00:00.000Z",
      "updatedAt": "2026-10-30T13:00:00.000Z"
    }
  ],
  "hiddenDerived": ["ds:dsh-univer-office"]
}
```

- `hiddenDerived`：用户可以把不关心的派生套装（如随包 Office）从列表与 Jev 候选中隐藏；
  只是展示过滤，不改任何能力状态；
- 写入走 `shared/atomic-write.ts` + `shared/file-lock.ts`（同 `session-state.ts`）。

### 3.3 member 引用语法

| kind | ref 形式 | 解析依据 | 约束 |
|---|---|---|---|
| `skill` | `<skill name>` | `skills.sessionList(cwd, sessionId)` | 与 Jev `cap_*` 同源 |
| `mcp` | `server:<serverName>` / `project:<config key>` | `mcp.list` / `mcp.runtime` | **只存名字**，绝不落 `command`/`args`/`url`/`env` |
| `tool` | `plugin:<unit>` | `tools.list` 的 `unit` | 插件单元 = 一个开关 |
| `prompt` | `prompt:<id>` | 预留 | 未实现时跳过并报 `unsupported-kind` |

### 3.4 校验

- `id`：用户套装匹配 `^pk_[0-9a-f]{12}$`；派生套装由归属键生成，不落盘；
- `title` 1–60、`description` 1–200 字符（与 Jev 的 200 码点截断一致）；
- `members` 1–50 条，同 pack 内 `kind+ref` 去重；跨 pack 允许重复（多归属）；
- 未知 `kind` 保留但标 `unsupported`。

---

## 4. 派生套装的聚合规则

### 4.1 归属键

- 优先 `packageName`（tools 的 `attribution.packageName`、MCP 命名空间/来源映射的
  `packageName`）；
- 退化到展示名（`channel` / `unit`），与现有面板徽标同一口径；
- 归属键为 `"__unattributed__"` 的能力**不生成派生套装**，进「未归组」（§4.3）。

### 4.2 成员与状态

派生套装的成员 = 三域里归属键相同的全部条目：

```
ds:dsh-to-figma
  ├─ skill: figma-...            （provider dsh-figma）
  ├─ mcp:   figma（server 或命名空间）  （channel dsh-to-figma）
  └─ tool:  plugin:dsh-to-figma   （figma_* 规则）
```

- 每个成员照常跑 §4.4 的可用性解析；
- 派生套装的开关态**实时从成员算**：全开=已开，部分开=部分，全关=未开；
- **不写 pack 状态**，所以插件改名不会丢状态（这点和 `plugin:<unit>` 持久化键相反：
  那个改名会回落默认，这里天然免疫）。

### 4.3 未归组

- 面板给一个「未归组」桶：所有不属于任何派生套装、也不在用户套装里的能力；
- 用户可以从这里勾选能力新建用户套装（这是"手配"的主要入口）；
- 归因是**启发式**（名字前缀表 / provider 映射 / runtime 来源），可能漏；「未归组」
  就是漏网的可见兜底，而不是静默丢。

### 4.4 可用性（不是状态）

| 状态 | 含义 | UI |
|---|---|---|
| `ok` | 可解析、可写 | 正常 |
| `missing` | 当前项目/全局都没有这个名字 | 灰 + 「移出」 |
| `hard-disabled` | 配置 `disabled`（硬关闭） | 灰 + 说明开不了 |
| `not-toggleable` | 按 agent 作用域注入的 MCP，`tools.restrict` 契约不允许 | 灰 + 「由 XX 注入，无法开关」 |
| `unsupported-kind` | 未来 kind | 灰 + 「本版本不支持」 |

派生套装里出现 `not-toggleable` 成员很常见（某些插件在 agent 层注入 MCP）。
整体开关时跳过并提示 `n 个成员无法开关`，不假装成功。

---

## 5. 应用语义

### 5.1 勾选 = 逐成员打开（additive）

```
packs.apply { sessionId, cwd?, packId, action?: "on" | "off" }
  → 解析成员（逐条给可用性）
  → 只对可应用成员写 setSessionEnabled(true|false)
  → 返回 { enabled, disabled, skipped[], unchanged }
```

- **additive**：只动成员，不动任何非成员；
- 复用 `[本仓]` `src/jev/apply.ts` 的 `executeOps`（skills / mcp / tools 各自的
  `setSessionEnabled`），不新造写路径；
- 不写 pack 级状态；「取消」= 同样的清单写 `false`（不区分"关掉"与"恢复默认"，保持简单）。

### 5.2 幂等 / 部分失败 / 冷会话

- 幂等：已开的成员进 `unchanged`；
- 部分失败不回滚：逐条 `failed[]`，重试 = 重放；
- 冷会话：复用 Jev 的 `PendingPlan` 排队（`[本仓]` `src/jev/apply.ts` §8）。

### 5.3 多归属与并集

- 同一能力可属于多个套装，勾多个 = 并集，按 `kind+ref` 去重后只写一次；
- 取消某个套装只关它自己的成员（不推断其它套装是否还需要），保持可预测。

### 5.4 与 Jev 筛选语义的区别

- **手动勾套装**（面板 / 胶囊）：additive，只开成员；
- **Jev 应用**：沿用现有筛选语义（勾的开、其余可应用关）。套装在 Jev 里只是
  "一次勾上多个成员"的快捷方式，不改变 Jev 的整体语义。

---

## 6. Jev 集成

### 6.1 候选集合（折叠规则）

```
候选 = 全部派生套装（未隐藏、至少 1 个可用成员）
     + 全部用户套装
     + 未被任何套装单独覆盖的能力（多归属成员、未归组能力）
```

- **被单一套装覆盖的成员折叠**：它已经被套装代表，再单独出现是噪声；
- **多归属成员不折叠**：它属于多个集合，没有唯一的代表，保留独立行；
- 效果：`dsh-to-figma` 从 3 条候选（skill + mcp + tool）变成 **1 条**；
  成本不升反降；
- 设置项 `showPackedMembers`（默认 false）：想看细粒度时全展开。

### 6.2 请求

- `state` 增加 `packs: [{ id, kind: "derived"|"user", title, description,
  members: [{kind, name}] }]`；
- 每个 pack 一条 Noul，与能力条目同构：

```
"This is a pack: a bundle of skills, MCP servers and plugin tools that ship together."
"Judge whether the pack AS A WHOLE helps with the draft."
```

- 派生套装的 `description` 用插件包描述（读不到时退化为
  `1 个技能 · 1 个 MCP · 8 个工具` 的计数文案）；
- pack 的 `applicable` = 至少 1 个成员可应用；`enabledInSession` = 全部可应用成员都开。

### 6.3 应用（客户端展开，宿主零改动）

- 客户端把勾选的 pack 展开成成员 id，并入 plan 一起提交（按 id 去重）；
- 宿主 `jev.apply` 不感知 pack：它拿到的仍是一组能力 id；
- 这样"勾套装 = 勾成员"在 Jev 路径上也不需要新写路径。

### 6.4 结果 UI

- pack 行可展开显示成员（只读 + 状态）；
- 勾 pack → 自动勾上其成员行（折叠时这些行本来就不可见）；
- 取消勾选某成员（展开模式下）→ pack 变半选。

---

## 7. UI 落点

| 位置 | 职责 |
|---|---|
| 面板新增域 Tab **「套装」**（`Skills / MCP / Tools / 套装 / Jev 模型`） | 管理：两段列表——「由插件提供」（派生，只读 + 隐藏开关）、「我的套装」（可编辑）；详情显示成员按 kind 分组 + 状态；「未归组」桶可勾选建新套装 |
| 会话「能力」页 / 首屏配置弹窗 | 使用：一排套装胶囊（点击 = additive 应用；再次点击 = 关闭），显示 `n/m`（实时算） |
| Jev 结果面板 | 评分：pack 行 + 展开后的成员行 |

- 选 Tab 而非"能力页里的 section"：现有 Tab 的分类轴就是能力项类型，套装是第四类，
  且管理动作（列表/详情/增删改）与三域同构；顺序体现 `来源 → 组合 → 决策`。
- 代价：`panel.tsx` 的 `DomainTab` / `DOMAIN_ORDER` 加一项；`notes/verify/render-smoke.mjs`
  的域 Tab 断言要改。
- **不进首屏 hero 行**（那行已有「标准模式」= 宿主 preset 选择器，会混淆）。

---

## 8. 元数据边界（硬不变量）

> 套装的 `title` / `description` 只进 Jev，不进 coding model 上下文。

允许：面板 UI（本地渲染）、`jev.rank` 请求体（脱敏 + 200 码点截断后出站）。

禁止：不注册任何 `systemPrompt.section`；不改任何 skill / MCP / tools 的 `description`；
不写 `AGENTS.md` / `CLAUDE.md` / `.mcp.json`；不注入输入框、不进会话标题、不进
`tools.restrict` 名单。

守卫：`src/packs/*` 不 import `systemPrompt` / tools 注册 API；出站文本走
`[本仓]` `src/shared/descriptor-text.ts` 的 `sanitizeDescriptorText`；评审用 grep 断言。

推论：不触发宿主 model-visible ⟺ logged 规则，不需要会话日志，工具表与提示词段零变化。

---

## 9. 安全

1. **纯数据、无执行面**：不含 `command` / `args` / `env` / prompt 正文 / 脚本；
2. **派生套装不信任插件自报**：成员完全由本插件的归因逻辑算出来，插件无法通过
   声明把别人的能力塞进自己的套装（将来的可选声明只能提供 title/description，
   不能提供 members）；
3. **导入可审计**：`packs.import` 先出预览 `{added, conflicts, missing[], unsupported[]}`，
   确认后落盘；`id` 撞车 → 新建副本；
4. **不提权**：套装只能打开"本来可用"的能力；硬关闭与不可 restrict 的一律跳过。

---

## 10. 分期与工作量（粗估）

| 期 | 内容 | 估 |
|---|---|---|
| **MVP-A（派生聚合 + 管理）** | `src/packs/{types,resolve,derived}.ts`（复用 `plugin-attribution`）；RPC `packs.list`；面板「套装」Tab：派生列表 + 未归组桶 | 2–3 天 |
| **MVP-B（用户套装 + 应用）** | `capability-packs.json` 读写 + `hiddenDerived`；编辑器；`packs.apply`（additive/幂等/部分失败/冷会话）；胶囊 | 3 天 |
| **MVP-C（Jev）** | `kind:"pack"` + 折叠规则 + 客户端展开 + 结果面板 | 2–3 天 |
| 后续 | `showPackedMembers`、插件自声明 title/description（`package.json` 的 `dsh.capabilityPack`）、导入导出、deeplink | 待评估 |

---

## 11. 待定

- **待定 1 · 派生套装是否默认进 Jev 候选**：建议默认进（这正是"同一层"的意义），
  但随包 Office 这类不喜欢就 `hiddenDerived` 隐藏；
- **待定 2 · 折叠开关默认值**：建议 `showPackedMembers=false`（折叠），可在设置里打开；
- **待定 3 · 派生套装的 description 兜底**：拿不到包描述时用计数文案是否够用；
- **待定 4 · 插件自声明**：`package.json` 加 `dsh.capabilityPack: {title, description}`
  只提供文案、不提供 members（安全）；需要上游插件配合，二期；
- **待定 5 · 套装能否带 prompt 正文**：延续——**不支持**。

---

## 12. 参考

- Claude Code 插件 / marketplace（一个插件 = 一组组件，整包启停；安装键 ≠ 命名空间）：
  <https://code.claude.com/docs/en/plugins-reference> ·
  <https://code.claude.com/docs/en/plugins/marketplace-reference>
- Codex CLI profile（层叠文件 + MCP 与模型同层）：
  <https://developers.openai.com/codex/config-advanced>
- Gemini CLI extensions（`gemini-extension.json` 一个清单同时带 MCP / commands / skills）：
  <https://geminicli.com/docs/extensions/reference>
- Goose recipes（`title/description/extensions/parameters`）：
  <https://block.github.io/goose/docs/guides/recipes/recipe-reference>
- Roo Code custom modes（`slug`/`description`/`groups`）：
  <https://docs.roocode.com/features/custom-modes>
- Continue assistants / blocks（`uses/with/override` 引用式组合）：
  <https://docs.continue.dev/reference>
- Zed agent profiles（可用性 ≠ 审批）：<https://zed.dev/docs/ai/agent-profiles>
