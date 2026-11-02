/**
 * Skills 的**会话级**开关（按会话落盘）与**默认值**（全局默认 + 项目覆盖）的
 * 会话内投影。
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
 *   2. **默认关闭投影**（`projectShadows`）：有效默认关闭名单
 *      （`(global.skills ∪ project.skills) \ project.enabledSkills`，见
 *      `overrides/*` 与 `shared/skill-defaults.ts`）在 agent 创建 / 项目默认
 *      热更新 / 全局默认切换时 reconcile 进去。
 *
 * 优先级：**会话显式开关 > 工作区覆盖 > 全局默认**（显式开可以覆盖默认关）。
 *
 * **默认快照冻结（v21.2）**：默认 / 可见性 / 项目覆盖的变更**只影响新建会话**。
 * 会话创建时（首次投影）把当时的有效默认快照冻结到 `record.capabilities` /
 * `record.projectDefaults`；之后写盘不再传播到该会话（`reconcileProject` 只重放
 * 冻结快照）。会话级显式开关仍按 `explicit` 即时生效。
 * `enabledInSession` 以**实际注册状态**为准（不只看意图），并且 register 之后
 * 会 read-after 校验胜者确实是本插件的 shadow，消灭「UI 已禁用、实际仍可见」
 * 的假成功。
 *
 * **磁盘技能与注入技能都覆盖**（v20.1 B2）：宿主的 filesystem provider 注册在
 * host 层（global layer），而本插件的 shadow 注册在 agent 层 —— 读取时最近层
 * 直接赢，所以 `~/.agents/skills` / `<项目>/.agents/skills` 的磁盘技能同样能被
 * shadow 关闭（已用真实宿主 `SkillRegistry` 验证）。**已知硬边界**：preset 自带
 * 的 filesystem provider 与 shadow **同层**（project rank 100/200 < runtime 250），
 * 这类条目无法关闭；`registry.verifyShadow` 会识破并按业务失败返回，绝不静默
 * 假装已生效（面板侧以 `canToggleGlobal=false` + 原因禁用开关）。
 *
 * 语义边界：
 *   - **只可关闭，不能强制开启**：文件级已禁用（frontmatter 双 false）或项目
 *     内 shadow stub 的条目，本模块只把它们从可切换列表里过滤掉，不会去
 *     「反向开启」；
 *   - **按会话落盘**：显式会话开关写在插件数据目录
 *     （`<dshHome>/dsh-capability-settings/session-capabilities.json`，见
 *     `session-state.ts`），agent 重建 / 宿主重启后恢复；默认关闭名单落在
 *     `<dshHome>/dsh-capability-settings/capability-overrides.json`（项目层）
 *     与 `capability-global-overrides.json`（全局层）；
 *   - 找不到 live agent（冷会话）时开关失败并返回业务错误，不做状态暂存。
 *
 * @module dsh-capability-settings/skills/session
 */
import type { SessionStateStore } from "../session-state.js";
import type { SkillDefaultSets } from "../shared/skill-defaults.js";
import type { CapabilityDefaults } from "../overrides/types.js";
import type { SkillRegistryBridge } from "./registry.js";
import type { SkillSummaryView } from "./types.js";
/** 会话级 Skills 开关 / 默认值投影的依赖。 */
export interface SkillSessionDeps {
    /**
     * 默认值三层集合快照（全局默认 + 项目覆盖）读取器；**首选注入点**
     * （`overrides.defaultSets`）。缺省时回退 {@link projectDisabled}。
     */
    defaultSets?: (cwd?: string) => Promise<SkillDefaultSets | undefined>;
    /**
     * 旧注入点 / 兼容回退：项目关闭名单（不含全局默认层）。
     * 新装配请用 {@link defaultSets}（B2 需要全局层）。
     */
    projectDisabled?: (cwd?: string) => Promise<readonly string[]>;
    /**
     * 磁盘技能名读取器（v20.1 B2）：默认关闭必须对磁盘技能生效，投影前用它
     * 做存在性判定，避免给不存在 / 已删除的名字注册 ghost shadow。
     */
    diskNames?: (cwd?: string) => Promise<readonly string[]>;
    /**
     * v21：可见性 + 每工作区默认的批量入口
     * （`overrides.capabilityDefaultsMany("skills", names, cwd)`）。
     * 缺省时按「全部可见 + 旧默认」处理（旧装配 / 回归脚本兼容）。
     */
    capabilityDefaults?: (names: readonly string[], cwd?: string) => Promise<Map<string, CapabilityDefaults>>;
    /**
     * v21：可见性里出现过的技能名（`overrides.visibilityKeys("skills")`）。
     *
     * 运行时 gate 用它发现「不在默认关闭名单、但被可见性 / 每工作区默认关掉」
     * 的技能（mode/selected/每工作区 defaultEnabled=false 都可能是这种）。
     */
    visibilityNames?: (cwd?: string) => Promise<readonly string[]>;
    /** 宿主 registry 桥（读注入技能 + read-before/after-shadow 校验）；缺省退化为纯磁盘行为。 */
    registry?: SkillRegistryBridge;
    /**
     * 会话级开关的持久化存储（可选）：提供时显式开关按 sessionId 落盘，
     * agent 重建 / 宿主重启后恢复；省略时保持旧的纯内存行为。
     */
    state?: SessionStateStore;
    /** 宿主日志（结构子集）。 */
    logger?: {
        warn?: (message: string) => void;
    };
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
export type SessionSkillOpResult = {
    ok: true;
} | {
    ok: false;
    errors: string[];
};
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
     * v21：与 {@link list} 相同的行，外加工作区视图的 `hiddenCount`（被可见性隐藏
     * 的技能数，供「另有 N 个未开放」提示）。
     *
     * RPC `skills.sessionList` 用这个（value 恒为 `{skills, hiddenCount}`）；宿主内部
     * 调用方（jev / session-bulk）继续用数组形态的 `list`。
     */
    listView(baseList: (cwd?: string) => Promise<SkillSummaryView[]>, cwd?: string, sessionId?: string): Promise<{
        skills: SessionSkillView[];
        hiddenCount: number;
    }>;
    /**
     * 设置本会话开关（按会话落盘；无 `state` 依赖时仅内存）。
     *
     * `enabled=false` 注册 shadow；`true` 解除；`undefined` 清除显式覆盖、
     * 回到项目默认（与 MCP 的 `setSessionEnabled` 语义对齐）。
     */
    setEnabled(input: {
        sessionId: string;
        name: string;
        enabled?: boolean;
    }): Promise<SessionSkillOpResult>;
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
    /**
     * 对同项目的 live 会话重放**已冻结**的默认投影（幂等）。
     *
     * v21.2 起默认 / 可见性变更只影响新会话，因此本方法不再读取新配置：已冻结的
     * 会话保持创建时快照（本方法基本是 no-op，仅用于重试 pending / 解除旧 shadow 等
     * 自愈路径）；组合根已不再在默认写盘后调用它。
     */
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
/**
 * 用全局快照补齐工作区视图漏掉的**注入行**（按 name 去重，工作区快照优先）。
 *
 * 只补 `injected === true` 且工作区结果里不存在的行：磁盘行 / 项目行 /
 * `projectShadow` 判定 / `toggleable` 过滤语义完全不变。宿主 registry 在带
 * cwd 的快照里可能丢掉某些全局注入技能（插件 / preset 注入），它们在全局视图
 * 可见，工作区 / 会话列表也应可见。
 *
 * index.ts 的 `panelSkillRows(cwd)` 与 {@link SkillSessionRegistry.listView}
 * 共用这一份去重逻辑（禁止两处各写一套）。
 *
 * @param rows 工作区快照合并后的行（磁盘 + 注入，可能缺全局注入技能）
 * @param globalInjected 全局快照（cwd 缺省）的注入行
 * @returns 去重后的行（按 name 排序；无新增时返回入参浅拷贝）
 */
export declare function supplementInjectedRows(rows: readonly SkillSummaryView[], globalInjected: readonly SkillSummaryView[]): SkillSummaryView[];
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
export declare function createSkillSessionRegistry(ctx: any, deps?: SkillSessionDeps): SkillSessionRegistry;
