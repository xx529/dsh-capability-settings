# 能力面板升级 · 代码考古（只读取证）

> **任务**：task-1（scout 只读取证）。本轮只做原型设计前的取证，**未修改任何生产代码**。
> **仓库根**：`/Users/lzx/Documents/GitHub/dsh-capability-settings`（下文所有相对路径都以它为基准，例如 `src/client/panel.tsx:66`）。
> **取证方式**：只读 `src/**`、`package.json`、`README.md`、`CHANGELOG.md`、`AGENTS.md`、`notes/**`（本地 gitignore 的验证脚本）、`node_modules/@deepseek-ai/dsh-skill`（宿主依赖源码/类型），以及从宿主 `app.asar` 中只读抽取的 `dsh-skill-filesystem` 文档片段。
> **证据等级标注**：
> - `[R]` 本仓库源码（行号为当前 HEAD `0e0bb04` 的工作区状态）；
> - `[H]` 已安装的宿主依赖包（`node_modules/@deepseek-ai/dsh-skill`）；
> - `[A]` 宿主 `app.asar` 内抽取的官方 provider 文档（只读文本片段，未执行）；
> - `[不确]` 未验证/推断，明确标注。

---

## 0. 一句话结论

1. **现状 IA = 3 个域 Tab（快捷消息/技能/MCP）× 域内「项目 / 全局」二选一 Tab**；两区数据其实**一次性全量拉到了客户端**（`skills.list` / `mcp.list` 都同时返回两个作用域），所以「同屏看项目 + 全局」是**纯客户端改造，零新 RPC**。
2. **同名 skill**：本插件 `list()` **不去重**（同名会在项目区/全局区各出现一行，靠 `source:name` 区分）；**宿主 registry 会去重**，同名只暴露 rank 最小的一行（项目 100/200 < custom 300 < 全局 400/500 < bundled 600）。
3. **SKILL.md 正文目前客户端完全没有展示**：宿主 RPC `skills.read` 已实现并返回 `{spec, body, format, resources}`，但**没有任何客户端组件调用它**，且其现有客户端适配器有「不传 root ⇒ 只能读全局 `.agents`」＋「不解业务信封」两个缺陷。目录内其它文件**无法**通过现有 RPC 读取（`resources` 只是一层文件名，且不含内容）。
4. **新增文件浏览 RPC 可行**：宿主侧只需在 `skills/manager.ts` 加一个方法 + `remote.ts` 加路由 + 客户端 api/adapter；安全边界可复用 `isSkillName` + `validateRelativePath` + `path.resolve` 前缀校验，仓库里**没有现成的符号链接防护**，需要新写。
5. **快捷消息可整块删除**，但它嵌在 `overrides`/`imports` 两个共享域的类型与配置键里（`CapabilityDomain`、`ImportDomain`、`DOMAIN_KEYS`、`IMPORT_DOMAINS`），**MCP 复用这两个模块**，删的时候必须保留模块、只摘掉 `quickMessages` 这个键；`notes/verify` 有 5 处断言会连带失败。
6. **最大风险**：客户端 bundle 只外部化 `react` / `react/jsx-runtime`（实测 `lib/client.js` 里只有这两条 `require`），**不能引入 markdown/yaml 等裸依赖**；同时 `skills.read` 的 root 解析缺陷若不修，详情页会对项目技能直接报 "not found"。

---

## 1. 当前能力面板 IA 与点击路径

### 1.1 宿主装配（谁提供数据）

`src/index.ts`

| 位置 | 内容 |
|---|---|
| `src/index.ts:29-41` | 引入三个域管理器 + overrides/imports + mcp loader/usage + `mountRpcChannel` |
| `src/index.ts:74-80` | `CapabilityPanelService = { skills, mcp, quickMessages, overrides }` |
| `src/index.ts:101-123` | `overrides` 包一层：`toggle` 成功后，`mcp` 域再 `loader.reload` |
| `src/index.ts:131-137` | `skillsBase = createService(...)`，再 `Object.assign` 上 `sessionList` / `setSessionEnabled` |
| `src/index.ts:133-155` | 组装 `service`；`quickMessages: createQuickMessagesManager(...)`（`:153`） |
| `src/index.ts:156` | `ctx.provide("capabilityPanel", () => service)` |
| `src/index.ts:158-161` | `config.mountRpc !== false` ⇒ `mountRpcChannel(ctx, service)` |

RPC 通道与信封：

- `src/remote.ts:20-22` `CHANNEL` 来自 `src/channel.ts`（唯一来源，`src/channel.ts:1-16`）。
- `src/remote.ts:24-46`：传输层恒 `{ ok: true, value }`；业务失败必须包成 `{ ok: true, value: { ok: false, errors } }`，否则外壳 zod 校验判非法。
- `src/remote.ts:49-115` `PanelRpcService`：`skills`（`:50-74`）、`mcp`（`:75-103`）、`quickMessages`（`:104-110`）、`overrides`（`:111-114`）。
- `src/remote.ts:124-204` `handleEndpoint`：从 payload 解析 `cwd`（`:126`）/ `sessionId`（`:128`），`switch` 路由（`:130-197`），未知 endpoint ⇒ 业务失败（`:198-199`），handler 抛错 ⇒ 业务失败（`:201-203`）。
- `src/remote.ts:235-263` `mountRpcChannel`（为什么不用 `connection.rpc.handle` 的根因写在 `:206-234`）。
- `src/remote.ts:266` 请求体上限 300 MiB；`:287-369` 具体 HTTP 处理（信任/认证、415、413、rpcId 校验）。

### 1.2 客户端入口与槽位

`src/client.ts`

| 位置 | 内容 |
|---|---|
| `src/client.ts:30` | locale 命名空间 `capabilityPanel`；`:32-65` 中英词典（注释明说「组件仍硬编码中文，词典暂无消费者」`：34-37`） |
| `src/client.ts:68` | `inject = ["connection","slots","locale","workspaces"]`（**服务名**，非包名） |
| `src/client.ts:105-117` | 面板用 `api = createPanelApi({...})`（带项目钉选 `selection.cwd`） |
| `src/client.ts:138-170` | composer 用 `composerApiFor(sessionId)`，每会话一份、不读面板钉选 |
| `src/client.ts:199-223` | 侧栏 `sidebar.panellist`（id `capability-panel`，order 30）+ `main`（key `capability-panel`）**成对**注册 ⇒ 面板占据主区域 |
| `src/client.ts:225-262` | 会话内入口：`conversation.view`「能力」Tab（`:245-251`）、hero 内联区 `conversation.input.dock`（`:256-261`） |
| `src/client.ts:269-307` | `sessionTitleOf`（把 sessionId 投影成侧栏标题） |
| `src/client.ts:309-381` | `currentWorkspaceCwd`（项目作用域兜底顺序，`:313-332` 有完整说明） |
| `src/client.ts:383-400` | `listWorkspaceOptions`（下拉框选项） |
| `src/client.ts:402-422` | `workspaceItemsKey`（含 `sessionIds`，否则新建会话不刷新） |

> 注意：`src/client.ts:225-230` 的注释仍写着「快捷消息仍可在侧栏能力面板中管理」——需求 1 落地时要一起改。

### 1.3 面板骨架（`src/client/panel.tsx`）

- `src/client/panel.tsx:49-57` 域 Tab 类型与文案：`DomainTab = "quickMessages" | "skills" | "mcp"`；默认 `skills`（`:69`）。
- `src/client/panel.tsx:66-150` `CapabilityPanel`：
  - `:95-139` 头部：标题「能力面板」+ 工作区路径（`:102-106`）+ **项目作用域下拉框**（`:110-122`，`SkpSelect`，空值 = 跟随当前会话）+ 域 Tab（`:126-138`）。
  - `:141-147` 分支渲染 `SkillsView` / `McpView` / `QuickMessagesPanel`。
- `src/client/panel.tsx:70-91` 订阅 `api.subscribeWorkspace` 同步工作区/项目选项/钉选。

### 1.4 Skills 视图（`src/client/panel.tsx:156-305`）

- `:167` `zone` 默认 `"project"`；`:173` `useAsyncList(() => skillsApi.list(), [skillsApi, workspace])` —— **一次拉全量**（项目 + 全局都在这一个数组里）。
- `:176-184` 过滤 = `isProjectSource(source)` 决定区 + 关键词命中 `name/description`；**两区互斥展示**。
- `:193-199` `ZoneTabs` 切换区，**切换时清空选中**（`:196-198`）——这是「换个区就丢详情」的摩擦来源。
- `:200-206` 搜索框；`:207-215` 「+ 安装到项目/全局」按钮。
- `:221-289` 双栏：`.skp-list`（`:222-268`）行 = 状态圆点（仅项目区，`:234-251`）+ 名称 + 描述；`.skp-detail`（`:269-288`）。
- `:291-302` 安装弹窗（`InstallDialog`，`:762-995`）。
- `:321-323` 行 key = `source:name`，注释明确「技巧名在合并列表里**不唯一**」。
- `:345-727` 详情卡 `SkillDetail`：头部徽标（`:533-559`）、操作行（`:560-655`）、字段表（`:656-720`）。
- `:733-741` `skillRef(summary)`：优先 `root`，否则按 source 退化 scope/target。

### 1.5 MCP 视图（`src/client/mcp-panel.tsx`）

- `:55-97` `McpView`：`zone` 默认 project（`:58`）；`useAsyncList` 并行拉 `list + status + runtime`（`:79-97`）并聚合挂载状态、`settling`。
- `:104-109` `toggleDefault`：写 `overrides.toggle("mcp", key)`（**项目级「默认」**）。
- `:126-138` `settling` 时每 800ms 静默重拉（上限 20 次）。
- `:141-148` 两区过滤（`server.scope === zone`）；`:153-163` 外部注入实例只在全局区展示。
- `:222-255` 子头部：`ZoneTabs`（`:225-234`）+ 搜索 + 「+ 添加到项目/全局」（`:242-254`）。
- `:266-340` 列表行：名称 + 来源徽标（引用/导入/全局/项目，`:294-296`）+「默认关闭」徽标（`:297-301`）+ meta 标签（transport/已禁用/挂载异常，`:303-313`）+ 行尾「默认」开关（`:316-337`）。
- `:341-397` 外部注入实例行（只读 + 独立「默认」开关，`:374-394`）。
- `:407-426` 详情区：`McpExternalDetail`（`:538-590`）或 `McpDetail`（`:597-850`）或空态。
- `McpDetail` 操作行 `:664-776`：启停（`:674-708`）、导入引用（`:710-727`）、编辑（`:729-731`）、查看工具与参数（`:734-751`）、使用记录（`:753-760`）、删除/移出（`:762-775`）。
- 字段表 `:780-808`；使用记录区 `:810-817`；探测报告 `:818-833`。
- 弹窗：`McpAddDialog`（`:1243`）、`McpEditDialog`（`:1307`）、JSON 导入（`:1417`）。

### 1.6 共享组件与样式

- `src/client/panel-common.tsx:23-28` `hasWorkspaceLabel` / `isProjectSource`；`:31` `PanelZone`；`:34-50` `ZoneTabs`（三域共用）；`:64-104` `useAsyncList`（请求序号守卫）。
- `src/client/modal.tsx:13-22` 模态框；`src/client/select.tsx:1-19`（自绘下拉，视口钳制）。
- `src/client/panel-entry.tsx:36-42` 主区域页面；`:56-66` 侧栏图标（只画图标）。
- 样式：`src/client/styles.ts:46-47` `.skp-main`；`:55-58` `.skp-tabs/.skp-tab`；`:66-67` `.skp-body` / `.skp-list`（**列表固定 320px**）；`:70-76` 行 + 行尾默认开关；`:89` 行描述；`:91-104` 详情区；`:108-110` 子头部；`:133` 作用域下拉 `max-width:250px`；`:162-165` 模态框。

### 1.7 点击路径清单（当前实现）

| 目标 | 入口 | 点击次数 | 证据 |
|---|---|---|---|
| 打开能力面板 | 侧栏「能力面板」图标 | **1** | `src/client.ts:217-222` |
| 切域（技能/MCP/快捷消息） | 头部域 Tab | **1** | `src/client/panel.tsx:126-138` |
| 切「项目/全局」 | 域内 ZoneTabs | **1**（且清空选中） | `src/client/panel-common.tsx:34-50`；`src/client/panel.tsx:193-199` |
| 换钉选项目 | 头部下拉 | **2**（开 + 选） | `src/client/panel.tsx:110-122` |
| 看某技能详情 | 列表行 | **1** | `src/client/panel.tsx:227-230` |
| 项目技能启/停 | 详情按钮 | **1** | `src/client/panel.tsx:566-576` |
| 模型/用户调用开关 | 详情两个按钮 | 各 **1** | `src/client/panel.tsx:680-707` |
| 全局技能「导入到本项目」 | 详情按钮 | **1**（同名冲突时 **2**） | `src/client/panel.tsx:592-606`、`:468-487` |
| 全局技能「在本项目禁用/恢复」 | 详情按钮 | **1** | `src/client/panel.tsx:611-632` |
| 导出（浏览器下载） | 详情按钮 | **1** | `src/client/panel.tsx:633-635` |
| 导出到宿主路径 | 详情按钮 → 弹窗提交 | **2** + 输入 | `src/client/panel.tsx:636-638`、`:998-1050` |
| 删除技能 | 详情按钮 | **2**（二次确认） | `src/client/panel.tsx:639-653` |
| 安装技能 | 「+ 安装…」→ 模式 Tab → 选文件 → 目标下拉 → 安装 | **≈6-7** | `src/client/panel.tsx:207-215`、`:762-995` |
| 看 MCP 详情 | 列表行 | **1** | `src/client/mcp-panel.tsx:272-281` |
| 切 MCP「默认」开关 | 行尾 switch | **1** | `src/client/mcp-panel.tsx:316-337` |
| MCP 项目条目启/停 | 详情按钮 | **1** | `src/client/mcp-panel.tsx:674-708` |
| MCP 导入引用 | 详情按钮 | **1**（冲突 **2**） | `src/client/mcp-panel.tsx:710-727`、`:192-206` |
| MCP 编辑 | 详情「编辑」→ 表单保存 | **2** + 输入 | `src/client/mcp-panel.tsx:729-731`、`:1307` |
| MCP 查看工具与参数 | 详情按钮 | **1**（真连一次） | `src/client/mcp-panel.tsx:734-751` |
| MCP 使用记录 | 详情按钮 | **1** | `src/client/mcp-panel.tsx:753-760` |
| MCP 删除/移出 | 详情按钮 | **2** | `src/client/mcp-panel.tsx:762-775` |
| MCP 新增 | 「+ 添加…」→ 表单保存 | **≈3+** | `src/client/mcp-panel.tsx:242-254`、`:1243` |

### 1.8 与需求 3 的差距（「项目/全局」不直观）

- 两区**互斥**：同一时刻只能看到一个区（`src/client/panel.tsx:176-184`），且切换会清空选中（`:196-198`）。
- 两区数据**本来就同时在手**：`skills.list` 返回全部受管根（`src/skills/manager.ts:103-136`），`mcp.list` 返回 project + global 两类视图（`src/mcp/manager.ts:149-238`）。**做「同屏双列」不需要新增 RPC。**
- 全局面板还有一个「工作区钉选」维度（`src/client/panel.tsx:110-122`），与「项目/全局」正交，容易混淆。
- 详情区是右侧单栏（`src/client/styles.ts:67` 列表 320px + `:91` 详情 flex），双列后空间需要重新分配（见 §6 风险）。

---

## 2. 数据模型：scope / source / 覆盖语义

### 2.1 skills：受管根与 source

- 受管根清单（宿主侧）：`src/skills/manager.ts:58-74`
  - 项目：`project-dsh` → `<项目根>/.dsh/skills`（`:63`）、`project-agents` → `<项目根>/.agents/skills`（`:64`）、`project-claude` → `<项目根>/.claude/skills`（`:65`）
  - 全局：`user-dsh`（`:69`）、`user-agents`（`:70`）、`user-claude`（`:71`）
- 目录解析：`src/skills/roots.ts:36-39`（dsh home/skills）、`:47-49`（agentsHome/skills，全局**写入**目标）、`:55-57`（`~/.claude/skills`）、`:67-70`（项目根 + 子目录）。
- 只读判定：`.claude` 两源只读（`src/skills/manager.ts:85-87`）。
- 项目系/全局系的**单一事实源**：`src/shared/skill-sources.ts:15-22`（`isProjectSkillSource` / `isGlobalSkillSource`；`custom` 归项目侧，`bundled` 两侧都不归，见 `:1-13` 注释）。
- 去重根（同一物理目录被两个 source 命中时保留先出现的项目根）：`src/skills/manager.ts:47-55`。

### 2.2 同名 skill 的覆盖/去重语义（**关键**）

**面板（本插件）不去重**：

- `src/skills/manager.ts:103-136` 遍历每个根 → 每个条目都 push 一个 view → 最后只按 `name` 排序（`:135`）。
- 同名条目因此**各占一行**：项目副本 + 全局原版（甚至 `.dsh` 与 `.agents` 两个项目根同时存在时会有两行项目条目）。
- 客户端用 `source:name` 复合 key 防 React 调和冲突（`src/client/panel.tsx:314-323`）。
- 遮蔽状态只是**标注**，不删除行：`src/skills/manager.ts:308-331` `annotateProjectShadow` 给全局行标 `projectShadow = "stub" | "skill"`；面板据此渲染徽标（`src/client/panel.tsx:548-558`）。

**宿主 registry 会去重，只暴露 rank 最小的那个**：

- `[H]` `node_modules/@deepseek-ai/dsh-skill/lib/index.js:108-118`：*"A read merges the global layer with the viewing scope's chain — the nearest layer's entry wins a duplicate name outright, and the rank order decides duplicates only within one layer."*
- `[H]` 同文件 `:519-521`：`compareIndexedCandidates = rank - rank || providerOrder - providerOrder || localOrder - localOrder`（**rank 小者胜**）。
- `[A]` 宿主 `dsh-skill-filesystem` 官方文档（从 `app.asar` 只读抽取）给出 rank 表：

| Rank | Source | Path |
|---|---|---|
| 100 | `project-dsh` | `<projectRoot>/.dsh/skills` |
| 200 | `project-agents` | `<projectRoot>/.agents/skills` |
| 300 | `custom` | `Config.customSkillDirs` |
| 400 | `user-dsh` | `<dshHome>/skills` |
| 500 | `user-agents` | `<agentsHome>/skills` |
| 600 | `bundled` | 内置根 |

  ⇒ **项目同名恒压过全局**；同层内（如 `.dsh` vs `.agents`）rank 小者胜；`.claude` **不在** rank 表里（所以面板把 `.claude` 标只读，`src/skills/manager.ts:85-87`，且 `.claude` 条目不参与宿主目录——与 `src/client/composer-skills.tsx:91` 的注释一致）。
- 本插件利用该语义实现「在本项目禁用全局」：写同名 shadow stub（`src/skills/shadow.ts:1-18` 机制说明、`:62` `createShadowStub`、`:120` `removeShadowStub`），并在「导入到本项目」里主动拒绝其它项目根同名冲突（`src/skills/manager.ts:218-225`）。
- 宿主 `skills.get(name)` 只返回**胜出**的那一份（`[H] node_modules/@deepseek-ai/dsh-skill/lib/types/index.d.ts:276-288`），并带 `content` 与 `resourceBase`（同文件 `:72-80`）。**因此：想看「被项目副本遮蔽的全局原版」，不能只靠宿主 registry，必须继续用插件的磁盘视图。**

### 2.3 MCP：scope / overrides「默认关闭」/ 会话开关

- 合并列表（一份返回两区）：`src/mcp/manager.ts:149-238`
  - 全局行 `shadowed = 项目里同名 key 是否存在`（`:178`）。
  - 项目行恒 `shadowed:false`（`:199`）；引用行把同名全局行标 `shadowed`（`:213-236`）。
  - 最终排序 `[...projectRows, ...globalRows]` 再按 key 排（`:231-233`）。
- 项目级「默认关闭」= `.agents/capability-overrides.json` 的 `mcp` 列表：
  - 类型 `src/overrides/types.ts:29-38`；域键 `src/overrides/config-file.ts:21`；写盘最小化 `:78-85`。
  - 视图标记 `src/mcp/manager.ts:191-193`（全局）、`:201-203`（项目）、`:222-224`（引用）。
  - 面板开关语义见 `src/client/mcp-panel.tsx:99-109`、`:316-337`；文档说明 `README.md`（见 §4.3）。
- 会话开关（内存态、不落盘）：
  - 键：`project:<configKey>` / `server:<serverName>`（`src/mcp/loader.ts:239-251`）。
  - 优先级（`src/mcp/loader.ts:237-245` 注释 + `:363-365` 实现）：**显式会话开关 > 项目级默认（overrides 里列了 = 默认关闭）**；配置文件里 `disabled: true` 是**硬关闭**，忽略会话开关（`src/mcp/loader.ts:367-372`）。
  - 全局/外部实例的「关掉」= `tools.restrict` 按 agent 作用域屏蔽，不卸载共享实例（`src/mcp/loader.ts:400-425`，AGENTS.md 亦有契约说明）。
- 引用（导入）存储：`src/imports/manager.ts:36-48`（读）、`:83-95`（登记）、`:110-124`（项目级启停）；类型 `src/imports/types.ts:23-47`。
- **快捷消息与 MCP 共用上面两个域**：`src/overrides/types.ts:30`、`src/imports/types.ts:24,27`。

### 2.4 快捷消息（待移除域）

- 文件位置：项目 `<项目根>/.agents/quick-messages.json`（`src/quick-messages/paths.ts:43-46`），全局 `<agentsHome>/quick-messages.json`（`:62-64`），读取兼容 `.dsh` / `.claude`（`src/shared/config-location.ts:22-26,44-53`）。
- 磁盘形状：`{ "messages": { "<名称>": { "text": "...", "disabled"?: true, "importedFromGlobal"?: true } } }`（`src/quick-messages/types.ts:1-39`）。
- 名称/正文校验：`src/quick-messages/entry-util.ts:18-28`（宿主与客户端共用）。
- 合并列表 + 引用 + 遮蔽：`src/quick-messages/manager.ts`（列表注释见 `:58-63`）。
- 面板：`src/client/quick-messages-panel.tsx:32`（列表/详情/表单）；域 Tab 注册见 §1.3。

---

## 3. 技能目录全文浏览的可行性（需求 2 的核心）

### 3.1 现状：read / list 到底返回什么

**磁盘层**（`src/skills/disk.ts`）：

- 布局：flat = `<root>/<name>.md`；directory = `<root>/<name>/SKILL.md`（`:1-11`、`:142-144`）。
- `readSkill(root,name,format)` → `ParsedSkill = { spec, body }`，读不到返回 `undefined`（`:159-168`）。
- `listResources(root,name)` → `string[]`：**只 readdir 一层**，排除 `SKILL.md`，**不区分文件/目录、不递归、不读内容**（`:216-225`）。
- `resourceDirectory(root,name)` = `<root>/<name>`（`:147-149`）。

**CRUD 层**（`src/skills/crud.ts`）：

```ts
// src/skills/crud.ts:187-196
export interface ReadResult {
  ok: boolean; errors?: string[];
  spec?: SkillSpec; body?: string; format?: SkillFormat;
  resources?: string[];            // directory 布局下的一层文件名
}
// src/skills/crud.ts:202-211
export async function readSkillDetail(root, name): Promise<ReadResult>  // 探测布局 → 读文件 → listResources
```

**服务层**（`src/skills/manager.ts:176-180`）：

```ts
async read(input: { root?; scope?; target?; cwd?; name }) {
  const root = input.root ?? resolveRoot(input.scope ?? "global", input.cwd, input.target);
  return readSkillDetail(root, input.name);
}
```

`resolveRoot("global")` **只**返回 `~/.agents/skills`（`:143-147`）——不覆盖 `user-dsh` / `user-claude`。

**客户端层**（`src/client/api.ts:139-140`、`src/client/api-adapter.ts:143-151`）：

```ts
// api.ts
read(name: string): Promise<ClientSkillDetail | undefined>;
// api-adapter.ts
const result = await rpc("skills.read", { name, cwd });   // ← 不传 root / scope / target
if (!result.ok) throw new Error(...);
return result.value as ClientSkillDetail;                  // ← 未 unwrap 业务信封
```

**三个已确认问题**：

1. **不传 `root`** ⇒ 宿主一律按 `global → ~/.agents/skills` 解析 ⇒ **项目技能、`~/.dsh/skills`、`~/.claude/skills` 的 read 都会 "not found"**。
2. **不解业务信封** ⇒ `ReadResult.ok === false` 时被当成 `ClientSkillDetail` 返回（字段全 undefined），UI 无法分辨「失败」与「空详情」。
3. 另外 `ReadResult` 本身**没有** `name/description/source/format/root/path` 等摘要字段，而 `ClientSkillDetail extends ClientSkillSummary`（`src/client/api.ts:57-61`）——类型与实际形状不符，`read` 无法独立构成详情，必须与列表摘要合并。

**客户端当前完全没有消费它**：`grep -rn "\.read(" src/client src/client.ts` 只命中 `src/client/unzip.ts:96`（stream reader）。`SkillDetail` 只接收 `ClientSkillSummary`（`src/client/panel.tsx:345-360`），字段表只渲染 description / whenToUse / 调用方式 / source / path（`:656-720`）——**没有正文、没有资源文件**。

### 3.2 skill 目录如何定位（客户端可用于请求的字段）

- 列表明细里宿主已带：`path`（skill 文件绝对路径）、`root`（受管根）、`format`，以及仅 directory 的 `resourceDirectory`（`src/skills/manager.ts:276-306`）。
- **客户端拿到的是裁剪版**：`ClientSkillSummary`（`src/client/api.ts:24-54`）只有 `path` / `root` / `format`，**没有 `resourceDirectory`**；`toSummary` 也确实没映射它（`src/client/api-adapter.ts:455-473`）。
  - ⇒ 客户端目前只能靠 `path` + `format` 反推：directory 时 `dirname(path)`；flat 时只有单文件。
  - 更稳的做法：新 RPC 让宿主用 `{ root, name, format }` 重新算路径（`skillFilePath` / `resourceDirectory`），**不要接受客户端传绝对目录**（见 §3.4）。
- **`src/shared/skill-locate.ts` 不参与运行时目录定位**：它只用于「压缩包/上传清单里找 skill 根」（`locateSkillRoot` `:32-54`、`stripCommonTopFolder` `:60-66`、`rerootEntries` `:72-80`），宿主下载安装与客户端 zip 上传共用；磁盘上的浏览应走 `roots.ts` + `disk.ts`（`detectFormat` `src/skills/disk.ts:202-210`、`skillFilePath` `:142-144`）。
- 官方 provider 文档补充 `[A]`：*"Catalog entries and loaded skills expose the resolved instruction-file path, so symlinked directories and flat files can open as regular-file previews. Reload locators and resource bases retain the discovered paths, including symlinks."* ⇒ **符号链接是被保留的**，磁盘视图里 `path` 可能是 symlink 后的真实/展示路径，安全校验要按 `realpath` 再做前缀判断。

### 3.3 新增宿主 RPC 的建议形状

**建议两个 endpoint（或一个带 `mode` 的合并 endpoint）**：

```ts
// 1) 目录树（不含正文）
"skills.files"   payload: { root?: string; scope?: "project"|"global"; target?: ".dsh"|".agents";
                            cwd?: string; name: string; format?: "flat"|"directory" }
// value（业务信封内）：
type SkillFilesResult =
  | { ok: true; format: "flat"|"directory"; dir?: string;
      entries: Array<{ path: string;      // skill 目录内的 posix 相对路径（flat 为 "<name>.md"）
                       kind: "file"|"dir"; size: number; binary: boolean;
                       truncated?: boolean }>;
      truncated?: boolean }
  | { ok: false; errors: string[] };

// 2) 单文件正文
"skills.readFile" payload: { root?; scope?; target?; cwd?; name; format?; path: string;   // 相对路径，服务端校验
                             maxBytes?: number }
// value：
type SkillFileResult =
  | { ok: true; path: string; size: number; encoding: "utf-8"; content: string; truncated: boolean }
  | { ok: false; errors: string[]; code?: "not-text" | "too-large" | "escape" | "not-found" };
```

**要改的文件（最小集）**：

| 文件 | 改动 |
|---|---|
| `src/skills/files.ts`（**新增**，建议） | `listSkillFiles()` / `readSkillFile()`：路径收敛、递归、大小/二进制/编码判定、`lstat`/`realpath` 校验 |
| `src/skills/manager.ts` | return 对象里加 `files(input)` / `readFile(input)`（与 `read` 同样的 root 解析口径）`src/skills/manager.ts:149-272` |
| `src/remote.ts` | `PanelRpcService.skills` 加两个方法签名（`:50-74`）；`handleEndpoint` 加两个 `case`（`:130-160`） |
| `src/client/api.ts` | 新增 `ClientSkillFile*` 类型 + `SkillsApi.files/readFile`（`:123-184`） |
| `src/client/api-adapter.ts` | 实现两个方法（仿 `exportFiles` / `mcp.test` 的 `unwrap` 写法 `:220-240`、`:283-290`） |
| `src/client/panel.tsx` | 详情卡里加「文件」区（见 §6） |

**错误信封硬约束**（照抄 `src/remote.ts:24-46`）：

- 传输层**必须** `{ ok: true, value }`；业务失败塞进 `value: { ok: false, errors }`；
- handler 抛错也会被 `handleEndpoint` 兜成业务失败（`:201-203`），但**不要依赖它**——路径穿越这类预期失败应显式返回 `errors`；
- 客户端侧用 `unwrap()` 解（`src/client/api-adapter.ts:100-105`），并注意 `read` 现有的漏解 bug（§3.1）。

**响应体积**：请求体上限 300 MiB（`src/remote.ts:266`），响应没有单独上限，但整个响应会 `JSON.stringify`（`:290`）——文件正文建议**服务端单文件截断**（如 256 KiB）+ `maxBytes` 入参。

### 3.4 安全与边界（每条给出仓库内可复用的先例）

| 风险 | 现状 | 建议 | 可复用先例 |
|---|---|---|---|
| `../` 穿越 | 现有 `read` 只接受 `name`，已有 `nameGuard` | 文件名走 `validateRelativePath`；最终路径 `resolve()` 后必须 `startsWith(resolve(skillDir) + sep)` | `src/skills/crud.ts:27-33`；`src/skills/validate.ts:12-22`；`src/skills/transfer.ts:274-283` |
| 符号链接逃逸 | 仓库内**无任何 lstat/realpath 处理** `[不确]` | list 时 `lstat` 跳过 symlink（或 `realpath` 后校验前缀）；读文件同样校验 | 无先例，需新写；provider 文档见 §3.2 `[A]` |
| 受管根逃逸 | `root` 由客户端传入（`ClientSkillSummary.root`） | 服务端**不能**信任任意 `root`：应限制在 `managedRoots()` 产生集合内（或用 `scope/target` 重算） | `src/skills/manager.ts:58-74,143-147` |
| 文件数量 | 上传路径有 200 上限 | 目录树也设上限（如 200 条），超出 `truncated` | `src/skills/transfer.ts:48` |
| 单文件大小 | 上传 20 MiB / 下载 30 MiB / 解压 64 MiB | 正文建议 256 KiB（可调），超出返回 `truncated` 或错误 | `src/skills/transfer.ts:49`；`src/skills/download.ts:23`；`src/skills/unzip.ts:34` |
| 二进制识别 | 仓库无 helper `[不确]` | 读前 `stat` + NUL 字节探测 + `TextDecoder("utf-8",{fatal:true})` 失败判定；图片/zip 只显示元信息 | 无先例 |
| 非 UTF-8 | `readFile(path,"utf8")` 会静默替换非法序列（`src/skills/disk.ts:163`） | 用 `Buffer` 读 → fatal decoder → 失败则 `binary:true` | `src/skills/crud.ts:187-196`（可仿照扩展 `ReadResult`） |
| 隐藏文件 | `listResources` 不过滤（`src/skills/disk.ts:220-224`） | 明确策略：默认展示但置灰，或不展示 `.` 开头（需 Lead 决策，见 §7） | — |
| flat 格式 | 没有目录，`resources` 恒空（`src/skills/crud.ts:209`） | 详情仍显示单文件正文；文件树区域显示「该技能为单文件格式」 | `src/client/panel.tsx` 详情 UI |

### 3.5 客户端 markdown 渲染的可行方案

**约束（硬）**：

- `package.json` 里**没有** markdown 库（依赖只有 `@modelcontextprotocol/client`、`yaml`、`@deepseek-ai/dsh-home-paths`、`@deepseek-ai/dsh-mcp-client`）。
- 客户端 bundle 只有两个外部依赖：实测 `lib/client.js` 中 `require` 仅 `react`、`react/jsx-runtime`（`grep -o 'require("...")' lib/client.js`）。`tsdown.config.ts:44-52` 注释解释：客户端图里唯一的非相对裸导入就是这两个，`deps.neverBundle: true` 正好只外部化它们。
  - ⇒ **在 client 代码里 `import "yaml"` / `import "marked"` 会生成 `require("yaml")`**，外壳的模块工厂没有这个模块 ⇒ 运行时报错。**markdown 渲染必须零依赖（自研）或内联源码**。
- 客户端目前**没有任何 `dangerouslySetInnerHTML`**（全仓 grep 无命中）⇒ 自研渲染器应继续用 **React 元素树**输出，天然免疫 XSS；不要为了省事拼 HTML 字符串。
- **无外部 CSS / 组件库**：所有样式必须写进 `src/client/styles.ts` 的 `SKP_CSS` 模板字符串（客户端插件注入 `<style>`，见 `src/client.ts:75` `installStyles()` 与 `src/client/styles.ts:1-20` 文件头），优先用宿主 `--dsw-alias-*` 令牌；不能引 `.css` 文件、Tailwind 或 UI 组件库（`AGENTS.md`「平台契约 · 自绘 UI」）。

**推荐分层**（按成本从低到高）：

1. **`<pre>` 纯文本**（成本最低）：正文 + `white-space:pre-wrap`（现成模式见 `src/client/styles.ts:179` `.skp-test-instruction-body`）。代价：标题/列表/代码块都没有排版，长文档可读性差；但零风险、零依赖、一天内可完成。
2. **零依赖最小渲染器**（推荐）：~150 行，按行扫描，支持：
   - ATX 标题 `#..######` → `<h1..h6>`
   - 无序/有序列表（含一层缩进）→ `<ul>/<ol><li>`
   - 围栏代码块 ``` → `<pre><code>`（保留原样，不做语法高亮）
   - 引用 `>`、水平线 `---`
   - 表格（`| a | b |` + 分隔行）→ `<table>`（MVP 可选）
   - 行内：`` `code` ``、`**bold**`、`*italic*`、`[text](url)`（链接要 `target="_blank" rel="noreferrer noopener"`，且只允许 `http(s)`）
   - 其余按段落
   - 已知取舍：不支持嵌套列表/图片/HTML 内联/脚注；不保证与 CommonMark 逐字一致——文档里要写清「预览级渲染」。
3. 引入第三方（**不建议**）：需要改 `tsdown.config.ts` 的 external 策略或把库源码 vendored 进来；前者会踩宿主 require 解析，后者增大 bundle（当前 272 KB）+ 维护成本。

**样式接入**：新增 `skp-md-*` 类（如 `.skp-md h1/h2/code/pre/table`），令牌用现有 `--skp-text/--skp-fill/--skp-border`（`src/client/styles.ts:49` 起）与 `--ds-font-family-code`（已在 `:102` `.skp-path`、`:159` `.skp-textarea` 使用）。

**降级为 `<pre>` 的代价**：只丢失「可读排版」；不丢失安全性、不丢失代码块可复制性（`<pre>` 也可复制）。对「在这里就能看完整技能内容」的需求，`<pre>` 能满足"看完整"，但不满足"像文档一样好读"。建议 MVP 直接上方案 2 的子集（标题/列表/代码块/链接），表格与行内强调可后置。

---

## 4. 快捷消息整模块移除清单

### 4.1 直接删除的文件

| 文件 | 行数 | 说明 |
|---|---|---|
| `src/quick-messages/manager.ts` | 262 | 宿主域管理器 |
| `src/quick-messages/types.ts` | 85 | `QuickScope` / `QuickMessageEntry` / `QuickMessageView` / `QuickMessagesListResult` / `QuickOpResult` |
| `src/quick-messages/config-file.ts` | 71 | 读写 + 校验导出 |
| `src/quick-messages/entry-util.ts` | 27 | 名称/正文校验（宿主 + 客户端共用） |
| `src/quick-messages/paths.ts` | 63 | 文件定位 |
| `src/client/quick-messages-panel.tsx` | 528 | 面板域视图（`QuickMessagesPanel` `:32`） |
| `src/client/composer-quick.tsx` | 390 | **已是未注册死代码**（全仓无它 import；CHANGELOG `:26-28` 明说"保留未注册"） |
| `docs/screenshots/panel-quick.png`、`docs/screenshots/composer-quick.png` | — | README 引用（§4.3） |

> `src/client/composer-skills.tsx` / `src/client/composer-mcp.tsx` / `src/client/composer-common.ts` 同样是**未注册死代码**（无 import 点），但**不属于本次快捷消息移除范围**；是否顺手清理见 §7 开放问题。

### 4.2 逐文件修改点（含行号）

| 文件 | 位置 | 改法 |
|---|---|---|
| `src/client/panel.tsx` | `:40` import；`:50` `DomainTab`；`:53-57` `DOMAIN_LABEL`；`:127` Tab 列表；`:141-147` 渲染分支；`:24-29` 文件头注释 | 删 quick 分支/标签，`DomainTab` 收窄为 `"skills" \| "mcp"` |
| `src/client.ts` | `:34-37` 注释提到 quick-messages-panel；`:229-230` 注释「快捷消息仍可在侧栏能力面板管理」 | 改注释（无代码依赖） |
| `src/client/styles.ts` | `:33-34` 注释；`:257` `.skp-composer-pop-quick`；`:274-283` `.skp-composer-quick-*` | 删 11 行样式 + 注释 |
| `src/client/api.ts` | `:387-446` 整个快捷消息段；`:454` `ClientOverrides.quickMessages`；`:487` `CapabilityPanelApi.quickMessages` | 删；`ClientOverrides` 只留 `mcp` + `filePath` |
| `src/client/api-adapter.ts` | `:21` import `ClientQuickMessagesList`；`:378-409` `quickMessages` 实现块 | 删 |
| `src/remote.ts` | `:104-110` `PanelRpcService.quickMessages`；`:184-193` 5 条 `quick.*` case | 删 |
| `src/index.ts` | `:10` 注释；`:36` import；`:78` 服务类型；`:102-105` 注释；`:153` 装配；`:178` re-export；`:195-196` 路径/配置 re-export；`:199-205` 类型 re-export | 删/改 |
| `src/overrides/types.ts` | `:4-15` 注释；`:17-24` 磁盘形状示例；`:30` `CapabilityDomain`；`:35` `quickMessages?` | **保留模块**，`CapabilityDomain = "mcp"` |
| `src/overrides/config-file.ts` | `:21` `DOMAIN_KEYS`；`:24-26` `emptyOverrides` | 去掉 `quickMessages` |
| `src/overrides/manager.ts` | `:88-89` `next` 里显式复制 `quickMessages` | 去掉该键 |
| `src/imports/types.ts` | `:4-18` 注释；`:23-27` `ImportDomain`/`IMPORT_DOMAINS`；`:39-42` `ImportsSet`；`:45-48` `ImportsFileShape` | 只留 `mcp` |
| `src/imports/manager.ts` | `:4-9` 注释 | 改注释（代码与域无关） |
| `src/imports/config-file.ts` | `:21-23` `emptyImports`；循环走 `IMPORT_DOMAINS`（`:34`、`:61`） | 改 `emptyImports`，循环自动收窄 |
| `src/shared/*` | `config-location.ts`、`json-config.ts`、`file-lock.ts`、`atomic-write.ts`、`errors.ts`、`agents-home.ts` | **不动**：skills/mcp/overrides 共用 |
| `notes/verify/lib/stub-api.mjs` | `:63` `quickMessages` 桩；`:64` `overrides.get` 返回值含 `quickMessages` | 删/改 |
| `notes/verify/lib/gui-harness.mjs` | `:61-64` `quick.list` 分支 + `overrides.get` 返回 | 删/改 |
| `notes/verify/render-smoke.mjs` | `:45` 断言「三个域 Tab（快捷消息/技能/MCP）」 | 改为两个 Tab |
| `notes/verify/api-two-instances.mjs` | `:34-35` `quick.list` + `overrides.get` | 删/改 |
| `notes/verify/live-gui-acceptance-probe.mjs` | `:72-73` `A2-tabs` 断言含「快捷消息」 | 改 |
| `notes/verify/mcp-probe.mjs` | `:335` `quickMessages: {}` | 删 |

### 4.3 文档 / 设计源 / 历史引用

| 文件 | 位置 | 说明 |
|---|---|---|
| `README.md` | `:4` 首段；`:20` 能力表行；`:29-32` 配置表；`:47` IA 描述；`:207-217` 整节「💬 快捷消息」；`:227` 引用制说明；`:239`、`:256-260` 输入框弹层描述；`:271-272`、`:290` 「快捷消息仍可…」；`:301` 架构图；`:363` 卸载说明；`:386-388` 目录结构 | 全部要改/删；截图 `panel-quick.png`、`composer-quick.png` 一并处理 |
| `CHANGELOG.md` | `:26-28`（1.2.0 变更）、`:58`、`:149-159`、`:169`、`:179-181`、`:211-216`、`:229` | **历史条目不要改**（Keep a Changelog 惯例）；在 `[Unreleased]` 新增「变更/移除」条目说明整域移除与数据残留策略 |
| `AGENTS.md` | `:6`（能力列表）、`:40`（`src/index.ts` 职责）、`:42`（endpoint 列表）、`:44`（`src/client/*.tsx` 清单）、`:45`（域目录）、`:65`（配置文件名） | 仓库文档，需同步 |
| `docs/figma/scenes/*.json` | `grep "快捷消息"` **无命中** | Figma 终稿不含快捷消息，**无需改设计源** |
| `notes/**` | `REVIEW-3.md`、`REVIEW-5-live-gui.md`、`REPORT.md`、`design/capability-dock.md`、`real-gui-evidence/**`、`out-render-smoke.txt` | 本地 gitignore 历史证据，不建议回改（留作历史），但 `run-all.sh` 会因断言失败变红——需同步改脚本（§4.2） |

### 4.4 「删了会连带坏什么」（按影响面排序）

1. **编译期**：`src/client/panel.tsx` 的 `DomainTab`/渲染分支、`remote.ts` 的 service 接口、`index.ts` 的 `CapabilityPanelService`、`api.ts` 的 `CapabilityPanelApi` 四处互相引用；漏一处 `tsc` 直接报错（这是好事，能兜底）。
2. **overrides / imports 两个共享域**（**最容易踩**）：`CapabilityDomain` / `ImportDomain` 是 MCP 也在用的联合类型；`overrides/config-file.ts:21` 与 `imports/config-file.ts:34,61` 决定「读哪些域键、写哪些域键」。摘掉 `quickMessages` 后：
   - 旧文件里的 `quickMessages` 键**读时被忽略、下次写时被抹掉**（`imports/config-file.ts:59-70` 只写 `IMPORT_DOMAINS`；`overrides/config-file.ts:78-84` 同）⇒ **用户数据会静默丢失**，需在 CHANGELOG/迁移提示里说明（或保留一个只读迁移）。
   - 注意 `overrides.get` 的返回形状会从 `{quickMessages, mcp}` 变 `{mcp}`；**当前没有任何客户端组件调用 `overrides.get`**（只有 `api-adapter.ts:411-425` 定义了它），所以不会破坏 UI，但 `notes/verify` 的桩要改。
3. **数据文件残留**：用户机器上的 `quick-messages.json`（项目 + 全局，含旧位置 `.dsh`/`.claude`）不会被删除。卸载说明 `README.md:363` 提到"配置文件原样保留"——移除域后建议明确写「不再读取，可手动删除」。
4. **RPC 兼容**：新宿主 + 旧缓存客户端 bundle 会调 `quick.list` → 走 `default` 分支返回 `unknown endpoint` 业务失败（`src/remote.ts:198-199`），面板报错但不会崩；反之旧宿主 + 新客户端不会发生（客户端不调用）。可接受。
5. **验证套件**：`run-all.sh:17` 会跑 `render-smoke`，它 `:45` 断言写死「三个 Tab（快捷消息/技能/MCP）」⇒ **不改脚本，套件必红**。`api-two-instances.mjs:34` 与 `lib/gui-harness.mjs:61` 里的 `quick.list` 桩不改也不会红（只是变成无用桩），但为保持口径一致建议一并清掉。
6. **locale**：`src/client.ts:38-65` 词典**没有**快捷消息键（只有 `panel.*`），无需改。
7. **样式**：`skp-composer-quick-*` 只被 `composer-quick.tsx`（已死代码）使用；但 `.skp-composer-pop-quick` 与 `.skp-composer-skill-*` 相邻，删除时按行核对，别误删 `composer-skills` 仍在引用的类。
8. **输入框**：当前 `src/client.ts` **没有**注册任何 composer 弹层（`src/client.ts:225-262` 只有 view Tab + hero 区），CHANGELOG `:26-28` 也确认三个弹层已移除 ⇒ **快捷消息在 UI 上只剩面板域 Tab 一个入口**，删除面比想象中小。

---

## 5. 验证设施：现状与新增 UI 的验证方案

### 5.1 现有设施

| 文件 | 作用 | 备注 |
|---|---|---|
| `notes/verify/run-all.sh` | 一键套件 | `:8-15` tsc/build/verify-build；`:17-21` 循环跑 9 个脚本；`:23-25` 直接驱动 `lib/` 的 loader 行为 |
| `notes/verify/setup.sh` | 准备 | `:11-12` `tsc -p notes/verify/tsconfig.verify.json` ⇒ `notes/verify/tmp/build`；`:14-17` 软链 MCP SDK；`:19-25` 装 `server-everything` |
| `notes/verify/tsconfig.verify.json` | 把 `src/**` 编成 ESM 到 `tmp/build` | 脚本 import 的是**编译产物**，不是 ts 源 |
| `notes/verify/lib/stub-api.mjs` | `CapabilityPanelApi` 桩（`makeApiStub`）+ `makeRpcStub` + `makeWorkspaceWorld` | `:32-64` |
| `notes/verify/lib/gui-harness.mjs` | jsdom + `createFakeClientCtx`（假 slots/workspaces/rpc） | `:50-80` |
| `notes/verify/render-smoke.mjs` | SSR 断言：主区域页面 + 侧栏图标；`:45` 断言三个域 Tab | 在 run-all 里 |
| `notes/verify/capability-dock-render.mjs` | 会话能力区 SSR + 纯函数 + 注册 + 样式断言（`check(id,desc,pass,detail)` `:26-28`） | **不在 run-all 里**，手动跑 |
| `notes/verify/dock-visual.mjs` | 把 `SKP_CSS` + SSR 组件拼成 HTML（`:1-11`），产物 `notes/verify/tmp/dock-visual.html` | **只生成 HTML，不截图**；截图由 Playwright 另行完成 |
| `notes/verify/live-gui-check.mjs` / `live-gui-acceptance-probe.mjs` | 真机 GUI 只读复核（Playwright） | Playwright 路径**硬编码在 npx 缓存**：`live-gui-check.mjs:7`、`live-gui-acceptance-probe.mjs:7`（`/Users/lzx/.npm/_npx/…/playwright/index.mjs`）——`[不确]` 该缓存是否仍存在，换机/清缓存即失效 |
| `notes/verify/tmp/env/node_modules/jsdom` | jsdom 安装位置 | `notes/verify/package.json` 声明 `jsdom ^30.1.3`；`AGENTS.md` 警告不要删 `notes/verify/tmp` |

**注意事项**：

- `run-all.sh:17` 的脚本清单**不含** `capability-dock-render.mjs` / `dock-visual.mjs`（当前是手动验收）；新功能若要进 CI 式回归，需要显式加进循环。
- 视觉截图依赖本机 Playwright，不是仓库依赖；「新增 UI 必须给截图」在当前仓库只能靠本机 npx 缓存 + 手工跑，属于既有技术债 `[不确]` 是否可长期复现。

### 5.2 新增 UI 后应怎么做渲染断言与截图（建议流程）

1. **SSR 断言（无浏览器，最快）**：
   - 在 `render-smoke.mjs` 更新域 Tab 断言（删「快捷消息」、断言两列容器存在），并加「技能详情含 SKILL.md 标题 + 文件树容器」断言。
   - 新增 `notes/verify/skill-files-render.mjs`（仿 `capability-dock-render.mjs`）：用 `makeApiStub()` 扩展 `skills.files/readFile` 桩，断言
     - 文件树渲染出预期条目数、二进制条目显示「不可预览」；
     - markdown 渲染器对给定样本输出 `<h2>/<ul>/<pre>`（纯函数单测更好：把渲染函数导出）。
2. **静态视觉（SSR + CSS → HTML → 截图）**：
   - 扩 `dock-visual.mjs`：加「技能详情双列 + 文件预览」stage（当前 stage 在 `:100-118` 附近拼接），输出 HTML；
   - 用 Playwright（沿用 `live-gui-check.mjs` 的 headless chrome + 1400×900 viewport）打开 `file://…/dock-visual.html` 截图，重点看：320px 列表在双列下是否挤压、窄容器（760px）是否换行、代码块横向滚动。
3. **真机验收（独立环境，勿动用户 profile）**：按 `AGENTS.md` 的 `DSH_HOME=.verify-home` + 独立端口；用 `SKP_URL='http://127.0.0.1:<port>/?token=…'` 跑 `live-gui-check.mjs` / `live-gui-acceptance-probe.mjs`（注意这两个脚本的 A2-tabs 断言要同步改）。**不要**在用户 `~/.dsh` profile 上装/改配置。
4. **构建门槛**：`pnpm typecheck` + `pnpm build`（`AGENTS.md`「变更纪律」），且 `lib/**` 要一起提交。

---

## 6. 最小改动面建议（需求 1 + 2 + 3）

### 6.1 文件清单

**新增**

| 文件 | 职责 |
|---|---|
| `src/skills/files.ts` | 递归列目录 + 安全读单文件（路径收敛/符号链接/大小/二进制/编码） |
| `src/client/markdown.tsx` | 零依赖最小 markdown → React 元素（标题/列表/代码块/链接，可选表格） |
| `src/client/skill-files.tsx` | 详情内的文件树 + 预览（可内联进 `panel.tsx`，但独立更易测） |
| `notes/verify/skill-files-render.mjs` | 新增 SSR/纯函数断言（可选但推荐） |

**修改**

| 文件 | 改动要点 |
|---|---|
| `src/skills/manager.ts` | `+ files()/readFile()`；顺带修 `read` 的 root 解析（或让新 RPC 统一走 `root`） |
| `src/remote.ts` | service 签名 + 2 个 case |
| `src/client/api.ts` | 新类型 + `SkillsApi.files/readFile`；`ClientSkillSummary` **可选**加 `resourceDirectory` |
| `src/client/api-adapter.ts` | 实现两个方法；**修 `read` 的 root 不传 + 业务信封漏解** |
| `src/client/panel.tsx` | ① 删 quick 域；② `ZoneTabs` 换成「项目/全局同屏」布局；③ `SkillDetail` 加正文 + 文件区 |
| `src/client/panel-common.tsx` | 可新增 `TwoZoneLayout` 共享组件（Skills 与 MCP 复用） |
| `src/client/mcp-panel.tsx` | 同上，域内改双列；保留行尾「默认」开关语义 |
| `src/client/styles.ts` | 新增双列/文件树/`skp-md-*` 类；删 `skp-composer-quick-*` |
| `src/index.ts`、`src/overrides/*`、`src/imports/*` | 仅摘 `quickMessages` 域键（§4.2） |
| 文档 | `README.md`、`CHANGELOG.md`（`[Unreleased]`）、`AGENTS.md` |
| 验证 | `render-smoke.mjs`、`stub-api.mjs`、`gui-harness.mjs`、`api-two-instances.mjs`、`live-gui-acceptance-probe.mjs`、`mcp-probe.mjs` |

**删除**：§4.1 的 7 个源文件 + 2 张截图。

### 6.2 需求 3 的布局取舍（建议之二选一）

- **A. 双列 + 底部/右侧详情**：`.skp-body` 里放两列（项目 / 全局），各 ~260-320px，详情仍占剩余宽度。优点：改动集中在 `zone` → 两列渲染；缺点：三栏在 760px 窄容器会挤（当前详情已经要放文件树，空间更紧张）。
- **B. 单列分节（项目区在上、全局区在下，各自可折叠）**：复用现有行/详情布局，详情固定在右侧。优点：窄屏友好、实现最小；缺点："同时清晰看到"稍弱（需滚动）。
- 折中：**列表区两列并排（项目/全局），详情区固定在右侧**；窄容器（`@media` 或按容器宽度）降级为 B。详见 §7 决策点。

### 6.3 风险与取舍

| 风险 | 说明 | 缓解 |
|---|---|---|
| **详情页空间被文件树挤压** | 列表 320px 固定（`styles.ts:67`）+ 详情 padding 22/24（`:91`）；再加文件树会让正文更窄 | 文件树做成详情内的可折叠区（复用 `.skp-detail-inspect` 的「分隔线 + 标题」模式 `styles.ts:209-213`） |
| **`skills.read` 旧缺陷** | 不传 root ⇒ 项目技能读不到；漏解业务信封 | 新 RPC 强制走 `root/scope` 解析；顺手修 adapter（属行为修复，需 CHANGELOG） |
| **不传绝对路径给客户端** | `ClientSkillSummary.root` 来自宿主，但客户端可篡改 payload | 服务端把 `root` 限制在 `managedRoots()` 集合内 |
| **符号链接** | 仓库无先例；provider 文档明确保留 symlink `[A]` | `lstat` + `realpath` 双校验；拒绝指向 skill 目录外的链接 |
| **bundle 不能加依赖** | 见 §3.5 | 自研渲染器 / `<pre>` |
| **MCP 双列改动牵连「默认」开关** | 「默认」开关当前是列表行的**同级兄弟**（`mcp-panel.tsx:316-337`），不是详情按钮；重排布局时容易丢 | 双列时把开关留在行内（`styles.ts:70-73` 已有 `.skp-row-wrap` 布局） |
| **快捷消息删除影响 MCP** | `overrides`/`imports` 是共享模块 | 只改联合类型与域键，保留模块与读写函数 |
| **验证套件红灯** | `render-smoke.mjs:45` 写死三 Tab；另有 4 处 `quick.*` 桩（§4.2） | 与代码同批改（§4.2） |
| **设计源同步** | 仓库纪律要求 UI 改动同步 Figma `Capability Dock · 终稿 v5` | 本轮只做原型，Figma 在实现轮同步 |

### 6.4 需求 1/2/3 的最小可交付拆分

1. **P0（需求 3，纯客户端）**：`panel.tsx`/`mcp-panel.tsx` 域内改「项目 + 全局」同屏；`ZoneTabs` 保留（或改成分段控件）但不再互斥。零 RPC、零宿主改动，可先独立验收。
2. **P0（需求 1）**：删快捷消息域（§4），同批修验证脚本与文档。
3. **P1（需求 2 的第一步）**：详情卡展示 SKILL.md 正文（走修好的 `skills.read` 或合并进新 RPC），markdown MVP 或 `<pre>`。
4. **P1（需求 2 的第二步）**：`skills.files` + `skills.readFile` + 文件树 UI。
5. **P2**：图片/二进制元信息、markdown 表格、文件搜索等增强。

---

## 7. 不确定项（明确不编造）

1. `[不确]` `.claude` 兼容根的条目是否**真的**不参与宿主 registry：rank 表（`[A]`）里没有 `.claude`，`src/client/composer-skills.tsx:91` 注释也这么说，但未在宿主代码里逐行确认。
2. `[不确]` 宿主 provider 对**符号链接**的具体解析（`[A]` 只说明"保留 symlink 路径"），是否可能出现 skill 目录位于 symlink 之后、真实路径在根外的情形。
3. `[不确]` `notes/verify` 里硬编码的 Playwright npx 缓存路径（`live-gui-check.mjs:7`）在当前机器是否仍可用——未执行验证脚本（只读取证，不跑构建/安装）。
4. `[不确]` `mcp.list` 在**无工作区**时的项目区行为（代码上 `projectFile === undefined` ⇒ 只有全局行，`src/mcp/manager.ts:152,167-171`），但面板对无工作区的文案/按钮禁用路径未逐条走查。
5. `skills.read` **从未被 UI 使用过**（已核实：`git log -S "skills.read" -- src/client` 只命中初始提交 `dc21551`，且该版本的 `panel.tsx` 里也没有 `.read(` 调用）。它不是「曾经用过后来坏了」的回归，而是**一直未接线**的死接口。
6. `[不确]` 宿主是否有「读 skill 目录任意文件」的官方 API：`[H]` 类型里只有 `skills.get(name)` 返回 body + `resourceBase`（`node_modules/@deepseek-ai/dsh-skill/lib/types/index.d.ts:72-80,276-288`），**没有**列目录/读任意资源文件的方法，所以需要自建 RPC。

---

## 8. 需要 Lead 决策的开放问题

1. **布局方案**：双列（项目|全局）并排 + 右侧详情（A），还是上下分节 + 右侧详情（B）？窄容器（<900px）降级策略选哪个？
2. **同名条目的表达**：双列后，项目副本与全局原版各自可见；是否保留「本项目已禁用 / 项目副本生效中」徽标，还是加「被项目覆盖」置灰 + 一键跳转？
3. **文件浏览的读权限**：本轮原型只读，还是允许在详情里**编辑/保存**文件？（后者要再加 `skills.writeFile`，安全面与测试面都变大）
4. **文件类型策略**：图片/二进制是显示「不可预览 + 大小」，还是直接隐藏？隐藏文件（`.` 开头）展示与否？
5. **正文渲染**：MVP 用 `<pre>`，还是直接上零依赖最小 markdown（标题/列表/代码块/链接）？是否接受"不做表格/语法高亮"？
6. **快捷消息数据迁移**：删除域后，遗留的 `quick-messages.json` 与 `capability-overrides.json` / `capability-imports.json` 里的 `quickMessages` 键——是自动清理、提示用户、还是完全不处理（读时忽略）？
7. **死代码清理范围**：`composer-quick.tsx` 必删；`composer-skills.tsx` / `composer-mcp.tsx` / `composer-common.ts`（均未注册）是否顺带删？（会减少 ~1000 行与一批样式）
8. **Figma 同步**：本轮原型是否需要在 `docs/figma/scenes` 同步新增「双列 + 文件预览」设计源，还是等实现轮？
