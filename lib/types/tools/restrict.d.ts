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
/**
 * v28：预设（agent-scope）工具被工作区默认关闭时，执行层 guard 的拒绝文案。
 *
 * `tools.restrict` 无法屏蔽 agent 自身层注册（宿主契约），因此这类单元改用
 * `tools.guard`（monotonic denial）在调用时拒绝；恢复工作区默认后 disposer 解除。
 */
export declare const PRESET_TOOL_DISABLED_REASON = "\u8BE5\u5DE5\u5177\u5728\u6240\u5C5E\u5DE5\u4F5C\u533A\u5DF2\u5173\u95ED\uFF08\u80FD\u529B\u9762\u677F\u5DE5\u4F5C\u533A\u9ED8\u8BA4\uFF09\uFF1B\u6062\u590D\u9ED8\u8BA4\u540E\u53EF\u7528";
/** v28：宿主未提供 `tools.guard` 时预设工具的降级说明。 */
export declare const TOOLS_GUARD_UNAVAILABLE = "\u5BBF\u4E3B tools \u670D\u52A1\u672A\u63D0\u4F9B guard()\uFF0C\u65E0\u6CD5\u5728\u672C\u4F1A\u8BDD\u62D2\u7EDD\u5DF2\u5173\u95ED\u7684\u9884\u8BBE\u5DE5\u5177";
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
export declare const RESTRICT_RETRY_LIMIT = 4;
/**
 * {@link applyRestrict} 的容错版：宿主拒绝部分名字时剔除并重试。
 *
 * @param agentTools agent 作用域的 tools 服务
 * @param deny 候选 deny 名单（可包含 scope-local 名字）
 */
export declare function applyRestrictWithRetry(agentTools: any, deny: readonly string[]): RestrictOutcome;
/** 两个工具名清单是否等价（restrict 名单与顺序无关；空名单同样等价）。 */
export declare function sameDenyNames(left: readonly string[], right: readonly string[]): boolean;
