/**
 * 派生「动态选择」：按子 agent 首条任务在工作区默认能力上打分，并在子 agent
 * 创建时应用三域快照（v24）。
 *
 * 两段式时序（与 `docs/architecture/agent-capability-inheritance.md` §5.4 一致，
 * 但基线换成「工作区默认能力」）：
 *
 *   1. 父侧 `tools/pre-execute`（被 await 的 waterfall）：spawn 工具的 `prompt`
 *      就是子 agent 的第一条 user message；在这里枚举工作区能力 → Jev 打分 →
 *      生成派发计划（pending）。
 *   2. 子侧 `agent/created`（serial、被 await、首条 prompt 投递之前）：由
 *      `derive/manager.ts` 消费 pending 并 seed 到 child 会话记录；
 *      `installApply()` 注册的**晚期**监听器（在 skills / mcp / tools 之后）再
 *      调三域的 `setSessionEnabled*` 并 await 收敛，保证首轮即按选择生效。
 *
 * 失败一律 fail-open：不阻塞 spawn / 子 agent 创建；空集、Jev 不可用、超时由
 * `derive/manager.ts` 回退「派生继承会话」。委派任务文本只发给 Jev，不落盘。
 *
 * @module dsh-capability-settings/derive/auto-select
 */
import type { JevCapabilityService } from "../jev/apply.js";
import type { JevCapability } from "../jev/types.js";
import type { DerivedDynamicInfo, SessionStateStore } from "../session-state.js";
/** 支持「动态选择」的创建工具；其它派生方式按回退处理。 */
export declare const DYNAMIC_SPAWN_TOOLS: ReadonlySet<string>;
/** 默认相关度阈值（与 `jev.json.decisionThreshold` 兜底一致）。 */
export declare const DEFAULT_DYNAMIC_THRESHOLD = 0.5;
/** 单次打分超时上限（spawn 同步等待；用户已接受首轮变慢，但不能无限等）。 */
export declare const DYNAMIC_RANK_TIMEOUT_CAP_MS = 8000;
/** 派生日志（缺省静默）。 */
export interface DynamicSelectLogger {
    warn?(message: string): void;
    info?(message: string): void;
}
/** 一条动态选择计划（host 内部；不跨 RPC）。 */
export interface DynamicPlan {
    parentSessionId: string;
    /** spawn 参数里的短描述 / name（用于与 child descriptor label 对齐）。 */
    label?: string;
    /** 子 agent 的工作目录（工作区基线）。 */
    cwd?: string;
    status: "ok" | "fallback";
    /** fallback 原因码：no-config / no-key / timeout / error / empty / unavailable。 */
    reason?: string;
    threshold: number;
    /** 达到阈值的已启用量。 */
    selected: number;
    /** 参与打分的候选总数。 */
    total: number;
    /** 三域各自选中数。 */
    counts: {
        skills: number;
        mcp: number;
        tools: number;
    };
    /** seedDerived 用的三域显式开关（仅 `status === "ok"` 有内容）。 */
    toggles: {
        skills: Record<string, boolean>;
        mcp: Record<string, boolean>;
        tools: Record<string, boolean>;
    };
    /** 晚期 apply 用：skills 批量条目。 */
    skillEntries: Array<{
        name: string;
        enabled: boolean;
    }>;
    /** 晚期 apply 用：MCP 批量条目。 */
    mcpEntries: Array<{
        target: string;
        kind: "project" | "server";
        enabled: boolean;
    }>;
    /** 晚期 apply 用：Tools 插件单元（选中 / 未选中分开写，API 一次只接受一个 enabled）。 */
    toolUnits: {
        enabled: string[];
        disabled: string[];
    };
    at: number;
}
/** 派发计划存储 / 消费接口（组合根注入给 derive/manager）。 */
export interface DynamicSelectHost {
    /** 由 derive/manager 在 `agent/created` 早期消费（按 parent + label/FIFO）。 */
    consume(agent: any, parentId: string): DynamicPlan | undefined;
    /** 早期 seed 成功后登记，供晚期 apply 监听使用。 */
    arm(childSessionId: string, plan: DynamicPlan): void;
}
/** 动态选择模块。 */
export interface DeriveAutoSelect extends DynamicSelectHost {
    /**
     * 注册晚期 `agent/created` 应用监听。
     *
     * 必须在 skills / mcp / tools 的监听器**之后**调用（组合根保证），这样三域
     * 记录已存在、`setSessionEnabled*` 会 await 对应 remount / restrict sweep。
     */
    installApply(): void;
    /** 卸载监听、清空 pending / armed。 */
    dispose(): void;
}
/** 构造参数。 */
export interface DeriveAutoSelectDeps {
    ctx: any;
    state: SessionStateStore;
    dshHome?: string;
    service: () => JevCapabilityService | undefined;
    logger?: DynamicSelectLogger;
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
}
/** 计划 → 派生会话页只读信息。 */
export declare function dynamicInfoOf(plan: DynamicPlan, fallback?: "session" | "workspace"): DerivedDynamicInfo;
/** 由能力集合 + 分数 + 阈值构造计划（纯函数，单测直接调）。 */
export declare function buildDynamicPlan(input: {
    parentSessionId: string;
    label?: string;
    cwd?: string;
    capabilities: readonly JevCapability[];
    scores: ReadonlyMap<string, number>;
    threshold: number;
    at: number;
}): DynamicPlan;
/**
 * 创建「动态选择」模块。
 *
 * 构造时只注册 `tools/pre-execute`；三域监听器之后的 `installApply()` 由组合根
 * 在装配完成后调用（保证应用阶段能 await 三域的 remount / restrict）。
 */
export declare function createDeriveAutoSelect(ctx: any, deps: DeriveAutoSelectDeps): DeriveAutoSelect;
/** 供诊断 / 日志：prompt 摘要（不落盘）。 */
export declare function promptHashOf(prompt: string): string;
