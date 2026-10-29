# v13 取证：插件注入工具 / MCP 来源 / 会话首屏 / 配置文案 / 布局

> 角色：scout（只读取证，不做设计决策）。任务：`task-1`。日期：2026-10-29。
> 写作用域：本文件是本次唯一落盘产物。
> 仓库基线：`f454a03`（docs(architecture): 派生能力继承与自动选择方案）。
> 宿主版本：桌面应用 **0.2.1-rc.3**（`/Applications/DeepSeek Harness.app/Contents/Info.plist` → `CFBundleShortVersionString`；
> 各宿主包 `package.json` 内 `"version": "0.2.1-rc.3"`，如 `/tmp/asar-scout/src/dsh-tools/package.json`）。
> 宿主源码：`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`（asar 归档，按条目 `offset` 只读解包到 `/tmp/asar-scout/src/` 供 grep；**未修改任何宿主文件**）。

## 0. 证据分级与引用约定

- **[源码]**：本仓库源码实读，`文件:行号` 以工作树 `f454a03` 为准。
- **[宿主]**：app.asar 内宿主包源码实读，引用形如 `@deepseek-ai/dsh-tools lib/index.js:2991`（包名 + 文件 + 行）。
- **[本机]**：用户本机 `~/.dsh`、`~/.agents`、已装插件 `node_modules` 只读观察。
- **[推断]**：由上述事实推出，未直接观测。
- **[待验证]**：需要跑起来（tester / 真机）才能确认，给出的降级口径写在同一行。

结论只用三档：Fact / Inference / Assumption。

---

## 1. 摘要（每条一句话，细节见对应章节）

| 点 | 一句话结论 |
|---|---|
| E1 | 宿主 `tools` 服务是**单一 registry**，`schemas()` 只回 `{name, description, parameters, deferLoading?}`（**无来源/owner 字段**），注册时不记录注入方 ⇒ 运行时**拿不到**"哪个插件注入了哪个 tool"的权威映射，只能靠 MCP 命名前缀 + 插件清单做启发式归类。 |
| E2 | `tools.restrict({deny})` 对插件工具**同样生效**（按名字，不区分宿主/插件），但**只能屏蔽"继承层"（global + 祖先 scope）的工具**；注册在 agent 自身作用域的工具（Agent Teams 全组工具、子 agent structured-output 工具）**不可关闭**，`run_code` 也不可。宿主**没有** dangerous/system 标签 ⇒ 排除清单必须自维护。 |
| E3 | "外部注入 MCP 的来源"已有字段 `source`（=cordis `Fiber.name` 或 loader 条目 id）+ `origin`，但**只覆盖 mcp-client 桥接实例**；插件直接注册 `mcp__*` 工具（本机 `dsh-to-figma`）发现不到。首屏 MCP 行模型目前**不展示** `source`（仅当 `tools.length === 0` 时兜底当 meta）。 |
| E4 | 首屏"本会话能力"与「能力」Tab 是**同一组件** `CapabilityPanel`（`mode="hero"` / `"view"`）；"恢复默认"是**逐条 RPC 的 `Promise.all`**，**没有批量端点**；面板高 340、卡片区 174、4 列，容器查询断点 820/600。 |
| E5 | 派生继承仍是**提案**（`docs/architecture/agent-capability-inheritance.md` 标注"未实现"，`src/shared/session-lineage.ts`、`src/agents/` 均不存在）；持久化只有 `session-capabilities.json` v1 的 `{skills,mcp}` 两个域，**无** policy/继承字段。 |
| E6 | Jev 文案原文在 `src/client/jev-panel.tsx:65-66`（`securityPath` / `securityTail`），渲染在 `:602-603`；另 `:78` 的 `apiKeyHint` 与 `:757`。 |
| E7 | 首屏一行已接近满：Tab 行（3 Tab + 提示 + 能力决策 + 管理全部）内部宽度约 892px 时已用 ~690px；hero 面板实际宽度 = 输入卡 `rect.width`（宿主上限 `min(100%−16px, 952px)`，内容宽默认 `min(100%−32px, 920px)`），**不是 936**。 |

---

## 2. E1 插件注入工具的枚举与归属

### 2.1 宿主 tools 服务怎么列工具

**Fact（宿主）** —— `@deepseek-ai/dsh-tools`（`lib/index.js`）：

| 符号 | 行 | 事实 |
|---|---|---|
| `ToolRuntime extends Service` | 2760 | 服务名 `"tools"`；`layers = new ScopedLayers(...)` 按 scope 分层 |
| `register(definition)` | 2974-2982 | `this.layers.effect(this.ctx, (layer) => layer.tools.insert(name, definition))`；**只按名字插入 layer.tools，不写任何来源/owner 元数据** |
| `view(scope)` | 3055-3080 | 入参 `scope` 为 `undefined` 时是**全局视图**：`inherited = global layer`；agent 视图 = global + 祖先链层 + 自身层；返回 `{visible, knownNames, restrictableNames}` |
| `get(name, scope)` | 3091 | 单查 |
| `schemas(scope)` | 3119-3121 | `[...view(scope).visible.values()].map(d => this.schemaOf(d, true))` |
| `schemaOf(definition, detach)` | 3135-3144 | 只投射 `{ name, description, parameters, deferLoading? }` |

**Fact（宿主）** —— `ToolSchema` / `ToolDefinition` 的公开声明：

- `ToolSchema = { deferLoading?: true; name: string; description: string; parameters: Record<string, unknown> }`
  —— `@deepseek-ai/dsh-tool-cordis lib/types/api-catalog.js:8260`。
- `ToolDefinition extends ToolSchema`，另有 `output` / `execute` / `projectContent?` / `finalizeContent?` / `timeoutMs?` / `isConcurrencySafe?` / `presentCall?` / `presentResult?`
  —— 同文件 `:8156`。**没有任何 origin / source / owner / plugin / owner 字段。**

**Fact（宿主）** —— 服务的"调用方作用域"是 cordis 的可追踪代理机制提供的，而不是服务实例自身：

- `ctx.get(name)` → `getTraceable(this.ctx, impl.value)`：`@deepseek-ai/cordis lib/index.js:764`。
- 方法被调用时 `this` 被替换为**调用 ctx 的 shadow**：`createShadow` / `createShadowMethod`，`@deepseek-ai/cordis lib/index.js:111-130`；
  `Service` 基类把 `ctx` 存在实例上并返回可调用代理：`@deepseek-ai/cordis lib/index.js:1742-1771`；
  `scopeOf(ctx)` 读 `ctx[kScope]`：`@deepseek-ai/dsh-scope lib/index.js:312`（`kScope = Symbol("dsh.scope")`，非 `Symbol.for`，跨副本不通用 —— 与本仓库 `AGENTS.md` 的"必须用宿主那份 dsh-scope"是同一约束）。

⇒ **Fact**：从插件自己的 ctx（无 agent scope）调 `ctx.get("tools").schemas()` 得到的是**全局视图**（不含任何 scoped 注册）；这与 `src/mcp/loader.ts:37-45` 的注释一致，也是 `src/mcp/loader.ts:494-512` 取全局 MCP 工具名的依据。

### 2.2 能否判定"插件注入"而非"宿主内置"

**Fact（宿主）**：不能从 tools registry 判定。原因三层：

1. 注册入口 `register(definition)` 不接受来源参数（`dsh-tools lib/index.js:2974-2982`）；
2. `schemas()` 投射字段里没有来源（`:3135-3144` + `api-catalog.js:8260`）；
3. 工具包 `package.json` 也不声明工具清单（反例：`dsh-tool-bash/package.json` 只有 name/version/exports/peerDependencies，无 `dsh.*.tools`）。

**Fact（宿主）**：插件清单可用，但**没有 "插件 → 工具" 映射**：

- `pluginInventory/list` 只投影 loader 条目：id、模块标识、有效启用状态、fiber phase、可选 meta
  —— `@deepseek-ai/dsh-host-plugin-inventory` README.zh.md「快照包含什么」段（"每一行是一个非组 Loader 条目"）。
- `@deepseek-ai/dsh-plugin-package-inventory-deepseek` 与 `@deepseek-ai/dsh-plugin-manager` 源码内均无 tools 归因（grep `tools` 只命中 peerDependencies 名单）。

**Fact（宿主）**：唯一的运行时"有名字的归属"信号来自 **cordis 插件注册表 / loader 条目**，且只对 **mcp-client** 这一种桥接有效：
`Fiber.name` = 最近具名祖先；`Plugin.Runtime` 有 `name` / `fibers`
—— 本仓库实现见 `src/mcp/runtime.ts:12-18`、`:72-118`（fiber 扫描）、`:120-150`（loader 条目扫描）。

**Fact（本机，只读观察）**：插件确实可以只注册工具、不带 MCP 实例。`dsh-to-figma`（插件 id `dsh-figma`）：

```
node_modules/dsh-to-figma/index.mjs:7   import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client'
node_modules/dsh-to-figma/index.mjs:15  export const name='dsh-figma'
node_modules/dsh-to-figma/index.mjs:49  const tool=createMcpToolDefinition(ctx,{name:qualified?publicToolName('figma',rawName):rawName,...})
node_modules/dsh-to-figma/index.mjs:51  const dispose=ctx.tools.register(tool)
```

⇒ 它注册出来的是 `mcp__figma__*`（`publicToolName` 规则见 `@deepseek-ai/dsh-mcp-client lib/index.js:97-103`），但**没有** `ctx.plugin(mcpClient, ...)` 实例，因此
`src/mcp/runtime.ts` 的两条发现路径都不会产出 `figma` 这一条外部实例。**这是 E3/R4 的关键缺口**。

**Fact（本机）**：本机 profile 里注册工具的非宿主插件（`grep -rl "tools.register"` 于 `~/.dsh/profiles/desktop/node_modules`，排除 `.pnpm`）：

| 插件 | 工具名（实读） |
|---|---|
| `dsh-to-figma` | `mcp__figma__<raw>`（如 `mcp__figma__download_assets`，最长 28 字符） |
| `dsh-univer-office` | `univer_new` / `univer_import` / `univer_inspect` / `univer_execute` / `univer_export` / `univer_screenshot` / `univer_api` / `univer_resources` / `univer_compile_svg` / `univer_lint` / `univer_print_pdf` / `univer_worktree` / `univer` |
| `dsh-remote` | `rw_connect` / `rw_machines` / `rw_pick_workspace` / `rw_list_dir` / `rw_exec` / `rw_read_file` / `rw_edit` / `rw_push` / `rw_*`（≥19 个） |
| `@xmanrui/dsh-im` | `dsh_im_context` / `dsh_im_files` / `dsh_im_group_file` / `dsh_im_group_history` / `dsh_im_reply_to` / `dsh_im_return_file` / `dsh_im_source` / `dsh_im_source_guidance` |
| `dsh-better-sidebar` | `sidebar_open` |
| `@local/dsh-popout-window` | `open_in_popout` |
| `dsh-diff-approval` | `dsh-diff-approval-annotate` |

（`dsh-context` 命中 `tools.register` 但未定位到工具名 → [待验证]。）

**Fact（宿主/本机）**：宿主内置工具的注册点在各自包的 `ctx.tools.register(...)`，名称为：

`bash`、`pwsh`、`read`/`write`/`edit`/`read_image`、`glob`/`grep`、`str_replace_editor`、`web_search`/`web_fetch`、`skill`、`todo_write`、`present`、`job_*`(4)、`schedule_*`(4)、`session_*`(5)、`terminal_*`(6)、`create_goal`/`get_goal`/`update_goal`、`ralph`、`load_workspace_dependencies`、`working_directory`、`ask_user_question`、`cordis_inspect_list`/`cordis_inspect_query`、`list_subagent_models`、`interrupt_agent`/`send_message`、`subagent`、`workflow`（本仓库会话内另见 Agent Teams 的 9 个 + `spawn_teammate` 等）。

### 2.3 本仓库已有可复用的枚举/判定

| 位置 | 现状 | 可复用性 |
|---|---|---|
| `src/index.ts:243-266` | `mcpTools(serverName)`：`ctx.get("tools").schemas()` 过滤 `mcp__<server>__` 前缀，产出 `{name, description}` | **可直接扩展**成"全部工具清单"的取数原语（去掉前缀过滤即可），但仍是全局视图 |
| `src/mcp/loader.ts:494-512` | `globalToolNames(serverNames)`：同样 `ctx.root.get("tools").schemas()` + 前缀过滤；异常降级 `[]` | 同上；已有"服务缺失/抛错 → 降级"范式 |
| `src/mcp/loader.ts:596-612` | 监听 `tools/change` 重算 restrict（微任务合并） | 新增"工具域"后需要同样的**工具集变化重算**机制 |
| `src/mcp/usage.ts` + `src/index.ts:154` | `tools.guard` 旁路记录 `mcp__*` 调用 | 只记 MCP 前缀，非通用工具 |

**Fact**：仓库内**没有**任何"非 MCP 工具"的枚举、来源判定或开关代码（`grep -rn 'get("tools")'` 只命中上述三处 + `src/jev/apply.ts:78` 注释）。

### 2.4 结论与降级口径（E1）

**Conclusion（Fact + Inference）**：
- Fact：宿主不提供"工具 → 注入插件"映射；`schemas()` 没有来源字段；注册无 provenance。
- Inference：R3 的"插件工具域"若要在 UI 上显示"插件名 + 工具名列表"，只能靠三条**旁路**：
  (a) **命名规则**：`mcp__<serverName>__*` → 可归属到 MCP 服务器（进而归属到 mcp-client 实例的 `source`）；
  (b) **插件清单 × 约定前缀**：`ctx.loader.entries()` 给插件名/条目 id（`pluginInventory` 同源），配合硬编码/启发式前缀（`rw_*`→dsh-remote、`univer_*`→dsh-univer-office、`mcp__figma__*`→dsh-to-figma、`dsh_im_*`→@xmanrui/dsh-im、`sidebar_open`→dsh-better-sidebar、`open_in_popout`→dsh-popout-window）；
  (c) **静态扫描已装插件包**（如 `~/.dsh/profiles/desktop/node_modules/*/lib/*.js` 里 `tools.register` 附近的 `name:`），代价与误报都高，不建议进产品路径。
- **降级口径（建议写进设计）**：识别不到来源时统一显示 **「来源未识别 · 插件」**（不要显示宿主内置），并按"工具名"排序；MCP 行继续用 `serverName` 作为名字。

**Assumption**：宿主后续版本可能给 `ToolDefinition` 加来源字段或提供 tools 的 remote 列表。
若错（现状即终态），R3 的"按插件分组"只能靠上述旁路；影响：分组名可能是启发式猜测，需 UI 兜底文案。

**[待验证]**：真实的 `ctx.get("tools").schemas()` 输出条数与内容（需要运行时 dump；tester 一条命令即可：在实机插件内 `console.log` 或临时 RPC 返回）。降级口径：以本文件 §2.2 的"宿主内置名单 + 本机插件名单"合并估算。

---

## 3. E2 插件工具的会话级开关可行性

### 3.1 restrict 契约（宿主原文）

**Fact（宿主）** —— `@deepseek-ai/dsh-tools lib/index.js:2991-3005`（`restrict(filter)`）：

```
:2992  const scope = scopeOf(this.ctx);
:2993  if (scope === void 0) throw "requires a scoped context (agent.ctx)"
:2995  if (allow === void 0 && deny === void 0) throw "tools.restrict({}) is a no-op"
:2999  if ([...allow, ...deny].includes("run_code")) throw "cannot name reserved PTC mode presentation transport"
:3002  const known = this.view(scope).restrictableNames;
:3004  if (unknown.length) throw "names unknown global tool …"
:3005  return this.layers.effect(... restrictions.append ...)
```

**Fact（宿主）** —— 语义边界（同文件 `:3040-3041` 注释 + `:3066-3068`）：

> "A restriction filters what a scope inherits — the global layer and every ancestor layer on its chain — and **never what its OWN layer registers**."
> `restrictableNames` 只收集 `inherited`（global + 祖先层），**不含 own 层**。

⇒ 四条硬约束（对本插件已有实现完全同构，见 `src/mcp/loader.ts:31-45`）：

1. 必须 `agent.ctx.get("tools").restrict(...)`（无 scoped ctx 抛错）；
2. 空 filter 抛错；
3. 名字必须是**当前已注册的"可继承"名字**，否则抛错（`scope-local` 名字同样抛）；
4. 只能过滤"继承层"，**改不了本 agent 自己层注册的东西**。

**Fact**：`deny` 是**数组**，可以逐工具精确屏蔽（同插件多工具可逐个 deny）；也可 `deny: [同 server 全部工具]`（现有实现即如此，`src/mcp/loader.ts:537-575`）。

**Fact（宿主）**：`tools.restrict` 对"插件工具"与"宿主内置工具"**无区别待遇** —— restrict 只按名字编译进某个 scope 的 `restrictions`，`view()` 里统一 `layer.admits(name)` 过滤（`:3055-3079`）。所以"插件注入的 tool 能否被会话级关闭"的答案是：**能，只要它在继承层且名字已知**。

### 3.2 不可关闭清单（证据支撑，直接可给 ux/architect）

| # | 类别 | 证据 | 结果 |
|---|---|---|---|
| 1 | **Agent Teams 全组工具**（`spawn_teammate` / `list_agents` / `send_message` / `wait_agent` / `interrupt_agent` / `team_task_*`） | 注册进 `agent.ctx` 的**自身层**：`@deepseek-ai/dsh-experimental-tool-agent-team lib/index.js:213-214`（`install(agent, ctx, config)` → `const scoped = agent.ctx`）+ `:250,292,320,329,351,364,399,443,456` 的 `scoped.tools.register(...)` | **不可 restrict**：名字不在 `restrictableNames`，调用即抛 "unknown global tool" |
| 2 | 子 agent 的 structured-output 工具 | `@deepseek-ai/dsh-subagent lib/index.js:908` `childCtx.tools.register({...})` | 同上（own 层） |
| 3 | `run_code`（PTC 呈现传输） | `dsh-tools lib/index.js:2999` 显式抛错；`:2868-2875` 说明它永不进 global 层 | 禁止出现在 deny/allow |
| 4 | 全局视图里看不到的工具（父作用域/预设层注册，root 视图不含） | `dsh-tools lib/index.js:3055-3079` | 不是"不可关闭"，而是"**枚举不到就关不了**"——必须先能从 agent 作用域枚举（见 §3.4） |
| 5 | 语义上"关掉即毁会话"的工具（`bash` / `read` / `write` / `edit` / `skill` / `present` / `todo_write` 等） | **宿主没有任何 dangerous/system/toolset 标签**（`ToolSchema` 只有 4 个字段，`api-catalog.js:8260`）；权限层是 `dsh-permission-presets` + `dsh-sandbox-policy`（按 sandbox 模式，不按工具名标注等级） | 宿主不替我们排除 ⇒ **排除清单必须本插件自维护**（写死名单 + 版本适配） |

**Inference**：第 5 类是可关闭的（技术上），但产品上应排除；`bash`/`read`/`write` 之类被 deny 后模型仍能"说话"，只是无法行动 —— 这与"能力面板"的语义冲突，需 architect 定排除清单口径。

### 3.3 关闭后是否影响 subagent / teammate（R2 语义相关）

**Fact（宿主）**：agent 作用域**不嵌套**。`ReactLoopAgent` 构造 `this.scope = createScope(loopCtx, this)`
—— `@deepseek-ai/dsh-agent-loop lib/index.js:778`；`createScope` 只有 `options?.parent` 可选（`@deepseek-ai/dsh-scope lib/index.js:296-320`），loop 未传 parent。

**Fact（宿主）**：宿主自带的委派机制只把**policy** 下发给 child，且用 child 自己的 ctx 上 restrict：
`@deepseek-ai/dsh-subagent lib/index.js:395` `if (composition.toolFilter !== void 0) childCtx.tools.restrict(composition.toolFilter)`。
`toolFilter` 形状 = `{allow?, deny?}`（`dsh-subagent` 的 `parseToolFilter`，`:585-620`）。

⇒ 结论：
1. **父 agent 的 restrict 不会自动作用于 child**（scope 是兄弟，不是父子）；
2. 要让 child 继承，必须**在 child 的 ctx 上重复 restrict**（这正是 `docs/architecture/agent-capability-inheritance.md` §3 的方案）；
3. 关掉 `subagent`/`spawn_teammate` 工具本身不影响"继承"机制（继承发生在插件侧），但会让该 agent 无法派生 —— 与 R2 的"继承/不继承"是两个正交开关。

### 3.4 能否拿到"确切工具名"（枚举）

**Fact**：能，但有作用域限制：
- `ctx.get("tools").schemas()` = 全局视图（宿主内置 + 所有无 scope 注册的插件工具 + 全局 MCP 工具）；
- agent 视图需要 `ScopeKey`（`schemas(scope)`），而 `ScopeKey` 只能由 `scopeOf(agentCtx)` 拿到（`@deepseek-ai/dsh-scope lib/index.js:312`），且 `kScope` 是普通 Symbol ⇒ **必须用宿主那份 dsh-scope**，插件自带副本读不到（与 `AGENTS.md` 的 MCP 历史坑同源）。

**Fact（本机）**：本机 profile 的 `cordis.yml` 里，工具插件**同时**出现在根组合（`~/.dsh/profiles/desktop/cordis.yml:208` `tool-bash`、`:220` `tool-fs`、`:311` `subagent`、`:398` `tool-web`、`:407` `dsh-tools`）**和** agent preset 组合（`:683`、`:847`、`:1114` 等）。

⇒ **[待验证]**：preset 层注册的工具是否会以"祖先层"形式出现、以及 root 全局视图是否已包含它们（两处重复注册时 preset 侧 `register` 会不会因同名冲突失败）。降级口径：以**全局视图 + 现有的 agent-scope 探测**两路合并；拿不到就只展示全局视图能看到的工具（并在 UI 注明"部分会话内工具不可见"）。

### 3.5 现有实现可直接复用的部分

`src/mcp/loader.ts:537-575` `applyRestrictions(record)`：先 `globalToolNames()` 取名单 → 空名单降级 `skipped` → `tools.restrict({deny})` → 失败降级 `warning` + 状态视图。
**Fact**：这是"通用工具域"最接近的现成骨架，唯一要改的是名字来源（从 `mcp__` 前缀改成"任意工具名集合"）与"不可关闭清单"过滤。

---

## 4. E3 MCP 来源信息（R4）

### 4.1 现有"外部注入"来源字段

**Fact（本仓库）**：

| 层 | 字段 | 位置 |
|---|---|---|
| 宿主视图类型 | `source?: string`（"注入它的插件显示名（cordis `Fiber.name`）或 loader 条目 id；识别不到缺省"）、`origin: "entry" \| "fiber"` | `src/mcp/types.ts:216-246` |
| 客户端类型 | 同名字段 | `src/client/api.ts:348-369` |
| 发现实现 | fiber 扫描（`Fiber.name` 作 source）+ loader 条目扫描（`entry.options.id` 作 source），两路并集 | `src/mcp/runtime.ts:24`（`BRIDGE_PACKAGE = "dsh-mcp-client"`）、`:72-118`、`:120-150` |

**Fact（宿主）**：`Fiber.name` 语义 = "inherited from the nearest named ancestor"（本仓库 `src/mcp/runtime.ts:14` 引用；`Plugin.Runtime` 有 `name`/`fibers`，`@deepseek-ai/cordis` 注册表按 runtime 分桶）。

⇒ 所以 `source` **是插件名（或 loader 条目 id）**，语义上就是 R4 要的"插件"。

### 4.2 首屏 MCP 行现在展示什么

**Fact（本仓库）**：首屏 MCP Tab 的行模型在 **`composer-capability.tsx` 的 `buildMcpRows()`**（`:1413-1468`），不在 `composer-mcp.tsx`。

`McpRow` 字段（`src/client/composer-capability.tsx:104-121`）：`id / kind / name / tag / tone / meta / enabled / disabled / dot / target / writeKind / locked`
—— **没有 channel/source 字段**（SkillRow 有 `channel?` + `injected?`，见 `:87-103`）。

外部实例行的当前取值（`:1435-1465`）：

```
name   = server.serverName
tag    = "外部"   tone = "external"
meta   = restrictable !== true ? "不可在当前对话关闭"
       : tools.length > 0 ? `${tools.length} 个工具`
       : typeof source === "string" ? source : "外部实例"
```

⇒ **Fact**：`source` 只在"该实例没有可见工具"时被折叠进 `meta` 显示；有工具时 UI 上**看不到插件名**。R4 需要改的正是这一处（把 `source` 提升为独立"来源标签"，与 SkillRow 的 `channel` + `skp-dock-tag-channel` 同形，标签渲染见 `:1521-1530`）。

**Fact（区分）**：`src/client/composer-mcp.tsx` 是**输入框工具条的 MCP 快捷弹层**（模块头注释 `:1-27`：`conversation.input.left` 按钮 + `conversation.input.overlay` 弹层，按"当前项目 / 全局"分组），它的行只有 server 名 + 开关，**不是**首屏 MCP Tab 的行模型；R4 不应改这里（除非要两处一致）。

### 4.3 "插件注入 MCP" 与 "插件注入 tool" 是不是同一域

**Fact（宿主）**：**同一个工具注册表、同一个 `mcp__` 命名空间，但两条不同的"存在形态"**：

1. **mcp-client 实例**：`ctx.plugin(mcpClient, config)` 起桥接，工具名由 `publicToolName(serverName, rawName)` 生成并 `ctx.tools.register`（`@deepseek-ai/dsh-mcp-client lib/index.js:97-103`、`:131-153`）。**可被 `src/mcp/runtime.ts` 发现**（fiber 或 loader 条目）。
2. **插件直接注册**：插件自己调 `ctx.tools.register(createMcpToolDefinition(...))`，名字可以带 `mcp__` 前缀，但**没有实例**。本机实例：`dsh-to-figma`（§2.2）。

⇒ **Fact**：`figma` 就是"既注册 `mcp__figma__*` 工具、又不挂 mcp-client 实例"的活例。它在本机**不会被** `mcp.runtime` 列为外部实例，因此**不会出现在 MCP 面板**；但它的工具确实在全局工具视图里（`mcp__figma__*`）。

**Fact（本机 profile 现状）**：
- `~/.agents/mcp.json` 有 8 个 server：`AnySearch / context7 / tavily / playwright / deepwiki / open-computer-use / Parallel Search / jev-browser-chrome`（全部由本插件的**全局层**按配置挂载，不是"外部注入"）。
- `~/.dsh/profiles/desktop/cordis.patch.yml` / `cordis.yml` 中**没有** `mcp-client` 的 `insert:` 条目；`grep -rl "dsh-mcp-client"` 命中的第三方包只有 `dsh-to-figma`（用 `createMcpToolDefinition`，非实例）与 `dshmarket`（静态检查用）。
⇒ **本机现在没有真正的"外部注入 MCP 实例"**。R4 的"插件 · 名称"当前实际只对 `figma` 这类"插件自注册 mcp__ 工具"有意义 + 未来 profile 注入生效时才有价值。若不做第 2 类识别，R4 在真机上**看不到任何新标签**。

### 4.4 R4 所需字段与缺口

| 需要 | 现状 | 缺口 |
|---|---|---|
| 插件名 | `source`（fiber name / entry id）✅ | 仅 mcp-client 实例有；`figma` 没有 |
| 展示名 | `channel` 同义（Skill 侧）✅ | MCP 侧无 channel 概念 |
| 名字归一（`dsh-to-figma` → `dsh-figma` 之类） | Skill 侧有映射表：`src/skills/registry.ts:207-237`（`KNOWN_PLUGIN_SOURCES` + `KNOWN_RUNTIME_NAME_PREFIXES`）、`:500-550`（channel 决议） | MCP 侧没有映射表 → 需要一张同样的表（or 用 `source` 原样） |
| `mcp__` 前缀聚合 | `globalToolNames` 已按前缀归组（`src/mcp/loader.ts:494-512`） | 可用于把"插件自注册的 mcp__ 前缀"当成伪 server 显示 |

**Inference（给 architect）**：R4 的最小可行口径 = 在 `runtime` 的两条发现路径之外，**再加第三条**："全局工具视图里 `mcp__<x>__*` 的 `<x>`，若没有对应实例，则视为'插件工具命名空间'"，来源用 `KNOWN_RUNTIME_NAME_PREFIXES` 式的映射表（或标"来源未识别"）。这样 `figma` 才会出现。

---

## 5. E4 会话首屏结构（R1/R2 落点）

### 5.1 `composer-capability.tsx` 结构（行号）

| 区块 | 行号 | 说明 |
|---|---|---|
| 组件入口 `CapabilityPanel` | `1570` | `mode: "dock" \| "hero" \| "overlay" \| "view"`；hero 与 view **同一组件** |
| 头部（图标 + 标题 + 副标题 + 搜索 + 收起） | `1593-1624` | 标题 `:1597`「本会话能力」；搜索 `:1602-1618`（placeholder「搜索能力」） |
| 域 Tab 行 | `1621-1660` | `:1621` `skp-dock-tab-row`；Skills tab `:1625-1633`、MCP tab `:1635-1645`（每个 tab 带 `x / y` 计数 `:1631`/`:1643`）；`:1647` spacer；`:1649-1651` decisionHint；`:1652` decisionEntry；`:1653-1656`「管理全部 ↗」 |
| 错误条 | `1662-1668` | |
| 卡片网格 | `1670-1686` | `skp-dock-grid`，单卡片 `CapabilityCard`（`:1490-1537`） |
| 底栏 | `1688-1708` | `:1690-1692` 统计 + 注入项说明；`:1694-1703`「恢复默认」；`:1704-1707`「完成」 |
| 收起态能力条 `CapabilityBar` | `1717-1785` | hero 收起后替代面板；chips 最多 5 个（`:1737`） |
| 会话控制器 `useCapabilityController` | `1791-1895` | `toggle` `:1843-1870`、`reset` `:1871-1894` |
| hero 主体 `HeroBody` | `1929-2143` | 定位：`fixed` + `width = composerCardRect.width`（`:2112-2116`） |
| 「能力」Tab 整页 `SessionCapabilityView` | `2149-2211` | `mode="view"`（`:2197`）；隐藏输入框（`:2177-2185`） |

### 5.2 尺寸/密度约束（`src/client/styles.ts`）

| 事实 | 行 | 数值 |
|---|---|---|
| hero 容器宽度来源 | `303-304` | `.skp-dock>* { max-width: var(--dsh-composer-card-max-width, 952px) }`；hero 实际 `width` = `[data-composer-card]` 的 `rect.width`（`composer-capability.tsx:2079-2081` 内联 style） |
| 宿主 CSS 变量定义 | `@deepseek-ai/dsh-client-ui-conversation/lib/client.js:17386` | `--dsh-chat-content-width: min(calc(100% - 32px), 920px)`；`--dsh-composer-card-max-width: calc(var(--dsh-chat-content-width) + 32px)`（另有一条 `min(calc(100% - 16px), 952px)`）⇒ **1440 视口下 hero 面板宽约 920px，上限 952px**；任务书的 "936px" 是近似值（含外边距） —— [推断，需真机量一次] |
| 面板高度 | `324` | `max-height: 340px`；hero 处还有 JS 兜底 `maxHeight = min(360, viewportHeight - rect.top - 24)`（`composer-capability.tsx:2080`） |
| 卡片区 | `348` | `max-height: 174px`；4 列 `repeat(4, minmax(0,1fr))`；gap 8；纵向滚动 |
| 容器查询 | `396-397` | ≤820px → 3 列；≤600px → 2 列 |
| ≥1180px | `421` | hero 网格 5 列（**视口/容器**查询，920 宽命中不到） |
| 卡片文字省略 | `359` | `skp-dock-card-name` 单行 `ellipsis`；`:360` desc 两行 clamp |
| view 模式 | `407-419` | 网格 `auto-fill minmax(240px,1fr)`；搜索宽 220 |

### 5.3 「恢复默认」的批量语义（R1 的实现代价）

**Fact（本仓库）**：

- `reset()`（`composer-capability.tsx:1871-1894`）是**纯客户端循环**：
  - Skills：`snapshot.skills.filter(s => s.enabledInSession === false)` → 对每条 `api.skills.setSessionEnabled({name, enabled: true})` → `Promise.all`；
  - MCP：`snapshot.servers.filter(s => s.enabledInSession !== undefined)` + `snapshot.externals`（仅 `restrictable`）→ 逐条 `api.mcp.setSessionEnabled({target, kind, enabled: undefined})` → `Promise.all`；
  - 失败只 `setError`，最后 `refresh()`。
- **没有批量端点**：`src/remote.ts:135-212` 的 endpoint 表里，`skills.*` / `mcp.*` 全是单条语义（`skills.setSessionEnabled`、`mcp.setSessionEnabled`）；`jev.apply` 是唯一的"批量应用"，但那是 Jev 决策结果专用的入参形状（`src/jev/apply.ts`）。
- 单条开关也是逐条 RPC：`toggle()` `:1843-1870`。

⇒ **R1"全局一键开/关"的实现代价（Fact）**：= "遍历三域行 → 生成 N 条 RPC（与 reset 同构）"。本机历史数据：lead 会话曾记录 **143 个 skill 键 + 9 个 MCP 键**（`docs/architecture/agent-capability-inheritance.md:64`）⇒ 一键关 ≈ 150+ 条 RPC 并发。
**Inference**：需要在设计上明确"乐观回显 + 进度条 + 部分失败聚合"，或由 architect 决定是否新增一个 `*.setSessionBulk` 端点（**现有契约里没有**，属于要动的生产代码面）。

### 5.4 hero 与会话 Tab 是否同一控件

**Fact**：是同一个 `CapabilityPanel`（`1570`），hero `mode="hero"`（`:2106-2107`）、会话 Tab `mode="view"`（`:2197`）。
差异只在容器与可见元素：`view` 隐藏"收起"、显示副标题（`:1598`）、`onManage` 仍渲染（`:2192-2201` 传了 `onManage`）。
⇒ 若 R1/R2 控件加在 `CapabilityPanel` 内（建议的新行），**两处自动一致**；若加在 `HeroBody` 内，则两处不一致。

---

## 6. E5 派生继承现状（R2）

**Fact（本仓库文档）**：`docs/architecture/agent-capability-inheritance.md`
- `:6` 状态 **"提案 v0.1（未实现）"**；
- `:37` lineage 方案 = 沿 `session.header.parentSession` 找根会话，父不在线时用 `sessionPersistence.open(id,"read").header` 兜底；
- `:41` 持久化方案 = 会话级策略写入 `session-capabilities.json` 的会话记录；
- `:194-226` §4.2 明确要**复用** `session-capabilities.json` 并新增 `agentPolicy` / `derivedAgents` 字段，并警告"旧版插件写回时可能只保留已知字段 ⇒ 降级会丢字段"（`:226`）；
- `:243-245` 规划的新文件 `src/shared/session-lineage.ts`、`src/agents/auto-select.ts` —— **两者都不存在**（`ls` 失败）。

**Fact（宿主）**：父子关系只在 session header：
- 子会话写入：`@deepseek-ai/dsh-subagent lib/index.js:352` `parentSession: parentHeader.id`；
- teammate 侧读取：`@deepseek-ai/dsh-experimental-agent-team lib/index.js:873` `agent.session.header.parentSession`。

**Fact（本仓库）**：会话级持久化落点 = `session-capabilities.json`，`version: 1`，记录形状
`{sessions: {<sessionId>: {updatedAt, headerCreatedAt?, cwd?, skills?: {}, mcp?: {}, missingSince?}}}`
（`src/session-state.ts:30-75` 的模块注释 + 类型 `:90-120`）；写入 API 只有 `setSkill` / `setMcp`（`src/session-state.ts:172-176`）。**没有** policy / 继承 / 派生类型字段。

**Fact（本仓库）**：首屏**没有任何**"继承/不继承" UI（`grep -rn "继承\|inherit" src/` 只命中注释与 mcp/types 的说明性文字）。

⇒ **R2 若要落地（Fact）**：至少需要 (1) lineage 解析（新文件或内联）；(2) `session-capabilities.json` 新增字段（同 version 1 加字段是"旧版未知字段会被丢弃"的降级面，提案 `:226` 已标注）；(3) 新 RPC 端点（`src/remote.ts` 现阶段无 policy 端点）；(4) 子 agent 侧重复应用 shadow/restrict/mount 的执行点（`mcp/loader.ts` 的 `remount`、`skills/session.ts` 的 hydrate 都以 `agent.id` 为键，见提案 `:73`）。

**Inference（默认值风险，给 ux 一句话）**：提案 `:47` 的默认值是 `subagent=inherit` / `teammate=inherit` —— 这**改变现有行为**（今天子 agent 拿到的是"项目默认"）；若 UI 只放一个开关而不写清"默认已是继承"，用户会以为关掉才等于旧行为。

---

## 7. E6 文案（R5）

**Fact（原文，逐字）** —— `src/client/jev-panel.tsx`：

| 行 | 常量 | 原文 |
|---|---|---|
| `:64` | `securityLead` | `API Key 只保存在宿主` |
| `:65` | `securityPath` | `~/.dsh/dsh-capability-settings/jev.json` |
| `:66` | `securityTail` | `（目录 700 / 文件 600），不会下发到浏览器；评分请求由宿主发起。` |
| `:78` | `apiKeyHint` | `密钥仅保存在宿主侧；更换后需点「保存」才会生效。` |

**Fact（渲染点）**：`:600-606`「Jev 模型」卡片的 `skp-jev-note`：

```
:602  {COPY.securityLead} <code>{COPY.securityPath}</code>
:603  {COPY.securityTail}
```

R5 要删的是 **`:602-603` 这一行 `<span>` 的内容**（`securityLead` + `<code>` 路径 + `securityTail`），即"密钥路径 + 目录/文件权限"整段；`:78` `apiKeyHint` 是另一处"仅保存在宿主侧"的措辞（在 API Key 字段下方 `:757` 渲染），**不属于路径/权限说明**，是否一并精简需 ux 决定。

**Fact（其它出现"路径/权限/目录"文案的地方，`grep` 全仓库）**：
- 源码注释（非用户可见）：`src/session-state.ts:12`、`:58`、`:68-70`；`src/jev/config-file.ts:6-10`、`:45-47`、`:186-187`、`:218`、`:383`；`src/jev/paths.ts:6-11`、`:28`、`:35`；`src/jev/types.ts:29`、`:35`；`src/overrides/config-file.ts:175-177`；`src/overrides/paths.ts:27`；`src/shared/atomic-write.ts:18-23`；`src/mcp/paths.ts:6`；`src/mcp/loader.ts:173`。
- **用户可见**：只有 `jev-panel.tsx:602-603` 一处（`CODE_COPY` 之外的 UI 文案里没有别的路径/权限说明）。

---

## 8. E7 布局/密度风险

**Fact**：首屏卡片区可视宽 = 面板宽 − 左右 padding（`styles.ts:324` `padding:10px 14px`）⇒ 920px 面板下约 892px；4 列 + gap 8 ⇒ 单卡约 **(892 − 24) / 4 ≈ 217px**。
**Fact**：卡片名是单行 `ellipsis`（`styles.ts:359`），desc 两行 clamp（`:360`），脚部 `flex-wrap`（`:361`）。

**Fact（名字长度风险样本，本机实读）**：
- MCP 工具名上限 64 字符（`@deepseek-ai/dsh-mcp-client lib/index.js:68` `MAX_PUBLIC_NAME_LENGTH = 64`），最长样本 `mcp__figma__download_assets`（27）、`mcp__open-computer-use__*` 前缀 25 + 工具名；
- 插件工具名样本：`dsh-diff-approval-annotate`（27）、`load_workspace_dependencies`（26）、`univer_screenshot`（16）、`dsh_im_source_guidance`（22）、`rw_pick_workspace`（17）；
- 若把"插件 · 名称"做成标签：`dsh-figma · mcp__figma__download_assets` ≈ 40+ 字符，**217px 卡片放不下**，必须"标签行只放插件名、名称行放工具名"（与 Skill 行现有 `skp-dock-tag-channel` 同形，`composer-capability.tsx:1521-1530`）。

**Fact（Tab 行密度）**：当前 tab 行已有 2 Tab（每 Tab 含 `x / y` 计数）+ spacer + 可选 decisionHint + decisionEntry（≈112px）+ 「管理全部 ↗」（≈59px）（`composer-capability.tsx:1621-1660`）。
**Inference**：加第 3 个域 Tab（`插件工具 5/28` ≈ 100px）+ R1 按钮组（2×64 + gap）+ R2 切换（≈120px）后，**单行 892px 放不下**（估算 > 950px）⇒ 必须新增一行（或把 R1/R2 收到 Tab 行右侧的溢出区）。这是尺寸层面的确定结论，不是审美判断。

**Fact（窄容器）**：容器查询 ≤820px 时卡片区变 3 列（`styles.ts:396`）；≤600px 2 列（`:397`）。侧栏展开/窗口缩小时 hero 宽度会跌破 820 ⇒ 新增控件必须能换行或折叠（当前 tab 行 `skp-dock-tab-row` 无 `flex-wrap`，`styles.ts:337`）。

**Assumption**：hero 宽度在本机 1440 视口下实测约 920px（宿主 CSS 推导，未跑起来量）。
若错（更窄，如侧栏 + 分栏时 <820px）：3 列甚至 2 列卡片 + 新增控件换行会显著拥挤；影响：R1/R2 控件需改为"图标按钮 + 悬浮说明"而非全宽文字按钮。

---

## 9. 设计可用的确定事实（给 ux / architect）

1. 首屏与「能力」Tab 是同一组件，控件加在 `CapabilityPanel` 内即两处一致（`composer-capability.tsx:1570` / `:2106-2107` / `:2197`）。
2. 批量开/关**没有批量端点**，现状是逐条 RPC（`composer-capability.tsx:1871-1894`；`src/remote.ts:135-212`）；一键关 ≈ 150+ 条并发（历史数据 143 skills + 9 MCP）。
3. `tools.restrict` 对插件工具生效，但**只能作用于继承层**；Agent Teams 工具与子 agent 内部工具**不可关闭**（`dsh-tools:3040-3041`、`dsh-experimental-tool-agent-team:213-214`、`dsh-subagent:908`）。
4. 宿主**不标注**任何"危险/系统"工具等级（`ToolSchema` 仅 4 字段）⇒ 不可关闭清单必须由本插件自维护。
5. MCP 侧"插件来源"字段已存在（`source` + `origin`），但首屏 MCP 行**未展示**（`composer-capability.tsx:1435-1465`）；Skill 侧的"来源标签 + 渠道小标签"已有现成样式与数据（`SkillRow.channel`、`skp-dock-tag-channel`）。
6. 插件**直接注册 `mcp__*` 工具**（本机 `dsh-to-figma`）不被现有外部实例发现逻辑覆盖（`src/mcp/runtime.ts:24`）⇒ R4 若只改显示，本机将看不到任何新标签。
7. 首屏面板宽 = 输入卡宽度（上限 952、内容宽 920），**不是固定 936**；卡片区 4 列 ≈ 217px/卡，名称单行省略。
8. Jev 权限文案只有一处渲染（`jev-panel.tsx:602-603`），删除即可；不改 `:78` 的 `apiKeyHint` 也能满足 R5 的字面要求。
9. 派生继承是提案，无代码、无端点、无持久化字段（`agent-capability-inheritance.md:6`；`src/session-state.ts:172-176`）。
10. 宿主版本是 **0.2.1-rc.3**（不是仓库文档里多次出现的 rc.2）⇒ 任何"契约行号"以本文件为准。

## 10. 仍待验证（谁去验 / 降级口径）

| # | 待验证 | 验证方式（建议 owner） | 降级口径 |
|---|---|---|---|
| 1 | `ctx.get("tools").schemas()` 在真机的**实际条数与名字**（是否含 preset 层工具） | tester：临时在插件里 dump 一次（不发版），或加一个只读 debug RPC | 用本文件 §2.2 的名单估算；UI 标注"部分工具不可见" |
| 2 | `tools.restrict` 对某个**插件工具**（非 MCP）实测能否成功（名字来自全局视图） | tester：单独 deny 一个插件工具再调用应报 UNKNOWN_TOOL | 设计按"技术上可行"推进，但 UI 首次失败降级为 `skipped` 提示（沿用 `mcp/loader.ts` 的降级范式） |
| 3 | hero 面板在真机的实际宽度（920 / 952 / 其它） | tester：`getBoundingClientRect` 一次 | 设计按 920 内宽排布，控件留 60px 折叠余量 |
| 4 | `dsh-context` 注册的工具名 | scout 后续 / tester | 归入"来源未识别" |
| 5 | 关掉 `bash`/`read` 等基础工具后 agent 的实际表现（确认排除清单必要性） | tester（隔离环境） | 设计先按"必须排除"处理 |
| 6 | 插件工具总数（R3 Tab 计数 `x / y` 的 y） | 同 #1 | 先不显示分母，或显示"已启用 N 个工具" |

## 11. 对 R1–R5 的关键约束（每条一句话，无 UI 方案）

- **R1**：批量开/关没有批量端点，只能并发 N 条单条 RPC（N 可达 150+）⇒ 必须有乐观回显 + 失败聚合。
- **R2**：继承需要"子 agent 自己的 scope 重复应用 + 新持久化字段 + 新 RPC"，宿主不提供；默认值改动会**改变现有行为**，必须在文案上写明"默认已继承"。
- **R3**：工具可枚举（全局视图）但**来源不可权威归属**；Agent Teams/子 agent 内部工具与 `run_code` **不可关闭**；危险工具排除清单需自维护。
- **R4**：MCP 的"插件名"字段已有（`source`），但只覆盖 mcp-client 实例；`mcp__figma__*` 这类插件自注册命名空间需新增识别路径，否则真机上无标签可显示。
- **R5**：删 `jev-panel.tsx:602-603` 的路径/权限段即可；`:78` 的 `apiKeyHint` 不是路径说明，删不删由 ux 定。

## 12. 取证命令与降级记录（可复现）

```bash
# 宿主 asar 只读解析（不写宿主文件；解包到 /tmp 供 grep）
python3 - <<'EOF'   # 解析 app.asar 头部 JSON + 按 offset 读条目
... (读 header → files → 逐条 f.seek(base+offset))
EOF
# 产物：/tmp/asar-scout/src/@deepseek-ai 的子集（dsh-tools / dsh-agent / cordis / dsh-mcp-client / dsh-subagent /
#       dsh-experimental-tool-agent-team / dsh-tool-* / dsh-agent-loop / dsh-scope / client-ui-conversation ...）

# 本仓库
grep -rn 'get("tools")' src/
grep -rn "restrict" src/ --include=*.ts
grep -rn "700\|600\|jev.json\|~/.dsh" src/ --include=*.tsx

# 本机（只读）
python3 -c "import json;print(list(json.load(open('/Users/lzx/.agents/mcp.json'))['mcpServers']))"
grep -rl "tools\.register" ~/.dsh/profiles/desktop/node_modules --include=*.js --include=*.mjs
grep -n "parentSession" /tmp/asar-scout/src/dsh-subagent/lib/index.js
```

**已尝试但未取到的点**：
- 试图确认"preset 层工具是否进全局视图"：只从 `cordis.yml` 看到重复注册（根 + preset），**没有运行时 dump** ⇒ 标 [待验证]（§10 #1）。
- 试图找宿主 tools 的"列表 remote"（供浏览器直接调）：`ToolInfo` 只出现在 `dsh-tool-cordis/lib/types/api-catalog.js` 的类型声明里，**无对应 remote 实现** ⇒ 结论：插件必须自己加 host RPC 才能把工具清单传给前端。

## 13. 参考

- 本仓库：`docs/architecture/agent-capability-inheritance.md`（提案）、`docs/architecture/skill-sources.md`（Skill 来源模型，R4 的同形先例）、`docs/ux/capability-v13.md`（ux 侧规格，待本文件回填）。
- 宿主包（app.asar `dsh/node_modules/@deepseek-ai/`）：`dsh-tools`、`dsh-mcp-client`、`dsh-mcp-resources`、`dsh-subagent`、`dsh-experimental-tool-agent-team`、`dsh-agent-loop`、`dsh-scope`、`cordis`、`dsh-client-ui-conversation`、`dsh-host-plugin-inventory`、`dsh-tool-*`。
- 本机：`~/.dsh/profiles/desktop/{package.json,cordis.yml,cordis.patch.yml}`、`~/.agents/mcp.json`、`~/.dsh/profiles/desktop/node_modules/*`。
