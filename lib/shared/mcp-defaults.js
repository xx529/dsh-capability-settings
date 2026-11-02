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
/** 全空快照（无项目 / 无配置时的默认值；每次返回新对象避免共享可变数组）。 */
export function emptyMcpDefaultSets() {
    return { globalDisabled: [], projectDisabled: [], projectEnabled: [], effectiveDisabled: [] };
}
/**
 * 规范化一份名字清单：trim、去空、去重、按语言排序。
 *
 * 与 `overrides/config-file.ts` 的 `normalizeList` 同一口径；这里不引入那份
 * 依赖，保持本模块零内部依赖（overrides → shared 的单向依赖）。
 */
function normalizeNames(values) {
    const seen = new Set();
    const out = [];
    for (const value of values) {
        if (typeof value !== "string")
            continue;
        const name = value.trim();
        if (name.length === 0 || seen.has(name))
            continue;
        seen.add(name);
        out.push(name);
    }
    return out.sort((a, b) => a.localeCompare(b));
}
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
export function mcpDefaultSets(input) {
    const globalDisabled = normalizeNames(input.globalDisabled ?? []);
    const projectDisabled = normalizeNames(input.projectDisabled ?? []);
    const projectDisabledSet = new Set(projectDisabled);
    const projectEnabled = normalizeNames(input.projectEnabled ?? []).filter((name) => !projectDisabledSet.has(name));
    const effective = new Set(globalDisabled);
    for (const name of projectDisabled)
        effective.add(name);
    for (const name of projectEnabled)
        effective.delete(name);
    return {
        globalDisabled,
        projectDisabled,
        projectEnabled,
        effectiveDisabled: [...effective].sort((a, b) => a.localeCompare(b)),
    };
}
/**
 * 某个名字在有效默认下是否启用（面板 / loader 的共同判据）。
 *
 * @param sets 三层快照
 * @param name serverName（或配置条目键经 {@link sanitizeServerName} 后的名字）
 */
export function mcpDefaultEnabled(sets, name) {
    return !sets.effectiveDisabled.includes(name);
}
