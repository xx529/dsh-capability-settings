# v12 并入基线的执行计划（Lead 机械执行，pm 验收）

> 目的：把已确认的 v12 设计 **补丁式** 落到 Figma 基线，并重导 preview / scene JSON。
> 只动 3 个基线帧；历史页面（v5/v6/v7/v9/v10）与 v12 提案页 `88:8519` **完全不动**。
> 所有画布脚本在 `docs/figma/prototype/v12/`。执行顺序：**勘察 → 补丁 → 截图校验 → 导预览 → 导 scene**。

## 0. 前置

1. `figma_status` 确认 `dsh` 已连接（backend local）。
2. 若上一个写操作结果不明（报 uncertain），先 `get_metadata({nodeId:"42:3433"})` 消障。

## 1. 只读勘察（先跑，不改画布）

把 `docs/figma/prototype/v12/00-inspect.js` 整段贴进 `use_figma` 执行，返回 5 帧结构 JSON。

**自检要点**（与建稿脚本一致即可继续）：

| 帧 | 期望存在的关键节点名 |
|---|---|
| `42:3376`（v8 01 技能·项目） | `header/tab-skills-t`、`scope/global`（含 `count` 子文本）、`row/agent-orchestration-advisor` |
| `42:3433`（v8 02 技能·全局） | `row/agent-orchestration-advisor`、`row/acquisition-channel-advisor`、`row/altitude-horizon-framework`、`row/ai-shaped-readiness-advisor`、`detail/name/t`、`detail/tag-global`、`detail/tree`、`detail/reader`、`act/import`、`act/export`、`act/export-path`、`act/delete`、`meta/source/t`、`meta/path`、`meta/caps` |
| `56:7679`（v11 04 结果） | `capability-panel`，其下 `v11/row/0..5/{name,desc,type,type-t,score,bar-fill}`、`v11/note` |
| `88:8523` / `88:9011` | v12 参考帧，只读不动 |

若与上表不符：**停止**，把 00-inspect 的 JSON 回传 pm（不要盲改）。

## 2. 应用补丁（幂等，可重跑）

把 `docs/figma/prototype/v12/apply-baseline.js` 整段贴进 `use_figma` 执行。

写的内容：

- **v8 02（+ 01 的侧栏计数）**：注入技能分组（`v12/group/*`）+ 5 个注入行
  （figma-workbench / dsh-remote-deploy / dsh-diff-approval-answer / office / office-docx，
  行名 `v12/row/<name>`），详情切到 figma-workbench（只读原因条 `v12/detail/readonly`、
  `v12/meta/mode`、`v12/tree/*`、`v12/reader/*`）；磁盘第 3–5 行与详情写按钮
  **隐藏不删除**（pluginData `v12-hidden`）；全局计数 157 / 列表 14。
- **v11 04**：6 行结果加来源标签（`v12/src/<i>`）并把说明列右移；行内容/分数对齐
  v12-03；`已选 5 / 52`；底部说明改为含「来源标签显示 …」的版本。

返回 `{ v8Global:{frame,nodes,ids}, v8Project:{frame,scopeCount}, v11Results:{frame,panel,rows,tags} }`。
**把完整返回值回传 pm**（含 id 列表，用于 scene 节点数核对）。

重跑安全：新节点统一 `v12/` 前缀，脚本先删再建；基线节点只隐藏不删除。

## 3. 截图校验（必须做，不许用旧图）

```
get_screenshot({ nodeId: "42:3376", scale: 1 })   // v8 01
get_screenshot({ nodeId: "42:3433", scale: 1 })   // v8 02（注入分组 + 只读详情）
get_screenshot({ nodeId: "56:7679", scale: 1 })   // v11 04（来源标签）
```

核对：注入分组标题/计数、来源标签（内置琥珀 / 插件紫 / 预设灰）、渠道名等宽字、
开关态（office 为关）、只读原因条、meta 三栏、资源树与阅读器无越界/遮挡；
v11 每行 `[类型][名称][来源标签][说明]` 不重叠、分数/进度条未被破坏。
如画面有缺陷：**先定位再改脚本**（把缺陷点回传 pm），不要重复执行同一补丁。

## 4. 导预览（覆盖仓库 preview）

```
download_assets({ nodeIds: ["42:3376","42:3433","56:7679"], format: "PNG", scale: 1 })
```

文件落在工作区 `.figma/assets/<uuid>/` 下。把每个文件的**绝对路径 + 字节数**回传 pm，
pm 负责复制为：

- `docs/figma/preview/v8-01-skills-project.png`
- `docs/figma/preview/v8-02-skills-global.png`
- `docs/figma/preview/v11-04-results.png`

（v8-03/04 未改，不重导。v12 提案图保留。）

## 5. 重导 scene JSON（按 README §4 分片）

对 3 个帧各跑一次 `docs/figma/tools/export-scene.js`，只改两行参数：

| 目标 | TARGET_NODE_ID | 落盘文件 |
|---|---|---|
| v8 01 技能·项目 | `42:3376` | `docs/figma/scenes/v8-01-skills-project.scene.json` |
| v8 02 技能·全局 | `42:3433` | `docs/figma/scenes/v8-02-skills-global.scene.json` |
| v11 04 结果 | `56:7679` | `docs/figma/scenes/v11-04-results.scene.json` |

**分片方案**（`SERIALIZE_RANGE`，每段 40 000 字符，`end=null` 表示到结尾）：

```
[0,40000] → [40000,80000] → [80000,120000] → [120000,160000] → [160000,null]
```

- 先看第一次返回的 `total`：`total ≤ 40000` 时一次即可；否则按上表续片。
- **省事通道**：直接 `SERIALIZE_RANGE=[0, null]` 整段跑一次；输出过大时 DSH 会把完整
  结果存到 spill 文件，工具结果里带路径 —— 把 **spill 绝对路径**回传 pm 即可，pm 从
  spill 里提取 `part` 并拼接。两种方式任选，优先整段 + spill。
- 若分片：把每片 `part` 原文写入 `notes/figma-export/<scene-name>.partNN.txt`
  （`notes/` 已 gitignore；pm 之后拼接校验），或直接把 part 贴回。

pm 侧校验与落盘：`JSON.parse` 成功、`nodes` 长度为 1、节点数与 apply 返回值/旧 scene 对比、
写入 `{ nodes: [...] }`。

## 6. 回传清单（一条消息给 pm）

```
inspect: 与期望一致 / 差异行
apply: <完整返回值 JSON>
screenshots: 三帧目视结论（或缺陷点）
previews: 3 个绝对路径 + 字节数
scenes: 3 个（spill 路径 或 part 文本/文件）；每帧 total 字符数
```

pm 随后：复制预览、写 scene JSON、更新 `docs/figma/README.md`（v12 并入基线的节点 id /
预览字节数 / scene 节点数）、README 截图引用核对，并完成 task-5 回执。
