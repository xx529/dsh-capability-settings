# Capability Panel · 终稿 v8 —— 同步当前实现（1.3.4）

> 目的：把 1.3.4 的实现同步成 Figma 设计源，页面可整体导出 scene JSON 供下次导入。
> 新页面 `Capability Panel · 终稿 v8`，4 帧 1440×900；视觉与坐标沿用 v7；只写 `docs/figma/prototype/v8/`，不改 v6/v7 与 `src/`。

## 1. 与 1.3.4 实现的对应

| 实现行为 | v8 帧表现 |
|---|---|
| 左 ScopeNav = 全局 / 项目 + 「+」；工作区列表在「项目」行下方，**两种 scope 都常驻** | 4 帧都显示 14 个工作区行（h34），LiveShopping 选中（#2A303B + 左蓝条）；全局帧也保留，仅 全局/项目 的 active 行不同 |
| 作用域切换只影响中间列表与详情 | 01/03 = 项目（LiveShopping active 行、中间 `LiveShopping` 列表）；02/04 = 全局（全局 active、中间 `全局` 列表） |
| 中间列只有标题 + 条目 | 中列 300：工作区/作用域名 + 计数 + `+`，下面直接条目；不再出现工作区列表 |
| 技能详情 = 动作 / 元信息 + 文件树 200 + 阅读器 412 | 01/02 右详情：动作区（项目=已启用/导出/导出到路径/删除；全局=安装到本项目/导出/导出到路径/删除）+ 元信息 + 树 200 + 阅读器 412（预览/源码） |
| MCP 详情 = 动作 / 字段 + **工具参数手风琴** | 03/04：折叠面板每行只有 工具名 + `N 个参数`（无 description）；一项展开（▾，主蓝）在**该行下方**显示参数表（参数/类型/必填/说明），其余收起（▸） |
| 全局 MCP 视图含「外部注入」分组（只读，非空） | 04 中列 = 全局组 4 行 + 分隔 + 外部注入组 1 行（figma，开关关）；详情为 figma 只读态 |
| 项目视图 MCP 只有本项目条目 | 03 中列 = 本项目组 2 行（AnySearch / playwright） |
| 项目 scope 未选工作区时中间列为空态 | 本 4 帧均选中 LiveShopping，故不出现空态；空态文案实现为「在左侧选择工作区后查看技能 / MCP」 |

## 2. 执行顺序（Lead 依次粘贴到 `use_figma`）

| # | 脚本 | 内容 | 幂等 |
|---|---|---|---|
| 1 | `00-init.js` | 建/重置页 `Capability Panel · 终稿 v8`、4 画框、逐帧克隆 sidebar(4:8)+修「能力面板」高亮、页标题/副标题 | 清空整页重建 |
| 2 | `01-skills-project.js` | 01 · 技能 · 项目 | 清空帧内除 `sidebar` 外节点 |
| 3 | `02-skills-global.js` | 02 · 技能 · 全局 | 同上 |
| 4 | `03-mcp-project.js` | 03 · MCP · 项目 | 同上 |
| 5 | `04-mcp-global.js` | 04 · MCP · 全局 | 同上 |

- 画框位置：01 (0,150) · 02 (1520,150) · 03 (0,1200) · 04 (1520,1200)；帧标题在画框上方 34px（页面级）。
- 返回：00 `{ pageId, frames[] }`；01–04 `{ frame, children }`。
- dynamic-page：统一 `await figma.setCurrentPageAsync(page)`。

## 3. 坐标（帧内绝对坐标，四帧共用）

```
侧栏 256 │ 主区 1184（x=256）
头部 line1 0–51：标题 276,16（17/600）｜路径 360,19（12.5）｜胶囊 1204,10 216×34
头部 line2 52–103：Tab 轨道 276,60 300×36（选中项 279,63 147×30）｜搜索 1096,60 320×36 右对齐
body y=104：ScopeNav 208（256–464，分隔线 463）｜列表 300（464–764，分隔线 763）｜详情 676（764–1440，内容 628 = x788–1416）
```

**左 ScopeNav**：行宽 192 x=264；`全局` y=112 h=32（名称 13/600 + 计数 146 右对齐 + 行尾 `+`）；`项目` y=148 h=32（active #2A303B r8，计数 12）。工作区行 y=186 起、h34、x=272 w=184（"项目"行下缩进 8），名称 basename 13px；选中行 #2A303B + 左 2px 蓝条；滚动条 x=458。

**中列**：标题行 y=112（`LiveShopping`/`全局` 13.5/600 + 计数胶囊 + 蓝色 `+` 720,112 32×32）；`grp/*` 组头 y 起始 156，h36（13/600 + 计数胶囊 + 右侧 10.5 说明）；条目 x=472 w=284。
- 技能行 h=76：点 12,13；名称 24,7（170×20）；标签 y=28；描述 12,50（184×20）；行尾「启用」+ 开关 244,29。
- MCP 行 h=72：名称 24,7；标签 y=28；meta 24,49（184×18）；行尾「默认」+ 开关 244,27。
- 02 列表行 y=156/236/316/396/476；03 组头 156、行 200/276；04 组头 156、行 200/276/352/428、分隔线 508、组头 516、行 560。

**右详情（内容 628）**
- 技能（01/02）：标题 788,132（18/600）+ 标签 1070/1110 + 复制路径 1330；动作 176（h30 pill）；元信息 218 h36；内容 266 h614 = 树 200（788）+16+ 阅读器 412（1004）。树：头部 36、行 30、徽标 x=118、大小 x=156、引导线 28/38；阅读器：头部 40、`预览/源码` 分段、正文 h1/p/列表/代码块。
- MCP 项目（03）：标题 788,132 + 标签 890/930 + 复制命名空间；动作 176（已启用/编辑/查看工具与参数/使用记录/删除）；字段 218–402；**手风琴** 418 h316；使用记录 746 h100。
- MCP 全局（04）：标题 figma + 标签 850/930；动作 176（查看工具与参数/使用记录）；只读说明条 218 h32；字段 262–540；**手风琴** 552 h214；使用记录折叠 778 h44。

**手风琴规格**
- 头部 40：`工具与参数` + `17 个工具 · 点击工具展开参数`；分隔线 y=40。
- 工具行 h=36：chevron ▸/▾（14，展开主蓝）+ 工具名 Menlo 11.5 + 右侧 `N 个参数` 11 (#7F8794)；行底 1px 白 6%。
- 展开项：行下方参数表——表头 24（参数 x34 / 类型 x144 / 必填 x216 / 说明 x272），行 h=30，必填橙色 10；表头下 1px 分隔。
- 03 展开 `mcp__AnySearch__search`（query 必填、max_results 可选、search_depth 可选），收起 batch_search(2)、extract(1)、get_sub_domains(0)。
- 04 展开 `mcp__figma__figma_select_document`（connectionId 必填），收起 figma_status(0)、figma_read_guide(0)。

## 4. 节点命名

```
page-title / page-subtitle / <帧名> · 帧标题 → Frame → sidebar
  header/{title,workspace,workspace-dd(+text),tabs→tab-skills|tab-mcp(+t),search(+search-ph,search-icon,search-handle),line1,line2}
  scope/{divider,global,project}(+label,count,plus) │ ws/<basename>(+bar,name) │ scope/scrollbar
  list/{divider,title,count(+t),add(+t),scrollbar} │ grp/<scope>(+title,count,count-t,note,line) │ row/<id>(+sel-bar,dot,name,tag-*,desc|meta,toggle-label,switch→knob)
  detail/{name,tag-*,copy-path,copy-ns} │ act/* │ meta/* │ notice/readonly(+text) │ field/<key>/label|value │ field/line-*
  detail/tree(+title,count,line,scrollbar) → tree/<item>(+icon,bg,bar,label,count,badge→/t,size) + tree/guide-d1|d2
  detail/reader(+file,meta,seg→seg-on/off,line,scrollbar) → md/h1|p1|h2|list|code(+code-text)|p2
  collapse/tools(+title,meta,line) → tools/<id>/{chev,name,count,line} | params/{h-name,h-type,h-req,h-desc,line} | params/<param>/{name,type,req,desc}
  collapse/usage(+title,meta,chev,line) → usage/{time,session,tool}-<n>
```

## 5. 验收点

1. 页面 4 帧 1440×900，命名/位置正确；左 256 为 v5 sidebar 克隆，「能力面板」高亮。
2. 4 帧都显示工作区列表（14 行，LiveShopping 选中）；全局帧 全局 active、项目帧 项目 active。
3. 中间列只有「标题 + 计数 + `+` + 条目/组头」，**不再出现工作区列表**；01/03 标题 `LiveShopping`，02/04 标题 `全局`。
4. 03 中列只有本项目 2 条；04 中列 = 全局 4 条 + 分隔 + 外部注入 1 条（figma 开关关）。
5. MCP 工具参数为手风琴：所有行只显示工具名 + `N 个参数`（无 description），各帧各有 1 项展开并显示参数表，其余 ▸ 收起。
6. 技能详情 = 动作 + 元信息 + 文件树 200 + 阅读器 412（预览/源码）。
7. 行尾开关统一 30×18（skills「启用」/ MCP「默认」），开 #61AFEF、关白 13%；标签不压开关。
8. 文字零溢出、零重叠；长名称/路径/参数说明截断。
9. 详情字段与 1.3.4 一致：MCP 命名空间/命令/参数（token 打码 `as_sk_••••`）/配置文件/状态；外部注入含只读原因/来源/注入方式/传输/默认/当前对话/调用次数/管理。
10. 脚本幂等 + dynamic-page 兼容；重跑不产生重复节点、不新增页面、不动 v6/v7 页与 4:2 / 1:2；导出 scene JSON 可直接 `import_scene` 重建。
