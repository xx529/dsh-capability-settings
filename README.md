# @chengdb/capability-panel

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件：
在 Web GUI 里**可视化管理项目的全部能力**——Skills、MCP 服务器、快捷消息，
全部支持**项目级 / 全局级**双作用域，全部可以**不离开浏览器**完成安装、启停与分发。

![能力面板总览](docs/screenshots/panel-overview.png)

> **外壳版本要求**：侧栏入口用的是 root 作用域的 `sidebar.panellist` 槽
> （「全局面板」图标排）与同 id 的 `main` keyed 槽，**需要 dsh 外壳 ≥ 0.2.0-rc.2**
> （桌面应用 0.2.0-rc.2 即有；更早的 `0.1.2-alpha.2` 只有 `sidebar.footer.action`，
> 那时入口与主区域面板都不会注册——升级外壳即可）。

## 它能做什么

| 能力域 | 浏览/搜索 | 新增/安装 | 编辑 | 启用/禁用 | 删除 | 导入/导出 |
|---|---|---|---|---|---|---|
| **Skills** | ✅ 项目/全局两区 + 详情 | ✅ 上传 / 宿主路径 / URL 三种来源 | ✅ | ✅ 项目区启停 + 模型/用户方向独立开关 | ✅ 两击确认 | ✅ 导入到本项目（物理副本）/ 在本项目禁用（屏蔽占位）/ 下载 zip / 复制到宿主目录 |
| **MCP 服务器** | ✅ 项目/全局两区 + 实时挂载状态 | ✅ 表单新增（stdio/sse/http）+ 详情页「查看工具与参数」 | ✅ | ✅ 项目区启停 + 写后热重挂 | ✅ | ✅ 导入到本项目（引用，跟随全局）/ `.mcp.json` 与 Claude Code 格式兼容 |
| **快捷消息** | ✅ 项目/全局两区 + 搜索 | ✅ 多行正文 | ✅ | ✅ 项目区启停 | ✅ | ✅ 导入到本项目（引用，跟随全局）/ JSON 配置文件即数据 |

## 配置文件位置

本插件的配置文件**写入优先用 `.agents` 目录**，读取兼容旧位置与跨工具生态：

| 配置 | 写入目标 | 读取兼容（旧位置） |
|---|---|---|
| 项目级能力禁用声明（MCP 弹层「本项目」开关） | `<项目根>/.agents/capability-overrides.json` | `.dsh` → `.claude` |
| 项目级「全局能力引用」声明（MCP / 快捷消息的导入） | `<项目根>/.agents/capability-imports.json` | — |
| 项目级快捷消息 | `<项目根>/.agents/quick-messages.json` | `.dsh` → `.claude` |
| 全局 MCP 服务器 | `~/.agents/mcp.json` | `~/.dsh` → `~/.claude` |
| 全局快捷消息 | `~/.agents/quick-messages.json` | `~/.dsh` → `~/.claude` |
| Skills（项目/全局） | `.agents/skills`、`~/.agents/skills` | `.dsh/skills`（可写）、`.claude/skills`（只读展示） |
| 项目 MCP 服务器 | `<项目根>/.mcp.json`（Claude Code 标准，位置不变） | — |

首次写入新位置时，旧文件内容会自动**并入并删除**（不丢配置、不留两份）。
`.agents` 与 `.dsh` 同时参与"项目根"判定（`.claude` 也纳入），换目录 / 换
工具搬家都不会影响配置归属。

## 亮点

### 🗂 一个面板，管住三个能力域

侧栏**上方**（品牌/新建会话行之下、工作区列表之上）新增「能力面板」入口，
点击后像「插件 / 自动化任务 / Context」那样**占据主区域**（不再是浮层，也不
会挤压对话区）。面板顶部在
**快捷消息 / Skills / MCP** 三个域之间切换，每个域内部再按 **项目 / 全局**
两区分离——项目区只列本项目配置里的条目，全局区只列全局配置，两区都支持
关键词搜索。头部下拉框还可以把"项目"钉选到任意已知工作区——不切 session
也能管理别的项目（**钉选只影响面板**：输入框里的三个弹层始终跟随当前会话
自己的工作区）。工作区多时该下拉会自动适应：按视口钳制左右边界（不会顶出
屏幕右边）、下方放不下时向上弹、列表在半个视口内自身滚动（滚到底可选到最后
一个工作区）。

![面板：Skills 域列表](docs/screenshots/panel-skills.png)

> 截图摄于 1.1.0（入口在侧栏底部、面板是浮层）。此后入口移到侧栏上方、
> 面板改为占据主区域，版面比截图更宽；三个域的列表与操作完全一致。
> 另外 **MCP 详情卡的「查看工具与参数」按钮与新的测试报告排版也不在旧截图里**
> （报告排版见下方 MCP 一节的文字说明）。

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
`<name>/SKILL.md`），装完立刻可被 agent 调用。安装目标随所在区固定：
项目区只装进项目根，全局区只装进全局根。

导出同样简单：flat skill 直接下载 `.md`，目录型 skill 在浏览器端打成
store-only zip；也可以复制到宿主任意目录。

![安装 Skill 对话框](docs/screenshots/skill-install.png)

### ⚡ 一键启用/禁用，不动正文（仅项目区）

**全局区没有启停也没有调用方向开关**——全局技能恒定可用（对所有项目可见、
agent 可直接调用），面板在全局区提供的是「导入到本项目」「在本项目禁用 /
恢复」、导出与删除（见下一节）。**启用/禁用只发生在项目区**。

项目区详情卡上有「已启用 / 已禁用」状态按钮（文字与颜色随状态变化）。
禁用只写入 `user-invocable: false` + `disable-model-invocation: true`
两个扁平键——正文与其它元数据原样保留，启用即清除恢复。禁用的 skill 会
立刻从输入框的 Skills 快捷弹层中消失。只读条目（`.claude` 兼容根）不显示
操作按钮。

调用方式可以**按方向细调**：详情卡的「调用方式」字段上，「模型调用」与
「用户调用」两个方向各自独立开关——比如某个 skill 只希望用户 `/name`
手动触发、**不需要 agent 自动注入**，关掉「模型调用」即可，frontmatter
只写入 `disable-model-invocation: true`，`user-invocable` 原样保留
（反之亦然）。两个方向都关等价于一键禁用，恢复同理；写盘保持最小化，
启用即清除对应键。两个方向状态不一致时，整体按钮显示「部分禁用」。

左侧列表行不堆文字标签：**项目区行只保留状态圆点**（绿=双开、蓝=部分
禁用、灰=全禁用；屏蔽占位恒灰），全局区行没有圆点（全局技能恒定可用），
布局 / 来源等属性信息收进右侧详情卡。

![Skill 详情与启停开关](docs/screenshots/skill-detail.png)

### 🗃 Skills：全局与项目两区分离，项目级控制落实为真实文件

面板的 Skills 域分「**项目** / **全局**」两区（域内顶部切换），每区只列
该作用域的真实文件——项目区 = `<项目>/.agents/skills` 等，全局区 =
`~/.agents/skills` 等。项目级控制全部落实为项目区里的**真实文件**（副本
或屏蔽占位），启停只写 skill 文件自己的 frontmatter，由宿主的文件
watcher + 目录重发布原生生效（下一步即注入/剔除），没有写在插件私有
配置里的叠层状态。

- **导入到本项目**：全局区任意条目的详情卡上有「导入到本项目」按钮，把
  该 skill（目录型连资源）**物理复制**到 `<项目>/.agents/skills`，此后在
  本项目对这份副本的一切控制都是项目级的——宿主 registry 同名时项目优先，
  项目副本会遮蔽全局名。导入是**快照**：全局后续更新不会同步到已导入的
  副本，项目内同名冲突可选覆盖；
- **在本项目禁用 / 恢复**（shadow stub 屏蔽占位）：全局区条目的详情卡上有
  「在本项目禁用」按钮，在项目 `.agents/skills` 生成一个同名占位文件
  （frontmatter 双向禁用 + `metadata: capability-panel: shadow-stub` 标记）。
  宿主按 frontmatter name 合并技能、项目根 rank 恒高于全局根，占位文件于是
  **顶掉**同名全局条目——catalog 注入、`skill` 工具调用、`/name` 用户注入
  三条链路都在本项目内被宿主原生拒绝（其它项目不受影响）。占位条目出现在
  项目区（灰点 +「屏蔽占位」徽标），被遮蔽的全局条目在全局区带「本项目已
  禁用」徽标；点「在本项目恢复」（或删除占位文件）即还原；
- 详情卡标题旁有**归属徽标**（按作用域着色：项目=蓝 / 全局=绿）与状态徽标
  （屏蔽占位 / 本项目已禁用 / 项目副本生效中）；
- 删除按钮语义直接：全局区条目 = 「**删除**」（已导入到各项目的副本不受
  影响），项目区条目 = 「**删除**」（只删本项目这份文件；对屏蔽占位而言
  即恢复同名全局技能）；
- 提醒：**agent 侧的可见性以宿主 registry 为准**——全局 skill 对所有项目
  可见、agent 可直接调用。要让某全局 skill 在本项目停掉 agent 自动触发，
  两条路：**「在本项目禁用」**（整体屏蔽，最省事），或**先「导入到本项目」，
  再在项目区关闭它的「模型调用」**（保留 `/name` 手动调用的细粒度控制）。

![全局区详情：导入到本项目 / 在本项目禁用](docs/screenshots/skill-detail-global.png)

### 🔌 MCP：改配置即热挂载，不重启、不改 preset

- 配置文件与 **Claude Code 的 `.mcp.json` 格式兼容**：项目级
  `<projectRoot>/.mcp.json`，全局级 `~/.agents/mcp.json`（读取兼容旧位置
  `~/.dsh/mcp.json`），同名 key 项目级覆盖全局级；`env`/`headers`/`args`
  支持 `${VAR}` 环境变量插值。
- 全局级 `<agentsHome>/mcp.json` 的条目**整个 harness 只挂一份实例**（挂在本
  插件自己的 Cordis context 上，`serverName` 按 root 作用域预留，各 session
  共用同一个 MCP 进程）；**项目级** `<项目根>/.mcp.json` 的条目仍挂在 agent
  自己的 Cordis context 上——工具以 `mcp__<serverName>__<tool>` 出现在**该
  session 内**，同一工作区里各 session 各一份、彼此隔离，agent 销毁自动卸载。
- 新增/编辑 server 时可以先点**「测试连接」**：按当前草稿真连一次（不必先
  保存），成功后列出该 server 暴露的**工具名与参数列表**（参数名 / 类型 /
  必填或可选 / 说明）与耗时；失败给出中文文案与原始错误。探测是一次性连接，
  不注册任何工具，结束即关闭（含 stdio 子进程）。
- 选中某个 server 后，详情卡上还有**「查看工具与参数」**：不必进编辑弹窗，
  直接真连一次就地展开它的**描述 + 工具 + 参数**，带「重新测试」与
  「收起工具列表」；换选服务器会自动清掉上一次的结果。两个入口共用同一个
  零副作用探测通道。
- **MCP 有「默认开关」和「当前对话开关」两级**：
  - 能力面板 MCP 列表每行右侧有**「默认」**开关（配置条目与外部注入实例都有）：它写
    项目级的"默认关闭"声明，**新建对话按它来**；已有对话在没有任何手动覆盖时也跟随它。
    外部实例同样适用（共享实例不卸载，只按项目屏蔽其工具；按会话作用域注入的实例
    无法屏蔽，开关置灰）。
  - 输入框 MCP 弹层里的开关是**只影响当前对话**的（内存内、不落盘）：项目条目按需
    挂载/卸载，全局与外部实例用 `tools.restrict` 屏蔽/恢复其工具，不影响其它对话。
    显式会话开关优先于默认；再次切换即回到跟随默认。
- **外部注入的 MCP 也能管理（只读 + 按项目开关）**：其它插件或 profile 在运行时直接
  挂载的 `@deepseek-ai/dsh-mcp-client` 实例（不在本插件配置文件里）会**与配置条目同列表
  出现在「全局」区**——名称旁标 `外部` 与**来源插件**（如 `dsh-to-figma`；来源来自 cordis
  的 `Fiber.name`/loader 条目 id），点开详情可看：来源、注入方式、命名空间、传输与命令
  摘要、**每个工具的说明与参数**（名字/类型/必填/说明）、本次运行调用次数与使用记录。
  它们**不可编辑/删除/卸载**（配置与生命周期在注入方）；但可以在输入框的 MCP 弹层里
  **按项目启用/禁用**——开关写项目级声明，宿主不会卸载实例，只对该项目 session 的
  `tools.restrict({deny:['mcp__<serverName>__*']})` 屏蔽其工具（按会话作用域注入的实例
  无法屏蔽，开关置灰）。每个 MCP 名称旁都有来源标记：`全局`/`项目`/`引用`/`导入`/`外部·来源`。
- 详情卡还有**「使用记录」**（只读、不落盘）：列出**最近的调用**——什么时候、哪个
  session（显示侧栏的会话标题，拿不到标题时显示会话 id 尾部）、调用了这个 server 的
  哪个 tool；默认显示最近 50 条（宿主内存里最多留 200 条），打开期间每 2s 静默刷新。
  实现方式是宿主侧一个**全局 `tools.guard` 旁路**：只观察 `mcp__<serverName>__<tool>`
  调用、**永远放行**、异常吞掉，不写任何文件、不影响工具执行；插件重载或应用重启即
  清空（刻意不做持久化）。记录的是**调用尝试**（执行前），不代表该次调用成功。
- 报告本身是**可读的卡片式排版**：顶部一行状态徽标（`连接正常` + 工具数 +
  参数总数 + 耗时）；服务器的 `instructions`（常见上千字）单独成块并**默认
  折叠 3 行**，需要时点「展开」；每个工具一张卡片（等宽工具名 + 参数个数 +
  描述折叠 3 行，完整文本在悬浮提示里）；参数按「名字 + 类型 + 必填/可选」
  一行、说明另起一行，长 URL / 长英文会安全换行；工具列表在不超过半个视口的
  区域内**自身滚动**，既不会被截断，也不会把「添加 / 取消」按钮顶出屏幕。
- 面板分「项目 / 全局」两区：项目区条目可启停/编辑/删除，全局区条目提供
  **「导入到本项目」**——登记一条**引用**（写入
  `<项目根>/.agents/capability-imports.json`），不是物理复制：内容始终
  跟随全局条目（全局更新实时生效），启停是引用上的项目级标记；引用在
  项目区显示（归属徽标「全局」），可启停、可「移出」。引用与项目原生
  条目同级参与挂载合并，同名时遮蔽全局原版。
- 面板里每次新增/编辑/删除/启停，都会**自动重挂受影响 session** 的
  MCP 连接；但**写入不必等重挂**——RPC 只等配置文件落盘就返回，列表立刻刷新
  （删除/新增/启停都即时可见），重挂在后台按队列进行：重挂期间还没拿到状态的
  条目显示「挂载中…」，面板静默轮询直到挂载状态收敛，且不会闪「加载中…」。
  项目区行的列表圆点：绿=启用、灰=禁用；挂载失败/冲突/未挂载
  等实时状态用行内标签与 tooltip 呈现，详情卡「状态」字段保留完整挂载
  信息与错误。

![面板：MCP 域列表与状态](docs/screenshots/panel-mcp.png)

### 💬 快捷消息：常用提示词，一键入草稿、一键直发

把高频提示词存成快捷消息（项目级 `<项目根>/.agents/quick-messages.json` +
全局 `~/.agents/quick-messages.json`，读取兼容旧位置 `.dsh` / `~/.dsh`）。
面板分「项目 / 全局」两区管理：项目区条目可增删改、启停、搜索；全局区
条目的**「导入到本项目」**登记一条引用（写入
`.agents/capability-imports.json`）——内容始终跟随全局（全局更新实时
生效），启停是引用上的项目级标记，可随时「移出」。
禁用的消息只从输入框弹层隐藏，配置仍然保留。

![面板：快捷消息域](docs/screenshots/panel-quick.png)

### 🎯 项目级控制全局能力

全局能力默认对所有项目生效。想只在某个项目里调整，每个域都有落在真实
文件上的机制（都不写插件私有的叠层状态）：

- **Skills**：「导入到本项目」物理复制出项目副本（此后项目内独立启停 /
  细调方向，快照不跟随全局）；或「在本项目禁用」生成屏蔽占位（shadow
  stub，整体屏蔽，删除即恢复）；
- **MCP / 快捷消息**：「导入到本项目」登记**引用**（内容实时跟随全局，
  启停是引用上的项目级标记，写在 `.agents/capability-imports.json`）；
- **MCP 弹层的「本项目」开关**：输入框的 MCP 弹层里，全局 server 可以
  直接切换本项目启用/禁用（写 `.agents/capability-overrides.json`）。
  全局实例是共享的，所以「禁用」由宿主的 `tools.restrict`
  在该 session 的 agent 作用域上屏蔽其工具实现——全局配置不动、其他项目
  不受影响；宿主不提供 `restrict` 时降级（记 warning + 状态标 `skipped`，
  工具对本会话仍可见）。

### ⌨️ 输入框里的「能力工具组」

输入框左下角注册了一组三个按钮（顺序与面板域 Tab 一致）：
**快捷消息 / Skills / MCP**。点击在输入框上方展开弹层，三个弹层共用
同一锚点，切换不跳位；Esc / 点击外部关闭，彼此互斥。

三个按钮与三个弹层的**项目作用域一律跟随自己所在 session 的工作区**：
composer 槽（`conversation.input.left` / `conversation.input.overlay`）都是
session 作用域、standardProps 里直接给 `sessionId`，插件按它解析出所属工作区
（`workspaces` 快照的 `items[].sessionIds`），并按 sessionId 缓存适配器实例。
因此在 B 工作区的会话里**只会**看到 B 的项目级条目——既不受能力面板头部
「项目作用域」钉选影响，也不会因为拿不到"当前会话"而退化成工作区列表第一项。

![输入框能力工具组与 Skills 弹层](docs/screenshots/composer-skills.png)

- **Skills 弹层**：按项目/全局分组列出 user-invocable 的 skill（可搜索），
  同名 skill 以项目区条目为准（与宿主 rank 解析同一口径，被项目副本 /
  屏蔽占位遮蔽的名字不会漏出全局的"死口令"）。点击把 `/name ` 追加进
  草稿——与宿主 `/` 菜单同一口令形式，发送后宿主自动注入 skill 正文。
  草稿里已含已知口令时按钮实心变绿。
- **快捷消息弹层**：点击把正文追加进草稿；行尾 hover 浮现纸飞机按钮，
  **一键直发**整条消息（不经过草稿）。被项目区同名条目（原生或引用）
  遮蔽的全局消息不重复出现。

  ![快捷消息弹层与一键直发](docs/screenshots/composer-quick.png)
- **MCP 弹层**：逐行开关控制 server 的**本项目启用/禁用**——项目条目
  （含引用）直接切项目级状态，全局条目走项目级覆写（不翻全局配置，其他
  项目不受影响），全局已禁用的 server 不在此列出（启用全局请到能力面板
  全局区）；写配置 + 自动热重挂，与面板同一语义。

  ![MCP 快捷开关弹层](docs/screenshots/composer-mcp.png)

## 工作原理

```
浏览器客户端                          宿主（host）
┌─────────────────────┐   RPC     ┌──────────────────────────────┐
│ sidebar.panellist    │ ────────► │ ctx.capabilityPanel 服务      │
│  └ 能力面板图标       │ /capability│  ├ skills        磁盘 CRUD    │
│ main(key=capability- │ -panel    │  ├ mcp           配置 CRUD +   │
│  panel) └ 面板页面    │ 通道       │  │               热挂载 loader │
│ conversation.input  │           │  ├ quickMessages 配置 CRUD     │
│  └ 能力工具组×3      │           │  ├ overrides 项目级禁用声明    │
│ conversation.input  │           │  └ imports   项目级引用声明    │
│  └ 弹层×3            │           │ agent/created → 项目级挂载     │
└─────────────────────┘           │ 插件 ctx      → 全局单例挂载   │
                                  └──────────────────────────────┘
```

- **不重复注册 skills provider**：面板列表直接读受管根目录的磁盘（与官方
  filesystem provider 口径逐字节一致），启停只写 frontmatter 调用键，
  由宿主的文件 watcher 原生生效。
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
- **UI 纯增量**：侧栏入口与输入框按钮都注册在宿主的列表槽（list slot）里，
  不顶替、不遮蔽任何内置 UI，也不绑定特定 session。

## 安装

> 本仓库是 [chengdb/dsh-plugin-capability-panel](https://github.com/chengdb/dsh-plugin-capability-panel)
> 的 fork（包名仍是 `@chengdb/capability-panel`，保持 profile patch id 与
> `tsdown` 的 pluginId 不变）。下面的安装地址指向本 fork。

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
dsh plugin --profile web remove @chengdb/capability-panel
```

移除后重新运行 `dsh web` 即可，侧栏入口与输入框工具组随之消失。卸载**不会**触碰
你已经管理的任何数据——`.agents/skills`（及旧位置 `.dsh/skills`）、`.mcp.json`、
`quick-messages.json`、`capability-imports.json` 等文件全部原样保留，随时可重新
安装接管。

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
  client.ts       客户端插件入口（侧栏 panellist 入口 + main 页面 + 输入框工具组 + 弹层）
  remote.ts       host↔client RPC 接线（endpoint 按域前缀路由）
  shared/         项目根探测 / 文件写锁 / skill 根定位与来源分类（两端共用）
  skills/         skills 域：磁盘读写、CRUD、安装/导出、URL 下载、shadow stub、校验
  mcp/            MCP 域：.mcp.json 读写、全局单例 + 项目级每会话挂载、探测（测试连接）
  quick-messages/ 快捷消息域：JSON 配置读写、CRUD
  overrides/      项目级禁用声明：.agents/capability-overrides.json 读写（兼容旧位置）
  imports/        项目级「全局能力引用」：.agents/capability-imports.json 读写（MCP / 快捷消息）
  client/         React 面板（三域两区）、三个 composer 弹层、入口外壳、zip 工具、自含样式
```

## License

[MIT](LICENSE)
