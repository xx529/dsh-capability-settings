/**
 * Skills 的**会话级**开关（内存态、不落盘）。
 *
 * 背景：宿主 `skills` 注册表（`@deepseek-ai/dsh-skill` 的 `SkillRegistry`）
 * 没有 disable/restrict 一类的按会话禁用 API，但它是**分层**的：`register()`
 * 把 runtime skill 注册进「调用方 ctx 所属 scope」的层（`this.layers.effect(
 * this.ctx, ...)`，`scopeOf(this.ctx)`），读取时按 `global → 祖先 → 最近层`
 * 合并，**同名最近层赢**。因此：
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
 * 语义边界：
 *   - **只可关闭，不能强制开启**：文件级已禁用（frontmatter 双 false）或项目
 *     内 shadow stub 的条目，本模块只把它们从可切换列表里过滤掉，不会去
 *     「反向开启」；
 *   - **纯内存**：不落盘，agent 销毁 / 宿主重启即回到默认（本期语义）；
 *   - 找不到 live agent（冷会话）时开关失败并返回业务错误，不做状态暂存。
 *
 * @module dsh-capability-settings/skills/session
 */

import type { SkillSummaryView } from "./types.js";

/** 面板「本会话」列表的一行：磁盘视图 + 本会话启用态。 */
export interface SessionSkillView extends SkillSummaryView {
  /** 本会话是否生效（默认 true；被本会话 shadow 后 false）。 */
  enabledInSession: boolean;
  /** 当前是否有该 session 的 agent ctx（false 时 UI 置灰）。 */
  canToggleInSession: boolean;
}

/** 会话级 Skills 开关的结果（业务信封形状，见 remote.ts 文件头）。 */
export type SessionSkillOpResult = { ok: true } | { ok: false; errors: string[] };

/** 会话级 Skills 开关注册表（挂到 `capabilityPanel.skills` 上）。 */
export interface SkillSessionRegistry {
  /**
   * 合并磁盘列表 + 本会话启用态。
   *
   * @param baseList 磁盘视图函数（由 index.ts 注入 skills manager 的 list）
   * @param cwd 工作区路径（决定项目根，用于磁盘视图）
   * @param sessionId 会话 id；缺省时全部条目 `canToggleInSession:false`
   */
  list(baseList: (cwd?: string) => Promise<SkillSummaryView[]>, cwd?: string, sessionId?: string): Promise<SessionSkillView[]>;
  /** 设置本会话开关（内存态，不落盘）。enabled=false 注册 shadow；true 解除。 */
  setEnabled(input: { sessionId: string; name: string; enabled: boolean }): Promise<SessionSkillOpResult>;
  /** 本会话被关闭的 skill 名（只读快照，测试/诊断用）。 */
  sessionState(sessionId: string): string[];
  /** 卸载：移除生命周期监听并清空内存状态（agent fiber 自己回收 shadow 注册）。 */
  dispose(): void;
}

/** 每个 session 的记录：agent 引用 + 本会话已注册的 shadow disposer。 */
interface SessionRecord {
  agent: any;
  shadows: Map<string, () => void>;
}

/** shadow skill 的描述（仅出现在注册表内部，用户看不到正文）。 */
const SHADOW_DESCRIPTION = "本会话已禁用（capability-panel）";

/** 从注册表注册失败里提取可读错误信息。 */
function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 构造会话级 Skills 开关注册表。
 *
 * 只做「簿记 + 注册/解除」；磁盘列表仍由 `skills/manager.ts` 提供，避免两处
 * 读取口径分叉。生命周期监听与 `mcp/loader.ts` 的 mountAgent 同款：
 * `agent/created` 登记、`agent/disposed` 清理（shadow 注册挂在 agent fiber 的
 * 效果上，agent 销毁时由 cordis 自动回收，这里只清 Map）。
 *
 * @param ctx 宿主上下文（插件自身的 ctx；用 `ctx.get("agents")` 补登记存量）
 */
export function createSkillSessionRegistry(ctx: any): SkillSessionRegistry {
  /** sessionId → 记录（agent.id === session.id，见 dsh-agent）。 */
  const sessions = new Map<string, SessionRecord>();
  /** 生命周期监听 disposer（`ctx.on` 在 cordis 4 返回函数）。 */
  const listeners: Array<() => void> = [];
  let disposed = false;

  /** 登记一个 agent（无 ctx / 无 id 的 stub 跳过；重复登记先到先得）。 */
  function track(agent: any): void {
    if (agent?.ctx === undefined || agent?.id === undefined) return;
    if (sessions.has(agent.id)) return;
    sessions.set(agent.id, { agent, shadows: new Map() });
  }

  /** 按 sessionId 找记录；内存里没有时从 `agents.list()` 补登记一次。 */
  function find(sessionId: string): SessionRecord | undefined {
    const known = sessions.get(sessionId);
    if (known !== undefined) return known;
    const agents = ctx.get?.("agents")?.list?.() ?? [];
    for (const agent of agents) {
      if (agent?.id !== sessionId) continue;
      track(agent);
      return sessions.get(sessionId);
    }
    return undefined;
  }

  /** 当前 session 的 skills 注册表代理（访问方是 agent.ctx ⇒ 注册进 agent 层）。 */
  function skillsOf(record: SessionRecord): any {
    return record.agent?.ctx?.get?.("skills");
  }

  // —— 生命周期簿记 ——
  if (typeof ctx.on === "function") {
    const offCreated = ctx.on("agent/created", ({ agent }: any) => track(agent));
    if (typeof offCreated === "function") listeners.push(offCreated);
    const offDisposed = ctx.on("agent/disposed", ({ agent }: any) => {
      // 不手动 dispose shadow：注册挂在该 agent ctx 的效果上，fiber 销毁即回收。
      if (agent?.id !== undefined) sessions.delete(agent.id);
    });
    if (typeof offDisposed === "function") listeners.push(offDisposed);
  }

  // 插件加载时已经存活的 agent（resume / 历史 session）补登记，等首次开关时
  // 再注册 shadow（避免加载期做非必要注册）。
  for (const agent of ctx.get?.("agents")?.list?.() ?? []) track(agent);

  return {
    async list(baseList, cwd, sessionId): Promise<SessionSkillView[]> {
      const rows = await baseList(cwd);
      // 冷会话 / 未知会话也返回列表：只是全部置灰（canToggleInSession=false）。
      const record = sessionId !== undefined ? find(sessionId) : undefined;
      const shadows = record?.shadows;
      return rows
        // 硬关闭的条目（文件级双向 false、项目内 shadow stub）不可在会话层切换：
        // shadow 只能"再藏一层"，无法把文件级禁用反向开启，过滤掉避免误导。
        .filter((row) => row.shadowStub !== true && (row.invocation.modelInvocable || row.invocation.userInvocable))
        .map((row) => ({
          ...row,
          enabledInSession: shadows?.has(row.name) !== true,
          canToggleInSession: record !== undefined,
        }))
        // 磁盘视图本身已按 name 排序；这里再排一次，保证 baseList 实现变化时
        // 面板顺序稳定。
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    async setEnabled(input): Promise<SessionSkillOpResult> {
      if (disposed) return { ok: false, errors: ["skill session registry disposed"] };
      const sessionId = typeof input?.sessionId === "string" ? input.sessionId : "";
      const name = typeof input?.name === "string" ? input.name : "";
      if (sessionId.length === 0) return { ok: false, errors: ["sessionId is required"] };
      if (name.length === 0) return { ok: false, errors: ["skill name is required"] };

      const record = find(sessionId);
      if (record === undefined) return { ok: false, errors: [`session not found: ${sessionId}`] };

      const skills = skillsOf(record);
      if (typeof skills?.register !== "function") {
        return { ok: false, errors: [`skills service unavailable for session ${sessionId}`] };
      }

      // 开启 = 解除本会话的 shadow（幂等：没关过就直接成功）。
      if (input.enabled) {
        const dispose = record.shadows.get(name);
        if (dispose !== undefined) {
          try {
            dispose();
          } catch (error) {
            // disposer 理论上幂等；这里仍降级成业务失败，避免"UI 显示已恢复、
            // 实际仍被遮蔽"的假成功。
            return { ok: false, errors: [`failed to restore skill "${name}": ${errMessage(error)}`] };
          }
          record.shadows.delete(name);
        }
        return { ok: true };
      }

      // 关闭 = 在本会话 scope 注册同名 runtime shadow（幂等：已关过不重注册）。
      if (record.shadows.has(name)) return { ok: true };
      try {
        const dispose = skills.register({
          name,
          description: SHADOW_DESCRIPTION,
          content: "",
          invocation: { modelInvocable: false, userInvocable: false },
        });
        // 同层已有同名 runtime skill 时 registry 返回 no-op disposer（warn 不抛）：
        // 仍记下来，之后"恢复"会调用它（幂等无害）。
        record.shadows.set(name, typeof dispose === "function" ? dispose : () => undefined);
        return { ok: true };
      } catch (error) {
        // 名称非法 / 服务内部异常都收敛成业务失败，不向 RPC 层抛。
        return { ok: false, errors: [`failed to disable skill "${name}": ${errMessage(error)}`] };
      }
    },

    sessionState(sessionId): string[] {
      const record = sessions.get(sessionId);
      if (record === undefined) return [];
      return [...record.shadows.keys()].sort();
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
      sessions.clear();
    },
  };
}
