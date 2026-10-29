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
import type { HostToolBrief } from "./types.js";
/** 宿主未提供 `tools.restrict` 时的降级说明。 */
export declare const TOOLS_RESTRICT_UNAVAILABLE = "\u5BBF\u4E3B tools \u670D\u52A1\u672A\u63D0\u4F9B restrict()\uFF0C\u65E0\u6CD5\u5728\u672C\u4F1A\u8BDD\u5173\u95ED\u63D2\u4EF6\u5DE5\u5177";
/** 名单为空（工具尚未注册 / 已全部注销）时的降级说明。 */
export declare const TOOLS_RESTRICT_NO_TOOLS = "\u8BE5\u5355\u5143\u5F53\u524D\u6CA1\u6709\u5DF2\u6CE8\u518C\u7684\u5168\u5C40\u5DE5\u5177\uFF08\u53EF\u80FD\u5C1A\u672A\u52A0\u8F7D\uFF09\uFF0C\u672C\u6B21\u672A\u8C03\u7528 restrict";
/** 一次 restrict 的结果状态（与 `McpRestrictionView.state` 同口径）。 */
export type ToolsRestrictionState = "applied" | "skipped" | "failed";
/** restrict 执行结果（`deny` 是实际提交的名单，供幂等短路比对）。 */
export interface RestrictOutcome {
    state: ToolsRestrictionState;
    /** 实际提交（或结算出但未提交）的 deny 名单。 */
    deny: string[];
    error?: string;
    /** `applied` 时的解绑句柄（`tools.restrict` 返回的 disposer）。 */
    dispose?: () => void;
}
/**
 * 计算 deny 名单：目标单元的全部工具名，去掉 `run_code` 等保留名与非当前
 * 全局视图名字，去重并保持稳定序（按工具名升序，便于幂等比对）。
 *
 * @param targetTools 目标单元的工具清单（来自**当前** `tools.list` 枚举）
 * @param available 当前全局视图里的全部工具名（restrict 只接受这些名字）
 */
export declare function computeDenyNames(targetTools: readonly (readonly HostToolBrief[])[], available: ReadonlySet<string>): string[];
/**
 * 对某个 agent 作用域的 tools 服务提交一次 restrict。
 *
 * 任何失败都只降级为 `skipped` / `failed`（warning 由调用方打），绝不抛穿——
 * 一次关闭失败不能让会话其它功能受影响。
 *
 * @param agentTools `agent.ctx.get("tools")` 得到的**作用域内**代理
 * @param deny 已按 {@link computeDenyNames} 过滤好的工具名
 */
export declare function applyRestrict(agentTools: any, deny: readonly string[]): RestrictOutcome;
/** 两个工具名清单是否等价（restrict 名单与顺序无关；空名单同样等价）。 */
export declare function sameDenyNames(left: readonly string[], right: readonly string[]): boolean;
