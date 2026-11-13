# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.18.10] - 2026-11-13

### 修复

- **能力面板全局视图看不到 `dsh-doc`，但首屏会话能力面板能看到**（反馈：全局
  Skills 搜索 `dsh-doc` 显示「没有匹配」）：根因是 preset 层技能只存在于绑定该
  预设的 agent scope，面板全局视图走的是无 scope 的 `snapshot({cwd})`，看不到
  preset 行。
  - 面板全局视图新增 `hostPanelRows`：从 `agents.list()` 的 live agent scope 补
    宿主注入行（只收 `hostInjected`、按名字去重、最多 20 个 scope），与首屏会话
    视图统一；全局列表搜索可见，开关仍置灰，可见性编辑隐藏。
  - 全局面板点开 `dsh-doc` 详情时，`skills.get` 会按名字在 live agent scope 里
    找一个能看见它的 scope 再读（只读，不改变任何状态），正文/资源不再 not-found。
  - 验证 `node notes/verify/host-injected.mjs` 13/13（新增「面板全局视图补 preset
    宿主技能」「面板全局视图可读 preset 宿主技能详情」）；`pnpm typecheck`、
    `pnpm build` 通过。

## [1.18.9] - 2026-11-13

### 修复

- **宿主注入的 Tools / Skills / MCP 仍可被开关**（反馈：`@deepseek-ai/dsh-terminal-panel`
  的 `user_terminal_*`、宿主预设技能 `dsh-doc` 在面板/首屏仍显示可操作开关）：
  - **Tools**：宿主包（`@deepseek-ai/*`）纳入归属扫描并单独建索引；工具名命中
    宿主包字面量时归到宿主单元并标记 `hostInjected`，优先于人工表与「名字推测」
    （修复 `user_terminal_*` 被同名第三方插件 `dsh-terminal-panel` 抢归属的问题）。
    宿主单元恒 `enabled=true`、`lockedReason` = 宿主原因，不参与可见性 / 默认 /
    `tools.restrict`；`tools.setSessionEnabled` / `setGlobalEnabled` 直接拒绝。
  - **Skills**：`origin=bundled|preset` 或注入路径落在 `@deepseek-ai/*` / `app.asar`
    的注入技能标记 `hostInjected`；面板与首屏开关置灰，`skills.setSessionEnabled`
    单条/批量、会话默认投影都拒绝；Jev 能力决策里仍展示但标记为不可选
    （`host-injected`），派生动态选择不会选中；历史遗留的关闭记录会被清理而不是
    继续注册 shadow。
  - **MCP**：注入方为 `@deepseek-ai/*` 包 / 宿主 fiber 的外部实例标记
    `hostInjected`；全局默认 / 工作区默认 / 可见性 / 当前对话开关全部置灰，
    `mcp.setSessionEnabled` / 批量写入与 session-bulk 跳过；Jev 里展示但不可选。
  - 三域的全局默认 / 项目默认 / 可见性写路径统一加宿主守卫
    （`overrides` 的 `toggle` / `globalToggle` / `globalToggleMany` /
    `setVisibility` 返回业务失败），UI 仍是主拦截层。
  - 设计同步：新增「宿主」青蓝标签（面板 / 首屏 / Jev 决策来源标签）。
  - 验证 `node notes/verify/host-injected.mjs` 11/11：
    `Tools 宿主包字面量归属`、`Tools 宿主单元只读锁定`、`Tools 宿主单元拒绝会话开关`、
    `Tools 宿主单元拒绝全局默认`、`Skills 宿主预设技能 hostInjected`、
    `Skills 第三方技能仍可开关`、`MCP 宿主注入识别`、`MCP 第三方注入保持可开关`、
    `Overrides 拒绝宿主项目默认 / 全局默认 / 可见性` 全 PASS；
    `pnpm typecheck`、`pnpm build` 通过。

## [1.18.8] - 2026-11-13

### 修复

- **首屏能力配置弹窗切换 Tab 时整框上下跳动**（反馈：从 Skills 切到 MCP / Tools / Prompt，
  弹窗位置不停变化，影响交互）：根因是弹窗用 `align-items:center` 垂直居中，而高度
  随当前 Tab 的内容数量变化，内容一矮（Tools 8 张卡 / Prompt 2 张卡）整框就被往上推。
  现在改为**顶部定锚**：遮罩层 `align-items:flex-start`，上沿固定为
  `clamp(72px, 15vh, 168px)`，弹窗与面板最大高度按 `calc(100vh - 上沿 - 24px)` 计算，
  只有下沿随内容伸缩；内容超高时卡片网格内部滚动（面板 `max-height:inherit`，不越出弹窗）。
  - 验证 `notes/verify/v26-modal-anchor-gui.mjs` 7/7：真实组件 + Chromium 1920×1080，
    四个 Tab 上沿均为 162px（旧实现 179.5 / 281.5 / 332.5 / 384.5，差 205px），
    下沿 Skills 883 / MCP 679 / Tools 577 / Prompt 473，最高内容不越视口；
    1440×900 / 1280×720 / 1680×1050 复测无页面级溢出（1280×720 为网格内部滚动）。

## [1.18.7] - 2026-11-11

### 修复

- **参数行标签与输入框没有垂直居中、行高忽高忽低**（反馈：`pageId` 的标签和输入框
  不在一条中线，文本行明显比布尔开关行高）：参数行网格改为 `align-items:center`，
  标签列显式垂直居中；控件列 `min-height:38px` 并居中，开关行同步为 38px，所以
  文本输入行 / 枚举下拉行 / 布尔开关行等高；多行 JSON 行仍按内容撑高（标签顶部对齐）。
  - 设计同步：规范板 03 补「标签与控件垂直居中；控件 min-height 38px、文本/布尔行
    等高」；预览图重导。
  - 验证 `notes/verify/v25-align-gui.mjs` 4/4（文本/布尔行等高 ≤2px、两种行的标签与
    控件中心差 ≤2px）；回归八套 v25 走查全通过。

## [1.18.6] - 2026-11-11

### 修复

- **问号悬浮说明停留久了会出现两个浮层**（反馈：hover 一会儿后系统 tooltip 与自定义
  浮层叠在一起）：问号按钮原先同时挂了原生 `title`，浏览器在 ~1s 后弹出系统 tooltip。
  现在移除 `title`，只用自定义浮层；同时给按钮加 `aria-describedby` 指向打开的
  浮层（无障碍信息不丢）。
  - 设计同步：第 10 帧规则补「不使用原生 title」，规范板 03 的 ? 规则同步。
  - 验证 `notes/verify/v25-singletip-gui.mjs` 4/4（无 title / 停留 2.5s 仅一个浮层 /
    aria-describedby 指向浮层 / 内容正确）；回归 v25-helptip-gui 10/10 等。

## [1.18.5] - 2026-11-11

### 变更

- **参数说明改为「?」悬浮提示**（反馈：description 很长时内联展示把布局撑得很难看）：
  - 有说明的字段 / 对象 / 数组分组，在「必填 / 可选」右侧显示 16×16 圆形问号；
    鼠标悬停、键盘聚焦或点击出现说明浮层；移出 120ms 收起（移入浮层不收起），
    Esc 只关浮层不关弹窗。
  - 浮层 fixed 定位（不受弹窗滚动容器裁剪）、宽度 ≤ 360px、按视口上下空间自动
    向上/下展开并钳制在视口内、`max-height: 320px` 可滚动、长英文/下划线长词强制断行。
  - 字段说明不再内联占行（对象 / 数组分组头同理），表单行高稳定。
  - 设计同步：新增第 10 帧 `preview/v25-10-helptip.png`（问号 + 浮层规则）；
    规范板 03 改为「说明走 ? 悬浮提示」；预览图重导。
  - 验证 `notes/verify/v25-helptip-gui.mjs` 10/10（无内联说明 / ? 数量 / hover 出层 /
    文案完整 / 视口内且 ≤360 / 移出收起 / Esc 只关层 / 分组头 ?）；回归
    v25-debug-gui 12/12、v25-nested-gui 5/5、v25-array-gui 8/8、
    v25-schemaonly-gui 5/5、v25-nodesc-gui 3/3、v25-nonotice-gui 5/5。

## [1.18.4] - 2026-11-11

### 变更

- **调试弹窗不再展示黄色安全提示条**（反馈：`⚠ 调试调用会真实执行一次工具…` 这条
  不需要）：移除弹窗顶部的提示条与 `.skp-dbg-notice` 样式，参数区直接贴在头部下方。
  连接方式说明（「一次性连接 · 不挂载 · 不影响正在运行的对话」/「走已挂载实例」）
  仍保留在底部左侧。
  - 设计同步：v25 的 02–06 / 08 / 09 帧移除提示条并整体上移，规范板 02 改为
    「不展示安全提示条」；预览图重导。
  - 验证 `notes/verify/v25-nonotice-gui.mjs` 5/5（无提示条节点 / 文案不出现 /
    参数区紧跟头部 / 无提示条留白）；回归 v25-debug-gui 12/12、v25-nested-gui 5/5、
    v25-array-gui 8/8、v25-schemaonly-gui 5/5、v25-nodesc-gui 3/3。

## [1.18.3] - 2026-11-11

### 变更

- **调试弹窗不再展示工具级 `description`**（反馈：context7 的 `resolve-library-id`
  说明很长，一进弹窗就占满上半屏）：工具说明在 MCP 详情页 / 工具列表已可见，弹窗
  只保留「参数（含各字段说明）+ 结果」，参数区直接贴着安全提示条开始。
  - 客户端移除弹窗顶部 `tool.description` 渲染与 `.skp-dbg-desc` 样式；字段级
    `.skp-dbg-field-desc` 不受影响。
  - 设计同步：v25 的 02 / 03 / 06 / 08 / 09 帧移除工具描述行并整体上移，规范板 02
    补「不在弹窗重复展示工具 description」；预览图已重导。
  - 验证 `notes/verify/v25-nodesc-gui.mjs` 3/3（无工具级描述节点 / 描述文本不出现 /
    字段级说明仍展示）；回归 v25-debug-gui 12/12、v25-nested-gui 5/5、
    v25-array-gui 8/8、v25-schemaonly-gui 5/5。

## [1.18.2] - 2026-11-11

### 修复

- **撤销 1.18.1 的「按说明推断元素字段」**（反馈：不要特殊处理，schema 识别不了就
  提示输入格式不对）：参数表单只按 `inputSchema` 渲染，schema 没声明的字段不猜测、
  不推断。
  - `array` 的 `items` 只声明 `type: "object"`（没有 `properties`）时，每项就是一个
    多行 JSON 文本框；输入不是 JSON 对象时明确提示
    「输入格式不正确：应为 JSON 对象（例如 {"key":"value"}）」，数组则提示
    「输入格式不正确：应为 JSON 数组（例如 [1, 2]）」。
  - 保留 1.18.1 的两个修复：行内解析失败不再叠加「必填数组未添加任何项」；
    长描述排版（说明跨两列 + 长词断行）。
  - AnySearch `batch_search` 的 `queries` 因此恢复为每项 JSON：正确写法是
    `{"query": "新闻"}`（可带 domain / sub_domain / sub_domain_params）。
  - 验证 `notes/verify/v25-schemaonly-gui.mjs` 5/5（无推断标签 / 每项 JSON 文本框 /
    非 JSON 提示格式不正确 / 不误报必填数组 / 合法 JSON 可执行回显）；回归
    v25-debug-gui 12/12、v25-nested-gui 5/5、v25-array-gui 8/8。

## [1.18.1] - 2026-11-11

### 修复

- **自由格式 object 数组被要求手写 JSON，且解析错误叠加误报**（反馈：AnySearch
  `batch_search` 的 `queries` 每项明明是搜索对象，却只给 JSON 文本框；填 `新闻` 后
  每项报「JSON 解析失败」，分组底部还额外报「必填数组未添加任何项」）：
  - `items` 只声明 `type: "object"`（没有 `properties`）时，若数组 `description`
    引用了同服务器的某个工具（如「follows the search tool schema」），按该工具的
    `inputSchema` 推断元素字段；`batch_search` 因此直接渲染出 `query`（必填）/
    `domain` / `sub_domain` / `max_results` 等逐项字段，分组头标注
    「字段按 search 推断」；推断不到才退回每项 JSON。
  - 修掉误报：只有数组 **0 项**时才提示「必填数组未添加任何项」，行内解析失败
    不再额外叠加这条错误。
  - 自由格式 object 的 JSON 解析失败文案改为「应为 JSON 对象（该工具未声明元素
    字段，请按工具说明填写…）」，不再只写「JSON 解析失败」。
  - 验证 `notes/verify/v25-freeobj-gui.mjs` 7/7（推断标注 / 推断出 query·domain·
    max_results / 不再要求整项 JSON / 执行回显 / 无引用时保留 JSON / 错误文案 /
    不误报必填数组）。

## [1.18.0] - 2026-11-11

### 新增

- **MCP 工具调试（v25）**：能力面板「MCP → 详情 → 工具与参数」右栏，当前选中工具
  标题右侧新增「▶ 调试」按钮，弹窗内可按 `inputSchema` 填参数（表单 / JSON 双模式）
  并真实调用一次工具，结果就地展示（参数区保持展开，结果在下方滚动）。
  - 宿主新增 `mcp.invoke`：**配置条目**（全局 / 工作区 / 引用）走一次性 MCP 连接
    `callTool`（复用 `openMcpSession`，与探测同源：不挂载、不注册工具、不影响正在
    运行的对话，任何路径都关连接）；**外部注入实例**无配置可读，改走已挂载工具
    注册表（`tools.execute` + `mcp__<server>__<tool>` 公共名），仅全局可见实例可调，
    agent 作用域注入的返回业务失败并说明；`callId` 带 `capability-panel-debug`
    前缀，使用记录 guard 跳过，调试调用不污染「使用记录」。
  - 客户端新增 `src/client/mcp-debug-dialog.tsx`：`inputSchema` → 表单（string /
    number / integer / boolean / enum 下拉 / array·object 多行 JSON）、必填与类型
    校验、JSON 模式行内错误、执行后自动滚动到结果、`content` 按类型渲染（text
    pretty / image 缩略图 / resource 链接）、`structuredContent` 折叠、复制结果、
    Esc 关闭、⌘/Ctrl+Enter 执行；草稿与上次结果缓存在内存（同工具再打开恢复）。
  - **嵌套 object 递归子表单 + 数组逐项输入**（反馈「object 嵌套参数怎么填」
    「array 应该给一个个格子」）：`object` 带 `properties` 时按 schema 递归渲染成
    缩进子表单（最多 3 层；内层 `required` 同样标必填并校验，必填对象要求至少填一个
    子字段）；`array` 的 `items` 是基础类型 → 每项一个控件，是 object → 每项一张子
    卡片，支持「＋ 添加一项 / ✕ 删除」（删除后下标前移，已填值保留）；只有 items 是
    数组或没有 items 时才退回多行 JSON；必填数组 0 项时执行禁用。JSON 模式递归校验
    嵌套类型/必填/数组项并提示未知键，切回表单只回填已知字段。设计新增第 8/9 帧
    `preview/v25-08-nested.png` / `v25-09-array.png`；验证
    `notes/verify/v25-nested-gui.mjs` 5/5、`notes/verify/v25-array-gui.mjs` 8/8
    （逐项分组 / 增删与下标前移 / 必填数组禁用 / 字符串数组与对象数组执行回显）。
  - 结果预算 200k 字符（超长文本截断并标记）；调用超时默认 / 上限 60s；失败
    （连接失败 / 超时 / 服务器 JSON-RPC 错误 / isError）都收敛成业务失败就地展示。
  - 文档与设计：README 新增「MCP 工具调试（v25）」；Figma 新页
    `Capability Panel · MCP 工具调试 v25（定稿）`（page `240:2`，9 帧），预览
    `docs/figma/preview/v25-01…09-*.png`。
  - 验证：`node notes/verify/mcp-invoke.mjs` 12/12（真实 stdio 夹具 tools/call、
    参数校验、未知工具、连接失败、manager 两条路径、RPC 信封、无残留子进程）；
    隔离实例（`DSH_HOME=.verify-home --profile v25`）Playwright 走查 12/12（右栏
    按钮 → 弹窗 → 填参 → 执行回显 `hello v25` → JSON 模式 → Esc）；`pnpm typecheck`
    与 `pnpm build` 通过。

### 修复

- **调试弹窗长描述压到输入框 / 溢出的排版问题**：`string(enum)` 等字段的
  `description` 很长（含 `sky_click`、`OPEN_COMPUTER_USE_ALLOW_GLOBAL_POINTER_FALLBACKS=1`
  这类长词）时，说明原先放在 260px 标签列里（`flex:1 0 100%`），长词的
  min-content 宽于列宽、Flex 子项又无法收缩，横向溢出到控件列并压到输入框底部。
  现在参数行改为三行网格：第 1 行「标签 | 控件」、第 2 行「说明」跨两列、
  第 3 行「错误」跨两列；说明加 `min-width:0 / max-width:100% /
  overflow-wrap:anywhere`，长英文与下划线长词按列宽强制断行；分组头的说明
  同样独占一行。验证 `notes/verify/v25-longdesc-gui.mjs` 6/6（说明在输入框下方、
  跨两列、不超出弹窗、不压下一行、无横向溢出），回归 v25-debug-gui 12/12、
  v25-nested-gui 5/5、v25-array-gui 8/8。

## [1.17.0] - 2026-11-09

### 新增

- **对话「分叉」继承原会话的会话级能力开关**（用户反馈：分叉出的会话没有继承
  原会话的 session 级能力配置）：宿主 `session/fork` 按设计**不写 `parentSession`**
  （只写 `isSeeded` + 继承事件前缀），插件原本只在有 `parentSession` 时才做派生
  继承，因此分叉会话总是落回项目 / 全局默认。现在：
  - 新增 `src/derive/fork-source.ts`：在宿主 `sessionController.fork` 方法外层套
    `AsyncLocalStorage`，fork 调用期间（含其内部 `agent/created` 派发）可读到源
    会话 id；cordis traceable Proxy 用 `Symbol.for("cordis.original")` 取原始服务
    实例替换方法，dispose 还原，任何失败 fail-open（分叉照常创建）；
  - `derive/manager` 的 `agent/created` 把「`isSeeded` + 无 `parentSession` +
    fork 上下文有源会话」识别为分叉，按「派生继承会话」同一口径复制：Skills 按
    父 / 子可见集合投影、MCP / Tools 复制显式覆盖；**不看派生模式下拉**（分叉是
    同一段对话的延续），`resume` 不重新继承；
  - 分叉会话仍是普通会话：不写 `derived*` 元数据（派生下拉 / 派生页只服务
    subagent / teammate），父子之后各自独立；
  - 新增 `session-state.inheritToggles`（一次落盘复制三域覆盖；全空不建记录）。
  验证：`notes/verify/v27-fork-inherit.mjs` 6/6；**真实宿主（隔离实例
  DSH 0.2.2-rc.1）E2E**：对带完整轮次的会话设置 Skills / MCP / Tools 会话开关后
  调 `session/fork`，子会话记录得到 `skills` 172 项投影（含父显式关闭项）、
  `mcp:server:tavily=false`、`tools:plugin:dsh-task-gantt=false`；子会话 live
  列表 `enabledInSession=false` 生效，`session.deriveGet` 无 `derived` 字段。

## [1.16.0] - 2026-11-08

### 修复

- **DSH 升级到 0.2.2-rc.1 后，插件清单的兼容声明与实际宿主版本不符**
  （用户反馈：确认插件在 0.2.2-rc.1 下的适配情况）。宿主 0.2.2 的插件加载门禁
  （`@deepseek-ai/dsh-app-boot` 的 `evaluatePluginCompatibility`）规则是：声明了
  `engines.dsh` 就只按它判定、忽略 `@deepseek-ai/dsh*` peer；否则逐个校验 dsh-*
  peer（`semver.satisfies(runtime, range, { includePrerelease: true })`），不匹配
  整个 bundle 被 `skipping profile bundle` 跳过。原清单：
  - `@deepseek-ai/cordis` peer 是 `~4.0.4`，而宿主 0.2.2 用 **cordis 4.1.0**；
    cordis 不在门禁过滤范围（只看 `@deepseek-ai/dsh*`），**不影响加载**，但声明失真；
  - `@deepseek-ai/dsh-invariants` peer 指向的包自 0.2.1 起已不再随宿主发布
    （0.2.2 app.asar 内不存在、npm 无 0.2.1+ 版本）；门禁只比「范围 vs 运行时版本」、
    插件源码也不 import，**不影响加载**，但同样失真且会让 pnpm/插件管理器报
    unmet peer。

  现改为：删除 `@deepseek-ai/dsh-invariants`（peer + dev）；`@deepseek-ai/cordis`
  peer 放宽为 `>=4.0.4 <5.0.0`（devDeps 升到 `^4.1.0`，与宿主 4.1.0 的
  `ctx.inject`/`ctx.plugin` 返回 Fiber 语义对齐）；新增
  **`engines.dsh: ">=0.2.0-rc.2 <0.3.0"`** 作为运行时兼容范围的单一事实源
  （0.2.1+ 只认它；0.2.0-rc.2 无该字段支持时回退 peer，两种路径都通过）。

### 变更

- 开发依赖 / 类型目标升级到 **DSH 0.2.2-rc.1**：`@deepseek-ai/dsh-*` devDeps 全部
  `^0.2.2-rc.1`；运行时兜底依赖 `@deepseek-ai/dsh-home-paths`、
  `@deepseek-ai/dsh-mcp-client` 同步到 `^0.2.2-rc.1`（仍优先使用宿主 loader 里的同一份实例）。
- 宿主行为变化（插件无需改码，仅记录）：0.2.2 起 agent-instructions baseline 额外读取
  `~/.agents/AGENTS.md`（`agents-global` 作用域）并做双根去重 —— 插件 v23 Prompt 域
  已按同语义建模；`dsh-mcp-client` 对未声明 `resources` 能力的 server 不再调用
  `resources/list`，插件「关掉 server 后资源清单遮蔽」逻辑与段格式不变。

### 内部

- **0.2.2-rc.1 兼容审计（0 breaking）**：宿主侧 A–M 契约（插件加载 / tools
  `restrict`·`schemas`·`guard`·`change` / `systemPrompt.section` 同名空文本 shadow /
  `agent/pre-step`·`agent/created`·`agent/disposed`·`session/disposed` /
  `webServer.register({kind:"prefix"})` / `loader.import` / `system-prompt/assemble` /
  mcp-client / mcp-resources / skills 注册表 / `sessionPersistence.stat` /
  `dsh-home-paths`）与客户端 24 条契约（lazy-CJS 注册协议、`dsh.client.inject`、
  `exports["./client"]`、4 个槽位与 standardProps、`connection.rpc.call` 包络、
  workspaces/sessions 快照、`layout.selectPanel`、React externals）逐条对照 0.2.0/0.2.1
  基线，均为 unchanged 或纯加性变化。关键对照：`dsh-client-ui-renderer` 与
  `dsh-client-connection` 的 `client.browser.js` 相对 0.2.1-rc.3 **字节相同**。
  审计报告（本地、已 gitignore）：`notes/compat-022/{host-audit,client-audit}/findings.md`。
- **隔离实机复核**（不触碰用户 profile）：桌面应用自带 0.2.2-rc.1 运行时 +
  `DSH_HOME=.verify-home` 起独立 web 实例（`--profile web --port 19400`），Playwright
  只读复核：能力面板 5 个域全部渲染（Skills 176 / MCP 9 / Tools 3 / Prompt 0 /
  Jev 模型）；RPC `skills.list` / `mcp.list` / `tools.list` / `prompt.list` /
  `overrides.globalGet` / `session.listOverrides` 全部 `{ok:true}`；首屏 hero 入口
  计数（Skills 175 / MCP 9 / Tools 3）与「派生继承」下拉正常；`.skp-main` 高度 =
  视口 950px、列表滚动容器 `.skp-group-scroll` clientH 752 / scrollH 18170
  —— 确认 0.2.2 新增的 `.mainPanel` 包裹层不影响全高与内部滚动。
- 启动日志无 `skipping profile bundle "dsh-capability-settings"`（新 `engines.dsh`
  在 0.2.2-rc.1 门禁下判定通过；重启隔离实例后复验）。
- 验证：`pnpm typecheck` / `pnpm build` 通过（`lib/client.js` 831.26 kB，与运行中桌面
  实际下发的 831,309 B bundle 一致）；`loader-behavior` 81/81、Jev host 套件
  （host-config 82/82、host-rank 132/132、host-apply 122/122、host-rpc 13/13、
  client-adapter 21/21）、v23/v24/v25 UI 与 prompt 套件全过。
- **本地 `run-all.sh` 说明**：整体仍有 17 个脚本失败，逐条核对为**与当前代码语义
  脱节的历史残留用例**（如 `slot-input-dock-hero` 期望 v18 已移除的 `input.dock`、
  `render-smoke` 期望旧版导航、`dock-visual` 抛错），用 HEAD 的旧依赖基线（0.2.0-rc.1）
  跑同名脚本失败数完全一致（render-smoke 8 / capability-dock-render 10 /
  bug1-composer-cwd-e2e 7），**与本版本改动无关**；不是依赖升级引入的回归。

## [1.15.1] - 2026-11-06

### 修复

- **Skills 详情文件树不显示 `.env` 等隐藏文件**（用户反馈：技能目录里的
  `scripts/.env` 在文件列表里看不到）：客户端原先按「任意路径段以 `.` 开头
  即隐藏」过滤，把所有 dotfile 一并挡掉。改为只隐藏 VCS / 系统元数据
  （`.DS_Store` / `.git` / `.svn` / `.hg`，仍计入「隐藏 N」提示），其它
  以 `.` 开头的普通文件（`.env`、`.gitignore`、`.npmrc` …）在目录树中照常
  展示、可预览/复制/下载。验证 `notes/verify/v26-skill-dotfiles.mjs` 3/3
  （jsdom 真实渲染 + 点击 `.env` 行；`.DS_Store` / `.git/config` 仍隐藏）。

## [1.15.0] - 2026-11-06

### 新增

- **Jev 三维判据（角色 / 任务 / 操作指令，取 max）**：`jev.rank` 与派生「动态选择」
  对每个能力最多发 3 道 `noul` 题——`<capId>~role`（角色定义的长期职责是否需要）、
  `<capId>~task`（当前任务是否需要）、`<capId>~operation`（当前操作指令是否要求该动作）；
  每题只判一层，能力得分取三维 **max**（任一需要即启用，宁可冗余、不收窄）。首屏评分与
  spawn 旁路打分共用同一实现，行为一致。
  - `src/jev/rank.ts`：新增 `RankDimension` / `RANK_DIMENSIONS` /
    `RANK_DIMENSION_TASKS` / `RANK_DIMENSION_CRITERIA` / `rankQuestionId` /
    `parseDimensionScores` / `parseRankScore`；`state.guidance` 改为分层判据
    （明确「每题只判一层、能力相关度取 max」）；三维都带工具清单（实测 role 维度去掉
    tools 后区分度退化：需要项 0.72–0.79、无关项被抬到 0.35–0.38）。
  - **按体积分片**：三维请求体积约为单维 2.4–2.9×，152 条能力会超过 150KB 软上限 →
    新增 `buildSystemOneRequests`（按能力二分、保持原顺序），每片仍走原 4 档降级；
    `jev.rank` 串行发送并合并 `answers`，对外仍是一次调用（`requestCount` 语义不变 = 1）。
  - `src/jev/manager.ts` / `src/derive/auto-select.ts`：改用 `buildSystemOneRequests` +
    `parseRankScore`；动态选择多片共享 8s 总预算（`AbortController`）。
  - 实测（8 个真实 MCP，`notes/verify/jev-bench/`）：常规任务三维 max 与旧单维分数差
    ≤0.1；teammate 就位 prompt（角色+待命）从「全部 0.03–0.04」变为按角色
    role=0.82–0.90（task/op≈0.03），可正常预置检索能力；8 能力请求 11.4KB →
    32.6KB、input tokens 3.2k → 8.6k。
  - 验证：`pnpm typecheck` / `pnpm build`；`host-rank` 132/132（新增 H15 三维取 max、
    H14 152 能力分片断言）。
- **「Jev 模型」配置页可配置能力决策的初始相关度阈值**（用户反馈：首屏「✦ 能力决策」
  结果面板的阈值初值固定 `0.50`，希望能在配置里改）：`jev.json` 新增 additive 字段
  `decisionThreshold`（`0–1`，默认 `0.50`），宿主读取 / `setConfig` 校验（越界返回
  `E_DECISION_THRESHOLD`，不落盘）、`getConfig` 视图回传；「Jev 模型」Tab 的
  「能力决策」区新增**相关度阈值**滑杆（步长 `0.05`，随表单一起保存 / 恢复默认）；
  首屏结果面板的初始阈值改读该配置（配置未就绪 / 旧宿主缺字段时兜底 `0.50`），
  面板内拖动仍只影响本次、不回写配置。
  验证：`pnpm typecheck` / `pnpm build`；本地 Jev 套件 `host-config` 82/82、
  `client-adapter` 21/21、新增 `client-threshold` 9/9（配置页回显 / 保存载荷 /
  首屏初值取自配置 / 旧宿主兜底）。
- **派生第三种模式「动态选择」（v24）**：`派生继承会话 / 派生继承工作区` 下拉新增
  `动态选择`。spawn 时用子 agent 首条任务（`subagent` 的 `prompt`、
  `spawn_teammate` 的 `prompt`）在**工作区默认能力**（Skills / MCP / Tools）上逐项
  跑 Jev 相关度，`score ≥ 阈值` 才启用；阈值取「Jev 模型」配置页的
  `decisionThreshold`（默认 `0.50`，菜单 / 派生页只读展示）。
  - 宿主新增 `src/derive/auto-select.ts`：`tools/pre-execute`（被 await 的 waterfall）
    抓 spawn 首条任务并打分 → pending；`agent/created` 早期 seed child 会话记录，
    晚期（skills / mcp / tools 之后）await 三域 `setSessionEnabled*` 收敛，保证
    首轮即按选择生效；打分上限 8s，失败绝不阻塞 spawn。
  - 空集 / Jev 未配置 / 超时 / 异常 → 回退「派生继承会话」（复制父会话显式快照；
    跨项目根回退工作区默认）；`ralph` / `workflow` 的逐 child 任务文本拿不到，按
    回退处理；覆盖 `subagent`（spawn / fork）与 `spawn_teammate` 两条路径。
  - `session-capabilities.json` 的派生快照新增 additive 字段 `derivedDynamic`
    （`status` / `reason` / `threshold` / `selected` / `total` / `counts` /
    `fallback`）；`DeriveMode` 增加 `"dynamic"`，旧版本读到会忽略该字段（降级为
    默认 `session`）。
  - UI：下拉第三项 + 底部只读阈值（来源「Jev 模型」配置，配置保存事件后刷新）；
    派生会话页成功显示蓝色快照条 + `动态` chip，回退显示琥珀色提示 + `已回退` chip。
  - 验证：`pnpm typecheck` / `pnpm build`；本地 `notes/verify/v24-dynamic-derive.mjs`
    7/7（plan 阈值 / 三域 toggles / 空集回退 / session-state 落盘重载 /
    pre-execute 打分 / 晚期应用 / derive 顺序）；`notes/verify/v24-dynamic-derive-ui.mjs`
    2/2（三项下拉 / 阈值 0.55 只读行 / set(dynamic)；派生页成功「选出 7 项」+ 回退
    「timeout」banner / chip）。

### 修复

- **动态选择回退后「父 agent 0 项 / 子 agent 3 项」**（用户反馈 `session-8dd9ed78…`：
  父会话 0/192，三个 teammate 的能力页各显示 3/192）：回退「派生继承会话」时技能
  投影只遍历 **child 当时可见的技能名**，而 `visibleSkillNames` 会排除
  `disable-model-invocation: true` 的 user-only 技能（本机 `grill-me` /
  `grill-with-docs` / `i-have-adhd`）；父级显式关闭但没有出现在 child 可见集合里的
  名字因此漏写，child 落回工作区默认（开启）。修复：
  - `sessionTogglesFor` 投影时补上父级**显式 false 且 child 缺失**的技能名；
  - 新增 `repairDynamicFallbackSkillProjection`（启动时幂等对账）：对已存在的
    `derivedMode=dynamic && derivedDynamic.status=fallback` 记录补齐缺失的父级显式
    false 键；只动动态回退，不动 session / workspace / 动态成功快照。
  验证：`notes/verify/v24-dynamic-derive.mjs` 9/9（新增“父级显式关闭但不在 child
  目录的技能”投影、回退快照对账幂等两组断言）。

## [1.14.1] - 2026-11-05

### 修复

- **磁盘技能目录名 / 文件名与 frontmatter `name` 不一致时，详情页「文件列表读取失败」
  （用户反馈：`.agents/skills/ht-order-center-skill/SKILL.md` 的 frontmatter 是
  `name: htdot-order-supply`，面板能列出技能但打开报
  `skill "htdot-order-supply" not found`）**：宿主 `skill-filesystem` 以 frontmatter
  `name` 注册、目录名只是存放位置，而面板所有「按名称拼磁盘路径」的入口都直接用
  frontmatter name 定位 `<root>/<name>`，名称不一致即找不到；registry fallback 也救不了
  面板（`skill-filesystem` 挂在 agent preset 作用域，root 的同名行 `disabled: true`，
  无 agent scope 的 `snapshot({cwd})` 只能看到 global 层的 runtime 注入条目）。
  新增 `resolveSkillEntry`（`src/skills/disk.ts`，与 `list()` 同一套发现口径：先走
  `<name>.md` / `<name>/SKILL.md` 快路径，未命中再扫描根目录按 frontmatter name 匹配），
  并统一接入详情 / 导出（文件清单、导出到宿主目录）/ 编辑 / 删除 / 调用方向开关 /
  创建冲突 / 克隆 / 导入到本项目：写操作写回**原磁盘条目**，不会新造一个
  frontmatter 名目录。验证：真实宿主 RPC（隔离实例）`skills.read` /
  `skills.export` 由 `not found` 变为返回正文 + 9 个文件；新增
  `notes/verify/skill-sources/host-disk-name-mismatch.test.mjs` 28/28
  （含 flat 布局、覆盖创建、导出路径、删除无连带、未知名称仍 not found）。

## [1.14.6] - 2026-11-05

### 内部

- **补齐 v1.14.5 的 lib 清理**：1.14.5 只是在原 lib 上重新编译，`tsc` 不会删除
  v1.14.4 误提交的 `lib/derive/auto-select.js` / `lib/types/derive/auto-select.d.ts`
  （并行会话未提交源码的产物）。本版本在干净 worktree 里**删除 `lib/` 后完整重建**并提交，
  确认 `lib` 只包含已提交源码的产物。并行会话的代码仍由它自己提交。

## [1.14.5] - 2026-11-05

### 内部

- **重新生成 `lib/`，使其与已提交源码一致**：v1.14.4 构建时工作区里还有另一个并行会话
  尚未提交的动态模型源码（`src/derive/auto-select.ts` 等），`pnpm build` 把这些**未提交
  源码**的产物一起打进了 `lib/` 并随 tag 提交，导致 tag 的 `lib` 与 `src` 不匹配。
  本版本在 `e32a6db` 的干净 worktree 里按已提交源码重新构建并提交 `lib/`；
  并行会话的源码与产物由它自己提交，不受影响。

## [1.14.4] - 2026-11-05

### 修复

- **Prompt「查看全部」弹层改用全屏 portal + 背景模糊**（用户反馈：弹层被面板裁切、背景没有模糊、
  观感差）：
  - 用 `createPortal` 挂到 `document.body`，`.skp-prompt-full-overlay` 全屏 fixed +
    `backdrop-filter: blur(10px) saturate(120%)` 遮罩，不受面板 overflow / transform 裁切；
  - 居中宽版面板（`min(920px, 92vw)` / 最高 82vh）：固定标题栏 + 关闭按钮 + 可滚动正文，
    正文仍是 Markdown 渲染；点遮罩 / `✕` / `Esc` 关闭；
  - 补 `src/client/react-dom.d.ts`（只声明 `createPortal`，不引 `@types/react-dom` 整包）。
  验证 `notes/verify/v25-prompt-frozen.mjs` 5/5（含 portal 位置 / 弹层内表格 / 遮罩关闭）。

## [1.14.3] - 2026-11-05

### 修复

- **会话「能力」→ Prompt 只读页的「已注入内容预览」改为 Markdown 渲染 + 查看全部**
  （用户反馈：预览是 `<pre>` 原文、且没有查看全部入口）：
  - 预览用 `MarkdownPreview` 渲染，去掉插件控制的 `<system-reminder>` 包裹与固定 intro，
    每个文件的 `Instructions from: <path>` 升级为二级标题，正文（含 GFM 表格）原样渲染；
  - 右上角新增「查看全部」按钮，打开宽版弹层滚动查看完整注入内容（弹层内同样是 Markdown）；
  - 只读页预览默认高度 200px，超出部分在弹层里查看；正文不再按 4000 字截断。
  - composer 作用域补 `.skp-prompt-frozen` 的 `--skp-*` 令牌映射，保证 Markdown 在深色只读页可读。
  验证 `notes/verify/v25-prompt-frozen.mjs` 5/5（Markdown 渲染 / framing 清理 / 表格 /
  查看全部弹层 / 遮罩关闭）。

## [1.14.2] - 2026-11-05

### 修复

- **会话「能力」→ Prompt 只读页的预览位置**（用户反馈：内容预览被推到页面很下方）：
  `.skp-dock-grid` 的 `flex:1 1 auto` 在 view 面板里把卡片网格撑满高度，预览被压到页底。
  新增 `.skp-dock-grid-prompt{flex:0 0 auto}`，Prompt 网格只占内容高度——「已注入内容预览」
  紧跟卡片网格下一行。
- **移除 Prompt 页底部的两段说明文案**（用户反馈不需要）：`只展示首轮已注入 / 未注入结果…`
  与 `只展示本会话首轮注入结果 · 不参与 Jev 能力决策 · 不参与三域批量开关` 均不再渲染；
  相关能力说明保留在详情/列表本身。

## [1.14.0] - 2026-11-05

### 新增

- **Prompt 能力域（v23）：首轮注入的指令文件**——第 4 个条目域，覆盖
  `$DSH_HOME/AGENTS.md`、`$DSH_AGENTS_HOME/AGENTS.md` 与项目根（`.git` 向上）→ cwd 每层的
  `AGENTS.md` / `CLAUDE.md` / `AGENTS.local.md` / `CLAUDE.local.md`：
  - **能力面板**新增「Prompt」Tab：全局 / 项目分区列表（状态：注入 / 关闭 / 不可见 / 重复折叠 /
    预算省略 / 超 1MB）、详情 Markdown 预览 + 文本编辑（原子写）、全局可见范围弹层（按工作区
    `visible` / `defaultEnabled`）、工作区视图行尾独立默认开关；
  - **会话首屏**新增 Prompt Tab（卡片开关）：决定本会话首轮把哪些文件交给 DSH；默认全选
    （= DSH 原生行为），开关只写本会话选择；
  - **会话内「能力」Tab** 新增 Prompt 子 Tab：只读冻结，展示首轮实际注入的文件、顺序、字节、
    被预算省略/截断项与正文预览；不渲染任何开关与编辑；
  - 全局与项目 prompt **叠加注入**（不是覆盖）：每个文件独立启用，全部按顺序交给 DSH；只有同
    候选组内容重复时由宿主去重；
  - Prompt **不参与** Jev 能力决策与三域批量动作（`BULK_DOMAINS` 仍三域），也不写入
    `capability-global-overrides.json` 的 `visibility` 三域；
  - 降级：宿主渲染器不可用（`loader.import` 失败 / 导出缺失）时接管层整体 no-op，注入保持宿主
    默认行为，面板/首屏显示「开关暂不生效」提示。
- RPC：`prompt.list` / `prompt.read` / `prompt.save` / `prompt.setVisibility` /
  `prompt.setProjectDefault` / `prompt.setSessionSelection` / `prompt.manifest`；客户端
  `CapabilityPanelApi.prompt` 同步新增。
- 存储（均在 `<dshHome>/dsh-capability-settings/`，目录 `700` / 文件 `600`、原子写 + 文件锁）：
  - `prompt-policy.json`：全局可见范围 + 每工作区默认 + 按宿主项目根的每文件默认 + 会话首屏显式选择；
  - `prompt-manifests.json`：会话首轮冻结清单（文件顺序/字节/SHA-1、omitted、truncated、正文）。

### 修复

- **Markdown 预览不渲染 GFM 表格**（用户反馈：Prompt 详情里的 `AGENTS.md` 表格显示成
  `| 需求 | 首选 | … |` 原始管道符）：轻量渲染器补表格支持——表头 + 对齐分隔行 + 数据行，
  支持 `:---:` / `---:` 对齐、单元格内行内 `code` / `**bold**` / `\|` 转义；宽表外层
  `.skp-md-table-wrap` 横向滚动。Skills / MCP / Prompt 的 Markdown 预览同时生效。
  验证 `notes/verify/v25-markdown-table.mjs` 7/7。

### 变更

- **Prompt 详情页的「保存后：仅对新会话生效」不再常驻**：改为保存成功后在详情顶部弹出
  绿色提示条（约 4s 自动消失）；编辑态编辑器内保留一行轻量提示。预览页不再占用高度。

### 内部

- 新增 `src/prompt/`：`paths.ts`（宿主语义 home/项目根/目录链）、`store.ts`（策略 + 冻结清单）、
  `host.ts`（`loader.import` 取宿主 `@deepseek-ai/dsh-agent-instructions`，虚拟 fs 只暴露允许集合，
  拼接/去重/预算/framing 全由宿主完成）、`manager.ts`（列表/读写/策略/冻结）、`inject.ts`
  （root ctx `agent/pre-step` + `{prepend:true}`：首轮用宿主渲染结果替换 baseline 正文，之后丢弃
  增量并清 inbox；resume/compaction 后按冻结正文重放；全程 fail-open）。
- 新增验证 `notes/verify/v25-prompt.mjs`（26/26：路径语义 / 策略 / 存储 / 列表 / 读写 / 冻结清单 /
  RPC 信封 / 注入决策形状 / fail-open）。
- Figma：新增 `Capability Panel · Prompt 指令域 v23 草案`（page `207:2`，7 帧）+ 预览
  `docs/figma/preview/v23-01…07-*.png`，`docs/figma/README.md` 已同步。

## [1.13.1] - 2026-11-04

### 修复

- **MCP 详情页「删除 / 移出服务器」第一次点确认无效果**（用户反馈：点击删除项目级
  MCP 后不生效）：
  - 根因：v22 把删除动作从行内按钮收进详情页 `⋯` 菜单 + 确认弹窗后，面板级
    `onDelete` 里旧的「第一次点击只进入确认态、第二次点击才真正删除」状态机
    （`confirmDelete`）仍在。弹窗里的「删除」是第一次点击 → 只写确认态、不调
    `mcp.remove`；弹窗同时关闭，界面毫无变化（第二次再点才会删）。该状态机在行内
    删除按钮移除后已无用户可见入口，`confirmingDelete` 也不再被详情页渲染。
  - 修复：确认交由详情页弹窗完成，`onDelete` 直接执行 `mcp.remove` / 引用移出并
    清空选中；删除 `confirmDelete` / `confirmingDelete` 死状态，与 Skills 详情页
    删除口径一致。工作区原生条目、全局条目、引用条目三条删除路径同时生效。

### 验证

- `pnpm typecheck` / `pnpm build` → 0。
- `node notes/verify/mcp-delete-repro.mjs` → 修复前 REPRO-03 失败（`removeCalls: []`），
  修复后 3/3（点一次弹窗「删除」调一次 `mcp.remove({scope:'project', key:'order-center'})`）。
- 宿主侧 `mcp.remove` 落盘核对：临时工作区 `.mcp.json` 删条后只剩另一条、触发项目重挂。
- `node notes/verify/v22-detail-layout.mjs` → 13/13。

## [1.13.0] - 2026-11-04

### 变更

- **会话「能力」Tab 卡片加强开关状态对比**（用户反馈：一眼看过去开启 / 未开启差不多）：
  - 开启卡片：品牌色描边（58%）+ 13% 品牌色底 + 左侧 2px 品牌色竖条 + 底部「已启用」标签，
    hover 底色加深到 18%；
  - 未开启卡片：整卡压暗（`opacity:.55`，hover 回升到 .85）+ 标题降至 tertiary / 500、
    描述同为 tertiary + 底部「未启用」标签；
  - 锁定行（不可切换）不参与亮暗区分：保持 `.skp-dock-card-disabled`（opacity .5、
    cursor default、无 hover 高亮）；
  - 新增 `.skp-dock-card-off` / `.skp-dock-card-state` 样式，`CapabilityCard` 增加状态标签。

### 验证

- `pnpm typecheck` / `pnpm build` → 0。
- `node notes/verify/v24-session-cards.mjs` → 真实渲染对比截图
  `notes/real-gui-evidence/v24/session-cards.png`（开启 4 张 / 未开启 4 张并排目测通过）。
- 相关既有套件 `v13-session-bulk` / `v13-tools-ui-layer` / `render-smoke` 的失败项与本改动
  无关（均为更早版本遗留断言：冷会话 skipped、工具行 switch title、ScopeNav），改动前基线同样失败。

## [1.12.3] - 2026-11-03

### 变更

- **「元数据」入口去掉展开箭头**（用户反馈）：元数据已改为弹窗，不再有展开/收起语义，
  去掉按钮上的 `⌄ / ⌃` 与 `aria-expanded`（MCP 配置条目 / 外部注入 / Skills 三处一致）。

### 验证

- `pnpm typecheck` / `pnpm build` → 0；`notes/verify/v22-detail-layout.mjs` → 13/13。

## [1.12.2] - 2026-11-03

### 变更

- **详情状态条三个入口样式统一、全部走弹窗**（用户反馈）：
  - `编辑可见范围` / `使用记录` / `元数据` 统一为同一款胶囊按钮（`skp-strip-meta-btn`），
    不再混用文字链接；
  - `元数据` 从 inline 展开面板改为**宽版弹窗**（`Modal wide`，760px：三列元数据网格 +
    可见范围摘要 + frontmatter / 服务器提示 + 复制动作 + 关闭）；
  - `使用记录`、`编辑可见范围` 继续走弹窗；MCP / Skills 两域一致（Skills 无工具调用
    数据源，因此只有「编辑可见范围 / 元数据」两项）。
  - `detail-shell.tsx` 移除未再使用的 `MetaPanel`；`Modal` 新增 `wide` 选项。

### 验证

- `pnpm typecheck` / `pnpm build` → 0。
- `node notes/verify/v22-detail-layout.mjs` → 13/13（新增 V22-09：三个入口同类名；
  V22-04 改为断言宽弹窗；V22-08c 断言弹窗内只留可见范围摘要）。
- `node notes/verify/v22-visual.mjs` → 真实渲染截图 `notes/real-gui-evidence/v22/`
  （mcp-detail.png / mcp-metadata-modal.png）。

## [1.12.1] - 2026-11-03

### 修复

- **全局条目的「编辑可见范围」移到详情状态条外层**（用户反馈：藏在「元数据」面板里，
  要先展开才能看到）：Skills / MCP 全局详情现在与「使用记录」「元数据」并排直接提供
  「编辑可见范围」胶囊按钮（tooltip = 当前可见范围摘要），点开即弹层；元数据面板里的
  「可见范围」行只保留摘要（`VisibilityDetailFields summaryOnly`），不重复按钮。
  新增 `VisibilityEditControl`（`src/client/visibility.tsx`）。

### 验证

- `pnpm typecheck` / `pnpm build` → 0。
- `node notes/verify/v22-detail-layout.mjs` → 12/12（新增 V22-08/08b/08c：
  状态条外层入口可见、点开即弹层、元数据只留摘要不重复按钮）。

## [1.12.0] - 2026-11-03

### 变更

- **详情页改为「内容优先」布局（Skills / MCP 两域）**：用户反馈旧详情把作用域卡片、
  动作行、字段表 / frontmatter 堆在正文上方，`工具与参数`、`SKILL.md` 正文只剩半屏。
  现在详情页是「固定头部三段 + 内容区独立滚动」：
  - 头部 = 标题行（名称 / 徽章 / 常驻启停开关 / `⋯` 菜单）+ 状态条（单行作用域链 +
    来源 + 命名空间 / 格式 + 使用记录 / 元数据）+ 内容工具条；MCP 约占 136px，
    Skills 多一行描述。
  - 长元数据（MCP 命名空间 / 命令或 URL / 配置文件 / 用途描述 / 可见范围 / 服务器提示；
    Skills 来源 / 格式 / 路径 / 调用方式 / 使用时机 / frontmatter）收进「元数据」面板，
    默认收起、inline 展开（内容区仍 ≥ 56%）。
  - **MCP 工具与参数改为主从分栏**：左 262px 工具列表（搜索 / 参数数 / 选中态 /
    ↑↓ 键盘切换），右侧常驻参数详情；详情打开即探测一次（`mcp.test`，零副作用），
    失败只在内容区提示 + 重新测试，不影响已挂载连接。
  - **Skills 目录树常驻**：flat / 单文件技能也显示所在目录与文件（此前隐藏树、阅读器
    占满）；多文件仍按目录分组、点文件切预览 / 源码。
  - 详情动作收进 `⋯` 菜单（编辑配置 / 导出 / 导出到路径 / 复制到本工作区 / 删除等），
    危险项红色；MCP 删除改用确认对话框（原两击确认）；使用记录改为弹窗（2s 轮询不变）。
  - 新增共享外壳 `src/client/detail-shell.tsx`（DetailPage / DetailTitleBar / DetailStrip /
    ToggleSwitch / MoreMenu / MetaPanel）；`ScopeChain` 增加 `compact` 单行变体。
- **Figma 原型**：新增 `Capability Panel · 详情页内容优先 v22 草案`（page `201:2`，
  6 帧 1194×878：MCP 备选 A 手风琴 / A + 元数据 / **MCP 定稿 B 主从分栏** /
  Skills 单文件 / Skills 多文件 + 元数据 / 规范）；预览 `docs/figma/preview/v22-*.png`。
  2026-11-03 反馈：MCP 选方案 B；Skills 目录树必须常驻。

### 验证

- `pnpm typecheck` / `pnpm build` → 0。
- `node notes/verify/v22-detail-layout.mjs` → 9/9（自动探测、工具切换、元数据面板、
  ⋯ 菜单、开关写 `mcp.setEnabled`、Skills 目录树常驻）。
- `node notes/verify/v22-visual.mjs` → 真实 CSS + Chromium 截图
  `notes/real-gui-evidence/v22/mcp-detail.png`（MCP 详情主从分栏目视通过）。
- 既有 `notes/verify/render-smoke.mjs` 12/20：失败项均为 v20.1 已删除的 ScopeNav 旧断言
  （改动前基线同样失败），非本次回归。

## [1.11.1] - 2026-11-03

### 修复

- **项目自己的 Skills / MCP 行不再显示「默认 · 跟随全局」**：项目条目没有「全局默认」
  概念，这段文案无意义；现在项目原生条目的行尾开关不显示该标签（tooltip 说明是
  「本项目默认」）。工作区视图里全局条目的「跟随全局 / 已覆盖」保留。
- **项目 MCP 行尾开关勾选态修正**：工作区视图里项目原生 MCP 的开关现在表示「本工作区
  默认是否启用」（`disabledInProject`），原来错误地显示配置文件条目自身的 enabled；
  点击仍写 `capability-overrides.json` 的 `projects.<工作区>.mcp`。

### 验证

- `npx tsc --noEmit` / `pnpm build` → 0；v21 UI 24/24、v20.2 UI 9/9。

## [1.11.0] - 2026-11-02

### 变更（破坏性）

- **项目级配置改为落在「工作区目录」本身**（用户要求：旧的项目根语义是错的）：
  - 项目级 MCP：`<工作区>/.mcp.json`（不再向上找含 `.git`/`.dsh`/`.agents`/`.claude`/
    `dsh.json` 的祖先目录）；
  - 项目级 Skills：`<工作区>/.agents/skills`（及 `.dsh/skills` 兼容路径）；
  - 项目级 overrides（默认关闭 / 重新打开）：`capability-overrides.json` 的 key
    从「项目根」改为**工作区目录**；
  - 项目级「全局能力引用」：`<工作区>/.agents/capability-imports.json`；
  - MCP loader 的项目层挂载、按项目的重挂、Skills 项目默认投影都按工作区目录解析。
- **不兼容、不迁移旧的项目根（祖先目录）配置**：旧 `<祖先>/.mcp.json` /
  `<祖先>/.agents/skills` 里的条目不会再被读取，也不会自动复制；需要的话请手动
  移动到工作区目录后重新添加。
- 面板「添加」弹窗的落点路径随之为 `<工作区>/.mcp.json` / `<工作区>/.agents/skills`，
  与实际写入一致；项目分组头恢复「本项目 · <工作区>」/「工作区独有」。

## [1.10.6] - 2026-11-02

### 修复

- **MCP「添加」弹窗显示了错误的落点路径**：项目级 MCP 实际写入 `<项目根>/.mcp.json`
  （项目根 = 从工作区向上找到的第一个含 `.git` / `.dsh` / `.agents` / `.claude` /
  `dsh.json` 的目录，同根下的多个工作区共享），但弹窗原来显示 `<工作区>/.mcp.json`。
  现在宿主 `mcp.list` 返回 `projectRoot` / `projectFile`，弹窗显示真实路径并注明
  「项目根 … · 同根工作区共享」；项目分组头在项目根与工作区不一致时也显示
  「项目配置（项目根 …）」。

### 验证

- `npx tsc --noEmit` / `pnpm build` → 0；v21 UI 24/24、v20.2 UI 9/9。

## [1.10.5] - 2026-11-02

### 修复

- **项目级列表行尾标签重复工作区目录名**：工作区视图的「默认」开关标签原来写成
  `<工作区名> 默认 · 跟随全局/已覆盖`，与列表标题/分组头里的工作区路径重复；长工作区名
  （如 `htdot-order-demand-skill`）还会把行内名称/元信息挤成一列。三域（Skills / MCP /
  Tools）统一改为 `默认 · 跟随全局` / `默认 · 已覆盖`，标签最大宽度 120px 并省略号截断，
  长名称不再破坏行布局。

### 验证

- `npx tsc --noEmit` / `pnpm build` → 0；v21 host 41/41、v21 UI 24/24、v20.2 UI 9/9。

## [1.10.4] - 2026-11-02

### 修复 / 性能

- **切换能力作用域/工作区的加载等待**：面板 Skills 工作区列表原来会做两次 registry
  snapshot/merge（cwd 快照 + 全局快照补注入行）。实测服务端 RPC 仅 50–70ms，但真实环境
  （插件多、技能多）double snapshot 会放大延迟。现在：
  - 面板无 session/agent，注入行固定来自全局快照：`panelSkillRows(cwd)` 只做**一次**
    `merge({ cwd: undefined, diskRows, projectDisabled })`，磁盘行仍按工作区读取。
  - 会话列表保留一次 session merge；补额外的全局注入行改走 `registry.globalInjected()` 的
    **3s TTL 缓存**（`skills/change` 立即失效、并发合并、失败降级），不再每次双 snapshot。
- **客户端 stale-while-revalidate**：`useAsyncList` 增加 cacheKey + 模块级缓存，切换作用域/
  工作区时**同步渲染已访问过的列表**并后台刷新；无缓存时保留上一份数据，不再清空成
  「加载中…」；有数据时只显示轻量「刷新中…」。
- **列表行 memo 化**（Skills/MCP/Tools）：切换/选中/刷新提示变化时不再整表重渲 160+ 行。

### 验证

- 服务端自测 3/3：`globalInjected` TTL / skills-change 失效 / 浅拷贝；面板单次 merge 含注入行；
  会话列表无双 snapshot。
- 客户端 jsdom 11/11：三域 global↔workspace↔global 第二次切换同步出缓存、轻刷新提示；
  筛选/搜索/选中不整表重渲。
- v21 host 41/41、v21 UI 24/24、v20.2 UI 9/9；`npx tsc --noEmit` / `pnpm build` 通过。

## [1.10.3] - 2026-11-02

### 变更

- **默认 / 可见性只影响新建会话**：全局默认、每工作区默认与可见性写盘后不再对已存在的
  session 做热应用（不再 reconcile / refreshRestrictions / 重新 apply）。三域在会话创建时
  **冻结默认快照**：Skills（`skillDefaults` / `defaultsFrozen`）、Tools
  （`record.defaults/globals` + `frozenDefaultsOf`）、MCP（`SessionDefaultsSnapshot`）；
  之后的 `tools/change`、面板列表读取、会话级开关触发的 remount、配置级重挂都复用基线。
  某个 session 正在使用 A skill 时，全局关闭 A 不会影响它；新建 session 才按新配置投影。
  会话级显式开关仍即时、只影响当前 session。`mcp.setEnabled`（`mcp.json` 的 `disabled`
  配置级硬关闭）仍允许重挂，属于配置启停而非默认。
- **Skills 详情增加 frontmatter 展示**：名称、描述、使用时机（触发规则）、模型/用户调用
  策略、`metadata`（key-value，嵌套 JSON 预览）以及可折叠的原始 YAML（只输出真实存在的
  字段，不臆造未知键）；注入行读取失败静默降级。
- 可见性弹层与详情补「只对新建对话生效；已有对话可在会话「能力」Tab 调整」说明。

### 验证

- 后端自测 4/4（Skills/Tools/MCP 写默认或可见性后已有 session 的 shadow/deny/restrict
  不变；新建 session 按新配置；配置变更触发的 remount 仍用创建时基线）。
- 前端 jsdom 9/9（详情 read/frontmatter 字段/YAML/空 metadata/注入行失败降级/两处提示文案）。
- `npx tsc --noEmit`、`pnpm build` 通过；v21 host/UI、v20.2 UI 回归。

## [1.10.2] - 2026-11-02

### 变更

- **可见范围弹层交互重做**：删除「全部 / 指定 / 不可见」模式分段与「全部工作区可见」
  链接；改为工作区表格逐行「可见」勾选 + 「默认开/关」，并在表头「可见」「默认」两列
  各加批量按钮（全选/全不选、全部默认开/关，默认批量只作用于可见行）。保存时按行状态
  推导 `mode`（全可见 all / 全不可见 none / 混合 selected），提交完整 workspaces 映射；
  footer 常驻与保存 dirty 态保持。

### 新增

- **可见性一致性检测与决策**：把能力设为不可见时，若某些工作区用项目覆盖显式开启了它
  （`enabledSkills` / `enabledMcp` / `enabledTools`），`overrides.setVisibility` 会返回
  `{ok:false, code:"visibility-conflicts", conflicts:[{workspace,projectRoot}]}` 且**不写盘**；
  面板弹二级确认框，用户可选：取消 / `keep`（写盘、保留工作区配置，恢复可见后生效）/
  `clear`（写盘，并从这些工作区的项目覆盖移除该能力的显式开启，其它默认不变）。
  新增只读预查询 RPC `overrides.visibilityConflicts`；`setVisibility` 入参新增
  `resolveConflicts?: "keep"|"clear"`，成功返回 `cleared` / `retained` 工作区列表。
  项目默认关闭名单不算冲突；项目原生条目/引用不做可见性、不参与检测。

### 验证

- 后端夹具 9/9（拒绝写盘 / keep / clear 只清 enabled* / MCP 与 Tools / 单工作区
  visible:false / 默认关闭不算冲突 / 坏存储静默 / 非法参数 / RPC 路由）。
- 前端 jsdom 真实 click 15/15（批量全选/全不选、默认全开/全关、mode 推导、冲突二级框
  三选择与重试）＋ footer/结构 5/5；Chrome 无头 30 工作区/30 冲突：列表可滚到底、
  footer 固定不位移、批量按钮不越列。
- v21 host 36/36、v20.2 UI 9/9 无回归。

## [1.10.1] - 2026-11-02

### 修复

- **工作区视图看不到插件注入的 Skills**：宿主 `skills.snapshot({ cwd })` 的工作区视图快照可能漏掉
  部分全局注入技能（插件 / preset 注入），导致全局列表有、工作区列表没有。工作区列表现在会在
  原有快照之外补一次 `{ cwd: undefined }` 全局快照的 `injected` 行（按 name 去重，磁盘行与工作区
  行优先），`skills.list` / `skills.sessionList` 同一口径；不可见过滤、`hiddenCount`、shadow /
  projectShadow 判定保持不变。
- **可见性弹层**：底部「取消 / 保存」改为常驻弹层底部，不随工作区列表滚动；内容区独立滚动、
  表头 sticky。**「保存」增加 dirty 态**：打开时无改动则置灰禁用（点击不发 RPC），修改任一工作区
  可见性 / 默认开或关 / 切换模式后变为可用主色；取消始终可用。保存载荷仍是完整 `workspaces` 映射。
- 自测：jsdom 11/11（footer 不在滚动容器内、初始保存禁用、无改动 0 RPC、改动后启用、还原后
  重新禁用、完整载荷）；Chrome 无头 30 工作区实测滚动到底且 footer 位置固定（618.9 → 618.9）；
  v21 UI 12/12、v20.2 UI 9/9、v21 host 36/36 无回归。

## [1.10.0] - 2026-11-02

### 新增（v21 能力可见性）

- **能力可见性（按工作区）**：全局文件 `capability-global-overrides.json` 升 v2，新增
  `visibility{skills,mcp,tools}`：每个能力对每个工作区可配 `mode`（all / selected / none）
  与 `workspaces.<path>.{visible,defaultEnabled}`；v1 文件读取兼容（全部可见）。
  - 全局是唯一可见性控制方：不可见 ⇒ 工作区列表/详情、对话首屏/能力 Tab 都不出现，
    运行时强制不可用（MCP restrict + 指令段影子、Skills runtime shadow、Tools deny）；
    会话开关不能打开不可见能力（RPC 业务失败）。
  - **每工作区默认开/关**：全局为每个可见工作区单独配置默认；工作区可再覆盖
    （沿用 `skills`/`enabledSkills`、`mcp`/`enabledMcp`，Tools 新增 `tools`/`enabledTools`）。
  - **Tools 域纳入**：与 Skills/MCP 同模型（可见性 + 每工作区默认 + 工作区覆盖 + 会话开关）。
  - **项目自己的条目不做可见性**：`.mcp.json` 原生条目、项目技能、项目引用仍由项目在
    工作区内管理。
- 面板：三域全局行增加可见性标签 + 「默认：N 开 / M 关」摘要；详情「可见范围」分段 +
  工作区表格（可见 checkbox + 默认开/关）；可见范围弹层按工作区分别配置；工作区视图只列
  可见条目并提示「另有 N 个能力未对此外工作区开放」；对话首屏/能力 Tab 复用现有 v18/v19
  界面，仅做可见性过滤与可见口径计数。
- 新宿主模块 `src/shared/visibility.ts`（`visibleIn` / `perWorkspaceDefault` /
  `workspaceMatchKey` / 归一化与坏数据降级）；客户端共用 `src/client/visibility.tsx`。
- RPC：新增 `overrides.setVisibility({domain,key,mode,workspaces})`（写盘后三域热应用）；
  `overrides.globalGet` 返回 `tools` 与 `visibility`；`overrides.toggle` / `globalToggle`
  扩到三域；`skills.list` / `skills.sessionList` value 改 `{skills,hiddenCount}`
  （service 层数组形态保留，旧客户端 adapter 兼容）；`mcp.list` / `mcp.runtime` /
  `tools.list` 增加 `hiddenCount` 与行可见性字段。
- 设计稿：Figma `Capability Panel · 可见性与默认 v21 草案`（page `192:2`，5 帧），
  预览 `docs/figma/preview/v21-01…05-*.png`。

### 变更（v21）

- 三域全局默认的兜底口径不变：`skills`/`mcp` 名单 + Tools 的 `tools-global.json`
  （旧文件只读合并）；新写入统一进 `capability-global-overrides.json` 的 `tools`。
- 可见性 `workspaces` 的 key 使用 **workspace path**（不归一化 projectRoot）；运行时按
  `projectRoot 精确 → path 精确 → cwd 最长前缀` 匹配。
- 不可见能力的旧项目/会话显式覆盖保留不删；恢复可见后重新生效。
- 全局视图的能力行不再有行尾默认开关（默认已按工作区配置；行尾只保留可见性标签 +
  「默认：N 开 / M 关」摘要）；工作区视图的默认覆盖开关保留。
- 详情里的可见性只保留一行摘要 +「编辑可见范围」按钮（模式分段与逐工作区配置收进弹层），
  不再内联列出全部工作区；详情面板恢复纵向滚动（`.skp-detail-fixed` 由 overflow:hidden
  改为 overflow-y:auto），长内容（MCP 工具手风琴等）可滚到底。

### 内部（v21）

- 新增 `src/shared/visibility.ts`；`overrides.manager` 的 `capabilityDefaults` /
  `capabilityDefaultsMany` 是列表投影与运行时 gate 的唯一默认计算入口；Tools 的
  `effectiveEnabledFor` 可见性优先。
- 回归：`notes/verify/v21-visibility.mjs` + `v21-visibility-ui.mjs`（本机 gitignore）。

## [1.9.1] - 2026-11-02

### 新增（v20.2 MCP 全局默认）

- **MCP 也支持「全局默认关闭」**（此前只有 Skills 有 B2 全局默认层）：
  - 独立文件 `<dshHome>/dsh-capability-settings/capability-global-overrides.json`
    增加 `mcp: string[]`（运行时注入实例的 `serverName` 名单）；空名单不落盘该字段；
    原子写 + 0600 + 文件锁，读校验与 `skills` 同策略。
  - 优先级 **全局默认 < 工作区显式 < 会话显式**：工作区用项目 overrides 的
    `enabledMcp` 重新打开，会话显式开关仍最高；有效默认
    `(global.mcp ∪ project.mcp) \ project.enabledMcp`。
  - 生效方式：不卸载共享实例、不改注入方配置，按会话 `tools.restrict` 屏蔽
    `mcp__<serverName>__*` 工具 + 同名空文本系统提示词段遮蔽；全局默认写入后调用
    新接口 `loader.refreshRestrictions()` 热应用（不重挂 fiber）。
  - 全局默认**不作用于**项目原生条目（`.mcp.json`）与项目级引用（imports）——它们
    仍只受项目 overrides / 引用自身 `disabled` 控制。配置级硬关闭（`mcp.json` 的
    `disabled`）语义不变。
- 面板「外部注入」组从「只读」改为**配置只读、默认开关可写**：全局视图写全局默认
  名单，工作区视图写本工作区默认（可覆盖全局默认）；行内标签区分「全局默认关闭 /
  已覆盖全局默认 / 工作区默认关闭」，组头按作用域提示写入落点。
- 新宿主模块 `src/shared/mcp-defaults.ts`（三层默认纯计算，面板与 loader 共用）；
  `src/mcp/config-file.ts` 导出 `isMcpServerName`（全局默认写的 key 校验）。
- 设计稿同步：Figma `Capability Panel · MCP 全局默认 v20.2`（page `190:2`：全局视图
  `190:7` / 工作区视图 `190:79` / 优先级与落点规范 `190:153`）。

### 变更（v20.2 MCP 全局默认）

- `overrides.globalGet` 返回值新增 `mcp`；`overrides.globalToggle` 的 `domain` 扩为
  `"skills" | "mcp"`；`overrides.get` 新增 `enabledMcp`。
- `overrides.toggle` 的 `mcp` 域改为 B2 三态：显式 `enabled` 写 `mcp` / `enabledMcp`，
  不传时**翻转有效默认**（旧调用方注意：不再是单纯翻转 `mcp` 成员）。
- `mcp.runtime` 行新增 `disabledGlobally`（原始全局名单成员）与语义扩展后的
  `disabledInProject`（本工作区有效默认关闭）；旧宿主缺省时面板按 feature-detect 回退。
- 外部注入 MCP 详情文案从「只读」改为「配置只读，默认开关可写」，并补
  「全局默认 / 本工作区」状态行；`restrictable=false` 时开关仍置灰并给宿主契约原因。

## [1.9.0] - 2026-11-02

### 新增（v20.1 能力中心）

- **能力面板重构为独立管理台**（与当前对话所在工作区解耦）：
  - 默认进入「全局」；「工作区」从全部已知工作区中显式选择；面板只管理到工作区层级，
    不出现/不修改会话级状态（会话级仍在对话上方「能力」Tab）。
  - 删除左栏「全局 / 项目 + 工作区列表」；列表标题栏写「全局 Skills / HtDot · Skills /
    HtDot · MCP」+ 计数 + `＋ 添加 Skill` / `＋ 添加 MCP`。
  - 添加改为**固定落点**：类型与作用域由当前 Tab × 当前作用域决定，弹窗只填内容并显示
    写入路径；Skills 支持上传/路径/URL，MCP 支持表单 + JSON 粘贴（逐条预览 新增/覆盖）。
  - 详情作用域链只保留「全局 → 工作区」两段；全局视图第二段是「在「工作区」作用域查看 ↗」
    入口，P0 不统计跨工作区覆盖数。
- **Skills 全局默认（B2）**：新增
  `<dshHome>/dsh-capability-settings/capability-global-overrides.json`
  （`{"version":1,"skills":[...]}`，原子写、0600、文件锁）。优先级
  **全局默认 < 工作区显式启用/禁用 < 会话显式开关**；工作区用项目 overrides 的
  `enabledSkills` 重新打开全局关闭的 Skill，会话显式开关仍最高。
- 新增 RPC `overrides.globalGet` / `overrides.globalToggle`；`overrides.toggle` 增加可选
  `enabled`（B2 三态写回）；`skills.list` / `skills.sessionList` 行增加
  `globalDefaultDisabled` / `projectDefaultEnabled` / `projectDefaultDisabled` /
  `effectiveDefaultEnabled` / `canToggleGlobal` / `globalToggleBlockedReason`。
- 新增宿主模块 `src/overrides/global-file.ts`、`src/shared/skill-defaults.ts`（面板列表与
  运行时投影共用同一套有效默认计算）。

### 变更（v20.1 能力中心）

- 面板 api 的 `cwd` 只取面板内选择（`undefined` = 全局），**不再回落到当前会话工作区**；
  composer api 保持跟随会话不变。
- Skills 全局行开关改为写**全局默认**（不再写「本项目禁用」shadow stub）；工作区行改为
  B2 项目启用/禁用；project preset 同层注入（宿主 rank 100）无法被全局 shadow 时，
  行开关禁用并显示 `globalToggleBlockedReason`，`overrides.globalToggle` 逐名报业务失败，
  不把列表当已生效。磁盘 Skills 与其它注入 Skills 均已用真实宿主 `SkillRegistry` 验证可投影。
- MCP 全局行开关走 `mcp.setEnabled({scope:"global"})`；工作区行走项目 overrides；外部注入
  实例无法全局禁用，开关禁用并显示原因；面板不再展示/调用 `mcp.status` 的会话挂载状态。
- Skills 详情移除旧的「在本项目禁用/恢复（shadow stub）」动作，统一由工作区行开关走 B2。
- `overrides.get` 保持旧形状 `{mcp, skills}`（兼容 mcp loader 与旧回归）；完整 B2 项目态
  走新 `overrides.projectSets(cwd)`。

### 修复（v20.1 能力中心）

- 全局视图作用域链第二段改为**先展开工作区下拉**，选中具体工作区后再切换；不再隐式跳到
  最近/第一个工作区，避免用户不知道即将查看哪个工作区。
- 修复作用域链工作区下拉**无法滚动**：列表内部滚动不再触发关闭，最大高度按视口上下空间钳制，
  工作区多时可滚轮选择；下方空间不足时向上展开。
- 修复工作区名很长时列表标题栏「＋ 添加」按钮被挤出/截断：标题拆成「作用域名 + 类型」，
  作用域名可省略号截断（完整名在 tooltip），类型、计数、作用域提示与添加按钮保持固定可见。
- 修复普通注入行（`canToggleGlobal` 缺省 true）被 `readOnly` 误禁用；`canToggleGlobal=false`
  优先返回预设的 `globalToggleBlockedReason`。
- 修复全局 Skills 开关 tooltip 中遗留的「技能」命名（统一 Skills）。
- 旧验证套件随新 IA 更新（旧 mock 补 `overrides.globalGet/globalToggle`；v18 已移除的
  dock/hero 套件 SKIP 并注明；`v13-session-bulk` 冷会话语义对齐 v1.8.0）。

### 验证（v20.1）

- `pnpm typecheck` / `pnpm build` 通过。
- `bash notes/verify/v20-run.sh`：**68/68 PASS**（host 25 / scope 10 / skills 20 / mcp 13），
  关键按钮/开关均用 DOM 真实点击并断言 RPC、真实文件（含 0600）、视图切换与 modal 副作用。
- `bash notes/verify/run-all.sh`：`FAILED_SCRIPTS=0` / `FAILED_SUITES=0`。

### 设计（v20.1）

- Figma：`Capability Panel · 能力中心整改 v20.1`（page `169:2`）；预览
  `docs/figma/preview/v20-01…07-*.png`（含 MCP 表单 / JSON 添加弹窗）。

### 新增

- **派生继承（spawn-time snapshot）**：主对话可下拉选择 `派生继承会话`（默认）/
  `派生继承工作区`，决定之后创建的 subagent / teammate 继承什么：
  - 继承会话 = 创建时把当前会话的显式覆盖（Skills / MCP / Tools）复制到 child 的
    `session-capabilities.json` 记录；继承工作区 = 不复制，child 使用工作区 / 项目默认；
  - 只在 `agent/created` 且 `source === "startup"` 时应用；`resume` 不重新继承，
    已存在的 child 不受影响；父 / 子不同项目根时降级为工作区默认；
  - 会话记录新增 `deriveMode` / `derivedMode` / `derivedFrom` / `derivedAt`；
    新增宿主 RPC `session.deriveGet` / `session.deriveSet`，客户端
    `api.derive.get/set`；
  - UI：首屏行「标准模式」旁与「本会话能力」工具行右端各一个下拉；派生会话页
    只读展示创建时的模式并显示快照说明；
  - 新增宿主模块 `src/derive/manager.ts`（在 skills / mcp / tools 的
    `agent/created` 监听器之前写快照，保证 child 首轮前生效）。
- Figma：新增页面 `Capability Panel · 派生继承 v19`（`158:13728`），含首屏默认 /
  下拉 / 继承工作区、能力页两种模式、派生会话页与控件状态板；预览图
  `docs/figma/preview/v19-*.png`。

### 文档

- 新增 `docs/architecture/capability-packs.md`：「能力套装（Capability Pack）」设计提案
  （v4）。套装 = 一组能力的具名分组，`{id, title, description, members[]}`，
  members 是 skill / mcp / tool（将来 prompt）的引用；**不持有会话状态**。要点：
  - **两种来源同一概念**：`derived`（一个插件带来的整组能力，按
    `src/shared/plugin-attribution.ts` 的三域同口径归因自动聚合，不落盘、随安装/卸载
    出现与消失）+ `user`（用户手配，存
    `~/.dsh/dsh-capability-settings/capability-packs.json`；另有 `hiddenDerived` 隐藏项）；
  - 勾套装 = 逐个打开成员（additive，不动非成员）；取消 = 逐个关闭；成员可多归属，
    勾多个套装 = 并集；会话里仍只记录成员自己的显式开关；
  - 对 Jev 是一等候选单元（`kind:"pack"`）：被单一套装覆盖的成员折叠、多归属成员保留，
    `dsh-to-figma` 由 3 条候选降为 1 条；客户端把勾选的 pack 展开成成员 id 后提交，
    宿主 `jev.apply` 零改动；
  - 归因是启发式的，漏网能力进「未归组」桶作为可见兜底；不可开关成员（agent 作用域
    注入的 MCP）整组开关时跳过并提示；
  - 硬不变量：pack 的 `title`/`description` 只进面板 UI 与 `jev.rank` 请求体，
    不进 system prompt / 工具描述 / skills 列表，因此不触发 model-visible ⟺ logged；
  - 含外部先例对照（Claude Code plugin / Codex profile / Gemini extension / Goose recipe /
    Roo custom mode / Continue assistant / Cline workflow）与分期拆分。
- 新增 `docs/architecture/mcp-resource-suppression.md`：记录「MCP 关闭后资源清单与
  资源工具残留」的完整拆解——四条能力通道、宿主 0.2.1-rc.3 源码依据（`dsh-mcp-resources`
  `layers.merge(scope)`/`request()`、`dsh-scope` 并集无删除、system-prompt scoped
  shadow 契约）、v1.7.2 的缓解实现与文本耦合代价、剩余工具层残留、上游
  [discussion #11562](https://github.com/deepseek-ai/deepseek-harness/discussions/11562)
  与退出条件；README / AGENTS.md 的残留说明链到该文件。

### 验证

- `pnpm typecheck`、`pnpm build` 通过；
- 宿主机理（`lib/session-state.js` + `lib/derive/manager.js`，假 `agent/created`）
  验证：继承会话复制三域显式覆盖；`resume` 不重放；继承工作区只写派生元数据、
  不复制；跨项目根因父 cwd 不可得时按工作区语义处理；
- `bash notes/verify/run-all.sh`：派生继承相关类型/构建/加载器/归属/Jev 服务端
  套件通过；`capability-dock-render`、`client-panel`、`client-hero` 仍有**历史遗留**
  失败（测试仍引用已移除的 `CapabilityBar` / `ComposerCapabilityHero` 与
  `.skp-dock-bar` 类，非本次改动引入），待单独清理测试基线。

## [1.7.2] - 2026-10-30

### 修复

- **MCP 资源服务器清单仍列出已关闭的 server 名**（1.7.1 的残留）：宿主
  `dsh-mcp-resources` 的 `mcp-resource-servers` 段（`## MCP resource servers` +
  段尾 JSON 名单）由资源 provider 注册表现算，`tools.restrict` 与
  `mcp:<serverName>` 指令段影子都影响不到它——「当前对话」关掉 server 后，
  它的名字仍出现在模型看到的资源服务器清单里。
  修复：`src/mcp/loader.ts` 为每个会话挂一个 `system-prompt/assemble` 装配钩子
  （`installResourceListFilter`），只对名为 `mcp-resource-servers` 的段做最小
  文本手术（`filterResourceListNames`）：解析段尾 `server argument: [...]` JSON
  名单 → 剔除命中的**字符串** serverName（非字符串项原样保留，防宿主未来扩展
  名单结构）→ 用原前后缀拼回（保持顺序）。边界：
  - **不整段删除**：全部被剔除时保留段、名单写作 `[]`（明确告知没有可用资源
    服务器）；其它段（含 `mcp:<serverName>` 指令段）一律不动；
  - **fail-open**：正则/JSON/数组形状不符时原样返回，宿主改文案只会退化为
    「名单不隐藏」，绝不影响装配；
  - 隐藏名单与指令段影子同源（每代 `applyPromptShadows` 重算），但**不要求**
    root 侧证据：名字出现在宿主清单里就说明有 resource provider；
  - 宿主 ctx 不支持 `on` / 注册抛错 → 一次性 warning + 降级，不拖垮 session
    挂载；监听器每会话仅注册一次、随 agent ctx 释放。
  剩余残留：三个资源工具（`list_mcp_resources` / `list_mcp_resource_templates`
  / `read_mcp_resource`）仍能访问被关 server 的 resources（宿主无按名字移除
  provider 的 API；需要上游支持）。

### 验证

- 真实运行版 DSH 0.2.1-rc.3（app.asar 内的 `dsh-system-prompt` + `cordis` +
  `dsh-scope`）实测：scoped ctx 注册 `system-prompt/assemble` 钩子后，本会话
  清单从 `["AnySearch","Serena","deepwiki"]` 过滤为
  `["AnySearch","deepwiki"]`、另一会话不变、`mcp:*` 段不受影响、全剔时为
  `[]`、非法 JSON fail-open；钩子 dispose 后恢复；
- 独立 harness（假 ctx 模拟 waterfall）48/48 PASS：部分剔除、本会话 mounted 同名
  不剔除（即使它也是 restrict target）、全剔时 `[]` 且段保留、fail-open
  （正则不匹配/非法 JSON/非数组/text 非 string/缺段均返回原引用）、只改
  `mcp-resource-servers` 段（含同样锚点的干扰段对象引用不变）、宿主 `on` 缺失/
  抛错时恰好 1 条 warning 且不拖垮挂载、同步/Promise 两种 `next()` 形态、
  动态开关与 session 隔离、每会话恰好 1 个 listener（remount 不重复注册）；
  负向对照 5/5 变异可检出（漏过滤/丢失挂载排除/整段删除/fail-closed/挂错作用域）；
- 旧基准 `loader-behavior` 81/81、`prompt-shadow` 68/68 不回归
  （`prompt-shadow` 的 S6-1 断言随 1.7.1 的"静默重试 + 单次 warning"实现同步调整）。

## [1.7.1] - 2026-10-30

### 修复

- **当前对话关掉 MCP 后，服务器指令仍进入系统提示词**（用户反馈：能力插件
  只过滤了 MCP，但 MCP 的 prompt 还会出现在系统提示词里）：根因是「关闭」只调
  `tools.restrict({ deny })` 过滤**工具表**，而宿主 `@deepseek-ai/dsh-mcp-client`
  的 `registerServerContext()` 还会把每个 server 的 `instructions` 注册成系统
  提示词段（`name: "mcp:<serverName>"`、`order =
  getSectionOrder("MCP_SERVERS")`；全局实例挂在插件 ctx ⇒ 全局作用域）。
  于是被本项目 / 本会话关掉的**全局或外部注入** server，整段指令仍随系统提示词
  发给模型（占 token，也可能把 `instructions` 里的行为要求带进来）。
  修复：`src/mcp/loader.ts` 新增 `applyPromptShadows`——按既有 `restrictTargets`
  在同一 `agent.ctx.get("systemPrompt")` 上注册**同名、空文本**的 scoped 段，
  依据宿主契约「A scoped section shadows a global section with the same name」
  让本会话装配取到空文本、渲染阶段丢弃；重新启用 / 换代时 dispose 恢复。
  与 restrict 同源同生命周期（`remount` 内换代前 dispose、挂载后重算；
  `remountGlobal` 完成后与 `tools/change` 时 `refreshPromptShadows` 增量收敛
  "证据后到"的条目：已生效跳过、失效释放、失败静默重试且同一失败只警告一次，
  不会在每次刷新时全量重建或刷屏）。边界与降级：
  - **本会话自己挂载的项目层同名 server 不遮蔽**（桥接层会在同一 agent 作用域
    注册同名段，重复注册会抛 `prompt section ... is already registered in this
    scope`，可能拖垮该 server 挂载）→ 按本代实际挂载的 `serverName` 排除；
  - **只遮蔽「确定挂在 root 侧」的 server**（本插件 `globalMounts` 条目，或全局
    工具注册表里能按 `mcp__<serverName>__*` 认出来的外部注入实例，与面板
    `restrictable` 同一判据）；认不出来的名字可能是按会话注入的实例，影子段会
    和它的同名段抢注册 → 跳过（与 `tools.restrict` 对这类实例无能为力一致）；
  - 外部按会话注入实例已占用同名段 → 逐条 catch + warning，不影响其它条目；
  - 宿主没有 `systemPrompt.section`（headless / 旧装配）→ 整组降级为一次性
    warning，绝不抛穿到 session 挂载；
  - 残留说明（实测确认，详见验证）：`dsh-mcp-resources` 的
    `mcp-resource-servers` 段（服务器名清单）不归本插件所有，仍会列出被关掉的
    server 名；更实质的是三个资源工具（`list_mcp_resources` /
    `list_mcp_resource_templates` / `read_mcp_resource`）仍能列出/读取被关
    server 的 resources（宿主没有按名字移除 provider 的 API；整段 shadow 会连
    保留的 server 一起从清单消失，重写文本依赖宿主内部格式）。彻底解决需上游
    `dsh-mcp-resources` 支持按作用域抑制或从受限工具视图派生清单。

### 验证

- `pnpm typecheck`、`pnpm build` 通过；
- 用桌面应用 `app.asar` 内**运行版** DSH **0.2.1-rc.3** 的
  `dsh-system-prompt@0.2.1-rc.3` + `dsh-scope@0.2.1-rc.3` + `cordis@4.0.5` 实测
  （独立验证者脚本，T1 13/13 断言 PASS）：root 注册 `mcp:demo` 后，在 agent
  scope 注册同名空文本段 → 该 scope 装配 `mcp:demo` 文本为空、`renderPrompt`
  不含指令；另一 scope 与 root 不受影响；dispose 后恢复且幂等；并验证了
  cordis traceable 服务（`this.ctx` = 调用方 ctx）这一前提；
- 同作用域同名重复注册抛 `prompt section "mcp:demo" is already registered in
  this scope`（跨作用域不冲突）——据此保留「先 dispose 影子 → 挂项目层 → 再补
  影子」的换代顺序；
- 版本漂移取证：`0.1.2-alpha.2` 的 `SECTION_ORDERS` 无 `MCP_SERVERS`、
  `0.1.0-rc.6` 连 `getSectionOrder` 都没有（宿主兜底常量与 try/catch 必需）；
  旧版 mcp-client 不注册 `mcp:*` 段，故影子只对宿主 ≥0.2.x 有意义；
- 假 ctx 驱动的独立 harness 68/68 断言 PASS（`notes/verify/prompt-shadow*.mjs`，
  不入库）：关闭 → 影子段注册/复原、项目层挂载不遮蔽、无 systemPrompt 降级、
  部分禁用只遮蔽被禁用项、root 侧证据不足跳过、`remountGlobal`/`tools/change`
  收敛（含"全程无重复注册尝试"负向控制）；
- 旧 `status()` / 挂载行为基准 `notes/verify/loader-behavior.mjs` 81/81 通过，
  不回归。

## [1.7.0] - 2026-10-30

### 变更

- **首屏能力入口从输入框工具行迁到首屏行右端**（`conversation.hero.options`）：
  入口与 workspace chip /「标准模式」同族——24px 高、12px 字号、无外底 / 边框 /
  分隔线，hover 才出单项浅底（`rgba(255,255,255,.06)` + 圆角 6），focus-visible
  2px 主色环；首屏行保持 26px、不再被入口撑高。该槽由外壳固定右对齐、`occupants`
  为空，`standardProps` 与旧槽同款（`useInput` / `inputActions` / `sessionId`），
  组件逻辑不变。实现：`src/client.ts` 槽注册 + `src/client/styles.ts` 的
  `.skp-dock-entry*`。
- **三域图标换成 E 套（内联 SVG，无新依赖）**：Skills = Lucide `book-open`（ISC）、
  MCP = Simple Icons 官方标（CC0）、Tools = Lucide `wrench`（ISC）；24 viewBox、
  12px 渲染、stroke 2.2（约 1.1px），与邻居线性图标同档。交互不变：点计数项 →
  对应 Tab 的配置弹窗，`✦` → 能力决策，滑杆 → 配置弹窗。

### 内部

- 首屏入口的 `HeroSlotProps` 注释同步为 `conversation.hero.options` 契约；active
  相位入口随首屏行整行卸载（与旧实现「active 不渲染入口」等价）。
- 验证：`pnpm typecheck`、`pnpm build` 通过，构建产物已核对注册槽名 / 入口样式 /
  三域图标 path；Figma 基线 `v18`（3 帧预览 `docs/figma/preview/v18-*.png`）。
  真机 GUI 验收需在隔离 `DSH_HOME` 或重装 profile 后补跑（首屏行入口 / hover /
  弹窗 / 首条消息后入口消失）。

## [1.6.1] - 2026-10-30

### 修复

- **能力决策「应用所选」要卡 5–10 秒**（用户反馈：点「应用所选」后「应用中…」
  至少 5 秒；认为只是记录筛选、不该有大计算）：根因是**筛选语义一次要把约 150 条
  技能的会话开关全部落地**，而旧实现逐条 `skills.setSessionEnabled`，每条都会
  ① `prepareShadow` 做 2 次宿主 skill catalog 全量发现、② `skills.register` 让宿主
  `collectCache` 整体失效、③ `verifyShadow` 再做 1 次全量发现、④ 一次
  `session-capabilities.json` 读改写。本机 145 个 SKILL.md 时单次全量发现实测
  ≈22ms，145×3 ≈ 435 次 ≈ 9.5s（用户侧 5–10s 即此）。现在新增宿主批量能力：
  `skills.setEnabledBatch`（整批 **1 次目录发现 + 1 次落盘**，read-after 用一次
  快照校验整批；ghost shadow / 同层 runtime 冲突仍判真假成功）、
  `skills.registry.prepareShadows / verifyShadows` 批量桥；`jev.apply` 的 live 路径
  按阶段走批量：skills 批量端点、MCP `setSessionEnabledMany`（一次落盘 + 一次重挂）、
  Tools 分组写；失败回滚同样批量；冷会话激活路径保留逐条 + 就绪重试语义。
  独立基准（真实编译产物 + fake 宿主，150 skills / 勾 8 / 写 142 条，目录发现
  20ms 每次）：apply **9785.7ms → 73.3ms**、目录发现 **426 → 3 次**、落盘
  **142 次 setSkill → 1 次 setToggles（142 键）**，结果逐项一致（applied=142 /
  disabled=142 / skipped=8）；失败回滚 **13531.5ms → 142.6ms**（发现 566 → 6、
  落盘 282 → 2），回滚终态与基线逐键一致。另：apply 总耗时 ≥800ms 时 warn 一次并
  带「枚举 / 写入」耗时分解，便于后续定位。验证：host-apply 122/122、
  session-skills 11/11、session-state 8/8、session-restore 2/2；既有客户端套件
  的失败为本次改动前 v14 重构遗留的陈旧断言（`src/client/**` 本次零改动）。

### 变更

- **Tools 写入改为阶段级分组批量**：`jev.apply` 的 Tools 写入从「每 unit 一次
  调用」改为「同一阶段（启用 / 关闭）合并为一次
  `tools.setSessionEnabled({units})`」。宿主该端点是阶段级原子（任一条校验失败 →
  整批 `ok:false`，不产生部分写入），因此单条 unit 失败时该阶段全部 Tools 项按
  失败处理、并回滚其它域已写项；`JevApplyResult.failed` 仍只报一个失败 id（此时
  为该阶段稳定排序后的第一个失败项，不再保证是"触发失败的那条 unit"）。最终状态
  与旧实现一致（旧实现失败时同样整批回滚）。

### 内部

- **`skills/session.ts` 新增批量会话开关原语 `setEnabledBatch`**：
  `{sessionId, entries:[{name, enabled}]}` → `{ok, errors, outcomes:[{name, ok,
  errors?}]}`；单条失败不影响其它条目；`enabled: undefined` = 清除显式覆盖（回项目
  默认），语义与单条 `setEnabled` 一致。单条路径抽出 `registerShadowCore` /
  `releaseShadowCore` 纯簿记核心（无目录发现）供批量复用；仅对**本次新建**的
  shadow 做 read-after（与单条幂等短路一致），校验失败按项回滚并恢复 `explicit`
  前态；批量落盘用一次 `state.setToggles`（含 `undefined` 键清除）；旧装配
  （无 registry / 无批量端点）保持逐条路径，单条返回形状与旧实现一致。
- **`skills/registry.ts` 新增 `prepareShadows / verifyShadows` 批量桥**：整批共用
  一次（prepare 为 global + scoped 两次）`skills.snapshot()`，返回本批注入元数据与
  ghost shadow 集合 / 整批胜者映射；单条 `prepareShadow / verifyShadow` 改为其
  单名封装，行为不变。
- **`session.setBulk` 的 skills 域改用批量端点**：能力面板「全部开启 / 全部关闭 /
  恢复默认」写 150 条技能时同样从 O(N²) 目录发现降为一次；三域（skills / mcp /
  tools）现在都是「一次落盘 + 一次重算 / 重挂」。
- **MCP 批量会话开关暴露到 manager**：新增 `mcp.setSessionEnabledMany`（转发
  loader 的批量实现），供 `jev.apply` 的 MCP 阶段使用。
- **本地验证夹具更新**：`notes/verify/v13-jev-tools.mjs` 的 Tools fake 改为批量
  语义（units 数组 / 阶段级原子），J-04/J-05/J-06 断言同步分组写入契约（J-06 改为
  验证「失败批零部分写入 + 同阶段 skills 按前态回滚」）。

## [1.6.0] - 2026-10-30

### 变更

- **首屏能力入口改为工具行 icon + 计数，默认收起**：入口从「输入框下方独立能力条 /
  默认展开的内联面板」迁到 `conversation.input.left`（输入框底部工具行里
  `工作区内修改` 之后的预留位）。收起态只显示三枚**扁平单色 icon + 已启用数**
  （书 = Skills、插头 = MCP、工具箱 = Tools）+ 分隔线 + `✦ 能力决策` + 滑杆「配置」；
  icon 数字只显示已启用数，hover tooltip 显示 `已启用 / 总数`。不再有「点击整条 →
  内联下拉展开」的旧交互，也不再单独占输入框下方一条。active 相位不渲染入口。
- **入口三域 icon 点击落到对应 Tab**：点书/插头/工具箱任一 icon，弹窗直接打开
  Skills / MCP / Tools 对应 Tab（不再总是 Skills）；滑杆「配置」沿用上次停留的 Tab。
- **Jev 自动评分缺少密钥时显式提示**：当「输入停顿后自动评分」已开启、但当前没有
  可用 API Key（文件与 `apiKeyEnv` 环境变量都没有）时，Jev 设置页在开关下方显示
  红色提示「自动评分不会触发」——避免"开关已开但首屏不自动选择"的误解；补齐密钥
  并保存后即恢复自动触发。
- **配置改为居中弹窗（背景模糊）**：点击计数区或「配置」打开 `1120px` 居中弹窗，
  `55%` 深色遮罩 + `10px` backdrop blur；Esc / 点遮罩 / ✕ / 完成关闭，Tab 焦点
  圈定在弹窗内，打开时焦点移到关闭按钮、关闭后回到「配置」。弹窗内复用能力面板
  （三 Tab / 搜索 / 行 3 批量控制 / 恢复默认 / 派生继承语义不变），网格可视区域
  从旧内联面板的 2 行扩大到 4 列多行滚动。
- **`✦ 能力决策` 入口保留在工具行入口内**：手动触发仍不依赖自动触发开关；结果面板
  仍在输入卡下方 fixed 出现（v13 帧 08 行为不变）。未配置 Jev 时点击引导到
  「Jev 模型」Tab；草稿为空 / 能力未就绪时置灰。
- **Figma 新增 `Capability Dock · 首屏入口 v14` 页**（4 帧：默认收起 / Skills 弹窗 /
  Tools 弹窗 / 全部关闭），预览图在 `docs/figma/preview/v14-*`；可重导入 scene JSON
  已保存到 `docs/figma/scenes/v14-01..04*.scene.json`（97 / 283 / 205 / 97 节点，
  VECTOR 图标需重画，见 docs/figma/README.md）；旧 v13 页保留。

### 修复

- **MCP 凭据可能随能力描述外发（安全）**：`summarizeEntry` 原样拼接 `args`，本机
  实测 `--header "Authorization: Bearer as_sk_…"` / `--api-key ctx7sk-…` 会进入
  摘要，并被 `jev.rank` 当作能力描述原样发给第三方 Jev API（`collectJevSecrets`
  只处理错误文本，不处理请求体）。新增 `src/shared/descriptor-text.ts`：按参数
  边界掩码敏感 flag 的值（`--header` / `--api-key` / `-H` …），并兜底
  Bearer / Basic / `KEY=value` / URL query / 常见 token 前缀；`summarizeEntry`、
  MCP 详情的参数/URL 展示、Jev 请求体（最终防线）统一走它。
- **Tools 归属被"工具注册拦截器"劫持（真 bug）**：能力面板把 28 个别家插件的工具
  （`rw_*` / `dsh_im_*` / `figma_*` / `diff_approval_annotate` / `open_in_popout`）
  全判给 `dsh-context` —— 本机 `dsh-context` 为标注自己的工具来源包装了宿主
  `tools.register`，而旧 T0 取「`tools/change` 监听器栈里第一个第三方帧」，命中的
  正是这层包装（`dsh-context` 自身 0 个工具）。后果不止显示错：该单元开关会把
  28 个真实工具一起 `tools.restrict({ deny })`。
  现在 T0 改为**调用方身份优先**：`internal/get` 里 cordis 在服务解析点创建的
  `Error` 栈第一帧即访问方插件（配 `ctx.fiber.name`），`tools/change` 的差集与
  它配对；身份过期才退回注册栈兜底，且兜底改取**最后一个**第三方帧（最靠近真实
  调用方）+ 跳过交叉校验识别出的拦截器包（`medium`，UI 标「推测」）。
  同时修掉三个放大器：`mcp__*` 不再写工具归属/派生命名空间（只认身份信号）、
  删除"差集为空 → 把上一批工具整批重归当前注册方"、缓存 v1→v2 迁移只保留包扫描
  结果（v1 被污染的 `runtime` 一律丢弃）。新增「包根 realpath → 包 id」映射，
  覆盖 `link:`/`@local/*` 插件帧（真实路径不含 `node_modules` 时不再掉「未识别」）。
- **插件工具归属漏真实工具名 / 新插件需要改表**：改为四层自动发现——T0 运行时
  注册栈（主）、T1 插件包字面量唯一命中（冷启动回填）、T2 MCP 命名空间自动映射、
  T3 名字相似度（仅兜底，标「推测」）；原 `TOOL_RULES` 降为人工兜底/降级锚。
  `figma_*`、`diff_approval_annotate` 等真实工具名现在自动归到对应插件，不再落
  「来源未识别」；未知仍不猜（T5）。
- **Skills 项目默认关闭没有投影到会话（真 bug）**：能力面板里「本项目默认关闭」的
  全局 Skills（项目区有屏蔽占位 / shadow stub）在对话首屏仍显示为启用——会话
  `list()` 用 runtime shadow 判断，漏掉了磁盘层的 stub 遮蔽。现在：
  - 被本项目屏蔽占位关闭的全局磁盘技能，会话默认 `enabledInSession=false`
    （新会话首屏默认关，与能力面板一致）；显式会话覆盖优先（`true` / `false` /
    清除覆盖三态，会话内仍可临时开启）；
  - 被项目副本遮蔽的全局重复行从**会话视图**过滤（同名只保留项目副本行），
    首屏 / Jev 不再出现同名两行，也不会把被遮蔽的全局行误报为启用；
  - UI：全局行标签「本项目已禁用」→「本项目默认关闭」，「全局」作用域顶部注明
    `启停仅作用于当前项目 · 其它项目不受影响`。
- **插件工具归属漏真实工具名（Tools 出现「来源未识别」）**：补 `figma_*` →
  `dsh-to-figma`（desktop `dsh-to-figma` 0.2.3 起直接注册，无 `mcp__` 前缀）、
  `diff_approval_annotate` → `dsh-diff-approval`（实际工具名是下划线形式，不是
  包名前缀）；宿主内建排除清单补 `create_worktree` / `list_mcp_resources` /
  `list_mcp_resource_templates` / `read_mcp_resource`（不再进 Tools、不再显示
  「来源未识别」）。`mcp__*` 恒归 MCP 的优先级不变。
- **Tools 面板去重与「本会话覆盖」标识**：能力面板 Tools 详情删除重复的「默认
  开关 / 状态」行（开关只在左侧列表行出现一次）；对话首屏 Tools 卡片在该插件
  存在本会话显式覆盖时显示 `本会话覆盖` 小标签（悬停说明全局默认值与本次覆盖），
  用于解释「能力面板显示全局默认关、本会话却开着」。
- **MCP「插件自注册的 MCP 命名空间」来源不可识别**：插件直接
  `ctx.tools.register(createMcpToolDefinition(...))` 注册 `mcp__<ns>__*` 时没有
  mcp-client 实例，`mcp.runtime` 原先只能把它当「无来源外部行」——本机 `figma`
  因此显示 `外部`、详情写「来源不可识别」。现在新增第三条发现路径
  `scanInjectedMcpNamespaces`（全局工具视图里 `mcp__<ns>__*` 无实例 → 合成
  `origin:"namespace"` + `synthesized:true`、无配置），来源走映射表归一
  （`figma` → `dsh-to-figma`），列表行与详情显示「插件 + 插件名」两枚标签；
  未命中映射表的命名空间标「未识别」（不猜成宿主内置）。真实例（fiber / loader
  条目）优先，命名空间行不覆盖已有实例；工具注册表反推的兜底行也改为
  `origin:"namespace"`（原先写死 `"fiber"`，来源语义是错的）。
- **会话能力卡片来源标签被截断**：注入技能卡片底部的渠道名原先受
  `.skp-dock-tag-channel` 的固定 `max-width:92px` 限制，`DSH 内置（Office）`
  （实测 105px）、`DSH 内置（随包技能目录）`（128px）、`dsh-diff-approval`
  （107px）都被截成 `DSH 内置（Offi…` / `dsh-diff-appro…`，来源读不全。
  现在渠道名改为按内容自适应宽度（`flex:0 1 auto; min-width:0; max-width:100%`，
  上限 = 卡片可用宽度）；`.skp-dock-card-foot` 允许换行（`flex-wrap:wrap`），
  窄卡片上渠道名整块掉到第二行显示全文，只有极窄容器才收缩 + 省略。完整渠道名
  同时写进标签 `title`（悬停可读）。与 Figma v12 基线一致（设计稿标签宽度按文本
  自适应，代码的 92px 单行上限是偏差）。
- **「当前对话」能力开关重启后不保持**：Skills / MCP 的会话级开关原先只有内存态
  （`loader.sessionToggles` / `skills/session.ts` 的 `explicit`），宿主重启 / agent
  重建后回到项目默认，用户看到的行为与重启前不一致（`README` 原文也写着
  「重启后会话覆盖即失效」）。现在按 sessionId 落盘：
  - MCP：`remount` 前 hydrate `sessionToggles`，项目条目挂载 / `tools.restrict`
    名单与重启前一致；
  - Skills：`applyProjectDefaults` 与 `sessionList` 前 hydrate `explicit`，重新注册
    同名 runtime shadow（磁盘技能 + 注入技能都覆盖；已删除技能的覆盖会被清理，
    不造幽灵 shadow）。
- 写入失败（磁盘只读 / 权限）只记 warning，本次运行内仍生效，不向 RPC 报错误导 UI。

### 新增

- **Jev 能力描述层（MCP / 插件）**：新增 `src/jev/descriptors.ts` 与
  `src/shared/descriptor-text.ts`，把「给模型判断用」的描述从原始配置里解耦：
  - **MCP**：作者手填 `description` 优先；缺省从 `command/args/url` 推导
    （远程 host / npm 包名 / 脚本名 / 命令名），外部注入实例用注入方名字 +
    summary 推导；**不再把原始命令行当描述**，也不再依赖「已挂载工具」才有语义。
  - **MCP 配置扩展字段 `description`**：编辑弹窗新增「用途描述（可选，供 Jev
    能力判断）」，详情页展示；随条目落盘，不写项目级声明文件。
  - **Tools 插件单元**：从插件 `package.json.description` 生成描述（归属扫描
    读包元数据，源码扫描超时也能拿到）；`tools.list.units[].description`
    additive，读不到时回退旧的「N 个工具 · 插件注入」。
  - **工具清单扩容**：`tools` 仍为 8 条带描述（描述上限 120 码点），新增
    `moreTools`（最多 24 个仅名称，总 600 码点）覆盖大插件/大 server；guidance
    说明 `moreTools` 与「无工具时按描述判断」。
  - **全局预算**：请求体超过 150k 字符时按 4 档降级（先减 `moreTools`，再丢
    工具清单，最后完全不带工具），避免能力数增长后撞 64k 上下文。
  - 本地回归：`notes/verify/jev-descriptor-pipeline.mjs`（脱敏/推导/打包/贯通）、
    `notes/verify/jev-request-sample.mjs`（真实数据采样请求）。
- **工具归属自动发现（T0–T4）**：新增 `src/tools/attribution/**`（unit-id /
  migrate / runtime / scan / cache / resolver）。T0 独立监听 `tools/change` 抓注册
  栈（`stackTraceLimit=48`，连续 3 次失败自动禁用）；T1 包扫描只读字面量（限额 +
  超时 + 让出事件循环）；T2 `mcp__<ns>__` 命名空间；T3 相似度 ≥0.5 且 margin ≥0.3；
  T4 人工表兜底。`tools.list.units[].attribution` additive 增
  `confidence/conflictsWithTable/ambiguous/mixed/legacyUnit`，`matchedBy` 扩为
  `runtime|literal|namespace|table|similarity`（旧值保留）；`tools.list` 增
  `attributionSettling`。
- **归属扫描缓存 `tool-attribution.json` v1**：`{version,generatedAt,hostVersion,
  selfPackage,packages{version,mtimeMs,literals,namespaceHints},runtime,failures}`；
  包名+version+mtime+宿主版本失效；T0 增量 2s debounce；原子写 + 文件锁 + 锁内合并
  + 进程内串行；损坏/未知 version → 空缓存 + warn + 后台重建；不存绝对路径。
- **`enableAutoAttribution` 配置开关**（缺省 on）：false = 纯人工表行为（不挂
  监听、不扫描、不写缓存）。
- **unit id 迁移**：unit = 归一化完整包名（含 scope）；`dsh-im →
  @xmanrui/dsh-im`、`dsh-popout-window → @local/dsh-popout-window`（其余 5 个不变，
  展示名全部不变）；读时别名归一 + 一次性锁内写回 + **旧键镜像双写**（可回滚，
  保留到下一 minor）+ 未知键原样保留；两文件（tools-global.json、
  session-capabilities.json 的 tools 域）独立、幂等、崩溃可续。
- **第三个能力域 Tools（插件级开关）**：新增宿主 `src/tools/{types,manager,restrict}.ts`
  与归属单一事实源 `src/shared/plugin-attribution.ts`。枚举源唯一 =
  `ctx.root.get("tools").schemas()`（全局视图，天然只含可继承层）；按序归类：
  `mcp__*` 恒归 **MCP 域**、宿主内建工具**不入任何域**（排除清单在插件侧自维护，
  因为宿主 `ToolSchema` 无来源/危险等级字段）、命中插件映射表 → Tools 插件单元、
  其余合并成唯一「来源未识别」单元（`unit = "__unattributed__"`）。
  - **一个插件 = 一个开关单元**（无单工具开关）：关闭 = 在该 agent 作用域
    `tools.restrict({ deny: 该插件当前全部可继承工具名 })`；deny 名**每次重算**，
    持久化只存 `plugin:<unit>`（插件升级增减工具后自动跟随）；
  - 幂等：名单与上一代等价时直接返回（`tools.restrict` 自身也会触发
    `tools/change`，这条短路是刷新不形成循环的关键）；监听 `tools/change`
    微任务合并后重算，懒加载后才注册的工具因此不会漏网；
  - 降级：agent 作用域没有 `restrict`（旧外壳）→ `tools.list` 提前给
    `lockedReason`、开关置灰；名单为空（工具尚未注册）→ 不调用 restrict、
    状态记 `skipped`；restrict 抛错 → 状态 `failed` + warning，不影响其它开关。
  - **枚举不到就不显示**：注册在 agent 自身层的插件工具不可 restrict、也无法从
    全局视图枚举，因此**不出现**在 Tools 域（不是显示后置灰）——这是相对早期
    UX 稿的规格修正。
- **RPC `tools.list` / `tools.setSessionEnabled`**：`tools.list` 返回 `units`
  （`unit/name/kind/tools/toolCount/attribution/defaultEnabled/enabled/
  enabledInSession/explicit/lockedReason/restriction`）+ 诊断字段
  `totalGlobalTools` / `excludedBuiltinCount` / `errors`——`defaultEnabled` 是
  全局默认、`enabled` 是本会话生效值（= 会话覆盖 ?? 全局默认）、
  `enabledInSession` 为恒等 legacy 别名；`tools.setSessionEnabled` **batch-first**
  （单条 = 长度 1 的数组），入参只接受**单元 id**、宿主自己重算工具名（客户端无法
  注入任意 deny 名单），`enabled: true|false|undefined` 分别表示写显式开 /
  显式关 / 清除覆盖。`tools` 服务缺失或 `schemas()` 失败时返回空列表 + `errors`，
  不阻断另两域。
- **RPC `tools.setGlobalEnabled`（全局默认）**：`{units: string[], enabled: boolean}`
  → `{ok:true, applied}` / `{ok:false, errors}`；写 `tools-global.json` 后
  **异步扇出**到全部 live agent（微任务 + 每会话串行队列，不阻塞写 RPC），新 agent
  在 `agent/created` 按生效值应用。只接受当前枚举出的单元 id，兼容裸 unit 与
  `plugin:<unit>` 写法。
- **RPC `tools.inspect`（懒加载工具 schema）**：入参 `{unit, sessionId?}`；成功
  value = `{unit, tools:[{name, description?, parameters?}]}`（**成功支无 `ok`
  字段**），业务失败 `{ok:false, errors}`。`parameters` 取宿主 `schemas()` 原文
  **不裁剪**，`description` 也是完整值（不按 list 的 200 码点截断）；复用
  `tools.list` 同一份枚举/归属逻辑（不二次扫描、不漂移），仅在详情选中插件时调用。
- **Tools 全局默认存储 `tools-global.json`**：`<dshHome>/dsh-capability-settings/
  tools-global.json` = `{"version":1,"disabled":["<unit>",…]}`（缺省 / 缺失 =
  全部启用）；目录 `700` / 文件 `600`、原子写 + 文件锁；损坏 / 未知 version →
  warn + 按全部启用降级；写入失败只 warn（本次运行内仍生效）；已卸载插件的残留
  unit 读取时忽略、不删用户数据。
- **R1 批量端点 `session.setBulk`**：`{sessionId, action:"enable"|"disable"|"reset",
  domains?, cwd?, dryRun?}`，宿主自己枚举目标（不信客户端列表）：
  - 幂等（同一 action 重放 → `applied:0` + `unchanged:N`）、**同会话串行**（排队
    而非拒绝，不同会话互不影响）、**部分失败不回滚**（失败项进
    `failed[{domain,target,kind,error}]`，已成功项保留；重试 = 重放同一 action）；
  - 返回 `applied/unchanged/skipped/failed/byDomain` + `coldSession?` + `elapsedMs`；
  - 写盘批量化：mcp / tools 各一次落盘（`state.setToggles`）+ restrict 只重算一次；
    skills 逐条（shadow 注册本来就必须逐条，但同一 tick 全部发起）；
  - mcp 域新增内部方法 `loader.setSessionEnabledMany`：一次 hydrate → 写全部
    toggle → **一次**重挂（逐条调用会排队 N 次重挂）；「全部开启」对 MCP 写**显式
    true**（不是清覆盖，否则会被项目默认重新关掉）；
  - 冷会话：skills 项记 `skipped`（`setEnabled` 需要 live agent），mcp / tools 仍
    落盘并返回 `coldSession:true`。
- **会话首屏行 3「本会话控制条」**：`全部开启` / `全部关闭` + `已启用 n / m` +
  `仅当前会话 · 不改项目默认`；**无二次确认**、无提醒条；全开 / 全关时对应按钮禁用；
  执行中按域串行调用 `session.setBulk` 并显示域级进度（`正在关闭 2 / 3 个域…`，
  不再有逐条进度）；部分失败显示 `n 项失败 · 重试`，点重试只重放失败所在域。
  底栏「恢复默认」也改走 `session.setBulk({action:"reset"})`（只清显式会话覆盖，
  不动项目默认）。
- **MCP 来源两枚标签（R4 客户端）**：外部行按三态渲染——有插件展示名 → `插件` +
  插件名（第二枚等宽小标签、悬停全名）；命名空间合成且无映射 → `未识别`（琥珀）；
  其余 → `外部注入`。详情新增「来源判定」（`前缀 mcp__{ns}__ → {channel}
  （插件清单映射表）` / `运行时注入来源：{source} → {channel}` / `来源未识别
  （不是宿主内置）`）与「注入方式」（`工具命名空间合成（不落盘、无 mcp-client
  实例）` 等）。组内排序：有 channel 的按展示名升序，无 channel 的排后面。
  `mcp.runtime` 纯 additive 扩展 `channel?` / `attribution?` / `synthesized?` 与
  `origin:"namespace"`，旧字段（`source` 原文、`origin:"entry"|"fiber"`）语义不变。
- **Jev 能力决策纳入 Tools（插件级计分与应用）**：一个插件 = 一个评分/应用单元
  （`kind:"tool"`、`id = cap_<sha256("tool:plugin:<unit>")>`、additive 字段
  `toolCount`）。候选 name = 插件展示名、description = `N 个工具 · 插件注入`；
  请求只带工具名 + 一句话说明（截断 8 个 / 500 码点，**不带参数 schema**）；
  「来源未识别」单元**不进候选**（可能混入未来宿主内建工具，让模型推荐关闭风险高，
  但仍可手动开关、计入分母）。应用 = 选中插件整插件开、未选中且当前开 → 整插件关；
  不可开关（locked）项一律不动；**只收窄不扩权**；沿用既有批量两阶段写入、
  失败按前态逆序回滚、冷会话排队；Tools 写入单列并发组（≤4，写入会触发 restrict
  重算）。`JevCapabilityWrite` / `JevPrevState` 增加 `tools` 分支，
  `compareRankItems` 由「skill 先于 mcp」改为三档全序 skill → mcp → tool。
  （候选口径后改为「本会话 effective 启用」，见「变更」。）
- **能力面板第四个域 Tab `Tools`**：两栏（插件列表 + 详情），**无左导航、无项目 /
  工作区下拉**（全局工具注册没有项目维度），header `全局工具注册 · 不区分项目 /
  工作区`；列表行 = 插件名 + `插件` / `未识别` 标签 + `N 个工具` + 「启用」开关
  （**全局默认**，不需要当前会话，也不显示任何具体会话状态）；详情 = 来源判定 /
  注入方式 / 工具数 / **工具清单（只读手风琴）**——工具行显示 `N 个参数 / 无参数`，
  展开有参数表（参数 / 类型 / 必填 / 说明）与可折叠的原始 JSON；schema 由
  `tools.inspect` 按需懒加载（`tools.list` 保持轻量），失败降级为「仅名称 + 说明」。
  详情整页纵向可滚动；开关写 `tools.setGlobalEnabled`，会话首屏的覆盖写
  `tools.setSessionEnabled`。
- **会话级开关持久化**（`src/session-state.ts`）：`<dshHome>/dsh-capability-settings/
  session-capabilities.json`，按 sessionId 记录 Skills / MCP / Tools 显式覆盖
  （`tools` 域为 v13 additive，见「内部」）；目录 0700 /
  文件 0600；原子写 + 文件锁 + 懒加载；损坏 / 未知版本降级为空表（跟随项目默认）。
  记录带 `headerCreatedAt` 防 sessionId 复用（不一致 ⇒ 旧记录作废；fork 是新 id，
  不继承父会话开关）。
- **孤儿记录对账**（`src/session-state-reconcile.ts`）：宿主没有「会话删除」事件
  （cordis 只有 `session/created|disposed|event|flush`），且关机时 `session/disposed`
  会对所有 live 会话成批发出——因此事件只触发「只标记」核对，删除由启动后 + 每 24h
  的存在性校验（`sessionPersistence.stat`）决定：确认缺失先记 `missingSince`，
  累计 ≥24h 才删除；服务缺失 / 探测抛错一律保留。

### 变更

- **⚠️ Tools 改为两层语义（覆盖 v13 早期的「仅会话开关」设计 / A5）**：与
  Skills、MCP 一致——
  - **能力面板 Tools 页 = 全局默认**（所有会话、含新建会话），写
    `tools-global.json`；**会话首屏 /「能力」Tab = 本会话覆盖**，写
    `session-capabilities.json` 的 `tools` 域；
  - **effective = 会话覆盖 ?? 全局默认**，`tools.restrict` 按 effective 应用。
    因此**全局关闭的插件仍可在单个会话里单独开启**，全局开启时也可只关本会话；
  - 首屏行 3 的「全部开启 / 全部关闭」**只写本会话覆盖**、不动全局默认；底栏
    「恢复默认」清除本会话覆盖 → Tools 回落到全局默认；
  - 全局默认变化**扇出到所有 live 会话**（异步重算，不阻塞开关）；新建会话按
    全局默认应用；
  - 早期方案里的 **A3（Tools 无项目级默认）与 A5（主面板只读 / 仅会话级）作废**，
    行为以本节与 README 为准。
- **Tools 面板体验修复**：详情整页纵向可滚动（插件工具多时不再撑破布局）；工具
  清单改手风琴（每行 `N 个参数 / 无参数`，展开显示说明 + 参数表 + 可折叠原始
  JSON）；删除「关闭该插件后…」琥珀影响条与「无参数表」文案；主面板开关改为
  **全局默认**（无需解析当前会话）。
- **MCP 外部注入行名称可见**：来源两枚标签（`插件` + 展示名）从名称行移到下方
  meta 行，`serverName` 不再被标签挤没（`figma` 等合成行现在能直接看到名称）。
- **主面板全局 Skills 在「跟随当前会话」时可开关**：未钉选项目时，行开关的写操作
  落在**当前会话的工作区**（tooltip 注明作用域）；只有完全没有工作区时才置灰。
- **Jev Tools 候选改为「本会话 effective 启用」**：全局默认关闭 / 本会话已关的
  插件不进入候选（不能被 Jev 重新打开，只收窄不扩权）；apply 仍写会话覆盖。
- **能力面板 / 会话面板改为三域 + 全站命名统一**：用户可见文案 `技能` → `Skills`、
  `MCP 服务器` → `MCP`、`插件工具` → `Tools`（注释与内部标识不动）。主面板 Tab 行
  变为四域 `Skills / MCP / Tools / Jev 模型`（`Jev 模型` 仍是配置页、无计数）；
  会话面板三 Tab `Skills / MCP / Tools`，卡片计数按域（Tools 按**插件数**，
  Tab 形如 `3 / 6`）。面板与会话两处的 DomainTab 顺序固定。
- **会话计数口径改为三域相加**：控制条 `已启用 n / m`、底栏 `n / m 项已启用`、
  收起态能力条 chips 与「决策估算总数」都含 Tools（m = Skills 条数 + MCP 行数 +
  Tools 插件单元数；「来源未识别」单元也计入分母）。
- **Jev 评分范围从两域扩到三域**：`capabilitiesTotal` = Skills + MCP + Tools 插件
  单元（未识别单元不计）；结果面板 `已选 x / N` 的 N 含 Tools（一个插件算 1 个
  单元）；同分排序由「Skills 先于 MCP」改为三档全序 `Skills → MCP → Tools`，
  再按名称 / id。结果行：Tools = 插件名（等宽）+ `插件` 标签 + `N 个工具` 灰标签 +
  描述 + 分数条，**不逐工具出行、不挂来源小标签**（名称即插件名，避免重复）；
  结果列表下方补一行弱说明（`Tools 以插件整体计分与启用…Jev 只收窄…`）。
  `empty-capabilities` 文案同步为「当前会话没有可评分的 Skills / MCP / Tools」。
- **R5 文案收口**：Jev 配置页删除独立 callout（原说明含密钥路径 `~/.dsh/...` 与
  `目录 700 / 文件 600`），说明并入标题下副标题两行（含 Tools 隐私说明）；
  密钥安全承诺收进 API Key 标签右侧 `ⓘ`（`密钥仅存宿主，不下发浏览器`）；
  「能力决策」区内的成本 / 隐私说明保留，其余配置项语义与字段不变。
- **⚠️ R2 派生继承本版未实现（重要）**：派生继承（`继承 / 不继承` 布尔开关、
  subagent / teammate 共用、三域整体、默认「继承」）**只有交互设计
  （`docs/ux/capability-v13.md` §4 / D3），零代码**：本版不写入任何 policy /
  继承字段、不新增 RPC、首屏行 3 右侧**不渲染任何继承控件或弱提示**。
  派生 agent（subagent / teammate）的能力仍按现有规则（项目默认 / 项目级声明）
  取得，**不是**「跟随父会话生效集合」——不要把设计稿里的默认「继承」当成现状。
  实现属后续版本（第一批只为它预留了 Tools restrict 可按任意 agent 作用域重复
  应用的纯函数入口 `applyForAgent`）。
- **会话能力面板 Tab 文案 `MCP 服务器` → `MCP`**：与主能力面板的域 Tab（`MCP`）和
  Figma v12 基线一致，去掉「服务器」后缀；只是文案，Tab 切换与计数不变。
- **移除自动触发等待期的倒计时弱提示**：能力条 / 面板标题行原先在等待停顿期间显示
  「停顿 0.9s / 1.0s · 即将能力决策」，现按用户要求**不再显示**（首屏少一行常驻
  文本）。同时删除 `DecisionController.countdown` 状态与 100ms 刷新 ticker（少一处
  只驱动展示的定时重渲染）及 `.skp-decision-countdown*` 样式。自动触发行为不变：
  门槛（最少触发字数 / 最少修改间隔字符数）、停顿阈值、到点发起评分、取消后同草稿
  静默、不弹 toast、不抢焦点均保持原样，等待期不再有可见进度提示。
- **项目级「默认关闭」声明统一收进插件数据目录**：原先写在项目仓库的
  `<项目根>/.agents/capability-overrides.json`，现在统一写到
  `<dshHome>/dsh-capability-settings/capability-overrides.json`（与 `jev.json` /
  会话开关同目录，文件权限 0600），**一个文件按项目根分 key**：
  `projects.<项目根>.mcp` / `.skills`，条目带 `updatedAt` 与最近 `cwd`。
  影响与边界：
  - 面板「默认」开关不再改项目仓库文件，声明也不再随 git 提交 / 跨机器共享
    （换机器或清空 dsh home 后需重新设置）；
  - 旧项目内声明（`.agents`，兼容 `.dsh` / `.claude`）**只读兼容**：统一存储里
    还没有该项目时回退读取；首次写入时把旧内容并入统一存储并删除旧文件
    （之后只有统一存储生效，避免两处维护）；
  - 项目根 key 取自 `findProjectRoot(cwd)`：同一项目的不同子目录共享同一份；
    项目路径移动后会生成新 key，旧条目保留但不再命中；
  - 统一存储损坏 / 版本不认识：列表降级为空、写入显式报错（不静默覆盖用户数据）；
  - `overrides.get` 回包 additive 增加 `projectRoot`，`filePath` 改指统一存储；
    新增公开导出 `overridesStoreFile` / `readOverridesStore` / `writeOverridesStore` /
    `OVERRIDES_STORE_VERSION`。

### 内部

- **自动归属实现**：`src/tools/attribution/resolver.ts` 同步解析（绝不 await 扫描）+
  后台缓存/扫描；`manager.ts` 的 `enumerateGlobalTools` 接 resolver、unit=规范包名、
  单元级归属聚合（优先级 + `mixed`/`legacyUnit`）；`src/mcp/runtime.ts` 命名空间
  支持动态 resolver；`src/index.ts` 最先装配 resolver 并 kick-off 两文件迁移；
  `global-state.ts` / `session-state.ts` 读归一、镜像双写、`migrateUnitIds` /
  `migrateToolsUnits`（settled 幂等）。
- **`src/skills/session.ts` 会话投影**：`projectShadow === "stub"`（非 injected
  磁盘全局行）在无显式覆盖时 `enabledInSession=false`，显式覆盖优先（true /
  false / 清除三态）；`projectShadow === "skill"` 的全局重复行从会话视图过滤
  （项目副本行保留）；冷会话（无 live agent）同规则。`canToggleInSession` 语义与
  injected 行口径不变。
- **`tools.list` 的 `explicit` 语义明确**（字段本已 additive 下发，未改名）：
  `true` ⇔ `session-capabilities.json` 的 `tools` 域存在 `plugin:<unit>` 键
  （值为 `true` / `false` 都算"本会话有覆盖"）；无覆盖或未传 `sessionId` 时恒
  `false`。首屏 Tools 卡片据此显示「本会话覆盖」标签。
- **`src/shared/plugin-attribution.ts`**：`TOOL_RULES` 增 `figma`（exact）/
  `figma_`（prefix）→ `dsh-to-figma`、`diff_approval_annotate`（exact）→
  `dsh-diff-approval`；`HOST_BUILTIN_EXACT` 增 4 个宿主基础 bundle 工具名
  （工作区 / MCP 资源类），避免落进「来源未识别」或被误当插件单元。
- **Tools 两层生效 + 扇出（`src/tools/manager.ts`）**：全局默认镜像按需 hydrate；
  `effectiveEnabled(unit, sessionToggles, globalDisabled)` 为唯一口径（已导出纯函数，
  供 R2 复用）；`tools.restrict` 目标 = 所有 effective=false 单元；
  `setGlobalEnabled` 写盘后 `refreshGlobal()` + 微任务扇出（每会话走既有串行队列，
  fire-and-forget）；`tools/change` 重算前先 hydrate 全局，避免用空集合误释放
  「全局关闭」的 deny；`applyForAgent` 新增可选 `globallyDisabled`（不读全局存储，
  子 agent 继承时投影即可）。
- **Tools 全局默认存储（`src/tools/global-state.ts`）**：目录 0700 / 文件 0600、
  原子写 + `withFileLock` 锁内读盘合并；`disabled` 清洗（只收非空字符串、去重）；
  未知 version / JSON 损坏 / 读失败 → warn + 按全部启用；无变化不写盘（幂等）；
  stale unit 保留在文件里（读取时忽略，不删用户数据）。
- **`tools.inspect` 实现**：与 `tools.list` 共用同一次枚举/归属逻辑（不二次扫描），
  完整 `description` + 原始 `parameters` 不裁剪；整包 > 1 MiB 只记 warning（不静默
  丢字段）；`tools.list` 仍只回 name + 200 码点说明。
- **Jev Tools 回滚前态按来源区分**：有显式会话覆盖时记 `true`，仅靠全局默认生效时
  记 `undefined`（回滚 = 清除覆盖回到全局默认，不写死 true 破坏全局关闭）。
- **`session-capabilities.json` v1 追加 `tools` 域（additive，版本号不变）**：
  记录级 `sessions.<id>.tools`（键 `plugin:<unit>` → boolean，
  未识别单元为 `plugin:__unattributed__`）。`version` 仍为 **1**，旧版插件读本文件
  时忽略该字段（旧版写回**只保留已知字段** ⇒ 用旧版改过任意开关后 Tools 会话开关
  会丢失、回到默认全部开启，这是已知降级，不承诺降级保状态）。同步修改
  `SessionStateEntry` / `sanitizeEntry`（只收 boolean）/ `isEmptyEntry` /
  `writeToggle`（`field` 联合加 `"tools"`），新增 `tools()` / `setTool()` /
  `setToggles()`（批量一次落盘；空表 = 不改，不是"清空全部"）。
- **新增宿主模块**：`src/shared/plugin-attribution.ts`（映射表 / 内建清单 /
  `run_code` 防御的单一事实源）、`src/tools/{types,manager,restrict}.ts`、
  `src/session-bulk.ts`（三域批量）。`tools/manager.ts` 导出 R2 预留纯函数
  `applyForAgent(agent, sessionId, toggles)`（本版不调用它实现继承）。
- **接线**：`src/index.ts` 装配 `tools` 服务与延迟构造的 `session.setBulk`，
  把 Tools 服务注入 Jev 枚举（缺省时 Jev 跳过 Tools 段并 warn 一次）；
  `src/remote.ts` 新增三个 endpoint 并扩展 `PanelRpcService`（传输层信封恒
  `{ok:true,value}`，业务失败仍在 value 内）；`src/mcp/loader.ts` 只新增
  `setSessionEnabledMany`（不改现有 `setSessionEnabled` 语义）；`src/jev/**`
  扩 `kind:"tool"` / `write:{type:"tools"}` / `JevPrevState` tools 分支 /
  `toolCount`。公开 API 增加对应 re-export。
- **归属规则的已知边界**：真机插件基础工具名是 `univer`（不带 `_`），因此映射表
  除 `univer_` 前缀外另加一条 exact `univer`；`dsh-diff-approval-` 前缀作为未来
  多工具的防御规则（exact 优先、同层最长前缀、前缀必须以 `_`/`-` 结尾）；
  宿主内建排除清单含 `job_` / `schedule_` / `session_` / `terminal_` /
  `team_task_` / `cordis_inspect_` 前缀与 `run_code`（版本敏感，升级宿主需复核）。
- **验证**：`pnpm typecheck` 通过；宿主段临时自测（未入库，脚本在 `/tmp`）覆盖
  方案 §10 的 TH-01..12 / B-01..11 / R4-01..08 / J-01..09 共 168 断言 0 失败，
  另有真实 `apply()` 组合根装配冒烟 11 断言。正式回归套件由 tester 落
  `notes/verify/v13-*.mjs`（按方案 §10 用例编号）。
- `skills/session.ts`：`applyProjectDefaults` 早退条件纳入显式开关；新增
  `restoreExplicit`（list 路径覆盖磁盘 + 注入技能，并清理已删除技能的覆盖记录）。
- `mcp/loader.ts`：`setSessionEnabled` 先 hydrate 再改内存并落盘；`remount` 前
  hydrate；`agent/disposed` 只清内存、不删磁盘。
- `index.ts`：组合根创建单一 `sessionState` 注入两个域，并接线对账调度
  （`session/disposed` / `agent/disposed` → debounce 只标记核对）。
- `overrides/*`：`paths.ts` 新增统一存储路径；`config-file.ts` 新增 store 读写
  （版本 / 形状校验、空条目不落盘、文件 0600）；`manager.ts` 按项目根读写 +
  旧文件兼容迁移。
- 回归：`notes/verify/session-state.test.mjs`（8 例：重启读回 / 清除 / 防 id 复用 /
  两阶段对账 / 跨实例合并 / 权限 / 损坏降级 / 未知版本）、
  `notes/verify/session-restore.test.mjs`（2 例：Skills 与 MCP 的重启恢复接线）、
  `notes/verify/overrides-store.test.mjs`（8 例：按项目分 key / 项目隔离 / 子目录共享 /
  旧文件迁移删除 / 空条目 / 坏旧文件 / 坏存储 / `get` 视图 / 非法入参）。

## [1.5.0] - 2026-10-25

### 新增

- **注入技能来源展示（面板 / 会话 / 能力决策）**：新增宿主技能注册表桥
  （`src/skills/registry.ts`），把 `ctx.get("skills").snapshot()` 里**不在受管
  磁盘根**的条目 additive 合并进 `skills.list` / `skills.sessionList`：
  - 面板「全局」scope 新增「注入技能」分组（计数 +「内容只读 · 可启停」说明）；
    行内标签 = 来源类别（**内置** / **插件** / **预设**）+ 格式（目录 / `.md`）+
    **渠道名**（`DSH 内置（Office）`、`dsh-to-figma`、`dsh-remote`、
    `插件运行时注入`、preset id；preset 名解析失败显示「预设（未知）」，条目不丢）。
    同名磁盘条目优先、本插件自身 shadow 被过滤、`project-*` / `user-*` 等宿主
    磁盘根条目不算注入（面板磁盘视图是权威来源）。
  - 会话能力区（首屏 hero / 顶部「能力」Tab）注入行与磁盘技能同列，带来源 +
    渠道标签；开关仍只写当前会话。
  - **能力决策结果行显示来源小标签**（内置 / 插件 / 预设渠道）：`rank` 回包
    新增 additive `origin / channel / provider / contentReadOnly`，`jev.apply`
    原样透传；旧宿主没有这些字段时按原样不显示，不影响评分/勾选/应用。
- **注入技能的项目默认启停**：`capability-overrides.json` 新增 `skills` 域
  （与 `mcp` 并列；空数组不落盘、旧文件无该键读成 `[]`）。面板注入行开关 =
  「本项目默认」，写该名单；`agent/created` / 项目默认热更新时按名单在 agent
  作用域注册同名 runtime shadow（注入技能没有磁盘文件，**不写 frontmatter**）。
  优先级：显式会话开关 > 项目默认；会话显式可再打开/关闭（内存态、不落盘）。
- **注入技能详情 / 资源读取 / 导出**：`skills.read` 增加 registry fallback
  （磁盘读不到时用 `ctx.skills.get` 取正文）；新增 `skills.readResource`——
  仅 `resourceBase.kind === "directory"` 允许浏览一层条目并按需读取单个文件
  （基准目录只来自宿主；`../`、绝对路径、反斜杠、符号链接、realpath 逃逸、
  非 UTF-8、超过 256 KiB 均返回带 `code` 的业务错误），`url` / `opaque` 只给
  正文 + 说明。导出注入行为单文件正文快照（`lossy: true`，资源文件不打包）。
- **Jev 枚举纳入注入技能**：`sessionList` 合并后自动进入 `enumerateCapabilities`，
  评分 / 应用与磁盘技能完全一致（`capabilityId` 仍为 `skill:<name>`、`reason`
  不新增枚举）；冷会话只含 global 层注入。
- **RPC**：新增 `skills.readResource`；`overrides.get` 返回 `skills` 域、
  `overrides.toggle` 支持 `domain: "skills"`。全部 additive，旧客户端忽略新字段。

### 变更

- 面板 / 会话技能列表从「仅受管磁盘根」改为「磁盘行 + registry 注入行」合并
  视图；注入行 `source: "external"`、`format: "directory"`、
  `contentReadOnly: true`、**不带 `root`**，因此所有写 RPC 在宿主侧一律返回
  `read-only` 业务失败（不是只在 UI 隐藏按钮）。注入行不参与项目/全局的磁盘
  归属判断，改由 `injected` / `origin` 单独渲染。
- 会话技能视图 `enabledInSession` 由「是否注册 shadow」改为状态机
  （显式会话覆盖 > 项目默认 > 始终可切换的既有语义），冷会话按项目默认给初值；
  注入行被自己 shadow 遮蔽时用内存元数据缓存补行（仍可见、可再打开）。
- 技能计数与搜索：注入行计入「全局」域计数（含只读、含注入、不去重）；
  渠道名（插件 / preset 名）参与搜索。
- 详情页对注入行隐藏 编辑 / 删除 / 导入 / 调用方向 / 导出到宿主路径 等写操作，
  显示来源 + 渠道 + 只读原因条；保留 查看正文、浏览资源、导出 `.md`、启停。
- **Figma 设计基线同步**：v12 提案（注入技能来源）**补丁式并入**基线——
  `Capability Panel · 终稿 v8` 的 02 技能·全局帧（`42:3433`）新增「注入技能 5」分组
  （`v12/group/*`）+ 5 个注入行（`v12/row/figma-workbench` / `dsh-remote-deploy` /
  `dsh-diff-approval-annotate` / `office` / `office-docx`，来源标签 + 渠道名 + 本项目
  默认开关；磁盘第 3–5 行与详情写按钮**隐藏不删**）并把详情切到注入技能
  figma-workbench（只读原因条 `v12/detail/readonly`、`v12/meta/mode`、资源树
  `v12/tree/*`、阅读器 `v12/reader/*`）；01 技能·项目帧（`42:3376`）仅同步左导航全局
  计数 157；`Capability Panel · 能力决策 v11` 的 04 结果帧（`56:7679`，panel `56:7791`）
  6 行结果新增来源标签（`v12/src/0..5`）、说明列右移、「已选 5 / 52」。
  历史页面（v5 / v6 / v7 / v9 / v10 与 v12 提案页 `88:8519`）**全部保留不动**；
  重导预览 `docs/figma/preview/v8-01-skills-project.png`（152633 B）、
  `v8-02-skills-global.png`（165194 B）、`v11-04-results.png`（159880 B），以及
  `docs/figma/scenes/v8-01-skills-project.scene.json`（264 节点）、
  `v8-02-skills-global.scene.json`（278）、`v11-04-results.scene.json`（170）
  （README 已注明旧截图不覆盖新 UI；scene 重导方式见 `docs/figma/README.md` §3.1.3）。

### 修复

- **项目技能详情恒 not found**：客户端 `api.read` 只传 `{name, cwd}`、且不解
  业务信封，导致有 `root` 的项目技能详情打不开、失败被当成空详情。现在 `read`
  传 `root`（优先）/ `scope` / `sessionId`，适配器用 `unwrap` 解业务信封；
  注入行则由宿主回落到 registry。
- **`overrides.toggle` 会抹掉其它域**：旧实现写盘时重建 `{ mcp: [...] }` 硬编码，
  新增 `skills` 域后切换一个域会清掉另一个域的名单。改为按 `DOMAIN_KEYS`
  （`mcp` / `skills`）重建。
- **降级路径（不误判为缺陷）**：宿主 registry 缺失 / `snapshot` 抛错 → 只显示
  磁盘技能并 `warn` 一次，磁盘功能不受影响；`snapshot.complete === false` →
  不更新 last-good、沿用上次缓存；`skills/change` / `agent/disposed` 清缓存；
  注入插件卸载后条目随 `skills/change` 刷新、不留死行；`origin=preset` 技能在
  冷会话（无 live agent）不可见是宿主 scope 语义的上游边界，文档与空态已写明
  「会话开始后可评分」。

### 内部

- 新增 `src/skills/registry.ts`（分类表为 `origin/channel` 的单一事实源、合并、
  detail fallback、资源边界、导出快照、LRU 元数据缓存）；`src/skills/session.ts`
  扩展项目默认 / 显式开关 / reconcile 校验；`src/skills/{types,manager,crud,
  disk,transfer}.ts`、`src/overrides/*`、`src/remote.ts`、`src/index.ts`、
  `src/jev/{apply,types}.ts`、`src/client/*` 做字段透传与 UI；契约与证据见
  `docs/architecture/skill-sources.md`（task-1）。
- 不新增运行时依赖；客户端 bundle 仍只外置 `react` / `react/jsx-runtime`；
  写入仍走 `atomicWriteText` + `withFileLock`。

## [1.4.3] - 2026-10-24

### 修复

- **能力决策 0 选择应用**（用户 bug：阈值筛出 0 个能力时无法应用）：旧实现 n=0
  时禁用主按钮，用户无法表达「本会话全部不需要」。现在
  `jev.apply` 允许空 plan `[]`：目标集合为空 = 关闭当前会话全部**可应用**能力
  （不可应用项不动；非数组 / 超量仍返回 `bad-request`）；前端 n=0 时主按钮改为
  「应用（关闭全部）」且可用，`noMatch` 提示可直接应用；toast 拆为只关闭
  （`已应用：关闭 {Y} 项（当前会话未启用任何能力）`）/ 只启用 / 都变化三组合，
  冷会话 pending 同样排队全部关闭 ops。实现 / 验证：task-52、task-53、task-54
  （tester 610+ 断言 0 失败；既有回归全绿）。

### 变更

- **包名改为 `dsh-capability-settings`（fork 独立身份）**：`package.json` 的 `name`、
  `cordis.patch.yml` 的 insert `name`、`tsdown.config.ts` 的 `pluginId` 同步为新名
  （客户端 bundle 注册 id 必须等于包名，DSH 加载器契约）。`cordis.patch.yml` 的
  `id: capability-panel` 与 RPC 通道 `/capability-panel` 保持不变。**升级需重装**：
  profile 里旧依赖键 `@chengdb/capability-panel` 与 `dsh.profile.bundles` 条目不会
  自动迁移，先卸载旧条目再装 `github:xx529/dsh-capability-settings#master`；已有
  配置数据不受影响（见下一条）。
- **Jev 配置目录改为 `<dshHome>/dsh-capability-settings`（与包名一致）**：旧目录
  `<dshHome>/capability-panel/jev.json` 在首次读取时**自动迁移**——优先原子
  `rename`，失败退化为「复制 + chmod + 删除旧文件」；幂等（新文件已存在则不动），
  并发下也不会丢配置。目录 `0700` / 文件 `0600` 权限不变；旧目录里的其它历史文件
  （如 `stats.jsonl`）不迁移、原样保留。配置页「API Key 只保存在宿主 …」文案同步
  改为新路径，Figma v11 的 scene/建稿脚本文案已同步（预览 PNG 未重导）。

### 内部

- **新增 `scripts/push-and-reinstall.sh`（`pnpm push:install`）**：一条命令完成
  「typecheck + build → `git push` → 重装 profile」。内置桌面应用自带的 dsh CLI 路径
  （PATH 里的 0.1.x 旧 CLI 会被拒绝）、用 `pnpm update` 重新解析 `github:…#master`
  （`install` 不会重解析）、校验/补齐 `dsh.profile.bundles`、安装后校验 commit 并提示
  重启。参数：`--dry-run` / `--profile` / `--ref` / `--remote` / `--dsh-home` /
  `--dsh-cli` / `--no-push` / `--no-install` / `--no-build` / `--force-reinstall` /
  `--force`。AGENTS.md 与 README 新增「推送 + 重装」说明，后续不需要再探索安装方式。
- **收录到 Awesome DSH Plugin 市场**（<https://awesome-dsh-plugin.com/>）：上游目录为
  `data/plugins/<owner>__<repo>.yml` 单文件条目，本次新增
  `data/plugins/xx529__dsh-capability-settings.yml`（分类 `ui`）。条目副本与提交流程 /
  CI 检查 / PR 模板沉淀在 `docs/marketplace/`（`awesome-dsh-plugin.yml` + `README.md`），
  AGENTS.md 增加「插件市场收录」章节：改包名或插件能力时同步改市场条目，避免描述与
  代码不一致被评审打回。

## [1.4.2] - 2026-10-24

### 修复

- **能力决策 apply 写入性能**（用户反馈：应用 8/154 项时「应用中…」卡很久）：
  旧实现逐条串行 `await` 写入，最多 146 次写入会让技能注册表的 effect 逐次刷新。
  现在 skills 写入在同一 tick 批量发起后 `Promise.allSettled` 合并等待（N 次 shadow
  注册只触发一次刷新），MCP 按并发上限 **4** 限流写入，失败仍批量逆序回滚；成功 /
  冷会话排队支新增 additive `elapsedMs`（覆盖枚举 + 批量写入总耗时，便于排查）。
  fake 基准 142 skills 的串行下界 ~284ms 降至 **3ms**（结构性收益，真机仍待测）。
  验证：task-47 / task-48（tester **610 PASS / 0 FAIL**，host-apply 105；并发峰值
  skills = 阶段技能数、MCP ≤4；既有回归全绿）。

## [1.4.1] - 2026-10-24

### 修复

- **能力决策「应用所选」改为筛选语义**（用户 bug：应用后本会话能力面板仍全开）：
  旧实现只启用勾选项、未勾选项保持现状，因此面板保留全部已启用能力（如 145/145），
  看起来没有过滤。现在宿主枚举当前会话全部可应用能力：勾选 → 启用、未勾选 → 关闭
  （只改当前会话、不动项目默认），只写状态不一致项；成功支新增 `enabled` / `disabled`
  计数（`applied = enabled + disabled`）；跳过项区分真正不可应用与 `already-applied`
  （后者不展示为「不可切换」），重复应用只写差异；冷会话 pending 保存完整 ops
  （含关闭）并在 `agent/created` 后重放，失败仍按前态逆序回滚。
  实现 / 验证：task-42（宿主筛选语义）、task-43（客户端 toast / 过滤）、
  task-44（tester 571 PASS / 0 FAIL，`notes/verify/jev-capability-decision/report.md`）。

## [1.4.0] - 2026-10-24

### 新增

- **能力面板第三个域 Tab「Jev 模型」**（TypeSafe Jev 全局配置页，无计数 / 无搜索 /
  无左导航）：Base URL（默认 `https://api.typesafe.ai`）、模型名（默认 `jev-latest`）、
  API Key 来源（`直接填写` / `环境变量`，默认变量名 `TYPESAFE_API_KEY`）、测试连接、
  保存、恢复默认（需行内再点一次确认，只重置表单）。保存成功**不关闭页面、不跳转**，下一次
  评分 / 测试立即生效。
- **Jev 配置存储与密钥边界**：配置文件写入 `<dshHome>/capability-panel/jev.json`
  （默认 `~/.dsh/capability-panel/jev.json`；`DSH_HOME` 存在时以其为根；目录 `0700` /
  文件 `0600`）。密钥解析优先级 **环境变量（`apiKeyEnv`）> 配置文件 `apiKey`**；
  `jev.getConfig` 只回 `hasApiKey` / `apiKeySource` / `apiKeyLast4`，浏览器与 RPC
  响应均无明文；错误、日志与错误摘要统一脱敏。旧 `~/.agents/jev.json` 无历史迁移、
  不读取。
- **首屏 hero「✦ 能力决策」**：手动点按即发起评分；结果面板替换 hero 能力区内容
  （同宽、不遮输入框、不抢焦点），按分数降序（同分技能先于 MCP、再按名称）；
  阈值滑杆 `0–1` 步长 `0.05` 默认 `0.50`，分数 ≥ 阈值预勾选、支持手改；显示
  `已选 n / N`（N 含不可切换项）；「应用所选」只写**当前会话**的会话开关，不改项目
  默认，失败尽力回滚并报错。
- **一次批量评分**：`POST {baseURL}/v1/systemone` 单次请求、每能力一条 `noul`、
  返回 0–1 分；**不分片、不按能力拆请求**；单次最多 300 个能力（超出直接报错不请求）；
  超上下文返回「输入内容超出模型上下文上限」，不自动截断或分批。缺分 / 非数值容错：
  数值 clamp 到 `[0,1]`（`1.2`→`1`），缺失 / 字符串 / `NaN` → 该能力 `score=0` +
  `reason="no-answer"`（界面「未获得评分」），**不整单失败**，列表不丢行。
- **输入停顿自动触发（默认关闭）**：开启后仅 hero 相位、已配置、无评分 / 应用进行中，
  且同时满足「草稿字符数 ≥ 最少触发字数」「自上次能力决策累计插入 + 删除字符数 ≥
  最少修改间隔字符数」时，停顿达到阈值自动发起 1 次评分并展开面板。可配置：停顿阈值
  （默认 `1000ms`，`300–3000`、步长 100）、最少触发字数（默认 `10`，`1–200`）、
  最少修改间隔字符数（默认 `4`，`1–100`）。编辑量在任意一次决策触发后、草稿清空后、
  发送首条消息后归零；停顿计时每次草稿变化都重置但不清零编辑量；取消后同草稿静默，
  直到再次累计到最少修改量；不弹 toast、不抢焦点、不进 `aria-live`。
- **冷会话排队应用**：首屏无 live agent 时 `jev.apply` 只入宿主内存 pending 队列，
  chips 立即乐观回显 + 提示「已加入本会话，发送首条消息后生效」（有跳过项时合并
  提示）；`agent/created` 后 `setTimeout(0)` 延后应用，失败重试 2 次（100ms / 300ms）；
  激活后应用失败以一次性 `pendingOutcome` 回执提示（读取即消费，插件重载会丢失）。
- **RPC**：新增 `jev.getConfig / setConfig / test / rank / apply` 五个端点；沿用
  `{ok:true,value}` 传输信封与 `value:{ok:false,...}` 业务失败约定。

### 修复

- **首次配置保存后首屏不刷新**（测试报告 F3）：配置保存成功后广播
  `capability-panel:jev-config-changed` 事件，hero 监听事件并在窗口重新聚焦时重读
  `jev.getConfig`；无需刷新页面即可用新配置评分、按新门槛自动触发。
- **Jev rank 打分质量**：旧请求把能力数组放在 `state.capabilities`，但 155 条
  noul question 的 instructions/criteria 完全相同、题内又不含能力（question id
  不发给模型），模型只能给出几乎相同的概率，实测分数集中在 0.40–0.41，排序与阈值
  失效。现改为 `state = { request, guidance }`，每题结构化 instructions 内嵌
  `capability { kind, name, description, whenToUse?, tools? }`（MCP 带工具名/描述：
  配置条目经宿主 `mcpTools(serverName)` 从工具 schema 反推、外部实例用 runtime
  tools），题目逐能力唯一、criteria 更明确，仍保持一次请求、不分片。RPC 返回形状
  不变、客户端无感；内部请求体积 152 条 ≈105KB（约 27k tokens），低于默认 64k
  上下文，超限仍报 `context-too-long`。tester task-31 复验 **567 PASS / 0 FAIL**
  （host-rank 126），typecheck / build 与既有回归全 0；真实 Jev 分数分布需用户真机
  复测（本机无 key），架构文档同步 v1.1（task-32）。

### 变更

- **结果面板精简**：移除说明行 / 隐私行 / 阈值提示，仅保留标题、模型徽标、阈值与列表。
- **域 Tab 由两个变三个**：`技能 / MCP / Jev 模型`；第三个 Tab 无计数、无搜索，
  选中时头部工作区路径与项目作用域下拉隐藏（内容区为单列配置页）。
- **评分错误语义调整**：不再有「评分结果不完整」错误态；单能力缺分 / 非法分按
  `no-answer` 容错（0 分 + 可解释标注），只有 HTTP / 鉴权 / 超时 / 上下文 / 空能力等
  整体失败才进入错误态。
- **重试与超时边界**：仅 429 / 529 在 HTTP 层最多重试 2 次（固定 500ms / 1000ms
  退避，无抖动）；其它 4xx 不重试；单次尝试超时 30s；自动触发失败不自动重试。
- **隐私与发送范围**：评分请求只由宿主发起；请求体仅含当前草稿 + 能力名称 / 描述
  （截断到 200 / 120 码点），不含历史消息、文件正文、项目路径、session/cwd 或
  API Key；错误与日志同样脱敏。
- **文档与原型**：新增 `docs/specs/jev-auto-select.md` v1.3.1（含 §11 实现裁决记录）、
  `docs/ux/jev-auto-select.md` v1.5、`docs/architecture/jev-capability-decision.md`；
  Figma v11 五帧（`docs/figma/preview/v11-*.png`）；README 增加「Jev 能力决策」章节、
  三 Tab 总述与旧截图跨版本说明。

### 内部

- 实现（task-14~21）：
  - 宿主新增 `src/jev/paths.ts`（dsh home 路径）、`types.ts`（配置 / 错误码契约）、
    `config-file.ts`（读写锁 + 原子写 + 校验 + 脱敏）、`manager.ts`（RPC 业务与密钥
    解析）、`rank.ts`（systemone 请求构造 / 容错解析 / 排序 / 错误映射）、
    `apply.ts`（枚举、会话写入事务、冷会话 pending）。
  - `src/remote.ts` 增加 5 个 `jev.*` 路由；`src/index.ts` 装配 manager / apply 引擎与
    `agent/created`、`agent/disposed` 生命周期监听；`src/shared/atomic-write.ts`
    支持写入文件 mode。
  - 客户端新增 `src/client/jev-panel.tsx`（配置页）；`src/client/api.ts` /
    `api-adapter.ts` 增加 `jev.*` 适配；`src/client/panel.tsx` 三域 Tab 与 Jev 页；
    `src/client/composer-capability.tsx` 能力决策调度器（手动 / 自动 / 编辑计数 /
    冷会话 pending / 结果面板）；`src/client/styles.ts` 新增样式与
    `@container 720/560` 断点。
- 验证（task-17）：
  - `bash notes/verify/jev-capability-decision/run-all.sh` — exit 0，**511/511 断言
    通过**（host-config 68、host-rank 93、host-apply 69、host-rpc 12、client-panel 73、
    client-hero 178、client-adapter 18）；`pnpm typecheck` / `pnpm build` exit 0。
  - 既有回归 `bash notes/verify/run-all.sh` — 全部子脚本 exit 0；既有回归断言未改，
    `render-smoke` 的域 Tab 断言仍只校验「技能 / MCP 存在且无快捷消息」，不与第三
    Tab 冲突。
  - 报告：`notes/verify/jev-capability-decision/report.md`（含覆盖矩阵、关键断言、
    规格—实现偏差 F1/F2/F3/F4/F5 与真机验证状态）。
- 未验证 / 已知限制：真机浏览器未执行（隔离 `DSH_HOME` + 同版本外壳未搭建）；hero
  `useInput` 实机可用性、冷会话排队后首条消息是否真正生效、首次配置保存后事件链
  仍建议真机补验（见报告 §8–§9）；Windows 上 POSIX mode 语义不生效（记录 warning，
  不阻断保存）。

## [1.3.4] - 2026-10-23

### 变更

- **MCP「工具与参数」改为手风琴**：工具列表行只显示工具名 + 参数个数（不再显示
  description）；点击工具名在该行**下方**展开参数表，再点收起，同一时间只展开一个。
  展开/收起只改本地状态，不重新探测。
- 工具行显式 `outline:none`（`focus-visible` 用内描边代替），修掉鼠标点击后左侧留下的
  白色焦点竖条。

### 内部

- `src/client/mcp-panel.tsx`：`ToolsInspector` 由左右两栏改为手风琴；删除两栏相关
  内联样式常量与 description 渲染。
- `src/client/styles.ts`：删除 `.skp-inspector*` / `@container` 规则，新增
  `.skp-tool-accordion` / `.skp-tool-item(-open)` / `.skp-tool-trigger` /
  `.skp-tool-chevron` / `.skp-tool-count` / `.skp-tool-body`。
- 构建 / 测试：
  - `pnpm typecheck` — exit 0，无类型错误。
  - `pnpm build` — exit 0；`lib/client.js` 343.16 kB（gzip 81.96 kB）、`lib/client.map` 529.28 kB。
  - `bash notes/verify/run-all.sh` — exit 0（render-smoke 20/20、bug1-e2e 21/21、
    mutation controlOk:true、loader-behavior 81/81、probe-connectivity 12/12、baseline PASS 等）。
  - `node notes/verify/panel-upgrade.test.mjs` — **86/86**（8 条手风琴断言：默认收起、
    行文本不含 description、点击行下展开、再点收起、单开、不重新探测、focus-visible
    内描边且旧 `.skp-inspector` 规则已移除）。
- 版本号：`1.3.4`（工具参数面板交互调整）。

## [1.3.3] - 2026-10-23

### 修复

- **切换工作区时整页闪烁**：`useAsyncList` 重新加载时只要已有数据，就保留列表/详情框架
  （不再卸载 `.skp-body`）；只有首次加载（数据尚未到达）才显示「加载中…」。点项目名/
  切工作区时页面不再闪一下。
- **MCP「工具与参数」窄容器被压扁**：两栏改为 `.skp-inspector` / `.skp-inspector-list` /
  `.skp-inspector-pane` 类；详情区设为容器查询上下文，`@container (max-width:620px)` 时
  自动改为上下堆叠（工具列表在上、参数表在下），宽详情仍保持左右两栏；左列表
  `min-width:220`，不会被右栏 min-content 压成细条。

### 内部

- `src/client/panel.tsx` / `mcp-panel.tsx`：数据到达后的重载不再以 loading 卸载 body；
  ToolsInspector 改用 CSS 类 + 容器查询。
- `src/client/styles.ts`：新增 `.skp-inspector*` 与容器查询规则；`.skp-detail-inspect`
  增加 `container-type:inline-size`。
- 构建 / 测试：
  - `pnpm typecheck` — exit 0，无类型错误。
  - `pnpm build` — exit 0；`lib/client.js` 345.12 kB（gzip 82.65 kB）、`lib/client.map` 532.19 kB。
  - `bash notes/verify/run-all.sh` — exit 0（render-smoke 20/20、bug1-e2e 21/21、
    mutation controlOk:true、loader-behavior 81/81、probe-connectivity 12/12、baseline PASS 等）。
  - `node notes/verify/panel-upgrade.test.mjs` — **84/84**（新增：数据在途切工作区不卸载
    `.skp-body`、仅首次显示加载；`.skp-inspector*` 类与 `@container (max-width:620px)` 堆叠规则）。
  - 负控制：回退 gating 后 81/84，失败项恰为新增的三条“不闪”断言。
- 版本号：`1.3.3`（交互稳定性修复）。

## [1.3.2] - 2026-10-23

### 修复

- **全局 scope 下左侧工作区列表被隐藏**：v7 实现只在 project scope 渲染工作区列表，
  点「全局」后列表消失、无法直接切到其它工作区。现在两种 scope 都保留「项目」下方的工作区
  列表；点任一工作区会切回 project scope 并钉选该工作区。
- **MCP 行 hover/选中底色错位**：底色原先只落在左侧卡片（`.skp-row`），右侧「默认」开关
  落在底色之外，hover 时像被切成两块。现在 hover/选中底色放在整行 wrapper
  （`.skp-row-wrap` / `.skp-row-wrap-active`），右侧开关与卡片处于同一块高亮内。

### 内部

- `src/client/panel.tsx` / `mcp-panel.tsx`：工作区列表去掉 scope 条件；选中工作区时
  `setScope("project")`；MCP 行 `<li>` 增加选中类。
- `src/client/styles.ts`：`.skp-row-wrap` 承载 hover/选中底色，`.skp-row` 在其内透明。
- 构建 / 测试：
  - `pnpm typecheck` — exit 0，无类型错误。
  - `pnpm build` — exit 0；`lib/client.js` 345.06 kB（gzip 82.64 kB）、`lib/client.map` 532.45 kB。
  - `bash notes/verify/run-all.sh` — exit 0（render-smoke 20/20、bug1-e2e 21/21、
    mutation controlOk:true、loader-behavior 81/81、probe-connectivity 12/12、baseline PASS 等）。
  - `node notes/verify/panel-upgrade.test.mjs` — **75/75**（新增：两种 scope 下 nav 工作区列表
    均可见；全局态点工作区 → 项目 scope + selectProject + 条目；MCP 选中行 `.skp-row-wrap-active`；
    CSS 含整行 hover 规则）。
- 版本号：`1.3.2`（交互缺陷修复）。

## [1.3.1] - 2026-10-23

### 变更

- **v7 IA 调整：工作区列表移入左导航**：工作区列表从中间列移到左 ScopeNav「项目」行下方
  （**仅 project scope 显示，global scope 隐藏**；行高 34、名称 = 文件夹 basename、`title` =
  完整路径、选中态 = 高亮 + 左侧 2px 蓝条、列表在 nav 内自身滚动）；中间列只保留标题 + 条目，
  项目未选工作区时显示居中空态「请选择左侧工作区」；**删除「‹ 工作区」返回行**。未选工作区时
  头部搜索过滤左导航工作区名/路径，已选后 nav 保持完整、搜索只过滤中间列条目。全局/项目行
  右侧「+」入口不变。
- 设计源切到 Figma 页 `Capability Panel · 交互原型 v7`（2 帧，技能 · 项目 / MCP · 项目），
  预览 `docs/figma/preview/v7-01-skills-project.png`、`v7-02-mcp-project.png`；v6 的 4 帧
  与预览转为上一版留档。
- 宽度取舍：实现沿用「中列 280 + 详情 694（内容 646，目录树常驻 200）」，不采用 v7 原型
  的 300/676；v7 帧中列标题的蓝色「+」**不补入实现**——添加入口只保留在「全局 / 项目」行
  右侧（避免两套入口）。

### 内部

- `src/client/panel.tsx` / `mcp-panel.tsx`：工作区列表移入 ScopeNav（`.skp-scope-workspaces` /
  `.skp-scope-workspace[-active]`），中间列删除 `.skp-workspace-pane` / `‹ 工作区` 返回行；
  搜索两口径（未选工作区过滤 nav，已选过滤条目）。
- 构建 / 测试：
  - `pnpm typecheck` — exit 0，无类型错误。
  - `pnpm build` — exit 0；`lib/client.js` 344.47 kB（gzip 82.52 kB）、`lib/client.map` 531.67 kB。
  - `bash notes/verify/run-all.sh` — exit 0；render-smoke 20/20、bug1-e2e 21/21、
    mutation-negative-control `controlOk:true`、composer-api-cache 7/7、workspace-items-key 10/10、
    api-two-instances 17/17、loader-behavior 81/81、probe-connectivity 12/12、
    mcp-connectivity-baseline PASS、lib 产物 loader 81/81。
  - `node notes/verify/panel-upgrade.test.mjs` — 70/70（v7 IA：工作区列表在 nav 内且 global
    隐藏 / 中间列提示空态 / 无返回行 / 两种搜索口径 / 行尾开关 / 文件树与阅读器 / MCP 参数表 /
    删除确认 / 未选工作区置灰）。
- 版本号：`1.3.1`（在 1.3.0 已推送基础上的交互布局修订）。

## [1.3.0] - 2026-10-23

### 新增

- **能力面板两域计数**：域 Tab 收敛为「技能 / MCP」并带条目计数（技能 = 项目 + 全局条目数，
  MCP = 项目 + 全局配置条目数、不含外部注入）。
- **双作用域呈现（v2 形态，第三轮已演进）**：先在同一个列表里用「本项目 / 全局」两组同屏呈现
  （组头 = 标题 + 计数 + 一句说明，组内独立滚动，空组折叠为一行引导）；**第三轮改为左导航 +
  项目按工作区下钻，v7 再把工作区列表收进左导航，见「变更」两条 IA 调整**。
- **行尾统一开关**：列表每行右端只有一个「label + 30×18 开关」，点击不改变选中、失败回滚、
  写后静默重拉。技能行 =「启用」（项目条目整体启停 `setEnabled`；全局条目 = 在本项目禁用/恢复
  `disableInProject` / `enableInProject`；项目屏蔽占位 = 恢复；只读、`项目副本生效中`、
  无工作区时置灰并给 tooltip）；MCP 行 =「默认」（语义不变：新建对话是否启用，写项目级 overrides）。
- **技能详情「目录树 + SKILL.md 阅读器」**：根目录 → 文件夹（`/` + 文件计数、可展开）→ 文件
  （类型徽标 `MD`/`JSON`/`PNG`… + 大小），14px 缩进 + 1px 引导线，`SKILL.md` 置顶并默认选中；
  点击文件 1 次切换内容（一次拉全量后本地缓存，切换 0 请求）；「预览 / 源码」切换，预览走零依赖
  Markdown 渲染（标题/列表/代码块/引用/分隔线/行内 code 与粗体；不解析内联 HTML、不加载外链图片、
  无 `dangerouslySetInnerHTML`，渲染器异常时回落 `<pre>` 原文）。上限：单文件预览 256 KB、
  目录 200 文件、树深 3 层；二进制 / 空文件 / 截断各有降级；窄容器（内容区 < 632px）目录树
  折叠为「文件 (N)」下拉。
- **MCP「工具与参数」左右两栏**（配置条目与外部注入共用 `ToolsInspector`）：左列工具清单
  （工具名 + 说明，可点选），右列参数表（参数 / 类型 / 必填 / 说明），数据来自 `inputSchema` 的
  `properties` + `required`；探测成功默认选中第一个工具，切换工具只换右栏、不重新探测；
  外部注入直接用运行时注册表数据（不需要重连）。
- 关系标签可点击互跳：`覆盖全局` / `项目副本生效中` / `本项目已禁用` 等会切到另一 scope 并选中同名条目（第三轮行为）。

### 变更

- **第三轮 IA 调整（v7 的基础）**：头部第二行改为「域 Tab（左）+ 搜索框（右）」，删除视图内搜索 / 安装工具条；
  左列新增 ScopeNav「全局 / 项目」，每行右端「+」为安装 / 添加入口（项目未选工作区时置灰）；
  项目 scope 改为**工作区下钻**——先选工作区再显示该工作区条目（v7 进一步把工作区列表移入
  左导航，见上一条）；全局 scope 只显示全局条目，MCP 的「外部注入」从独立第三组归入全局
  scope 的第二组（保留组头与计数，仅非空时出现）。
- 删除上一版「同屏双组」布局与双组组头；详情宽度 864 → 694（内容 816 → 646），
  目录树 220 → 200、阅读器 580 → 430；内容宽 < 632 时目录树折叠为下拉的阈值随之调整。
- 搜索语义收敛：只过滤**当前可见列表**，不跨 scope；**未选工作区时过滤左导航工作区名/路径，
  已选后工作区列表保持完整、只过滤中间列条目**（v7 口径）；切 scope / 工作区保留搜索词，
  切域清空；技能全局标题在搜索时显示「匹配/总数」。
- 空态按 scope 重划：全局空态、左导航工作区空态（没有工作区 / 无匹配）、中间列「请选择左侧
  工作区」提示、项目空态；全局条目在未选工作区时项目级动作（安装到本项目 / 在本项目禁用 /
  行尾开关）置灰。
- 面板 IA（上一轮）：取消「项目 / 全局」二选一 Tab（删除 `ZoneTabs`），域 Tab 只剩技能 / MCP；
  头部「项目作用域」钉选行为不变（第三轮保留，并与左导航工作区选择共用同一状态）。
- 列表行：删除行内文字动作按钮（安装 / 禁用 / 导出 / 删除等），其余动作全部收进详情动作区；
  技能状态点**仅项目行**保留（绿 / 蓝 / 灰 / 空心），全局行改用关系标签；MCP 三组行均保留
  状态点（绿 / 蓝 / 橙 / 红 / 灰）。
- 技能删除由「两击确认」改为**确认对话框**（`Modal`，写明作用域后果，`Esc` 取消）；
  MCP 删除 / 移出与引用覆盖仍为两击确认。
- MCP 详情：原「查看工具与参数」的卡片式报告改为两栏 Inspector；「使用记录」保留
  （只读、内存、不落盘）。
- 域 Tab 计数口径：技能含只读与屏蔽占位、不去重；MCP 不含外部注入（外部注入在全局 scope 的
  第二组单独计数，且仅非空时出现）。
- 安装/添加对话框的作用域默认跟随所点位置：左导航全局行「+」= 全局、项目行「+」= 该项目的工作区；
  项目未选工作区时项目侧「+」置灰。

### 移除

- **快捷消息模块整体下线**：面板域 Tab、列表 / 详情 / 安装对话框、`quick.*` RPC 端点、宿主
  `quickMessages` 服务与 `src/quick-messages/**`、`src/client/quick-messages-panel.tsx`、
  `src/client/composer-quick.tsx`；`overrides` / `imports` 的域键收敛为 `mcp`（旧文件里的
  `skills` / `quickMessages` 键读取时忽略、写盘时清除）。
- 用户数据 `.agents/quick-messages.json`（项目 / 全局及旧位置 `.dsh`）**不再读写、文件原样保留**；
  卸载也不会删除（需要清理请手动处理）。
- 面板「项目 / 全局」二选一 Tab 与 `ZoneTabs` 组件、行内文字动作按钮，以及 `在文件树中查看` /
  `查看项目副本` 两个辅助入口（分别由目录树与可点击关系标签覆盖）。

### 内部

- 技能内容区**复用 `skills.export`**（`exportSkillFiles` 已递归返回相对路径 + base64），
  **不新增宿主 RPC**；新增 `src/client/skill-content.tsx`（建树 / 阅读器 / 解码 / 上限）与
  `src/client/markdown.tsx`（零依赖 L1 渲染）。
- `src/client/mcp-panel.tsx` 新增 `ToolsInspector` 与参数表；`src/client/styles.ts` 新增
  `.skp-group*`、`.skp-file-tree*`、`.skp-file-picker*`、`.skp-reader*`、`.skp-md-*`、
  `.skp-params*` 等样式（纯自绘、只用宿主 token 与回退值）。
- 列表面板改为 `listbox` 语义 + 行尾开关；选中项、按 scope / 工作区记忆的滚动位置与搜索词在
  静默刷新后保持。
- 构建 / 测试：
  - `pnpm typecheck` — exit 0，无类型错误。
  - `pnpm build` — exit 0；`lib/client.js` 328.57 kB（gzip 79.36 kB）、`lib/client.map` 511.00 kB，`lib/quick-messages/**` 死产物已清理。
  - `bash notes/verify/run-all.sh` — exit 0；render-smoke 19/19、bug1-e2e 21/21、
    mutation-negative-control `controlOk:true`、composer-api-cache 7/7、workspace-items-key 10/10、
    api-two-instances 17/17、loader-behavior 81/81、probe-connectivity 12/12、
    mcp-connectivity-baseline PASS、lib 产物 loader 81/81。
  - `node notes/verify/panel-upgrade.test.mjs` — 55/55（第三轮 IA：2 Tab / 左导航与「+」/
    工作区下钻与返回 / 当前列表搜索 / 行尾开关语义 / 文件树与阅读器 / 源码视图 / MCP 两组与
    参数表 / 删除确认 / 未选工作区置灰）。
- 版本号：`1.3.0`（本批功能与移除均属用户可见变更，minor bump）。

## [1.2.0] - 2026-10-23

### 新增

- **会话能力配置（Skills / MCP）两个入口**：首屏（hero）输入框下方默认展开的能力面板、会话内顶部
  「能力」Tab（`conversation.view`）整页管理；均为 Tab + 卡片网格，卡片右上角开关只写**当前会话**，
  附搜索、`恢复默认`、`管理全部`。打开「能力」Tab 时临时隐藏输入框，切回其它 Tab 恢复。
  - **Skills 会话级开关（关闭 / 恢复）**：宿主 skills 注册表没有按会话禁用 API，改为在
    `agent.ctx.get("skills")` 上注册同名 runtime shadow（`invocation` 双向 false），从模型目录 /
    `skill` 工具 / `/name` 注入三条链路隐藏；恢复即解除。只可关闭、不能强制开启文件级禁用项；
    会话无 live agent 时置灰。纯内存、不落盘。
  - **MCP 会话级开关（服务器级）**：复用既有 `mcp.setSessionEnabled`（项目条目按需挂载/卸载，
    global/外部实例 `tools.restrict` 屏蔽），`mcp.list` 带 `sessionId` 投影 `enabledInSession`；
    写后 `settling` 轮询收敛。
  - 新增 RPC `skills.sessionList` / `skills.setSessionEnabled`（信封契约不变）；新增
    `src/skills/session.ts`、`src/client/composer-capability.tsx` 与 `skp-dock-*` / `skp-cap-view`
    样式（只用宿主 `--dsw-*` token）。

### 变更

- 移除输入框左下角原来的三个快捷按钮（快捷消息 / Skills / MCP）及其弹层；快捷消息仍可在侧栏能力面板
  管理。旧的 `composer-quick.tsx` / `composer-skills.tsx` / `composer-mcp.tsx` 组件代码保留未注册，
  便于回退。
- 移除上一轮原型里的「输入框下方常驻能力条」（`conversation.composer.dock`）与后续临时加的输入框
  「能力」图标/快捷弹层：会话中只保留顶部「能力」Tab，首屏保留输入框下方内联面板。
- 移除多重面板头部多余的「仅本会话」标签；hero 收起条宽度与输入卡严格对齐。

### 内部

- 验证：`pnpm typecheck` / `pnpm build` 通过；`notes/verify/session-skills.test.mjs` PASS 11；
  `notes/verify/capability-dock-render.mjs` 30/30；`notes/verify/run-all.sh` 全绿
  （bug1-e2e 的 `composerApiFor` 计数断言调整为 ≥3；按钮预取改为能力按钮的计数角标）。
- 新增 `notes/verify/dock-visual.mjs`：真实 Chromium 视觉 harness，覆盖 hero 收起/展开、快捷弹层、
  顶部 Tab 整页与窄容器。

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

[1.6.1]: https://github.com/xx529/dsh-capability-settings/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/xx529/dsh-capability-settings/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v1.4.3...v1.5.0
[1.4.3]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v1.4.2...v1.4.3
[1.4.2]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v1.3.4...v1.4.0
[1.3.4]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v1.3.3...v1.3.4
[1.3.3]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v0.8.0...v1.0.0
[0.8.0]: https://github.com/chengdb/dsh-plugin-capability-panel/releases/tag/v0.8.0