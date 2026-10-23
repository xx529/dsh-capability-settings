# Capability Panel · 交互原型 v7 —— 工作区列表移入左侧导航

> 用户反馈：工作区列表（当前中间列「选择工作区 18」）不该占中间列，应归到左侧「全局 / 项目」那一侧。
> 本原型只确认信息架构，**不改代码**。视觉沿用 v6；只写 `docs/figma/prototype/v7/`，不动 v6 脚本与 `src/`。

## 1. 与反馈的对应

| 反馈 | v6 现状 | v7 处理 |
|---|---|---|
| 工作区列表占中间列 | 中间列是「选择工作区」长列表（名称 + 绝对路径） | 中间列改为技能 / MCP 列表；工作区移入左 ScopeNav「项目」行下方，行高 34，只显示 basename（路径已在 header 显示） |
| 左列只有 全局 / 项目 | 左列 全局 146 + 项目 | 左列 = 全局行、项目行（active）+ 项目下的工作区列表；行尾保留 `+` |
| 中间列与详情 | 中 320 + 详情 | 中 300（标题 + 计数 + `+` + 3–5 行）；详情 676（内容 628） |

## 2. 执行顺序（Lead 依次粘贴到 `use_figma`）

| # | 脚本 | 作用 | 幂等 |
|---|---|---|---|
| 1 | `00-init.js` | 建/重置页 `Capability Panel · 交互原型 v7`、2 画框、克隆 v5 sidebar(4:8) 并修正「能力面板」高亮、页标题/副标题 | 清空整页重建 |
| 2 | `01-skills-project.js` | 帧 01「技能 · 项目」：ScopeNav + 技能列表 + 技能详情 | 清空帧内除 `sidebar` 外节点 |
| 3 | `02-mcp-project.js` | 帧 02「MCP · 项目」：ScopeNav + MCP 列表 + MCP 详情（工具参数两栏） | 同上 |

- 返回：00 `{ pageId, frames[] }`；01/02 `{ frame, children }`。
- **dynamic-page**：用 `await figma.setCurrentPageAsync(page)`；帧内全部用原生可编辑图层（FRAME / TEXT / ELLIPSE），无图片、无阴影渐变。
- 只跑 00→01→02；05（v6 侧栏修复）不适用，v7 的侧栏修正在 00 内完成。

## 3. 布局坐标（1440×900，帧内绝对坐标）

```
侧栏 256（4:8 克隆） │ 主区 1184（x=256）
头部两行：
  line1  0–51    标题「能力面板」276,16 17/600；路径 360,19 12.5；右侧胶囊 1204,10 216×34
  line2  52–103  域 Tab 276,60 300×36（选中项 279,63 147×30）；搜索框 1096,60 320×36（右对齐）
body y=104（高 796）：左 ScopeNav 208（256–464）│ 中 列表 300（464–764）│ 右 详情 676（764–1440，内容 628）
```

**左 ScopeNav（208）**：分隔线 x=463；行宽 192、x=264。
- `全局` 行 y=112 h=32：名称 13/600 + 计数 146（右对齐 11 #7F8794）+ 行尾 `+`。
- `项目` 行 y=148 h=32，active（底 #2A303B r8）+ 计数 12 + `+`。
- 工作区列表 y=186 起，行高 34、x=272 w=184（相对「项目」行缩进 8）（14 行：Desktop / HtDot / dsh-setup / RemoteTTS / miraclip_ai / research / miraclips / agent-workspace / **LiveShopping（选中 #2A303B + 左 2px 蓝条）** / mira-ai / mira-live / OmniJev / Evoke / Raise），名称 12 起 13px，自身滚动条 x=458。

**中列（300）**：分隔线 x=763；标题行 y=112（`LiveShopping` 13.5/600 + 计数胶囊 + 蓝色 `+` 720,112 32×32）；列表 y=156 起，行 x=472 w=284。
- 技能行 h=76：点 12,13；名称 24,7（170×20）；标签 y=28；描述 12,50（184×20）；行尾「启用」+ 开关 244,29（30×18）。
- MCP 行 h=72：名称 24,7；标签 y=28；meta 24,49（184×18）；行尾「默认」+ 开关 244,27。

**右详情（676，内容 628，x=788..1416）**
- 技能帧：标题 788,132（18/600）+ 标签 1070/1110 + 复制路径 1330；动作 176（已启用/导出/导出到路径…/删除，h30 pill）；元信息 218 h36；内容 266 h614 = 文件树 200（788）+ 16 + 阅读器 412（1004），树行 h30、徽标 x=118、大小 x=156、引导线 28/38，阅读器含 `预览/源码` 分段。
- MCP 帧：标题 788,132 + 标签 890/926 + 复制命名空间；动作 176（导入到本项目/编辑/查看工具与参数/使用记录/删除）；字段 218–398（命名空间/命令/参数/配置文件/状态，含分隔线）；工具与参数 418 h292：左工具列表 230（行 h34，选中 `mcp__AnySearch__search`）+ 右参数表（列 268/360/422/462，行 h32：query 必填、max_results 可选、search_depth 可选）；使用记录 722 h100（两行）。

## 4. 节点命名

```
page-title / page-subtitle / <帧名> · 帧标题
Frame → sidebar
  header/{title,workspace,workspace-dd(+text),tabs→tab-skills|tab-mcp(+t),search(+search-ph,search-icon,search-handle),line1,line2}
  scope/{divider,global,project}(+label,count,plus) │ ws/<basename>(+bar,name) │ scope/scrollbar
  list/{divider,title,count(+t),add(+t),scrollbar} │ row/<id>(+sel-bar,dot,name,tag-*,desc|meta,toggle-label,switch→knob)
  detail/{name,tag-*,copy-path,copy-ns} │ act/* │ meta/*
  detail/tree(+title,count,line,scrollbar) → tree/<item>(+icon,bg,bar,label,count,badge→/t,size) + tree/guide-d1|d2
  detail/reader(+file,meta,seg→seg-on/off,line,scrollbar) → md/h1|p1|h2|list|code(+code-text)|p2
  field/<key>/label|value │ collapse/tools(+title,meta,chev,line,div) → tools/<id>/{bg,bar,name,desc} | params/*
  collapse/usage(+title,meta,chev,line) → usage/{time,session,tool}-<n>
```

## 5. 验收点

1. 两个画框 1440×900；左 256 为 v5 sidebar 克隆，侧栏「能力面板」为高亮态（不再高亮「多能力会话配置」）。
2. **中间列不再出现工作区列表**：中列 = 标题（LiveShopping + 计数）+ 3–5 行技能/MCP。
3. 工作区列表在左 ScopeNav 的「项目」行下方，行高 34、14 行、可滚动示意；LiveShopping 选中（底 #2A303B + 左蓝条）。
4. 「全局 146」「项目 12」计数与行尾 `+` 都在；点击区域 192×32。
5. 三列宽 208 / 300 / 676，分隔线 463 / 763；右侧内容 628（788..1416），与 16 间距一致。
6. 行尾开关统一 30×18（skills 文案「启用」、MCP「默认」），开 #61AFEF / 关白 13%；技能行开/关、MCP 行开关状态合理。
7. 技能详情：文件树 200（root + 缩进 + MD/JSON/PNG 徽标 + 大小 + 引导线）+ 阅读器 412（预览/源码）。
8. MCP 详情：字段完整 + 工具参数两栏（左列表选中、右参数表 参数/类型/必填/说明）+ 使用记录，整帧不超出 900。
9. 文字零溢出：长名称 / 路径 / 参数说明均截断，不压相邻元素；标签不与开关重叠。
10. 脚本幂等 + dynamic-page 兼容：重跑不产生重复节点、不新增页面、不动 v6 页与 4:2 / 1:2。
