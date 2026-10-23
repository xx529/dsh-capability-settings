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

import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import { redact } from "./config-file.js";
import { errMessage } from "../shared/errors.js";
import type { JevCapability, JevConfig, JevErrorCode, JevRankItem, JevUsage } from "./types.js";

/** `systemone` 端点路径（拼在 baseURL 后）。 */
export const SYSTEM_ONE_PATH = "/v1/systemone";

/** question 里 `capability.description` 的码点上限。 */
export const DESCRIPTION_LIMIT = 200;

/** question 里 `capability.whenToUse` 的码点上限。 */
export const WHEN_TO_USE_LIMIT = 120;

/** question 里 `capability.name` 的码点上限（防御性补充）。 */
export const NAME_LIMIT = 120;

/** 每题最多带多少个 MCP 工具。 */
export const TOOL_COUNT_LIMIT = 8;

/** 每个工具描述的码点上限。 */
export const TOOL_DESCRIPTION_LIMIT = 100;

/** 每题工具名 + 工具描述的总码点上限。 */
export const TOOLS_TOTAL_LIMIT = 500;

/** 工具名的码点上限（防御性补充）。 */
export const TOOL_NAME_LIMIT = 80;

/**
 * 共享判据：只放 `state.guidance` 一次（英文，控制 token）。
 *
 * 之前所有能力共用同一份 instructions 且题目里不含能力，模型看到 155 道
 * 一模一样的题，只能给出几乎相同的概率（实测 0.40–0.41）。现在判据共享、
 * 题目逐能力唯一。
 */
export const SYSTEM_ONE_GUIDANCE = [
  "You are selecting which capabilities to make available for the user's current request.",
  "For each question below you judge exactly one capability, described inside that question.",
  "Judge by the request's intent and the actions it needs, not by loose topic overlap.",
  "A capability that can directly perform an action the request asks for is highly relevant, even if the request does not name it.",
  "A capability that is only topically related but cannot execute the request is not relevant.",
  "For MCP servers, use the listed tools to judge what the server can actually do.",
  "Answer with a probability from 0 to 1: 1 = definitely useful now, 0 = definitely not.",
].join(" ");

/** 每题 `instructions.task`：判断该能力对当前请求是否直接有用。 */
export const SYSTEM_ONE_TASK =
  "Judge whether this capability is directly useful for the user's request: could using it materially help perform or complete the request now?";

/** 逐能力共用的判定标准（true = 能实质帮助完成/执行请求）。 */
export const SYSTEM_ONE_CRITERIA = {
  true: "Using this capability can materially help perform or complete the request, even if the request does not name it.",
  false: "The capability is unrelated to the request, or cannot help perform or complete it (topical overlap alone is not enough).",
} as const;

/** 重试退避（指数、无抖动，便于测试）。 */
export const RETRY_DELAYS_MS = [500, 1000] as const;

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
  criteria: { true: string; false: string };
}

/** `POST /v1/systemone` 的请求体（state 只放 request + 共享 guidance）。 */
export interface SystemOneRequest {
  model: string;
  state: { request: string; guidance: string };
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

// ---------------------------------------------------------------------------
// 能力 ID / 截断 / 请求构造
// ---------------------------------------------------------------------------

/**
 * 稳定能力 ID：`cap_` + sha256(namespaceKey) 前 36 位小写 hex。
 *
 * 不掺进程/时间/随机；`apply` 依赖同一算法重建映射。
 */
export function capabilityId(namespaceKey: string): string {
  const hex = createHash("sha256").update(namespaceKey, "utf8").digest("hex").slice(0, 36);
  return `cap_${hex}`;
}

/** 按 Unicode 码点截断（不追加省略号，省 token）。 */
export function truncateCodepoints(text: string, limit: number): string {
  const codepoints = Array.from(text);
  return codepoints.length <= limit ? text : codepoints.slice(0, limit).join("");
}

/** baseURL → systemone 绝对 URL。 */
export function systemOneURL(baseURL: string): string {
  return new URL(`${baseURL.replace(/\/+$/, "")}${SYSTEM_ONE_PATH}`).toString();
}

/** 码点长度（tools 的总长预算按码点算）。 */
function codepointLength(text: string): number {
  return Array.from(text).length;
}

/**
 * 构造 question 里的 MCP 工具列表（已截断）。
 *
 * 约束：最多 {@link TOOL_COUNT_LIMIT} 个；每个描述 ≤{@link TOOL_DESCRIPTION_LIMIT}
 * 码点；name + description 总码点 ≤{@link TOOLS_TOTAL_LIMIT}。超预算时按顺序截断
 * （后面的工具直接放弃），保证单题体积可控。
 */
export function buildQuestionTools(
  tools: readonly { name: string; description?: string }[] | undefined,
): SystemOneTool[] | undefined {
  if (tools === undefined || tools.length === 0) return undefined;
  const result: SystemOneTool[] = [];
  let total = 0;
  for (const tool of tools) {
    if (result.length >= TOOL_COUNT_LIMIT) break;
    const name = truncateCodepoints(tool.name, TOOL_NAME_LIMIT).trim();
    if (name.length === 0) continue;
    const rawDescription = typeof tool.description === "string" ? tool.description.trim() : "";
    const description =
      rawDescription.length > 0 ? truncateCodepoints(rawDescription, TOOL_DESCRIPTION_LIMIT) : undefined;
    const cost = codepointLength(name) + (description !== undefined ? codepointLength(description) : 0);
    if (result.length > 0 && total + cost > TOOLS_TOTAL_LIMIT) break;
    result.push(description !== undefined ? { name, description } : { name });
    total += cost;
  }
  return result.length > 0 ? result : undefined;
}

/** 构造一道题的 instructions（内嵌该能力定义，题目因此唯一）。 */
function buildQuestionInstructions(capability: JevCapability): SystemOneInstructions {
  const spec: SystemOneCapability = {
    kind: capability.kind,
    name: truncateCodepoints(capability.name, NAME_LIMIT),
    description: truncateCodepoints(capability.description, DESCRIPTION_LIMIT),
  };
  if (capability.whenToUse !== undefined && capability.whenToUse.trim().length > 0) {
    spec.whenToUse = truncateCodepoints(capability.whenToUse, WHEN_TO_USE_LIMIT);
  }
  const tools = buildQuestionTools(capability.tools);
  if (tools !== undefined) spec.tools = tools;
  return { task: SYSTEM_ONE_TASK, capability: spec };
}

/** 由能力集合与草稿构造一次批量请求。 */
export function buildSystemOneRequest(
  config: Pick<JevConfig, "model">,
  capabilities: readonly JevCapability[],
  draft: string,
): SystemOneRequest {
  const questions: Record<string, SystemOneQuestion> = {};
  for (const capability of capabilities) {
    questions[capability.id] = {
      type: "noul",
      instructions: buildQuestionInstructions(capability),
      criteria: { true: SYSTEM_ONE_CRITERIA.true, false: SYSTEM_ONE_CRITERIA.false },
    };
  }
  // 能力不进 state：state 只放用户请求与共享判据，避免 155 份重复与干扰。
  return { model: config.model, state: { request: draft, guidance: SYSTEM_ONE_GUIDANCE }, questions };
}

/** `jev.test` 的探针能力 id（hash namespace 与真实能力不同，不会冲突）。 */
export function probeCapabilityId(): string {
  return capabilityId("probe:connectivity");
}

/** `jev.test` 的最小成本探针请求。 */
export function buildProbeRequest(config: Pick<JevConfig, "model">): { id: string; request: SystemOneRequest } {
  const id = probeCapabilityId();
  return {
    id,
    request: {
      model: config.model,
      state: { request: "Connectivity check.", guidance: SYSTEM_ONE_GUIDANCE },
      questions: {
        [id]: {
          type: "noul",
          instructions: {
            task: "Is this a connectivity check?",
            capability: { kind: "skill", name: "connectivity-probe", description: "Connectivity probe." },
          },
          criteria: { true: "Yes, this is a connectivity check.", false: "No." },
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 响应解析 / 排序
// ---------------------------------------------------------------------------

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * 取某个能力的 `noul` 概率；容错 number / boolean / `{ value: number }`，
 * 缺失或不可解析返回 null（调用方记 score=0 + reason no-answer）。
 */
export function parseNoul(json: unknown, id: string): number | null {
  const answers = (json as { answers?: Record<string, { noul?: unknown }> } | null | undefined)?.answers;
  if (answers === null || typeof answers !== "object") return null;
  const raw = answers?.[id]?.noul;
  if (typeof raw === "number" && Number.isFinite(raw)) return clamp01(raw);
  if (typeof raw === "boolean") return raw ? 1 : 0;
  if (raw !== null && typeof raw === "object" && typeof (raw as { value?: unknown }).value === "number") {
    const value = (raw as { value: number }).value;
    if (Number.isFinite(value)) return clamp01(value);
  }
  return null;
}

/** 响应里的 model；缺失回退配置值。 */
export function pickModel(json: unknown, fallback: string): string {
  const model = (json as { model?: unknown } | null | undefined)?.model;
  return typeof model === "string" && model.length > 0 ? model : fallback;
}

/** 响应里的 usage；缺失记 0。 */
export function pickUsage(json: unknown): JevUsage {
  const usage = (json as { usage?: Record<string, unknown> } | null | undefined)?.usage;
  const input = Number(usage?.input_tokens ?? usage?.inputTokens ?? 0);
  const output = Number(usage?.output_tokens ?? usage?.outputTokens ?? 0);
  return {
    input_tokens: Number.isFinite(input) ? input : 0,
    output_tokens: Number.isFinite(output) ? output : 0,
  };
}

/** 把能力 + noul 映射成 rank 结果行。 */
export function toRankItem(capability: JevCapability, noul: number | null): JevRankItem {
  const item: JevRankItem = {
    id: capability.id,
    kind: capability.kind,
    name: capability.name,
    description: capability.description,
    score: noul === null ? 0 : noul,
    applicable: capability.applicable,
    enabledInSession: capability.enabledInSession,
  };
  const reason = capability.applicable ? (noul === null ? "no-answer" : undefined) : capability.reason;
  if (reason !== undefined) item.reason = reason;
  return item;
}

/**
 * 严格全序排序（架构 §6.7）：score 降序 → skill 先于 mcp → name → id。
 */
export function compareRankItems(a: JevRankItem, b: JevRankItem): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.kind !== b.kind) return a.kind === "skill" ? -1 : 1;
  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) return byName;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ---------------------------------------------------------------------------
// HTTP 错误
// ---------------------------------------------------------------------------

/** 已映射为业务码的 HTTP/网络错误（message 已脱敏，可直接进 `errors`）。 */
export class JevHttpError extends Error {
  readonly code: JevErrorCode;
  readonly retryable: boolean;

  constructor(code: JevErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = "JevHttpError";
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * HTTP 状态 → 业务错误码 / 是否重试（架构 §6.9 唯一权威表）。
 */
export function mapHttpStatus(status: number, bodyText: string): { code: JevErrorCode; retryable: boolean } {
  const lower = bodyText.toLowerCase();
  const contextTooLong =
    lower.includes("max_tokens_exceeded") || lower.includes("context_length_exceeded") || lower.includes("maximum context");
  if ((status === 400 || status === 422) && contextTooLong) return { code: "context-too-long", retryable: false };
  if (status === 401 || status === 403) return { code: "auth", retryable: false };
  if (status === 429) return { code: "rate-limit", retryable: true };
  if (status === 529) return { code: "overloaded", retryable: true };
  if (status >= 500) return { code: "network", retryable: false };
  return { code: "bad-request", retryable: false };
}

/** 响应体摘要：截 4096 字符 → 脱敏 → 截 300 字符（进 errors）。 */
function responseSummary(text: string, secrets: readonly string[]): string {
  return redact(text.slice(0, 4096), secrets).slice(0, 300);
}

/** 发一次 HTTP 请求（单次尝试超时；错误已映射为 `JevHttpError`）。 */
async function fetchOnce(
  url: string,
  bodyText: string,
  apiKey: string,
  options: SystemOneOptions,
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);
  const onAbort = (): void => controller.abort();
  if (options.signal !== undefined) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    return await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: bodyText,
      signal: controller.signal,
    });
  } catch (error) {
    if (options.signal?.aborted === true || timedOut) {
      throw new JevHttpError("timeout", `[timeout] 请求超时（>${options.timeoutMs}ms）`, false);
    }
    const name = (error as { name?: unknown } | null)?.name;
    if (name === "AbortError" || name === "TimeoutError") {
      throw new JevHttpError("timeout", `[timeout] ${redact(errMessage(error), options.secrets)}`, false);
    }
    throw new JevHttpError("network", `[network] ${redact(errMessage(error), options.secrets)}`, false);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener?.("abort", onAbort);
  }
}

/** 默认 sleep（可注入，测试用假时钟替换）。 */
const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 发出 systemone 请求并按 §6.9 重试：只有 429 / 529 重试，最多 2 次
 * （退避 500ms / 1000ms）；任何 4xx 不重试。
 */
export async function postSystemOne(
  url: string,
  request: SystemOneRequest,
  apiKey: string,
  options: SystemOneOptions,
): Promise<SystemOneResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const secrets = options.secrets;
  const bodyText = JSON.stringify(request);
  let latencyMsFirstAttempt: number | undefined;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    const attemptStarted = performance.now();
    try {
      const response = await fetchOnce(url, bodyText, apiKey, { ...options, fetchImpl });
      if (latencyMsFirstAttempt === undefined) {
        latencyMsFirstAttempt = Math.round(performance.now() - attemptStarted);
      }
      const text = await response.text().catch(() => "");
      if (!response.ok) {
        const mapped = mapHttpStatus(response.status, text);
        const summary = responseSummary(text, secrets);
        const detail = summary.length > 0 ? `HTTP ${response.status}: ${summary}` : `HTTP ${response.status}`;
        throw new JevHttpError(mapped.code, `[${mapped.code}] ${detail}`, mapped.retryable);
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new JevHttpError(
          "bad-request",
          `[bad-request] HTTP ${response.status}: 响应不是合法 JSON${text.trim().length > 0 ? `: ${responseSummary(text, secrets)}` : ""}`,
          false,
        );
      }
      if (json === null || typeof json !== "object" || Array.isArray(json)) {
        throw new JevHttpError("bad-request", "[bad-request] 响应顶层不是对象", false);
      }
      return {
        json: json as Record<string, unknown>,
        latencyMsFirstAttempt: latencyMsFirstAttempt ?? 0,
        requestCount: attempt + 1,
      };
    } catch (error) {
      const mapped =
        error instanceof JevHttpError
          ? error
          : new JevHttpError("network", `[network] ${redact(errMessage(error), secrets)}`, false);
      if (!mapped.retryable || attempt >= RETRY_DELAYS_MS.length) throw mapped;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  // 理论不可达（循环内要么 return 要么 throw）；保留兜底以免类型收窄报错。
  throw new JevHttpError("network", "[network] request failed", false);
}
