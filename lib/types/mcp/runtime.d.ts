/**
 * 运行时探测：**不是本插件配置文件**里的 MCP 实例（其它插件 / profile 注入）。
 *
 * 这类实例有三种存在形态，本模块都尝试识别：
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
 *  3. **工具命名空间（R4 新增）**：插件**直接** `ctx.tools.register` 注册
 *     `mcp__<ns>__*`、却没有 mcp-client 实例（本机活例 `dsh-to-figma` 的
 *     `figma`）。两条实例发现路径都看不到它，只能从**全局工具视图**反推：
 *     `mcp__<ns>__*` 出现但没有任何实例 ⇒ 合成一条 `origin:"namespace"` 的
 *     外部行（无 `config`、`synthesized:true`）。
 *
 * 三条路都是**只读**的：不修改任何注册表、不挂载/卸载任何东西。任何一步失败都
 * 静默降级（识别不到就少一条信息），绝不影响面板其它功能。
 *
 * @module dsh-capability-settings/mcp/runtime
 */
/** 从运行时发现的一个注入实例（字段都可能缺失，取决于发现路径）。 */
export interface InjectedMcpInstance {
    /** 桥接层实例的 serverName（工具命名空间 `mcp__<serverName>__*` 的那段）。 */
    serverName: string;
    /** 来源：注入它的插件显示名 / loader 条目 id；识别不到时缺省。 */
    source?: string;
    /**
     * 发现路径：loader 条目 / 动态 fiber / 工具命名空间合成。
     *
     * `"namespace"` = 没有 mcp-client 实例、由全局工具视图合成的行（R4）。
     */
    origin: "entry" | "fiber" | "namespace";
    /** 桥接层配置原样（`{transport, serverName, command, args, env, url, headers…}`）。 */
    config?: Record<string, unknown>;
}
/**
 * 扫 cordis 插件注册表，找出**动态挂载**的 mcp-client fiber。
 *
 * `ctx.registry` 在 cordis 里是 `ctx.registry`（RegistryService，Map-like）；每个
 * `Plugin.Runtime` 带 `name` 和 `fibers`。我们只认 runtime.name 含
 * `dsh-mcp-client` 的记录，再逐个 fiber 读配置里的 `serverName`。
 */
export declare function scanInjectedMcpFibers(ctx: any): InjectedMcpInstance[];
/**
 * 扫 cordis loader 的条目目录，找出 `insert:` 进 profile 的 mcp-client 条目。
 *
 * 只读：`ctx.loader.entries()` 是 cordis Loader 的公开方法（「Service that owns a
 * loader entry tree and imports configured plugins」）。条目 `options.id` 作为来源
 * 文案（如 `mcp-figma`），`options.config` 即桥接层配置。
 */
export declare function scanInjectedMcpEntries(ctx: any): InjectedMcpInstance[];
/**
 * 扫全局工具视图，找出**没有 mcp-client 实例**的 `mcp__<ns>__*` 命名空间（R4）。
 *
 * 这是第三条发现路径：插件可以自己 `ctx.tools.register(createMcpToolDefinition(...))`
 * 注册 `mcp__<ns>__*`（本机 `dsh-to-figma` 的 `figma`），此时没有实例、没有配置，
 * 前两条路径都看不到它，但它的工具确实在全局视图里。
 *
 * 只读：`ctx.root.get("tools").schemas()`（与 `mcp/loader.ts` 的取数口径一致）；
 * 任何异常静默降级为空数组。
 *
 * @param ctx 宿主插件上下文
 * @param exclude 已被 fiber / loader 条目 / 本插件配置占用的 serverName（不重复合成）
 */
export declare function scanInjectedMcpNamespaces(ctx: any, exclude: ReadonlySet<string>): InjectedMcpInstance[];
/**
 * 三条发现路径的并集：fiber → loader 条目 → namespace（仅缺失名字）。
 *
 * 合并顺序保证「已有实例的命名空间不会被 namespace 路径覆盖」（方案 §7.2-5）。
 * 同一 serverName 优先保留 loader 条目那条（带来源 id）。
 */
export declare function scanInjectedMcpInstances(ctx: any): Map<string, InjectedMcpInstance>;
