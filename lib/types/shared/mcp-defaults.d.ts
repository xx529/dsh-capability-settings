/**
 * MCP 三层默认值的**纯计算**（全局默认 → 工作区显式 → 会话显式）。
 *
 * 存储位置（见 `overrides/*`）：
 *
 *   - 全局默认关闭名单：`<dshHome>/dsh-capability-settings/capability-global-overrides.json`
 *     的 `mcp: string[]`（v20.2 新增层，serverName 名单）；
 *   - 工作区覆盖：同一 dsh home 下 `capability-overrides.json` 里
 *     `projects.<项目根>.mcp`（本工作区关闭）与 `.enabledMcp`
 *     （本工作区显式重新打开，可覆盖全局默认）。
 *
 * 有效默认（契约 §1.3）：
 *
 * ```
 * effectiveDefaultEnabled = projectEnabled
 *                            ? true
 *                            : (projectDisabled || globalDisabled) ? false : true
 * effectiveDisabled = (globalDisabled ∪ projectDisabled) \ projectEnabled
 * ```
 *
 * 两条不变量：
 *
 *   1. 同一名字**不同时**出现在项目 `mcp` 与 `enabledMcp`（读取时规范化，
 *      写路径保证）。契约 §1.2 的「禁用优先」由这条规范化落地；本函数再做一次
 *      防御性过滤（调用方可能绕过存储层直接传原始名单）。
 *   2. 本模块不读文件、不碰宿主服务，只看集合，供面板列表（`mcp.runtime`）
 *      与 MCP loader 共用，避免两处各算一套口径。
 *
 * 会话显式开关（loader 的 `sessionToggles` / `session-capabilities.json`）
 * 仍最后覆盖本结果：`session explicit > 本模块`。
 *
 * 全局层对**所有工作区**生效；项目层只对各自工作区。全局默认**不作用于**
 * 项目原生条目（`.mcp.json`）与项目级引用（imports）——那两类仍只受
 * `projects.<根>.mcp` / 引用自身 `disabled` 控制。
 *
 * @module dsh-capability-settings/shared/mcp-defaults
 */
/** 三层默认值的集合快照（数组形状，便于跨 RPC / 写盘；调用方不得原地修改）。 */
export interface McpDefaultSets {
    /** 全局默认关闭（`capability-global-overrides.json` 的 `mcp`）。 */
    globalDisabled: string[];
    /** 工作区默认关闭（`projects.<根>.mcp`）。 */
    projectDisabled: string[];
    /** 工作区显式重新打开（`projects.<根>.enabledMcp`）。 */
    projectEnabled: string[];
    /** 有效默认关闭 = `(globalDisabled ∪ projectDisabled) \ projectEnabled`。 */
    effectiveDisabled: string[];
}
/** 全空快照（无项目 / 无配置时的默认值；每次返回新对象避免共享可变数组）。 */
export declare function emptyMcpDefaultSets(): McpDefaultSets;
/**
 * 由三类原始名单计算三层默认集合。
 *
 * 空数组 / undefined 都当作空名单；**禁用优先**：`projectEnabled` 里与
 * `projectDisabled` 同名的条目被剔除（存储层已有同一不变量，这里再防一次）。
 *
 * @param input.globalDisabled 全局默认关闭名单
 * @param input.projectDisabled 本工作区关闭名单
 * @param input.projectEnabled 本工作区显式重新打开名单
 * @returns 三层快照（含 `effectiveDisabled`）
 */
export declare function mcpDefaultSets(input: {
    globalDisabled?: readonly string[];
    projectDisabled?: readonly string[];
    projectEnabled?: readonly string[];
}): McpDefaultSets;
/**
 * 某个名字在有效默认下是否启用（面板 / loader 的共同判据）。
 *
 * @param sets 三层快照
 * @param name serverName（或配置条目键经 {@link sanitizeServerName} 后的名字）
 */
export declare function mcpDefaultEnabled(sets: McpDefaultSets, name: string): boolean;
