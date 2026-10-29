/**
 * Tools 域（插件级会话开关）：枚举 → 插件归组 → 会话记录 → `tools.restrict` 应用。
 *
 * 方案：`docs/architecture/v13-implementation.md` §2 / §3 / §5（唯一权威）。
 *
 * 关键口径（不得偏离）：
 *
 *   - **枚举源唯一**：`ctx.root.get("tools").schemas()`（全局视图）。`restrict`
 *     只能屏蔽"继承层"的名字，而 agent 自身层注册的插件工具**枚举不到** ⇒
 *     不显示（不是显示后置灰，方案 §2.2 的规格修正）。
 *   - **一个插件 = 一个开关单元**：关闭 = 对该插件在本会话的全部可继承工具
 *     `tools.restrict({deny})`；deny 名单**每次重算**，持久化只存 `plugin:<unit>`。
 *   - **A4 未识别单元**：可开关、计入分母、不进 Jev 候选。
 *   - **A3 无项目默认**：键缺失 = 默认开启；`enabled:true` 写显式 true（为了
 *     与将来的项目默认语义稳定），`enabled:undefined` 才是"恢复默认"。
 *   - **R2 预留**：{@link applyForAgent} 是纯函数式"对任意 agent 作用域应用
 *     restrict"的入口，不假设自己只被会话创建路径调用（第一批不实现继承本身）。
 *
 * 生命周期与 `mcp/loader.ts` 同构：`agent/created` 首轮应用、`agent/disposed`
 * 只清内存（磁盘留给重启恢复）、`tools/change` 微任务合并后重算。
 *
 * @module dsh-capability-settings/tools/manager
 */
import type { SessionStateStore } from "../session-state.js";
import { type RestrictOutcome, type ToolsRestrictionState } from "./restrict.js";
import { type ToolsListView, type ToolsSetSessionResult } from "./types.js";
/** 结构化 logger 子集（与插件其它模块一致，缺省静默）。 */
export interface ToolsLogger {
    warn?(message: string): void;
    info?(message: string): void;
}
/** 工具说明的码点上限（与 Jev 的 `DESCRIPTION_LIMIT` 同口径）。 */
export declare const TOOL_DESCRIPTION_LIMIT = 200;
/** 旧外壳（无 `tools.restrict`）时的单元锁定文案。 */
export declare const LOCKED_RESTRICT_UNAVAILABLE = "\u5F53\u524D\u5916\u58F3\u4E0D\u652F\u6301\u6309\u4F1A\u8BDD\u5173\u95ED";
/** 构造依赖。 */
export interface ToolsManagerDeps {
    /**
     * 会话级开关的持久化存储（可选）：提供时开关按 sessionId 落盘，agent 重建 /
     * 宿主重启后恢复；省略时纯内存（headless / 旧装配）。
     */
    state?: SessionStateStore;
    /** 宿主日志（结构子集）。 */
    logger?: ToolsLogger;
    /** 全局 tools 服务访问器（测试注入；缺省 `ctx.root.get("tools") ?? ctx.get("tools")`）。 */
    globalTools?: () => any;
}
/** 挂到 `ctx.capabilityPanel.tools` 的服务形状（方案 §5.1）。 */
export interface ToolsManager {
    /** 枚举插件单元 + 本会话开关（不传 sessionId = 只读视图，供主面板）。 */
    list(input?: {
        sessionId?: string;
    }): Promise<ToolsListView>;
    /**
     * 设置本会话的插件开关（**batch-first**；单条 = 长度 1 的数组）。
     *
     * `units` 只接受单元 id（不是工具名）：宿主自己重算 deny 名单。
     * `enabled` 三种取值语义见方案 §5.3。
     */
    setSessionEnabled(input: unknown): Promise<ToolsSetSessionResult>;
    /** 本会话的显式开关快照（诊断；键带 `plugin:` 前缀）。 */
    sessionToggleState(sessionId?: string): Record<string, boolean>;
    /** 卸载：移除生命周期监听、解除已应用的 restrict、清空内存状态。 */
    dispose(): void;
}
/** 对某个 agent 的一次性应用结果（R2 预留形态的返回值）。 */
export interface ApplyForAgentResult {
    /** 本会话要关闭的单元（空 = 无需屏蔽）。 */
    targets: Array<{
        unit: string;
        name: string;
    }>;
    /** restrict 执行结果（`applied` 时带 disposer 供调用方释放）。 */
    outcome: RestrictOutcome;
}
/**
 * 对**任意 agent 作用域**应用 Tools restrict（R2 派生继承的唯一复用点）。
 *
 * 纯函数式：只读 `toggles` / 全局视图，只通过 `agent.ctx` 施加 restrict，
 * 不依赖本模块的会话记录、不假设自己被会话创建路径调用（提案 §5.1 的 child 侧
 * 就是再调一次同一个函数）。**第一批不调用它实现继承**，只保证形态可用。
 *
 * @param agent 目标 agent（需要 `agent.ctx`；stub 直接返回空结果）
 * @param sessionId 目标会话 id（仅诊断/日志）
 * @param toggles 该作用域的开关表（`plugin:<unit>` → boolean；仅 false 参与 deny）
 * @param options.globalTools 全局视图访问器（缺省从 agent.ctx 反查 root）
 */
export declare function applyForAgent(agent: any, sessionId: string, toggles: ReadonlyMap<string, boolean>, options?: {
    globalTools?: () => any;
    logger?: ToolsLogger;
}): ApplyForAgentResult;
/**
 * 创建 Tools 域管理器（组合根单例）。
 *
 * @param ctx 宿主插件上下文（用到 `on` / `get` / `logger` / `root`）
 * @param deps 持久化存储 / 日志 / 全局工具访问器
 */
export declare function createToolsManager(ctx: any, deps?: ToolsManagerDeps): ToolsManager;
export type { ToolsRestrictionState };
