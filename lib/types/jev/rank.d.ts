/**
 * `jev.rank` 的请求构造、响应解析、排序与 HTTP 错误映射（架构 §6）。
 *
 * 设计要点：
 *
 *   - **一次 POST** `{baseURL}/v1/systemone`，state + questions 一次带全；
 *     不分片、不发 long-context / 实验性 header；
 *   - `state = { request, guidance }`（**能力不再进 state**）；每个能力一条
 *     `noul` question，`instructions` 是**结构化对象**并内嵌该能力定义
 *     （kind/name/description/whenToUse/tools），保证每题唯一、模型能看到
 *     「这一题在问哪个能力」；共享判据只放 `state.guidance` 一次，控制 token；
 *   - 错误映射见 {@link mapHttpStatus}：只有 429 / 529 重试（退避 500ms → 1000ms，
 *     最多 2 次），任何 4xx 不重试；
 *   - 所有错误文本在这里就完成脱敏，绝不把请求头/完整 URL 带进错误信息。
 *
 * @module @chengdb/capability-panel/jev/rank
 */
import type { JevCapability, JevConfig, JevErrorCode, JevRankItem, JevUsage } from "./types.js";
/** `systemone` 端点路径（拼在 baseURL 后）。 */
export declare const SYSTEM_ONE_PATH = "/v1/systemone";
/** question 里 `capability.description` 的码点上限。 */
export declare const DESCRIPTION_LIMIT = 200;
/** question 里 `capability.whenToUse` 的码点上限。 */
export declare const WHEN_TO_USE_LIMIT = 120;
/** question 里 `capability.name` 的码点上限（防御性补充）。 */
export declare const NAME_LIMIT = 120;
/** 每题最多带多少个 MCP 工具。 */
export declare const TOOL_COUNT_LIMIT = 8;
/** 每个工具描述的码点上限。 */
export declare const TOOL_DESCRIPTION_LIMIT = 100;
/** 每题工具名 + 工具描述的总码点上限。 */
export declare const TOOLS_TOTAL_LIMIT = 500;
/** 工具名的码点上限（防御性补充）。 */
export declare const TOOL_NAME_LIMIT = 80;
/**
 * 共享判据：只放 `state.guidance` 一次（英文，控制 token）。
 *
 * 之前所有能力共用同一份 instructions 且题目里不含能力，模型看到 155 道
 * 一模一样的题，只能给出几乎相同的概率（实测 0.40–0.41）。现在判据共享、
 * 题目逐能力唯一。
 */
export declare const SYSTEM_ONE_GUIDANCE: string;
/** 每题 `instructions.task`：判断该能力对当前请求是否直接有用。 */
export declare const SYSTEM_ONE_TASK = "Judge whether this capability is directly useful for the user's request: could using it materially help perform or complete the request now?";
/** 逐能力共用的判定标准（true = 能实质帮助完成/执行请求）。 */
export declare const SYSTEM_ONE_CRITERIA: {
    readonly true: "Using this capability can materially help perform or complete the request, even if the request does not name it.";
    readonly false: "The capability is unrelated to the request, or cannot help perform or complete it (topical overlap alone is not enough).";
};
/** 重试退避（指数、无抖动，便于测试）。 */
export declare const RETRY_DELAYS_MS: readonly [500, 1000];
/** question 里的一条 MCP 工具（已截断）。 */
export interface SystemOneTool {
    name: string;
    description?: string;
}
/**
 * question 里描述的能力定义（**不再放 state**；每题内嵌一份，保证题目唯一）。
 */
export interface SystemOneCapability {
    kind: "skill" | "mcp";
    name: string;
    description: string;
    whenToUse?: string;
    /** 仅 MCP：工具名 + 简述；技能不带。 */
    tools?: SystemOneTool[];
}
/** 逐能力的结构化 instructions（题目唯一性靠这里的 `capability`）。 */
export interface SystemOneInstructions {
    task: string;
    capability: SystemOneCapability;
    /** 可选：逐题补充规则（当前放在 `state.guidance`，这里按需保留）。 */
    rules?: string[];
}
/** 一条 noul question。 */
export interface SystemOneQuestion {
    type: "noul";
    instructions: SystemOneInstructions;
    criteria: {
        true: string;
        false: string;
    };
}
/** `POST /v1/systemone` 的请求体（state 只放 request + 共享 guidance）。 */
export interface SystemOneRequest {
    model: string;
    state: {
        request: string;
        guidance: string;
    };
    questions: Record<string, SystemOneQuestion>;
}
/** 解析后的一次 systemone 响应。 */
export interface SystemOneResponse {
    json: Record<string, unknown>;
    /** 首次尝试（不含重试等待）的耗时。 */
    latencyMsFirstAttempt: number;
    /** 物理 HTTP 次数（正常 1，重试后 2–3）。 */
    requestCount: number;
}
/** 可注入的 HTTP 依赖（测试用；生产走全局 fetch / setTimeout）。 */
export interface SystemOneOptions {
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    /** 单次尝试超时（毫秒）。 */
    timeoutMs: number;
    /** 客户端取消信号。 */
    signal?: AbortSignal;
    /** 错误文本脱敏用的明文集合。 */
    secrets: readonly string[];
}
/**
 * 稳定能力 ID：`cap_` + sha256(namespaceKey) 前 36 位小写 hex。
 *
 * 不掺进程/时间/随机；`apply` 依赖同一算法重建映射。
 */
export declare function capabilityId(namespaceKey: string): string;
/** 按 Unicode 码点截断（不追加省略号，省 token）。 */
export declare function truncateCodepoints(text: string, limit: number): string;
/** baseURL → systemone 绝对 URL。 */
export declare function systemOneURL(baseURL: string): string;
/**
 * 构造 question 里的 MCP 工具列表（已截断）。
 *
 * 约束：最多 {@link TOOL_COUNT_LIMIT} 个；每个描述 ≤{@link TOOL_DESCRIPTION_LIMIT}
 * 码点；name + description 总码点 ≤{@link TOOLS_TOTAL_LIMIT}。超预算时按顺序截断
 * （后面的工具直接放弃），保证单题体积可控。
 */
export declare function buildQuestionTools(tools: readonly {
    name: string;
    description?: string;
}[] | undefined): SystemOneTool[] | undefined;
/** 由能力集合与草稿构造一次批量请求。 */
export declare function buildSystemOneRequest(config: Pick<JevConfig, "model">, capabilities: readonly JevCapability[], draft: string): SystemOneRequest;
/** `jev.test` 的探针能力 id（hash namespace 与真实能力不同，不会冲突）。 */
export declare function probeCapabilityId(): string;
/** `jev.test` 的最小成本探针请求。 */
export declare function buildProbeRequest(config: Pick<JevConfig, "model">): {
    id: string;
    request: SystemOneRequest;
};
/**
 * 取某个能力的 `noul` 概率；容错 number / boolean / `{ value: number }`，
 * 缺失或不可解析返回 null（调用方记 score=0 + reason no-answer）。
 */
export declare function parseNoul(json: unknown, id: string): number | null;
/** 响应里的 model；缺失回退配置值。 */
export declare function pickModel(json: unknown, fallback: string): string;
/** 响应里的 usage；缺失记 0。 */
export declare function pickUsage(json: unknown): JevUsage;
/** 把能力 + noul 映射成 rank 结果行。 */
export declare function toRankItem(capability: JevCapability, noul: number | null): JevRankItem;
/**
 * 严格全序排序（架构 §6.7）：score 降序 → skill 先于 mcp → name → id。
 */
export declare function compareRankItems(a: JevRankItem, b: JevRankItem): number;
/** 已映射为业务码的 HTTP/网络错误（message 已脱敏，可直接进 `errors`）。 */
export declare class JevHttpError extends Error {
    readonly code: JevErrorCode;
    readonly retryable: boolean;
    constructor(code: JevErrorCode, message: string, retryable: boolean);
}
/**
 * HTTP 状态 → 业务错误码 / 是否重试（架构 §6.9 唯一权威表）。
 */
export declare function mapHttpStatus(status: number, bodyText: string): {
    code: JevErrorCode;
    retryable: boolean;
};
/**
 * 发出 systemone 请求并按 §6.9 重试：只有 429 / 529 重试，最多 2 次
 * （退避 500ms / 1000ms）；任何 4xx 不重试。
 */
export declare function postSystemOne(url: string, request: SystemOneRequest, apiKey: string, options: SystemOneOptions): Promise<SystemOneResponse>;
