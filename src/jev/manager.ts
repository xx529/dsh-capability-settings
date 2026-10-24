/**
 * Jev 管理器：RPC 五个端点的实现装配。
 *
 * 职责：
 *
 *   - `getConfig` / `setConfig`：配置读写（委托 `config-file.ts`），只回掩码视图；
 *   - `test`：最小成本探针（1 条能力 + 1 条 noul），验证地址/密钥/模型/可解析性；
 *   - `rank`：枚举能力 → 一次 `POST /v1/systemone` → 解析/排序 → 返回结果；
 *   - `apply`：委托 `apply.ts` 的事务与冷会话排队；
 *   - 生命周期：内部持有 `agent/created` / `agent/disposed` 监听与两张内存表，
 *     `dispose()` 统一卸载（见架构 §8.7）。
 *
 * 所有网络请求都在宿主进程发出（客户端拿不到 key，也读不到 env）。
 *
 * @module dsh-capability-settings/jev/manager
 */

import { performance } from "node:perf_hooks";

import { errMessage } from "../shared/errors.js";
import { createJevApplyEngine } from "./apply.js";
import type { JevApplyEngine, JevCapabilityService } from "./apply.js";
import type { JevLogger } from "./types.js";
import {
  collectJevSecrets,
  mergeJevConfigInput,
  readJevConfig,
  redact,
  resolveJevKey,
  setJevConfig,
  toJevConfigView,
  validateJevConfig,
} from "./config-file.js";
import {
  buildProbeRequest,
  buildSystemOneRequest,
  compareRankItems,
  JevHttpError,
  parseNoul,
  pickModel,
  pickUsage,
  postSystemOne,
  systemOneURL,
  toRankItem,
} from "./rank.js";
import type { JevCapability, JevConfig, JevErrorCode, JevHostContext, JevRankResult, JevTestResult } from "./types.js";

/** 管理器构造参数。 */
export interface JevManagerDeps {
  ctx: JevHostContext;
  /** dsh home 覆盖（缺省由 `resolveDshHome` 解析）。 */
  dshHome?: string;
  /** 延迟求值的服务访问器（避免与 `capabilityPanel` 服务构造顺序耦合）。 */
  service: () => JevCapabilityService | undefined;
  logger?: JevLogger;
  /** 可注入的 fetch（测试用；默认全局 fetch）。 */
  fetchImpl?: typeof fetch;
  /** 可注入的 sleep（测试用；默认 setTimeout）。 */
  sleep?: (ms: number) => Promise<void>;
  /** 可注入的时钟（测试用；默认 Date.now）。 */
  now?: () => number;
}

/** 对 RPC 暴露的 Jev 服务形状（`PanelRpcService.jev`）。 */
export interface JevManager {
  getConfig(): Promise<unknown>;
  setConfig(input: unknown): Promise<unknown>;
  /**
   * 连通性探针（additive：payload 可为 `{config?: JevConfigInput}`）。
   *
   * 带 `config` 时用「已保存配置 + 本次表单值」的临时配置测试（不落盘）；
   * 缺省 / 空对象时沿用已保存配置（旧行为）。
   */
  test(input?: unknown, signal?: AbortSignal): Promise<unknown>;
  rank(input: unknown, signal?: AbortSignal): Promise<unknown>;
  apply(input: unknown): Promise<unknown>;
  /** 卸载：移除生命周期监听、清空内存队列（由组合根并入 disposers）。 */
  dispose(): void;
}

/** 把任意异常收敛成 rank/test 的业务失败支。 */
function failureOf(error: unknown, secrets: readonly string[]): { ok: false; code: JevErrorCode; errors: string[] } {
  if (error instanceof JevHttpError) return { ok: false, code: error.code, errors: [error.message] };
  return { ok: false, code: "network", errors: [redact(errMessage(error), secrets)] };
}

/** `rank` 入参解析（预览校验：不发请求的情况见架构 §6.1）。 */
type RankInputParse =
  | { ok: true; value: { cwd?: string; sessionId: string; draft: string } }
  | { ok: false; errors: string[] };

function parseRankInput(input: unknown): RankInputParse {
  const payload =
    input !== null && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
  if (sessionId.length === 0) return { ok: false, errors: ["sessionId is required"] };
  const cwd = typeof payload.cwd === "string" && payload.cwd.length > 0 ? payload.cwd : undefined;
  if (typeof payload.draft !== "string" || payload.draft.trim().length === 0) {
    return { ok: false, errors: ["draft is empty"] };
  }
  const draft = payload.draft.trim();
  if (Array.from(draft).length > 8000) return { ok: false, errors: ["draft exceeds 8000 characters"] };
  return { ok: true, value: { cwd, sessionId, draft } };
}

/** 评分集合的防御上限（架构 §6.1）。 */
const MAX_RANK_CAPABILITIES = 300;

/**
 * 创建 Jev 管理器（宿主生命周期内单例）。
 */
export function createJevManager(deps: JevManagerDeps): JevManager {
  const logger = deps.logger;
  const dshHome = deps.dshHome;
  const engine: JevApplyEngine = createJevApplyEngine({
    ctx: deps.ctx,
    service: deps.service,
    logger,
    ...(deps.sleep !== undefined ? { sleep: deps.sleep } : {}),
    ...(deps.now !== undefined ? { now: deps.now } : {}),
  });

  /** 读取配置 + 解析密钥 + 计算脱敏明文集合（每次请求都重新读，不缓存）。 */
  async function loadContext(): Promise<{
    config: JevConfig;
    key: ReturnType<typeof resolveJevKey>;
    secrets: string[];
  }> {
    const config = await readJevConfig(dshHome, logger);
    return { config, key: resolveJevKey(config, process.env), secrets: collectJevSecrets(config, process.env) };
  }

  async function getConfig(): Promise<unknown> {
    const config = await readJevConfig(dshHome, logger);
    return toJevConfigView(config, process.env);
  }

  async function setConfig(input: unknown): Promise<unknown> {
    return setJevConfig(dshHome, input, logger);
  }

  /**
   * 解析 `jev.test` 的本次表单配置（additive，task-19 / AC-CFG-11）。
   *
   * payload 形如 `{config?: JevConfigInput}`：有 `config` 时在「已保存配置」上
   * 按 setConfig 同一套合并/校验规则得到**仅本次探针使用的临时配置**（不落盘、
   * 不缓存）；缺省时返回已保存配置（旧行为）。校验失败返回 bad-request
   * （`errors` 与 setConfig 的字段级错误逐字一致，仅错误码按 JevErrorCode 收窄）。
   */
  async function resolveTestConfig(
    input: unknown,
  ): Promise<{ ok: true; config: JevConfig } | { ok: false; result: JevTestResult }> {
    const saved = await readJevConfig(dshHome, logger);
    const payload =
      input !== null && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
    if (!Object.hasOwn(payload, "config") || payload.config === undefined) {
      return { ok: true, config: saved };
    }
    const rawConfig = payload.config;
    if (rawConfig === null || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
      return {
        ok: false,
        result: { ok: false, code: "bad-request", errors: ["[E_CONFIG] config: config 必须是对象"] },
      };
    }
    const validation = validateJevConfig(mergeJevConfigInput(saved, rawConfig as Record<string, unknown>));
    if (!validation.ok) {
      return { ok: false, result: { ok: false, code: "bad-request", errors: validation.errors } };
    }
    return { ok: true, config: validation.value };
  }

  async function test(input?: unknown, signal?: AbortSignal): Promise<unknown> {
    const resolved = await resolveTestConfig(input);
    if (!resolved.ok) return resolved.result;
    const config = resolved.config;
    const key = resolveJevKey(config, process.env);
    if (key.source === "none" || key.value === undefined) {
      const result: JevTestResult = { ok: false, code: "no-config", errors: ["Jev API key is not configured"] };
      return result;
    }
    // 脱敏集合按本次生效的临时配置重算：表单里新填的 key 不会出现在错误信息里。
    const secrets = collectJevSecrets(config, process.env);
    const probe = buildProbeRequest(config);
    try {
      const response = await postSystemOne(systemOneURL(config.baseURL), probe.request, key.value, {
        ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
        ...(deps.sleep !== undefined ? { sleep: deps.sleep } : {}),
        timeoutMs: config.timeoutMs,
        ...(signal !== undefined ? { signal } : {}),
        secrets,
      });
      const score = parseNoul(response.json, probe.id);
      if (score === null) {
        const result: JevTestResult = {
          ok: false,
          code: "bad-request",
          errors: ["[bad-request] 探针响应缺少可解析的 answers[id].noul"],
        };
        return result;
      }
      const result: JevTestResult = {
        ok: true,
        model: pickModel(response.json, config.model),
        latencyMs: response.latencyMsFirstAttempt,
      };
      return result;
    } catch (error) {
      return failureOf(error, secrets);
    }
  }

  async function rank(input: unknown, signal?: AbortSignal): Promise<unknown> {
    const parsed = parseRankInput(input);
    if (!parsed.ok) {
      const result: JevRankResult = { ok: false, code: "bad-request", errors: parsed.errors };
      return result;
    }
    const { cwd, sessionId, draft } = parsed.value;

    const { config, key, secrets } = await loadContext();
    if (key.source === "none" || key.value === undefined) {
      const result: JevRankResult = { ok: false, code: "no-config", errors: ["Jev API key is not configured"] };
      return result;
    }

    let capabilities: JevCapability[];
    try {
      capabilities = await engine.enumerate({ cwd, sessionId, live: engine.isSessionLive(sessionId) });
    } catch (error) {
      const result: JevRankResult = { ok: false, code: "network", errors: [redact(errMessage(error), secrets)] };
      return result;
    }
    if (capabilities.length === 0) {
      const result: JevRankResult = { ok: false, code: "empty-capabilities", errors: ["no capabilities in this session"] };
      return result;
    }
    if (capabilities.length > MAX_RANK_CAPABILITIES) {
      const result: JevRankResult = {
        ok: false,
        code: "bad-request",
        errors: [`too many capabilities (${capabilities.length} > ${MAX_RANK_CAPABILITIES})`],
      };
      return result;
    }

    const started = performance.now();
    try {
      const request = buildSystemOneRequest(config, capabilities, draft);
      const response = await postSystemOne(systemOneURL(config.baseURL), request, key.value, {
        ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
        ...(deps.sleep !== undefined ? { sleep: deps.sleep } : {}),
        timeoutMs: config.timeoutMs,
        ...(signal !== undefined ? { signal } : {}),
        secrets,
      });
      const items = capabilities.map((capability) => toRankItem(capability, parseNoul(response.json, capability.id)));
      items.sort(compareRankItems);
      const pendingOutcome = engine.consumePendingOutcome(sessionId);
      const result: JevRankResult = {
        ok: true,
        items,
        model: pickModel(response.json, config.model),
        usage: pickUsage(response.json),
        elapsedMs: Math.round(performance.now() - started),
        requestCount: 1,
        capabilitiesTotal: capabilities.length,
      };
      if (pendingOutcome !== undefined) result.pendingOutcome = pendingOutcome;
      return result;
    } catch (error) {
      return failureOf(error, secrets);
    }
  }

  async function apply(input: unknown): Promise<unknown> {
    return engine.apply(input);
  }

  function dispose(): void {
    engine.dispose();
  }

  return { getConfig, setConfig, test, rank, apply, dispose };
}
