/**
 * 读写项目级"默认关闭"声明。
 *
 * **当前写入目标**：`<dshHome>/dsh-capability-settings/capability-overrides.json`
 * （统一存储：一个文件、按项目根分 key，见 {@link readOverridesStore} /
 * {@link writeOverridesStore}）。
 *
 * **旧格式**：`<项目根>/.agents/capability-overrides.json`（读取兼容 `.dsh` /
 * `.claude`，见 `paths.ts`）仍然可读（{@link readOverrides}），并在首次写入统一
 * 存储时并入内容、删除旧文件；{@link writeOverrides} 仅为公开 API / 测试保留。
 *
 * v20.1 B2：项目条目新增 `enabledSkills`（本项目显式重新打开的技能，覆盖全局
 * 默认关闭）；同一名字同时出现在 `skills` / `enabledSkills` 时**禁用优先**
 * （{@link normalizeOverridesSet} 读取与写盘两侧都强制）。全局层的
 * `capability-global-overrides.json` 在 `global-file.ts`，与本文件读写逻辑独立。
 *
 * 写入原子（临时文件 + rename）、父目录按需创建；读取对"文件缺失 / 文件为空"
 * 宽容（视为空声明），对"JSON 非法 / 形状不符合预期 / 版本不认识"抛出带文件名的
 * 错误，让面板明确展示问题。读入时每个域的清单 trim、去重、按语言排序；写出时
 * 空数组不落盘。
 *
 * @module dsh-capability-settings/overrides/config-file
 */
import type { CapabilityDomain, OverridesSet, OverridesStore } from "./types.js";
/** 能力域在声明文件里的键名（与 CapabilityDomain 一一对应）。 */
export declare const DOMAIN_KEYS: readonly CapabilityDomain[];
/**
 * 构造一份空的规范化声明（每个域都是空数组；`enabledSkills` 也是空）。
 */
export declare function emptyOverrides(): OverridesSet;
/**
 * 规范化一份声明并强制「同一名字不同时出现在 skills / enabledSkills」。
 *
 * 契约 §1.2 的「禁用优先」在这里落地：`enabledSkills` 里与 `skills` 同名的
 * 条目被剔除（写读两侧都走本函数，保证磁盘上不会长期保留矛盾数据）。
 *
 * @param input 任意来源（磁盘 / 调用方）的清单
 * @returns 规范化后的声明（每域 trim、去重、排序）
 */
export declare function normalizeOverridesSet(input: Partial<OverridesSet> | undefined): OverridesSet;
/**
 * 取两域视图（`{mcp, skills}`）：兼容旧调用方 / 旧回归测试的既有返回形状。
 *
 * @param set 完整声明（含 B2 的 enabledSkills）
 * @returns 只含 mcp / skills 的浅拷贝
 */
export declare function domainSetOf(set: OverridesSet): {
    mcp: string[];
    skills: string[];
};
/**
 * 规范化一个域的清单：trim、去重、按语言排序。
 */
export declare function normalizeList(values: unknown): string[];
/**
 * 读取一个禁用声明文件并规范化为 OverridesSet。
 *
 * - 文件缺失 / 空 → 全空声明（不报错）；
 * - JSON 非法 / 顶层不是对象 → 抛出带文件名的 Error；
 * - 某个域的键存在但不是字符串数组 → 抛出带文件名的 Error
 *   （手改文件写坏时显式暴露，而不是静默丢弃）；
 * - `enabledSkills`（B2）可选；旧文件没有该键时按空处理；与 `skills` 同时
 *   出现时禁用优先（{@link normalizeOverridesSet}）。
 */
export declare function readOverrides(filePath: string): Promise<OverridesSet>;
/**
 * 原子写入一份旧格式禁用声明（自动创建父目录）。
 * 用带时间戳与随机后缀的临时文件 + rename 覆盖；空数组不落盘。
 *
 * 仅保留给公开 API / 测试 / 迁移工具使用；面板写入走 {@link writeOverridesStore}。
 */
export declare function writeOverrides(filePath: string, overrides: OverridesSet): Promise<void>;
/** 统一存储的当前版本；版本不认识时整份拒绝（不猜测迁移，避免覆盖用户数据）。 */
export declare const OVERRIDES_STORE_VERSION = 1;
/** 构造一份空的统一存储。 */
export declare function emptyOverridesStore(): OverridesStore;
/**
 * 读取统一存储。
 *
 * - 文件缺失 / 空 → 空存储；
 * - JSON 非法 / `version` 不认识 / `projects` 或条目形状非法 → 抛错
 *   （读路径由调用方降级为空声明，写路径显式报错暴露问题）。
 */
export declare function readOverridesStore(filePath: string): Promise<OverridesStore>;
/**
 * 原子写入统一存储（自动创建父目录）。
 *
 * 只写非空条目（三个名单都为空的项目直接省略），保持文件最小化。
 */
export declare function writeOverridesStore(filePath: string, store: OverridesStore): Promise<void>;
