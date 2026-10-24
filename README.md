# dsh-capability-settings

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件：
在 Web GUI 里**可视化管理项目的全部能力**——Skills 与 MCP 服务器，覆盖
**全局级 / 项目级（逐工作区）**双作用域。安装、启停、内容浏览与分发都能
**不离开浏览器**完成。

面板还内置 TypeSafe Jev「能力决策」：按当前输入草稿为**本会话**预选技能 / MCP，
一次请求批量打 0–1 分，可手动点按，也可按输入停顿自动触发（默认关闭）。

![能力面板 v7 · 技能 · 项目（工作区列表在左导航）](docs/figma/preview/v7-01-skills-project.png)

> **界面版本提示**：顶部截图是 **v7 预览**（工作区列表在左导航）；文中「技能详情」
> 「MCP 详情」两张仍是 **v6 预览（上一版）**——详情区在 v7 未改版式，仅中列/导航变化。
> **这些截图都不含第三个域 Tab「Jev 模型」与首屏「✦ 能力决策」**（v10/v11 新增）；
> 新界面见 `docs/figma/preview/v11-*.png`（5 帧）与下文「Jev 能力决策」。当前 IA 说明见
> 「一个面板，管住三个能力域」与 [docs/ux/panel-upgrade.md](docs/ux/panel-upgrade.md)。

> **外壳版本要求**：侧栏入口用的是 root 作用域的 `sidebar.panellist` 槽
> （「全局面板」图标排）与同 id 的 `main` keyed 槽，**需要 dsh 外壳 ≥ 0.2.0-rc.2**
> （桌面应用 0.2.0-rc.2 即有；更早的 `0.1.2-alpha.2` 只有 `sidebar.footer.action`，
> 那时入口与主区域面板都不会注册——升级外壳即可）。

## 它能做什么

| 能力域 | 浏览/搜索 | 新增/安装 | 编辑 | 启用/禁用 | 删除 | 导入/导出 |
|---|---|---|---|---|---|---|
| **Skills** | ✅ 左导航「全局 / 项目」+ 头部搜索 + 项目按工作区下钻 + 详情（目录树 + `SKILL.md` 阅读器，预览/源码） | ✅ 上传 / 宿主路径 / URL 三种来源 | ✅ | ✅ 行尾「启用」开关（项目区启停；全局 = 在本项目禁用/恢复）+ 详情页模型/用户方向独立开关 | ✅ 确认对话框 | ✅ 导入到本项目（物理副本）/ 在本项目禁用（屏蔽占位）/ 下载 zip / 复制到宿主目录 |
| **MCP 服务器** | ✅ 全局（含外部注入第二组）/ 项目按工作区下钻 + 实时挂载状态 + 行尾「默认」开关 + 工具与参数手风琴 | ✅ 表单新增（stdio/http）+ JSON 导入 | ✅ | ✅ 「默认」开关（新建对话）+ 当前对话开关（会话能力配置）+ 项目条目详情启停 | ✅ 两击确认 | ✅ 导入到本项目（引用，跟随全局）/ `.mcp.json` 与 Claude Code 格式兼容 |

> 上表是两个**条目域**（技能 / MCP）。面板另有第三个域 Tab **「Jev 模型」**：它不是条目管理，
> 而是 TypeSafe Jev 的全局配置页（第三 Tab 无计数、无搜索、无左导航），并驱动首屏
> **「✦ 能力决策」**。详见下文「Jev 能力决策」。

## 配置文件位置

本插件的配置文件**写入优先用 `.agents` 目录**，读取兼容旧位置与跨工具生态
（例外：Jev 能力决策配置独立存放在 dsh home 的插件目录，见下表末行）：

| 配置 | 写入目标 | 读取兼容（旧位置） |
|---|---|---|
| 项目级「默认关闭」声明（MCP 面板的「默认」开关） | `<项目根>/.agents/capability-overrides.json` | `.dsh` → `.claude` |
| 项目级「全局能力引用」声明（MCP 的「导入到本项目」） | `<项目根>/.agents/capability-imports.json` | — |
| 全局 MCP 服务器 | `~/.agents/mcp.json` | `~/.dsh` → `~/.claude` |
| Skills（项目/全局） | `.agents/skills`、`~/.agents/skills` | `.dsh/skills`（可写）、`.claude/skills`（只读展示） |
| 项目 MCP 服务器 | `<项目根>/.mcp.json`（Claude Code 标准，位置不变） | — |
| 快捷消息（**已下线**） | **不再读写** | 旧文件 `<项目根>/.agents/quick-messages.json`、`~/.agents/quick-messages.json`（以及旧位置 `.dsh` 同名文件）**原样保留**，不会自动删除；需要清理请手动处理 |
| Jev 能力决策配置（TypeSafe Jev） | `<dshHome>/dsh-capability-settings/jev.json`（默认 `~/.dsh/dsh-capability-settings/jev.json`；目录权限 `700`、文件权限 `600`） | 旧目录 `~/.dsh/capability-panel/jev.json` 首次读取时自动迁移（`rename`，幂等）；不读写 `~/.agents/jev.json` |

首次写入新位置时，旧文件内容会自动**并入并删除**（不丢配置、不留两份）。
`.agents` 与 `.dsh` 同时参与"项目根"判定（`.claude` 也纳入），换目录 / 换
工具搬家都不会影响配置归属。

## 亮点

### 🗂 一个面板，管住三个能力域

侧栏**上方**（品牌/新建会话行之下、工作区列表之上）新增「能力面板」入口，
点击后像「插件 / 自动化任务 / Context」那样**占据主区域**（不再是浮层，也不
会挤压对话区）。

**头部两行**：第一行 =「能力面板 · 当前工作区路径 · 项目作用域下拉」；
第二行 = **左侧域 Tab**（「技能 / MCP / Jev 模型」；技能与 MCP 带条目数量，形如
「技能 12」「MCP 9」，`Jev 模型` 无计数）+ **右侧搜索框**（只在技能 / MCP 显示，
按域切换 placeholder）。视图内不再有搜索/安装工具条——搜索与添加都收进头部与左导航。
点 **Jev 模型** 时：第一行的「工作区路径 / 项目作用域下拉」与第二行搜索框隐藏，
内容区为单列配置页（无左导航、无列表 / 详情）。

**左导航 = 全局 / 项目**：两行，行右侧各有一个「+」用于安装技能 / 添加 MCP
服务器（项目行在未选工作区时置灰，tooltip「先选择工作区」）。

- 左导航「项目」行下方**常驻列出全部工作区**（全局 / 项目两种 scope 都显示）——
  名称 = 文件夹 basename，`title` = 完整路径；点击即钉选该工作区，选中行高亮 +
  左侧蓝条。工作区多时列表在左导航内自身滚动；**没有「‹ 工作区」返回行**。
  **在「全局」scope 下点工作区会自动切回「项目」scope 并钉选**。
- 点 **全局**：中间列只列全局条目（`~/.agents/skills`、`~/.agents/mcp.json`）；
  MCP 还会在下方显示第二组「外部注入」（运行时注入的只读实例，组头带计数，
  为空时不占位）。左侧工作区列表此时仍保留，可直接切项目。
- 点 **项目**：中间列显示已钉选工作区的 `.mcp.json` / 项目技能；未钉选时只给一句
  「请选择左侧工作区」（工作区列表在左导航，不占中间列）。头部「项目作用域」下拉
  与左导航选择是**同一个状态**，两边同步。
- 默认进入「项目」scope；若还没选过工作区，中间列只给一句「请选择左侧工作区」。
- **切换工作区 / 刷新不闪加载**：已有数据时采用 stale-while-revalidate——列表与详情
  框架保留、后台静默重拉；只有首次进入（尚无数据）才显示「加载中…」。
- 搜索只过滤**当前可见列表**，不跨 scope：**未钉选工作区时（任意 scope）**过滤
  左导航工作区名/路径；已选工作区后左导航保持完整、只过滤中间列条目。技能全局列表
  的标题计数在搜索时显示「匹配/总数」。

![能力面板 v7 · 技能 · 项目](docs/figma/preview/v7-01-skills-project.png)

> Jev 模型 Tab 与「✦ 能力决策」为 v10/v11 新增，上面这张 v7 截图不含它们；
> 新界面见 `docs/figma/preview/v11-05-config.png`（配置含能力决策）与
> `v11-01..04-*.png`（入口 / 停顿 / 评分中 / 结果）。

### 📥 Skills：三种方式安装，一键导出分享

- **浏览器上传**：拖入单个 `.md`、整个 skill 目录、或 `.zip` 压缩包
  （浏览器端 DecompressionStream 解压，零依赖）；路径防穿越，
  200 文件 / 20MB 上限。
- **宿主路径**：把磁盘上已有的 skill 目录或 `.md` 复制进受管根。
- **URL 下载**：GitHub 仓库（`https://github.com/<owner>/<repo>`，可带
  `/tree/<branch>/<子目录>`）、任意 `.zip`、raw `.md`
  （宿主端 30MB / 30s 限速）。

压缩包/仓库归档自动剥离公共顶层目录并定位唯一 `SKILL.md`；落盘名以
frontmatter 的 `name` 为准，同名冲突报错、可选覆盖。磁盘格式与官方
filesystem provider **逐字节兼容**（flat `<name>.md` / 目录型
`<name>/SKILL.md`），装完立刻可被 agent 调用。安装目标在安装对话框中选定
（「安装到本项目」/「安装到全局」，默认本项目；无工作区时只能装全局）。

导出同样简单：flat skill 直接下载 `.md`，目录型 skill 在浏览器端打成
store-only zip；也可以复制到宿主任意目录。

### ⚡ 行尾统一开关：一眼看清、一次点完

v2 把手写文字按钮全部收进详情，**列表每行右端只有一个开关**（30×18）：

- **技能行 =「启用」**：
  - 项目普通条目：开 = 模型与用户均可用；关 = 写入
    `user-invocable: false` + `disable-model-invocation: true`（一键禁用）；
  - 全局条目：开/关表达**本项目**是否禁用——关 = 生成屏蔽占位
    （shadow stub，只影响本项目），开 = 删除占位恢复；
  - 项目屏蔽占位行：拨到开 = 恢复同名全局技能；
  - **置灰不可点**：只读来源（`.claude`）、全局条目已被项目副本遮蔽
    （`项目副本生效中`）、无可用工作区；tooltip 写明原因。
- **MCP 行 =「默认」**：开 = 新建对话默认启用，关 = 默认关闭（写项目级
  overrides 的 mcp 列表，语义与旧版一致）。外部注入实例同样有该开关
  （不可按项目屏蔽时置灰）。

点击开关**不改变选中**，写后就地静默刷新（失败回滚 + 详情错误条）。
列表圆点：技能**仅项目行**保留状态圆点（绿 = 双开、蓝 = 部分禁用、灰 = 全禁用、
空心 = 只读/屏蔽占位），全局行用关系标签表达；MCP 的行（含外部注入）都有圆点
（绿 = 已挂载 / 蓝 = 启用未挂载 / 橙 = 默认关闭或冲突 / 红 = 挂载失败 / 灰 = 禁用）。

详情页的动作区则保留完整操作：**状态按钮（已启用/已禁用/部分禁用）、
导出、导出到路径…、删除**；全局条目多出「安装到本项目」「在本项目禁用 /
恢复」；只读条目只保留导出与复制路径。**技能删除走确认对话框**（列出作用域
后果，`Esc` 可取消）；MCP 的删除/移出仍为两击确认。调用方式仍可**按方向
细调**：详情「调用方式」字段上「模型调用」与「用户调用」两个方向各自独立
开关（例如只允许 `/name` 手动触发、不让 agent 自动注入）。

### 📖 Skills 详情：目录树 + `SKILL.md` 阅读器

详情主区域拆成左树右阅读器（目录型技能；flat 单文件技能隐藏树、阅读器占满）：

- **目录树**：根目录行 `▾ <技能名>/` → 文件夹行（`/` + 文件计数，可展开/收起）
  → 文件行（类型徽标 `MD`/`JSON`/`PNG`… + 文件名 + 大小）。14px 层级缩进 +
  1px 引导线，`SKILL.md` 恒置顶并默认选中；点击任一文件 1 次即切换内容
  （一次拉全量后本地缓存，切换不再发请求）。
- **阅读器**：标题为当前文件名（+ 大小/类型），正文可切「预览 / 源码」——
  预览走**零依赖轻量 Markdown**（标题/列表/代码块/引用/分隔线/行内 code 与
  粗体；不解析内联 HTML、不加载外链图片、无 `dangerouslySetInnerHTML`），
  源码显示含 frontmatter 的原文。长文件只在阅读器内部滚动。
- **降级**：二进制文件给「无法预览」+ 下载；空文件给提示；单文件超过
  256 KB 只预览前 256 KB 并提示下载完整文件；目录最多展示 200 个文件、
  树深 3 层（超出截断并提示）。
- **数据通道**：复用既有 `skills.export`（它已递归返回目录下全部文件的
  相对路径 + base64），**没有新增宿主 RPC**；目录树与内容全部在客户端组树、
  解码与缓存。窄容器（内容区 < 632px）时目录树折叠为「文件 (N)」下拉，
  阅读器占满宽度。

![技能详情（v6 预览，v7 未改版式）：目录树 + SKILL.md 阅读器](docs/figma/preview/v6-02-skill-detail.png)

### 🗃 Skills：全局 / 项目分离，项目级控制落实为真实文件

技能按来源分进「全局」与「项目」两个 scope（左导航切换；项目的工作区列表也挂在左导航
「项目」行下方），各自按真实文件列举——全局 = `~/.agents/skills` 等，项目 = 选中工作区的
`<项目>/.agents/skills` 等。
同名关系直接在行上标出，点击关系标签会切到另一 scope 并选中对应条目
（全局 → 项目时若还没选工作区，会尝试自动进入当前会话工作区）：

- 项目有同名副本 → 项目行 `覆盖全局`，全局行 `项目副本生效中`；
- 全局被本项目禁用 → 全局行 `本项目已禁用`，项目组出现 `屏蔽占位` 行；
- 全局行一律没有圆点（全局技能对所有项目可见），状态由标签与开关表达。

项目级控制全部落实为项目区里的**真实文件**（副本或屏蔽占位），启停只写
skill 文件自己的 frontmatter，由宿主的文件 watcher + 目录重发布原生生效
（下一步即注入/剔除），没有写在插件私有配置里的叠层状态。

- **安装到本项目 / 导入到本项目**：把全局 skill（目录型连资源）**物理复制**
  到 `<项目>/.agents/skills`，此后在本项目对这份副本的一切控制都是项目级的；
  导入是**快照**，全局后续更新不会同步，项目内同名冲突可选覆盖；
- **在本项目禁用 / 恢复**（shadow stub 屏蔽占位）：在项目
  `.agents/skills` 生成同名占位文件（frontmatter 双向禁用 +
  `metadata: capability-panel: shadow-stub` 标记）。宿主按 frontmatter name
  合并技能、项目根 rank 恒高于全局根，占位文件于是**顶掉**同名全局条目——
  catalog 注入、`skill` 工具调用、`/name` 用户注入三条链路都在本项目内被
  宿主原生拒绝（其它项目不受影响）。删除占位即恢复；
- 提醒：**agent 侧的可见性以宿主 registry 为准**。要让某全局 skill 在本项目
  停掉 agent 自动触发，用「在本项目禁用」（整体屏蔽），或先导入到本项目、
  再在项目副本的详情里关闭「模型调用」（保留 `/name` 手动触发的细粒度控制）。

### 🔌 MCP：改配置即热挂载，不重启、不改 preset

- 配置文件与 **Claude Code 的 `.mcp.json` 格式兼容**：项目级
  `<projectRoot>/.mcp.json`，全局级 `~/.agents/mcp.json`（读取兼容旧位置
  `~/.dsh/mcp.json`），同名 key 项目级覆盖全局级；`env`/`headers`/`args`
  支持 `${VAR}` 环境变量插值。
- 列表按**左导航 scope** 组织：**全局**（`~/.agents/mcp.json`；可导入到本项目 =
  登记引用、编辑、删除）+ 下方第二组**外部注入**（运行时由其它插件/profile
  挂载的实例，只读，仅在该组非空时出现）；**项目**（先选工作区，显示该工作区
  `.mcp.json`，可启停/编辑/删除）。左导航工作区列表在两种 scope 都常驻，全局态点
  工作区会自动切回项目并钉选。
- 列表行的 **hover / 选中底色覆盖整行**（含右侧「默认」开关），不是只覆盖左侧卡片。
- 全局级 `<agentsHome>/mcp.json` 的条目**整个 harness 只挂一份实例**（挂在
  本插件自己的 Cordis context 上，`serverName` 按 root 作用域预留，各 session
  共用同一个 MCP 进程）；**项目级** `<项目根>/.mcp.json` 的条目仍挂在 agent
  自己的 Cordis context 上——工具以 `mcp__<serverName>__<tool>` 出现在**该
  session 内**，同一工作区里各 session 各一份、彼此隔离，agent 销毁自动卸载。
- **「工具与参数」是手风琴**：每个工具一行，只显示**工具名 + 参数个数**（不显示
  description）；点工具名在**该行下方**展开参数表（**参数 / 类型 / 必填 / 说明**，
  来自该工具 `inputSchema` 的 `properties` 与 `required`），再点收起；**同一时间
  只展开一个**，默认全部收起，展开/收起不会重新探测。配置条目由「查看工具与参数」
  真连一次（零副作用，`finally` 关闭、不注册工具、不留子进程）；**外部注入实例**
  直接用运行时注册表里的工具与参数渲染同一套手风琴，不需要重连。新增/编辑弹窗里的
  「测试连接」仍会列出工具与参数，与详情面板同一数据源。手风琴是单列宽度自适应，
  窄容器下不会出现工具列表被压成细条；工具行鼠标点击不显示焦点环，键盘聚焦用内描边。
- **MCP 有「默认开关」和「当前对话开关」两级**：
  - 面板 MCP 列表每行右端是**「默认」**开关（配置条目与外部注入实例都有）：
    写项目级"默认关闭"声明，**新建对话按它来**；已有对话在没有任何手动覆盖时
    也跟随它。外部实例同样适用（默认关闭只是"新建对话默认不启用"；按会话
    作用域注入的实例无法屏蔽，开关置灰）。
  - **当前对话开关**在会话内能力配置（首屏内联面板 / 顶部「能力」Tab）里：
    只影响当前对话、内存内不落盘；项目条目按需挂载/卸载，全局与外部实例用
    `tools.restrict` 屏蔽/恢复其工具。显式会话开关优先于默认。
  - 行尾「默认」**不是启停**：配置条目的启用/禁用在该条目的详情状态按钮与
    编辑表单里。
- **外部注入的 MCP 也能管理（只读 + 默认/当前对话开关）**：其它插件或 profile
  在运行时直接挂载的 `@deepseek-ai/dsh-mcp-client` 实例（不在本插件配置文件里）
  出现在全局 scope 的第二组「外部注入」——名称旁标 `外部` 与**来源插件**（如
  `dsh-to-figma`；来源来自 cordis 的 `Fiber.name`/loader 条目 id），详情给出
  只读原因提示条与字段（命名空间、来源、注入方式、传输方式、默认 / 当前对话、
  本次运行调用、管理说明），并可查看工具与参数、使用记录。它们
  **不可编辑/删除/卸载**（配置与生命周期在注入方）。
- 详情还有**「使用记录」**（只读、不落盘）：列出最近的调用——什么时候、哪个
  session（显示侧栏的会话标题，拿不到标题时显示会话 id 尾部）、调用了这个
  server 的哪个 tool；默认显示最近 50 条（宿主内存里最多留 200 条），打开期间
  每 2s 静默刷新。实现是宿主侧一个**全局 `tools.guard` 旁路**：只观察
  `mcp__<serverName>__<tool>` 调用、**永远放行**、异常吞掉，不写任何文件、
  不影响工具执行；插件重载或应用重启即清空。记录的是**调用尝试**（执行前），
  不代表该次调用成功。
- 面板里每次新增/编辑/删除/启停，都会**自动重挂受影响 session** 的 MCP 连接；
  但**写入不必等重挂**——RPC 只等配置文件落盘就返回，列表立刻刷新（删除/新增/
  启停都即时可见），重挂在后台按队列进行：重挂期间还没拿到状态的条目显示
  「挂载中…」，面板静默轮询直到挂载状态收敛，且不会闪「加载中…」。

![MCP v7 · 项目（左导航工作区列表 + 工具参数；截图为上一版两栏，1.3.4 已改手风琴）](docs/figma/preview/v7-02-mcp-project.png)

![MCP 详情（v6 预览，v7 未改版式）：外部注入只读](docs/figma/preview/v6-04-mcp-detail.png)

### 🎯 项目级控制全局能力

全局能力默认对所有项目生效。想只在某个项目里调整，各域都有落在真实文件/声明
上的机制（都不写插件私有的叠层状态）：

- **Skills**：「导入到本项目」物理复制出项目副本（此后项目内独立启停 /
  细调方向，快照不跟随全局）；或「在本项目禁用」生成屏蔽占位（shadow stub，
  整体屏蔽，删除即恢复）；
- **MCP**：「导入到本项目」登记**引用**（内容实时跟随全局，启停是引用上的
  项目级标记，写在 `.agents/capability-imports.json`）；全局条目的行尾
  「默认」开关写 `.agents/capability-overrides.json` 的 mcp 列表，决定新建
  对话是否默认启用；
- **全局实例的「关掉」靠 `tools.restrict`**：全局 MCP 实例是共享的、无法按
  项目卸载，所以按 session 在该 agent 作用域上 deny 掉
  `mcp__<serverName>__*`——全局配置不动、其他项目不受影响；宿主不提供
  `restrict` 时降级（记 warning + 状态标 `skipped`，工具对本会话仍可见）。

### 🎛️ 会话能力配置：首屏内联 + 顶部「能力」Tab

会话能力（Skills / MCP 服务器）的查看与开关分两个入口，**开关全部只作用于
当前会话、内存态、不落盘**，优先级
`显式会话覆盖 > 项目默认 > 配置 disabled`。输入框工具栏的快捷按钮与底部能力条
已按产品决定移除，会话内只保留下面两个入口：

- **首屏（hero）默认展开**：新会话首屏在输入框卡片正下方直接展示能力面板
  （Tab + 卡片网格，默认展开、无需点击）。外壳 hero 相位不渲染
  `composer.dock`，这里用 `conversation.input.dock` 的零高锚点 +
  `position: fixed` 面板，位置由输入卡 `[data-composer-card]` 的 rect +
  `ResizeObserver` 跟随，宽度与输入卡一致。
- **会话中：顶部「能力」Tab**（`conversation.view`，与「对话 / 轨迹 /
  上下文 / 编队」同级）：整页管理本会话 Skills / MCP，Tab 切换能力类型、
  卡片网格自适应列数、搜索、`恢复默认`。进入该 Tab 时会临时隐藏输入框
  （只做能力管理、不需要对话输入），切回其它 Tab 自动恢复。

语义（全部会话级）：

- **MCP（服务器级）**：项目条目按需挂载/卸载；global / 外部实例用
  `tools.restrict` 屏蔽/恢复工具，不卸载共享实例；即上文「当前对话开关」。
  写后宿主异步重挂，面板用 `settling` 800ms × 20 静默轮询收敛。
- **Skills（关闭 / 恢复）**：宿主注册表没有按会话禁用 API，本插件在**该
  agent 作用域**注册同名 runtime skill shadow（`invocation` 双向 false），
  使该 skill 从「模型目录 / `skill` 工具 / `/name` 用户口令」三条链路消失；
  恢复即解除 shadow。**只可关闭、不能强制开启文件级已禁用项**；会话没有
  live agent 时开关置灰。
- RPC：`skills.sessionList`（磁盘列表 + `enabledInSession` /
  `canToggleInSession`）、`skills.setSessionEnabled`；`mcp.list` 带上
  `sessionId` 后由宿主投影 `enabledInSession`。
- 切换会话 / 刷新页面 / 宿主重启后会话覆盖即失效，回到项目默认。

### 🧭 Jev 能力决策：按输入草稿为本会话预选能力

面板第三个域 Tab「Jev 模型」是 TypeSafe Jev 的全局配置页；配置完成后，新会话首屏
（hero）出现「✦ 能力决策」入口，按当前输入框草稿给本会话全部技能 / MCP 打 0–1 分，
勾选后只写成**当前会话**的能力开关。

**配置（全局，所有项目 / 会话共享）**

- 字段：Base URL（默认 `https://api.typesafe.ai`）、模型名（默认 `jev-latest`）、
  API Key 来源（`直接填写` / `环境变量`，默认变量名 `TYPESAFE_API_KEY`）、测试连接、
  保存、恢复默认（需行内再点一次确认，只重置表单）。保存成功**不关闭配置页、不跳转**。
- 密钥与路径：配置保存到宿主 `<dshHome>/dsh-capability-settings/jev.json`
  （默认 `~/.dsh/dsh-capability-settings/jev.json`；`DSH_HOME` 存在时以其为根；目录 `700` /
  文件 `600`）。宿主解析密钥的优先级是 **环境变量（`apiKeyEnv`）> 配置文件中的 key**；
  界面只显示来源与末 4 位（短 key 显示 `****`），浏览器 / RPC 响应都拿不到明文。
- 保存后无需刷新页面：下一次评分 / 测试立即使用新配置；首屏 hero 监听配置变更事件，
  并在窗口重新聚焦时重读配置。
- 「能力决策」区：`输入停顿后自动评分`（默认**关闭**）、停顿阈值（默认 `1000 ms`，
  `300–3000`、步长 `100`）、最少触发字数（默认 `10`，`1–200`）、
  最少修改间隔字符数（默认 `4`，`1–100`）；常驻成本提示与隐私说明。

**手动触发**

- 首屏 hero「本会话能力」面板头部 / 收起态能力条右侧的「✦ 能力决策」按钮；点击即评分，
  不依赖自动触发开关。草稿为空时按钮禁用；未配置 Jev 时按钮可点并带蓝点，点击
  跳到「Jev 模型」Tab 配置。
- 结果面板替换 hero 能力区内容（同宽、不遮输入框、不抢焦点），仅保留标题 / 模型徽标 /
  阈值滑杆 / 结果列表：分数降序（同分技能先于 MCP，再按名称）；阈值滑杆 `0–1`
  步长 `0.05`、默认 `0.50`，分数 ≥ 阈值预勾选；可手改勾选；显示 `已选 n / N`
  （N = 全部参与评分的技能 + MCP，含不可切换项）；底栏「重新评分 / 取消 /
  应用所选（n）」。
- 评分请求**一次**发给 `POST {Base URL}/v1/systemone`：每个能力一条 `noul`，一个
  0–1 分；**不分片、不按能力拆请求**。单次最多 300 个能力（超出直接报错不请求）；
  超上下文返回「输入内容超出模型上下文上限」，不自动截断或分批。
- 缺分 / 非数值答案按容错处理：数值 clamp 到 `[0,1]`（`1.2`→`1`），缺失 / 字符串 /
  `NaN` → 该能力 0 分并标注「未获得评分」（`reason=no-answer`），**不整单失败**，
  列表不丢行。
- 「应用所选」按**筛选语义**只写**当前会话**的会话开关：勾选 → 启用，未勾选的
  可应用能力 → 关闭（技能关闭 / 恢复，MCP 按会话屏蔽 / 恢复；不可应用项不动），
  不改项目默认。成功 toast 显示「启用 X 项、关闭 Y 项（仅当前会话）」，重复应用只写
  差异；冷会话排队完整 ops（含关闭），提示「已加入本会话，发送首条消息后生效
  （启用 X · 关闭 Y）」；失败尽力按前态回滚（启用 / 关闭均恢复）。应用为批量写入
  （skills 同 tick、MCP 并发 ≤4），通常 <1s；实际耗时取决于本会话能力数与宿主状态。

**输入停顿自动触发（默认关闭）**

- 开启后，仅在 hero 相位、Jev 已配置、无评分 / 应用进行中，且同时满足两个门槛时，
  停止输入达到「停顿阈值」即自动发起 1 次评分并展开面板：
  - 草稿字符数（`trim` 后按 Unicode 码点）≥ 最少触发字数；
  - 自上次能力决策以来累计编辑字符数（**插入 + 删除**）≥ 最少修改间隔字符数。
- 编辑量在**任意一次能力决策触发后、草稿清空后、发送首条消息后**归零；每次草稿变化
  都重置停顿计时，但**不清零**编辑量。等待中在能力条 / 面板标题行显示
  「停顿 0.9s / 1.0s · 即将能力决策」弱提示（不进 aria-live、不弹 toast、不抢焦点）；
  取消评分后同一草稿保持静默，直到再次累计到最少修改量。
- 关闭开关（默认）时不会自动请求，入口仍可手动触发；会话进行中（首条消息后）
  不再自动触发。

**冷会话与错误 / 隐私边界**

- 首屏还没有 live agent 时，应用走**排队生效**：chips 立即回显 + 提示
  「已加入本会话，发送首条消息后生效」；有不可切换项时合并为一条提示。首条消息发出后
  由宿主排队应用；若启用失败，下一次评分 / 应用会在面板顶部显示一次性
  「上次排队应用：成功 x 项 · 失败 y 项 · 原因」提示。
- 错误分类（宿主统一映射）：401/403 → Key 无效 / 无权限；400/422（`max_tokens_exceeded`
  等）→ 内容超上下文；429 → 请求过于频繁（自动重试最多 2 次）；529 → 服务过载
  （重试 2 次）；其它 5xx / 连接失败 → 网络错误；30s 超时；非 JSON / 结构错误 →
  请求无法完成；会话无能力 → 「当前会话没有可评分的技能或 MCP 服务器」。4xx 不重试；
  错误文案统一脱敏。
- 隐私边界：评分请求由**宿主**发起，浏览器不直接访问 Jev；请求体只含当前草稿 +
  能力名称 / 描述（截断到 200 / 120 码点），不含历史消息、文件正文、项目路径、
  session/cwd 或 API Key；错误与日志同样脱敏。

## 工作原理

```
浏览器客户端                          宿主（host）
┌──────────────────────────┐   RPC    ┌──────────────────────────────┐
│ sidebar.panellist        │ ───────► │ ctx.capabilityPanel 服务      │
│  └ 能力面板图标           │ /capabil-│  ├ skills        磁盘 CRUD +  │
│ main(key=capability-     │ ity-     │  │               文件内容导出 │
│  panel) └ 面板页面        │ panel    │  ├ mcp           配置 CRUD +   │
│  ├ 域 Tab（技能/MCP/Jev） │ 通道     │  │               热挂载 loader │
│  └ 左导航 + 项目下钻 + 详情│          │  ├ overrides 项目级默认关闭   │
│ conversation.view        │          │  ├ imports   项目级引用声明   │
│  └ 「能力」Tab（会话级）  │          │  ├ jev 配置 + rank / apply    │
│ conversation.input.dock  │          │  └ agent/created → 排队/挂载   │
│  └ 首屏能力面板 + 能力决策 │          │ 插件 ctx → 全局单例挂载        │
│                          │          │                              │
└──────────────────────────┘          └──────────────────────────────┘
```

- **不重复注册 skills provider**：面板列表直接读受管根目录的磁盘（与官方
  filesystem provider 口径逐字节一致），启停只写 frontmatter 调用键，
  由宿主的文件 watcher 原生生效。
- **技能详情的内容区不新增 RPC**：复用 `skills.export` 的一次性全量文件
  清单（相对路径 + base64），客户端组树、解码、缓存；Markdown 预览用自研
  轻量渲染器（React 元素树，零依赖、无 XSS 面）。
- **MCP 分两层**：全局条目挂在插件的 root 侧 context 上一次（`serverName` 按
  `ctx.root` 预留，全应用共用一份实例）；项目条目挂在 agent 自己的 context
  上（`serverName` 按 agent 作用域预留，同项目多 session 各自挂载、互不冲突，
  agent 销毁即自动卸载）。为此必须取**宿主那份**
  `@deepseek-ai/dsh-mcp-client` 实例：插件自带副本的
  `@deepseek-ai/dsh-scope` 里 `kScope` 是普通 Symbol（非 `Symbol.for`），
  `scopeOf()` 读不到宿主打在 agent ctx 上的 scope tag，会恒回落 `ctx.root`，
  项目级的每会话隔离随之失效。宿主没有 loader 时（headless 等）回落自带
  副本，那种情况下同名 server 全应用只允许一份，后到者显示冲突圆点。
- **「在本项目禁用全局 MCP」靠 `tools.restrict` 屏蔽**：全局层共享、无法按
  项目卸载，于是按 session 对该 agent 作用域 deny 掉该 server 的全局工具
  （名单按 `mcp__<serverName>__` 前缀精确取；宿主没有 `restrict`、名字尚未
  注册或调用抛错时降级为 warning + 状态标 `skipped`/`failed`，不影响挂载）。
- **若 profile 里已 root 级挂过同名 server**（例：`profiles/web` 的
  `cordis.patch.yml` 插了 mcp-AnySearch / mcp-tavily / mcp-mobile-next /
  mcp-context7 / mcp-github 共 5 条），本插件不再重复挂载该 serverName：状态
  显示 `conflict` 并带文案，工具仍由那份实例提供，但**面板里对该条目的编辑
  不会生效**——请改 profile。
- **UI 纯增量**：侧栏入口与会话内入口都注册在宿主的既有槽位里，不顶替、
  不遮蔽任何内置 UI，也不绑定特定 session。

## 安装

> 本仓库是 [chengdb/dsh-plugin-capability-panel](https://github.com/chengdb/dsh-plugin-capability-panel)
> 的 fork，**已启用独立包名 `dsh-capability-settings`**（与上游 `@chengdb/capability-panel`
> 互斥，同一 profile 不能同时安装两者）。`cordis.patch.yml` 的 patch id 仍为
> `capability-panel`，客户端 `pluginId` 已与包名同步。下面的安装地址指向本 fork。

跟随 `master` 最新代码（推荐）：

```powershell
dsh plugin --profile web add "github:xx529/dsh-capability-settings#master"
dsh web        # 打开 Web GUI，侧栏上方（工作区列表之上）可见「能力面板」
```

安装上游 release（版本钉死，功能等同 1.1.0，不含本仓库后续改动）：

```powershell
dsh plugin --profile web add "github:chengdb/dsh-plugin-capability-panel#v1.1.0"
```

被 `dsh` 以 git 方式安装时，`lib/` 是**随仓库提交的构建产物**——改完 `src/`
记得 `pnpm build` 并把 `lib/**` 一起提交，否则安装方拿到的仍是旧产物。

## 卸载

```powershell
dsh plugin --profile web remove dsh-capability-settings
```

移除后重新运行 `dsh web` 即可，侧栏入口与会话内入口随之消失。卸载**不会**触碰
你已经管理的任何数据——`.agents/skills`（及旧位置 `.dsh/skills`）、`.mcp.json`、
`capability-overrides.json`、`capability-imports.json` 等文件全部原样保留，
随时可重新安装接管。旧版快捷消息的 `quick-messages.json`（项目/全局）本版
**不再读写**，同样不会被卸载动作删除。

## 本地开发

```powershell
cd <本仓库路径>
pnpm install
pnpm build     # tsc（lib/*.js + .d.ts）→ tsdown（lib/client.js 包裹版）
dsh plugin --profile web add "link:<本仓库路径>"
dsh web
```

## 目录结构

```
src/
  index.ts        宿主插件入口——暴露 ctx.capabilityPanel 服务
  client.ts       客户端插件入口（侧栏 panellist 入口 + main 页面 + 会话内入口）
  remote.ts       host↔client RPC 接线（endpoint 按域前缀路由）
  shared/         项目根探测 / 文件写锁 / skill 根定位与来源分类（两端共用）
  skills/         skills 域：磁盘读写、CRUD、安装/导出、URL 下载、shadow stub、校验
  mcp/            MCP 域：.mcp.json 读写、全局单例 + 项目级每会话挂载、探测（测试连接）
  overrides/      项目级「默认关闭」声明：.agents/capability-overrides.json
  imports/        项目级「全局能力引用」：.agents/capability-imports.json（MCP）
  jev/            Jev 能力决策：配置读写/校验（config-file）、密钥解析与 RPC（manager）、
                  rank（systemone 请求/容错解析/排序）、apply（会话开关事务 + 冷会话排队）
  client/         React 面板（三域 Tab + 左导航 + 工作区下钻 + 详情）、目录树/阅读器、工具参数手风琴、
                  Jev 模型配置页（jev-panel）、会话内能力配置 + 首屏「✦ 能力决策」调度器、入口外壳、
                  zip 工具、零依赖 Markdown、自含样式
```

## 设计文档与截图

- 能力面板（技能 / MCP）规格：[docs/ux/panel-upgrade.md](docs/ux/panel-upgrade.md)（v1.4 / v7 IA）
- Jev 能力决策：
  - 产品规格（v1.3.1，含实现裁决记录）：[docs/specs/jev-auto-select.md](docs/specs/jev-auto-select.md)
  - 交互与视觉规格（v1.5）：[docs/ux/jev-auto-select.md](docs/ux/jev-auto-select.md)
  - 架构与契约：[docs/architecture/jev-capability-decision.md](docs/architecture/jev-capability-decision.md)
- 原型预览（v11，当前）：`docs/figma/preview/v11-01-entry.png` … `v11-05-config.png`；
  Figma 页 **`Capability Panel · 能力决策 v11`**
- 建稿/坐标规格：`docs/figma/prototype/v11/spec-v11.md`；面板 v7 原型保留在
  `docs/figma/preview/v7-01-skills-project.png`、`v7-02-mcp-project.png`
- 运行时验证报告（tester，task-17）：`notes/verify/jev-capability-decision/report.md`
  （511 断言 0 失败；真机验证未执行，剩余项见报告 §8–§9）

> `docs/screenshots/` 下的图片是 1.1–1.2 旧版界面留档（包含已下线的快捷消息域与
> 已移除的输入框能力工具组），仅作历史对照，不再在本文中引用。
> **跨版本说明**：v7 及更早截图不含第三个域 Tab「Jev 模型」与首屏「✦ 能力决策」；
> 当前界面以 v11 预览（`docs/figma/preview/v11-*.png`）为准，v6/v7 仅作历史对照。
> 尺寸与线框见 `docs/ux/jev-auto-select.md` 与 `docs/ux/panel-upgrade.md` 的 §4 / §9。

## License

[MIT](LICENSE)
