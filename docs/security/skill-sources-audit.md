# 注入 skill 来源 / 启停 / 资源读取 · 安全与契约审计

- 任务：`task-6`（security，只读审计；写作用域仅 `docs/security/**`）
- 审计对象：`task-2`（宿主：registry 桥 / 项目与会话启停 / 详情与资源回退）与 `task-3`（客户端：来源标签 / 只读详情 / 资源懒加载 / 能力决策来源）的**工作区未提交改动**
- 基线：`git HEAD af52863` + 工作区改动（`git status` 见 §6.1）；架构契约 `docs/architecture/skill-sources.md`（未提交新文件）
- 日期：2026-10-25
- 结论：**无 CRITICAL / 无 HIGH**；MEDIUM 3 条、LOW 9 条。安全门可 PASS，但其中 2 条 MEDIUM 会直接影响验收（AC-6、RB-8），另有 1 条 MEDIUM 是状态完整性问题；建议 Lead 在收尾前处理或显式记入已知限制（见 §8）。

---

## 1. 结论摘要

| 级别 | 数量 | 是否阻断安全门 |
|---|---|---|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 3 | 否（但影响 AC-6 / RB-8 / 会话状态一致性，见各条） |
| LOW | 9 | 否（纵深防御 / 硬化 / 文档契约） |

最关键的三条：

1. **SEC-1（MEDIUM，frontend）**：客户端 `readResource` 对成功响应做了**双重解包**，注入技能的资源文件浏览 100% 失败（服务端边界本身正确）。实测复现见 §6.2。
2. **SEC-2（MEDIUM，architect/Lead）**：架构契约定义 `origin:"disk"`，实现（按 Lead 裁定 R3）**不引入**该值并对未受管 filesystem 条目返回 `undefined`。tester 若按契约 RB-8 写用例会得到稳定“失败”，属契约漂移而非代码缺陷，**必须先裁决**。
3. **SEC-3（MEDIUM，backend）**：插件卸载/reload 后，已注册的会话 shadow **不会解除且无簿记**（`dispose()` 不调 disposer；`releaseShadow` 在本地无 disposer 时直接返回成功）⇒ UI 显示“已启用”、技能实际仍被隐藏，且用户无法再打开。

---

## 2. 审计方法与证据等级

- 全文标注沿用契约文档约定：`[F]` = 实读代码/实测；`[I]` = 由 `[F]` 推理；`[A]` = 假设/未验证。
- 静态审计：逐行读 `src/skills/{registry,session,manager,types,validate,disk,crud,transfer}.ts`、`src/overrides/**`、`src/shared/{atomic-write,file-lock,json-config,config-location,skill-sources}.ts`、`src/remote.ts`、`src/index.ts`、`src/jev/{apply,rank,types}.ts`、`src/client/{api,api-adapter,panel,composer-capability,skill-content,markdown}.tsx`，并以宿主 `@deepseek-ai/dsh-skill`（devDep `0.2.0-rc.1`，与契约 §13-R1 同源）核对 `register` / `registerProvider` / 校验语义。
- **动态验证（只读，不改仓库）**：用 `tsc` 把 `src/skills/registry.ts`、`src/client/api-adapter.ts` 单独编译到 `/tmp/sec-audit/**`，配合 fake `ctx.skills` 与 fake rpc 实跑边界用例。命令与真实输出见 §6。
- 未做的验证：真机 GUI / 插件热重载 / 跨进程并发；Figma 与视觉；MCP 域行为（本次无改动，见 §3.6）。

---

## 3. 覆盖声明（按 task-6 的 6 个审计重点逐条）

### 3.1 registry 数据进入宿主后的信任边界 — 覆盖，无 HIGH/CRITICAL

| 检查项 | 结论 | 依据 |
|---|---|---|
| registry 名字是否被用于**写盘 / 写配置** | **无**。注入行只生成内存摘要；唯一由 registry 值拼出的文件名在 `exportSnapshot`（见 SEC-6），当前不可达 | `registry.ts:534-553`（`toSummaryView` 不下发 `root`）、`registry.ts:843-854`、`manager.ts:222-246` |
| registry 名字是否被用于**注册 shadow** | 是，但受宿主文法校验：`skills.register()` 先 `validateRuntimeSkill`（非法名直接 throw），本插件 catch 后收敛成业务失败 | `session.ts:279-291`；`node_modules/@deepseek-ai/dsh-skill/lib/index.js:193-199,465-470` |
| `isSkillName` 是否仍在 | **在**，且覆盖所有以 `root + name` 定位文件的入口（create/update/remove/read/clone）+ overrides 写入 | `skills/validate.ts:12-22`、`crud.ts:27-38,82,98,105,144`、`overrides/manager.ts:90-92` |
| 恶意 name 注入 / 路径穿越 | 名字进文件路径的入口均有 `nameGuard`；registry 侧名字经宿主 `SKILL_NAME` 校验，非法名无法进入视图 | 同上；`dsh-skill/lib/index.js:452-463,465-470` |
| 恶意 provider/channel **伪造来源** | **存在（LOW）**：来源标签完全信任 provider/source 自述，无法验证注入方身份 ⇒ 见 SEC-11 | `registry.ts:480-512` |
| 字段撑爆 / 无上限 | **存在（LOW）**：注入行数量、`description`/`channel`/正文长度均无上限，`lastGood` 未按契约 §5.8 限 256 行 ⇒ 见 SEC-8 | `registry.ts:337,555-608` |
| 日志注入 | **存在（LOW）**：overrides 名单里的名字可含内嵌换行，进入 `logger.warn` 文案 ⇒ 见 SEC-9 | `session.ts:234-239,429-433`；`overrides/config-file.ts:31-43` |

### 3.2 项目级默认启停配置（`capability-overrides.json` 的 `skills` 列表）— 覆盖

| 检查项 | 结论 | 依据 |
|---|---|---|
| 原子写 | ✅ 复用 `atomicWriteText`（临时文件 + rename，随机后缀） | `overrides/config-file.ts:78-85`、`shared/atomic-write.ts:38-49` |
| 文件锁 / 并发写 | ✅ 读-改-写整段在 `withFileLock(loc.writeFile)` 内；同进程串行。跨进程竞争是既有已知限制（`file-lock.ts:9-11` 头注释） | `overrides/manager.ts:93-104` |
| 幂等/重建不丢其它域 | ✅ `next` 按 `DOMAIN_KEYS` 重建，`mcp` 不会被 `skills` 覆盖；空数组不落盘 | `overrides/manager.ts:96-101`、`config-file.ts:78-83` |
| schema 校验 | ✅ 读取时：域值非数组 / 含非字符串 ⇒ 抛带文件名错误（`sets()` 吞错降级、`toggle()` 暴露错误）；写入时：`skills` 域只接受 kebab-case | `config-file.ts:53-72`、`overrides/manager.ts:57-65,90-92` |
| 未知名字 | ✅ 只 warn 跳过、不写文件（`applyProjectDefaults` 的 `knownInjected` 门槛 + 3 次重试后 warn） | `session.ts:406-437` |
| 路径穿越 | ✅ `skills` 域 key 经 `isSkillName` 校验后才拼入列表（列表值不参与路径）；`mcp` 域 key 为任意字符串但不参与路径 | `overrides/manager.ts:82-92` |
| 大小限制 / 条目上限 | ❌ **无（LOW）** ⇒ SEC-8 | `config-file.ts:31-43,78-85` |
| 写失败回滚 | ✅ 原子写保证无半写；文件写失败时不动内存状态。⚠️ 但“文件已写成功、reconcile 失败”会被当 toggle 失败返回 ⇒ SEC-10 | `index.ts:130-145` |

### 3.3 read/export fallback 与资源读取边界 — 覆盖，实测通过（除 SEC-5/SEC-6/SEC-7 硬化项）

| 检查项 | 结论 | 依据 |
|---|---|---|
| `ctx.skills.get` 的 scope/cwd 选择 | ✅ live 会话才传 `scope: agent`（不自行构造 scope key）；冷会话退化为无 scope。`sessionId` 由调用方传入并最终映射到该 session 的 agent，不把 agent 对象暴露给客户端 | `registry.ts:664-675,362-369`；`session.ts:597-599` |
| 资源基准只来自宿主、不接受客户端 | ✅ 客户端只传 `path`；`base` 恒来自 `definition.resourceBase` | `registry.ts:765-787` |
| `..` / 绝对路径 / 反斜杠 / 空段 | ✅ 全部 `escape`（实测 5/5 拒绝） | `registry.ts:754-762,783-790`；§6.3 |
| 符号链接逃逸 | ✅ 目标 `lstat` 拒绝 symlink + `realpath(root)`/`realpath(target)` 前缀复核（实测文件符号链接、目录内符号链接均拒绝） | `registry.ts:791-810`；§6.3 |
| 大小上限 | ✅ 单文件 256 KiB（实测 300 KiB `too-large`） | `registry.ts:221-222,812-825` |
| 二进制/非 UTF-8 | ✅ `TextDecoder("utf-8",{fatal:true})` ⇒ `not-text`（实测） | `registry.ts:833-838`；对照 `disk.ts:159-168` 的宽松读法 |
| 资源清单上限 | ✅ 一层 200 条（`RESOURCE_LIST_LIMIT`） | `registry.ts:224-225,704-715` |
| 错误信息泄露绝对路径 | ✅ `escape` 文案不含解析后路径 | `registry.ts:788-790,808-810` |
| TOCTOU（lstat/realpath/stat → readFile） | ⚠️ 存在窗口（LOW，需本地同用户写权限） ⇒ SEC-7 | `registry.ts:791-839` |
| `export` 的 destDir / name | ⚠️ `name` 未再校验、`destDir` 由客户端给（既有能力面） ⇒ SEC-6 | `manager.ts:222-246,405-428` |
| 冷会话 preset 详情 | ✅ 无法读到即降级为“无详情”，客户端给通用文案；但契约里的 `requires-session` 从未产生 ⇒ SEC-10 | `registry.ts:718-752`；`api.ts:148-160` |

### 3.4 session shadow：幂等、双桶记账、dispose、冷会话 — 覆盖，1 条 MEDIUM

| 检查项 | 结论 | 依据 |
|---|---|---|
| 注册幂等 | ✅ `ensureShadow` 先查两个桶；`withQueue` 串行化同一 session 的写 | `session.ts:246-261,223-231` |
| 双桶（显式 vs 项目默认）重复/错删 | ✅ 同一名字只登记一个桶；`ensureShadow` 会按驱动源 re-bucket；`releaseShadow` 同时清两桶 | `session.ts:246-261,331-348,350-356` |
| read-after 校验（消灭“假成功”） | ✅ register 后复核胜者是否本插件 shadow；`false` 时回滚簿记并返回业务失败；`undefined`（无法判定）按成功处理 | `session.ts:298-327` |
| agent dispose 清理 | ✅ 不手动 dispose（效果随 agent fiber 回收），只删 Map + 清缓存 | `session.ts:474-482`（注释 `:120-124` 同义） |
| 冷会话不写 | ✅ `find()` 找不到 record ⇒ `setEnabled` 返回业务失败；`list()` 的 merge 退化为无 scope | `session.ts:538-539,504-510` |
| 插件卸载/reload | ❌ **MEDIUM**：`dispose()` 不解除已注册 shadow、不调 disposer ⇒ SEC-3 | `session.ts:606-622,331-348` |
| 名字成员校验 | ⚠️ LOW：`setEnabled` 不校验名字是否为已知注入/磁盘技能 ⇒ SEC-4 | `session.ts:531-577` |

### 3.5 Jev：注入技能 id/name 冲突、筛选语义、回滚 — 覆盖，无 MEDIUM/HIGH

| 检查项 | 结论 | 依据 |
|---|---|---|
| 同名 id 冲突 | ✅ 面板/会话列表先做“磁盘优先”去重，注入行不与其同名；`add()` 仍对重复 id 保留先到者并 warn | `registry.ts:584`、`session.ts:516`、`jev/apply.ts:239-246` |
| 筛选语义误关不可切换项 | ✅ `planTargetOps` 先 `if (!cap.applicable) continue`；未勾选只对 applicable 子集写 `enabled:false`；`applicable` 计算对注入行与磁盘行一致 | `jev/apply.ts:533-540,249-278,886-895` |
| 冷会话排队重放不误关新出现的 preset 技能 | ✅ 结构性安全：`resolvePlanned` 只遍历 `plan.ops`（入队时冻结），不遍历重放时刻新增能力 | `jev/apply.ts:86-99` 注释、`:624-660`、`:738-760` |
| 注入技能写回 | ✅ 仍走 `setSessionEnabled`（不新增写面）；`write` 仍 `{type:"skills",name}` | `jev/apply.ts:374-390` |
| 回滚 | ⚠️ LOW：`restoreOne` 把“跟随项目默认”落成显式布尔，状态保真度下降 ⇒ SEC-12 | `jev/apply.ts:427-444` |
| 注入字段是否只做展示 | ✅ `origin/channel/provider/contentReadOnly` 不进入 id/筛选 | `jev/types.ts:160-186`；`jev/rank.ts:311-325` |

### 3.6 契约一致性（RPC 信封 / 客户端字段 / MCP 未改）— 覆盖，2 条 MEDIUM/LOW

| 检查项 | 结论 | 依据 |
|---|---|---|
| 传输层恒 `{ok:true, value}` | ✅ 新增 `skills.readResource` 走同一 `handleEndpoint`；业务失败包在 `value:{ok:false,errors,code}` | `remote.ts:127-215`（`:144-147` 新增） |
| 业务失败不直出通道失败信封 | ✅ 未发现新的直出；`failure()` 仅用于未知 endpoint/异常 | `remote.ts:45-47,212-214` |
| 客户端字段兼容（旧宿主缺字段） | ✅ `toSummary` / `overrides.get` 对缺失字段整体不输出或空清单回落 | `api-adapter.ts:561-635,432-446` |
| 客户端解包 | ❌ **MEDIUM**：`readResource` 成功支双重解包 ⇒ SEC-1 | `api-adapter.ts:107-124,173-201` |
| 未改 MCP 行为 | ✅ `git status` 无 `src/mcp/**`；`remote.ts` mcp 段未动；`grep` 无新增 mcp 分支 | §6.1 |
| 写操作对注入行拦截 | ⚠️ 已实现（服务层重查 registry），但存在两个绕过面 ⇒ SEC-5 | `manager.ts:179-210,251-284`；§6.4 |
| 契约文档 vs 实现 | ❌ **MEDIUM**：`origin:"disk"` 漂移 ⇒ SEC-2 | 见 SEC-2 |

### 3.7 未覆盖 / UNVERIFIED

| 项 | 状态 |
|---|---|
| 插件热重载后 agent 层 shadow 的真实生命周期（SEC-3 的运行期部分） | **UNVERIFIED**：需真机 GUI + profile patch 热重载；代码证据为 `[F]`，后果为 `[I]` |
| TOCTOU 实际可利用性（SEC-7） | **UNVERIFIED**：需本地同用户对资源目录写权限的对抗测试；仅推理 |
| `connection.requestRejection` 的认证/来源校验强度 | **UNVERIFIED**（宿主实现，本次未改；沿用既有通道） |
| Figma/UI 视觉一致性、跨版本外壳兼容 | 不在安全审计范围（由 task-5 / frontend 负责） |
| MCP 域、Jev 配置/密钥路径 | 本次无改动（`git status` 佐证），未重复审计 |

---

## 4. 发现清单

> 约定：「阻断」= 是否阻塞本次交付的质量门/验收；**安全门**指 CRITICAL/HIGH 为 0。所有发现均由 security 升级，**不修复**。

### SEC-1 — [MEDIUM] 客户端 `readResource` 成功响应被双重解包，资源浏览恒失败

- **文件:行**：`src/client/api-adapter.ts:173-201`（`unwrap` 定义 `:107-124`，`rpc` `:73-104`）
- **证据**：`unwrap()` 已把 `{ok:true, value:{ok:true,path,size,content}}` 解成业务对象本身；`:190` 仍从 `result.value` 取字段 ⇒ `value = {}` ⇒ 恒返回 `{ok:false, errors:["资源读取返回了非法结果"]}`。用 `tsc` 编译该适配器 + fake rpc 实测：
  - 成功响应 → `{"ok":false,"errors":["资源读取返回了非法结果"]}`
  - 失败响应 → `{"ok":false,"errors":["资源路径不允许"],"code":"escape"}`（失败支正常）
  - 对照 `skills.read`（同文件 `:150-172`）正常返回详情
  - 构建产物同样带此缺陷（审计期间工作区已有 `lib/**` 重建）：`lib/client/api-adapter.js:126-128`，即当前 `lib` 会把它一起发出去。
- **影响**：注入技能详情页的资源文件永远打不开 ⇒ AC-6 / L-3 / tester e2e 必失败；服务端路径边界本身正确（§6.3），所以**不是安全缺口**，但是功能阻断。
- **修复建议**：成功支改为直接使用 `const value = (result as unknown as Record<string, unknown>)`（或改为 `const inner = result as any; inner.path/inner.content`），与 `toSkillDetail` 的“两种输入都兼容”写法保持一致。
- **责任角色**：frontend
- **阻断**：是（阻塞 AC-6 验收；不阻塞安全门）

### SEC-2 — [MEDIUM] 契约文档与实现不一致：`origin:"disk"` 未实现

- **文件:行**：实现 `src/skills/types.ts:95`（`SkillOrigin = "bundled"|"plugin"|"preset"`）、`src/skills/registry.ts:459-463,496-507`（注释声明“Lead 裁定 R3：不引入 `origin:"disk"`”，`filesystem` 非 preset/bundled 返回 `undefined` 即不合并）；契约 `docs/architecture/skill-sources.md:216,309,334-338,500-506,869`（§3.1 类型 / §4.1 映射表 #7 #9 / §5.6 整节 / §11 RB-8 用例）
- **证据**：实测 fake snapshot 里 `source:"project-agents",provider:"filesystem"` 的行**不会**出现在合并结果（既不显示也不报错）；而契约 §5.6 要求归 `origin="disk"`、`contentReadOnly=true` 展示。同理 RB-8 期望 `origin="disk"` 在实现里永远不成立。
- **影响**：tester 按契约写 RB-8 会稳定失败并被误判为代码缺陷；“registry 有、面板没扫到”的磁盘条目在面板不可见（UX 降级，未记录在契约里）。
- **修复建议**：Lead 裁决（二选一）：(a) 契约回写“R3 决策：不引入 disk，未受管 filesystem 条目不在面板展示”；(b) 实现补 `origin:"disk"`（含 UI 标签与 RB-8）。裁决后同步 §3.1/§4.1/§5.6/§9.1/§11。
- **责任角色**：architect（文档）+ Lead（裁决）
- **阻断**：是（阻塞 tester 的 RB-8 判定与架构门一致性；不阻塞安全门）

### SEC-3 — [MEDIUM] 插件卸载/reload 后会话 shadow 泄漏：无簿记、无法解除、“假成功”

- **文件:行**：`src/skills/session.ts:606-622`（`dispose()` 只清 timers 与 Map，**不调用**任何已记录的 disposer）、`:331-348`（`releaseShadow` 在 `record.shadows`/`record.projectShadows` 都没有条目时直接 `{ok:true}`）、`:298-327`（read-after 校验只在**注册**时执行）
- **推理 `[F]→[I]`**：`skills.register()` 的 disposer 是挂在该**调用方 ctx**（agent ctx，见 `session.ts:9-12` 注释与 `dsh-skill/lib/index.js:193-220` 的 `layers.effect(this.ctx,…)`）上的效果；插件 fiber 卸载不会回收 agent fiber 上的效果 ⇒ 旧 shadow 继续遮蔽该名字 `[I]`。
- **后果**：重载后新实例的 sessions 为空 ⇒ `enabledInSession = !shadowed(record)` 显示 `true`（“已启用”），但模型目录里该技能仍是本插件 shadow（`invocation` 双向 false）；用户点“开启”走 `releaseShadow`，本地无 disposer ⇒ 返回成功但状态不变；同层 runtime 先到先得使后续同名注册变 no-op，**本会话无法真正恢复** `[I]`。
- **影响**：状态完整性/可用性（fail-closed 方向），并违反仓库自设的“消灭假成功”不变式（`session.ts:24-27`）。不影响权限边界。
- **修复建议**：① `dispose()` 对 `record.shadows`/`record.projectShadows` 记录的所有 disposer 做 best-effort 调用（try/catch），再清 Map；② `setEnabled(enabled:true)` 在本地无记录时用 `registry.verifyShadow(...)` 复核，若胜者仍是本插件 shadow 则返回业务失败并提示“需要新会话/重启会话”，而不是假成功。
- **责任角色**：backend
- **阻断**：否（建议修或写进 CHANGELOG 已知限制；不阻塞安全门）

### SEC-4 — [LOW] `setSessionEnabled` 不校验名字是否为已知技能 ⇒ 可注册“幽灵 shadow”占用名字槽

- **文件:行**：`src/skills/session.ts:531-577`（入口只做非空校验）、`:279-291`（register 由宿主文法校验，合法 kebab 名即可注册）
- **证据**：`setEnabled({sessionId, name:"any-kebab-name", enabled:false})` 会为该名字在 agent 层注册 `provider:"runtime"`、`description=SHADOW_DESCRIPTION`、`content:""`、双向 false 的 runtime 技能；`isOwnShadow` 过滤使其在面板中不可见（`registry.ts:583`），若该名字当时不在 registry 中，则**之后**同层的同名 runtime 注册会因 first-wins 被忽略并拿到 no-op disposer（`dsh-skill/lib/index.js:196-200`），导致该 skill 在本会话不可用。
- **影响**：需要已认证的本地 GUI 调用方（自伤/自 DoS），无权限提升；map 与 agent 层条目可被批量名字撑大（见 SEC-8）。
- **修复建议**：`setEnabled(enabled:false)` 先 `registry.inspectName(name,{cwd,sessionId})` 或 `injectedNames`/磁盘 list 判定“已知技能”，未知名字返回业务失败（`not-found`）。
- **责任角色**：backend
- **阻断**：否

### SEC-5 — [LOW] §7.4「注入行写拦截」存在两个绕过面

- **文件:行**：
  - (a) 判定名与实际写入名不一致：`src/skills/manager.ts:258-263`（`update` 用 `input.name` 判定）vs `src/skills/crud.ts:97-110`（写盘路径用 `options.name`，而 frontmatter 用 `options.spec.name`；`writeSkill` `disk.ts:180-185`）。
  - (b) preset 层名字在**无 sessionId** 时不可识别：`src/skills/registry.ts:636-662`（`viewSnapshot` 无 agent 时不含 preset 层；`globalSnapshot` 也不含）⇒ 实测 `inspectName("preset-skill", {})` 返回 `undefined` ⇒ `rejectInjectedWrite` 放行（`manager.ts:197`）。
- **证据**：实测输出 `inspectName(preset-skill, 无 sessionId) = undefined`；`inspectName(preset-skill, sessionId=s1) = injected`。名字不一致面为静态代码证据（`create` 用 `spec.name` @ `crud.ts:82`，`update` 用 `options.name` @ `crud.ts:109`）。
- **影响**：已认证 GUI 调用方可 (a) 用一个存在的磁盘技能名 `update`，把 frontmatter `name` 写成某个注入技能名 → 生成 rank 更高的项目磁盘副本，覆盖该注入技能在本项目的表现；(b) 对 preset 层技能名直接 `create` 项目副本。两者都能使“内容只读”承诺失效。**不越过本机用户权限边界**（可直接改文件），属纵深防御缺口。
- **修复建议**：`rejectInjectedWrite` 对 `update` 同时检查 `input.spec.name`；或 `updateSkill` 强制 `spec.name === options.name`（不一致时拒绝）。`inspectName` 在没有 sessionId 时把“已知 preset 名字集合”视为不可判定 ⇒ 对 `create/update` 采取更保守策略（若名字不在磁盘视图且 registry 视图不可判定，则要求 `sessionId` 或返回 `read-only`）。
- **责任角色**：backend
- **阻断**：否

### SEC-6 — [LOW] 注入行导出路径：`name` 未再校验即拼路径（当前不可达，纵深防御缺失）

- **文件:行**：`src/skills/registry.ts:843-854`（`files[0].path = ${name}.md`）、`src/skills/manager.ts:222-246`（`join(destDir, `${name}.md`)` + `atomicWriteText`）
- **推理 `[F]`**：`exportSnapshot` 只有在 `readDetail(name)` 命中 registry 条目时才返回；宿主 `get()` 会用 `isSkillName` 过滤（`dsh-skill/lib/index.js:251`）⇒ 含 `/`、`..` 的名字拿不到快照，当前不可构成穿越。但 `writeExportSnapshot` 自身没有 `isSkillName` 前置，若未来 registry 来源变化（或名字来自非 registry 路径）即成为路径注入点。
- **影响**：当前无；`destDir` 本身是既有的“导出到宿主路径”能力面（`exportToPath` 早已允许写任意目录），故不构成新能力。
- **修复建议**：`writeExportSnapshot` 开头加 `isSkillName(input.name)` 与 `basename` 断言；`export` 的 registry 分支复用 `validate.ts`。
- **责任角色**：backend
- **阻断**：否

### SEC-7 — [LOW] 资源读取 TOCTOU 与 readDetail 无大小上限

- **文件:行**：`src/skills/registry.ts:791-839`（`lstat` → `realpath` → `stat` → `readFile` 之间无二次校验，无 `O_NOFOLLOW`）；`registry.ts:681-701`（`readDetailFromPath` 直接 `readFile(path,"utf8")`，无大小上限）；`readDetail` 的 registry 正文同样无上限（`:717-752`）
- **推理**：在 `realpath/stat` 通过后、`readFile` 之前，若资源目录被本地写者替换为符号链接/超大文件，可读到目标文件或触发大内存分配。要求本地同用户写权限（插件/职业目录通常归当前用户），不越过本机权限边界。
- **修复建议**：用 `fs.open(path, O_RDONLY|O_NOFOLLOW)` 拿 fd 后 `fstat` 校验 `size <= 256KiB` 再读；`readDetail` 对正文加同样的上限（例如 1 MiB）并返回截断标记。
- **责任角色**：backend
- **阻断**：否

### SEC-8 — [LOW] 注入行数量/字段长度与 `lastGood` 无上限；overrides 名单无条目上限

- **文件:行**：`src/skills/registry.ts:337`（`lastGood: Map<string, SkillSummaryView[]>` 每 scope 不限行数；契约 §5.8 预算“≤256 行”未实现）、`:555-608`（无行数/字段截断）、`:372-381`（仅 `metaCache` 有 256 上限）；`src/overrides/config-file.ts:31-43,73-85`（无条目/文件大小上限）
- **影响**：恶意/异常 provider 或损坏的 overrides 文件可让 `skills.list` / `sessionList` 返回超大响应、内存与 CPU 放大（每个未知名还会走 3 次重试 + 每次 list 两次 snapshot，见 `session.ts:406-437`）。需要插件或项目配置写权限（均已是高信任面），故为 LOW。
- **修复建议**：合并结果按 `RESOURCE_LIST_LIMIT` 同款常量截断注入行（如 512）；`description/channel/provider` 在服务端截断（如 2 KiB / 256 字符）；overrides 读取限制条目数（如 200）并对超限显式报错；`lastGood` 按 scope 限制行数。
- **责任角色**：backend
- **阻断**：否

### SEC-9 — [LOW] 配置名字规范化不足导致日志注入（CWE-117）

- **文件:行**：`src/overrides/config-file.ts:31-43`（`normalizeList` 仅 `trim`，保留内嵌换行）、`src/skills/session.ts:234-239,429-433`（`warnSkip` 把名字拼进 `logger.warn` 文案）
- **证据**：`skills: ["foo\nFATAL forged log line"]` —— 名字非 kebab 不会成为注入技能，但在 `applyProjectDefaults` 第 4 次尝试时 `warnSkip` 输出含换行的文案，可伪造日志行。写入路径 `overrides.toggle` 用 `isSkillName` 拒绝这类名字（`overrides/manager.ts:90-92`），只有手改/外部写入的项目文件可触发。
- **影响**：日志完整性（审计噪声），无执行影响。
- **修复建议**：`normalizeList` 或 `warnSkip` 对不可打印字符做转义/剔除（例如 `JSON.stringify(name)` 后再拼日志）。
- **责任角色**：backend
- **阻断**：否

### SEC-10 — [LOW] 契约空承诺与 toggle 语义错位

- **文件:行**：
  - `requires-session` 错误码在 `src/skills/registry.ts:141-149` 声明、在 `docs/architecture/skill-sources.md:694-696,710` 定义，但实现从不产生（冷会话 preset 详情走 `readDetail` 未命中 → `undefined` → `manager.read` 回落磁盘 not-found，`manager.ts:286-298`）；客户端用通用文案兜底（`skill-content.tsx`）。
  - `src/index.ts:130-145`：`overrides.toggle("skills")` 在**写盘成功后**把 `reconcileProject` 的失败原样返回 ⇒ 客户端看到 `{ok:false}` 但配置已持久化；用户重试会反向 toggle。
- **影响**：错误码契约不可测（tester 无法按契约断言 `requires-session`）；UI 可能误报失败（状态已生效）。非安全问题，但属契约一致性缺陷，会影响 RD-2 类用例与“失败不落盘”直觉。
- **修复建议**：要么实现 `requires-session`（无 agent 且名字仅存在于 preset 层时返回该码），要么从契约表移除并让 tester 按“not-found”断言；`toggle` 对“已写盘 + reconcile 失败”返回 `{ok:true, warnings:[...]}` 或专用错误码（additive），文档写清“文件已生效”。
- **责任角色**：backend（实现）+ architect（契约）
- **阻断**：否（建议与 SEC-2 一起处理，避免 tester 按契约误判）

### SEC-11 — [LOW] 来源标签信任 provider/source 自述，可跨层伪装“DSH 内置 / 插件渠道”

- **文件:行**：`src/skills/registry.ts:480-512`（映射表单一事实源，按 `provider`/`source` 字符串直接定 `origin`/`channel`）
- **推理**：`registerProvider` 只限制同层重名（`dsh-skill/lib/index.js:159-174`，`runtime` 为保留名 `:160`），**不验证 provider 身份**；因此 preset/scope 层挂一个名为 `dsh-office` / `dsh-figma` 的 provider，其技能会被标为「DSH 内置（Office）」/`dsh-to-figma`。伪造需要改写 preset 组合（属管理员/用户可控配置），非普通插件可独立完成。
- **影响**：仅来源展示误导（面板/能力决策角标），不影响启停或写权限；无权限提升。
- **修复建议**：① 对 `bundled` 类标签要求“provider 名 + 已知内置包”双重匹配（可复用 `ctx.registry`/loader 条目判断，若可用）；② 或把渠道标签文案降级为“来源自述：dsh-office”；③ 至少在契约 §4.3 记录该限制。
- **责任角色**：architect（契约）+ backend（可选硬化）
- **阻断**：否

### SEC-12 — [LOW] Jev 回滚把“跟随项目默认”落成显式布尔

- **文件:行**：`src/jev/apply.ts:427-444`（`restoreOne` skills 分支传 `enabled: prev.enabled` 布尔）；`src/skills/session.ts:561-576`（布尔 ⇒ `explicit.set`）
- **推理**：若某注入技能原状态是“项目默认禁用（无显式覆盖）”，Jev 应用后被回滚会写入 `explicit=false`；之后即使项目默认解除，该会话仍保持显式禁用（不再跟随项目默认）。与磁盘技能既有行为一致，但注入技能是新增语义，建议记录。
- **影响**：状态保真度/可预期性，低。
- **修复建议**：`restoreOne` 对 skills 使用 `enabled: undefined` 表达“清除显式覆盖”，需要 `JevPrevState` 增加 `explicit: boolean` 维度的前态（additive）。
- **责任角色**：backend
- **阻断**：否

---

## 5. 已确认为安全 / 无需修复的边界（正向结论）

以下均为本次**实测或代码确证**，不列为发现，但作为“默认拒绝是验证出来的”证据：

1. **资源读取路径边界**（`registry.ts:754-840`）：`..`/绝对路径/反斜杠/空段/`.` 段、目标符号链接、目录内符号链接逃逸、超 256 KiB、非 UTF-8 全部按契约拒绝，且错误信息不回显解析后的绝对路径（实测 9/9 + 2 个 base 类别）。
2. **注入行不产生任何磁盘写**：`toSummaryView` 不下发 `root`（`registry.ts:534-553`）；项目默认只写 `.agents/capability-overrides.json`；会话开关只写内存（`session.ts`）。
3. **写入口名字守卫完整**：`create/update/remove/read/clone` 均先 `isSkillName`（`crud.ts:27-38` 的 `nameGuard`），`overrides.toggle` 的 `skills` 域同样拒绝非 kebab 名（`overrides/manager.ts:90-92`）。
4. **shadow 注册幂等且双桶不重复**：两个桶最多一个条目，切换驱动源时 re-bucket；`withQueue` 串行化同 session 写；`agent/disposed` 只清 Map、不手动 double-dispose（`session.ts:206-231,246-261,474-482`）。
5. **冷会话不写**：无 live agent 时 `setEnabled` 业务失败、`list` 的注入读取退化为无 scope（`session.ts:538-539,504-510`）。
6. **Jev 筛选语义不会误关新出现的 preset 技能**：`plan.ops` 冻结 + 只按 id 重解析（`jev/apply.ts:86-99,624-660`），JV-4 结论在实现上成立。
7. **无 XSS 面**：注入正文/资源内容经 `MarkdownPreview`（`markdown.tsx:11-13` 明确不解析 HTML、不 `dangerouslySetInnerHTML`、不加载外链图片/iframe）；`channel`/`origin`/`description` 均作为 React 文本节点渲染（`panel.tsx:1270-1281,324-340`），无 `innerHTML`/`dangerouslySetInnerHTML`（`grep` 全仓 0 命中）。
8. **RPC 通道仍由宿主认证闸门保护**：`connection.requestRejection`（未认证 401 / 不受信来源 403）、`application/json` 强制、endpoint 段字符集校验、请求体上限（`remote.ts:298-380`），本次只新增一个 case。
9. **来源分类为单一事实源且不参与路由**：`channel` 仅展示；`registrySource` 原值透传；`injectedNames`/`inspectName` 的判定不依赖客户端字段（服务端重查 registry）。
10. **MCP 域未被改动**：`git status --porcelain` 无 `src/mcp/**`，`remote.ts` 的 mcp 分支未变，会话开关/挂载语义不受本次改动影响。

---

## 6. 验证证据（可复现）

### 6.1 工作区与改动范围

```
$ git -C /Users/lzx/Documents/GitHub/dsh-capability-settings status --porcelain=v1
 M src/client/api-adapter.ts … M src/skills/session.ts … ?? src/skills/registry.ts
（共 21 个已改文件 + docs/architecture/skill-sources.md；**无 src/mcp/** 改动）
```

> 注：审计期间工作区还出现了 `lib/**`（由 task-4 允许的一次 `pnpm build`）与 `README.md` / `CHANGELOG.md`（task-5）的改动；这些不属于本次审计对象，但 SEC-1 已确认存在于重建后的 `lib/client/api-adapter.js:126-128`。

### 6.2 客户端 `readResource` 解包（SEC-1）

```
$ ./node_modules/.bin/tsc src/client/api-adapter.ts --outDir /tmp/sec-audit/out2 \
    --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck --esModuleInterop
$ node /tmp/sec-audit/out2/test-adapter.mjs
readResource 成功响应 → {"ok":false,"errors":["资源读取返回了非法结果"]}
readResource 失败响应 → {"ok":false,"errors":["资源路径不允许"],"code":"escape"}
```

### 6.3 资源读取边界（正向结论 §5-1）

```
$ ./node_modules/.bin/tsc src/skills/registry.ts --outDir /tmp/sec-audit/out \
    --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck --esModuleInterop
$ node /tmp/sec-audit/out/test-resource.mjs
正常文件 ref.md                        => OK size=15 content="hello resource\n"
.. 穿越                              => FAIL code=escape errors=["资源路径不允许包含 . 或 .. 段"]
绝对路径 /etc/hosts                    => FAIL code=escape errors=["资源路径不允许是绝对路径"]
反斜杠                                => FAIL code=escape errors=["资源路径不允许使用反斜杠"]
空路径                                => FAIL code=escape errors=["资源路径必须是相对路径"]
符号链接文件 link.md                     => FAIL code=escape errors=["资源路径不允许（符号链接）"]
目录内符号链接 escapedir/secret.txt       => FAIL code=escape errors=["资源路径不允许"]
超 256KiB big.md                      => FAIL code=too-large errors=["资源文件过大（307200 字节 > 262144 字节）"]
二进制 bin.dat                        => FAIL code=not-text errors=["该文件不是 UTF-8 文本，无法预览"]
不存在的文件                             => FAIL code=not-found errors=["资源文件不存在"]
未知技能名                              => FAIL code=not-found errors=["skill \"unknown-skill\" 不在宿主技能注册表中"]
. 段                                 => FAIL code=escape errors=["资源路径不允许包含 . 或 .. 段"]
子目录不存在                             => FAIL code=not-found errors=["资源文件不存在"]
base=url                           => {"ok":false,"errors":["资源在远端，本地不可浏览"],"code":"unsupported-base"}
base=opaque                        => {"ok":false,"errors":["打包在 asar 内"],"code":"unsupported-base"}
```

### 6.4 合并/分类/去重/写拦截判定

```
$ node /tmp/sec-audit/out/test-merge.mjs
— 面板 list（无 session）：
  figma-skill      injected=true origin=plugin channel=dsh-to-figma
  office-skill     injected=true origin=bundled channel=DSH 内置（Office）
  remote-skill     injected=true origin=plugin channel=dsh-remote
  runtime-skill    injected=true origin=plugin channel=插件运行时注入
  spoofed-office   injected=true origin=plugin channel=evil-plugin      ← 未知 provider 未伪装成功
— 会话 sessionList（有 live agent）：
  preset-skill     injected=true origin=preset channel=cordis
  shadowed-skill   （被 isOwnShadow 过滤，不出现）
  …（其余同上）
— 同名磁盘优先： ["figma-skill","remote-skill","runtime-skill","spoofed-office"]   ← office-skill 被磁盘行顶掉
— 自身 shadow 被过滤： []
— inspectName(preset-skill, 无 sessionId) = undefined                 ← SEC-5(b)
— inspectName(preset-skill, sessionId=s1) = injected
— inspectName(disk-skill) = {"kind":"disk-root"}
```

### 6.5 静态核对宿主校验语义

```
$ grep -n "function validateRuntimeSkill" -A 5 node_modules/@deepseek-ai/dsh-skill/lib/index.js
465:function validateRuntimeSkill(skill) {
466:    if (!SKILL_NAME.test(skill.name)) throw new Error(`invalid skill name "${skill.name}"`);
…
$ grep -n "register(skill)" -A 6 node_modules/@deepseek-ai/dsh-skill/lib/index.js
193:	register(skill) { 194: validateRuntimeSkill(skill); … 196: if (existingLayer.runtime.has(skill.name)) { 198: warn … 199: return () => {}; }
```

---

## 7. 未决点与建议动作

| # | 动作 | owner | 依据 |
|---|---|---|---|
| A1 | 修 SEC-1（客户端成功支解包），复跑资源浏览 | frontend | §4 SEC-1 |
| A2 | 裁定 SEC-2（文档回写 or 实现补 disk），同步 `docs/architecture/skill-sources.md`，再让 tester 写 RB-8 | Lead + architect | §4 SEC-2 |
| A3 | 修或记录 SEC-3（dispose 释放 shadow / release 前 verifyShadow） | backend | §4 SEC-3 |
| A4 | SEC-4/5/6/8/9 建议同批硬化（都不改外部契约） | backend | §4 |
| A5 | SEC-10 与 SEC-2 一起处理，避免 tester 按契约空码写用例 | backend + architect | §4 SEC-10 |
| A6 | CHANGELOG `[Unreleased]` 记录“注入技能来源标签为 provider 自述”（SEC-11）与“插件重载后会话内需新会话恢复”（若 A3 不修） | pm | §4 SEC-3/11 |

## 8. 质量门建议

- **安全门：PASS**（CRITICAL 0 / HIGH 0）。本审计未发现可跨越本机用户权限边界的读写能力；新增的 `readResource` 读取面严格窄于既有 `skills.install({sourcePath})` / `skills.export({destDir})` 能力面，且边界实测有效。
- **交付门：建议 Lead 在收尾前至少闭合 A1、A2**（分别阻塞 AC-6 与 RB-8 的验收判定），并决定 A3 是修复还是记为已知限制。
- 若 Lead 的质量门定义为“任何 MEDIUM 未闭合即 FAIL”，则**当前建议 FAIL**（3 条 MEDIUM 未闭合）；若按“仅 CRITICAL/HIGH 阻断”定义，则**建议 PASS（带条件）**。
