/**
 * 默认关闭管理服务（挂载为 `ctx.capabilityPanel.overrides`）。
 *
 * **两层存储**（B2，v20.1）：
 *
 *   1. **全局层**：`<dshHome>/dsh-capability-settings/capability-global-overrides.json`
 *      ——`{ version: 1, skills: string[] }`，全局默认关闭名单；不改技能文件。
 *      面板全局视图的 Skills 开关写这里（见 {@link globalToggle}）。
 *   2. **项目层（统一存储）**：`<dshHome>/dsh-capability-settings/capability-overrides.json`
 *      ——一个文件按**项目根**（`findProjectRoot(cwd)`）分 key，记录每个项目默认
 *      关闭的 MCP server / Skill，以及（B2）本项目**显式重新打开**的 Skill
 *      （`enabledSkills`）。MCP 列表读取、MCP 自动挂载、技能默认投影共用它的
 *      `sets()` 快照；面板通过 `get()` 读全量、`toggle()` 切换某一条。
 *
 * **有效默认**（契约 §1.3）：`(global.skills ∪ project.skills) \ project.enabledSkills`；
 * `defaultSets()` / {@link effectiveDisabledSkills} 是唯一计算入口，供面板列表与
 * `skills/session.ts` 的运行时投影共用（见 `shared/skill-defaults.ts`）。
 *
 * **旧位置兼容**：`<项目根>/.agents/capability-overrides.json`（以及更早的
 * `.dsh` / `.claude`）仍会被读取；某个项目在统一存储里还没有记录时，`sets()`
 * 回退到旧文件。首次 `toggle()` 会把旧内容并入统一存储并删除项目内旧文件
 * （之后旧文件不再生效，避免同一份声明两处维护）。
 *
 * `skills` 域对**磁盘技能与注入技能**都生效：磁盘技能靠 agent 作用域 runtime
 * shadow（与全局层投影片同一条机制），注入技能同样是 runtime shadow；由组合根在
 * 写盘成功后对同项目的 live 会话（全局层则对所有 live 会话）做增量 reconcile
 * （见 `index.ts` / `skills/session.ts`）。
 *
 * 无工作区（cwd 为 undefined）时不适用任何项目级禁用：`sets()` 返回全空
 * 快照，`toggle()` 直接报错；全局层不受工作区影响。
 *
 * @module dsh-capability-settings/overrides/manager
 */
import type { SkillDefaultSets } from "../shared/skill-defaults.js";
import type { CapabilityDomain, GlobalOverrideToggleInput, GlobalOverridesView, OverridesSet, OverridesView } from "./types.js";
/** 管理服务的构造依赖。 */
export interface OverridesManagerDeps {
    dshHome?: string;
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
     *   - `true`：恢复启用 —— 从项目 `skills` 移除；**仅当全局默认关闭时**才写入
     *     `enabledSkills`（否则清掉该名字的项目态，等价显式启用）；
     *   - `false`：禁用 —— 加入项目 `skills`，并从 `enabledSkills` 移除；
     *   - 不传：翻转**有效默认**（`mcp` 域仍是翻转禁用清单成员）。
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
    defaultSets: (cwd?: string) => Promise<SkillDefaultSets>;
    effectiveDisabledSkills: (cwd?: string) => Promise<string[]>;
};
/** 管理服务的完整类型（构造函数的返回值）。 */
export type OverridesManager = ReturnType<typeof createOverridesManager>;
