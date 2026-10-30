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
import type { SessionStateStore } from "../session-state.js";
/** 结构化 logger 子集（缺省静默）。 */
export interface DeriveInheritanceLogger {
    warn?(message: string): void;
    info?(message: string): void;
}
/** 构造参数。 */
export interface DeriveInheritanceDeps {
    state: SessionStateStore;
    logger?: DeriveInheritanceLogger;
}
/** 生命周期句柄。 */
export interface DeriveInheritance {
    /** 移除 `agent/created` 监听。 */
    dispose(): void;
}
/**
 * 创建派生继承监听器。
 *
 * 监听器内部**绝不抛错**，也不阻塞子 agent 首轮之外的其它路径；任何失败只
 * warn 并按 `workspace` 语义降级（子 agent 仍可创建）。
 */
export declare function createDeriveInheritance(ctx: any, deps: DeriveInheritanceDeps): DeriveInheritance;
