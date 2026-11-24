/**
 * Tools 域的 deny 名单计算与 `tools.restrict` 执行（对照 `mcp/loader.ts` 的
 * `applyRestrictions` 范式，方案 §5.2）。
 *
 * 的三条硬约束（宿主 `dsh-tools` 契约，证据 §3.1 原文）：
 *
 *   1. 必须由 **agent 作用域**的 tools 服务调用（无 scoped ctx 抛
 *      "requires a scoped context"）；
 *   2. 空 filter（`{deny:[]}`）抛错 ⇒ 名单为空时**不调用**，记 `skipped`；
 *   3. 名字必须是**当前已注册且可继承**的名字（未知 / scope-local 直接抛错）⇒
 *      deny 只从当前全局视图枚举里取，不落盘工具名（持久化只存 unit id）。
 *
 * `run_code` 另有一条硬禁令：出现在 deny/allow 里会直接抛错（`dsh-tools:2999`）。
 * 它同时在宿主内建排除清单里，这里再过滤一次作为防御。
 *
 * @module dsh-capability-settings/tools/restrict
 */
import { errMessage } from "../shared/errors.js";
import { isRestrictForbiddenToolName } from "../shared/plugin-attribution.js";
/** 宿主未提供 `tools.restrict` 时的降级说明。 */
export const TOOLS_RESTRICT_UNAVAILABLE = "宿主 tools 服务未提供 restrict()，无法在本会话关闭插件工具";
/** 名单为空（工具尚未注册 / 已全部注销）时的降级说明。 */
export const TOOLS_RESTRICT_NO_TOOLS = "该单元当前没有已注册的全局工具（可能尚未加载），本次未调用 restrict";
/**
 * v28：预设（agent-scope）工具被工作区默认关闭时，执行层 guard 的拒绝文案。
 *
 * `tools.restrict` 无法屏蔽 agent 自身层注册（宿主契约），因此这类单元改用
 * `tools.guard`（monotonic denial）在调用时拒绝；恢复工作区默认后 disposer 解除。
 */
export const PRESET_TOOL_DISABLED_REASON = "该工具在所属工作区已关闭（能力面板工作区默认）；恢复默认后可用";
/** v28：宿主未提供 `tools.guard` 时预设工具的降级说明。 */
export const TOOLS_GUARD_UNAVAILABLE = "宿主 tools 服务未提供 guard()，无法在本会话拒绝已关闭的预设工具";
/**
 * 计算 deny 名单：目标单元的全部工具名，去掉 `run_code` 等保留名与非当前
 * 全局视图名字，去重并保持稳定序（按工具名升序，便于幂等比对）。
 *
 * @param targetTools 目标单元的工具清单（来自**当前** `tools.list` 枚举）
 * @param available 当前全局视图里的全部工具名（restrict 只接受这些名字）
 */
export function computeDenyNames(targetTools, available) {
    const deny = new Set();
    for (const tools of targetTools) {
        for (const tool of tools) {
            const name = tool?.name;
            if (typeof name !== "string" || name.length === 0)
                continue;
            if (isRestrictForbiddenToolName(name))
                continue;
            if (!available.has(name))
                continue;
            deny.add(name);
        }
    }
    return [...deny].sort((a, b) => a.localeCompare(b));
}
/**
 * 对某个 agent 作用域的 tools 服务提交一次 restrict。
 *
 * 任何失败都只降级为 `skipped` / `failed`（warning 由调用方打），绝不抛穿——
 * 一次关闭失败不能让会话其它功能受影响。
 *
 * @param agentTools `agent.ctx.get("tools")` 得到的**作用域内**代理
 * @param deny 已按 {@link computeDenyNames} 过滤好的工具名
 */
export function applyRestrict(agentTools, deny) {
    if (typeof agentTools?.restrict !== "function") {
        return { state: "skipped", deny: [...deny], error: TOOLS_RESTRICT_UNAVAILABLE };
    }
    if (deny.length === 0) {
        // 契约规定空 filter 抛错，且没有工具可屏蔽时 restrict 也无意义。
        return { state: "skipped", deny: [], error: TOOLS_RESTRICT_NO_TOOLS };
    }
    try {
        // 必须由 agent.ctx 调用：restrict 按调用方作用域生效（契约原文见模块头）。
        const dispose = agentTools.restrict({ deny: [...deny] });
        return typeof dispose === "function" ? { state: "applied", deny: [...deny], dispose } : { state: "applied", deny: [...deny] };
    }
    catch (error) {
        return { state: "failed", deny: [...deny], error: errMessage(error) };
    }
}
/**
 * v28.1：提交 restrict，并在宿主拒绝「非继承层 / 已注销」名字时自动剔除重试。
 *
 * 预设插件的工具注册在 **预设祖先作用域**，agent 作用域可以 restrict；但同一个
 * agent 作用域里也可能有插件自己注册的 scope-local 工具（例如 trace-inspect 的
 * 影子工具），它们会混在 `tools.schemas(agent)` 的并集里。未知名字一旦提交会让
 * 整条 restriction 失败、所有工具都关不掉，因此：
 *   1. 先整批提交；
 *   2. 失败时从宿主错误里解析被拒绝的名字（`unknown global tool "x"`），
 *      只从 deny 中剔除这些名字后重试；
 *   3. 其它错误原样返回 failed。
 *
 * 最多重试 {@link RESTRICT_RETRY_LIMIT} 次；剔除后为空按「没有可屏蔽工具」跳过。
 */
export const RESTRICT_RETRY_LIMIT = 4;
/** 从宿主错误里解析被拒绝的工具名（只取 `; known global tools:` 之前）。 */
function rejectedNamesFrom(error, deny) {
    if (typeof error !== "string" || error.length === 0)
        return [];
    const head = error.split("; known global tools:")[0] ?? error;
    if (!/unknown global tool|scope-local|not restrictable/i.test(head))
        return [];
    const names = [...head.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "");
    return [...new Set(names)].filter((name) => name.length > 0 && deny.has(name));
}
/**
 * {@link applyRestrict} 的容错版：宿主拒绝部分名字时剔除并重试。
 *
 * @param agentTools agent 作用域的 tools 服务
 * @param deny 候选 deny 名单（可包含 scope-local 名字）
 */
export function applyRestrictWithRetry(agentTools, deny) {
    const remaining = new Set(deny);
    let last = { state: "skipped", deny: [] };
    for (let attempt = 0; attempt <= RESTRICT_RETRY_LIMIT; attempt += 1) {
        if (remaining.size === 0) {
            return { state: "skipped", deny: [], error: TOOLS_RESTRICT_NO_TOOLS };
        }
        const current = [...remaining].sort((a, b) => a.localeCompare(b));
        last = applyRestrict(agentTools, current);
        if (last.state !== "failed")
            return last;
        const rejected = rejectedNamesFrom(last.error, remaining);
        if (rejected.length === 0)
            return last;
        for (const name of rejected)
            remaining.delete(name);
    }
    return last;
}
/** 两个工具名清单是否等价（restrict 名单与顺序无关；空名单同样等价）。 */
export function sameDenyNames(left, right) {
    return left.length === right.length && left.every((name) => right.includes(name));
}
