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
 *   - 复制的是父会话的**显式覆盖**（不是项目 / 全局默认）。
 *
 * 时序：本模块必须在 skills / mcp / tools 的 `agent/created` 监听器之前创建，
 * 这样监听器（被 cordis serial await）先把快照写进 child 的会话记录，三个域
 * 后续 hydrate 时就能读到同一份快照，无需 owner 投影或热传播。动态选择的
 * 打分在父侧 `tools/pre-execute` 完成（见 `derive/auto-select.ts`），这里只消费
 * 结果并 seed；三域的最终收敛由 auto-select 的晚期监听器 await。
 *
 * @module dsh-capability-settings/derive/manager
 */

import { findProjectRoot } from "../shared/project-root.js";
import { errMessage } from "../shared/errors.js";
import { DEFAULT_DYNAMIC_THRESHOLD, dynamicInfoOf } from "./auto-select.js";
import type { DynamicPlan, DynamicSelectHost } from "./auto-select.js";
import type { DeriveMode, DerivedDynamicInfo, SessionStateMeta, SessionStateStore } from "../session-state.js";

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
  getSkillSessions?: () =>
    | {
        trackAgent(agent: any): void;
        setEnabledBatch(input: {
          sessionId: string;
          entries: ReadonlyArray<{ name: string; enabled: boolean }>;
        }): Promise<{ ok: boolean; errors: string[] }>;
      }
    | undefined;
  /**
   * v24 动态选择：惰性访问器（组合根在 skills / mcp / tools 之后才构造完整模块，
   * 但 `agent/created` 事件发生在插件装配完成之后）。
   */
  dynamic?: () => DynamicSelectHost | undefined;
}

/** 生命周期句柄。 */
export interface DeriveInheritance {
  /** 移除 `agent/created` 监听。 */
  dispose(): void;
}

/** 从 agent 读会话 header 创建时间（防 sessionId 复用）。 */
function headerCreatedAtOf(agent: any): number | undefined {
  const value = agent?.session?.header?.createdAt;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** 会话记录落盘元数据（cwd 仅诊断，headerCreatedAt 防 id 复用）。 */
function metaOf(agent: any): SessionStateMeta {
  const header = agent?.session?.header;
  const meta: SessionStateMeta = {};
  if (typeof header?.cwd === "string" && header.cwd.length > 0) meta.cwd = header.cwd;
  const createdAt = headerCreatedAtOf(agent);
  if (createdAt !== undefined) meta.headerCreatedAt = createdAt;
  return meta;
}

/** 宿主 skill 摘要的最小形状（只读快照用）。 */
interface SkillSnapshotEntry {
  name?: unknown;
  description?: unknown;
  invocation?: { modelInvocable?: unknown; userInvocable?: unknown };
}

/** 本插件 shadow 的描述（与 skills/registry.ts 的 SHADOW_DESCRIPTION 同值）。 */
const SHADOW_DESCRIPTION = "本会话已禁用（capability-panel）";

/** 是否为模型实际可见的 skill（排除本插件 shadow / 文件级硬禁用项）。 */
function isVisibleSkill(entry: SkillSnapshotEntry): entry is { name: string } {
  if (typeof entry?.name !== "string" || entry.name.length === 0) return false;
  if (entry.description === SHADOW_DESCRIPTION) return false;
  const invocation = entry.invocation;
  if (invocation !== undefined && invocation.modelInvocable === false) return false;
  return true;
}

/**
 * 读某个 agent 作用域下的**模型可见** skill 名集合。
 *
 * 用宿主 `skills.snapshot({scope: agent})` 而不是插件自己的 list：它已经合并
 * global / 祖先 / 当前 preset 层，并应用了该 agent 作用域上的 shadow（父会话
 * 关闭的 skill 不会出现在父级可见集合里）。失败返回 undefined，由调用方回落
 * 到「复制父级显式开关」的旧策略。
 */
async function visibleSkillNames(ctx: any, agent: any, cwd: string | undefined): Promise<Set<string> | undefined> {
  try {
    const skills = ctx.get?.("skills");
    if (skills === undefined || typeof skills.snapshot !== "function") return undefined;
    const snapshot = await skills.snapshot({ ...(cwd !== undefined ? { cwd } : {}), scope: agent });
    if (snapshot === null || typeof snapshot !== "object" || !Array.isArray(snapshot.skills)) return undefined;
    const names = new Set<string>();
    for (const entry of snapshot.skills as SkillSnapshotEntry[]) {
      if (isVisibleSkill(entry)) names.add(entry.name);
    }
    return names;
  } catch {
    return undefined;
  }
}

/**
 * 解析「继承会话」是否仍可安全复制。
 *
 * 父 / 子 cwd 都属于同一个项目根时才复制会话覆盖；不同项目根的 MCP
 * `project:<key>` / 项目默认不同，跨项目复制会串味，此时降级为
 * `workspace`（子级按自己的项目默认启动）。
 */
function effectiveMode(
  mode: DeriveMode,
  childCwd: string | undefined,
  parentCwd: string | undefined,
): DeriveMode {
  if (mode !== "session") return mode;
  if (childCwd === undefined || parentCwd === undefined) return mode;
  try {
    return findProjectRoot(childCwd) === findProjectRoot(parentCwd) ? mode : "workspace";
  } catch {
    return mode;
  }
}

/** 三域开关快照（`session` 继承 / 动态回退共用）。 */
interface DerivedToggles {
  skills: Record<string, boolean>;
  mcp: Record<string, boolean>;
  tools: Record<string, boolean>;
}

/**
 * 计算「继承会话」的开关快照：父会话显式覆盖 + 技能目录投影。
 *
 * 技能投影是 2026-10-30 的关键修正：父会话的技能目录在升级 / 换 preset 后会
 * 变化，只复制显式开关会让 child 的 150+ 个新技能保持默认开启。这里按「父会话
 * 模型可见集合」投影到 child 自己的可见目录，保证两边范围一致。
 */
async function sessionTogglesFor(input: {
  ctx: any;
  state: SessionStateStore;
  logger?: DeriveInheritanceLogger;
  parentId: string;
  parentAgent: any;
  parentCwd: string | undefined;
  childAgent: any;
  childCwd: string | undefined;
}): Promise<DerivedToggles> {
  let toggles: DerivedToggles = {
    skills: { ...input.state.skills(input.parentId) },
    mcp: { ...input.state.mcp(input.parentId) },
    tools: { ...input.state.tools(input.parentId) },
  };
  if (input.parentAgent !== undefined) {
    const [parentNames, childNames] = await Promise.all([
      visibleSkillNames(input.ctx, input.parentAgent, input.parentCwd),
      visibleSkillNames(input.ctx, input.childAgent, input.childCwd),
    ]);
    if (parentNames !== undefined && childNames !== undefined) {
      const projected: Record<string, boolean> = {};
      for (const name of childNames) projected[name] = parentNames.has(name);
      /**
       * 父会话里被显式关闭、但**不在 child 当时可见集合**里的名字（典型：
       * user-invocable-only 技能、或 agent/created 时 child 技能目录尚未就绪）
       * 不能漏掉：否则 child 会落回工作区默认（开启），出现「父 0 / 子 3」。
       * 这里只补父级显式 false 的缺失名字（不把父级 true 投影成 ghost）。
       */
      for (const [name, enabled] of Object.entries(input.state.skills(input.parentId))) {
        if (enabled === false && projected[name] === undefined) projected[name] = false;
      }
      toggles = { ...toggles, skills: projected };
    } else {
      input.logger?.warn?.("capability-panel: 派生继承读取技能目录失败，回落到复制父级显式开关");
    }
  }
  return toggles;
}

/** 空开关快照。 */
function emptyToggles(): DerivedToggles {
  return { skills: {}, mcp: {}, tools: {} };
}

/** 动态选择缺失时的合成 fallback 计划（只用于生成只读展示信息）。 */
function missingDynamicPlan(parentId: string): DynamicPlan {
  return {
    parentSessionId: parentId,
    status: "fallback",
    reason: "missing",
    threshold: DEFAULT_DYNAMIC_THRESHOLD,
    selected: 0,
    total: 0,
    counts: { skills: 0, mcp: 0, tools: 0 },
    toggles: { skills: {}, mcp: {}, tools: {} },
    skillEntries: [],
    mcpEntries: [],
    toolUnits: { enabled: [], disabled: [] },
    at: Date.now(),
  };
}

/**
 * 创建派生继承监听器。
 *
 * 监听器内部**绝不抛错**，也不阻塞子 agent 首轮之外的其它路径；任何失败只
 * warn 并按 `workspace` 语义降级（子 agent 仍可创建）。
 */
export function createDeriveInheritance(ctx: any, deps: DeriveInheritanceDeps): DeriveInheritance {
  const { state, logger } = deps;
  let disposed = false;

  /**
   * `agent/created` 处理：只在“新创建”的派生会话上写一次快照。
   */
  async function onCreated(agent: any, source: unknown): Promise<void> {
    if (disposed) return;
    // 只有新创建才继承；resume / 其它来源一律不复刻（child 记录已持久化）。
    if (source !== "startup") return;
    const header = agent?.session?.header;
    const childId = typeof agent?.id === "string" ? agent.id : undefined;
    const parentId = typeof header?.parentSession === "string" ? header.parentSession : undefined;
    if (childId === undefined || parentId === undefined) return;

    await state.ready();

    // 已经写过派生快照（例如同一 agent 被重复 announce）⇒ 保留第一次结果。
    if (state.derivedInfo(childId) !== undefined) return;

    const mode = state.deriveMode(parentId);
    const meta = metaOf(agent);
    const childCwd = typeof header?.cwd === "string" ? header.cwd : undefined;
    let parentAgent: any;
    let parentCwd: string | undefined;
    try {
      parentAgent = ctx.get?.("agents")?.get?.(parentId);
      const liveCwd = parentAgent?.session?.header?.cwd;
      if (typeof liveCwd === "string" && liveCwd.length > 0) parentCwd = liveCwd;
    } catch {
      /* agents 服务缺失：退回落盘 cwd */
    }
    if (parentCwd === undefined) {
      const recordCwd = state.entries()[parentId]?.cwd;
      if (typeof recordCwd === "string" && recordCwd.length > 0) parentCwd = recordCwd;
    }

    const dynamicHost = deps.dynamic?.();
    let recordMode: DeriveMode;
    let toggles: DerivedToggles = emptyToggles();
    let dynamicInfo: DerivedDynamicInfo | undefined;
    let dynamicPlan: DynamicPlan | undefined;

    if (mode === "dynamic") {
      recordMode = "dynamic";
      const plan = dynamicHost?.consume(agent, parentId);
      if (plan?.status === "ok") {
        /**
         * 和工作区基线枚举相比，child 自己的技能目录可能因 `agentPreset` 不同而
         * 增减；沿用「派生继承会话」的投影原则：以 child 可见技能为准，计划里
         * 选中 → true、其余 child 可见技能 → false（父 / 子范围一致，且不写幽灵
         * shadow）。拿不到 child 目录时保留计划原样。
         */
        let skills = { ...plan.toggles.skills };
        const childNames = await visibleSkillNames(ctx, agent, childCwd);
        if (childNames !== undefined) {
          const projected: Record<string, boolean> = {};
          for (const name of childNames) projected[name] = plan.toggles.skills[name] === true;
          skills = projected;
        }
        const effectivePlan: DynamicPlan = {
          ...plan,
          toggles: {
            skills,
            mcp: { ...plan.toggles.mcp },
            tools: { ...plan.toggles.tools },
          },
          skillEntries: Object.entries(skills).map(([name, enabled]) => ({ name, enabled })),
          counts: {
            skills: Object.values(skills).filter(Boolean).length,
            mcp: Object.values(plan.toggles.mcp).filter(Boolean).length,
            tools: Object.values(plan.toggles.tools).filter(Boolean).length,
          },
        };
        effectivePlan.selected = effectivePlan.counts.skills + effectivePlan.counts.mcp + effectivePlan.counts.tools;
        toggles = {
          skills: effectivePlan.toggles.skills,
          mcp: effectivePlan.toggles.mcp,
          tools: effectivePlan.toggles.tools,
        };
        dynamicInfo = dynamicInfoOf(effectivePlan);
        dynamicPlan = effectivePlan;
      } else {
        // 回退策略：同项目根 → 继承父会话；跨项目根 → 工作区默认（与 session 一致）。
        const fallbackMode = effectiveMode("session", childCwd, parentCwd);
        const fallback: "session" | "workspace" = fallbackMode === "session" ? "session" : "workspace";
        if (fallback === "session") {
          toggles = await sessionTogglesFor({
            ctx,
            state,
            ...(logger !== undefined ? { logger } : {}),
            parentId,
            parentAgent,
            parentCwd,
            childAgent: agent,
            childCwd,
          });
        }
        const infoPlan = plan ?? missingDynamicPlan(parentId);
        dynamicInfo = dynamicInfoOf(infoPlan, fallback);
        if (plan !== undefined) {
          logger?.info?.(
            `capability-panel: 动态选择回退（${plan.reason ?? "unknown"}）：${parentId} → ${childId}，` +
              `阈值 ${plan.threshold.toFixed(2)}，按 ${fallback === "session" ? "继承会话" : "工作区默认"} 启动`,
          );
        }
      }
    } else {
      const applied = effectiveMode(mode, childCwd, parentCwd);
      recordMode = applied;
      if (applied !== mode) {
        logger?.warn?.(
          `capability-panel: 派生继承 ${parentId} → ${childId} 跨项目根，按工作区默认启动（不复制会话覆盖）`,
        );
      }
      if (applied === "session") {
        toggles = await sessionTogglesFor({
          ctx,
          state,
          ...(logger !== undefined ? { logger } : {}),
          parentId,
          parentAgent,
          parentCwd,
          childAgent: agent,
          childCwd,
        });
      }
    }

    await state.seedDerived(childId, parentId, recordMode, toggles, meta, dynamicInfo);
    // 不能只靠 skills 域的 agent/created 监听器：它可能在本监听器之前注册/执行，
    // 或者 applyProjectDefaults 只处理注入技能、跳过磁盘技能。seed 后立即把
    // child 的显式开关应用到 agent 作用域，保证首轮前生效。
    if (recordMode !== "workspace") {
      const skillSessions = deps.getSkillSessions?.();
      const entries = Object.entries(toggles.skills).map(([name, enabled]) => ({ name, enabled }));
      if (skillSessions !== undefined && entries.length > 0) {
        try {
          // 先登记 child（skills 域监听器可能尚未执行），再走现有批量路径：
          // 一次目录发现 + 一次落盘，避免逐条 ensureShadow 的 O(N²) 目录发现。
          skillSessions.trackAgent(agent);
          const result = await skillSessions.setEnabledBatch({ sessionId: childId, entries });
          if (result.ok !== true || result.errors.length > 0) {
            logger?.warn?.(`capability-panel: 派生继承批量应用技能开关降级（${result.errors.join("; ")}）`);
          }
        } catch (error) {
          logger?.warn?.(`capability-panel: 派生继承立即应用技能开关失败（${errMessage(error)}）`);
        }
      }
    }
    // 动态选择成功才需要「晚期 apply」：三域监听器已把 seed 的快照 hydrate，
    // 这里登记给 auto-select 的晚期 listener，await 到 remount / restrict 收敛。
    if (dynamicPlan !== undefined) dynamicHost?.arm(childId, dynamicPlan);
  }

  const off =
    typeof ctx.on === "function"
      ? ctx.on("agent/created", (payload: any) =>
          onCreated(payload?.agent, payload?.source).catch((error) => {
            // 监听器绝不抛穿：agent/created 被 await，失败会让子 agent 创建失败。
            logger?.warn?.(`capability-panel: 写入派生继承快照失败（${errMessage(error)}）`);
          }),
        )
      : undefined;

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (typeof off === "function") off();
    },
  };
}

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
export async function repairDynamicFallbackSkillProjection(
  state: SessionStateStore,
  logger?: DeriveInheritanceLogger,
): Promise<number> {
  await state.ready();
  const entries = state.entries();
  const writes: Array<{ childId: string; name: string; cwd?: string; headerCreatedAt?: number }> = [];
  for (const [childId, entry] of Object.entries(entries)) {
    if (entry.derivedMode !== "dynamic" || entry.derivedDynamic?.status !== "fallback") continue;
    if (entry.derivedFrom === undefined) continue;
    const parent = entries[entry.derivedFrom];
    if (parent === undefined) continue;
    for (const [name, enabled] of Object.entries(parent.skills ?? {})) {
      if (enabled !== false) continue;
      if (entry.skills?.[name] !== undefined) continue;
      writes.push({
        childId,
        name,
        ...(entry.cwd !== undefined ? { cwd: entry.cwd } : {}),
        ...(entry.headerCreatedAt !== undefined ? { headerCreatedAt: entry.headerCreatedAt } : {}),
      });
    }
  }
  for (const write of writes) {
    await state.setSkill(
      write.childId,
      write.name,
      false,
      {
        ...(write.cwd !== undefined ? { cwd: write.cwd } : {}),
        ...(write.headerCreatedAt !== undefined ? { headerCreatedAt: write.headerCreatedAt } : {}),
      },
    );
  }
  if (writes.length > 0) {
    logger?.info?.(`capability-panel: 动态回退技能投影补齐 ${writes.length} 个键`);
  }
  return writes.length;
}
