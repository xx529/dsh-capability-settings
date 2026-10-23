/**
 * 能力枚举、应用事务与冷会话排队（架构 §7 / §8）。
 *
 * 三条不变量：
 *
 *   1. **枚举是唯一入口**：`rank` 与 `apply` 都走 `enumerateCapabilities`，
 *      客户端传来的 `name` / `target` 一律不信任 —— 应用时按 `id` 重新枚举解析；
 *   2. **写入串行 + 失败逆序回滚**：skills 的 shadow 注册与 MCP 重挂都不是并发
 *      安全的；部分失败时按前态快照逆序恢复；
 *   3. **冷会话只排队不写**：无 live agent 时把已解析的计划存进内存
 *      `Map<sessionId, PendingPlan>`，`ctx.on("agent/created")` 命中后
 *      `setTimeout(0)` 延后应用（让 mcp/loader 等监听先完成登记），失败短重试。
 *
 * @module @chengdb/capability-panel/jev/apply
 */
import type { McpOpResult } from "../mcp/manager.js";
import type { McpListResult, McpRuntimeView } from "../mcp/types.js";
import type { SessionSkillOpResult, SessionSkillView } from "../skills/session.js";
import type { JevApplyResult, JevApplySkipped, JevCapability, JevHostContext, JevLogger, JevPendingOutcome, JevPrevState } from "./types.js";
/**
 * 枚举/写入依赖的宿主服务（结构子集）。
 *
 * 只声明用到的三个方法，避免 `jev/**` 运行时 import `index.ts`
 * （组合根）造成循环依赖；赋值兼容性由 `src/index.ts` 的装配处检查。
 */
export interface JevCapabilityService {
    skills: {
        sessionList(cwd?: string, sessionId?: string): Promise<SessionSkillView[]>;
        setSessionEnabled(input: {
            sessionId: string;
            name: string;
            enabled: boolean;
        }): Promise<SessionSkillOpResult>;
    };
    mcp: {
        list(cwd?: string, sessionId?: string): Promise<McpListResult>;
        runtime(input: {
            cwd?: string;
            sessionId?: string;
        }): Promise<McpRuntimeView>;
        setSessionEnabled(input: {
            sessionId: string;
            cwd?: string;
            target: string;
            kind: "project" | "server";
            enabled: boolean | undefined;
        }): Promise<McpOpResult>;
    };
    /**
     * 可选：从全局工具注册表反推某个 MCP server 的工具（name + description）。
     *
     * 由组合根实现（`ctx.get("tools").schemas()` 过滤 `mcp__<serverName>__*`），
     * 用于把工具清单塞进 rank 的 question，帮助模型判断 server 实际能做什么。
     * 不可用 / 抛错 / 返回空都会被静默降级（能力照常评分，只是没有 tools）。
     */
    mcpTools?(serverName: string): Array<{
        name: string;
        description?: string;
    }> | Promise<Array<{
        name: string;
        description?: string;
    }>>;
}
/** 冷会话计划（同会话只保留最新一份）。 */
export interface JevPendingPlan {
    sessionId: string;
    cwd?: string;
    createdAt: number;
    /** 已通过入参校验与能力本体可应用判定的条目（含前态快照）。 */
    items: Array<{
        cap: JevCapability;
        prev: JevPrevState;
    }>;
    skipped: JevApplySkipped[];
}
/** 冷会话队列/应用引擎。 */
export interface JevApplyEngine {
    /** 枚举当前会话的评分集合（含 applicable=false 的项）。 */
    enumerate(input: {
        cwd?: string;
        sessionId: string;
        live?: boolean;
    }): Promise<JevCapability[]>;
    /** 判活：`agents.list()` 中存在 `agent.id === sessionId`。 */
    isSessionLive(sessionId: string): boolean;
    /** `jev.apply` 主体。 */
    apply(input: unknown): Promise<JevApplyResult>;
    /** 读取并消费某会话的排队结果回执（读取即消费）。 */
    consumePendingOutcome(sessionId: string): JevPendingOutcome | undefined;
    /** 诊断：当前排队中的计划数。 */
    pendingCount(): number;
    /** 卸载：移除生命周期监听、清空两张 Map。 */
    dispose(): void;
}
/** 引擎构造参数。 */
export interface JevApplyEngineDeps {
    ctx: JevHostContext;
    /** 延迟求值的服务访问器（避免与 `capabilityPanel` 服务构造顺序耦合）。 */
    service: () => JevCapabilityService | undefined;
    logger?: JevLogger;
    /** 可注入的 sleep（测试用；默认 setTimeout）。 */
    sleep?: (ms: number) => Promise<void>;
    /** 可注入的时钟（测试用；默认 Date.now）。 */
    now?: () => number;
}
/**
 * 会话是否 live：`agents.list()` 存在 `agent.id === sessionId`（F4）。
 *
 * 每次调用现算、不缓存（agent 生命周期由事件驱动，缓存会陈旧）。
 * `agents` 服务不可用时按「冷会话」处理（降级：排队，用户可手动重试）。
 */
export declare function isSessionLive(ctx: JevHostContext, sessionId: string): boolean;
/**
 * 枚举一个会话的评分集合（架构 §7.1）。
 *
 * 集合包含 `applicable=false` 的项（前端要展示「不可切换 + 原因」）；
 * 应用集合 = 其中 `applicable` 为 true 的子集。
 *
 * @param options.live 会话是否 live。**冷会话技能不按 `canToggleInSession`
 *   排除**（§7.3 冷会话例外），否则首屏主场景将无技能可选。
 */
export declare function enumerateCapabilities(options: {
    service: () => JevCapabilityService | undefined;
    cwd?: string;
    sessionId: string;
    live: boolean;
    logger?: JevLogger;
}): Promise<JevCapability[]>;
/**
 * 创建应用引擎：枚举 / 事务 / 冷会话排队 / 生命周期监听。
 */
export declare function createJevApplyEngine(deps: JevApplyEngineDeps): JevApplyEngine;
