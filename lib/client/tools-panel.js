import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * 能力面板 · Tools 域（v13 R3 / 帧 06）。
 *
 * Tools 是**全局工具注册**，没有项目 / 工作区维度（UX v1.8 §2.4 / §2.5）：
 * 因此本视图没有左导航、没有工作区列表，只有**两栏**：
 *   - 左：插件单元列表（一个插件 = 一个开关单元，`N 个工具`）；
 *   - 右：插件详情 + **只读**工具清单（手风琴；schema 由 `tools.inspect` 懒加载，
 *     可展开看参数表与原始 JSON）。
 *
 * 开关语义（**覆盖 v13 A5**）：能力面板 = **全局默认**（所有会话），
 * 会话首屏 /「能力」Tab = **本会话覆盖**（全局关闭时仍可在首屏单独开启）。
 * 因此本页：
 *   - 行 / 详情开关展示并写 `defaultEnabled`（`tools.setGlobalEnabled`），
 *     不需要 sessionId，也不显示任何具体会话状态；
 *   - 详情补一句「本会话可在对话首屏单独覆盖」，把两层关系说清。
 *
 * 契约：docs/architecture/v13-implementation.md §5.1 / §9.4 / 附录 A +
 * task-20 两层语义（`defaultEnabled` / `enabled`、`tools.setGlobalEnabled`）。
 *
 * @module dsh-capability-settings/client/tools-panel
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ToolParameterTable, toolParameters } from "./tool-schema.js";
/** 详情标题右侧标签行的排版（与 mcp-panel 的 HEAD_TAGS_STYLE 同形）。 */
const HEAD_TAGS_STYLE = { display: "inline-flex", alignItems: "center", gap: 6, flex: "none" };
/** 详情底部弱说明的上外边距。 */
const NOTE_STYLE = { margin: "10px 0 0" };
/**
 * 单元的**全局默认**开关：新宿主给 `defaultEnabled`；旧宿主/夹具只有单层
 * `enabledInSession` 时回落到它，再缺省按默认开启（与宿主 `TOOLS_DEFAULT_ENABLED` 一致）。
 */
function defaultEnabledOf(unit) {
    return unit.defaultEnabled ?? unit.enabledInSession ?? true;
}
/** 未识别单元的琥珀标签类（复用既有 warn 标签）。 */
function unitTagClass(unit) {
    return unit.kind === "unattributed" ? "skp-tag skp-tag-warn" : "skp-tag skp-tag-plugin";
}
/**
 * 单元排序：保持宿主枚举顺序（帧 06 的插件顺序来自运行时注册顺序），只把
 * 来源未识别恒排最后（UX v1.8 §5.4 的分组语义）。
 */
function sortUnits(units) {
    return [...units.filter((unit) => unit.kind !== "unattributed"), ...units.filter((unit) => unit.kind === "unattributed")];
}
/** 归属依据的人话标签（task-32：运行时/包扫描/人工映射/名字推测/命名空间/未识别）。 */
function attributionLabel(unit) {
    switch (unit.attribution.matchedBy) {
        case "runtime":
            return "运行时捕获";
        case "literal":
            return "包扫描";
        case "table":
        case "prefix":
        case "exact":
            return "人工映射";
        case "similarity":
            return "名字推测";
        case "namespace":
            return "命名空间";
        default:
            return "未识别";
    }
}
/** true = 来源含推测成分（UI 加琥珀「推测」标识与核对提示）。 */
function attributionIsSpeculative(unit) {
    const attribution = unit.attribution;
    // 「运行时捕获」分两档：调用方身份（高置信）与注册栈兜底（中置信，标推测）。
    const runtimeFallback = attribution.matchedBy === "runtime" && attribution.confidence === "medium";
    return (attribution.matchedBy === "similarity" ||
        runtimeFallback ||
        attribution.ambiguous === true ||
        attribution.conflictsWithTable === true);
}
/** 详情「来源判定」的补充说明（依据原文 / 冲突 / 置信度 / 多来源合并）。 */
function attributionDetail(unit) {
    const attribution = unit.attribution;
    const parts = [];
    const pattern = attribution.pattern ?? attribution.packageName;
    if (attribution.matchedBy === "prefix" && pattern !== undefined)
        parts.push(`前缀 ${pattern} → ${unit.name}（插件清单映射表）`);
    else if (attribution.matchedBy === "exact" && pattern !== undefined)
        parts.push(`精确匹配 ${pattern} → ${unit.name}（插件清单映射表）`);
    else if (pattern !== undefined && pattern !== unit.name)
        parts.push(pattern);
    if (attribution.conflictsWithTable === true)
        parts.push("与人工映射冲突");
    if (attribution.ambiguous === true)
        parts.push("存在多个候选");
    if (attribution.mixed === true)
        parts.push("多来源合并");
    if (attribution.matchedBy === "runtime" && attribution.confidence === "medium")
        parts.push("注册栈兜底");
    const confidence = attribution.confidence;
    if (typeof confidence === "number" && Number.isFinite(confidence)) {
        // 旧数字口径：0–1 → 百分比（adapter 已归一到 0–1）。
        parts.push(`置信度 ${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`);
    }
    else if (confidence === "high") {
        parts.push("高置信");
    }
    else if (confidence === "medium") {
        parts.push("中置信");
    }
    else if (confidence === "low") {
        parts.push("低置信");
    }
    return parts.length > 0 ? parts.join(" · ") : undefined;
}
/**
 * 一个工具的手风琴行：行 = 工具名 + `N 个参数/无参数`；展开后显示说明、
 * 参数表（参数/类型/必填/说明）与可折叠的原始 JSON（`parameters` pretty）。
 */
function ToolAccordionItem({ tool, open, onToggle }) {
    const [rawOpen, setRawOpen] = useState(false);
    const parameters = useMemo(() => toolParameters(tool.parameters), [tool.parameters]);
    const description = tool.description?.trim() ?? "";
    return (_jsxs("div", { className: open ? "skp-tool-item skp-tool-item-open" : "skp-tool-item", role: "listitem", children: [_jsxs("button", { type: "button", className: "skp-tool-trigger", "aria-expanded": open, title: tool.name, onClick: onToggle, children: [_jsx("span", { className: "skp-tool-chevron", "aria-hidden": "true", children: open ? "▾" : "▸" }), _jsx("code", { className: "skp-tool-name", children: tool.name }), _jsx("span", { className: "skp-tool-count", children: parameters.length > 0 ? `${parameters.length} 个参数` : "无参数" })] }), open && (_jsxs("div", { className: "skp-tool-body", children: [description.length > 0 && _jsx("p", { className: "skp-tool-desc", children: description }), _jsx(ToolParameterTable, { parameters: parameters }), _jsxs("div", { className: "skp-tools-raw", children: [_jsx("button", { type: "button", className: "skp-link-btn", "aria-expanded": rawOpen, onClick: () => setRawOpen((value) => !value), children: rawOpen ? "收起原始 JSON" : "查看原始 JSON" }), rawOpen && _jsx("pre", { className: "skp-tools-raw-json", children: JSON.stringify(tool.parameters ?? {}, null, 2) })] })] }))] }));
}
/**
 * Tools 域视图：两栏（插件列表 + 详情/只读工具清单），无左导航。
 *
 * @param query 根组件头部搜索框的值（按插件名 / 工具名 / 工具说明本地过滤）。
 * @param workspace 当前工作区（只作为重新拉取的信号：工作区/会话切换时刷新列表）。
 */
export function ToolsView({ api, query, workspace, onCount, }) {
    const [data, setData] = useState(undefined);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(undefined);
    const [version, setVersion] = useState(0);
    const [selectedUnit, setSelectedUnit] = useState(undefined);
    const [busyUnit, setBusyUnit] = useState(undefined);
    const [opError, setOpError] = useState(undefined);
    const [copied, setCopied] = useState(false);
    /** `tools.inspect` 结果缓存（按 unit；选中时才拉，刷新列表不复用过期数据）。 */
    const [inspectCache, setInspectCache] = useState({});
    /** 手风琴当前展开的工具（同一时间只展开一个）。 */
    const [expandedTool, setExpandedTool] = useState(undefined);
    const mountedRef = useRef(true);
    const rowRefs = useRef(new Map());
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(undefined);
        // 主面板只看/写全局默认：不传 sessionId（全局态与会话无关）。
        void api.tools
            .list()
            .then((view) => {
            if (cancelled)
                return;
            setData(view);
        })
            .catch((failure) => {
            if (cancelled)
                return;
            setError(String(failure instanceof Error ? failure.message : failure));
        })
            .finally(() => {
            if (!cancelled)
                setLoading(false);
        });
        return () => {
            cancelled = true;
        };
    }, [api, workspace, version]);
    const units = useMemo(() => sortUnits(data?.units ?? []), [data]);
    // 计数回填（搜索不影响计数）；加载中不覆盖。
    useEffect(() => {
        if (!loading && error === undefined)
            onCount?.(units.length);
    }, [units.length, loading, error, onCount]);
    // 首次到达 / 当前选中消失时选中第一项（帧 06 默认展开详情）。
    useEffect(() => {
        if (units.length === 0) {
            if (selectedUnit !== undefined)
                setSelectedUnit(undefined);
            return;
        }
        if (selectedUnit !== undefined && units.some((unit) => unit.unit === selectedUnit))
            return;
        setSelectedUnit(units[0]?.unit);
    }, [units, selectedUnit]);
    const q = query.trim().toLowerCase();
    const visible = useMemo(() => units.filter((unit) => {
        if (q === "")
            return true;
        if (unit.name.toLowerCase().includes(q))
            return true;
        return unit.tools.some((tool) => tool.name.toLowerCase().includes(q) || (tool.description ?? "").toLowerCase().includes(q));
    }), [units, q]);
    const selected = units.find((unit) => unit.unit === selectedUnit);
    /** true = 宿主仍在解析归属：显示轻量提示，不阻塞开关。 */
    const attributionSettling = data?.attributionSettling === true;
    // 选中单元时懒加载工具 schema（按 unit 缓存）：失败/旧宿主降级为 list 的 name+description。
    const inspectState = selectedUnit === undefined ? undefined : inspectCache[selectedUnit];
    useEffect(() => {
        if (selectedUnit === undefined)
            return;
        if (inspectCache[selectedUnit] !== undefined)
            return;
        setInspectCache((prev) => (prev[selectedUnit] !== undefined ? prev : { ...prev, [selectedUnit]: { status: "loading" } }));
        void api.tools
            .inspect({ unit: selectedUnit })
            .then((view) => {
            if (!mountedRef.current)
                return;
            setInspectCache((prev) => ({ ...prev, [selectedUnit]: { status: "ready", tools: view.tools } }));
        })
            .catch((failure) => {
            if (!mountedRef.current)
                return;
            setInspectCache((prev) => ({
                ...prev,
                [selectedUnit]: { status: "error", message: String(failure instanceof Error ? failure.message : failure) },
            }));
        });
    }, [api, selectedUnit, inspectCache]);
    // 切换插件时收起展开的工具（避免沿用上一个插件的工具名）。
    useEffect(() => {
        setExpandedTool(undefined);
    }, [selectedUnit]);
    const inspectedTools = inspectState?.status === "ready" ? inspectState.tools : undefined;
    const inspectLoading = inspectState?.status === "loading";
    const inspectError = inspectState?.status === "error" ? inspectState.message : undefined;
    // inspect 未就绪时退回 `tools.list` 的轻量清单（仅名称 + 说明），保证列表不空。
    const displayTools = inspectedTools ??
        (selected?.tools ?? []).map((tool) => ({
            name: tool.name,
            ...(tool.description !== undefined ? { description: tool.description } : {}),
        }));
    /**
     * 写**全局默认**开关（能力面板语义）：不需要 sessionId，也不碰任何会话覆盖。
     * 全局关闭后，单个会话仍可在对话首屏单独开启。
     */
    const toggleDefault = useCallback(async (unit, next) => {
        if (unit.lockedReason !== undefined || busyUnit !== undefined)
            return;
        setBusyUnit(unit.unit);
        setOpError(undefined);
        try {
            await api.tools.setGlobalEnabled({ units: [unit.unit], enabled: next });
        }
        catch (failure) {
            setOpError(String(failure instanceof Error ? failure.message : failure));
        }
        finally {
            if (mountedRef.current)
                setBusyUnit(undefined);
            setVersion((value) => value + 1);
        }
    }, [api, busyUnit]);
    const copyName = async (name) => {
        try {
            await navigator.clipboard?.writeText(name);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        }
        catch {
            /* 剪贴板不可用时静默 */
        }
    };
    const focusRow = (unit) => {
        const element = rowRefs.current.get(unit);
        element?.focus();
        element?.scrollIntoView({ block: "nearest" });
    };
    const onRowKeyDown = (event, unit) => {
        if (visible.length === 0)
            return;
        const index = visible.findIndex((item) => item.unit === unit);
        if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
            event.preventDefault();
            const next = event.key === "Home"
                ? 0
                : event.key === "End"
                    ? visible.length - 1
                    : event.key === "ArrowDown"
                        ? Math.min(visible.length - 1, index + 1)
                        : Math.max(0, index - 1);
            const nextUnit = visible[next]?.unit;
            if (nextUnit !== undefined) {
                setSelectedUnit(nextUnit);
                requestAnimationFrame(() => focusRow(nextUnit));
            }
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            setSelectedUnit(unit);
        }
    };
    const listErrors = data?.errors ?? [];
    return (_jsxs("div", { className: "skp-domain", children: [opError !== undefined && _jsx("div", { className: "skp-error", children: opError }), error !== undefined && _jsxs("div", { className: "skp-error", children: ["\u8BFB\u53D6\u5931\u8D25\uFF1A", error] }), error === undefined && listErrors.length > 0 && _jsx("div", { className: "skp-error", children: listErrors.join("\n") }), loading && data === undefined && _jsx("div", { className: "skp-status", children: "\u52A0\u8F7D\u4E2D\u2026" }), data !== undefined && error === undefined && (_jsxs("div", { className: "skp-body skp-tools-body", children: [_jsxs("div", { className: "skp-workspace-pane skp-tools-pane", children: [_jsxs("div", { className: "skp-pane-title", children: [_jsx("span", { className: "skp-pane-title-text", children: "Tools" }), _jsx("span", { className: "skp-group-count", children: units.length }), _jsxs("span", { className: "skp-pane-title-note", children: ["\u00B7 ", units.filter((unit) => defaultEnabledOf(unit)).length, " \u9ED8\u8BA4\u542F\u7528 \u00B7 \u63D2\u4EF6\u7EA7\u5F00\u5173\uFF08\u6574\u63D2\u4EF6\u751F\u6548\uFF09"] })] }), attributionSettling && _jsx("div", { className: "skp-pane-note", children: "\u6765\u6E90\u89E3\u6790\u4E2D\u2026" }), units.length === 0 ? (_jsx("div", { className: "skp-empty", children: listErrors.length > 0 ? "当前外壳未提供工具注册表，无法列出 Tools。" : "尚未发现 Tools。" })) : visible.length === 0 ? (_jsxs("div", { className: "skp-empty", children: ["\u6CA1\u6709\u5339\u914D\u300C", query.trim(), "\u300D\u7684 Tools\u3002"] })) : (_jsx("div", { className: "skp-group-scroll", children: _jsx("ul", { className: "skp-list", role: "listbox", "aria-label": "Tools", children: visible.map((unit) => {
                                        const active = unit.unit === selectedUnit;
                                        const locked = unit.lockedReason !== undefined;
                                        return (_jsxs("li", { className: active ? "skp-row-wrap skp-row-wrap-active" : "skp-row-wrap", children: [_jsxs("button", { type: "button", role: "option", "aria-selected": active, tabIndex: active ? 0 : -1, className: active ? "skp-row skp-row-active" : "skp-row", ref: (element) => {
                                                        if (element === null)
                                                            rowRefs.current.delete(unit.unit);
                                                        else
                                                            rowRefs.current.set(unit.unit, element);
                                                    }, onClick: () => setSelectedUnit(unit.unit), onKeyDown: (event) => onRowKeyDown(event, unit.unit), children: [_jsxs("span", { className: "skp-row-name", children: [_jsx("span", { className: defaultEnabledOf(unit) ? "skp-dot skp-dot-enabled" : "skp-dot skp-dot-hollow", "aria-hidden": "true" }), _jsx("span", { className: "skp-sr-only", children: defaultEnabledOf(unit) ? "默认已启用" : "默认已关闭" }), _jsx("span", { className: "skp-row-title", title: unit.name, children: unit.name })] }), _jsxs("span", { className: "skp-row-meta", children: [_jsx("span", { className: unitTagClass(unit), title: unit.kind === "unattributed" ? "来源未识别：不是宿主内置工具" : "插件运行时注册（非 MCP）", children: unit.kind === "unattributed" ? "未识别" : "插件" }), _jsxs("span", { className: "skp-tag skp-tag-flat", children: [unit.toolCount, " \u4E2A\u5DE5\u5177"] })] })] }), _jsxs("label", { className: "skp-row-toggle", title: locked
                                                        ? (unit.lockedReason ?? "该插件无法开关")
                                                        : defaultEnabledOf(unit)
                                                            ? "关闭：关闭后所有会话默认不可用；单个会话仍可在对话首屏单独开启"
                                                            : "开启：所有会话默认可用（单个会话可在对话首屏单独关闭）", children: [_jsx("span", { className: "skp-row-default-label", children: "\u9ED8\u8BA4" }), _jsxs("span", { className: "skp-switch", children: [_jsx("input", { type: "checkbox", role: "switch", "aria-label": `默认启用 ${unit.name}`, checked: defaultEnabledOf(unit), disabled: locked || busyUnit === unit.unit, onChange: (event) => void toggleDefault(unit, event.target.checked) }), _jsx("span", { className: "skp-switch-track" })] })] })] }, unit.unit));
                                    }) }) }))] }), _jsx("div", { className: "skp-detail skp-detail-fixed", children: selected === undefined ? (_jsx("div", { className: "skp-detail-empty", children: "\u9009\u62E9\u4E00\u4E2A\u63D2\u4EF6\u67E5\u770B\u5DE5\u5177\u6E05\u5355\u4E0E\u53C2\u6570\u3002" })) : (_jsxs("div", { className: "skp-detail-card", children: [_jsxs("div", { className: "skp-detail-head", children: [_jsx("h3", { title: selected.name, children: selected.name }), _jsxs("span", { style: HEAD_TAGS_STYLE, children: [_jsx("span", { className: selected.kind === "unattributed" ? "skp-tag skp-tag-warn" : "skp-tag skp-tag-plugin", children: selected.kind === "unattributed" ? "未识别" : "插件" }), _jsx("span", { className: "skp-tag skp-tag-channel", title: selected.attribution.packageName ?? selected.name, children: selected.name })] }), _jsx("span", { className: "skp-detail-head-spacer" }), _jsx("button", { type: "button", className: "skp-btn", onClick: () => void copyName(selected.name), children: copied ? "已复制" : "复制插件名" })] }), _jsxs("div", { className: "skp-detail-meta", children: [_jsxs("span", { className: "skp-detail-meta-item", children: [_jsx("span", { className: "skp-detail-meta-strong", children: "\u6765\u6E90\u5224\u5B9A\uFF1A" }), attributionLabel(selected), attributionDetail(selected) !== undefined ? ` · ${attributionDetail(selected) ?? ""}` : ""] }), attributionIsSpeculative(selected) && (_jsx("span", { className: "skp-tag skp-tag-warn", title: "\u6765\u6E90\u4E3A\u63A8\u6D4B\uFF0C\u8BF7\u6838\u5BF9\u5DE5\u5177\u6E05\u5355", children: "\u63A8\u6D4B" })), (selected.attribution.legacyUnit === true || typeof selected.attribution.legacyUnit === "string") && (_jsx("span", { className: "skp-note", title: typeof selected.attribution.legacyUnit === "string"
                                                ? `旧版键：${selected.attribution.legacyUnit}`
                                                : "旧版持久化键已迁移到新的插件单元", children: "\u65E7\u7248\u952E\u5DF2\u8FC1\u79FB" })), attributionSettling && _jsx("span", { className: "skp-note", children: "\u6765\u6E90\u89E3\u6790\u4E2D\u2026" }), _jsxs("span", { className: "skp-detail-meta-item", children: [_jsx("span", { className: "skp-detail-meta-strong", children: "\u6CE8\u5165\u65B9\u5F0F\uFF1A" }), "\u63D2\u4EF6\u8FD0\u884C\u65F6\u6CE8\u518C\u7684\u975E MCP \u5DE5\u5177\uFF08\u4E0D\u843D\u76D8\uFF09"] })] }), attributionIsSpeculative(selected) && (_jsx("p", { className: "skp-note skp-note-warn", children: "\u6765\u6E90\u4E3A\u63A8\u6D4B\uFF0C\u8BF7\u6838\u5BF9\u5DE5\u5177\u6E05\u5355" })), _jsxs("div", { className: "skp-note", children: ["\u5DE5\u5177\u6570 ", selected.toolCount, " \u00B7 \u5F00\u5173\u4E3A\u63D2\u4EF6\u7EA7\uFF1A\u5173\u95ED\u540E\u8BE5\u63D2\u4EF6\u5168\u90E8\u5DE5\u5177\u5728\u6240\u6709\u4F1A\u8BDD\u9ED8\u8BA4\u4E0D\u53EF\u89C1\uFF08\u4E0D\u6539\u5DF2\u6709\u4F1A\u8BDD\u7684\u663E\u5F0F\u8986\u76D6\uFF09"] }), _jsxs("div", { className: "skp-detail-inspect", children: [_jsxs("div", { className: "skp-detail-inspect-head", children: [_jsxs("span", { className: "skp-field-label", children: ["\u5DE5\u5177\u6E05\u5355\uFF08", selected.toolCount, "\uFF09"] }), _jsx("span", { className: "skp-test-stat", children: inspectLoading ? "正在读取参数…" : "点击工具查看参数与原始 JSON" })] }), inspectError !== undefined && (_jsxs("div", { className: "skp-note", children: ["\u53C2\u6570\u4E0D\u53EF\u7528\uFF1A", inspectError, "\uFF08\u4ECD\u53EF\u67E5\u770B\u5DE5\u5177\u540D\u79F0\u4E0E\u8BF4\u660E\uFF09"] })), displayTools.length === 0 ? (_jsx("div", { className: "skp-note", children: "\u5DE5\u5177\u6E05\u5355\u4E0D\u53EF\u89C1\uFF08\u8BE5\u5355\u5143\u5F53\u524D\u6CA1\u6709\u53EF\u89C1\u5DE5\u5177\uFF09\u3002" })) : (_jsx("div", { className: "skp-tool-accordion", role: "list", children: displayTools.map((tool) => (_jsx(ToolAccordionItem, { tool: tool, open: expandedTool === tool.name, onToggle: () => setExpandedTool(expandedTool === tool.name ? undefined : tool.name) }, tool.name))) }))] }), _jsx("p", { className: "skp-note", style: NOTE_STYLE, children: "\u63D2\u4EF6\u7EA7\u5F00\u5173\uFF0C\u4E0D\u63D0\u4F9B\u5355\u5DE5\u5177\u5F00\u5173\uFF1B\u65E0\u6CD5 restrict \u7684\u63D2\u4EF6\u5F00\u5173\u7F6E\u7070\u5E76\u8BF4\u660E\u539F\u56E0\uFF1B\u5BBF\u4E3B\u5185\u5EFA\u57FA\u7840\u5DE5\u5177\u4E0D\u8FDB\u5165\u672C\u57DF\u3002" })] })) })] }))] }));
}
