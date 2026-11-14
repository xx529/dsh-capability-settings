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
/**
 * 插件工具归属表（第一批必须覆盖；新增插件只需追加此表）。
 *
 * 顺序不影响结果：精确匹配优先于前缀匹配，同层取**最长前缀**。
 * 证据：`docs/research/capability-v13-evidence.md` §2.2 本机实读名单。
 */
export const TOOL_RULES = [
    // 基础工具名就是 `univer`（不带 `_`），不会被 `univer_` 前缀命中 ⇒ 精确规则兜底。
    { match: "exact", pattern: "univer", display: "dsh-univer-office", packageName: "dsh-univer-office" },
    { match: "prefix", pattern: "univer_", display: "dsh-univer-office", packageName: "dsh-univer-office" },
    // dsh-to-figma 0.2.3 起直接注册 `figma_*` 工具（不再走 `mcp__figma__*` 命名空间）；
    // 基础名 `figma` 也保留精确规则（与 univer 同理，前缀 `_` 边界命不中）。
    { match: "exact", pattern: "figma", display: "dsh-to-figma", packageName: "dsh-to-figma" },
    { match: "prefix", pattern: "figma_", display: "dsh-to-figma", packageName: "dsh-to-figma" },
    { match: "prefix", pattern: "rw_", display: "dsh-remote", packageName: "dsh-remote" },
    { match: "prefix", pattern: "dsh_im_", display: "dsh-im", packageName: "@xmanrui/dsh-im" },
    { match: "exact", pattern: "sidebar_open", display: "dsh-better-sidebar", packageName: "dsh-better-sidebar" },
    { match: "exact", pattern: "open_in_popout", display: "dsh-popout-window", packageName: "@local/dsh-popout-window" },
    {
        match: "exact",
        pattern: "dsh-diff-approval-annotate",
        display: "dsh-diff-approval",
        packageName: "dsh-diff-approval",
    },
    // 真机实际工具名是下划线形式（`diff_approval_annotate`），并非插件包名前缀。
    { match: "exact", pattern: "diff_approval_annotate", display: "dsh-diff-approval", packageName: "dsh-diff-approval" },
    // 防御性前缀：未来该插件新增工具时自动归组（分隔符边界，不会吃掉 annotate 的精确规则）。
    { match: "prefix", pattern: "dsh-diff-approval-", display: "dsh-diff-approval", packageName: "dsh-diff-approval" },
];
/**
 * MCP 命名空间映射表（R4）。
 *
 * 只覆盖「插件直接注册 `mcp__*` 工具、没有 mcp-client 实例」的已知案例；
 * 未命中的命名空间由调用方标「来源未识别」（不猜）。
 */
export const MCP_NAMESPACE_RULES = [
    // 插件内部 name = 'dsh-figma'，展示名沿用 Skills 侧同款 dsh-to-figma（registry.ts）。
    { namespace: "figma", display: "dsh-to-figma", packageName: "dsh-to-figma" },
];
/**
 * fiber / loader 的 source（插件 runtime 名或 loader 条目 id）→ 展示名。
 *
 * 命中映射表 → 映射后的展示名；未命中 → **原样返回**（source 本身就是可读标识，
 * 可能形如 `dsh-figma` 或条目 id `mcp-figma`；详情「来源判定」会写明它是哪种）。
 */
const SOURCE_DISPLAY = new Map([
    ["dsh-figma", "dsh-to-figma"],
    ["dsh-to-figma", "dsh-to-figma"],
    ["dsh-univer-office", "dsh-univer-office"],
    ["dsh-remote", "dsh-remote"],
    ["dsh-better-sidebar", "dsh-better-sidebar"],
    ["dsh-diff-approval", "dsh-diff-approval"],
]);
/** 前缀规则的分隔符边界：`_` 或 `-`（含分隔符才可能命中）。 */
function hasSeparatorBoundary(pattern) {
    return pattern.endsWith("_") || pattern.endsWith("-");
}
/**
 * 工具名归属：精确匹配优先，其次同层最长前缀。
 *
 * 未命中返回 undefined（调用方归入「来源未识别」）。
 *
 * @param name 完整工具名（`schemas()` 里的 `name`）
 */
export function attributeTool(name) {
    if (typeof name !== "string" || name.length === 0)
        return undefined;
    // 1) 精确匹配（与名字全等）。
    for (const rule of TOOL_RULES) {
        if (rule.match === "exact" && rule.pattern === name)
            return rule;
    }
    // 2) 前缀匹配，取最长；前缀必须以分隔符结尾（或与名字全等）。
    let best;
    for (const rule of TOOL_RULES) {
        if (rule.match !== "prefix")
            continue;
        if (rule.pattern.length === 0)
            continue;
        const hit = name === rule.pattern || (hasSeparatorBoundary(rule.pattern) && name.startsWith(rule.pattern));
        if (!hit)
            continue;
        if (best === undefined || rule.pattern.length > best.pattern.length)
            best = rule;
    }
    return best;
}
/**
 * MCP 命名空间归属：`mcp__<namespace>__*` 的 namespace 是否对应已知插件。
 *
 * @param namespace `parseMcpToolName` 解析出的 serverName
 */
export function attributeMcpNamespace(namespace) {
    if (typeof namespace !== "string" || namespace.length === 0)
        return undefined;
    return MCP_NAMESPACE_RULES.find((rule) => rule.namespace === namespace);
}
/**
 * 注入来源 → 展示名；未命中原样返回（不猜）。
 *
 * @param source cordis `Fiber.name` / loader 条目 id
 */
export function displayNameOfSource(source) {
    if (typeof source !== "string" || source.length === 0)
        return source;
    return SOURCE_DISPLAY.get(source) ?? source;
}
/**
 * 宿主内建工具排除清单（精确段）。
 *
 * 来源：证据 §2.2 实读名单 + 本会话真实工具清单。**版本敏感**：宿主升级后新增的
 * 内建工具若未进清单，会落进「来源未识别」单元（方案 §11-R2 缓解项），因此
 * 每次升级宿主都要复核本表。
 *
 * 不进 UI（不列「宿主工具」分组），只用于「不把内建工具当插件工具」。
 */
const HOST_BUILTIN_EXACT = new Set([
    // 基础工具
    "bash",
    "pwsh",
    "read",
    "write",
    "edit",
    "read_image",
    "glob",
    "grep",
    "str_replace_editor",
    "web_search",
    "web_fetch",
    "skill",
    "todo_write",
    "present",
    // 目标 / 循环 / 子代理
    "create_goal",
    "get_goal",
    "update_goal",
    "ralph",
    "subagent",
    "subagent_fork",
    "workflow",
    "list_subagent_models",
    "load_workspace_dependencies",
    "working_directory",
    "ask_user_question",
    // 工作区 / MCP 资源（宿主基础 bundle 的内建工具，不进 Tools 域）
    "create_worktree",
    "exit_plan_mode",
    "apply_patch",
    "lsp",
    "plugin_manager",
    "plugin_market",
    "propose_action",
    "subagent_oar",
    "list_mcp_resources",
    "list_mcp_resource_templates",
    "read_mcp_resource",
    // cordis / 工具检查
    "cordis_inspect_list",
    "cordis_inspect_query",
    // Agent Teams（注册在 agent 自身层，不可 restrict；见证据 §3.2 #1）
    "interrupt_agent",
    "send_message",
    "list_agents",
    "wait_agent",
    "spawn_teammate",
    // 宿主保留名（`run_code` 进 deny 会直接抛错，见下）
    "run_code",
]);
/** 宿主内建工具排除清单（前缀段；覆盖成组注册的内建工具）。 */
const HOST_BUILTIN_PREFIXES = [
    "job_",
    "schedule_",
    "session_",
    "terminal_",
    "team_task_",
    "cordis_inspect_",
    "office_",
    "stagehand_",
];
/**
 * 是否宿主内建工具（v26 起仍会以只读「宿主」单元展示，但永不参与开关）。
 *
 * @param name 完整工具名
 */
export function isHostBuiltinTool(name) {
    if (typeof name !== "string" || name.length === 0)
        return false;
    if (HOST_BUILTIN_EXACT.has(name))
        return true;
    return HOST_BUILTIN_PREFIXES.some((prefix) => name.startsWith(prefix));
}
/** 无法精确归属的宿主内建工具统一落到这个只读单元。 */
export const HOST_BUILTIN_GENERIC_UNIT = "@deepseek-ai/dsh-tool-builtins";
/**
 * 宿主内建工具 → 只读宿主单元（v26）。
 *
 * 截图里的核心工具按宿主包分组展示（`edit/read/write` → `dsh-tool-fs`、
 * `glob/grep` → `dsh-tool-fs-search`、`bash` → `dsh-tool-bash-persistent`）；
 * 其余内建工具归入 `dsh-tool-builtins` 一个只读单元。规则只服务展示，*不是*
 * 注册来源的权威判断，也没有任何开关/restrict 语义。
 *
 * 版本敏感：宿主升级新增内建工具时，未命中精确/前缀规则的会落到 generic 单元，
 * 不会消失，也不会被当成第三方插件。
 *
 * **不覆盖宿主插件实例工具**：同一个宿主插件包被 cordis patch 以
 * `config.toolName` 再插一次时（`subagent_codex` / `subagent_claude_code`），
 * 名字不在本表——由 resolver 的运行时身份（fiber 名 → 宿主包）与 loader 声明
 * 兜底（`matchedBy=config`），不要往这里堆名字。
 */
const HOST_BUILTIN_UNIT_RULES = [
    // 文件 / 搜索 / shell（用户截图里的那组）
    { match: "exact", pattern: "bash", unit: "@deepseek-ai/dsh-tool-bash-persistent" },
    { match: "exact", pattern: "pwsh", unit: "@deepseek-ai/dsh-tool-pwsh" },
    { match: "exact", pattern: "read", unit: "@deepseek-ai/dsh-tool-fs" },
    { match: "exact", pattern: "write", unit: "@deepseek-ai/dsh-tool-fs" },
    { match: "exact", pattern: "edit", unit: "@deepseek-ai/dsh-tool-fs" },
    { match: "exact", pattern: "read_image", unit: "@deepseek-ai/dsh-tool-fs" },
    { match: "exact", pattern: "glob", unit: "@deepseek-ai/dsh-tool-fs-search" },
    { match: "exact", pattern: "grep", unit: "@deepseek-ai/dsh-tool-fs-search" },
    // 其余「一包一组」的宿主工具（命中则分组更清楚，未命中走 generic）
    { match: "exact", pattern: "web_search", unit: "@deepseek-ai/dsh-tool-web" },
    { match: "exact", pattern: "web_fetch", unit: "@deepseek-ai/dsh-tool-web" },
    { match: "exact", pattern: "skill", unit: "@deepseek-ai/dsh-tool-skill" },
    { match: "exact", pattern: "todo_write", unit: "@deepseek-ai/dsh-tool-todo" },
    { match: "exact", pattern: "ask_user_question", unit: "@deepseek-ai/dsh-tool-ask-user" },
    // 宿主随包工具目录（`docs/tool-catalog.md`）是权威来源；这里是目录不可用时的兜底。
    { match: "exact", pattern: "present", unit: "@deepseek-ai/dsh-tool-present" },
    { match: "exact", pattern: "working_directory", unit: "@deepseek-ai/dsh-tool-working-directory" },
    { match: "exact", pattern: "load_workspace_dependencies", unit: "@deepseek-ai/dsh-tool-workspace-dependencies" },
    { match: "exact", pattern: "create_worktree", unit: "@deepseek-ai/dsh-experimental-tool-worktree" },
    { match: "exact", pattern: "str_replace_editor", unit: "@deepseek-ai/dsh-tool-str-replace-editor" },
    { match: "exact", pattern: "exit_plan_mode", unit: "@deepseek-ai/dsh-plan-mode" },
    { match: "exact", pattern: "apply_patch", unit: "@deepseek-ai/dsh-tool-fs" },
    { match: "exact", pattern: "lsp", unit: "@deepseek-ai/dsh-tool-lsp" },
    { match: "exact", pattern: "plugin_manager", unit: "@deepseek-ai/dsh-plugin-manager" },
    { match: "exact", pattern: "plugin_market", unit: "@deepseek-ai/dsh-plugin-market" },
    { match: "exact", pattern: "propose_action", unit: "@deepseek-ai/dsh-action-cards" },
    { match: "exact", pattern: "subagent_oar", unit: "@deepseek-ai/dsh-experimental-tool-subagent-oar" },
    { match: "exact", pattern: "run_code", unit: "@deepseek-ai/dsh-tool-executor-ptc" },
    { match: "exact", pattern: "subagent", unit: "@deepseek-ai/dsh-tool-subagent" },
    { match: "exact", pattern: "subagent_fork", unit: "@deepseek-ai/dsh-tool-subagent" },
    { match: "exact", pattern: "list_subagent_models", unit: "@deepseek-ai/dsh-tool-subagent" },
    { match: "exact", pattern: "workflow", unit: "@deepseek-ai/dsh-tool-workflow" },
    { match: "exact", pattern: "ralph", unit: "@deepseek-ai/dsh-tool-ralph" },
    { match: "exact", pattern: "create_goal", unit: "@deepseek-ai/dsh-tool-goal" },
    { match: "exact", pattern: "get_goal", unit: "@deepseek-ai/dsh-tool-goal" },
    { match: "exact", pattern: "update_goal", unit: "@deepseek-ai/dsh-tool-goal" },
    { match: "exact", pattern: "cordis_inspect_list", unit: "@deepseek-ai/dsh-tool-cordis" },
    { match: "exact", pattern: "cordis_inspect_query", unit: "@deepseek-ai/dsh-tool-cordis" },
    { match: "exact", pattern: "list_mcp_resources", unit: "@deepseek-ai/dsh-mcp-resources" },
    { match: "exact", pattern: "list_mcp_resource_templates", unit: "@deepseek-ai/dsh-mcp-resources" },
    { match: "exact", pattern: "read_mcp_resource", unit: "@deepseek-ai/dsh-mcp-resources" },
    // 成组注册的宿主工具
    { match: "prefix", pattern: "job_", unit: "@deepseek-ai/dsh-tool-jobs" },
    { match: "prefix", pattern: "schedule_", unit: "@deepseek-ai/dsh-tool-schedule" },
    { match: "prefix", pattern: "session_", unit: "@deepseek-ai/dsh-tool-session-query" },
    { match: "prefix", pattern: "terminal_", unit: "@deepseek-ai/dsh-tool-terminal" },
    { match: "prefix", pattern: "team_task_", unit: "@deepseek-ai/dsh-tool-agent-team" },
    { match: "prefix", pattern: "office_", unit: "@deepseek-ai/dsh-tool-office" },
    {
        match: "prefix",
        pattern: "stagehand_",
        unit: "@deepseek-ai/dsh-experimental-browser-use-stagehand-native",
    },
];
/**
 * 宿主内建工具 → 只读展示单元 id（精确优先；前缀取最长；未命中 generic）。
 *
 * @param name 完整工具名
 */
export function hostBuiltinUnitOf(name) {
    if (typeof name !== "string" || name.length === 0)
        return HOST_BUILTIN_GENERIC_UNIT;
    for (const rule of HOST_BUILTIN_UNIT_RULES) {
        if (rule.match === "exact" && rule.pattern === name)
            return rule.unit;
    }
    let best;
    for (const rule of HOST_BUILTIN_UNIT_RULES) {
        if (rule.match !== "prefix" || !hasSeparatorBoundary(rule.pattern))
            continue;
        if (!name.startsWith(rule.pattern))
            continue;
        if (best === undefined || rule.pattern.length > best.pattern.length)
            best = rule;
    }
    return best?.unit ?? HOST_BUILTIN_GENERIC_UNIT;
}
/**
 * 契约禁止出现在 `restrict({deny})` 里的保留工具名。
 *
 * 宿主 `dsh-tools` 的 restrict 对 `run_code` 直接抛错（证据 §3.1 第 3 条，
 * `dsh-tools lib/index.js:2999`）。`run_code` 同时在排除清单里，这里是
 * **deny 名单提交前的防御性过滤**（正常不会命中）。
 */
export const RESTRICT_FORBIDDEN_TOOL_NAMES = new Set(["run_code"]);
/**
 * 是否禁止进入 deny 名单的保留名。
 *
 * @param name 完整工具名
 */
export function isRestrictForbiddenToolName(name) {
    return RESTRICT_FORBIDDEN_TOOL_NAMES.has(name);
}
