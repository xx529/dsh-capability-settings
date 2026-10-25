/**
 * 项目级"默认关闭"管理服务（挂载为 `ctx.capabilityPanel.overrides`）。
 *
 * **统一存储**：`<dshHome>/dsh-capability-settings/capability-overrides.json`
 * ——一个文件按**项目根**（`findProjectRoot(cwd)`）分 key，记录每个项目默认关闭
 * 的 MCP server / 注入技能清单。MCP 列表读取、MCP 自动挂载、技能项目默认投影
 * 共用它的 `sets()` 快照；面板通过 `get()` 读全量、`toggle()` 切换某一条。
 *
 * **旧位置兼容**：`<项目根>/.agents/capability-overrides.json`（以及更早的
 * `.dsh` / `.claude`）仍会被读取；某个项目在统一存储里还没有记录时，`sets()`
 * 回退到旧文件。首次 `toggle()` 会把旧内容并入统一存储并删除项目内旧文件
 * （之后旧文件不再生效，避免同一份声明两处维护）。
 *
 * `skills` 域只对**宿主 registry 注入的技能**生效（写入 `skills: string[]`；
 * 非法/非 kebab-case 名字直接拒绝），由组合根在写盘成功后对同项目的 live
 * 会话做增量 reconcile（见 `index.ts` / `skills/session.ts`）。
 *
 * 无工作区（cwd 为 undefined）时不适用任何项目级禁用：`sets()` 返回全空
 * 快照，`toggle()` 直接报错。
 *
 * @module dsh-capability-settings/overrides/manager
 */
import type { CapabilityDomain, OverridesSet, OverridesView } from "./types.js";
/** 管理服务的构造依赖。 */
export interface OverridesManagerDeps {
    dshHome?: string;
}
/** toggle 的入参。 */
export interface OverrideToggleInput {
    /** 项目作用域必填：工作区目录。 */
    cwd?: string;
    domain: CapabilityDomain;
    /** 要切换禁用状态的全局条目名 / 键。 */
    key: string;
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
    sets: (cwd?: string) => Promise<OverridesSet>;
    get: (cwd?: string) => Promise<OverridesView>;
    toggle: (input: OverrideToggleInput) => Promise<OverrideOpResult>;
};
/** 管理服务的完整类型（构造函数的返回值）。 */
export type OverridesManager = ReturnType<typeof createOverridesManager>;
