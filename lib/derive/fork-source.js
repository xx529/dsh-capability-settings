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
import { AsyncLocalStorage } from "node:async_hooks";
/** cordis 的原始服务实例符号（`Symbol.for`，跨模块实例一致）。 */
const CORDIS_ORIGINAL = Symbol.for("cordis.original");
/**
 * 安装会话分叉拦截。
 *
 * @param ctx 插件根 ctx
 * @param logger 结构化 logger（缺省静默）
 * @returns 跟踪器（dispose 还原包装）
 */
export function createForkSourceTracker(ctx, logger) {
    const als = new AsyncLocalStorage();
    let disposed = false;
    const restores = [];
    let stopInject;
    /** 给宿主 sessionController.fork 套一层上下文；返回还原函数。 */
    function wrap(service) {
        if (disposed || service === null || typeof service !== "object")
            return undefined;
        const raw = service[CORDIS_ORIGINAL] ?? service;
        if (raw === null || typeof raw !== "object" || typeof raw.fork !== "function")
            return undefined;
        const original = raw.fork;
        const wrapper = function (...args) {
            const request = args[0];
            const parent = typeof request?.sessionId === "string" && request.sessionId.length > 0 ? request.sessionId : undefined;
            if (parent === undefined)
                return original.apply(this, args);
            return als.run({ parent }, () => original.apply(this, args));
        };
        try {
            raw.fork = wrapper;
        }
        catch (error) {
            logger?.warn?.(`capability-panel: 会话分叉拦截安装失败（${String(error)}）`);
            return undefined;
        }
        return () => {
            try {
                if (raw.fork === wrapper)
                    delete raw.fork;
            }
            catch {
                /* 还原失败不影响运行 */
            }
        };
    }
    /** 服务可用后安装包装（ctx.inject 回调）。 */
    function install(hostCtx) {
        if (disposed)
            return;
        const restore = wrap(hostCtx?.sessionController);
        if (restore === undefined)
            return;
        if (typeof hostCtx?.effect === "function") {
            const off = hostCtx.effect(() => restore, "capability-panel: 会话分叉来源跟踪");
            if (typeof off === "function")
                restores.push(off);
            else
                restores.push(restore);
        }
        else {
            restores.push(restore);
        }
    }
    if (typeof ctx?.inject === "function") {
        // sessionController 由 dsh-api-session-controller 提供；等它可用再包装。
        const fiber = ctx.inject(["sessionController"], install);
        if (typeof fiber === "function")
            stopInject = fiber;
        else if (fiber !== undefined && typeof fiber.dispose === "function")
            stopInject = () => void fiber.dispose();
    }
    else {
        // 无 ctx.inject 的测试 / 精简环境：直接取（服务缺失就放弃）。
        const restore = wrap(ctx?.get?.("sessionController"));
        if (restore !== undefined)
            restores.push(restore);
    }
    return {
        parent() {
            return als.getStore()?.parent;
        },
        dispose() {
            if (disposed)
                return;
            disposed = true;
            if (stopInject !== undefined)
                stopInject();
            for (const restore of restores.splice(0))
                restore();
        },
    };
}
