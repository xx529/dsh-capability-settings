# Jev 能力决策 · 实施架构与 API 契约

| 项 | 值 |
|---|---|
| 文档 ID | `docs/architecture/jev-capability-decision.md`（本文件） |
| 版本 | v1.3（空 plan = 关闭全部可应用能力；apply 批量/并发见 v1.2） |
| 日期 | 2026-10-24 |
| 作者 | architect2（task-14） |
| 上游依据 | `docs/specs/jev-auto-select.md` v1.3（WHAT/验收）、`docs/ux/jev-auto-select.md` v1.5（HOW-UI/文案）、`docs/research/jev-auto-select.md`（API 与仓库考古） |
| 下游任务 | task-15 backend、task-16 frontend、task-17 tester |
| 写作用域 | 仅 `docs/architecture/**`；本文不写 `src/**`、`docs/{ux,specs,figma}` |

---

## 0. 阅读方式与约束

1. **本文只定义 HOW（实现契约）**：存储、密钥边界、RPC、请求构造、事务、冷会话、时序与测试方案。
   用户可见文案/交互以 UX v1.5 为准，验收以 spec v1.3 为准，本文不重复抄写文案。
2. 证据标注：
   - `[源码]` = 本次实读仓库源码（范围见 §2.1，行号以当前工作树为准）；
   - `[研究]` = 引自 `docs/research/jev-auto-select.md` 的已核对结论；
   - `[架构决定]` = 规格/研究未覆盖、由本架构显式裁决的点（均给出理由与降级）；
   - `[未找到]` = 无法在允许范围内取证的点（给出降级，不猜测）。
3. **不读 `app.asar`**：宿主 agent 生命周期结论由 Lead 提供，并在仓库内有同款先例
   （`src/skills/session.ts` 用 `ctx.on("agent/created")` / `agent/disposed` +
   `ctx.get("agents").list()` 跟踪 agent，`agent.id === session.id`）[源码]。本文直接复用该结论。
4. 禁止：跑 `pnpm build` / `pnpm install`；改用户 `~/.dsh` profile；在本轮写 `src/**`。

### 0.1 版本口径提示（重要）

任务书提到「136 条验收」。本机 `docs/specs/jev-auto-select.md` 当前版本按唯一 ID 统计为
**144 条**（分组：CFG 24 / ENT 31 / REQ 10 / RES 10 / THR 11 / APP 13 / ERR 18 / SEC 8 /
A11Y 8 / NAR 6 / REG 5）。实现与验收**以仓库当前 spec 为准**；本文 §12 按分组映射，不逐条复制。

---

## 1. 结论摘要（TL;DR）

### 1.1 五个关键契约

| # | 契约 | 一句话结论 |
|---|---|---|
| 1 | **配置** | `resolveDshHome(override)` + `dsh-capability-settings/jev.json`；目录 `0700`/文件 `0600`；`readJsonDocument` 读、`withFileLock` 包读写、`atomicWriteText(..., {mode:0o600})` 写；非法/损坏读回默认，`setConfig` 校验失败返回 `{ok:false, code:"invalid-config", errors, issues}`。 |
| 2 | **密钥** | `getConfig` 只回 `hasApiKey/apiKeySource/apiKeyLast4`，无明文；key 解析优先级 **env（`apiKeyEnv`，默认 `TYPESAFE_API_KEY`）> 文件 `apiKey`**；`test`/`rank` 在**宿主进程** fetch；所有错误/日志经脱敏（隐去 Bearer/Authorization/key 原文）。 |
| 3 | **RPC** | 在 `PanelRpcService.jev` 增加 `getConfig/setConfig/test/rank/apply`，`handleEndpoint` 加 5 个 `case "jev.*"`；传输信封恒 `{ok:true,value}`，业务失败一律 `value:{ok:false,...}`（见 §5）。 |
| 4 | **rank** | 一次 `POST {baseURL}/v1/systemone`：`state={request,guidance}`（**能力不进 state**）；每能力一条 `noul` question，`instructions` 为**结构化对象**并内嵌 `capability{kind,name,description,whenToUse?,tools?}`（MCP 带工具清单，题目逐能力唯一）；共享判据只在 `state.guidance` 出现一次；`score=noul`；排序 desc → 技能先于 MCP → 名称；错误映射 9 码；429/529 最多重试 2 次（退避 500/1000ms），4xx 不重试；不发 long-context header；不分片（v1.1 请求形状变更，原因见 §6.0）。 |
| 5 | **apply** | 宿主按 `id` 重解析 → **筛选语义**（plan = 已勾选集合：选中启用、未选关闭，只改会话开关；**空 plan 合法 = 关闭本会话全部可应用能力**）→ 只留状态不一致项 → **enable→disable 两阶段批量写**（skills 同一 tick 全部发起 + `allSettled`，宿主注册表 effect 合并刷新；MCP 并发 4）→ 任一失败逆序批量回滚 → 返回 `applied/enabled/disabled/skipped/pending`（成功支 additive `elapsedMs`）；冷会话入队完整目标集合并用同一执行器重放（见 §7、§8，v1.2/v1.3）。 |

### 1.2 冷会话结论（最高风险项）

**可行，且不需要新增平台钩子。** 复用 `src/skills/session.ts` 已验证的模式：

- 判活：`ctx.get("agents").list()` 中存在 `agent.id === sessionId`（`agent.id === session.id`）；
- 无 live agent ⇒ `jev.apply` 不写、把**完整目标集合**（可应用能力的 `{id, desired}`，含关闭项）
  存入宿主内存 `Map<sessionId, PendingPlan>`，返回 `{ok:true, pending:true}`；
- `ctx.on("agent/created", ({agent}) => ...)` 命中 pending ⇒ **`setTimeout(0)` 延后**再应用
  （让 `mcp/loader` 等同类监听先完成登记）；重放**复用同一批量执行器**（重新枚举 + 等 skills 就绪 +
  两阶段批量写），失败短重试 2 次（100ms/300ms）；
- 插件启动时 `agents.list()` 里的存活会话天然判活，无需补登记 pending；
- `agent/disposed` 清理该 session 的 pending；插件 dispose 时移除监听并清空两张 Map。

失败降级：激活后应用失败 ⇒ 丢弃 pending、把 `JevPendingOutcome` 存入有界内存（≤32 条），
在下一次同 session 的 `jev.rank`/`jev.apply` 响应里以 `pendingOutcome?` 返回（读取即消费），
前端提示「已排队但启用失败，请重新评分或手动开启」；插件重载会丢失 pending（见 §8.5 降级）。

### 1.3 拆分与并行边界

| 角色 | 任务 | 写作用域 | 可否并行 |
|---|---|---|---|
| backend | task-15 | `src/jev/**`（新建）、`src/remote.ts`、`src/index.ts`、`src/shared/atomic-write.ts` | 与 frontend 并行（契约已冻结） |
| frontend | task-16 | `src/client/**`、`src/client.ts` | 与 backend 并行 |
| tester | task-17 | `notes/verify/**` | 阻塞于 task-15 + task-16 |
| Lead | — | `README.md`、`CHANGELOG.md`、`package.json`（如需）、`lib/**` 构建提交 | 收尾 |

**无文件重叠**（backend 不碰 `src/client/**`，frontend 不碰 `src/**` 其余部分）。
唯一软耦合：`src/client/api.ts` 的类型必须与本文件 §5 一致——契约已冻结，frontend 可立即开工。

### 1.4 必读风险清单（给实现者）

1. `agent/created` 时 `agent.ctx` 是否已能 `get("skills")`、MCP loader 是否已登记该 session
   —— **[未找到]** 宿主源码证据（本轮不允许读 asar）。降级：`setTimeout(0)` + 2 次短重试。
2. 冷会话技能行**不按 `canToggleInSession === false` 排除**（否则首屏主场景无法应用任何技能），
   与 UX 旧稿「会话未激活置灰」的冲突按 §8.6 处理。
3. `systemone` 响应结构未在本轮复核；解析必须容错（number / boolean / `{value}` / 缺失）。
4. 重试会让**物理** HTTP 请求 >1；`requestCount` 语义见 §6.8。

---

## 2. 事实基线

### 2.1 本次实读范围（限读纪律）

| 文件 | 实读范围 | 用途 |
|---|---|---|
| `src/remote.ts` | 40–200（`failure`、`PanelRpcService`、`handleEndpoint`） | RPC 信封与服务形状 |
| `src/index.ts` | 1–60、95–165 | 装配点、`Config`、`ctx.provide`、disposer |
| `src/shared/atomic-write.ts` | 全文（<60 行） | 需加 `mode` |
| `src/shared/file-lock.ts` | 1–50 | `withFileLock` 契约 |
| `src/skills/session.ts` | 55–200 | agent 生命周期先例、`canToggleInSession` |
| `src/mcp/manager.ts` | 140–240、`setSessionEnabled` ±40 | `mcp.list` / `mcp.runtime` / 写接口 |
| `src/mcp/loader.ts` | 690–740 | 会话开关落点与 `sessionToggleState` |
| `src/client/composer-capability.tsx` | 600–780 | 能力条、控制器、hero 结构 |
| `src/client/panel.tsx` | 50–205 | `DomainTab` / 搜索框 / Tab 渲染 |
| `docs/research/jev-auto-select.md` | §B1–B4（173–310 行） | 配置/密钥/RPC/能力枚举/草稿读取 |
| `docs/specs/jev-auto-select.md` | 仅 grep（分节与 AC ID） | 验收分组 |

另有 4 处**单行签名 grep**（`readJsonDocument`、`resolveDshHome` 引用、`dshHome` 装配、
`setSessionEnabled` 行号），不做整文件通读。

### 2.2 架构必须遵守的既有硬约束

| # | 约束 | 证据 |
|---|---|---|
| F1 | 传输层恒返回 `{ok:true, value}`；业务失败必须包成 `value:{ok:false, errors:string[]}`，否则宿主连接层 zod 判非法 | `src/remote.ts` 40–46 的 `failure()`；研究 §B2 |
| F2 | `handleEndpoint` 已统一从 payload 取 `cwd` / `sessionId`，未知 endpoint 与 handler 抛错都归一为业务失败 | `src/remote.ts:112-190`[研究行号] |
| F3 | 会话级开关是**内存态、不落盘**：skills 关闭 = agent scope 注册同名 shadow；MCP = `sessionToggles` Map + 按需重挂/restrict | `src/skills/session.ts:151-199`、`src/mcp/loader.ts:705-728`、`src/mcp/manager.ts:482-497` |
| F4 | `agent.id === session.id`；会话注册表可先从 `ctx.get("agents").list()` 补登记 | `src/skills/session.ts:101-118` |
| F5 | 配置读：ENOENT/空 → `undefined`，非法 JSON/顶层非对象 → 抛带文件名 Error；无 zod，校验手写 | `src/shared/json-config.ts:27-46`；研究 §B2 |
| F6 | 写串行化 `withFileLock(file, fn)` 只覆盖进程内；「读+改+写」整段包在锁里 | `src/shared/file-lock.ts:28-39`；研究 §B1 |
| F7 | `atomicWriteText(filePath, body, tmpPrefix)` = mkdir + 随机临时名 + `writeFile(tmp, body, "utf8")` + rename，**无 mode** | `src/shared/atomic-write.ts:25-30` |
| F8 | `resolveDshHome(override?)` 来自 `@deepseek-ai/dsh-home-paths`，仓库已用它把 `.dsh` 映射到 DSH_HOME / `~/.dsh` | `src/shared/config-location.ts:18,60-65`；`src/index.ts:49`[dshHome 覆盖] |
| F9 | 客户端不能读宿主 env；`mcp.list` 现有视图会把 `entry`（含 headers/env）原样下发，Jev 配置**不得**走这条通道 | 研究 §B2（`src/client/api.ts:191-223`） |
| F10 | 自绘 UI、无外部 CSS/组件库，样式集中在 `src/client/styles.ts`；客户端 bundle 只外置 react 系 | `AGENTS.md` 平台契约 |
| F11 | 宿主全局工具注册表可按 `ctx.get("tools").schemas()` 反推 MCP 工具名（`mcp__<serverName>__<tool>`）与描述，供 prompt 使用 | `src/index.ts:172-195`（v1.1 新增，`mcpTools`） |

### 2.3 术语

| 术语 | 含义 |
|---|---|
| **评分集合** | `jev.rank` 交给模型的全部能力（可枚举全集，含「不可应用」项，用 `applicable=false` 表达） |
| **应用集合** | 评分集合中真正允许写入会话开关的子集（§7.3 排除规则） |
| **可应用（applicable）** | 能力**本身**允许被启用（非硬关闭、可 restrict、非遮蔽、非占位），**与 session 是否 live 无关**（冷会话走排队，§8） |
| **pending** | 冷会话下计划已接受但尚未写入，返回 `pending:true` |
| **enabledInSession** | 会话视图里的启用态；MCP 未显式覆盖时 = `!disabledInProject` |

## 3. 配置契约

### 3.1 路径解析

```ts
// src/jev/paths.ts（新建）
import { join } from "node:path";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";

export const JEV_DIR_NAME = "capability-panel";
export const JEV_FILE_NAME = "jev.json";

/** 配置目录：<dshHome>/dsh-capability-settings（DSH_HOME 优先由 resolveDshHome 保证）。 */
export function jevConfigDir(dshHome?: string): string {
  return join(resolveDshHome(dshHome), JEV_DIR_NAME);
}
/** 配置文件：<dshHome>/dsh-capability-settings/jev.json。 */
export function jevConfigFile(dshHome?: string): string {
  return join(jevConfigDir(dshHome), JEV_FILE_NAME);
}
```

- **DSH_HOME 优先**：`resolveDshHome(override?)` 的解析顺序（显式 override → `DSH_HOME` →
  `~/.dsh`）由 `@deepseek-ai/dsh-home-paths` 包实现，仓库已用它把 `.dsh` 映射到该根
  （`src/shared/config-location.ts:18,60-65`）[源码]。本模块**不重复实现** env 解析，
  插件 `Config.dshHome` 覆盖经 `src/index.ts:49` 透传。
- 目录带插件名，便于将来放同域其它文件；**不使用** `<agentsHome>/jev.json`（研究 §B1 的初版建议）。
  偏离理由 `[架构决定]`：Lead/UX v1.4 已裁决路径为 `~/.dsh/dsh-capability-settings/jev.json`；
  与可读写的 agents home 分开，避免旧位置（`~/.claude` 等只读兼容根）干扰与密钥扩散。
- **无历史迁移**：`~/.agents/jev.json` 从未上线，不做读取兼容（`[未找到]` 旧文件，按不存在处理）。

### 3.2 权限（POSIX）

| 对象 | 目标模式 | 实现 |
|---|---|---|
| 目录 `<dshHome>/dsh-capability-settings/` | `0o700` | `mkdir(dir, { recursive: true, mode: 0o700 })` + `chmod(dir, 0o700)` 兜底（已存在目录的 mode 不会被 mkdir 改写） |
| 文件 `jev.json` | `0o600` | `atomicWriteText(file, body, "jev", { mode: 0o600 })`（写临时文件时带 mode，rename 保留） |

- `chmod` 失败（Windows / 只读 FS）**不阻断保存**：记录 `logger.warn`，保存仍成功；视图无需暴露。
  `[架构决定]` Windows 上 `mode` 语义不生效，属平台差异，不追求等价。
- 目录 `chmod` 只在**写入路径**执行（`getConfig` 不改权限，避免只读场景报错）。

### 3.3 读写封装（`src/jev/config-file.ts`）

读取：`readJsonDocument(jevConfigFile(dshHome), "Jev config")`（`src/shared/json-config.ts:27`）[源码]。

- ENOENT / 空文件 → 返回默认值（不创建文件）；
- 非法 JSON / 顶层非对象 → **捕获后回默认值 + `logger.warn`**（`[架构决定]`：配置损坏不能把整个面板打挂；
  spec 要求「读取兼容缺失/损坏并回默认」）；文件保持原样，用户下次保存即修复。

写入（`setConfig` 的唯一入口）：

```ts
async function saveJevConfig(dshHome: string | undefined, next: JevConfig): Promise<void> {
  const file = jevConfigFile(dshHome);
  const dir = jevConfigDir(dshHome);
  await withFileLock(file, async () => {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700).catch(() => undefined);          // 兜底，失败不阻断
    const body = JSON.stringify(next, null, 2) + "\n";        // 稳定格式，便于 diff
    await atomicWriteText(file, body, "jev", { mode: 0o600 }); // 见 3.4 的签名扩展
  });
}
```

**`atomicWriteText` 扩展（向后兼容，唯一一处共享工具改动）**：

```ts
// src/shared/atomic-write.ts
export interface AtomicWriteOptions { mode?: number }              // 新增，可选
export async function atomicWriteText(
  filePath: string,
  body: string,
  tmpPrefix: string,
  options?: AtomicWriteOptions,                                    // 新增第 4 参
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmp = join(dirname(filePath), `.${tmpPrefix}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`);
  const writeOptions = options?.mode === undefined
    ? "utf8" as const
    : { encoding: "utf8" as const, mode: options.mode };
  await writeFile(tmp, body, writeOptions);
  await rename(tmp, filePath);
}
```

- **默认行为完全不变**：mcp / skills / overrides 三域的现有三参调用无需改动，产物 mode 仍由 umask 决定；
- 只影响显式传 `options.mode` 的调用方（当前仅 Jev）；
- 不在 rename 后补 `chmod`（`mode` 已覆盖主路径；节省一次 syscall）。

### 3.4 JSON 类型与默认值（`src/jev/types.ts`）

```ts
export interface JevAutoTrigger {
  enabled: boolean;      // 自动触发总开关，默认 false（默认关闭，UX/v1.4 裁决）
  pauseMs: number;       // 停顿阈值 300–3000，步长 100，默认 1000
  minChars: number;      // 最少触发字数 1–200，默认 10
  minEditChars: number;  // 最少修改间隔字符数 1–100，默认 4
}

export interface JevConfig {
  baseURL: string;       // 根地址，不含 /v1/systemone；默认 https://api.typesafe.ai
  model: string;         // 默认 jev-latest
  apiKey?: string;       // 直接填写；落盘，文件 0600
  apiKeyEnv?: string;    // 默认 TYPESAFE_API_KEY；env 优先于文件
  autoTrigger: JevAutoTrigger;
  timeoutMs: number;     // 单次 HTTP 尝试超时，默认 30000（范围见 3.5）
}

export function defaultJevConfig(): JevConfig {
  return {
    baseURL: "https://api.typesafe.ai",
    model: "jev-latest",
    apiKeyEnv: "TYPESAFE_API_KEY",
    autoTrigger: { enabled: false, pauseMs: 1000, minChars: 10, minEditChars: 4 },
    timeoutMs: 30000,
  };
}
```

落盘文件名/结构：**单个 JSON 对象**，字段全可选（缺省即默认值），未知字段忽略且不回写。
不引入 `schemaVersion`（`[架构决定]`：单版本、字段可加；未来需要迁移时再加，避免现在猜格式）。

### 3.5 校验规则与错误码（`validateJevConfig`）

| 字段 | 规则 | 违规错误码 |
|---|---|---|
| `baseURL` | trim；去尾部 `/`；可被 `new URL()` 解析；scheme 必须 `https:`，**例外**：hostname ∈ `localhost` / `127.0.0.1` / `::1` / `[::1]` 允许 `http:`；pathname 不得以 `/v1/systemone` 结尾（避免与「根地址 + 代码拼 endpoint」两种约定混用）；长度 ≤ 2048 | `E_BASE_URL_FORMAT` / `E_BASE_URL_SCHEME` / `E_BASE_URL_HAS_ENDPOINT` |
| `model` | trim 后非空；≤128 字符；无控制字符/换行 | `E_MODEL` |
| `apiKey` | 可选；非空时 trim；≤512 字符；不含空白/换行 | `E_API_KEY` |
| `apiKeyEnv` | 可选；空串/缺省 → `TYPESAFE_API_KEY`；必须匹配 `^[A-Za-z_][A-Za-z0-9_]{0,63}$` | `E_API_KEY_ENV` |
| `autoTrigger.enabled` | boolean（非 boolean → 取默认并报） | `E_AUTO_ENABLED` |
| `autoTrigger.pauseMs` | 整数，300 ≤ x ≤ 3000，且 `x % 100 === 0` | `E_PAUSE_MS` |
| `autoTrigger.minChars` | 整数，1 ≤ x ≤ 200 | `E_MIN_CHARS` |
| `autoTrigger.minEditChars` | 整数，1 ≤ x ≤ 100 | `E_MIN_EDIT_CHARS` |
| `timeoutMs` | 整数，1000 ≤ x ≤ 120000 | `E_TIMEOUT_MS` |
| 顶层未知字段 | 忽略（不报错、不落盘） | — |

`timeoutMs` 的 1000–120000 范围 `[架构决定]`：spec/UX 未定义范围；下限防止把请求压成必超时，
上限防止 RPC 挂死（宿主 HTTP 层没有更细粒度预算）。

校验结果类型：

```ts
export interface JevConfigIssue { field: string; code: string; message: string } // message 为中文可读文案
export type JevConfigValidation =
  | { ok: true; value: JevConfig }
  | { ok: false; issues: JevConfigIssue[]; errors: string[] };  // errors = issues 的 "[CODE] field: message" 展平
```

- **越界拒绝保存**：`jev.setConfig` 返回 `value:{ok:false, code:"invalid-config", errors, issues}`，
  不落盘、不改内存态；**不做静默夹取/四舍五入**（`[架构决定]`：静默修正会让 UI 与文件不一致）。
- `errors` 保持 `string[]`（与既有 `failure()` / 客户端 `unwrap()` 的 `errors.join("; ")` 兼容），
  结构化明细放可选的 `issues`（additive 字段）。

### 3.6 `setConfig` 语义

1. payload `{ config: JevConfigInput }`（字段均可选）；
2. 在 `withFileLock` 内：读当前有效配置（损坏则默认）→ `{...current, ...provided}`；
   `autoTrigger` 若提供则**要求整对象**（不做部分合并，避免歧义）；
3. 校验 → 失败即返回，不写；
4. 写入规范化后的完整对象（`apiKey` 为空串时**删除该字段**，表示「不用文件 key」）；
5. 成功后**不回读、不回传密钥**；`getConfig` 由下一次调用重新计算视图。

并发的两个保存请求由 `withFileLock` 串行化（F6）；读-改-写整段在锁内，避免丢更新。

### 3.7 生效时机

| 配置项 | 生效时机 |
|---|---|
| `baseURL` / `model` / `apiKey` / `apiKeyEnv` / `timeoutMs` | 下一次 `jev.test` / `jev.rank` 立即生效（**不缓存 HTTP client**，每次读配置） |
| `autoTrigger.*` | 前端保存成功后立即写入本地调度状态（无需重载页面 / 重启插件） |
| 文件被手动编辑 | 宿主下一次读取生效；前端在打开配置 Tab 或保存后刷新 `getConfig` |

`[架构决定]`：不监听文件变化（无 `fs.watch`），避免多点变更竞态；代价是外部编辑需要重新打开 Tab。

---

## 4. 密钥边界

### 4.1 解析优先级（仅宿主内使用）

```ts
export type JevKeySource = "env" | "file" | "none";
export interface ResolvedJevKey { value?: string; source: JevKeySource; last4: string | null }

export function resolveJevKey(config: JevConfig, env: NodeJS.ProcessEnv): ResolvedJevKey {
  const envName = config.apiKeyEnv && config.apiKeyEnv.length > 0 ? config.apiKeyEnv : "TYPESAFE_API_KEY";
  const fromEnv = env[envName];
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return { value: fromEnv.trim(), source: "env", last4: maskLast4(fromEnv.trim()) };   // env 优先
  }
  if (typeof config.apiKey === "string" && config.apiKey.trim().length > 0) {
    return { value: config.apiKey.trim(), source: "file", last4: maskLast4(config.apiKey.trim()) };
  }
  return { source: "none", last4: null };
}

/** 末 4 位仅对足够长的 key 展示；短 key 一律 ****，防「已知短 key 即全泄露」。 */
function maskLast4(key: string): string {
  return key.length >= 8 ? key.slice(-4) : "****";
}
```

- env 优先于文件（`[架构决定]`：便于 CI / 共享环境用 env 覆盖个人文件，且让「文件里有过期 key」不能压过 env）；
- 环境变量名默认 `TYPESAFE_API_KEY`，用户可在配置 Tab 改 `apiKeyEnv`；
- 解析只在宿主进程发生；**客户端永远拿不到 `value`**。

### 4.2 `jev.getConfig` 视图（`JevConfigView`）

```ts
export interface JevConfigView {
  baseURL: string;
  model: string;
  hasApiKey: boolean;
  apiKeySource: "env" | "file" | "none";
  apiKeyLast4: string | null;
  autoTrigger: JevAutoTrigger;
  timeoutMs: number;
}
```

- **无 `apiKey` / 无 `apiKeyEnv` 明文下发**；`hasApiKey = source !== "none"`；
- `apiKeyLast4` 为 `null`（无 key）或 4 位/`"****"`（短 key）；
- 不提供任何 `getApiKey` 端点；不提供「回显 key」能力（替换 key 只能整串重填）。

### 4.3 网络请求只在宿主

- `jev.test` / `jev.rank` 由宿主 `fetch` 发出（Node 18+ 全局 `fetch`，Node 22.x 运行时已有）；
- 客户端只发 RPC（`/capability-panel`），**bundle 里不出现任何读取 `process.env` 的代码**；
- 客户端出现 `TYPESAFE_API_KEY` 字面量仅限于「默认变量名」文案，不得据此读 env。

### 4.4 错误脱敏（强制）

所有面向 RPC 的 `errors`、以及所有 `logger.warn/error` 输出，必须经同一个脱敏器：

```ts
export function redact(text: string, secrets: string[]): string
```

规则（顺序执行）：

1. 逐个把 `secrets` 中的非空字符串替换为 `"***"`（secrets = 解析出的 key + 配置里的 `apiKey` + `process.env[apiKeyEnv]`）；
2. `/Bearer\s+[A-Za-z0-9._~+/=-]+/gi` → `Bearer ***`；
3. `/(authorization|api[-_]?key|x-api-key)\s*[:=]\s*\S+/gi` → `$1: ***`；
4. 兜底 `/\bsk-[A-Za-z0-9._-]{8,}/g` → `sk-***`；
5. **永不把请求头对象、完整 URL query 放进错误信息**（URL 只保留 origin + pathname）；
6. 响应体最多取 4096 字符做诊断，脱敏后再截断到 300 字符进入 `errors`。

> 约束来源：`handleEndpoint` 的 `catch` 会把 `error.message` 原样回浏览器（`src/remote.ts:184-186`[研究]），
> 所以脱敏必须在 **jev manager/rank 内部**完成，不能依赖 RPC 层。

辅助约定（伪代码里出现的 `redactSafe` / `errMessage`）：

```ts
const knownSecrets = () => [resolveJevKey(await readConfig(), process.env).value, (await readConfig())?.apiKey]
  .filter((v): v is string => typeof v === "string" && v.length > 0);
const redactSafe = (text: string) => redact(text, knownSecrets());
const errMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
```

（实现时 `knownSecrets` 读取一次并在单次请求内复用，避免每条错误重复读盘。）

### 4.5 测试环境如何指向假端点

- 允许 `http://127.0.0.1:<随机端口>` 与 `http://localhost:<端口>`（§3.5 的 loopback 例外）；
- tester 的假服务监听 `127.0.0.1`、端口 `0`（随机），把实际端口写进 `DSH_HOME` 下的
  `jev.json` 后走真实 `jev.rank` 路径；
- 不在宿主编译期/运行期引入 `NODE_ENV === "test"` 之类的分支（`[架构决定]`：测试端点是配置，
  不是代码分支；避免测试专用代码进生产）。

---

## 5. RPC 契约

### 5.1 服务形状与路由（`src/remote.ts`）

```ts
export interface PanelRpcService {
  // ...既有 skills / mcp / overrides 不变
  jev: {
    getConfig(): Promise<unknown>;
    setConfig(input: unknown): Promise<unknown>;
    test(signal?: AbortSignal): Promise<unknown>;
    rank(input: unknown, signal?: AbortSignal): Promise<unknown>;
    apply(input: unknown): Promise<unknown>;
  };
}
```

`handleEndpoint` 新增（放在 `overrides.*` 之后、`default` 之前）：

```ts
case "jev.getConfig":
  return { ok: true, value: await service.jev.getConfig() };
case "jev.setConfig":
  return { ok: true, value: await service.jev.setConfig(p) };
case "jev.test":
  return { ok: true, value: await service.jev.test(_signal) };
case "jev.rank":
  return { ok: true, value: await service.jev.rank(p, _signal) };
case "jev.apply":
  return { ok: true, value: await service.jev.apply(p) };
```

- 全部走**业务失败信封**（F1）：`{ok:true, value:{ok:false, ...}}`；`handleEndpoint` 的 `catch`
  仍兜底未知异常（同样会脱敏，因为异常从 rank/manager 内部已包装）。
- `cwd` / `sessionId` 已由 `handleEndpoint` 从 payload 解析（`src/remote.ts:117-121`[研究]）；
  `jev.rank`/`jev.apply` 仍传**整个 payload** `p` 给 service，由 service 重新校验类型（与 mcp 一致）。
- `_signal` 透传用于「取消评分」：客户端 `rpc.call(..., signal)` 断开 → 宿主 `fetch` abort。
- **宿主服务（非 RPC）新增可选依赖** `CapabilityPanelService.mcpTools?(serverName)`：由组合根注入
  （`src/index.ts:172-195`，`ctx.get("tools").schemas()` 按 `mcp__<serverName>__` 前缀反推 name/description），
  只给 `rank` 的 question 提供 MCP 工具清单。**它不进 `PanelRpcService`、不跨 RPC**；缺失/抛错/空
  静默降级为 `[]`（能力照常评分，只是不带 `tools`）。
- **返回形状不变**：本次 v1.1 只改 rank 的**请求构造内部形状**（§5.7、§6），
  `jev.rank` / `jev.apply` 的入参与返回类型（§5.2）保持 v1.0 契约。

### 5.2 类型全集（宿主 `src/jev/types.ts`；客户端 `src/client/api.ts` 镜像同名类型）

```ts
export type JevErrorCode =
  | "no-config" | "auth" | "rate-limit" | "overloaded" | "timeout"
  | "context-too-long" | "network" | "bad-request" | "empty-capabilities";

export type JevSetConfigErrorCode = "invalid-config" | "write-failed";
export type JevApplyErrorCode = "bad-request" | "write-failed";

export interface JevUsage { input_tokens: number; output_tokens: number }

/* —— 入参类型（宿主与客户端共用语义；客户端由 adapter 补 sessionId/cwd） —— */
export type JevConfigInput = Partial<Omit<JevConfig, "autoTrigger">> & { autoTrigger?: JevAutoTrigger };
export interface JevSetConfigInput { config: JevConfigInput }
export interface JevRankInput { cwd?: string; sessionId: string; draft: string }
export interface JevApplyInput { cwd?: string; sessionId: string; plan: JevApplyPlanItem[] }

export interface JevConfigView {
  baseURL: string;
  model: string;
  hasApiKey: boolean;
  apiKeySource: "env" | "file" | "none";
  apiKeyLast4: string | null;
  autoTrigger: JevAutoTrigger;
  timeoutMs: number;
}

export type JevSetConfigResult =
  | { ok: true }
  | { ok: false; code: JevSetConfigErrorCode; errors: string[]; issues?: JevConfigIssue[] };

export type JevTestResult =
  | { ok: true; model: string; latencyMs: number }
  | { ok: false; code: JevErrorCode; errors: string[] };

export interface JevRankItem {
  id: string;                      // cap_<36 位小写 hex>
  kind: "skill" | "mcp";
  name: string;
  description: string;             // 已截断 200 码点
  score: number;                   // 0..1，noul；无答案记 0
  applicable: boolean;             // 能力本身可启用（与 session 活性无关，见 §7.3）
  reason?: string;                 // applicable=false 时：hard-disabled|not-restrictable|not-toggleable|shadowed|no-answer
  enabledInSession: boolean;       // 当前会话启用态（前端勾选初值/回显）
}

export type JevRankResult =
  | {
      ok: true;
      items: JevRankItem[];
      model: string;
      usage: JevUsage;
      elapsedMs: number;
      requestCount: 1;             // 逻辑批量请求数（重试不累加，见 §6.8）
      capabilitiesTotal: number;
      pendingOutcome?: JevPendingOutcome;  // 冷会话排队结果回执（§8.5，additive）
    }
  | { ok: false; code: JevErrorCode; errors: string[] };

export type JevApplySkipReason =
  | "unknown-id" | "hard-disabled" | "not-restrictable" | "not-toggleable" | "shadowed" | "already-applied";

export interface JevApplyPlanItem {
  id: string;
  kind: "skill" | "mcp";
  name: string;                    // 仅用于诊断/日志；宿主按 id 重解析，不信任
  target?: string;                 // 同上；MCP 项目条目=config key，服务/外部=serverName
  enabled: true;                   // 客户端只提交**勾选项**；宿主把 plan 当「选中集合」= 目标真值
                                   // （v1.2 筛选语义：未勾选的可应用能力会被**关闭**，见 §7.2）
                                   // 空数组 [] 合法（v1.3）：目标集合为空 = 关闭全部可应用能力
}

export interface JevApplySkipped { id: string; reason: JevApplySkipReason }
export interface JevApplyFailed { id: string; reason: string }

export type JevApplyResult =
  | {
      ok: true;
      applied: number;             // 实际写入条数 = enabled + disabled（回滚=0）
      enabled: number;             // v1.2 additive：本次实际启用数（勾选且原关闭）
      disabled: number;            // v1.2 additive：本次实际关闭数（可应用但未勾选、原开启）
      skipped: JevApplySkipped[];
      pending: boolean;            // true = 冷会话排队，尚未写入（此时 applied/enabled/disabled 均 0）
      failed?: JevApplyFailed[];
      errors?: string[];           // additive：回滚细节/诊断（脱敏）
      elapsedMs?: number;          // v1.2 additive（task-47）：成功支 = 枚举+批量写入总耗时(ms)
      pendingOutcome?: JevPendingOutcome;
    }
  | { ok: false; code: JevApplyErrorCode; errors: string[] };

export interface JevPendingOutcome {
  applied: number;               // 激活后实际写入条数（筛选语义下 = 启用数 + 关闭数）
  failed: number;
  errors: string[];
  at: number;                    // epoch ms
}

/* 便于实现/前端引用的收窄别名 */
export type JevRankSuccess = Extract<JevRankResult, { ok: true }>;
export type JevApplySuccess = Extract<JevApplyResult, { ok: true }>;
```

### 5.3 端点语义表

| endpoint | payload | 成功 | 业务失败 |
|---|---|---|---|
| `jev.getConfig` | `{}`（忽略） | `JevConfigView` | 无（读失败回默认） |
| `jev.setConfig` | `{config: JevConfigInput}` | `{ok:true}` | `{ok:false, code:"invalid-config"\|"write-failed", errors, issues?}` |
| `jev.test` | `{}`（忽略） | `{ok:true, model, latencyMs}` | `{ok:false, code:JevErrorCode, errors}` |
| `jev.rank` | `{cwd?, sessionId, draft}` | `JevRankResult` 成功支 | 同左失败支 |
| `jev.apply` | `{cwd?, sessionId, plan: JevApplyPlanItem[]}` | `JevApplyResult` 成功支 | `{ok:false, code, errors}` |

`jev.test` 的探针请求 `[架构决定]`（spec 只要求「成功显示实际模型与耗时」）：

```ts
// 最小成本探针：1 条能力 + 1 条 noul，验证 地址/密钥/模型/可解析性
// v1.1 起与新请求形状一致：能力定义在 question 内，state 只放 request + guidance。
const probeId = capabilityId("probe:connectivity");
state = { request: "Connectivity check.", guidance: SYSTEM_ONE_GUIDANCE };
questions = {
  [probeId]: {
    type: "noul",
    instructions: {
      task: "Is this a connectivity check?",
      capability: { kind: "skill", name: "connectivity-probe", description: "Connectivity probe." },
    },
    criteria: { true: "Yes, this is a connectivity check.", false: "No." },
  },
};
```

- 成功判定：HTTP 2xx 且 `answers[probeId].noul` 可解析为数（或 boolean）；
- `model` 取响应 `model` 字段，缺省回退配置 `model`；`latencyMs` 取**首次**尝试的耗时（不含重试等待）；
- 成本约几十 token，可忽略；探针 id 与真实能力 id 不冲突（hash namespace 不同）。
- 不发送 long-context header；该端点同样受 §6.9 的错误映射与重试策略约束（429/529 重试）。

### 5.4 RPC 级错误码（人读对照；前端按码映射 UX 文案）

| code | 触发 | 前端处理（UX v1.5） |
|---|---|---|
| `no-config` | 无可用 key（`source:"none"`） | 引导到「Jev 模型」Tab，按钮不禁用 |
| `auth` | 401/403 | 「鉴权失败，请检查 API Key」+ 去配置 |
| `rate-limit` | 429（重试耗尽） | 「请求过多，请稍后重试」 |
| `overloaded` | 529（重试耗尽） | 「服务繁忙，请稍后重试」 |
| `timeout` | 尝试超时 / 客户端取消 | 「请求超时，可重试」 |
| `context-too-long` | 400 `max_tokens_exceeded` / 上下文超限 | 「内容过长」态，提示精简草稿，不自动分片 |
| `network` | DNS/连接失败/5xx 非 529 | 「网络错误，请检查 Base URL」 |
| `bad-request` | 400(其它)/404/405/415/422、入参非法 | 「请求参数有误」+ 诊断 |
| `empty-capabilities` | 会话内无可评分能力 | 「当前会话没有可评分的能力」空态 |
| `invalid-config` | 保存校验失败 | 字段级错误提示 |
| `write-failed` | 保存/应用写盘失败 | 「保存失败」/「应用失败，已回滚」 |

### 5.5 为什么 `rank` / `apply` 由宿主枚举能力（而不是客户端传）

1. **权威状态只在宿主内存**：skills 的 shadow 表（`src/skills/session.ts:151-199`）与
   MCP 的 `sessionToggles`（`src/mcp/loader.ts:705-728`）都是宿主内存态，客户端拿到的
   `enabledInSession` 只是上一次快照，不能作为评分/应用的权威输入。
2. **`canToggle` 依赖 live agent**：`canToggleInSession` 由宿主 `agents.list()` 决定
   （`src/skills/session.ts:132-149`）；客户端无法判断冷/热会话。
3. **外部注入 MCP 只能在宿主发现**：`mcp.runtime` 的 `restrictable` 依赖宿主工具注册表
   （`src/mcp/manager.ts:409-469`[研究]），客户端不可枚举。
4. **一致性（TOCTOU）**：一次 RPC 内完成「枚举 → 评分 → 返回」，`apply` 再按 id 重解析，
   避免客户端传来的能力集合与宿主当前状态错位（例如用户在另一个标签页改了开关）。
5. **id 必须由宿主生成**：`apply` 只接受 `cap_<hash>`，宿主用同一算法重建映射，
   客户端伪造 `target`/`name` 不生效（见 §7.4）。
6. **减少往返**：否则一次评分需要 3 次 RPC（skills/mcp/runtime）+ 1 次评分，且三次快照可能不一致。

### 5.6 取消与超时

- `rank` / `test` 接受可选 `AbortSignal`（来自 `handleEndpoint` 的 `_signal`）；abort 时
  `fetch` 抛 `AbortError`：**若客户端已断开，结果不再有意义**（前端按 `runId` 丢弃晚到响应），
  宿主侧归一为 `timeout` 业务失败即可（不重试）。
- `timeoutMs` 是**单次尝试**预算（`AbortSignal.timeout` 或 `AbortController` + `setTimeout`）；
  重试预算见 §6.9。

### 5.7 宿主内部请求类型（`SystemOneRequest`，不跨 RPC）

`src/jev/rank.ts:82-116` 定义、`buildSystemOneRequest()` 构造；只存在于宿主进程，不出现在
RPC 返回里。列出以便 backend/tester 按同一形状实现与断言：

```ts
interface SystemOneTool { name: string; description?: string }

interface SystemOneCapability {
  kind: "skill" | "mcp";
  name: string;                  // ≤120 码点
  description: string;           // ≤200 码点
  whenToUse?: string;            // ≤120 码点，仅 skill 且有值
  tools?: SystemOneTool[];       // 仅 MCP，≤8 个（§6.3 截断规则）
}

interface SystemOneInstructions {
  task: string;                  // 逐题相同（§6.5）
  capability: SystemOneCapability;
  rules?: string[];              // 可选，当前未使用
}

interface SystemOneQuestion {
  type: "noul";
  instructions: SystemOneInstructions;   // v1.1：结构化对象，不再是无能力信息的字符串
  criteria: { true: string; false: string };
}

interface SystemOneRequest {
  model: string;
  state: { request: string; guidance: string };   // 能力不进 state
  questions: Record<string, SystemOneQuestion>;   // key = cap_<36hex>
}
```

---

## 6. `jev.rank` 请求与解析

### 6.0 v1.1 变更：能力进 question、共享判据进 state（根因与影响）

**根因（实测）**：v1.0 把能力数组放在 `state.capabilities`，而 `questions` 里 155 道题
共用**完全相同**的字符串 `instructions`（只问「能力是否相关」，题目里没有能力定义）。
关键点：`questions` 的 **key（能力 id）不会作为文本发给模型**——模型只读到
`instructions`/`criteria` 的内容，所以 155 道题在模型眼里**字面完全相同**，无法区分
「这一题在问哪个能力」，只能对所有能力给出几乎相同的概率——实测分数塌缩到
**0.40–0.41**，排序失去意义、阈值勾选失效。

**修复（backend 已落地，`src/jev/rank.ts:1-130,199-230`）**：

1. `state` 只保留 `{ request, guidance }`：用户请求一次 + 共享判据一次（控 token）；
2. 每道题的 `instructions` 改为**结构化对象** `{ task, capability{kind,name,description,whenToUse?,tools?} }`，
   内嵌该能力定义 ⇒ 题目逐能力唯一，模型能判断「这一题问的是哪个能力」；
3. MCP 能力额外携带**工具清单**（配置条目走 `service.mcpTools`，外部实例走 `view.tools`）⇒ 模型能判断
   server **实际能做什么**，而不是只看名字/summary；
4. 共享判据（英文）只在 `state.guidance` 出现一次，`criteria.true/false` 仍逐题相同。

**影响面**：

| 对象 | 影响 |
|---|---|
| RPC 契约（§5.2） | **不变**：`jev.rank` 入参/返回类型、错误码、`requestCount` 语义都不变，客户端零改动 |
| `jev.test`（§5.3） | 探针请求同步为新形状（能力进 question，state={request,guidance}） |
| token 量级 | 见下方「体积与上下文预算」；能力定义从 `state` 移到各题，总量级相近；`guidance` 只出现一次，不重复 155 份判据 |
| 测试（§10） | 假端点与断言必须按新形状（`state.request`、`instructions.capability`）；v1.0 请求形状（能力进 state）的断言删除 |
| 文档 | 旧请求形状只在本节作为根因说明保留；§6.2/§6.3/§6.5 与测试章节已按新形状重写 |

**体积与上下文预算（backend 实测估算，v1.1）**：

| 场景 | 请求体 | 估算 tokens | 结论 |
|---|---|---|---|
| 152 条能力（当前常见规模） | ≈108 KB | ≈27–31k | < 64k 上下文，安全 |
| 最坏 155 条 | ≈137 KB | ≈34–39k | < 64k，仍单请求 |

- 仍**不分片**；若服务端仍判超上下文（400 `max_tokens_exceeded`）→ 按 §6.9 映射
  `context-too-long`，**不自动缩减能力重试**；
- 估算按 JSON 混合文本 ~4 字符/token 粗算，仅用于容量判断，不作为计费依据；
- `state.guidance` 全篇只出现一次（约 0.5 KB），不随能力数线性增长。

### 6.1 前置校验（不发请求的情况）

| 条件 | 结果 |
|---|---|
| `sessionId` 缺失/空 | `{ok:false, code:"bad-request", errors:["sessionId is required"]}` |
| `draft` 非 string / trim 后为空 | `bad-request`（前端另有门槛，宿主仍校验） |
| `draft` 码点 > 8000 | `bad-request`，`errors` 提示「草稿过长（>8000 字符）」`[架构决定]`（防御，避免巨大请求） |
| 解析不到 key（`source:"none"`） | `no-config` |
| 评分集合为空 | `empty-capabilities`（不请求） |
| 评分集合 > 300 条 | `bad-request`，提示先关闭部分能力 `[架构决定]`（防御上限） |

### 6.2 请求

```
POST {baseURL}/v1/systemone
Content-Type: application/json
Accept: application/json
Authorization: Bearer <resolvedKey>
```

请求体（v1.1 形状，类型 `SystemOneRequest`，实现 `src/jev/rank.ts:113-230`）：

```jsonc
{
  "model": "jev-latest",
  "state": {
    "request": "<原始草稿（已 trim，未截断）>",
    "guidance": "<共享判据，英文，整段只出现一次，见 §6.5>"
  },
  "questions": {
    "cap_<36hex>": {
      "type": "noul",
      "instructions": {
        "task": "<英文：判断该能力对请求是否直接有用>",
        "capability": {
          "kind": "skill" | "mcp" | "tool",
          "name": "<≤120 码点>",
          "description": "<≤200 码点；descriptors.ts 生成并脱敏>",
          "whenToUse": "<≤120 码点，仅 skill 且有值>",
          "tools": [ { "name": "<≤80 码点>", "description": "<≤120 码点，可省>" } ],  // MCP / tool，≤8 条
          "moreTools": [ "<工具名，≤80 码点>" ]  // MCP / tool，≤24 个仅名称（v1.3）
        }
      },
      "criteria": { "true": "<英文>", "false": "<英文>" }
    }
  }
}
```

- **`state` 只有 `request` + `guidance`，没有能力数组**；能力定义在**每题的 `instructions.capability`** 里
  （v1.1 核心变更，根因与影响见 §6.0）；
- **questions 的 key 与评分集合的 id 一一对应**，数量恒等（tester 断言）；
- `instructions` 是**结构化对象**（`task` + `capability`[+ 可选 `rules?`]），**不是字符串**；
- `baseURL` 规范化后拼接：`new URL(baseURL.replace(/\/+$/, "") + "/v1/systemone")`；
- 不发送任何 long-context / 实验性 header；不分片（一次请求就是全部能力）；
- 请求体不包含 `cwd`、`sessionId`、能力文件路径等本地信息（隐私最小化）。

### 6.3 能力定义进 question（含 MCP 工具）与截断

能力元数据不再进 `state`，而是逐题内嵌到 `instructions.capability`（`SystemOneCapability`）：

| 能力种类 | `kind` | `name` | `description` | `whenToUse` | `tools` / `moreTools` |
|---|---|---|---|---|---|
| skill（`skills.sessionList`） | `"skill"` | `row.name`（≤120） | `row.description \|\| "（无描述）"`（≤200） | `row.whenToUse`（≤120，空则不带） | 不带 |
| MCP 配置条目（`mcp.list`） | `"mcp"` | `row.serverName`（≤120） | `describeMcpServer()`：作者 `entry.description` > 从 `command/args/url` 推导（host / 包名 / 脚本名 / 命令名）> 最小兜底（≤200） | 不带 | `tools`（≤8 带描述）+ `moreTools`（≤24 仅名称），见下 |
| 外部注入实例（`mcp.runtime`） | `"mcp"` | `view.serverName`（≤120） | `describeExternalMcp()`：`view.summary` 结构化推导 > `由 <channel> 注入的 MCP 实例`（≤200） | 不带 | `view.tools` |
| Tools 插件单元（`tools.list`） | `"tool"` | `unit.name`（≤120） | `unit.description`（`package.json.description`）> `"N 个工具 · 插件注入"`（≤200） | 不带 | `unit.tools`（同上打包） |

> **v1.3 描述层**：`description` 不再直接拼原始命令行 / 固定占位文案，改由
> `src/jev/descriptors.ts` 统一生成；所有文本（含工具描述）在进请求体前还会做一次
> `sanitizeDescriptorText()` 凭据掩码（`--header` / `--api-key` / Bearer / Basic /
> `KEY=value` / URL query / 常见 token 前缀）。MCP 配置新增可选 `description`
> 扩展字段（编辑弹窗「用途描述」）作为最高优先级来源。

**MCP 工具来源（v1.1 新增；只用于 prompt，不跨 RPC 下发）**：

| 来源 | 取法 | 失败降级 |
|---|---|---|
| 配置条目（项目/全局/引用） | 组合根注入的 `service.mcpTools(serverName)`：`ctx.get("tools").schemas()` 按 `mcp__<serverName>__` 前缀过滤，name 取后缀、description 取 schema 描述（`src/index.ts:172-195`） | 服务缺失/抛错/空 ⇒ 不带 `tools`，能力照常评分 |
| 外部注入实例 | `mcp.runtime({cwd,sessionId})` 的 `view.tools`（`src/jev/apply.ts:304-306`） | `view.tools` 为空/非法 ⇒ 不带 `tools` |

截断规则（`[架构决定]`，常量见 `src/jev/rank.ts:33-49`；spec 只给了 desc/whenToUse 上限）：

- `description`：按 **Unicode 码点**截断到 200（`Array.from(s).slice(0,200).join("")`），不追加省略号（省 token）；
- `whenToUse`：截断到 120 码点，空/空白则省略字段；
- `name`：截断到 120 码点（防御性补充；超长名极少）；
- `tools`：最多 **8** 个；每个工具 `name` ≤80 码点、`description` ≤120 码点；每题
  `name + description` 总码点 ≤**500**；超预算时**按顺序截断**（后面的工具直接放弃，不缩词）；
- `moreTools`：`tools` 之后的工具**仅名称**，最多 **24** 个、总码点 ≤**600**；
  大插件（本机 `dsh-remote` 22 个工具）/ 大 server 不再只暴露前 8 个（v1.3）；
- **全局预算降级**：请求体（`JSON.stringify(request).length`）超过
  `REQUEST_SOFT_LIMIT_CHARS`（150_000）时按 4 档重建：完整 → `moreTools` 减到 8 →
  丢弃 `moreTools` → `tools` 仅名称 → 完全不带工具；
- 截断对模型判断影响可忽略；`JevRankItem.description` 回传的是同一份（已脱敏）
  截断值（前端展示用，需要完整描述时可回查既有快照；本期不额外传全文）。

### 6.4 能力 ID（稳定、无特殊字符）

```ts
function capabilityId(namespaceKey: string): string {
  const hex = createHash("sha256").update(namespaceKey, "utf8").digest("hex").slice(0, 36);
  return `cap_${hex}`;               // 总长 40：cap_ + 36 小写 hex，仅 [a-z0-9_]
}
```

namespaceKey（**输入里可以用冒号，输出 id 里不会出现**）：

| 能力 | namespaceKey |
|---|---|
| skill | `skill:${name}` |
| MCP 项目条目 | `mcp:project:${configKey}` |
| MCP 全局配置条目 | `mcp:server:${serverName}` |
| 外部注入实例 | `mcp:server:${serverName}`（与全局同名时**先去重**，见 §7.1；否则同一开关命名空间） |

- 稳定：不掺进程/时间/随机，跨进程与重启一致；`apply` 依赖它；
- 唯一性：枚举后 `Map<id, capability>` 去重；若真出现 hash 冲突（可忽略概率），保留先到者并
  `logger.warn`，后者不进入结果（测试可断言 id 唯一）；
- 不透明：客户端只当 token 用，不解析。

### 6.5 questions 文案（英文；判据共享、题目逐能力唯一）

```ts
// 共享判据：只放 state.guidance 一次（实现 `src/jev/rank.ts:46-57`）
const SYSTEM_ONE_GUIDANCE = [
  "You are selecting which capabilities to make available for the user's current request.",
  "For each question below you judge exactly one capability, described inside that question.",
  "Judge by the request's intent and the actions it needs, not by loose topic overlap.",
  "A capability that can directly perform an action the request asks for is highly relevant, even if the request does not name it.",
  "A capability that is only topically related but cannot execute the request is not relevant.",
  "For MCP servers, use the listed tools to judge what the server can actually do.",
  "Answer with a probability from 0 to 1: 1 = definitely useful now, 0 = definitely not.",
].join(" ");

// 每题任务（instructions.task，所有题相同）
const SYSTEM_ONE_TASK =
  "Judge whether this capability is directly useful for the user's request: could using it materially help perform or complete the request now?";

// 逐题 criteria（所有题相同）
const SYSTEM_ONE_CRITERIA = {
  true: "Using this capability can materially help perform or complete the request, even if the request does not name it.",
  false: "The capability is unrelated to the request, or cannot help perform or complete it (topical overlap alone is not enough).",
};
```

- **题目唯一性来自 `instructions.capability`**；`task`/`criteria` 逐题相同是刻意的——
  判据复用，模型只需按「这题问的能力」判分；
- `[研究]` Jev 以英文为主、中文草稿可判（英文判据 + 中文 `state.request` 是研究推荐用法）；
- `type: "noul"` ⇒ 答案即 0–1 概率，不需要 confidence；
- v1.0 的「所有题共用同一份字符串 instructions」已废弃（原因见 §6.0），本文其它章节
  不得再把 `instructions` 描述为纯字符串。

### 6.6 响应解析

```ts
const json = await response.json() as any;
const model: string = typeof json?.model === "string" && json.model.length > 0 ? json.model : config.model;
const usage: JevUsage = {
  input_tokens: Number(json?.usage?.input_tokens ?? json?.usage?.inputTokens ?? 0) || 0,
  output_tokens: Number(json?.usage?.output_tokens ?? json?.usage?.outputTokens ?? 0) || 0,
};
function noulOf(id: string): number | null {
  const raw = json?.answers?.[id]?.noul;
  if (typeof raw === "number" && Number.isFinite(raw)) return clamp01(raw);
  if (typeof raw === "boolean") return raw ? 1 : 0;
  if (raw !== null && typeof raw === "object" && typeof raw.value === "number" && Number.isFinite(raw.value)) {
    return clamp01(raw.value);                        // 容错：{value: number}
  }
  return null;                                        // 缺失/不可解析
}
```

- 无答案 ⇒ `score = 0`，`reason = "no-answer"`（**不丢弃**该能力，前端可解释）；
- `score` 一律 clamp 到 `[0,1]`，保留原始浮点（不做 2 位舍入；展示由前端格式化）；
- `elapsedMs` = 从发起到结束的**总**耗时（含重试等待，`performance.now()` 差值取整）。

### 6.7 排序（严格全序，便于测试）

1. `score` 降序；
2. 同分：`kind === "skill"` 先于 `kind === "mcp"`；
3. 再同：`name.localeCompare(other.name)`（默认 locale；测试用 ASCII 名称避免地域差异）；
4. 再同：`id` 升序（保证确定性）。

### 6.8 `requestCount` / `capabilitiesTotal` / `usage`

- `requestCount: 1` = **逻辑批量请求数**（一次 rank 就是一次批量请求，不是「每个能力一次」）。
  物理 HTTP 次数在 429/529 重试时可能为 2–3；tester 应断言「正常场景假服务收到 1 次」、
  「429 场景收到 3 次（1+2 重试）」。若未来需要暴露物理次数，加 additive 字段，不改本字段语义。
- `capabilitiesTotal` = 本次进入评分的条数（= `items.length`）；用于前端「N 个能力」文案与
  「questions 数 = 能力数」断言。
- `usage` 取服务端返回值；缺失记 0（不伪造估算）。

### 6.9 错误映射与重试（唯一权威表）

| 条件 | code | 重试 |
|---|---|---|
| HTTP 400 且响应体含 `max_tokens_exceeded` / `context_length_exceeded` / `maximum context` | `context-too-long` | 否 |
| HTTP 422 同上特征 | `context-too-long` | 否 |
| HTTP 400（其它） | `bad-request` | 否 |
| HTTP 401 / 403 | `auth` | 否 |
| HTTP 404 / 405 / 415 / 422（非上下文） | `bad-request` | 否 |
| HTTP 429 | `rate-limit` | **是**，最多 2 次 |
| HTTP 529 | `overloaded` | **是**，最多 2 次 |
| HTTP 5xx（500/502/503/504 等，非 529） | `network` | 否 |
| `fetch` 抛 `AbortError`/`TimeoutError` 或内部超时 | `timeout` | 否 |
| `fetch` 抛其它（DNS/ECONNREFUSED/TLS/TypeError） | `network` | 否 |
| 响应非 JSON / 非对象 | `bad-request` | 否 |
| 解析不到 key | `no-config` | 否（不发请求） |

- 退避：`500ms` → `1000ms`（指数，无抖动 `[架构决定]`：便于测试；生产抖动收益小于可预测性）；
- 只对 `rate-limit` / `overloaded` 重试；**任何 4xx 不重试**；
- 每次尝试独立 `timeoutMs`；最多 3 次尝试；总耗时最坏 ≈ `3 * timeoutMs + 1.5s`；
- 重试时**同一请求体**，不缩减能力数（不分片、不降级）；
- `errors` 内容：`"[<code>] HTTP <status>: <脱敏后的响应摘要>"`，无响应体时 `"[<code>] <脱敏异常信息>"`。

### 6.10 不分片、不发 long-context

`[研究]` 结论：一次请求放多个问题是官方推荐用法；超上下文时服务端返回
`max_tokens_exceeded`。本架构**不实现分片**，也不发送扩展 long-context header：

- 超出 → `context-too-long` → 前端「内容过长」态（提示精简草稿/减少能力）；
- 不自动重试「少放几个能力」的降级请求（会产生「评分不全但假装成功」的语义风险）。

### 6.11 `rank` 伪代码

```ts
async function rank(input: unknown, signal?: AbortSignal): Promise<JevRankResult> {
  const { cwd, sessionId, draft } = parseRankInput(input);         // §6.1
  if (!sessionId) return fail("bad-request", ["sessionId is required"]);
  if (!draft || draft.trim().length === 0) return fail("bad-request", ["draft is empty"]);
  if (Array.from(draft).length > 8000) return fail("bad-request", ["draft exceeds 8000 characters"]);

  const config = await readConfig();                               // 损坏→默认
  const key = resolveJevKey(config, process.env);
  if (key.source === "none" || !key.value) return fail("no-config", ["Jev API key is not configured"]);

  const caps = await enumerateCapabilities({ cwd, sessionId, live: isSessionLive(sessionId) }); // §7.1 → JevCapability[]
  if (caps.length === 0) return fail("empty-capabilities", ["no capabilities in this session"]);
  if (caps.length > 300) return fail("bad-request", ["too many capabilities (>300)"]);

  const started = performance.now();
  try {
    // §6.2：state={request,guidance}；每能力一条 question，能力定义内嵌 instructions.capability
    const request = buildSystemOneRequest(config, caps, draft);
    const json = await postSystemOne(systemOneURL(config.baseURL), request, key.value, {
      timeoutMs: config.timeoutMs, ...(signal !== undefined ? { signal } : {}), secrets,
    });
    const items = caps.map((cap) => toRankItem(cap, noulOf(json, cap.id)));  // §6.6
    items.sort(compareRankItems);                                  // §6.7
    const pendingOutcome = consumePendingOutcome(sessionId);       // §8.5
    return {
      ok: true, items, model: pickModel(json, config.model), usage: pickUsage(json),
      elapsedMs: Math.round(performance.now() - started), requestCount: 1,
      capabilitiesTotal: caps.length,
      ...(pendingOutcome !== undefined ? { pendingOutcome } : {}),
    };
  } catch (error) {
    return fail(mapHttpError(error), [redact(describe(error), [key.value, config.apiKey ?? ""])]);
  }
}
```

---

## 7. 能力枚举与应用事务

### 7.1 宿主侧枚举（唯一入口 `enumerateCapabilities({cwd, sessionId})`）

调用既有服务（**不新增枚举 RPC**）：

| 调用 | 返回关键字段（只列用到的） | 用途 |
|---|---|---|
| `skills.sessionList(cwd, sessionId)` | `name/description/whenToUse/source/shadowStub/modelInvocable/userInvocable/enabledInSession/canToggleInSession` | 技能评分与应用 |
| `mcp.list(cwd, sessionId)` | `servers[]: key/serverName/scope/transport/enabled/summary/shadowed/disabledInProject/enabledInSession/reference/entry` + `errors` | MCP 配置条目 |
| `mcp.runtime({cwd, sessionId})` | `servers[]: serverName/restrictable/enabledInSession/disabledInProject/tools` | 外部注入实例 + 其工具清单 |
| `service.mcpTools(serverName)`（组合根注入的可选依赖，**不是 RPC**） | `Array<{name, description?}>` | v1.1：MCP 配置条目的工具清单（进 question，§6.3） |

合并与去重：

1. 技能：直接映射（宿主已过滤 `shadowStub===true` 与「双向不可调用」，`src/skills/session.ts:132-149`[源码]）；
   防御性再过滤一次 `shadowStub === true`；技能不带 `tools`。
2. MCP 配置条目：**跳过 `shadowed === true`**（被项目同名条目遮蔽的全局行，开关落在被遮蔽行上无意义）；
   其余逐条映射；`enabledInSession` 缺省按 `!disabledInProject` 推导（`src/mcp/manager.ts:203-215`[源码]）；
   v1.1 起逐条 `await service.mcpTools(row.serverName)` 取工具清单（失败/空 ⇒ 不带 `tools`，不影响评分）。
3. 外部注入实例：`mcp.runtime` 已排除 loader 自己 `owned` 的 serverName（研究 §B3），仍按
   `serverName` 与 2 去重（若同名，以配置条目为准，丢弃外部视图）；`tools` 取 `view.tools`
   （归一化：只保留 `name` 非空，`description` 可选）。
4. 按 id 去重（§6.4）；最终按 `kind` + `name` 稳定排序后返回 `JevCapability[]`：

```ts
/** 宿主内部类型（`src/jev/types.ts:269-300`）：不跨 RPC。 */
interface JevCapability {
  id: string; kind: "skill" | "mcp"; name: string;
  description: string;                  // 已按 200 码点截断（进 question）
  whenToUse?: string;                   // 已按 120 码点截断
  source: "project" | "global" | "external";  // 仅内部/诊断；v1.1 起不再进请求体
  applicable: boolean;                  // §7.3
  reason?: string;
  enabledInSession: boolean;
  /** 仅 skill：`skills.sessionList` 的原始 canToggleInSession（冷会话为 false，激活重试判据）。 */
  canToggleInSession?: boolean;
  /** 仅 MCP：是否有显式会话覆盖；undefined = 跟随项目默认（回滚恢复 `enabled: undefined`）。 */
  mcpExplicitToggle?: boolean;
  /** 仅 MCP：工具清单（prompt 用，不跨 RPC）；来源见上表。 */
  tools?: Array<{ name: string; description?: string }>;
  // 写回所需（不发给模型）
  write: { type: "skills"; name: string }
       | { type: "mcp"; target: string; targetKind: "project" | "server"; serverName: string };
}
```

MCP 写回映射（`target` / `kind` 与既有 `mcp.setSessionEnabled` 一致，`src/mcp/manager.ts:482-497`[源码]）：

| 行来源 | `targetKind` | `target` |
|---|---|---|
| 项目原生条目 | `"project"` | `row.key`（配置文件里的 config key） |
| 项目级引用（`reference === true`） | `"project"` | `row.key` |
| 全局配置条目 | `"server"` | `row.serverName` |
| 外部注入实例 | `"server"` | `view.serverName` |

### 7.2 评分集合 vs 应用集合

- **评分集合** = 上述合并结果全集（含 `applicable=false`），保证 UX 能展示「不可切换 + 原因」；
- **应用集合** = 评分集合按 §7.3 过滤后的子集；
- 两个集合的差异必须在 `rank.items[].applicable/reason` 中可解释（不做静默过滤）。
- **筛选语义（task-42，v1.2）**：`jev.apply` 的 `plan` 是「已勾选集合」= **目标真值**。宿主对
  **当前会话全部可应用能力**计算目标态：`selected → enabled`、**未 selected → disabled**；
  只写「当前状态 ≠ 目标状态」的项；不可应用项一律不动。
  因此它**不再是** v1.1 的「只启用、不关闭」语义——应用一次 = 把本会话能力集合对齐到勾选结果
  （仍只写会话级内存开关，不动项目默认与配置文件）；**`plan=[]`（v1.3）即目标集合为空，
  等价于关闭本会话全部可应用能力**（见 §7.4/§7.6）。

### 7.3 可应用判定（`applicable`）

| 种类 | 不可应用条件 | `reason` |
|---|---|---|
| skill | `modelInvocable === false && userInvocable === false`（宿主已过滤，防御保留） | `not-toggleable` |
| skill | `shadowStub === true`（占位） | `shadowed` |
| skill | live 会话存在但 `canToggleInSession === false`（例：agent 无 skills 服务） | `not-toggleable` |
| MCP 配置条目 | `entry.disabled === true`（配置文件硬关闭，会话开关无法反向开启） | `hard-disabled` |
| MCP 配置条目 | `shadowed === true` | `shadowed` |
| 外部注入实例 | `restrictable !== true`（工具不可见 ⇒ 无法 restrict） | `not-restrictable` |
| 任意 | 冷会话（无 live agent） | **不判不可应用**，走 pending（§8） |

> **冷会话例外**：`skills.sessionList` 在无 live agent 时会把所有技能 `canToggleInSession=false`
> （`src/skills/session.ts:132-149`）。若照搬为「不可应用」，首屏（本功能主场景）将无技能可选，
> 与 Lead 的冷会话排队裁决直接冲突。故 `applicable` 只在**live 会话**下参考 `canToggleInSession`；
> 冷会话按能力本身可开判定，写入延后到激活（§8.6 给冲突处理）。

### 7.4 `jev.apply` 入参校验与目标态

| 条件 | 结果 |
|---|---|
| `sessionId` 缺失/空 | `{ok:false, code:"bad-request"}` |
| `plan` 非数组 / 长度 >500 | `bad-request`；**空数组 `[]` 合法**（v1.3，见下行） |
| `plan = []`（0 选中） | **合法**：目标集合为空 ⇒ 当前会话**全部可应用能力** desired=false（关闭）；不可应用项不动；成功支 `enabled=0, disabled=实际关闭数`；冷会话入队 `ops` 全部 `desired=false` |
| item 非法（非对象 / `id` 不匹配 `^cap_[0-9a-f]{36}$` / `enabled !== true`） | 逐条进 `skipped`（`unknown-id`） |
| id 不在当前枚举中 | `skipped: unknown-id` |
| live 会话下能力 `applicable=false` | `skipped: <reason>`（`hard-disabled` / `not-restrictable` / `not-toggleable` / `shadowed`） |
| 冷会话下的 `not-toggleable` | **不算跳过**（§7.3 冷会话例外：能否切换取决于激活后是否就绪） |
| 状态已等于目标（选中且已启用 / 未选且已关闭） | `skipped: already-applied`（状态一致，不写） |
| 未在 plan 中出现且 `applicable=false` 的能力 | **不动、也不进 `skipped`**（不是用户可操作项） |
| 枚举失败（服务异常） | `{ok:false, code:"write-failed"}`（附脱敏 errors） |

**不信任客户端**：`name`/`target` 只用于日志与错误文案；实际写入目标从**重新枚举**的
`id → JevCapability.write` 映射取。计划里的条目若 id 不在当前枚举中 ⇒ `skipped: unknown-id`。

目标态计算（`planTargetOps`）：遍历**全部可应用能力** → `desired = selectedIds.has(id)` →
`desired === enabledInSession` 记为一致跳过，否则生成 `PlannedOp{cap, desired, prev}`；
**`selectedIds` 为空时**，每个 `enabledInSession === true` 的可应用能力都会得到
`desired=false` 的关闭 op（= 关闭全部），本来已关闭的记 `already-applied`；
排序为**稳定全序**：先 `desired=true`（enable 阶段）后 `desired=false`（disable 阶段），
组内按 `id` 升序（保证可重放、可测试）。

### 7.5 事务伪代码（v1.2：两阶段批量/并发）

```ts
/** 一个待写操作：目标态 desired（true=启用，false=关闭）+ 前态快照。 */
interface PlannedOp { cap: JevCapability; desired: boolean; prev: JevPrevState }

/** 目标态计算（§7.2 筛选语义）：只对可应用能力算，只留状态不一致项。 */
function planTargetOps(caps: JevCapability[], selectedIds: Set<string>) {
  const ops: PlannedOp[] = [], consistent: JevApplySkipped[] = [];
  for (const cap of caps) {
    if (!cap.applicable) continue;                        // 不可应用：不动、不 skip
    const desired = selectedIds.has(cap.id);
    if (cap.enabledInSession === desired) {               // 已一致（含「未选且已关闭」）
      consistent.push({ id: cap.id, reason: "already-applied" });
      continue;
    }
    ops.push({ cap, desired, prev: snapshotPrev(cap) });
  }
  // 稳定全序：先 enable 后 disable，组内按 id 升序（可重放/可测试）
  ops.sort((a, b) => (a.desired !== b.desired ? (a.desired ? -1 : 1) : a.cap.id < b.cap.id ? -1 : 1));
  return { ops, consistent };
}

async function apply(input: unknown): Promise<JevApplyResult> {
  const { cwd, sessionId, plan } = parseApplyInput(input);            // §7.4
  const startedAt = performance.now();                                // elapsedMs 覆盖「枚举+写入」
  const live = isSessionLive(ctx, sessionId);                         // §8.1
  const caps = await enumerate({ cwd, sessionId, live });             // §7.1

  // 1) 解析勾选集合（只信 id；非法/未知/不可应用 → skipped）
  const selectedIds = new Set<string>(), invalidSkips: JevApplySkipped[] = [];
  for (const item of plan) {
    const cap = isCapabilityId(item?.id) ? caps.find((c) => c.id === item.id) : undefined;
    if (cap === undefined || item.enabled !== true) { invalidSkips.push({ id: String(item?.id ?? ""), reason: "unknown-id" }); continue; }
    if (!cap.applicable && !(live === false && cap.reason === "not-toggleable")) {
      invalidSkips.push({ id: cap.id, reason: cap.reason ?? "not-toggleable" }); continue;
    }
    selectedIds.add(cap.id);
  }

  // 2) 目标态（筛选语义）：选中→启用、未选→关闭，只留状态不一致项
  const { ops, consistent } = planTargetOps(caps, selectedIds);
  const skipped = [...invalidSkips, ...consistent];

  // 3) 冷会话：入队「完整目标集合」（含 desired=false），激活后重放（§8.3）
  if (!live) {
    queuePendingPlan({ sessionId, cwd, createdAt: Date.now(),
      ops: caps.filter((c) => c.applicable).map((c) => ({ id: c.id, desired: selectedIds.has(c.id) })),
      skipped: invalidSkips });
    return { ok: true, applied: 0, enabled: 0, disabled: 0, skipped, pending: true,
             elapsedMs: Math.round(performance.now() - startedAt),
             pendingOutcome: consumePendingOutcome(sessionId) };
  }

  // 4) live：两阶段批量写（enable 全部 → disable 全部），失败逆序批量回滚
  const writeResult = await applyPlannedOps(sessionId, cwd, ops, writeOne);
  if (!writeResult.ok) {
    return { ok: true, applied: 0, enabled: 0, disabled: 0, skipped, pending: false,
             failed: [{ id: writeResult.failedId,
                        reason: writeResult.rollbackFailed ? "write-failed（回滚部分失败）" : "write-failed" }],
             errors: writeResult.errors.map(redactSafe),
             pendingOutcome: consumePendingOutcome(sessionId) };
  }
  const enabled = writeResult.written.filter((op) => op.desired).length;
  return { ok: true, applied: writeResult.written.length, enabled,
           disabled: writeResult.written.length - enabled, skipped, pending: false,
           elapsedMs: Math.round(performance.now() - startedAt),
           pendingOutcome: consumePendingOutcome(sessionId) };
}
```

**单阶段执行器 `runWritePhase`（enable 或 disable）**：

```ts
async function runWritePhase(phaseOps: PlannedOp[], write): Promise<WriteResult[]> {
  const results: WriteResult[] = new Array(phaseOps.length);
  const skillIdx: number[] = [], mcpIdx: number[] = [];
  phaseOps.forEach((op, i) => (op.cap.write.type === "skills" ? skillIdx : mcpIdx).push(i));

  // skills：同一 tick 全部发起（不逐条 await），再 allSettled ⇒ 宿主注册表 effect 合并为一次刷新
  const skillPromises = skillIdx.map((i) => write(phaseOps[i]!.cap, phaseOps[i]!.desired));
  // MCP：并发限流 4（manager/loader 自身有串行队列，避免打爆子进程/连接）
  const mcpPromise = runWithConcurrency(mcpIdx, MCP_WRITE_CONCURRENCY /* 4 */,
    (i) => write(phaseOps[i]!.cap, phaseOps[i]!.desired));
  const [skillSettled, mcpResults] = await Promise.all([Promise.allSettled(skillPromises), mcpPromise]);
  // 结果按原 phaseOps 顺序落位；失败判定取原顺序第一个失败
  // …（skillSettled[i] → results[skillIdx[i]]；mcpResults[i] → results[mcpIdx[i]]）
  return results;
}
```

**两阶段 + 失败回滚 `applyPlannedOps`**：

```ts
async function applyPlannedOps(sessionId, cwd, ops: PlannedOp[], write) {
  const phases = [ops.filter((o) => o.desired), ops.filter((o) => !o.desired)];  // enable → disable
  const written: PlannedOp[] = [];
  const failures: Array<{ op: PlannedOp; errors: string[] }> = [];
  for (const phaseOps of phases) {
    if (phaseOps.length === 0) continue;
    const results = await runWritePhase(phaseOps, write);
    results.forEach((r, i) => (r.ok
      ? written.push(phaseOps[i]!)
      : failures.push({ op: phaseOps[i]!, errors: r.errors })));
    if (failures.length > 0) break;                    // 阶段失败：不进入下一阶段，直接回滚
  }
  if (failures.length === 0) return { ok: true as const, written };
  const rollbackErrors = await rollback(sessionId, cwd, written);     // 逆序 + 同样批量
  return { ok: false as const, written, failedId: failures[0]!.op.cap.id,
           errors: [...failures[0]!.errors, ...rollbackErrors],
           rollbackFailed: rollbackErrors.length > 0 };
}
```

**回滚 `rollback`（v1.2 同样批量）**：按已写列表**逆序**；skills 回滚调用同一 tick 全部发起 +
`allSettled`（注册表 effect 再合并刷新一次），MCP 回滚并发 4；每条把前态写回（skills 恒 boolean；
MCP 可为 `undefined` = 清显式覆盖，`src/mcp/loader.ts:705-728`[源码]）。

- 写入与回滚都是「先算全量 → 批量发起 → 汇总结果」，**不再逐条 `await`**；语义不变：
  先 enable 后 disable、阶段失败即停并回滚、单条写接口仍是既有的
  `skills.setSessionEnabled` / `mcp.setSessionEnabled`（`writeOne`）；
- **回滚只覆盖「已写成功」的项**；失败项本身未写入所以不回滚（`rollback(written)`），
  批次内失败判定取**原顺序第一个**失败项（用于 `failed[0].id` 与 errors 主因）；
- 辅助函数沿用 v1.1 定义：`writeOne(cap, desired)` 由闭包绑定 `sessionId/cwd` 后转调既有会话开关；
  `snapshotPrev(cap)` 记录前态（skills=boolean，MCP=显式覆盖或 `undefined`）；
  `restoreOne` 写回单条前态；`runWithConcurrency(items, 4, fn)` 是按输入顺序返回结果的固定并发度执行器；
- skills 走「同一 tick 发起 Promise」：142 次调用落在同一宏任务 ⇒ 宿主 skills 注册表 effect
  合并刷新——这是 142 条写入 284ms → 3ms 的来源（§7.7）。

### 7.6 返回语义

| 场景 | `ok` | `applied` / `enabled` / `disabled` | `pending` | `failed` | 前端表现 |
|---|---|---|---|---|---|
| 全部成功 | true | applied = enabled+disabled | false | — | toast + chips 回显 + 收起 |
| **空 plan（关闭全部可应用能力）** | true | 0 / 0 / N（N=实际关闭数） | false | — | toast「已应用：关闭 N 项（当前会话未启用任何能力）」 |
| 部分 skipped（`already-applied` / 非法 id / 不可应用） | true | 实际写入数 | false | — | 「已应用 N 条（启用 a / 关闭 b），跳过 M 条」 |
| 写入失败并回滚 | true | 0 / 0 / 0 | false | `[{id, reason}]` | 报错「应用失败，已回滚」 |
| 冷会话排队 | true | 0 / 0 / 0 | true | — | chips 立即回显 + 「已加入本会话，发送首条消息后生效」 |
| 入参非法/枚举失败 | false | — | — | — | 错误提示 |

- `applied = enabled + disabled`（筛选语义下「关闭」也算实际应用）；空 plan ⇒ `enabled=0`，
  `applied === disabled`（本来已关闭的项进 `already-applied`，不计入 applied）；
- `elapsedMs` **additive**（task-47）：仅成功支返回（**冷会话成功支也有**），= 枚举 + 写入总耗时；
  客户端可忽略，仅用于排查「应用中…」过长；
- `skipped[].reason = "already-applied"` 现在覆盖两类状态一致项（选中且已启用 / 未选且已关闭），
  前端统计「跳过」提示时应排除它（客户端已按此过滤）；
- `failed` / `errors` 为诊断信息（脱敏），用户文案由前端按 code/原因映射。

### 7.7 批量执行的收益、基准与风险（v1.2）

| 项 | 结论 |
|---|---|
| 基准（task-48，fake 执行器，2ms/5ms 模型） | ① **142 skills 关闭**：`elapsedMs = 3ms`，skills 在途峰值 **142**（串行下界 **284ms**）；② **142 skills + 6 MCP**：`elapsedMs = 12ms`，MCP 在途峰值 **4**（串行下界 **314ms**） |
| 收益来源 | ① skills：同一 tick 发起 + `allSettled` ⇒ 宿主注册表 effect 只刷新一次；② MCP：卸载/挂载不再逐个串行等待；③ 只写状态不一致项，减少无效写 |
| **风险（关键）** | 真实收益取决于**宿主 `skills.register` 的实际成本**。fake harness 里 `register` 近乎零成本，若真实注册表每次 `register` 都触发独立 effect 刷新，284ms→3ms 的比例无法复现，只能拿到「减少 await 往返」的那部分收益 |
| 降级/后续动作 | 若真机基准显示 skills 写入仍是瓶颈：给 `src/skills/session.ts` 增加**批量 shadow API**（`registerMany` / `setEnabledBatch`：一次注册多条 + 一次 effect 刷新），Jev 侧以**可选依赖**调用、不可用则回落到当前实现。**该 API 属 skills 域改动，需 backend + Lead 另立任务，不在 task-50 范围** |
| MCP 并发为何是 4 | `mcp/loader` 的项目条目挂载/卸载自身有串行队列，并发过高会打爆子进程/连接；4 是本机基准下的保守上限（常量 `MCP_WRITE_CONCURRENCY`，`src/jev/apply.ts:139`） |
| 可观测 | 成功支 `elapsedMs`；tester 用 fake service 记录**在途峰值**断言「skills 同 tick、MCP ≤4」 |

---

## 8. 冷会话排队生效

### 8.1 判活

```ts
function isSessionLive(ctx: any, sessionId: string): boolean {
  const agents = ctx.get?.("agents")?.list?.() ?? [];
  return agents.some((agent: any) => agent?.id === sessionId);
}
```

- 依据 `agent.id === session.id`（`src/skills/session.ts` 的注册表语义，F4）；`agents.list()`
  是权威来源，会话注册表的 `find()` 本身也是从 `agents.list()` 补登记的
  （`src/skills/session.ts:101-118`[源码]），故无需额外的 registry 判活接口；
- 判活**每次调用时现算**，不缓存（agent 生命周期由事件驱动，缓存会陈旧）。

### 8.2 PendingPlan 结构（v1.2：存完整目标集合）

```ts
interface PendingPlan {
  sessionId: string;
  cwd?: string;
  createdAt: number;
  /** 入队时全部可应用能力的**目标态**（含 desired=false），激活后按 id 重放。 */
  ops: Array<{ id: string; desired: boolean }>;
  /** 入队阶段就已确定的跳过项（非法/未知 id；冷会话下仅这类，不可应用判定留到重放时）。 */
  skipped: JevApplySkipped[];
}

const pendingPlans = new Map<string, PendingPlan>();          // 同会话只保留最新一份
const pendingOutcomes = new Map<string, JevPendingOutcome>(); // 上次激活应用结果（≤32 条，读取即消费）
```

- 同会话重复 apply ⇒ **后者替换前者**（最新目标覆盖；不累积），返回 `pending:true`；
- **空 plan（v1.3）**：入队 `ops` = 全部可应用能力、`desired` 全为 `false`（关闭全部）；不可应用项不入 ops；
- 存**目标态**而不是「已解析的写入项」：激活时状态可能已变，重放会重新枚举、重新快照前态（§8.3）；
- `pendingPlans` 规模上界：session 数级；TTL 30 分钟 + `agent/disposed` 清理（§8.5）。

### 8.3 `agent/created` 重放（伪代码，复用同一批量执行器）

> v1.2：重放与 live 路径共用 `planTargetOps` / `applyPlannedOps` / `runWritePhase` / `rollback`，
> 只是多一层「等 skills 服务就绪」的重试；**不再有独立的逐条写入循环**。

```ts
function onAgentCreated({ agent }: any): void {
  if (disposed) return;
  const sessionId = agent?.id;
  if (typeof sessionId !== "string") return;
  const plan = pendingPlans.get(sessionId);
  if (plan === undefined) return;
  pendingPlans.delete(sessionId);                     // 先取走，避免重复应用
  // 延后一个宏任务：让同一事件的其它监听（mcp/loader 的 mountAgent 等）先完成登记，
  // 否则 mcp.setSessionEnabled 找不到 session record。
  setTimeout(() => { if (!disposed) void applyPending(plan); }, 0);
}

/** 激活后重放：重新枚举 + 就绪重试 → 重算目标态/前态 → 同一批量执行器 → 记 outcome。 */
async function applyPending(plan: PendingPlan): Promise<void> {
  try {
    // 1)+2) 重新枚举（live:true）+ 就绪重试 → 按 id 重算目标态/前态
    //   实现 resolvePlanned(plan) 内部：
    //     caps = enumerate(live:true)
    //     while (任一 skill canToggleInSession === false) { await sleep(READY_RETRY_DELAYS_MS); 重枚举 }
    //     ops = caps 仍存在 && applicable && enabledInSession !== desired 的项
    //     skipped += unknown-id / 不可应用 reason / already-applied；排序：先 enable 后 disable
    const { ops, skipped } = await resolvePlanned(plan);

    // 3) 同一批量执行器；写入对「服务未就绪」类错误还会短重试（100/300ms）
    const result = await applyPlannedOps(plan.sessionId, plan.cwd, ops,
      (cap, desired) => writeOneWithReadyRetry(plan.sessionId, plan.cwd, cap, desired));

    recordOutcome(plan.sessionId, result.ok
      ? { applied: result.written.length, failed: 0, errors: [], at: Date.now() }
      : { applied: 0, failed: ops.length, errors: result.errors.map(redactSafe), at: Date.now() });
  } catch (error) {
    recordOutcome(plan.sessionId, { applied: 0, failed: plan.ops.length,
      errors: [redactSafe(errMessage(error))], at: Date.now() });
  }
}
```

- `skipped` 包含入队时已知的跳过项 + 重放时新发现的（未知 id / 不可应用 / 已一致）；
- 重放失败**不保留 pending**（避免无限重试）：丢弃计划，把 `JevPendingOutcome` 存起来，
  下一次同会话 `rank`/`apply` 成功响应带 `pendingOutcome?`（§8.4）；
- 重试只针对「服务未就绪」类（`unavailable|not found|not registered|session record|no agent`），
  对确定性失败（不可切换/硬关闭）不重试；就绪判定用「任一技能 `canToggleInSession === false`」。

### 8.4 结果回报前端（`pendingOutcome`）

- `recordOutcome`：`pendingOutcomes.set(sessionId, outcome)`；超过 32 条按插入顺序淘汰最旧；
- **读取即消费**：`consumePendingOutcome(sessionId)` 返回并删除；`rank` / `apply` 成功支
  以 `pendingOutcome?` 字段带回（§5.2），前端一次性提示「排队的能力已生效 / 排队启用失败」；
- 消费点：`jev.rank` 与 `jev.apply` 的**成功**响应（失败响应不消费，留待下次成功时带回，
  避免错误路径丢提示）；
- 不新增第 6 个端点（保持契约最小；若未来需要「排队状态查询」再评估）。

### 8.5 失败降级与边界

| 场景 | 行为 |
|---|---|
| 激活后应用失败 | 丢弃 pending；记录 `pendingOutcome`（`failed>0` + 脱敏 errors）；下一次 rank/apply 带回；同时 `logger.warn` |
| 回滚也失败 | `rollback` 返回逐条错误，`failed[0].reason = "write-failed（回滚部分失败）"`；状态可能不一致，前端提示「请手动检查本会话能力开关」 |
| 插件重载 / 宿主重启 | 内存 pending 丢失（已接受计划不会生效）；前端只看到「已加入本会话」提示 → 用户可重新评分/手动开启。`[架构决定]` 首版不落盘 pending（落盘会引入跨进程一致性与密钥无关的复杂度） |
| 会话被删除（disposed） | 清 pending 与 outcome，无泄漏 |
| pending 长期不激活（用户不发送消息） | 单会话只留 1 份且轻量；加 TTL 兜底：`createdAt` 超过 30 分钟在下次写入/读取时清理 |
| `agents.list()` 不可用（旧宿主） | 视为「冷会话」→ 排队；若始终不激活，用户可手动按钮重试（`[未找到]` 旧宿主 `ctx.get("agents")` 形状；降级如此） |

### 8.6 与 UX「会话未激活置灰」的冲突处理（必须知会 frontend）

- 现状：既有 composer 面板在冷会话把技能置灰（`canToggleInSession=false` → 「会话未激活」，
  研究 §B3 记录的既有行为）。
- 本架构：`rank` 返回的 `applicable` **不因冷会话置 false**，`apply` 对冷会话技能**入队**。
- 冲突点：UX 旧稿要求「不可切换行置灰+原因会话未激活」，但同一稿又要求「冷会话应用后
  chips 立显 + 发送首条消息后生效」；两者不能同时满足「置灰 = 不可勾选」。
- 裁决：**以 Lead 冷会话排队裁决为准，不置灰**；`reason` 里不出现「会话未激活」。
  若 UX 定稿仍要求视觉置灰，允许把「冷会话技能」渲染为**弱化样式但可勾选**（视觉弱化不影响
  `applicable`），由 frontend 按 UX 最终文案实现，不改宿主契约。

### 8.7 装配与 dispose（`src/index.ts`）

```ts
const jev = createJevManager({ ctx, dshHome: config.dshHome, service: () => service });
const service: CapabilityPanelService = { skills: ..., mcp: ..., overrides: ..., jev };
// disposers 追加
disposers.push(() => jev.dispose());
```

- `createJevManager` 内部持有：`pendingPlans`、`pendingOutcomes`、`agent/created|disposed`
  监听、配置读取（无状态）、`enumerateCapabilities` 依赖的 service 访问器（**延迟求值**，
  避免与 `capabilityPanel` 服务构造顺序耦合）；
- `dispose`：清监听、清两 Map、拒绝后续 `apply`（返回 `write-failed` + `"jev manager disposed"`）。



## 9. 客户端实现要点（给 frontend）

> 交互/文案以 `docs/ux/jev-auto-select.md` v1.5 为准；本节只给**实现结构、状态与调度算法**。

### 9.1 第三 Tab（`src/client/panel.tsx`）

- `DomainTab` 扩展为 `"skills" | "mcp" | "jev"`（当前定义在 `src/client/panel.tsx:56-67`[源码]）；
  `DOMAIN_LABEL.jev = "Jev 模型"`，`DOMAIN_ORDER = ["skills","mcp","jev"]`。
- **该 Tab 不显示搜索框**：`DOMAIN_SEARCH_PLACEHOLDER` 无 `jev` 项；渲染搜索框处按
  `domain !== "jev"` 条件隐藏（保留 skills/mcp 行为不变）。
- **Tab 计数不适用**：`counts.jev = undefined` → 显示 `—`（或按 UX 定稿不显示计数块）。
- 视图分支：`domain === "jev"` 渲染 `<JevPanel api={api} />`；不传 `query`。
- `JevPanel` 只需 `api.jev.getConfig/setConfig/test`（不需要 sessionId）。

### 9.2 配置表单（`src/client/jev-panel.tsx` 新建）

状态：

```ts
type KeyMode = "direct" | "env";
interface FormState {
  baseURL: string; model: string;
  keyMode: KeyMode; apiKeyDraft: string; apiKeyEnv: string;
  autoEnabled: boolean; pauseMs: number; minChars: number; minEditChars: number;
}
```

- 初始：`api.jev.getConfig()` → 填表单；`apiKeySource==="env"` ⇒ `keyMode="env"`；`"file"` ⇒ `"direct"`
  且密码框留空（**不回填明文**，placeholder 显示 `末 4 位` 提示）；`"none"` ⇒ 默认 `env` 模式。
- `apiKeyDraft` 是**一次性输入**：用户不改则提交时不带 `apiKey` 字段（避免把掩码写回文件）；
  用户清空并切到 env 模式 ⇒ 提交 `apiKey: ""`（宿主删除文件 key）。
- 数字输入统一用 `<input type="number">` + `min/max/step`，并在提交前本地校验（范围见 §3.5）；
  本地校验失败不发 RPC，直接字段错误（与宿主返回 `issues` 双保险）。
- 「测试连接」调 `api.jev.test()`：进行中禁用按钮 + 显示「测试中…」；成功显示 `model` + `latencyMs`；
  失败按 `code` 映射 UX 文案。
- 「保存」调 `api.jev.setConfig({config})`；成功后**不自动关闭配置页**（UX 口径），刷新 `getConfig`
  以更新掩码/来源；本地调度状态立即用新值（§9.4）。
- 「恢复默认」：把表单填回 `defaultJevConfig()` 的值（不立即保存，按 UX 定稿；未找到更细口径时由
  UX 决定是否直接保存）。
- 文案必须包含：路径 `~/.dsh/dsh-capability-settings/jev.json`、目录 700/文件 600、密钥不下发浏览器、
  草稿会发送到所配置 endpoint 的隐私说明、每次约 1 次请求的成本提示（文案取自 UX，不在代码里硬编码长句）。
- 窄容器（<720/<560）与暗色：复用 `src/client/styles.ts` 的宿主 token，类名前缀 `skp-jev-`。

### 9.3 草稿读取（`src/client/composer-capability.tsx`）

优先级（**与 Lead 裁决 #10 一致**）：

1. **槽 standardProps（首选）**：`ComposerCapabilityHero` 增加 `props` 入参：

```ts
const draftFromProps = typeof props?.useInput === "function"
  ? props.useInput((s: any) => (typeof s?.draft === "string" ? s.draft : ""))
  : (typeof props?.input?.draft === "string" ? props.input.draft : undefined);
```

- `useInput` 是订阅式 hook（草稿变化即重渲染）；`props.input.draft` 是非订阅兜底；
- hero 相位是否注入标准套件 `[未找到]` 真机证据（研究 §B4 标「中置信度」）——由 tester 真机验证。

2. **DOM 兜底**：`anchorEl.closest("[data-phase]")?.querySelector("[data-composer-card] [data-composer-input]")`
   → 读 `innerText`（contenteditable 无 `value`），清洗：

```ts
function cleanDraft(text: string): string {
  return text
    .replace(/[\uE100-\uE11D\uFFFC]/gu, "")   // 宿主 chip/附件占位符（REFERENCE_PLACEHOLDER_RE）
    .replace(/[\u200B-\u200D\uFEFF]/gu, "")   // 零宽字符
    .trim();
}
```

   监听：`MutationObserver({ childList: true, characterData: true, subtree: true })` + `beforeinput`；
   拿到 `[data-composer-card]` 的 `compositionstart/compositionend` 维护 `isComposing`。

3. **都失败** ⇒ 「✦ 能力决策」入口禁用 + tooltip「无法读取输入框内容」（不提供点击报错路径）。

`draft`、`isComposing`、`draftRev` 统一收敛到 `useDraftSource(props, anchorRef)`，对调度器暴露
`{ draft, revision, isComposing, available }`。

### 9.4 自动触发调度（核心算法）

**本地配置**（来自 `getConfig`，保存后立即更新）：

```ts
interface AutoPrefs { enabled: boolean; pauseMs: number; minChars: number; minEditChars: number }
```

**引用状态（useRef，不触发渲染）**：

| ref | 用途 |
|---|---|
| `timerRef` | 停顿计时器 |
| `lastDraftRef` | 上次草稿（算编辑量） |
| `editCharsRef` | 自基线累计「插入+删除」字符数 |
| `silentDraftRef` | 取消时记录的草稿（同草稿不再自动触发） |
| `inFlightRef` | 当前请求（含 `runId`/`AbortController`） |
| `runIdRef` | 单调递增；晚到响应 runId 不匹配即丢弃 |

**编辑量算法**（前缀/后缀对齐，码点级）：

```ts
function diffAmount(prev: string, next: string): number {
  const a = Array.from(prev), b = Array.from(next);
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const deleted = a.length - p - s;
  const inserted = b.length - p - s;
  return deleted + inserted;
}
```

**每次 `draft` 变化**：

1. `editCharsRef += diffAmount(lastDraftRef.current, draft)`；`lastDraftRef.current = draft`；
2. `clearTimeout(timerRef)`；若 `draft === ""` ⇒ `editCharsRef = 0`（清空即重置基线）；
3. 若 `isComposing` ⇒ 不启动计时（compositionend 后再启动）；
4. 否则 `timerRef = setTimeout(fireIfEligible, pauseMs)`。

**触发前 5 条门槛**（全部通过才发请求；任一失败静默等待下一次变化）：

| # | 门槛 | 说明 |
|---|---|---|
| G1 | `prefs.enabled === true` | 默认关闭；关闭时仅手动按钮可用 |
| G2 | 已配置（`hasApiKey === true`，或首次 `getConfig` 的 `apiKeySource !== "none"`） | 未配置不发请求，入口引导到 Tab |
| G3 | `Array.from(cleanDraft).length >= prefs.minChars` | 用清洗后草稿 |
| G4 | `editCharsRef >= prefs.minEditChars` | 自上次决策以来的累计编辑量 |
| G5 | `!isComposing && inFlightRef.current === undefined` | IME 中不触发；已有请求不并发 |

**附加抑制条件**（不占门槛编号）：

- 相位：仅 `phase === "hero"`（既有 `useConversationPhase()`，`src/client/composer-capability.tsx:225-241`[研究]）；
- 静默：`cleanDraft === silentDraftRef.current` ⇒ 不自动触发（手动按钮不受限）；
- 草稿为纯空白 / 仅 `/` 等命令前缀 ⇒ 由 G3 自然挡住（长度不足）。

**触发动作**（`startDecision("auto" | "manual")`）：

```ts
async function startDecision(origin: "auto" | "manual") {
  const runId = ++runIdRef.current;
  const controller = new AbortController();
  inFlightRef.current = { runId, controller };
  setState({ phase: "loading" });
  if (origin === "auto") setOpen(true);          // 自动触发展开面板，但不 focus()
  editCharsRef = 0;                              // 任意决策触发即重置基线
  try {
    const result = await api.jev.rank({ draft: cleanDraft, /* sessionId/cwd 由 adapter 注入 */ },
                                       controller.signal);
    if (runId !== runIdRef.current) return;      // 晚到响应丢弃
    ...                                          // 成功/错误状态
  } catch (error) {
    if (runId !== runIdRef.current) return;
    if (isAbort(error)) return;                  // 取消不报错
    setState({ phase: "error", code: classify(error) });
  } finally {
    if (runId === runIdRef.current) inFlightRef.current = undefined;
  }
}
```

**取消**：

- 点击「取消评分」：`controller.abort()`（宿主 fetch 中止）、`runIdRef.current++`（让在途响应失效）、
  `silentDraftRef.current = cleanDraft`、`editCharsRef = 0`、回入口态；
- 取消后同一草稿不再自动触发；**草稿再次变化**（内容变化）即解除静默（比对 `cleanDraft !== silentDraftRef`）。

**重置基线的三个时机**（与 spec v1.3 一致）：任意决策触发后 / 草稿清空后 / 发送消息后
（发送 ⇒ 宿主草稿变空，由「草稿清空」覆盖；另在 `phase` 由 hero 变 active 时也重置一次）。

**手动按钮**：始终可点（自动关闭、门槛不满足、静默期内都可用）；点击立即 `startDecision("manual")`；
若未配置 ⇒ 跳转/引导到「Jev 模型」Tab（按钮不禁用，UX 口径）。

**不抢焦点**：自动触发展开面板时**不调用** `focus()`；完成/错误通过 `aria-live="polite"` 播报；
手动点击入口后焦点进入面板容器（`tabIndex={-1}` + `.focus()`）由 UX 定稿决定，但**自动路径不做**。

### 9.5 结果面板与阈值（`composer-capability.tsx` 内新增子组件）

状态：

```ts
type DecisionState =
  | { phase: "idle" }
  | { phase: "loading"; origin: "auto" | "manual" }
  | { phase: "results"; data: JevRankSuccess; threshold: number; manual: Set<string> }
  | { phase: "error"; code: JevErrorCode; message: string }
  | { phase: "pending"; applied: number }        // 冷会话排队提示
  | { phase: "applied"; applied: number };
```

- `threshold` 默认 `0.50`，步长 `0.05`；**只影响预勾选**：`checked = manual.size > 0 ? manual : autoChecked`，
  其中 `autoChecked = { id | item.applicable && item.score >= threshold }`；
  用户手改某行 ⇒ 写入 `manual`（此后以 manual 为准）；
- 改阈值**不重新请求**；重新评分 ⇒ 清空 `manual`、**保留当前阈值**；面板关闭再打开 ⇒ 阈值回 `0.50`；
- 行展示：勾选框 + 类型徽标 + 名称 + 描述 + 分数条 + 数值；`applicable === false` ⇒ 置灰不可勾选 +
  `reason` 文案（`hard-disabled`/`not-restrictable`/`not-toggleable`/`shadowed`）；
- 计数：单基数「已选 n / N」，`N = items.length`（含不可切换项）；
- 底部：重新评分 / 取消 / 「应用所选（N）」；**0 选中时按钮文案为「应用（关闭全部）」且可点**（v1.3）。
- 应用 `plan = checked.map(id => ({ id, kind, name, enabled: true }))`（`kind`/`name` 从 item 取，
  宿主仍按 id 重解析）；成功 ⇒ 收起面板 + 复用现有 `controller.refresh()` 刷新 chips；
  `pending === true` ⇒ chips 立即回显（乐观）+ 提示「已加入本会话，发送首条消息后生效」；
- **筛选语义（v1.2 / task-42）**：`plan` 是全量勾选集合 = 目标真值，宿主会把**未勾选但当前已启用**
  的可应用能力关闭（只影响本会话）；因此客户端必须提交全部勾选项（0 个时提交 `[]`，不能只提交增量），
  并在 toast 里用返回的 `enabled`/`disabled` 说明「启用 a / 关闭 b」；`already-applied` 属于状态一致，
  不计入「不可切换跳过」；
- **0 选中是合法结果（v1.3 / task-52）**：`plan = []` ⇒ 宿主关闭本会话**全部可应用能力**并返回
  `enabled 0 / disabled N`；**不要因为 0 选中而跳过请求**。toast 由客户端 `applyToastText` 按
  `enabled`/`disabled` 分三类：只关闭「已应用：关闭 N 项（当前会话未启用任何能力）」、只启用
  「已应用：启用 N 项（仅当前会话）」、都变化「已应用：启用 N 项、关闭 M 项（仅当前会话）」；
  冷会话对应「已加入本会话，发送首条消息后生效（关闭 N 项，当前会话未启用任何能力）」；
- `apply` 返回的 `elapsedMs`（成功支 additive）仅用于诊断，不展示给用户；
- `pendingOutcome?` 存在时（下一次 rank/apply 返回）⇒ 一次性提示成功/失败，不重复弹。

### 9.6 a11y（按 UX v1.5 §5.12/§6.11）

- 面板：`role="dialog"`、`aria-modal={false}`、`aria-labelledby` 指向标题 id；
- `Esc`：关闭面板（不影响草稿），焦点归还触发按钮；
- `aria-live`：**倒计时/等待不播报**（`aria-live="off"`），评分完成/应用结果用 `polite` 一次播报；
- 阈值滑杆：`role="slider"` 语义（`input[type=range]` 原生） + `aria-valuetext="0.50"`；
- 键盘：Tab 顺序＝行勾选框 → 阈值 → 底部按钮；不可勾选行 `aria-disabled="true"` + `title=reason`。

### 9.7 装配（`src/client.ts`）

- 面板根 api 增加 `jev`（`src/client.ts` 构造面板 api 处，参考 `skills/mcp/overrides` 的写法）；
- composer 的 per-session api 已由 `composerApiFor(sessionId)` 绑定（`src/client.ts:149-172`[研究]），
  `jev.rank/apply` 在 adapter 内自动补 `sessionId`（以及 `cwd`，若 adapter 已有 workspace 解析）；
- hero 槽注册（`src/client.ts:253-261`[研究]）保持 `api` + `onManage`，**不新增 props 传递草稿**——
  草稿走宿主注入的 standardProps（`useInput`/`input`），客户端插件无需改槽参数。

**客户端 `JevApi` 类型与适配器约定（重要，与 skills/mcp 现有风格不同）**：

```ts
export interface JevApi {
  getConfig(): Promise<JevConfigView>;
  setConfig(input: JevSetConfigInput): Promise<JevSetConfigResult>;
  test(): Promise<JevTestResult>;
  /** sessionId/cwd 由 adapter 从 deps 自动注入；组件只需传 draft。 */
  rank(input: { draft: string; sessionId?: string; cwd?: string }, signal?: AbortSignal): Promise<JevRankResult>;
  apply(input: { plan: JevApplyPlanItem[]; sessionId?: string; cwd?: string }): Promise<JevApplyResult>;
}
```

- **业务失败不解包成 throw**：`skills/mcp` 现有适配器用 `unwrap()` 把 `{ok:false,errors}` 抛成
  `Error`（`src/client/api-adapter.ts:99-112`[研究]）；Jev 前端需要 `code` 做错误分类，
  所以 `jev.*` 适配器**原样返回业务结果对象**，由组件按 `code` 分支。
- 传输层异常（RPC 调用 reject）仍按现有模式抛出，组件 catch 后显示通用错误（码 `network`）。
- `sessionId` 缺失时（面板根作用域误调 rank/apply）adapter 直接 `throw new Error("jev.rank requires a session context")`。


### 9.8 客户端不变量（评审 checklist）

1. 自动触发默认关闭；手动按钮任何配置/任何门槛下都可点。
2. 自动路径**不 focus、不 toast、不抢滚动**。
3. 同一草稿取消后不自动重触发；草稿变化后解除。
4. 任一请求都有 `runId`；晚到/取消的响应不改 UI。
5. 阈值只改预勾选，不隐藏、不重排、不重发。
6. 配置页不回显明文 key；`apiKeyDraft` 未改不动 `apiKey` 字段。
7. 所有新样式前缀 `skp-jev-`，仅用宿主 token，不引入外部 CSS/依赖。

---

## 10. 测试方案（给 tester）

### 10.1 假 Jev 端点（`notes/verify/jev-capability-decision/fake-jev.mjs`）

```js
import { createServer } from "node:http";
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const record = { method: req.method, url: req.url, headers: req.headers, body: safeParse(body), at: Date.now() };
    requests.push(record);
    if (opts.delayMs) return setTimeout(reply, opts.delayMs);
    reply();
  });
  function reply() {
    if (opts.error) { res.writeHead(opts.error.status, { "content-type": "application/json" }); return res.end(JSON.stringify(opts.error.body)); }
    const answers = {};
    for (const [id, question] of Object.entries(record.body?.questions ?? {})) {
      // v1.1：能力定义在 instructions.capability（state 不再携带能力）
      const name = question?.instructions?.capability?.name;
      answers[id] = { noul: opts.scores?.[name] ?? opts.defaultScore ?? 0.5 };
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ model: opts.model ?? "jev-test", answers, usage: { input_tokens: 12, output_tokens: 3 } }));
  }
});
server.listen(0, "127.0.0.1");  // 把 server.address().port 写进 DSH_HOME 下的 jev.json
```

能力：可配 `scores`（按能力 `name`）/`defaultScore`/`error{status,body}`/`delayMs`/`failFirstN`（用于重试）；
记录 `requests`（次数、`body.state.request`、`body.state.guidance`、每题 `instructions.capability`、
Authorization 是否出现）供断言；建议同时记录 `body` 原始 JSON 以便断言「state 里没有能力数组」。

### 10.2 fixture 与断言（宿主侧，Node ESM 直接 import `lib/**` 产物）

| # | 用例 | 断言 |
|---|---|---|
| H1 | 配置默认值 | 无文件 ⇒ `getConfig` 返回 `https://api.typesafe.ai` / `jev-latest` / `autoTrigger{false,1000,10,4}` / `timeoutMs 30000` / `apiKeySource "none"` |
| H2 | 掩码 | 文件写入 `apiKey:"sk-test-1234567890"` ⇒ view `hasApiKey true`、`source "file"`、`last4 "7890"`、**响应 JSON 不含 key 原文** |
| H3 | env 优先 | 同时 env + 文件 ⇒ `source "env"`；只 env ⇒ env；`apiKeyEnv` 自定义名生效 |
| H4 | 权限 | `stat` 目录 mode & 0o777 === 0o700、文件 === 0o600（Linux/macOS） |
| H5 | DSH_HOME | 子进程设 `DSH_HOME=/tmp/x` ⇒ 文件落在 `/tmp/x/dsh-capability-settings/jev.json` |
| H6 | 损坏 JSON | 写入 `{oops` ⇒ `getConfig` 回默认且不抛；`setConfig` 可覆盖修复 |
| H7 | 越界拒绝 | `pauseMs:250` / `3500` / `1050`、`minChars:0/201`、`minEditChars:0/101` ⇒ `ok:false code:"invalid-config"` + 对应 `issues[].code`；文件未变 |
| H8 | baseURL 校验 | `http://example.com` 拒绝；`http://127.0.0.1:PORT` 接受；`https://api.typesafe.ai/v1/systemone` 拒绝（`E_BASE_URL_HAS_ENDPOINT`） |
| H9 | 一次请求 + v1.1 请求形状 | `requests.length === 1`；`Object.keys(body.questions).length === capabilitiesTotal`；`typeof body.state.request === "string"` 且等于 trim 后的草稿；`typeof body.state.guidance === "string"` 且非空；**`Object.hasOwn(body.state, "capabilities") === false`**（state 不得携带能力）；每题 `instructions.capability.name` 非空；`body.model` = 配置 model |
| H9b | 题目唯一性（防回归） | N 个能力时 `new Set(questions[].instructions.capability.name).size === N`（若再次退化为「N 道同题」直接失败）；所有题 `instructions.task` 相同属预期 |
| H10 | 截断（能力定义在 question） | 超长 desc ⇒ `questions[id].instructions.capability.description` 码点 ≤200；whenToUse ≤120；`name` ≤120 |
| H10b | MCP 工具入题 | mock `service.mcpTools` 返回 10 个工具 ⇒ 该题 `capability.tools` 恰 8 个、顺序保留、单工具 desc ≤100、name+desc 总码点 ≤500；`mcpTools` 抛错 ⇒ 该题无 `tools` 且 `rank` 仍成功；外部实例取 `mcp.runtime` 的 `view.tools` |
| H11 | 排序 | mock 分数 `{b:0.9, a:0.9, mcpX:0.9, low:0.2}` ⇒ 顺序 `a, b`（skill 同分按名）→ `mcpX` → `low` |
| H12 | 错误映射 | 401→`auth`；400+`max_tokens_exceeded`→`context-too-long`；422→`bad-request`；429→`rate-limit`（断言 3 次请求：1+2 重试）；529→`overloaded`（3 次）；500→`network`（1 次）；连接拒绝→`network`；`delayMs>timeoutMs`→`timeout` |
| H13 | 无配置 | 无 key ⇒ `no-config`，且假服务 0 请求 |
| H14 | apply 成功 + 筛选语义 | 能力 A 已启用、B 已启用、C 已关闭；plan 只勾 A、C ⇒ `applied 2`、`enabled 1`、`disabled 1`、`pending false`；A 进 `skipped: already-applied`；写入参数：A 不写、B `enabled:false`、C `enabled:true` |
| H14b | 阶段顺序与并发 | 计划含 2 enable + 3 disable ⇒ 先发 enable 组、后发 disable 组；组内按 id 升序；fake service 记录 skills **同一 tick 发起**（在途峰值 = skills 数）、MCP 在途峰值 ≤4（`MCP_WRITE_CONCURRENCY`） |
| H14c | `elapsedMs` additive | 成功支与冷会话成功支都有 `elapsedMs`（number ≥0）；失败回滚支无（客户端可忽略） |
| H14d | **空 plan = 关闭全部可应用能力**（v1.3） | 会话内 A/B 已启用、C 已关闭、D 硬关闭不可应用；`plan=[]` ⇒ `ok:true`、`applied 2`、`enabled 0`、`disabled 2`、`pending false`；写入：A/B `enabled:false`；C 进 `already-applied`；D 不动也不 skip；enable 阶段为空（只执行 disable 阶段）；`elapsedMs` 存在 |
| H14e | 空 plan 入参边界 | `plan` 缺省 / null / 非数组 ⇒ `{ok:false, code:"bad-request"}`；`plan: []` 合法（与 `<=500` 上限无关）；`plan` 长 501 ⇒ `bad-request` |
| H15 | apply 失败回滚（批量） | 第 2 个写入失败 ⇒ `applied 0 / enabled 0 / disabled 0`、`failed[0].id`=失败项、`pending false`；回滚按已写列表**逆序**、skills 回滚同一 tick、MCP 回滚并发 ≤4；最终状态=前态（fake service 状态快照对比） |
| H15b | 失败即停 | enable 阶段失败 ⇒ **不进入 disable 阶段**（fake service 记录 disable 调用数 = 0） |
| H16 | 不可应用跳过 | 硬关闭 MCP / 不可 restrict 外部实例 ⇒ `skipped[].reason` 对应，不写 |
| H17 | 未知 id | 伪造 `cap_000…` ⇒ `skipped: unknown-id`，不写 |
| H18 | 冷会话排队（v1.2 完整目标集合） | `agents.list()=[]` ⇒ `apply` 返回 `pending:true`、`applied/enabled/disabled 0`、`elapsedMs` 存在，且**无写调用**；pending 存的是全部可应用能力的 `{id,desired}`（含 `desired=false`）；随后触发捕获到的 `agent/created` 监听（fake agent id=sessionId）并等待 ⇒ 用**同一批量执行器**写入（先 enable 后 disable）、pending 清空 |
| H18b | 冷会话空 plan（v1.3） | `agents.list()=[]` 且 `plan=[]` ⇒ `pending:true`、`applied/enabled/disabled 0`、无写调用；pending `ops` = 全部可应用能力且 `desired` **全为 false**；激活后全部关闭（disable 阶段生效） |
| H19 | 排队失败回报 | 激活应用失败 ⇒ 下一次 `rank`/`apply` 成功响应带 `pendingOutcome.failed > 0`，再次调用不再带（读取即消费）；激活重放失败**不保留 pending** |
| H20 | dispose | 调 `jev.dispose()` ⇒ 监听移除、pending 清空、后续 `apply` 返回 `write-failed` |

### 10.3 客户端（jsdom + 假时钟）

| # | 用例 | 断言 |
|---|---|---|
| C1 | 第三 Tab | 渲染 3 个 Tab；点「Jev 模型」后搜索框不存在；配置表单默认值 = 关闭/1000/10/4；密钥框为空、显示来源+末 4 位 |
| C2 | 默认关闭 | `pauseMs` 内 `useInput` 连续变 3 次、推进假时钟 5000ms ⇒ `rank` **0 次** |
| C3 | 停顿触发一次 | 开启 auto，草稿 ≥10 字，推进 `pauseMs` ⇒ `rank` 恰 1 次；继续推进时钟不再触发 |
| C4 | 字数不足 | 草稿 5 字（<10）⇒ 不触发 |
| C5 | 修改量不足 | 首轮决策后仅改 2 字 ⇒ 不触发；再改到累计 ≥4 ⇒ 触发 |
| C6 | 输入中不触发 | 每 300ms 变一次（<pauseMs）⇒ 不触发；停手后触发 1 次 |
| C7 | 取消静默 | 触发后点取消 ⇒ 同草稿推进时钟不再触发；改 1 字（≥minEdit 时）⇒ 再触发 |
| C8 | 手动可用 | auto 关闭/门槛不满足时点按钮 ⇒ 立即 1 次 rank |
| C9 | runId | 连发两次，先返回的旧响应后到 ⇒ 丢弃，UI 显示第 2 次结果 |
| C10 | 阈值 | 改阈值不重发请求；预勾选随阈值变化；手改后以手改为准；重评清手改、阈值保留；关闭重开回 0.50 |
| C11 | 不可切换行 | `applicable=false` ⇒ 勾选框 disabled + `aria-disabled` + 原因文案；「应用所选」不含该 id |
| C12 | 冷会话提示 | `apply` 返回 `pending:true` ⇒ 面板显示「发送首条消息后生效」，chips 乐观回显 |
| C13 | DOM 兜底 | `useInput` 返回 undefined 且 DOM 存在 ⇒ 读 `[data-composer-card] [data-composer-input]` 的 innerText 并清洗 chip 占位符（`\uE100`/`\uFFFC` 被移除） |
| C14 | 都不可读 | props 与 DOM 均失败 ⇒ 入口 disabled + tooltip 文案 |

### 10.4 真机必须验证（不得用单测替代）

1. **hero 相位 `props.useInput` 是否存在**：在独立 `DSH_HOME` + 独立端口 + 同版本外壳下，
   在 hero 组件内临时日志确认 `typeof props.useInput === "function"`（研究 §B4 标「中置信度」）。
   若不存在 ⇒ 走 DOM 兜底（§9.3），并记录结论。
2. **第三 Tab 真机渲染**：面板头部 3 个 Tab、搜索框在 Jev Tab 隐藏、配置表单可读写真实
   `~/.dsh`（**必须用独立 DSH_HOME**，禁止动用户 profile）。
3. **冷会话排队真机**：首屏不发送消息直接应用 ⇒ chips 回显 + 提示；发送首条消息后能力条状态
   与所选一致。
4. **真机权限**：`stat -f "%Lp"` 确认目录 700/文件 600（macOS）。

> 若真机条件不可得（无法起独立外壳），在 `report.md` 明确写「未验证 + 原因」，不得用推断冒充证据。

---

## 11. 任务拆分与并行边界

### 11.1 backend（task-15）文件清单

| 文件 | 新建/改动 | 内容 | 依赖 |
|---|---|---|---|
| `src/jev/types.ts` | 新建 | §3.4/§5.2 全部类型、`defaultJevConfig()`、错误码 | 无 |
| `src/jev/paths.ts` | 新建 | §3.1 | types |
| `src/jev/config-file.ts` | 新建 | `readConfig` / `saveConfig` / `validateJevConfig` / `resolveJevKey` / `redact` | types、paths、shared |
| `src/shared/atomic-write.ts` | 改动（最小） | §3.3 的 `options.mode`；默认行为不变 | 无 |
| `src/jev/rank.ts` | 新建 | §6 全部（HTTP、解析、排序、错误映射、重试、探针） | types、config-file |
| `src/jev/apply.ts` | 新建 | §7 枚举/事务/回滚 + §8 pending 队列 | types、config-file、service 访问器 |
| `src/jev/manager.ts` | 新建 | 组装 `getConfig/setConfig/test/rank/apply`、生命周期监听、dispose | 以上全部 |
| `src/remote.ts` | 改动 | `PanelRpcService.jev` + 5 个 case + `_signal` 透传 | types |
| `src/index.ts` | 改动 | `createJevManager` 装配、`service.jev`、disposers；v1.1 起注入 `mcpTools`（`ctx.get("tools").schemas()` 反推 `mcp__<server>__*`，供 rank 的 question 带工具清单） | manager |

实现顺序（同一 owner 串行）：`types → paths → atomic-write(mode) → config-file → rank → apply → manager → remote → index`。
**`atomic-write.ts` 必须先于 config-file 落地**（否则 Jev 保存无法 0600）。

### 11.2 frontend（task-16）文件清单

| 文件 | 新建/改动 | 内容 |
|---|---|---|
| `src/client/api.ts` | 改动 | `JevConfigView`/`JevRankItem`/`JevRankResult`/`JevApplyResult`/`JevApi` + `CapabilityPanelApi.jev` |
| `src/client/api-adapter.ts` | 改动 | 5 个方法；`rank/apply` 自动注入 `sessionId`/`cwd`；`jev.test/rank` 支持 signal |
| `src/client/jev-panel.tsx` | 新建 | §9.2 配置表单 |
| `src/client/panel.tsx` | 改动 | §9.1 第三 Tab（隐藏搜索框、计数不适用） |
| `src/client/composer-capability.tsx` | 改动 | §9.3–§9.6：入口按钮、草稿源、调度器、结果面板、a11y |
| `src/client/styles.ts` | 改动 | `skp-jev-*` 样式（暗色/窄容器） |
| `src/client.ts` | 改动（小） | 面板 api 挂 `jev`；若 `jev-panel` 需要，exports 不变 |

实现顺序：`api.ts 类型 → api-adapter → jev-panel → panel Tab → composer 调度/结果面板 → styles`。
前面两步可在 backend 未完成时独立完成（契约已冻结）。

### 11.3 并行边界与集成点

```
task-14（本文）
   ├── task-15 backend ──┐
   └── task-16 frontend ─┴── task-17 tester（两者都 done 后）
```

- backend / frontend **零文件重叠**（§1.3），可并行；
- 集成点（唯一）：`/capability-panel` 上的 5 个 endpoint 名与返回形状 = 本文 §5；
- 若 backend 在实现中发现契约需要改（例如新增字段），**先回报 Lead**，由 Lead 统一
  知会 frontend 并更新本文（禁止单边改变形状）；
- 跨任务 typecheck 预期：backend 完成后 `api.ts` 未改前 typecheck 可能提示 `CapabilityPanelApi`
  缺 `jev` —— 属预期，由 Lead 在两者合流后统一 `pnpm typecheck` + `pnpm build`。

### 11.4 归属

| 产物 | 归属 |
|---|---|
| `README.md`（行为说明/新 Tab/自动触发/配置路径） | Lead 收尾（写作用域外） |
| `CHANGELOG.md` `[Unreleased]`（新增/变更/内部） | Lead 收尾 |
| `lib/**`（构建产物，`pnpm build` 后提交） | Lead 收尾 |
| `notes/verify/jev-capability-decision/**`（脚本 + report.md） | tester（task-17） |
| 本文档 | architect2（task-14，已完成） |

---

## 12. 验收追踪（按模块 → AC 组）

> 以仓库当前 spec（144 条唯一 ID）为准；任务书的「136 条」为旧口径。下表只做**覆盖映射**，
> 不逐条复制。详细 AC 文本见 `docs/specs/jev-auto-select.md` §6。

| 模块（实现落点） | 覆盖 AC 组 | 说明 |
|---|---|---|
| 配置存储/校验/权限/路径（`src/jev/{paths,config-file,manager}`、`src/shared/atomic-write`） | **CFG**（24）全组 | 默认值、持久化、掩码、落盘路径与权限、保存/恢复默认、损坏回退 |
| 密钥边界与脱敏（`config-file.resolveJevKey/redact`、`rank/test` 错误路径） | **SEC**（8）全组 | 明文不下发、来源+末 4 位、错误不含 key、宿主 fetch |
| RPC 装配与客户端 adapter（`remote.ts`、`index.ts`、`client/api*`） | **ENT**（31）中的入口/跳转/未配置引导/刷新保留配置 | 入口两态、按钮可用性、Tab 切换 |
| `rank` 请求构造（`src/jev/rank.ts`） | **REQ**（10）全组 | 一次请求、不分片、questions 数=能力数、model/state 字段 |
| 排序/结果投影（`rank.ts` + 结果面板） | **RES**（10）全组 | desc、同分规则、usage/model/耗时、单基数计数 |
| 阈值与勾选（`composer-capability.tsx` 结果面板） | **THR**（11）全组 | 默认 0.50/步长 0.05、只改预勾选、不重发、手改优先、重评/重开语义 |
| `apply` 事务/回滚/冷会话（`src/jev/apply.ts`、`manager.ts` 生命周期） | **APP**（13）全组 | 筛选语义（选中启用 / 未选关闭）、只写状态不一致项、两阶段批量写、失败逆序回滚、不可切换跳过、冷会话排队与重放、chips 回显、`enabled`/`disabled` 统计 |
| 状态机/错误分类/防抖（前端调度 + `rank` 错误映射 + 配置表单） | **ERR**（18）全组 | 未配置/空草稿/评分中/无匹配/各类错误/并发与取消 |
| 面板 a11y（`composer-capability.tsx`、`jev-panel.tsx`） | **A11Y**（8）全组 | role/焦点/Esc/aria-live/键盘顺序 |
| 窄容器与暗色（`styles.ts`） | **NAR**（6）全组 | <720/<560 降级、暗色 token |
| 既有功能不回归（sections/输入框/能力条/面板两域） | **REG**（5）全组 | 由 tester 回归脚本 + Lead 最终验证覆盖 |
| 配置页视觉/文案（`jev-panel.tsx`） | CFG 中 UI 类条目 + UX §5.8 文案 | 文案以 UX 为准，代码不硬编码长句 |

**明确不在本期**（spec 非目标）：MCP 工具级评分/开关、自动执行能力、长期学习记忆、云端同步、
自动分片、跨会话记忆。

---

## 13. 未决、未找到与降级（禁止猜测清单）

| # | 事项 | 状态 | 降级 / 处理 |
|---|---|---|---|
| U1 | `agent/created` 触发时 `agent.ctx` 是否已可 `get("skills")`、MCP loader 是否已登记 session | **[未找到]**（本轮不读 asar；仓库无现成结论） | `setTimeout(0)` 延后 + 「服务未就绪」类错误短重试 2 次（100/300ms）；tester H18 验证；若真机证明仍太早，改 `agent/created` 后等一个 `queueMicrotask` + 50ms 再试（只改 apply.ts，不影响契约） |
| U2 | `systemone` 响应的权威结构（`answers[id].noul`、`usage` 字段名） | 研究 §A 有结论，本轮未复核 | 容错解析（number/boolean/`{value}`/缺失）；`usage` 兼容 snake/camel；测试用假端点覆盖两种形状 |
| U3 | 是否有官方 health / models 端点供 `jev.test` | **[未找到]** | 最小探针请求（§5.3），成本可忽略；若后续发现 health 端点再替换（只改 rank.ts） |
| U4 | 冷会话技能「置灰」与「排队生效」的 UX 最终口径 | 冲突（§8.6） | 架构按 Lead 裁决：不置灰、排队；允许前端做视觉弱化，不改 `applicable` |
| U5 | Windows 文件权限语义 | **[未找到]**（POSIX 目标） | `chmod`/`mode` 失败不阻断；文档标注平台差异，验收只在 macOS/Linux 断言权限 |
| U6 | 请求体积/能力数硬上限 | 官方文档称仅受上下文限制 | 防御上限：300 能力 / 草稿 8000 码点（§6.1），超限 `bad-request`；真机 37 条远低于上限 |
| U7 | `useInput` 在 hero 相位是否可用 | 研究标「中置信度」 | DOM 兜底链（§9.3）；tester 真机验证（§10.4） |
| U8 | 既有 `mcp.list` 视图把 `entry`（含 headers/env）下发浏览器 | 既有事实（F9） | 本期不扩大该行为；Jev 配置走独立文件 + 掩码视图，**不复用** mcp 通道 |
| U9 | `pendingOutcome` / `issues` / `errors?` 等 additive 字段是否会破坏旧客户端 | 低风险 | 全部 optional；旧客户端解构时忽略；tester 断言 JSON 形状 |
| U10 | spec 条目数与任务书不一致（144 vs 136） | 已核对 | 以仓库 spec 为准；§12 按分组映射 |
| U11 | **skills 批量写入的真实收益**（v1.2） | 风险（task-48 只在 fake 执行器上验证） | fake 基准 142 skills 284ms→3ms 依赖「注册表 effect 合并刷新」；真实 `skills.register` 成本未知。降级：先按当前实现上线并记录 `elapsedMs`；若真机仍是瓶颈 ⇒ 给 `src/skills/session.ts` 加批量 shadow API（`registerMany`/`setEnabledBatch`，可选依赖、不可用回落），需 Lead 另立 skills 域任务 |
| U12 | `JevApplyResult` 新增 `enabled`/`disabled`/`elapsedMs` 的跨版本兼容 | 已处理 | 全部 additive optional（`elapsedMs`）或语义不冲突（旧客户端忽略未知字段）；`applied` 语义明确为 `enabled+disabled`（筛选语义），旧客户端只展示总数仍成立 |

---

## 14. 证据索引

| 证据 | 位置 | 用途 |
|---|---|---|
| 业务失败信封 `failure()` 与传输信封约束 | `src/remote.ts:40-46`（实读） | §5.1 |
| `PanelRpcService` 三域形状 | `src/remote.ts:50-107`[研究行号] | §5.1 |
| `handleEndpoint` 路由/未知/抛错归一 | `src/remote.ts:112-190`[研究行号] | §5.1、§4.4 |
| 插件装配点（service / provide / disposers / mountRpc） | `src/index.ts:95-215`（实读） | §8.7、§11.1 |
| `mcpTools` 从全局工具注册表反推（`mcp__<server>__*`） | `src/index.ts:172-195`（实读） | §6.3、§7.1、§11.1 |
| `Config.dshHome` 覆盖 | `src/index.ts:47-58`（实读） | §3.1 |
| rank 请求构造（v1.1：`state={request,guidance}`、结构化 `instructions.capability`、tools 截断、探针） | `src/jev/rank.ts:1-130,199-249`（实读） | §5.3、§6.0、§6.2、§6.3、§6.5 |
| 能力枚举与描述截断、MCP 工具来源 | `src/jev/apply.ts:220-320`（实读） | §6.3、§7.1 |
| apply 写入/回滚批量执行器（skills 同 tick + `allSettled`、MCP 并发 4、失败逆序） | `src/jev/apply.ts:335-480`（实读） | §7.5、§7.7 |
| apply 计划/两阶段调度/激活重放（`planTargetOps`、`runWritePhase`、`applyPlannedOps`） | `src/jev/apply.ts:490-790`（实读） | §7.4、§7.5、§8.2、§8.3 |
| `jev.apply` 入口（筛选语义、`enabled`/`disabled`/`elapsedMs`、冷会话入队） | `src/jev/apply.ts:790-951`（实读） | §5.2、§7.2、§7.6 |
| `JevApplyResult` / `JevApplyPlanItem` / `JevPendingOutcome` 类型（v1.2 字段） | `src/jev/types.ts:200-270`（实读） | §5.2、§7.6 |
| `JevCapability` / `JevRankItem` / `JevRankResult` 类型 | `src/jev/types.ts:161-190,269-300`（实读） | §5.2、§7.1 |
| rank 结果聚合（`requestCount:1`、`elapsedMs`、`pendingOutcome`） | `src/jev/manager.ts:240-280`（实读） | §5.2、§6.8、§8.4 |
| `atomicWriteText` 现状（无 mode） | `src/shared/atomic-write.ts:25-30`（全文实读） | §3.3 |
| `withFileLock` 契约（进程内串行） | `src/shared/file-lock.ts:28-39`（实读） | §3.3、§3.6 |
| `readJsonDocument` 语义 | `src/shared/json-config.ts:27-46`（签名 grep） | §3.3 |
| `resolveDshHome` 用法与 `.dsh` 映射 | `src/shared/config-location.ts:18,60-65`（grep） | §3.1 |
| agent 生命周期先例（created/disposed/list、id===session.id） | `src/skills/session.ts:85-130`（实读 55–200） | §1.2、§8.3 |
| `canToggleInSession` 冷会话置灰语义 | `src/skills/session.ts:132-149`[研究行号]（实读） | §7.3、§8.6 |
| skills 会话开关写入语义（shadow 注册/解除） | `src/skills/session.ts:151-199`（实读） | §7.5、§7.6 |
| `mcp.list` 合并/遮蔽/会话投影 | `src/mcp/manager.ts:140-240`（实读） | §7.1、§7.3 |
| `mcp.setSessionEnabled` 入参（target/kind/enabled） | `src/mcp/manager.ts:482-497`（grep + 实读） | §7.1、§7.5 |
| `mcp.runtime` 的 restrictable 语义 | `src/mcp/manager.ts:409-469`[研究行号] | §7.1、§7.3 |
| `loader.sessionToggles` 与 `enabled: undefined` 清覆盖 | `src/mcp/loader.ts:690-740`（实读） | §7.5、§7.6 |
| hero 能力条/控制器/hero 结构 | `src/client/composer-capability.tsx:600-780`（实读） | §9.3、§9.5 |
| `DomainTab` / 搜索框 / 域渲染 | `src/client/panel.tsx:56-200`（实读 50–205） | §9.1 |
| 研究：配置落盘/密钥边界/RPC 最小改动/能力枚举 | `docs/research/jev-auto-select.md` §B1–B3（173–约 310 行实读） | §3、§4、§5、§7 |
| 研究：草稿读取与 DOM 兜底 | `docs/research/jev-auto-select.md` §B4 | §9.3 |
| 验收分组与唯一 ID 统计 | `docs/specs/jev-auto-select.md`（grep 分节/AC ID） | §0.1、§12 |
| 仓库硬约束（槽位/样式/构建/提交纪律） | `AGENTS.md`（工作区指令） | §9.8、§11.4 |

---

### 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-10-24 | 首版：配置/密钥/RPC/rank/枚举与事务/冷会话/客户端调度/测试/拆分/验收映射/未决清单 |
| v1.1 | 2026-10-24 | **rank 请求形状变更**（backend 实测修复）：`state` 改为 `{request,guidance}`，能力定义进每题的 `instructions.capability`（MCP 带 `tools`），共享判据只在 `guidance` 出现一次；根因是旧形状下 155 道题共用同一字符串 instructions（question id 不进模型输入）且题目不含能力，分数塌缩到 0.40–0.41（见 §6.0）。同步更新 §1.1、§2.2(F11)、§5.1、§5.3、§5.7、§6.0/§6.2/§6.3/§6.5、§7.1、§10.1/§10.2、§11.1、§14；**RPC 类型与客户端契约不变**（rank/apply 返回形状未变） |
| v1.2 | 2026-10-24 | **apply 执行器改批量/并发 + 筛选语义**（task-42/47/48，backend 已验证）：① `plan` = 已勾选集合 = 目标真值，选中启用 / 未选关闭（只改会话开关）；② 只写状态不一致项；③ **enable→disable 两阶段**，阶段内 skills 同一 tick 全部发起 + `allSettled`（注册表 effect 合并刷新）、MCP 并发 4；④ 阶段失败即停、按前态**逆序批量回滚**（同样批量）；⑤ 冷会话入队完整目标集合、激活后**复用同一执行器**重放（含就绪重试 100/300ms）；⑥ 成功支 **additive** `elapsedMs`，返回新增 `enabled`/`disabled`（`applied = enabled+disabled`）。fake 基准（2ms/5ms 模型）：142 skills 关闭 284ms→`elapsedMs 3ms`（skills 峰值 142）、142 skills+6 MCP 314ms→`elapsedMs 12ms`（MCP 峰值 4）。风险见 §7.7/U11（真实收益取决于 `skills.register` 成本与 effect 合并，必要时加 skills 批量 shadow API）。同步更新 §1.1、§1.2、§5.2、§7.2/§7.4/§7.5/§7.6（新增 §7.7）、§8.2/§8.3/§8.5、§9.5、§10.2、§13、§14；rank 契约不变 |
| v1.3 | 2026-10-24 | **空 plan = 关闭全部可应用能力**（task-52）：`jev.apply` 的 `plan` 允许空数组 `[]`（仅拒绝非数组 / >500）；空 plan = 目标集合为空 ⇒ 当前会话全部**可应用**能力 `desired=false`（关闭），不可应用不动；返回 `enabled=0 / disabled=N / applied=N`；冷会话入队 `ops` 全 `desired=false`；前端 0 选中时按钮为「应用（关闭全部）」且可点，toast 分「只关闭 / 只启用 / 都变化」三类。同步更新 §1.1、§5.2、§7.4、§7.6、§8.2、§9.5、§10.2（H14d/H14e/H18b）；两阶段批量/回滚/rank 契约不变 |

