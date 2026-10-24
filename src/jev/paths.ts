/**
 * Jev 配置路径解析。
 *
 * 配置固定落在 **dsh home** 下的插件目录（目录名 = 包名）：
 *
 *   `<dshHome>/dsh-capability-settings/jev.json`
 *
 * 旧版本（fork 沿用上游包名时）写在 `<dshHome>/capability-panel/jev.json`；
 * 该路径只作为一次性迁移来源（见 `config-file.ts` 的 `migrateLegacyJevConfig`）。
 *
 * `dshHome` 的解析（显式 override → `DSH_HOME` → `~/.dsh`）交给宿主的
 * `@deepseek-ai/dsh-home-paths`，本模块不重复实现 env 解析（架构 §3.1）。
 *
 * @module dsh-capability-settings/jev/paths
 */

import { join } from "node:path";

import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";

/** 插件在 dsh home 下的目录名（与包名一致；将来同域其它文件也放这里）。 */
export const JEV_DIR_NAME = "dsh-capability-settings";

/** 历史目录名：fork 沿用上游包名时使用的插件目录，仅用于一次性迁移。 */
export const LEGACY_JEV_DIR_NAME = "capability-panel";

/** 配置文件名。 */
export const JEV_FILE_NAME = "jev.json";

/** 配置目录：`<dshHome>/dsh-capability-settings`。 */
export function jevConfigDir(dshHome?: string): string {
  return join(resolveDshHome(dshHome), JEV_DIR_NAME);
}

/** 配置文件：`<dshHome>/dsh-capability-settings/jev.json`。 */
export function jevConfigFile(dshHome?: string): string {
  return join(jevConfigDir(dshHome), JEV_FILE_NAME);
}

/** 历史配置文件路径：`<dshHome>/capability-panel/jev.json`（只读迁移来源）。 */
export function legacyJevConfigFile(dshHome?: string): string {
  return join(resolveDshHome(dshHome), LEGACY_JEV_DIR_NAME, JEV_FILE_NAME);
}
