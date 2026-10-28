# 派生能力继承与自动选择 · 设计与实现方案（提案）

| 项 | 值 |
|---|---|
| 文档 ID | `docs/architecture/agent-capability-inheritance.md`（本文件） |
| 状态 | **提案 v0.1（未实现）**，2026-10-28 |
| 作者 | Lead |
| 上游依据 | 用户反馈（lead 的当前对话能力派生 agent 不继承）+ 本机真实团队运行数据（见附录 A）+ DSH 0.2.1-rc.2 源码取证（见附录 B） |
| 下游任务 | phase 1 / phase 2 实现、tester、Figma（实现后同步配置面） |
| 写作用域 | 本轮**仅新增本文件**；不改 `src/**`、不安装、不推 profile、不改用户 `~/.dsh` 配置 |

---

## 0. 阅读方式与证据标注

1. 本文把「WHAT（语义）」与「HOW（实现契约）」放在一份文档里，便于一次性评审；实现阶段再拆任务。
2. 证据标注：
   - `[源码]` = 本仓库源码实读（行号以当前工作树 `5cb097e` 为准）；
   - `[宿主取证]` = 从 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar` 提取的 DSH 0.2.1-rc.2 源码实读（包名 + 符号见附录 B）；
   - `[本机数据]` = 用户本机真实会话文件与持久化文件（附录 A）；
   - `[裁决]` = 本文显式给出的设计决定（附理由与降级）；
   - `[待验证]` = 实现后必须用测试/真机确认的点（见 §8）。
3. 本文不声称「已经可用」：默认值、UI 入口、自动选择的语义仍有待决问题（§10），确认后才进入实现。

---

## 1. 结论摘要（TL;DR）

### 1.1 问题

会话级能力开关按 `agent.id`（= `session.id`）存储与读取；teammate / subagent 是**独立 session**，插件按子会话 id 读取时查不到 lead 的显式覆盖，只能回落项目默认。agent 的 cordis scope 互不嵌套，所以 lead 作用域上的 skills shadow / `tools.restrict` 也不会自动作用于子 agent。[源码][宿主取证][本机数据]

### 1.2 方案

**派生能力继承（conversation-tree inheritance）+ 可选自动选择**，全部在本插件内实现，不改 DSH 原生 `subagent` / `agent-team` / `agent-loop`：

1. **lineage 解析**：沿 `session.header.parentSession` 找到对话根会话（父不在线时用 `sessionPersistence.open(id,"read").header` 兜底）。
2. **两种派生类型、三态策略**：`subagent` / `teammate` 各自可配 `none | inherit | inherit+auto`；配置粒度 **会话 > 项目 > 全局默认**。
3. **继承**：子 agent 的生效集合 = 直接父 agent 的生效集合（depth 1 即 lead），在子 agent 自己的作用域里重新注册 shadow / restrict / 项目 MCP 挂载；不复制开关记录。
4. **自动选择**：在 spawn 工具执行**前**（`tools/pre-execute` 瀑布）用委派任务文本跑一次 Jev，把「收窄后的选择」暂存；在 `agent/created`（serial 且被 await，子 agent 尚未发布/首轮未开始）绑定并应用。
5. **持久化**：会话级策略写入 `session-capabilities.json` 的会话记录；自动选择快照按 child 存在**所属对话**的记录里，重启 / resume 直接复用，不重复请求 Jev。
6. **默认值**：`subagent = inherit`、`teammate = inherit`、自动选择默认关闭；可显式改回 `none` 保持旧行为。

### 1.3 非目标

- 不改原生 subagent / agent-team / agent-loop；
- 不覆盖 out-of-process / 跨主机子 agent；
- 不覆盖其它插件注册的能力（只处理本插件的 skills / MCP 会话开关）；
- 不提供「单个子 agent 的手动能力编辑」UI（自动选择产生的是派生结果，不是用户开关）。

---

## 2. 现状、证据与根因

### 2.1 本机真实复现（附录 A 全文）

以 2026-10-28 16:14 的团队运行为例：

| 项 | 值 |
|---|---|
| lead 会话 | `session-d4d2e505-5cc6-4322-8186-38f472fee03f`（cwd `.../dsh-htdot-bridge`，`delegationDepth: 0`，`agentPreset: standard`） |
| 派生 teammate | 7 个（scout / architect / pm / ux / backend / frontend / devops） |
| 子会话 header | `parentSession: session-d4d2e505…`、`origin: "subagent"`、`delegationDepth: 1`、`agentPreset: "cordis"` |
| lead 持久化开关 | 143 个 skill 键（142 关 / 1 开）+ 9 个 MCP 键（figma / open-computer-use / AnySearch / Parallel-Search / tavily / deepwiki / jev-browser-chrome 关；playwright / context7 开） |
| 7 个子会话的开关记录 | **0 条** |
| 该工作区项目级默认 | `capability-overrides.json` 的 `projects` 为空 ⇒ 子 agent 实际拿到「全部默认开启」 |

### 2.2 本插件当前链路

| 位置 | 现状 | 影响 |
|---|---|---|
| `src/mcp/loader.ts:675,682` | `remount()` 用 `record.agent?.id` 调 `hydrateToggles` / `resolveSessionPlan` | 子 agent 用的是自己的 session id，读不到 lead 的开关 |
| `src/skills/session.ts:254,493,574,710` | `hydrateExplicit` / 持久化写入用 `record.agent.id` | 同上 |
| `src/session-state.ts` | 记录形状 `sessions.<sessionId>.{skills,mcp}` | 天然按会话隔离，没有"会话树"概念 |
| `src/session-state-reconcile.ts` | 存在性校验 + 24h 宽限，`session/disposed` 只标记不删 | 重启不会清空 lead 的记录（这是"重启后仍生效"的前提） |
| `src/index.ts` | 组合根把一个 `sessionState` 注入两个域 | 新增策略/派生存储可复用同一实例与写盘封装 |

### 2.3 宿主契约取证（附录 B 全文）

1. `agent.id === session.id`：`dsh-agent` registry `enter()` 显式校验 `id !== agent.session.id` 时抛错。
2. 子 agent 有独立 session，父子关系只在 `session.header.parentSession`：`dsh-subagent` 的 `childSessionMeta()` 写入 `parentSession: parentHeader.id`；teammate 由 `dsh-experimental-agent-team` 以 `parentSession = lead.id` 创建。
3. agent scope 不嵌套：`dsh-agent-loop` 的 `ReactLoopAgent` 构造时 `this.scope = createScope(loopCtx, this)`（无 `parent` 选项）⇒ 不同 agent 的 scope 是兄弟，lead 的 shadow / restrict 不会沿 scope 链下发。
4. DSH 自带的委派继承只覆盖 sandbox / approval / permissionPreset：`dsh-subagent` 的 `captureDelegatedPolicyOverrides()` / `appendDelegatedPolicyOverrides()`；**不含 skills / MCP**。
5. `agent/created` 是 **serial 且被 await** 的：`dsh-agent` 的 `announce()` 调 `ctx.serial(...)`，cordis `EventsService.serial` 对监听器返回值 `await` ⇒ 监听器返回 Promise 会阻塞子 agent 发布（可用于"首轮前应用"）。
6. `tools/pre-execute` 是 **被 await 的 waterfall**：`dsh-tools.prepareExecution()` 先 `await this.ctx.waterfall(carrier,"tools/pre-execute",exec, …)` 再进入审批 / guard / dispatch ⇒ 插件可在 spawn 工具执行前做异步计算。
7. `session/event` 观察者是**同步调用、返回 Promise 不等待**（`invokeContainedSessionObservers` 只 catch）⇒ 不能用它阻塞首条消息投递。
8. `agentTeams.tryMembership(agent)` 是公开、非抛错方法（service 名 `agentTeams`）；`team/member` 事件在 `subagents.startActivation` **之前** journal+flush ⇒ `agent/created` 时可判断 teammate。
9. 子 agent 的 `subagent/descriptor` 只有 `version/mode/provider/label`（continuable 另含模型/persona/toolFilter），**没有 prompt**；`label` 来自工具参数 `description`。
10. 工具参数（`[源码]` 工具包实读）：
    - `spawn_teammate`: `{name, description, prompt, context, provider?…}`
    - `subagent`（spawn/fork）: `{description, prompt, cwd?, agentPreset?, provider?, model?, …}`
    - `ralph`: `{objective, maxRounds?}`（固定脚本每轮用 objective 构造 child prompt）
    - `workflow`: `{script, meta, args?}`（每个 child 的 prompt 在脚本里的 `agent(prompt)` 字面量中）

### 2.4 根因链

1. 会话开关按 `agent.id` 存取；2. 子 agent 的 `agent.id` 是它自己的新 session id；3. 插件没有 lineage 概念，把每个 agent 当独立会话；4. 宿主也不提供 skills/MCP 的委派继承。⇒ 子 agent 只能看到项目默认。

---

## 3. 目标语义（WHAT）

### 3.1 术语

| 术语 | 定义 |
|---|---|
| 对话根会话（root） | `session.header.parentSession === undefined` 的会话；即用户在 UI 里打开的对话 |
| 派生 agent | 由 root 或其派生物通过 subagent / teammate / workflow / ralph 等方式创建的 agent |
| 派生类型 | `teammate`（Agent Teams 成员，`agentTeams.tryMembership` 命中）或 `subagent`（其余有 `parentSession` 的 child） |
| 继承模式 | `none`（按项目默认）/ `inherit`（跟随直接父 agent 的生效集合）/ `inherit+auto`（继承 + Jev 收窄） |
| 生效集合 | 某个 agent 在当前会话里实际启用的 skills 名集合 + MCP 开关集合（skills 名 / `project:<key>` / `server:<serverName>`） |
| 派生快照 | `inherit+auto` 下为该 child 持久化的「Jev 选择结果」；应用时与当前父级生效集合取交集 |

### 3.2 策略与优先级

- 两种派生类型分别配置三态：`subagent`、`teammate`。
- 优先级（从高到低）：**会话级覆盖 → 项目级覆盖 → 全局默认**。
- 默认值 `[裁决]`：`subagent = inherit`、`teammate = inherit`、自动选择关闭（`inherit` 而非 `inherit+auto`）。理由：这是用户报告的"应当继承"的预期；`none` 可一键恢复旧行为。
- 改策略的生效时机：**只影响之后的 spawn 与 resume**；已 live 的 child 在父级开关变化时按 §3.4 热更新，不因策略变化被"反悔"重算（避免运行中能力集突变）。

### 3.3 生效集合计算

```
effective(root)      = lead 的显式会话覆盖 applied over 项目默认
effective(child)     = switch(policy(child.kind)):
    none             -> 项目默认
    inherit          -> effective(直接父 agent)
    inherit+auto     -> effective(直接父 agent) ∩ snapshot(child).selected
```

- `[裁决]` **baseline = 直接父 agent 的生效集合**（不是永远 root）。depth 1 时等于 lead；逐层收窄，符合最小权限，也让 auto 可组合。若父级无法解析 → 回退 root 的生效集合；root 也无法解析 → 项目默认。
- `∩` 是**收窄**：lead/父级关闭的能力不会被自动选择重新打开；自动选择只决定"在父级已启用的范围内，哪些对这个 child 的任务相关"。
- MCP 的键与现有 `jev/apply.ts` 的映射一致：项目条目 `project:<key>`、全局/外部 `server:<serverName>`。
- 快照里的 `selected` 存**保留**的能力名（不是全量开关），因此父级后续关闭的会自动消失（交集），父级后续新增的**不会**自动进入 child（child 的能力范围在 spawn 时固定）`[裁决]`。

### 3.4 热传播（运行中改开关）

- lead 在自己的能力面板改开关 → 写 root 记录 → 扇出到**同一会话树下所有 live child**：
  - MCP：重算 plan，重挂/解除 restrict；
  - Skills：reconcile 该 child 的 shadow（只应用、不写 child 记录）；
  - `inherit+auto` 的 child：用 `生效父级集合 ∩ 已存快照` 重算，**不重新请求 Jev**。
- child 的能力范围只在 spawn 时由 Jev 决定；之后父级的打开/关闭都只做交集收窄/恢复。
- 未 live 的 child：下次创建/恢复时按持久化状态计算。

### 3.5 重启 / resume

| 场景 | 行为 |
|---|---|
| 重启后 lead 恢复，再 spawn child | ✅ 继承仍生效：lineage 从 child header 解析，lead 开关从 `session-capabilities.json` 恢复 |
| 重启后 child 被 resume | ✅ 读 child 的派生快照 + 当前父级集合；无 pre-execute、不重复 Jev |
| 插件启动时已有 live agent | ✅ 对 `agents.list()` 逐个解析（父不在线走持久化 header 兜底），不依赖遍历顺序 |
| lead 会话被删除/归档且超 24h 宽限 | ❌ 父链断 → 回落项目默认 + warn；派生快照保留但无法与父级求交集（该 child 走 `none`） |
| `session-capabilities.json` 丢失/损坏 | 等同"无显式覆盖"（lead 自己也回项目默认） |
| `sessionPersistence` 不可用 | 父不在线时无法解析 → 回落项目默认；父在线时仍继承 |

### 3.6 兼容性

- 无 `parentSession` 的普通会话：行为完全不变；
- 未配置新字段的旧数据：按默认策略（`inherit`）解释 `[裁决]`；
- 降级到旧版插件：旧版只认 `sessions.<id>.{skills,mcp}`，会忽略新字段（见 §4.4）。

---

## 4. 配置与存储

### 4.1 全局 / 项目策略：新文件

`<dshHome>/dsh-capability-settings/agent-inheritance.json`（目录 0700 / 文件 0600，原子写 + 文件锁，复用 `src/shared/atomic-write.ts` / `file-lock.ts`）：

```jsonc
{
  "version": 1,
  "defaults": {
    "subagent": "inherit",          // none | inherit | inherit+auto
    "teammate": "inherit",
    "auto": {
      "threshold": 0.5,             // 与 Jev 能力决策阈值同义；可单独配
      "timeoutMs": 1500,            // pre-execute 内 Jev 超时
      "maxConcurrent": 3,           // 并发上限（团队一次性 spawn 多人时）
      "promptSource": "prompt",     // prompt（完整委派任务）| description（短描述）
      "extraContext": "none",       // none | parent-last-user（附加父会话最后一条用户消息）
      "cache": true                 // 相同 promptHash 复用结果（会话内）
    }
  },
  "projects": {
    "<项目根>": { "subagent": "inherit+auto" }
  }
}
```

- 未知 `version` → 整份忽略 + warn（不猜测迁移）。
- 读取失败/缺失 → 全部按默认值；写入失败只 warn（本次运行内仍生效）。

### 4.2 会话级覆盖与派生快照：复用 `session-capabilities.json`

在现有 `sessions.<sessionId>` 记录上**追加可选字段**（不改 `version`）：

```jsonc
"sessions": {
  "<leadSessionId>": {
    "updatedAt": 0, "headerCreatedAt": 0, "cwd": "…",
    "skills": { … }, "mcp": { … },
    "agentPolicy": { "subagent": "none", "teammate": "inherit+auto" },
    "derivedAgents": {
      "<childSessionId>": {
        "kind": "subagent",
        "mode": "inherit+auto",
        "baseSessionId": "<leadSessionId>",
        "selected": { "skills": ["figma-workbench"], "mcp": ["server:AnySearch"] },
        "auto": {
          "status": "ok",           // ok | timeout | unavailable | skipped
          "threshold": 0.5,
          "promptHash": "sha256:…", // 只存摘要，不存 prompt 本体
          "promptSource": "prompt",
          "selectedAt": 0
        }
      }
    }
  }
}
```

- 派生快照挂在**所属对话（root）**的记录下，不写到 child 自己的 session 记录（child 记录继续只作为用户显式开关的兜底容器；本方案不写）。
- `selected` 只存能力名，不含正文 / prompt；`promptHash` 只用于诊断与缓存，不落原文。
- 清理：`session-state-reconcile` 扩展为对 `derivedAgents` 做两阶段清理（child 不存在且超宽限才删）；root 记录保留期与现有策略一致。
- 降级/兼容：旧版插件读同一文件时会忽略未知字段；**但旧版写回时可能只保留已知字段**，因此降级会丢 `agentPolicy` / `derivedAgents`（可接受，文档标注；不要靠降级保住派生状态）。

### 4.3 读取顺序

1. 会话记录里的 `agentPolicy`；
2. 项目根命中 `agent-inheritance.json.projects`；
3. `agent-inheritance.json.defaults`；
4. 代码内兜底默认值（同 defaults）。

---

## 5. 实现架构（HOW）

### 5.1 模块清单

| 模块 | 类型 | 职责 |
|---|---|---|
| `src/shared/session-lineage.ts` | 新增 | 沿 `parentSession` 解析对话根 / 直接父级；live 快走 + 持久化兜底 + 进程内缓存 |
| `src/agents/policy.ts`（或 `src/agent-inheritance/policy.ts`） | 新增 | 读取/写入三级策略、解析某一 child 的 mode、派生快照读写、版本/损坏校验 |
| `src/agents/auto-select.ts` | 新增（phase 2） | `tools/pre-execute` 注册、prompt 提取、Jev 调用与超时、pending 表、绑定与持久化 |
| `src/mcp/loader.ts` | 修改 | record 增加 `ownerSessionId/ownerMeta`；hydrate/plan/读投影改用 owner；`setSessionEnabled` 规范化 + 扇出；spawn 时的继承应用 |
| `src/skills/session.ts` | 修改 | record 增加 `stateSessionId/stateMeta`；hydrate 从 owner 读；`applyInherited`（只应用不写盘）；写盘/清理只写 owner；扇出 reconcile |
| `src/index.ts` | 修改 | 组合根创建 lineage / policy / auto-select，并注入两个域与远程 RPC |
| `src/session-state.ts` | 修改 | schema 追加 `agentPolicy` / `derivedAgents`（sanitize 保留）+ 读写 API |
| `src/session-state-reconcile.ts` | 修改 | 清理 missing child 的派生快照（两阶段、宽限同现有） |
| `src/remote.ts` / `src/client/api-adapter.ts` / `src/client/*.tsx` / `src/client/styles.ts` | 修改 | 新 RPC（策略 get/set）+ 配置 UI + 会话面板入口 |
| `README.md` / `CHANGELOG.md` / `docs/architecture/skill-sources.md`（必要时） | 修改 | 实现后再写，不在本提案轮 |

### 5.2 lineage 解析

```ts
interface LineageInfo { sessionId: string; header: SessionHeader }

ownerOfSync(sessionId): LineageInfo | undefined   // 只走 live agents 链（读投影用）
ownerOf(sessionId): Promise<LineageInfo | undefined> // live 链 + sessionPersistence 兜底
ownerOfAgent(agent): Promise<LineageInfo | undefined>
```

- live 链：`ctx.get("agents").get(id)` → `agent.session.header`；`header.parentSession` 继续向上，直到无 parent。
- 持久化兜底：`ctx.get("sessionPersistence").open(parentId, "read")` → `handle.header`，`finally` 关闭；一次链路上每级最多读一次。
- 缓存：`Map<sessionId, LineageInfo>`（会话树在生命周期内不变）；插件卸载清空。
- 失败：服务缺失 / open 抛错 → 返回 `undefined`，调用方回落"自身 + 项目默认"并 warn 一次（按 sessionId 去重）。

### 5.3 两个域如何接入

**MCP（`src/mcp/loader.ts`）**

1. `SessionRecord` 增 `ownerSessionId` / `ownerMeta`（remount 首次解析后缓存）。
2. `remount(record)`：`hydrateToggles(owner.id, ownerMeta)` + `resolveSessionPlan(record.cwd, owner.id)`；挂载 / restrict 逻辑不变（仍按 agent 自己的 ctx）。
3. `setSessionEnabled`：先把入参 `sessionId` 规范化为 owner（live 链可同步；冷会话保持原 id），写盘写 owner，然后对 `sessions` 里所有 `ownerSessionId === owner.id` 的记录 `scheduleRemount`（含 root 自身）。
4. 读投影：`sessionToggleState(sessionId)` / `mcp.list` / `runtime` 的 `sessionId` 先规范化到 owner，保证子会话如果被 UI 打开时看到的是所属对话的状态。
5. `agent/created`：`mountAgent` 后 remount；监听器可返回 Promise（见 §5.5）——**skills 可在首轮前完成；MCP 挂载仍是异步收敛**（与 lead 现状一致，面板 `settling` 轮询）。

**Skills（`src/skills/session.ts`）**

1. `SessionRecord` 增 `stateSessionId` / `stateMeta`（= owner 的 id / header）。
2. `hydrateExplicit` 改为读 `stateSessionId` + `stateMeta`；写盘（`setEnabled` / 清理已删除技能）统一写 `stateSessionId`。
3. 注册 shadow 仍用 agent 自己的 ctx；registry 桥调用仍用 child 自己的 session id（保证 preset / scope 视图正确）。
4. 新增 `applyInherited(record)`（**只应用、不写盘**）：
   - 从 owner 的显式开关复制一份到 record 内存（不落盘）；
   - 对显式 off 的名字 `ensureShadow`；显式 on 的名字 `releaseShadow`（释放项目默认 shadow）；
   - 可见性预检：`listDisk(cwd)` ∪ `registry.injectedNames(agent, …)`；名字不在 child 视图里 → 跳过 + warn 一次（避免在父 preset 与子 preset 不同时造 ghost shadow）；
   - 需要新增依赖 `listDisk`（组合根已有 `diskList`，直接注入即可）。
5. 热传播：root 的 `setEnabled` 成功后，遍历同 owner 的 live records，更新其 `explicit` 副本 + 对单个名字 ensure/release（复用现有 `withQueue` 串行化）。
6. 注意：`restoreExplicit` 的"可见名字不存在则删除持久化"逻辑**只允许在 owner 自己的 UI list 路径执行**；派生记录走 `applyInherited`，绝不删 root 的键。

**派生类型判定**

```ts
function kindOf(agent): "teammate" | "subagent" | undefined {
  if (agent.session.header.parentSession === undefined) return undefined; // root
  const membership = ctx.get("agentTeams")?.tryMembership?.(agent);
  return membership?.role === "teammate" ? "teammate" : "subagent";
}
```

- `agentTeams` 服务缺失/抛错 → 一律 `subagent`（此时也不存在 teammate）；
- `tryMembership` 依赖 live registry 与 journal，`agent/created` 时已满足（`team/member` 先 flush）。

### 5.4 自动选择流水线（phase 2）

**时机**

```
spawn 工具调用
  │
  ├─(1) tools/pre-execute（waterfall，被 await）         ← 插件在这里算
  │      · exec.name / exec.arguments / exec.agent
  │      · 判定 kind、读策略、取 prompt
  │      · 父级生效集合 = effective(parent)（缓存）
  │      · Jev rank(timeout) → selected（只保留父级已启用的、score ≥ threshold）
  │      · 存 pending{parentAgentId, callId, kind, label, promptHash, selected, expiresAt}
  │      · 永远 return next()（绝不 deny / 不抛错；失败=跳过 auto）
  │
  ├─(2) 工具执行（审批 / guard / 真正 spawn）
  │
  ├─(3) agent/created（serial，被 await）                ← 插件在这里用
  │      · 解析 lineage、判定 kind、读策略
  │      · 计算最终生效集合（inherit 或 inherit+auto）
  │      · 绑定 pending（label/name/顺序）→ 写派生快照（挂在 root 记录）
  │      · 应用：skills shadow（await 完成，保证首轮前）；MCP restrict（同步）
  │      · MCP 项目挂载照旧异步；监听器绝不抛错，受总超时保护
  │
  └─(4) 子 agent 发布，首轮开始
```

**prompt 来源**（`[裁决]` 优先完整任务文本，可配为短描述）

| 派生方式 | 工具 | 用于 Jev 的文本 | 绑定 / 备注 |
|---|---|---|---|
| teammate | `spawn_teammate` | `args.prompt`（完整初始任务）；可前缀 `name` / `description` | child descriptor `label = description`，`team/member` 有 name/description |
| subagent · spawn | `subagent` | `args.prompt` | `label = args.description` |
| subagent · fork | `subagent`（fork provider） | `args.prompt`（新增指令）；**不发父会话历史** | 同上 |
| ralph | `ralph` | `args.objective`（所有轮共享） | 一次调用派生多轮 → 同一选择应用到该批 |
| workflow | `workflow` | 工具参数只有 `script` + `meta/args`；逐 child prompt 在脚本里 | 不支持逐 child 首轮前自动选择；兜底见 §7 |
| 后续消息 | `send_message` | 不重跑 Jev | 沿用已有快照；可配置"新一轮重算"（默认关） |

**绑定规则**

- primary：`parentSession == pending.parentAgentId` + 子 descriptor `label`（或 team `name` + `description`）匹配；
- 多 child 同一次调用（ralph / workflow）：按 pending 批次应用到该父级窗口内创建的全部 child（workflow 走兜底）；
- 同一父级并行 spawn：label 相同则按 FIFO 消费；仍歧义 → 放弃 auto、按 `inherit` 应用（安全降级）；
- 工具被拒绝/超时/未 spawn：pending 按 TTL（建议 60s）+ 工具结果事件清理。

**失败与成本**

- Jev 未配置 / 超时 / 报错 / 返回空 → `auto.status` 记原因，按 `inherit` 应用；
- `maxConcurrent` 限制并发 rank；相同 `promptHash` 命中会话内缓存；
- pre-execute 中执行，spawn 会因此变慢（建议 1.2–2s 上限）；对用户可见的"团队一次性 spawn 多人"要提示成本；
- 隐私：委派任务文本会发给 Jev；只存 `promptHash`，不落 prompt 本体；文档与 UI 需披露。

### 5.5 关键约束（实现时必须遵守）

1. `agent/created` / `tools/pre-execute` 监听器**绝不能抛错**（前者会让 agent 创建失败；后者会让工具执行失败），所有异常内部捕获 + warn。
2. 监听器阻塞时间必须受控：skills shadow 应用可 await（快）；MCP 挂载不要 await（保持现有 fire-and-forget + `settling` 轮询）；auto 的 Jev 有硬超时。
3. 所有写盘走 `session-state.ts` 的既有 API（原子写 + 文件锁 + 序列化队列），不直接 `fs.writeFile`。
4. 幂等：热传播重复触发不得重复注册 shadow / 重复 remount；沿用现有 `withQueue` + `sameNames` 短路模式。
5. 缓存边界：lineage / 派生快照 / 策略按 session 缓存，插件卸载时清理；不在子会话销毁时删 root 的策略。

### 5.6 RPC 与客户端 API（新增面）

| Endpoint | 入参 | 返回（`{ok:true,value}` 信封内） |
|---|---|---|
| `agentPolicy.get` | `{ sessionId?, cwd? }` | `{ global, project?, session?, effective }` |
| `agentPolicy.set` | `{ scope: "global"/"project"/"session", sessionId?, cwd?, subagent?, teammate? }` | 同 `get` |
| `agentPolicy.derived`（诊断/测试） | `{ sessionId }` | `{ children: [...] }`（只读，隐藏 promptHash 以外不含隐私） |

- 复用 `src/channel.ts` 的 `CHANNEL`，业务失败包在 `value: { ok: false, errors }`（见 `src/remote.ts` 文件头契约）。
- 客户端：`src/client/api-adapter.ts` 增加对应方法；composer 会话 api 带 `sessionId`。

### 5.7 UI（实现阶段）

| 面 | 内容 |
|---|---|
| 全局 | 主能力面板新增「派生策略」页/区：subagent / teammate 三态 + auto 选项（阈值、超时、prompt 来源）+ 成本/隐私说明 |
| 会话级 | 「本会话能力」面板头部新增「派生策略…」入口（弹窗，仅覆盖本会话）；底栏说明可显示当前有效策略（如 `派生：subagent 继承 · teammate 继承+自动`） |
| 不建议 | 不在卡片列表里逐 child 展示/编辑（自动选择是派生结果，不是用户开关） |

- 全部自绘样式进 `src/client/styles.ts`，走宿主 CSS token；实现后按仓库纪律同步 README / CHANGELOG / Figma（新增配置面需要一帧）。

---

## 6. 关键时序（验收时照此核对）

**T1 · lead 设置后 spawn（subagent / teammate）**

1. lead 改开关 → `session-capabilities.json` 写 root 记录；live child 扇出（若有）。
2. spawn 工具 pre-execute：判 kind/mode；auto 时取 prompt → Jev → pending。
3. child `agent/created`：解析 owner（= lead 或直接父）→ 读策略 → 计算生效集合 → 应用 shadow / restrict → 写派生快照（auto）。
4. 子 agent 首轮：skills 已一致；MCP 挂载异步收敛（与 lead 现状一致）。
5. 子 agent 调用被 lead 关闭的 MCP 工具 → 被 `tools.restrict` 拒绝；被关闭的 skill 不出现在其 skill 视图。

**T2 · 运行中改 lead 开关**

1. root 写盘成功 → 扇出所有同 owner 的 live records；2. 各 child 重算 plan / 重注册 shadow；3. 不重新跑 Jev（auto 用交集）。

**T3 · 重启后**

1. 插件加载 → 补登记 live agents → lineage 解析（父不在线走持久化）。
2. lead 恢复 → 读 root 开关；child resume → 读 root 下派生快照 + 当前集合 → 重放。
3. 新 spawn → 同 T1。

**T4 · 自动选择失败/超时**

1. pre-execute 超时 → 记 `auto.status=timeout`；2. 仍 `return next()`；3. `agent/created` 按 `inherit` 应用；4. 不阻塞、不弹错。

---

## 7. 边界与降级

| 场景 | 行为 | 备注 |
|---|---|---|
| root 不在线 / 无法读持久化 | 回落项目默认 + warn 一次 | 不阻塞 spawn |
| root 已删除/归档（超宽限） | child 走 `none` | 派生快照保留但无法求交集 |
| 父级与子级 `agentPreset` 不同 | 名字不在子视图 → 跳过并 warn | 用户真实数据里 teammate 是 `cordis` preset |
| workflow 逐 child 自动选择 | phase 1 不支持；child 按 `inherit`，auto 可选"脚本字面量"实验开关 | 见 §10 Q7 |
| ralph | 用 objective 统一选择，应用到该批 child | 同一调用多轮 |
| 并行 spawn / label 冲突 | 歧义 → 放弃 auto，按 `inherit` | 安全优先 |
| Jev 未配置 / 超时 / 报错 | 按 `inherit`，`auto.status` 记录 | 永不阻塞 |
| 审批/guard 拒绝了 spawn | pending TTL 清理，无副作用 | 浪费一次 rank |
| `agentTeams` 服务缺失 | teammate 策略不生效；全部按 subagent 处理 | Agent Teams 未启用的 profile |
| `sessionPersistence` 缺失 | 父不在线时无法解析 → 项目默认 | live 父链仍正常 |
| 工具改名 / 参数形状变化 | 自动选择 fail-open（只继承）；配置项可扩展工具名集合 | DSH 升级风险 |
| out-of-process 子 agent | 不覆盖 | 需要宿主级委派能力策略 |
| 子会话在 UI 被打开 | 面板显示/编辑的是所属对话（owner）的配置 | 读投影规范化 |
| 降级旧版插件 | 新字段被忽略/可能被旧版写回丢弃 | 不承诺降级保住派生状态 |

---

## 8. 测试与验收

### 8.1 单元 / 集成（`notes/verify/`，假 ctx + 真模块）

| 编号 | 断言 |
|---|---|
| INH-1 | live 链解析 root；深度 2 的 child 得到直接父（深度 1）的生效集合 |
| INH-2 | 父不在线时用 `sessionPersistence.open` 兜底；持久化不可用 → 项目默认 |
| INH-3 | MCP：lead 关闭全局 server → child 的 `tools.restrict` deny 名单包含它；lead 恢复 → 撤销 |
| INH-4 | MCP：lead 关闭 project 条目 → child 不挂载；恢复 → 挂载 |
| INH-5 | Skills：lead 关闭磁盘技能 + 注入技能 → child 作用域各注册 shadow；恢复 → 解除 |
| INH-6 | 运行中 lead 改开关 → live child 热更新；无重复注册（幂等） |
| INH-7 | 策略优先级：会话 > 项目 > 全局；`none` = 旧行为 |
| INH-8 | 无 `parentSession` 的会话行为与现状完全一致（回归） |
| AUTO-1 | pre-execute 捕获 `spawn_teammate` / `subagent` 的 prompt，Jev 调用一次（假端点） |
| AUTO-2 | `agent/created` 绑定正确 child；首轮前 skills 生效；派生快照落到 root 记录 |
| AUTO-3 | 候选只来自父级启用集合（不被重新打开）；阈值边界 |
| AUTO-4 | Jev 超时/500/空返回 → `inherit` 应用，spawn 不失败 |
| AUTO-5 | 并行 spawn / label 冲突 → 放弃 auto，按 inherit |
| AUTO-6 | 重启/resume 不重复调用 Jev，复用快照 |
| AUTO-7 | 派生快照 GC：child 不存在超过宽限才删 |
| RESTART-1 | 重启后新 spawn 继承；resume 的 child 继承 |
| UI-1 | 全局/项目/会话三级配置的 get/set RPC 与校验；损坏文件降级 |

### 8.2 真机（隔离环境）

- 独立 `DSH_HOME`（如 `.verify-home/`）+ 独立端口 + 桌面同版本外壳；
- 用 `docs/verify` 里的 fake Jev 端点或真实 key（由用户提供）跑 auto；
- 验收：lead 关 AnySearch/某 skill → 7 人团队 spawn → 逐个确认 teammate 无法调用/看不到；改 lead → 运行中 teammate 收敛；重启 → 新建/resume 仍继承。

### 8.3 回归

- `bash notes/verify/run-all.sh` 全绿；
- `bash notes/verify/jev-capability-decision/run-all.sh` 全绿（auto 复用其 fake-jev 夹具）；
- `pnpm typecheck` + `pnpm build`。

### 8.4 验收清单（用户可见语义）

- [ ] lead 的"当前对话"开关对**之后派生**的 subagent / teammate 生效；
- [ ] 对**运行中**的派生 agent 改 lead 开关能收敛；
- [ ] **重启/resume** 后仍生效；
- [ ] 可配置派生类型的三态；`none` 恢复旧行为；
- [ ] `inherit+auto` 只收窄、不越权；Jev 失败自动降级为继承；
- [ ] 派生 agent 能力范围在 spawn 时固定（父级后续新增不自动扩权）；
- [ ] 无 `parentSession` 的会话行为不变。

---

## 9. 分阶段交付与工作量（粗估）

| 阶段 | 内容 | 预估 |
|---|---|---|
| Phase 1 | lineage + 策略存储/RPC + 两域 `inherit` + 热传播 + 会话/全局配置 UI + 单测/真机 + 文档 | 600–900 行 src + 测试；2–3 工作日 |
| Phase 2 | `tools/pre-execute` 自动选择流水线 + 派生快照 + 成本/超时/缓存 + AUTO 测试 | 400–600 行；约 2 工作日 |
| Phase 3（可选） | workflow 逐 child、out-of-process（需上游）、Figma 配置面同步 | 视范围 |

**风险**

| 风险 | 缓解 |
|---|---|
| 默认 `inherit` 改变现有行为 | 文档标注 + 一键 `none` + CHANGELOG 语义说明 |
| 监听器阻塞 spawn | 硬超时 + 失败即继承 + 仅 auto 模式执行 |
| 工具名/参数耦合 | 配置化工具集合 + 参数形状判定 + fail-open |
| 派生快照与父级交集语义误解 | UI 说明"范围在 spawn 时固定；父级关闭永远收窄" |
| 持久化降级 | 新字段 additive；不承诺旧版保住派生状态 |
| Agent Teams 实验包变动 | 服务缺失即降级；`tryMembership` 调用包 try/catch |

---

## 10. 待决问题（实现前需要拍板）

| # | 问题 | 建议 |
|---|---|---|
| Q1 | 默认模式？ | `subagent/teammate = inherit`；auto 默认关 |
| Q2 | baseline 用 root 还是直接父级？ | 直接父级（逐层收窄；纯继承时等价于 root） |
| Q3 | auto 是否允许重新开启 lead 关闭的能力？ | 不允许（只收窄） |
| Q4 | prompt 来源？ | direct tools 用完整 `prompt`；提供 `description` 选项 |
| Q5 | 配置粒度？ | 全局 + 项目 + 会话三级（会话 > 项目 > 全局） |
| Q6 | UI 入口？ | 主面板新增「派生策略」页；会话面板头部「派生策略…」弹窗 |
| Q7 | workflow / ralph 的支持程度？ | ralph 用 objective；workflow 暂不逐 child auto（可后续加实验开关） |
| Q8 | 是否需要"某个 child 手动覆盖"？ | 本方案不做，后续再议 |

---

## 11. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v0.1 | 2026-10-28 | 初稿（提案，未实现）：接入证据、三态策略、会话树继承、pre-execute + agent/created 两段式自动选择、存储/降级/测试/待决 |

---

## 附录 A · 本机真实复现数据

- 会话日志：`/Users/lzx/.dsh/sessions/--Users-lzx-Documents-GitHub-dsh-htdot-bridge--/session-d4d2e505-5cc6-4322-8186-38f472fee03f/session.v4.jsonl.zstd`
- 子会话（7 个，header 均含 `parentSession: session-d4d2e505…`、`origin: "subagent"`、`delegationDepth: 1`、`agentPreset: "cordis"`）：
  `969b896d-…`（scout）、`397fbb37-…`（architect）、`c327a0e9-…`（pm）、`430ada3c-…`（ux）、`1a5bbb82-…`（backend）、`78471a58-…`（frontend）、`b2cc76d9-…`（devops）。
- `~/.dsh/dsh-capability-settings/session-capabilities.json`：lead 记录 143 skill 键（142 false / 1 true）、9 个 MCP 键；上述 7 个 child 均无记录。
- `~/.dsh/dsh-capability-settings/capability-overrides.json`：`projects` 为空 ⇒ 子 agent 落到"默认全开"。
- 该团队的 lead 日志中 `team/member` 事件（seq 174 起）早于 `subagent/catalog` 事件，证明 membership 在 child 创建前已可见。

## 附录 B · 宿主源码取证（DSH 0.2.1-rc.2，app.asar 提取）

| # | 包 / 符号 | 事实 | 对本方案的意义 |
|---|---|---|---|
| B1 | `@deepseek-ai/dsh-agent` · `AgentRegistry.enter()` | `if (id !== agent.session.id) throw …` | `agent.id = session.id`，子 agent 有独立 id |
| B2 | `@deepseek-ai/dsh-subagent` · `childSessionMeta()` | `parentSession: parentHeader.id` | 父子关系的权威来源 |
| B3 | `@deepseek-ai/dsh-agent-loop` · `ReactLoopAgent` 构造函数 | `this.scope = createScope(loopCtx, this)`（无 parent） | agent scope 不嵌套，必须逐 agent 应用 |
| B4 | `@deepseek-ai/dsh-subagent` · `captureDelegatedPolicyOverrides()` | 仅 sandbox / approval / permissionPreset | 宿主不会替我们继承 skills/MCP |
| B5 | `@deepseek-ai/cordis` · `EventsService.serial()` | `const result = await cb(...args)` | `agent/created` 可阻塞到我们完成 |
| B6 | `@deepseek-ai/dsh-tools` · `prepareExecution()` | `await this.ctx.waterfall(carrier,"tools/pre-execute",exec, …)` 在 dispatch/审批前 | 可在 spawn 前用 `exec.arguments` 跑 Jev |
| B7 | `@deepseek-ai/dsh-session` · `Session.commit()` / `invokeContainedSessionObservers()` | 观察者同步调用、返回 Promise 不 await | 不能用 `session/event` 阻塞首条消息 |
| B8 | `@deepseek-ai/dsh-experimental-agent-team` · `TeamService` | service 名 `agentTeams`；公开 `tryMembership(agent)`；`team/member` 先 flush 再 `startActivation` | 可区分 teammate / subagent，且创建前可判定 |
| B9 | `@deepseek-ai/dsh-subagent` · `descriptor` | 字段仅 `version/mode/provider/label`（continuable 另含模型/persona/toolFilter） | 创建时拿不到完整 prompt，只能用 label |
| B10 | `@deepseek-ai/dsh-tool-subagent` / `dsh-experimental-tool-agent-team` / `dsh-tool-ralph` / `dsh-tool-workflow` | 工具参数与 label 来源见 §2.3 第 10 条 | prompt 提取与绑定依据 |

## 附录 C · 本仓库落点

- 会话状态：`src/session-state.ts`（记录形状、原子写、文件锁、`verifySession`）
- 孤儿对账：`src/session-state-reconcile.ts`（两阶段、24h 宽限、disposed 只标记）
- MCP：`src/mcp/loader.ts`（`mountAgent` / `remount` / `setSessionEnabled` / `sessionToggleState`）、`src/mcp/manager.ts`（读投影）
- Skills：`src/skills/session.ts`（`track` / `hydrateExplicit` / `ensureShadow` / `releaseShadow` / `applyProjectDefaults` / `restoreExplicit` / `setEnabled`）
- 组合根：`src/index.ts`（`sessionState`、`diskList`、loader / skillSessions 装配）
- RPC / 客户端：`src/remote.ts`、`src/channel.ts`、`src/client/api-adapter.ts`、`src/client/composer-capability.tsx`、`src/client/styles.ts`
- 现有测试设施：`notes/verify/lib/fake-ctx.mjs`、`notes/verify/jev-capability-decision/fake-jev.mjs`、`notes/verify/run-all.sh`
