/**
 * `jev.rank` 的请求构造、响应解析、排序与 HTTP 错误映射（架构 §6）。
 *
 * 设计要点：
 *
 *   - **三维判据**：每个能力最多 3 条 `noul` question（`~role` / `~task` /
 *     `~operation`），每题只判一层，能力得分取三维 **max**——角色职责、当前
 *     任务、当前操作指令任一需要即算相关（宁可冗余、不收窄）；
 *   - **按体积分片**：单请求超过 {@link REQUEST_SOFT_LIMIT_CHARS} 时按能力
 *     二分拆成多片（{@link buildSystemOneRequests}），每片仍走原来的 4 档
 *     降级；对外仍是一次 `jev.rank`；
 *   - `state = { request, guidance }`（**能力不再进 state**）；`instructions`
 *     是**结构化对象**并内嵌该能力定义（kind/name/description/whenToUse/tools），
 *     保证每题唯一、模型能看到「这一题在问哪个能力」；共享判据只放
 *     `state.guidance` 一次，控制 token；
 *   - 错误映射见 {@link mapHttpStatus}：只有 429 / 529 重试（退避 500ms → 1000ms，
 *     最多 2 次），任何 4xx 不重试；
 *   - 所有错误文本在这里就完成脱敏，绝不把请求头/完整 URL 带进错误信息。
 *
 * @module dsh-capability-settings/jev/rank
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
/** 每题最多带多少个**带描述的** MCP/工具清单项。 */
export declare const TOOL_COUNT_LIMIT = 8;
/** 额外携带的**仅名称**工具数（`moreTools`；覆盖大插件/大 server 的工具面）。 */
export declare const TOOL_EXTRA_NAMES_LIMIT = 24;
/** 每个工具描述的码点上限。 */
export declare const TOOL_DESCRIPTION_LIMIT = 120;
/** 每题 `tools` 里工具名 + 工具描述的总码点上限。 */
export declare const TOOLS_TOTAL_LIMIT = 500;
/** 每题 `moreTools`（仅名称）的总码点上限。 */
export declare const TOOL_EXTRA_NAMES_TOTAL_LIMIT = 600;
/** 工具名的码点上限（防御性补充）。 */
export declare const TOOL_NAME_LIMIT = 80;
/**
 * 请求体软上限（字符数）：超过则按降级档位重建请求（先丢 moreTools、
 * 再丢工具描述、最后丢工具清单），避免能力数增长后撞 64k 上下文。
 *
 * 现状 152 条能力约 108 KB；150 KB 留出约 40% 余量，正常规模不会触发。
 */
export declare const REQUEST_SOFT_LIMIT_CHARS = 150000;
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
/**
 * 判据维度：同一能力最多三道题，各判一层，取 max。
 *
 * - `role`：角色定义的长期职责是否需要它（适合 spawn / 首屏角色预置）；
 * - `task`：当前任务是否需要它；
 * - `operation`：当前操作指令（含待命、禁止）是否要求它的动作。
 *
 * **不做 veto**：显式禁止不在这里扣分，需要时由调用方在应用层处理（v24 决策）。
 */
export type RankDimension = "role" | "task" | "operation";
/** 三维顺序（稳定，决定 questions 里题目的出现顺序）。 */
export declare const RANK_DIMENSIONS: readonly RankDimension[];
/** 维度题面的 `instructions.task`（每题只问一层）。 */
export declare const RANK_DIMENSION_TASKS: Record<RankDimension, string>;
/** 维度题面的 `criteria`（true/false 与题面同义）。 */
export declare const RANK_DIMENSION_CRITERIA: Record<RankDimension, {
    true: string;
    false: string;
}>;
/** 某能力某维度的 question id：`cap_<hex>~<dimension>`。 */
export declare function rankQuestionId(capabilityId: string, dimension: RankDimension): string;
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
    kind: "skill" | "mcp" | "tool";
    name: string;
    description: string;
    whenToUse?: string;
    /** MCP / Tools：工具名 + 简述（≤{@link TOOL_COUNT_LIMIT} 个，带预算截断）。 */
    tools?: SystemOneTool[];
    /**
     * MCP / Tools：超出 `tools` 名额的**仅名称**工具（≤{@link TOOL_EXTRA_NAMES_LIMIT}）。
     *
     * 大插件（本机 `dsh-remote` 22 个工具）/ 大 server（playwright 等）只靠 8 条
     * 带描述的清单会丢一半以上工具；名称本身就是很强的语义证据，单独放一个
     * 数组比给每条都加 `{name}` 对象更省 token。
     */
    moreTools?: string[];
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
 * 构造 question 里的 MCP/插件工具列表（已截断；兼容旧调用）。
 *
 * 只返回带描述的 `tools`；额外仅名称工具见 {@link buildQuestionMoreTools}。
 */
export declare function buildQuestionTools(tools: readonly {
    name: string;
    description?: string;
}[] | undefined): SystemOneTool[] | undefined;
/** 构造 `moreTools`（超出 `tools` 名额的仅名称工具；旧调用不涉及）。 */
export declare function buildQuestionMoreTools(tools: readonly {
    name: string;
    description?: string;
}[] | undefined, extraLimit?: number): string[] | undefined;
/**
 * 由能力集合与草稿构造**单个**请求（不分片）。
 *
 * **全局预算**：超过 {@link REQUEST_SOFT_LIMIT_CHARS} 时按 4 档降级
 * （24 名额 → 8 名额 → 只留带描述的 8 条 → 只留 8 个名称 → 完全不带工具），
 * 优先保住「每条能力仍有描述」，而不是让整个请求撞上下文上限。
 *
 * `jev.rank` 实际使用 {@link buildSystemOneRequests}（先分片、再降级）；
 * 本函数保留给探针 / 测试 / 单请求调用方。
 *
 * @param options.maxChars 覆盖软上限（测试/诊断用）。
 */
export declare function buildSystemOneRequest(config: Pick<JevConfig, "model">, capabilities: readonly JevCapability[], draft: string, options?: {
    maxChars?: number;
}): SystemOneRequest;
/** 分片结果（一次 `jev.rank` 内部的全部请求）。 */
export interface SystemOneRequestPlan {
    /** 按能力原顺序的分片请求；无需分片时长度为 1。 */
    requests: SystemOneRequest[];
    /** 片数（= `requests.length`）。 */
    batches: number;
}
/**
 * 构造一次 `jev.rank` 需要的全部请求：**先按体积分片、再对单片降级**。
 *
 * 三维判据让单请求体积约为原来的 2.3×；152 条能力（约 108 KB/单维）会超过
 * {@link REQUEST_SOFT_LIMIT_CHARS}。这里按能力二分（保持原顺序），每片分别
 * 走 {@link buildSystemOneRequest} 的 4 档降级，直到每片 ≤ 软上限；这样不会
 * 为了压体积而丢掉工具清单（工具是 MCP 判断的主信号）。
 *
 * 单片能力数极少时（1 条）仍可能超过自定义的极小 `maxChars`（测试场景），
 * 此时返回降级后的最后一份，由调用方决定是否接受。
 */
export declare function buildSystemOneRequests(config: Pick<JevConfig, "model">, capabilities: readonly JevCapability[], draft: string, options?: {
    maxChars?: number;
}): SystemOneRequestPlan;
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
/**
 * 解析某能力的三维分数（`~role` / `~task` / `~operation`）。
 *
 * 缺失 / 不可解析的维度为 `null`（不参与 max）；整题缺失不影响其它维度。
 */
export declare function parseDimensionScores(json: unknown, capabilityId: string): Record<RankDimension, number | null>;
/**
 * 能力最终得分：三维 **max**（任何一层高分即取该值）；三维全缺失 → null
 * （调用方记 score=0 + reason `no-answer`）。
 */
export declare function parseRankScore(json: unknown, capabilityId: string): number | null;
/** 响应里的 model；缺失回退配置值。 */
export declare function pickModel(json: unknown, fallback: string): string;
/** 响应里的 usage；缺失记 0。 */
export declare function pickUsage(json: unknown): JevUsage;
/** 把能力 + noul 映射成 rank 结果行。 */
export declare function toRankItem(capability: JevCapability, noul: number | null): JevRankItem;
/**
 * 严格全序排序（架构 §6.7）：score 降序 → skill → mcp → tool → name → id。
 *
 * 三档全序保证"同分排序稳定"仍成立（v13 新增 Tools 单元后不能再用二分）。
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
