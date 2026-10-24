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
 *   - **纯内存**：不落盘，agent 销毁 / 宿主重启即回到默认；项目默认才落
 *     `.agents/capability-overrides.json`；
 *   - 找不到 live agent（冷会话）时开关失败并返回业务错误，不做状态暂存。
 *
 * @module dsh-capability-settings/skills/session
 */
import type { SkillRegistryBridge } from "./registry.js";
import type { SkillSummaryView } from "./types.js";
/** 会话级 Skills 开关 / 项目默认投影的依赖。 */
export interface SkillSessionDeps {
    /** 项目默认禁用名单（overrides.skills；只对注入技能生效）。 */
    projectDisabled?: (cwd?: string) => Promise<readonly string[]>;
    /** 宿主 registry 桥（读注入技能 + read-before/after-shadow 校验）；缺省退化为纯磁盘行为。 */
    registry?: SkillRegistryBridge;
    /** 宿主日志（结构子集）。 */
    logger?: {
        warn?: (message: string) => void;
    };
}
/** 面板「本会话」列表的一行：磁盘/注入视图 + 本会话启用态。 */
export interface SessionSkillView extends SkillSummaryView {
    /** 本会话是否生效（项目默认 + 会话显式开关共同决定，以实际 shadow 状态为准）。 */
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
     * 合并磁盘/注入列表 + 本会话启用态。
     *
     * @param baseList 磁盘视图函数（由 index.ts 注入 skills manager 的 list）
     * @param cwd 工作区路径（决定项目根与项目默认名单）
     * @param sessionId 会话 id；缺省时全部条目 `canToggleInSession:false`
     */
    list(baseList: (cwd?: string) => Promise<SkillSummaryView[]>, cwd?: string, sessionId?: string): Promise<SessionSkillView[]>;
    /**
     * 设置本会话开关（内存态，不落盘）。
     *
     * `enabled=false` 注册 shadow；`true` 解除；`undefined` 清除显式覆盖、
     * 回到项目默认（与 MCP 的 `setSessionEnabled` 语义对齐）。
     */
    setEnabled(input: {
        sessionId: string;
        name: string;
        enabled?: boolean;
    }): Promise<SessionSkillOpResult>;
    /** 项目默认变更后，对同项目的全部 live 会话增量 reconcile。 */
    reconcileProject(cwd?: string): Promise<SessionSkillOpResult>;
    /** 本会话被关闭的 skill 名（只读快照，测试/诊断用）。 */
    sessionState(sessionId: string): string[];
    /** 按 sessionId 取 live agent（registry 桥的 scope 传参用）。 */
    agentOf(sessionId: string): any | undefined;
    /** 该名字当前是否被本插件的任一 shadow 遮蔽（registry 桥清缓存时保留元数据用）。 */
    isShadowed(sessionId: string, name: string): boolean;
    /** 卸载：移除生命周期监听并清空内存状态（agent fiber 自己回收 shadow 注册）。 */
    dispose(): void;
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
export declare function createSkillSessionRegistry(ctx: any, deps?: SkillSessionDeps): SkillSessionRegistry;
