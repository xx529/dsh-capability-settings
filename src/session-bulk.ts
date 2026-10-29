/**
 * R1 批量端点 `session.setBulk`：三域（Skills / MCP / Tools）一次开 / 关 / 恢复默认。
 *
 * 方案：`docs/architecture/v13-implementation.md` §6（唯一权威）。
 *
 * 契约要点（不得偏离）：
 *
 *   - 传输层信封恒 `{ok:true,value}`（`remote.ts` 文件头）；本模块的**业务失败**
 *     也返回 `{ok:false, errors}` 放在 value 里，绝不抛到通道层。
 *   - **幂等**：同一 `action` 重放 → `applied:0` + `unchanged:N`（不重复写盘）。
 *   - **按会话串行**：同 session 的批量请求排队（重复调用排队而非拒绝）；
 *     不同 session 互不影响。
 *   - **部分失败不回滚**（A7）：某条失败只进 `failed[]`，已成功的保留；
 *     重试 = 重放同一 action（已成功项进 `unchanged`）。
 *   - **宿主自己枚举**：客户端不传目标列表（避免与宿主枚举口径漂移）。
 *   - 写盘批量化：mcp / tools 一次落盘（`state.setToggles` / loader 批量方法），
 *     skills 保持逐条（shadow 注册本来就必须逐条）；restrict 只重算一次。
 *
 * @module dsh-capability-settings/session-bulk
 */

import { errMessage } from "./shared/errors.js";
import type { McpLoader } from "./mcp/loader.js";
import type { McpListResult, McpRuntimeView } from "./mcp/types.js";
import type { SessionStateStore } from "./session-state.js";
import type { SessionSkillOpResult, SessionSkillView } from "./skills/session.js";
import type { ToolsListView, ToolsSetSessionResult } from "./tools/types.js";

/** 三域的域名（顺序固定 `skills → mcp → tools`）。 */
export type SessionBulkDomain = "skills" | "mcp" | "tools";

/** 目标态：enable=全部打开；disable=全部关闭；reset=清除显式会话覆盖（回默认）。 */
export type SessionBulkAction = "enable" | "disable" | "reset";

/** 逐项失败（不阻断其它项）。 */
export interface SessionBulkFailure {
  domain: SessionBulkDomain;
  /** skills = skill 名；mcp = target（项目 key / serverName）；tools = unit id。 */
  target: string;
  /** 细分种类，便于 UI 只重试某类。 */
  kind: "skill" | "mcp-project" | "mcp-server" | "plugin";
  error: string;
}

/** 单域统计。 */
export interface SessionBulkDomainStat {
  changed: number;
  unchanged: number;
  skipped: number;
  failed: number;
}

/** `session.setBulk` 入参（缺省 = 三域全部）。 */
export interface SessionBulkInput {
  /** 必填；空 → 业务失败。 */
  sessionId: string;
  action: SessionBulkAction;
  /** 缺省 = 三域全部；客户端按域串行调用以取得粗粒度进度。 */
  domains?: SessionBulkDomain[];
  /** 项目作用域（skills 列表 / mcp 项目条目需要）；缺省由宿主从 session header.cwd 解析。 */
  cwd?: string;
  /** 仅测试/诊断：只计算不写入，返回将改变的数量。 */
  dryRun?: boolean;
}

/** `session.setBulk` 成功 value。 */
export interface SessionBulkResult {
  ok: true;
  action: SessionBulkAction;
  /** 状态实际改变数（dryRun 时为「将要改变」数）。 */
  applied: number;
  /** 已是目标态、无需写入。 */
  unchanged: number;
  /** 不可参与（locked / 非 live 的 skills / 无 deny 名单的插件）。 */
  skipped: number;
  /** 逐项失败（不阻断其它项）。 */
  failed: SessionBulkFailure[];
  byDomain: Record<SessionBulkDomain, SessionBulkDomainStat>;
  /** 非 live 会话里仍有只落盘写入的域（mcp/tools）时的提示位。 */
  coldSession?: boolean;
  elapsedMs: number;
}

/** 业务失败支（放在传输层 `{ok:true, value}` 里）。 */
export interface SessionBulkFailureResult {
  ok: false;
  errors: string[];
}

/** 批量端点依赖的三域服务（结构子集，避免与组合根循环 import）。 */
export interface SessionBulkServices {
  skills: {
    sessionList(cwd?: string, sessionId?: string): Promise<SessionSkillView[]>;
    setSessionEnabled(input: { sessionId: string; name: string; enabled?: boolean }): Promise<SessionSkillOpResult>;
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
    }): Promise<{ ok: true } | { ok: false; errors: string[] }>;
  };
  tools: {
    list(input: { sessionId?: string }): Promise<ToolsListView>;
    setSessionEnabled(input: {
      sessionId: string;
      units: string[];
      enabled: boolean | undefined;
    }): Promise<ToolsSetSessionResult>;
  };
}

/** 构造依赖。 */
export interface SessionBulkDeps {
  /** 宿主上下文（只用到 `get("agents")`）。 */
  ctx: any;
  /** 会话级开关存储（批量落盘 + `entries()` 读显式名单）。 */
  state?: SessionStateStore;
  /** MCP loader（批量写 + 显式开关快照）。 */
  loader: McpLoader;
  /** 三域服务（延迟求值，避免与组合根构造顺序耦合）。 */
  service: () => SessionBulkServices | undefined;
  logger?: { warn?(message: string): void };
  /** 时钟注入（测试用；缺省 `Date.now`）。 */
  now?: () => number;
}

/** 批量端点（挂到 `ctx.capabilityPanel.session`）。 */
export interface SessionBulk {
  setBulk(input: unknown): Promise<SessionBulkResult | SessionBulkFailureResult>;
}

/** 三域固定顺序（方案 §6.2-6）。 */
const DOMAIN_ORDER: readonly SessionBulkDomain[] = ["skills", "mcp", "tools"];

/** 空统计。 */
function emptyStat(): SessionBulkDomainStat {
  return { changed: 0, unchanged: 0, skipped: 0, failed: 0 };
}

/** 解析入参；非法形状归业务失败。 */
function parseInput(input: unknown): { ok: true; value: SessionBulkInput } | SessionBulkFailureResult {
  const payload =
    input !== null && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
  if (sessionId.length === 0) return { ok: false, errors: ["sessionId is required"] };
  const action = payload.action;
  if (action !== "enable" && action !== "disable" && action !== "reset") {
    return { ok: false, errors: ['action must be one of "enable" | "disable" | "reset"'] };
  }
  const result: SessionBulkInput = { sessionId, action };
  if (payload.domains !== undefined) {
    if (!Array.isArray(payload.domains) || payload.domains.length === 0) {
      return { ok: false, errors: ["domains must be a non-empty array"] };
    }
    const seen = new Set<SessionBulkDomain>();
    for (const raw of payload.domains) {
      if (raw !== "skills" && raw !== "mcp" && raw !== "tools") {
        return { ok: false, errors: [`unknown domain ${JSON.stringify(raw)}`] };
      }
      seen.add(raw);
    }
    // 固定顺序：skills → mcp → tools（与客户端串行调用口径一致）。
    result.domains = DOMAIN_ORDER.filter((domain) => seen.has(domain));
  }
  if (typeof payload.cwd === "string" && payload.cwd.length > 0) result.cwd = payload.cwd;
  if (payload.dryRun === true) result.dryRun = true;
  return { ok: true, value: result };
}

/** 构造批量端点实现（组合根单例）。 */
export function createSessionBulk(deps: SessionBulkDeps): SessionBulk {
  const logger = deps.logger;
  const now = deps.now ?? (() => Date.now());
  /** 同 session 串行队列（方案 §6.3）。 */
  const queues = new Map<string, Promise<unknown>>();

  /** 当前 live agent 列表（异常降级为空）。 */
  function agents(): any[] {
    try {
      const list = deps.ctx?.get?.("agents")?.list?.();
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  /** 磁盘会话记录里的显式覆盖名单（冷启动时 state 尚未 ready 的调用方需先 ready）。 */
  function storedToggle(sessionId: string, domain: "skills" | "mcp"): Record<string, boolean> {
    try {
      return { ...(deps.state?.entries()[sessionId]?.[domain] ?? {}) };
    } catch {
      return {};
    }
  }

  /** loader 的会话显式开关快照（内存权威；失败降级为空）。 */
  function loaderToggle(sessionId: string): Record<string, boolean> {
    try {
      return deps.loader.sessionToggleState(sessionId) ?? {};
    } catch {
      return {};
    }
  }

  /** skills 域：冷会话不可写（`setEnabled` 返回 session not found）→ 记 skipped。 */
  async function runSkills(
    services: SessionBulkServices,
    input: {
      sessionId: string;
      action: SessionBulkAction;
      cwd?: string;
      live: boolean;
      dryRun: boolean;
    },
    failed: SessionBulkFailure[],
    stat: SessionBulkDomainStat,
  ): Promise<void> {
    const rows = (await services.skills.sessionList(input.cwd, input.sessionId)) ?? [];
    const explicit = input.action === "reset" ? storedToggle(input.sessionId, "skills") : {};
    /** 需要写入的名字（先算完再**同一 tick 全部发起**，方案 §6.3 域内不加额外限流）。 */
    const targets: string[] = [];
    for (const row of rows) {
      if (row.shadowStub === true) continue;
      if (input.action === "reset") {
        // reset：只清「有显式覆盖」的名字（磁盘记录里的键）。
        if (!Object.hasOwn(explicit, row.name)) continue;
      } else {
        const desired = input.action === "enable";
        // enabledInSession 缺省按"启用"读（与列表语义一致）。
        if ((row.enabledInSession !== false) === desired) {
          stat.unchanged += 1;
          continue;
        }
      }
      if (row.canToggleInSession !== true || !input.live) {
        // 冷会话：技能开关需要 live agent（skills/session.ts 明确拒绝）。
        stat.skipped += 1;
        continue;
      }
      targets.push(row.name);
    }
    if (targets.length === 0) return;
    if (input.dryRun) {
      stat.changed += targets.length;
      return;
    }
    // 同一 tick 全部发起（每条仍由 skills/session 的 per-session 队列串行落盘）；
    // 逐条 shadow 注册本来就必须逐条，但能避免 N 次事件循环往返。
    const settled = await Promise.allSettled(
      targets.map((name) =>
        services.skills.setSessionEnabled(
          input.action === "reset"
            ? { sessionId: input.sessionId, name, enabled: undefined }
            : { sessionId: input.sessionId, name, enabled: input.action === "enable" },
        ),
      ),
    );
    settled.forEach((result, index) => {
      const name = targets[index]!;
      if (result.status === "rejected") {
        stat.failed += 1;
        failed.push({ domain: "skills", target: name, kind: "skill", error: errMessage(result.reason) });
        return;
      }
      if (result.value !== undefined && result.value.ok === false) {
        stat.failed += 1;
        failed.push({
          domain: "skills",
          target: name,
          kind: "skill",
          error: (result.value.errors ?? []).join("; ") || "unknown error",
        });
        return;
      }
      stat.changed += 1;
    });
  }

  /** mcp 域：配置条目 + 运行时注入实例；enable 写显式 true（不是清覆盖）。 */
  async function runMcp(
    services: SessionBulkServices,
    input: { sessionId: string; action: SessionBulkAction; cwd?: string; dryRun: boolean },
    failed: SessionBulkFailure[],
    stat: SessionBulkDomainStat,
  ): Promise<void> {
    type Entry = { target: string; kind: "project" | "server"; enabled: boolean | undefined };
    const entries: Entry[] = [];
    if (input.action === "reset") {
      // 只清有显式覆盖的键；无覆盖项不变（mcp 项目默认仍生效）。
      const toggles = { ...storedToggle(input.sessionId, "mcp"), ...loaderToggle(input.sessionId) };
      for (const key of Object.keys(toggles)) {
        if (key.startsWith("server:")) entries.push({ target: key.slice("server:".length), kind: "server", enabled: undefined });
        else if (key.startsWith("project:")) {
          entries.push({ target: key.slice("project:".length), kind: "project", enabled: undefined });
        }
      }
    } else {
      const desired = input.action === "enable";
      const list = await services.mcp.list(input.cwd, input.sessionId);
      const configured = new Set((list?.servers ?? []).map((server) => server.serverName));
      for (const row of list?.servers ?? []) {
        if (row.shadowed === true) continue;
        const current = typeof row.enabledInSession === "boolean" ? row.enabledInSession : row.disabledInProject !== true;
        if (current === desired) {
          stat.unchanged += 1;
          continue;
        }
        // 硬关闭（配置文件 disabled / 禁用态引用）不接受会话开关。
        if (row.enabled === false) {
          stat.skipped += 1;
          continue;
        }
        entries.push({
          target: row.scope === "project" ? row.key : row.serverName,
          kind: row.scope === "project" ? "project" : "server",
          enabled: desired,
        });
      }
      const runtime = await services.mcp.runtime({
        ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
        sessionId: input.sessionId,
      });
      for (const view of runtime?.servers ?? []) {
        // 与配置条目同名时以配置条目为准（与 manager.runtime / Jev 枚举同口径）。
        if (configured.has(view.serverName)) continue;
        const current = typeof view.enabledInSession === "boolean" ? view.enabledInSession : view.disabledInProject !== true;
        if (current === desired) {
          stat.unchanged += 1;
          continue;
        }
        // 运行时注入且不可 restrict 的实例不参与（方案 §6.2-3）。
        if (view.restrictable !== true) {
          stat.skipped += 1;
          continue;
        }
        entries.push({ target: view.serverName, kind: "server", enabled: desired });
      }
    }
    if (entries.length === 0) return;
    if (input.dryRun) {
      stat.changed += entries.length;
      return;
    }
    try {
      // 一次 hydrate → 写全部 toggle → 一次重挂（不是逐条）。
      await deps.loader.setSessionEnabledMany({
        sessionId: input.sessionId,
        ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
        entries,
      });
      stat.changed += entries.length;
    } catch (error) {
      stat.failed += entries.length;
      for (const entry of entries) {
        failed.push({
          domain: "mcp",
          target: entry.target,
          kind: entry.kind === "project" ? "mcp-project" : "mcp-server",
          error: errMessage(error),
        });
      }
    }
  }

  /** tools 域：插件单元级（含未识别单元）；locked 不参与。 */
  async function runTools(
    services: SessionBulkServices,
    input: { sessionId: string; action: SessionBulkAction; dryRun: boolean },
    failed: SessionBulkFailure[],
    stat: SessionBulkDomainStat,
  ): Promise<void> {
    const view = await services.tools.list({ sessionId: input.sessionId });
    const units: string[] = [];
    const desired = input.action === "enable";
    for (const unit of view?.units ?? []) {
      if (input.action === "reset") {
        if (unit.explicit === true) units.push(unit.unit);
        continue;
      }
      if (unit.lockedReason !== undefined) {
        stat.skipped += 1;
        continue;
      }
      if (unit.enabledInSession === desired) {
        stat.unchanged += 1;
        continue;
      }
      units.push(unit.unit);
    }
    if (units.length === 0) return;
    if (input.dryRun) {
      stat.changed += units.length;
      return;
    }
    try {
      // batch-first：一次写盘 + 一次 restrict 重算。
      const result = await services.tools.setSessionEnabled({
        sessionId: input.sessionId,
        units,
        enabled: input.action === "reset" ? undefined : desired,
      });
      if (result.ok === false) {
        stat.failed += units.length;
        for (const unit of units) {
          failed.push({ domain: "tools", target: unit, kind: "plugin", error: result.errors.join("; ") || "unknown error" });
        }
      } else {
        stat.changed += result.applied;
        stat.unchanged += Math.max(0, units.length - result.applied);
      }
    } catch (error) {
      stat.failed += units.length;
      for (const unit of units) {
        failed.push({ domain: "tools", target: unit, kind: "plugin", error: errMessage(error) });
      }
    }
  }

  /** 执行本体（永不 reject：失败收进返回值）。 */
  async function execute(input: SessionBulkInput): Promise<SessionBulkResult | SessionBulkFailureResult> {
    const services = deps.service();
    if (services === undefined) return { ok: false, errors: ["capability-panel service unavailable"] };
    const startedAt = now();
    const { sessionId, action } = input;
    // 冷启动首批请求：先等读盘完成，再读显式覆盖名单（否则会误判"无显式覆盖"）。
    if (deps.state !== undefined) await deps.state.ready();
    const liveAgents = agents();
    const live = liveAgents.some((agent) => agent?.id === sessionId);
    const headerCwd = liveAgents.find((agent) => agent?.id === sessionId)?.session?.header?.cwd;
    const cwd = input.cwd ?? (typeof headerCwd === "string" && headerCwd.length > 0 ? headerCwd : undefined);
    const dryRun = input.dryRun === true;
    const failed: SessionBulkFailure[] = [];
    const byDomain: Record<SessionBulkDomain, SessionBulkDomainStat> = {
      skills: emptyStat(),
      mcp: emptyStat(),
      tools: emptyStat(),
    };
    const domains = input.domains ?? [...DOMAIN_ORDER];

    for (const domain of domains) {
      try {
        if (domain === "skills") {
          await runSkills(services, { sessionId, action, ...(cwd !== undefined ? { cwd } : {}), live, dryRun }, failed, byDomain.skills);
        } else if (domain === "mcp") {
          await runMcp(services, { sessionId, action, ...(cwd !== undefined ? { cwd } : {}), dryRun }, failed, byDomain.mcp);
        } else {
          await runTools(services, { sessionId, action, dryRun }, failed, byDomain.tools);
        }
      } catch (error) {
        // 域级异常：本域整体记失败，不阻断其它域（失败不回滚）。
        const stat = byDomain[domain];
        stat.failed += 1;
        failed.push({
          domain,
          target: domain,
          kind: domain === "skills" ? "skill" : domain === "mcp" ? "mcp-server" : "plugin",
          error: errMessage(error),
        });
        logger?.warn?.(`capability-panel: session.setBulk ${domain} 域失败（session ${sessionId}）：${errMessage(error)}`);
      }
    }

    return {
      ok: true,
      action,
      applied: byDomain.skills.changed + byDomain.mcp.changed + byDomain.tools.changed,
      unchanged: byDomain.skills.unchanged + byDomain.mcp.unchanged + byDomain.tools.unchanged,
      skipped: byDomain.skills.skipped + byDomain.mcp.skipped + byDomain.tools.skipped,
      failed,
      byDomain,
      ...(live ? {} : { coldSession: true }),
      elapsedMs: Math.max(0, now() - startedAt),
    };
  }

  return {
    async setBulk(input: unknown): Promise<SessionBulkResult | SessionBulkFailureResult> {
      const parsed = parseInput(input);
      if (!parsed.ok) return parsed;
      const { sessionId } = parsed.value;
      const previous = queues.get(sessionId) ?? Promise.resolve();
      // 同 session 排队：前一个失败也不影响后一个开始。
      const run = previous.then(
        () => execute(parsed.value),
        () => execute(parsed.value),
      );
      const tracked: Promise<unknown> = run.then(
        () => undefined,
        () => undefined,
      );
      queues.set(sessionId, tracked);
      try {
        return await run;
      } finally {
        if (queues.get(sessionId) === tracked) queues.delete(sessionId);
      }
    },
  };
}
