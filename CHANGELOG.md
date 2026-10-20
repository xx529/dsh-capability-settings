# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增

- **MCP 服务器配置「测试连接」**：新增/编辑 MCP server 时可以不落盘先试连——
  表单里点「测试连接」即按当前草稿真连一次（stdio 或 streamable-http），
  成功后列出该 server 暴露的**工具名 + 参数列表**（参数名 / 类型 / 必填或
  可选 / 说明）与耗时，失败给出中文文案 + 原始错误（stdio 还会附服务器
  stderr 尾巴）。实现见 `src/mcp/probe.ts`：一次性 `Client` + transport，
  `finally` 里 `client.close()` 后兜底 `transport.close()`，超时用
  `AbortController`（默认 15s，夹在 0.5–60s），**不注册任何工具、不碰宿主
  tools 注册表**，探测结束无残留子进程。RPC endpoint `mcp.test`，静态校验
  （`validateEntry`）失败时直接返回、不发连接。新增依赖
  `@modelcontextprotocol/client@2.0.0`（与宿主 `dsh-mcp-client` 同版本）。
- **MCP 管理支持「外部注入的 MCP」**（其它插件/profile 在运行时挂载的
  `@deepseek-ai/dsh-mcp-client`，不在本插件配置文件里）。以前完全看不到，只有与自己的
  条目撞名时显示 `conflict`。现在与配置条目**同列表展示、只读**：
  - **发现**：① cordis 插件注册表（`ctx.registry` 的 `Plugin.Runtime.fibers`）拿动态
    fiber 实例与**来源插件**——`Fiber.name` 的语义是「inherited from the nearest named
    ancestor」，所以 `dsh-to-figma` 挂的 `figma` 会显示来源 `dsh-to-figma`；② cordis
    loader 条目（profile `cordis.patch.yml` 里 `insert:` 的 mcp-client，来源=条目 id）；
    ③ 全局工具注册表按 `mcp__<serverName>__*` 反推**工具与参数 Schema**；④ 内存使用记录
    补上只在 agent 作用域可见的实例与调用次数。本插件自己管理的 serverName 一律排除。
  - **展示**：外部实例以普通行出现在「全局」区（名称旁 `外部` + 来源标记），详情卡只读
    展示来源插件 / 注入方式（loader 条目 or 动态 fiber）/ 命名空间 / 传输与命令摘要 /
    **每个工具及其参数**（名字、类型、必填、说明）/ 本次运行调用次数 / 使用记录；
    不提供编辑、删除、卸载。
  - **每个 MCP 名称旁都有来源标记**：`全局` / `项目` / `引用` / `导入` / `外部 · <来源>`。
  - **输入框的 MCP 弹层**同样列出外部实例（`外部` + 来源），并支持**按项目手动启用/禁用**：
    开关写项目级声明（`.agents/capability-overrides.json`），宿主不会卸载实例，而是对该项目
    的 session 调 `tools.restrict({ deny: ['mcp__<serverName>__*'] })` 屏蔽其工具；按会话
    作用域注入的实例无法屏蔽，开关置灰并给出说明。
- **MCP 详情卡新增「使用记录」（只读、不落盘）**：选中某个 server 后点「使用记录」，
  就地列出**最近的调用**——什么时候、哪个 session（显示侧栏的会话标题）、调用了
  这个 server 的哪个 tool；只显示最近 50 条（宿主内存里最多留 200 条），打开期间每
  2s 静默刷新。记录方式是在宿主注册一个**全局 `tools.guard` 旁路**：只观察
  `mcp__<serverName>__<tool>` 形式的调用、**永远返回 undefined 放行**、任何记录异常
  都吞掉，因此不影响工具执行、不拦截任何调用、不写任何文件；插件重载/应用重启即
  清空——这是刻意的（需求就是"不需要持久化"）。会话标题由**客户端**用自己的会话
  快照解析（宿主 `SessionHeader` 只有 id/cwd、没有标题），拿不到时退化为显示会话
  id 尾部。注意记录的是**调用尝试**（执行前记录），不代表该次调用成功。
- **MCP 详情卡新增「查看工具与参数」**：不必进编辑弹窗，选中某个 server 后
  直接点详情卡上的按钮，即复用同一个 `mcp.test` 探测通道（零副作用）就地展开
  该 server 的**描述 + 工具 + 参数**，并带「重新测试」与「收起工具列表」；
  切换选中的 server 会自动丢弃上一次的结果，不会把 A 的清单显示在 B 上。
- **面板入口上移到侧栏上方、面板改为占据主区域**：入口从
  `sidebar.footer.action`（Settings 旁）改注册到 `sidebar.panellist`
  （ui-sidebar 的「全局面板」图标排，位于品牌/新建会话行之下、工作区列表
  之上），同时把同名 id 注册进 `main` keyed slot——点击入口由布局把主区域
  切到面板，不再是浮层。两个注册成对（ui-sidebar 明确：选择没有对应 `main`
  条目的 id 会抛错）。浮层外壳（backdrop / popover / 关闭按钮）与
  `CapabilitiesFooterAction` 一并删除，`CapabilityPanel` 现在只渲染页面本体。

### 修复

- **能力面板钉选工作区后，其它工作区输入框的 MCP/Skills/快捷消息弹层串味**：
  面板头部「项目作用域」下拉框的钉选值（`selection.cwd`）此前被 composer
  三个按钮/弹层的 API 共用，于是在 B 工作区的对话框里会列出 A 工作区的
  项目级 MCP server（及技能/快捷消息）。现在 composer 使用**独立的
  `composerApi`**（`currentWorkspaceCwd` 只取当前会话工作区，`selectedProject`
  恒为 undefined、`selectProject` 空操作），面板继续使用带钉选的那份；
  两份共用同一份工作区订阅回调集合，所以各自都能随会话切换刷新。
- **同一 bug 的更深一层成因（真机复现后修复）**：`currentWorkspaceCwd()` 依赖
  的两个字段在 dsh `0.2.0-rc.2` 外壳里**都不存在**——`sessions.list` 快照形状是
  `{ ids, byId, phase, projectionsBySession }`（**没有 `current`**），
  `workspaces.list` 快照是 `{ items, archivedSessionIds, pinnedSessionIds,
  state, phase, error }`（**没有 `recentWorkspaceId`**）。于是解析退化为
  `items[0]`（工作区列表第一项）：在 ws-b 的会话里，弹层列出的却是 ws-a 的
  项目级 server，且切换工作区不会变。现在 composer 槽位直接使用 standardProps
  提供的 **`sessionId`**（`conversation.input.left` / `conversation.input.overlay`
  均为 session 作用域，契约里就有 `sessionId: SessionId`）精确解析所在工作区，
  并按 sessionId 缓存 api 实例；面板侧（root 作用域拿不到 sessionId）在该外壳上
  退化为「**唯一**被主视图保留（`retainedBy.mainView > 0`）的会话」，只在唯一时
  采用以免多会话歧义。该成因由隔离实例 + 真实 `dsh 0.2.0-rc.2` 外壳的 GUI
  实测发现并复验（见 `notes/real-gui-evidence/`）。
- **连带修复（防回归）**：① `useWorkspaceLabel` 在传入的 api 实例变化时只重新订阅、
  没有立刻用新实例重算标签，下游 `ComposerMcpButton` 又会用「标签未变」短路掉取数——
  外壳若复用同一个槽组件实例、只替换 `sessionId` props，切会话后弹层就不会为新会话
  取数；现在 effect 里先 `setWorkspace(api.workspaceLabel())` 再订阅。
  ② 工作区变更通知键（`workspaceItemsKey`）此前只含 `id:path:title`，而新建会话时
  宿主先改的是 `items[].sessionIds`，这次变化不触发通知，新建会话的弹层会停在旧值；
  现在把每个 Workspace 的 `sessionIds` 纳入通知键。
- **连带修复**：工作区变化的通知判定此前只比较「钉选优先」的 cwd，面板钉选
  到 A 时把当前会话从 B 切到 C 不会触发通知，composer 会继续显示 B 的项目级
  条目。现在同时跟踪「面板侧」与「会话侧」两个 cwd 键。
- **下拉框在条目多时会顶出屏幕**（用户反馈：工作区 20+ 时点面板头部「项目作用域」，
  列表显示不全、超出画面范围）。根因在自绘 `SkpSelect`（`src/client/select.tsx`）：
  弹出层虽是 `position: fixed`，却 `left: rect.left` 不钳制右边界、宽度又由**内容**
  决定（长工作区名会把它撑宽），只要触发按钮不在窗口最左侧就越过右边界；`top` 也
  只看下方、不会向上弹，而 `maxHeight` 的 160 下限会在下方空间不足时把列表顶出屏幕
  底部。现在打开时按视口算下方/上方空间取宽裕一侧（下方 < 舒适高度 240 且上方更宽
  时**向上弹**，用 `bottom` 贴住按钮），高度夹在 `[120, 480]`；水平按
  `min(520, vw−16)` 钳制并用 `useLayoutEffect` 按弹层实测宽度二次修正 `left`；
  CSS 兜底 `.skp-dd-pop{max-width:calc(100vw - 16px)}`、`.skp-dd-opt-label{min-width:0}`
  （让省略号真正生效）。实测（1400×900、触发按钮贴右缘、23 项）：修复前右边缘
  1689（超出 +297px）、下边缘 898（超出 +6px）；修复后 1392 / 541，完全在视口内。
- **下拉框的「列表内部滚动」会把它关掉**（同上场景下等于滚不到底）：关闭监听是
  `window.addEventListener("scroll", close, true)`，连弹出层自身滚动也命中。现在
  内部滚动放行，只有面板/页面等其它容器滚动才关闭。
- **MCP「测试连接」的报告排版凌乱**（用户反馈：服务器描述与工具参数挤成一团、
  列表被截断）。此前借技能列表的 `skp-import-*` 样式兼职渲染：`max-height:200px`
  截断列表、参数挤在一行 `flex-wrap` 里、服务器 `instructions` 整段铺开。现在报告
  顶部只留「连接正常」徽标 + 工具数 / 参数总数 / 耗时；`instructions` 单独成块并
  **默认折叠 3 行**（带展开/收起）；每个工具一张卡片（等宽工具名 + 参数个数 +
  描述折叠 3 行、完整文本在 `title`）；参数收成「名字 + 类型 + 必填/可选」一行、
  **说明另起一行**，`overflow-wrap:anywhere` 让长 URL / 长英文安全换行；工具列表
  自身滚动 `max-height:min(46vh,420px)`——既不截断内容，也不再把「添加/取消」等
  操作按钮顶出屏幕。
- **删除 MCP 后列表不立即消失（要切到别的页面再回来才看到）**（用户反馈）。根因不在
  面板：`manager` 的写路径 `await reloadFor(...)` → `loader.reload()` →
  `remountGlobal()` 会 `await fiber` **逐条等每个全局 server 起进程 + MCP 握手**。
  本机 5 条 stdio server 走 `npx`/`bunx` 冷启动，于是 `mcp.remove` / `mcp.upsert` /
  `mcp.setEnabled` 这几个 RPC 会卡住数秒到数十秒；面板的刷新跟在 RPC 之后，所以
  表现为"删掉了但列表不动"（文件其实早就写好，切页触发的重新加载才显示出来）。
  现在：
  ① **写入只等文件落盘就返回**（`reloadFor` 改为 fire-and-forget，重挂交给 loader
  自己的串行队列在后台做），紧随其后的 `mcp.list` 立刻就是新内容；
  ② 重挂期间 `status()` 带 `settling: true`，面板据此**静默轮询**（每 800ms，上限约
  16s）让「已挂载/未挂载」自行收敛，并且只刷新数据、不闪「加载中…」；
  ③ 尚未拿到状态的条目显示「挂载中…」而不是看起来像未挂载；
  ④ 全局层与 session 层换代都是"新一代状态攒好再整体替换"，重挂中途不会出现
  "所有 server 都掉了"的假象。
  真机实测（隔离实例 + 一个 initialize 故意慢 4s 的 MCP）：修复前写入 RPC 会被重挂
  拖住数秒（塞一个永不响应握手的 server 时，重挂持续 ≥24s，写入就会一直卡着）；
  修复后 `mcp.remove` **6ms** 返回、行 **260ms** 内从列表消失，`mcp.upsert` 同样 6ms。
- `src/mcp/loader.ts` 里解释「为何必须用宿主那份 mcp-client」的注释有两处与
  实测不符（已按 AGENTS.md「结论必须有据可查」纠正）：① 两份副本的预留
  表达式其实相同，真正的差异是 `@deepseek-ai/dsh-scope` 的
  `kScope = Symbol("dsh.scope")` 是普通 Symbol（非 `Symbol.for`），插件自带
  副本读不到宿主打在 agent ctx 上的 scope tag，恒回落 `ctx.root`；② 本机
  `profiles/desktop` 的 `cordis.patch.yml` 并没有 root 级 mcp-client 条目
  （只有 `profiles/web` 有），因此全局层撞名是安全网而非必然。

### 变更

- **全局 MCP 改为整个 harness 复用同一份实例**：`<agentsHome>/mcp.json`
  （兼容旧位置 dsh home / `~/.claude`）里的 server 不再**每个 session 各起
  一份进程**，而是逐条挂在插件自己的 Cordis context（`scopeOf(ctx)` 为空 ⇒
  serverName 按 `ctx.root` 预留）上一次，所有 session 共用；全局配置写入后
  仍热重挂（`loader.reload()`）。
- **项目级 MCP 保持每会话隔离**：`<项目根>/.mcp.json` 的原生条目仍挂在
  `agent.ctx` 上，同一工作区里各 session 各一份、互不冲突；同名项目条目按
  tools 注册表的「scoped 注册遮蔽全局」规则遮蔽全局那份。
- **「在本项目禁用全局 MCP」改用 `tools.restrict` 屏蔽**：全局层既然共享就
  无法按项目卸载，于是按 session 对该 agent 作用域 `restrict({ deny })`
  掉该 server 的全局工具（名单从 `ctx.root.get("tools").schemas()` 按
  `mcp__<serverName>__` 前缀精确取，空名单不调用——`restrict` 契约规定空
  filter 会失败）。任何失败（宿主无 `restrict`、名字未注册、调用抛错）都
  降级为「记一条 warning + 状态视图标 `skipped`/`failed`」，**绝不影响
  session 挂载**。挂载状态视图新增可选 `scope: "global" | "session"` 与
  `restrictions[]`，全局层以哨兵会话 `sessionId === "*global*"` 出现在
  `status()` 里（`servers[].{key,serverName,state,error}` 形状不变，客户端
  聚合逻辑向后兼容）。
- **行为差异（请留意）**：① 全局 stdio 条目**没有显式写 `cwd`** 时，其工作
  目录从「各会话的项目根」变成「宿主进程目录」（单例没有"当前项目"；条目
  自己写了 `cwd` 不受影响）；② 若某个 profile 的 `cordis.patch.yml` 里已经
  root 级插入了同名 mcp-client（例：`profiles/web` 插了
  mcp-AnySearch / mcp-tavily / mcp-context7 / mcp-github），本插件不再重复
  挂载该 serverName：状态显示为 `conflict` 并带友好文案，工具仍由那份实例
  提供，但**面板里对该条目的编辑不会生效**——请在 profile 里改；③ 宿主没有
  `loader` 服务（headless 等）时会回落到插件自带的 mcp-client 副本，此时
  `scopeOf()` 读不到宿主 scope tag，项目级的每会话隔离会降级为「同 cwd 只
  允许一个 session 挂同名 server」，其余 session 显示 `conflict`。
- 面板 MCP 行尚未展示宿主的 `restrictions[]`（宿主已提供，客户端类型
  `ClientMcpStatus` 暂未透出）：`restrict` 降级时面板看不到「本项目屏蔽未
  生效」的标注，只会在宿主日志里出现 warning。属已知限制。

### 内部

- `src/mcp/loader.ts` 顶层架构改为「全局单例层 + 项目级每会话层」两个独立
  串行队列（互不 await，避免死锁）；`tools/change` 事件用于在工具集合变化
  后幂等重算屏蔽名单（不让「后注册的工具」漏出）。
- 验证：三条实现任务各有真实行为脚本（假 cordis ctx 驱动 loader、真实
  stdio/HTTP MCP 探测、SSR 渲染冒烟），并由独立验证者按六条需求逐条复核
  （含变异对照证明测试有检测力）；脚本落在 gitignore 的 `notes/` 下，不进版本库。
- **真机 GUI 验证**：另建完全隔离的 DSH 实例（`DSH_HOME=<repo>/.verify-home`、
  独立端口、本地装入与桌面应用同版本的 `dsh@0.2.0-rc.2`、夹具工作区与夹具 MCP
  进程），用真实浏览器逐条复验六项需求，并用进程计数给出逻辑改动的硬证据
  （3 个真实会话时全局 MCP 进程 = 1，同一工作区两个会话的项目级 MCP 进程 = 2）。
  证据与复现步骤见 `notes/real-gui-evidence/`。注意：系统里全局安装的
  `dsh@0.1.2-alpha.2` 外壳**没有** `sidebar.panellist` 槽，用它会误判 UI 改动，
  验证必须用 0.2.0-rc.2 及以上外壳。

## [1.1.0] - 2026-09-29

### 修复

- **DSH 升级到 0.2.0-rc.1 后整个插件被跳过（`skipping profile bundle`）**：
  `dsh-app-boot` 的兼容性判定只检查插件 `peerDependencies` 里
  `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 的 semver 范围
  （`semver.satisfies(runtime, range, { includePrerelease: true })`），原来那批
  `^0.1.0-rc.7` 在 0.2.0-rc.1 上全部不满足，于是整个 bundle 被
  `prepareProfileEntries` 跳过。其中 `@deepseek-ai/dsh-client-runtime` 在
  0.2.0-rc.1 已不再发布（npm 上最新为 0.1.1-rc.2，内容已拆到
  `dsh-client-ui-slots` / `dsh-client-ui-renderer` / `dsh-client-store` 等包），
  这条 peer 永远无法满足。现改为 `^0.2.0-rc.1` 并移除该条；`slots` 服务在
  0.2.0-rc.1 由 `@deepseek-ai/dsh-client-ui-renderer` 提供，据此更新
  `dsh.client.inject`；`@deepseek-ai/cordis` 对齐生态统一的 `~4.0.4`。
  插件自身的运行时依赖没有变化——客户端 bundle 只外部化 `react` /
  `react/jsx-runtime`，构建产物里不含任何 `@deepseek-ai/*` 导入。
- **输入框的三个弹层（快捷消息 / Skills / MCP）背景透明、下层文字透出**：
  0.2.0-rc.1 把宿主菜单底色 `--dsw-specific-menu` 改成了两级间接的磨砂底
  （`body` → `var(--dsw-menu-surface-fill)`，light `#f8f9fa94`≈58% /
  dark `#43454a73`≈45%，且只有 `html[data-platform=darwin]` 被覆盖成近不透明），
  宿主一律配 `backdrop-filter: var(--dsw-menu-backdrop-filter)` 兜底
  （16 处引用中 11 处如此）。弹层此前只抄了 `background` 没抄模糊，于是只剩
  半透明。现改用宿主不透明的层级底色 `--dsw-alias-bg-layer-1`（与
  `.skp-panel` / `.skp-modal` 同一 token）；三个弹层共用 `.skp-composer-pop`，
  一并修复。

### 破坏性变更

- `peerDependencies` 的 dsh 范围由 `^0.1.0-rc.7` 改为 `^0.2.0-rc.1`，插件不再在
  dsh 0.1.x 上加载。

## [1.0.2] - 2026-09-16

### 修复

- **同一应用里只有第一个会话能看到 MCP 工具，其余会话静默 `conflict`**：
  `mcp/loader.ts` 顶层静态 `import` 拿到的是本插件 `dependencies` 里那份
  `@deepseek-ai/dsh-mcp-client`（0.1.0-rc.8），它按 `ctx.root` 预留
  `serverName`——全应用只允许一个会话挂上同名 server，后开的会话拿不到任何
  `mcp__*` 工具，面板聚合显示「任一会话已挂载」因而看不出问题；宿主自己那份
  （0.1.5-rc.2 起）按 agent 作用域预留（`scopeOf(ctx) ?? ctx.root`），多会话
  才能各自挂载。注意**升级依赖版本解决不了**：插件自带的
  `@deepseek-ai/dsh-scope` 副本里 `kScope` 是每份模块实例独有的 Symbol，
  `scopeOf()` 读不到宿主打在 agent ctx 上的 scope tag，仍会回落 `ctx.root`。
  现改为挂载时按包名向宿主 loader 取实例
  （`ctx.get("loader").import(...)` + `unwrapExports`，解析基准是 profile
  目录），宿主没有 loader 时才回落到自带副本。

## [1.0.1] - 2026-09-16

### 修复

- **DSH 升级到 0.1.5-rc.2 后打开「能力面板」即报 `transport failure for
  /capability-panel/skills.list: HTTP 405`**：宿主端原先用
  `connection.rpc.handle("/capability-panel", …)` 挂通道，该 API 在当前版本内部
  执行 `owner.effect(() => owner.webServer.register(route))`，其中 `owner` 经
  cordis 的 shadow/origin 绑定解析成 **connection 插件自己的 ctx**（inject 里
  没有 `webServer`），于是恒定抛 `cannot get property "webServer" without
  inject`——异常发生在 `rpc.handle` 内部，通道静默不挂载，浏览器端的 POST 落到
  前端静态兜底路由上，返回 405。现改为用宿主公开 API 自行挂前缀路由：
  `ctx.inject(["connection", "webServer"], …)` 等两端服务就位 +
  `connection.requestRejection(req)` 过宿主/来源信任与浏览器会话认证 +
  `webServer.register({ kind: "prefix", path, handler })` 注册路由，并自行实现
  与 `dsh-client-connection` 客户端 `rpc.call` 一致的线上信封
  （`client-request` / `server-response`）。路由注册生命周期挂在插件自己的
  fiber 上，插件卸载 / 重载即摘除。

## [1.0.0] - 2026-09-08

### 新增

- **「在本项目禁用」全局 skill（shadow stub 屏蔽占位）**：全局区详情卡新增
  「在本项目禁用 / 在本项目恢复」。禁用会在项目 `.agents/skills` 生成一个
  同名占位文件（frontmatter 双向禁用 + `metadata: capability-panel:
  shadow-stub` 标记）——宿主 registry 按 frontmatter name 合并技能且项目根
  rank 恒高于全局根，占位文件于是顶掉同名全局条目：catalog 注入、`skill`
  工具调用、`/name` 用户注入三条链路都在本项目内被宿主**原生**拒绝（其它
  项目不受影响，也不写任何插件私有状态）。占位条目出现在项目区（灰点 +
  「屏蔽占位」徽标，删除即恢复）；被遮蔽的全局条目带「本项目已禁用」徽标；
  项目区已有同名真实条目的全局技能带「项目副本生效中」徽标。
- **Skills 快捷弹层与宿主解析口径对齐**：同名 skill 以项目区条目为准（rank
  语义）——项目副本 / 屏蔽占位 / 项目原生条目被禁用（含仅关闭「用户调用」）
  时，该名字整体从弹层排除，不再漏出全局同名的"死口令"（点了宿主也不会
  注入）；`.claude` 兼容根的条目同步排除（宿主 registry 不扫描该根）。
- **Skill 调用方式可按方向细调**：详情卡「调用方式」字段上，「模型调用」
  与「用户调用」两个方向各自独立开关（例如只希望用户 `/name` 手动触发、
  不需要 agent 自动注入的 skill，关闭「模型调用」即可）。frontmatter 只
  写入 `disable-model-invocation` / `user-invocable` 对应扁平键，另一个
  方向原样保留，正文与其它元数据不动。两个方向状态不一致时，整体按钮
  显示蓝色「部分禁用」。
- **Skills 域改为「全局 / 项目」两区分离 + 导入制**：Skills 域内不再混排
  全局与项目条目、也不再走"项目级禁用全局项"的叠层（旧
  `capability-overrides.json` 的 skills 声明不再读取）。每区只列该作用域的
  真实文件：
  - 全局区管理 `~/.agents/skills` 等全局根，**全局技能没有启停与调用方向
    开关**（会影响所有项目），只有「导入到本项目」/ 导出 / 删除；
  - 项目区管理 `<项目>/.agents/skills` 等项目根，**启用/禁用与模型/用户
    调用方向只作用于项目文件**（写 frontmatter 扁平调用键，宿主原生链路
    下一步即生效）；
  - 全局区详情卡新增「**导入到本项目**」：把全局 skill 物理复制到项目根
    （目录型连资源），此后在本项目内独立控制；同名冲突可确认覆盖；
  - 安装对话框的目标随区固定（全局区只装全局，项目区只装项目）；
  - Skills 列表行不再显示「部分禁用」等文字状态标签，只保留**项目区行的
    状态圆点**（绿=双开、蓝=部分禁用、灰=全禁用）；行内"项目/全局"标签
    与"本项目禁用"标记同时删除（区归属即作用域）；
  - 详情卡标题旁新增**归属徽标**（项目=蓝 / 全局=绿，按作用域着色）；
    删除按钮语义统一为「删除」（全局条目删全局文件，项目条目删项目文件）。
- **MCP / 快捷消息域同步改为「项目 / 全局」两区分离**：三域视图头部统一
  为项目/全局两区 Tab（取代 All/Project/Global 三档作用域过滤），每区
  只列该作用域配置文件里的真实条目；列表行不再渲染"项目/全局"标签（区
  归属即作用域），状态圆点只在项目区行显示；新增/安装对话框的默认作用域
  跟随当前区（全局区只见全局目标）。
- **「导入到本项目」（MCP / 快捷消息）= 登记引用而非物理复制**：全局区
  详情卡新增「导入到本项目」，写入
  `<项目根>/.agents/capability-imports.json`。引用内容实时取自同名全局
  条目（全局更新立即生效），启停是引用上的项目级 `disabled` 标记；引用
  与项目原生条目同级参与合并——MCP 挂载时遮蔽全局原版（启用态引用还会
  覆盖全局条目自身的 disabled 默认），快捷消息的全局原版被同名项目条目
  （原生或引用）遮蔽时标 `shadowed`，输入框弹层据此过滤。引用条目在项目
  区显示「全局」归属徽标，移除按钮为「移出」；项目内已有同名原生条目时
  报硬错误，已有同名引用时两击确认重登记（保留原启停状态）。旧版
  「导入 = 物理复制」写入的 `importedFromGlobal` 标记随读→写周期保留，
  这类副本同样显示「全局」徽标与「移出」按钮。

### 变更

- **配置文件位置改为 `.agents` 优先**：所有可写配置（项目级能力禁用声明、
  项目/全局快捷消息、全局 MCP、skills 安装目标）保存时优先写入 `.agents`
  目录（项目 `<项目根>/.agents/`，全局 `~/.agents/`）；读取兼容旧位置
  （项目 `.dsh` / `.claude`，全局 dsh home / `~/.claude`）。首次写入新位置
  时自动并入旧文件内容并删除旧文件，旧配置不丢失、不留两份。
- **Skills 只读兼容 `.claude/skills`**：项目与全局的 Claude Code 技能目录
  出现在面板中（只读徽标，不可写回）；skills 默认安装目标改为 `.agents`
  （项目）与 `~/.agents/skills`（全局）。
- **项目根判定标记新增 `.agents` 与 `.claude`**：与 `.git` / `.dsh` 同等
  参与 `findProjectRoot` 的向上探测（主目录护栏不变）。
- **三域详情卡移除「项目已启用 / 项目已禁用」覆写按钮**：项目级控制改用
  各域的导入制入口（skills = 物理副本 / 屏蔽占位，MCP / 快捷消息 = 引用
  启停）。`capability-overrides.json` 机制保留：MCP 弹层的「本项目」开关
  仍在使用；快捷消息域的既有声明仍被读取（弹层继续过滤），但面板不再
  提供开关入口（用引用启停替代）；skills 域声明不再读取。
- **代码重构**（行为不变）：三域头部 Tab 收敛为共用的 `ZoneTabs`
  （`scope-tabs.ts` 删除），`ProjectOverrideButton` 移除；skill 来源的
  项目/全局分类收敛到 `shared/skill-sources.ts`（宿主端与客户端共用）。

### 修复

- **Skills 项目区启停/调用方向现在真实生效**：此前「导入到本项目」登记的是
  引用（`capability-imports.json`），其启停状态只对插件面板可见——宿主的
  目录注入 / `skill` 工具 / `/name` 注入三条链路只读 skill 文件的
  frontmatter，而补偿用的注入守卫只能过滤**本步新注入**的消息，无法触及
  已持久化在会话里的旧目录消息，导致引用条目禁用后上下文仍始终注入。
  现在 skills 域彻底移除引用机制与注入守卫（`capability-imports.json` 里
  遗留的 skills 键读取时忽略、下次写盘自动清除），「导入到本项目」回归
  物理复制，启停与调用方向一律写项目副本的 frontmatter——由宿主的文件
  watcher + 目录重发布原生生效（实测下一步即剔除）。
- **MCP 多会话同名 server 冲突不再伪装成故障**：桥接层按 app（`ctx.root`）
  预留 `serverName`，同一 server 全应用只允许一个会话挂载，其余会话报
  `already in use` 属预期。此前面板按"最差状态"聚合（conflict 排最高），
  只要存在第二个会话，行上就永远显示「冲突」（删除后重加也一样），
  看起来像删除未生效。现在：
  - 聚合改为**任一会话已挂载即显示"已挂载"**，全部未挂载时才取最差状态；
  - 冲突状态的详情文案从桥接层的原始报错（误导性提示"pick a unique
    serverName in cordis.yml"）换成说明真实原因的中文说明。

## [0.8.0] - 2026-08-28

### 新增

- **项目级禁用全局能力**：全局的 skill / MCP server / 快捷消息默认对所有
  项目生效，现在可以在单个项目里关掉而不动全局配置。打开详情卡，点击
  **「项目已启用 / 项目已禁用」** 状态按钮（绿=生效，橙=禁用）即可。
  - 声明写入 `<项目根>/.dsh/capability-overrides.json`，全局配置原样保留，
    其他项目完全不受影响；
  - 效果真实生效：Skills / 快捷消息立刻从输入框弹层消失，MCP server 从
    本项目所有 session **热卸载**（恢复时自动重挂）。
- **MCP 快捷弹层改为「本项目」开关**：全局条目在弹层里只切换本项目
  启用/禁用（走项目级覆写，不翻全局配置）；全局已禁用的 server 不再列出。
- **输入框工具组三个弹层共享同一份列表数据**：按钮与弹层不再各拉一次
  同一份 RPC 数据（打开弹层时的重复请求被消除）。

### 变更

- **列表状态语义统一**：三个域的列表圆点统一为「绿=已启用 / 灰=已禁用 /
  橙=本项目禁用」；MCP 的挂载失败 / 冲突 / 未挂载改用行内标签与 tooltip
  呈现，详情卡「状态」字段保留完整挂载信息与错误，未再把挂载异常画进圆点。
- **代码重构**（行为不变）：
  - 输入框工具行三个弹层（快捷消息 / Skills / MCP）共用一套模块级开合
    存储 + Esc/外部点击关闭 + 锚点定位（`client/composer-common.ts`）；
  - 三个面板视图共用 `ScopeTabs` / `useAsyncList` / `ProjectOverrideButton`
    与工作区/来源判定小工具（`client/panel-common.tsx`）；
  - MCP 挂载状态按 key 聚合的"取最差"逻辑收敛到 `client/mcp-common.ts`；
  - JSON 配置文件读取脚手架、原子写入（临时文件 + rename）、错误文案
    归一收敛到 `shared/` 工具模块；file-lock 队列在 settle 后自动清理
    （长驻进程不再无界增长）；MCP 旧 fiber 改为并发释放。
- 详情卡项目级覆写按钮在**全局已禁用**时恒灰并禁用（本项目状态无意义）。

### 修复

- **安全：skill 名称路径穿越封堵**。`skills.read / remove / setEnabled /
  update / clone / export` 此前把 RPC 传入的 `name` 原样拼进文件路径
  （`join(root, name)`），恶意名称（如 `../x`）可越出受管根读写任意 `.md`
  文件；现在所有拼路径的入口强制 `isSkillName`（kebab-case）校验。
- **安全：ZIP 解压上限与越界防护**。宿主端与浏览器端解压均增加 64 MiB
  输出总量上限（对接入的压缩包上限之下再拦一层"膨胀内存"），并修复
  数据区越界被静默截断、短归档负面偏移读越界的问题（zip bomb 防护）。

[Unreleased]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v1.1.0...master
[1.1.0]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v0.8.0...v1.0.0
[0.8.0]: https://github.com/chengdb/dsh-plugin-capability-panel/releases/tag/v0.8.0