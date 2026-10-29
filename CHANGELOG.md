# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 修复

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