/**
 * 派生继承（spawn-time snapshot）：在子 agent 创建时按父会话的「派生继承模式」
 * 决定复制哪些会话级能力开关。
 *
 * 语义（用户 2026-10-30 拍板）：
 *
 *   - 主对话的 `deriveMode` 只有两个值：
 *     `session`（默认）= 复制当前会话的显式覆盖（Skills / MCP / Tools）；
 *     `workspace` = 不复制，子 agent 使用工作区 / 项目默认；
 *   - **只在 `agent/created` 且 `source === "startup"`（新创建）时生效**；
 *     `source === "resume"` 一律跳过——子会话记录里已有创建时快照；
 *   - 只影响之后创建的 child，已存在的 child 不回溯；
 *   - 复制的是父会话的**显式覆盖**（不是项目 / 全局默认）。
 *
 * 时序：本模块必须在 skills / mcp / tools 的 `agent/created` 监听器之前创建，
 * 这样监听器（被 cordis serial await）先把快照写进 child 的会话记录，三个域
 * 后续 hydrate 时就能读到同一份快照，无需 owner 投影或热传播。
 *
 * @module dsh-capability-settings/derive/manager
 */
import { findProjectRoot } from "../shared/project-root.js";
import { errMessage } from "../shared/errors.js";
/** 从 agent 读会话 header 创建时间（防 sessionId 复用）。 */
function headerCreatedAtOf(agent) {
    const value = agent?.session?.header?.createdAt;
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
/** 会话记录落盘元数据（cwd 仅诊断，headerCreatedAt 防 id 复用）。 */
function metaOf(agent) {
    const header = agent?.session?.header;
    const meta = {};
    if (typeof header?.cwd === "string" && header.cwd.length > 0)
        meta.cwd = header.cwd;
    const createdAt = headerCreatedAtOf(agent);
    if (createdAt !== undefined)
        meta.headerCreatedAt = createdAt;
    return meta;
}
/** 本插件 shadow 的描述（与 skills/registry.ts 的 SHADOW_DESCRIPTION 同值）。 */
const SHADOW_DESCRIPTION = "本会话已禁用（capability-panel）";
/** 是否为模型实际可见的 skill（排除本插件 shadow / 文件级硬禁用项）。 */
function isVisibleSkill(entry) {
    if (typeof entry?.name !== "string" || entry.name.length === 0)
        return false;
    if (entry.description === SHADOW_DESCRIPTION)
        return false;
    const invocation = entry.invocation;
    if (invocation !== undefined && invocation.modelInvocable === false)
        return false;
    return true;
}
/**
 * 读某个 agent 作用域下的**模型可见** skill 名集合。
 *
 * 用宿主 `skills.snapshot({scope: agent})` 而不是插件自己的 list：它已经合并
 * global / 祖先 / 当前 preset 层，并应用了该 agent 作用域上的 shadow（父会话
 * 关闭的 skill 不会出现在父级可见集合里）。失败返回 undefined，由调用方回落
 * 到「复制父级显式开关」的旧策略。
 */
async function visibleSkillNames(ctx, agent, cwd) {
    try {
        const skills = ctx.get?.("skills");
        if (skills === undefined || typeof skills.snapshot !== "function")
            return undefined;
        const snapshot = await skills.snapshot({ ...(cwd !== undefined ? { cwd } : {}), scope: agent });
        if (snapshot === null || typeof snapshot !== "object" || !Array.isArray(snapshot.skills))
            return undefined;
        const names = new Set();
        for (const entry of snapshot.skills) {
            if (isVisibleSkill(entry))
                names.add(entry.name);
        }
        return names;
    }
    catch {
        return undefined;
    }
}
/**
 * 解析「继承会话」是否仍可安全复制。
 *
 * 父 / 子 cwd 都属于同一个项目根时才复制会话覆盖；不同项目根的 MCP
 * `project:<key>` / 项目默认不同，跨项目复制会串味，此时降级为
 * `workspace`（子级按自己的项目默认启动）。
 */
function effectiveMode(mode, childCwd, parentCwd) {
    if (mode !== "session")
        return mode;
    if (childCwd === undefined || parentCwd === undefined)
        return mode;
    try {
        return findProjectRoot(childCwd) === findProjectRoot(parentCwd) ? mode : "workspace";
    }
    catch {
        return mode;
    }
}
/**
 * 创建派生继承监听器。
 *
 * 监听器内部**绝不抛错**，也不阻塞子 agent 首轮之外的其它路径；任何失败只
 * warn 并按 `workspace` 语义降级（子 agent 仍可创建）。
 */
export function createDeriveInheritance(ctx, deps) {
    const { state, logger } = deps;
    let disposed = false;
    /**
     * `agent/created` 处理：只在“新创建”的派生会话上写一次快照。
     */
    async function onCreated(agent, source) {
        if (disposed)
            return;
        // 只有新创建才继承；resume / 其它来源一律不复刻（child 记录已持久化）。
        if (source !== "startup")
            return;
        const header = agent?.session?.header;
        const childId = typeof agent?.id === "string" ? agent.id : undefined;
        const parentId = typeof header?.parentSession === "string" ? header.parentSession : undefined;
        if (childId === undefined || parentId === undefined)
            return;
        await state.ready();
        // 已经写过派生快照（例如同一 agent 被重复 announce）⇒ 保留第一次结果。
        if (state.derivedInfo(childId) !== undefined)
            return;
        const mode = state.deriveMode(parentId);
        const meta = metaOf(agent);
        const childCwd = typeof header?.cwd === "string" ? header.cwd : undefined;
        let parentAgent;
        let parentCwd;
        try {
            parentAgent = ctx.get?.("agents")?.get?.(parentId);
            const liveCwd = parentAgent?.session?.header?.cwd;
            if (typeof liveCwd === "string" && liveCwd.length > 0)
                parentCwd = liveCwd;
        }
        catch {
            /* agents 服务缺失：退回落盘 cwd */
        }
        if (parentCwd === undefined) {
            const recordCwd = state.entries()[parentId]?.cwd;
            if (typeof recordCwd === "string" && recordCwd.length > 0)
                parentCwd = recordCwd;
        }
        const applied = effectiveMode(mode, childCwd, parentCwd);
        if (applied !== mode) {
            logger?.warn?.(`capability-panel: 派生继承 ${parentId} → ${childId} 跨项目根，按工作区默认启动（不复制会话覆盖）`);
        }
        let toggles = {};
        if (applied === "session") {
            toggles = { skills: state.skills(parentId), mcp: state.mcp(parentId), tools: state.tools(parentId) };
            /**
             * 关键修正（2026-10-30）：父会话的**技能目录**在升级 / 换 preset 后会变化，
             * 只复制父级显式开关会让 child 的 150+ 个新技能保持默认开启（用户实测：
             * lead 13 个、teammate 153 个）。这里按「父会话模型可见集合」投影到 child
             * 自己的可见目录：父级可见 → true，父级不可见 → false，保证两边范围一致。
             */
            if (parentAgent !== undefined) {
                const [parentNames, childNames] = await Promise.all([
                    visibleSkillNames(ctx, parentAgent, parentCwd),
                    visibleSkillNames(ctx, agent, childCwd),
                ]);
                if (parentNames !== undefined && childNames !== undefined) {
                    const projected = {};
                    for (const name of childNames)
                        projected[name] = parentNames.has(name);
                    toggles = { ...toggles, skills: projected };
                }
                else {
                    logger?.warn?.("capability-panel: 派生继承读取技能目录失败，回落到复制父级显式开关");
                }
            }
        }
        await state.seedDerived(childId, parentId, applied, toggles, meta);
    }
    const off = typeof ctx.on === "function"
        ? ctx.on("agent/created", (payload) => onCreated(payload?.agent, payload?.source).catch((error) => {
            // 监听器绝不抛穿：agent/created 被 await，失败会让子 agent 创建失败。
            logger?.warn?.(`capability-panel: 写入派生继承快照失败（${errMessage(error)}）`);
        }))
        : undefined;
    return {
        dispose() {
            if (disposed)
                return;
            disposed = true;
            if (typeof off === "function")
                off();
        },
    };
}
