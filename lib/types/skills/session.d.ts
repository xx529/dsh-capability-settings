/**
 * Skills 的**会话级**开关（内存态、不落盘）。
 *
 * 背景：宿主 `skills` 注册表（`@deepseek-ai/dsh-skill` 的 `SkillRegistry`）
 * 没有 disable/restrict 一类的按会话禁用 API，但它是**分层**的：`register()`
 * 把 runtime skill 注册进「调用方 ctx 所属 scope」的层（`this.layers.effect(
 * this.ctx, ...)`，`scopeOf(this.ctx)`），读取时按 `global → 祖先 → 最近层`
 * 合并，**同名最近层赢**。因此：
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
 * 语义边界：
 *   - **只可关闭，不能强制开启**：文件级已禁用（frontmatter 双 false）或项目
 *     内 shadow stub 的条目，本模块只把它们从可切换列表里过滤掉，不会去
 *     「反向开启」；
 *   - **纯内存**：不落盘，agent 销毁 / 宿主重启即回到默认（本期语义）；
 *   - 找不到 live agent（冷会话）时开关失败并返回业务错误，不做状态暂存。
 *
 * @module dsh-capability-settings/skills/session
 */
import type { SkillSummaryView } from "./types.js";
/** 面板「本会话」列表的一行：磁盘视图 + 本会话启用态。 */
export interface SessionSkillView extends SkillSummaryView {
    /** 本会话是否生效（默认 true；被本会话 shadow 后 false）。 */
    enabledInSession: boolean;
    /** 当前是否有该 session 的 agent ctx（false 时 UI 置灰）。 */
    canToggleInSession: boolean;
}
/** 会话级 Skills 开关的结果（业务信封形状，见 remote.ts 文件头）。 */
export type SessionSkillOpResult = {
    ok: true;
} | {
    ok: false;
    errors: string[];
};
/** 会话级 Skills 开关注册表（挂到 `capabilityPanel.skills` 上）。 */
export interface SkillSessionRegistry {
    /**
     * 合并磁盘列表 + 本会话启用态。
     *
     * @param baseList 磁盘视图函数（由 index.ts 注入 skills manager 的 list）
     * @param cwd 工作区路径（决定项目根，用于磁盘视图）
     * @param sessionId 会话 id；缺省时全部条目 `canToggleInSession:false`
     */
    list(baseList: (cwd?: string) => Promise<SkillSummaryView[]>, cwd?: string, sessionId?: string): Promise<SessionSkillView[]>;
    /** 设置本会话开关（内存态，不落盘）。enabled=false 注册 shadow；true 解除。 */
    setEnabled(input: {
        sessionId: string;
        name: string;
        enabled: boolean;
    }): Promise<SessionSkillOpResult>;
    /** 本会话被关闭的 skill 名（只读快照，测试/诊断用）。 */
    sessionState(sessionId: string): string[];
    /** 卸载：移除生命周期监听并清空内存状态（agent fiber 自己回收 shadow 注册）。 */
    dispose(): void;
}
/**
 * 构造会话级 Skills 开关注册表。
 *
 * 只做「簿记 + 注册/解除」；磁盘列表仍由 `skills/manager.ts` 提供，避免两处
 * 读取口径分叉。生命周期监听与 `mcp/loader.ts` 的 mountAgent 同款：
 * `agent/created` 登记、`agent/disposed` 清理（shadow 注册挂在 agent fiber 的
 * 效果上，agent 销毁时由 cordis 自动回收，这里只清 Map）。
 *
 * @param ctx 宿主上下文（插件自身的 ctx；用 `ctx.get("agents")` 补登记存量）
 */
export declare function createSkillSessionRegistry(ctx: any): SkillSessionRegistry;
