/**
 * 项目级"默认关闭"声明文件的位置解析。
 *
 * **统一存储（当前写入目标）**：
 *   `<dshHome>/dsh-capability-settings/capability-overrides.json`
 *
 * 一个文件按**项目根**（`findProjectRoot(cwd)`）分 key，记录每个项目默认关闭的
 * MCP server / 注入技能清单——不再散落在各个项目仓库里，也不随仓库被提交。
 *
 * **旧位置（只读兼容 + 迁移来源）**：`<项目根>/.agents/capability-overrides.json`，
 * 以及更早的 `<项目根>/.dsh` / `<项目根>/.claude`。旧文件在首次写入统一存储时
 * 并入内容并删除（见 `manager.ts` 的 `toggle`）。
 *
 * @module dsh-capability-settings/overrides/paths
 */
import { join } from "node:path";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { PROJECT_CONFIG_DIRS } from "../shared/config-location.js";
import { findProjectRoot } from "../shared/project-root.js";
/** 声明文件的固定文件名（新旧位置同名）。 */
export const OVERRIDES_FILE_NAME = "capability-overrides.json";
/** 插件在 dsh home 下的数据目录名（与包名一致，和 `jev.json` / 会话开关同目录）。 */
export const OVERRIDES_DATA_DIR_NAME = "dsh-capability-settings";
/** 统一存储文件名。 */
export const OVERRIDES_STORE_FILE_NAME = OVERRIDES_FILE_NAME;
/** 统一存储文件：`<dshHome>/dsh-capability-settings/capability-overrides.json`。 */
export function overridesStoreFile(dshHome) {
    return join(resolveDshHome(dshHome), OVERRIDES_DATA_DIR_NAME, OVERRIDES_STORE_FILE_NAME);
}
/**
 * 项目作用域的**旧位置**候选目录列表（绝对路径；第一个为旧写入目标 `.agents`）。
 *
 * 只用于兼容读取与迁移；新写入一律走 {@link overridesStoreFile}。
 *
 * @param cwd 工作区目录，向上探测项目根
 * @param projectRootOverride 预先算好的项目根（可选，避免重复探测）
 * @returns `<项目根>/<候选目录>` 的绝对路径列表
 */
export function projectOverridesDirs(cwd, projectRootOverride) {
    const root = projectRootOverride ?? findProjectRoot(cwd);
    return PROJECT_CONFIG_DIRS.map((dir) => join(root, dir));
}
/**
 * 项目作用域的**旧位置**声明文件路径（兼容读取 / 迁移用）。
 *
 * @param cwd 工作区目录，向上探测项目根
 * @param projectRootOverride 预先算好的项目根（可选）
 * @returns `<项目根>/.agents/capability-overrides.json` 的绝对路径
 */
export function projectOverridesFile(cwd, projectRootOverride) {
    const root = projectRootOverride ?? findProjectRoot(cwd);
    return join(root, ".agents", OVERRIDES_FILE_NAME);
}
