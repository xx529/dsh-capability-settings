/**
 * 默认关闭声明文件的位置解析（项目层 + 全局层）。
 *
 * **项目层统一存储（当前写入目标）**：
 *   `<dshHome>/dsh-capability-settings/capability-overrides.json`
 *
 * 一个文件按**项目根**（`findProjectRoot(cwd)`）分 key，记录每个项目默认关闭的
 * MCP server / 技能清单（以及 B2 的「项目重新打开」名单）——不再散落在各个项目
 * 仓库里，也不随仓库被提交。
 *
 * **全局层（B2，v20.1 新增）**：
 *   `<dshHome>/dsh-capability-settings/capability-global-overrides.json`
 *   `{ version: 1, skills: string[] }` = 全局默认关闭名单；工作区可用
 *   `enabledSkills` 重新打开。见 {@link globalOverridesFile}。
 *
 * **旧位置（只读兼容 + 迁移来源）**：`<项目根>/.agents/capability-overrides.json`，
 * 以及更早的 `<项目根>/.dsh` / `<项目根>/.claude`。旧文件在首次写入统一存储时
 * 并入内容并删除（见 `manager.ts` 的 `toggle`）。
 *
 * @module dsh-capability-settings/overrides/paths
 */
/** 声明文件的固定文件名（新旧位置同名）。 */
export declare const OVERRIDES_FILE_NAME: "capability-overrides.json";
/** 插件在 dsh home 下的数据目录名（与包名一致，和 `jev.json` / 会话开关同目录）。 */
export declare const OVERRIDES_DATA_DIR_NAME: "dsh-capability-settings";
/** 统一存储文件名。 */
export declare const OVERRIDES_STORE_FILE_NAME: "capability-overrides.json";
/** 统一存储文件：`<dshHome>/dsh-capability-settings/capability-overrides.json`。 */
export declare function overridesStoreFile(dshHome?: string): string;
/** 全局覆盖文件名（B2：全局默认关闭名单，与项目统一存储同目录）。 */
export declare const GLOBAL_OVERRIDES_FILE_NAME: "capability-global-overrides.json";
/**
 * 全局覆盖文件：`<dshHome>/dsh-capability-settings/capability-global-overrides.json`。
 *
 * 与项目统一存储同目录、同权限（0600）；一个文件、不按项目分 key
 * （全局默认对所有项目生效，工作区可用 `enabledSkills` 重新打开）。
 *
 * @param dshHome dsh home 覆盖（缺省用 `resolveDshHome()` 解析）
 * @returns 全局覆盖文件绝对路径
 */
export declare function globalOverridesFile(dshHome?: string): string;
/**
 * 项目作用域的**旧位置**候选目录列表（绝对路径；第一个为旧写入目标 `.agents`）。
 *
 * 只用于兼容读取与迁移；新写入一律走 {@link overridesStoreFile}。
 *
 * @param cwd 工作区目录，向上探测项目根
 * @param projectRootOverride 预先算好的项目根（可选，避免重复探测）
 * @returns `<项目根>/<候选目录>` 的绝对路径列表
 */
export declare function projectOverridesDirs(cwd: string, projectRootOverride?: string): string[];
/**
 * 项目作用域的**旧位置**声明文件路径（兼容读取 / 迁移用）。
 *
 * @param cwd 工作区目录，向上探测项目根
 * @param projectRootOverride 预先算好的项目根（可选）
 * @returns `<项目根>/.agents/capability-overrides.json` 的绝对路径
 */
export declare function projectOverridesFile(cwd: string, projectRootOverride?: string): string;
