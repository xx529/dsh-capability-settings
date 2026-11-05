/**
 * 注入接管层（P1）：把「本会话选中的 prompt 集合」交给宿主渲染器，并冻结结果。
 *
 * 设计（与用户确认的口径一致）：
 *
 *   - **不自己拼接 / 去重 / 算预算**：调用 `manager.render()` → 宿主导出的
 *     `loadBaselineInstructions`，渲染结果原样使用；
 *   - **只控制传递什么**：宿主注入器先跑（我们注册在 root ctx 的 `prepend`
 *     最外层，`next()` 返回后能看到它处理完的 decision），我们把宿主 baseline
 *     正文替换成「允许集合」的宿主渲染结果；允许集合为空时替换成宿主的
 *     empty-replacement 文本（或整条丢弃）；
 *   - **冻结**：首轮之后丢弃所有 `source.kind = "agent-instructions"` 的消息
 *     并清 `agent.inbox` 里的同类排队；跨 resume / compaction 后仍按冻结清单
 *     重放同一正文；
 *   - **fail-open**：任何异常只 warn，原样放行宿主消息（全量注入），绝不拖垮对话。
 *
 * @module dsh-capability-settings/prompt/inject
 */
import type { PromptManager } from "./manager.js";
/** 注入层依赖。 */
export interface PromptInjectionDeps {
    manager: PromptManager;
    logger?: {
        warn?: (message: string) => void;
    };
}
/**
 * 安装注入接管（root ctx，`prepend` 最外层）。
 *
 * @param ctx 宿主插件 ctx
 * @param deps manager + logger
 * @returns disposer；宿主不支持事件系统时返回 noop
 */
export declare function installPromptInjection(ctx: {
    on?: (name: string, handler: (payload: any, next: () => Promise<any>) => unknown, options?: unknown) => (() => void) | void;
}, deps: PromptInjectionDeps): () => void;
