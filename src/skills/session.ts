/**
 * Skills 的**会话级**开关（内存态、不落盘）与**项目默认**的会话内投影。
 *
 * 背景：宿主 `skills` 注册表（`@deepseek-ai/dsh-skill` 的 `SkillRegistry`）
 * 没有 disable/restrict 一类的按会话禁用 API，但它是**分层**的：`register()`
 * 把 runtime skill 注册进「调用方 ctx 所属 scope」的层（`scopeOf(this.ctx)`），
 * 读取时按 `global → 祖先 → 最近层` 合并，**同名最近层赢**。因此：
 *
 *   - 取 `agent.ctx.get("skills")` 得到的可追踪代理会把 `this.ctx` 绑定成该
 *     agent ctx（cordis tracker `{associate:"skills", property:"ctx"}`），从它
 *     `register()` 就落在**该 agent 的 scope 层**（与 mcp/loader.ts 用
 *     `agent.ctx.get("tools").restrict(...)` 是同一条机制）；
 *   - 注册一个同名 runtime skill，并把 `invocation` 设成双向 false，就能同时把
 *     它从「模型目录 / `skill` 工具 / `/name` 用户口令」三条消费链路里隐藏 ——
 *     等价于「在本会话禁用该 skill」；
 *   - 解除 = 调用 `register()` 返回的 disposer（注册表按效果回收该层的条目）。
 *
 * 本模块管理两类 shadow，**分开记账**：
 *
 *   1. **会话显式开关**（`shadows`）：用户在会话内手动关掉某个技能；
 *   2. **项目默认禁用**（`projectShadows`）：`.agents/capability-overrides.json`
 *      的 `skills` 名单，在 agent 创建时/项目默认热更新时 reconcile 进去。
 *
 * 优先级：**会话显式开关 > 项目默认**（显式开可以覆盖项目默认关）。
 * `enabledInSession` 以**实际注册状态**为准（不只看意图），并且 register 之后
 * 会 read-after 校验胜者确实是本插件的 shadow，消灭「UI 已禁用、实际仍可见」
 * 的假成功（同层 runtime 先到先得时无法覆盖，属宿主 registry 的硬边界）。
 *
 * 语义边界：
 *   - **只可关闭，不能强制开启**：文件级已禁用（frontmatter 双 false）或项目
 *     内 shadow stub 的条目，本模块只把它们从可切换列表里过滤掉，不会去
 *     「反向开启」；
 *   - **按会话落盘**：显式会话开关写在插件数据目录
 *     （`<dshHome>/dsh-capability-settings/session-capabilities.json`，见
 *     `session-state.ts`），agent 重建 / 宿主重启后恢复；项目默认仍落
 *     `.agents/capability-overrides.json`；
 *   - 找不到 live agent（冷会话）时开关失败并返回业务错误，不做状态暂存。
 *
 * @module dsh-capability-settings/skills/session
 */

import { findProjectRoot } from "../shared/project-root.js";
import type { SessionStateStore } from "../session-state.js";
import { SHADOW_DESCRIPTION, SHADOW_METADATA_KEY } from "./registry.js";
import type { ClassifiedInjectedRow, SkillRegistryBridge } from "./registry.js";
import type { SkillSummaryView } from "./types.js";

/** 会话级 Skills 开关 / 项目默认投影的依赖。 */
export interface SkillSessionDeps {
  /** 项目默认禁用名单（overrides.skills；只对注入技能生效）。 */
  projectDisabled?: (cwd?: string) => Promise<readonly string[]>;
  /** 宿主 registry 桥（读注入技能 + read-before/after-shadow 校验）；缺省退化为纯磁盘行为。 */
  registry?: SkillRegistryBridge;
  /**
   * 会话级开关的持久化存储（可选）：提供时显式开关按 sessionId 落盘，
   * agent 重建 / 宿主重启后恢复；省略时保持旧的纯内存行为。
   */
  state?: SessionStateStore;
  /** 宿主日志（结构子集）。 */
  logger?: { warn?: (message: string) => void };
}

/** 面板「本会话」列表的一行：磁盘/注入视图 + 本会话启用态。 */
export interface SessionSkillView extends SkillSummaryView {
  /** 本会话是否生效（项目默认 + 会话显式开关共同决定，以实际 shadow 状态为准）。 */
  enabledInSession: boolean;
  /**
   * 当前是否可以写会话开关：有 live agent 时立即注册 shadow；冷会话在有
   * `state` 时也允许先落盘，下次恢复时由 `applyPersistedExplicit` 应用。
   */
  canToggleInSession: boolean;
  /** 冷会话（无 live agent）的改动只在下次恢复时生效。 */
  activationPending?: boolean;
}

/** 会话级 Skills 开关的结果（业务信封形状，见 remote.ts 文件头）。 */
export type SessionSkillOpResult = { ok: true } | { ok: false; errors: string[] };

/** 批量会话开关的一条目标（`enabled` 语义与 {@link SkillSessionRegistry.setEnabled} 相同）。 */
export interface SessionSkillBatchEntry {
  name: string;
  enabled: boolean | undefined;
}

/** 批量会话开关的逐项结果（顺序与请求里的名字首次出现顺序一致）。 */
export interface SessionSkillBatchOutcome {
  name: string;
  ok: boolean;
  /** 仅失败时给出（与单条 `setEnabled` 的错误文案同源）。 */
  errors?: string[];
}

/**
 * 批量会话开关的结果。
 *
 * `ok=false` 只表示**整批**无法执行（会话不存在 / skills 服务不可用 / 参数
 * 非法）；单条失败收在 `outcomes` 里，不影响其余条目的写入。
 */
export interface SessionSkillBatchResult {
  ok: boolean;
  errors: string[];
  outcomes: SessionSkillBatchOutcome[];
}

/** 会话级 Skills 开关注册表（挂到 `capabilityPanel.skills` 上）。 */
export interface SkillSessionRegistry {
  /**
   * 合并磁盘/注入列表 + 本会话启用态。
   *
   * @param baseList 磁盘视图函数（由 index.ts 注入 skills manager 的 list）
   * @param cwd 工作区路径（决定项目根与项目默认名单）
   * @param sessionId 会话 id；缺省时全部条目 `canToggleInSession:false`
   */
  list(baseList: (cwd?: string) => Promise<SkillSummaryView[]>, cwd?: string, sessionId?: string): Promise<SessionSkillView[]>;
  /**
   * 设置本会话开关（按会话落盘；无 `state` 依赖时仅内存）。
   *
   * `enabled=false` 注册 shadow；`true` 解除；`undefined` 清除显式覆盖、
   * 回到项目默认（与 MCP 的 `setSessionEnabled` 语义对齐）。
   */
  setEnabled(input: { sessionId: string; name: string; enabled?: boolean }): Promise<SessionSkillOpResult>;
  /**
   * 批量设置本会话开关（性能路径：整批只做**一次**技能目录发现 + **一次**落盘）。
   *
   * 逐条 `setEnabled` 在 N 条时会触发 3N 次宿主 skill catalog 全量发现
   * （`prepareShadow` 2 次 + `verifyShadow` 1 次，且 `skills.register` 会让宿主
   * `collectCache` 整体失效）与 N 次 session-capabilities.json 读改写；
   * `jev.apply` 的筛选语义一次要写约 150 条，逐条 = 5–10 秒。本方法把发现收敛
   * 到「整批 1 次 prepare + 1 次 verify」、落盘收敛到一次 `setToggles`，并保留
   * 逐项失败（含 ghost shadow / 同层 runtime 冲突的判真假成功）。
   */
  setEnabledBatch(input: {
    sessionId: string;
    entries: ReadonlyArray<SessionSkillBatchEntry>;
  }): Promise<SessionSkillBatchResult>;
  /** 项目默认变更后，对同项目的全部 live 会话增量 reconcile。 */
  reconcileProject(cwd?: string): Promise<SessionSkillOpResult>;
  /** 本会话被关闭的 skill 名（只读快照，测试/诊断用）。 */
  sessionState(sessionId: string): string[];
  /**
   * 确保该 agent 已被登记（派生继承在 seed 后、skills 域监听器之前调用，
   * 再走 `setEnabledBatch` 一次性应用；幂等）。
   */
  trackAgent(agent: any): void;
  /** 按 sessionId 取 live agent（registry 桥的 scope 传参用）。 */
  agentOf(sessionId: string): any | undefined;
  /** 该名字当前是否被本插件的任一 shadow 遮蔽（registry 桥清缓存时保留元数据用）。 */
  isShadowed(sessionId: string, name: string): boolean;
  /** 卸载：移除生命周期监听并清空内存状态（agent fiber 自己回收 shadow 注册）。 */
  dispose(): void;
}

/** 每个 session 的记录：agent 引用 + shadow 簿记 + 项目默认投影。 */
interface SessionRecord {
  agent: any;
  /** session 的工作目录（来自 `session.header.cwd`）。 */
  cwd?: string;
  /** 由 cwd 推导的项目根（项目默认按项目根匹配）。 */
  projectRoot?: string;
  /** 会话显式关闭的 shadow（name → disposer）。 */
  shadows: Map<string, () => void>;
  /** 项目默认关闭的 shadow（name → disposer）。 */
  projectShadows: Map<string, () => void>;
  /** 会话显式开关（缺省 = 跟随项目默认）。true = 显式开启。 */
  explicit: Map<string, boolean>;
  /** 是否已从磁盘恢复过显式开关（每个会话一次；保持内存里刚改的值优先）。 */
  explicitHydrated: boolean;
  /** 本项目默认禁用名单（最近一次读取的快照）。 */
  projectDefaults: Set<string>;
  /** 已尝试但尚未生效的名字（registry 未就绪/时序问题；下次读取重试）。 */
  projectPending: Set<string>;
  /** 每个名字已重试的次数（超过上限只 warn 一次后放弃）。 */
  projectAttempts: Map<string, number>;
  /** 本会话的操作串行队列（toggle / reconcile 互斥）。 */
  queue: Promise<unknown>;
  /** 延迟重试定时器（有则不再重复排）。 */
  retryTimer?: ReturnType<typeof setTimeout>;
}

/** shadow 注册失败时的额外语义：是否值得在下一次读取时重试。 */
type ShadowResult = { ok: true } | { ok: false; errors: string[]; retryable?: boolean };

/** 从注册表注册失败里提取可读错误信息。 */
function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 构造会话级 Skills 开关注册表。
 *
 * 只做「簿记 + 注册/解除 + 项目默认投影」；磁盘/注入列表由 `skills/manager.ts`
 * 与 `skills/registry.ts` 提供，避免读取口径分叉。生命周期监听与
 * `mcp/loader.ts` 的 mountAgent 同款：`agent/created` 登记、`agent/disposed`
 * 清理（shadow 注册挂在 agent fiber 的效果上，agent 销毁时由 cordis 自动回收，
 * 这里只清 Map）。
 *
 * @param ctx 宿主上下文（插件自身的 ctx；用 `ctx.get("agents")` 补登记存量）
 * @param deps 项目默认名单 / registry 桥 / 日志
 */
export function createSkillSessionRegistry(ctx: any, deps: SkillSessionDeps = {}): SkillSessionRegistry {
  /** sessionId → 记录（agent.id === session.id，见 dsh-agent）。 */
  const sessions = new Map<string, SessionRecord>();
  /** 生命周期监听 disposer（`ctx.on` 在 cordis 4 返回函数）。 */
  const listeners: Array<() => void> = [];
  /** 已 warn 过的「跳过非注入名」记录（避免每次 list 刷日志）。 */
  const warnedSkips = new Set<string>();
  let disposed = false;

  /** 项目默认名单读取（失败降级为空，不阻断列表）。 */
  async function projectDisabledOf(cwd: string | undefined): Promise<readonly string[]> {
    if (deps.projectDisabled === undefined) return [];
    try {
      return await deps.projectDisabled(cwd);
    } catch {
      return [];
    }
  }

  /** 登记一个 agent（无 ctx / 无 id 的 stub 跳过；重复登记先到先得）。 */
  function track(agent: any): SessionRecord | undefined {
    if (agent?.ctx === undefined || agent?.id === undefined) return undefined;
    const known = sessions.get(agent.id);
    if (known !== undefined) return known;
    const cwd = typeof agent.session?.header?.cwd === "string" ? agent.session.header.cwd : undefined;
    const record: SessionRecord = {
      agent,
      ...(cwd !== undefined ? { cwd } : {}),
      ...(cwd !== undefined ? { projectRoot: findProjectRoot(cwd) } : {}),
      shadows: new Map(),
      projectShadows: new Map(),
      explicit: new Map(),
      explicitHydrated: false,
      projectDefaults: new Set(),
      projectPending: new Set(),
      projectAttempts: new Map(),
      queue: Promise.resolve(),
    };
    sessions.set(agent.id, record);
    return record;
  }

  /** 按 sessionId 找记录；内存里没有时从 `agents.list()` 补登记一次。 */
  function find(sessionId: string): SessionRecord | undefined {
    const known = sessions.get(sessionId);
    if (known !== undefined) return known;
    try {
      const agents = ctx.get?.("agents")?.list?.() ?? [];
      for (const agent of Array.isArray(agents) ? agents : []) {
        if (agent?.id !== sessionId) continue;
        return track(agent);
      }
    } catch {
      /* agents 服务不可用：按冷会话处理 */
    }
    return undefined;
  }

  /** 当前 session 的 skills 注册表代理（访问方是 agent.ctx ⇒ 注册进 agent 层）。 */
  function skillsOf(record: SessionRecord): any {
    try {
      return record.agent?.ctx?.get?.("skills");
    } catch {
      return undefined;
    }
  }

  /** 某个名字当前的实际 shadow disposer（显式或项目默认，二者不会同时存在）。 */
  function shadowOf(record: SessionRecord, name: string): (() => void) | undefined {
    return record.shadows.get(name) ?? record.projectShadows.get(name);
  }

  /** 该名字当前是否被 shadow 遮蔽（实际注册状态）。 */
  function shadowed(record: SessionRecord, name: string): boolean {
    return record.shadows.has(name) || record.projectShadows.has(name);
  }

  /** 意图状态：显式开关优先，否则跟随项目默认。 */
  function desiredEnabled(record: SessionRecord, name: string): boolean {
    const explicit = record.explicit.get(name);
    if (explicit !== undefined) return explicit;
    return !record.projectDefaults.has(name);
  }

  /** 会话记录 → 落盘元数据（cwd 仅诊断、headerCreatedAt 防 id 复用）。 */
  function metaOf(record: SessionRecord): { cwd?: string; headerCreatedAt?: number } {
    const meta: { cwd?: string; headerCreatedAt?: number } = {};
    if (record.cwd !== undefined) meta.cwd = record.cwd;
    const createdAt = record.agent?.session?.header?.createdAt;
    if (typeof createdAt === "number" && Number.isFinite(createdAt)) meta.headerCreatedAt = createdAt;
    return meta;
  }

  /**
   * 从持久化存储恢复本会话的显式开关（幂等；每个会话一次）。
   *
   * 内存里已有的键优先：同一运行内用户刚改过的开关不被磁盘旧值覆盖。
   * sessionId 复用（header 创建时间不一致）时旧记录作废（见 `verifySession`）。
   */
  async function hydrateExplicit(record: SessionRecord): Promise<void> {
    const state = deps.state;
    if (state === undefined || record.explicitHydrated) return;
    await state.ready();
    record.explicitHydrated = true;
    const sessionId = typeof record.agent?.id === "string" ? record.agent.id : undefined;
    if (sessionId === undefined) return;
    if (!state.verifySession(sessionId, metaOf(record))) return;
    const stored = state.skills(sessionId);
    for (const [name, enabled] of Object.entries(stored)) {
      if (!record.explicit.has(name)) record.explicit.set(name, enabled);
    }
  }

  /** 每 session 的串行队列（写操作互斥；读路径不排队，避免死锁）。 */
  function withQueue<T>(record: SessionRecord, work: () => Promise<T>): Promise<T> {
    const run = record.queue.then(work, work);
    record.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** 只 warn 一次。 */
  function warnSkip(record: SessionRecord, name: string, message: string): void {
    const key = `${String(record.agent?.id)}::${name}`;
    if (warnedSkips.has(key)) return;
    warnedSkips.add(key);
    deps.logger?.warn?.(message);
  }

  /**
   * 注册 shadow 的**纯簿记核心**（无目录发现、无 read-after 校验）。
   *
   * 单条 `ensureShadow` 与批量 `setEnabledBatch` 共用：批量路径把整批的目录
   * 发现收敛到 `registry.prepareShadows` 一次，这里只做同步注册与桶归位。
   *
   * @param viaProject true = 因项目默认禁用而注册（记入 projectShadows），否则记入 shadows
   * @returns `created=true` = 本次新建了 shadow（批量路径只对新建项做 read-after 校验，
   *   与单条 `ensureShadow` 的幂等短路语义一致）
   */
  function registerShadowCore(
    record: SessionRecord,
    name: string,
    viaProject: boolean,
  ): ShadowResult & { created?: boolean } {
    if (disposed) return { ok: false, errors: ["skill session registry disposed"] };
    const explicitDisposer = record.shadows.get(name);
    const projectDisposer = record.projectShadows.get(name);
    const existing = explicitDisposer ?? projectDisposer;
    if (existing !== undefined) {
      // 幂等；但要把簿记归位（项目默认驱动 ↔ 会话显式驱动），否则项目默认解除时
      // 会漏掉一个「记在显式桶里、但其实是项目默认造成」的 shadow。
      if (viaProject && explicitDisposer !== undefined) {
        record.shadows.delete(name);
        record.projectShadows.set(name, explicitDisposer);
      } else if (!viaProject && projectDisposer !== undefined) {
        record.projectShadows.delete(name);
        record.shadows.set(name, projectDisposer);
      }
      return { ok: true, created: false };
    }
    const skills = skillsOf(record);
    if (typeof skills?.register !== "function") {
      return { ok: false, errors: [`skills service unavailable for session ${String(record.agent?.id)}`], retryable: true };
    }
    let dispose: unknown;
    try {
      dispose = skills.register({
        name,
        description: SHADOW_DESCRIPTION,
        content: "",
        source: "runtime",
        metadata: { [SHADOW_METADATA_KEY]: true },
        invocation: { modelInvocable: false, userInvocable: false },
      });
    } catch (error) {
      // 名称非法 / 服务内部异常都收敛成业务失败，不向 RPC 层抛。
      return { ok: false, errors: [`failed to disable skill "${name}": ${errMessage(error)}`] };
    }
    // 同层已有同名 runtime skill 时 registry 返回 no-op disposer（warn 不抛）：
    // 仍记下来，之后「恢复」会调用它（幂等无害）；read-after 校验会识破它。
    const recorded = typeof dispose === "function" ? (dispose as () => void) : () => undefined;
    const bucket = viaProject ? record.projectShadows : record.shadows;
    bucket.set(name, recorded);
    return { ok: true, created: true };
  }

  /**
   * 注册 shadow（幂等）：read-before-shadow 缓存元数据 → register → read-after 校验。
   *
   * @param viaProject true = 因项目默认禁用而注册（记入 projectShadows），否则记入 shadows
   */
  async function ensureShadow(record: SessionRecord, name: string, viaProject: boolean): Promise<ShadowResult> {
    if (disposed) return { ok: false, errors: ["skill session registry disposed"] };
    const existing = record.shadows.get(name) ?? record.projectShadows.get(name);
    // 幂等分支：已有 shadow（含项目默认驱动）时只需桶归位，无需再读目录。
    if (existing !== undefined) {
      const idempotent = registerShadowCore(record, name, viaProject);
      // 单条接口不暴露内部 `created` 标记（结果形状与旧实现一致）。
      return idempotent.ok ? { ok: true } : idempotent;
    }

    const registry = deps.registry;
    const agent = record.agent;
    const sessionId = typeof agent?.id === "string" ? agent.id : undefined;
    // read-before-shadow：缓存注入元数据，保证「被自己遮蔽的条目」仍能显示。
    let meta: ClassifiedInjectedRow | undefined;
    if (registry !== undefined) {
      try {
        meta = await registry.prepareShadow(agent, sessionId, record.cwd, name);
      } catch {
        meta = undefined;
      }
    }
    const result = registerShadowCore(record, name, viaProject);
    if (!result.ok) return result;

    if (registry !== undefined) {
      let verified: boolean | undefined;
      try {
        verified = await registry.verifyShadow(agent, sessionId, record.cwd, name);
      } catch {
        verified = undefined;
      }
      if (verified === false) {
        // 同层 runtime 先到先得（宿主 registry 硬边界）：撤销簿记并回滚注册。
        const recorded = record.shadows.get(name) ?? record.projectShadows.get(name);
        record.shadows.delete(name);
        record.projectShadows.delete(name);
        try {
          recorded?.();
        } catch {
          /* 回滚失败无额外副作用 */
        }
        return {
          ok: false,
          errors: [`skill "${name}" 由同作用域已注册的运行时条目提供，无法在本会话禁用`],
        };
      }
      // register 触发的 skills/change 会清掉刚缓存的元数据：显式写回。
      if (meta !== undefined) {
        try {
          registry.keepShadowed(agent, sessionId, meta);
        } catch {
          /* 缓存写回失败只影响展示，不影响启停 */
        }
      }
    }
    return { ok: true };
  }

  /** 解除 shadow 的产物：`restore` 用于 read-after 失败时恢复簿记（与旧单条实现一致）。 */
  type ReleaseResult =
    | { ok: true; released: boolean; restore?: () => void }
    | { ok: false; errors: string[] };

  /**
   * 解除 shadow 的**纯簿记核心**（无目录发现）。
   *
   * `released=false` = 本地没有本插件的 disposer（可能是插件重载前旧实例注册的
   * ghost shadow），由调用方用 registry 胜者校验裁定。
   */
  function releaseShadowCore(record: SessionRecord, name: string): ReleaseResult {
    if (disposed) return { ok: false, errors: ["skill session registry disposed"] };
    const explicitDisposer = record.shadows.get(name);
    const projectDisposer = record.projectShadows.get(name);
    const target = explicitDisposer ?? projectDisposer;
    if (target === undefined) return { ok: true, released: false };
    const wasExplicit = explicitDisposer !== undefined;
    const restore = (): void => {
      if (wasExplicit) record.shadows.set(name, target);
      else record.projectShadows.set(name, target);
    };
    record.shadows.delete(name);
    record.projectShadows.delete(name);
    try {
      target();
    } catch (error) {
      // disposer 理论上幂等；这里仍降级成业务失败，避免假成功。
      restore();
      return { ok: false, errors: [`failed to restore skill "${name}": ${errMessage(error)}`] };
    }
    return { ok: true, released: true, restore };
  }

  /**
   * 解除 shadow（幂等）。**两步校验**，避免「UI 显示已恢复、实际仍被隐藏」：
   *
   * 1. 本地无 disposer 时（插件重载前的旧实例注册的 ghost shadow）：用 registry
   *    胜者校验判断当前是否仍被本插件的 shadow 遮蔽 —— 仍遮蔽则返回业务失败，
   *    而不是直接 ok；
   * 2. 本地有 disposer 时：调用 disposer 后 read-after 校验胜者不再是本插件的
   *    shadow；否则恢复簿记并返回业务失败（同层 runtime 先到先得 / ghost 冲突）。
   */
  async function releaseShadow(record: SessionRecord, name: string): Promise<ShadowResult> {
    if (disposed) return { ok: false, errors: ["skill session registry disposed"] };
    const hasLocal = record.shadows.has(name) || record.projectShadows.has(name);
    const registry = deps.registry;
    const agent = record.agent;
    const sessionId = typeof agent?.id === "string" ? agent.id : undefined;

    /** 用 registry 胜者校验该名字当前是否仍是本插件的 shadow（无法判定 = undefined）。 */
    const stillShadowed = async (): Promise<boolean | undefined> => {
      if (registry === undefined) return undefined;
      try {
        return await registry.verifyShadow(agent, sessionId, record.cwd, name);
      } catch {
        return undefined;
      }
    };

    if (!hasLocal) {
      // 幂等分支：本来就没 shadow，或 shadow 是本插件重载/卸载前旧实例注册的
      // （本地没有 disposer，解除不了）。用胜者校验区分两者，不做假成功。
      if ((await stillShadowed()) === true) {
        return {
          ok: false,
          errors: [
            `skill "${name}" 的会话级禁用仍由宿主技能注册表持有（可能来自插件重载前的实例），无法在本会话恢复；请重新打开该会话`,
          ],
        };
      }
      return { ok: true };
    }

    const released = releaseShadowCore(record, name);
    if (!released.ok) return released;

    // read-after：确认胜者不再是本插件的 shadow（no-op disposer / 旧实例 ghost
    // 都会让验证失败）；失败时恢复簿记，状态与 UI 保持一致。
    if ((await stillShadowed()) === true) {
      released.restore?.();
      return {
        ok: false,
        errors: [
          `failed to restore skill "${name}": 会话级禁用仍被其它注册持有（同层 runtime 先到先得），本会话无法恢复；请重新打开该会话`,
        ],
      };
    }
    return { ok: true };
  }

  /** 把 shadow 归到正确桶：没有显式覆盖 ⇒ 属于项目默认（否则项目默认解除时漏删）。 */
  function rebucketShadow(record: SessionRecord, name: string): void {
    const disposer = record.shadows.get(name);
    if (disposer === undefined || record.explicit.has(name)) return;
    record.shadows.delete(name);
    record.projectShadows.set(name, disposer);
  }

  /** 延迟重试项目默认投影（registry/preset 层还没就绪时的降级路径）。 */
  function scheduleRetry(record: SessionRecord, attempt: number): void {
    if (disposed || record.retryTimer !== undefined) return;
    if (attempt >= 4) return;
    const delay = attempt <= 0 ? 0 : attempt === 1 ? 100 : 300;
    record.retryTimer = setTimeout(() => {
      record.retryTimer = undefined;
      void runApply(record, attempt + 1);
    }, delay);
    if (typeof record.retryTimer?.unref === "function") record.retryTimer.unref();
  }

  /**
   * 把项目默认禁用名单投影到该会话（幂等、逐名独立）。
   *
   * 只对**注入条目**生效（Lead 裁定 R7：磁盘技能的项目级禁停继续走 shadow
   * stub）；名单里出现磁盘/未知名字时跳过并 warn 一次。registry 还没就绪时
   * 记 pending 并按 0 / 100 / 300ms 短重试，仍失败只 warn 不阻断会话。
   *
   * @param attempt 已重试次数（0 = 首次）
   * @param preloadedDisabled 调用方已读到的名单（避免重复读文件）
   */
  async function applyProjectDefaults(
    record: SessionRecord,
    attempt = 0,
    preloadedDisabled?: readonly string[],
  ): Promise<SessionSkillOpResult> {
    // 先恢复落盘的显式会话开关：desiredEnabled 依赖它（否则重启后会被项目默认盖掉）。
    await hydrateExplicit(record);
    const registry = deps.registry;
    if (registry === undefined) return { ok: true };
    const disabled = preloadedDisabled ?? (await projectDisabledOf(record.cwd));
    record.projectDefaults = new Set(disabled);
    // 常见路径：本项目没有任何默认禁用、也没有待处理项、也没有显式会话开关
    // ⇒ 不必读 registry（显式开关也要走下面的恢复逻辑，不能提前返回）。
    if (
      disabled.length === 0 &&
      record.projectShadows.size === 0 &&
      record.projectPending.size === 0 &&
      record.explicit.size === 0
    ) {
      return { ok: true };
    }
    const sessionId = typeof record.agent?.id === "string" ? record.agent.id : undefined;
    let injected: Set<string> | undefined;
    try {
      injected = await registry.injectedNames(record.agent, sessionId, record.cwd);
    } catch {
      injected = undefined;
    }
    if (injected === undefined && disabled.length > 0) {
      for (const name of disabled) record.projectPending.add(name);
      scheduleRetry(record, attempt);
      return { ok: true };
    }

    const errors: string[] = [];
    const names = new Set<string>([
      ...record.projectDefaults,
      ...record.projectShadows.keys(),
      ...record.explicit.keys(),
      ...record.projectPending,
    ]);
    for (const name of [...names].sort()) {
      const knownInjected =
        injected?.has(name) === true ||
        record.projectShadows.has(name) ||
        record.shadows.has(name) ||
        (sessionId !== undefined && registry.knowsInjected(sessionId, name));
      if (!knownInjected) {
        if (record.projectDefaults.has(name)) {
          const tries = (record.projectAttempts.get(name) ?? 0) + 1;
          record.projectAttempts.set(name, tries);
          if (tries <= 3) {
            // 可能是 preset 层尚未就绪：留待下一次读取重试。
            record.projectPending.add(name);
            scheduleRetry(record, attempt);
            continue;
          }
          warnSkip(
            record,
            name,
            `capability-panel: 项目默认禁用名单中的 "${name}" 不是宿主注入技能（或宿主尚未提供），已跳过`,
          );
        }
        record.projectPending.delete(name);
        continue;
      }
      record.projectAttempts.delete(name);
      const desired = desiredEnabled(record, name);
      const explicitOff = record.explicit.get(name) === false;
      const result = desired ? await releaseShadow(record, name) : await ensureShadow(record, name, !explicitOff);
      if (result.ok) {
        record.projectPending.delete(name);
        continue;
      }
      errors.push(...result.errors);
      if (result.retryable === true) {
        record.projectPending.add(name);
        scheduleRetry(record, attempt);
      } else {
        // 同层冲突等硬失败：不再重试（重试也不会变），只保留错误给调用方。
        record.projectPending.delete(name);
      }
    }
    return errors.length > 0 ? { ok: false, errors } : { ok: true };
  }

  /** 项目默认投影的串行化入口（同一 session 的多次 reconcile 不并发注册）。 */
  function runApply(record: SessionRecord, attempt = 0, preloadedDisabled?: readonly string[]): Promise<SessionSkillOpResult> {
    return withQueue(record, () => applyProjectDefaults(record, attempt, preloadedDisabled));
  }

  /**
   * 恢复显式会话开关（list 路径，能同时看到磁盘 + 注入技能名）。
   *
   * `applyProjectDefaults` 只处理**注入技能**（项目默认禁用的口径），而会话
   * 显式开关也可能落在磁盘技能上（自定义技能 = 磁盘条目）。这里按"当前仍
   * 可见的名字"恢复：可见 ⇒ 按状态注册/解除 shadow；已删除 ⇒ 清掉显式覆盖
   * 并落盘（避免重启后给已删技能造出幽灵 shadow）。
   */
  async function restoreExplicit(record: SessionRecord, visibleNames: ReadonlySet<string>): Promise<void> {
    if (record.explicit.size === 0) return;
    await withQueue(record, async () => {
      const sessionId = typeof record.agent?.id === "string" ? record.agent.id : undefined;
      for (const [name, enabled] of [...record.explicit.entries()]) {
        if (!visibleNames.has(name)) {
          record.explicit.delete(name);
          if (sessionId !== undefined && deps.state !== undefined) {
            await deps.state.setSkill(sessionId, name, undefined, metaOf(record));
          }
          continue;
        }
        const result = enabled ? await releaseShadow(record, name) : await ensureShadow(record, name, false);
        // 失败保留意图（下次读取重试），不清显式记录。
        if (result.ok) rebucketShadow(record, name);
      }
    });
  }

  /** 构造完成后回填（供 agent/created 时立即应用落盘开关；见 onAgentCreated）。 */
  let registryApi: SkillSessionRegistry | undefined;

  /**
   * 把落盘的显式开关在 agent 创建时**立即**批量应用。
   *
   * 背景：`applyProjectDefaults` 只处理注入技能，磁盘技能要等到 `list` 的
   * `restoreExplicit` 才注册 shadow；宿主重启 / resume 后模型首轮可能先于
   * 面板加载，出现「面板显示 19 / 模型实际 155」的不一致。这里在创建路径用
   * 现有 `setEnabledBatch`（一次目录发现 + 一次落盘）提前收敛。
   */
  async function applyPersistedExplicit(record: SessionRecord): Promise<void> {
    const api = registryApi;
    const sessionId = typeof record.agent?.id === "string" ? record.agent.id : undefined;
    if (api === undefined || deps.state === undefined || sessionId === undefined) return;
    await deps.state.ready();
    const entries = Object.entries(deps.state.skills(sessionId)).map(([name, enabled]) => ({ name, enabled }));
    if (entries.length === 0) return;
    const result = await api.setEnabledBatch({ sessionId, entries });
    const failed = result.outcomes.filter((outcome) => outcome.ok !== true).length;
    if (failed > 0) {
      deps.logger?.warn?.(`capability-panel: 会话恢复时 ${failed} 个技能显式开关未能立即应用`);
    }
  }

  /** 生命周期回调：登记 + 延后应用项目默认 + 立即应用落盘显式开关。 */
  function onAgentCreated(agent: any): Promise<void> | void {
    const record = track(agent);
    if (record === undefined) return;
    scheduleRetry(record, 0);
    // agent/created 是 serial 且被 await：返回 Promise 可把首轮前的 shadow 收敛
    // 纳入创建路径；失败只 warn，绝不让 agent 创建失败。
    return applyPersistedExplicit(record).catch((error) => {
      deps.logger?.warn?.(`capability-panel: 会话恢复技能开关失败（${String(error)}）`);
    });
  }

  // —— 生命周期簿记 ——
  if (typeof ctx.on === "function") {
    const offCreated = ctx.on("agent/created", ({ agent }: any) => onAgentCreated(agent));
    if (typeof offCreated === "function") listeners.push(offCreated);
    const offDisposed = ctx.on("agent/disposed", ({ agent }: any) => {
      // 不手动 dispose shadow：注册挂在该 agent ctx 的效果上，fiber 销毁即回收。
      if (agent?.id === undefined) return;
      const record = sessions.get(agent.id);
      if (record?.retryTimer !== undefined) clearTimeout(record.retryTimer);
      sessions.delete(agent.id);
      deps.registry?.invalidateSession(agent.id);
    });
    if (typeof offDisposed === "function") listeners.push(offDisposed);
  }

  const api: SkillSessionRegistry = {
    async list(baseList, cwd, sessionId): Promise<SessionSkillView[]> {
      const record = sessionId !== undefined ? find(sessionId) : undefined;
      const projectDisabled = new Set<string>(await projectDisabledOf(cwd));
      // 冷会话（agent 已释放）没有 record，但面板仍应显示落盘快照而不是默认全开。
      let persisted: Readonly<Record<string, boolean>> = {};
      // 只有「派生继承会话」的快照是"缺席即关闭"；派生继承工作区没有快照，
      // 缺席名字应回落到工作区 / 项目默认（否则面板会把注入技能全显示成关闭）。
      let derivedSessionSnapshot = false;
      if (sessionId !== undefined && deps.state !== undefined) {
        await deps.state.ready();
        persisted = deps.state.skills(sessionId);
        derivedSessionSnapshot = deps.state.entries()[sessionId]?.derivedMode === "session";
      }
      // 项目默认投影（fire-and-await；读路径允许触发一次幂等 reconcile）。
      if (record !== undefined) await runApply(record, 0, [...projectDisabled]);

      const diskRows = await baseList(cwd);
      let injectedRows: SkillSummaryView[] = [];
      if (deps.registry !== undefined) {
        try {
          injectedRows = await deps.registry.merge({
            cwd,
            // 冷会话（无 live agent）退化为无 scope 读：只看得见 global 层注入。
            sessionId: record !== undefined ? sessionId : undefined,
            diskRows,
            projectDisabled,
          });
        } catch {
          injectedRows = [];
        }
      }

      const rows = [...diskRows, ...injectedRows].sort((a, b) => a.name.localeCompare(b.name));
      /**
       * 全局磁盘行被**项目副本**遮蔽：该项目行才是本项目实际生效的条目（磁盘列表
       * 已按「项目根在前」排序，首屏/Jev 又都按 name 去重）。会话视图里过滤掉这条
       * 重复的全局行，避免同名两行、也避免把被遮蔽的全局行当成"当前启用"。
       */
      const shadowedByProjectSkill = (row: SkillSummaryView): boolean =>
        row.injected !== true && row.projectShadow === "skill";
      /**
       * 全局磁盘行被**项目屏蔽占位（shadow stub）**遮蔽：该技能在本项目内被宿主
       * 原生禁用（占位行因双向 false 已被过滤），但全局行本身仍可见/可 toggle。
       * 它在本项目的默认态必须是"关闭"——不能再用 `!shadowed(record, name)`
       * 判断（stub 是磁盘文件层面的遮蔽，不在 record 的 runtime shadow 里）。
       */
      const shadowedByProjectStub = (row: SkillSummaryView): boolean =>
        row.injected !== true && row.projectShadow === "stub";
      // 硬关闭的条目（文件级双向 false、项目内 shadow stub）不可在会话层切换：
      // shadow 只能「再藏一层」，无法把文件级禁用反向开启，过滤掉避免误导。
      const toggleable = rows.filter(
        (row) =>
          row.shadowStub !== true &&
          !shadowedByProjectSkill(row) &&
          (row.invocation.modelInvocable || row.invocation.userInvocable),
      );
      // 恢复显式会话开关（磁盘 + 注入都覆盖；已删除技能顺便清理覆盖记录）。
      if (record !== undefined) await restoreExplicit(record, new Set(toggleable.map((row) => row.name)));
      return toggleable.map((row) => {
        const explicit = record?.explicit.get(row.name);
        // 实际注册状态（项目默认 + 会话 shadow 共同决定）。
        const registered =
          record !== undefined ? !shadowed(record, row.name) : row.injected !== true || !projectDisabled.has(row.name);
        // 优先级：显式会话覆盖 > 项目级默认（stub 遮蔽）> 落盘快照（冷会话 /
        // 派生会话缺席名字按关闭）> 实际注册状态。
        const persistedValue = persisted[row.name];
        const enabledInSession =
          explicit !== undefined
            ? explicit
            : shadowedByProjectStub(row)
              ? false
              : persistedValue !== undefined
                ? persistedValue
                : derivedSessionSnapshot
                  ? false
                  : registered;
        return {
          ...row,
          enabledInSession,
          canToggleInSession: record !== undefined || deps.state !== undefined,
          ...(record === undefined && deps.state !== undefined ? { activationPending: true } : {}),
        };
      });
    },

    async setEnabled(input): Promise<SessionSkillOpResult> {
      if (disposed) return { ok: false, errors: ["skill session registry disposed"] };
      const sessionId = typeof input?.sessionId === "string" ? input.sessionId : "";
      const name = typeof input?.name === "string" ? input.name : "";
      if (sessionId.length === 0) return { ok: false, errors: ["sessionId is required"] };
      if (name.length === 0) return { ok: false, errors: ["skill name is required"] };

      const record = find(sessionId);
      if (record === undefined) {
        // 冷会话（teammate 已结束）：没有 live agent ctx，无法注册 shadow；
        // 先落盘，等下次 restore / resume 时由 applyPersistedExplicit 应用。
        if (deps.state === undefined) return { ok: false, errors: [`session not found: ${sessionId}`] };
        await deps.state.ready();
        await deps.state.setSkill(sessionId, name, input.enabled);
        return { ok: true };
      }
      const skills = skillsOf(record);
      if (typeof skills?.register !== "function") {
        return { ok: false, errors: [`skills service unavailable for session ${sessionId}`] };
      }
      if (deps.registry === undefined) {
        // 无 registry 桥（旧装配）：保持旧的显式开关行为。
        return withQueue(record, async () => {
          await hydrateExplicit(record);
          if (input.enabled === undefined) {
            record.explicit.delete(name);
            const projectDisabled = await projectDisabledOf(record.cwd);
            record.projectDefaults = new Set(projectDisabled);
          } else {
            record.explicit.set(name, input.enabled === true);
          }
          const desired = desiredEnabled(record, name);
          const result = desired ? await releaseShadow(record, name) : await ensureShadow(record, name, record.explicit.get(name) !== false);
          if (result.ok) {
            rebucketShadow(record, name);
            // 落盘：失败只 warn（本次运行内仍生效），不影响开关结果。
            if (deps.state !== undefined) await deps.state.setSkill(sessionId, name, input.enabled, metaOf(record));
          }
          return result;
        });
      }

      return withQueue(record, async () => {
        await hydrateExplicit(record);
        // 刷新项目默认快照（显式开关的 fallback 依赖它）。
        const projectDisabled = await projectDisabledOf(record.cwd);
        record.projectDefaults = new Set(projectDisabled);
        const desired = input.enabled === undefined ? !record.projectDefaults.has(name) : input.enabled === true;
        const explicitOff = input.enabled === false;
        const result = desired
          ? await releaseShadow(record, name)
          : await ensureShadow(record, name, !explicitOff);
        if (!result.ok) return { ok: false, errors: result.errors };
        // 校验成功后才写显式状态（失败保留原状），并把 shadow 归到正确桶。
        if (input.enabled === undefined) record.explicit.delete(name);
        else record.explicit.set(name, input.enabled === true);
        rebucketShadow(record, name);
        // 落盘：失败只 warn（本次运行内仍生效），不向 RPC 报错误导 UI。
        if (deps.state !== undefined) await deps.state.setSkill(sessionId, name, input.enabled, metaOf(record));
        return { ok: true };
      });
    },

    /**
     * 批量会话开关（性能路径）：**整批一次**目录发现 + **一次**落盘。
     *
     * 语义与逐条 `setEnabled` 一致（`false` 注册 shadow / `true` 解除 /
     * `undefined` 清除显式覆盖回项目默认）；逐项失败不影响其它条目，成功项用
     * 一次 `state.setToggles` 落盘。read-after 校验用一次快照覆盖整批，
     * ghost shadow（宿主注册表里仍是本插件 shadow、本地没有 disposer）与同层
     * runtime 冲突都按单条口径判为失败，不做假成功。
     */
    async setEnabledBatch(input): Promise<SessionSkillBatchResult> {
      if (disposed) return { ok: false, errors: ["skill session registry disposed"], outcomes: [] };
      const sessionId = typeof input?.sessionId === "string" ? input.sessionId : "";
      if (sessionId.length === 0) return { ok: false, errors: ["sessionId is required"], outcomes: [] };
      if (!Array.isArray(input?.entries)) return { ok: false, errors: ["entries must be an array"], outcomes: [] };

      /** 去重（同名后者覆盖）并保持首次出现顺序。 */
      const wanted = new Map<string, boolean | undefined>();
      for (const raw of input.entries) {
        if (raw === null || typeof raw !== "object") continue;
        const name = typeof (raw as { name?: unknown }).name === "string" ? (raw as { name: string }).name : "";
        if (name.length === 0) continue;
        const rawEnabled = (raw as { enabled?: unknown }).enabled;
        wanted.set(name, rawEnabled === true ? true : rawEnabled === false ? false : undefined);
      }
      if (wanted.size === 0) return { ok: true, errors: [], outcomes: [] };

      const record = find(sessionId);
      if (record === undefined) {
        if (deps.state === undefined) {
          return { ok: false, errors: [`session not found: ${sessionId}`], outcomes: [] };
        }
        await deps.state.ready();
        const writes: Record<string, boolean | undefined> = {};
        for (const [name, enabled] of wanted) writes[name] = enabled;
        if (Object.keys(writes).length > 0) await deps.state.setToggles(sessionId, "skills", writes);
        return {
          ok: true,
          errors: [],
          outcomes: [...wanted.keys()].map((name) => ({ name, ok: true })),
        };
      }
      const skills = skillsOf(record);
      if (typeof skills?.register !== "function") {
        return { ok: false, errors: [`skills service unavailable for session ${sessionId}`], outcomes: [] };
      }

      return withQueue(record, async () => {
        await hydrateExplicit(record);
        record.projectDefaults = new Set(await projectDisabledOf(record.cwd));
        const registry = deps.registry;
        const agent = record.agent;
        const names = new Set(wanted.keys());

        // 一次目录发现：整批的注入元数据（展示缓存）+ ghost shadow 判定。
        let prepared: { rows: Map<string, ClassifiedInjectedRow>; ownShadow: Set<string> } | undefined;
        if (registry !== undefined) {
          try {
            prepared = await registry.prepareShadows(agent, sessionId, record.cwd, names);
          } catch {
            prepared = undefined;
          }
        }

        const outcomes = new Map<string, SessionSkillBatchOutcome>();
        const persistWrites: Record<string, boolean | undefined> = {};
        /** 本批真正动过 shadow 的项（稍后用一次快照批量校验）。 */
        const touched: Array<
          | { name: string; kind: "disabled"; recorded: () => void; prevExplicit: boolean | undefined }
          | { name: string; kind: "enabled"; restore: (() => void) | undefined; prevExplicit: boolean | undefined }
        > = [];
        /** 成功关闭的名字（含已存在的 shadow）：稍后统一写回展示元数据。 */
        const disabledNames: string[] = [];

        for (const [name, enabled] of wanted) {
          const desired = enabled === undefined ? !record.projectDefaults.has(name) : enabled === true;
          const prevExplicit = record.explicit.get(name);
          if (!desired) {
            // 关闭：`false` = 显式关闭；`undefined` = 项目默认禁用驱动的 shadow。
            const viaProject = enabled !== false;
            const result = registerShadowCore(record, name, viaProject);
            if (!result.ok) {
              outcomes.set(name, { name, ok: false, errors: result.errors });
              continue;
            }
            const recorded = record.shadows.get(name) ?? record.projectShadows.get(name);
            if (enabled === undefined) record.explicit.delete(name);
            else record.explicit.set(name, false);
            rebucketShadow(record, name);
            // 只对**本次新建**的 shadow 做 read-after 校验（与单条幂等短路一致）。
            if (recorded !== undefined && result.created === true) {
              touched.push({ name, kind: "disabled", recorded, prevExplicit });
            }
            disabledNames.push(name);
            persistWrites[name] = enabled;
            outcomes.set(name, { name, ok: true });
            continue;
          }
          // 开启：解除 shadow（显式开启 / 清除显式覆盖回项目默认）。
          const released = releaseShadowCore(record, name);
          if (!released.ok) {
            outcomes.set(name, { name, ok: false, errors: released.errors });
            continue;
          }
          // 本地没有 disposer、但宿主快照里胜者已是本插件 shadow = ghost：不做假成功。
          if (!released.released && prepared?.ownShadow.has(name) === true) {
            outcomes.set(name, {
              name,
              ok: false,
              errors: [
                `skill "${name}" 的会话级禁用仍由宿主技能注册表持有（可能来自插件重载前的实例），无法在本会话恢复；请重新打开该会话`,
              ],
            });
            continue;
          }
          if (enabled === undefined) record.explicit.delete(name);
          else record.explicit.set(name, true);
          touched.push({ name, kind: "enabled", restore: released.restore, prevExplicit });
          persistWrites[name] = enabled;
          outcomes.set(name, { name, ok: true });
        }

        // 一次 read-after 校验（等同逐条 `ensureShadow` / `releaseShadow` 的校验）。
        if (registry !== undefined && touched.length > 0) {
          let verified: Map<string, boolean> | undefined;
          try {
            verified = await registry.verifyShadows(agent, record.cwd, new Set(touched.map((entry) => entry.name)));
          } catch {
            verified = undefined;
          }
          if (verified !== undefined) {
            for (const entry of touched) {
              if (outcomes.get(entry.name)?.ok !== true) continue;
              const still = verified.get(entry.name) === true;
              if (entry.kind === "disabled" && !still) {
                // 同层 runtime 先到先得（宿主 registry 硬边界）：撤销簿记并回滚注册。
                record.shadows.delete(entry.name);
                record.projectShadows.delete(entry.name);
                try {
                  entry.recorded();
                } catch {
                  /* 回滚失败无额外副作用 */
                }
                if (entry.prevExplicit === undefined) record.explicit.delete(entry.name);
                else record.explicit.set(entry.name, entry.prevExplicit);
                delete persistWrites[entry.name];
                outcomes.set(entry.name, {
                  name: entry.name,
                  ok: false,
                  errors: [`skill "${entry.name}" 由同作用域已注册的运行时条目提供，无法在本会话禁用`],
                });
              } else if (entry.kind === "enabled" && still) {
                // no-op disposer / 旧实例 ghost：恢复簿记，状态与 UI 保持一致。
                entry.restore?.();
                if (entry.prevExplicit === undefined) record.explicit.delete(entry.name);
                else record.explicit.set(entry.name, entry.prevExplicit);
                delete persistWrites[entry.name];
                outcomes.set(entry.name, {
                  name: entry.name,
                  ok: false,
                  errors: [
                    `failed to restore skill "${entry.name}": 会话级禁用仍被其它注册持有（同层 runtime 先到先得），本会话无法恢复；请重新打开该会话`,
                  ],
                });
              }
            }
          }
        }
        // register 触发的 skills/change 会清掉刚缓存的元数据：批量写回被遮蔽项。
        if (registry !== undefined && prepared !== undefined) {
          for (const name of disabledNames) {
            if (outcomes.get(name)?.ok !== true) continue;
            const row = prepared.rows.get(name);
            if (row === undefined) continue;
            try {
              registry.keepShadowed(agent, sessionId, row);
            } catch {
              /* 缓存写回失败只影响展示，不影响启停 */
            }
          }
        }

        // 一次落盘：`undefined` 值 = 清除显式覆盖（`writeToggle` 已实现该语义）。
        if (deps.state !== undefined && Object.keys(persistWrites).length > 0) {
          await deps.state.setToggles(sessionId, "skills", persistWrites, metaOf(record));
        }
        return { ok: true, errors: [], outcomes: [...outcomes.values()] };
      });
    },

    async reconcileProject(cwd): Promise<SessionSkillOpResult> {
      if (disposed) return { ok: false, errors: ["skill session registry disposed"] };
      const projectRoot = cwd !== undefined ? findProjectRoot(cwd) : undefined;
      const errors: string[] = [];
      for (const record of sessions.values()) {
        if (projectRoot !== undefined && record.projectRoot !== projectRoot) continue;
        const result = await runApply(record, 0);
        if (!result.ok) errors.push(...result.errors);
      }
      return errors.length > 0 ? { ok: false, errors } : { ok: true };
    },

    sessionState(sessionId): string[] {
      const record = sessions.get(sessionId);
      if (record === undefined) return [];
      return [...new Set([...record.shadows.keys(), ...record.projectShadows.keys()])].sort();
    },

    trackAgent(agent): void {
      track(agent);
    },

    agentOf(sessionId): any | undefined {
      return find(sessionId)?.agent;
    },

    isShadowed(sessionId, name): boolean {
      const record = sessions.get(sessionId);
      return record !== undefined && shadowed(record, name);
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const off of listeners) {
        try {
          off();
        } catch {
          /* 卸载阶段忽略监听解绑异常 */
        }
      }
      listeners.length = 0;
      // best-effort 解除已记录的会话 shadow：注册挂在 agent ctx 上，插件卸载 /
      // 热重载不会自动回收（agent 可能仍存活），不显式释放会留下「插件已卸载、
      // 技能仍被隐藏」的 ghost shadow。单个 disposer 失败不影响其余清理。
      const released = new Set<() => void>();
      for (const record of sessions.values()) {
        if (record.retryTimer !== undefined) clearTimeout(record.retryTimer);
        for (const disposer of [...record.shadows.values(), ...record.projectShadows.values()]) {
          if (released.has(disposer)) continue;
          released.add(disposer);
          try {
            disposer();
          } catch {
            /* 卸载阶段 best-effort：disposer 可能已随 agent fiber 回收 */
          }
        }
      }
      sessions.clear();
      warnedSkips.clear();
    },
  };
  registryApi = api;
  // api 就绪后再补应用存量 agent：此前 agent/created 若已错过，这里仍能恢复
  // 落盘显式开关（异步，不阻塞插件加载）。
  try {
    const existing = ctx.get?.("agents")?.list?.() ?? [];
    for (const agent of Array.isArray(existing) ? existing : []) void onAgentCreated(agent);
  } catch {
    /* agents 服务不可用：按无存量会话处理 */
  }
  return api;
}

