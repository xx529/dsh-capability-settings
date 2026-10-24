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
import { SESSION_STATE_GRACE_MS } from "./session-state.js";
/** 默认周期对账间隔（24 小时）。 */
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** disposed 触发的核对 debounce（5 秒，合并关机时成批事件）。 */
const DEFAULT_DEBOUNCE_MS = 5_000;
/** 启动对账：等待 `sessionPersistence` 就绪的最大重试次数。 */
const DEFAULT_STARTUP_RETRIES = 8;
/** 启动对账：首次延迟与每次重试间隔（毫秒）。 */
const DEFAULT_STARTUP_DELAY_MS = 1_000;
/** 从服务列表里汇总 live 会话 id（服务缺失 / 形状不符时安全跳过）。 */
function defaultLiveIds(ctx) {
    const ids = new Set();
    const collect = (list) => {
        for (const item of Array.isArray(list) ? list : []) {
            const id = item?.id;
            if (typeof id === "string" && id.length > 0)
                ids.add(id);
        }
    };
    try {
        collect(ctx?.get?.("agents")?.list?.());
    }
    catch {
        /* agents 服务不可用：忽略该来源 */
    }
    try {
        collect(ctx?.get?.("sessions")?.list?.());
    }
    catch {
        /* sessions 服务不可用：忽略该来源 */
    }
    return ids;
}
/** 持久化快照探测：`undefined` = 无法判断（保留）。 */
async function defaultPersisted(ctx, sessionId) {
    let service;
    try {
        service = ctx?.get?.("sessionPersistence");
    }
    catch {
        return undefined;
    }
    if (typeof service?.stat !== "function")
        return undefined;
    try {
        return (await service.stat(sessionId)) !== undefined;
    }
    catch {
        // 格式不支持 / 快照损坏 / 后端未就绪：保留记录（宁可留垃圾，不可误删）。
        return undefined;
    }
}
/** `sessionPersistence` 是否已就绪（启动对账的前置条件）。 */
function persistenceAvailable(ctx) {
    try {
        return typeof ctx?.get?.("sessionPersistence")?.stat === "function";
    }
    catch {
        return false;
    }
}
/**
 * 构造对账调度器。
 *
 * @param ctx 宿主上下文（只读服务探测；不注册任何监听，事件由组合根接）
 * @param store 会话级开关存储（与两个域共用同一实例）
 * @param deps 可选覆盖（测试用）
 */
export function createSessionStateReconciler(ctx, store, deps = {}) {
    const logger = deps.logger;
    const graceMs = deps.graceMs ?? SESSION_STATE_GRACE_MS;
    const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
    const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    const startupRetries = deps.startupRetries ?? DEFAULT_STARTUP_RETRIES;
    const startupDelayMs = deps.startupDelayMs ?? DEFAULT_STARTUP_DELAY_MS;
    let started = false;
    let disposed = false;
    let startupTimer;
    let intervalTimer;
    let debounceTimer;
    /** 立即核对一次。 */
    async function check(input = {}) {
        const result = await store.reconcile({
            liveIds: (deps.liveIds ?? defaultLiveIds)(ctx),
            persisted: (sessionId) => (deps.persisted ?? defaultPersisted)(ctx, sessionId),
            allowDelete: input.allowDelete === true,
            ...(deps.now !== undefined ? { now: deps.now() } : {}),
            ...(deps.graceMs !== undefined ? { graceMs } : {}),
        });
        if (result.removed.length > 0) {
            logger?.info?.(`capability-panel: 清理了 ${result.removed.length} 条已删除会话的能力开关记录`);
        }
        return result;
    }
    /** 启动对账：等持久化服务就绪，避免把冷会话全判成"不存在"。 */
    function scheduleStartup(attempt) {
        if (disposed)
            return;
        startupTimer = setTimeout(() => {
            startupTimer = undefined;
            void (async () => {
                const available = persistenceAvailable(ctx);
                if (!available && attempt < startupRetries) {
                    scheduleStartup(attempt + 1);
                    return;
                }
                if (!available) {
                    logger?.warn?.("capability-panel: 会话持久化服务不可用，跳过启动对账（不影响会话开关）");
                    return;
                }
                try {
                    await check({ allowDelete: true });
                }
                catch (error) {
                    logger?.warn?.(`capability-panel: 启动对账失败（${String(error)}）`);
                }
            })();
        }, startupDelayMs);
        if (typeof startupTimer?.unref === "function")
            startupTimer.unref();
    }
    return {
        start() {
            if (started || disposed)
                return;
            started = true;
            scheduleStartup(0);
            intervalTimer = setInterval(() => {
                void check({ allowDelete: true }).catch((error) => {
                    logger?.warn?.(`capability-panel: 周期对账失败（${String(error)}）`);
                });
            }, intervalMs);
            if (typeof intervalTimer?.unref === "function")
                intervalTimer.unref();
        },
        check,
        noteDisposed() {
            if (disposed || debounceTimer !== undefined)
                return;
            debounceTimer = setTimeout(() => {
                debounceTimer = undefined;
                void check({ allowDelete: false }).catch(() => undefined);
            }, debounceMs);
            if (typeof debounceTimer?.unref === "function")
                debounceTimer.unref();
        },
        dispose() {
            disposed = true;
            if (startupTimer !== undefined)
                clearTimeout(startupTimer);
            if (intervalTimer !== undefined)
                clearInterval(intervalTimer);
            if (debounceTimer !== undefined)
                clearTimeout(debounceTimer);
            startupTimer = undefined;
            intervalTimer = undefined;
            debounceTimer = undefined;
        },
    };
}
