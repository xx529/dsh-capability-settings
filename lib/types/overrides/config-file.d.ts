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
/** 构造一份空的规范化声明（每个域都是空数组）。 */
export declare function emptyOverrides(): OverridesSet;
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
 *   （手改文件写坏时显式暴露，而不是静默丢弃）。
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
 * 只写非空条目（两个域都为空的项目直接省略），保持文件最小化。
 */
export declare function writeOverridesStore(filePath: string, store: OverridesStore): Promise<void>;
