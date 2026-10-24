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
/** 插件在 dsh home 下的目录名（将来同域其它文件也放这里）。 */
export declare const JEV_DIR_NAME = "capability-panel";
/** 配置文件名。 */
export declare const JEV_FILE_NAME = "jev.json";
/** 配置目录：`<dshHome>/capability-panel`。 */
export declare function jevConfigDir(dshHome?: string): string;
/** 配置文件：`<dshHome>/capability-panel/jev.json`。 */
export declare function jevConfigFile(dshHome?: string): string;
