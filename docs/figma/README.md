# Figma 原型（Dock v5 · 能力面板 v6–v8 · Jev/能力决策 v9–v11 · Skill 来源 v12 · 首屏入口 v14）

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
- **Capability Dock · 首屏入口 v14**（page `134:8699`）：**当前首屏交互基线**——能力入口收进
  输入框底部工具行（`conversation.input.left`）预留位，默认收起为「书 / 插头 / 工具箱
  + 已启用数 + ✦ + 滑杆」；点击计数区或滑杆打开居中配置弹窗（55% 遮罩 + 10px 背景模糊，
  1120 宽、随域自适应），`✦ 能力决策` 仍保留在入口。4 帧：01 `134:8700`（默认收起）、
  02 `134:8942`（Skills 弹窗）、03 `134:9184`（Tools 弹窗）、04 `134:9426`（全部关闭）。
  预览图 `preview/v14-01..04`；交互说明在页面底部 `v14/interaction-notes`。
- **Capability Panel · 能力决策 v11**（page `56:7043`）：**能力决策基线**——统一命名「能力决策」、
  自动触发默认关闭、双门槛（最少触发字数 10 / 最少修改间隔字符数 4）、密钥路径
  `~/.dsh/dsh-capability-settings/jev.json`（目录 700 / 文件 600）。5 帧：01 `56:7046`、02 `56:7257`、
  03 `56:7468`、04 `56:7679`、05 `56:7890`。
- **Capability Panel · Skill 来源 v12（提案）**（page `88:8519`）：把宿主技能注册表注入的 skill
  （内置 / 插件运行时 / 预设渠道）纳入技能列表与只读详情的提案稿，4 帧：01 `88:8523`（技能·全局）、
  02 `88:8797`（首屏·本会话能力）、03 `88:9011`（能力决策·结果）、04 `88:9375`（会话「能力」Tab）。
  **已「补丁式」并入基线**（v8 02/01 与 v11 04，见下方 2026-10-25 说明）；本页保留作提案与对照，
  不再单独维护。

> **2026-10-24 文案精简（v11 03/04，已完成）**：按用户反馈删除结果/加载帧的说明行
> （`v11/hdr/desc`）；`prototype/v11/03-loading.js`、`04-results.js` 已更新并已在画布重跑
> （状态行/阈值行上移、骨架/结果行起点 80、行距重算），`preview/v11-03-loading.png`
> （126025 B）、`preview/v11-04-results.png`（153292 B）已重导覆盖。画面核对：03 标题下无说明行、
> 状态行紧贴标题；04 标题下无说明行、阈值行紧贴标题，列表与底栏正常。

> **v14 首屏交互（2026-10-30）**：入口从「输入框下方独立能力条 / 默认展开内联面板」迁到
> `conversation.input.left` 工具行预留位；配置改为居中背景模糊弹窗。Figma 页 `134:8699`
> 的 4 帧为当前基线；预览图 `preview/v14-*`；**4 帧可重导入 scene JSON 已导出**
> （`scenes/v14-*.scene.json`，97 / 283 / 205 / 97 节点，均 < 500，可逐帧 `import_scene`；
> 见下方 v14 scene 表）。注意：scene 契约不含 VECTOR → 入口三个 icon（书/插头/工具箱）、
> `✦` 与滑杆图标导入后会缺失，需用 `use_figma` 重画或 `upload_assets` 补 SVG；
> 其余布局/文字/卡片/弹窗完整。交互以页面底部 notes 与预览图为准。

> **v11 已导出可重导入 scene JSON（2026-10-24）**：`scenes/v11-01-entry.scene.json`、
> `v11-02-pause.scene.json`、`v11-03-loading.scene.json`、`v11-04-results.scene.json`、
> `v11-05-config.scene.json`，均为 `{ nodes: [FRAME] }` 契约，单帧节点数 170 / 97 / 131 / **170**（04 已并入 v12 来源标签）/ 324；
> 导入方法见 §3.1.2。**v9/v10 仍只有 preview + prototype 脚本，scene JSON 未导出**，
> 重建按 §3.1 的脚本顺序执行。

> **2026-10-25 v12 已并入基线（补丁式，未新建基线页）**：由
> `prototype/v12/apply-baseline.js` 在既有帧上增改，作者/验收 = pm（Lead 机械执行画布脚本）：
>
> - **v8 02 技能 · 全局**（`42:3433`，+73 新建 / 净 +19 节点）：
>   「注入技能 5」分组（`v12/group/*`）+ 5 个注入行
>   （`v12/row/figma-workbench`、`v12/row/dsh-remote-deploy`、
>   `v12/row/dsh-diff-approval-annotate`、`v12/row/office`、`v12/row/office-docx`；
>   来源标签 内置/插件 + 渠道名 + 本项目默认开关；office 为关闭态）；
>   详情切到注入技能 figma-workbench（只读原因条 `v12/detail/readonly`、`v12/meta/mode`、
>   资源树 `v12/tree/*`、阅读器 `v12/reader/*`）；磁盘第 3–5 行与详情写按钮
>   **隐藏不删除**（pluginData `v12-hidden`，重跑脚本先恢复再隐藏）。
> - **v8 01 技能 · 项目**（`42:3376`）：仅左导航「全局」计数 146 → 157（`42:3623`），
>   项目内容与语义不变。
> - **v11 04 能力决策 · 结果**（`56:7679`，panel `56:7791`）：6 行结果加来源标签
>   （`v12/src/0..5`：全局 / dsh-to-figma / 全局 / 内置 / dsh-remote / 预设 cordis），
>   说明列右移，「已选 5 / 52」，底部说明增加「来源标签显示 …」；行内容 / 分数对齐 v12-03。
> - **历史页面未动**：v5 / v6 / v7 / v9 / v10 与 v12 提案页 `88:8519` 全部保持原样。
> - **预览重导**：`preview/v8-01-skills-project.png`（152633 B）、
>   `preview/v8-02-skills-global.png`（165194 B）、`preview/v11-04-results.png`（159880 B）。
> - **scene 重导（JSON 层重放）**：`prototype/v12/patch-scenes.mjs` 在基线 scene JSON 上重放
>   同一套增删改规则 → `scenes/v8-01-skills-project.scene.json`（**264** 可见节点）、
>   `scenes/v8-02-skills-global.scene.json`（**278**）、`scenes/v11-04-results.scene.json`（**170**）；
>   与画布真值（`prototype/v12/dump-tree.js` 的可见节点签名计数）一致：264 / 278 / 170。
>   三个文件均为 `{ nodes: [FRAME] }`、单帧、< 500 节点，可直接 `import_scene` 重导。
> - **校验工具**：`prototype/v12/00-inspect.js`（结构勘察）、`dump-tree.js`（导出可见节点签名，
>   与 `tools/export-scene.js` 同规则）、`apply-baseline.js`（幂等补丁）、
>   `patch-scenes.mjs`（scene JSON 重放）、`export-plan.md`（执行步骤）。执行时 Lead 的
>   两处画布修正已回写脚本：注入行名 `dsh-diff-approval-annotate`、references 计数 3。

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
| 同上 | | 02 · 技能 · 全局（v12 注入分组/只读详情已并入） | `42:3433` |
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
| Capability Dock · 首屏入口 v14（**当前首屏基线**） | `134:8699` | 01 · 首屏 · 默认收起（工具行 icon+计数入口） | `134:8700` |
| 同上 | | 02 · 点击「配置」→ 弹窗 · 背景模糊（Skills） | `134:8942` |
| 同上 | | 03 · 弹窗内切换 Tab（Tools） | `134:9184` |
| 同上 | | 04 · 首屏 · 全部关闭（入口仍在工具行） | `134:9426` |
| Capability Panel · 能力决策 v11（**能力决策基线**） | `56:7043` | 01 · 首屏 · 能力决策入口 | `56:7046` |
| 同上 | | 02 · 输入停顿 · 自动触发 | `56:7257` |
| 同上 | | 03 · 能力决策 · 评分中 | `56:7468` |
| 同上 | | 04 · 能力决策 · 结果（v12 来源标签已并入） | `56:7679` |
| 同上 | | 05 · Jev 模型 · 配置（含能力决策） | `56:7890` |
| Capability Panel · Skill 来源 v12（提案，已并入基线） | `88:8519` | 01 · 技能 · 全局（含内置/插件注入与只读详情） | `88:8523` |
| 同上 | | 02 · 首屏 · 本会话能力（来源标签） | `88:8797` |
| 同上 | | 03 · 能力决策 · 结果（来源标签） | `88:9011` |
| 同上 | | 04 · 会话 · 能力 Tab 整页网格（含来源） | `88:9375` |
| Capability Dock · 交互原型（历史 v1–v4） | `1:2` | 保留不动，仅作演进记录 | — |

## 2. 文件

```
docs/figma/
├── README.md                      ← 本文件
├── scenes/
│   ├── 01-hero.scene.json         ← v5：import_scene 契约：{ nodes: [FRAME...] }
│   ├── 02-capability-tab.scene.json
│   ├── v8-01-skills-project.scene.json  ← v8 四帧（面板终稿；01 = 264 节点，v12 计数已并入）
│   ├── v8-02-skills-global.scene.json   ← 278 节点（v12 注入分组/只读详情已并入）
│   ├── v8-03-mcp-project.scene.json
│   ├── v8-04-mcp-global.scene.json
│   ├── v11-01-entry.scene.json     ← v11 五帧（当前基线，可直接 import_scene）
│   ├── v11-02-pause.scene.json
│   ├── v11-03-loading.scene.json
│   ├── v11-04-results.scene.json   ← 170 节点（v12 来源标签已并入）
│   ├── v11-05-config.scene.json
│   ├── v13-01-hero-skills.scene.json … v13-08-decision-results.scene.json ← v13 八帧
│   ├── v14-01-hero-entry.scene.json       ← v14 四帧（97 节点；入口 icon 为 VECTOR，导入后会缺）
│   ├── v14-02-modal-skills.scene.json     ← 283 节点
│   ├── v14-03-modal-tools.scene.json      ← 205 节点
│   └── v14-04-hero-all-off.scene.json     ← 97 节点
│   # v9/v10：scene JSON 未导出（只有 preview + prototype 脚本，见 §3.1）
├── preview/
│   ├── 01-hero.png                ← v5 导出预览图（1440×900）
│   ├── 02-capability-tab.png
│   ├── v6-01-skill-overview.png   ← v6 四帧真实导出（1440×900）
│   ├── v6-02-skill-detail.png
│   ├── v6-03-mcp-overview.png
│   ├── v6-04-mcp-detail.png
│   ├── v7-01-skills-project.png   ← v7：工作区列表在左导航（技能）
│   ├── v7-02-mcp-project.png      ← v7：工作区列表在左导航（MCP）
│   ├── v8-01-skills-project.png   ← v8 四帧真实导出（2026-10-25 重导 152633 B）
│   ├── v8-02-skills-global.png    ← 2026-10-25 v12 注入分组/只读详情（165194 B）
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
│   ├── v11-03-loading.png         ← 2026-10-24 文案精简后重导（126025 B）
│   ├── v11-04-results.png         ← 2026-10-25 v12 来源标签后重导（159880 B）
│   ├── v11-05-config.png
│   ├── v12-01-skills-global.png   ← v12 提案图（保留作提案/对照）
│   ├── v12-02-session-hero.png
│   ├── v12-03-decision-results.png
│   └── v12-04-session-capability-tab.png
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
│   ├── v11/                       ← 「能力决策」当前基线（默认关闭 + 双阈值）
│   │   ├── 00-init.js
│   │   ├── 01-entry.js
│   │   ├── 02-pause.js
│   │   ├── 03-loading.js
│   │   ├── 04-results.js
│   │   ├── 05-config.js
│   │   └── spec-v11.md
│   └── v12/                       ← v12「Skill 来源」并入基线（补丁脚本，非新建页）
│       ├── 00-inspect.js          ← 只读结构勘察
│       ├── apply-baseline.js      ← 幂等补丁：v8 01/02 + v11 04
│       ├── dump-tree.js           ← 导出可见节点签名（与 export-scene.js 同规则）
│       ├── patch-scenes.mjs       ← scene JSON 层重放（Node，无依赖）
│       └── export-plan.md         ← 执行顺序 / 分片 / 回传清单
└── tools/
    └── export-scene.js            ← 从 Figma 重新导出 scene JSON 的 use_figma 脚本
```

## 3. 重新导入到 Figma（智能体步骤）

1. `figma_status` 确认 `dsh` 文档已连接；断连时 `figma_select_document <connectionId>` 重新绑定。
2. 读取 `docs/figma/scenes/*.scene.json`，取 `scene.nodes`。
   > 目前 `scenes/` 含 v5（`01-hero` / `02-capability-tab`）、v8（4 帧，v12 已并入 01/02）、
   > v11（5 帧，v12 已并入 04）、v13（8 帧）与 v14（4 帧）；**v9/v10 没有 scene JSON**，
   > 这两页改用 §3.1 的建稿脚本重建；v11/v13/v14 可直接 `import_scene`（v14 四帧
   > 97 / 283 / 205 / 97 节点，逐帧导入）。
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
   - **v8（面板终稿基线）逐帧导入**：四个 `scenes/v8-*.scene.json` 各含一个独立画框
     （01/02 在 y=150，03/04 在 y=1200，x=0/1520），单帧节点数 **264 / 278 / 233 / 259**
     （v12 并入后 01/02 增长），**合计 1034 > 500，不能一次全导**；
     逐帧 `import_scene({ nodes: v8_02.nodes, parentId: "42:3373" })` 即可，或导入到临时页面
     做对照（Lead 验收 v12 scene 时用的就是这一方式）。
   - **v11（当前基线）按帧导入**：五个 `scenes/v11-*.scene.json` 各含一个独立画框
     （01 在 `0,150`、02 在 `1520,150`、03 在 `0,1200`、04 在 `1520,1200`、05 在 `0,2250`），
     单帧节点数 **170 / 97 / 131 / 170 / 324**，**合计 892 > 500，不能一次全导**；推荐逐帧
     `import_scene({ nodes: v11_04.nodes, parentId: "56:7043" })`，或按 01+04（340 节点）、
     02+03（228 节点）、05（324 节点）分三次合并导入。导入后与 `preview/v11-*.png` 对照。
4. 若导入后想改设计：直接编辑 Figma 节点，然后**重新导出**（见下一节）并覆盖 scene JSON + 预览图。

### 3.1 重建 v9 / v10（v11 已有 scene JSON，也可用脚本重建）

v9/v10 的 scene JSON 未导出，这两页以 `prototype/v9/v10/` 建稿脚本为唯一事实源；
v11 推荐直接用 §3.1.2 的 scene JSON 导入，也可按脚本重建。在 Figma 内按脚本顺序执行即可
重建可编辑图层（脚本自包含、幂等，含 `v9/`/`v10/`/`v11/` 前缀清理，克隆底座 4:7 / 42:3376 保留）：

| 页面 | 执行顺序 |
|---|---|
| v9（历史） | `00-init` → `01-entry` → `02-results` → `03-loading` → `04-config` |
| v10（历史） | `00-init` → `01-entry` → `02-pause` → `03-loading` → `04-results` → `05-config` |
| v11（当前基线） | `00-init` → `01-entry` → `02-pause` → `03-loading` → `04-results` → `05-config` |

- 每段脚本整体贴进 `use_figma` 执行；`00-init` 会清空并重建对应页面，`01–05` 各自定位页面/帧名。
- 单独重跑 `01` 会把 capability-panel 复位到 920×320 并恢复底座子节点，之后需按顺序重跑后续帧脚本。
- 重建后用 `get_screenshot` / `download_assets` 与 `preview/v9-*…v11-*` 对照；
  v11 的 scene JSON 已导出（§3.1.2），若要补 v9/v10 的 scene，后续用 `tools/export-scene.js`
  按帧 id 导出（见 §4）。

### 3.1.1 2026-10-24 v11 03/04 文案精简后的重建 / 重导

- **已更新脚本**：`prototype/v11/03-loading.js`、`04-results.js`——删除 `v11/hdr/desc`；
  03 状态行上移（spinner 49 / 文案 y=40）、分隔线 74、骨架起点 80；04 阈值行上移（y=40 / 滑杆 52）、
  分隔线 74、结果行起点 80，行距按面板高度重算。
- **重跑顺序**：Figma 工具可用时只跑 `03-loading.js` → `04-results.js` 即可（幂等，先清 `v11/`
  前缀旧节点；无需重跑 00-init/01/02/05）。
- **重导预览**：重跑后用
  `download_assets({ nodeIds: ["56:7468","56:7679"], format: "PNG", scale: 1 })`
  重新截图，覆盖 `preview/v11-03-loading.png`、`preview/v11-04-results.png`。
- **当前状态（2026-10-24 02:27 已完成）**：03/04 已在画布用新脚本重跑，`preview/v11-03-loading.png`
  （126025 B）与 `preview/v11-04-results.png`（153292 B）已重新导出覆盖；画面核对 03 标题下无说明行、
  状态行紧贴标题，04 标题下无说明行、阈值行紧贴标题、列表与底栏正常。上面的重跑/重导命令保留，
  供后续再次修改 03/04 时复用。
- **scene JSON**：v11 五帧已导出（见 §3.1.2）；v9/v10 仍未导出。

### 3.1.2 2026-10-24 v11 scene JSON 重导入

- **文件与节点数**（均 `{ nodes: [FRAME] }` 契约，单文件一帧）：
  `scenes/v11-01-entry.scene.json`（170）、`v11-02-pause.scene.json`（97）、
  `v11-03-loading.scene.json`（131）、`v11-04-results.scene.json`（170，v12 并入后）、
  `v11-05-config.scene.json`（324）。
  > **2026-10-25 更新**：v12 来源标签并入后 `v11-04-results.scene.json` 为 **170** 节点
  > （原 158），其余四帧未变。
- **导入方式**：逐帧 `import_scene({ nodes: [ ...v11_04.nodes ], parentId: "56:7043" })`
  （`parentId` 可省略或换成目标页面）；也可按 **01+04（340 节点）、02+03（228 节点）、05（324 节点）**
  分三次导入。**合计 892 节点 > 500，不能一次全导**。
- 画框自带坐标（01 `0,150`、02 `1520,150`、03 `0,1200`、04 `1520,1200`、05 `0,2250`），
  导入页面后会与现有 5 帧重叠：先删除/移开原帧，或导入到临时页面做对照。
- 导入后用 `get_screenshot` / `download_assets` 与 `preview/v11-*.png` 对照；
  已知限制见 §5（无 VECTOR 图标、仅 SOLID/圆角/自动布局）。

### 3.1.3 2026-10-25 v12 并入基线与 scene 重导（JSON 层重放）

v12 是**提案页 + 补丁并入**，不新建基线页。执行链（脚本都在 `prototype/v12/`）：

1. **勘察**（只读）：`00-inspect.js` 导出 v8 01/02、v11 04 与 v12 参考帧的结构；
   `dump-tree.js` 导出三帧的「可导出节点签名」（与 `tools/export-scene.js` 同规则：
   跳过 hidden、只留 8 类节点、`type|name|x|y|w|h[|text]`）。
2. **补丁**：`apply-baseline.js`（幂等）在 v8 01/02 与 v11 04 上增改；新增节点统一 `v12/`
   前缀，基线节点**只隐藏不删除**（pluginData `v12-hidden`）。重跑先删 `v12/`、再恢复隐藏。
3. **校验**：`get_screenshot` 三帧 + 可见节点计数（画布真值 264 / 278 / 170）。
4. **预览**：`download_assets({ nodeIds:["42:3376","42:3433","56:7679"], format:"PNG", scale:1 })`。
5. **scene 重导**：打完补丁后单帧 278 节点、`export-scene.js` 的分片文本可达 100–200KB，
   逐片回传会撑爆工具输出 ⇒ 用 `patch-scenes.mjs` 在**基线 scene JSON 上重放同一套增删改规则**
   （脚本内注释逐条对应 apply-baseline.js），产出新 scene 并打印 `before/after` 节点数；
   再与 `dump-tree.js` 的可见计数对齐（264 / 278 / 170）。
   > 若将来画布又有改动，仍以 `tools/export-scene.js` 的真实导出为准；`patch-scenes.mjs`
   > 只是本次 v12 补丁的可复现记录，不是通用导出器。

## 4. 从 Figma 重新导出

1. 把 `docs/figma/tools/export-scene.js` 整段贴进 `use_figma` 执行。
2. 调整脚本顶部参数：
   - `TARGET_NODE_ID`：`4:7`（首屏）或 `4:223`（能力 Tab）；v12 基线帧为 `42:3376` /
     `42:3433` / `56:7679`；
   - `SERIALIZE_RANGE`：先 `[0, 24000]`，再 `[24000, null]`，分两次拿 `part` 字符串；
     单次输出过大时 DSH 会存到 spill 文件，可用 `grep` 找到完整 `part`。
     v8-02（278 节点）整段文本可能 >100KB，建议从 `[0, 40000]` 起按 40000 字符分片。
   > 2026-10-25 的 v12 基线重导**没有走分片回传**：补丁后单帧文本过大，改用
   > `prototype/v12/patch-scenes.mjs` 在 scene JSON 层重放同一套增删改规则（见 §3.1.3）；
   > 真实导出通道仍是本节这套 `export-scene.js`，画布再改时以它为准。
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
- `visible === false` 的节点**不导出**：v12 补丁隐藏的基线节点（磁盘第 3–5 行、详情写按钮、
  `meta/path`、旧资源树/阅读器子节点）不会出现在 scene JSON 里，scene 只含最终可见画面。
- 只保留 SOLID 填充/描边、圆角、像素行高与自动布局属性；渐变、阴影、模糊、混合模式、图片填充不导出。
- 文字字体为 `PingFang SC`（Regular/Medium/Semibold），导入前 Figma 需已加载该字体（本机 Figma 已安装）。
- `import_scene` 不是网页捕获：它只重建显式 layer，不还原交互/运行时逻辑。
- 已用 2 节点小场景实际调用 `import_scene` 验证 `x/y/width/height/TEXT` 契约可用；
  v12 三帧（264 / 278 / 170 节点）的 scene 重放结果**按帧** import_scene 到临时页面复核
  （可见节点计数 + 截图），验完删除临时页面——不要往基线页面直接导入，画框坐标会与原帧重叠。
- **v12 的 node 命名空间**：补丁新增节点统一 `v12/` 前缀（`v12/row/*`、`v12/group/*`、
  `v12/detail/*`、`v12/tree/*`、`v12/reader/*`、`v12/md/*`、`v12/src/*`、`v12/meta/*`）；
  重跑 `apply-baseline.js` 会先删除全部 `v12/` 节点再重建，基线节点靠 pluginData
  `v12-hidden` 恢复/再隐藏。

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
| v11（**当前基线**） | **能力决策** | 点按立即决策 + 停顿自动触发（默认关闭） | 默认关闭；三个数值字段：停顿阈值 1000ms、最少触发字数 10、最少修改间隔字符数 4；密钥 `~/.dsh/dsh-capability-settings/jev.json`（目录 700 / 文件 600） | 5 |

- 命名演进口径：v9「自动选择」→ v10「自主决策」→ v11「能力决策」（当前）；v9/v10 仅作历史对照。
- **v11 已导出 5 个可重导入 scene JSON**（`scenes/v11-*.scene.json`，见 §3.1.2）；v9/v10 仍只有
  preview + prototype 脚本、scene JSON 未导出；v11 的实现与验收以 `prototype/v11/spec-v11.md` 为准。
- 2026-10-24：v11 03/04 删除说明行——脚本已更新、画布已重跑、预览已重导（`v11-03-loading.png`
  126025 B / `v11-04-results.png` 153292 B），scene JSON 已同步导出。
- 2026-10-25：v11 04 并入 v12 来源标签（标签 `v12/src/0..5`、说明列右移、`已选 5 / 52`、底部说明
  增加「来源标签显示 …」）；`preview/v11-04-results.png` 重导为 **159880 B**，
  `scenes/v11-04-results.scene.json` 同步为 170 节点（见 §3.1.3）。

## 9. v12 注入技能来源（已并入基线）

- **设计口径**：技能列表「全局」scope 新增「注入技能」分组（组头计数 + 「内容只读 · 可启停」），
  注入行 = 来源类别标签（**内置** 琥珀 / **插件** 紫 / **预设** 灰）+ **渠道名**（等宽：`dsh-to-figma`、
  `dsh-remote`、`dsh-office`、`dsh-diff-approval`、preset id）+ 行尾本项目默认开关；
  详情为只读：来源/渠道/格式标签、只读原因条、「来源 / 注入方式 / 调用方式」meta、资源树 + 阅读器，
  无写操作按钮。能力决策结果行在名称后加来源标签（`全局` 绿 / `内置` 琥珀 / `dsh-*` 紫 / `预设 <id>` 灰）。
- **对应实现**：`src/skills/registry.ts`（来源分类单一事实源）、`src/client/panel.tsx`
  （分组/标签/只读详情）、`src/client/composer-capability.tsx`（会话行 + 决策行标签）、
  `src/overrides/*`（`skills` 域本项目默认）；行为说明见根 `README.md`「注入技能」一节、
  契约见 [`../architecture/skill-sources.md`](../architecture/skill-sources.md)。
- **基线节点**：v8 02 `42:3433`（注入分组/5 行/只读详情）、v8 01 `42:3376`（仅计数）、
  v11 04 `56:7679`（来源标签）；v12 提案页 `88:8519` 保留不动。
- **可重导入产物**：`scenes/v8-01-skills-project.scene.json`（264 节点）、
  `scenes/v8-02-skills-global.scene.json`（278）、`scenes/v11-04-results.scene.json`（170）；
  预览 `preview/v8-01-skills-project.png`（152633 B）、`v8-02-skills-global.png`（165194 B）、
  `v11-04-results.png`（159880 B）。

## 10. v13 三域 Skills / MCP / Tools · 全局开关 · 派生继承 · MCP 来源 · Jev 文案

**页面**：`Capability Panel · 全局开关与派生 v13`（page id `106:2`，新建页，不改 v8/v11/v12 既有页面）。

> **Tools 两层语义（v1.11）**：能力面板 Tools = **全局默认**（开关旁 `默认`，tooltip 说明「关闭后所有会话默认不可用；单会话仍可在对话首屏单独开启」，**无「本会话」字样**）；
> 会话首屏 / 会话「能力」Tab Tools = **本会话覆盖**（全局关时该会话仍可单独开启；rail 批量只写本会话；「恢复默认」清除会话覆盖回全局默认）。无 workspace / 项目维度。

> ⚠️ **R2 派生继承为设计提案、本版零渲染**：帧 01–05 的「派生 agent 整体继承三域 / 继承|不继承」只作后续设计参照；
> 实现 UI 不出现该控件，验收按「R2 零渲染」执行，不按帧反推为缺陷。

| 帧 | frame id | 预览 | 内容 |
|---|---|---|---|
| 01 · 首屏 hero · 本会话能力（Skills） | `106:5` | `preview/v13-01-hero-skills.png` | 三域 Tab（`Skills 8/15` / `MCP 5/9` / `Tools 3/6`）+ 行 3 控制条（全部开启/全部关闭、「已启用 16/30」、`派生 agent 整体继承三域` + 派生继承 继承/不继承，**无分型策略**；派生控件 ⚠️R2 提案未实现）+ Skills 卡片；帧注含「会话覆盖 / rail 只改本会话 / 恢复默认回全局」 |
| 02 · 首屏 hero · MCP（插件来源） | `106:229` | `preview/v13-02-hero-mcp.png` | `figma`（`插件`+`dsh-to-figma` 两枚标签，17 工具，命名空间合成行）/ `AnySearch` / `context7` / `tavily`（`全局`，tavily 关闭）；派生控件 ⚠️R2 提案未实现 |
| 03 · 首屏 hero · Tools（插件级） | `106:453` | `preview/v13-03-hero-tools.png` | **6 张已知插件卡片（4 + 2 两行，仅非 MCP 插件工具）**：`dsh-univer-office 13` / `dsh-remote 19` / `dsh-im 8`（开）、`dsh-better-sidebar 1` / `dsh-popout-window 1` / `dsh-diff-approval 1`（关）；卡片 = 插件名 + `13 个工具 · 插件注入` + `插件` 标签 + 整插件开关；**会话覆盖语义**（帧注：全局关时本会话可单开 / rail 只改本会话 / 恢复默认回全局）；派生控件 ⚠️R2 提案未实现 |
| 04 · 首屏 hero · 全部关闭后状态 | `106:677` | `preview/v13-04-hero-closed.png` | `0/15` `0/9` `0/6`、控制条 `已启用 0/30`（全部关闭禁用 / 全部开启可用）、三域卡片全关、底栏 `0 / 30`；**无二次确认、无提醒条 / 快捷按钮**；派生控件 ⚠️R2 提案未实现 |
| 05 · 会话「能力」Tab 整页（宽屏） | `106:901` | `preview/v13-05-session-tab.png` | 1080 宽：三域 Tab + 同一控制条（16/30）+ **固定 4 列**卡片（250 宽 × 两行）；帧注含「1080 固定 4 列 + R2 零渲染」约束 |
| 06 · 能力面板 · Tools（全局） | `106:1085` | `preview/v13-06-panel-tools.png` | 四 Tab（`Skills` / `MCP` / `Tools` / `Jev 模型`，Tools 激活）+ **两栏**：6 个已知插件行（插件名 / `插件` 标签 / 工具数 / `默认` + 开关）+ 右侧详情（`dsh-univer-office`，`univer_` 前缀；**整块详情可滚动**；工具清单 = **手风琴**：名称 + N 参数 → 说明 + 参数表 + 可折叠原始 JSON，schema 懒加载）；**无左导航、无「本会话」、无琥珀关闭影响条、无「无参数表」** |
| 07 · 能力面板 · Jev 配置 | `106:1485` | `preview/v13-07-jev-config.png` | 删 callout、副标题两行按**实现口径**（发送输入框草稿 + 能力名称/描述；草稿仅用于评分、不落盘）、Base URL 起上移；保留删密钥路径行 + API Key ⓘ；四 Tab（Jev 高亮）；卡片 672 为 740 宽示意值（1184 宽实测 1077，不校验固定高度） |
| 08 · 能力决策 · 结果（含 Tools） | `113:7053` | `preview/v13-08-decision-results.png` | 阈值 0.50 + **4 行完整 + 第 5 行底部渐隐 + 滚动提示**（6 行仅展开示意；真实 900px 窗口约 3 行可见）+ `已选 4 / 30` + Tools 插件行（`dsh-univer-office` 13 工具选中 / `dsh-remote` 19 工具未选中）+ 底部 Tools 说明 |

**建稿脚本**（`prototype/v13/`，均幂等：先删 `base-*` / `v13/` 再从基线帧克隆后重绘，不修改基线页节点）：

```
00-init.js         建页 + 8 帧 1440×900 + 克隆底座（88:8797 / 88:9375 / 42:3433 / 56:7890 / 56:7679）
01-hero-skills.js  02-hero-mcp.js  03-hero-tools.js  04-hero-closed.js
05-session-tab.js  06-panel-tools.js  07-jev-config.js  08-decision-results.js
```

**口径要点**（详见 [`../ux/capability-v13.md`](../ux/capability-v13.md) v1.9）：

- **命名统一**：`Skills` / `MCP` / `Tools`（旧 `MCP 服务器` / `插件工具` / `技能` 不再出现）；主面板四 Tab 含 `Jev 模型`，会话面板三 Tab。
- **计数 = 可开关单元**：Skills 8/15 + MCP 5/9 + Tools 3/6 ⇒ `已启用 16 / 30`；帧 04 全关 `0 / 30`。
  Tools Tab 分母是**插件数**（6），卡片描述显示插件内工具数；计数为示例口径，以运行时枚举为准。
- **Tools 两层语义**：能力面板 = **全局默认**（`默认` 开关；`tools-global.json`；`tools.list` 轻量字段——插件名/来源/工具数/globalDefault/sessionOverride/effective/restrictable，不返回 schema；`tools.setGlobalEnabled` 写全局；详情 schema 由 `tools.inspect` 懒加载）；会话首屏 / 能力 Tab = **本会话覆盖**（全局关可单开；rail 只写会话；恢复默认回全局）。空态文案 `尚未发现 Tools` / `无法列出 Tools`。
- **5 项 UI 修复（v1.11）**：① Tools 详情整块一根滚动条；② 删除「关闭该插件后…」琥珀条与「无参数表」文案；③ 工具清单手风琴（说明 + 参数表 + 可折叠原始 JSON）；④ MCP 外部注入行名称第一行、两枚标签在 meta 行；⑤ 全局 Skills 跟随会话时允许会话级开关。
- **Tools 插件级开关**：hero 6 张已知插件卡片（4 + 2 两行；标题 / 工具数描述 / `插件` 标签 / 整插件开关），关闭插件 = 该插件全部工具在**本会话**不可见；
  面板两栏插件列表 + 插件详情（只读工具清单），**不提供单工具开关、不做参数表**。
- **无二次确认、无提醒条**：全部关闭 / 全部开启一步生效；全关态只体现控件与卡片状态，恢复入口是控制条「全部开启」。
- **派生继承为布尔开关（⚠️设计提案，本版零渲染）**：只有一个 `继承 | 不继承` 分段（无分型链接 / 弹层 / 第三态），subagent 与 teammate 共用，整体作用于 Skills · MCP · Tools；首屏弱提示 `派生 agent 整体继承三域`，只影响之后派生。实现验收不要求该控件。
- **MCP 来源（R4 不变）**：两枚标签（`插件` + 插件名，第二枚 96px 省略）；配置来源保留 `全局` / `项目`；
  插件自注册 `mcp__*` 无 mcp-client 实例，需「工具命名空间合成来源行」才能显示。
- **域边界（MCP vs Tools）**：MCP 收 mcp-client 实例 + 插件自注册 `mcp__<server>__*` 命名空间（figma 合成行只在 02）；Tools 只收插件直接注册的非 `mcp__` 工具（`univer_*` / `rw_*` / `dsh_im_*` / `sidebar_open` / `open_in_popout` / `dsh-diff-approval-annotate`），两域互斥不重复收录。
- **插件归属启发式**：宿主 `tools.schemas()` 无来源字段，按前缀 + 插件清单映射；识别不到显示「来源未识别」（当前 6 张卡均为已知插件，无未识别卡）。
- **能力决策含 Tools（插件级）**：候选单元 = Skills 15 + MCP 9 + Tools 6（插件）= 30；Tools 以**插件**为评分/应用单元，选中即启用该插件全部工具、未选中即整插件关闭；Jev **只收窄不扩权**；结果行 `已选 x / 30` 与选中数一致。
- **实现约束（验收口径）**：① 会话「能力」Tab 1080 容器**固定 4 列**（5 列仅容器 >1180 时可选）；② 能力决策结果面板 **约 3 行可见 + 可滚动 + 底部 20px 渐隐 + 末行可达**（**不要求 6 行全显**，6 行仅展开示意）；③ Jev 卡片高度不做固定断言（设计 672 是 740 宽示意，实现 1184 宽实测 1077，验收以「无 callout + Base URL 上移」为准）；④ **R2 零渲染**。
- **真实外壳 / 数据备注**：帧 01/03/04/05 的 920 宽是**桌面 1440 外壳示意值**；真实 web 测试外壳 hero 面板宽 ≈774，卡片为 **3 列**（验收以真实外壳 3 列为准，不回改帧）。web 测试 profile 实际 Tools 仅 **2 个单元**（`dsh-im` 1 + `__unattributed__` 40），univer/popout/diff 未安装、dsh-remote 版本不兼容被跳过、figma 未安装（R4 合成行由单测 8/8 + entry/fiber 两枚标签验证）；帧 03/06 的 **6 插件为示例**。
- Jev 页副标题两行（实现口径）：「用 Jev 模型给 Skills、MCP 与 Tools 打分，自动选出与本轮草稿最相关的能力。」+「一次请求完成；发送输入框草稿与能力名称、描述（Tools 为插件名与工具说明摘要）；草稿仅用于本次评分、不落盘，结果只写当前会话。」；页面正文无目录路径 / 700 / 600。

**可重导入 scene JSON（已导出，8/8）**：

| 文件 | nodes | bytes |
|---|---|---|
| `scenes/v13-01-hero-skills.scene.json` | 195 | 58485 |
| `scenes/v13-02-hero-mcp.scene.json` | 157 | 46390 |
| `scenes/v13-03-hero-tools.scene.json` | 172 | 51049 |
| `scenes/v13-04-hero-closed.scene.json` | 194 | 56566 |
| `scenes/v13-05-session-tab.scene.json` | 170 | 53154 |
| `scenes/v13-06-panel-tools.scene.json` | 181 | 60508 |
| `scenes/v13-07-jev-config.scene.json` | 333 | 102815 |
| `scenes/v13-08-decision-results.scene.json` | 166 | 48955 |

- 契约 `{ nodes: [FRAME] }`，单帧均 < 500 节点；已校验 `JSON.parse` 通过、`nodes.length === 1`、根节点 FRAME、节点数与画布可见节点一致。
- 导出链：`prototype/v13/export-scene.js`（紧凑序列化，短键 + 十六进制色值，规避单次工具输出上限）→
  `prototype/v13/decode-scene.py`（本地还原为 scene 契约）。**scripts 仍是建稿唯一事实源**，scene 为快照。

**v14 首屏入口 scene JSON（已导出，4/4）**：

| 文件 | nodes | bytes |
|---|---|---|
| `scenes/v14-01-hero-entry.scene.json` | 97 | 110041 |
| `scenes/v14-02-modal-skills.scene.json` | 283 | 342872 |
| `scenes/v14-03-modal-tools.scene.json` | 205 | 241589 |
| `scenes/v14-04-hero-all-off.scene.json` | 97 | 110035 |

- 导入：逐帧 `import_scene({ nodes: v14_01.nodes, parentId: "134:8699" })`，四帧均 < 500 节点；
  x/y 已保留（01/02 在 y=150，03/04 在 y=1200，x=0/1520）。
- **已知缺失**：VECTOR 图标（入口书/插头/工具箱、✦、滑杆、卡片图标）不会随 scene 导入，
  恢复后需用 `use_figma` 的 `createVector`/`vectorPaths` 重画，或从 `preview/v14-entry-icons.png`
  对照补 `upload_assets`；除此之外的图层可完整重建。
- 导出脚本：`use_figma` 内复用 `docs/figma/tools/export-scene.js` 的序列化函数，一次导出
  四帧 JSON（结果超限落 spill 文件，本地解析后逐帧写入）。
