/**
 * 宿主随包工具目录（`@deepseek-ai/dsh/docs/tool-catalog.md`）解析。
 *
 * 背景：宿主工具注册表没有来源字段，而桌面 / Web 组合把**几乎所有模型可见的
 * 内建工具**改由 Agent 预设按会话挂载（`dsh-web-app` 的 patch 把根层同名工具行
 * 逐条 `disabled: true`，再由 `presets/standard.patch.yml` 挂进 agent scope）。
 * 这些工具既不在全局 `tools.schemas()` 里，也不在插件包源码的字面量里可唯一
 * 归属，靠人工表维护会随宿主升级漂移（`present` / `working_directory` /
 * `apply_patch` / `exit_plan_mode` / `session_*` / `team_task_*` …）。
 *
 * 宿主自己随包提供了一份**生成式**工具目录（`pnpm run gen-tool-catalog` 产出），
 * 其中 `Tool Package Map` 表把每个模型可见工具名映射到提供它的 npm 包。本模块
 * 只读解析这张表，作为宿主工具的**权威归属来源**；读不到 / 有歧义时调用方回落
 * 人工表。解析失败一律 fail-open（返回空表），绝不影响 Tools 域可用性。
 *
 * 约束：
 *   - 只读文本、不执行任何宿主代码；
 *   - 同名字段可能对应多个包（如 `bash` 同时有 `dsh-tool-bash` 与
 *     `dsh-tool-bash-persistent`）→ 记入 `ambiguous`，不猜；
 *   - 不缓存到磁盘（随宿主版本变化，进程内一次性解析即可）。
 *
 * @module dsh-capability-settings/tools/attribution/host-catalog
 */
/** 解析结果。 */
export interface HostToolCatalog {
    /** 唯一归属的工具名 → 包名。 */
    tools: ReadonlyMap<string, string>;
    /** 同一工具名被多个宿主包声明：不猜，调用方回落人工表。 */
    ambiguous: ReadonlySet<string>;
    /** 命中的目录文件（诊断用；不落盘）。 */
    source?: string;
}
/** 空目录（读不到 / 解析失败）。 */
export declare function emptyHostToolCatalog(): HostToolCatalog;
/**
 * 解析 `tool-catalog.md` 的 `Tool Package Map` 表。
 *
 * 行形状：`| \`@deepseek-ai/dsh-tool-fs\` | \`apply_patch\`, \`edit\`, … | Requires |
 * Writes | \`alias\` | note |`。只取第 2 列（模型可见名）与第 5 列（Shipped
 * aliases），其余列是说明/依赖，不能当工具名。
 *
 * @param text 目录文件全文
 * @param source 诊断用来源路径
 */
export declare function parseToolCatalogMarkdown(text: string, source?: string): HostToolCatalog;
/**
 * 候选 `@deepseek-ai/dsh` 包根（去重）。
 *
 * 顺序：`pluginPackages.packageOf`（宿主包解析器）→ loader 条目 baseUrl 反推
 * `node_modules` → Electron `process.resourcesPath` 固定布局。任一命中即可，
 * 全部失败时返回空数组（调用方 fail-open）。
 */
export declare function hostToolCatalogCandidates(ctx: any): string[];
/**
 * 读取并解析宿主随包工具目录（同步、fail-open）。
 *
 * 同步是刻意的：归属解析 `resolveTool` / `tools.list` 都是同步路径，目录文件通常
 * 只有 ~100KB，一次读入 + 解析在毫秒级；失败返回空表，后续仍可重试。
 *
 * @param ctx 宿主插件上下文（`get("pluginPackages")` / `loader`）
 * @param logger 可选：记录命中的目录路径（debug 级；缺省静默）
 */
export declare function loadHostToolCatalog(ctx: any, logger?: {
    info?: (message: string) => void;
    warn?: (message: string) => void;
}): HostToolCatalog;
