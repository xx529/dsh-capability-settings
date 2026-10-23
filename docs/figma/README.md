# Figma 原型（Dock v5 · 能力面板 v6–v8 · Jev/能力决策 v9–v11）

本目录是能力面板相关 UI 的 Figma 设计源，供人工查看 / 未来智能体继续改原型：

- **Capability Dock · 终稿 v5**（`4:2`）：「输入框下方会话能力配置区」的终稿（历史，保留）；
- **Capability Panel · 升级原型 v6**（`10:2`）：「能力面板」v2 升级原型（同屏双组版，历史）；
- **Capability Panel · 交互原型 v7**（`21:2353`）：第三轮 IA（工作区列表移入左侧导航）确认稿（历史）；
- **Capability Panel · 终稿 v8**（`42:3373`）：面板列表/详情/手风琴的终稿（1.3.4 实现同步：工作区
  列表两种 scope 常驻、MCP 工具参数手风琴、全局 MCP 含外部注入组）；可编辑图层由
  `prototype/v8/` 脚本生成，并已导出可重导入的 `scenes/v8-01..04.scene.json` + `preview/v8-*.png`；
- **Capability Panel · Jev 模型 v9**（page `49:4455`）：首屏「自动选择」入口/结果/评分中 +
  Jev 模型配置 Tab（历史原型，4 帧）；
- **Capability Panel · 自主决策 v10**（page `51:5711`）：改名「自主决策」，交互改为输入停顿
  约 1s 后自动触发（历史原型，5 帧）；
- **Capability Panel · 能力决策 v11**（page `56:7043`）：**当前设计基线**——统一命名「能力决策」、
  自动触发默认关闭、双门槛（最少触发字数 10 / 最少修改间隔字符数 4）、密钥路径
  `~/.dsh/capability-panel/jev.json`（目录 700 / 文件 600）。5 帧：01 `56:7046`、02 `56:7257`、
  03 `56:7468`、04 `56:7679`、05 `56:7890`。

> **2026-10-24 文案精简状态（v11 03/04）**：按用户反馈删除结果/加载帧的说明行
> （`v11/hdr/desc`），`prototype/v11/03-loading.js`、`04-results.js` **已更新**（状态行/阈值行
> 上移、骨架/结果行起点 80、行距重算）。但本次会话 Figma 画布 MCP 工具不可用
> （`figma_status` 正常、`mcp__figma__*` 未暴露），因此
> **`preview/v11-03-loading.png`、`preview/v11-04-results.png` 仍是删除前版本，待下次重导**；
> 其余 v11 预览（01/02/05）与脚本一致。重导方式见 §3.1.1。

> **v9–v11 的 scene JSON 尚未导出**：`scenes/` 目前只到 v8。这三个页面以
> `prototype/v9|v10|v11/` 建稿脚本 + `preview/v9-*…v11-*` 预览图为交付物；需要可重导入的
> scene 时，按对应脚本顺序在 Figma 内重建（见 §3.1），或后续用 `tools/export-scene.js`
> 补导出后再补 `scenes/v9-*…v11-*`。不要把 v9–v11 当成已有 scene 快照。

设计文档说明见 [`../../notes/design/capability-dock.md`](../../notes/design/capability-dock.md)
（v5）与 [`../ux/panel-upgrade.md`](../ux/panel-upgrade.md)（能力面板交互规格，入库）。

## 1. 设计文件与节点

Figma 本地文档：**`dsh`**（DSH to Figma 本地桥，见根 `AGENTS.md`「Figma 原型」一节）。

| 页面 | page id | 画框 | node id |
|---|---|---|---|
| Capability Dock · 终稿 v5 | `4:2` | 00 · v5 终稿（画板） | `4:3` |
| 同上 | | 01 · 首屏 hero · 输入框下方默认展开 | `4:7` |
| 同上 | | 02 · 会话内 · 能力 Tab（隐藏输入框） | `4:223` |
| Capability Panel · 升级原型 v6 | `10:2` | 01 · 技能总览（双作用域同屏） | `10:5` |
| 同上 | | 02 · 技能详情（SKILL.md + 文件树） | `10:61` |
| 同上 | | 03 · MCP 总览（三组） | `10:117` |
| 同上 | | 04 · MCP 详情（外部只读） | `10:173` |
| Capability Panel · 交互原型 v7 | `21:2353` | 01 · 技能 · 项目（工作区列表在左导航） | `21:2356` |
| 同上 | | 02 · MCP · 项目（工作区列表在左导航） | `21:2413` |
| Capability Panel · 终稿 v8 | `42:3373` | 01 · 技能 · 项目 | `42:3376` |
| 同上 | | 02 · 技能 · 全局 | `42:3433` |
| 同上 | | 03 · MCP · 项目 | `42:3490` |
| 同上 | | 04 · MCP · 全局 | `42:3547` |
| Capability Panel · Jev 模型 v9（历史） | `49:4455` | 01 · 首屏 · 自动选择入口 | `49:4458` |
| 同上 | | 02 · 自动选择 · 结果 | `49:4669` |
| 同上 | | 03 · 自动选择 · 评分中 | `49:4880` |
| 同上 | | 04 · 能力面板 · Jev 模型 | `49:5091` |
| Capability Panel · 自主决策 v10（历史） | `51:5711` | 01 · 首屏 · 自主决策入口 | `51:5714` |
| 同上 | | 02 · 输入停顿 · 自动触发 | `51:5925` |
| 同上 | | 03 · 自主决策 · 评分中 | `51:6136` |
| 同上 | | 04 · 自主决策 · 结果 | `51:6347` |
| 同上 | | 05 · Jev 模型 · 配置（含自动决策） | `51:6558` |
| Capability Panel · 能力决策 v11（**当前基线**） | `56:7043` | 01 · 首屏 · 能力决策入口 | `56:7046` |
| 同上 | | 02 · 输入停顿 · 自动触发 | `56:7257` |
| 同上 | | 03 · 能力决策 · 评分中 | `56:7468` |
| 同上 | | 04 · 能力决策 · 结果 | `56:7679` |
| 同上 | | 05 · Jev 模型 · 配置（含能力决策） | `56:7890` |
| Capability Dock · 交互原型（历史 v1–v4） | `1:2` | 保留不动，仅作演进记录 | — |

## 2. 文件

```
docs/figma/
├── README.md                      ← 本文件
├── scenes/
│   ├── 01-hero.scene.json         ← v5：import_scene 契约：{ nodes: [FRAME...] }
│   ├── 02-capability-tab.scene.json
│   ├── v8-01-skills-project.scene.json  ← v8 四帧（面板终稿，可直接 import_scene）
│   ├── v8-02-skills-global.scene.json
│   ├── v8-03-mcp-project.scene.json
│   └── v8-04-mcp-global.scene.json
│   # v9/v10/v11：scene JSON 尚未导出（只有 preview + prototype 脚本，见 §3.1）
├── preview/
│   ├── 01-hero.png                ← v5 导出预览图（1440×900）
│   ├── 02-capability-tab.png
│   ├── v6-01-skill-overview.png   ← v6 四帧真实导出（1440×900）
│   ├── v6-02-skill-detail.png
│   ├── v6-03-mcp-overview.png
│   ├── v6-04-mcp-detail.png
│   ├── v7-01-skills-project.png   ← v7：工作区列表在左导航（技能）
│   ├── v7-02-mcp-project.png      ← v7：工作区列表在左导航（MCP）
│   ├── v8-01-skills-project.png   ← v8 四帧真实导出（面板终稿）
│   ├── v8-02-skills-global.png
│   ├── v8-03-mcp-project.png
│   ├── v8-04-mcp-global.png
│   ├── v9-01-entry.png            ← v9（历史）：自动选择入口 / 结果 / 评分中 / Jev 配置
│   ├── v9-02-results.png
│   ├── v9-03-loading.png
│   ├── v9-04-config.png
│   ├── v10-01-entry.png           ← v10（历史）：自主决策 + 停顿自动触发
│   ├── v10-02-pause.png
│   ├── v10-03-loading.png
│   ├── v10-04-results.png
│   ├── v10-05-config.png
│   ├── v11-01-entry.png           ← v11（**当前基线**）：能力决策
│   ├── v11-02-pause.png
│   ├── v11-03-loading.png         ← ⚠ 文案删除前版本，待重导（2026-10-24）
│   ├── v11-04-results.png         ← ⚠ 文案删除前版本，待重导（2026-10-24）
│   └── v11-05-config.png
├── prototype/                     ← 建稿脚本（v6 在本目录，v7–v11 在各自子目录）
│   ├── 00-init.js                 ← 建页 + 4 画框 + 克隆 v5 sidebar
│   ├── 01-skill-overview.js
│   ├── 02-skill-detail.js
│   ├── 03-mcp-overview.js
│   ├── 04-mcp-detail.js
│   ├── 05-sidebar-fix.js          ← 侧栏高亮「能力面板」（幂等，最后跑）
│   ├── spec-v6.md                 ← 节点树 / 坐标 / 验收点
│   ├── v7/                        ← 第三轮 IA 原型
│   │   ├── 00-init.js
│   │   ├── 01-skills-project.js
│   │   ├── 02-mcp-project.js
│   │   └── spec-v7.md
│   ├── v8/                        ← 面板终稿（1.3.4 同步）
│   │   ├── 00-init.js
│   │   ├── 01-skills-project.js
│   │   ├── 02-skills-global.js
│   │   ├── 03-mcp-project.js
│   │   ├── 04-mcp-global.js
│   │   └── spec-v8.md
│   ├── v9/                        ← 「Jev 模型」自动选择原型（历史）
│   │   ├── 00-init.js
│   │   ├── 01-entry.js
│   │   ├── 02-results.js
│   │   ├── 03-loading.js
│   │   ├── 04-config.js
│   │   └── spec-v9.md
│   ├── v10/                       ← 「自主决策」+ 停顿自动触发（历史）
│   │   ├── 00-init.js
│   │   ├── 01-entry.js
│   │   ├── 02-pause.js
│   │   ├── 03-loading.js
│   │   ├── 04-results.js
│   │   ├── 05-config.js
│   │   └── spec-v10.md
│   └── v11/                       ← 「能力决策」当前基线（默认关闭 + 双阈值）
│       ├── 00-init.js
│       ├── 01-entry.js
│       ├── 02-pause.js
│       ├── 03-loading.js
│       ├── 04-results.js
│       ├── 05-config.js
│       └── spec-v11.md
└── tools/
    └── export-scene.js            ← 从 Figma 重新导出 scene JSON 的 use_figma 脚本
```

## 3. 重新导入到 Figma（智能体步骤）

1. `figma_status` 确认 `dsh` 文档已连接；断连时 `figma_select_document <connectionId>` 重新绑定。
2. 读取 `docs/figma/scenes/*.scene.json`，取 `scene.nodes`。
   > 目前 `scenes/` 只有 v5（`01-hero` / `02-capability-tab`）与 v8（4 帧）；
   > **v9–v11 没有 scene JSON，不能 import_scene**，请改用 §3.1 的建稿脚本重建。
3. 调用 Figma MCP 的 `import_scene`：
   ```jsonc
   {
     "nodes": [ /* scene.nodes，最多 500 个节点 */ ],
     "parentId": "可选：目标画板/页面内父节点 id"
   }
   ```
   - **01 与 02 可一次导入**（165 + 142 = 307 节点 < 500）：画框自带 x/y（01 在 `0,150`，02 在 `1520,150`），会并排出现。
   - 单次工具参数很大时，分两次导入（每个文件一次）。
   - 导入后可 `get_screenshot` / `download_assets` 与 `docs/figma/preview/*.png` 对照。
   - **v8（面板终稿基线）一次性导入**：四个 `scenes/v8-*.scene.json` 各含一个独立画框
     （01/02 在 y=150，03/04 在 y=1200，x=0/1520），合计约 229 个节点 < 500，可一次
     `import_scene({ nodes: [ ...v8-01, ...v8-02, ...v8-03, ...v8-04 ] })` 重建 4 帧；
     也可只导入其中一帧，或分文件导入。对应页面/node id 见 §1，预览见 `preview/v8-*.png`。
4. 若导入后想改设计：直接编辑 Figma 节点，然后**重新导出**（见下一节）并覆盖 scene JSON + 预览图。

### 3.1 重建 v9 / v10 / v11（无 scene JSON）

v9–v11 的 scene JSON 尚未导出；这三页以 `prototype/v9|v10|v11/` 建稿脚本为唯一事实源，
在 Figma 内按脚本顺序执行即可重建可编辑图层（脚本自包含、幂等，含 `v9/`/`v10/`/`v11/`
前缀清理，克隆底座 4:7 / 42:3376 保留）：

| 页面 | 执行顺序 |
|---|---|
| v9（历史） | `00-init` → `01-entry` → `02-results` → `03-loading` → `04-config` |
| v10（历史） | `00-init` → `01-entry` → `02-pause` → `03-loading` → `04-results` → `05-config` |
| v11（当前基线） | `00-init` → `01-entry` → `02-pause` → `03-loading` → `04-results` → `05-config` |

- 每段脚本整体贴进 `use_figma` 执行；`00-init` 会清空并重建对应页面，`01–05` 各自定位页面/帧名。
- 单独重跑 `01` 会把 capability-panel 复位到 920×320 并恢复底座子节点，之后需按顺序重跑后续帧脚本。
- 重建后用 `get_screenshot` / `download_assets` 与 `preview/v9-*…v11-*` 对照；
  若要补 scene JSON，后续用 `tools/export-scene.js` 按帧 id 导出（见 §4）。

### 3.1.1 2026-10-24 v11 03/04 文案精简后的重建 / 重导

- **已更新脚本**：`prototype/v11/03-loading.js`、`04-results.js`——删除 `v11/hdr/desc`；
  03 状态行上移（spinner 49 / 文案 y=40）、分隔线 74、骨架起点 80；04 阈值行上移（y=40 / 滑杆 52）、
  分隔线 74、结果行起点 80，行距按面板高度重算。
- **重跑顺序**：Figma 工具可用时只跑 `03-loading.js` → `04-results.js` 即可（幂等，先清 `v11/`
  前缀旧节点；无需重跑 00-init/01/02/05）。
- **重导预览**：重跑后用
  `download_assets({ nodeIds: ["56:7468","56:7679"], format: "PNG", scale: 1 })`
  重新截图，覆盖 `preview/v11-03-loading.png`、`preview/v11-04-results.png`。
- **当前状态**：本次会话画布 MCP 不可用（`figma_status` 正常、`mcp__figma__*` 未暴露），
  上述两张预览仍为**删除前版本**；在重新导出前，不要用它们核对最新 03/04 视觉。
- **scene JSON**：v9–v11 均未导出（`scenes/` 仍只有 v5/v8），本次不变。

## 4. 从 Figma 重新导出

1. 把 `docs/figma/tools/export-scene.js` 整段贴进 `use_figma` 执行。
2. 调整脚本顶部参数：
   - `TARGET_NODE_ID`：`4:7`（首屏）或 `4:223`（能力 Tab）；
   - `SERIALIZE_RANGE`：先 `[0, 24000]`，再 `[24000, null]`，分两次拿 `part` 字符串；
     单次输出过大时 DSH 会存到 spill 文件，可用 `grep` 找到完整 `part`。
3. 把两次的 `part` 拼接 → `JSON.parse` → 写入 `docs/figma/scenes/*.scene.json`（`{ nodes: [...] }`）。
4. 重新导出 PNG 预览：
   ```
   download_assets({ nodeIds: ["4:7", "4:223"], format: "PNG", scale: 1 })
   ```
   把生成文件复制到 `docs/figma/preview/`。

## 4.1 手动导出（不依赖智能体）

- Figma 里选中 `4:7` / `4:223` → 右侧 Export → 选 `PNG 1x` / `SVG`，即可得到可拖入 Figma
  （SVG 为可编辑矢量层，文字可能被轮廓化）或用于评审的图片；`docs/figma/preview/` 里已有本次导出的 PNG。
- 画布工具偶发 `unknown tool`：先 `figma_status` 确认文档已连接；若工具仍未注册，关闭并重开
  Figma 里的「DSH to Figma · Local」插件，再 `figma_select_document <connectionId>` 后重试；
  仍失败时重启 DSH 会话再操作（不要用旧截图冒充新设计）。

## 5. 已知限制（导出/导入）

- scene 契约只支持 `FRAME / TEXT / RECTANGLE / ELLIPSE / COMPONENT / SECTION / STICKY / SHAPE_WITH_TEXT`；
  **VECTOR 图标路径会被跳过**（导入后图标为空，需要 `upload_assets` 导入 SVG 或用 `use_figma` 补画）。
- 只保留 SOLID 填充/描边、圆角、像素行高与自动布局属性；渐变、阴影、模糊、混合模式、图片填充不导出。
- 文字字体为 `PingFang SC`（Regular/Medium/Semibold），导入前 Figma 需已加载该字体（本机 Figma 已安装）。
- `import_scene` 不是网页捕获：它只重建显式 layer，不还原交互/运行时逻辑。
- 已用 2 节点小场景实际调用 `import_scene` 验证 `x/y/width/height/TEXT` 契约可用；**整份
  307 节点**的导入未在本会话逐字节验证（工具参数量大），首次导入后请用 `preview/*.png` 对照，
  必要时分两次导入或先导入一个画框。

## 6. 设计口径（v5 终稿）

- 两个入口：首屏（hero）输入框下方默认展开面板；会话内顶部「能力」Tab。
- 无「仅本会话」标签、无 Tab 栏「+」、无输入框「能力」图标/快捷弹层、无底部能力条。
- 「能力」Tab 打开时隐藏输入框；整页右侧预留 64px 外壳浮动控件安全区。
- Skills 会话级开关 = 关闭/恢复（agent 作用域 runtime shadow）；MCP 只做服务器级。

## 7. v6 升级原型（能力面板 v2.1 之前的 IA）

> **注意**：v6 的 4 帧对应「同屏双组」版 IA；第三轮交互调整（左 ScopeNav「全局 / 项目」、
> 项目先列工作区再下钻、头部第二行 Tab 左 + 搜索右、添加按钮在 scope 行右侧）**尚未同步到
> Figma 帧**，当前以 `docs/ux/panel-upgrade.md` v1.3 与代码实现为准。重新出图时按该文档 §4/§9
> 的 6 帧建议清单更新本页。

设计口径（与 `docs/ux/panel-upgrade.md` v1.2 一致，第三轮前）：

- 域 Tab 只剩「技能 / MCP」，各带条目计数（技能 = 项目 + 全局；MCP 不含外部注入）。
- 列表同屏分组：技能「本项目 / 全局」；MCP「本项目 / 全局 / 外部注入（非空才出现）」；
  组头带计数与说明，组内独立滚动，空组折叠。
- 行尾统一开关（30×18）：技能 =「启用」（项目整体启停；全局 = 在本项目禁用/恢复），
  MCP =「默认」（新建对话是否启用）；行内不再有文字按钮。
- 技能详情 = 标题/动作/元信息 + 目录树（220）+ 阅读器（580，「预览 / 源码」）；
  数据复用 `skills.export`，无新增宿主 RPC。
- MCP 详情 = 左工具列表（可点选）+ 右参数表（参数 / 类型 / 必填 / 说明，来自
  `inputSchema` 的 `properties` + `required`）；外部注入只读详情复用同一检视器。
- 帧尺寸 1440×900（含 256px sidebar 语境）；字体 PingFang SC，代码/路径 Menlo。

### 7.1 重新生成 v6 页面

1. `figma_status` 确认 `dsh` 已连接；必要时 `figma_select_document <connectionId>`。
2. 依次把 `prototype/00-init.js` → `01` → `02` → `03` → `04` → `05` 整段贴进 `use_figma` 执行
   （脚本均为幂等：`00` 清空 v6 页重建画框，`01–04` 只重建对应帧主区并保留 sidebar，
   `05` 修正侧栏高亮）。注意 dynamic-page 模式必须用 `await figma.setCurrentPageAsync(page)`，
   不能直接赋值 `figma.currentPage`。
3. 每帧 `get_screenshot` / `download_assets` 与 `preview/v6-*.png` 对照；设计变更后
   用 `download_assets({ nodeIds:["10:5","10:61","10:117","10:173"], format:"PNG", scale:1 })`
   覆盖预览图。
4. 若要导出可重导入的 scene JSON：复用 `tools/export-scene.js`，把 `TARGET_NODE_ID`
   换成上表 v6 帧 id（脚本需先 `await figma.loadAllPagesAsync()`），按 `SERIALIZE_RANGE`
   分片取 `part` 后拼接写入 `scenes/v6-*.scene.json`。v6 的可编辑图层以 `prototype/` 脚本
   为唯一事实源，scene JSON 只是可选快照。

## 8. v9 → v11 演进（Jev 配置与「能力决策」）

| 版本 | 命名 | 交互 | 配置要点 | 帧数 |
|---|---|---|---|---|
| v9（历史） | 自动选择 | 点按入口 | Jev 模型配置 Tab（Base URL / 模型 / API Key） | 4 |
| v10（历史） | 自主决策 | 输入停顿约 1s 自动触发（可配置） | 新增「自动决策」区：开关 + 停顿阈值 1000ms | 5 |
| v11（**当前基线**） | **能力决策** | 点按立即决策 + 停顿自动触发（默认关闭） | 默认关闭；三个数值字段：停顿阈值 1000ms、最少触发字数 10、最少修改间隔字符数 4；密钥 `~/.dsh/capability-panel/jev.json`（目录 700 / 文件 600） | 5 |

- 命名演进口径：v9「自动选择」→ v10「自主决策」→ v11「能力决策」（当前）；v9/v10 仅作历史对照。
- 三页均**只导出预览图与建稿脚本，scene JSON 未导出**；v11 的实现与验收以 `prototype/v11/spec-v11.md` 为准。
- 2026-10-24：v11 03/04 删除说明行（脚本已更新）；**03/04 两张预览待重导**（画布 MCP 本次不可用），
  重导步骤见 §3.1.1。
