/**
 * 派生继承（spawn-time snapshot）：在子 agent 创建时按父会话的「派生继承模式」
 * 决定复制哪些会话级能力开关。
 *
 * 语义（v24）：
 *
 *   - 主对话的 `deriveMode` 有三个值：
 *     `session`（默认）= 复制当前会话的显式覆盖（Skills / MCP / Tools）；
 *     `workspace` = 不复制，子 agent 使用工作区 / 项目默认；
 *     `dynamic` = 按子 agent 首条任务在工作区默认能力上打分，只启用达到阈值的
 *     能力；空集 / Jev 不可用 / 超时回退 `session`（跨项目根时回退 `workspace`）；
 *   - **只在 `agent/created` 且 `source === "startup"`（新创建）时生效**；
 *     `source === "resume"` 一律跳过——子会话记录里已有创建时快照；
 *   - 只影响之后创建的 child，已存在的 child 不回溯；
 *   - 复制的是父会话的**显式覆盖**（不是项目 / 全局默认）；
 *   - **会话分叉**（对话「分叉 / branch」，宿主不写 `parentSession`、只有
 *     `isSeeded`）也走同一个快照计算，但不再看派生模式：总是复制源会话的
 *     会话级覆盖（同一段对话的延续），且不写 `derived*` 元数据——分叉会话仍是
 *     普通会话（派生下拉 / 派生页只服务 subagent / teammate）。源会话 id 由
 *     `derive/fork-source.ts` 在宿主 fork 调用期间提供。
 *
 * 时序：本模块必须在 skills / mcp / tools 的 `agent/created` 监听器之前创建，
 * 这样监听器（被 cordis serial await）先把快照写进 child 的会话记录，三个域
 * 后续 hydrate 时就能读到同一份快照，无需 owner 投影或热传播。动态选择的
 * 打分在父侧 `tools/pre-execute` 完成（见 `derive/auto-select.ts`），这里只消费
 * 结果并 seed；三域的最终收敛由 auto-select 的晚期监听器 await。
 *
 * @module dsh-capability-settings/derive/manager
 */
import type { DynamicSelectHost } from "./auto-select.js";
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
    /**
     * 惰性取 skills 会话注册表：组合根里 derive 模块先于 skills 创建（监听器顺序），
     * 因此用 getter，事件发生时再取。
     */
    getSkillSessions?: () => {
        trackAgent(agent: any): void;
        setEnabledBatch(input: {
            sessionId: string;
            entries: ReadonlyArray<{
                name: string;
                enabled: boolean;
            }>;
        }): Promise<{
            ok: boolean;
            errors: string[];
        }>;
    } | undefined;
    /**
     * v24 动态选择：惰性访问器（组合根在 skills / mcp / tools 之后才构造完整模块，
     * 但 `agent/created` 事件发生在插件装配完成之后）。
     */
    dynamic?: () => DynamicSelectHost | undefined;
    /**
     * 会话分叉来源：`agent/created` 执行期间（宿主 fork 调用内部）返回被分叉的
     * 源会话 id；不在 fork 流程里返回 undefined（见 `derive/fork-source.ts`）。
     */
    forkSource?: () => string | undefined;
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
/**
 * 修复 v24 动态选择回退快照的技能投影缺口（一次性对账，幂等）。
 *
 * 背景：失败回退时按「父级可见 ∩ child 可见」投影；父级显式关闭但不在 child
 * 当时可见集合里的名字（典型：`disable-model-invocation: true` 的 user-only
 * 技能，或 agent/created 时 child 技能目录尚未就绪）会漏掉，child 落回工作区
 * 默认（开启），出现「父 0 / 子 3」。这里只补 **动态回退** 记录：父级显式
 * `false` 且 child 记录里缺失的名字 → 写 `false`。已在 `sessionTogglesFor`
 * 修复新 child；本函数负责修复已存在的回退快照。
 *
 * 只处理 `derivedMode === "dynamic" && derivedDynamic.status === "fallback"`，
 * 不动 `session` / `workspace` / 动态成功（成功是按工作区选的，不沿用父级）。
 */
export declare function repairDynamicFallbackSkillProjection(state: SessionStateStore, logger?: DeriveInheritanceLogger): Promise<number>;
