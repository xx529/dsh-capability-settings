/**
 * 自动归属（resolver）的共享类型与缓存文件契约。
 *
 * 设计：`docs/architecture/plugin-attribution-auto.md` §4.3 / §7 / §8
 * （字段名是契约，不得改名）。
 *
 * @module dsh-capability-settings/tools/attribution/types
 */
/**
 * 当前缓存版本。
 *
 * v3：丢弃 <3 的 `runtime` / `interceptors`。v2 的运行时归属可能被
 * `tools/change` 监听顺序污染（本机 `dsh-trace-inspect/desc-inject` 在监听里
 * 读 tools 服务，导致 `rw_*` 被记到 trace-inspect 名下）；`packages` 扫描结果
 * 继续复用，省一次全量扫描。
 */
export const TOOL_ATTRIBUTION_CACHE_VERSION = 3;
/** 缓存文件名。 */
export const TOOL_ATTRIBUTION_CACHE_FILE = "tool-attribution.json";
