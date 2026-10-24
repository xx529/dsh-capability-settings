/**
 * 会话级开关记录的"孤儿对账"调度。
 *
 * 为什么需要单独一层：宿主**没有会话删除事件**（cordis 只有
 * `session/created`、`session/disposed`、`session/event`、`session/flush`），
 * 而 `session/disposed` 在正常退出 / 关机时会对**所有 live 会话**发出——
 * 拿它当"会话已删除"信号会在一次重启后清空全部记录。反过来，冷归档会话被
 * 第三方回收站删除时又完全没有任何事件。
 *
 * 因此策略是：事件只做"提醒去核对"，删除由**存在性校验 + 宽限期**决定：
 *
 *   - `check({ allowDelete: true })`：启动后（等持久化服务就绪）与每 24h 一次；
 *     确认不存在的会话先记 `missingSince`，累计 ≥ 宽限期（默认 24h）才删除；
 *   - `check({ allowDelete: false })`：`session/disposed` / `agent/disposed`
 *     触发的 debounce 核对，只标记不删（关机时成批发 disposed，不能误删）；
 *   - 持久化服务不可用 / 探测抛错 ⇒ 一律保留（宁可留垃圾，不可丢用户设置）。
 *
 * 存在性判断口径（宿主 0.2.1-rc.2）：
 *
 *   - live：`ctx.get("agents").list()` / `ctx.get("sessions").list()` 命中；
 *   - 已持久化：`ctx.get("sessionPersistence").stat(id)` 有快照；
 *   - `stat` 返回 `undefined` ⇒ 确认不存在（两阶段后清理）；
 *   - 服务缺失 / 抛错 ⇒ `undefined`（无法判断，保留）。
 *
 * @module dsh-capability-settings/session-state-reconcile
 */
import type { SessionStateReconcileResult, SessionStateStore } from "./session-state.js";
/** 对账调度的可选依赖（测试可整体替换）。 */
export interface SessionStateReconcilerDeps {
    /** 日志（缺省静默）。 */
    logger?: {
        warn?: (message: string) => void;
        info?: (message: string) => void;
    };
    /** live 会话 id 读取；缺省从 `ctx` 的 agents / sessions 服务汇总。 */
    liveIds?: (ctx: any) => ReadonlySet<string>;
    /** 持久化快照探测；缺省 `ctx.get("sessionPersistence").stat(id)`。 */
    persisted?: (ctx: any, sessionId: string) => Promise<boolean | undefined>;
    /** 两阶段宽限期（缺省 24h）。 */
    graceMs?: number;
    /** 周期对账间隔（缺省 24h）。 */
    intervalMs?: number;
    /** disposed 触发核对的 debounce（缺省 5s）。 */
    debounceMs?: number;
    /** 启动对账重试次数（缺省 8；每次间隔 `startupDelayMs`）。 */
    startupRetries?: number;
    /** 启动对账首次延迟 / 重试间隔（缺省 1s）。 */
    startupDelayMs?: number;
    /** 时间源（测试用）。 */
    now?: () => number;
}
/** 对账调度器：由组合根在插件加载时创建并 `start()`。 */
export interface SessionStateReconciler {
    /** 启动：安排启动对账 + 周期对账（幂等）。 */
    start(): void;
    /** 立即核对一次（`allowDelete` 缺省 false = 只标记）。 */
    check(input?: {
        allowDelete?: boolean;
    }): Promise<SessionStateReconcileResult>;
    /** `session/disposed` / `agent/disposed` 时调用：debounce 后做"只标记"核对。 */
    noteDisposed(): void;
    /** 卸载：清掉所有定时器。 */
    dispose(): void;
}
/**
 * 构造对账调度器。
 *
 * @param ctx 宿主上下文（只读服务探测；不注册任何监听，事件由组合根接）
 * @param store 会话级开关存储（与两个域共用同一实例）
 * @param deps 可选覆盖（测试用）
 */
export declare function createSessionStateReconciler(ctx: any, store: SessionStateStore, deps?: SessionStateReconcilerDeps): SessionStateReconciler;
