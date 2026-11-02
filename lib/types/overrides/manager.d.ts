/**
 * 默认关闭管理服务（挂载为 `ctx.capabilityPanel.overrides`）。
 *
 * **三层存储**（B2，v20.1；v20.2 扩到 MCP；v21 扩到 Tools + 可见性 + 全局文件 v2）：
 *
 *   1. **全局层**：`<dshHome>/dsh-capability-settings/capability-global-overrides.json`
 *      ——`{ version: 1, skills: string[], mcp: string[] }`，全局默认关闭名单；
 *      不改技能文件、不改 MCP 注入方配置、不卸载共享实例。
 *      面板全局视图的 Skills / 外部注入 MCP / Tools 兜底默认写这里
 *      （见 {@link globalToggle} / {@link globalToggleMany}）；v21 起的 `visibility`
 *      也在这里（{@link setVisibility}）。
 *   2. **项目层（统一存储）**：`<dshHome>/dsh-capability-settings/capability-overrides.json`
 *      ——一个文件按**项目根**（`findProjectRoot(cwd)`）分 key，记录每个项目默认
 *      关闭的 MCP server / Skill，以及（B2）本项目**显式重新打开**的 Skill /
 *      MCP server（`enabledSkills` / `enabledMcp`）。MCP 列表读取、MCP 自动挂载、
 *      技能默认投影共用它的 `sets()` 快照；面板通过 `get()` 读全量、`toggle()`
 *      切换某一条。
 *
 * **有效默认**（契约 §1.3）：
 *
 *   - Skills：`(global.skills ∪ project.skills) \ project.enabledSkills`；
 *     `defaultSets()` / {@link effectiveDisabledSkills} 是唯一计算入口；
 *   - MCP：`(global.mcp ∪ project.mcp) \ project.enabledMcp`；
 *     {@link mcpDefaultSets} 是旧计算入口（实现见 `shared/mcp-defaults.ts`）。
 *
 * **v21 的统一计算入口**是 {@link capabilityDefaults} / {@link capabilityDefaultsMany}：
 * `visible && (projectOverride ?? workspaces[ws].defaultEnabled ?? !兜底全局默认关闭)`
 * ——可见性 + 每工作区默认 + 项目三态合并成一个快照，三域列表投影与运行时 gate
 * 都从它取值（见 `shared/visibility.ts`）。
 *
 * **旧位置兼容**：`<项目根>/.agents/capability-overrides.json`（以及更早的
 * `.dsh` / `.claude`）仍会被读取；某个项目在统一存储里还没有记录时，`sets()`
 * 回退到旧文件。首次 `toggle()` 会把旧内容并入统一存储并删除项目内旧文件
 * （之后旧文件不再生效，避免同一份声明两处维护）。
 *
 * **写盘语义（v21.2）**：默认关闭 / 可见性**只写配置、只对新建会话生效**——
 * 写盘后**不**对已存在的 live 会话做任何传播（不 reconcile / 不 refreshRestrictions /
 * 不扇出）。会话级显式开关（`skills.setSessionEnabled`、`mcp.setSessionEnabled`、
 * `tools.setSessionEnabled`）仍即时只作用于当前会话。新建会话在 `agent/created`
 * 初始化路径按文件内容计算（skills 投影 / mcp remount / tools 冻结快照）。
 *
 * 无工作区（cwd 为 undefined）时不适用任何项目级禁用：`sets()` 返回全空
 * 快照，`toggle()` 直接报错；全局层不受工作区影响。
 *
 * @module dsh-capability-settings/overrides/manager
 */
import type { SkillDefaultSets } from "../shared/skill-defaults.js";
import type { McpDefaultSets } from "../shared/mcp-defaults.js";
import type { VisibilityDomain, VisibilitySets } from "../shared/visibility.js";
import type { CapabilityDefaults, CapabilityDomain, GlobalOverrideToggleInput, GlobalOverridesView, GlobalVisibilityInput, OverridesSet, OverridesView, VisibilityConflict, VisibilitySetResult } from "./types.js";
/** 管理服务的构造依赖。 */
export interface OverridesManagerDeps {
    dshHome?: string;
    /**
     * Tools 的**旧全局默认兜底**（`tools-global.json` 的 disabled 集合）。
     *
     * v21 起 Tools 的全局默认写入 `capability-global-overrides.json` 的 `tools`，
     * 但旧文件继续按「并集」参与兜底（不删、不改写），保证已有用户语义不变。
     * 缺省 = 无旧文件（只用新名单）。
     */
    toolsGlobalDisabled?: () => ReadonlySet<string> | Promise<ReadonlySet<string>>;
}
/** toggle 的入参（B2 起支持可选的 `enabled`）。 */
export interface OverrideToggleInput {
    /** 项目作用域必填：工作区目录。 */
    cwd?: string;
    domain: CapabilityDomain;
    /** 要切换的全局条目名 / 键。 */
    key: string;
    /**
     * 可选：显式指定目标状态（B2 项目层语义；不传时保持旧的「翻转」行为）。
     *
     *   - `true`：恢复启用 —— 从项目禁用名单（`skills` / `mcp`）移除；**仅当全局
     *     默认关闭时**才写入 `enabledSkills` / `enabledMcp`（否则清掉该名字的项目
     *     重新打开标记，等价显式启用）；
     *   - `false`：禁用 —— 加入项目禁用名单，并从重新打开名单移除；
     *   - 不传：翻转**有效默认**（全局默认 < 工作区显式）。
     */
    enabled?: boolean;
}
/** 写操作的结果：成功或带错误信息列表。 */
export type OverrideOpResult = {
    ok: true;
} | {
    ok: false;
    errors: string[];
};
/** 创建管理服务。 */
export declare function createOverridesManager(deps?: OverridesManagerDeps): {
    sets: (cwd?: string) => Promise<{
        mcp: string[];
        skills: string[];
    }>;
    projectSets: (cwd?: string) => Promise<OverridesSet>;
    get: (cwd?: string) => Promise<OverridesView>;
    toggle: (input: OverrideToggleInput) => Promise<OverrideOpResult>;
    globalGet: () => Promise<GlobalOverridesView>;
    globalToggle: (input: GlobalOverrideToggleInput | Record<string, unknown>) => Promise<OverrideOpResult>;
    globalToggleMany: (input: {
        domain?: unknown;
        keys?: unknown;
        disabled?: unknown;
    }) => Promise<{
        ok: true;
        applied: number;
    } | {
        ok: false;
        errors: string[];
    }>;
    setVisibility: (input: GlobalVisibilityInput | Record<string, unknown>) => Promise<VisibilitySetResult>;
    visibilityConflicts: (input: GlobalVisibilityInput | Record<string, unknown>) => Promise<{
        ok: true;
        conflicts: VisibilityConflict[];
    } | {
        ok: false;
        errors: string[];
    }>;
    visibilitySets: () => Promise<VisibilitySets>;
    visibilityKeys: (domain: VisibilityDomain) => Promise<string[]>;
    invisibleKeys: (domain: VisibilityDomain, cwd?: string) => Promise<string[]>;
    capabilityDefaults: (domain: VisibilityDomain, key: string, cwd?: string) => Promise<CapabilityDefaults>;
    capabilityDefaultsMany: (domain: VisibilityDomain, keys: readonly string[], cwd?: string) => Promise<Map<string, CapabilityDefaults>>;
    defaultSets: (cwd?: string) => Promise<SkillDefaultSets>;
    effectiveDisabledSkills: (cwd?: string) => Promise<string[]>;
    mcpDefaultSets: (cwd?: string) => Promise<McpDefaultSets>;
};
/** 管理服务的完整类型（构造函数的返回值）。 */
export type OverridesManager = ReturnType<typeof createOverridesManager>;
