/**
 * 自动归属（resolver）的共享类型与缓存文件契约。
 *
 * 设计：`docs/architecture/plugin-attribution-auto.md` §4.3 / §7 / §8
 * （字段名是契约，不得改名）。
 *
 * @module dsh-capability-settings/tools/attribution/types
 */
/** 当前缓存版本。 */
export const TOOL_ATTRIBUTION_CACHE_VERSION = 1;
/** 缓存文件名。 */
export const TOOL_ATTRIBUTION_CACHE_FILE = "tool-attribution.json";
