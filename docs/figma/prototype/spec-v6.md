# Capability Panel · 升级原型 v6 —— 建稿规格（第二版）

> 目标：在 Figma 文档 `dsh` 页面 **`Capability Panel · 升级原型 v6`** 的 4 个 1440×900 画框里，搭原生可编辑图层。
> 只写本目录；不改 `src/`、不改 v5 页 `4:2` 与 v1–v4 页 `1:2`。
> 视觉常量见 `docs/research/figma-recon.md` §5，布局/线框见 `docs/ux/panel-upgrade.md` §4 与 §9。

## 1. 执行顺序（Lead 逐条粘贴到 `use_figma`）

| # | 脚本 | 作用 | 幂等性 |
|---|---|---|---|
| 1 | `00-init.js` | 建/重置页、4 画框、为每帧克隆 v5 sidebar(4:8)、页标题/帧标题 | 清空整页再建 |
| 2 | `01-skill-overview.js` | 帧 01 主区：技能总览（双作用域同屏） | 清空帧内除 `sidebar` 外节点 |
| 3 | `02-skill-detail.js` | 帧 02 主区：技能详情（目录树 + SKILL.md，详情最大化） | 同上 |
| 4 | `03-mcp-overview.js` | 帧 03 主区：MCP 三组 + AnySearch 详情（工具参数面板） | 同上 |
| 5 | `04-mcp-detail.js` | 帧 04 主区：figma 外部只读详情（工具参数面板 + 折叠使用记录） | 同上 |
| 6 | `05-sidebar-fix.js` | 侧栏当前页高亮改到「能力面板」（不改 01–04） | 删旧高亮重建 |

- 01–04 返回 `{ frame, children }`；00 返回 `{ pageId, frames[], sidebarMissing }`；05 返回每帧 `hiddenActive / label / highlight / dot`。
- **dynamic-page 模式**：用 `await figma.setCurrentPageAsync(page)`，不要写 `figma.currentPage = page`。
- 05 只需在 01–04 之后跑一次（或换帧后重跑），4 帧一起修；不必随每次改帧重跑。

## 2. 节点树与命名

```
Page  Capability Panel · 升级原型 v6
├─ page-title / page-subtitle                 30 Semibold / 14 Regular
├─ <帧名> · 帧标题                              17 Semibold #DEE3EC
└─ Frame 1440×900  (clipsContent, #1E222B, 无阴影)
   ├─ sidebar                                  ← 4:8 克隆，x0 y0 256×900
   ├─ header/title | workspace | workspace-dd(+text) | tabs → tab-skills/tab-mcp(+t) | line
   ├─ toolbar/search(+search-ph, search-icon, search-handle) | cta(+t) | line
   ├─ list/divider | list/scrollbar
   ├─ grp/{project,global,external}(+title,count,count-t,note,line)
   ├─ row/<id>(+dot,name,tag-*,desc|meta|summary,toggle-label,switch→knob,sel-bar)
   ├─ detail/name | tag-* | copy-path | copy-ns
   ├─ act/<enabled|export|export-path|delete|import|edit|tools|usage>
   ├─ meta/source | meta/path | meta/caps | field/<key>/label|value | field/line-*
   ├─ notice/readonly(+text)
   ├─ detail/tree(+title,count,line,scrollbar) → tree/<item>(+icon|bg,bar,label,count,badge→badge/t,size) + tree/guide-d1/d2
   ├─ detail/reader(+file,meta,seg→seg-on/off,line,scrollbar) → md/h1|p1|h2|list|quote-bar|quote|h2b|code(+code-text)|p2|p3
   └─ collapse/{tools,usage}(+title,meta,chev,line)
        tools → tools/<id>/{bg,bar,name,desc} | params/{title,count,h-name,h-type,h-req,h-desc,line} | params/<param>/{name,type,req,desc}
```

## 3. 每帧内容（第二版）

| 帧 | 画框名 | 位置 | 内容要点 |
|---|---|---|---|
| 01 | `01 · 技能总览（双作用域同屏）` | 0,150 | 本项目 3 + 全局 4 行，行尾「启用」+开关；详情：目录树 220（计数 5）+ SKILL.md 阅读器 580 |
| 02 | `02 · 技能详情（SKILL.md + 文件树）` | 1520,150 | 列表 3+3 行（同开关），详情最大化：目录树 240（计数 6）+ 阅读器 560，内容区 584 |
| 03 | `03 · MCP 总览（三组）` | 0,1200 | 本项目 2 / 全局 4 / 外部注入 1，行尾「默认」+开关；AnySearch 详情：字段 + 工具参数面板（左列表 240 高 + 右参数表）+ 使用记录 |
| 04 | `04 · MCP 详情（外部只读）` | 1520,1200 | 选中 figma(外部注入)；只读说明条；8 字段；工具参数面板（216）+ 折叠使用记录（44） |

开关状态（01–04 统一）：skills 本项目 = 开/关(屏蔽占位)/开；全局 = 开、开、开但**置灰**（项目副本生效中，轨道白 8%、knob 在右）、开。MCP = AnySearch 开、playwright 开、context7 开、deepwiki 开、open-computer-use 开、tavily 开、figma 关。**行内不再有文字动作按钮**，动作只留在详情。

## 4. 关键坐标（帧内绝对坐标）

- 主区 x=256；内容区 y=140；列表 256/320；详情 576/864（内容宽 816，左内边距 24）。
- header：标题 276,16；路径 360,19；下拉 1204,8；Tab 轨道 276,51；分隔线 y=87。toolbar：搜索 276,96(1012×36)；CTA 1304,96(112×32)；分隔线 y=139。
- **行尾开关**：switch 30×18 knob14，x=264；skills y=29（行 76 高居中）、MCP y=27（行 72 高居中）；label x=224 w=32 右对齐 10.5 #7F8794，文案 skills「启用」/ MCP「默认」。
- 技能行 264×304×76：点 12,13(8)；名称 24,7(200×20)；标签 y=28；描述 12,50(214×20)；开关 264,29。
- MCP 行 264×304×72：名称 24,7 宽 `min(170, txtw+16)`；标签 y=10；meta 24,29 宽 192；摘要 24,49 宽 192；开关 264,27。
- 详情：标题 y=160（02 帧 164/156 组）、动作 y=212(209)、元信息 y=264(252)、内容区 y=312(296)。
- **目录树**（行高 30/32，头部 36/40，行首：root y=44/48，子项 +30/+32）：
  - F1 宽 220：base 12、徽标 x=132、大小 x=176；行 = root(▾, Menlo 11 #9DA5B4)、SKILL.md(选中)、workflow.md、references/(▾ 2)、schema.json、example.png、examples.md。
  - F2 宽 240：base 14、徽标 x=150、大小 x=190；多一行 patterns.md，references/ 计数 3。
  - 子项缩进 14/28；文件夹 = ▾/▸ + 名称 + `/` + 计数；文件 = 22×14 r3 白 6% 徽标（MD/JSON/PNG，Menlo 8.5）+ 名称 + 右侧大小。
  - 引导线 1px 白 8%：F1 x=30（y74 h180）/ x=44（y164 h60）；F2 x=32（y80 h224）/ x=46（y176 h96）。
- **工具与参数面板**：头部 40（标题 + `17 个工具 · 点击工具查看参数` + ▾）+ 分隔线；左列 w=300、行 h=34（工具名 Menlo 11.5 + 说明 10.5），选中行底 #2A303B + 左 2px 蓝；分隔线 x=312；右侧 x=340：标题（Menlo 11.5 #8FBCFF）+「N 个参数」，表头 参数/类型/必填/说明（列 340/452/524/572），行 h=32，必填橙色 10。
  - 03：面板 600,464 816×248；选中 `mcp__AnySearch__search` → query(string,必填,搜索关键词)、max_results(number,可选,返回条数，默认 10)、search_depth(string,可选,basic / advanced)；使用记录 600,720 816×110（两行）。
  - 04：面板 600,604 816×216；选中 `mcp__figma__figma_select_document` → connectionId(string,必填,文档连接 ID（由 figma_status 返回）)+「无其他参数」；使用记录折叠 600,828 816×44（仅头部 + ▸）。

## 5. 视觉常量（脚本内联 C 对象）

底 #1E222B / 面板 #23272F / Tab 轨道 #1B1F27 / Tab 选中 #2E3540 / 行选中 #2A303B / 面板深底 #1F232B / 代码块 #151920；
主蓝 #61AFEF / 亮蓝 #8FBCFF / 绿 #98C379 / 警告 #D19A66 / 红 #E06C75；文字 #E3E6EA / #9DA5B4 / #7F8794；
描边白 6%（分隔）/8%（输入、引导线）/13%（开关关轨道）/14%（次按钮）/蓝 40%（选中）；圆角：面板/树/阅读器 10、Tab 6/8、按钮 999、标签 4、开关 999、徽标 3；字体 PingFang SC，路径/代码 Menlo。

## 6. 验收点

1. 四帧均 1440×900，左侧 256px 为 v5 sidebar 克隆；无阴影、无渐变。
2. 零文字溢出/压行：长名称、路径、摘要、参数说明均截断；不压右邻元素。
3. 行内无文字按钮：只剩「名称 / 标签 / 描述 / 行尾开关」；动作只在详情。
4. 开关统一：30×18、knob 14、开 #61AFEF、关白 13%，行尾垂直居中；skills「启用」、MCP「默认」；置灰开关轨道白 8%、knob 在右。
5. 开关状态与 §3 一致（含 figma 关、session-retrospective 关、全局 agent-orchestration 置灰）。
6. 目录树是真树：root 行 + 缩进子项、文件夹带 `/` 与计数、文件带 MD/JSON/PNG 徽标与大小、1px 竖向引导线覆盖对应子项；F1 计数 5、F2 计数 6。
7. 选中态：Tab #2E3540、列表行 #2A303B + 左 2px 蓝条、树 SKILL.md 选中、工具列表选中行。
8. 分栏对齐：列表右分隔线 575；详情内容 600..1416；树与阅读器间距 16。
9. MCP 工具参数面板：左列表选中 + 右侧标题/参数表（参数/类型/必填/说明）完整，03 面板 248 高、04 面板 216 高；04 使用记录为折叠态且不超出 900。
10. 03/04 三组顺序：本项目 → 全局 → 外部注入；外部注入行带「默认」关开关且 04 帧选中。
11. 预览视图不显示 Markdown 标记：h1/h2 无 `#`/`##`，列表以 `• ` 开头。
12. 脚本重跑幂等：不产生重复节点、不新增页面、不动 4:2 / 1:2；dynamic-page 下可执行。
