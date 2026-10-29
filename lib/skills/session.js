/**
 * Skills 的**会话级**开关（内存态、不落盘）与**项目默认**的会话内投影。
 *
 * 背景：宿主 `skills` 注册表（`@deepseek-ai/dsh-skill` 的 `SkillRegistry`）
 * 没有 disable/restrict 一类的按会话禁用 API，但它是**分层**的：`register()`
 * 把 runtime skill 注册进「调用方 ctx 所属 scope」的层（`scopeOf(this.ctx)`），
 * 读取时按 `global → 祖先 → 最近层` 合并，**同名最近层赢**。因此：
 *
 *   - 取 `agent.ctx.get("skills")` 得到的可追踪代理会把 `this.ctx` 绑定成该
 *     agent ctx（cordis tracker `{associate:"skills", property:"ctx"}`），从它
 *     `register()` 就落在**该 agent 的 scope 层**（与 mcp/loader.ts 用
 *     `agent.ctx.get("tools").restrict(...)` 是同一条机制）；
 *   - 注册一个同名 runtime skill，并把 `invocation` 设成双向 false，就能同时把
 *     它从「模型目录 / `skill` 工具 / `/name` 用户口令」三条消费链路里隐藏 ——
 *     等价于「在本会话禁用该 skill」；
 *   - 解除 = 调用 `register()` 返回的 disposer（注册表按效果回收该层的条目）。
 *
 * 本模块管理两类 shadow，**分开记账**：
 *
 *   1. **会话显式开关**（`shadows`）：用户在会话内手动关掉某个技能；
 *   2. **项目默认禁用**（`projectShadows`）：`.agents/capability-overrides.json`
 *      的 `skills` 名单，在 agent 创建时/项目默认热更新时 reconcile 进去。
 *
 * 优先级：**会话显式开关 > 项目默认**（显式开可以覆盖项目默认关）。
 * `enabledInSession` 以**实际注册状态**为准（不只看意图），并且 register 之后
 * 会 read-after 校验胜者确实是本插件的 shadow，消灭「UI 已禁用、实际仍可见」
 * 的假成功（同层 runtime 先到先得时无法覆盖，属宿主 registry 的硬边界）。
 *
 * 语义边界：
 *   - **只可关闭，不能强制开启**：文件级已禁用（frontmatter 双 false）或项目
 *     内 shadow stub 的条目，本模块只把它们从可切换列表里过滤掉，不会去
 *     「反向开启」；
 *   - **按会话落盘**：显式会话开关写在插件数据目录
 *     （`<dshHome>/dsh-capability-settings/session-capabilities.json`，见
 *     `session-state.ts`），agent 重建 / 宿主重启后恢复；项目默认仍落
 *     `.agents/capability-overrides.json`；
 *   - 找不到 live agent（冷会话）时开关失败并返回业务错误，不做状态暂存。
 *
 * @module dsh-capability-settings/skills/session
 */
import { findProjectRoot } from "../shared/project-root.js";
import { SHADOW_DESCRIPTION, SHADOW_METADATA_KEY } from "./registry.js";
/** 从注册表注册失败里提取可读错误信息。 */
function errMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * 构造会话级 Skills 开关注册表。
 *
 * 只做「簿记 + 注册/解除 + 项目默认投影」；磁盘/注入列表由 `skills/manager.ts`
 * 与 `skills/registry.ts` 提供，避免读取口径分叉。生命周期监听与
 * `mcp/loader.ts` 的 mountAgent 同款：`agent/created` 登记、`agent/disposed`
 * 清理（shadow 注册挂在 agent fiber 的效果上，agent 销毁时由 cordis 自动回收，
 * 这里只清 Map）。
 *
 * @param ctx 宿主上下文（插件自身的 ctx；用 `ctx.get("agents")` 补登记存量）
 * @param deps 项目默认名单 / registry 桥 / 日志
 */
export function createSkillSessionRegistry(ctx, deps = {}) {
    /** sessionId → 记录（agent.id === session.id，见 dsh-agent）。 */
    const sessions = new Map();
    /** 生命周期监听 disposer（`ctx.on` 在 cordis 4 返回函数）。 */
    const listeners = [];
    /** 已 warn 过的「跳过非注入名」记录（避免每次 list 刷日志）。 */
    const warnedSkips = new Set();
    let disposed = false;
    /** 项目默认名单读取（失败降级为空，不阻断列表）。 */
    async function projectDisabledOf(cwd) {
        if (deps.projectDisabled === undefined)
            return [];
        try {
            return await deps.projectDisabled(cwd);
        }
        catch {
            return [];
        }
    }
    /** 登记一个 agent（无 ctx / 无 id 的 stub 跳过；重复登记先到先得）。 */
    function track(agent) {
        if (agent?.ctx === undefined || agent?.id === undefined)
            return undefined;
        const known = sessions.get(agent.id);
        if (known !== undefined)
            return known;
        const cwd = typeof agent.session?.header?.cwd === "string" ? agent.session.header.cwd : undefined;
        const record = {
            agent,
            ...(cwd !== undefined ? { cwd } : {}),
            ...(cwd !== undefined ? { projectRoot: findProjectRoot(cwd) } : {}),
            shadows: new Map(),
            projectShadows: new Map(),
            explicit: new Map(),
            explicitHydrated: false,
            projectDefaults: new Set(),
            projectPending: new Set(),
            projectAttempts: new Map(),
            queue: Promise.resolve(),
        };
        sessions.set(agent.id, record);
        return record;
    }
    /** 按 sessionId 找记录；内存里没有时从 `agents.list()` 补登记一次。 */
    function find(sessionId) {
        const known = sessions.get(sessionId);
        if (known !== undefined)
            return known;
        try {
            const agents = ctx.get?.("agents")?.list?.() ?? [];
            for (const agent of Array.isArray(agents) ? agents : []) {
                if (agent?.id !== sessionId)
                    continue;
                return track(agent);
            }
        }
        catch {
            /* agents 服务不可用：按冷会话处理 */
        }
        return undefined;
    }
    /** 当前 session 的 skills 注册表代理（访问方是 agent.ctx ⇒ 注册进 agent 层）。 */
    function skillsOf(record) {
        try {
            return record.agent?.ctx?.get?.("skills");
        }
        catch {
            return undefined;
        }
    }
    /** 某个名字当前的实际 shadow disposer（显式或项目默认，二者不会同时存在）。 */
    function shadowOf(record, name) {
        return record.shadows.get(name) ?? record.projectShadows.get(name);
    }
    /** 该名字当前是否被 shadow 遮蔽（实际注册状态）。 */
    function shadowed(record, name) {
        return record.shadows.has(name) || record.projectShadows.has(name);
    }
    /** 意图状态：显式开关优先，否则跟随项目默认。 */
    function desiredEnabled(record, name) {
        const explicit = record.explicit.get(name);
        if (explicit !== undefined)
            return explicit;
        return !record.projectDefaults.has(name);
    }
    /** 会话记录 → 落盘元数据（cwd 仅诊断、headerCreatedAt 防 id 复用）。 */
    function metaOf(record) {
        const meta = {};
        if (record.cwd !== undefined)
            meta.cwd = record.cwd;
        const createdAt = record.agent?.session?.header?.createdAt;
        if (typeof createdAt === "number" && Number.isFinite(createdAt))
            meta.headerCreatedAt = createdAt;
        return meta;
    }
    /**
     * 从持久化存储恢复本会话的显式开关（幂等；每个会话一次）。
     *
     * 内存里已有的键优先：同一运行内用户刚改过的开关不被磁盘旧值覆盖。
     * sessionId 复用（header 创建时间不一致）时旧记录作废（见 `verifySession`）。
     */
    async function hydrateExplicit(record) {
        const state = deps.state;
        if (state === undefined || record.explicitHydrated)
            return;
        await state.ready();
        record.explicitHydrated = true;
        const sessionId = typeof record.agent?.id === "string" ? record.agent.id : undefined;
        if (sessionId === undefined)
            return;
        if (!state.verifySession(sessionId, metaOf(record)))
            return;
        const stored = state.skills(sessionId);
        for (const [name, enabled] of Object.entries(stored)) {
            if (!record.explicit.has(name))
                record.explicit.set(name, enabled);
        }
    }
    /** 每 session 的串行队列（写操作互斥；读路径不排队，避免死锁）。 */
    function withQueue(record, work) {
        const run = record.queue.then(work, work);
        record.queue = run.then(() => undefined, () => undefined);
        return run;
    }
    /** 只 warn 一次。 */
    function warnSkip(record, name, message) {
        const key = `${String(record.agent?.id)}::${name}`;
        if (warnedSkips.has(key))
            return;
        warnedSkips.add(key);
        deps.logger?.warn?.(message);
    }
    /**
     * 注册 shadow（幂等）：read-before-shadow 缓存元数据 → register → read-after 校验。
     *
     * @param viaProject true = 因项目默认禁用而注册（记入 projectShadows），否则记入 shadows
     */
    async function ensureShadow(record, name, viaProject) {
        if (disposed)
            return { ok: false, errors: ["skill session registry disposed"] };
        const explicitDisposer = record.shadows.get(name);
        const projectDisposer = record.projectShadows.get(name);
        const existing = explicitDisposer ?? projectDisposer;
        if (existing !== undefined) {
            // 幂等；但要把簿记归位（项目默认驱动 ↔ 会话显式驱动），否则项目默认解除时
            // 会漏掉一个「记在显式桶里、但其实是项目默认造成」的 shadow。
            if (viaProject && explicitDisposer !== undefined) {
                record.shadows.delete(name);
                record.projectShadows.set(name, explicitDisposer);
            }
            else if (!viaProject && projectDisposer !== undefined) {
                record.projectShadows.delete(name);
                record.shadows.set(name, projectDisposer);
            }
            return { ok: true };
        }
        const skills = skillsOf(record);
        if (typeof skills?.register !== "function") {
            return { ok: false, errors: [`skills service unavailable for session ${String(record.agent?.id)}`], retryable: true };
        }
        const registry = deps.registry;
        const agent = record.agent;
        const sessionId = typeof agent?.id === "string" ? agent.id : undefined;
        // read-before-shadow：缓存注入元数据，保证「被自己遮蔽的条目」仍能显示。
        let meta;
        if (registry !== undefined) {
            try {
                meta = await registry.prepareShadow(agent, sessionId, record.cwd, name);
            }
            catch {
                meta = undefined;
            }
        }
        let dispose;
        try {
            dispose = skills.register({
                name,
                description: SHADOW_DESCRIPTION,
                content: "",
                source: "runtime",
                metadata: { [SHADOW_METADATA_KEY]: true },
                invocation: { modelInvocable: false, userInvocable: false },
            });
        }
        catch (error) {
            // 名称非法 / 服务内部异常都收敛成业务失败，不向 RPC 层抛。
            return { ok: false, errors: [`failed to disable skill "${name}": ${errMessage(error)}`] };
        }
        // 同层已有同名 runtime skill 时 registry 返回 no-op disposer（warn 不抛）：
        // 仍记下来，之后「恢复」会调用它（幂等无害）；read-after 校验会识破它。
        const recorded = typeof dispose === "function" ? dispose : () => undefined;
        const bucket = viaProject ? record.projectShadows : record.shadows;
        bucket.set(name, recorded);
        if (registry !== undefined) {
            let verified;
            try {
                verified = await registry.verifyShadow(agent, sessionId, record.cwd, name);
            }
            catch {
                verified = undefined;
            }
            if (verified === false) {
                // 同层 runtime 先到先得（宿主 registry 硬边界）：撤销簿记并回滚注册。
                bucket.delete(name);
                try {
                    recorded();
                }
                catch {
                    /* 回滚失败无额外副作用 */
                }
                return {
                    ok: false,
                    errors: [`skill "${name}" 由同作用域已注册的运行时条目提供，无法在本会话禁用`],
                };
            }
            // register 触发的 skills/change 会清掉刚缓存的元数据：显式写回。
            if (meta !== undefined) {
                try {
                    registry.keepShadowed(agent, sessionId, meta);
                }
                catch {
                    /* 缓存写回失败只影响展示，不影响启停 */
                }
            }
        }
        return { ok: true };
    }
    /**
     * 解除 shadow（幂等）。**两步校验**，避免「UI 显示已恢复、实际仍被隐藏」：
     *
     * 1. 本地无 disposer 时（插件重载前的旧实例注册的 ghost shadow）：用 registry
     *    胜者校验判断当前是否仍被本插件的 shadow 遮蔽 —— 仍遮蔽则返回业务失败，
     *    而不是直接 ok；
     * 2. 本地有 disposer 时：调用 disposer 后 read-after 校验胜者不再是本插件的
     *    shadow；否则恢复簿记并返回业务失败（同层 runtime 先到先得 / ghost 冲突）。
     */
    async function releaseShadow(record, name) {
        if (disposed)
            return { ok: false, errors: ["skill session registry disposed"] };
        const explicitDisposer = record.shadows.get(name);
        const projectDisposer = record.projectShadows.get(name);
        const target = explicitDisposer ?? projectDisposer;
        const registry = deps.registry;
        const agent = record.agent;
        const sessionId = typeof agent?.id === "string" ? agent.id : undefined;
        /** 用 registry 胜者校验该名字当前是否仍是本插件的 shadow（无法判定 = undefined）。 */
        const stillShadowed = async () => {
            if (registry === undefined)
                return undefined;
            try {
                return await registry.verifyShadow(agent, sessionId, record.cwd, name);
            }
            catch {
                return undefined;
            }
        };
        if (target === undefined) {
            // 幂等分支：本来就没 shadow，或 shadow 是本插件重载/卸载前旧实例注册的
            // （本地没有 disposer，解除不了）。用胜者校验区分两者，不做假成功。
            if ((await stillShadowed()) === true) {
                return {
                    ok: false,
                    errors: [
                        `skill "${name}" 的会话级禁用仍由宿主技能注册表持有（可能来自插件重载前的实例），无法在本会话恢复；请重新打开该会话`,
                    ],
                };
            }
            return { ok: true };
        }
        const wasExplicit = explicitDisposer !== undefined;
        const restore = () => {
            if (wasExplicit)
                record.shadows.set(name, target);
            else
                record.projectShadows.set(name, target);
        };
        record.shadows.delete(name);
        record.projectShadows.delete(name);
        try {
            target();
        }
        catch (error) {
            // disposer 理论上幂等；这里仍降级成业务失败，避免假成功。
            restore();
            return { ok: false, errors: [`failed to restore skill "${name}": ${errMessage(error)}`] };
        }
        // read-after：确认胜者不再是本插件的 shadow（no-op disposer / 旧实例 ghost
        // 都会让验证失败）；失败时恢复簿记，状态与 UI 保持一致。
        if ((await stillShadowed()) === true) {
            restore();
            return {
                ok: false,
                errors: [
                    `failed to restore skill "${name}": 会话级禁用仍被其它注册持有（同层 runtime 先到先得），本会话无法恢复；请重新打开该会话`,
                ],
            };
        }
        return { ok: true };
    }
    /** 把 shadow 归到正确桶：没有显式覆盖 ⇒ 属于项目默认（否则项目默认解除时漏删）。 */
    function rebucketShadow(record, name) {
        const disposer = record.shadows.get(name);
        if (disposer === undefined || record.explicit.has(name))
            return;
        record.shadows.delete(name);
        record.projectShadows.set(name, disposer);
    }
    /** 延迟重试项目默认投影（registry/preset 层还没就绪时的降级路径）。 */
    function scheduleRetry(record, attempt) {
        if (disposed || record.retryTimer !== undefined)
            return;
        if (attempt >= 4)
            return;
        const delay = attempt <= 0 ? 0 : attempt === 1 ? 100 : 300;
        record.retryTimer = setTimeout(() => {
            record.retryTimer = undefined;
            void runApply(record, attempt + 1);
        }, delay);
        if (typeof record.retryTimer?.unref === "function")
            record.retryTimer.unref();
    }
    /**
     * 把项目默认禁用名单投影到该会话（幂等、逐名独立）。
     *
     * 只对**注入条目**生效（Lead 裁定 R7：磁盘技能的项目级禁停继续走 shadow
     * stub）；名单里出现磁盘/未知名字时跳过并 warn 一次。registry 还没就绪时
     * 记 pending 并按 0 / 100 / 300ms 短重试，仍失败只 warn 不阻断会话。
     *
     * @param attempt 已重试次数（0 = 首次）
     * @param preloadedDisabled 调用方已读到的名单（避免重复读文件）
     */
    async function applyProjectDefaults(record, attempt = 0, preloadedDisabled) {
        // 先恢复落盘的显式会话开关：desiredEnabled 依赖它（否则重启后会被项目默认盖掉）。
        await hydrateExplicit(record);
        const registry = deps.registry;
        if (registry === undefined)
            return { ok: true };
        const disabled = preloadedDisabled ?? (await projectDisabledOf(record.cwd));
        record.projectDefaults = new Set(disabled);
        // 常见路径：本项目没有任何默认禁用、也没有待处理项、也没有显式会话开关
        // ⇒ 不必读 registry（显式开关也要走下面的恢复逻辑，不能提前返回）。
        if (disabled.length === 0 &&
            record.projectShadows.size === 0 &&
            record.projectPending.size === 0 &&
            record.explicit.size === 0) {
            return { ok: true };
        }
        const sessionId = typeof record.agent?.id === "string" ? record.agent.id : undefined;
        let injected;
        try {
            injected = await registry.injectedNames(record.agent, sessionId, record.cwd);
        }
        catch {
            injected = undefined;
        }
        if (injected === undefined && disabled.length > 0) {
            for (const name of disabled)
                record.projectPending.add(name);
            scheduleRetry(record, attempt);
            return { ok: true };
        }
        const errors = [];
        const names = new Set([
            ...record.projectDefaults,
            ...record.projectShadows.keys(),
            ...record.explicit.keys(),
            ...record.projectPending,
        ]);
        for (const name of [...names].sort()) {
            const knownInjected = injected?.has(name) === true ||
                record.projectShadows.has(name) ||
                record.shadows.has(name) ||
                (sessionId !== undefined && registry.knowsInjected(sessionId, name));
            if (!knownInjected) {
                if (record.projectDefaults.has(name)) {
                    const tries = (record.projectAttempts.get(name) ?? 0) + 1;
                    record.projectAttempts.set(name, tries);
                    if (tries <= 3) {
                        // 可能是 preset 层尚未就绪：留待下一次读取重试。
                        record.projectPending.add(name);
                        scheduleRetry(record, attempt);
                        continue;
                    }
                    warnSkip(record, name, `capability-panel: 项目默认禁用名单中的 "${name}" 不是宿主注入技能（或宿主尚未提供），已跳过`);
                }
                record.projectPending.delete(name);
                continue;
            }
            record.projectAttempts.delete(name);
            const desired = desiredEnabled(record, name);
            const explicitOff = record.explicit.get(name) === false;
            const result = desired ? await releaseShadow(record, name) : await ensureShadow(record, name, !explicitOff);
            if (result.ok) {
                record.projectPending.delete(name);
                continue;
            }
            errors.push(...result.errors);
            if (result.retryable === true) {
                record.projectPending.add(name);
                scheduleRetry(record, attempt);
            }
            else {
                // 同层冲突等硬失败：不再重试（重试也不会变），只保留错误给调用方。
                record.projectPending.delete(name);
            }
        }
        return errors.length > 0 ? { ok: false, errors } : { ok: true };
    }
    /** 项目默认投影的串行化入口（同一 session 的多次 reconcile 不并发注册）。 */
    function runApply(record, attempt = 0, preloadedDisabled) {
        return withQueue(record, () => applyProjectDefaults(record, attempt, preloadedDisabled));
    }
    /**
     * 恢复显式会话开关（list 路径，能同时看到磁盘 + 注入技能名）。
     *
     * `applyProjectDefaults` 只处理**注入技能**（项目默认禁用的口径），而会话
     * 显式开关也可能落在磁盘技能上（自定义技能 = 磁盘条目）。这里按"当前仍
     * 可见的名字"恢复：可见 ⇒ 按状态注册/解除 shadow；已删除 ⇒ 清掉显式覆盖
     * 并落盘（避免重启后给已删技能造出幽灵 shadow）。
     */
    async function restoreExplicit(record, visibleNames) {
        if (record.explicit.size === 0)
            return;
        await withQueue(record, async () => {
            const sessionId = typeof record.agent?.id === "string" ? record.agent.id : undefined;
            for (const [name, enabled] of [...record.explicit.entries()]) {
                if (!visibleNames.has(name)) {
                    record.explicit.delete(name);
                    if (sessionId !== undefined && deps.state !== undefined) {
                        await deps.state.setSkill(sessionId, name, undefined, metaOf(record));
                    }
                    continue;
                }
                const result = enabled ? await releaseShadow(record, name) : await ensureShadow(record, name, false);
                // 失败保留意图（下次读取重试），不清显式记录。
                if (result.ok)
                    rebucketShadow(record, name);
            }
        });
    }
    /** 生命周期回调：登记 + 延后应用项目默认（等 preset 层 provider 就绪）。 */
    function onAgentCreated(agent) {
        const record = track(agent);
        if (record === undefined)
            return;
        scheduleRetry(record, 0);
    }
    // —— 生命周期簿记 ——
    if (typeof ctx.on === "function") {
        const offCreated = ctx.on("agent/created", ({ agent }) => onAgentCreated(agent));
        if (typeof offCreated === "function")
            listeners.push(offCreated);
        const offDisposed = ctx.on("agent/disposed", ({ agent }) => {
            // 不手动 dispose shadow：注册挂在该 agent ctx 的效果上，fiber 销毁即回收。
            if (agent?.id === undefined)
                return;
            const record = sessions.get(agent.id);
            if (record?.retryTimer !== undefined)
                clearTimeout(record.retryTimer);
            sessions.delete(agent.id);
            deps.registry?.invalidateSession(agent.id);
        });
        if (typeof offDisposed === "function")
            listeners.push(offDisposed);
    }
    // 插件加载时已经存活的 agent（resume / 历史 session）补登记并应用项目默认。
    try {
        const existing = ctx.get?.("agents")?.list?.() ?? [];
        for (const agent of Array.isArray(existing) ? existing : [])
            onAgentCreated(agent);
    }
    catch {
        /* agents 服务不可用：按无存量会话处理 */
    }
    return {
        async list(baseList, cwd, sessionId) {
            const record = sessionId !== undefined ? find(sessionId) : undefined;
            const projectDisabled = new Set(await projectDisabledOf(cwd));
            // 项目默认投影（fire-and-await；读路径允许触发一次幂等 reconcile）。
            if (record !== undefined)
                await runApply(record, 0, [...projectDisabled]);
            const diskRows = await baseList(cwd);
            let injectedRows = [];
            if (deps.registry !== undefined) {
                try {
                    injectedRows = await deps.registry.merge({
                        cwd,
                        // 冷会话（无 live agent）退化为无 scope 读：只看得见 global 层注入。
                        sessionId: record !== undefined ? sessionId : undefined,
                        diskRows,
                        projectDisabled,
                    });
                }
                catch {
                    injectedRows = [];
                }
            }
            const rows = [...diskRows, ...injectedRows].sort((a, b) => a.name.localeCompare(b.name));
            /**
             * 全局磁盘行被**项目副本**遮蔽：该项目行才是本项目实际生效的条目（磁盘列表
             * 已按「项目根在前」排序，首屏/Jev 又都按 name 去重）。会话视图里过滤掉这条
             * 重复的全局行，避免同名两行、也避免把被遮蔽的全局行当成"当前启用"。
             */
            const shadowedByProjectSkill = (row) => row.injected !== true && row.projectShadow === "skill";
            /**
             * 全局磁盘行被**项目屏蔽占位（shadow stub）**遮蔽：该技能在本项目内被宿主
             * 原生禁用（占位行因双向 false 已被过滤），但全局行本身仍可见/可 toggle。
             * 它在本项目的默认态必须是"关闭"——不能再用 `!shadowed(record, name)`
             * 判断（stub 是磁盘文件层面的遮蔽，不在 record 的 runtime shadow 里）。
             */
            const shadowedByProjectStub = (row) => row.injected !== true && row.projectShadow === "stub";
            // 硬关闭的条目（文件级双向 false、项目内 shadow stub）不可在会话层切换：
            // shadow 只能「再藏一层」，无法把文件级禁用反向开启，过滤掉避免误导。
            const toggleable = rows.filter((row) => row.shadowStub !== true &&
                !shadowedByProjectSkill(row) &&
                (row.invocation.modelInvocable || row.invocation.userInvocable));
            // 恢复显式会话开关（磁盘 + 注入都覆盖；已删除技能顺便清理覆盖记录）。
            if (record !== undefined)
                await restoreExplicit(record, new Set(toggleable.map((row) => row.name)));
            return toggleable.map((row) => {
                const explicit = record?.explicit.get(row.name);
                // 实际注册状态（项目默认 + 会话 shadow 共同决定）。
                const registered = record !== undefined ? !shadowed(record, row.name) : row.injected !== true || !projectDisabled.has(row.name);
                // 优先级：显式会话覆盖 > 项目级默认（stub 遮蔽）> 实际注册状态。
                const enabledInSession = explicit !== undefined ? explicit : shadowedByProjectStub(row) ? false : registered;
                return { ...row, enabledInSession, canToggleInSession: record !== undefined };
            });
        },
        async setEnabled(input) {
            if (disposed)
                return { ok: false, errors: ["skill session registry disposed"] };
            const sessionId = typeof input?.sessionId === "string" ? input.sessionId : "";
            const name = typeof input?.name === "string" ? input.name : "";
            if (sessionId.length === 0)
                return { ok: false, errors: ["sessionId is required"] };
            if (name.length === 0)
                return { ok: false, errors: ["skill name is required"] };
            const record = find(sessionId);
            if (record === undefined)
                return { ok: false, errors: [`session not found: ${sessionId}`] };
            const skills = skillsOf(record);
            if (typeof skills?.register !== "function") {
                return { ok: false, errors: [`skills service unavailable for session ${sessionId}`] };
            }
            if (deps.registry === undefined) {
                // 无 registry 桥（旧装配）：保持旧的显式开关行为。
                return withQueue(record, async () => {
                    await hydrateExplicit(record);
                    if (input.enabled === undefined) {
                        record.explicit.delete(name);
                        const projectDisabled = await projectDisabledOf(record.cwd);
                        record.projectDefaults = new Set(projectDisabled);
                    }
                    else {
                        record.explicit.set(name, input.enabled === true);
                    }
                    const desired = desiredEnabled(record, name);
                    const result = desired ? await releaseShadow(record, name) : await ensureShadow(record, name, record.explicit.get(name) !== false);
                    if (result.ok) {
                        rebucketShadow(record, name);
                        // 落盘：失败只 warn（本次运行内仍生效），不影响开关结果。
                        if (deps.state !== undefined)
                            await deps.state.setSkill(sessionId, name, input.enabled, metaOf(record));
                    }
                    return result;
                });
            }
            return withQueue(record, async () => {
                await hydrateExplicit(record);
                // 刷新项目默认快照（显式开关的 fallback 依赖它）。
                const projectDisabled = await projectDisabledOf(record.cwd);
                record.projectDefaults = new Set(projectDisabled);
                const desired = input.enabled === undefined ? !record.projectDefaults.has(name) : input.enabled === true;
                const explicitOff = input.enabled === false;
                const result = desired
                    ? await releaseShadow(record, name)
                    : await ensureShadow(record, name, !explicitOff);
                if (!result.ok)
                    return { ok: false, errors: result.errors };
                // 校验成功后才写显式状态（失败保留原状），并把 shadow 归到正确桶。
                if (input.enabled === undefined)
                    record.explicit.delete(name);
                else
                    record.explicit.set(name, input.enabled === true);
                rebucketShadow(record, name);
                // 落盘：失败只 warn（本次运行内仍生效），不向 RPC 报错误导 UI。
                if (deps.state !== undefined)
                    await deps.state.setSkill(sessionId, name, input.enabled, metaOf(record));
                return { ok: true };
            });
        },
        async reconcileProject(cwd) {
            if (disposed)
                return { ok: false, errors: ["skill session registry disposed"] };
            const projectRoot = cwd !== undefined ? findProjectRoot(cwd) : undefined;
            const errors = [];
            for (const record of sessions.values()) {
                if (projectRoot !== undefined && record.projectRoot !== projectRoot)
                    continue;
                const result = await runApply(record, 0);
                if (!result.ok)
                    errors.push(...result.errors);
            }
            return errors.length > 0 ? { ok: false, errors } : { ok: true };
        },
        sessionState(sessionId) {
            const record = sessions.get(sessionId);
            if (record === undefined)
                return [];
            return [...new Set([...record.shadows.keys(), ...record.projectShadows.keys()])].sort();
        },
        agentOf(sessionId) {
            return find(sessionId)?.agent;
        },
        isShadowed(sessionId, name) {
            const record = sessions.get(sessionId);
            return record !== undefined && shadowed(record, name);
        },
        dispose() {
            if (disposed)
                return;
            disposed = true;
            for (const off of listeners) {
                try {
                    off();
                }
                catch {
                    /* 卸载阶段忽略监听解绑异常 */
                }
            }
            listeners.length = 0;
            // best-effort 解除已记录的会话 shadow：注册挂在 agent ctx 上，插件卸载 /
            // 热重载不会自动回收（agent 可能仍存活），不显式释放会留下「插件已卸载、
            // 技能仍被隐藏」的 ghost shadow。单个 disposer 失败不影响其余清理。
            const released = new Set();
            for (const record of sessions.values()) {
                if (record.retryTimer !== undefined)
                    clearTimeout(record.retryTimer);
                for (const disposer of [...record.shadows.values(), ...record.projectShadows.values()]) {
                    if (released.has(disposer))
                        continue;
                    released.add(disposer);
                    try {
                        disposer();
                    }
                    catch {
                        /* 卸载阶段 best-effort：disposer 可能已随 agent fiber 回收 */
                    }
                }
            }
            sessions.clear();
            warnedSkips.clear();
        },
    };
}
