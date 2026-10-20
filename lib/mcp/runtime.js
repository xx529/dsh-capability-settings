/**
 * 运行时探测：**不是本插件配置文件**里的 MCP 实例（其它插件 / profile 注入）。
 *
 * 这类实例有两种存在形态，本模块都尝试识别：
 *
 *  1. **loader 条目**：profile 的 `cordis.patch.yml` 里 `insert:` 的
 *     `@deepseek-ai/dsh-mcp-client` 条目（cordis loader 的 entry tree）。可直接读
 *     `entry.options.id / name / config`，来源标为条目 id。
 *  2. **动态 fiber**：别的插件在自己的 `apply()` 里 `ctx.plugin(await loader.import(
 *     '@deepseek-ai/dsh-mcp-client'), config)` 挂的实例（例如 `dsh-to-figma` 挂的
 *     `figma`）。这类**不在 loader 条目里**，只能从 cordis 的插件注册表反推：
 *     `ctx.registry` 是「map-like inspection over active plugin callbacks」
 *     （每个 `Plugin.Runtime` 有 `name` 与 `fibers`），而 `Fiber.name` 的语义是
 *     「inherited from the nearest named ancestor」——因此该 fiber 的 `name`
 *     就是**注入它的插件**，这正是"来源插件"。
 *
 * 两条路都是**只读**的：不修改任何注册表、不挂载/卸载任何东西。任何一步失败都
 * 静默降级（识别不到就少一条信息），绝不影响面板其它功能。
 *
 * @module @chengdb/capability-panel/mcp/runtime
 */
/** 桥接层包名（loader 条目 name / fiber runtime name 都按它匹配）。 */
const BRIDGE_PACKAGE = "dsh-mcp-client";
/** 是否像 `@deepseek-ai/dsh-mcp-client` 这个桥接层。 */
function isBridgeName(value) {
    return typeof value === "string" && value.includes(BRIDGE_PACKAGE);
}
/** 把 `DisposableList` / Set / 数组等统一成可遍历数组（失败给空数组）。 */
function toArray(value) {
    if (value === undefined || value === null)
        return [];
    if (Array.isArray(value))
        return value;
    try {
        if (typeof value[Symbol.iterator] === "function")
            return [...value];
    }
    catch {
        /* 不可遍历：放弃 */
    }
    return [];
}
/** 读取 fiber 上挂载时的配置（不同 cordis 版本字段名略有差异，逐个兜底）。 */
function fiberConfig(fiber) {
    for (const candidate of [fiber?.config, fiber?._config, fiber?.runtime?.config]) {
        if (candidate !== null && typeof candidate === "object" && typeof candidate.serverName === "string") {
            return candidate;
        }
    }
    return undefined;
}
/**
 * 扫 cordis 插件注册表，找出**动态挂载**的 mcp-client fiber。
 *
 * `ctx.registry` 在 cordis 里是 `ctx.registry`（RegistryService，Map-like）；每个
 * `Plugin.Runtime` 带 `name` 和 `fibers`。我们只认 runtime.name 含
 * `dsh-mcp-client` 的记录，再逐个 fiber 读配置里的 `serverName`。
 */
export function scanInjectedMcpFibers(ctx) {
    const found = [];
    let runtimes = [];
    try {
        const registry = ctx?.root?.registry ?? ctx?.registry;
        if (registry === undefined)
            return found;
        runtimes = typeof registry.values === "function" ? toArray(registry.values()) : toArray(registry);
    }
    catch {
        return found;
    }
    for (const runtime of runtimes) {
        const record = runtime;
        if (!isBridgeName(record?.name))
            continue;
        for (const fiber of toArray(record?.fibers)) {
            const config = fiberConfig(fiber);
            const serverName = config?.serverName;
            if (typeof serverName !== "string" || serverName.length === 0)
                continue;
            // Fiber.name = 继承自最近具名祖先的插件显示名 → 注入方；若它就是桥接层本身
            // （例如宿主直接以 root 挂载、没有具名祖先），则视为来源未知。
            const name = typeof fiber?.name === "string" ? fiber.name : undefined;
            found.push({
                serverName,
                origin: "fiber",
                ...(name !== undefined && !isBridgeName(name) ? { source: name } : {}),
                config,
            });
        }
    }
    return found;
}
/**
 * 扫 cordis loader 的条目目录，找出 `insert:` 进 profile 的 mcp-client 条目。
 *
 * 只读：`ctx.loader.entries()` 是 cordis Loader 的公开方法（「Service that owns a
 * loader entry tree and imports configured plugins」）。条目 `options.id` 作为来源
 * 文案（如 `mcp-figma`），`options.config` 即桥接层配置。
 */
export function scanInjectedMcpEntries(ctx) {
    const found = [];
    try {
        const loader = ctx?.loader ?? ctx?.get?.("loader");
        if (typeof loader?.entries !== "function")
            return found;
        for (const entry of toArray(loader.entries())) {
            const options = entry?.options;
            if (options === undefined || options.disabled === true)
                continue;
            if (!isBridgeName(options.name))
                continue;
            const config = options.config;
            const serverName = config?.serverName;
            if (typeof serverName !== "string" || serverName.length === 0)
                continue;
            const id = typeof options.id === "string" ? options.id : undefined;
            found.push({ serverName, origin: "entry", ...(id !== undefined ? { source: id } : {}), config });
        }
    }
    catch {
        /* loader 不可用：只靠 fiber 扫描 */
    }
    return found;
}
/** 两条发现路径的并集（同一 serverName 优先保留 loader 条目那条，带来源 id）。 */
export function scanInjectedMcpInstances(ctx) {
    const merged = new Map();
    for (const instance of scanInjectedMcpFibers(ctx))
        merged.set(instance.serverName, instance);
    for (const instance of scanInjectedMcpEntries(ctx))
        merged.set(instance.serverName, instance);
    return merged;
}
