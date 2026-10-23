# Figma 原型（Capability Dock v5 + 能力面板升级 v6）

本目录是能力面板相关 UI 的 Figma 设计源，供人工查看 / 未来智能体继续改原型：

- **Capability Dock · 终稿 v5**（`4:2`）：「输入框下方会话能力配置区」的终稿（历史，保留）；
- **Capability Panel · 升级原型 v6**（`10:2`）：「能力面板」v2 升级原型（当前设计基线；
  可编辑图层由 `prototype/` 下的 `use_figma` 脚本生成，可随时重跑复现）。

设计文档说明见 [`../../notes/design/capability-dock.md`](../../notes/design/capability-dock.md)
（v5）与 [`../ux/panel-upgrade.md`](../ux/panel-upgrade.md)（v6 交互规格，入库）。

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
| Capability Dock · 交互原型（历史 v1–v4） | `1:2` | 保留不动，仅作演进记录 | — |

## 2. 文件

```
docs/figma/
├── README.md                      ← 本文件
├── scenes/
│   ├── 01-hero.scene.json         ← v5：import_scene 契约：{ nodes: [FRAME...] }
│   └── 02-capability-tab.scene.json
├── preview/
│   ├── 01-hero.png                ← v5 导出预览图（1440×900）
│   ├── 02-capability-tab.png
│   ├── v6-01-skill-overview.png   ← v6 四帧真实导出（1440×900）
│   ├── v6-02-skill-detail.png
│   ├── v6-03-mcp-overview.png
│   └── v6-04-mcp-detail.png
├── prototype/                     ← v6 建稿脚本（按帧拆分，use_figma 可直接执行）
│   ├── 00-init.js                 ← 建页 + 4 画框 + 克隆 v5 sidebar
│   ├── 01-skill-overview.js
│   ├── 02-skill-detail.js
│   ├── 03-mcp-overview.js
│   ├── 04-mcp-detail.js
│   ├── 05-sidebar-fix.js          ← 侧栏高亮「能力面板」（幂等，最后跑）
│   └── spec-v6.md                 ← 节点树 / 坐标 / 验收点
└── tools/
    └── export-scene.js            ← 从 Figma 重新导出 scene JSON 的 use_figma 脚本
```

## 3. 重新导入到 Figma（智能体步骤）

1. `figma_status` 确认 `dsh` 文档已连接；断连时 `figma_select_document <connectionId>` 重新绑定。
2. 读取 `docs/figma/scenes/*.scene.json`，取 `scene.nodes`。
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
4. 若导入后想改设计：直接编辑 Figma 节点，然后**重新导出**（见下一节）并覆盖 scene JSON + 预览图。

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
