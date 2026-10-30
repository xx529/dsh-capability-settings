/**
 * R1 批量端点 `session.setBulk`：三域（Skills / MCP / Tools）一次开 / 关 / 恢复默认。
 *
 * 方案：`docs/architecture/v13-implementation.md` §6（唯一权威）。
 *
 * 契约要点（不得偏离）：
 *
 *   - 传输层信封恒 `{ok:true,value}`（`remote.ts` 文件头）；本模块的**业务失败**
 *     也返回 `{ok:false, errors}` 放在 value 里，绝不抛到通道层。
 *   - **幂等**：同一 `action` 重放 → `applied:0` + `unchanged:N`（不重复写盘）。
 *   - **按会话串行**：同 session 的批量请求排队（重复调用排队而非拒绝）；
 *     不同 session 互不影响。
 *   - **部分失败不回滚**（A7）：某条失败只进 `failed[]`，已成功的保留；
 *     重试 = 重放同一 action（已成功项进 `unchanged`）。
 *   - **宿主自己枚举**：客户端不传目标列表（避免与宿主枚举口径漂移）。
 *   - 写盘批量化：三个域都走批量端点——mcp/tools 由 loader/manager 一次落盘
 *     （`state.setToggles`），skills 走 `skills/session.ts#setEnabledBatch`
 *     （整批一次宿主目录发现 + 一次落盘）；restrict 只重算一次。
 *
 * @module dsh-capability-settings/session-bulk
 */
import { errMessage } from "./shared/errors.js";
/** 三域固定顺序（方案 §6.2-6）。 */
const DOMAIN_ORDER = ["skills", "mcp", "tools"];
/** 空统计。 */
function emptyStat() {
    return { changed: 0, unchanged: 0, skipped: 0, failed: 0 };
}
/** 解析入参；非法形状归业务失败。 */
function parseInput(input) {
    const payload = input !== null && typeof input === "object" && !Array.isArray(input) ? input : {};
    const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
    if (sessionId.length === 0)
        return { ok: false, errors: ["sessionId is required"] };
    const action = payload.action;
    if (action !== "enable" && action !== "disable" && action !== "reset") {
        return { ok: false, errors: ['action must be one of "enable" | "disable" | "reset"'] };
    }
    const result = { sessionId, action };
    if (payload.domains !== undefined) {
        if (!Array.isArray(payload.domains) || payload.domains.length === 0) {
            return { ok: false, errors: ["domains must be a non-empty array"] };
        }
        const seen = new Set();
        for (const raw of payload.domains) {
            if (raw !== "skills" && raw !== "mcp" && raw !== "tools") {
                return { ok: false, errors: [`unknown domain ${JSON.stringify(raw)}`] };
            }
            seen.add(raw);
        }
        // 固定顺序：skills → mcp → tools（与客户端串行调用口径一致）。
        result.domains = DOMAIN_ORDER.filter((domain) => seen.has(domain));
    }
    if (typeof payload.cwd === "string" && payload.cwd.length > 0)
        result.cwd = payload.cwd;
    if (payload.dryRun === true)
        result.dryRun = true;
    return { ok: true, value: result };
}
/** 构造批量端点实现（组合根单例）。 */
export function createSessionBulk(deps) {
    const logger = deps.logger;
    const now = deps.now ?? (() => Date.now());
    /** 同 session 串行队列（方案 §6.3）。 */
    const queues = new Map();
    /** 当前 live agent 列表（异常降级为空）。 */
    function agents() {
        try {
            const list = deps.ctx?.get?.("agents")?.list?.();
            return Array.isArray(list) ? list : [];
        }
        catch {
            return [];
        }
    }
    /** 磁盘会话记录里的显式覆盖名单（冷启动时 state 尚未 ready 的调用方需先 ready）。 */
    function storedToggle(sessionId, domain) {
        try {
            return { ...(deps.state?.entries()[sessionId]?.[domain] ?? {}) };
        }
        catch {
            return {};
        }
    }
    /** loader 的会话显式开关快照（内存权威；失败降级为空）。 */
    function loaderToggle(sessionId) {
        try {
            return deps.loader.sessionToggleState(sessionId) ?? {};
        }
        catch {
            return {};
        }
    }
    /** skills 域：冷会话不可写（`setEnabled` 返回 session not found）→ 记 skipped。 */
    async function runSkills(services, input, failed, stat) {
        const rows = (await services.skills.sessionList(input.cwd, input.sessionId)) ?? [];
        const explicit = input.action === "reset" ? storedToggle(input.sessionId, "skills") : {};
        /** 需要写入的名字（先算完再**同一 tick 全部发起**，方案 §6.3 域内不加额外限流）。 */
        const targets = [];
        for (const row of rows) {
            if (row.shadowStub === true)
                continue;
            if (input.action === "reset") {
                // reset：只清「有显式覆盖」的名字（磁盘记录里的键）。
                if (!Object.hasOwn(explicit, row.name))
                    continue;
            }
            else {
                const desired = input.action === "enable";
                // enabledInSession 缺省按"启用"读（与列表语义一致）。
                if ((row.enabledInSession !== false) === desired) {
                    stat.unchanged += 1;
                    continue;
                }
            }
            if (row.canToggleInSession !== true || !input.live) {
                // 冷会话：技能开关需要 live agent（skills/session.ts 明确拒绝）。
                stat.skipped += 1;
                continue;
            }
            targets.push(row.name);
        }
        if (targets.length === 0)
            return;
        if (input.dryRun) {
            stat.changed += targets.length;
            return;
        }
        const enabled = input.action === "reset" ? undefined : input.action === "enable";
        // 性能路径：批量端点整批只做一次技能目录发现 + 一次落盘（逐条写 150 条会
        // 触发 O(N²) 的宿主 catalog 全量发现，见 `skills/session.ts#setEnabledBatch`）。
        const batch = services.skills.setSessionEnabledBatch;
        if (typeof batch === "function") {
            try {
                const result = await batch.call(services.skills, {
                    sessionId: input.sessionId,
                    entries: targets.map((name) => ({ name, enabled })),
                });
                if (!result.ok)
                    throw new Error(result.errors.join("; ") || "skills batch failed");
                const byName = new Map(result.outcomes.map((outcome) => [outcome.name, outcome]));
                for (const name of targets) {
                    const outcome = byName.get(name);
                    if (outcome?.ok === true) {
                        stat.changed += 1;
                        continue;
                    }
                    stat.failed += 1;
                    failed.push({
                        domain: "skills",
                        target: name,
                        kind: "skill",
                        error: (outcome?.errors ?? []).join("; ") || "unknown error",
                    });
                }
            }
            catch (error) {
                const message = errMessage(error);
                stat.failed += targets.length;
                for (const name of targets) {
                    failed.push({ domain: "skills", target: name, kind: "skill", error: message });
                }
            }
            return;
        }
        // 降级（旧装配无批量端点）：同一 tick 全部发起，每条仍由 per-session 队列串行。
        const settled = await Promise.allSettled(targets.map((name) => services.skills.setSessionEnabled(input.action === "reset"
            ? { sessionId: input.sessionId, name, enabled: undefined }
            : { sessionId: input.sessionId, name, enabled: input.action === "enable" })));
        settled.forEach((result, index) => {
            const name = targets[index];
            if (result.status === "rejected") {
                stat.failed += 1;
                failed.push({ domain: "skills", target: name, kind: "skill", error: errMessage(result.reason) });
                return;
            }
            if (result.value !== undefined && result.value.ok === false) {
                stat.failed += 1;
                failed.push({
                    domain: "skills",
                    target: name,
                    kind: "skill",
                    error: (result.value.errors ?? []).join("; ") || "unknown error",
                });
                return;
            }
            stat.changed += 1;
        });
    }
    /** mcp 域：配置条目 + 运行时注入实例；enable 写显式 true（不是清覆盖）。 */
    async function runMcp(services, input, failed, stat) {
        const entries = [];
        if (input.action === "reset") {
            // 只清有显式覆盖的键；无覆盖项不变（mcp 项目默认仍生效）。
            const toggles = { ...storedToggle(input.sessionId, "mcp"), ...loaderToggle(input.sessionId) };
            for (const key of Object.keys(toggles)) {
                if (key.startsWith("server:"))
                    entries.push({ target: key.slice("server:".length), kind: "server", enabled: undefined });
                else if (key.startsWith("project:")) {
                    entries.push({ target: key.slice("project:".length), kind: "project", enabled: undefined });
                }
            }
        }
        else {
            const desired = input.action === "enable";
            const list = await services.mcp.list(input.cwd, input.sessionId);
            const configured = new Set((list?.servers ?? []).map((server) => server.serverName));
            for (const row of list?.servers ?? []) {
                if (row.shadowed === true)
                    continue;
                const current = typeof row.enabledInSession === "boolean" ? row.enabledInSession : row.disabledInProject !== true;
                if (current === desired) {
                    stat.unchanged += 1;
                    continue;
                }
                // 硬关闭（配置文件 disabled / 禁用态引用）不接受会话开关。
                if (row.enabled === false) {
                    stat.skipped += 1;
                    continue;
                }
                entries.push({
                    target: row.scope === "project" ? row.key : row.serverName,
                    kind: row.scope === "project" ? "project" : "server",
                    enabled: desired,
                });
            }
            const runtime = await services.mcp.runtime({
                ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
                sessionId: input.sessionId,
            });
            for (const view of runtime?.servers ?? []) {
                // 与配置条目同名时以配置条目为准（与 manager.runtime / Jev 枚举同口径）。
                if (configured.has(view.serverName))
                    continue;
                const current = typeof view.enabledInSession === "boolean" ? view.enabledInSession : view.disabledInProject !== true;
                if (current === desired) {
                    stat.unchanged += 1;
                    continue;
                }
                // 运行时注入且不可 restrict 的实例不参与（方案 §6.2-3）。
                if (view.restrictable !== true) {
                    stat.skipped += 1;
                    continue;
                }
                entries.push({ target: view.serverName, kind: "server", enabled: desired });
            }
        }
        if (entries.length === 0)
            return;
        if (input.dryRun) {
            stat.changed += entries.length;
            return;
        }
        try {
            // 一次 hydrate → 写全部 toggle → 一次重挂（不是逐条）。
            await deps.loader.setSessionEnabledMany({
                sessionId: input.sessionId,
                ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
                entries,
            });
            stat.changed += entries.length;
        }
        catch (error) {
            stat.failed += entries.length;
            for (const entry of entries) {
                failed.push({
                    domain: "mcp",
                    target: entry.target,
                    kind: entry.kind === "project" ? "mcp-project" : "mcp-server",
                    error: errMessage(error),
                });
            }
        }
    }
    /** tools 域：插件单元级（含未识别单元）；locked 不参与。 */
    async function runTools(services, input, failed, stat) {
        const view = await services.tools.list({ sessionId: input.sessionId });
        const units = [];
        const desired = input.action === "enable";
        for (const unit of view?.units ?? []) {
            if (input.action === "reset") {
                if (unit.explicit === true)
                    units.push(unit.unit);
                continue;
            }
            if (unit.lockedReason !== undefined) {
                stat.skipped += 1;
                continue;
            }
            if (unit.enabledInSession === desired) {
                stat.unchanged += 1;
                continue;
            }
            units.push(unit.unit);
        }
        if (units.length === 0)
            return;
        if (input.dryRun) {
            stat.changed += units.length;
            return;
        }
        try {
            // batch-first：一次写盘 + 一次 restrict 重算。
            const result = await services.tools.setSessionEnabled({
                sessionId: input.sessionId,
                units,
                enabled: input.action === "reset" ? undefined : desired,
            });
            if (result.ok === false) {
                stat.failed += units.length;
                for (const unit of units) {
                    failed.push({ domain: "tools", target: unit, kind: "plugin", error: result.errors.join("; ") || "unknown error" });
                }
            }
            else {
                stat.changed += result.applied;
                stat.unchanged += Math.max(0, units.length - result.applied);
            }
        }
        catch (error) {
            stat.failed += units.length;
            for (const unit of units) {
                failed.push({ domain: "tools", target: unit, kind: "plugin", error: errMessage(error) });
            }
        }
    }
    /** 执行本体（永不 reject：失败收进返回值）。 */
    async function execute(input) {
        const services = deps.service();
        if (services === undefined)
            return { ok: false, errors: ["capability-panel service unavailable"] };
        const startedAt = now();
        const { sessionId, action } = input;
        // 冷启动首批请求：先等读盘完成，再读显式覆盖名单（否则会误判"无显式覆盖"）。
        if (deps.state !== undefined)
            await deps.state.ready();
        const liveAgents = agents();
        const live = liveAgents.some((agent) => agent?.id === sessionId);
        const headerCwd = liveAgents.find((agent) => agent?.id === sessionId)?.session?.header?.cwd;
        const cwd = input.cwd ?? (typeof headerCwd === "string" && headerCwd.length > 0 ? headerCwd : undefined);
        const dryRun = input.dryRun === true;
        const failed = [];
        const byDomain = {
            skills: emptyStat(),
            mcp: emptyStat(),
            tools: emptyStat(),
        };
        const domains = input.domains ?? [...DOMAIN_ORDER];
        for (const domain of domains) {
            try {
                if (domain === "skills") {
                    await runSkills(services, { sessionId, action, ...(cwd !== undefined ? { cwd } : {}), live, dryRun }, failed, byDomain.skills);
                }
                else if (domain === "mcp") {
                    await runMcp(services, { sessionId, action, ...(cwd !== undefined ? { cwd } : {}), dryRun }, failed, byDomain.mcp);
                }
                else {
                    await runTools(services, { sessionId, action, dryRun }, failed, byDomain.tools);
                }
            }
            catch (error) {
                // 域级异常：本域整体记失败，不阻断其它域（失败不回滚）。
                const stat = byDomain[domain];
                stat.failed += 1;
                failed.push({
                    domain,
                    target: domain,
                    kind: domain === "skills" ? "skill" : domain === "mcp" ? "mcp-server" : "plugin",
                    error: errMessage(error),
                });
                logger?.warn?.(`capability-panel: session.setBulk ${domain} 域失败（session ${sessionId}）：${errMessage(error)}`);
            }
        }
        return {
            ok: true,
            action,
            applied: byDomain.skills.changed + byDomain.mcp.changed + byDomain.tools.changed,
            unchanged: byDomain.skills.unchanged + byDomain.mcp.unchanged + byDomain.tools.unchanged,
            skipped: byDomain.skills.skipped + byDomain.mcp.skipped + byDomain.tools.skipped,
            failed,
            byDomain,
            ...(live ? {} : { coldSession: true }),
            elapsedMs: Math.max(0, now() - startedAt),
        };
    }
    return {
        async setBulk(input) {
            const parsed = parseInput(input);
            if (!parsed.ok)
                return parsed;
            const { sessionId } = parsed.value;
            const previous = queues.get(sessionId) ?? Promise.resolve();
            // 同 session 排队：前一个失败也不影响后一个开始。
            const run = previous.then(() => execute(parsed.value), () => execute(parsed.value));
            const tracked = run.then(() => undefined, () => undefined);
            queues.set(sessionId, tracked);
            try {
                return await run;
            }
            finally {
                if (queues.get(sessionId) === tracked)
                    queues.delete(sessionId);
            }
        },
    };
}
