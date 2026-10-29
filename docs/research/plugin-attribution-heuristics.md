# 插件工具归属：启发式自动发现可行性取证

> 角色：scout（只读取证）。任务：`task-30`。日期：2026-10-29。
> 仓库基线：`bd6a2d3`（已含 `src/shared/plugin-attribution.ts` 硬编码 TOOL_RULES）。
> 宿主：桌面应用 0.2.1-rc.3（`Info.plist` `CFBundleShortVersionString`）。
> 宿主源码：`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`（按 asar 条目 offset 只读解包到 `/tmp/asar-scout/src/`；**未修改任何宿主文件**）。
> 本文件是本次唯一落盘产物；未改 `src/`、未动 `~/.dsh`。

## 0. 结论摘要（推荐组合）

**结论**：用「**运行时栈归属（主）+ 静态字面量索引（冷启动回填）+ MCP 命名空间映射 + 名字相似度（仅兜底）**」四层替代/收窄硬编码 `TOOL_RULES`；现有 `TOOL_RULES` 退化为**最后一道降级与稳定 id 锚**，不再是主路径。

| 层 | 信号 | 可靠性 | 成本 | 覆盖（本机实测） | 备注 |
|---|---|---|---|---|---|
| **T0** | 监听 `tools/change`，在监听器里 `new Error().stack` 取注册调用栈 → 从帧里的 `node_modules/<pkg>` 反推包名 | **高（精确，无猜测）** | 每次注册约 **8.2 µs** 捕获（实测），零文件 IO | 监听器挂上之后注册的**全部**工具 = 100% | 需临时抬高 `Error.stackTraceLimit`（默认 10 帧不够，实测默认栈只有 9 行）；抓不到启动顺序早于本插件的注册 |
| **T1** | 插件包根 + 源码字面量索引：工具名在**唯一一个**插件包里以字面量出现 → 归属该包 | 中高（本机 65 个工具命中 31 个字面量唯一；0 歧义） | 扫 26 个第三方 bundle **0.46 s / 23k 字面量**（跳 artifacts 与大文件）；缓存后 0 | 65 工具中 31（48%） | 必须排除自身包、排除宿主内建名单；`mcp__` 前缀名靠 T2 |
| **T2** | MCP 命名空间：`mcp__<ns>__*` 的 `<ns>` 在**唯一**插件包内出现 → 该包「自注册命名空间」 | 高（`figma`→`dsh-to-figma` 唯一命中；其余 9 个配置型 MCP 命名空间全部 0 命中） | 同 T1（复用同一索引） | 65 工具中 17（26%） | 必须排除自身包（本仓库硬编码表里含 `figma`，会污染结果——实测出现 2 个 owner） |
| **T3** | 名字相似度：包名归一 token ∩ 工具名 token（去停用词、分母取 min），唯一命中且差 margin 才采用 | 中（65/65 无错配；但 379 包装机集合上 11 个测试名有 3 个歧义） | 纯字符串，微秒级 | 65 工具中 17（26%）；真实 48 个插件域工具中 16（33%） | 只能兜底，UI 应标「推测」 |
| **T4** | 现有 `TOOL_RULES` 硬编码表 | 高（人工确认过） | 0 | 覆盖 7 类已知插件 | 保留：作为稳定 unit id 与降级锚 |
| **T5** | 「来源未识别」单元 | — | 0 | 真实 48 个插件域工具中 **2 个（4.2%）** | 兜底，绝不猜 |

**无法自动归属比例（本机真实注册表实测）**：
- 真实可见工具 **214** 个 = 宿主内建 **57** + MCP 命名空间工具 **109** + 插件域工具 **48**。
- 插件域 48 个中：字面量唯一 **30**，相似度 **16**，**无法归属 2 个（4.2%）**：`univer_inspect`（与 `dsh-trace-inspect` token 冲突）、`plugin_manager`（无 token 命中）。
- 7 插件 ground-truth 样本（65 工具）：字面量 31 + 命名空间 17 + 相似度 17 = **65/65 覆盖，0 错配**。
- 若采纳 T0（运行时栈）为主路径，**归零**上述 4.2%：这两个工具都是在宿主启动后注册的，栈归属可直接确定（见 §4）。

---

## 1. 数据来源与方法

### 1.1 真实注册表（本机、运行时只读）

通过宿主自带的只读检查器取当前 Agent 的真实工具集（**非静态推断**）：

- `cordis_inspect_query(platform:"host", provider:"Tool", method:"listTools")` → **214** 个工具；其中 `mcp__*` **109** 个，命名空间 10 个：`AnySearch / Parallel-Search / chrome-devtools / context7 / deepwiki / figma / jev-browser-chrome / open-computer-use / playwright / tavily`。
- 非 MCP 105 个：宿主内建 57、插件域 48（`univer_*` **14**、`rw_*` **22**、`figma_*` 5、`dsh_im_*` **3**、`open_in_popout`、`diff_approval_annotate`、`plugin_market`、`plugin_manager`）。
- 交叉核对（`grep -o '"name": "<prefix>…"'` 计数）：`dsh_im_` 3、`univer_` 14、`rw_` 22、`figma_` 5、`mcp__figma__` 17、`open_in_popout` 1、`plugin_` 2、`sidebar_open` **0**（本机此次 better-sidebar 未注册该工具）。
- 该 provider 的描述即「Tools visible to the requesting Agent, including scoped and dynamic registrations」（`cordis_inspect_list` 返回的 provider 目录），是宿主侧视图，不是本插件的 `schemas()`。

### 1.2 静态样本（只读扫描 `~/.dsh/profiles/desktop/node_modules`）

- 7 个确认注册工具的第三方插件：`dsh-to-figma`、`dsh-univer-office`、`dsh-remote`、`@xmanrui/dsh-im`、`dsh-better-sidebar`、`@local/dsh-popout-window`、`dsh-diff-approval`。
- **源码 ground truth**（人工读注册点建立，非扫描结果）：**65** 个工具名。
- **运行时同 7 插件**：46 个工具（14+22+3+5+1+1）。两者不一致（`dsh_im_*` 源码 8 → 运行时 3、univer 13 → 14、rw 21 → 22）⇒ 不同插件版本/会话内条件注册所致，**[待验证]**；本文的两组实验分别基于这两个集合，结论按各自口径引用，不混用。
  - `dsh-to-figma` 22：`figma_status/setup/read_guide/reconnect/select_document`（源码注册点 `dsh-to-figma/index.mjs:74-83,151,158,163`，均为 `qualified:false` 原始名）+ 17 个 `mcp__figma__<raw>`（`qualified:true`，`index.mjs:48-51` + `lib/catalog.mjs` 的 `LOCAL_TOOLS`）。
  - `dsh-univer-office` 13：`univer_*`（`lib/index.js:12718-12721` 附近的 `newTool/statusTool/worktreeTool/unitTool` 工厂）。
  - `dsh-remote` 21：`rw_*`（`lib/index.js:2934` `tools.register(t)`，名字在表里）。
  - `@xmanrui/dsh-im` 8：`dsh_im_*`（`lib/index.js:77` `tools.register(o)`）。
  - `dsh-better-sidebar` 1：`sidebar_open`（`lib/index.js:4847` `defineTool({ name: "sidebar_open"`）。
  - `@local/dsh-popout-window` 1：`open_in_popout`（`index.js:472`）。
  - `dsh-diff-approval` 1：**`diff_approval_annotate`**（`lib/index.js:3198` `const ANNOTATE_TOOL_NAME = "diff_approval_annotate"`）。

> 注：`dsh-diff-approval/lib/index.js:2946` 的 `name: "dsh-diff-approval-annotate"` 是 **skill 名**，不是工具名——这是"字面量扫描"最典型的误报来源（详见 §3.3）。

---

## 2. 候选信号证据（A / B / C）

### 2.1 A：loader / 插件 inventory —— 能枚举全部 Loader 插件，且能拿到包根目录

**Fact（宿主）** `@deepseek-ai/cordis-plugin-loader`：

| 事实 | 位置 |
|---|---|
| `Entry` 字段：`loader / ctx / fiber / moduleNamespace / parent / options / subgroup / subtree` | `lib/index.js:310-330` |
| `entries()` 遍历整棵树（含 group 与 disabled） | `lib/index.js:142-148` |
| 每个条目 ctx 被扩展出 `baseUrl`（= 所属 Loader 树的解析基准） | `lib/index.js:133`、`:599` |
| 条目 import 走 `loader.internal.import(name, baseUrl, {})`，bare specifier 由 profile 解析 | `lib/index.js:214-224` |
| 条目标识：`entry.id`（含父路径，如 `include:capability-panel`）、`entry.options.name`（模块 specifier）、`entry.fiber` | `lib/index.js:310-355` |

**Fact（运行时实测）**：`loader.entries()` 在本机返回 **238** 个条目
—— `cordis_inspect_query(provider:"Config", method:"listConfigs", {limit:5})` → `total: 238`；
单条查询 `{name:"dsh-capability-settings"}` → `{id:"include:capability-panel", patchId:"capability-panel", name:"dsh-capability-settings", status:"absent"}`。

**Fact（宿主）包目录解析 API 存在且在本机可用**：

- `pluginPackages.packageOf(specifier, parentURL)` → 返回 `{dir, ...}`（包根目录）：`@deepseek-ai/dsh-app-boot lib/index.js:3544-3560`；同类 `metaOf` 在 `:3562`。
- `packageOf` 未安装 profile resolution 时走 Node 查找：`packageDirFromParent` = `createRequire(parentURL).resolve.paths(name)` + `existsSync(join(candidate,"package.json"))`（`dsh-app-boot:3566-3572`）。
- 官方消费范例：`@deepseek-ai/dsh-tool-cordis lib/types/config.js:44-47`
  `ctx.get('pluginPackages')?.packageOf(entry.options.name, baseUrl)?.dir`，注释即「the profile package lookup that resolves an entry's **package directory**」。
- **运行时实测（本机）**：`cordis_inspect_query(provider:"Config", method:"listConfigs", {entry:"include:capability-panel"})` 返回
  `packageDir: "/Users/lzx/.dsh/profiles/desktop/node_modules/dsh-capability-settings"` ⇒ 该 API 在本机真机可用。

**Fact（本机结构）**：`~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 34 项 + `dependencies` 28 项；其中在 `node_modules` 里实际可定位的第三方/本地包 **26** 个（其余是宿主 `@deepseek-ai/*`，属"宿主内建"域，不需要归属）。

**Inference**：`loader.entries()` 覆盖「由 Loader 管理」的插件（本机 238 条）；**动态 `ctx.plugin(...)` 挂的 fiber 不在 entry 树里**（本仓库 `src/mcp/runtime.ts:120-150` 的 loader 扫描 + `:72-118` 的 registry 扫描两路互补即为此）。

### 2.2 B：cordis fiber / registry 能拿到什么

**Fact（宿主）** `@deepseek-ai/cordis`：

| 事实 | 位置 |
|---|---|
| `Fiber` 字段：`parent / inject / runtime / uid / ctx / config / _config / state / dispose / store / inertia / _disposables / context / _error / _runner` | `lib/index.js:1008-1033` |
| `Fiber.name` getter = `fiber.runtime?.name`，否则沿 `parent.fiber` 上溯，兜底 `"root"` | `lib/index.js:1117-1123` |
| `Plugin.Runtime` 形状 = `{ name, callback, fibers, Config }` | `lib/index.js:1627-1634` |
| `ctx.registry` 是 `RegistryService`（`this.registry = new RegistryService(self)`），可遍历 runtime | `lib/index.js:1686` |
| 每个 effect 带 `meta = { label, children }`，挂在 disposer 的 `symbols.effect` 上；`runner.getOuterStack = buildOuterStack()` | `lib/index.js:1185-1198` |

**Fact**：fiber 上**没有模块路径/包名**，只有 `runtime.name`（插件 `export const name` 或包名派生的显示名，例：`dsh-to-figma` 的 `name='dsh-figma'`，见 `node_modules/dsh-to-figma/index.mjs:15`），以及 `config`（桥接层配置）。

**Fact（部分可用）**：`fiber._disposables` 里的 effect wrapper 带 `[symbols.effect].label`（如 `"tools.register()"`、`"tools.restrict()"`）⇒ 可以知道「**哪些插件用到了 tools.register**」，但 label 里**不含工具名**，因此**不能**用它做"工具 → 插件"的逐条归属。

### 2.3 C：tools 服务 / register / tools/change 的可观测点

**Fact（宿主）** `@deepseek-ai/dsh-tools`：

| 事实 | 位置 |
|---|---|
| `register(definition)`：`this.layers.effect(this.ctx, (layer) => layer.tools.insert(name, definition), {label:"tools.register()"})`——**只按名字入库，无 provenance** | `lib/index.js:2974-2982` |
| 变更通知：`layers = new ScopedLayers(..., () => { this.ctx.emit("tools/change"); })` | `lib/index.js:2783-2785` |
| `ScopedLayers.effect` 在 action 之后**同步**调用 `onChange()`（同一调用栈） | `@deepseek-ai/dsh-scope lib/index.js:189-215` |
| `tools/change` **没有 payload**（无 name/owner） | `dsh-tools:2784`（`emit("tools/change")` 无参） |
| `schemas()` / `view()` / `restrict()` 不含来源（已在 `docs/research/capability-v13-evidence.md` §2/§3 取证） | `:3119-3121`、`:3055-3079`、`:2991-3005` |

**Fact（宿主）**：cordis `emit` 是**同步**调用监听器：
`emit(...args) { this.dispatch("emit", args).map((cb) => cb(...args)); }` —— `@deepseek-ai/cordis lib/index.js:280-282`。

⇒ **关键推论（本任务的支点）**：在 `tools/change` 监听器里执行 `new Error().stack`，调用栈顶部就是
`捕获 → 监听器 → emit → ScopedLayers.effect → tools.register → 注册插件自己的代码`，
因此栈里**必然出现注册方文件的绝对路径**。这条路径不需要 patch 宿主代码，也不需要任何静态扫描。

**Fact（本仓库已有同类监听）**：`src/mcp/loader.ts:765` `ctx.on("tools/change", () => scheduleRestrictionRefresh())`
——证明"插件根 ctx 监听 tools/change"在本插件里已工作（现有 MCP 屏蔽刷新即依赖它）。

---

## 3. 静态扫描实验（D）

### 3.1 算法与参数

- 文件：只扫 `.js/.mjs/.cjs`（**排除 `.d.ts`**——它们是类型声明，不是注册点）。
- 目录：`SKIP = {artifacts, node_modules, .git, docs, test, tests, __tests__, coverage, examples, playground, vendor, .figma}`。
- 单文件上限 **2 MB**（理由见 §3.2：本机插件里有 59 MB / 32 MB 的 `artifacts/*.cjs`，扫进来纯浪费）。
- 提取：正则取引号字面量（`"..."` / `'...'` / `` `...` ``），再过滤 `^[a-z][a-z0-9_]{2,47}$`（工具名形状）。
- 归属规则：**唯一包命中**（`name in packageLiterals` 且 owner 数 == 1）。

### 3.2 耗时/体积（本机实测）

| 扫描范围 | 文件数 | 读取体积 | 字面量总量 | 耗时 |
|---|---|---|---|---|
| 7 个 ground-truth 插件（**不限目录**，8 MB 上限） | 937 | **64 MB**（其中 univer `artifacts/` 一个 **59 MB**、upgrade-worker 32 MB、unit-content-worker 30 MB；7 包 JS 总量 245 MB） | 341k | **~0.81 s**（univer 单包 610 ms） |
| 同 7 包（2 MB 上限） | 932 | **40 MB** | 99k | 957 ms |
| 7 个插件（跳过 `artifacts/` 等 + 2 MB 上限） | 526 | **13.4 MB** | 2.9k | **266 ms**（im 168 ms、better-sidebar 62 ms） |
| **26 个第三方 bundle 包（真实 profile，调优参数）** | — | — | **23,027** | **0.46 s** |

⇒ 结论：**必须**「跳过 artifacts/test/docs + 单文件上限 + 缓存」；否则冷启动扫描 0.5–1 s 且内存里挂着 30 万条无关字面量。缓存命中时应为 0 IO。

### 3.3 准确率/误报（7 个插件，**源码 ground truth 65** 个工具）

| 指标 | 结果 |
|---|---|
| 字面量唯一归属 | **31 / 65**（47.7%；运行时同 7 插件口径下为 30/46） |
| 其中错配 | **0** |
| 覆盖不到的 | 17 个 `mcp__figma__*`（前缀是 `publicToolName()` 拼出来的，源码里只有 raw name）+ 12 个 `univer_*`（名字在工厂/压缩代码里，调优扫描没读到）+ 5 个 `dsh_im_*` |
| 典型误报源（已实测） | ① `dsh-diff-approval/lib/index.js:2946` 的 `"dsh-diff-approval-annotate"` 是 **skill 名**（真实工具名在 `:3198` 是 `diff_approval_annotate`）；② 宿主内建名 `read/write/edit/bash/glob/grep/present/skill/subagent/workflow` 在**多数插件包**里作为字符串出现（实测 `read` 命中 5 个包、`write`/`edit` 命中 5 个）⇒ **必须先跑宿主内建过滤再谈字面量归属**；③ 注释/日志文案里的 snake_case 字符串（本实验未剔除注释，已计入误报源）。 |
| 自污染（严重） | `figma` 字面量在 **`dsh-capability-settings`（本仓库自己的硬编码表）** 与 `dsh-to-figma` 两个包里都出现 ⇒ 命名空间归属出现 2 个 owner。**扫描必须排除自身包。** |

### 3.4 交集/歧义统计

- 65 个工具里，字面量 owner 数 ≥2 的：**0**（样本干净）。
- 真实 214 个工具上，字面量唯一命中 **30**；歧义 0；未命中 18（进相似度层）。
- **MCP 命名空间**（真实 10 个）：`figma` → `{dsh-capability-settings, dsh-to-figma}`（自污染，排除自身后唯一）；其余 9 个（`AnySearch/context7/tavily/playwright/deepwiki/open-computer-use/Parallel-Search/jev-browser-chrome/chrome-devtools`）在 26 个插件包中**全部 0 命中** ⇒ 命名空间自动映射**不会**把配置型 MCP 误判成插件。

---

## 4. 运行时栈归属（E）——推荐做**主路径**

### 4.1 机制（全部有宿主源码依据）

1. `tools.register()` → `ScopedLayers.effect()` → `onChange()` → `ctx.emit("tools/change")`（**同步**，`dsh-scope:189-215`、`cordis:280-282`）。
2. 本插件在根 ctx `ctx.on("tools/change", handler)`（现成范式：`src/mcp/loader.ts:765`）。
3. handler 内 `new Error().stack` → 栈帧：
   `at handler → at emit(cordis:280) → at ScopedLayers.effect(dsh-scope:189) → at ToolRuntime.register(dsh-tools:2974) → at <注册插件文件>`。
4. 用正则 `/node_modules((?:\/[^/]+)*?)\/((?:@[^/]+\/)?[^/]+)\//` 从帧里抠包名；宿主帧含 `/app.asar/dsh/node_modules/@deepseek-ai/` ⇒ 判为宿主内建（且本来就在内建名单里）。
5. 与 T1/T2/T3 的结果合并：栈优先（`matchedBy:"runtime"`），其余为"推测"层。

### 4.2 成本（本机实测，node 24.21.0）

| 项 | 实测 |
|---|---|
| `new Error().stack` 平均耗时 | **8.18 µs**（20k 次；`stackTraceLimit=50` 时 8.82 µs） |
| 默认 `Error.stackTraceLimit` | **10** |
| 默认栈帧数 | **9 行** |
| 一个 MCP server 注册 30 个工具的开销 | ≈ 30 × 9 µs ≈ **0.27 ms**（对启动可忽略） |

⚠️ **默认 10 帧不够**：从 handler 到插件帧的深度约 6–9 帧，边缘情况会被截断。做法：handler 内 `const old = Error.stackTraceLimit; Error.stackTraceLimit = 48; try {…} finally { Error.stackTraceLimit = old; }`（进程级全局，恢复；V8 该属性是普通数值属性，改动无副作用，但**必须 finally 恢复**）。

### 4.3 可行性判定

- **不需要 patch 宿主**：只加一个事件监听器，零副作用（监听器内异常必须 try/catch 吞掉，沿用 `src/mcp/usage.ts` 的"永远放行/异常吞掉"纪律）。
- **覆盖边界**：
  - ✅ 本插件 `apply()` 之后注册的所有工具（本机第三方插件几乎都在 bundles 列表尾部，**推断**覆盖绝大多数）。
  - ❌ 本插件监听之前注册的工具（启动顺序早于 `dsh-capability-settings` 的插件）→ 用 T1/T2/T3 + 现有 TOOL_RULES 回填。
  - ⚠️ **异步注册**（MCP `syncTools()` 在 `await listTools()` 之后）栈里只剩 `dsh-mcp-client` 的帧 ⇒ 归因到 `mcp-client`；但这类工具本来就走 MCP 命名空间（T2），不影响 Tools 域。
  - ⚠️ **同一插件一次注册多个工具**：每个工具各有一次 `tools.change`，逐个捕获即可；去重按 `(toolName)` 记录首次来源。
- **验证成本**：**低**——一条 `console.log` 或一个只读 debug RPC 即可在真机确认帧里确实含插件包路径；这是本方案唯一需要 tester/真机确认的点（见 §11）。

### 4.4 备选（仅在 T0 帧不可用时）

`ctx.get("tools")` 返回的是 cordis 可追踪代理；cordis `symbols` 全部是 `Symbol.for(...)`（`cordis:35-52`），**跨副本稳定**，因此 `proxy[symbols.original]` 可拿到裸服务实例，再 `Object.getPrototypeOf(raw).register` 做包装。
**不推荐**：影响进程内所有调用方、需保证 finally 复原、且 HMR 重载后可能叠加多层包装。仅作为 T0 失败时的应急，且必须在设计文档里标注风险。

---

## 5. 名字相似度（F）

### 5.1 归一化

```
包 token = 去 scope、去 dsh-/plugin- 前缀、按 -/_/. 切分、小写、去停用词
          （停用词：to in of the and for with on at is a an dsh plugin local tool tools）
工具 token = 同上切分（mcp__<ns>__<raw> 取 ns 与 raw 两段合并）
score = |交集| / min(|工具 token|, |包 token|)
```

### 5.2 实测

| 阈值 | 7 插件 65 工具 correct | wrong | unattributed |
|---|---|---|---|
| ≥0.3 | 46 | **0** | 19（全是 `rw_*`，包名 `dsh-remote` 与 `rw` 无 lexical 关系） |
| ≥0.5 | 46 | 0 | 19 |
| ≥0.8 | 10 | 0 | 55 |

- **0.3 与 0.5 结果相同**：因为唯一命中时分数多为 1.0（如 `univer_*` ↔ `dsh-univer-office`），非命中为 0；建议取 **≥0.5**，并要求"最佳 - 次佳 ≥ 0.3"（margin）才采用，防止两个插件共享通用 token。
- **真实 48 个插件域工具上**：相似度命中 **16**，其中错配 0（人工核对：`univer_*`→univer-office、`dsh_im_*`→dsh-im、`diff_approval_annotate`→dsh-diff-approval、`open_in_popout`→popout-window）。
- **碰撞风险（379 个已装包全量做候选）**：11 个测试名里 **3 个歧义**：
  `dsh_im_context` → {`@xmanrui/dsh-im`, `dsh-context`}；`dsh_im_group_history` → {`@xmanrui/dsh-im`, `@local/dsh-group-chat`}；`diff_approval_annotate` → {`diff`, `dsh-diff-approval`}。
  ⇒ 相似度**不能单独**当归属依据，只能在 T1/T2 都没命中时、且唯一 + margin 足够时采用（并标记 `matchedBy:"similarity"`，UI 可显示"推测"）。
- **无法归属的类型（结构性）**：缩写型前缀（`rw_*` ↔ `dsh-remote`）、通用词开头（`plugin_manager`、`plugin_market`）、单字符 token。

---

## 6. MCP 命名空间自动映射（G 的一部分）

**Fact**：
- 工具名契约 `mcp__<serverName>__<rawName>`（`@deepseek-ai/dsh-mcp-client lib/index.js:97-103`；本仓库解析器 `src/mcp/usage.ts:57`）。
- 两种来源：① mcp-client 实例（fiber/entry 归属，现有 `src/mcp/runtime.ts:72-150`）；② **插件直接注册** `mcp__<ns>__*`（`figma`，本机 `dsh-to-figma/index.mjs:49-51` + `lib/catalog.mjs`）。
- 现有硬编码 `MCP_NAMESPACE_RULES` 只有 `figma` 一条（`src/shared/plugin-attribution.ts`）。

**自动映射规则（实测可行）**：
1. 遍历插件包（T1 的索引）找 `<ns>` 字面量；
2. **排除自身包**（否则本仓库的 `figma` 字符串会让 `dsh-capability-settings` 成为第二个 owner）；
3. 唯一 owner → `matchedBy:"namespace"`；多 owner → 不采用（标"来源未识别"）；
4. 0 owner → 说明它是配置型/外部 MCP server，交回现有 MCP 域（`mcp.runtime`）。

**实测**：`figma` 排除自身后唯一 owner = `dsh-to-figma`；其余 9 个命名空间 0 owner ⇒ 不会误判。

---

## 7. 缓存与失效（G）

### 7.1 建议落点（复用现有范式）

`<dshHome>/dsh-capability-settings/tool-attribution.json`（目录 0700 / 文件 0600，原子写 + 文件锁）。
现成范式：`src/tools/global-state.ts:26-60`（`TOOLS_GLOBAL_VERSION`/`FILE_MODE`/`atomicWriteText`/`withFileLock`）——照抄即可，不要新造写盘路径。

```jsonc
{
  "version": 1,
  "generatedAt": 1761..., 
  "packages": {
    "dsh-univer-office": {
      "version": "0.3.7",
      "mtimeMs": 1761...,            // 包根/入口文件 mtime
      "bytes": 123456,               // 可选：入口文件大小
      "namespacehints": [],
      "literals": ["univer_new", "…"]   // 只存"工具名形状"字面量，不存全量
    }
  },
  "runtime": {
    "univer_inspect": { "package": "dsh-univer-office", "matchedBy": "runtime", "at": 1761... }
  }
}
```

### 7.2 失效条件

| 触发 | 动作 |
|---|---|
| `tools/change` | 只更新 `runtime` 段（内存 + 延迟 2s 落盘）；不重扫包 |
| `loader` 条目变化（`plugin/status` 或 inventory 快照差异） | 标记受影响包"待重扫"，惰性重扫（下次枚举时） |
| 包 `version` 或包根 `mtimeMs` 变化 | 该包缓存失效（**缓存键 = 包名 + version + mtimeMs**） |
| `dshHome` 变化（切换 profile） | 缓存路径跟着变，天然隔离 |
| 用户手动"刷新"（面板） | 强制全量重扫 |
| 文件缺失/损坏/version 不认识 | 空缓存 + warn，退化为纯 T0 + TOOL_RULES + 来源未识别 |

### 7.3 缓存读取成本

- 缓存命中：读一个 <100 KB JSON（260 个工具名 + 26 包字面量子集），**远小于 0.46 s 扫描**。
- 建议把 `literals` 限制为"长度 3–48、snake_case、命中过至少一次运行时工具名或与包 token 有交集"的集合，避免把 23k 字面量全存盘。

---

## 8. 推荐算法（伪代码，不写实现代码）

```
resolve(toolName):
  # 0. 恒等域
  if parseMcpToolName(toolName): return MCP_DOMAIN          # 现有规则，不变
  if isHostBuiltinTool(toolName): return HOST_BUILTIN       # 现有规则，不变（必须先跑）

  # 1. 运行时栈（T0，最高优先）
  if runtime.attribution[toolName]: return {package, matchedBy:"runtime"}   # confidence=high

  # 2. 静态字面量唯一（T1）
  owners = packages.filter(p => p !== SELF && p.literals.has(toolName))
  if owners.length == 1: return {package: owners[0], matchedBy:"literal"}   # confidence=high

  # 3. 前缀/现有硬编码表（T4，保守优先）
  if rule := TOOL_RULES.match(toolName): return {display: rule.display, matchedBy: rule.match}

  # 4. 名字相似度（T3）——唯一 + margin
  scored = packages.map(p => ({p, s: tokenScore(toolName, p)}))
  best, second = top2(scored)
  if best.s >= 0.5 and (second.s is None or best.s - second.s >= 0.3):
      return {package: best.p, matchedBy:"similarity", confidence:"medium"}
  return UNATTRIBUTED                                        # 来源未识别
```

**冷启动顺序**：插件 `apply()` 里先挂 `tools/change` 监听（T0 从此刻起生效），再读缓存（得到历史 T0 + T1/T2/T3 结果），最后在首次枚举时补一次惰性扫描（未命中包才扫）。

**unit id 稳定性（重要约束）**：现有持久化键是 `plugin:<unit>`，`unit` 当前 = `rule.display`（`src/tools/types.ts:21-25`、`src/tools/manager.ts:220-232`）。
改成自动归属后：
- 建议 `unit` 用**归一化包名**（如 `dsh-univer-office`），display 另存展示名；
- 现有 10 条 `TOOL_RULES` 的 display 必须映射到同一 `unit`（否则 `tools-global.json`/`session-capabilities.json` 里的 `plugin:<unit>` 全部失效 = 用户开关丢失）；
- 对 `TOOL_RULES` 里 display 与包名不一致的两条（`dsh-im` vs `@xmanrui/dsh-im`、`dsh-popout-window` vs `@local/dsh-popout-window`）保留 display 作 unit，包名只作诊断字段。

---

## 9. 预计实现改动面（实现是别人的任务，这里只估面）

| 文件 | 动作 | 估算 |
|---|---|---|
| `src/tools/attribution.ts` | 新增：`tools/change` 监听器 + 栈捕获 + 包名解析 + 合并 T1/T2/T3 + 内存表 | +250~350 行 |
| `src/tools/attribution-static.ts` | 新增：包根解析（`pluginPackages.packageOf` / `createRequire` 兜底）+ 调优扫描 + 字面量索引 | +200~250 行 |
| `src/tools/attribution-cache.ts` | 新增：`tool-attribution.json` 读写（照 `global-state.ts` 范式） | +120~160 行 |
| `src/shared/plugin-attribution.ts` | 改：保留 `TOOL_RULES` 为 fallback；新增 `ToolAttribution` 类型与纯函数（similarity/停用词/自包排除）；`MCP_NAMESPACE_RULES` 保留为降级 | +80~120 行 |
| `src/tools/manager.ts` | 改：`enumerateTools()` 的 `attributeTool(name)` 换成 `resolver.resolve(name)`（`:207-232` 一段） | ~15 行 |
| `src/mcp/runtime.ts` | 改：`attributeMcpNamespace` 改为"先查动态表、再查 `MCP_NAMESPACE_RULES`"（`:169-180`） | ~20 行 |
| `src/index.ts` | 改：装配 resolver（`ctx.on("tools/change")` 与 manager 共用），并暴露诊断 | ~15 行 |
| 单测 + README + CHANGELOG | 按仓库纪律（`notes/verify` 或 `*.test.ts`） | 视仓库现有测试布局 |
| **合计** | **5 改 + 3 新增文件，约 700–1000 行**；不触碰 `restrict.ts`（deny 只用名字）、不动会话/全局状态格式 | |

风险隔离：T0 只在内存里加一条监听；T1/T2/T3 全部是"读文件/读字符串"的纯函数；任何一层失败都降级到下一层，最差等于今天的行为（TOOL_RULES + 来源未识别）。

---

## 10. 风险与降级

| # | 风险 | 影响 | 降级/缓解 |
|---|---|---|---|
| R1 | 栈帧被 bundler/sourcemap 改写、或帧深度超限 | T0 失效 | `Error.stackTraceLimit=48`（finally 恢复）；解析失败就跳过 T0，落 T1–T4 |
| R2 | 在监听器内抛异常 | 影响宿主注册流程 | 全程 try/catch 吞掉（沿用 `src/mcp/usage.ts` 的 guard 纪律），绝不 rethrow |
| R3 | 每次 `tools/change` 都读 `schemas()` 做 diff | 注册风暴时 O(n²) | 只捕获栈、按 name 去重；diff 用增量 Set，不每次全量比对 |
| R4 | 启动顺序早于本插件的工具 | T0 覆盖不到 | 冷启动静态回填 + 现有表 |
| R5 | 同名工具被不同插件先后注册（replace） | 归属漂移 | 以最后一次注册为准（与宿主 registry 语义一致），记录 `at` 时间戳 |
| R6 | 静态扫描被恶意/超大的插件包拖慢 | 冷启动变慢 | 单文件 2 MB、包级 0.3 s 超时（`Promise.race`）、跳过 artifacts，失败即放弃该包 |
| R7 | 自污染（本仓库源码含工具名字面量） | 误归属到自己 | 显式排除 `SELF` 包名（实测 `figma` 已出现，非假设） |
| R8 | 宿主升级后内建工具名单变化 | 新内建工具被当插件工具 | 内建过滤保持"名单 + 前缀"，并让 T0 把宿主帧（含 `app.asar`）直接归为宿主 |
| R9 | `pluginPackages` 服务缺失/不提供 dir | 拿不到包根 | 用 `createRequire(baseUrl).resolve.paths(name)` 逐级找 `package.json`（`dsh-app-boot:3566-3572` 的官方兜底同款） |
| R10 | 栈里出现软链接路径（本机 `@local/*` 是 `link:` 依赖） | 包名解析成真实路径 | 取路径里的 `node_modules/<name>` 段，或 `realpath` 后再匹配；包名优先用 loader entry 的 `options.name` 对照 |

---

## 11. 待验证（建议 tester，本地只读脚本即可闭环）

| # | 待验证 | 方式 | 失败时的降级 |
|---|---|---|---|
| V1 | `tools/change` 监听器里的栈**确实**含注册插件包路径 | 临时在 `src/mcp/loader.ts:765` 的 listener 里 `console.log(new Error().stack)`（Debug 构建/隔离环境），注册一个测试工具观察 | T0 不可用 → 全量走 T1–T4（覆盖率降到 ~96%） |
| V2 | 本插件 `apply()` 相对其它插件的加载顺序（覆盖窗口大小） | 启动日志打印 loader entries 顺序；确认第三方插件在其后 | 同上 |
| V3 | `ctx.get("pluginPackages")` 从**插件 ctx** 可见性（inspect 里没有该 key，但 Config provider 用到了） | 插件内 `ctx.get("pluginPackages")` 打印是否 undefined | 用 `createRequire` 兜底（R9） |
| V4 | 栈帧在 HMR 重载后是否仍指向包路径 | 热重载一次再看 | 同上 |
| V5 | 26 个包全量扫描在目标机器上的真实耗时（本机 0.46 s） | 加一次性 debug 计时 | 缓存 + 惰性单包扫描 |
| V6 | `univer_inspect` / `plugin_manager` 两个当前无法静态归属的工具，T0 是否可解 | 同 V1 | 归入"来源未识别" |

---

## 12. 与"用户要求"的对照

- **「以后插件多了不用每次加表」**：T0 让**新增插件零配置**即被正确归属；T1/T2 让冷启动也基本自动；只有名称完全无关且注册早于本插件的工具才需要人工兜底（本机实测占比 0，最坏 4.2%）。
- **「低风险」**：T0 只是加一个监听器；T1/T2/T3 全部只读、可回退；最差等价于今天（硬编码 + 来源未识别）。
- **「可缓存」**：§7 的 `tool-attribution.json`（包名+version+mtime 键，原子写），命中后 0 扫描。
- **「失败降级到现有表与来源未识别」**：T4/T5 就是现有行为，保留不动。

---

## 13. 复现命令（全部只读）

```bash
# 1) 宿主侧真实工具清单（运行时只读检查器）
#    cordis_inspect_query: platform=host, provider=Tool, method=listTools
#    本机结果：214 个工具（109 个 mcp__*，10 个命名空间；非 MCP 105）

# 2) loader 条目目录（运行时只读）
#    cordis_inspect_query: provider=Config, method=listConfigs → total: 238
#    单条：{entry:"include:capability-panel"} → packageDir: /Users/lzx/.dsh/profiles/desktop/node_modules/dsh-capability-settings

# 3) 宿主信号源码（app.asar 只读解包后 grep）
grep -n 'emit("tools/change")' /tmp/asar-scout/src/dsh-tools/lib/index.js          # 2784
grep -n "emit(...args)" /tmp/asar-scout/src/cordis/lib/index.js                   # 280-282（同步）
grep -n "	get name()" /tmp/asar-scout/src/cordis/lib/index.js                     # 1117
grep -n "	packageOf(specifier, parentURL)" /tmp/asar-scout/src/dsh-app-boot/lib/index.js  # 3544

# 4) 静态扫描实验（7 插件 / 26 包；Python，跳过 artifacts 与 >2MB）
#    见本文 §3.2 参数；字面量正则：["'`]([a-zA-Z][a-zA-Z0-9_.\-]{2,60})["'`]
```

## 14. 参考

- 既有取证：`docs/research/capability-v13-evidence.md`（`schemas()` 无 provenance、restrict 契约、MCP 来源字段）。
- 现状实现：`src/shared/plugin-attribution.ts`（TOOL_RULES / MCP_NAMESPACE_RULES / SOURCE_DISPLAY）、`src/tools/manager.ts:170-285`（枚举与归属应用）、`src/tools/types.ts:21-25`（`plugin:<unit>` 持久化键）、`src/tools/global-state.ts:26-60`（缓存文件范式）。
- 宿主包：`@deepseek-ai/cordis`（Fiber/Runtime/emit/effect meta）、`@deepseek-ai/cordis-plugin-loader`（Entry/entries/baseUrl）、`@deepseek-ai/dsh-tools`（register/tools.change）、`@deepseek-ai/dsh-scope`（ScopedLayers.effect）、`@deepseek-ai/dsh-app-boot`（PluginPackages.packageOf/metaOf）、`@deepseek-ai/dsh-tool-cordis`（packageDir 官方消费范例）。
- 本机：`~/.dsh/profiles/desktop/{package.json,cordis.yml}`、`~/.dsh/profiles/desktop/node_modules/{dsh-to-figma,dsh-univer-office,dsh-remote,@xmanrui/dsh-im,dsh-better-sidebar,@local/dsh-popout-window,dsh-diff-approval}`。
