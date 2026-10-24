# 注入 skill 的来源展示与项目/会话启停 · 实施架构与 API 契约

| 项 | 值 |
|---|---|
| 文档 ID | `docs/architecture/skill-sources.md`（本文件） |
| 版本 | v1.2（task-14：补已知 runtime 技能前缀映射例外） |
| 日期 | 2026-10-25 |
| 修订 | v1.2（2026-10-25，task-14）：§4.1/§4.3/R2 补「已知 runtime 技能名前缀 → 注入插件」例外（首期 `dsh-diff-approval`，Lead task-12）；未命中仍回退「插件运行时注入」；标注 additive 扩展点与维护方式。 |
| 修订 | v1.1（2026-10-25，task-9）：按 **Lead R3 裁定（2026-10-25）** 移除 `origin:"disk"`；`origin` 只允许 `bundled \| plugin \| preset`，**磁盘行不设置 `origin`/`injected`**。同步 §1/§2/§3/§4/§5/§7/§9/§11/§13。 |
| 作者 | architect（task-1） |
| 上游依据 | task-1 任务描述；`docs/research/code-recon.md`；Lead 调研结论（宿主 `SkillRegistry`、面板 UI 现状）；仓库 `src/**`；`node_modules/@deepseek-ai/dsh-skill@0.2.0-rc.1` 类型；宿主 `app.asar`（`0.2.1-rc.2`）只读抽取 |
| 下游任务 | backend（`src/**`）、frontend（`src/client/**`）、tester（`notes/verify/**`） |
| 写作用域 | **仅 `docs/architecture/**`**；本文不改代码 / 测试 / README / CHANGELOG |

---

## 0. 阅读方式、证据等级与复现方法

### 0.1 证据等级（全文统一）

| 标记 | 含义 |
|---|---|
| `[F]` | **Fact**：本次直接读到的仓库源码 / 类型声明 / 宿主包源码（给出 `文件:行号`）。 |
| `[I]` | **Inference**：由 `[F]` 推演出的行为结论（给出推演链，不是猜测）。 |
| `[A]` | **Assumption**：无法在本轮取证、实现前必须复核的假设（给出复核方式与降级）。 |

本文**不发明覆盖率**：凡没有证据的点，一律标 `[A]` 并给降级路径。

### 0.2 本轮实读范围

| 来源 | 范围 | 用途 |
|---|---|---|
| 仓库 `src/**` | `skills/{manager,session,types,shadow}.ts`、`overrides/{types,config-file,manager}.ts`、`jev/{apply,types}.ts`、`remote.ts`、`index.ts`、`shared/{skill-sources,project-root}.ts`、`client/{api,api-adapter,panel,composer-capability}.ts(x)` | 现状与契约落点 |
| 仓库 `AGENTS.md` | §「MCP 关键模型」第 2 条（`kScope` 陷阱） | 硬约束 |
| 本地依赖 | `node_modules/@deepseek-ai/dsh-skill/lib/types/index.d.ts`（`0.2.0-rc.1`） | 类型契约 |
| 宿主 `app.asar`（`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`，`0.2.1-rc.2`） | `dsh-skill`、`dsh-tool-skill`、`dsh-skill-filesystem`、`dsh-skill-office`、`dsh-agent-preset-registry`、`dsh-desktop-host`、`dsh-web-app` bundle patch、preset patch | **运行时**行为与真实注入方 |
| 本机 profile | `~/.dsh/profiles/desktop/{cordis.yml,package.json}` 与已装插件 `dsh-to-figma` / `dsh-remote` / `dsh-diff-approval` | 真实渠道取证 |

### 0.3 asar 行号复现方法（只读）

```python
# 只读：解析 asar 头（前 4B=4，随后 pickle 长度 / JSON 长度 / JSON 长度），按 JSON 目录里的 offset 读取。
# 头部 JSON 起点 = 16；数据段起点 = 8 + header_size。
```
本文对 asar 内文件给出的行号 = **抽取出的 UTF-8 文本行号**（不是 asar 偏移）。宿主升级后行号可能漂移；复核时以文件内容 + 包版本为准 `[A]`。

### 0.4 版本口径（重要）

- 仓库 `devDependencies` 的 `@deepseek-ai/dsh-skill` 是 **`0.2.0-rc.1`** `[F]`（`node -e` 读 `node_modules/@deepseek-ai/dsh-skill/package.json`）。
- 宿主实际运行的是 **`0.2.1-rc.2`** `[F]`（asar 内 `dsh-skill/package.json`、`dsh-tool-skill/package.json`、`dsh-desktop-host` 抽取）。
- 结论：**类型只作编译期参考，运行时行为以 asar 抽取值与 `ctx.get("skills")` 实测为准**；backend 需在实现首日复核（见 §13-R1）。

---

## 1. 结论摘要（TL;DR）

### 1.1 五条关键契约

| # | 契约 | 一句话 |
|---|---|---|
| 1 | **读** | 新增「注册表桥」（`src/skills/registry.ts`）：`ctx.get("skills").snapshot({cwd, scope?})` 的条目 **additive 合并**进现有磁盘视图；面板 `list` 读**全局层**，会话 `sessionList` 读**带 `scope: agent`**；同名**首期以磁盘为准**（外部条目仅在名字不存在时追加）。 |
| 2 | **展示** | 每行新增 `injected/origin/channel/provider/registrySource/resourceBaseKind/contentReadOnly/disabledInProject`；`origin ∈ {bundled, plugin, preset}`（**磁盘受管行不设 `origin`/`injected`**，Lead R3 裁定 2026-10-25），`channel` 是展示用的注入方名（`DSH 内置（Office）` / `dsh-to-figma` / `dsh-remote` / `cordis` / `插件运行时注入`）。 |
| 3 | **项目默认启停** | **不写 frontmatter**（注入技能没有文件）：扩展 `.agents/capability-overrides.json` 的 `skills: string[]`；`agent/created` 时按该列表在 **agent 作用域注册同名 runtime shadow**（复用 `skills/session.ts` 已验证机制）。 |
| 4 | **会话/项目开关** | 注入技能内容只读、**启用/禁用与全局技能同逻辑**：会话显式开关 > 项目默认；会话显式 = 在 agent 层注册/解除 runtime shadow（先读快照缓存元数据 → 注册 → 再读校验真正生效）。 |
| 5 | **详情/资源** | `skills.read` 增加 registry fallback（`ctx.skills.get(name, {cwd, scope?})`）；`resourceBase.kind === "directory"` 时才允许受边界约束的资源读取（新 `skills.readResource`），`url` / `opaque` 只给正文。 |

### 1.2 任务 7 项要求 → 本文位置（自检表）

| # | 任务要求 | 本文 |
|---|---|---|
| 1 | 宿主数据形状 + 客户端/Jev 镜像字段 | §3 |
| 2 | registry 合并算法 / scope 传 agent / 去重 / 过滤自身 shadow / 元数据缓存 | §5（去重 §5.4，shadow §5.5） |
| 3 | 来源映射表（office/figma/remote/runtime/preset 名解析） | §4 |
| 4 | 项目级默认启停存储（overrides.skills）+ agent/created shadow + 会话优先 + 与 `session.ts` 关系 / dispose | §6 |
| 5 | RPC 语义与错误降级；内容只读但启停一致；读详情/导出 registry fallback；resourceBase 资源边界 | §7、§8 |
| 6 | 冷会话边界、Jev 排队重放影响、registry 不可用降级 | §9 |
| 7 | 测试矩阵 + 验收标准 | §11、§12 |

### 1.3 三个必须先接受的现状（避免误判为缺陷）

1. **面板 `skills.list` 从不读 `ctx.skills`**：`src/skills/manager.ts:96` 的 `createService(ctx, …)` 收下了 `ctx`，但 `list()` 只遍历受管磁盘根（`src/skills/manager.ts:103-136`），`ctx` 仅在注释里被「预留给将来」（`src/skills/manager.ts:89-95`）`[F]`。
2. **Jev 枚举走 `skills.sessionList`**，因此「注入技能进 Jev」= 「先把注入技能并进 `sessionList`」，不需要 Jev 侧另开读取源（`src/jev/apply.ts:249`）`[F]`。
3. **会话内禁用 = agent 作用域 runtime shadow**（不是新机制）：`src/skills/session.ts:1-27` 的设计说明、`:182-198` 的注册与 no-op disposer 处理 `[F]`。注入技能只是把同一机制推广到「非磁盘条目」。

---

## 2. 事实基线

### 2.1 现状调用链（面板 / 会话 / Jev / 详情）

| 链路 | 入口 | 数据来源 | 证据 |
|---|---|---|---|
| 面板技能列表 | `skills.list` → `service.skills.list(cwd)` | **仅磁盘受管根**（项目 `.dsh/.agents/.claude` + 全局 `~/.dsh/~/.agents/~/.claude`） | `src/remote.ts:132-133`；`src/skills/manager.ts:58-74`、`:103-136` |
| 会话技能列表 | `skills.sessionList` | 磁盘视图 + `enabledInSession` / `canToggleInSession` | `src/remote.ts:134-136`；`src/skills/session.ts:132-149` |
| 会话开关 | `skills.setSessionEnabled` | agent ctx `skills.register` 同名 shadow | `src/remote.ts:137-139`；`src/skills/session.ts:151-199` |
| 详情 | `skills.read` | 磁盘 `readSkillDetail` | `src/remote.ts:140-141`；`src/skills/manager.ts:176-180` |
| Jev 枚举 | `service.skills.sessionList(cwd, sessionId)` | 同上会话列表 | `src/jev/apply.ts:249-272` |
| 客户端详情适配 | `api.read(name)` | 只传 `{name, cwd}`，**不解业务信封** | `src/client/api-adapter.ts:149-157`；`src/client/api.ts:140` |

`[F]` 结论：跨渠道的所有注入技能在面板与会话能力视图中**完全不可见**；Jev 也枚举不到。

### 2.2 宿主 registry 的数据形状（类型契约）

来源：`node_modules/@deepseek-ai/dsh-skill/lib/types/index.d.ts`（`0.2.0-rc.1`，与宿主 `0.2.1-rc.2` 类型面一致）`[F]`。

| 类型 | 关键字段 | 行号 |
|---|---|---|
| `SkillSource` | `project-dsh \| project-agents \| runtime \| user-dsh \| user-agents \| custom \| bundled \| (string & {})`（**允许任意字符串**） | `:24` |
| `SkillResourceBase` | `{kind:"directory", path}` \| `{kind:"url", url}` \| `{kind:"opaque", description}` | `:26-35` |
| `SkillInvocationPolicy` | `modelInvocable` / `userInvocable` | `:37-42` |
| `SkillSummary` | `path?`, `name`, `description`, `whenToUse?`, `invocation`, `source`, **`provider`**, `resourceBase?` | `:44-61` |
| `SkillCandidate` | 上述 + `rank` + `locator` + `metadata?`（**不对外**） | `:63-70` |
| `SkillDefinition` | `SkillSummary` + `content`（已剥离 frontmatter）+ `metadata?` | `:72-77` |
| `SkillRegistration` | `Omit<SkillDefinition,"invocation"\|"provider">` + 可选 `invocation`/`provider`（runtime 注册用） | `:78-84` |
| `SkillLookupOptions` | `cwd?` / `signal?`（**provider 只看这两个**） | `:86-91` |
| `SkillViewOptions` | `SkillLookupOptions` + **`scope?: ScopeKey`**（注释：「the calling agent」；省略 = 只读 global 层） | `:98-101` |
| `SkillRegistry` | `registerProvider` `:247`、`register` `:257`、`list` `:266`、**`snapshot`** `:274`（带 `complete`）、`get` `:284` | `:225-296` |
| `skills/change` 事件 | 「provider/runtime/catalog 可能变了；消费方自行 refetch」 | `:204-212` |

`ScopeKey = object`（宿主 `dsh-scope`）；**agent 对象本身就是 scope key**（`dsh-tool-skill` 把 `scope: agent` 直接传进去，见 §2.3 行号）`[F]`。

### 2.3 宿主合并算法（决定「谁能覆盖谁」）

运行时实现（asar 抽取 `dsh-skill/lib/index.js`，`0.2.1-rc.2`）`[F]`：

| 机制 | 证据 |
|---|---|
| 名称正则 `^[a-z0-9]+(?:-[a-z0-9]+)*$` | `:17` |
| runtime provider 名 `"runtime"`、runtime 条目 rank **250** | `:20-21` |
| bundled 标准 rank **600** | `:23` |
| `register(skill)`：按 `scopeOf(this.ctx)` 决定进哪个层；**同层同名 runtime「先到先得」**，重复者只 warn 并拿到 **no-op disposer**；`provider` 缺省 = `"runtime"` | `:193-215` |
| `snapshot/list`：`collect()` → 汇总 | `:224-246` |
| `get(name, options)`：按同样的层合并取胜者，再调 provider.get | `:250-291` |
| `collectFresh`：`layers = [global, ...chainLayers(options.scope)]`，逐层 `merged.set(name, entry)` | `:298-310` |
| `collectLayer`：层内按 `compareIndexedCandidates` 排序后**首个同名胜出** | `:312-334` |
| `listLayerCandidates`：runtime 条目先入（`providerOrder = -1`），provider 条目按注册顺序 | `:335-380` |
| 排序键：`rank` → `providerOrder` → `localOrder` | `:519-521` |
| runtime 候选 rank=250，携带 `source`/`provider`/`resourceBase`/`path`/`metadata` | `:437-450` |
| provider 候选校验：`candidate.provider` **必须等于** provider 名 | `:452-463` |
| runtime 注册校验：仅 name/description/invocation | `:465-470` |
| 摘要排序：按 name 码点 | `:511-513` |

**层序推演** `[I]`（依据 `dsh-scope` 的 `ScopedLayers.chainLayers` 契约：*"farthest ancestor first and the exact scope last, so a caller layering them in order gives the nearest scope the final word"*，见 `node_modules/@deepseek-ai/dsh-scope/lib/types/store.d.ts` 的 `chainLayers`/`merge` 注释）：

```
读 scope=agent 时：layers = [global, <preset 层>, <agent 层>]
逐层 set ⇒ global 先写、preset 覆盖 global、agent 覆盖 preset
⇒ 胜者优先级（同名）：agent 层 > preset 层 > global 层（与 rank 无关）
；同名只在**同一层内**用 rank/providerOrder/localOrder 决胜。
```

这条推演是「**会话 shadow 能关掉任何层的注入技能**」的全部依据（§6.2）；也是「**preset 层条目会盖掉 global 层同名条目**」的依据（§5）。

**R3 裁定（Lead，2026-10-25）**：registry 里的**磁盘条目永不作为注入行合并**。`classify` 对 `provider === "filesystem"` 且 `source ∈ {project-*, user-*, 全局 custom}` 返回 `undefined`（= 不合并），磁盘来源仍只由面板磁盘视图表达；实现落点 `src/skills/registry.ts:459-464`、`:503-507`，类型落点 `src/skills/types.ts:93-95`。v1.0 中的 `origin:"disk"` 设计**作废**。

### 2.4 真机注入方取证（本机 + 官方 bundle）

| 注入方 | 注册方式 | registry 字段 | 证据 |
|---|---|---|---|
| **DSH 随包 Office（7 个技能）** | 宿主插件 `dsh-skill-office`（插件名 `skill-office`），provider `dsh-office`；桌面版由 `dsh-desktop-host` 的 `desktop-office` 以 `assetRoot = <runtime>/office-skills` 挂载 | `provider:"dsh-office"`、`source:"bundled"`、`rank:600`、`resourceBase.directory`（`assets/<name>`） | asar `dsh-skill-office/lib/index.js:66-101`；`dsh-desktop-host/lib/index.js:66-88`（`:84` assetRoot）；`/Applications/DeepSeek Harness.app/Contents/Resources/runtime/office-skills/{office,office-docx,…}/SKILL.md` 实际存在 |
| **dsh-to-figma** | `ctx.skills.registerProvider(...)`，provider `dsh-figma`，单技能 `figma-workbench` | `source:"bundled"`（借 rank 600）、`provider:"dsh-figma"`、`resourceBase.directory` | `~/.dsh/profiles/desktop/node_modules/dsh-to-figma/index.mjs:35-36` |
| **dsh-remote** | `ctx.get('skills').register({...})`，runtime 注册 | `name:"dsh-remote-deploy"`、`source:"dsh-remote"`（**插件自定义 source**）、`provider` 缺省 ⇒ `"runtime"` | 同目录 `dsh-remote/lib/web-deploy-skill.js:147-160`（`:156` source） |
| **dsh-diff-approval** | `ctx.effect(() => skills.register(skill))`，runtime 注册（2 个技能） | `source:"runtime"`、`provider` 缺省 `"runtime"` | 同目录 `dsh-diff-approval/lib/index.js:2925-2942`（comment skill）、`:2948-2998`（annotate skill）、`:4201-4218`（`registerRuntimeSkill`，`:4210` 注册） |
| **Agent preset（如 `cordis`）内的文件系统 provider** | preset 组合里挂 `@deepseek-ai/dsh-skill-filesystem` + `customSkillDirs: <dsh-agent-preset>/skills`（5 个技能） | `source:"custom"`、`provider:"filesystem"`、`rank:300` | asar `dsh-web-app/presets/cordis.patch.yml:122-128`；本机 `~/.dsh/profiles/desktop/cordis.yml:1080-1084`（preset id `cordis`）、`:1234-1243`（skill-filesystem + customSkillDirs + tool-skill）；preset registry：`composedPreset(ctx)` `dsh-agent-preset-registry/lib/index.js:717-719` |
| **官方分层说明（关键）** | web-app 把**宿主层 `skill-filesystem` 禁用**，由每个 preset 自己挂 | 「deployment-level providers … register into its global layer, while a preset's skill-filesystem registers into that preset's layer, and each agent reads the merged catalog its scope chain selects. Only the per-agent rows move behind presets: the base host skill-filesystem row is disabled here (presets own local discovery)」 | asar `dsh-web-app/cordis.patch.yml:505-518` |

`[I]` 由此得到两条对实现至关重要的结论：

- **web 形态下，磁盘技能条目（项目/用户/自定义/bundled 根）是「preset 层」条目**——只有带 `scope: agent` 的读才看得见；**无 scope 的读只能看到 global 层的部署级 provider/runtime 条目**（office / figma / dsh-remote / dsh-diff-approval 等）。
- 因此：**面板 `list`（无会话）= 磁盘视图 + global 层注入；会话 `sessionList`（scope=agent）= 磁盘视图 + 全部注入（global 被 preset/agent 同名覆盖后仍是合并视图）**。两者不能互相替代（§5.1）。

### 2.5 现有会话 shadow 机制与它的硬边界

`src/skills/session.ts` `[F]`：

- 记录模型：`SessionRecord { agent, shadows: Map<name, disposer> }`（`:60-64`）；
- 生命周期：`agent/created` 登记、`agent/disposed` 清理（`:117-125`），插件加载时补登记存量（`:127-129`）；
- 读取：过滤磁盘 shadow stub / 双向禁用，映射 `enabledInSession = !shadows.has(name)`、`canToggleInSession = record!==undefined`（`:132-149`）；
- 关闭：`skills.register({name, description: SHADOW_DESCRIPTION, content:"", invocation:{false,false}})`（`:182-198`），其中 `SHADOW_DESCRIPTION = "本会话已禁用（capability-panel）"`（`:66-67`）；
- **同层同名 runtime 已存在时** registry 返回 no-op disposer（`:191-194` 注释）⇒ **本插件无法保证 shadow 生效**（同层先到先得，§2.3）`[I]`。

这两点是 §6 设计的直接约束：
1. shadow 只能**藏**，不能**反向开启**文件级禁用（`:19-24` 语义边界）；
2. 注册后必须**读回校验**（否则「UI 已禁用、实际仍可见」的假成功，`session.ts:171-176` 已为 disposer 异常写了同类理由）。

### 2.6 项目级默认存储现状（必须扩展的地方）

| 事实 | 证据 |
|---|---|
| `capability-overrides.json` 只有 `mcp` 域；`CapabilityDomain = "mcp"`；注释明确写「skills 域不走项目级禁用声明，旧文件里遗留的 `skills` 键读取时忽略、下次写盘自动清除」 | `src/overrides/types.ts:12-14`、`:27-34` |
| 域键表 `DOMAIN_KEYS = ["mcp"]`；`emptyOverrides() = { mcp: [] }`；读按域循环（新增域自动生效）；写按域循环、空数组不落盘 | `src/overrides/config-file.ts:21`、`:24-26`、`:53-72`、`:78-85` |
| `toggle()` 重建 `next` 时**硬编码 `{ mcp: [...current.mcp] }`**——只加域键不修这里会**清掉其它域** | `src/overrides/manager.ts:87` |
| `index.ts` 的 overrides 包装只在 `domain === "mcp"` 时 `loader.reload`（skills 需要平行的「热应用」钩子） | `src/index.ts:121-130` |
| 读取兼容旧位置（`.dsh`/`.claude`）、写入固定 `.agents`、首次迁移删旧文件 | `src/overrides/manager.ts:76-97`；`src/shared/config-location.ts` |

`[I]` 结论：扩展 `skills` 域是**小改动、高兼容**（读写循环已按域泛化），但必须同时改 `types.ts`、`config-file.ts:21,24`、`overrides/manager.ts:87`、`index.ts:121-130`，并把 `types.ts:12-14` 的旧注释改成新语义。

### 2.7 架构必须遵守的既有硬约束

| # | 约束 | 证据 |
|---|---|---|
| C1 | **不 import 插件自带的 `@deepseek-ai/dsh-scope`**：其 `kScope` 是普通 `Symbol`（非 `Symbol.for`），读不到宿主打在 agent ctx 上的 scope tag | `AGENTS.md:135-138` |
| C2 | scope 只能**把 agent 对象原样传给 registry API**（`scope: agent`），不要自己构造 scope key | `dsh-tool-skill/lib/index.js:871,905,938`（`scope: exec.agent` / `scope: agent`）`[F]` |
| C3 | RPC 传输层恒 `{ok:true, value}`；业务失败必须包成 `value:{ok:false, errors}` | `src/remote.ts:24-46`；`src/remote.ts:126-131` |
| C4 | 客户端 bundle 只外置 react 系；不得引入新裸依赖；UI 自绘、样式进 `styles.ts` | `AGENTS.md`「平台契约」；`docs/research/code-recon.md:337-343` |
| C5 | 写入一律走 `atomicWriteText` + `withFileLock` | `src/overrides/config-file.ts:15-16`、`src/overrides/manager.ts:85` |
| C6 | 会话开关是**内存态**（不落盘）；项目默认才落 `.agents/capability-overrides.json` | `src/skills/session.ts:19-24`；`src/mcp/loader.ts` 会话开关同构 |
| C7 | 宿主外层 UI 判断「全局/项目」目前用 `isGlobalSkillSource(source)`（只认 `user-*`），直接用会**把注入行标成「项目」** | `src/client/panel.tsx:948`；`src/shared/skill-sources.ts:20-22` |
| C8 | **R3 裁定（Lead，2026-10-25）**：`origin` 只有 `bundled` / `plugin` / `preset`；磁盘受管行不设置 `origin`/`injected`；registry 的磁盘根条目（`project-*` / `user-*` / 全局 `custom`）**不合并**、不产生注入行 | `src/skills/types.ts:93-95`；`src/skills/registry.ts:459-464,503-507` |

---

## 3. 数据契约

> 原则：**全部字段可选、全部 additive**。旧客户端忽略新字段；新客户端对旧宿主（字段缺失）必须回落当前行为。

### 3.1 宿主 `SkillSummaryView`（`src/skills/types.ts`）

```ts
/**
 * 注入条目的来源类别（**仅 `injected` 行携带**）。
 * 磁盘受管行不设置 `origin`（来源仍由 `source` 表达）——Lead R3 裁定（2026-10-25）。
 */
export type SkillOrigin = "bundled" | "plugin" | "preset";

/** registry 资源基准类别（决定能否读资源文件，见 §8）。 */
export type RegistryResourceBaseKind = "directory" | "url" | "opaque";

/** 附加在 SkillSummaryView 上的注入字段（磁盘行不带 = 保持旧形状）。 */
export interface InjectedSkillFields {
  /** true = 该行来自宿主 registry 注入，不是面板受管磁盘根。 */
  injected?: true;
  /** 来源类别（仅 injected 行）。 */
  origin?: SkillOrigin;
  /** 展示用注入方名；约定见 §4.2。 */
  channel?: string;
  /** registry SkillSummary.provider（runtime / filesystem / dsh-figma / dsh-office …）。 */
  provider?: string;
  /** registry SkillSummary.source 原值（bundled/custom/runtime/project-*/user-*/插件自定义）。 */
  registrySource?: string;
  /** registry SkillSummary.resourceBase.kind；缺省 = 该技能无资源基准。 */
  resourceBaseKind?: RegistryResourceBaseKind;
  /** true = 正文/资源只读（不提供创建/编辑/删除/调用方向修改）。 */
  contentReadOnly?: true;
  /** 仅 injected 行：本项目默认是否禁用（来自 overrides.skills）。 */
  disabledInProject?: boolean;
}

export interface SkillSummaryView extends InjectedSkillFields {
  // ...现有字段不变（name/description/whenToUse/invocation/source/format/readOnly/path/resourceDirectory/root/shadowStub/projectShadow）
}
```

配套改动（**必须同批**）：

- `SkillSource`（`src/skills/types.ts:22-31`）增加 `"external"`：注入行的 `source` 恒为 `"external"`。理由：既有分区/写权限判断都以 `source` 为键，新增一个**既非项目也非全局**的值可以同时满足「不进入项目区」「不被 `readOnly` 误判为 `.claude`」两个诉求 `[I]`。
- `src/shared/skill-sources.ts` 增加 `isInjectedSkillSource(source): boolean`（`source === "external"`）；`isProjectSkillSource` / `isGlobalSkillSource` **不改**（注入行两侧都不归，由 `injected`/`origin` 单独渲染）。
- `format`：注入行没有磁盘布局 → 恒 `"directory"`（resourceBase 为 directory 或虚拟目录），`path` 仅在 registry 给出时透传，`root` **不下发**（不能让客户端拿它去写盘）。

### 3.2 客户端 `ClientSkillSummary`（`src/client/api.ts`）

```ts
export interface ClientSkillSummary {
  // ...现有字段不变
  injected?: boolean;
  origin?: "bundled" | "plugin" | "preset";
  channel?: string;
  provider?: string;
  registrySource?: string;
  resourceBaseKind?: "directory" | "url" | "opaque";
  contentReadOnly?: boolean;
  disabledInProject?: boolean;
}
```

`ClientSkillDetail` 增加：

```ts
export interface ClientSkillDetail extends ClientSkillSummary {
  spec: SkillSpec;
  body: string;
  resources: string[];          // 注入行：resourceBase.directory 的一层条目名（文件/目录；不含 SKILL.md 自身）
  /** 仅注入行：true = 本详情来自 registry fallback（内容只读，无磁盘文件可写）。 */
  fromRegistry?: boolean;
  /** 仅注入行：导出/资源读取的降级说明（如 "url" / "opaque" 基准不可浏览）。 */
  resourceBaseNote?: string;
}
```

`toSummary`（`src/client/api-adapter.ts:511-529`）补字段透传；缺省字段不输出（与现有 `...(cond ? {} : {})` 风格一致）。

### 3.3 Jev 镜像（`src/jev/types.ts`）

`JevCapability`（内部枚举结果）与 `JevRankItem`（RPC 回包，`src/jev/types.ts:161-176`）都增加同一组可选字段：

```ts
export interface JevCapabilitySourceFields {
  /** 注入来源类别；磁盘行缺省。 */
  origin?: "bundled" | "plugin" | "preset";
  /** 展示用注入方名（与面板 channel 同源）。 */
  channel?: string;
  /** registry provider id（诊断用）。 */
  provider?: string;
  /** true = 内容只读（启用/禁用仍可）。 */
  contentReadOnly?: boolean;
}
```

- 只做**展示**与前端角标；**不进入** `capabilityId` 的 namespace（id 仍为 `skill:${name}`，`src/jev/apply.ts:256`），避免破坏 `apply` 的 id 稳定性契约 `[I]`。
- `JevRankItem.reason` 复用现有枚举值，不新增（注入技能与磁盘技能的可应用判定完全一致）。

### 3.4 字段语义与不变式

| 字段 | 不变式 |
|---|---|
| `injected` | 仅 `true` 时出现；`injected !== true` ⇒ 该行必须可按旧路径写盘（`root` + frontmatter） |
| `origin` | 与 `injected` 同时出现，取值只有 `bundled` / `plugin` / `preset`；**磁盘受管行不设置 `origin`/`injected`**（Lead R3 裁定 2026-10-25） |
| `channel` | 非空字符串；**展示值**（不是机器 id）；不得回传到宿主做路由 |
| `contentReadOnly` | 恒 `true`（只要 `injected`）；UI 据此隐藏写操作，但**不隐藏启停** |
| `disabledInProject` | 只对 `injected` 有意义；磁盘行的项目级禁停仍走 shadow stub（`src/skills/shadow.ts:32-41`） |
| `enabledInSession` | 会话视图字段；语义 = 本会话**实际**是否生效（含项目默认），见 §6.3 状态机 |
| `projectShadow` | 注入行**不带**（它表达的是「项目磁盘副本 vs 全局磁盘原版」关系） |

---

## 4. 来源映射（`source`/`provider` → `origin` + `channel`）

### 4.1 判定优先级（严格按序，首个命中即返回）

输入：registry `entry = {name, source, provider, resourceBase?}`，以及两个上下文标志：

- `globalRead`：同一 `name` 在**无 scope 读**里的条目（`Map<name, {provider, source}>`）；
- `fromPresetLayer`：`!globalRead.has(name)` **或** `globalRead.get(name).provider !== entry.provider` **或** `globalRead.get(name).source !== entry.source`（即：该名字在无 scope 读里不存在，或胜者身份不同 ⇒ 近层条目）`[I]`。

> **R3 裁定（Lead，2026-10-25）**：`origin` 只有 `bundled` / `plugin` / `preset`。下表「磁盘根条目」分支（第 7、9 行）一律 **不合并**（`classify` 返回 `undefined`），**不产生注入行**；磁盘来源只由面板磁盘视图表达。实现：`src/skills/registry.ts:459-464,503-507`。

| # | 条件 | origin | channel | 依据 |
|---|---|---|---|---|
| 1 | `provider === "dsh-office"` | `bundled` | `DSH 内置（Office）` | §2.4 asar office `:72-73`、desktop-host `:83-88` |
| 2 | `provider === "dsh-figma"` | `plugin` | `dsh-to-figma` | §2.4 figma `index.mjs:35-36` |
| 3 | `provider === "runtime"` 且 `source === "dsh-remote"` | `plugin` | `dsh-remote` | §2.4 dsh-remote `:156` |
| 4 | `provider === "runtime"` 且 `source` 是已知插件 source（`KNOWN_PLUGIN_SOURCES`，首期只有 `"dsh-remote"`） | `plugin` | 该 source | 同上（扩展点） |
| 5 | `provider === "runtime"`（其余，含 `source === "runtime"`） | `plugin` | **已知技能名前缀命中 → 表内插件名（首期 `dsh-diff-approval`）**；未命中 → `插件运行时注入` | §2.4 diff-approval `:2942,2998,4210`；前缀表实现 `src/skills/registry.ts:213-240`（`KNOWN_RUNTIME_NAME_PREFIXES` + `runtimeChannelOf`，精确匹配或 `前缀-` 边界）、使用点 `:519-523`；未命中回退 `RUNTIME_CHANNEL`（`:227`，Lead 裁定 R2）；维护方式 §4.3 `[F]` |
| 6 | `provider === "filesystem"` 且 `source === "custom"` 且 `fromPresetLayer` | `preset` | `presetId`（解析见 §4.2） | §2.4 cordis preset `presets/cordis.patch.yml:122-128`；rank 300 `filesystem/lib/index.js:22,167-168` |
| 7 | `provider === "filesystem"` 且 `source === "custom"`（global 层） | **不合并** | —（面板磁盘视图为权威；不在受管根的自定义目录本期不展示） | `filesystem` 的 `customSkillDirs` 根（`:167-168`）；不在面板 `managedRoots`（`manager.ts:58-74`）；R3 裁定 |
| 8 | `provider === "filesystem"` 且 `source === "bundled"` | `bundled` | `DSH 内置（随包技能目录）` | filesystem bundled 根 rank 600（`:182-183` + `README:56`） |
| 9 | `provider === "filesystem"` 且 `source ∈ {project-dsh, project-agents, user-dsh, user-agents}` | **不合并** | —（项目根解析差异导致的未受管磁盘根源码不出注入行，见 §5.6） | R3 裁定；`src/skills/registry.ts:503-507` |
| 10 | 其它 provider（未知插件 provider） | `plugin` | `provider` 原值 | 兜底；`provider` 由 registry 保证是字符串（`dsh-skill` `:452-463`） |

> **已知 runtime 前缀例外（Lead task-12，实现 `src/skills/registry.ts:213-240,519-523`）**：`provider === "runtime"` 且 `source` 未命中已知插件 source 时，**先按技能名前缀表识别注入方**——名字精确等于前缀，或以 `前缀-` 开头（带 `-` 边界，`dsh-diff-approvalx` 不会误命中）；命中即映射到表内渠道名（首期 `dsh-diff-approval` 覆盖其 `-comment` / `-annotate` 两个技能）；**未命中仍回退「插件运行时注入」**。这是 **additive 扩展点**：新增已验收插件只往 `KNOWN_RUNTIME_NAME_PREFIXES` 追加一条 `{prefix, channel}`，不改分类顺序、字段与 RPC 契约；维护规则见 §4.3。

### 4.2 preset 名解析（`channel = presetId`）

```ts
// 只在需要 preset 名时调用；每会话缓存，随 skills/change / agent/disposed 失效。
function presetIdOf(ctx: any, agent: any): string | undefined {
  const presets = ctx.get?.("agentPresets");           // 宿主 profile 层服务
  try {
    const id = presets?.composedPreset?.(agent?.ctx);   // dsh-agent-preset-registry:717-719
    if (typeof id === "string" && id.length > 0) return id;
    const first = presets?.inspectCompositions?.(agent?.ctx)?.[0]; // :559-568
    return typeof first?.id === "string" ? first.id : undefined;
  } catch { return undefined; }
}
```

- 解析失败 ⇒ `channel = "预设（未知）"`，行照常展示（**不得因此丢弃条目**）`[I]`。
- `presetId` 是**展示名**（如 `cordis` / `standard` / `ptc` / `minimal`；本机 preset id 见 `~/.dsh/profiles/desktop/cordis.yml:651-654,816-817,986-987,1083-1084`）`[F]`。
- 不读 preset 配置文件、不解析 YAML：registry 只暴露 id（`agent-presets` README 的声明式模型）；`readDocument` 是「查看」通道，不用于运行期归属 `[I]`。

### 4.3 渠道扩展点（后续）

- `KNOWN_PLUGIN_SOURCES: ReadonlyMap<string, string>` 放在 `src/skills/registry.ts`，键 = registry `source`，值 = 展示渠道名。首期只有 `"dsh-remote"`（`src/skills/registry.ts:210-211`）。
- `KNOWN_RUNTIME_NAME_PREFIXES: ReadonlyArray<{prefix, channel}>`（`src/skills/registry.ts:213-225`）：「runtime + source 未命中已知 source」时的**技能名前缀 → 插件名**映射表；匹配 = 名字**精确等于前缀**或**以 `前缀-` 开头**（`-` 边界，`runtimeChannelOf` `:229-240`）；未命中回退 `RUNTIME_CHANNEL`（`:227`）。首期只有 `dsh-diff-approval`（覆盖 `dsh-diff-approval-comment` / `dsh-diff-approval-annotate`），对应 Lead task-12。
- **维护方式（additive，不需要改契约）**：新增一个已验收、runtime 注册且能按名字前缀稳定识别的插件时，只往 `KNOWN_RUNTIME_NAME_PREFIXES` 追加 `{prefix, channel}`（`channel` = 该插件在面板其它位置展示的包名）；**不要**用裸 `startsWith(prefix)`，必须保留 `-` 边界；表只影响**展示渠道名**，不参与 `origin`、读写、启停判定，也不改变 §4.1 的判定顺序。
- 仍然无法识别的（无已知 source、也无已知前缀）：统一显示「插件运行时注入」——registry 的 `SkillSummary` 不暴露 registration 归属 `[F]`（§13-R2）。彻底区分需要上游在 summary 上暴露 registration 身份或自建 fiber 扫描，本期不做。

---

## 5. 注册表桥：合并算法（`src/skills/registry.ts` 新增）

### 5.1 三个读入口与各自的 scope

| 入口 | 调用 | scope | 覆盖的注入类别 | 理由 |
|---|---|---|---|---|
| 面板 `skills.list` | `service.skills.list(cwd)` | **无** | global 层注入（office/figma/remote/diff-approval/部署级 provider） | 面板无会话；preset 技能天然不可见（§9.1） |
| 会话 `skills.sessionList` | `service.skills.sessionList(cwd, sessionId)` | `scope: agent`（**live 时**） | global + preset + agent 层注入 | 与模型实际目录一致（`dsh-tool-skill` 同款 `scope: agent`：`:871,905,938`） |
| 冷会话 `sessionList`（无 live agent） | 同上 | 无（退化为面板口径） | 仅 global 层注入 | preset 技能无 agent 即不可枚举（§9.1） |

实现签名（`src/skills/registry.ts`）：

```ts
export interface RegistrySnapshotDeps {
  /** 插件 ctx；用 ctx.get("skills") 取宿主服务（不要 import 宿主单例）。 */
  ctx: any;
  logger?: { warn?: (m: string) => void };
  /** 取某 session 的 agent（live 判定 + scope 传参）；由 skills/session.ts 提供。 */
  agentOf?: (sessionId: string) => any | undefined;
}

export interface ClassifiedInjectedRow {
  name: string;
  description: string;
  whenToUse?: string;
  invocation: { modelInvocable: boolean; userInvocable: boolean };
  origin: "bundled" | "plugin" | "preset";
  channel: string;
  provider: string;
  registrySource: string;
  resourceBaseKind?: "directory" | "url" | "opaque";
  path?: string;
}

export interface InjectedMergeInput {
  cwd?: string;
  sessionId?: string;
  /** 磁盘视图行（manager.list 结果）；用于同名去重。 */
  diskRows: SkillSummaryView[];
  /** 项目默认禁用名单（overrides.skills）；用于 disabledInProject。 */
  projectDisabled: ReadonlySet<string>;
}
```

### 5.2 合并步骤（伪代码，实现按此逐条落测试）

```ts
async function mergeInjected(input: InjectedMergeInput): Promise<SkillSummaryView[]> {
  const skills = deps.ctx.get?.("skills");
  if (typeof skills?.snapshot !== "function" || typeof skills?.list !== "function") return []; // C1 降级
  const agent = input.sessionId !== undefined ? deps.agentOf?.(input.sessionId) : undefined;

  // 1) 无 scope 读（用于分类：谁能覆盖谁）
  const globalSnap = await safeSnapshot(skills, { cwd: input.cwd });
  const globalByName = byName(globalSnap?.skills ?? []);

  // 2) 视图读：live 会话带 scope=agent；否则等同无 scope
  const viewSnap = agent !== undefined
    ? await safeSnapshot(skills, { cwd: input.cwd, scope: agent })   // ← 只传 agent 对象，不构造 scope key（C2）
    : globalSnap;
  if (viewSnap === undefined) return cachedOrNothing();               // registry 不可用 → 降级 §5.7
  if (viewSnap.complete === false) { markIncomplete(); return cachedOrNothing(); }

  // 3) 过滤自身 shadow（provider=runtime + 固定描述）+ 与磁盘同名去重
  const diskNames = new Set(input.diskRows.map((r) => r.name));
  const rows: SkillSummaryView[] = [];
  for (const entry of viewSnap.skills) {
    if (isOwnShadow(entry)) continue;                                 // §5.5
    if (diskNames.has(entry.name)) continue;                          // §5.4 首期：磁盘优先
    const meta = classify(entry, globalByName, { agent, ctx: deps.ctx });
    cacheInjected(scopeKey(input), meta);                             // §5.5 元数据缓存
    rows.push(toSummaryView(meta, input.projectDisabled.has(entry.name)));
  }
  // 4) 被自身 shadow 遮蔽但缓存里有元数据的条目 → 用缓存补行（enabledInSession=false）
  //    仅在 live 会话视图执行（会话关闭后要仍然「看得见、能再打开」）
  if (agent !== undefined) rows.push(...cachedShadowedRows(scopeKey(input), diskNames, input.projectDisabled));

  return rows.sort(byNameThenOrigin);
}
```

关键决策（均已给出理由）：

1. **用 `snapshot` 而非 `list`**：`snapshot.complete === false` 是「provider 未完成/并发变更」的唯一信号（`dsh-skill` types `:152-157`、impl `:312-334` 的 `cacheable`）→ 必须据此启用 last-good，而不是把不完整目录当真 `[I]`。
2. **无 scope 读 + 有 scope 读各一次**：分类需要「同名的 global 胜者」，会话视图的注入行集合需要「实际胜者」。两次读都命中宿主 `collectCache`（`dsh-skill/lib/index.js:250-291` 的缓存键含 `cwd` + scope 链 + revision），成本可忽略 `[I]`。
3. **不把 registry 读塞进 `manager.ts`**：`createService` 的 `list` 保持纯磁盘语义（写路径 import/export/shadow 都依赖它），注入合并放在新模块，由 `index.ts` 组装到 `service.skills.list/sessionList` `[I]`。

### 5.3 与磁盘受管行的关系

- 磁盘行**字段零变化**：`injected` 不出现，`source` 仍是 `project-*/user-*/custom`，写路径完全不变（`src/skills/manager.ts:149-272`）。
- 注入行**永远不携带 `root`**（`summaryView` 的 `root` 是写盘寻址键，`manager.ts:288-303`），因此所有既有写 RPC 对注入行都会因缺 root 而走 scope 兜底——**必须**在 UI 隐藏写操作（§7.4），并在 RPC 层对注入行的写操作返回业务失败（§7.3）。
- 排序：磁盘行与注入行**合并后按 `name.localeCompare` 排序**（与 `manager.ts:135` 一致），同名列不可能出现（去重后）。

### 5.4 同名去重规则（首期）与后续扩展点

| 情况 | 首期行为 | 理由 |
|---|---|---|
| 注入条目的 name 与任一磁盘行同名 | **丢弃注入行**（磁盘优先） | 任务要求；宿主 rank 语义下项目磁盘条目通常确实是胜者（`project-dsh` 100 / `project-agents` 200 < `custom` 300 < `user-*` 400/500 < `bundled` 600），面板展示与「模型实际看到的」在绝大多数情况一致 `[I]` |
| 注入行被 **preset 层同名磁盘条目**覆盖 | 归入上一条（preset 层包含项目磁盘根；同名 ⇒ 磁盘行存在 ⇒ 丢弃注入行） | §2.4 `[I]` |
| 注入条目之间同名 | registry 已层内去重，视图读只返回胜者（`dsh-skill/lib/index.js:312-334`） | `[F]` |

**后续精确同名的扩展点**（本期只记录、不实现）：

- 面板值：`conflicts?: Array<{origin, channel, provider}>`（additive），UI 可展开「同名来源」；
- 或使用 `${origin}:${name}` 复合行 key + 独立的「注入条目」分区；
- 前置依赖：`skills.list` 需要同时拿「无 scope」与「逐层」视图（宿主目前不暴露逐层列表，只能靠无 scope + 有 scope 两次读推差集）`[I]`。

### 5.5 自身 shadow 过滤与元数据缓存（关键 UX 保障）

**标记**：`SHADOW_DESCRIPTION = "本会话已禁用（capability-panel）"`（`src/skills/session.ts:66-67`）`[F]`。

```ts
function isOwnShadow(entry: {provider?: string; description?: string}): boolean {
  return entry.provider === "runtime" && entry.description === SHADOW_DESCRIPTION;
}
```

- **不能**用 `source` 过滤：现有注册未传 `source`（`src/skills/session.ts:185-190` 的 register 入参只有 name/description/content/invocation），运行时 `source` 可能是 `undefined`；只有 `provider`（缺省补 `"runtime"`，`dsh-skill/lib/index.js:200-208`）+ `description` 稳定 `[F][I]`。实现时应顺手在 `session.ts` 的 register 里显式补 `source: "runtime"` 与 `metadata: {"capability-panel/shadow": true}`（后者便于 `ctx.skills.get` 侧二次确认，`SkillDefinition.metadata`，types `:72-77`；`list` 摘要不含 metadata `[F]`）。
- **元数据缓存**（纯内存、有界）：

```ts
interface CachedInjectedMeta { name: string; description: string; whenToUse?: string;
  invocation: {modelInvocable: boolean; userInvocable: boolean};
  origin: SkillOrigin; channel: string; provider: string; registrySource: string;
  resourceBaseKind?: "directory" | "url" | "opaque"; path?: string; }
// key = `${scopeKey}::${name}`；scopeKey = "global" 或 `session:${sessionId}`
// 上限 256 条（LRU）；清空时机：skills/change、agent/disposed、插件 dispose
```

- **写入时机（强制）**：每次 `setSessionEnabled(false)` / 项目默认 shadow 注册**之前**必须先做一次 scope 快照并 `cacheInjected`（这就是「read-before-shadow」）。否则：重启后第一条 `sessionList` 只看到自己的 shadow、缓存为空 ⇒ 该技能从会话列表里**彻底消失**，用户无法再打开 `[I]`。
- **读取兜底**：当视图快照里某名字的胜者是 `isOwnShadow`，但缓存里有该名字的注入元数据 ⇒ 用缓存元数据生成一行，`enabledInSession=false`，`canToggleInSession=true`。
- 缓存里若没有（例如 shadow 是别的 profile 实例留下的、或缓存被清）⇒ 本轮**不生成**该行；下一次 `skills/change` 后正常 `[I]`。
- **不得**把缓存当作权威：它只用于「展示被自己遮蔽的条目」，`enabledInSession` 仍由 §6.3 状态机算。

### 5.6 registry 有、面板没扫到的磁盘条目（R3：不合并）

**事实**：宿主 filesystem provider 的项目根 = 「最近的含 `.git` 的祖先；没有则用 cwd」（`dsh-skill-filesystem/README.md:56`）`[F]`；而本仓库的 `findProjectRoot` 认 5 个标记（`.git/.dsh/.agents/.claude/dsh.json`，`src/shared/project-root.ts:29`、`:57-62`）`[F]`。

**推演** `[I]`：存在 cwd 使两者解析出不同项目根（例：`~/proj/.agents` 存在但 `~/proj` 无 `.git`，cwd=`~/proj/sub`：宿主扫 `~/proj/sub`，面板扫 `~/proj`）⇒ 会出现「registry 有、磁盘视图无」的 `project-*`/`user-*` 条目。

**R3 裁定（Lead，2026-10-25）**：这类条目**不合并**。`classify` 对 `provider === "filesystem"` 且 `source ∈ {project-*, user-*, 全局 custom}` 返回 `undefined`（实现 `src/skills/registry.ts:503-507`），面板**不产生注入行**（`injected`/`origin` 都不出现），磁盘来源仍只由面板磁盘视图表达。理由：它们不在面板受管根内，任何写路径都会落到错误目录；只读行又会制造「看得到、不能改」的困惑。

- 测试口径见 §11 RB-8（期望 = 不产生行）。
- 已知限制：这类条目在面板中**不可见**（不是隐藏，而是不合并）；若产品后续确需展示，前置条件是先把该根纳入 `managedRoots`（或提供独立的只读根配置），本期不做，也不引入第 4 个 `origin` 值 `[I]`。

### 5.7 失败降级矩阵

| 失败 | 行为 | 证据/理由 |
|---|---|---|
| `ctx.get("skills")` 缺失 / 无 `snapshot` | 返回 `[]`（仅磁盘行）；`logger.warn` 一次（去重） | 插件 `inject:["skills"]`（`src/index.ts:46`）保证正常存在；headless 定制组合可能缺 `[A]` |
| `snapshot` 抛错 | 返回 last-good（缓存的行）；没有则 `[]` | registry 自身已 catch provider 错误并标记 incomplete（`dsh-skill/lib/index.js:352-360`），这里只兜 API 形态漂移 |
| `snapshot.complete === false` | **不更新** last-good，本轮沿用缓存 | types `:152-157`；impl `:312-334` |
| agent 不存在（冷会话） | 视图读退化为无 scope 读（仅 global 注入） | §9.1 |
| `composedPreset` 抛错/缺失 | `channel="预设（未知）"`，行保留 | §4.2 |
| 单个 provider 的条目字段异常（如 description 为空） | 丢弃该条目（不整批失败），`logger.warn` | registry 侧 `validateCandidate` 已在 provider 层拦截（`dsh-skill/lib/index.js:452-463`）；这里防类型漂移 |
| `skills/change` 触发 | 清空 last-good + 元数据缓存；下一次读取重建 | types `:204-212` |
| 插件 dispose | 清缓存、解绑监听 | 与 `src/index.ts:198-211` disposer 风格一致 |

### 5.8 性能与缓存预算

- 每次 `list` / `sessionList`：≤ 2 次 `snapshot`（无 scope + 有 scope；冷会话 1 次）；宿主内部 `collectCache` 已按 `cwd+scopeChain+revision` 缓存（`dsh-skill/lib/index.js:250-291`）`[F]`；
- 额外内存：last-good ≤ 256 行 + 元数据缓存 ≤ 256 条；
- 不使用轮询：面板刷新沿用现有 `useAsyncList` 拉取；`skills/change` 仅清缓存（不主动推 UI）。

---

## 6. 项目级默认启停 / 会话开关

### 6.1 存储：扩展 `capability-overrides.json`

磁盘形状（**保持最小化：空数组不落盘**，与现有写盘风格一致 `src/overrides/config-file.ts:78-85`）：

```jsonc
{
  "mcp": ["github"],
  "skills": ["figma-workbench", "cordis-plugin-development"]
}
```

类型/读写改动清单：

| 文件 | 改动 | 依据 |
|---|---|---|
| `src/overrides/types.ts` | `CapabilityDomain = "mcp" \| "skills"`；`CapabilityOverrides.skills?: string[]`；**重写 `:12-14` 注释**（旧语义「skills 不走声明」已作废） | `:27-34` |
| `src/overrides/config-file.ts` | `DOMAIN_KEYS = ["mcp","skills"]`；`emptyOverrides() = {mcp:[],skills:[]}`；读写循环自动覆盖新域（无需改循环体） | `:21`、`:24-26`、`:53-72`、`:78-85` |
| `src/overrides/manager.ts` | `toggle()` 里 `next` 改为按 `DOMAIN_KEYS` 重建（当前硬编码 `{mcp: ...}` 会**抹掉 skills**） | `:87` |
| `src/index.ts` | overrides 包装：`domain==="skills"` 时调用「把项目默认热应用到该项目 live 会话」的钩子（与 mcp 的 `loader.reload` 平行） | `:121-130` |

语义与迁移：

- **只接受 kebab-case 技能名**（与宿主名称文法一致，`dsh-skill/lib/index.js:17`）；非法/空白名写入时拒绝（`errors`），读入时 `normalizeList` 已 trim/去重/排序（`config-file.ts:31-43`）。
- **只对注入条目生效**：名单里若出现「磁盘技能名」→ 注册阶段跳过（磁盘技能的项目级禁停继续用 shadow stub，`src/skills/shadow.ts:62+`，`src/skills/manager.ts:243-260`）。跳过时 `logger.warn` 一次，不写文件、不报错给 UI `[I]`。
- **旧文件兼容**：历史版本读到 `skills` 键会忽略并在下次写盘清除（`src/overrides/types.ts:12-14`）。新版本把它当**有效声明**重新解释；旧值只可能是用户手工写入或历史遗留，效果 = 「若该名是注入技能则默认禁用，否则忽略」⇒ 无破坏性 `[I]`。写盘时仍按最小化规则（空数组删除键）。
- **不写 frontmatter**：注入技能没有磁盘文件；项目默认一律走本节声明的 overrides + runtime shadow。磁盘技能的启停仍走 frontmatter（`src/skills/manager.ts:9-12` 的既有设计）`[F]`。

### 6.2 项目级默认 → agent 作用域 runtime shadow

注册时机与语义：

| 时机 | 动作 |
|---|---|
| `agent/created` | 记录 agent（沿用 `session.ts:117-125`）；用 `agent.session.header.cwd` 解析项目根（cwd 取值先例：`dsh-to-figma/index.mjs:69` 的 `session.header.cwd`）`[I]`；读该项目 `overrides.skills`；对每个名字执行 **read-before-shadow**（§6.3）后注册 |
| 插件启动时已有 agent | `ctx.get("agents").list()` 补登记（`session.ts:127-129`），同样按上一条应用（可延后到首次读取，避免加载期注册风暴；见 §6.6 时序） |
| `overrides.toggle({domain:"skills"})` | 写盘成功后，对该项目**全部 live 会话**增量 reconcile（disable → 注册；enable → 解除），并刷新 `disabledInProject` |
| `agent/disposed` | 删除会话记录；shadow 由 agent fiber 自动回收（**不要**手动 dispose，`session.ts:120-124` 注释）`[F]` |
| 插件 dispose | 移除监听、清 Map；agent 上的 shadow 随 fiber 回收 |

**时序风险（必须按降级处理）**：`agent/created` 时 `agent.ctx.get("skills")`、preset 层 provider 是否已就绪**没有宿主源码证据**（与 Jev 架构文档 §1.4-1 的未决项同源）。降级：`setTimeout(0)` + 2 次短重试（100ms/300ms，沿用 `src/jev/apply.ts` 的 `READY_RETRY_DELAYS_MS` 思路），仍失败则记 pending，在该 session 的**下一次** `sessionList` 里再试一次；再失败只 `logger.warn`，不阻断会话 `[A][I]`。

### 6.3 会话/项目状态机（`SessionRecord` 扩展）

```ts
interface SessionRecord {
  agent: any;
  /** 实际注册中的 shadow（name → disposer）。 */
  shadows: Map<string, () => void>;
  /** 会话显式开关（缺省 = 跟随项目默认）。true = 显式开启。 */
  explicit: Map<string, boolean>;
  /** 本项目默认禁用名单（注册时快照；toggle 热更新）。 */
  projectDefaults: Set<string>;
  /** 已尝试但尚未生效的项目默认名（下次读取重试）。 */
  projectPending: Set<string>;
  /** 本会话注入条目元数据缓存（被 shadow 遮蔽时展示用，§5.5）。 */
  meta: Map<string, CachedInjectedMeta>;
}
```

**有效状态**：

```
effectiveDisabled(name) = shadow 实际存在               // 以实际注册为准
explicit 状态：explicit.has(name) ? explicit.get(name) : !projectDefaults.has(name)
```

| 项目默认 | 会话显式 | 期望 shadow | `enabledInSession`（UI） | 说明 |
|---|---|---|---|---|
| 未禁用 | 无 | 无 | `true` | 默认可用 |
| 未禁用 | 显式关 | **有** | `false` | 会话内关闭 |
| 禁用 | 无 | **有** | `false` | 项目默认关闭 |
| 禁用 | 显式开 | 无 | `true` | **会话显式优先** |
| 禁用 | 显式关 | 有 | `false` | 冗余但一致 |

- `canToggleInSession`：`record !== undefined`（与现有语义一致，`session.ts:144`）。
- `setSessionEnabled({name, enabled})`：`enabled===true` → `explicit.set(name,true)`；`false` → `explicit.set(name,false)`。**新增** `enabled === undefined` = 清除显式覆盖、回到项目默认（与 MCP `setSessionEnabled` 的 `undefined` 语义对齐，`src/remote.ts` mcp 段注释）`[I]`。Jev 只传 boolean（`src/jev/apply.ts:385`），不受影响。

**reconcile(name)（唯一写路径，幂等 + 校验）**：

```ts
async function reconcile(record, name, desiredEnabled): Promise<{ok: true} | {ok:false; errors:string[]}> {
  const shouldDisable = !desiredEnabled;
  if (shouldDisable) {
    if (record.shadows.has(name)) return { ok: true };                 // 幂等
    // read-before-shadow：拿元数据 + 确认 name 在 registry 内可解析（§5.5）
    const before = await snapshotFor(record);                          // scope=agent
    cacheFromSnapshot(before);
    const dispose = skillsOf(record).register({
      name, description: SHADOW_DESCRIPTION, content: "",
      source: "runtime", metadata: { "capability-panel/shadow": true },
      invocation: { modelInvocable: false, userInvocable: false },
    });
    record.shadows.set(name, typeof dispose === "function" ? dispose : () => undefined);
    // read-after-shadow：确认胜者真的变成自己的 shadow
    const after = await snapshotFor(record);
    const winner = byName(after?.skills ?? []).get(name);
    if (!isOwnShadow(winner)) {                                        // 同层 runtime 先到先得（§2.5）
      record.shadows.delete(name); try { dispose?.(); } catch {}
      return { ok: false, errors: [`skill "${name}" 由同作用域已注册的运行时条目提供，无法在本会话禁用`] };
    }
    return { ok: true };
  }
  const dispose = record.shadows.get(name);
  if (dispose === undefined) return { ok: true };                      // 幂等
  try { dispose(); } catch (e) { return { ok:false, errors:[`恢复失败：${String((e as Error)?.message ?? e)}`] }; }
  record.shadows.delete(name);
  return { ok: true };
}
```

- **read-after 校验的代价**：多一次 `snapshot`（宿主内部缓存，成本可忽略）；收益是消灭「假成功」（`session.ts:171-176` 的既有理由）`[I]`。
- 校验失败时**保留原状**（不写显式状态）并返回业务失败 —— UI 不得显示已切换。
- 磁盘技能同样走 reconcile（现有行为不变）；只是磁盘技能有独立磁盘视图，不依赖缓存展示。

### 6.4 与现有 `skills/session.ts` 的关系

- **不新写第二套 shadow 机制**：`SessionRecord.shadows`/`skillsOf`/`find`/生命周期监听全部复用；本契约只**扩展**记录字段与 reconcile 校验、并新增「项目默认」来源。
- `list()` 的过滤条件保持（`shadowStub` 磁盘占位 + 双向禁用不可切换，`session.ts:138-140`），注入行额外规则：`contentReadOnly` 不参与过滤（内容只读 ≠ 不可启停）。
- `enabledInSession` 改由 §6.3 状态机产出（旧实现只判断 `shadows.has`，无法表达「项目默认」）。
- `SHADOW_DESCRIPTION` 需**导出**（当前是模块内常量 `session.ts:67`）供 registry 桥过滤；字符串值不变，避免与旧会话内注册的 shadow 不匹配 `[F]`。

### 6.5 dispose / 回滚 / 并发

| 场景 | 处理 |
|---|---|
| agent 销毁 | shadow 挂 agent ctx 效果自动回收；删记录；清该 session 的元数据缓存 `[F]`（`session.ts:120-124`） |
| 项目默认 toggle 写盘失败 | 不 reconcile、不改内存状态；UI 显示失败（现有 `toggle` 错误信封） |
| reconcile 中途失败（多名字） | **逐名独立**：成功的保留、失败的回调里返回明细；不做整批回滚（项目默认是「期望状态」，下次读取会重建；与 Jev 的「写事务」语义不同）`[I]` |
| 并发 toggle / 同 session 多次 setSessionEnabled | 每 session 一个 promise 队列（`record.queue = record.queue.then(work)`），写盘仍由 `withFileLock` 串行（`src/overrides/manager.ts:85`）`[I]` |
| preset 切换（blank session 换 preset） | 会话可能重新 `agent/created`；按新 agent 重新应用项目默认；旧 shadow 随旧 fiber 回收 `[I]` |

### 6.6 UI 语义（交给 ux/frontend，契约只固定数据）

- 面板（全局区）注入行：显示 `channel` 角标 + `只读` 标记；提供「默认（本项目）」开关（写 `overrides.toggle({domain:"skills"})`）——与 MCP 外部注入的既有交互范式一致（`docs/ux/panel-upgrade.md:581-602,626-627,661-664,979` 的「外部注入 / 运行时注入 · 只读 / 只读原因条」），UX 文档需新增技能段落（§13-R6）`[I]`。
- 会话能力区（`composer-capability.tsx:148,1807`）：注入行与磁盘行同列，开关调 `skills.setSessionEnabled`；`origin=preset` 行显示预设渠道角标。
- 详情页：隐藏 创建/编辑/删除/导入/调用方向/导出到宿主路径 等写操作（`contentReadOnly`）；保留「查看正文/资源」「本会话启停」「本项目默认」。
- 计数口径：沿用 `docs/ux/panel-upgrade.md:116` 的「含只读、含屏蔽占位、不去重」——注入行**计入**全局计数（本契约下与磁盘行不重名，因此不会重复计）`[I]`。

---

## 7. RPC 契约（`src/remote.ts`）

### 7.1 端点变更表（全部 additive）

| endpoint | 变更 | payload | value |
|---|---|---|---|
| `skills.list` | 行内新增注入字段 | `{cwd?}`（不变） | `SkillSummaryView[]`（含注入行） |
| `skills.sessionList` | 同上 + 项目默认/显式会话状态 | `{cwd?, sessionId?}`（不变） | `SessionSkillView[]` |
| `skills.setSessionEnabled` | 支持 `enabled?: boolean`（`undefined` = 清除显式覆盖） | `{sessionId, name, enabled?}` | `{ok:true}` \| `{ok:false, errors}` |
| `skills.read` | **修 root 解析** + registry fallback | `{name, cwd?, root?, scope?, target?, sessionId?}` | `ReadResult`（原有字段 + `fromRegistry?`, `resourceBaseNote?`, `resources` 语义扩展） |
| `skills.readResource` | **新增** | `{name, cwd?, sessionId?, path}` | `{ok:true, path, size, content}\|{ok:false, errors, code}` |
| `skills.export` | 注入行 fallback（内容快照） | `{name, cwd?, sessionId?, root?, scope?, target?, destDir?, overwrite?}` | 现有 `ExportFilesResult` \| 业务失败 |
| `overrides.get` | 返回新增 `skills` 域 | `{cwd?}` | `{mcp: string[], skills: string[], filePath?}` |
| `overrides.toggle` | 支持 `domain:"skills"` | `{cwd, domain, key}` | `{ok:true}` \| `{ok:false, errors}` |

不新增 `skills.setProjectEnabled`：项目默认的统一入口是 `overrides.toggle`（与 mcp 一致），避免两套写面 `[I]`。

### 7.2 新端点类型（客户端 `api.ts` 镜像同名）

```ts
export interface SkillResourceEntry { path: string; kind: "file" | "dir"; size?: number }
export type SkillResourceResult =
  | { ok: true; path: string; size: number; content: string; truncated: boolean }
  | { ok: false; errors: string[]; code?:
      | "not-found" | "escape" | "not-text" | "too-large"
      | "unsupported-base" | "registry-unavailable" | "requires-session" | "read-only" };

export interface SkillsApi {
  // ...现有
  read(name: string, ref?: SkillRef & { sessionId?: string }): Promise<ClientSkillDetail | undefined>;
  readResource(input: { name: string; path: string; sessionId?: string }): Promise<SkillResourceResult>;
}
```

### 7.3 业务错误码（新，包在 `value:{ok:false, errors, code?}` 里）

| code | 触发 | UI 行为 |
|---|---|---|
| `registry-unavailable` | `ctx.get("skills")` 缺失 / snapshot 抛错 | 提示「宿主技能注册表不可用，仅显示磁盘技能」；磁盘功能不受影响 |
| `requires-session` | 读 preset 层注入技能但无 live agent | 提示「打开该会话后可查看全文」 |
| `not-found` | registry `get` 返回 `undefined` | 提示「技能已不可用（可能已被插件卸载）」 |
| `unsupported-base` | `resourceBase.kind !== "directory"` | 详情只显示正文；资源区显示「该技能不提供可浏览资源」 |
| `escape` | 资源相对路径越界/符号链接逃逸 | 提示「路径不允许」；**不回显**解析后的绝对路径 |
| `not-text` | 非法 UTF-8 / 二进制 | 「该文件不是文本，无法预览」 |
| `too-large` | 超过单文件上限（256 KiB） | 显示大小 + 截断/拒绝说明 |
| `read-only` | 对注入行调用任何写 RPC | 「注入技能内容只读」 |

传输层信封规则不变（C3）；`handleEndpoint` 新增 `case "skills.readResource"` 与 `overrides` 域扩展（`src/remote.ts:124-204`）`[F]`。

### 7.4 写操作对注入行的拦截（服务层，不是仅 UI）

每个既有写 RPC（`create/update/remove/setEnabled/setInvocation/install/importToProject/disableInProject/enableInProject/export` 的写路径）在入口处判断：

```ts
// 宿主侧唯一判据：该 name 是否属于「当前注入行集合」（injected:true）？
// 注意：不能只靠 client 传的字段（可伪造），必须重新查 registry。
```
- 命中 ⇒ `{ok:false, errors:["注入技能内容只读，只能在本项目/本会话启停"], code:"read-only"}`；
- 例外：`skills.export`（只读导出，允许，§8.4）；`skills.setSessionEnabled` / `overrides.toggle`（允许）。
- 该判断需要一次 snapshot（可用缓存，§5.8）；**不得**因为「名字不在磁盘视图」就直接拒绝：不在受管根的磁盘根条目按 R3 **不会出现在注入行里**（§5.6），对它们的写请求仍走既有磁盘路径（客户端没有 `root` 时由既有 `resolveRoot` 兜底）；只有确认是注入行时才返回 `read-only` `[I]`。

---

## 8. 详情、导出与资源读取边界

### 8.1 `ctx.skills.get` fallback（详情）

宿主侧 `skills.read` 新流程：

```
1) 有 root（磁盘行） → readSkillDetail(root, name)（现有逻辑，行为不变）
2) 无 root：
   a) 用 name 在 registry 视图（sessionId 有 → scope=agent；否则无 scope）里解析条目；
      命中磁盘同源条目 → 走 resolveRoot 的磁盘路径（修 §8.5 的既有缺陷）
   b) 命中注入条目 → ctx.skills.get(name, { cwd, ...(agent ? { scope: agent } : {}) })
      → SkillDefinition {content, metadata, source, provider, resourceBase, ...}
      → 组装 ReadResult{ok:true, spec:{name,description,whenToUse?,invocation,metadata?}, body:content,
                        format:"directory", resources: listResourceNames(resourceBase), fromRegistry:true}
3) registry 命中但 get 返回 undefined → {ok:false, code:"not-found"}
4) 都没有 → 现有 not-found 行为（面板显示空/不存在）
```

- `spec.invocation` 由 `definition.invocation` 反向投影为 frontmatter 形态（`invocationPolicy` 的逆：`disable-model-invocation: !modelInvocable`、`user-invocable: userInvocable`，见 `src/skills/types.ts:74-79`），**不落盘**、仅用于 UI 展示 `[I]`。
- **不把 `metadata` 中的任意键当路径/命令使用**；只原样展示可选键（无 UI 需求时不下发）。
- preset 层条目的详情在冷会话返回 `requires-session`（§7.3）。

### 8.2 `resourceBase` 三类处理

| kind | 详情 | 资源浏览 | 导出 |
|---|---|---|---|
| `directory` | 列一层条目名（文件/目录；排除 `SKILL.md` 自身；最多 200 条，超出截断） | ✅ `skills.readResource`（路径必须在目录内） | 内容快照（§8.4） |
| `url` | 只给正文 + `resourceBaseNote="资源在远端，本地不可浏览"` | ❌ `unsupported-base` | 内容快照 |
| `opaque` | 只给正文 + description 文案 | ❌ `unsupported-base` | 内容快照 |
| 缺失 | 只给正文 | ❌ | 内容快照 |
| `resourceBase.kind === "directory"` 但路径不可读/不存在 | 只给正文 + note | ❌ `not-found` | 内容快照 |

### 8.3 路径边界（`skills.readResource`，硬要求）

复用仓库既有先例，**不新造一套**：

1. **基准目录只来自宿主**：`base = definition.resourceBase.path`（来自 `ctx.skills.get` 的返回值），**绝不接受客户端传的基准目录**；
2. 客户端只传 `path`（POSIX 相对路径）：先 `validateRelativePath`（`src/skills/validate.ts:12-22` 同款规则：非空、无 `..` 段、非绝对、无反斜杠）；再 `resolve(base, rel)`，结果必须 `startsWith(resolve(base) + sep)`（先例 `src/skills/crud.ts:27-33`）；
3. `lstat`：只接受常规文件（`isFile()`）；**拒绝符号链接**（仓库无 realpath 先例，宿主 provider 文档明确「保留 symlink 路径」，`dsh-skill-filesystem/README.md` "Catalog entries and loaded skills expose the resolved instruction-file path, so symlinked directories … retain the discovered paths" ⇒ 必须显式防逃逸）`[F][I]`；
4. `realpath(base)` 与 `realpath(target)` 再做一次前缀校验（防 base 内部 symlink 到外部）；
5. 大小上限 **256 KiB**（先例：上传 20 MiB/下载 30 MiB 是传输上限，`src/skills/transfer.ts:48-49`；单文件预览取更小值 `[I]`）；`stat.size` 超限直接 `too-large`；
6. 读取用 `Buffer` + `new TextDecoder("utf-8", { fatal: true })`，失败 ⇒ `not-text`（不要用 `readFile(...,"utf8")` 静默替换，见 `src/skills/disk.ts:163` 的已知行为）；
7. 不递归、不写、不删；单次请求只读一个文件；不做压缩/打包。

### 8.4 导出语义（注入行）

- `skills.export`（浏览器下载）：返回**单文件内容快照**：
  - `format:"flat"`、`files:[{path:`${name}.md`, content: "---\nname: …\ndescription: …\n---\n\n" + body}]`；
  - 附加 additive 字段 `lossy: true`（`ExportFilesResult` 增加可选字段），提示「资源文件（如有）不会被打包」；
  - 正文不可用（`get` 失败）⇒ 业务失败 `not-found`。
- `skills.export`（`destDir` 宿主路径）：写单个 `<destDir>/<name>.md`（同上内容），走既有 `exportToPath` 的路径/覆盖校验；**不复制** `resourceBase.directory`（asar 内路径、symlink、跨盘权限都可能失败，且写面扩大）`[I]`。
- 磁盘技能导出**完全不变**（`src/skills/transfer.ts`）。

### 8.5 顺手必修的既有缺陷（属于本契约前置）

`skills.read` 的客户端适配器当前**不传 root、不解业务信封**（`src/client/api-adapter.ts:149-157`，`src/client/api.ts:140`）⇒ 项目技能详情恒 not found、失败被当成空详情（recon §3.1 已确认）。本契约要求：

- 客户端 `read` 传 `ref`（`root` 优先，`scope/target` 兜底；会话视图再带 `sessionId`）；
- 适配器用 `unwrap()` 解业务信封（与 `exportFiles`/`mcp.test` 同款，`api-adapter.ts:220-240`、`:283-290`）；
- 否则 §8.1 的 fallback 无法到达（会先被 root 缺失的磁盘路径掩盖）`[F][I]`。

---

## 9. 冷会话边界与 Jev 排队重放

### 9.1 可见性矩阵（必须写进 UX 文案）

| 类别 | 面板 `list`（无会话） | `sessionList`（live） | `sessionList`（cold） | Jev `rank`（cold） | Jev `apply` 重放 |
|---|---|---|---|---|---|
| 磁盘受管行 | ✅ | ✅ | ✅ | ✅ | ✅ |
| global 层注入（office/figma/remote/diff-approval/部署级 provider） | ✅ | ✅ | ✅（退化为无 scope） | ✅ | ✅ |
| preset 层注入（如 `cordis` 的 5 个技能） | ❌ | ✅ | ❌ | ❌ | ⚠️ 激活后才出现，但**不在冻结的计划里**，见 §9.3 |

- **冷会话为什么看不到 preset 技能**：`scope` 只能是「某个 agent 对象」，没有 live agent 就没有 scope key，`ctx.skills.snapshot` 无法选中 preset 层（`SkillViewOptions.scope` 语义，types `:98-101`；`dsh-tool-skill` 也只在有 `exec.agent`/`agent` 时传 scope `:871,905,938`）`[F][I]`。
- 因此 `rank` 在冷会话里**评分集合不含 preset 技能**；这是文档明确的上游边界，不是缺陷 `[I]`。会话激活后用户可重新评分。

### 9.2 Jev 枚举/评分/应用链路改动

| 位置 | 改动 |
|---|---|
| `enumerateCapabilities` skills 段（`src/jev/apply.ts:249-272`） | 无逻辑改动：`sessionList` 自带注入行后，自动进入评分集合；新增字段透传到 `JevCapability`（§3.3） |
| `skillSourceOf`（`:173-175`） | **不改**：它只区分 project/global 两档；注入行的 `source="external"` 会落 `"global"`（`startsWith("project")` 为 false）⇒ 语义正确（注入不是项目级）`[F][I]` |
| `writeOne` skills 分支（`:374-390`） | 不变（`setSessionEnabled` 已支持注入行） |
| 回滚（`restoreOne` skills 分支，`:427-444`） | 不变 |
| `JevRankResult.items` | 新增可选 `origin/channel/provider/contentReadOnly`（§3.3）；客户端渲染角标 |

### 9.3 Jev 冷会话排队重放的边界（已核实的「安全」与「不安全」）

**安全（Fact）**：待应用计划在**入队时**就冻结了「当时所有可应用能力的目标态（含关闭）」，重放时只按 `plan.ops` 逐 id 重解析，不会遍历「重放时刻新出现的能力」：

- `JevPendingPlan.ops` 注释明确「入队时记录当时所有可应用能力的目标态（含关闭）；激活后重新枚举、按 id 匹配并只写当前状态 ≠ 目标的项」（`src/jev/apply.ts:86-99`）；
- `resolvePlanned` 只 `for (const {id, desired} of plan.ops)`（`:638-660`）；
- 因此「激活后 preset 技能才出现在会话里」**不会**被「未勾选 = 关闭」的筛选语义误关 `[F][I]`。

**不安全/需文案（Inference）**：

1. 冷会话 `rank` 的评分集合不含 preset 技能 ⇒ 用户**无法**在首轮勾选它们；激活后它们默认可用（项目默认可关闭，§6）。
2. 冷会话 `rank` 与 `apply` 之间若插件/预设变化，磁盘技能也可能增减——现有语义就是「按入队集合」处理，新增能力不动、消失的能力记 `unknown-id` 跳过（`:641-651`）`[F]`。
3. 冷会话入队时 `canToggleInSession=false`，`enumerateCapabilities` 用 `live=false` 豁免（`src/jev/apply.ts:218-226` 注释 + `:254` 的 `applicable` 计算），所以**可以**把 global 层注入技能写进计划；重放时 `live=true` 重新判定（§9.1）`[F]`。
4. **项目默认禁用**在冷会话 `rank` 里必须已经体现（`enabledInSession=false` 初值），否则用户以为默认开着。实现要求：冷会话 `sessionList` 从 `overrides.skills` 读文件算 `disabledInProject`（无需 agent）`[I]`。

**结论**：不需要改 Jev 的 pending 结构；但需在 UI/文档写清「preset 技能在会话开始前不参与评分」`[I]`。

---

## 10. 模块拆分、写作用域与依赖顺序

| 角色 | 任务建议 | 写作用域 | 依赖 |
|---|---|---|---|
| backend | `src/skills/registry.ts`（新）、`src/skills/project-defaults.ts`（新，或并入 session.ts）、`src/skills/{types,manager,session}.ts`、`src/overrides/{types,config-file,manager}.ts`、`src/remote.ts`、`src/index.ts`、`src/jev/{apply,types}.ts`（仅透传字段） | `src/**` | blocked_by: 本文 |
| frontend | `src/client/{api,api-adapter,panel,composer-capability,styles}.ts(x)` | `src/client/**` | blocked_by: 本文 + backend 类型落地（可先按 §3/§7 契约并行） |
| tester | `notes/verify/**`（SSR + 纯函数 + fake ctx；真机探针） | `notes/verify/**` | blocked_by: backend + frontend |
| Lead | `README.md`、`CHANGELOG.md`、`lib/**`、`package.json`（devDep 复核） | 仓库根 | 收尾 |

**无文件重叠**：backend 不碰 `src/client/**`；frontend 不碰其它 `src/**`；tester 只碰 `notes/verify/**`。软耦合 = §3/§7 的类型与端点，契约已冻结。

---

## 11. 测试矩阵

> 全部可用 **fake `ctx.skills`**（`snapshot/list/get/register` 手写桩）在 Node 下跑，不依赖真实宿主；真机项单列。测试脚本按仓库惯例放 `notes/verify/`（gitignored），由 tester 实现。

### 11.1 注册表桥（宿主，纯函数/服务级）

| ID | 用例 | 输入 | 期望 |
|---|---|---|---|
| RB-1 | bundled/office | fake snapshot 含 `provider:"dsh-office", source:"bundled"` | 行 `injected=true, origin="bundled", channel="DSH 内置（Office）", contentReadOnly=true` |
| RB-2 | 插件 provider | `provider:"dsh-figma", source:"bundled"` | `origin="plugin", channel="dsh-to-figma"` |
| RB-3 | runtime + 已知 source | `provider:"runtime", source:"dsh-remote"` | `origin="plugin", channel="dsh-remote"` |
| RB-4 | runtime + source=runtime（未命中已知前缀） | `provider:"runtime", source:"runtime"`，技能名如 `mystery-runtime` | `origin="plugin", channel="插件运行时注入"` |
| RB-4c | runtime 已知技能名前缀（task-12） | `provider:"runtime", source:"runtime", name:"dsh-diff-approval-comment"` | `origin="plugin", channel="dsh-diff-approval"`（精确前缀或以 `前缀-` 开头；`dsh-diff-approvalx` 不命中，仍回退统一文案） |
| RB-5 | preset 层 custom | 无 scope 读无该名；有 scope 读有 `source:"custom", provider:"filesystem"`；fake `agentPresets.composedPreset→"cordis"` | `origin="preset", channel="cordis"`；**面板 list 不含**、live sessionList 含 |
| RB-6 | preset 名不可解析 | `composedPreset` 抛错 | `channel="预设（未知）"`，行保留 |
| RB-7 | 同名磁盘优先 | 磁盘行 `foo` + snapshot `foo` | 只 1 行、`injected` 不出现 |
| RB-8 | 未受管磁盘根（R3：不合并） | snapshot `source:"project-agents"` 且磁盘视图无该名 | **不产生注入行**：`injected`/`origin` 都不出现；面板只显示受管磁盘行；`classify` 返回 `undefined`（实现 `src/skills/registry.ts:503-507`） |
| RB-9 | 自身 shadow 过滤 | snapshot winner `{provider:"runtime", description:SHADOW_DESCRIPTION}` | 不产生行 |
| RB-10 | 被 shadow 的注入行用缓存补显 | 先一次正常快照（缓存）→ 再 shadow 后读取 | 行仍在、`enabledInSession=false`、`canToggleInSession=true` |
| RB-11 | 冷会话不含 preset | 无 agent、有 scope-only 条目 | 冷 sessionList 不含；且 `preset` 相关调用数为 0 |
| RB-12 | snapshot incomplete | `complete:false` | 不更新缓存；返回上一次 last-good；不抛错 |
| RB-13 | registry 缺失 | `ctx.get("skills") === undefined` | 仅磁盘行；一次 warn；无异常 |
| RB-14 | `skills/change` | 触发事件后再读 | 缓存清空、重新拉 snapshot（调用计数 +1） |
| RB-15 | 排序与去重 | 混合 5 行（磁盘 2 + 注入 3，其中 1 同名） | 按 name 排序、总 4 行 |

### 11.2 项目默认 / 会话开关

| ID | 用例 | 期望 |
|---|---|---|
| PS-1 | overrides 读写新域 | 写入 `{mcp:[…], skills:[…]}`；空数组不落盘；旧文件仅 mcp 时读取后 `skills:[]` |
| PS-2 | toggle(domain="skills") 不丢 mcp | 写盘后 mcp 列表原样保留（回归 `overrides/manager.ts:87` 硬编码） |
| PS-3 | agent/created 应用项目默认 | fake agent + overrides 含注入名 ⇒ `skills.register` 调用 1 次、参数 name/description/invocation 正确 |
| PS-4 | 项目默认对磁盘名跳过 | overrides 含磁盘技能名 ⇒ 不 register、warn |
| PS-5 | 会话显式开启优先 | 项目默认禁用 + `setSessionEnabled({enabled:true})` ⇒ disposer 被调用、无 shadow |
| PS-6 | 会话显式关闭 + 清除覆盖 | `enabled:false` 再 `enabled:undefined` ⇒ 回到项目默认（再注册 shadow） |
| PS-7 | read-after 校验失败 | 同层 runtime 先到先得（fake register 返回 no-op、snapshot winner 非本 shadow）⇒ 返回 `{ok:false}`，无 shadow 记录 |
| PS-8 | 幂等 | 连续两次 `enabled:false` ⇒ register 只 1 次；连续两次 true ⇒ dispose 只 1 次 |
| PS-9 | 冷会话 setSessionEnabled | 返回业务失败（现状语义，`session.ts:158-159`） |
| PS-10 | 项目默认热更新 | 已有 2 个 live 会话，toggle 一次 ⇒ 两个 session 都被 reconcile（fake 计数） |
| PS-11 | agent 销毁 | dispose 后读状态为空、缓存清空 |

### 11.3 详情 / 资源 / 导出 / 写拦截

| ID | 用例 | 期望 |
|---|---|---|
| RD-1 | 注入详情 | `get` 返回 content ⇒ `ok:true, body===content, fromRegistry:true`，`resources` = directory 一层条目 |
| RD-2 | preset 详情冷会话 | 无 agent ⇒ `requires-session` |
| RD-3 | `get` 返回 undefined | `not-found` |
| RD-4 | 资源正常读 | `readResource` 返回 utf-8 文本 |
| RD-5 | `../` 越界 | `escape`，无内容、不回显绝对路径 |
| RD-6 | 绝对路径 / 反斜杠 / 空段 | `escape` |
| RD-7 | 符号链接文件 | `escape`（或按实现策略直接拒绝） |
| RD-8 | 二进制 | `not-text` |
| RD-9 | 超 256 KiB | `too-large` |
| RD-10 | url/opaque 基准 | `unsupported-base` |
| RD-11 | 注入行导出 | `format:"flat"`、单文件、`lossy:true`、frontmatter 名称正确 |
| RD-12 | 注入行写 RPC | `create/update/remove/setEnabled/setInvocation` ⇒ `read-only`，磁盘无变化 |
| RD-13 | 客户端 `read` 传 root | 项目技能详情不再 not found（回归 §8.5） |

### 11.4 Jev

| ID | 用例 | 期望 |
|---|---|---|
| JV-1 | 冷会话 rank 集合 | 含 global 注入、不含 preset；`capabilitiesTotal` = 集合长度 |
| JV-2 | JevRankItem 字段 | 注入项带 `origin/channel/provider/contentReadOnly`，`id` 仍 `cap_<36hex>` |
| JV-3 | apply 写注入技能 | 调用 `setSessionEnabled`；`applied/enabled/disabled` 计数正确 |
| JV-4 | 冷会话排队重放不误关新技能 | 入队后 fake snapshot 新增 preset 技能 ⇒ 重放后新增技能**没有** register 调用（关键回归 §9.3） |
| JV-5 | 项目默认参与初值 | overrides 禁用某注入技能 ⇒ cold rank 的 `enabledInSession=false` |
| JV-6 | 同名 id 唯一 | 磁盘与注入同名被去重后，无 `cap_` 冲突 warn |

### 11.5 客户端（SSR / 纯函数）

| ID | 用例 | 期望 |
|---|---|---|
| UI-1 | 注入行渲染 | 行显示 `channel` 角标 + 只读标记；项目/全局分区正确（注入进全局区） |
| UI-2 | 详情只读 | 写按钮不渲染；启停/默认开关可用 |
| UI-3 | `isGlobal` 判定 | 注入行的「全局/项目」标签正确（回归 `panel.tsx:948`） |
| UI-4 | 冷会话置灰 | `canToggleInSession=false` 时开关禁用 + tooltip |
| UI-5 | 空态 | 无注入行时分组不渲染（沿用外部注入空态规则） |

### 11.6 构建与真机

| ID | 用例 | 期望 |
|---|---|---|
| B-1 | `pnpm typecheck` | 退出码 0 |
| B-2 | `pnpm build` | 退出码 0；`lib/**` 更新 |
| L-1 | 真机（独立 `DSH_HOME`） | 面板全局区出现 office 注入行；`figma-workbench` 渠道正确；`cordis` 会话内出现 preset 行 |
| L-2 | 真机启停 | 项目默认关 figma ⇒ 新会话模型目录不含 figma；会话显式开 ⇒ 恢复 |
| L-3 | 真机详情 | 注入技能正文可读；资源文件可读；越界路径被拒 |

---

## 12. 验收标准

### 12.1 契约级 DoD（架构门）

1. **additive**：所有新增字段可选；旧客户端连新宿主、新客户端连旧宿主均不崩、不误判（旧宿主缺字段 ⇒ 现状行为）。
2. **单一事实源**：映射表只在 `src/skills/registry.ts` 一处；`channel` 展示值不参与路由。
3. **不越权写**：注入行不产生任何磁盘写；项目默认只写 `.agents/capability-overrides.json`；会话开关只写内存。
4. **可复现证据**：每条 `[F]` 都能用文中 `文件:行号` 复核；实现 PR 必须附 `pnpm typecheck/build` 真实输出 + 至少一条真机证据。
5. **测试覆盖**：§11 的 RB/PS/RD/JV/UI 全绿；JV-4 为强制回归。

### 12.2 可观察验收（AC）

| # | 验收（观察得到） |
|---|---|
| AC-1 | 面板全局区出现 DSH 随包 Office 技能行，角标为「DSH 内置（Office）」，无与磁盘行重复的名字。 |
| AC-2 | `figma-workbench` 行角标 `dsh-to-figma`；`dsh-remote-deploy` 行角标 `dsh-remote`；`dsh-diff-approval-*` 行角标 `dsh-diff-approval`（已知前缀映射，task-12）；其余 runtime 注入行角标「插件运行时注入」。 |
| AC-3 | 选 `cordis` 预设的会话，会话能力区出现 5 个预设技能，角标 `cordis`；同一技能在无会话面板列表不出现。 |
| AC-4 | 面板对注入行「默认（本项目）」开关 → `.agents/capability-overrides.json` 出现 `"skills":["<name>"]`，`mcp` 键不受影响；新会话模型技能目录不再出现该技能。 |
| AC-5 | 会话内把注入技能关闭 → 该行仍在、显示关闭态（来自元数据缓存）→ 可再打开；会话结束后新会话回到项目默认。 |
| AC-6 | 注入技能详情显示完整正文；`resourceBase.directory` 的文件可打开；`../` 与符号链接路径返回错误且无内容泄露。 |
| AC-7 | 注入行不出现 编辑/删除/导入/调用方向 按钮；调用写 RPC 返回 `read-only` 业务失败。 |
| AC-8 | 冷会话 Jev 评分不含 preset 技能；激活后重放不会关闭这些新技能（JV-4 断言）。 |
| AC-9 | 卸载/停用注入插件后（模拟 registry 条目消失），面板不残留死行（`skills/change` 后重拉）。 |
| AC-10 | 宿主 registry 不可用时，面板仍完整显示磁盘技能，无异常弹窗。 |

### 12.3 质量门

- 构建：`pnpm typecheck` + `pnpm build` 退出码 0（AGENTS.md 变更纪律）。
- 无新依赖：客户端 bundle `require` 仍只有 `react` / `react/jsx-runtime`。
- 无越界写：diff 只含契约允许的文件集合（§10）。
- 文档同步由 Lead 负责（README / CHANGELOG `[Unreleased]`），不在本任务写作用域。

---

## 13. 未决点与风险（需 Lead 决策 / 后续复核）

| # | 项 | 类型 | 建议 |
|---|---|---|---|
| R1 | 仓库 devDep `dsh-skill@0.2.0-rc.1` vs 宿主 `0.2.1-rc.2` | `[A]` 风险 | backend 首日复核类型面；必要上升 devDep（需 Lead 定，涉及 `package.json` 与 lockfile） |
| R2 | runtime+`source:"runtime"` 无法区分注入插件（默认只能统一显示「插件运行时注入」） | **已部分缓解（Lead task-12，2026-10-25）** | 默认仍无法区分；已加**已知技能名前缀表**（首期 `dsh-diff-approval`，`src/skills/registry.ts:213-240`）：命中按表映射到插件名，**未命中仍回退「插件运行时注入」**；维护方式见 §4.3（additive，只追加表项）。彻底区分仍需上游在 `SkillSummary` 暴露 registration 身份 |
| R3 | `origin` 是否引入第 4 个值 `"disk"`（超出任务的 bundled/plugin/preset） | **已裁定（Lead，2026-10-25）** | **不引入**：`origin` 只允许 `bundled` / `plugin` / `preset`；磁盘受管行不设置 `origin`/`injected`；registry 的磁盘根条目（`project-*` / `user-*` / 全局 `custom`）**不合并**（`src/skills/registry.ts:503-507`）。v1.0 的 `origin:"disk"` 已从本文移除（task-9） |
| R4 | 同名精确展示（磁盘 vs 注入同时可见） | `[I]` 后续 | 首期磁盘优先；扩展点见 §5.4 |
| R5 | 注入技能导出为「内容快照、不打包资源」 | `[I]` 降级 | 接受；如用户诉求强，二期做目录复制（需重新评估 asar/symlink 边界） |
| R6 | 技能区「外部注入」UI 文案/分组：复用 MCP 的「外部注入」范式还是新建「内置/插件」分组 | 需 pm/ux | 推荐复用 `docs/ux/panel-upgrade.md:581-602` 范式，新增技能段落与文案 key（`group.external`/`tag.external`/`notice.readonly` 已有先例 `:891-892,933,979`） |
| R7 | 磁盘技能的「项目默认」是否也统一到 overrides.skills（替代 shadow stub） | 需 Lead/pm | **不建议**：stub 是宿主原生链路（frontmatter+rank），overrides 只覆盖注入技能；两套机制按「内容是否只读」分流，文案需讲清 |
| R8 | `agent/created` 时 preset 层是否已就绪 | `[A]` | 按 §6.2 `setTimeout(0)`+短重试+pending 重试；真机 L-1 验证 |
| R9 | 客户端 bundle 体积/性能 | `[I]` | 不引入新依赖；注入字段是纯数据透传 |
| R10 | 冷会话 preset 技能不可见是产品可接受边界 | 需 pm/ux 确认 | 文档+空态文案写清「会话开始后可评分」 |

---

## 14. 证据清单（可直接复核）

### 14.1 本仓库

| 主题 | 证据 |
|---|---|
| 面板只读磁盘 | `src/skills/manager.ts:89-95`、`:103-136`；`src/remote.ts:132-133` |
| 受管根 / 只读根 | `src/skills/manager.ts:58-74`、`:85-87` |
| summaryView 字段 | `src/skills/manager.ts:276-306` |
| 注入合并实现（R3 口径） | `src/skills/registry.ts:459-464`（`classify`；磁盘根 → `undefined`）、`:503-507`（project-*/user-*/全局 custom 不合并）、`:556-590`（merge 去重）；`src/skills/types.ts:93-95`（`SkillOrigin = bundled\|plugin\|preset`） |
| projectShadow 标注 | `src/skills/manager.ts:308-331` |
| 会话 shadow 机制 | `src/skills/session.ts:1-27`、`:60-67`、`:98-114`、`:117-129`、`:132-149`、`:151-199`、`:201-219` |
| `SkillSummaryView` / `SkillSource` | `src/skills/types.ts:18-31`、`:81-115`、`:74-79` |
| 磁盘 shadow stub | `src/skills/shadow.ts:1-41`、`:62` 起 |
| overrides 现状 | `src/overrides/types.ts:12-14`、`:27-38`；`src/overrides/config-file.ts:21,24-26,53-72,78-85`；`src/overrides/manager.ts:76-97`（`:87` 硬编码） |
| Jev 枚举/计划 | `src/jev/apply.ts:173-175`、`:227-272`、`:86-99`、`:616-660`、`:738-760`、`:780-800`；`src/jev/types.ts:161-176` |
| RPC 路由/信封 | `src/remote.ts:24-46`、`:49-115`、`:120-204` |
| 组装点 | `src/index.ts:46`、`:66-71`、`:108-130`、`:138-154`、`:197-211` |
| 客户端 | `src/client/api.ts:26-61`、`:122-146`；`src/client/api-adapter.ts:113-157`、`:511-529`；`src/client/panel.tsx:301-303`、`:458-459`、`:948`、`:1119-1148`、`:1247`；`src/client/composer-capability.tsx:148`、`:1807` |
| 来源分类 | `src/shared/skill-sources.ts:14-22` |
| 项目根解析 | `src/shared/project-root.ts:22-29`、`:45-66` |
| 写盘/锁/原子写 | `src/overrides/config-file.ts:15-16`；`src/overrides/manager.ts:85-97` |
| scope 陷阱硬约束 | `AGENTS.md:135-138` |

### 14.2 宿主（asar `0.2.1-rc.2`，行号为抽取文本行号）

| 主题 | 证据 |
|---|---|
| registry 类型面 | `node_modules/@deepseek-ai/dsh-skill/lib/types/index.d.ts:24,26-35,37-42,44-61,63-70,72-77,78-84,86-91,98-101,152-157,204-212,225-296` |
| registry 实现（rank/layer/缓存） | asar `dsh-skill/lib/index.js:17,20-23,193-215,224-246,250-291,298-310,312-334,335-380,437-450,452-463,465-470,511-513,519-521` |
| `scope: agent` 用法 | asar `dsh-tool-skill/lib/index.js:871,905,938` |
| office provider | asar `dsh-skill-office/lib/index.js:66-101`；asar `dsh-desktop-host/lib/index.js:66-88`（`:84`） |
| filesystem ranks/根 | asar `dsh-skill-filesystem/lib/index.js:20-24,31,74,83,155-183,605-606`；`dsh-skill-filesystem/README.md:48-56` |
| preset registry API | asar `dsh-agent-preset-registry/lib/index.js:550-566,717-719,725-728` |
| web 分层官方说明 | asar `dsh-web-app/cordis.patch.yml:505-518` |
| preset 组合（cordis/standard） | asar `dsh-web-app/presets/cordis.patch.yml:122-128`；`dsh-web-app/presets/standard.patch.yml:37-40` |

### 14.3 本机 profile / 已装插件（会随本机变化，复核时以仓库 `docs/research` 为准）

| 主题 | 证据 |
|---|---|
| preset id 列表 | `~/.dsh/profiles/desktop/cordis.yml:651-654,816-817,986-987,1083-1084`（standard/ptc/minimal/cordis） |
| cordis preset 技能来源 | `~/.dsh/profiles/desktop/cordis.yml:1234-1243`（skill-filesystem + `customSkillDirs` + tool-skill） |
| to-figma provider | `~/.dsh/profiles/desktop/node_modules/dsh-to-figma/index.mjs:35-36` |
| dsh-remote runtime 注册 | `~/.dsh/profiles/desktop/node_modules/dsh-remote/lib/web-deploy-skill.js:147-160` |
| diff-approval runtime 注册 | `~/.dsh/profiles/desktop/node_modules/dsh-diff-approval/lib/index.js:2925-2998,4201-4218` |
| Office 资产实际存在 | `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/office-skills/**/SKILL.md` |
