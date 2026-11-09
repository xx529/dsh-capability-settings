/**
 * 会话分叉（对话「分叉 / branch」）的来源会话跟踪。
 *
 * 宿主 `dsh-api-session-controller` 的 `fork` **不写 `parentSession`**（设计如此：
 * 普通 fork 是独立会话，`buildForkSeed` 只复制事件前缀 + `isSeeded`），因此
 * 插件无法从 child header 知道源会话 id。这里在宿主 fork 方法外层套一层
 * `AsyncLocalStorage`：fork 执行期间（含其内部 `agents.create` 派发的
 * `agent/created`）都能读到源会话 id，`derive/manager` 据此把源会话的会话级
 * 能力快照复制给分叉会话。
 *
 * 实现注意：
 *   - 宿主 Service 通过 cordis 暴露时是 **traceable Proxy**，在 Proxy 上赋值不会
 *     落到服务实例；用 `Symbol.for("cordis.original")` 取回原始实例再替换方法。
 *   - 只替换实例方法（原型链不动），dispose 时若仍是本插件的包装则删除自有属性
 *     还原；任何一步失败都 fail-open（分叉照常创建，只是不继承）。
 *
 * @module dsh-capability-settings/derive/fork-source
 */
/** 结构化 logger 子集（缺省静默）。 */
export interface ForkSourceLogger {
    warn?(message: string): void;
    info?(message: string): void;
}
/** 会话分叉来源跟踪器。 */
export interface ForkSourceTracker {
    /**
     * 当前异步上下文正在分叉的源会话 id（不在 fork 流程里返回 undefined）。
     * 在 `agent/created` 监听器里调用可拿到本次 fork 的来源。
     */
    parent(): string | undefined;
    dispose(): void;
}
/**
 * 安装会话分叉拦截。
 *
 * @param ctx 插件根 ctx
 * @param logger 结构化 logger（缺省静默）
 * @returns 跟踪器（dispose 还原包装）
 */
export declare function createForkSourceTracker(ctx: any, logger?: ForkSourceLogger): ForkSourceTracker;
