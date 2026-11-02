import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * Capability Panel 的 MCP 域视图（v20.1 能力中心）。
 *
 * 与 Skills 域**同构的两栏**：列表 + 详情。作用域唯一入口在根组件 header
 * （全局 / 工作区 ▾，工作区下拉列出全部工作区），**左栏 ScopeNav 已删除**，
 * 面板与当前对话所在工作区解耦、默认进入全局。列表标题栏固定写
 * 「全局 MCP」/「HtDot · MCP」+ 计数 + 作用域提示 + 内联「＋ 添加 MCP」。
 *
 * - **全局作用域**：`~/.agents/mcp.json` 条目（行尾开关 = 全局默认，写配置
 *   文件 `disabled`）；「外部注入」（其它插件 / profile 在运行时挂载的
 *   mcp-client）作为第二组，**配置只读、默认开关可写**：全局视图写独立文件
 *   `capability-global-overrides.json` 的 `mcp` 名单（不改注入方配置、不卸载实例）；
 * - **工作区作用域**：该工作区 `.mcp.json` 条目 + 引用的全局配置；行尾开关 =
 *   该工作区的默认（写项目 overrides，仅此工作区生效）；
 * - 按契约 §3.6：**不展示某会话的挂载状态**；连接健康以详情「查看工具与参数」
 *   的真实探测结果为准（零副作用，见 `mcp/probe.ts`）；
 * - 详情用同款两段作用域链（全局 → 工作区），只到工作区。
 *
 * 搜索框在根组件头部，由 `query` prop 传入，只过滤当前列表。行内不提供文字
 * 按钮：启用/编辑/删除/引用/探测/使用记录都在详情卡。
 *
 * @module dsh-capability-settings/client/mcp-panel
 */
import { useEffect, useMemo, useState } from "react";
import { summarizeEntry, transportOf, validateEntry } from "../mcp/entry-util.js";
import { sanitizeDescriptorText, formatMaskedArgs } from "../shared/descriptor-text.js";
import { Modal } from "./modal.js";
import { ScopeChain } from "./scope-chain.js";
import { ToolParameterTable, toolParameters } from "./tool-schema.js";
import { SkpSelect } from "./select.js";
import { hasWorkspaceLabel, useAsyncList } from "./panel-common.js";
import { EMPTY_VISIBILITY_SETS, VisibilityDetailFields, VisibilityRowMeta, isRowInvisible, safeGlobalGet, safeOverridesGet, visibilityEntryOf, visibilityModeOf, visibleWorkspaceCountOf, workspaceOverrideOf, } from "./visibility.js";
/** 复合行 id：同一个 key 可能同时存在于 project 与 global 两个作用域。 */
function rowId(server) {
    return `${server.scope}:${server.key}`;
}
/** 行摘要：单行省略（覆盖 `.skp-row-desc` 的两行 clamp，保证行高 72）。 */
const ROW_SUMMARY_STYLE = {
    display: "block",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    WebkitLineClamp: "unset",
};
/** 详情头右侧的标签组（两个标签并排，无对应样式类）。 */
const HEAD_TAGS_STYLE = { display: "inline-flex", alignItems: "center", gap: 6, flex: "none" };
/** 检视区标题行右侧（计数 / 重新测试并排）。 */
const INSPECT_HEAD_RIGHT_STYLE = {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    justifyContent: "flex-end",
};
/**
 * 一条配置条目行（v20.1：全局 / 工作区两种作用域共用同一行结构）。
 *
 * 点行 = 选中（详情卡跟着换）；行尾开关独立，不改变选中。开关语义由**当前
 * 作用域**决定：
 *   - 全局视图 = **全局默认**（写配置文件 `disabled`，所有工作区生效）；
 *   - 工作区视图 = **该工作区的默认**（写项目 overrides，仅此工作区生效）。
 * 行内不渲染文字按钮——启用/编辑/删除/导入/探测/使用记录全部在详情卡里。
 */
function McpServerRow({ server, scope, projectName, toolCount, visibilityEntry, projects, globalOff, invisible, overrideState, selected, busy, onSelect, onToggleDefault, }) {
    const isGlobal = server.scope === "global";
    // 勾选态：全局视图 = 配置级 enabled；工作区视图 = 该工作区默认是否启用。
    const checked = scope === "global" ? server.enabled : isGlobal ? server.disabledInProject !== true : server.enabled;
    const dotClass = checked ? "skp-dot skp-dot-enabled" : "skp-dot skp-dot-hollow";
    /** 归属标签按「出身」：引用 / 旧版导入副本本质是全局条目，标「引用」「导入」。 */
    const scopeTag = server.reference === true
        ? { label: "引用", className: "skp-tag skp-tag-flat" }
        : server.importedFromGlobal === true
            ? { label: "导入", className: "skp-tag skp-tag-flat" }
            : isGlobal
                ? { label: "全局", className: "skp-tag skp-tag-global" }
                : { label: "本项", className: "skp-tag skp-tag-project" };
    const defaultOff = scope === "workspace" && isGlobal && server.disabledInProject === true;
    const switchLabel = invisible
        ? "不可见 · 不参与默认"
        : scope === "global"
            ? "全局默认"
            : `${projectName ?? "工作区"} 默认 · ${overrideState === "inherit" ? "跟随全局" : "已覆盖"}`;
    /** 只有全局视图的全局条目能编辑可见性（项目原生 / 引用不参与）。 */
    const showVisibility = scope === "global" && isGlobal;
    return (_jsxs("li", { className: selected ? "skp-row-wrap skp-row-wrap-active" : "skp-row-wrap", children: [_jsxs("button", { type: "button", className: selected ? "skp-row skp-row-active" : "skp-row", style: { minHeight: 72 }, onClick: onSelect, children: [_jsxs("span", { className: "skp-row-name", children: [_jsx("span", { className: dotClass, title: checked ? "已启用" : "已关闭" }), _jsx("span", { className: "skp-row-title", title: server.key, children: server.key }), _jsx("span", { className: scopeTag.className, children: scopeTag.label })] }), _jsxs("span", { className: "skp-row-meta", children: [_jsx("span", { className: "skp-tag skp-tag-flat", children: server.transport }), !server.enabled && (_jsx("span", { className: "skp-tag skp-tag-warn", title: "\u914D\u7F6E\u6587\u4EF6\u91CC\u6807\u8BB0\u4E3A disabled\uFF1B\u53EF\u5728\u5168\u5C40\u89C6\u56FE\u5F00\u5173\u6062\u590D", children: "\u914D\u7F6E\u5DF2\u7981\u7528" })), defaultOff && (_jsx("span", { className: "skp-tag skp-tag-warn", title: "\u8BE5\u5DE5\u4F5C\u533A\u9ED8\u8BA4\u5173\u95ED\uFF1B\u53EA\u5F71\u54CD\u672C\u5DE5\u4F5C\u533A\uFF0C\u53EF\u5728\u672C\u5DE5\u4F5C\u533A\u91CD\u65B0\u6253\u5F00", children: "\u5DE5\u4F5C\u533A\u9ED8\u8BA4\u5173\u95ED" })), server.shadowed && (_jsx("span", { className: "skp-tag skp-tag-directory", title: "\u88AB\u672C\u5DE5\u4F5C\u533A\u5185\u7684\u540C\u540D\u6761\u76EE\u906E\u853D\uFF1A\u672C\u5DE5\u4F5C\u533A\u7684\u6761\u76EE\u4F18\u5148\u751F\u6548", children: "\u88AB\u906E\u853D" })), showVisibility && (_jsx(VisibilityRowMeta, { entry: visibilityEntry, workspaces: projects, globalOff: globalOff, mode: server.visibilityMode ?? visibilityModeOf(visibilityEntry), count: server.visibleWorkspaceCount ?? visibleWorkspaceCountOf(visibilityEntry, projects), invisible: invisible })), scope === "workspace" && overrideState !== "inherit" && isGlobal && (_jsx("span", { className: "skp-tag skp-tag-warn", title: overrideState === "on"
                                    ? "本工作区显式打开（覆盖全局的每工作区默认）"
                                    : "本工作区显式关闭（覆盖全局的每工作区默认）", children: "\u5DF2\u8986\u76D6" })), _jsx("span", { children: toolCount !== undefined
                                    ? `${toolCount} 个工具`
                                    : "工具数未知 · 详情可测试连接" })] }), _jsx("span", { className: "skp-row-desc", style: ROW_SUMMARY_STYLE, title: server.summary, children: server.summary })] }), scope === "workspace" && (_jsxs("label", { className: "skp-row-toggle", title: checked
                    ? "关闭：仅此工作区默认不启用（写项目覆盖，其它工作区不受影响）"
                    : "打开：仅此工作区默认启用（写项目覆盖）", children: [_jsx("span", { className: "skp-row-default-label", children: switchLabel }), _jsxs("span", { className: "skp-switch", children: [_jsx("input", { type: "checkbox", role: "switch", "aria-label": `${switchLabel} ${server.key}`, checked: checked, disabled: busy, onChange: onToggleDefault }), _jsx("span", { className: "skp-switch-track" })] })] }))] }));
}
/**
 * 一条「外部注入」实例行：**配置只读、默认开关可写**。
 *
 * - 全局视图：开关 = **全局默认**（写独立文件 `capability-global-overrides.json`
 *   的 `mcp` 名单，所有工作区新建对话生效；不改注入方配置、不卸载共享实例）；
 * - 工作区视图：开关 = **本工作区默认**（写项目 overrides 的 `mcp` / `enabledMcp`
 *   三态，可覆盖全局默认）。
 *
 * 能否写由 `restrictable` 决定（工具在全局注册表可见才能 `tools.restrict` 屏蔽；
 * 按 agent 作用域注入的实例置灰 + tooltip 说明宿主契约上限）。
 */
/** 注入方展示名（R4）：优先 `channel`，没有则 undefined（不猜）。 */
function externalChannelOf(server) {
    return typeof server.channel === "string" && server.channel.length > 0 ? server.channel : undefined;
}
/** true = 命名空间合成行（没有 mcp-client 实例，工具来自 `mcp__<ns>__*` 命名空间）。 */
function isSynthesized(server) {
    return server.synthesized === true || server.origin === "namespace";
}
/** 外部注入实例「不可写」的统一 tooltip（宿主 `tools.restrict` 契约上限）。 */
const EXTERNAL_TOGGLE_BLOCKED_TITLE = "该实例按 agent 作用域注入，无法用 tools.restrict 屏蔽（宿主契约上限）";
/**
 * 工作区视图下外部实例的**有效默认关闭**（决定行尾开关 checked）：
 * 优先宿主投影的 `disabledInProject`（v20.2 = 全局默认 ∪ 工作区默认 − 工作区重新打开）；
 * 旧宿主缺该字段时退化到 `disabledGlobally`（全局视图口径）。
 */
function disabledInWorkspaceOf(server) {
    return server.disabledInProject !== undefined ? server.disabledInProject : server.disabledGlobally === true;
}
/**
 * 外部实例的来源标签（v13 R4 两枚标签规则）：
 *   - 有 channel → `插件` + 插件名（第二枚等宽小标签）；
 *   - 命名空间合成且无映射 → `未识别`（琥珀，只此一枚）；
 *   - 其余 → `外部注入`（只此一枚）。
 */
function ExternalSourceTags({ server }) {
    const channel = externalChannelOf(server);
    if (channel !== undefined) {
        return (_jsxs(_Fragment, { children: [_jsx("span", { className: "skp-tag skp-tag-plugin", title: "\u63D2\u4EF6\u6CE8\u5165\u7684 MCP\uFF08\u6765\u6E90\u7531\u63D2\u4EF6\u8FD0\u884C\u65F6\u6CE8\u518C\uFF09", children: "\u63D2\u4EF6" }), _jsx("span", { className: "skp-tag skp-tag-channel", title: channel, children: channel })] }));
    }
    if (isSynthesized(server)) {
        return (_jsx("span", { className: "skp-tag skp-tag-warn", title: "\u5DE5\u5177\u547D\u540D\u7A7A\u95F4\u5408\u6210\uFF1A\u6765\u6E90\u672A\u8BC6\u522B\uFF08\u4E0D\u662F\u5BBF\u4E3B\u5185\u7F6E\uFF09", children: "\u672A\u8BC6\u522B" }));
    }
    return (_jsx("span", { className: "skp-tag skp-tag-readonly", title: "\u8FD0\u884C\u65F6\u6CE8\u5165 \u00B7 \u672A\u6CE8\u518C\u63D2\u4EF6\u540D", children: "\u5916\u90E8\u6CE8\u5165" }));
}
/** 归属依据的人话标签（task-32：runtime/literal/table/similarity 等新依据）。 */
function externalAttributionLabel(server) {
    switch (server.attribution?.matchedBy) {
        case "runtime":
            return "运行时捕获";
        case "literal":
            return "包扫描";
        case "table":
            return "人工映射";
        case "similarity":
            return "名字推测";
        default:
            return undefined;
    }
}
/** true = 来源含推测成分（MCP 详情同样加「推测」标识，不改变「配置只读」语义）。 */
function externalAttributionIsSpeculative(server) {
    const attribution = server.attribution;
    if (attribution === undefined)
        return false;
    return (attribution.matchedBy === "similarity" || attribution.ambiguous === true || attribution.conflictsWithTable === true);
}
/** 详情「来源判定」文案（方案 §7.6；task-32 新依据优先用人话标签）。 */
function externalAttributionText(server) {
    const channel = externalChannelOf(server);
    const matchedBy = server.attribution?.matchedBy;
    const basisLabel = externalAttributionLabel(server);
    if (basisLabel !== undefined) {
        const pattern = server.attribution?.pattern ?? server.attribution?.packageName;
        const target = channel ?? server.source;
        return `${basisLabel}${pattern !== undefined ? `：${pattern}` : ""}${target !== undefined && target !== pattern ? ` → ${target}` : ""}`;
    }
    if (channel !== undefined) {
        if (matchedBy === "namespace") {
            return `前缀 mcp__${server.attribution?.pattern ?? server.serverName}__ → ${channel}（插件清单映射表）`;
        }
        return `运行时注入来源：${server.attribution?.pattern ?? server.source ?? server.serverName} → ${channel}`;
    }
    return "来源未识别（不是宿主内置）";
}
/** 详情「注入方式」文案（R4：命名空间合成单独说明）。 */
function externalInjectionText(server) {
    if (server.origin === "namespace")
        return "工具命名空间合成（不落盘、无 mcp-client 实例）";
    return server.origin === "entry" ? "loader 条目（profile patch insert）" : "动态 fiber（其它插件在 apply 中挂载）";
}
function McpExternalRow({ server, scope, projectName, globalDefaultDisabled, visibilityEntry, projects, invisible, overrideState, selected, busy, onSelect, onToggleDefault, }) {
    /** 全局默认关闭（原始名单；宿主 `disabledGlobally` 为 true 时也必然是关闭）。 */
    const globalOff = globalDefaultDisabled || server.disabledGlobally === true;
    /** 当前视图的默认关闭态：全局视图看全局默认；工作区视图看本工作区有效默认。 */
    const defaultOff = scope === "global" ? globalOff : disabledInWorkspaceOf(server);
    /** 工具在全局注册表可见才可写（两种作用域同一判据；agent 作用域注入的不可）。 */
    const canToggle = server.restrictable;
    const checked = !defaultOff;
    const dot = checked ? { className: "skp-dot skp-dot-enabled", style: undefined } : { className: "skp-dot", style: { background: "var(--skp-warn)" } };
    const toolText = server.tools.length > 0 ? `${server.tools.length} 个工具` : "工具数未知";
    const meta = server.calls > 0 ? `${toolText} · 调用 ${server.calls} 次` : toolText;
    const summary = isSynthesized(server)
        ? "由工具命名空间合成 · 无 mcp-client 实例（配置只读）"
        : (server.summary ?? "运行时注入，由注入方管理（默认开关可写）");
    const switchLabel = invisible
        ? "不可见 · 不参与默认"
        : scope === "global"
            ? "全局默认"
            : `${projectName ?? "工作区"} 默认 · ${overrideState === "inherit" ? "跟随全局" : "已覆盖"}`;
    /** 行内状态标签：全局默认关闭 / 已覆盖全局默认 / 工作区默认关闭。 */
    const stateTag = scope === "global"
        ? globalOff
            ? { label: "全局默认关闭", title: "该实例在全局默认关闭名单里（所有工作区新建对话默认不启用）" }
            : undefined
        : globalOff
            ? defaultOff
                ? { label: "全局默认关闭", title: "继承全局默认关闭；本工作区未重新打开" }
                : { label: "已覆盖全局默认", title: "全局默认关闭，但本工作区已显式重新打开" }
            : defaultOff
                ? { label: "工作区默认关闭", title: "该工作区默认关闭；只影响本工作区" }
                : undefined;
    const switchTitle = invisible
        ? "该实例对所有工作区都不可见：不参与默认开关；先在「可见范围」里打开可见性"
        : !canToggle
            ? EXTERNAL_TOGGLE_BLOCKED_TITLE
            : scope === "global"
                ? checked
                    ? "关闭：写入全局默认关闭名单（所有工作区新建对话默认不启用；不改注入方配置、不卸载共享实例）"
                    : "打开：从全局默认关闭名单移除（恢复所有工作区默认启用）"
                : checked
                    ? "关闭：仅此工作区默认不启用（写工作区覆盖，其它工作区不受影响）"
                    : globalOff
                        ? "打开：本工作区显式重新打开（覆盖全局默认关闭，写 enabledMcp）"
                        : "打开：仅此工作区默认启用（写工作区覆盖）";
    return (_jsxs("li", { className: selected ? "skp-row-wrap skp-row-wrap-active" : "skp-row-wrap", children: [_jsxs("button", { type: "button", className: selected ? "skp-row skp-row-active" : "skp-row", style: { minHeight: 72 }, onClick: onSelect, children: [_jsxs("span", { className: "skp-row-name", children: [_jsx("span", { className: dot.className, style: dot.style, title: defaultOff ? (globalOff ? "全局默认关闭" : "本工作区默认关闭") : "运行时注入的实例" }), _jsx("span", { className: "skp-row-title", title: server.serverName, children: server.serverName }), _jsx("span", { className: "skp-tag skp-tag-warn", title: "\u4E0D\u662F\u672C\u63D2\u4EF6\u914D\u7F6E\u6587\u4EF6\u91CC\u7684\u6761\u76EE\uFF1A\u7531\u5176\u5B83\u63D2\u4EF6 / profile \u8FD0\u884C\u65F6\u6CE8\u5165\uFF08\u914D\u7F6E\u53EA\u8BFB\u3001\u9ED8\u8BA4\u5F00\u5173\u53EF\u5199\uFF09", children: "\u5916\u90E8\u6CE8\u5165" })] }), _jsxs("span", { className: "skp-row-meta", children: [_jsx(ExternalSourceTags, { server: server }), externalChannelOf(server) === undefined && server.source !== undefined && (_jsx("span", { className: "skp-tag skp-tag-flat", children: server.source })), server.transport !== undefined && _jsx("span", { className: "skp-tag skp-tag-flat", children: server.transport }), stateTag !== undefined && (_jsx("span", { className: "skp-tag skp-tag-warn", title: stateTag.title, children: stateTag.label })), scope === "global" && (_jsx(VisibilityRowMeta, { entry: visibilityEntry, workspaces: projects, globalOff: globalOff, mode: server.visibilityMode ?? visibilityModeOf(visibilityEntry), count: server.visibleWorkspaceCount ?? visibleWorkspaceCountOf(visibilityEntry, projects), invisible: invisible })), scope === "workspace" && overrideState !== "inherit" && (_jsx("span", { className: "skp-tag skp-tag-warn", title: overrideState === "on" ? "本工作区显式打开（覆盖全局的每工作区默认）" : "本工作区显式关闭（覆盖全局的每工作区默认）", children: "\u5DF2\u8986\u76D6" })), _jsx("span", { children: meta })] }), _jsx("span", { className: "skp-row-desc", style: ROW_SUMMARY_STYLE, title: summary, children: summary })] }), scope === "workspace" && (_jsxs("label", { className: "skp-row-toggle", title: canToggle ? switchTitle : EXTERNAL_TOGGLE_BLOCKED_TITLE, children: [_jsx("span", { className: "skp-row-default-label", children: switchLabel }), _jsxs("span", { className: "skp-switch", children: [_jsx("input", { type: "checkbox", role: "switch", "aria-label": `${switchLabel} ${server.serverName}`, checked: checked, disabled: !canToggle || busy, onChange: onToggleDefault }), _jsx("span", { className: "skp-switch-track" })] })] }))] }));
}
/** 路径最后一段（工作区名）；空串/纯分隔符回退为原串。 */
function baseName(path) {
    const trimmed = path.replace(/[\\/]+$/, "");
    const at = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
    return at >= 0 ? trimmed.slice(at + 1) || trimmed : trimmed || path;
}
/**
 * MCP 视图主组件（v20.1）：**两栏**（列表 + 详情），不再有左栏 ScopeNav。
 *
 * - **全局作用域**：全局 `~/.agents/mcp.json` 条目（开关 = 全局默认，写配置文件
 *   `disabled`）+ 「外部注入」（配置只读，行尾开关写全局默认关闭名单）；
 * - **工作区作用域**：该工作区 `.mcp.json` 条目（本项目） + 引用的全局配置；
 *   行尾开关 = **该工作区的默认**（写项目 overrides，仅此工作区生效；外部注入
 *   行可覆盖全局默认）；
 * - **搜索**来自根组件头部输入框（`query` prop），只过滤当前列表；
 * - 列表标题栏固定「类型 + 作用域」+ 计数 + 内联「＋ 添加 MCP」，落点由
 *   当前作用域直接确定；行内没有文字按钮——启停/编辑/删除/导入/探测都在详情卡。
 * - 按契约 §3.6：不展示「某会话的挂载状态」（挂载是会话级事实），连接健康
 *   以详情页「查看工具与参数」的真实探测结果为准。
 */
export function McpView({ api, query, projects, workspace, onSelectWorkspace, onCount, }) {
    const mcpApi = api.mcp;
    const [opError, setOpError] = useState(undefined);
    const [selected, setSelected] = useState(undefined);
    /** 选中的「外部注入」实例（serverName）；与 selected 互斥。 */
    const [selectedExternalName, setSelectedExternalName] = useState(undefined);
    /** 行尾默认开关最近一次操作失败的错误。 */
    const [defaultError, setDefaultError] = useState(undefined);
    // 编辑态：undefined = 空闲；非空 = 正在弹窗里编辑这条 server（McpEditDialog）。
    const [editServer, setEditServer] = useState(undefined);
    // 新增弹窗开关（表单 / JSON 两种模式见 McpAddDialog）。
    const [addOpen, setAddOpen] = useState(false);
    /** 正在写开关的行 id（同一时间只允许一个，防重复提交）。 */
    const [busyKey, setBusyKey] = useState(undefined);
    // 二次确认删除：记录“待确认的行 id”，再点一次才真正删除。
    const [confirmDelete, setConfirmDelete] = useState(undefined);
    // 二次确认导入覆盖：工作区内已有同名时记录“待确认的行 id”，再点一次带 overwrite。
    const [confirmImport, setConfirmImport] = useState(undefined);
    /** 本次运行内探测成功回填的工具数（serverName → 工具数）；不落盘、不新增宿主字段。 */
    const [toolCounts, setToolCounts] = useState({});
    /** v21：工作区视图的项目 overrides（判断「跟随全局默认 / 已覆盖」）。 */
    const [projectOverrides, setProjectOverrides] = useState(undefined);
    /** 写操作计数：overrides 变化后重读项目覆盖态。 */
    const [writeVersion, setWriteVersion] = useState(0);
    const scope = workspace === undefined ? "global" : "workspace";
    const projectName = workspace === undefined ? undefined : (projects.find((project) => project.path === workspace)?.title ?? baseName(workspace));
    /**
     * 拉取 list + runtime + 全局默认关闭名单（挂载时、作用域变化时自动执行，写操作后
     * 显式 reload）。不再拉 `mcp.status`：面板不展示某会话的挂载状态（契约 §3.6）。
     *
     * 额外读一次 `globalGet`：宿主 `disabledGlobally` 已是原始名单成员（v20.2），
     * 这里取同一份名单做防御（旧宿主缺字段 / 工作区视图需要区分「继承」与
     * 「已覆盖」），复用已有 RPC 的 `mcp` 字段，不新增端点；失败不影响主列表。
     */
    const { data, loading, error, reload } = useAsyncList(async () => {
        const [list, runtime, globalOverrides] = await Promise.all([
            mcpApi.list(),
            // 运行时注入的 MCP（其它插件/profile 挂的 mcp-client）：配置只读展示，失败不影响主列表。
            mcpApi.runtime({ cwd: workspace }).catch(() => ({ servers: [], hiddenCount: 0 })),
            // 全局层（v20.2 默认关闭名单 + v21 可见性）：失败不影响主列表。
            safeGlobalGet(api),
        ]);
        return {
            servers: list.servers,
            listErrors: list.errors,
            listHiddenCount: list.hiddenCount ?? 0,
            runtimeServers: runtime.servers,
            runtimeHiddenCount: runtime.hiddenCount ?? 0,
            globalOverrides,
        };
    }, [api, mcpApi, workspace]);
    const servers = data?.servers ?? [];
    const listErrors = data?.listErrors ?? [];
    const runtimeServers = data?.runtimeServers ?? [];
    const globalOverrides = data?.globalOverrides;
    const visibilitySets = globalOverrides?.visibility ?? EMPTY_VISIBILITY_SETS;
    /** v21：工作区视图被可见性隐藏的条目数（配置条目 + 外部实例）。 */
    const hiddenCount = scope === "workspace" ? (data?.listHiddenCount ?? 0) + (data?.runtimeHiddenCount ?? 0) : 0;
    /** 某 serverName 的可见性配置（配置条目与外部注入共用 serverName）。 */
    const visibilityOfName = (serverName) => visibilityEntryOf(visibilitySets, "mcp", serverName);
    /** 兜底默认是否关闭（全局默认关闭名单原始成员；外部实例也看 disabledGlobally）。 */
    const globalOffOf = (serverName, disabledGlobally) => globalOverrides?.mcp.includes(serverName) === true || disabledGlobally === true;
    const invisibleOf = (row, entry) => isRowInvisible(row, entry, projects);
    // v21：工作区视图读项目 overrides（判断「跟随全局默认 / 已覆盖」）。
    useEffect(() => {
        if (scope !== "workspace") {
            setProjectOverrides(undefined);
            return;
        }
        let alive = true;
        void safeOverridesGet(api).then((value) => {
            if (alive)
                setProjectOverrides(value);
        });
        return () => {
            alive = false;
        };
    }, [api, scope, workspace, writeVersion]);
    const globalServers = servers.filter((server) => server.scope === "global");
    const projectServers = servers.filter((server) => server.scope === "project");
    /** 工作区视图里因可见性被隐藏、不应渲染的全局配置条目（旧宿主自动过滤用）。 */
    const workspaceGlobalServers = scope === "workspace" ? globalServers.filter((server) => server.visibleInWorkspace !== false) : globalServers;
    /** 当前作用域总数（Tab 与列表标题共用同一口径；外部注入单独成组计数）。 */
    const scopeTotal = scope === "global" ? globalServers.length : projectServers.length + workspaceGlobalServers.length;
    useEffect(() => {
        if (data === undefined)
            return;
        onCount?.(scope === "global" ? globalServers.length : projectServers.length + workspaceGlobalServers.length);
    }, [data, scope, globalServers.length, projectServers.length, workspaceGlobalServers.length, onCount]);
    /** 作用域切换：清空选中与待确认态（详情跟走）。 */
    useEffect(() => {
        setSelected(undefined);
        setSelectedExternalName(undefined);
        setEditServer(undefined);
        setConfirmDelete(undefined);
        setConfirmImport(undefined);
    }, [scope, workspace]);
    const trimmedQuery = query.trim();
    const q = trimmedQuery.toLowerCase();
    const matchesServer = (server) => q.length === 0 ||
        server.key.toLowerCase().includes(q) ||
        server.serverName.toLowerCase().includes(q) ||
        server.summary.toLowerCase().includes(q);
    const matchesExternal = (server) => q.length === 0 ||
        server.serverName.toLowerCase().includes(q) ||
        (server.channel ?? "").toLowerCase().includes(q) ||
        (server.source ?? "").toLowerCase().includes(q) ||
        (server.summary ?? "").toLowerCase().includes(q);
    const visibleGlobal = workspaceGlobalServers.filter(matchesServer);
    const visibleProject = projectServers.filter(matchesServer);
    // R4：有插件展示名的排前面（按展示名升序），无 channel 的排后面（按 serverName）。
    // v21：工作区视图里隐藏实例不渲染（宿主已过滤，这里防旧宿主）。
    const scenarioRuntimes = scope === "workspace" ? runtimeServers.filter((server) => server.visibleInWorkspace !== false) : runtimeServers;
    const visibleExternal = scenarioRuntimes
        .filter(matchesExternal)
        .sort((a, b) => {
        const aChannel = a.channel ?? "";
        const bChannel = b.channel ?? "";
        if (aChannel.length === 0 && bChannel.length > 0)
            return 1;
        if (bChannel.length === 0 && aChannel.length > 0)
            return -1;
        return aChannel.localeCompare(bChannel) || a.serverName.localeCompare(b.serverName);
    });
    const searching = trimmedQuery.length > 0;
    const selectedServer = servers.find((s) => rowId(s) === selected);
    const selectedExternal = selectedExternalName === undefined ? undefined : runtimeServers.find((s) => s.serverName === selectedExternalName);
    /** 执行一次写操作：失败写 opError；成功清错误并重拉列表。返回是否成功。 */
    const runOp = async (op) => {
        const result = await op;
        if (!result.ok) {
            setOpError(result.errors.join("; "));
            return false;
        }
        setOpError(undefined);
        reload();
        return true;
    };
    /**
     * 行尾默认开关（按作用域分派）：
     *   - 全局视图 → `mcp.setEnabled({scope:"global"})`（写配置文件 `disabled`）；
     *   - 工作区视图 → `overrides.toggle("mcp", key, { enabled })`（B2 三态，仅此工作区；
     *     显式传 enabled，避免宿主按「有效默认」翻转时写错名单）。
     */
    const toggleRow = async (server) => {
        const id = rowId(server);
        if (busyKey !== undefined)
            return;
        // 当前勾选态（与 McpServerRow 的行内口径一致）：全局配置条目看配置级 enabled；
        // 全局视图看配置级 enabled；工作区视图的全局条目看本工作区有效默认。
        const current = scope === "global" ? server.enabled : server.scope === "global" ? server.disabledInProject !== true : server.enabled;
        setBusyKey(id);
        setDefaultError(undefined);
        try {
            const result = scope === "global"
                ? await mcpApi.setEnabled({ scope: "global", key: server.key, enabled: !server.enabled })
                : await api.overrides.toggle("mcp", server.key, { enabled: !current });
            if (!result.ok)
                setDefaultError(result.errors.join("; "));
        }
        catch (failure) {
            setDefaultError(String(failure));
        }
        finally {
            setBusyKey(undefined);
            setWriteVersion((value) => value + 1);
            reload({ silent: true });
        }
    };
    /**
     * 外部注入实例的行尾默认开关（v20.2：两种作用域都可写，限制只看 `restrictable`）：
     *   - 全局视图 → `overrides.globalToggle({domain:"mcp"})`，写全局默认关闭名单；
     *   - 工作区视图 → `overrides.toggle("mcp", serverName, { enabled })`，写工作区覆盖
     *     （B2 三态：全局默认关闭时「打开」写 `enabledMcp`）。
     * 都是「不卸载共享实例、只按会话重新 restrict」的写入路径。
     */
    const toggleExternal = async (server) => {
        const id = `external:${server.serverName}`;
        if (busyKey !== undefined || !server.restrictable)
            return;
        const checked = scope === "global" ? server.disabledGlobally !== true : !disabledInWorkspaceOf(server);
        setBusyKey(id);
        setDefaultError(undefined);
        try {
            const result = scope === "global"
                ? await api.overrides.globalToggle({ domain: "mcp", key: server.serverName, disabled: checked })
                : await api.overrides.toggle("mcp", server.serverName, { enabled: !checked });
            if (!result.ok)
                setDefaultError(result.errors.join("; "));
        }
        catch (failure) {
            setDefaultError(String(failure));
        }
        finally {
            setBusyKey(undefined);
            setWriteVersion((value) => value + 1);
            reload({ silent: true });
        }
    };
    /**
     * 导入这条**全局** server 到当前工作区：登记工作区级引用（内容跟随全局，
     * 启停是引用上的工作区级标记）。工作区内已有同名引用时进入“确认覆盖”态。
     */
    const onImport = async (server) => {
        const id = rowId(server);
        const result = await mcpApi.importToProject({ key: server.key, overwrite: confirmImport === id });
        if (!result.ok) {
            if (result.existed === true) {
                setConfirmImport(id);
                return;
            }
            setOpError(result.errors.join("; "));
            return;
        }
        setOpError(undefined);
        setConfirmImport(undefined);
        reload();
    };
    /** 删除：第一次点击进入确认态；同一行再次点击才真正删除并清空选中。 */
    const onDelete = (server) => {
        const id = rowId(server);
        if (confirmDelete !== id) {
            setConfirmDelete(id);
            return;
        }
        setConfirmDelete(undefined);
        void runOp(mcpApi.remove({ scope: server.scope, key: server.key })).then((ok) => {
            if (ok)
                setSelected(undefined);
        });
    };
    /** 选中一条配置条目：清掉外部实例选中与所有待确认态。 */
    const selectServer = (server) => {
        setSelected(rowId(server));
        setSelectedExternalName(undefined);
        setEditServer(undefined);
        setConfirmDelete(undefined);
        setConfirmImport(undefined);
    };
    /** 选中一个外部注入实例：与配置条目选中互斥。 */
    const selectExternal = (server) => {
        setSelectedExternalName(server.serverName);
        setSelected(undefined);
        setEditServer(undefined);
        setConfirmDelete(undefined);
        setConfirmImport(undefined);
    };
    /** 打开新增弹窗：落点由当前作用域固定（全局 / 此工作区），不再二次选择。 */
    const openAdd = () => {
        setEditServer(undefined);
        setAddOpen(true);
    };
    /** 非空的服务器列表（组内滚动 + listbox 语义）。 */
    const renderServerScroll = (list, label) => (_jsx("div", { className: "skp-group-scroll", children: _jsx("ul", { className: "skp-list", role: "listbox", "aria-label": label, children: list.map((server) => {
                const isGlobal = server.scope === "global";
                const entry = isGlobal ? visibilityOfName(server.serverName) : undefined;
                return (_jsx(McpServerRow, { server: server, scope: scope, projectName: projectName, toolCount: toolCounts[server.serverName], visibilityEntry: entry, projects: projects, globalOff: globalOffOf(server.serverName), invisible: isGlobal && invisibleOf(server, entry), overrideState: scope === "workspace" && isGlobal
                        ? workspaceOverrideOf(projectOverrides, "mcp", server.serverName)
                        : "inherit", selected: selected === rowId(server), busy: busyKey !== undefined, onSelect: () => selectServer(server), onToggleDefault: () => void toggleRow(server) }, rowId(server)));
            }) }) }));
    /** 空态：区分「还没有」与搜索「无匹配」，并给原地添加入口。 */
    const renderEmpty = () => {
        if (searching)
            return _jsxs("div", { className: "skp-empty", children: ["\u6CA1\u6709\u5339\u914D\u300C", trimmedQuery, "\u300D\u7684 MCP\u3002"] });
        return (_jsxs("div", { className: "skp-empty", children: [_jsx("div", { children: scope === "global" ? "全局还没有 MCP。" : `工作区 ${projectName ?? ""} 还没有 MCP。` }), _jsx("button", { type: "button", className: "skp-btn", style: { marginTop: 10 }, onClick: openAdd, children: scope === "global" ? "添加全局 MCP" : "添加到此工作区" })] }));
    };
    /** 一个分组头（标题 + 计数 + 说明）。 */
    const renderGroupHead = (title, count, note) => (_jsxs("div", { className: "skp-list-group-head", children: [_jsx("span", { className: "skp-list-group-title", children: title }), _jsx("span", { className: "skp-group-count", children: count }), _jsx("span", { className: "skp-list-group-note", children: note })] }));
    /**
     * 「外部注入」组（全局 / 工作区两个视图共用）：配置只读、行尾默认开关可写。
     * 组头备注按作用域说明写入落点；保留组头与计数，为空时不占位。
     */
    const renderExternalGroup = () => visibleExternal.length > 0 ? (_jsxs("section", { className: "skp-group", role: "group", "aria-label": `外部注入（${visibleExternal.length}）`, children: [renderGroupHead("外部注入", scenarioRuntimes.length, scope === "global" ? "运行时注入 · 可设全局默认" : "运行时注入 · 可设本工作区默认"), _jsx("div", { className: "skp-group-scroll", children: _jsx("ul", { className: "skp-list", role: "listbox", "aria-label": "\u5916\u90E8\u6CE8\u5165 MCP", children: visibleExternal.map((server) => (_jsx(McpExternalRow, { server: server, scope: scope, projectName: projectName, globalDefaultDisabled: globalOffOf(server.serverName, server.disabledGlobally), visibilityEntry: visibilityOfName(server.serverName), projects: projects, invisible: invisibleOf(server, visibilityOfName(server.serverName)), overrideState: scope === "workspace"
                            ? workspaceOverrideOf(projectOverrides, "mcp", server.serverName)
                            : "inherit", selected: selectedExternalName === server.serverName, busy: busyKey !== undefined, onSelect: () => selectExternal(server), onToggleDefault: () => void toggleExternal(server) }, `external:${server.serverName}`))) }) })] })) : null;
    /** 列表主体：全局 = 全局配置 + 外部注入；工作区 = 本项目 + 引用的全局配置 + 外部注入。 */
    const renderListBody = () => {
        if (loading && data === undefined)
            return _jsx("div", { className: "skp-status", children: "\u52A0\u8F7D\u4E2D\u2026" });
        if (error !== undefined)
            return _jsxs("div", { className: "skp-error", children: ["\u8BFB\u53D6\u5931\u8D25\uFF1A", error] });
        if (scope === "global") {
            if (visibleGlobal.length === 0 && visibleExternal.length === 0)
                return renderEmpty();
            return (_jsxs("div", { className: "skp-group-scroll skp-group-scroll-plain", children: [visibleGlobal.length > 0 && (_jsxs(_Fragment, { children: [renderGroupHead("全局配置", globalServers.length, "~/.agents/mcp.json"), renderServerScroll(visibleGlobal, "全局配置 MCP")] })), renderExternalGroup()] }));
        }
        if (visibleProject.length === 0 && visibleGlobal.length === 0 && visibleExternal.length === 0) {
            if (hiddenCount > 0) {
                return (_jsxs("div", { className: "skp-group-scroll skp-group-scroll-plain", children: [_jsx("div", { className: "skp-empty", children: "\u672C\u5DE5\u4F5C\u533A\u6CA1\u6709\u53EF\u89C1\u7684 MCP\u3002" }), _jsxs("div", { className: "skp-pane-note", children: ["\u53E6\u6709 ", hiddenCount, " \u4E2A\u80FD\u529B\u672A\u5BF9\u6B64\u5916\u5DE5\u4F5C\u533A\u5F00\u653E"] })] }));
            }
            return renderEmpty();
        }
        return (_jsxs("div", { className: "skp-group-scroll skp-group-scroll-plain", children: [visibleProject.length > 0 && (_jsxs(_Fragment, { children: [renderGroupHead(`本项目 · ${projectName ?? "工作区"}`, projectServers.length, "工作区独有"), renderServerScroll(visibleProject, "本项目 MCP")] })), visibleGlobal.length > 0 && (_jsxs(_Fragment, { children: [renderGroupHead("引用的全局配置", workspaceGlobalServers.length, `默认开关作用于 ${projectName ?? "此工作区"}`), renderServerScroll(visibleGlobal, "引用的全局 MCP")] })), renderExternalGroup(), hiddenCount > 0 && (_jsxs("div", { className: "skp-pane-note", title: "\u8FD9\u4E9B\u80FD\u529B/\u5B9E\u4F8B\u5728\u5168\u5C40\u89C6\u56FE\u91CC\u672A\u88AB\u5F00\u653E\u7ED9\u672C\u5DE5\u4F5C\u533A\uFF1B\u8BF7\u5728\u5168\u5C40\u89C6\u56FE\u7684\u300C\u53EF\u89C1\u8303\u56F4\u300D\u91CC\u5F00\u542F", children: ["\u53E6\u6709 ", hiddenCount, " \u4E2A\u80FD\u529B\u672A\u5BF9\u6B64\u5916\u5DE5\u4F5C\u533A\u5F00\u653E"] }))] }));
    };
    const listTitle = scope === "global" ? "全局 MCP" : `${projectName ?? "工作区"} · MCP`;
    const listNote = scope === "global" ? "所有工作区" : "仅此工作区";
    const addTitle = scope === "global" ? "添加 MCP 到全局" : `添加 MCP 到工作区 ${projectName ?? "工作区"}`;
    return (_jsxs("div", { className: "skp-domain", children: [listErrors.length > 0 && _jsx("div", { className: "skp-error", children: listErrors.join("\n") }), opError && _jsx("div", { className: "skp-error", children: opError }), defaultError !== undefined && _jsx("div", { className: "skp-error", children: defaultError }), _jsxs("div", { className: "skp-body", children: [_jsxs("div", { className: "skp-list-pane", children: [_jsxs("div", { className: "skp-list-head", children: [_jsxs("span", { className: "skp-list-title", title: listTitle, children: [_jsx("span", { className: "skp-list-title-scope", children: scope === "global" ? "全局" : (projectName ?? "工作区") }), _jsx("span", { className: "skp-list-title-type", children: scope === "global" ? " MCP" : " · MCP" })] }), _jsx("span", { className: "skp-group-count", title: "\u5F53\u524D\u4F5C\u7528\u57DF\u603B\u6570", children: searching ? `${visibleProject.length + visibleGlobal.length} / ${scopeTotal}` : scopeTotal }), _jsx("span", { className: "skp-list-note", children: listNote }), _jsx("span", { className: "skp-detail-head-spacer" }), _jsx("button", { type: "button", className: "skp-btn skp-btn-primary skp-list-add", title: addTitle, "aria-label": addTitle, onClick: openAdd, children: "\uFF0B \u6DFB\u52A0 MCP" })] }), scope === "global" && (_jsx("div", { className: "skp-pane-note", children: "\u5168\u5C40\u914D\u7F6E\u5199\u5165 ~/.agents/mcp.json \u00B7 \u6240\u6709\u5DE5\u4F5C\u533A\u751F\u6548" })), scope === "workspace" && (_jsx("div", { className: "skp-pane-note", children: "\u9ED8\u8BA4\u5F00\u5173\u5199\u5165\u5DE5\u4F5C\u533A\u8986\u76D6 \u00B7 \u4EC5\u6B64\u5DE5\u4F5C\u533A\u751F\u6548" })), renderListBody()] }), _jsx("div", { className: "skp-detail skp-detail-fixed", children: selectedExternal !== undefined ? (_jsx(McpExternalDetail, { api: mcpApi, panelApi: api, server: selectedExternal, scope: scope, projectName: projectName, globalDefaultDisabled: globalOffOf(selectedExternal.serverName, selectedExternal.disabledGlobally), visibilityEntry: visibilityOfName(selectedExternal.serverName), projects: projects, globalOff: globalOffOf(selectedExternal.serverName, selectedExternal.disabledGlobally), onVisibilitySaved: () => {
                                setWriteVersion((value) => value + 1);
                                reload({ silent: true });
                            }, workspaces: projects, onSelectWorkspace: onSelectWorkspace }, selectedExternal.serverName)) : selectedServer ? (_jsx(McpDetail, { api: mcpApi, panelApi: api, server: selectedServer, scope: scope, workspace: workspace, projectName: projectName, visibilityEntry: selectedServer.scope === "global" ? visibilityOfName(selectedServer.serverName) : undefined, projects: projects, globalOff: globalOffOf(selectedServer.serverName), onVisibilitySaved: () => {
                                setWriteVersion((value) => value + 1);
                                reload({ silent: true });
                            }, workspaces: projects, onSelectWorkspace: onSelectWorkspace, confirmingDelete: confirmDelete === rowId(selectedServer), confirmingImport: confirmImport === rowId(selectedServer), onEdit: () => setEditServer(selectedServer), onToggle: () => {
                                if (selectedServer.scope === "global") {
                                    void runOp(mcpApi.setEnabled({ scope: "global", key: selectedServer.key, enabled: !selectedServer.enabled }));
                                }
                                else {
                                    void runOp(mcpApi.setEnabled({ scope: selectedServer.scope, key: selectedServer.key, enabled: !selectedServer.enabled }));
                                }
                            }, onDelete: () => onDelete(selectedServer), onImport: () => void onImport(selectedServer), onToolCount: (count) => setToolCounts((prev) => (prev[selectedServer.serverName] === count ? prev : { ...prev, [selectedServer.serverName]: count })) }, rowId(selectedServer))) : (_jsx("div", { className: "skp-detail-empty", children: scopeTotal === 0
                                ? "此作用域还没有 MCP。用列表标题栏的「＋ 添加 MCP」添加一个。"
                                : "选择一个服务器查看详情，或新增一个。" })) })] }), addOpen && (_jsx(McpAddDialog, { api: mcpApi, servers: servers, scope: scope === "global" ? "global" : "project", workspace: workspace, projectName: projectName, onClose: () => setAddOpen(false), onMutated: () => reload({ silent: true }) })), editServer !== undefined && (_jsx(McpEditDialog, { api: mcpApi, server: editServer, workspace: workspace, onClose: () => setEditServer(undefined), onSaved: () => reload() }))] }));
}
// ---------------------------------------------------------------------------
// 详情卡片
// ---------------------------------------------------------------------------
/**
 * 「使用记录」只读区：最近谁（哪个 session）在什么时候调用了该 server 的哪个 tool。
 *
 * 数据来自宿主内存（`tools.guard` 旁路记录，见 `mcp/usage.ts`）——插件/进程重载即
 * 清空、**不落盘**；打开期间每 2s 静默刷新。详情卡与「外部注入」详情共用这一块。
 */
function McpUsageSection({ api, serverName }) {
    const [view, setView] = useState(undefined);
    const [error, setError] = useState(undefined);
    useEffect(() => {
        let cancelled = false;
        let timer;
        const load = async () => {
            try {
                const next = await api.usage({ serverName });
                if (cancelled)
                    return;
                setView(next);
                setError(undefined);
            }
            catch (err) {
                if (cancelled)
                    return;
                setError(String(err));
            }
            if (!cancelled)
                timer = window.setTimeout(() => void load(), 2000);
        };
        void load();
        return () => {
            cancelled = true;
            if (timer !== undefined)
                window.clearTimeout(timer);
        };
    }, [api, serverName]);
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "skp-detail-inspect-head", children: [_jsx("span", { className: "skp-field-label", children: "\u4F7F\u7528\u8BB0\u5F55" }), _jsxs("span", { className: "skp-test-stat", children: ["\u4EC5\u672C\u6B21\u8FD0\u884C \u00B7 \u4E0D\u843D\u76D8", view === undefined ? "" : ` · 最近 ${view.limit} 条`] })] }), error !== undefined && _jsx("div", { className: "skp-error", children: error }), view === undefined ? (_jsx("div", { className: "skp-note", children: "\u8BFB\u53D6\u4E2D\u2026" })) : view.entries.length === 0 ? (_jsx("div", { className: "skp-note", children: "\u672C\u6B21\u8FD0\u884C\u8FD8\u6CA1\u6709\u8C03\u7528\u8BB0\u5F55\u3002" })) : (_jsx("ul", { className: "skp-usage", children: view.entries
                    .slice()
                    .reverse()
                    .map((entry, index) => (_jsxs("li", { className: "skp-usage-row", children: [_jsx("span", { className: "skp-usage-time", title: new Date(entry.time).toLocaleString(), children: formatUsageTime(entry.time) }), _jsx("span", { className: "skp-usage-session", title: entry.sessionId === "" ? undefined : entry.sessionId, children: entry.sessionTitle ?? (entry.sessionId.length > 0 ? `对话 ${entry.sessionId.slice(-8)}` : "—") }), _jsx("code", { className: "skp-usage-tool", title: entry.serverName, children: entry.tool })] }, `${entry.time}-${entry.tool}-${index}`))) }))] }));
}
/**
 * MCP 详情的两段作用域链（全局 → 工作区，契约 §3.6：只到工作区）。
 *
 * 全局视图的第二段先展开工作区下拉，选中后才切到该工作区；工作区视图的
 * 第二段是真实状态。**不展示任何会话挂载状态**（挂载是会话级事实）。
 */
function McpScopeChain({ scope, projectName, globalSeg, workspaceSeg, workspaces, onSelectWorkspace, }) {
    return (_jsx(ScopeChain, { scope: scope, projectName: projectName, globalSeg: globalSeg, workspaceSeg: workspaceSeg, workspaces: workspaces, onSelectWorkspace: onSelectWorkspace }));
}
/**
 * 「外部注入」MCP 的详情：**配置只读，默认开关可写**。
 *
 * 这些实例不在本插件配置文件里（其它插件/profile 在运行时挂的 mcp-client），
 * 配置与生命周期由注入方管理，能力面板不能编辑/删除/卸载；但**默认开关可写**：
 * 全局视图 = 全局默认关闭名单（独立文件 `capability-global-overrides.json`），
 * 工作区视图 = 本工作区默认（项目 overrides，可覆盖全局默认）；两者都不卸载
 * 共享实例，只按会话重新 `tools.restrict`。详情只展示能观察到的信息：来源插件、
 * 注入方式、命名空间、传输/命令摘要（能读到才有）、每个工具的说明与参数
 * （来自工具注册表，与「查看工具与参数」同源），以及使用记录。
 */
function McpExternalDetail({ api, panelApi, server, scope, projectName, globalDefaultDisabled, visibilityEntry, projects, globalOff: globalOffProp, onVisibilitySaved, workspaces, onSelectWorkspace, }) {
    const [toolsOpen, setToolsOpen] = useState(false);
    // 「使用记录」：宿主内存里的 MCP 工具调用记录（只读、不落盘），打开才拉取。
    const [usageOpen, setUsageOpen] = useState(false);
    const hasTools = server.tools.length > 0;
    /** 全局默认关闭（原始名单；宿主 `disabledGlobally` 为 true 时也必然是关闭）。 */
    const globalOff = globalOffProp || globalDefaultDisabled || server.disabledGlobally === true;
    /** 本工作区有效默认关闭（含全局默认继承；本工作区重新打开后为 false）。 */
    const workspaceOff = disabledInWorkspaceOf(server);
    return (_jsxs("div", { className: "skp-detail-card", children: [_jsxs("div", { className: "skp-detail-head", children: [_jsx("h3", { children: server.serverName }), _jsxs("span", { style: HEAD_TAGS_STYLE, children: [_jsx(ExternalSourceTags, { server: server }), externalAttributionIsSpeculative(server) && (_jsx("span", { className: "skp-tag skp-tag-warn", title: "\u6765\u6E90\u4E3A\u63A8\u6D4B\uFF0C\u8BF7\u6838\u5BF9\u5DE5\u5177\u6E05\u5355", children: "\u63A8\u6D4B" })), _jsx("span", { className: "skp-tag skp-tag-flat", title: "\u914D\u7F6E\u7531\u6CE8\u5165\u65B9\u7BA1\u7406\uFF08\u53EA\u8BFB\uFF09\uFF1B\u9ED8\u8BA4\u5F00\u5173\u53EF\u5728\u5217\u8868\u884C\u5C3E\u8BBE\u7F6E\uFF08\u53EF\u5199\uFF09", children: "\u914D\u7F6E\u53EA\u8BFB" })] })] }), _jsx(McpScopeChain, { scope: scope, projectName: projectName, globalSeg: {
                    on: !globalOff,
                    title: globalOff ? "全局默认关闭" : "全局默认启用",
                    note: "全局默认写 capability-global-overrides.json · 不改注入方配置",
                }, workspaceSeg: {
                    on: !workspaceOff,
                    title: !workspaceOff
                        ? globalOff
                            ? "已覆盖全局默认"
                            : "默认启用"
                        : globalOff
                            ? "继承全局默认关闭"
                            : "本工作区默认关闭",
                    note: server.restrictable ? "行尾开关可写本工作区默认（不卸载共享实例）" : EXTERNAL_TOGGLE_BLOCKED_TITLE,
                }, workspaces: workspaces, onSelectWorkspace: onSelectWorkspace }), externalAttributionIsSpeculative(server) && (_jsx("div", { className: "skp-note skp-note-warn", children: "\u6765\u6E90\u4E3A\u63A8\u6D4B\uFF0C\u8BF7\u6838\u5BF9\u5DE5\u5177\u6E05\u5355" })), (server.attribution?.legacyUnit === true || typeof server.attribution?.legacyUnit === "string") && (_jsx("div", { className: "skp-note", title: typeof server.attribution.legacyUnit === "string" ? `旧版键：${server.attribution.legacyUnit}` : undefined, children: "\u65E7\u7248\u952E\u5DF2\u8FC1\u79FB" })), _jsx("div", { className: "skp-note", children: isSynthesized(server)
                    ? `配置只读：该实例由工具命名空间 mcp__${server.serverName}__* 合成（没有 mcp-client 实例，无配置可编辑）；默认开关可写（全局默认 / 本工作区）。`
                    : `配置只读：该 MCP 由 ${externalChannelOf(server) ?? server.source ?? "其它插件"} 在运行时注入，能力面板不能编辑或删除；默认开关可写（全局默认 / 本工作区），不卸载共享实例。` }), _jsxs("div", { className: "skp-detail-actions", children: [_jsx("button", { type: "button", className: "skp-btn", title: hasTools ? "查看该实例暴露的工具与参数（数据来自运行时工具注册表，不重新连接）" : "该实例的工具清单不可见（只能统计调用次数）", onClick: () => setToolsOpen((open) => !open), children: toolsOpen ? "收起工具与参数" : "查看工具与参数" }), _jsx("button", { type: "button", className: "skp-btn", onClick: () => setUsageOpen((open) => !open), children: usageOpen ? "收起使用记录" : "使用记录" })] }), _jsxs("dl", { className: "skp-detail-fields", children: [_jsx("dt", { children: "\u6765\u6E90" }), _jsx("dd", { children: externalChannelOf(server) ?? server.source ?? "来源未识别" }), _jsx("dt", { children: "\u6765\u6E90\u5224\u5B9A" }), _jsx("dd", { children: externalAttributionText(server) }), _jsx("dt", { children: "\u6CE8\u5165\u65B9\u5F0F" }), _jsxs("dd", { children: [externalInjectionText(server), isSynthesized(server) ? "；无实例配置，传输方式未知" : ""] }), _jsx("dt", { children: "\u547D\u540D\u7A7A\u95F4" }), _jsx("dd", { children: _jsxs("code", { children: ["mcp__", server.serverName, "__*"] }) }), server.transport !== undefined && (_jsxs(_Fragment, { children: [_jsx("dt", { children: "\u4F20\u8F93\u65B9\u5F0F" }), _jsxs("dd", { children: [server.transport, server.summary !== undefined ? ` · ${server.summary}` : ""] })] })), scope === "global" && (_jsx(VisibilityDetailFields, { api: panelApi, domain: "mcp", capabilityKey: server.serverName, name: server.serverName, entry: visibilityEntry, workspaces: projects, globalOff: globalOff, onSaved: onVisibilitySaved })), _jsx("dt", { children: "\u5168\u5C40\u9ED8\u8BA4" }), _jsx("dd", { children: globalOff
                            ? "关闭（在「全局」作用域用列表行尾开关恢复；不改注入方配置、不卸载共享实例）"
                            : "启用" }), _jsx("dt", { children: "\u672C\u5DE5\u4F5C\u533A" }), _jsx("dd", { children: !workspaceOff
                            ? globalOff
                                ? "已覆盖全局默认：本工作区显式重新打开"
                                : "继承全局默认（启用）"
                            : globalOff
                                ? "继承全局默认（关闭）"
                                : "本工作区默认关闭" }), _jsx("dt", { children: "\u9ED8\u8BA4\u5F00\u5173" }), _jsx("dd", { children: server.restrictable
                            ? "列表行尾开关可写：全局视图 = 全局默认（独立文件，所有工作区生效）；工作区视图 = 本工作区默认（可覆盖全局默认）。均不卸载共享实例。"
                            : EXTERNAL_TOGGLE_BLOCKED_TITLE }), _jsx("dt", { children: "\u672C\u6B21\u8FD0\u884C\u8C03\u7528" }), _jsx("dd", { children: server.calls > 0 ? `${server.calls} 次` : "还没有调用记录" }), _jsx("dt", { children: "\u7BA1\u7406" }), _jsx("dd", { children: isSynthesized(server)
                            ? "工具命名空间无法在这里编辑或卸载；请在注入方管理（默认开关仍可写）。"
                            : "配置由注入方管理；能力面板不提供编辑/删除/卸载，但默认开关可写。" })] }), toolsOpen && (_jsxs("div", { className: "skp-detail-inspect", children: [_jsxs("div", { className: "skp-detail-inspect-head", children: [_jsx("span", { className: "skp-field-label", children: "\u5DE5\u5177\u4E0E\u53C2\u6570" }), _jsx("span", { className: "skp-test-stat", children: hasTools ? `${server.tools.length} 个工具 · 点击工具查看参数` : "工具清单不可见" })] }), hasTools ? (_jsx(ToolsInspector, { tools: server.tools })) : (_jsx("div", { className: "skp-note", children: "\u5DE5\u5177\u6E05\u5355\u4E0D\u53EF\u89C1\uFF08\u8BE5\u5B9E\u4F8B\u6309\u4F5C\u7528\u57DF\u6CE8\u5165\uFF0C\u53EA\u80FD\u7EDF\u8BA1\u8C03\u7528\u6B21\u6570\uFF09\u3002" }))] })), usageOpen && (_jsx("div", { className: "skp-detail-inspect", children: _jsx(McpUsageSection, { api: api, serverName: server.serverName }) }))] }));
}
/**
 * 配置条目详情：归属徽标 + 字段 + 写操作 + 「工具与参数」（真连一次探测，
 * 两栏工具/参数）/「使用记录」两个折叠区。
 *
 * 动作语义沿用现状：**项目条目** = 启用/禁用、编辑、删除（两击确认）；
 * **全局条目** = 「导入到本项目」（登记项目级引用，同名时两击确认）、编辑、
 * 删除；全局条目自身 disabled 时给一个直接的恢复入口。
 */
function McpDetail({ api, panelApi, server, scope, workspace, projectName, visibilityEntry, projects, globalOff, onVisibilitySaved, workspaces, onSelectWorkspace, confirmingDelete, confirmingImport, onEdit, onToggle, onDelete, onImport, onToolCount, }) {
    const isGlobal = server.scope === "global";
    /** 工作区里来自全局导入的副本（条目带导入标记）：徽标按"出身"标「全局」。 */
    const imported = !isGlobal && server.importedFromGlobal === true;
    /** 工作区级引用（内容跟随全局，启停是工作区级标记；不提供「编辑」）。 */
    const isReference = server.reference === true;
    /** 移除按钮文案：全局导入的副本 = 「移出」（全局原版仍在全局区）；其余 = 「删除」。 */
    const removeVerb = imported ? "移出" : "删除";
    const hasWorkspace = workspace !== undefined;
    // 「查看工具与参数」：真连一次该条目（零副作用探测），用两栏检视器展开工具与参数。
    const [inspect, setInspect] = useState({
        open: false,
        testing: false,
    });
    // 「使用记录」：宿主内存里的 MCP 工具调用记录（只读、不落盘）。
    const [usageOpen, setUsageOpen] = useState(false);
    // 换选中的服务器时收起并丢弃上一次的结果，避免把 A 的清单显示在 B 上。
    useEffect(() => {
        setInspect({ open: false, testing: false });
        setUsageOpen(false);
    }, [server.key, server.scope]);
    /** 跑一次探测；失败以 `{ ok:false, errors }` 归一（不抛异常，就地展示）。 */
    const runInspect = async () => {
        setInspect({ open: true, testing: true });
        try {
            const result = await api.test({ entry: server.entry, key: server.key });
            setInspect({ open: true, testing: false, result });
            if (result.ok)
                onToolCount?.(result.tools.length);
        }
        catch (error) {
            setInspect({ open: true, testing: false, result: { ok: false, errors: [String(error)] } });
        }
    };
    /** 两段作用域链：全局 → 工作区（不展示任何会话挂载状态）。 */
    const globalSeg = isGlobal
        ? {
            on: server.enabled,
            title: server.enabled ? "已配置 · 默认启用" : "已配置 · 配置内禁用",
            note: `来源：${server.filePath}`,
        }
        : { on: false, title: "未配置", note: "本项只存在于所选工作区" };
    const workspaceSeg = isReference
        ? {
            on: server.enabled,
            title: server.enabled ? "已引用 · 默认启用" : "已引用 · 已禁用",
            note: "来源：工作区引用（内容跟随全局配置）",
        }
        : isGlobal
            ? {
                on: server.disabledInProject !== true,
                title: server.disabledInProject === true ? "已关闭（覆盖）" : "默认启用",
                note: server.disabledInProject === true
                    ? "来源：工作区覆盖 · 仅此工作区默认关闭"
                    : "未配置工作区覆盖 · 跟随全局配置",
            }
            : {
                on: server.enabled,
                title: server.enabled ? "已配置 · 默认启用" : "已配置 · 配置内禁用",
                note: "来源：工作区 .mcp.json",
            };
    return (_jsxs("div", { className: "skp-detail-card", children: [_jsxs("div", { className: "skp-detail-head", children: [_jsx("h3", { children: server.key }), _jsxs("span", { style: HEAD_TAGS_STYLE, children: [_jsx("span", { className: isGlobal || imported ? "skp-tag skp-tag-global" : "skp-tag skp-tag-project", title: isGlobal
                                    ? server.shadowed
                                        ? "全局服务器（对所有工作区生效）；当前被本工作区内的同名条目遮蔽"
                                        : "全局服务器（对所有工作区生效）"
                                    : isReference
                                        ? "本工作区内对全局服务器的引用（内容跟随全局，默认开关只作用于本工作区）"
                                        : imported
                                            ? "本工作区内来自全局导入的副本（遮蔽全局同名条目，控制只作用于本工作区）"
                                            : "本工作区内的服务器（遮蔽全局同名条目）", children: isGlobal || imported ? "全局" : "本项" }), isReference && (_jsx("span", { className: "skp-tag skp-tag-flat", title: "\u5F15\u7528\uFF1A\u5185\u5BB9\u8DDF\u968F\u5168\u5C40\uFF0C\u9ED8\u8BA4\u5F00\u5173\u53EA\u4F5C\u7528\u4E8E\u672C\u5DE5\u4F5C\u533A", children: "\u5F15\u7528" }))] })] }), _jsx(McpScopeChain, { scope: scope, projectName: projectName, globalSeg: globalSeg, workspaceSeg: workspaceSeg, workspaces: workspaces, onSelectWorkspace: onSelectWorkspace }), _jsxs("div", { className: "skp-detail-actions", children: [!isGlobal && !isReference && (_jsx("button", { type: "button", className: `skp-btn ${server.enabled ? "skp-state-on" : "skp-state-off"}`, title: server.enabled ? "点击禁用（保留在配置文件中，不挂载）" : "点击启用（写入配置文件并挂载）", onClick: onToggle, children: server.enabled ? "已启用" : "已禁用" })), isGlobal && !server.enabled && scope === "global" && (_jsx("button", { type: "button", className: "skp-btn skp-state-off", title: "\u6B64\u5168\u5C40\u670D\u52A1\u5668\u5F53\u524D\u4E3A\u7981\u7528\u72B6\u6001\uFF1B\u70B9\u51FB\u6062\u590D\u542F\u7528\uFF08\u5BF9\u6240\u6709\u5DE5\u4F5C\u533A\u751F\u6548\uFF09", onClick: onToggle, children: "\u5DF2\u7981\u7528" })), isGlobal && hasWorkspace && (_jsx("button", { type: "button", className: confirmingImport ? "skp-btn skp-btn-danger" : "skp-btn", title: confirmingImport
                            ? "工作区内已有同名引用，再次点击将重新登记（保留原启停状态，全局配置不变）"
                            : "在本工作区登记对全局服务器的引用（内容跟随全局，可设置本工作区默认）", onClick: onImport, children: confirmingImport ? "确认重复导入同名引用？" : "引用到本工作区" })), !isReference && (_jsx("button", { type: "button", className: "skp-btn", onClick: onEdit, children: "\u7F16\u8F91" })), _jsx("button", { type: "button", className: "skp-btn", disabled: inspect.testing, title: inspect.open
                            ? "收起工具与参数"
                            : "真连一次该服务器并列出它的描述、工具与参数（不落盘、不注册工具、不影响已挂载的连接）", onClick: () => {
                            if (inspect.open)
                                setInspect({ open: false, testing: false });
                            else
                                void runInspect();
                        }, children: inspect.testing ? "连接中…" : inspect.open ? "收起工具列表" : "查看工具与参数" }), _jsx("button", { type: "button", className: "skp-btn", title: "\u67E5\u770B\u6700\u8FD1\u54EA\u4E2A\u5BF9\u8BDD\u5728\u4EC0\u4E48\u65F6\u5019\u8C03\u7528\u4E86\u8FD9\u4E2A MCP \u7684\u54EA\u4E2A\u5DE5\u5177\uFF08\u4EC5\u672C\u6B21\u8FD0\u884C\u7684\u5185\u5B58\u8BB0\u5F55\uFF0C\u4E0D\u843D\u76D8\uFF09", onClick: () => setUsageOpen((open) => !open), children: usageOpen ? "收起使用记录" : "使用记录" }), _jsx("button", { type: "button", className: confirmingDelete ? "skp-btn skp-btn-danger" : "skp-btn skp-btn-danger-ghost", title: isGlobal
                            ? "删除此全局服务器；各工作区内的引用不受影响（变为悬空引用）"
                            : isReference
                                ? "移出本工作区（移除对全局服务器的引用，全局原版仍在全局区）"
                                : imported
                                    ? "移出本工作区（移除全局导入的副本，全局原版仍在全局区）"
                                    : "删除本工作区中的这个服务器", onClick: onDelete, children: confirmingDelete ? `确认${removeVerb}？` : removeVerb })] }), isReference && _jsx("div", { className: "skp-note", children: "\u5F15\u7528\uFF1A\u5185\u5BB9\u8DDF\u968F\u5168\u5C40\u914D\u7F6E\uFF0C\u9ED8\u8BA4\u5F00\u5173\u53EA\u4F5C\u7528\u4E8E\u672C\u5DE5\u4F5C\u533A\u3002" }), _jsxs("dl", { className: "skp-detail-fields", children: [scope === "global" && isGlobal && (_jsx(VisibilityDetailFields, { api: panelApi, domain: "mcp", capabilityKey: server.serverName, name: server.key, entry: visibilityEntry, workspaces: projects, globalOff: globalOff, onSaved: onVisibilitySaved })), _jsx("dt", { children: "\u547D\u540D\u7A7A\u95F4" }), _jsxs("dd", { children: ["mcp__", server.serverName, "__*"] }), typeof server.entry.description === "string" && server.entry.description.trim().length > 0 && (_jsxs(_Fragment, { children: [_jsx("dt", { children: "\u7528\u9014\u63CF\u8FF0" }), _jsx("dd", { children: server.entry.description })] })), server.transport === "stdio" ? (_jsxs(_Fragment, { children: [_jsx("dt", { children: "\u547D\u4EE4" }), _jsx("dd", { className: "skp-path", children: server.entry.command }), (server.entry.args ?? []).length > 0 && (_jsxs(_Fragment, { children: [_jsx("dt", { children: "\u53C2\u6570" }), _jsx("dd", { className: "skp-path", children: formatMaskedArgs(server.entry.args ?? []) })] }))] })) : (_jsxs(_Fragment, { children: [_jsx("dt", { children: "URL" }), _jsx("dd", { className: "skp-path", children: sanitizeDescriptorText(server.entry.url ?? "") })] })), _jsx("dt", { children: "\u914D\u7F6E\u6587\u4EF6" }), _jsx("dd", { className: "skp-path", children: server.filePath })] }), inspect.open && (_jsxs("div", { className: "skp-detail-inspect", children: [_jsxs("div", { className: "skp-detail-inspect-head", children: [_jsx("span", { className: "skp-field-label", children: "\u5DE5\u5177\u4E0E\u53C2\u6570" }), _jsxs("span", { style: INSPECT_HEAD_RIGHT_STYLE, children: [inspect.result?.ok === true && inspect.result.tools.length > 0 && (_jsx("span", { className: "skp-test-stat", children: "\u70B9\u51FB\u5DE5\u5177\u67E5\u770B\u53C2\u6570" })), _jsx("button", { type: "button", className: "skp-link-btn", disabled: inspect.testing, onClick: () => void runInspect(), children: inspect.testing ? "连接中…" : "重新测试" })] })] }), inspect.result === undefined ? (_jsx("div", { className: "skp-note", children: "\u6B63\u5728\u8FDE\u63A5\u5E76\u8BFB\u53D6\u5DE5\u5177\u6E05\u5355\u2026" })) : (_jsx(ToolsReport, { result: inspect.result }))] })), usageOpen && (_jsx("div", { className: "skp-detail-inspect", children: _jsx(McpUsageSection, { api: api, serverName: server.serverName }) }))] }));
}
// ---------------------------------------------------------------------------
// 新增 / 编辑表单
// ---------------------------------------------------------------------------
/**
 * 新增 / 编辑表单（分别内嵌在添加 / 编辑弹窗里，见 McpAddDialog / McpEditDialog）。
 *
 * 多行文本框承载 env / headers（每行 `KEY=VALUE`）与 args（每行一个参数），
 * 提交时解析成结构化字段。v20.1 起添加弹窗的**落点由当前作用域固定**
 * （`fixedScope`），表单不再二次选择类型/作用域；编辑态 scope 与 name 锁定
 * （改名 = 删除后重建）。
 *
 * `embedded` 为 true 时褪掉卡片外壳与自带标题，直接作为弹窗内容；
 * 此时按钮行由 `actionsClass` 指定落到弹窗底部的对齐方式。
 * onSave 抛错（如宿主校验/落盘失败）时把错误信息展示在表单顶部。
 */
function McpForm({ api, mode, server, workspace, embedded, actionsClass = "skp-detail-actions", fixedScope, onCancel, onSave, }) {
    // 编辑态用现有条目回填；新增态从空对象起步。
    const entry = server?.entry ?? {};
    const [scope, setScope] = useState(server?.scope ?? fixedScope ?? (workspace !== undefined ? "project" : "global"));
    const [key, setKey] = useState(server?.key ?? "");
    const [description, setDescription] = useState(typeof entry.description === "string" ? entry.description : "");
    const [transport, setTransport] = useState(server?.transport ?? "stdio");
    const [command, setCommand] = useState(entry.command ?? "");
    const [args, setArgs] = useState((entry.args ?? []).join("\n"));
    const [env, setEnv] = useState(recordToLines(entry.env));
    const [url, setUrl] = useState(entry.url ?? "");
    const [headers, setHeaders] = useState(recordToLines(entry.headers));
    const [timeoutMs, setTimeoutMs] = useState(entry.timeoutMs !== undefined ? String(entry.timeoutMs) : "");
    const [disabled, setDisabled] = useState(entry.disabled === true);
    const [errors, setErrors] = useState([]);
    const [saving, setSaving] = useState(false);
    // 「测试连接」：结果（成功含工具清单 / 失败含错误文案）与进行中标志。
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState(undefined);
    const isNew = mode === "new";
    /**
     * 从当前表单值构建条目（保存与测试共用同一口径，避免"能测不能存"漂移）。
     * 有校验问题时返回问题列表；测试与保存都直接展示这些问题。
     */
    const buildEntry = () => {
        const problems = [];
        if (key.trim().length === 0)
            problems.push("名称不能为空");
        if (transport === "stdio" && command.trim().length === 0)
            problems.push('stdio 服务器需要填写「命令」');
        if (transport === "http" && url.trim().length === 0)
            problems.push('http 服务器需要填写「URL」');
        const envRecord = linesToRecord(env, "env", problems);
        const headerRecord = linesToRecord(headers, "headers", problems);
        const timeout = timeoutMs.trim().length === 0 ? undefined : Number(timeoutMs);
        if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0))
            problems.push("超时必须是正数（ms）");
        if (problems.length > 0)
            return { ok: false, problems };
        // 只把"有内容的可选字段"写进条目，保持配置文件最小化。
        // 「全局导入」标记随编辑保留（改字段不抹掉"来自全局导入"的身份）。
        const importMarker = entry.importedFromGlobal === true ? { importedFromGlobal: true } : {};
        const descriptionValue = description.trim();
        const descriptionField = descriptionValue.length > 0 ? { description: descriptionValue } : {};
        const next = transport === "stdio"
            ? {
                type: "stdio",
                command: command.trim(),
                args: linesToArray(args),
                ...descriptionField,
                ...(Object.keys(envRecord).length > 0 ? { env: envRecord } : {}),
                ...(timeout !== undefined ? { timeoutMs: timeout } : {}),
                ...(disabled ? { disabled: true } : {}),
                ...importMarker,
            }
            : {
                type: "http",
                url: url.trim(),
                ...descriptionField,
                ...(Object.keys(headerRecord).length > 0 ? { headers: headerRecord } : {}),
                ...(timeout !== undefined ? { timeoutMs: timeout } : {}),
                ...(disabled ? { disabled: true } : {}),
                ...importMarker,
            };
        return { ok: true, entry: next };
    };
    /** 保存（客户端前置校验与宿主 validateEntry 同口径，快速反馈）。 */
    const submit = async () => {
        const built = buildEntry();
        if (!built.ok) {
            setErrors(built.problems);
            return;
        }
        setSaving(true);
        try {
            await onSave(scope, key.trim(), built.entry);
            setErrors([]);
        }
        catch (error) {
            // 宿主校验 / 落盘失败：把错误展示在表单顶部（编辑态此前走面板级
            // opError，新增态弹窗内没有该通道，统一收敛到表单内）。
            setErrors([error instanceof Error ? error.message : String(error)]);
        }
        finally {
            setSaving(false);
        }
    };
    /**
     * 「测试」：把当前表单草稿直接交给宿主真实连接（不落盘、不挂载），
     * 结果就地展示工具名与参数。失败只更新 testResult，不抛异常。
     */
    const runTest = async () => {
        const built = buildEntry();
        if (!built.ok) {
            setErrors(built.problems);
            setTestResult(undefined);
            return;
        }
        setErrors([]);
        setTesting(true);
        setTestResult(undefined);
        try {
            setTestResult(await api.test({ entry: built.entry, key: key.trim() }));
        }
        catch (error) {
            // 传输层异常（RPC 断线等）：按失败结果展示，不冒泡到渲染层。
            setTestResult({ ok: false, errors: [error instanceof Error ? error.message : String(error)] });
        }
        finally {
            setTesting(false);
        }
    };
    const busy = saving || testing;
    return (_jsxs("div", { className: embedded ? undefined : "skp-detail-card", children: [!embedded && _jsx("h3", { children: isNew ? "添加 MCP" : `编辑 ${server?.key}` }), errors.length > 0 && _jsx("div", { className: "skp-error", children: errors.join("\n") }), _jsxs("div", { className: "skp-form", children: [fixedScope === undefined && (_jsxs("label", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "\u4F5C\u7528\u57DF" }), _jsx(SkpSelect, { value: scope, disabled: !isNew, ariaLabel: "\u670D\u52A1\u5668\u4F5C\u7528\u57DF", options: [
                                    { value: "project", label: "工作区（.mcp.json）", disabled: !hasWorkspaceLabel(workspace) },
                                    { value: "global", label: "全局（~/.agents/mcp.json）" },
                                ], onChange: (value) => setScope(value === "project" ? "project" : "global") })] })), _jsxs("label", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "\u540D\u79F0" }), _jsx("input", { className: "skp-input", value: key, disabled: !isNew, placeholder: "github", onChange: (e) => setKey(e.target.value) })] }), _jsxs("label", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "\u7528\u9014\u63CF\u8FF0\uFF08\u53EF\u9009\uFF0C\u4F9B Jev \u80FD\u529B\u5224\u65AD\uFF09" }), _jsx("textarea", { className: "skp-input skp-textarea", value: description, placeholder: "\u4F8B\u5982\uFF1A\u8FDE\u63A5 GitHub \u4ED3\u5E93\uFF0C\u8BFB\u5199 issue / PR / \u6587\u4EF6", onChange: (e) => setDescription(e.target.value) })] }), _jsxs("label", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "\u4F20\u8F93\u65B9\u5F0F" }), _jsx(SkpSelect, { value: transport, ariaLabel: "\u4F20\u8F93\u65B9\u5F0F", options: [
                                    { value: "stdio", label: "stdio（启动本地命令）" },
                                    { value: "http", label: "http（流式 HTTP 端点）" },
                                ], onChange: (value) => setTransport(value === "http" ? "http" : "stdio") })] }), transport === "stdio" ? (_jsxs(_Fragment, { children: [_jsxs("label", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "\u547D\u4EE4" }), _jsx("input", { className: "skp-input", value: command, placeholder: "npx", onChange: (e) => setCommand(e.target.value) })] }), _jsxs("label", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "\u53C2\u6570\uFF08\u6BCF\u884C\u4E00\u4E2A\uFF09" }), _jsx("textarea", { className: "skp-input skp-textarea", value: args, placeholder: "-y\n@modelcontextprotocol/server-github", onChange: (e) => setArgs(e.target.value) })] }), _jsxs("label", { className: "skp-field", children: [_jsxs("span", { className: "skp-field-label", children: ["\u73AF\u5883\u53D8\u91CF\uFF08\u6BCF\u884C KEY=VALUE\uFF0C\u652F\u6301 $", "${VAR}", "\uFF09"] }), _jsx("textarea", { className: "skp-input skp-textarea", value: env, placeholder: "GITHUB_TOKEN=${GITHUB_TOKEN}", onChange: (e) => setEnv(e.target.value) })] })] })) : (_jsxs(_Fragment, { children: [_jsxs("label", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "URL" }), _jsx("input", { className: "skp-input", value: url, placeholder: "http://localhost:3000/mcp", onChange: (e) => setUrl(e.target.value) })] }), _jsxs("label", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "\u8BF7\u6C42\u5934\uFF08\u6BCF\u884C KEY=VALUE\uFF09" }), _jsx("textarea", { className: "skp-input skp-textarea", value: headers, onChange: (e) => setHeaders(e.target.value) })] })] })), _jsxs("label", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "\u5DE5\u5177\u8C03\u7528\u8D85\u65F6\uFF08ms\uFF0C\u53EF\u9009\uFF09" }), _jsx("input", { className: "skp-input", value: timeoutMs, inputMode: "numeric", placeholder: "60000", onChange: (e) => setTimeoutMs(e.target.value) })] }), _jsxs("label", { className: "skp-field skp-field-inline", children: [_jsx("input", { type: "checkbox", checked: disabled, onChange: (e) => setDisabled(e.target.checked) }), _jsx("span", { children: "\u7981\u7528\uFF08\u4FDD\u7559\u5728\u914D\u7F6E\u6587\u4EF6\u4E2D\uFF0C\u4E0D\u6302\u8F7D\uFF09" })] }), testing && _jsx("div", { className: "skp-status", children: "\u6B63\u5728\u8FDE\u63A5\u5E76\u8BFB\u53D6\u5DE5\u5177\u5217\u8868\u2026" }), testResult !== undefined && _jsx(ToolsReport, { result: testResult }), _jsxs("div", { className: actionsClass, children: [_jsx("button", { type: "button", className: "skp-btn", disabled: busy, title: "\u7528\u5F53\u524D\u8868\u5355\u5185\u5BB9\u771F\u5B9E\u8FDE\u63A5\u4E00\u6B21\uFF08\u4E0D\u4FDD\u5B58\u3001\u4E0D\u6302\u8F7D\uFF09\uFF0C\u5217\u51FA\u8BE5\u670D\u52A1\u5668\u7684\u5DE5\u5177\u4E0E\u53C2\u6570", onClick: () => void runTest(), children: testing ? "测试中…" : "测试连接" }), _jsx("button", { type: "button", className: "skp-btn skp-btn-primary", disabled: busy, onClick: () => void submit(), children: saving ? (isNew ? "添加中…" : "保存中…") : isNew ? "添加" : "保存" }), _jsx("button", { type: "button", className: "skp-btn", onClick: onCancel, children: "\u53D6\u6D88" })] })] })] }));
}
// ---------------------------------------------------------------------------
// 工具与参数（两栏检视器）
// ---------------------------------------------------------------------------
/**
 * 「工具与参数」手风琴检视器（配置条目与外部注入共用）：
 *  - 每个工具一行，只显示工具名 + 参数个数（不显示 description）；
 *  - 点工具名在其**下方**展开参数表（参数 / 类型 / 必填 / 说明），再点收起；
 *    同一时间只展开一个工具；
 *  - 参数从 `tool.parameters` 的 `properties` + `required` 展开；无参数显示「无参数」。
 *
 * 展开/收起只改变本地状态，**不重新探测**（探测由调用方控制）；工具清单变化
 * （重新测试 / 换服务器）时若当前展开项已不存在则自动收起。
 */
function ToolsInspector({ tools }) {
    // 手风琴：默认全部收起；点工具名展开其参数表，再点收起（同一时间只展开一个）。
    const [expandedName, setExpandedName] = useState(undefined);
    useEffect(() => {
        setExpandedName((current) => (current !== undefined && tools.some((tool) => tool.name === current) ? current : undefined));
    }, [tools]);
    return (_jsx("div", { className: "skp-tool-accordion", role: "list", children: tools.map((tool) => {
            const open = expandedName === tool.name;
            const parameters = toolParameters(tool.parameters);
            return (_jsxs("div", { className: open ? "skp-tool-item skp-tool-item-open" : "skp-tool-item", role: "listitem", children: [_jsxs("button", { type: "button", className: "skp-tool-trigger", "aria-expanded": open, title: tool.name, onClick: () => setExpandedName(open ? undefined : tool.name), children: [_jsx("span", { className: "skp-tool-chevron", "aria-hidden": "true", children: open ? "▾" : "▸" }), _jsx("code", { className: "skp-tool-name", children: tool.name }), _jsx("span", { className: "skp-tool-count", children: parameters.length > 0 ? `${parameters.length} 个参数` : "无参数" })] }), open && (_jsx("div", { className: "skp-tool-body", children: _jsx(ToolParameterTable, { parameters: parameters }) }))] }, tool.name));
        }) }));
}
/**
 * 「测试连接」/「查看工具与参数」的成功报告：状态行（连接正常 / 工具数 / 耗时）
 * + 服务器提示（默认折叠 3 行）+ 两栏工具/参数检视器。失败只展示错误块。
 */
function ToolsReport({ result }) {
    if (!result.ok)
        return _jsx("div", { className: "skp-error", children: result.errors.join("\n") });
    const instruction = typeof result.instruction === "string" ? result.instruction.trim() : "";
    return (_jsxs("div", { className: "skp-test", children: [_jsxs("div", { className: "skp-test-head", children: [_jsx("span", { className: "skp-tag skp-tag-global", children: "\u8FDE\u63A5\u6B63\u5E38" }), _jsxs("span", { className: "skp-test-stat", children: [result.tools.length, " \u4E2A\u5DE5\u5177"] }), _jsxs("span", { className: "skp-test-stat", children: ["\u8017\u65F6 ", result.elapsedMs, "ms"] })] }), instruction.length > 0 && _jsx(McpInstruction, { text: instruction }), result.tools.length === 0 ? (_jsx("div", { className: "skp-note", children: "\u8FDE\u63A5\u6210\u529F\uFF0C\u4F46\u670D\u52A1\u5668\u672A\u66B4\u9732\u4EFB\u4F55\u5DE5\u5177\u3002" })) : (_jsx(ToolsInspector, { tools: result.tools }))] }));
}
/** 服务器提示（`instructions`）：默认折叠 3 行，点「展开/收起」切换。 */
function McpInstruction({ text }) {
    const [expanded, setExpanded] = useState(false);
    return (_jsxs("div", { className: "skp-test-instruction", children: [_jsxs("div", { className: "skp-test-instruction-head", children: [_jsx("span", { className: "skp-field-label", children: "\u670D\u52A1\u5668\u63D0\u793A" }), _jsx("button", { type: "button", className: "skp-link-btn", onClick: () => setExpanded((value) => !value), children: expanded ? "收起" : "展开" })] }), _jsx("p", { className: expanded ? "skp-test-instruction-body" : "skp-test-instruction-body skp-clamp-3", children: text })] }));
}
/**
 * 使用记录的时间列：当天只显示 `HH:mm:ss`，跨天补上 `MM-DD `（避免不同日期的
 * 记录看起来一样）。时间来自宿主 `Date.now()`，客户端本地时区格式化。
 */
function formatUsageTime(time) {
    if (!Number.isFinite(time) || time <= 0)
        return "—";
    const date = new Date(time);
    const pad = (value) => String(value).padStart(2, "0");
    const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    const now = new Date();
    const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
    return sameDay ? clock : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock}`;
}
// ---------------------------------------------------------------------------
// 添加弹窗（表单 / JSON）
// ---------------------------------------------------------------------------
/**
 * 添加 MCP 服务器弹窗：与技能安装弹窗同构（Modal + 模式 Tab）。
 *
 * - 表单：沿用 McpForm（embedded 内嵌）逐字段填写单个条目；
 * - JSON：粘贴 .mcp.json 或裸服务器映射，实时预览后批量添加。
 */
function McpAddDialog({ api, servers, scope, workspace, projectName, onClose, onMutated, }) {
    const [tab, setTab] = useState("form");
    const isGlobal = scope === "global";
    const title = isGlobal ? "添加 MCP 到全局" : `添加 MCP 到工作区 ${projectName ?? "工作区"}`;
    const targetPath = isGlobal ? "~/.agents/mcp.json" : `${workspace ?? "<工作区>"}/.mcp.json`;
    return (_jsxs(Modal, { title: title, onClose: onClose, children: [_jsxs("div", { className: "skp-landing", children: [_jsxs("div", { className: "skp-landing-head", children: [_jsx("span", { className: "skp-landing-icon", "aria-hidden": "true", children: "\u2316" }), _jsx("span", { className: "skp-field-label", children: "\u843D\u70B9" }), _jsx("span", { className: isGlobal ? "skp-tag skp-tag-global" : "skp-tag skp-tag-project", children: isGlobal ? "全局" : `工作区 ${projectName ?? "工作区"}` }), _jsx("span", { className: "skp-landing-note", children: "\u4EC5\u6B64\u4F5C\u7528\u57DF\u751F\u6548 \u00B7 \u4E0E\u5F53\u524D\u5BF9\u8BDD\u65E0\u5173" }), _jsx("span", { className: "skp-detail-head-spacer" }), _jsx("span", { className: "skp-landing-hint", children: "\u8981\u6362\u843D\u70B9\uFF1F\u5148\u5207\u6362\u9876\u90E8\u4F5C\u7528\u57DF" })] }), _jsx("code", { className: "skp-landing-path", title: targetPath, children: targetPath })] }), _jsx("div", { className: "skp-tabs", role: "tablist", children: ["form", "json"].map((t) => (_jsx("button", { role: "tab", "aria-selected": tab === t, className: tab === t ? "skp-tab skp-tab-active" : "skp-tab", onClick: () => setTab(t), children: t === "form" ? "表单" : "JSON 粘贴" }, t))) }), _jsx("div", { hidden: tab !== "form", children: _jsx(McpForm, { api: api, mode: "new", workspace: workspace, embedded: true, actionsClass: "skp-modal-actions", fixedScope: scope, onCancel: onClose, onSave: async (savedScope, key, entry) => {
                        const result = await api.upsert({ scope: savedScope, key, entry });
                        if (!result.ok)
                            throw new Error(result.errors.join("; "));
                        onMutated();
                        onClose();
                    } }) }), _jsx("div", { hidden: tab !== "json", children: _jsx(McpJsonImport, { api: api, servers: servers, scope: scope, onClose: onClose, onMutated: onMutated }) })] }));
}
/**
 * 编辑 MCP 服务器弹窗：与新增同款外壳（Modal + 内嵌 McpForm）。
 * 只含表单（JSON 批量导入只属于新增场景）；scope 与 name 在编辑态锁定
 * （改名 = 删除后重建，沿用 McpForm 的禁用态规避）。
 */
function McpEditDialog({ api, server, workspace, onClose, onSaved, }) {
    return (_jsx(Modal, { title: `编辑 ${server.key}`, onClose: onClose, children: _jsx(McpForm, { api: api, mode: "edit", server: server, workspace: workspace, embedded: true, actionsClass: "skp-modal-actions", onCancel: onClose, onSave: async (scope, key, entry) => {
                const result = await api.upsert({ scope, key, entry });
                if (!result.ok)
                    throw new Error(result.errors.join("; "));
                onSaved();
                onClose();
            } }) }));
}
/**
 * 解析"添加 MCP 服务器"的 JSON 文本为条目清单。
 *
 * 接受两种形状：
 *   - 完整配置文件：`{ "mcpServers": { … } }`（可直接粘贴 .mcp.json）；
 *   - 裸映射：`{ "github": { … }, "web": { … } }`。
 * 顶层必须是对象；逐条用与宿主同口径的 validateEntry 校验
 * （见 mcp/entry-util.ts），任一非法条目都会整体返回错误与逐条原因。
 */
function parseMcpJson(text) {
    let data;
    try {
        data = JSON.parse(text);
    }
    catch (error) {
        return { ok: false, errors: [`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`] };
    }
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
        return { ok: false, errors: ['JSON 顶层必须是对象，例如 { "mcpServers": { … } } 或 { "服务器名": { … } }'] };
    }
    const root = data;
    // 裸映射的每个值都不是对象 → 更像"单条条目缺名称键"，给出明确提示。
    if (Object.keys(root).length > 0 && Object.values(root).every((v) => v === null || typeof v !== "object" || Array.isArray(v))) {
        return { ok: false, errors: ['看起来是单条服务器条目，缺少名称键；请用 { "服务器名": { … } } 包裹。'] };
    }
    // 完整配置文件取 mcpServers 键；否则把顶层本身当服务器映射。
    let servers;
    if (typeof root.mcpServers === "object" && root.mcpServers !== null && !Array.isArray(root.mcpServers)) {
        servers = root.mcpServers;
    }
    else if ("mcpServers" in root && Object.keys(root).length === 1) {
        return { ok: false, errors: ['「mcpServers」必须是服务器对象映射。'] };
    }
    else {
        servers = root;
    }
    const entries = [];
    const problems = [];
    for (const [key, value] of Object.entries(servers)) {
        if (value === null || typeof value !== "object" || Array.isArray(value)) {
            problems.push(`${key}: 条目必须是对象`);
            continue;
        }
        const entry = value;
        const entryProblems = validateEntry(key, entry);
        if (entryProblems.length > 0) {
            problems.push(`${key}: ${entryProblems.join("; ")}`);
            continue;
        }
        entries.push({ key, entry });
    }
    if (problems.length > 0)
        return { ok: false, errors: problems };
    if (entries.length === 0)
        return { ok: false, errors: ["没有可添加的服务器条目。"] };
    return { ok: true, entries };
}
/** JSON 文本框占位示例（两种形状都能贴）。 */
const JSON_PLACEHOLDER = `{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "\${GITHUB_TOKEN}" }
    },
    "web": { "type": "http", "url": "http://localhost:3000/mcp" }
  }
}`;
/**
 * JSON 批量添加面板：粘贴 .mcp.json 或裸服务器映射，实时解析并预览
 * （新增 / 覆盖 / 跳过与逐条错误），确认后逐条写入。
 *
 * 逐条**串行** upsert：并发读写同一配置文件会互相覆盖（读-改-写竞态），
 * 串行保证每次写入都基于最新文件内容。
 */
function McpJsonImport({ api, servers, scope, onClose, onMutated, }) {
    const [text, setText] = useState("");
    const [overwrite, setOverwrite] = useState(false);
    const [busy, setBusy] = useState(false);
    const [opErrors, setOpErrors] = useState([]);
    // 实时解析：文本一变预览区就刷新（整体非法时展示解析错误）。
    const parse = useMemo(() => parseMcpJson(text), [text]);
    // 预览行：标注每条的状态（将新增 / 将覆盖 / 已存在跳过），供确认与冲突提示。
    const preview = useMemo(() => {
        if (!parse.ok)
            return undefined;
        return parse.entries.map(({ key, entry }) => {
            const exists = servers.some((s) => s.scope === scope && s.key === key);
            return { key, entry, exists, overwriting: exists && overwrite, skipped: exists && !overwrite };
        });
    }, [parse, servers, scope, overwrite]);
    const addable = preview?.filter((item) => !item.skipped) ?? [];
    const doAdd = async () => {
        setBusy(true);
        setOpErrors([]);
        const failures = [];
        let added = 0;
        for (const { key, entry } of addable) {
            const result = await api.upsert({ scope, key, entry });
            if (result.ok)
                added += 1;
            else
                failures.push(`${key}: ${result.errors.join("; ")}`);
        }
        onMutated(); // 已写入的部分先刷新列表与冲突检测
        if (failures.length > 0) {
            setOpErrors([`已导入 ${added} 个，失败 ${failures.length} 个：`, ...failures]);
            setBusy(false);
            return;
        }
        onClose();
    };
    return (_jsxs("div", { className: "skp-form", children: [_jsxs("label", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "JSON \u914D\u7F6E" }), _jsx("textarea", { className: "skp-input skp-textarea skp-json-field", value: text, spellCheck: false, placeholder: JSON_PLACEHOLDER, onChange: (e) => {
                            setText(e.target.value);
                            setOpErrors([]);
                        } }), _jsxs("span", { className: "skp-note", children: ["\u652F\u6301\u5B8C\u6574 .mcp.json\uFF08\u542B mcpServers \u952E\uFF09\uFF0C\u6216\u76F4\u63A5\u7C98\u8D34 ", `{ "服务器名": { … } }`, " \u6620\u5C04\u3002"] })] }), !parse.ok && text.trim().length > 0 && _jsx("div", { className: "skp-error", children: parse.errors.join("\n") }), preview !== undefined && preview.length > 0 && (_jsxs("div", { className: "skp-field", children: [_jsxs("span", { className: "skp-field-label", children: ["\u5C06\u5BFC\u5165 ", addable.length, "/", preview.length, " \u4E2A\u670D\u52A1\u5668"] }), _jsx("ul", { className: "skp-import-list", children: preview.map(({ key, entry, overwriting, skipped }) => (_jsxs("li", { className: "skp-import-item", children: [_jsx("span", { className: "skp-import-name", children: key }), _jsx("span", { className: "skp-tag skp-tag-flat", children: transportOf(entry) }), _jsx("span", { className: "skp-import-desc", children: summarizeEntry(entry) }), _jsx("span", { className: `skp-import-note ${overwriting ? "skp-import-note-over" : skipped ? "skp-import-note-skip" : "skp-import-note-add"}`, children: overwriting ? "将覆盖" : skipped ? "已存在，跳过" : "将新增" })] }, key))) })] })), _jsxs("label", { className: "skp-field skp-field-inline", children: [_jsx("input", { type: "checkbox", checked: overwrite, onChange: (e) => setOverwrite(e.target.checked) }), "\u540C\u540D\u670D\u52A1\u5668\u5DF2\u5B58\u5728\u65F6\u8986\u76D6"] }), opErrors.length > 0 && _jsx("div", { className: "skp-error", children: opErrors.join("\n") }), _jsxs("div", { className: "skp-modal-actions", children: [_jsx("button", { type: "button", className: "skp-btn", onClick: onClose, children: "\u53D6\u6D88" }), _jsx("button", { type: "button", className: "skp-btn skp-btn-primary", disabled: busy || addable.length === 0, onClick: () => void doAdd(), children: busy ? "导入中…" : `导入 ${addable.length} 个服务器` })] })] }));
}
// ---------------------------------------------------------------------------
// 文本帮助函数（KEY=VALUE 行 ⇄ 记录、一行一个 ⇄ 数组）
// ---------------------------------------------------------------------------
/** 记录 → 每行 `KEY=VALUE` 的文本（多行文本框回填用）。 */
function recordToLines(record) {
    return Object.entries(record ?? {})
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
}
/** 文本 → 记录；非法行（不以 `KEY=` 开头）记入 problems 并跳过。 */
function linesToRecord(text, field, problems) {
    const out = {};
    for (const rawLine of text.split("\n")) {
        const line = rawLine.trim();
        if (line.length === 0)
            continue;
        const eq = line.indexOf("=");
        if (eq <= 0) {
            problems.push(`${field}：行「${line}」不是 KEY=VALUE 格式`);
            continue;
        }
        out[line.slice(0, eq).trim()] = line.slice(eq + 1);
    }
    return out;
}
/** 文本 → 参数数组：按行拆分、trim、跳过空行。 */
function linesToArray(text) {
    return text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}
