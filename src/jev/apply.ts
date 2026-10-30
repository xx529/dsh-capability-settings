/**
 * 能力枚举、应用事务与冷会话排队（架构 §7 / §8；写入执行器见 task-47）。
 *
 * 六条不变量：
 *
 *   1. **枚举是唯一入口**：`rank` 与 `apply` 都走 `enumerateCapabilities`，
 *      客户端传来的 `name` / `target` 一律不信任 —— 应用时按 `id` 重新枚举解析；
 *   2. **筛选语义**（task-42）：plan 是「已勾选」集合，也就是目标真值；当前会话里
 *      **所有可应用**能力中，选中 → 目标启用、未选 → 目标关闭（只改会话开关，
 *      不动项目默认）；只写「当前状态 ≠ 目标状态」的项；不可应用项
 *      （hard-disabled / not-restrictable / live 下 not-toggleable）一律不动；
 *   3. **两阶段批量/并发写入**（task-47）：先 enable 阶段、再 disable 阶段；
 *      阶段内 skills **同一 tick 全部发起**（先收集 Promise 再 `Promise.allSettled`），
 *      让 `skills.register` 引发的注册表 effect 合并刷新一次；MCP 按
 *      {@link MCP_WRITE_CONCURRENCY}（4）并发限流，避免逐条串行等卸载/挂载；
 *   4. **失败按前态逆序批量回滚**：批次完成后按原顺序取第一个失败；已成功写入的
 *      项按**相反顺序**恢复前态（skills 批量发起、MCP 同样限流），启用/关闭都能还原；
 *   5. **冷会话只排队不写**：无 live agent 时把「可应用能力的完整目标集合」
 *      （含关闭）存进内存 `Map<sessionId, PendingPlan>`，`ctx.on("agent/created")`
 *      命中后 `setTimeout(0)` 延后重放（让 mcp/loader 等监听先完成登记），
 *      并复用同一批量执行器（失败短重试）；
 *   6. **结果 additive 字段**：成功支返回 `enabled` / `disabled` / `elapsedMs`
 *      （`applied = enabled + disabled`；耗时覆盖枚举 + 批量写入）。
 *
 * @module dsh-capability-settings/jev/apply
 */

import { performance } from "node:perf_hooks";

import type { McpOpResult } from "../mcp/manager.js";
import type { McpListResult, McpRuntimeView } from "../mcp/types.js";
import type { SessionSkillOpResult, SessionSkillView } from "../skills/session.js";
import type { ToolsListView, ToolsSetSessionResult } from "../tools/types.js";
import { errMessage } from "../shared/errors.js";
import { describeExternalMcp, describeMcpServer, describePluginUnit } from "./descriptors.js";
import { redact } from "./config-file.js";
import { capabilityId, DESCRIPTION_LIMIT, truncateCodepoints, WHEN_TO_USE_LIMIT } from "./rank.js";
import type {
  JevApplyPlanItem,
  JevApplyResult,
  JevApplySkipReason,
  JevApplySkipped,
  JevCapability,
  JevCapabilityWrite,
  JevHostContext,
  JevLogger,
  JevPendingOutcome,
  JevPrevState,
} from "./types.js";

// ---------------------------------------------------------------------------
// 依赖形状
// ---------------------------------------------------------------------------

/**
 * 枚举/写入依赖的宿主服务（结构子集）。
 *
 * 只声明用到的三个方法，避免 `jev/**` 运行时 import `index.ts`
 * （组合根）造成循环依赖；赋值兼容性由 `src/index.ts` 的装配处检查。
 */
export interface JevCapabilityService {
  skills: {
    sessionList(cwd?: string, sessionId?: string): Promise<SessionSkillView[]>;
    setSessionEnabled(input: { sessionId: string; name: string; enabled: boolean }): Promise<SessionSkillOpResult>;
    /**
     * 可选：批量会话开关（性能路径，见 `skills/session.ts#setEnabledBatch`）。
     *
     * 筛选语义一次要写约 150 条技能；逐条 `setSessionEnabled` 会触发 O(N²) 的
     * 宿主 skill catalog 全量发现。缺省（旧装配）时降级回逐条并发。
     */
    setSessionEnabledBatch?(input: {
      sessionId: string;
      entries: ReadonlyArray<{ name: string; enabled: boolean | undefined }>;
    }): Promise<{
      ok: boolean;
      errors: string[];
      outcomes: Array<{ name: string; ok: boolean; errors?: string[] }>;
    }>;
  };
  mcp: {
    list(cwd?: string, sessionId?: string): Promise<McpListResult>;
    runtime(input: { cwd?: string; sessionId?: string }): Promise<McpRuntimeView>;
    setSessionEnabled(input: {
      sessionId: string;
      cwd?: string;
      target: string;
      kind: "project" | "server";
      enabled: boolean | undefined;
    }): Promise<McpOpResult>;
    /** 可选：批量会话开关（一次落盘 + 一次重挂；见 `mcp/loader.ts#setSessionEnabledMany`）。 */
    setSessionEnabledMany?(input: {
      sessionId: string;
      cwd?: string;
      entries: Array<{ target: string; kind: "project" | "server"; enabled: boolean | undefined }>;
    }): Promise<McpOpResult>;
  };
  /**
   * 可选：Tools 域服务（v13；插件级会话开关）。
   *
   * 缺省（旧装配 / 半升级）时枚举**跳过 Tools 段**并 warn 一次，skills/mcp 的
   * 评分与应用不受影响（方案 §8.1 的降级口径）。
   */
  tools?: {
    list(input: { sessionId?: string }): Promise<ToolsListView>;
    setSessionEnabled(input: {
      sessionId: string;
      units: string[];
      enabled: boolean | undefined;
    }): Promise<ToolsSetSessionResult>;
  };
  /**
   * 可选：从全局工具注册表反推某个 MCP server 的工具（name + description）。
   *
   * 由组合根实现（`ctx.get("tools").schemas()` 过滤 `mcp__<serverName>__*`），
   * 用于把工具清单塞进 rank 的 question，帮助模型判断 server 实际能做什么。
   * 不可用 / 抛错 / 返回空都会被静默降级（能力照常评分，只是没有 tools）。
   */
  mcpTools?(serverName: string): Array<{ name: string; description?: string }> | Promise<Array<{ name: string; description?: string }>>;
}

/** 冷会话计划（同会话只保留最新一份）。 */
export interface JevPendingPlan {
  sessionId: string;
  cwd?: string;
  createdAt: number;
  /**
   * 目标集合：`{ id, desired }`（`desired=true` 启用、`false` 关闭）。
   *
   * 筛选语义下，入队时记录**当时所有可应用能力**的目标态（含关闭）；激活后
   * 重新枚举、按 id 匹配并只写「当前状态 ≠ 目标状态」的项（不复用入队快照）。
   */
  ops: Array<{ id: string; desired: boolean }>;
  /** 入队时已确定的跳过项（计划里 unknown/非启用/不可应用的 id）。 */
  skipped: JevApplySkipped[];
}

/** 冷会话队列/应用引擎。 */
export interface JevApplyEngine {
  /** 枚举当前会话的评分集合（含 applicable=false 的项）。 */
  enumerate(input: { cwd?: string; sessionId: string; live?: boolean }): Promise<JevCapability[]>;
  /** 判活：`agents.list()` 中存在 `agent.id === sessionId`。 */
  isSessionLive(sessionId: string): boolean;
  /** `jev.apply` 主体。 */
  apply(input: unknown): Promise<JevApplyResult>;
  /** 读取并消费某会话的排队结果回执（读取即消费）。 */
  consumePendingOutcome(sessionId: string): JevPendingOutcome | undefined;
  /** 诊断：当前排队中的计划数。 */
  pendingCount(): number;
  /** 卸载：移除生命周期监听、清空两张 Map。 */
  dispose(): void;
}

/** 引擎构造参数。 */
export interface JevApplyEngineDeps {
  ctx: JevHostContext;
  /** 延迟求值的服务访问器（避免与 `capabilityPanel` 服务构造顺序耦合）。 */
  service: () => JevCapabilityService | undefined;
  logger?: JevLogger;
  /** 可注入的 sleep（测试用；默认 setTimeout）。 */
  sleep?: (ms: number) => Promise<void>;
  /** 可注入的时钟（测试用；默认 Date.now）。 */
  now?: () => number;
}

/** 排队计划 TTL：30 分钟（§8.5，下次写入/读取时清理）。 */
const PENDING_TTL_MS = 30 * 60 * 1000;

/** 排队结果回执的上界（§8.4，超出按插入顺序淘汰最旧）。 */
const PENDING_OUTCOME_LIMIT = 32;

/** 激活时就绪重试的退避（100ms / 300ms）。 */
const READY_RETRY_DELAYS_MS = [100, 300] as const;

/** `jev.apply` 一次最多接受的计划条数。 */
const MAX_APPLY_PLAN_ITEMS = 500;

/**
 * 慢 apply 的 warn 阈值（毫秒）。
 *
 * 批量写入后正常路径应在百毫秒级；超过该阈值才 warn 一次，带上「枚举 / 写入 /
 * 技能条数」分解，便于下次定位（不刷日志、不改变返回值）。
 */
const SLOW_APPLY_WARN_MS = 800;

/**
 * MCP 写入并发度上限（task-47）。
 *
 * skills 走「整批同一 tick 同步发起」，不受这个限制；MCP 的卸载/挂载由
 * manager/loader 自身串行队列处理，这里只限流避免一次打爆子进程/连接。
 */
const MCP_WRITE_CONCURRENCY = 4;

/**
 * Tools 写入并发度上限（v13）。
 *
 * Tools 写入会触发 `tools.restrict` 重算，不宜与 MCP 同一 tick 全发；单列一个
 * 组便于日志区分（方案 §8.3-4 推荐）。
 */
const TOOLS_WRITE_CONCURRENCY = 4;

// ---------------------------------------------------------------------------
// 判活
// ---------------------------------------------------------------------------

/**
 * 会话是否 live：`agents.list()` 存在 `agent.id === sessionId`（F4）。
 *
 * 每次调用现算、不缓存（agent 生命周期由事件驱动，缓存会陈旧）。
 * `agents` 服务不可用时按「冷会话」处理（降级：排队，用户可手动重试）。
 */
export function isSessionLive(ctx: JevHostContext, sessionId: string): boolean {
  try {
    const agents = ctx.get?.("agents")?.list?.() ?? [];
    return Array.isArray(agents) && agents.some((agent: { id?: unknown } | null | undefined) => agent?.id === sessionId);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 枚举
// ---------------------------------------------------------------------------

/** skill 的 source（宿主取值是 `project-*` / `user-*` / `bundled` / `custom`）。 */
function skillSourceOf(source: string): "project" | "global" {
  return source.startsWith("project") ? "project" : "global";
}

/** MCP 的显式会话覆盖：与项目默认不同才视为「显式」，`undefined` = 跟随默认。 */
function explicitToggleOf(enabledInSession: boolean, disabledInProject: boolean | undefined): boolean | undefined {
  const defaultEnabled = !(disabledInProject === true);
  return enabledInSession !== defaultEnabled ? enabledInSession : undefined;
}

/** 归一化 MCP 工具列表（只保留 name 非空；description 可选）。 */
function normalizeTools(
  input: unknown,
): Array<{ name: string; description?: string }> | undefined {
  if (!Array.isArray(input)) return undefined;
  const tools: Array<{ name: string; description?: string }> = [];
  for (const item of input) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : "";
    if (name.length === 0) continue;
    const description =
      typeof record.description === "string" && record.description.length > 0 ? record.description : undefined;
    tools.push(description !== undefined ? { name, description } : { name });
  }
  return tools.length > 0 ? tools : undefined;
}

/**
 * 取某个 MCP server 的工具（配置条目走 `service.mcpTools`，外部实例用 view.tools）。
 *
 * 失败静默降级为 undefined：tools 只提升打分质量，不应让枚举整体失败。
 */
async function resolveMcpTools(
  service: JevCapabilityService,
  serverName: string,
): Promise<Array<{ name: string; description?: string }> | undefined> {
  if (typeof service.mcpTools !== "function") return undefined;
  try {
    return normalizeTools(await service.mcpTools(serverName));
  } catch {
    return undefined;
  }
}

/**
 * 枚举一个会话的评分集合（架构 §7.1）。
 *
 * 集合包含 `applicable=false` 的项（前端要展示「不可切换 + 原因」）；
 * 应用集合 = 其中 `applicable` 为 true 的子集。
 *
 * @param options.live 会话是否 live。**冷会话技能不按 `canToggleInSession`
 *   排除**（§7.3 冷会话例外），否则首屏主场景将无技能可选。
 */
export async function enumerateCapabilities(options: {
  service: () => JevCapabilityService | undefined;
  cwd?: string;
  sessionId: string;
  live: boolean;
  logger?: JevLogger;
}): Promise<JevCapability[]> {
  const service = options.service();
  if (service === undefined) throw new Error("capability-panel service unavailable");
  const { cwd, sessionId, live, logger } = options;
  const byId = new Map<string, JevCapability>();

  /** 追加一条能力；id 冲突时保留先到者并 warn（§6.4）。 */
  const add = (capability: JevCapability): void => {
    if (byId.has(capability.id)) {
      logger?.warn?.(`capability-panel: Jev 能力 id 冲突，已忽略后到者（${capability.kind}:${capability.name}）`);
      return;
    }
    byId.set(capability.id, capability);
  };

  // —— 1. skills ——
  const skillRows = await service.skills.sessionList(cwd, sessionId);
  for (const row of skillRows ?? []) {
    // 宿主 list 已过滤 shadow stub / 双向不可调用；这里防御性再过滤一次。
    if (row.shadowStub === true) continue;
    if (!row.invocation.modelInvocable && !row.invocation.userInvocable) continue;
    const applicable = !(live && row.canToggleInSession === false);
    // 注入技能（origin/channel/provider）与磁盘技能在评分/应用上完全一致，
    // 只有来源展示字段不同：source 映射为 "external"（不是项目级能力）。
    const injected = row.injected === true;
    const capability: JevCapability = {
      id: capabilityId(`skill:${row.name}`),
      kind: "skill",
      name: row.name,
      description: truncateCodepoints(row.description.length > 0 ? row.description : "（无描述）", DESCRIPTION_LIMIT),
      source: injected ? "external" : skillSourceOf(row.source),
      applicable,
      enabledInSession: row.enabledInSession !== false,
      canToggleInSession: row.canToggleInSession,
      write: { type: "skills", name: row.name },
    };
    if (row.whenToUse !== undefined && row.whenToUse.trim().length > 0) {
      capability.whenToUse = truncateCodepoints(row.whenToUse, WHEN_TO_USE_LIMIT);
    }
    if (injected) {
      if (row.origin !== undefined) capability.origin = row.origin;
      if (typeof row.channel === "string" && row.channel.length > 0) capability.channel = row.channel;
      if (typeof row.provider === "string" && row.provider.length > 0) capability.provider = row.provider;
      if (row.contentReadOnly === true) capability.contentReadOnly = true;
    }
    if (!applicable) capability.reason = "not-toggleable";
    add(capability);
  }

  // —— 2. MCP 配置条目（全局 + 项目原生 + 项目级引用）——
  const mcpList = await service.mcp.list(cwd, sessionId);
  /** 配置文件里出现过的 serverName（含被遮蔽行）：用于外部实例去重。 */
  const configuredServerNames = new Set<string>();
  for (const row of mcpList?.servers ?? []) {
    configuredServerNames.add(row.serverName);
    // 被项目同名条目遮蔽的全局行：开关落在被遮蔽行上无意义。
    if (row.shadowed === true) continue;
    const defaultEnabled = row.disabledInProject !== true;
    const enabledInSession = typeof row.enabledInSession === "boolean" ? row.enabledInSession : defaultEnabled;
    // 「硬关闭」= 配置文件 disabled（含引用上的项目级 disabled）：row.enabled 就是该口径。
    const applicable = row.enabled !== false;
    const write: JevCapabilityWrite =
      row.scope === "project"
        ? { type: "mcp", target: row.key, targetKind: "project", serverName: row.serverName }
        : { type: "mcp", target: row.serverName, targetKind: "server", serverName: row.serverName };
    const capability: JevCapability = {
      id: capabilityId(row.scope === "project" ? `mcp:project:${row.key}` : `mcp:server:${row.serverName}`),
      kind: "mcp",
      name: row.serverName,
      // 描述来源：作者手填 > 从 command/args/url 推导 > 最小兜底。
      // 注意 `row.summary` 只用于推导，绝不作为原文发送（可能含凭据）。
      description: truncateCodepoints(
        describeMcpServer({
          transport: row.transport,
          ...(typeof row.entry?.description === "string" ? { description: row.entry.description } : {}),
          ...(row.entry !== undefined ? { entry: row.entry } : {}),
          ...(row.summary.length > 0 ? { summary: row.summary } : {}),
        }),
        DESCRIPTION_LIMIT,
      ),
      source: row.scope === "project" ? "project" : "global",
      applicable,
      enabledInSession,
      mcpExplicitToggle: explicitToggleOf(enabledInSession, row.disabledInProject),
      write,
    };
    if (!applicable) capability.reason = "hard-disabled";
    // MCP 工具清单：配置条目从全局工具注册表反推（rank 的 question 用它判断能力范围）。
    const tools = await resolveMcpTools(service, row.serverName);
    if (tools !== undefined) capability.tools = tools;
    add(capability);
  }

  // —— 3. 运行时注入的外部实例（只读发现）——
  try {
    const runtime = await service.mcp.runtime({ cwd, sessionId });
    for (const view of runtime?.servers ?? []) {
      // 与配置条目同名时以配置条目为准（§7.1 合并去重）。
      if (configuredServerNames.has(view.serverName)) continue;
      const defaultEnabled = view.disabledInProject !== true;
      const enabledInSession = typeof view.enabledInSession === "boolean" ? view.enabledInSession : defaultEnabled;
      const applicable = view.restrictable === true;
      const capability: JevCapability = {
        id: capabilityId(`mcp:server:${view.serverName}`),
        kind: "mcp",
        name: view.serverName,
        // 外部实例：用注入方名字 + summary 的结构化推导；拿不到就给最小说法。
        description: truncateCodepoints(
          describeExternalMcp({
            ...(view.summary !== undefined ? { summary: view.summary } : {}),
            ...(view.channel !== undefined ? { channel: view.channel } : {}),
            ...(view.source !== undefined ? { origin: view.source } : {}),
            ...(view.transport !== undefined ? { transport: view.transport } : {}),
          }),
          DESCRIPTION_LIMIT,
        ),
        source: "external",
        applicable,
        enabledInSession,
        mcpExplicitToggle: explicitToggleOf(enabledInSession, view.disabledInProject),
        write: { type: "mcp", target: view.serverName, targetKind: "server", serverName: view.serverName },
      };
      if (!applicable) capability.reason = "not-restrictable";
      // 外部实例直接用它已发现的工具（mcp.runtime 的 view.tools）。
      const tools = normalizeTools(view.tools);
      if (tools !== undefined) capability.tools = tools;
      add(capability);
    }
  } catch (error) {
    // 外部实例枚举是增强项：失败不影响配置文件条目的评分/应用。
    logger?.warn?.(`capability-panel: Jev 外部 MCP 实例枚举失败（${redact(errMessage(error), [])}）`);
  }

  // —— 4. Tools 插件单元（v13）——
  // 一个插件 = 一个评分/应用单元；「来源未识别」单元不进候选（A4：可能混入未来
  // 宿主内建工具，让模型去"推荐关闭"风险高）。
  const toolsService = service.tools;
  if (toolsService === undefined) {
    warnToolsUnavailable(logger);
  } else {
    let toolsView: ToolsListView | undefined;
    try {
      // 冷会话可枚举（读磁盘 + 内存 hydrate，不需要 live agent）。
      toolsView = await toolsService.list({ sessionId });
    } catch (error) {
      logger?.warn?.(`capability-panel: Jev Tools 单元枚举失败（${redact(errMessage(error), [])}）`);
    }
    for (const unit of toolsView?.units ?? []) {
      if (unit.kind === "unattributed") continue;
      // 两层语义（task-20 §4）：候选 = 本会话 **effective 启用**的插件
      // （`enabled = 会话覆盖 ?? 全局默认`）。全局默认关闭 / 本会话已关的单元
      // **不参与评分与应用**，因此 Jev 无法把它们重新打开（只收窄不扩权）。
      const effective = typeof unit.enabled === "boolean" ? unit.enabled : unit.enabledInSession;
      if (effective !== true) continue;
      const applicable = unit.lockedReason === undefined;
      const capability: JevCapability = {
        id: capabilityId(`tool:plugin:${unit.unit}`),
        kind: "tool",
        name: unit.name,
        // 插件级语义：优先 npm 包描述（attribution 扫描/包根读取），否则旧占位。
        description: truncateCodepoints(
          describePluginUnit({
            ...(unit.description !== undefined ? { description: unit.description } : {}),
            toolCount: unit.toolCount,
          }),
          DESCRIPTION_LIMIT,
        ),
        // 不在项目 / 全局配置文件里；语义与"外部注入"一致。
        source: "external",
        origin: "plugin",
        channel: unit.name,
        toolCount: unit.toolCount,
        // 只发工具名与一句话说明（不下发 parameters；隐私口径见方案 §8.2）。
        tools: unit.tools.map((tool) => ({ ...tool })),
        applicable,
        // 候选已按 effective 过滤，进入这里的单元当前必然生效。
        enabledInSession: true,
        // 回滚前态：有显式会话覆盖 → true；跟随全局默认 → undefined（清除覆盖，
        // 回到全局默认，而不是写死 true 覆盖全局关闭）。
        toolsExplicitToggle: unit.explicit ? true : undefined,
        write: { type: "tools", unit: unit.unit, unitName: unit.name },
      };
      if (!applicable) capability.reason = "not-restrictable";
      add(capability);
    }
  }

  /** 固定序 skill → mcp → tool（与 `compareRankItems` 同步）。 */
  const KIND_ORDER: Record<JevCapability["kind"], number> = { skill: 0, mcp: 1, tool: 2 };
  return [...byId.values()].sort((a, b) => {
    if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return a.name.localeCompare(b.name);
  });
}

/**
 * 旧装配 / 半升级（没有 tools 服务）时 warn 一次：枚举跳过 Tools 段，不报错。
 *
 * 模块级只打一次，避免每次 rank/apply 刷屏。
 */
let toolsUnavailableWarned = false;
function warnToolsUnavailable(logger?: JevLogger): void {
  if (toolsUnavailableWarned) return;
  toolsUnavailableWarned = true;
  logger?.warn?.("capability-panel: 未注入 Tools 服务，Jev 枚举跳过 Tools 段（skills/mcp 不受影响）");
}

// ---------------------------------------------------------------------------
// 写回 / 回滚
// ---------------------------------------------------------------------------

type WriteResult = { ok: true } | { ok: false; errors: string[] };

/** 写回前态快照（回滚用）。 */
function snapshotPrev(capability: JevCapability): JevPrevState {
  if (capability.write.type === "skills") return { type: "skills", enabled: capability.enabledInSession };
  if (capability.write.type === "tools") return { type: "tools", enabled: capability.toolsExplicitToggle };
  return { type: "mcp", enabled: capability.mcpExplicitToggle };
}

/** 是否属于「服务未就绪」类错误（激活后短重试的判定）。 */
function isReadyError(message: string): boolean {
  return /unavailable|not found|not ready|not registered|session record|no agent/i.test(message);
}

/**
 * 写回一条能力（调用既有的会话开关接口；**批量/并发调度由上层
 * `runWritePhase` 负责**，本函数只负责单条写入与错误归一）。
 *
 * skills：`setSessionEnabled({sessionId,name,enabled:desired})`；
 * MCP：`setSessionEnabled({sessionId,cwd?,target,kind,enabled:desired})`。
 * `desired` 由筛选语义决定（选中 = true、未选 = false）；两者业务失败
 * （`ok:false`）都收敛成 `{ok:false,errors}`，不向 RPC 层抛。
 */
async function writeOne(
  deps: Pick<JevApplyEngineDeps, "service">,
  sessionId: string,
  cwd: string | undefined,
  capability: JevCapability,
  desired: boolean,
): Promise<WriteResult> {
  const service = deps.service();
  if (service === undefined) return { ok: false, errors: ["capability-panel service unavailable"] };
  try {
    if (capability.write.type === "skills") {
      const result = await service.skills.setSessionEnabled({ sessionId, name: capability.write.name, enabled: desired });
      return result?.ok === false ? { ok: false, errors: result.errors ?? [] } : { ok: true };
    }
    if (capability.write.type === "tools") {
      // 插件级：一个 unit 一次调用（`units` 长度 1；宿主按 unit 重算 deny 名单）。
      const toolsService = service.tools;
      if (toolsService === undefined) return { ok: false, errors: ["tools service unavailable"] };
      const result = await toolsService.setSessionEnabled({
        sessionId,
        units: [capability.write.unit],
        enabled: desired,
      });
      return result?.ok === false ? { ok: false, errors: result.errors ?? [] } : { ok: true };
    }
    const result = await service.mcp.setSessionEnabled({
      sessionId,
      ...(cwd !== undefined ? { cwd } : {}),
      target: capability.write.target,
      kind: capability.write.targetKind,
      enabled: desired,
    });
    return result?.ok === false ? { ok: false, errors: result.errors ?? [] } : { ok: true };
  } catch (error) {
    return { ok: false, errors: [redact(errMessage(error), [])] };
  }
}

/**
 * 以固定并发度执行异步任务，按输入顺序返回结果。
 *
 * 用于 MCP 写入/回滚限流（{@link MCP_WRITE_CONCURRENCY}）；skills 不走这里，
 * 而是整批同步发起（见引擎里的 `runWritePhase`）。
 */
async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await run(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// 批量写入（性能路径）：一次目录发现 + 一次落盘
// ---------------------------------------------------------------------------

/**
 * 批量写一组 skills；服务未提供批量端点时返回 undefined（调用方降级逐条）。
 *
 * 筛选语义下一次要写约 150 条技能：逐条 `setSessionEnabled` 每条都会触发 3 次
 * 宿主 skill catalog 全量发现（`register` 让 collectCache 失效），即 O(N²) 磁盘
 * 扫描（本机实测 145 条 ≈ 9.5s）；批量端点把整批收敛成 1 次 prepare + 1 次
 * verify + 1 次落盘。
 */
async function writeSkillsBatch(
  service: JevCapabilityService,
  sessionId: string,
  ops: readonly PlannedOp[],
): Promise<WriteResult[] | undefined> {
  const batch = service.skills.setSessionEnabledBatch;
  if (typeof batch !== "function") return undefined;
  const entries = ops.map((op) => {
    const write = op.cap.write as Extract<JevCapabilityWrite, { type: "skills" }>;
    return { name: write.name, enabled: op.desired };
  });
  const failAll = (errors: string[]): WriteResult[] => ops.map(() => ({ ok: false, errors }));
  try {
    const result = await batch.call(service.skills, { sessionId, entries });
    if (!result.ok) return failAll(result.errors.length > 0 ? result.errors : ["skills batch write failed"]);
    const byName = new Map(result.outcomes.map((outcome) => [outcome.name, outcome]));
    return entries.map((entry): WriteResult => {
      const outcome = byName.get(entry.name);
      // 批量端点必须对每个入参名字给出 outcome；缺失按失败处理（不做假成功）。
      if (outcome === undefined) return { ok: false, errors: ["skills batch outcome missing"] };
      if (outcome.ok) return { ok: true };
      return { ok: false, errors: outcome.errors ?? ["skills batch item failed"] };
    });
  } catch (error) {
    return failAll([redact(errMessage(error), [])]);
  }
}

/** 批量写一组 MCP 会话开关；服务未提供批量端点时返回 undefined。 */
async function writeMcpBatch(
  service: JevCapabilityService,
  sessionId: string,
  cwd: string | undefined,
  ops: readonly PlannedOp[],
): Promise<WriteResult[] | undefined> {
  const batch = service.mcp.setSessionEnabledMany;
  if (typeof batch !== "function") return undefined;
  const entries = ops.map((op) => {
    const write = op.cap.write as Extract<JevCapabilityWrite, { type: "mcp" }>;
    return { target: write.target, kind: write.targetKind, enabled: op.desired };
  });
  const failAll = (errors: string[]): WriteResult[] => ops.map(() => ({ ok: false, errors }));
  try {
    const result = await batch.call(service.mcp, {
      sessionId,
      ...(cwd !== undefined ? { cwd } : {}),
      entries,
    });
    if (result?.ok === false) return failAll(result.errors ?? ["mcp batch write failed"]);
    return ops.map((): WriteResult => ({ ok: true }));
  } catch (error) {
    return failAll([redact(errMessage(error), [])]);
  }
}

/**
 * 批量写一组 Tools 插件单元（同一阶段内目标态一致：整组启用或整组关闭）。
 *
 * 服务未提供（旧装配）或阶段内目标态不一致时返回 undefined。
 */
async function writeToolsBatch(
  service: JevCapabilityService,
  sessionId: string,
  ops: readonly PlannedOp[],
): Promise<WriteResult[] | undefined> {
  const tools = service.tools;
  if (tools === undefined) return undefined;
  const desired = ops[0]?.desired;
  if (desired === undefined || ops.some((op) => op.desired !== desired)) return undefined;
  const units = ops.map((op) => (op.cap.write as Extract<JevCapabilityWrite, { type: "tools" }>).unit);
  const failAll = (errors: string[]): WriteResult[] => ops.map(() => ({ ok: false, errors }));
  try {
    const result = await tools.setSessionEnabled({ sessionId, units, enabled: desired });
    if (result?.ok === false) return failAll(result.errors ?? ["tools batch write failed"]);
    return ops.map((): WriteResult => ({ ok: true }));
  } catch (error) {
    return failAll([redact(errMessage(error), [])]);
  }
}

/** 回滚一组 skills（批量端点；未提供时返回 undefined）。 */
async function restoreSkillsBatch(
  service: JevCapabilityService,
  sessionId: string,
  applied: ReadonlyArray<{ cap: JevCapability; prev: JevPrevState }>,
): Promise<string[] | undefined> {
  const batch = service.skills.setSessionEnabledBatch;
  if (typeof batch !== "function") return undefined;
  const entries = applied.map((entry) => ({
    name: (entry.cap.write as Extract<JevCapabilityWrite, { type: "skills" }>).name,
    enabled: entry.prev.type === "skills" ? entry.prev.enabled : true,
  }));
  try {
    const result = await batch.call(service.skills, { sessionId, entries });
    if (!result.ok) return [`rollback: ${result.errors.join("; ") || "skills batch rollback failed"}`];
    const errors: string[] = [];
    for (const outcome of result.outcomes) {
      if (outcome.ok) continue;
      for (const message of outcome.errors ?? []) errors.push(`rollback ${outcome.name}: ${redact(message, [])}`);
    }
    return errors;
  } catch (error) {
    return [`rollback: ${redact(errMessage(error), [])}`];
  }
}

/** 回滚一组 MCP 会话开关（批量端点；未提供时返回 undefined）。 */
async function restoreMcpBatch(
  service: JevCapabilityService,
  sessionId: string,
  cwd: string | undefined,
  applied: ReadonlyArray<{ cap: JevCapability; prev: JevPrevState }>,
): Promise<string[] | undefined> {
  const batch = service.mcp.setSessionEnabledMany;
  if (typeof batch !== "function") return undefined;
  const entries = applied.map((entry) => {
    const write = entry.cap.write as Extract<JevCapabilityWrite, { type: "mcp" }>;
    return {
      target: write.target,
      kind: write.targetKind,
      enabled: entry.prev.type === "mcp" ? entry.prev.enabled : undefined,
    };
  });
  try {
    const result = await batch.call(service.mcp, {
      sessionId,
      ...(cwd !== undefined ? { cwd } : {}),
      entries,
    });
    if (result?.ok === false) return [`rollback: ${(result.errors ?? []).join("; ") || "mcp batch rollback failed"}`];
    return [];
  } catch (error) {
    return [`rollback: ${redact(errMessage(error), [])}`];
  }
}

/** 回滚写入一条：把能力恢复成前态（skills 恒 boolean；MCP 可为 undefined=清显式覆盖）。 */
async function restoreOne(
  deps: Pick<JevApplyEngineDeps, "service">,
  sessionId: string,
  cwd: string | undefined,
  capability: JevCapability,
  prev: JevPrevState,
): Promise<string | undefined> {
  const service = deps.service();
  if (service === undefined) return `rollback ${capability.name}: capability-panel service unavailable`;
  try {
    if (capability.write.type === "skills") {
      await service.skills.setSessionEnabled({
        sessionId,
        name: capability.write.name,
        enabled: prev.type === "skills" ? prev.enabled : true,
      });
    } else if (capability.write.type === "tools") {
      const toolsService = service.tools;
      if (toolsService === undefined) return `rollback ${capability.name}: tools service unavailable`;
      // `prev.type !== "tools"` 时按"清除显式覆盖"兜底（回到默认开启）。
      await toolsService.setSessionEnabled({
        sessionId,
        units: [capability.write.unit],
        enabled: prev.type === "tools" ? prev.enabled : undefined,
      });
    } else {
      await service.mcp.setSessionEnabled({
        sessionId,
        ...(cwd !== undefined ? { cwd } : {}),
        target: capability.write.target,
        kind: capability.write.targetKind,
        enabled: prev.type === "mcp" ? prev.enabled : undefined,
      });
    }
    return undefined;
  } catch (error) {
    return `rollback ${capability.name}: ${redact(errMessage(error), [])}`;
  }
}

/**
 * 写入失败后按前态**逆序**恢复（§7.5）。
 *
 * 与写入侧同样批量执行：skills 回滚整批同步发起（不逐条 await），MCP / Tools
 * 各自并发限流（{@link MCP_WRITE_CONCURRENCY} / {@link TOOLS_WRITE_CONCURRENCY}）；
 * 整体按已写列表的相反顺序组织。
 */
async function rollback(
  deps: Pick<JevApplyEngineDeps, "service">,
  sessionId: string,
  cwd: string | undefined,
  applied: Array<{ cap: JevCapability; prev: JevPrevState }>,
  useBatch = false,
): Promise<string[]> {
  const reversed = [...applied].reverse();
  const skills = reversed.filter((entry) => entry.cap.write.type === "skills");
  const mcps = reversed.filter((entry) => entry.cap.write.type === "mcp");
  const tools = reversed.filter((entry) => entry.cap.write.type === "tools");
  const service = deps.service();

  /** skills 回滚：优先批量端点（一次发现 + 一次落盘），否则整批同 tick 逐条。 */
  const skillsTask = async (): Promise<string[]> => {
    if (useBatch && service !== undefined) {
      const batched = await restoreSkillsBatch(service, sessionId, skills);
      if (batched !== undefined) return batched;
    }
    const settled = await Promise.allSettled(
      skills.map((entry) => restoreOne(deps, sessionId, cwd, entry.cap, entry.prev)),
    );
    const errors: string[] = [];
    for (const result of settled) {
      if (result.status === "rejected") errors.push(`rollback: ${redact(errMessage(result.reason), [])}`);
      else if (result.value !== undefined) errors.push(result.value);
    }
    return errors;
  };

  /** MCP 回滚：优先批量端点（一次落盘 + 一次重挂），否则并发限流逐条。 */
  const mcpTask = async (): Promise<string[]> => {
    if (useBatch && service !== undefined) {
      const batched = await restoreMcpBatch(service, sessionId, cwd, mcps);
      if (batched !== undefined) return batched;
    }
    const results = await runWithConcurrency(mcps, MCP_WRITE_CONCURRENCY, (entry) =>
      restoreOne(deps, sessionId, cwd, entry.cap, entry.prev),
    );
    return results.filter((message): message is string => message !== undefined);
  };

  const toolsTask = async (): Promise<string[]> => {
    const results = await runWithConcurrency(tools, TOOLS_WRITE_CONCURRENCY, (entry) =>
      restoreOne(deps, sessionId, cwd, entry.cap, entry.prev),
    );
    return results.filter((message): message is string => message !== undefined);
  };

  // 三个域互不相干：并行执行（与写入侧一致）。
  const [skillErrors, mcpErrors, toolErrors] = await Promise.all([skillsTask(), mcpTask(), toolsTask()]);
  return [...skillErrors, ...mcpErrors, ...toolErrors];
}

// ---------------------------------------------------------------------------
// 筛选语义：目标态计算
// ---------------------------------------------------------------------------

/** 一条待写入的目标操作（含前态快照，回滚用）。 */
interface PlannedOp {
  cap: JevCapability;
  /** true = 启用，false = 关闭。 */
  desired: boolean;
  prev: JevPrevState;
}

/** 稳定全序：先 enable 后 disable，组内按 id 升序（便于测试与激活重放）。 */
function sortPlannedOps(ops: PlannedOp[]): void {
  ops.sort((a, b) => {
    if (a.desired !== b.desired) return a.desired ? -1 : 1;
    return a.cap.id < b.cap.id ? -1 : a.cap.id > b.cap.id ? 1 : 0;
  });
}

/**
 * 筛选语义的目标态计算。
 *
 * 只对**可应用**能力计算：selected → enabled=true；未 selected → enabled=false。
 * 返回：
 *   - `ops`：当前状态 ≠ 目标状态的待写操作（先 enable 后 disable，稳定排序）；
 *   - `consistent`：状态已经一致的 skipped（reason 复用 `already-applied`，
 *     不新增客户端未识别的 reason，避免跨任务类型分叉）。
 *
 * 不可应用项（hard-disabled / not-restrictable / live 下的 not-toggleable）
 * **一律不动**，也不进 skipped。
 */
function planTargetOps(
  caps: readonly JevCapability[],
  selectedIds: ReadonlySet<string>,
): { ops: PlannedOp[]; consistent: JevApplySkipped[] } {
  const ops: PlannedOp[] = [];
  const consistent: JevApplySkipped[] = [];
  for (const cap of caps) {
    if (!cap.applicable) continue;
    const desired = selectedIds.has(cap.id);
    if (cap.enabledInSession === desired) {
      consistent.push({ id: cap.id, reason: "already-applied" });
      continue;
    }
    ops.push({ cap, desired, prev: snapshotPrev(cap) });
  }
  sortPlannedOps(ops);
  return { ops, consistent };
}

// ---------------------------------------------------------------------------
// 引擎
// ---------------------------------------------------------------------------

/** 判断一个值是否是合法的能力 id（`cap_` + 36 位小写 hex）。 */
function isCapabilityId(value: unknown): value is string {
  return typeof value === "string" && /^cap_[0-9a-f]{36}$/.test(value);
}

/**
 * 创建应用引擎：枚举 / 事务 / 冷会话排队 / 生命周期监听。
 */
export function createJevApplyEngine(deps: JevApplyEngineDeps): JevApplyEngine {
  const logger = deps.logger;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? (() => Date.now());

  /** sessionId → 最新排队计划（同会话后者替换前者）。 */
  const pendingPlans = new Map<string, JevPendingPlan>();
  /** sessionId → 上次激活应用结果（有界，读取即消费）。 */
  const pendingOutcomes = new Map<string, JevPendingOutcome>();
  /** `ctx.on` 返回的 disposer。 */
  const listeners: Array<() => void> = [];
  let disposed = false;

  // —— 排队簿记 ——

  function prunePendingPlans(): void {
    const current = now();
    for (const [sessionId, plan] of pendingPlans) {
      if (current - plan.createdAt > PENDING_TTL_MS) pendingPlans.delete(sessionId);
    }
  }

  function recordOutcome(sessionId: string, outcome: JevPendingOutcome): void {
    pendingOutcomes.delete(sessionId);
    pendingOutcomes.set(sessionId, outcome);
    while (pendingOutcomes.size > PENDING_OUTCOME_LIMIT) {
      const oldest = pendingOutcomes.keys().next().value;
      if (oldest === undefined) break;
      pendingOutcomes.delete(oldest);
    }
  }

  function consumePendingOutcome(sessionId: string): JevPendingOutcome | undefined {
    prunePendingPlans();
    const outcome = pendingOutcomes.get(sessionId);
    if (outcome !== undefined) pendingOutcomes.delete(sessionId);
    return outcome;
  }

  function queuePendingPlan(plan: JevPendingPlan): void {
    prunePendingPlans();
    pendingPlans.set(plan.sessionId, plan);
  }

  function isLive(sessionId: string): boolean {
    return isSessionLive(deps.ctx, sessionId);
  }

  async function enumerate(input: { cwd?: string; sessionId: string; live?: boolean }): Promise<JevCapability[]> {
    const live = input.live ?? isLive(input.sessionId);
    return enumerateCapabilities({
      service: deps.service,
      cwd: input.cwd,
      sessionId: input.sessionId,
      live,
      logger,
    });
  }

  // —— 激活后应用 ——

  /** 激活后重新枚举，等「session 记录/skills 服务」就绪（最多 2 次短重试）。 */
  async function resolvePlanned(
    plan: JevPendingPlan,
  ): Promise<{ ops: PlannedOp[]; skipped: JevApplySkipped[] }> {
    const loadLive = (): Promise<JevCapability[]> =>
      enumerate({ cwd: plan.cwd, sessionId: plan.sessionId, live: true });
    let caps = await loadLive();
    for (let attempt = 0; attempt < READY_RETRY_DELAYS_MS.length; attempt += 1) {
      // 激活瞬间 skills 注册表可能还没 track 到该 agent：任一技能 not-toggleable
      // 都视为「服务未就绪」，短退避后重试（筛选语义要写全部可应用技能）。
      const skillsReady = caps.every((cap) => cap.kind !== "skill" || cap.canToggleInSession !== false);
      if (skillsReady) break;
      await sleep(READY_RETRY_DELAYS_MS[attempt]);
      caps = await loadLive();
    }

    const byId = new Map(caps.map((cap) => [cap.id, cap]));
    const skipped: JevApplySkipped[] = [...plan.skipped];
    const ops: PlannedOp[] = [];
    for (const { id, desired } of plan.ops) {
      const cap = byId.get(id);
      if (cap === undefined) {
        skipped.push({ id, reason: "unknown-id" });
        continue;
      }
      if (!cap.applicable) {
        skipped.push({ id, reason: (cap.reason ?? "not-toggleable") as JevApplySkipReason });
        continue;
      }
      if (cap.enabledInSession === desired) {
        skipped.push({ id, reason: "already-applied" });
        continue;
      }
      ops.push({ cap, desired, prev: snapshotPrev(cap) });
    }
    sortPlannedOps(ops);
    return { ops, skipped };
  }

  /**
   * 一个阶段（enable 或 disable）内的批量写入（task-47）。
   *
   * 关键优化：
   *   - **skills 整批同一 tick 发起**：先 `map` 出全部 `setSessionEnabled` Promise
   *     （不逐条 await），再 `Promise.allSettled`；145 次 `register` 落在同一宏任务，
   *     宿主 skills 注册表的 effect 合并为一次刷新；
   *   - **MCP 并发限流**：{@link MCP_WRITE_CONCURRENCY}（4），避免逐个串行等卸载/挂载；
   *   - 结果按原 `phaseOps` 顺序落位，失败判定取批次里**原顺序第一个**失败。
   */
  async function runWritePhase(
    sessionId: string,
    cwd: string | undefined,
    phaseOps: readonly PlannedOp[],
    write: (capability: JevCapability, desired: boolean) => Promise<WriteResult>,
    useBatch: boolean,
  ): Promise<WriteResult[]> {
    const results = new Array<WriteResult>(phaseOps.length);
    const skillIndexes: number[] = [];
    const mcpIndexes: number[] = [];
    const toolsIndexes: number[] = [];
    phaseOps.forEach((op, index) => {
      if (op.cap.write.type === "skills") skillIndexes.push(index);
      else if (op.cap.write.type === "tools") toolsIndexes.push(index);
      else mcpIndexes.push(index);
    });
    const service = useBatch ? deps.service() : undefined;
    const opsAt = (indexes: readonly number[]): PlannedOp[] => indexes.map((index) => phaseOps[index]!);

    // skills：优先批量端点（整批一次目录发现 + 一次落盘）；否则整批同一 tick 逐条。
    const skillsTask = async (): Promise<WriteResult[]> => {
      const ops = opsAt(skillIndexes);
      if (service !== undefined) {
        const batched = await writeSkillsBatch(service, sessionId, ops);
        if (batched !== undefined) return batched;
      }
      const settled = await Promise.allSettled(ops.map((op) => write(op.cap, op.desired)));
      return settled.map((entry): WriteResult =>
        entry.status === "fulfilled"
          ? entry.value
          : { ok: false, errors: [redact(errMessage(entry.reason), [])] },
      );
    };

    // MCP：优先批量端点（一次落盘 + 一次重挂）；否则并发限流逐条。
    const mcpTask = async (): Promise<WriteResult[]> => {
      const ops = opsAt(mcpIndexes);
      if (service !== undefined) {
        const batched = await writeMcpBatch(service, sessionId, cwd, ops);
        if (batched !== undefined) return batched;
      }
      return runWithConcurrency(ops, MCP_WRITE_CONCURRENCY, (op) => write(op.cap, op.desired));
    };

    // Tools 单列一组：写入会触发 restrict 重算，不与 MCP 抢同一 tick。
    const toolsTask = async (): Promise<WriteResult[]> => {
      const ops = opsAt(toolsIndexes);
      if (service !== undefined) {
        const batched = await writeToolsBatch(service, sessionId, ops);
        if (batched !== undefined) return batched;
      }
      return runWithConcurrency(ops, TOOLS_WRITE_CONCURRENCY, (op) => write(op.cap, op.desired));
    };

    const [skillResults, mcpResults, toolsResults] = await Promise.all([skillsTask(), mcpTask(), toolsTask()]);
    skillIndexes.forEach((opIndex, resultIndex) => {
      results[opIndex] = skillResults[resultIndex]!;
    });
    mcpIndexes.forEach((opIndex, resultIndex) => {
      results[opIndex] = mcpResults[resultIndex]!;
    });
    toolsIndexes.forEach((opIndex, resultIndex) => {
      results[opIndex] = toolsResults[resultIndex]!;
    });
    return results;
  }

  /**
   * 批量/并发写入一批目标操作；任一失败按前态**逆序回滚全部已写项**
   * （enable/disable 均可还原）。
   *
   * 顺序语义不变：先 enable 后 disable；同阶段内按稳定 id 序发起
   * （skills/MCP 优先批量端点、Tools 分组批量）；失败后不再进入下一阶段，直接回滚。
   *
   * @param useBatch true = 优先走批量端点（live 会话；冷会话激活路径保留逐条 +
   *   就绪重试语义）。
   */
  async function applyPlannedOps(
    sessionId: string,
    cwd: string | undefined,
    ops: readonly PlannedOp[],
    write: (capability: JevCapability, desired: boolean) => Promise<WriteResult>,
    useBatch: boolean,
  ): Promise<
    | { ok: true; written: PlannedOp[] }
    | { ok: false; written: PlannedOp[]; failedId: string; errors: string[]; rollbackFailed: boolean }
  > {
    const enableOps = ops.filter((op) => op.desired);
    const disableOps = ops.filter((op) => !op.desired);
    const written: PlannedOp[] = [];
    const failures: Array<{ op: PlannedOp; errors: string[] }> = [];
    for (const phaseOps of [enableOps, disableOps]) {
      if (phaseOps.length === 0) continue;
      const results = await runWritePhase(sessionId, cwd, phaseOps, write, useBatch);
      for (let index = 0; index < phaseOps.length; index += 1) {
        const result = results[index]!;
        if (result.ok) written.push(phaseOps[index]!);
        else failures.push({ op: phaseOps[index]!, errors: result.errors });
      }
      // 阶段失败：不再执行下一阶段（先回滚已写项）。
      if (failures.length > 0) break;
    }
    if (failures.length > 0) {
      const rollbackErrors = await rollback(deps, sessionId, cwd, written, useBatch);
      return {
        ok: false,
        written,
        failedId: failures[0]!.op.cap.id,
        errors: [...failures[0]!.errors, ...rollbackErrors],
        rollbackFailed: rollbackErrors.length > 0,
      };
    }
    return { ok: true, written };
  }

  /** 激活后应用：重新枚举、重新快照前态（不复用入队快照），失败回滚并记 outcome。 */
  async function applyPending(plan: JevPendingPlan): Promise<void> {
    try {
      const { ops } = await resolvePlanned(plan);
      const result = await applyPlannedOps(
        plan.sessionId,
        plan.cwd,
        ops,
        (capability, desired) => writeOneWithReadyRetry(plan.sessionId, plan.cwd, capability, desired),
        // 冷会话激活路径保留逐条 + 就绪重试语义（批量端点没有逐条重试）。
        false,
      );
      if (!result.ok) {
        const errors = result.errors.map((text) => redact(text, []));
        recordOutcome(plan.sessionId, { applied: 0, failed: ops.length, errors, at: now() });
        logger?.warn?.(
          `capability-panel: Jev 排队能力激活失败（session ${plan.sessionId}）：${errors.join("; ") || "unknown"}`,
        );
        return;
      }
      recordOutcome(plan.sessionId, { applied: result.written.length, failed: 0, errors: [], at: now() });
    } catch (error) {
      const errors = [redact(errMessage(error), [])];
      recordOutcome(plan.sessionId, { applied: 0, failed: plan.ops.length, errors, at: now() });
      logger?.warn?.(`capability-panel: Jev 排队能力应用异常（session ${plan.sessionId}）：${errors.join("; ")}`);
    }
  }

  /** 激活路径的写入：对「服务未就绪」类错误短重试 2 次（100ms / 300ms）。 */
  async function writeOneWithReadyRetry(
    sessionId: string,
    cwd: string | undefined,
    capability: JevCapability,
    desired: boolean,
  ): Promise<WriteResult> {
    let result = await writeOne(deps, sessionId, cwd, capability, desired);
    if (result.ok) return result;
    for (const delay of READY_RETRY_DELAYS_MS) {
      const retryable = result.errors.some(isReadyError);
      if (!retryable) return result;
      await sleep(delay);
      result = await writeOne(deps, sessionId, cwd, capability, desired);
      if (result.ok) return result;
    }
    return result;
  }

  // —— 生命周期监听 ——

  function onAgentCreated(payload: { agent?: { id?: unknown } } | null | undefined): void {
    if (disposed) return;
    const sessionId = payload?.agent?.id;
    if (typeof sessionId !== "string") return;
    const plan = pendingPlans.get(sessionId);
    if (plan === undefined) return;
    // 先取走，避免同一 session 重复应用。
    pendingPlans.delete(sessionId);
    // 延后一个宏任务：让同一事件的其它监听（mcp/loader 的 mountAgent 等）
    // 先完成登记，否则 mcp.setSessionEnabled 找不到 session record。
    setTimeout(() => {
      if (disposed) return;
      void applyPending(plan);
    }, 0);
  }

  function onAgentDisposed(payload: { agent?: { id?: unknown } } | null | undefined): void {
    const sessionId = payload?.agent?.id;
    if (typeof sessionId !== "string") return;
    // 会话都没了：清排队计划与待回报结果，避免泄漏。
    pendingPlans.delete(sessionId);
    pendingOutcomes.delete(sessionId);
  }

  if (typeof deps.ctx.on === "function") {
    const offCreated = deps.ctx.on("agent/created", onAgentCreated as (payload: any) => void);
    if (typeof offCreated === "function") listeners.push(offCreated as () => void);
    const offDisposed = deps.ctx.on("agent/disposed", onAgentDisposed as (payload: any) => void);
    if (typeof offDisposed === "function") listeners.push(offDisposed as () => void);
  }

  // —— apply 主体 ——

  /**
   * `jev.apply`：**筛选语义**（只改当前会话开关，不动项目默认）。
   *
   * plan 是「已勾选」项（`enabled:true`）；**允许空数组** —— 表示目标集合为空，
   * 即关闭当前会话全部可应用能力（task-52，阈值筛出 0 项时也能应用）。宿主枚举
   * 当前会话全部能力后：
   *   - 可应用能力里 selected → 目标启用，未 selected → 目标关闭；
   *   - 只写状态不一致的（两阶段批量/并发：先 enable 后 disable），任一失败按前态
   *     逆序批量回滚全部已写项；
   *   - 不可应用项一律不动；
   *   - 冷会话只把目标集合入队（含关闭），`agent/created` 后重放。
   */
  async function apply(input: unknown): Promise<JevApplyResult> {
    if (disposed) return { ok: false, code: "write-failed", errors: ["jev manager disposed"] };

    const payload =
      input !== null && typeof input === "object" && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : {};
    const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
    if (sessionId.length === 0) {
      return { ok: false, code: "bad-request", errors: ["sessionId is required"] };
    }
    const cwd = typeof payload.cwd === "string" && payload.cwd.length > 0 ? payload.cwd : undefined;
    const plan = payload.plan;
    // 空数组合法（task-52：目标集合为空 = 关闭全部可应用能力）；非数组或过量仍拒绝。
    if (!Array.isArray(plan) || plan.length > MAX_APPLY_PLAN_ITEMS) {
      return { ok: false, code: "bad-request", errors: ["plan must be an array (<=500)"] };
    }

    // 计时覆盖「枚举 + 批量写入」的整段 apply（客户端可观测；additive elapsedMs）。
    const applyStartedAt = performance.now();
    const live = isLive(sessionId);
    let caps: JevCapability[];
    try {
      caps = await enumerate({ cwd, sessionId, live });
    } catch (error) {
      return { ok: false, code: "write-failed", errors: [redact(errMessage(error), [])] };
    }
    const byId = new Map(caps.map((cap) => [cap.id, cap]));

    // 1) 解析勾选集合（只信任 id）：非法/未知/非启用/不可应用 → skipped。
    const selectedIds = new Set<string>();
    const invalidSkips: JevApplySkipped[] = [];
    for (const rawItem of plan) {
      const item =
        rawItem !== null && typeof rawItem === "object" && !Array.isArray(rawItem)
          ? (rawItem as Partial<JevApplyPlanItem>)
          : {};
      const cap = isCapabilityId(item.id) ? byId.get(item.id) : undefined;
      if (cap === undefined || item.enabled !== true) {
        invalidSkips.push({ id: typeof item.id === "string" ? item.id : "", reason: "unknown-id" });
        continue;
      }
      // 冷会话例外（§7.3）：not-toggleable 只在 live 会话下作为不可应用原因。
      if (!cap.applicable && !(live === false && cap.reason === "not-toggleable")) {
        invalidSkips.push({ id: cap.id, reason: (cap.reason ?? "not-toggleable") as JevApplySkipReason });
        continue;
      }
      selectedIds.add(cap.id);
    }

    // 2) 筛选语义：只对可应用能力算目标态，只写状态不一致的。
    const { ops, consistent } = planTargetOps(caps, selectedIds);
    const skipped: JevApplySkipped[] = [...invalidSkips, ...consistent];

    // 3) 冷会话：存完整目标集合（含关闭），激活后按 id 重放。
    if (!live) {
      const targets = caps
        .filter((cap) => cap.applicable)
        .map((cap) => ({ id: cap.id, desired: selectedIds.has(cap.id) }));
      queuePendingPlan({ sessionId, cwd, createdAt: now(), ops: targets, skipped: [...invalidSkips] });
      const outcome = consumePendingOutcome(sessionId);
      const result: JevApplyResult = {
        ok: true,
        applied: 0,
        enabled: 0,
        disabled: 0,
        skipped,
        pending: true,
        elapsedMs: Math.round(performance.now() - applyStartedAt),
      };
      if (outcome !== undefined) result.pendingOutcome = outcome;
      return result;
    }

    // 4) live：两阶段批量写（先 enable 后 disable；skills/MCP 走批量端点 =
    //    一次目录发现 + 一次落盘 + 一次重挂，Tools 分组批量）；任一失败按前态
    //    逆序批量回滚全部已写项。
    const enumerateMs = Math.round(performance.now() - applyStartedAt);
    const writeStartedAt = performance.now();
    const writeResult = await applyPlannedOps(
      sessionId,
      cwd,
      ops,
      (capability, desired) => writeOne(deps, sessionId, cwd, capability, desired),
      true,
    );
    const writeMs = Math.round(performance.now() - writeStartedAt);
    const outcome = consumePendingOutcome(sessionId);
    // 慢 apply 诊断：>800ms 才 warn（正常路径批量写入应在百毫秒级）。
    const totalMs = Math.round(performance.now() - applyStartedAt);
    if (totalMs >= SLOW_APPLY_WARN_MS) {
      const skillsCount = ops.filter((op) => op.cap.write.type === "skills").length;
      logger?.warn?.(
        `capability-panel: Jev apply 较慢 ${totalMs}ms（枚举 ${enumerateMs}ms / 写入 ${writeMs}ms，skills ${skillsCount} 条，写入 ${writeResult.written.length} 项）`,
      );
    }
    if (!writeResult.ok) {
      const errors = writeResult.errors.map((text) => redact(text, []));
      const failure: JevApplyResult = {
        ok: true,
        applied: 0,
        enabled: 0,
        disabled: 0,
        skipped,
        pending: false,
        failed: [
          {
            id: writeResult.failedId,
            reason: writeResult.rollbackFailed ? "write-failed（回滚部分失败）" : "write-failed",
          },
        ],
        errors,
      };
      if (outcome !== undefined) failure.pendingOutcome = outcome;
      return failure;
    }

    const enabled = writeResult.written.filter((op) => op.desired).length;
    const disabled = writeResult.written.length - enabled;
    const success: JevApplyResult = {
      ok: true,
      applied: writeResult.written.length,
      enabled,
      disabled,
      skipped,
      pending: false,
      elapsedMs: Math.round(performance.now() - applyStartedAt),
    };
    if (outcome !== undefined) success.pendingOutcome = outcome;
    return success;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const off of listeners) {
      try {
        off();
      } catch {
        /* 监听移除失败不阻断卸载 */
      }
    }
    listeners.length = 0;
    pendingPlans.clear();
    pendingOutcomes.clear();
  }

  return {
    enumerate,
    isSessionLive: isLive,
    apply,
    consumePendingOutcome,
    pendingCount: () => pendingPlans.size,
    dispose,
  };
}
