/**
 * 插件归属的**单一事实源**（Tools 域与 MCP R4 来源共用）。
 *
 * 背景（证据 `docs/research/capability-v13-evidence.md` §2.1/§2.2）：宿主
 * `tools` 服务是单一注册表，`schemas()` 只回 `{name, description, parameters}`，
 * **没有**来源/owner/插件字段，注册入口也不带 provenance。因此"哪个插件注入了
 * 哪个工具"只能在插件侧靠**旁路规则**推断：
 *
 *   - 命名空间约定：`mcp__<serverName>__<tool>` 恒归 MCP 域（不进 Tools）；
 *   - 名字前缀/精确映射：`univer_*` / `rw_*` / `dsh_im_*` / `sidebar_open` 等
 *     本机已实测的插件工具名（证据 §2.2 实读名单）；
 *   - 宿主内建工具排除清单：宿主不标注危险/系统等级（证据 §3.2 #5），只能由
 *     本插件自维护（**版本敏感**，宿主升级后要复核）。
 *
 * 本文件只放**纯函数 + 常量**，不 import 任何宿主服务，便于单测与两端复用。
 * 匹配顺序遵守方案 `docs/architecture/v13-implementation.md` §2.1：
 * `mcp__` → 宿主内建 → 插件映射 → 来源未识别（调用方负责前三步的顺序，本文件
 * 提供每一步的判定函数）。
 *
 * 展示名一旦进入持久化键（`plugin:<unit>`），**改名 = 丢失旧会话状态**
 * （回落到默认开启）；本表在本批冻结，未来改名需在 CHANGELOG 标注并考虑映射迁移。
 *
 * @module dsh-capability-settings/shared/plugin-attribution
 */
/** 一条「非 mcp 工具名 → 插件」的归属规则。 */
export interface ToolRule {
    /** 匹配方式。 */
    match: "exact" | "prefix";
    /** 精确名 或 前缀（前缀必须以 `_` / `-` 结尾，避免误伤同名开头的新插件）。 */
    pattern: string;
    /** 展示名（= Tools 单元 id 与卡片标题；与 Skills 的 channel 同口径）。 */
    display: string;
    /** npm 包名（详情「来源判定」文案 / 诊断用）。 */
    packageName?: string;
}
/**
 * 插件工具归属表（第一批必须覆盖；新增插件只需追加此表）。
 *
 * 顺序不影响结果：精确匹配优先于前缀匹配，同层取**最长前缀**。
 * 证据：`docs/research/capability-v13-evidence.md` §2.2 本机实读名单。
 */
export declare const TOOL_RULES: readonly ToolRule[];
/** 一条「MCP 命名空间 → 插件展示名」的映射（R4 第三条发现路径用）。 */
export interface McpNamespaceRule {
    /** 工具命名空间（`mcp__<namespace>__*` 里的那段）。 */
    namespace: string;
    /** 插件展示名（与 Skills 侧 `dsh-to-figma` 同口径）。 */
    display: string;
    /** npm 包名（诊断用）。 */
    packageName?: string;
}
/**
 * MCP 命名空间映射表（R4）。
 *
 * 只覆盖「插件直接注册 `mcp__*` 工具、没有 mcp-client 实例」的已知案例；
 * 未命中的命名空间由调用方标「来源未识别」（不猜）。
 */
export declare const MCP_NAMESPACE_RULES: readonly McpNamespaceRule[];
/**
 * 工具名归属：精确匹配优先，其次同层最长前缀。
 *
 * 未命中返回 undefined（调用方归入「来源未识别」）。
 *
 * @param name 完整工具名（`schemas()` 里的 `name`）
 */
export declare function attributeTool(name: string): ToolRule | undefined;
/**
 * MCP 命名空间归属：`mcp__<namespace>__*` 的 namespace 是否对应已知插件。
 *
 * @param namespace `parseMcpToolName` 解析出的 serverName
 */
export declare function attributeMcpNamespace(namespace: string): McpNamespaceRule | undefined;
/**
 * 注入来源 → 展示名；未命中原样返回（不猜）。
 *
 * @param source cordis `Fiber.name` / loader 条目 id
 */
export declare function displayNameOfSource(source: string): string;
/**
 * 是否宿主内建工具（不可作为插件工具开关，也不进入任何域）。
 *
 * @param name 完整工具名
 */
export declare function isHostBuiltinTool(name: string): boolean;
/**
 * 契约禁止出现在 `restrict({deny})` 里的保留工具名。
 *
 * 宿主 `dsh-tools` 的 restrict 对 `run_code` 直接抛错（证据 §3.1 第 3 条，
 * `dsh-tools lib/index.js:2999`）。`run_code` 同时在排除清单里，这里是
 * **deny 名单提交前的防御性过滤**（正常不会命中）。
 */
export declare const RESTRICT_FORBIDDEN_TOOL_NAMES: ReadonlySet<string>;
/**
 * 是否禁止进入 deny 名单的保留名。
 *
 * @param name 完整工具名
 */
export declare function isRestrictForbiddenToolName(name: string): boolean;
