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

import { isAbsolute, resolve as resolvePath } from "node:path";

import { enumerateCapabilities } from "../jev/apply.js";
import type { JevCapabilityService } from "../jev/apply.js";
import { collectJevSecrets, readJevConfig, resolveJevKey } from "../jev/config-file.js";
import { buildSystemOneRequests, parseRankScore, postSystemOne, systemOneURL } from "../jev/rank.js";
import type { JevCapability, JevConfig } from "../jev/types.js";
import { errMessage } from "../shared/errors.js";
import type { DerivedDynamicInfo, SessionStateStore } from "../session-state.js";

/** 支持「动态选择」的创建工具；其它派生方式按回退处理。 */
export const DYNAMIC_SPAWN_TOOLS: ReadonlySet<string> = new Set([
  "spawn_teammate",
  // 新版宿主若提供独立 spawn_agent 工具，同名覆盖；旧宿主不存在也无害。
  "spawn_agent",
  "subagent",
]);

/** 默认相关度阈值（与 `jev.json.decisionThreshold` 兜底一致）。 */
export const DEFAULT_DYNAMIC_THRESHOLD = 0.5;

/** 单次打分超时上限（spawn 同步等待；用户已接受首轮变慢，但不能无限等）。 */
export const DYNAMIC_RANK_TIMEOUT_CAP_MS = 8000;

/** pending 计划 TTL（覆盖审批 / guard 延迟）。 */
const PENDING_TTL_MS = 60 * 1000;

/** 同一父会话最多保留的 pending 数（防御异常调用）。 */
const PENDING_MAX_PER_PARENT = 16;

/** 工作区能力枚举缓存（并行 spawn 时避免重复磁盘 / MCP 扫描）。 */
const ENUM_CACHE_TTL_MS = 4000;

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
  counts: { skills: number; mcp: number; tools: number };
  /** seedDerived 用的三域显式开关（仅 `status === "ok"` 有内容）。 */
  toggles: {
    skills: Record<string, boolean>;
    mcp: Record<string, boolean>;
    tools: Record<string, boolean>;
  };
  /** 晚期 apply 用：skills 批量条目。 */
  skillEntries: Array<{ name: string; enabled: boolean }>;
  /** 晚期 apply 用：MCP 批量条目。 */
  mcpEntries: Array<{ target: string; kind: "project" | "server"; enabled: boolean }>;
  /** 晚期 apply 用：Tools 插件单元（选中 / 未选中分开写，API 一次只接受一个 enabled）。 */
  toolUnits: { enabled: string[]; disabled: string[] };
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
export function dynamicInfoOf(
  plan: DynamicPlan,
  fallback?: "session" | "workspace",
): DerivedDynamicInfo {
  return {
    status: plan.status,
    ...(plan.reason !== undefined ? { reason: plan.reason } : {}),
    threshold: plan.threshold,
    selected: plan.selected,
    total: plan.total,
    counts: { ...plan.counts },
    ...(fallback !== undefined ? { fallback } : {}),
    at: plan.at,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DYNAMIC_THRESHOLD;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function emptyCounts(): { skills: number; mcp: number; tools: number } {
  return { skills: 0, mcp: 0, tools: 0 };
}

/** 构造一个 fallback 计划（不写任何开关；由 derive 回退继承策略）。 */
function fallbackPlan(input: {
  parentSessionId: string;
  label?: string;
  cwd?: string;
  reason: string;
  threshold: number;
  total?: number;
  at: number;
}): DynamicPlan {
  return {
    parentSessionId: input.parentSessionId,
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
    status: "fallback",
    reason: input.reason,
    threshold: clamp01(input.threshold),
    selected: 0,
    total: input.total ?? 0,
    counts: emptyCounts(),
    toggles: { skills: {}, mcp: {}, tools: {} },
    skillEntries: [],
    mcpEntries: [],
    toolUnits: { enabled: [], disabled: [] },
    at: input.at,
  };
}

/** MCP 会话开关键（与 `mcp/loader.ts` / `session-state.ts` 的键口径一致）。 */
function mcpToggleKeyOf(write: Extract<JevCapability["write"], { type: "mcp" }>): string {
  return write.targetKind === "project" ? `project:${write.target}` : `server:${write.serverName}`;
}

/** 由能力集合 + 分数 + 阈值构造计划（纯函数，单测直接调）。 */
export function buildDynamicPlan(input: {
  parentSessionId: string;
  label?: string;
  cwd?: string;
  capabilities: readonly JevCapability[];
  scores: ReadonlyMap<string, number>;
  threshold: number;
  at: number;
}): DynamicPlan {
  const threshold = clamp01(input.threshold);
  const skills: Record<string, boolean> = {};
  const mcp: Record<string, boolean> = {};
  const tools: Record<string, boolean> = {};
  const skillEntries: Array<{ name: string; enabled: boolean }> = [];
  const mcpEntries: Array<{ target: string; kind: "project" | "server"; enabled: boolean }> = [];
  const toolEnabled: string[] = [];
  const toolDisabled: string[] = [];
  const counts = emptyCounts();
  let selected = 0;
  let total = 0;
  for (const capability of input.capabilities) {
    if (!capability.applicable) continue;
    total += 1;
    const enabled = (input.scores.get(capability.id) ?? 0) >= threshold;
    if (enabled) selected += 1;
    const write = capability.write;
    if (write.type === "skills") {
      skills[write.name] = enabled;
      skillEntries.push({ name: write.name, enabled });
      if (enabled) counts.skills += 1;
    } else if (write.type === "mcp") {
      mcp[mcpToggleKeyOf(write)] = enabled;
      mcpEntries.push({ target: write.target, kind: write.targetKind, enabled });
      if (enabled) counts.mcp += 1;
    } else {
      tools[`plugin:${write.unit}`] = enabled;
      if (enabled) toolEnabled.push(write.unit);
      else toolDisabled.push(write.unit);
      if (enabled) counts.tools += 1;
    }
  }
  if (total === 0 || selected === 0) {
    return fallbackPlan({
      parentSessionId: input.parentSessionId,
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
      reason: "empty",
      threshold,
      ...(total > 0 ? { total } : {}),
      at: input.at,
    });
  }
  return {
    parentSessionId: input.parentSessionId,
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
    status: "ok",
    threshold,
    selected,
    total,
    counts,
    toggles: { skills, mcp, tools },
    skillEntries,
    mcpEntries,
    toolUnits: { enabled: toolEnabled, disabled: toolDisabled },
    at: input.at,
  };
}

/** 从 spawn 参数取「子 agent 首条任务」文本。 */
function promptOf(tool: string, args: Record<string, unknown>): string | undefined {
  if (tool === "spawn_teammate" || tool === "spawn_agent" || tool === "subagent") {
    return typeof args.prompt === "string" && args.prompt.trim().length > 0 ? args.prompt : undefined;
  }
  return undefined;
}

/** spawn 参数里的 label（与 child descriptor 的 `label` 对齐）。 */
function labelOf(args: Record<string, unknown>): string | undefined {
  if (typeof args.description === "string" && args.description.trim().length > 0) return args.description.trim();
  if (typeof args.name === "string" && args.name.trim().length > 0) return args.name.trim();
  return undefined;
}

/** 父 agent 的 cwd。 */
function cwdOf(agent: any): string | undefined {
  const cwd = agent?.session?.header?.cwd;
  return typeof cwd === "string" && cwd.length > 0 ? cwd : undefined;
}

/** 解析子 agent cwd（subagent 的 `cwd` 参数相对父 cwd）。 */
function childCwdOf(parentCwd: string, args: Record<string, unknown>): string {
  const raw = args.cwd;
  if (typeof raw !== "string" || raw.length === 0) return parentCwd;
  return isAbsolute(raw) ? raw : resolvePath(parentCwd, raw);
}

/** 读 child descriptor 的 label（用于把 pending 绑定到正确的 child）。 */
function descriptorLabelOf(agent: any): string | undefined {
  try {
    const events = typeof agent?.session?.snapshotEvents === "function" ? agent.session.snapshotEvents() : undefined;
    if (!Array.isArray(events)) return undefined;
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event?.type !== "subagent/descriptor") continue;
      const label = event?.data?.label;
      if (typeof label === "string" && label.length > 0) return label;
    }
  } catch {
    /* descriptor 读失败 → 回落 FIFO */
  }
  return undefined;
}

/** 单条 pending（内部）。 */
interface PendingEntry {
  plan: DynamicPlan;
  expiresAt: number;
}

/**
 * 创建「动态选择」模块。
 *
 * 构造时只注册 `tools/pre-execute`；三域监听器之后的 `installApply()` 由组合根
 * 在装配完成后调用（保证应用阶段能 await 三域的 remount / restrict）。
 */
export function createDeriveAutoSelect(ctx: any, deps: DeriveAutoSelectDeps): DeriveAutoSelect {
  const logger = deps.logger;
  const now = deps.now ?? (() => Date.now());
  const pending = new Map<string, PendingEntry[]>();
  const armed = new Map<string, DynamicPlan>();
  const enumCache = new Map<string, { at: number; promise: Promise<JevCapability[]> }>();
  let disposed = false;
  let applyInstalled = false;
  let offApply: (() => void) | undefined;

  function prunePending(): void {
    const current = now();
    for (const [parentId, list] of pending) {
      const alive = list.filter((entry) => entry.expiresAt > current);
      if (alive.length > 0) pending.set(parentId, alive);
      else pending.delete(parentId);
    }
  }

  function remember(plan: DynamicPlan): void {
    prunePending();
    const list = pending.get(plan.parentSessionId) ?? [];
    list.push({ plan, expiresAt: now() + PENDING_TTL_MS });
    while (list.length > PENDING_MAX_PER_PARENT) list.shift();
    pending.set(plan.parentSessionId, list);
  }

  function consume(agent: any, parentId: string): DynamicPlan | undefined {
    prunePending();
    const list = pending.get(parentId);
    if (list === undefined || list.length === 0) return undefined;
    const label = descriptorLabelOf(agent);
    let index = label !== undefined ? list.findIndex((entry) => entry.plan.label === label) : -1;
    if (index < 0) {
      // child 有明确 label 但 pending 里没有对应项：宁可回退，也不要把另一次
      // spawn 的计划错套到这个 child 上。
      if (label !== undefined) return undefined;
      index = 0;
    }
    const [entry] = list.splice(index, 1);
    if (list.length === 0) pending.delete(parentId);
    return entry?.plan;
  }

  async function enumerateWorkspace(service: JevCapabilityService, cwd: string): Promise<JevCapability[]> {
    const key = cwd;
    const cached = enumCache.get(key);
    if (cached !== undefined && now() - cached.at < ENUM_CACHE_TTL_MS) return cached.promise;
    const promise = enumerateCapabilities({
      service: () => service,
      cwd,
      // 工作区基线：不带任何会话显式覆盖（见 enumerateCapabilities 注释）。
      live: false,
      ...(logger !== undefined ? { logger } : {}),
    });
    const entry = { at: now(), promise };
    enumCache.set(key, entry);
    promise.catch(() => {
      if (enumCache.get(key) === entry) enumCache.delete(key);
    });
    return promise;
  }

  async function planFor(input: {
    parentSessionId: string;
    prompt: string;
    cwd: string;
    label?: string;
  }): Promise<DynamicPlan> {
    const at = now();
    const base = {
      parentSessionId: input.parentSessionId,
      ...(input.label !== undefined ? { label: input.label } : {}),
      cwd: input.cwd,
      at,
    };
    const service = deps.service();
    if (service === undefined) return fallbackPlan({ ...base, reason: "unavailable", threshold: DEFAULT_DYNAMIC_THRESHOLD });
    let capabilities: JevCapability[];
    try {
      capabilities = await enumerateWorkspace(service, input.cwd);
    } catch (error) {
      logger?.warn?.(`capability-panel: 动态选择枚举工作区能力失败（${errMessage(error)}）`);
      return fallbackPlan({ ...base, reason: "unavailable", threshold: DEFAULT_DYNAMIC_THRESHOLD });
    }
    const candidates = capabilities.filter((capability) => capability.applicable);
    let config: JevConfig;
    try {
      config = await readJevConfig(deps.dshHome, logger);
    } catch {
      return fallbackPlan({ ...base, reason: "no-config", threshold: DEFAULT_DYNAMIC_THRESHOLD, total: candidates.length });
    }
    const threshold = clamp01(config.decisionThreshold);
    if (candidates.length === 0) {
      return fallbackPlan({ ...base, reason: "empty", threshold, total: 0 });
    }
    const key = resolveJevKey(config, process.env);
    if (key.source === "none" || key.value === undefined) {
      return fallbackPlan({ ...base, reason: "no-key", threshold, total: candidates.length });
    }
    const secrets = collectJevSecrets(config, process.env);
    const draft = Array.from(input.prompt).slice(0, 8000).join("");
    // 三维判据 + 体积分片：多片共享一个 8s 总预算（spawn 同步等待，不能逐片各等 8s）。
    const plan = buildSystemOneRequests(config, candidates, draft);
    const answers: Record<string, unknown> = {};
    const controller = new AbortController();
    const timeoutMs = Math.min(config.timeoutMs, DYNAMIC_RANK_TIMEOUT_CAP_MS);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      for (const request of plan.requests) {
        const response = await postSystemOne(systemOneURL(config.baseURL), request, key.value, {
          ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
          ...(deps.sleep !== undefined ? { sleep: deps.sleep } : {}),
          timeoutMs,
          signal: controller.signal,
          secrets,
        });
        const partial = (response.json as { answers?: Record<string, unknown> }).answers;
        if (partial !== null && typeof partial === "object") Object.assign(answers, partial);
      }
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      const reason = typeof code === "string" && code.length > 0 ? code : "error";
      logger?.warn?.(`capability-panel: 动态选择打分失败，回退继承（${reason}: ${errMessage(error)}）`);
      return fallbackPlan({ ...base, reason, threshold, total: candidates.length });
    } finally {
      clearTimeout(timer);
    }
    const scores = new Map<string, number>();
    for (const capability of candidates) scores.set(capability.id, parseRankScore({ answers }, capability.id) ?? 0);
    return buildDynamicPlan({
      parentSessionId: input.parentSessionId,
      ...(input.label !== undefined ? { label: input.label } : {}),
      cwd: input.cwd,
      capabilities: candidates,
      scores,
      threshold,
      at,
    });
  }

  async function onPreExecute(exec: any, next: () => Promise<any>): Promise<any> {
    try {
      if (disposed) return next();
      const tool = typeof exec?.name === "string" ? exec.name : "";
      if (!DYNAMIC_SPAWN_TOOLS.has(tool)) return next();
      const parent = exec?.agent;
      const parentId = typeof parent?.id === "string" ? parent.id : undefined;
      if (parentId === undefined) return next();
      await deps.state.ready();
      if (deps.state.deriveMode(parentId) !== "dynamic") return next();
      const args =
        exec.arguments !== null && typeof exec.arguments === "object" && !Array.isArray(exec.arguments)
          ? (exec.arguments as Record<string, unknown>)
          : {};
      const prompt = promptOf(tool, args);
      if (prompt === undefined) return next();
      const parentCwd = cwdOf(parent) ?? process.cwd();
      const plan = await planFor({
        parentSessionId: parentId,
        prompt,
        cwd: childCwdOf(parentCwd, args),
        ...(labelOf(args) !== undefined ? { label: labelOf(args)! } : {}),
      });
      remember(plan);
    } catch (error) {
      // pre-execute 是工具执行路径：绝不能让选择失败阻塞 spawn。
      logger?.warn?.(`capability-panel: 动态选择捕获首条任务失败，按回退处理（${errMessage(error)}）`);
    }
    return next();
  }

  async function applyPlan(agent: any, plan: DynamicPlan): Promise<void> {
    const service = deps.service();
    if (service === undefined) return;
    const sessionId = typeof agent?.id === "string" ? agent.id : undefined;
    if (sessionId === undefined) return;
    const cwd = plan.cwd ?? cwdOf(agent);
    if (plan.skillEntries.length > 0) {
      try {
        if (typeof service.skills.setSessionEnabledBatch === "function") {
          await service.skills.setSessionEnabledBatch({ sessionId, entries: plan.skillEntries });
        } else {
          await Promise.allSettled(
            plan.skillEntries.map((entry) =>
              service.skills.setSessionEnabled({ sessionId, name: entry.name, enabled: entry.enabled }),
            ),
          );
        }
      } catch (error) {
        logger?.warn?.(`capability-panel: 动态选择应用 Skills 失败（${errMessage(error)}）`);
      }
    }
    if (plan.mcpEntries.length > 0) {
      try {
        if (typeof service.mcp.setSessionEnabledMany === "function") {
          await service.mcp.setSessionEnabledMany({
            sessionId,
            ...(cwd !== undefined ? { cwd } : {}),
            entries: plan.mcpEntries,
          });
        } else {
          await Promise.allSettled(
            plan.mcpEntries.map((entry) =>
              service.mcp.setSessionEnabled({
                sessionId,
                ...(cwd !== undefined ? { cwd } : {}),
                target: entry.target,
                kind: entry.kind,
                enabled: entry.enabled,
              }),
            ),
          );
        }
      } catch (error) {
        logger?.warn?.(`capability-panel: 动态选择应用 MCP 失败（${errMessage(error)}）`);
      }
    }
    if (service.tools !== undefined && (plan.toolUnits.enabled.length > 0 || plan.toolUnits.disabled.length > 0)) {
      try {
        for (const [units, enabled] of [
          [plan.toolUnits.enabled, true],
          [plan.toolUnits.disabled, false],
        ] as const) {
          if (units.length === 0) continue;
          await service.tools.setSessionEnabled({ sessionId, units: [...units], enabled });
        }
      } catch (error) {
        logger?.warn?.(`capability-panel: 动态选择应用 Tools 失败（${errMessage(error)}）`);
      }
    }
  }

  function arm(childSessionId: string, plan: DynamicPlan): void {
    if (plan.status !== "ok") return;
    armed.set(childSessionId, plan);
  }

  function installApply(): void {
    if (disposed || applyInstalled) return;
    applyInstalled = true;
    if (typeof ctx.on !== "function") return;
    const off = ctx.on("agent/created", async ({ agent }: any) => {
      if (disposed) return;
      const sessionId = typeof agent?.id === "string" ? agent.id : undefined;
      if (sessionId === undefined) return;
      const plan = armed.get(sessionId);
      if (plan === undefined) return;
      armed.delete(sessionId);
      try {
        await applyPlan(agent, plan);
      } catch (error) {
        // agent/created 被 serial await：这里也不能抛穿。
        logger?.warn?.(`capability-panel: 动态选择应用异常（${errMessage(error)}）`);
      }
    });
    offApply = typeof off === "function" ? off : undefined;
  }

  const offPreExecute =
    typeof ctx.on === "function"
      ? ctx.on("tools/pre-execute", (exec: any, next: () => Promise<any>) => onPreExecute(exec, next))
      : undefined;

  return {
    consume,
    arm,
    installApply,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (typeof offPreExecute === "function") offPreExecute();
      if (typeof offApply === "function") offApply();
      pending.clear();
      armed.clear();
      enumCache.clear();
    },
  };
}
