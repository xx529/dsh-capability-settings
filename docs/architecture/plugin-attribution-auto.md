# 插件工具归属自动发现 · 实现设计（T0 栈捕获 / T1 包扫描 / T2 namespace / T3 相似度 / 缓存 / unit id 迁移）

| 项 | 值 |
|---|---|
| 文档 | `docs/architecture/plugin-attribution-auto.md`（新建，本任务唯一落盘产物） |
| 角色 | architect（只写架构文档）· **task-31** |
| 日期 | 2026-10-30 |
| 输入证据 | `docs/research/plugin-attribution-heuristics.md`（415 行，scout / task-30；下称 **证据**） |
| 现状基线 | `bd6a2d3`（`src/shared/plugin-attribution.ts` 硬编码 `TOOL_RULES` + `MCP_NAMESPACE_RULES`；Tools 两层语义已落地） |
| 关联方案 | `docs/architecture/v13-implementation.md`（Tools 域/两层语义/`tools.list`·`inspect` 契约） |
| 目标 | 把硬编码表从「唯一来源」降为「人工兜底与稳定 id 锚」，新增插件**零改表**即被归属；最差等价于今天（表 + 来源未识别） |
| 写作用域 | 仅本文；不改 `src/**`、不改设计稿、不动 `~/.dsh`、不安装、不推送 |

**阅读约定**：`文件:行号` = 当前工作树；`证据 §x` = 上述取证文档章节；`[待验证]` = 需真机/单测确认，同段给验证方式；`[需拍板]` = 本文给推荐值但需 Lead/用户确认后才能进入验收。

**本文不含实现代码**。伪代码/类型/JSON 片段是**契约与算法说明**，实现方按此落地，不得自行改字段名。

---

## 0. 结论摘要与决定表

### 0.1 一段话结论

保留现有「MCP 域 / 宿主内建」恒等判定不变；把「非 mcp 插件工具 → 插件」的归属做成一个 **resolver**，按 **T0 运行时栈（主）→ T1 静态字面量唯一命中（冷启动回填）→ T4 人工表（人工覆盖/降级锚）→ T3 名字相似度（仅兜底，标"推测"）→ 未识别** 依次短路；MCP 命名空间走 **T0'（该命名空间工具的注册栈）→ T2（包内唯一命名空间字面量）→ T4**。所有归属结果带 `matchedBy` + `confidence` additive 字段；扫描结果缓存到 `tool-attribution.json`（原子写 + 锁，损坏降级空缓存）。**unit id 从「规则 display」迁移到「归一化包名」**，旧持久化键通过「读时别名映射 + 一次性锁内写回 + 旧键镜像双写」无损迁移，UI 展示名与 id 分离（7 个已知插件的展示名保持不变）。

### 0.2 架构决定（可被实现/评审引用）

| id | 决定 | 位置 | 状态 |
|---|---|---|---|
| **D1** | **unit id = 归一化 npm 包名（完整名，含 scope）**；展示名 = 包名去 scope；持久化键仍为 `plugin:<unit>`；7 个已知插件展示名**不变**，仅 `dsh-im→@xmanrui/dsh-im`、`dsh-popout-window→@local/dsh-popout-window` 两个 id 变化 | §2 | 推荐（[需拍板] 备选 slug 化） |
| **D2** | 迁移 = **读时别名映射（canonicalize）+ 一次性锁内写回 + 旧键镜像双写（可回滚）+ 未知键原样保留**；幂等、崩溃可续；不删任何无法识别的键 | §3 | 推荐 |
| **D3** | 优先级：**域恒等 → T0 → T1 → T4 → T3 → 未识别**；T1 与 T4 冲突时 **T1 优先 + warn + 标 `conflictsWithTable`**（T0 有值时 T0 静默覆盖）；T3 必须「唯一最佳 + margin ≥0.3」 | §4 | 推荐（[需拍板] 冲突优先级） |
| **D4** | `matchedBy: "runtime" \| "literal" \| "namespace" \| "table" \| "similarity" \| "unknown"`（**additive**；旧值 `prefix/exact/source` 继续被识别）+ `confidence: "high"\|"medium"\|"low"`；`evidence?` 仅诊断，不作为唯一展示来源 | §4/§9 | 推荐 |
| **D5** | T0 落点为 resolver 自建的**独立** `ctx.on("tools/change")` 监听（与 `src/mcp/loader.ts:765`、`src/tools/manager.ts` 的现有监听并列，不改它们）；监听器内 `stackTraceLimit=48` + `finally` 恢复；同步 `schemas()` 差集得到新增工具名；异常全吞；连续失败 3 次自动禁用 T0（本进程） | §5 | 推荐 |
| **D6** | T1 包根 = `ctx.get("pluginPackages")?.packageOf(name, baseUrl)?.dir`（loader entries 提供 name/baseUrl），兜底 `createRequire(baseUrl).resolve.paths + package.json` 探测；拿不到包根 → 该包跳过静态层（仅 T0/T3 覆盖） | §6 | 推荐（`pluginPackages` 可见性 [待验证 V3]） |
| **D7** | 缓存 `tool-attribution.json` v1：`{version, generatedAt, hostVersion, packages{version,mtimeMs,literals,namespaceHints}, runtime{tool→pkg,at}, failures}`；失效键 = 包名+version+mtimeMs+host 版本；原子写 + 锁 + 进程内串行；损坏 → 空缓存 + warn | §8 | 推荐 |
| **D8** | 性能预算：T0 捕获 ≤10µs/次（证据 §4.2 实测 8.18µs）；首次扫描总预算 ≤500ms（本机 0.46s / 26 包，证据 §3.2）；`tools.list` **不 await 扫描**，新增 additive `attributionSettling`；缓存命中 <5ms 且零扫描 | §11 | 推荐 |
| **D9** | UI「来源判定」按 `matchedBy` 映射文案；`similarity` 标「推测」（琥珀）；不需要新增 RPC，只加 additive 字段（`tools.list.units[].attribution`、`mcp.runtime.servers[].attribution`） | §10 | 推荐（[需拍板] 推测单元能否开关） |
| **D10** | Jev：Tools 候选 id 为 `capabilityId("tool:plugin:<unit>")`，**unit 变了 id 就变**——该 id 只在单次 rank→apply 与冷会话队列里，**不持久化**；冷会话队列是**进程内存**（`src/jev/apply.ts` 的 `pendingPlans`），重启/升级即清，因此**跨版本无残留影响**；仅同进程内插件热更新（unit 变化）可能让队列里的旧 id 落到 `unknown-id` skipped（不误写） | §12 | 采纳 |
| **D11** | 降级原则：任一层失败都落到下一层，最差 = 今天的「T4 + 来源未识别」；旧客户端按旧 `matchedBy` 值渲染；旧版插件读新键失败时靠镜像键回滚 | §13 | 采纳 |
| **D12** | 自排除常量 `SELF_PACKAGE = "dsh-capability-settings"` 必须与 `package.json.name` 一致（仓库既有包名/id 纪律），单测断言；扫描/栈解析均先排除自身包 | §5/§6 | 采纳 |

### 0.3 需要 Lead/用户拍板的点（推荐值见 §0.2；实现细节见各节）

1. **D1 unit id 形态**：推荐「完整包名（含 scope）」；备选「slug 化（`xmanrui-dsh-im`）」。影响持久化键可读性与一次迁移成本；用户可见的展示名都不变。
2. **D2 旧键镜像保留策略**：推荐双写镜像保留到下一个 minor / `session-state` version 2 再清理（保证旧版可回滚）。文件里短期会同时出现 `plugin:@xmanrui/dsh-im` 与 `plugin:dsh-im`。
3. **D3 T1 vs T4 冲突优先级**：推荐 T1 优先 + warn（scout 方案），但存在「人工表被静态误报覆盖」的极小概率；备选 T4 优先。
4. **D9 推测单元的开关权限**：T3（and T1）误归属会导致「关错插件 = 关掉别的插件的工具」。推荐：**仍可开关**，但 `similarity`/`literal` 单一来源的单元在详情顶部标「来源推测，请核对工具清单」；若产品要保守，可把 **仅由 similarity 归属** 的单元设为只读（不参与批量、不计可开关分母）。


### 0.4 十个必答问题的落点（便于 Lead 验收）

| 问题 | 回答位置 |
|---|---|
| 1) unit id 迁移（读映射+一次写回+保留未知键+回滚兼容、展示名/id 分离） | §2（id 规则/别名表）、§3（迁移算法/镜像/回滚/未知键） |
| 2) T0 落点 / 栈解析（pnpm/.pnpm/scope）/ 误归属防护 / stackTraceLimit 抬升恢复 | §5（§5.1 落点、§5.2 监听器、§5.3 解析与防护、§5.4 覆盖窗口） |
| 3) T1 包根获取 / 扫描安全边界与上限 | §6（§6.1 包根、§6.2 限额、§6.3 索引、§6.4 歧义） |
| 4) 优先级（T0>T1>T2>T4）与 matchedBy/置信度 | §4.2 优先级、§4.3 接口、§9 字段、§15.1 矩阵 |
| 5) 性能预算（首次扫描/缓存/增量，不阻塞 RPC） | §11（预算表 + 不 await 原则 + `attributionSettling`） |
| 6) 缓存格式/失效/并发（atomic write+lock） | §8（形状/失效表/并发合并/清理） |
| 7) UI「来源判定」依据（运行时/包扫描/名字推测/人工/未识别） | §10（文案映射表 + 推测标识 + settling） |
| 8) 测试设计（迁移无损/歧义/缓存损坏/性能/回归） | §12（AT0–AT5 + 回归 + 真机待验证） |
| 9) 风险与降级 | §13（R1–R18） |
| 10) 分阶段交付 | §14（P1–P6 + 回滚开关 + 文档同步） |

---

## 1. 现状与目标

### 1.1 现状（行号以 `bd6a2d3` 工作树为准）

| # | 位置 | 现状 | 目标 |
|---|---|---|---|
| G1 | `src/shared/plugin-attribution.ts:44-66` | `TOOL_RULES` 硬编码 prefix/exact → display；**唯一归属来源** | 降为 **T4 人工兜底**；新增插件自动发现 |
| G2 | `src/shared/plugin-attribution.ts:84-87` | `MCP_NAMESPACE_RULES` 只有 `figma → dsh-to-figma` | 由 T0'/T2 动态映射；表保留为兜底 |
| G3 | `src/tools/manager.ts:179-268` | `enumerateGlobalTools()` 内直接 `attributeTool(name)`（`:222`），unit = `rule.display`（`:223`），attribution 取规则（`:225-232`）；未命中 → `__unattributed__` | 改为 `resolver.resolveTool(name)`；unit = 包 id，display 另算 |
| G4 | `src/tools/types.ts:16-39` | `unitKeyOf/unitOfKey` 只做 `plugin:` 前缀拼接；unit 即 display（含 `dsh-im` 等旧名） | unit = 包名 id；新增别名归一化（迁移层） |
| G5 | `src/tools/global-state.ts:97-129,169-174` | `tools-global.json` 的 `disabled[]` 存 unit（旧 display） | 迁移为包 id；读时别名归一并双写镜像（§3） |
| G6 | `src/session-state.ts:115,179-204,408-455` | `session-capabilities.json` 的 `sessions.<id>.tools{"plugin:<unit>":bool}` | 同上迁移 |
| G7 | `src/mcp/runtime.ts:156-193` | `scanInjectedMcpNamespaces` 用静态 `attributeMcpNamespace`（`:175`） | 先查 resolver 动态映射，再查表 |
| G8 | `src/client/tools-panel.tsx:61-66`、`src/client/api.ts:502-508` | 「来源判定」只认 `prefix/exact/unknown` | 扩展 matchedBy 文案 + 推测标识（§10） |
| G9 | 无 | 无缓存、无 runtime 索引、无包扫描 | 新增 resolver + 缓存（§4–§8） |
| G10 | `src/index.ts:127-144,310-311` | 组合根创建 stores/manager，暴露 `capabilityPanel` | 装配 resolver（尽早挂 T0 监听）、注入 manager/mcp runtime |

### 1.2 覆盖率目标（证据 §0）

| 口径 | 今天（T4） | 加 T1/T2/T3（无 T0） | 加 T0 |
|---|---|---|---|
| 7 插件 ground truth 65 工具 | 7 类前缀/精确覆盖（新增工具需加表） | 65/65，0 错配（证据 §3.3） | 65/65 |
| 真实 48 个插件域工具 | 已识别 7 插件名下的工具 | 字面量 30 + 相似度 16 = 46（95.8%） | **预计 48/48**（证据 §0、§4.3） |
| 冷启动扫描成本 | 0 | 0.46s / 26 包（证据 §3.2） | 同（缓存后 0 扫描） |

目标：**「新增插件不改表」**；只有「名字完全无关 + 注册早于本插件 + 包根不可得」的组合才落 T4/未识别（本机实测 0，最坏 4.2%）。

---

## 2. unit id 与展示名分离（D1）

### 2.1 标识规则（新增纯函数模块 `src/tools/attribution/unit-id.ts`）

```ts
/** 归一化包名：完整 npm 名（scope 保留、小写、去尾斜杠）。例：@xmanrui/dsh-im */
export function packageIdOf(packageName: string): string;
/** 展示名 = 包名去 scope。例：@xmanrui/dsh-im → dsh-im；dsh-univer-office → dsh-univer-office */
export function displayNameOfPackage(packageId: string): string;
/** 旧 unit（规则 display / 历史键）→ 包 id；未知名返回 undefined（不猜） */
export function canonicalUnitId(legacyOrPackage: string): string | undefined;
/** 反向：包 id → 旧 unit（仅用于镜像双写；无别名返回 undefined） */
export function legacyUnitOf(packageId: string): string | undefined;
export const SELF_PACKAGE: string;              // "dsh-capability-settings"
export const UNATTRIBUTED_UNIT: string;         // "__unattributed__"（不变，pass-through）
```

**unit 取值空间**：

| 情况 | unit id | display |
|---|---|---|
| 归属到已知/自动发现的插件包 | 归一化包名（如 `dsh-univer-office`、`@xmanrui/dsh-im`） | 去 scope（`dsh-univer-office`、`dsh-im`） |
| 来源未识别 | `__unattributed__`（不变） | `来源未识别` |
| 迁移前旧键（读时归一） | 映射到上表包 id；映射不到 → 不参与 UI（原样保留） | — |

**已知别名表**（静态、随代码发版；`[需拍板] D1` 若选 slug 只改这张表的右值，不碰调用方）：

| 旧 unit（`TOOL_RULES.display`） | 新 unit（包 id） | display（不变） |
|---|---|---|
| `dsh-univer-office` | `dsh-univer-office` | `dsh-univer-office` |
| `dsh-to-figma` | `dsh-to-figma` | `dsh-to-figma` |
| `dsh-remote` | `dsh-remote` | `dsh-remote` |
| `dsh-im` | **`@xmanrui/dsh-im`** | `dsh-im` |
| `dsh-better-sidebar` | `dsh-better-sidebar` | `dsh-better-sidebar` |
| `dsh-popout-window` | **`@local/dsh-popout-window`** | `dsh-popout-window` |
| `dsh-diff-approval` | `dsh-diff-approval` | `dsh-diff-approval` |

> `TOOL_RULES` 现有 11 条规则都带 `packageName`（`plugin-attribution.ts:44-66` 实读），因此 T4 命中时**总能给出包 id**；`display` 字段保留为「表回退时的展示名」（与 `displayNameOfPackage` 不一致时以表为准并 warn，见 §4.4）。

### 2.2 为什么不直接用 display 做 id

- display 是人读的短名，会为了 UI 改（如 `dsh-figma` → `dsh-to-figma`）；而持久化键一旦变，旧开关全丢（`plugin-attribution.ts:20-21` 已有这条警告）。
- 包名是**安装/解析层面的稳定身份**，与 UI 命名解耦；`@xmanrui/dsh-im` 与 `dsh-im` 的差异正是现在最脆的一处。
- 已接受的代价：两个已知键变化（`dsh-im`、`dsh-popout-window`）必须迁移（§3），或按 D2 双写镜像保证回滚。

### 2.3 与 Jev / MCP / UI 的关系

- **Jev**：capability id = `capabilityId("tool:plugin:<unit>")`（现实现 `src/jev/apply.ts:396`）。unit 变化 → id 变化；id 不落盘，只影响「升级瞬间的冷会话 pending plan」（§12）。
- **MCP 域**：unit id 只服务 Tools 域；MCP 行用 `serverName/channel`，不受影响。
- **UI**：客户端一直用 `unit` 当 id、`name` 当标题（`src/client/composer-capability.tsx` 的 `ToolRow.unit/name`；`tools-panel` 同），**前端不需要拆字段**，只需展示名继续来自 `name`。
- **横幅展示**：详情可增一行诊断 `内部 id：@xmanrui/dsh-im`（可选，便于用户/支持排查）；默认不展示。

---

## 3. 持久化键迁移（D2，**无损且可回滚**）

### 3.1 受影响的数据面

| 文件 | 位置 | 旧值 | 新值 |
|---|---|---|---|
| `<dshHome>/dsh-capability-settings/tools-global.json` | `disabled: string[]` | `dsh-im`、`dsh-popout-window` 等旧 unit | 包 id（scoped 两个变化） |
| `<dshHome>/dsh-capability-settings/session-capabilities.json` | `sessions.<sid>.tools["plugin:<unit>"]` | 同上 | 同上 |

> 其余 5 个已知 unit 与包名相同，**值不变**；但迁移逻辑必须能处理全部 7 个（以及未来新增别名）。

### 3.2 迁移算法（幂等、崩溃可续）

**阶段 A：读时归一（先于写回，保证 RPC 语义立刻正确）**

1. 读 `tools-global.json` → `disabled` 逐项 `canonicalUnitId`；映射不到的项**原样保留在 raw 集合**（不参与禁用集合）。
2. 读 `session-capabilities.json` 的某会话 `tools` 键 → `unitOfKey` 后 `canonicalUnitId`；映射不到 → 原样保留、忽略。
3. 内存态只持有**归一化后的 unit id**（manager 的 `globalDisabled` / `sessionToggles` 不再出现旧 display）。
4. 若原始值里出现旧键（`legacyUnitOf` 命中），记录 `legacySeen` 标记（供阶段 B 判断是否需要写回）。

**阶段 B：一次性写回（锁内、单文件一次原子写）**

- 触发：插件 apply 后**异步**执行（`void migrateAttributionUnitIds(stores)`），不阻塞 RPC；`tools.list` 等读路径已在阶段 A 归一，所以写回延迟不影响正确性。
- 每个文件一次：
  - 锁内重读磁盘（复用 `shared/file-lock.ts` + `shared/atomic-write.ts` 的既有封装）。
  - 对 `disabled[]` / `tools` 的每个键：`canonical = canonicalUnitId(k)`。
    - 命中 → 写 `canonical`；**同时写旧键镜像**（`legacyUnitOf(canonical)`，同值）→ 见 §3.3。
    - 未命中且**不是** `plugin:` 域的键 → **原样保留**（未知/未来键，不删）。
    - 未命中且在 `plugin:` 域 → 视为「未知旧 unit」（插件可能已卸载）→ **原样保留**，不删、不参与 UI（与 v13 §3.4 的 stale 策略一致）。
  - 冲突：新键与旧键同时存在且值不同 → **新键胜**（更接近当前语义），旧键镜像重写为新键值；记录 `conflict` 诊断。
  - 写后校验（可跳过）：`disabled` 去重、`tools` 键值不变式（`true/false` 才写）。
- **幂等**：第二次运行检测到「已无未知旧键」即跳过写盘（避免每次启动刷 mtime）。
- **崩溃安全**：两个文件各自原子写；A 写完 B 未写时，下一次启动仍会看到 B 的旧键并补齐（读时归一保证行为正确）。

**阶段 C：一次迁移报告（诊断，可选）**

- 模块级结果 `{ migrated, mirrored, keptUnknown, conflicts, files }`；写 info 日志；可通过 `tools.list` 的 additive `attribution.migration`（仅诊断，不影响 UI）或 debug RPC 暴露给 tester（§12.3）。

### 3.3 回滚兼容：旧键镜像双写（D2）

- **目的**：用户把插件降级到旧版本时，旧版仍能读到「会话 Tools 开关」与「全局默认」，而不是全部回默认。
- **规则**：
  - 写（`tools.setSessionEnabled` / `tools.setGlobalEnabled` / `setBulk` 的 tools 域 / 迁移写回）时，对**存在别名**的 unit：同时写 `plugin:<new>` 与 `plugin:<legacy>`，值相同。
  - 读：新键优先；只有旧键时归一到新 id 使用；**主视图永远不出现旧 unit**。
  - 清除（`enabled: undefined`）：新键与镜像键一起删。
  - `tools-global.json` 的 `disabled` 同理：禁用某 unit → 数组里同时含 new 与 legacy；启用 → 两者一起移出；读取时归一去重。
- **代价**：文件里短期存在两份键；`disable all`/`enable all` 的计数按**归一后单元**计（已经如此：`session-bulk.ts` 用 `tools.list` 的 units）。
- **清理**：推荐保留到下一个 minor（或 `SESSION_STATE_VERSION` 升到 2 时）一次性删除镜像键；`session-state.ts:61` 是版本号所在地。若 D1 选 slug 化，镜像仍然有效（旧 display 仍是别名）。
- **不镜像的情况**：`__unattributed__`（无别名）、未知旧键、自动发现但无历史别名的包（没有旧键可镜像）。

### 3.4 迁移与缓存/其他状态的关系

- **不影响** `tool-attribution.json`（派生缓存，可随时重建；新 unit id 直接写入）。
- **不影响** Jev 持久化（Jev 不落 capability id）。
- **对账**（`session-state-reconcile.ts`）不改：镜像键与主键同生同灭，随会话记录一起清理。
- **失败降级**：任一文件写失败 → warn，**读路径仍按阶段 A 正确工作**，下次启动重试；不向用户报错。

---

## 4. Resolver 架构与优先级（D3/D4）

### 4.1 模块划分（建议路径，实现可合并但职责不变）

| 模块 | 职责 |
|---|---|
| `src/tools/attribution/types.ts` | `ToolAttribution` / `NamespaceAttribution` / 缓存 schema / 诊断类型 |
| `src/tools/attribution/unit-id.ts` | 包 id 归一、display、旧键别名、`SELF_PACKAGE`（§2） |
| `src/tools/attribution/resolver.ts` | 内存索引 + 优先级短路 + 合并策略 + `settling()`；**同步** `resolveTool/resolveNamespace` |
| `src/tools/attribution/runtime.ts` | T0：`tools/change` 监听、栈捕获、包名解析、差集、失败禁用 |
| `src/tools/attribution/scan.ts` | T1/T2：包根解析、静态字面量扫描、索引构建（异步、限额、超时） |
| `src/tools/attribution/cache.ts` | `tool-attribution.json` 读写（§8） |
| `src/tools/attribution/migrate.ts` | unit id 迁移（§3） |
| 改：`src/shared/plugin-attribution.ts` | `TOOL_RULES`/`MCP_NAMESPACE_RULES` 保留为 T4；新增共享纯函数（相似度/停用词/包 id 校验） |
| 改：`src/tools/manager.ts:179-268` | `enumerateGlobalTools` 改为接受 `resolve` 回调；unit/display/attribution 来自 resolver |
| 改：`src/mcp/runtime.ts:156-193` | namespace 解析先查 resolver，再回退表 |
| 改：`src/index.ts:127-144,310-311` | 组合根创建 resolver（**尽早**挂 T0 监听）+ 注入 + dispose |
| 改：`src/client/{api.ts,tools-panel.tsx,mcp-panel.tsx}` | 新 matchedBy 文案 + 推测标识（§10） |

### 4.2 优先级（单次解析，按序短路）

```
resolveTool(name):
  # 域恒等（不变，先于一切）
  if parseMcpToolName(name):  → MCP_DOMAIN（不属于 Tools unit）
  if isHostBuiltinTool(name): → HOST_BUILTIN（不入域）

  # T0 运行时栈（ground truth；仅覆盖监听器挂上后注册的工具）
  if runtime[tool]:            → { packageId, matchedBy:"runtime", confidence:"high" }

  # T1 静态字面量唯一命中（冷启动回填）
  owners = literalIndex.owners(name) - SELF - hostPackages
  if |owners| == 1:            → { packageId, matchedBy:"literal", confidence:"high" }

  # T4 人工表（精确/前缀；覆盖 T1 漏掉或包根不可得的场景）
  if rule := TOOL_RULES.match(name):
      if T1 有 owner 且 ≠ rule 的包: warn + 标 conflictsWithTable
      → { packageId: rule.packageName ?? canonical(rule.display), matchedBy:"table", confidence:"high" }

  # T3 名字相似度（唯一 + margin）
  best,second = top2(score(name, pkg) for pkg in candidatePackages)
  if best.score ≥ 0.5 and (no second or best.score-second.score ≥ 0.3):
      → { packageId: best.pkg, matchedBy:"similarity", confidence:"medium", evidence: scores }

  → { matchedBy:"unknown", confidence:"low" }   → unit = "__unattributed__"
```

- **T1 与 T4 冲突**（D3）：T1 优先 + `warn` + `attribution.conflictsWithTable=true`（供日志/诊断，不进 UI 主文案）。理由：T1 有宿主真实注册事实支撑（字面量在唯一包内），而 T4 可能因插件改名而过期；但二者冲突值得人工复核。
- **T0 永远赢**：T0 有值时直接返回，不与表/扫描比较（栈是运行事实）。
- **T2（MCP 命名空间）走独立路径**（只影响 MCP 域，不进 Tools unit）：

```
resolveNamespace(ns):
  # T0'：该命名空间下工具的注册栈（若在监听窗口内注册）→ 包
  if runtimeNamespace[ns]:     → { packageId, matchedBy:"runtime", confidence:"high" }
  # T2：包内唯一出现该命名空间字面量（排除 SELF）
  owners = namespaceIndex.owners(ns) - SELF
  if |owners| == 1:            → { packageId, matchedBy:"namespace", confidence:"high" }
  # T4：MCP_NAMESPACE_RULES
  if rule:                     → { display: rule.display, packageId: rule.packageName, matchedBy:"table" }
  → undefined（交回 MCP 配置域，显示"外部注入/未识别"）
```

- **T2 的边界**：T2/T0' 只服务 **MCP 域**（R4 来源标签 / `mcp.runtime.channel`），**不参与 Tools unit 的优先级链**；Tools 的 mcp 前缀工具在域恒等阶段就被排除。两套 resolver 共用同一份包索引（T1 扫描产物），因此不会出现"同一包两种拼写"。
- **确定性**：同一输入多次调用必须同结果（索引按包名排序、T3 平局取 packageId 字典序最小但**不采用**——平局直接落 unknown，不猜）。
- **多版本同包**（pnpm 嵌套）：unit id 只按**逻辑包名**合并（版本只进缓存键）；日志记 `multiVersion:true`。

### 4.3 对外接口（resolver 契约）

```ts
export interface ToolAttribution {
  /** 命中时的包 id（= Tools unit）；unknown 缺省 */
  packageId?: string;
  /** 展示名（去 scope；表回退时用表 display） */
  display?: string;
  matchedBy: "runtime" | "literal" | "table" | "similarity" | "unknown";
  confidence: "high" | "medium" | "low";
  /** 命中依据原文：字面量 / 规则 pattern / 命名空间 / 包名 */
  pattern?: string;
  /** 诊断：T1 与 T4 冲突、或与另一个候选并列 */
  conflictsWithTable?: boolean;
  ambiguous?: boolean;
  /** 人读一句（诊断/详情可选；UI 文案以 matchedBy 为主） */
  evidence?: string;
}

export interface AttributionResolver {
  /** 同步；未就绪时退化为 T0(已收)/T4/unknown，绝不阻塞 */
  resolveTool(toolName: string): ToolAttribution;
  /** MCP 命名空间 → 插件展示名/包 id（R4 channel 用） */
  resolveNamespace(namespace: string): NamespaceAttribution | undefined;
  /** 扫描/缓存是否仍在后台进行（供 tools.list additive 字段） */
  settling(): boolean;
  /** 强制刷新（诊断/面板"刷新"；全量或按包） */
  refresh(options?: { packages?: string[]; force?: boolean }): Promise<void>;
  /** 当前诊断快照（tester/日志；不跨 RPC） */
  snapshot(): ResolverSnapshot;
  dispose(): void;
}
```

- resolver 在 `enumerateGlobalTools` 里被**同步**调用（该函数同步）；所有异步结果先落内存索引，解析永远同步。
- 未就绪时 `resolveTool` = T0(已捕获) + T4 + unknown；**不会**因为扫描未完成而把已知插件归错。

### 4.4 T4 表的降级形态

- `TOOL_RULES` 保留，但语义改为「**人工确认的兜底**」：
  - `packageName` 必填（目前 11 条都有；加单测断言）；
  - `display` 仅在包 id 不可用时用作展示名（正常情况下 `display = displayNameOfPackage(packageId)`；若两者不一致 → warn 并采用**表 display**，同时单测列出差异，逐步收敛）。
- `MCP_NAMESPACE_RULES` 保留为 T2 兜底。
- 清理策略（**不在本任务**）：当某条规则连续 N 次（如 3 个版本/30 天）与自动归属一致，可移出表；保留「没有自动归属信号」的条目（如包根不可得）。加注释标记候选删除。

---

## 5. T0：运行时栈归属（主路径）

### 5.1 落点与生命周期（D5）

- **模块**：`src/tools/attribution/runtime.ts` 内的 `createRuntimeAttributor(ctx, deps)`。
- **监听注册位置**：`src/index.ts` 的 `apply()` **最前段**（在 `createSessionState`/`createToolsGlobalStore` 之前；这些构造是同步的，但监听越早覆盖窗口越大）。请求：`ctx.on("tools/change", handler)`，disposer 收进现有 `disposers` 数组（`src/index.ts` 的 ctx.effect 清理）。
- **为什么独立监听**：
  - `src/mcp/loader.ts:765` 的监听只做 MCP 屏蔽刷新（`scheduleRestrictionRefresh`），不改它；
  - `src/tools/manager.ts` 内的 `tools/change` 监听做 restrict 重算；
  - resolver 的监听只做归属捕获 —— 三者职责独立，互不 await；cordis `emit` 同步调用所有监听器（证据 §2.3），新增一个监听不影响既有行为。
- **初始化顺序**（保证不漏 + 不误）：
  1. 挂监听（从此开始的注册进入 T0 窗口）；
  2. 同步取一次基线 `schemas()` → `knownNames`（此前已注册的工具交给 T1/T2/T3/T4 回填）；
  3. 异步：读缓存（§8）→ 若需要则启动惰性扫描（§6/§11）。
- **卸载**：`dispose()` 移除监听、清定时器/队列；插件热重载不会叠加监听（每条注册一次）。

### 5.2 监听器算法（伪代码）

```
handler():
  try:
    old := Error.stackTraceLimit
    Error.stackTraceLimit := 48
    try: stack := new Error().stack
    finally: Error.stackTraceLimit := old          # 必须 finally

    pkg := parsePackageFromStack(stack)             # §5.3
    if pkg == undefined or pkg == SELF or isHostFrame or isBridge(mcp-client): return
    names := schemasNow()                            # 同步；宿主在 emit 前已 insert（证据 §2.3）
    added := names - knownNames
    knownNames := names
    for n in added:
      if runtime[n] == undefined: runtime[n] := { package: pkg, at: now }
      # 同名被另一插件重新注册（replace）→ 以最后一次为准（证据 §4.3/R5）
      else if runtime[n].package != pkg: runtime[n] := { package: pkg, at: now }
    namespaceHints: 若 added 里有 mcp__<ns>__* 且 pkg 不是 bridge → runtimeNamespace[ns] := pkg
    markDirty(); scheduleCacheFlush()                # §8
  catch (e):
    failures += 1
    if failures >= 3 and !disabled: disabled := true; warn("T0 连续失败，本进程降级到静态归属")
  finally:
    return                                          # 绝不让异常穿出监听器
```

要点：

- **只捕获栈开销，不做 IO**（证据 §4.2：8.18µs/次；30 工具 ≈0.27ms）。
- **差集**：`tools/change` 无 payload（证据 §2.3），所以在监听器里同步 `schemas()` 与 `knownNames` 求差；`emit` 发生在 insert 之后，所以新工具已在 `schemas()` 里。
- **注册风暴**：MCP server 一次注册 30 个工具 → 30 次 handler × `schemas()`（214 条）= 6.4k 次比较，忽略不计；且 bridge 帧会**提前 return**（不读 schemas），进一步省。
- **replace 语义**：同名工具被不同插件重注册 → 以最后一次为准（与宿主 registry 行为一致），记录 `at`。
- **命名空间**：若捕获到 `mcp__<ns>__*` 的注册来自真实插件包（非 bridge）→ `runtimeNamespace[ns] = pkg`，供 T0' 使用（直接压过 T2）。
- **失败禁用**：连续 3 次异常（栈不可用/属性不可写等）→ 本进程关闭 T0，warn 一次；后续依赖静态层。

### 5.3 栈解析规则（镜像 scout 证据 §4.1，补 pnpm/scope/Windows）

1. 统一分隔符：`stack.replace(/\\/g, "/")`。
2. 逐帧取形如 `at fn (/abs/path:line:col)` 或 `at /abs/path:line:col` 的文件路径（含 `file://` 时先去 scheme）。
3. 跳过非文件帧（`node:`、`internal/`、`<anonymous>`）。
4. **取文件路径**（去掉行号），然后按以下顺序解析包名：
   - `app.asar` 路径 / `@deepseek-ai/` → **宿主帧**（宿主内建/框架）→ 不作为插件；
   - 若不是 `node_modules` 路径 → 跳过该帧（可能是入口脚本/HMR loader）。
   - 将所有 `/node_modules/` 出现位置切分，**取最后一段**（这对 pnpm 嵌套天然有效）：
     - `x = 最后一段`；取首组件（若首组件以 `@` 开头则取两段）→ `candidate`；
     - 若 `candidate == ".pnpm"`：把该段剩余部分（`.pnpm/<name>@<ver>/node_modules/...`）再按 `/node_modules/` 切一次，取**最后**一段首组件 → 重算 `candidate`；
     - 若 candidate 以 `.` 开头 / 为空 / 含非法字符 → 跳过。
   - `[待验证 V2]`：pnpm 布局的真实栈帧样本（`/profiles/<p>/.pnpm/...` vs `.../node_modules/.pnpm/...`）；验证方式：真机 debug 打印一条注册栈，落 `notes/verify/out-t0-stacks.json`。
5. **软链**（`@local/*` 多为 `link:`）：栈里可能是真实路径（如仓库工作目录）或 `node_modules/@local/...`；若解析出的 `candidate` 不在「已知包名集合」，再用 **loader entries 的 `options.name` 与 baseUrl 做后缀匹配**（`baseUrl` 以该包目录结尾即命中）；仍不中 → 用 `candidate` 作为临时包 id（`confidence:"high", resolvedBy:"stack-dir"`，展示名 = candidate 去 scope），并记 `unmapped:true` 诊断（也可以等待扫描阶段补映射）。
6. **解析到"包目录名"而非真实包名**时：resolver 合并阶段用「包名映射表」（loader entries / T1 扫描得到的 `package.json.name`）把目录名换成正式包名；换不到就保留目录名（见上一条）。
7. `[待验证 V4]`：HMR 重载后栈帧是否仍指向包路径（若指向 HMR 临时文件，T0 降级）。

**误归属防护（必做）**：

| 防护 | 规则 |
|---|---|
| 自身包 | `candidate == SELF_PACKAGE` → 丢弃（`SELF_PACKAGE` 与 `package.json.name` 同源，单测断言） |
| 宿主/框架 | 含 `app.asar`、`@deepseek-ai/*`、`cordis`、`dsh-scope`、`dsh-tools`、`dsh-agent*` → 丢弃（这些是 emit/框架帧） |
| 桥接层 | `dsh-mcp-client` → 丢弃（异步注册栈只有 bridge；对应工具归 MCP 域，T2 处理） |
| 非法路径 | 无 `node_modules` / 解析失败 → 跳过该帧（继续看下一帧？**否**：只取"第一个属于插件包的帧"，都失败则放弃本次） |
| 一次多帧同包 | 取**最靠近注册点**的那帧（栈里第一个非框架帧） |

> 说明：栈里会出现 `emit → ScopedLayers.effect → register` 三帧框架，之后才是注册插件帧（证据 §4.1）；规则按"跳过框架帧后第一个插件帧"即可。

### 5.4 覆盖窗口（必须写进 README/CHANGELOG）

- ✅ 本插件 apply 之后注册的**全部**工具（本机第三方插件大多在 bundles 尾部，推断覆盖绝大多数；`[待验证 V2]` 加载顺序）。
- ❌ 本插件监听之前注册的工具（启动更早的插件）→ T1/T2/T3/T4 回填。
- ⚠️ **异步注册**（如 `await listTools()` 后注册）→ 栈只剩 `dsh-mcp-client` 帧 → 归 MCP 域（T2），不影响 Tools。
- ⚠️ 若宿主未来把 `emit` 改成异步/微任务，T0 栈将不含 register 帧 → **自动降级**（解析失败计数触发禁用），行为等于 T1–T4。

---

## 6. T1：静态字面量扫描（冷启动回填）

### 6.1 包根获取（D6）

优先级（逐包解析，拿不到就跳过该包的静态层）：

1. **官方 API（首选）**：`ctx.get("pluginPackages")?.packageOf(specifier, baseUrl)?.dir`。
   - 官方消费范例：`@deepseek-ai/dsh-tool-cordis lib/types/config.js:44-47`（证据 §2.1）。
   - 真机可用证据：Config provider 的 `packageDir` 实测返回（证据 §2.1）——但**是从插件 ctx 可见性 [待验证 V3]**（`ctx.get("pluginPackages")` 可能返回 undefined；本插件目前 `inject=["skills"]`，`src/index.ts:56`）。
2. **loader entries**：`ctx.loader ?? ctx.get("loader")` 的 `entries?.()`（本仓库 `src/mcp/runtime.ts:110-129` 已用同一取值方式）；每条 entry 取：
   - `entry.options.name`（模块 specifier，如 `dsh-to-figma`、`@xmanrui/dsh-im`）；
   - `entry.ctx?.baseUrl ?? entry.baseUrl`（loader 给条目 ctx 扩展 `baseUrl`，证据 §2.1：loader `lib/index.js:133,599`）。
   - 对每个 entry 调 `packageOf(name, baseUrl)`；失败再走兜底。
3. **兜底（无 pluginPackages）**：`createRequire(baseUrl).resolve.paths(name)` 逐个 candidate，`existsSync(join(candidate,"package.json"))` 命中即包根（与宿主 `packageOf` 内部实现同款，证据 §2.1 R9）。
4. **动态 fiber**（`ctx.plugin(...)` 挂的、不在 entry 树里的插件）：**没有 baseUrl** → 静态层跳过（日志 `noPackageRoot`）；只能靠 T0（注册时覆盖）或 T3（相似度）。
5. 读到包根后 **读一次 `package.json`**：`name`（正式包名，优先于目录名）+ `version`（缓存键）；失败 → 用目录名 + `version:unknown`。

- `pluginPackages` 不可用的整体降级：全部走 2/3；仍失败 → `settling` 结束且日志 warn，UI 仍显示 T4/未识别（不报错）。
- 排除：`SELF_PACKAGE`、`@deepseek-ai/*`（宿主包，不进插件域）、`dsh-mcp-client`。

### 6.2 扫描安全边界（只读、限额）

| 维度 | 规则 |
|---|---|
| 根范围 | 仅 `packageDir` 下；**不跟随** symlink 目录（`lstat` 判断，`[待验证]` 本机 `link:` 依赖的 realpath 形态）；`realpath(root)` 后再扫 |
| 目录跳过 | `node_modules`、`artifacts`、`.git`、`docs`、`test`、`tests`、`__tests__`、`coverage`、`examples`、`playground`、`vendor`、`.figma`（证据 §3.1） |
| 文件类型 | 仅 `.js` / `.mjs` / `.cjs`；**排除** `.d.ts`、`.map`、`.json`、二进制 |
| 单文件上限 | **2 MB**（证据 §3.2：不设会被 59 MB artifacts 拖死） |
| 单包上限 | 最多 2000 个文件 / 64 MB 读取 / **300ms deadline**（`Promise.race` 到点即放弃该包，记 `failures[package]`） |
| 全局上限 | 最多 64 个包、总 deadline 8s（后台）；超时按已扫部分入库，其余标 `pending` |
| 执行 | **绝不 require/import/eval**；只 `fs.readFile` + 字符串扫描 |
| 错误 | 单文件读失败跳过；单包失败只记日志/诊断，不影响其它包 |
| 并发 | 扫描并发 ≤2（IO 密集但避免抢占 RPC）；扫描在后台任务里进行，不阻塞事件循环过久（每处理 N 个文件 `await setImmediate`，保证 RPC 可插队） |

### 6.3 字面量索引（T1/T2 共用）

- 提取：对每个文件用引号字面量正则（`["'`]([A-Za-z][A-Za-z0-9_.\-]{2,60})["'`]，证据 §13），过滤工具名形状 `^[a-z][a-z0-9_]{2,47}$`（证据 §3.1）。
- **锚点门控（增强，非 scout 原方案）**：只有文件内部出现至少一个注册锚点（`tools.register(`、`.register(`、`defineTool(`、`createTool(`、`createMcpToolDefinition(`、`name:`）才把该文件的字面量计入索引 —— 降低「日志/文档字符串」误报；`[待验证]` 对覆盖率影响（预期 ≤1 个工具，证据 §3.3 的误报源②③）。
- 归属：`literalOwners: Map<literal, Set<packageId>>`（排除 SELF 与宿主包）。
- `namespaceHints`：对 `mcp__<ns>__*` 的 `<ns>` 同样收集（T2 用）。
- 只把「**当前 `schemas()` 里真实存在的工具名**」与「namespace 候选」写进缓存索引（证据 §7.3 建议），避免 23k 字面量落盘；扫描时若工具集变化，未命中名字触发按包增量重扫（§8.2）。

### 6.4 唯一命中的定义与歧义

- T1 采用条件：`owners(name)` 去重后 **恰好 1 个包**，且不是 SELF/宿主包。
- owner ≥2 → **不采用**（落 T3/unknown），缓存里记 `ambiguous[name]=owners` 供诊断。
- 空 owner → 落 T3。
- `[待验证 V5]`：真实 214 工具上 T1 唯一命中 30/48（证据 §0），0 歧义；实现后跑一次真机索引落盘核对。

---

## 7. T2（MCP 命名空间）、T3（相似度）、T4（人工表）

### 7.1 T2 / T0'（MCP 域来源，R4）

- 目的：把 `MCP_NAMESPACE_RULES` 的硬编码（只有 `figma`）变成自动映射。
- 信号：
  - **T0'**：该命名空间下工具的注册栈命中真实插件包（最常见：插件直接 `ctx.tools.register(createMcpToolDefinition(...))`，如 `dsh-to-figma`，证据 §2.2/§4.3）→ `matchedBy:"runtime"`，最高。
  - **T2**：命名空间字面量在**唯一**插件包内出现（排除 SELF）→ `matchedBy:"namespace"`。
- 排除自身包是**硬要求**：本仓库历史硬编码表含 `figma`，不排除会出现 2 个 owner（证据 §3.3 自污染实测）。
- 0 owner → 交回 MCP 域按配置/外部实例展示（不猜）；≥2 → 「未识别」。
- 失败影响面：只影响 MCP 列表两枚标签/来源文案，不影响 Tools 开关。
- 实现落点：`src/mcp/runtime.ts:156-193` 的 `scanInjectedMcpNamespaces` 改为接受 `resolveNamespace`（由组合根注入），未注入时回退 `attributeMcpNamespace`（旧行为）。

### 7.2 T3 名字相似度（仅兜底）

- 归一化（证据 §5.1）：
  - 包 token：去 scope、去 `dsh-`/`plugin-` 前缀、按 `-/_/.` 切分、小写、去停用词（`to,in,of,the,and,for,with,on,at,is,a,an,dsh,plugin,local,tool,tools`）。
  - 工具 token：同法切分；`mcp__<ns>__<raw>` 取 `ns` 与 `raw` 两段合并（Tools 域不会遇到 mcp 名，函数仍通用）。
  - `score = |交集| / min(|工具 token|, |包 token|)`。
- 采用条件：`best ≥ 0.5` **且** `(no second or best - second ≥ 0.3)`；平局/不达标 → unknown（**绝不猜**）。
- 标记：`matchedBy:"similarity"`、`confidence:"medium"`、`evidence` 记 top2 分数；UI 标「推测」。
- 候选包集合 = 本次扫描得到的插件包集合（不是全盘 379 包；真机上仍存在歧义，证据 §5.2：`dsh_im_context → {@xmanrui/dsh-im, dsh-context}`）——所以 margin 是硬条件。
- T3 **只在 T0/T1/T4 都没命中时**运行（优先级最后一层）。
- 结构性无解的例子（证据 §5.2）：缩写前缀 `rw_*` ↔ `dsh-remote`（T4 已覆盖）、通用词 `plugin_manager`（无命中 → unknown）。

### 7.3 T4 人工表（保留，降级锚）

- 见 §4.4：`TOOL_RULES`/`MCP_NAMESPACE_RULES` 保留、语义降级。
- 新增约束：每条 `TOOL_RULES` 必须有 `packageName`（单测）；`display` 与 `displayNameOfPackage(packageName)` 不一致时 warn（当前 2 条 scoped 规则就是这种情况：`dsh-im` vs `dsh-im` 相同、`dsh-popout-window` 相同——按 §2.1 的 display 规则实际上一致，差异只可能来自未来的表改动）。
- 表条目的新增仍需人工，但**只在自动层失败时才需要**；日志/诊断会列出「所有 unknown + 候选」，方便补表。

---

## 8. 缓存（`tool-attribution.json`）

### 8.1 路径与文件形状（D7）

`<dshHome>/dsh-capability-settings/tool-attribution.json`（目录 0700 / 文件 0600；原子写 + 文件锁；范式照 `src/tools/global-state.ts:37-49,169-174`）。

```jsonc
{
  "version": 1,
  "generatedAt": 1761800000000,
  "hostVersion": "0.2.1-rc.3",
  "selfPackage": "dsh-capability-settings",
  "packages": {
    "dsh-univer-office": {
      "version": "0.3.7",          // 包 package.json version
      "mtimeMs": 1761700000000,    // 包根/入口 package.json mtime
      "scannedAt": 1761800000000,
      "literals": ["univer_new"],  // 只存「工具名形状且当前/曾命中工具名」的子集（≤500/包）
      "namespaceHints": []         // 该包内出现过的 mcp 命名空间字面量（≤50）
    }
  },
  "runtime": {
    "univer_inspect": { "package": "dsh-univer-office", "at": 1761800000000 }
  },
  "failures": {
    "some-big-pkg": { "reason": "timeout", "at": 1761800000000 }
  }
}
```

- `runtime` 段只存「T0 捕获到的工具 → 包」；**不存 failure 之外的用户数据**。
- 缓存是**派生数据**：损坏/缺失/版本不认识 → 直接丢弃重建，无需迁移，不写错误 UI。
- `literals` 落盘前过滤（只留工具名形状 + 与当前工具集/命名空间相关），控制 <100 KB（证据 §7.3）。

### 8.2 失效与增量

| 触发 | 动作 |
|---|---|
| `tools/change` | **只更新内存 runtime 段**；2s debounce 后合并写缓存；不重扫包 |
| `tools.list` 发现「未归属工具名」且该名不在索引里 | 触发**惰性按包扫描**（仅未扫描/待重扫的包）；不阻塞本次 RPC（`attributionSettling:true`） |
| 包 `version` / `package.json mtimeMs` 变化 | 该包索引失效，标记待重扫（下次惰性/启动时） |
| 宿主版本变化（`hostVersion` 与当前不同） | 整份缓存失效（内建名单/宿主布局都可能变） |
| `dshHome` / profile 变化 | 缓存路径随 dshHome 变，天然隔离 |
| 手动刷新（诊断/面板） | `resolver.refresh({force:true})` 全量重扫（异步） |
| 文件损坏 / version 不认识 | 空缓存 + `warn`；退化为 T0 + T4 + unknown，后台重建 |
| 包被卸载 | 下次全量扫描时从 `packages` 删除（缓存可丢）；**不删**用户开关（那是 §3 的事） |

### 8.3 并发与写入

- 进程内：模块级串行队列（`queue = queue.then(write)`），写盘前 200–2000ms debounce 合并（`tools/change` 风暴只写一次）。
- 跨进程/多面板：`withFileLock` 锁内**重读磁盘合并**：`runtime` 按 `at` 取新；`packages` 按 `name+version+mtimeMs` 取新；`failures` 合并。写失败 → warn，内存索引继续用（本次运行内不丢）。
- 读：`ready()` 懒加载（幂等）；读取时校验 `version/hostVersion/selfPackage`，不符即丢弃。
- 清理：`packages` 只保留当前解析到的包名集合（全量扫描后裁剪）；`runtime` 只保留当前 `schemas()` 中存在的工具名（全量扫描时裁剪）。
- `dispose()`：flush 一次（不 await，best-effort）。

---

## 9. 接口与类型变更（additive，D4/D9）

### 9.1 宿主 `ToolsUnitView.attribution`（`src/tools/types.ts:62-68`）

```ts
attribution: {
  /** 新联合（additive）；旧值 "prefix" | "exact" 仍可能出现（表回退/旧宿主）。 */
  matchedBy: "runtime" | "literal" | "table" | "similarity" | "namespace" | "prefix" | "exact" | "unknown";
  confidence?: "high" | "medium" | "low";
  /** 包 id（= unit；诊断用；无 scope 前缀的展示名另在 name） */
  packageName?: string;
  /** 命中依据原文（字面量/规则 pattern/命名空间/包名） */
  pattern?: string;
  /** T1 与 T4 冲突、或 T3 有并列候选（诊断；UI 可显示"来源有冲突"） */
  conflictsWithTable?: boolean;
  ambiguous?: boolean;
  /** 单元内工具来源不一致（部分 T0、部分 T1…） */
  mixed?: boolean;
  /** 旧 unit（迁移诊断；不展示在常规 UI） */
  legacyUnit?: string;
}
```

- 单元级 `attribution` 的选取：**取该单元内工具的"最高优先级依据"**（runtime > literal > table > similarity）；若来源不一致 → `mixed:true`。
- `ToolsListView` additive：`attributionSettling?: boolean`（后台扫描中；客户端可安静轮询一次或显示"正在识别来源…"）；`attributionDiagnostics?`（仅 debug/测试开关下返回，默认不下发，避免体积）。

### 9.2 `mcp.runtime` 视图（R4；`src/mcp/types.ts:216-246`）

```ts
attribution?: {
  matchedBy: "runtime" | "namespace" | "source" | "table" | "unknown";
  confidence?: "high" | "medium" | "low";
  pattern?: string;
};
```

- `channel` 仍由包 id → `displayNameOfPackage`（或 T4 display 兜底）。
- namespace 行的 `synthesized/origin` 语义不变。

### 9.3 客户端（`src/client/api.ts` / `tools-panel.tsx` / `mcp-panel.tsx`）

- `ClientToolsUnit.attribution.matchedBy` 联合扩展 + `confidence?`/`conflictsWithTable?`/`ambiguous?`/`mixed?`/`legacyUnit?`（全部 optional，旧宿主回退 `unknown` 处理）。
- `ClientMcpRuntimeServer.attribution` 联合扩展。
- **无新 RPC**：字段随现有 `tools.list` / `tools.inspect`（unit 级）/ `mcp.runtime` 下发。

### 9.4 内部装配

- `src/index.ts`：`const resolver = createAttributionResolver({ ctx, dshHome, logger });` → 传给 `createToolsManager({ resolver })` 与 `createMcpManager({ resolveNamespace: resolver.resolveNamespace })`；`disposers.push(() => resolver.dispose())`。
- `src/tools/manager.ts`：`enumerateGlobalTools(access, resolveTool)`；`ToolsManagerDeps` 增加 `resolver?`（缺省 = 纯表回退，保证旧装配/测试不炸）。
- `src/mcp/runtime.ts`：`scanInjectedMcpNamespaces(ctx, exclude, resolveNamespace?)`。

---

## 10. 前端展示：「来源判定」依据（D9）

### 10.1 文案映射（`tools-panel.tsx:61-66` 的 `attributionText` 重写）

| `matchedBy` | 详情「来源判定」文案 | 附加标识 |
|---|---|---|
| `runtime` | `运行时捕获：注册栈 → {packageName}（包目录解析）` | — |
| `literal` | `包扫描：{packageName} 内唯一字面量命中` | 中性（可加 "扫描" 小标签） |
| `table` | `人工映射：{pattern} → {display}（插件清单表）` | — |
| `similarity` | `名字推测：{packageName}（相似度 {score?}，仅供参考）` | **「推测」琥珀标签**（必需） |
| `namespace` | `命名空间映射：mcp__{pattern}__ → {display}` | —（MCP 详情用） |
| `prefix`/`exact`（旧宿主） | 保持现有文案（`精确匹配/前缀 … → …（插件清单映射表）`） | — |
| `unknown` | `来源未识别（不是宿主内置）` | 琥珀「未识别」标签（已有） |

- **推测单元额外提示**（详情顶部一行，`similarity` 或 `mixed && confidence!==high` 时）：
  `来源为自动推测，关闭前请核对下方工具清单，避免误关其它插件的工具。`
- **混合/冲突**（诊断）：`mixed` → `来源依据不一致（部分工具来自运行时捕获，部分来自包扫描/推测）`；`conflictsWithTable` → 仅日志/诊断面板，不进主文案（避免噪音）。
- **扫描中**：`tools.list.attributionSettling=true` 时不阻塞列表；详情「来源判定」可加尾注 `（来源识别中…）`；客户端在首次拿到 `true` 后延迟 800ms 静默刷新一次（与 MCP `settling` 同款，`mcp-panel.tsx` 已有范式）。
- **旧 id 诊断**：`legacyUnit` 存在时，详情底部小字 `内部 id 已迁移：{legacyUnit} → {unit}`（仅诊断；默认折叠）。

### 10.2 各页面一致性

- Tools hero 卡片：**不显示证据文案**（卡片只有插件名 + 工具数 + `插件` 标签），不新增噪音；推测是否在卡片加角标 → **不加**（详情足够）。
- 能力面板 Tools 列表行：`插件`/`未识别` 标签不变；`similarity` 单元的标签仍 `插件`（详情说明），若 D9 拍板要求更醒目可加 `推测` 小标签（备选）。
- MCP 外部行/详情：`attribution` 新旧值都要能渲染（`source` 旧值保留文案）。

---

## 11. 性能预算（D8）

| 路径 | 预算 | 依据/实测 |
|---|---|---|
| T0 单次捕获（含抬帧 + 解析） | ≤15µs | 证据 §4.2：`new Error().stack` 8.18µs + 解析 ~2–5µs |
| 注册风暴 300 工具 | ≤5ms | 300 × 15µs |
| `tools.list`（缓存已就绪） | ≤5ms 额外开销 | 纯内存 Map 查询 |
| 缓存读取（冷启动一次） | ≤10ms | <100KB JSON |
| 首次全量扫描（26 包） | ≤500ms | 证据 §3.2：0.46s（跳 artifacts + 2MB 上限） |
| 单包扫描 deadline | 300ms | 证据 §10 R6 建议 |
| 增量：新出现未归属工具 | ≤50ms/包（惰性单包） | 单包通常 <50ms；超时放弃 |
| 扫描对 RPC 的影响 | 不阻塞：后台任务 + 每 N 文件让出事件循环 | 任务书要求"不得阻塞 RPC" |
| `attributionSettling` | 从首次需要扫描到完成 | 无固定上限（后台）；UI 不阻塞 |

- **禁止**在 `enumerateGlobalTools` / `list` / `inspect` / `restrict` 路径里 `await` 扫描。
- 扫描启动时机：`apply()` 后 `queueMicrotask`/`setTimeout(0)` 启动「读缓存 → 如需要按需全量扫描」；若缓存有效则零扫描。
- 可观测：日志 `attribution scan: packages=26 files=... bytes=... ms=...`（一次），`failures` 入缓存诊断。

---

## 12. 测试设计（交给 tester）

### 12.1 测试载体

- 沿用仓库本地套件：`notes/verify/*.mjs`（`check(id, desc, pass, detail)`；宿主侧假 ctx 参考 `loader-behavior.mjs`，客户端 SSR 参考 `capability-dock-render.mjs`）。
- 新增脚本（建议）：
  - `v14-attribution-t0.mjs`（栈捕获 + 解析 fixture + 防护）
  - `v14-attribution-scan.mjs`（T1/T2/T3 + 限额 + 歧义）
  - `v14-attribution-cache.mjs`（命中/失效/损坏/并发写）
  - `v14-unit-migration.mjs`（无损迁移 + 回滚镜像 + 未知键）
  - `v14-attribution-ui.mjs`（文案 + 推测标识 + settling）
- **T0 真栈夹具**：在 `notes/verify/fixtures/node_modules/fake-plugin/index.js` 里调用一个假 `tools.register`（内部同步 `emit("tools/change")`），监听器栈里就会出现 `.../node_modules/fake-plugin/index.js` → 断言归属 `fake-plugin`（不依赖宿主真机）。

### 12.2 用例（编号 `V14-*`）

**T0（AT0）**

| # | 断言 |
|---|---|
| AT0-01 | 真栈夹具：假插件注册 1 个工具 → 归属 `fake-plugin`、`matchedBy:"runtime"`、`confidence:"high"` |
| AT0-02 | 批量注册（同一调用栈注册 3 个）→ 3 个都归属；`knownNames` 差集正确 |
| AT0-03 | pnpm 路径：`/x/node_modules/.pnpm/dsh-remote@1.0.0/node_modules/dsh-remote/lib/a.js` → `dsh-remote` |
| AT0-04 | scoped 路径：`/x/node_modules/@xmanrui/dsh-im/lib/a.js` → `@xmanrui/dsh-im` |
| AT0-05 | Windows 分隔符（`\`）与 `file://` 前缀 → 解析成功 |
| AT0-06 | 防护：`app.asar`/`@deepseek-ai/*` 帧 → 宿主，不归属；`dsh-mcp-client` 帧 → 不归属（bridge）；自身包帧 → 不归属 |
| AT0-07 | `stackTraceLimit`：捕获后恢复为原值（断言前后相等，含原值为 0/50 的情况） |
| AT0-08 | 异常注入（栈 getter 抛错 / 属性不可写）→ 监听器不抛、注册流程不受影响；连续 3 次 → T0 禁用 + warn 一次 |
| AT0-09 | replace：同名工具先后被两个假包注册 → 以最后一次为准（`at` 更新） |
| AT0-10 | MCP namespace：假插件注册 `mcp__fake__x` → `runtimeNamespace.fake=fake-plugin`，`resolveNamespace("fake")` 命中 runtime |

**T1/T2/T3 扫描（AT1）**

| # | 断言 |
|---|---|
| AT1-01 | 包扫描：夹具包含 `tools.register({name:"fake_tool_alpha"})` → T1 owner 唯一 → 归属；`matchedBy:"literal"` |
| AT1-02 | 歧义：两个夹具包都含同名工具字面量 → 不采用（落 unknown/T3 不达标） |
| AT1-03 | 自污染排除：夹具 `dsh-capability-settings` 也含字面量 → 不被选为 owner |
| AT1-04 | 限额：>2MB 文件跳过；`artifacts/test/node_modules` 目录跳过；`.d.ts` 跳过；总 deadline 到点放弃并记 `failures` |
| AT1-05 | 安全：扫描不执行代码（夹具里放 `throw`/`require` 语句，断言未执行、无副作用） |
| AT1-06 | T2：`figma` 字面量在 `dsh-to-figma` 唯一（排除自身）→ namespace 归属 `dsh-to-figma`；其余 9 个配置型 namespace → 0 owner（回退 T4/未知） |
| AT1-07 | T3 阈值：`univer_*` ↔ `dsh-univer-office` 命中；`rw_*` ↔ `dsh-remote` 不命中（缩写）；`dsh_im_context` 并列 → margin 不足 → unknown |
| AT1-08 | T3 标记：`matchedBy:"similarity"`、`confidence:"medium"`、`evidence` 含 top2 分数 |
| AT1-09 | 优先级：同一工具 T0/T1/T4 都有结果 → 选 T0；T1 与 T4 冲突 → 选 T1 + `conflictsWithTable:true` + warn |
| AT1-10 | 包根不可得（假 ctx 无 pluginPackages/loader baseUrl）→ 静态层跳过、不抛、日志 warn、行为=表+unknown |

**缓存（AT2）**

| # | 断言 |
|---|---|
| AT2-01 | 写入：扫描后文件存在（0600/0700）、含 `version/generatedAt/packages/runtime`；`literals` ≤500/包且只含工具名形状 |
| AT2-02 | 命中：第二次启动读缓存 → 不再扫描（计数 0）、`resolveTool` 结果与扫描一致 |
| AT2-03 | 失效：包 `version` 变化 / `package.json mtimeMs` 变化 / `hostVersion` 变化 → 对应缓存失效并重扫 |
| AT2-04 | 损坏：写坏 JSON / 未知 version / `selfPackage` 不符 → 空缓存 + warn + 后台重建（不抛） |
| AT2-05 | 并发：两个进程同时写（锁内合并）→ 不丢 `runtime`；进程内 debounce 合并（多次 `tools/change` 只写一次） |
| AT2-06 | 裁剪：全量扫描后删除已卸载包与已消失工具名的 `runtime` 条目；不碰 `tools-global.json`/`session-capabilities.json` |
| AT2-07 | dispose：插件卸载后不再写盘/不再监听（无定时器泄漏） |

**迁移（AT3）**

| # | 断言 |
|---|---|
| AT3-01 | 全局默认：`disabled:["dsh-im","dsh-popout-window"]` → 迁移后含 `@xmanrui/dsh-im`、`@local/dsh-popout-window`，且旧键镜像仍在、值等价；`resolveTool("dsh_im_x")` 的 unit = `@xmanrui/dsh-im` |
| AT3-02 | 会话覆盖：`tools{"plugin:dsh-im":false}` → 会话 `enabled` 仍 false（**用户开关不丢**）；写回后新键 + 镜像键都在 |
| AT3-03 | 未知键保留：`plugin:some-dead-plugin`、`plugin:tool:xxx` 等未知键原样保留、不影响 UI、不删 |
| AT3-04 | 冲突：新旧键同时存在且值不同 → 新键胜，镜像被改写为新值；记 `conflict` 诊断 |
| AT3-05 | 幂等：第二次启动不再写盘（mtime 不变） |
| AT3-06 | 崩溃可续：只迁移全局文件（模拟会话文件写失败）→ 下次启动补齐会话文件 |
| AT3-07 | 回滚兼容：迁移后用旧版键读取（模拟旧代码只读 `plugin:dsh-im`）→ 仍能读到关闭状态 |
| AT3-08 | `__unattributed__` 不受迁移影响；无别名的包 id 不产生镜像键 |

**UI（AT4）**

| # | 断言 |
|---|---|
| AT4-01 | 详情「来源判定」：runtime/literal/table/similarity/namespace/unknown 六种文案逐字正确 |
| AT4-02 | `similarity` 显示「推测」琥珀标签 + 顶部提示行；`unknown` 显示「未识别」 |
| AT4-03 | `mixed` 显示「来源依据不一致…」；`legacyUnit` 显示迁移诊断（折叠） |
| AT4-04 | `attributionSettling:true` 时列表不阻塞，文案带 `（来源识别中…）`；拿到 false 后提示消失 |
| AT4-05 | 旧宿主字段（`prefix`/`exact`/`unknown`、无 confidence）→ 旧文案不变，不崩 |
| AT4-06 | hero 卡片不新增证据噪音；标题仍为展示名（不是 unit id） |

**回归与性能（AT5/REG）**

| # | 断言 |
|---|---|
| AT5-01 | 7 个已知插件（fixtures）归属不变：univer→`dsh-univer-office`、remote→`dsh-remote`、im→`@xmanrui/dsh-im`、sidebar/popout/diff/figma 各自正确；展示名不变 |
| AT5-02 | 域边界：`mcp__*` 不进 Tools；宿主内建（含新增的 `create_worktree`/`read_mcp_resource` 等）仍被排除；`run_code` 不进 deny |
| AT5-03 | 开关行为：`tools.setSessionEnabled/setGlobalEnabled/setBulk` 用新 unit 正常工作；`reset`/默认层级不变 |
| AT5-04 | Jev：rank/apply 用新 unit 正常；同进程内 unit 变化（模拟热更新）后冷会话队列中的旧 id → `unknown-id` skipped（不崩、不误写）；"跨升级残留" 不适用（队列在内存，重启即清） |
| AT5-05 | MCP R4：namespace 两枚标签不变；配置型 MCP 不被 T2 误判 |
| AT5-06 | 性能：缓存命中 `tools.list` 额外 <5ms；首次扫描 <500ms（真机记录）；注册 300 工具 T0 开销 <5ms |
| AT5-07 | 无回归：`pnpm typecheck`/`pnpm build` 通过；`notes/verify/run-all.sh` 全绿（含既有 loader/mcp 用例） |

### 12.3 诊断出口（测试用，非产品 UI）

- `resolver.snapshot()` 内容（包数、runtime 条数、unknown 列表、failures、上次扫描耗时、迁移报告）通过**临时 debug RPC** `tools.attributionDebug`（只读，默认不注册/仅 `config.debugAttribution=true` 时注册）或 `console` 落 `notes/verify/out-*`。**正式版不暴露该 RPC**（或保留为只读诊断且不含敏感路径——包路径属于本机信息，建议 debug-only）。

---

## 13. 风险与降级

| # | 风险 | 严重度 | 触发 | 缓解/降级 |
|---|---|---|---|---|
| R1 | 栈帧被 bundler/sourcemap 改写 / 帧深度超限 | 中 | 插件用打包器/压缩 | `stackTraceLimit=48` + 解析失败计数；连续失败禁用 T0；落 T1–T4（覆盖率 ~96%） |
| R2 | 监听器内抛异常影响注册流程 | **高** | 任何 bug | 全 try/catch 吞掉、finally 恢复 stackTraceLimit；不 rethrow（沿用 `mcp/usage.ts` guard 纪律） |
| R3 | 监听 + 每次 `schemas()` diff 在注册风暴下 O(n²) | 低 | 30+ 工具连续注册 | 只捕获栈 + 增量 Set；bridge 帧提前 return（不读 schemas）；实测 214 工具可忽略 |
| R4 | 启动早于本插件的工具 T0 覆盖不到 | 中 | 插件顺序 | 冷启动 T1/T2/T3 + T4 回填（证据 §0） |
| R5 | 同名工具被不同插件先后注册（replace） | 低 | 插件冲突 | 以最后一次为准 + `at` 时间戳；日志提示 |
| R6 | 静态扫描超时/超大包/无权限 | 中 | 巨型包（59MB artifacts） | 目录跳过 + 2MB/文件 + 300ms/包 + 全局 deadline；失败记 `failures`，不影响其它包 |
| R7 | **自污染**：本仓库含工具名字面量（历史 `figma` 案） | **高** | 扫描自身包 | 双保险：T1/T2 与栈解析都显式排除 `SELF_PACKAGE`；单测 AT1-03 |
| R8 | 宿主升级新增内建工具未进排除清单 → 被当插件工具 | 中 | 宿主升级 | 域恒等先跑（`isHostBuiltinTool`）；T0 把 `app.asar`/`@deepseek-ai/*` 帧判宿主；每次宿主升级复核清单（v13 §4.3） |
| R9 | `pluginPackages` 不可见/无 `dir` | 中 | 服务缺失/旧宿主 | `createRequire` 兜底；仍失败 → 跳过静态层（T0/T3/表仍可用）；`[待验证 V3]` |
| R10 | 软链/`@local/*` 真实路径导致包名解析错 | 中 | `link:` 依赖 | 取 `node_modules` 最后一段 + 与 loader entries 的 `options.name` 后缀匹配；仍不行 → 用目录名临时 id + `unmapped` 诊断 |
| R11 | 多版本同包（pnpm 嵌套） | 低 | 依赖树 | unit 按逻辑包名合并（开关同时作用于所有版本）；缓存以 version 为键；日志 `multiVersion` |
| R12 | **误归属 → 关错插件**（T1 字面量误报 / T3 相似度错配） | **高** | 名字碰撞 | T3 唯一+margin；T1 唯一+锚点门控；详情列工具清单；`similarity` 标「推测」+ 提示；T0 存在时 T0 覆盖。**D9 拍板项**：是否把 similarity-only 单元设为只读 |
| R13 | unit id 迁移丢用户开关 | **高** | 迁移 bug | 读时归一 + 一次写回 + 双写镜像 + 幂等 + 崩溃可续；AT3-01..08 全覆盖；迁移前不删任何键 |
| R14 | 旧版回滚读不到新键 | 中 | 用户降级 | 镜像双写（§3.3）；保留到下一个 minor；文档标注 |
| R15 | `tool-attribution.json` 被旧版写坏/格式漂移 | 低 | 混装 | 派生数据：损坏即丢弃重建，不迁移；`version` 校验 |
| R16 | 缓存写入与 DSH 进程退出竞态 | 低 | 退出瞬间 | 原子写 + 锁；dispose best-effort flush；丢失只导致下次重扫 |
| R17 | 扫描泄漏插件包信息（路径）到缓存/日志 | 低 | — | 缓存只存包名/version/mtime，**不存绝对路径**；日志路径仅 debug 级 |
| R18 | Jev capability id 随 unit 变化 | 低 | 升级瞬间冷会话 | 只影响 pending plan（`unknown-id` skipped）；不误写、不崩；文档标注 |

---

## 14. 分阶段交付

### 14.1 阶段（每阶段可独立验证/回滚）

| 阶段 | 内容 | 验证 | 估时 |
|---|---|---|---|
| **P1** | **unit id + 迁移 + resolver 骨架**：`unit-id.ts`、`migrate.ts`、resolver（T4-only 行为）、manager 改接 resolver、`tools.list` attribution 字段扩展（`table/unknown`） | AT3-01..08；AT5-01/03/07；REG 全绿；行为等价（除 2 个 id 迁移） | 1.5d |
| **P2** | **T0 运行时捕获**（主路径）：栈解析 + 差集 + 防护 + 失败禁用；`mcp` namespace runtime hints | AT0-01..10；AT5-06（性能）；真机 V1/V2/V4 | 1.0d |
| **P3** | **缓存 + T1 扫描 + T2 namespace**：cache.ts、scan.ts（限额/超时/锚点门控）、包根获取、惰性扫描、`attributionSettling` | AT1-01..06/10；AT2-01..07；真机 V3/V5 | 1.5d |
| **P4** | **T3 相似度**（唯一+margin） | AT1-07..09 | 0.5d |
| **P5** | **UI 依据 + 推测标识 + settling 刷新 + MCP attribution** | AT4-01..06；AT5-05 | 0.75d |
| **P6** | **真机验收 + 性能/回归 + README/CHANGELOG/诊断 RPC** | AT5-01..07；真机 V1–V6 | 0.75d |

**合计 ≈ 6.0d**（另有与 P1 并行的文档/评审）。P1 必须先合入（持久化语义变更）；P2 可与 P3 交换顺序（T0 不依赖扫描），但 P1 的 resolver 契约要先定。

### 14.2 提交/回滚

- 每个阶段一次提交（中文 commit + 实际验证输出，仓库纪律）；P1 的迁移必须带"回滚测试"证据。
- 特性开关（建议）：`Config.enableAutoAttribution?: boolean`（默认 `true`；`false` = 纯 T4，等价今天），便于出问题时一键回退 attribution 逻辑；缓存文件保留无害。
- P1 上线后旧版插件可通过镜像键继续工作（R14）。

### 14.3 文档同步

- `README.md`：归属来源（运行时/包扫描/人工/推测/未识别）、`tool-attribution.json` 存在与可删除、`unit id = 包名`、旧键镜像与清理计划。
- `CHANGELOG.md` `[Unreleased]`：新增自动归属四层、缓存文件、unit id 迁移（含 2 个 id 变更与镜像回滚说明）、`tools.list`/`mcp.runtime` additive 字段；**标注 T0 覆盖窗口**与已知降级。
- `docs/architecture/v13-implementation.md`：§4（归属表降级为 T4）、§5.1（attribution 字段）、§9（UI 文案）补一句指向本文。

---

## 15. 附录

### 15.1 优先级矩阵（速查）

| 层 | Tools 工具归属 | MCP namespace 归属 | 置信度 | 依据 |
|---|---|---|---|---|
| T0 | ✅ 最高 | ✅ T0'（该 ns 工具注册栈） | high | 注册调用栈 |
| T1 | ✅ 唯一字面量 | —（T2 用同一索引） | high | 包内唯一字符串 |
| T2 | — | ✅ 唯一命名空间字面量 | high | 包内唯一字符串 |
| T4 | ✅ 人工表（兜底） | ✅ 人工表（兜底） | high（人工） | `TOOL_RULES`/`MCP_NAMESPACE_RULES` |
| T3 | ✅ 最后兜底（唯一+margin） | —（不做） | medium | 名字 token 相似度 |
| T5 | 未识别 | 未识别/外部注入 | low | — |

### 15.2 文件级改动矩阵

| 文件 | 类型 | 摘要 | 阶段 |
|---|---|---|---|
| `src/tools/attribution/{types,unit-id,resolver,runtime,scan,cache,migrate}.ts` | 新 | 见 §4.1 | P1–P4 |
| `src/shared/plugin-attribution.ts` | 改 | 表保留为 T4；加相似度/包名工具纯函数；`packageName` 必填断言 | P1/P4 |
| `src/tools/types.ts` | 改 | `attribution` 联合/字段 additive；`unitKeyOf` 语义不变 | P1 |
| `src/tools/manager.ts` | 改 | `enumerateGlobalTools` 接受 resolver；unit/display 来源切换；`attributionSettling` | P1/P3 |
| `src/tools/global-state.ts` | 改 | 读时别名归一 + 写时镜像（委托 unit-id 纯函数，**不改文件格式/版本**） | P1 |
| `src/session-state.ts` | 改 | 同上（`tools` 域键归一/镜像；**不改 schema version**） | P1 |
| `src/mcp/runtime.ts` | 改 | namespace 解析先 resolver 后表 | P3 |
| `src/mcp/manager.ts` | 改 | 透传新 attribution 字段/文案依据 | P3/P5 |
| `src/index.ts` | 改 | 装配 resolver（尽早挂 T0）+ dispose + 迁移调用 | P1/P2 |
| `src/client/api.ts` / `tools-panel.tsx` / `mcp-panel.tsx` | 改 | 新 matchedBy 文案、推测标识、settling 刷新 | P5 |
| `notes/verify/v14-*.mjs` | 新 | 测试用例（本地，gitignore） | P1–P6 |
| `README.md` / `CHANGELOG.md` / v13 架构文档 | 改 | 行为/降级/字段说明 | P6 |

### 15.3 待验证清单（owner / 方式 / 降级）

| # | 待验证 | owner | 方式 | 降级 |
|---|---|---|---|---|
| V1 | `tools/change` 监听器栈确实含注册插件包路径 | tester（P2） | 隔离环境 debug 打印一条注册栈，落 `notes/verify/out-t0-stacks.json` | T0 不可用 → T1–T4（~96% 覆盖） |
| V2 | 本插件 `apply()` 相对其它插件加载顺序（T0 窗口大小） | tester（P2） | 启动日志/loader entries 顺序 | 同上 |
| V3 | `ctx.get("pluginPackages")` 从插件 ctx 可见 | backend（P3） | 插件内打印是否 undefined | `createRequire` 兜底（R9） |
| V4 | HMR 重载后栈帧是否仍指向包路径 | tester（P2） | 热重载后重复 V1 | T0 依赖冷启动回填 |
| V5 | 26 包全量扫描在目标机器耗时（本机 0.46s） | tester（P3） | 一次性 debug 计时 | 单包惰性扫描 + 缓存 |
| V6 | `univer_inspect`/`plugin_manager` 能否被 T0 解 | tester（P2） | 真机确认归属 | 归"来源未识别"（A4 已支持） |
| V7 | 软链 `@local/*` 栈路径形态（真实路径 vs node_modules） | tester（P2） | 真机打印栈 | 目录名临时 id + `unmapped` 诊断 |
| V8 | 迁移后旧版插件回读镜像键（R14） | tester（P1） | 用旧 `lib/` 读迁移后的两份文件 | 若旧版不认 → 放弃镜像（降级为文档标注） |

### 15.4 与「用户要求」的对照

- **新增插件不改表**：T0 让新增插件零配置正确归属；T1/T2 让冷启动也基本自动；仅「名字无关 + 注册早于本插件 + 包根不可得」需要人工表（本机 0，最坏 4.2%）。
- **低风险**：T0 只加一个监听器（异常全吞）；T1/T2/T3 只读文件/纯字符串；最差 = 今天的表 + 未识别。
- **可缓存**：`tool-attribution.json`（包名+version+mtime+hostVersion 键，原子写）；命中后 0 扫描。
- **失败降级**：逐层短路到 T4/T5；迁移有任何问题都不删旧数据（镜像 + 未知识保留）。

---

## 16. 参考

- 证据：`docs/research/plugin-attribution-heuristics.md`（§0 摘要 / §2.1 loader·包根 API / §2.3 tools/change 同步性 / §3 静态扫描实测 / §4 运行时栈 / §5 相似度 / §7 缓存 / §10 风险 / §11 待验证）
- 现状：`src/shared/plugin-attribution.ts`（TOOL_RULES/MCP_NAMESPACE_RULES/内建清单）、`src/tools/{manager,types,global-state,restrict}.ts`、`src/session-state.ts`、`src/mcp/runtime.ts`、`src/index.ts`
- 关联方案：`docs/architecture/v13-implementation.md`（§2 域边界 / §3 持久化 / §4 归属 / §5 Tools 开关 / §9.4 面板）
- 宿主：`@deepseek-ai/cordis`（emit/registry/Fiber）、`@deepseek-ai/cordis-plugin-loader`（entries/baseUrl）、`@deepseek-ai/dsh-tools`（register/tools/change）、`@deepseek-ai/dsh-scope`（ScopedLayers.effect）、`@deepseek-ai/dsh-app-boot`（pluginPackages.packageOf）、`@deepseek-ai/dsh-tool-cordis`（packageDir 消费范例）
