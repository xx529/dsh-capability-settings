/**
 * Jev 配置路径解析。
 *
 * 配置固定落在 **dsh home** 下的插件目录：
 *
 *   `<dshHome>/capability-panel/jev.json`
 *
 * `dshHome` 的解析（显式 override → `DSH_HOME` → `~/.dsh`）交给宿主的
 * `@deepseek-ai/dsh-home-paths`，本模块不重复实现 env 解析（架构 §3.1）。
 *
 * @module dsh-capability-settings/jev/paths
 */
import { join } from "node:path";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
/** 插件在 dsh home 下的目录名（将来同域其它文件也放这里）。 */
export const JEV_DIR_NAME = "capability-panel";
/** 配置文件名。 */
export const JEV_FILE_NAME = "jev.json";
/** 配置目录：`<dshHome>/capability-panel`。 */
export function jevConfigDir(dshHome) {
    return join(resolveDshHome(dshHome), JEV_DIR_NAME);
}
/** 配置文件：`<dshHome>/capability-panel/jev.json`。 */
export function jevConfigFile(dshHome) {
    return join(jevConfigDir(dshHome), JEV_FILE_NAME);
}
