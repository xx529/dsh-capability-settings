import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * 能力面板 · Tools 域（v13 R3 / 帧 06；v21 纳入可见性与工作区默认）。
 *
 * Tools 是**全局工具注册**：一个插件 = 一个开关单元，无单工具开关。两栏布局：
 *   - 左：插件单元列表；
 *   - 右：插件详情 + 只读工具清单（手风琴；schema 由 `tools.inspect` 懒加载）。
 *
 * 三层开关（v21，与 Skills / MCP 同构）：
 *   1. **可见性（全局唯一控制，按工作区）**：全局视图行内标签 + 「可见范围」编辑
 *      （`overrides.globalGet().visibility.tools` / `overrides.setVisibility`）；
 *   2. **每工作区默认开/关**：可见性弹层里按工作区配置；某工作区没有单独配置时
 *      走兜底 `!全局默认关闭(unit)`（`capability-global-overrides.json` 的 `tools`
 *      ∪ legacy `tools-global.json`，宿主已合并进行字段 `defaultEnabled`）；
 *   3. **工作区覆盖**：工作区视图的行尾开关写项目三态
 *      （`overrides.toggle("tools", unit, {enabled})` → `tools` / `enabledTools`）。
 *
 * 全局视图的行尾开关仍是**全局默认兜底**（`tools.setGlobalEnabled`，写统一全局文件）；
 * 不可见行的默认开关禁用并标「不可见 · 不参与默认」。
 *
 * @module dsh-capability-settings/client/tools-panel
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ToolParameterTable, toolParameters } from "./tool-schema.js";
import { useAsyncList } from "./panel-common.js";
import { EMPTY_VISIBILITY_SETS, VisibilityDetailFields, VisibilityRowMeta, isRowInvisible, safeGlobalGet, safeOverridesGet, visibilityEntryOf, visibilityModeOf, visibleWorkspaceCountOf, workspaceDefaultOf, workspaceOverrideOf, } from "./visibility.js";
import { HOST_INJECTED_LABEL, HOST_INJECTED_REASON } from "../shared/host-injected.js";
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
    if (unit.hostInjected === true)
        return "skp-tag skp-tag-host";
    return unit.kind === "unattributed" ? "skp-tag skp-tag-warn" : "skp-tag skp-tag-plugin";
}
/** 单元来源标签文案（宿主 / 插件 / 未识别）。 */
function unitTagLabel(unit) {
    if (unit.hostInjected === true)
        return HOST_INJECTED_LABEL;
    return unit.kind === "unattributed" ? "未识别" : "插件";
}
/**
 * 单元排序：宿主单元恒排最前（运行基线），其余保持宿主枚举顺序（帧 06 的
 * 插件顺序来自运行时注册顺序），来源未识别恒排最后（UX v1.8 §5.4）。
 */
function sortUnits(units) {
    return [
        ...units.filter((unit) => unit.hostInjected === true),
        ...units.filter((unit) => unit.hostInjected !== true && unit.kind !== "unattributed"),
        ...units.filter((unit) => unit.hostInjected !== true && unit.kind === "unattributed"),
    ];
}
/** 路径最后一段（工作区名）；空串/纯分隔符回退为原串。 */
function baseName(path) {
    const trimmed = path.replace(/[\\/]+$/, "");
    const at = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
    return at >= 0 ? trimmed.slice(at + 1) || trimmed : trimmed || path;
}
/** 归属依据的人话标签（task-32：运行时/包扫描/人工映射/名字推测/命名空间/未识别）。 */
function attributionLabel(unit) {
    switch (unit.attribution.matchedBy) {
        case "builtin":
            return "宿主内建";
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
    // 宿主注入由包扫描/运行时身份命中：不展示「推测」标识。
    if (unit.hostInjected === true)
        return false;
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
 * Tools 列表单行（v21.3，`React.memo`）：避免切作用域 / 选中 / 刷新提示时整表重渲。
 * 行状态（checked/disabled/invisible/override）由父级计算后以原始值传入。
 */
const ToolListRow = memo(function ToolListRow({ unit, active, scope, projectName, projects, visibilityEntry, globalOff, checked, disabled, invisible, override, busy, rowRefs, onSelect, onToggle, onKeyDown, }) {
    const locked = unit.lockedReason !== undefined;
    const visibilityMeta = scope === "global" && unit.hostInjected !== true ? (_jsx(VisibilityRowMeta, { entry: visibilityEntry, workspaces: projects, globalOff: globalOff, mode: unit.visibilityMode ?? visibilityModeOf(visibilityEntry), count: unit.visibleWorkspaceCount ?? visibleWorkspaceCountOf(visibilityEntry, projects), invisible: invisible, summaryClassName: "skp-vis-summary" })) : (override !== "inherit" && (_jsx("span", { className: "skp-tag skp-tag-warn", title: override === "on" ? "本工作区显式打开（覆盖全局的每工作区默认）" : "本工作区显式关闭（覆盖全局的每工作区默认）", children: "\u5DF2\u8986\u76D6" })));
    const switchLabel = invisible
        ? "不可见 · 不参与默认"
        : scope === "global"
            ? "全局默认"
            : `默认 · ${override === "inherit" ? "跟随全局" : "已覆盖"}`;
    const switchTitle = invisible
        ? "该单元对所有工作区都不可见：不参与默认开关；先在「可见范围」里打开可见性"
        : locked
            ? (unit.lockedReason ?? "该插件无法开关")
            : scope === "global"
                ? defaultEnabledOf(unit)
                    ? "关闭：关闭后全局默认不可用；仍可在对话首屏为单个对话单独开启"
                    : "开启：全局默认可用（仍可在对话首屏为单个对话单独关闭）"
                : checked
                    ? "关闭：仅此工作区默认不启用（写工作区覆盖，其它工作区不受影响）"
                    : "打开：仅此工作区默认启用（写工作区覆盖）";
    return (_jsxs("li", { className: active ? "skp-row-wrap skp-row-wrap-active" : "skp-row-wrap", children: [_jsxs("button", { type: "button", role: "option", "aria-selected": active, tabIndex: active ? 0 : -1, className: active ? "skp-row skp-row-active" : "skp-row", ref: (element) => {
                    if (element === null)
                        rowRefs.current.delete(unit.unit);
                    else
                        rowRefs.current.set(unit.unit, element);
                }, onClick: () => onSelect(unit), onKeyDown: (event) => onKeyDown(event, unit.unit), children: [_jsxs("span", { className: "skp-row-name", children: [_jsx("span", { className: checked ? "skp-dot skp-dot-enabled" : "skp-dot skp-dot-hollow", "aria-hidden": "true" }), _jsx("span", { className: "skp-sr-only", children: checked ? "默认已启用" : "默认已关闭" }), _jsx("span", { className: "skp-row-title", title: unit.name, children: unit.name })] }), _jsxs("span", { className: "skp-row-meta", children: [_jsx("span", { className: unitTagClass(unit), title: unit.hostInjected === true
                                    ? HOST_INJECTED_REASON
                                    : unit.kind === "unattributed"
                                        ? "来源未识别：不是宿主内置工具"
                                        : "插件运行时注册（非 MCP）", children: unitTagLabel(unit) }), _jsxs("span", { className: "skp-tag skp-tag-flat", children: [unit.toolCount, " \u4E2A\u5DE5\u5177"] }), visibilityMeta] })] }), scope === "workspace" && (_jsxs("label", { className: "skp-row-toggle", title: switchTitle, children: [_jsx("span", { className: "skp-row-default-label", children: switchLabel }), _jsxs("span", { className: "skp-switch", children: [_jsx("input", { type: "checkbox", role: "switch", "aria-label": `默认启用 ${unit.name}`, checked: checked, disabled: disabled || busy, onChange: (event) => onToggle(unit, event.target.checked) }), _jsx("span", { className: "skp-switch-track" })] })] }))] }));
});
/**
 * Tools 域视图：两栏（插件列表 + 详情/只读工具清单）。
 *
 * @param query 根组件头部搜索框的值（按插件名 / 工具名 / 工具说明本地过滤）。
 * @param workspace 当前工作区（undefined = 全局视图；v21 起有工作区维度）。
 * @param projects 全部已知工作区（可见性标签 / 弹层 / 每工作区默认用）。
 */
export function ToolsView({ api, workspace, projects = [], query, onCount, }) {
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
    const scope = workspace === undefined ? "global" : "workspace";
    const projectName = workspace === undefined ? undefined : (projects.find((project) => project.path === workspace)?.title ?? baseName(workspace));
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);
    // v21.3：与 Skills/MCP 同构的缓存列表——切回已访问作用域时同步出旧列表再刷新。
    const { data: fetched, loading, error, reload, } = useAsyncList(async () => {
        // 主面板只看/写全局默认（不传 sessionId）；cwd 由面板 api 的当前作用域决定。
        const [view, visibility, overrides] = await Promise.all([
            api.tools.list(),
            safeGlobalGet(api),
            scope === "workspace" ? safeOverridesGet(api) : Promise.resolve(undefined),
        ]);
        return { view, globalOverrides: visibility, projectOverrides: overrides };
    }, [api, version, scope, workspace], { cacheKey: `tools:${workspace ?? "global"}` });
    const data = fetched?.view;
    const globalOverrides = fetched?.globalOverrides;
    const projectOverrides = fetched?.projectOverrides;
    const visibilitySets = globalOverrides?.visibility ?? EMPTY_VISIBILITY_SETS;
    /** 某单元的可见性配置（skills/mcp/tools 同构；tools key = unit）。 */
    const visibilityOf = (unit) => visibilityEntryOf(visibilitySets, "tools", unit.unit);
    /** 兜底默认是否关闭：legacy `tools-global.json` 已并入行字段 defaultEnabled。 */
    const globalOffOf = (unit) => unit.hostInjected === true ? false : !defaultEnabledOf(unit) || globalOverrides?.tools.includes(unit.unit) === true;
    const units = useMemo(() => sortUnits(data?.units ?? []), [data]);
    /** 工作区视图只渲染可见单元（宿主已过滤；这里防御旧宿主 / 脏数据）。 */
    const visibleUnits = useMemo(() => (scope === "global" ? units : units.filter((unit) => unit.visibleInWorkspace !== false)), [units, scope]);
    /** 工作区视图被可见性隐藏的单元数（全局视图恒 0）。 */
    const hiddenCount = scope === "workspace" ? (data?.hiddenCount ?? 0) : 0;
    // 计数回填（搜索不影响计数）；加载中不覆盖。v21：全局口径（Tab 计数不随作用域变）。
    useEffect(() => {
        if (!loading && error === undefined)
            onCount?.(units.length);
    }, [units.length, loading, error, onCount]);
    // 首次到达 / 当前选中消失时选中第一项（帧 06 默认展开详情）。
    useEffect(() => {
        if (visibleUnits.length === 0) {
            if (selectedUnit !== undefined)
                setSelectedUnit(undefined);
            return;
        }
        if (selectedUnit !== undefined && visibleUnits.some((unit) => unit.unit === selectedUnit))
            return;
        setSelectedUnit(visibleUnits[0]?.unit);
    }, [visibleUnits, selectedUnit]);
    const q = query.trim().toLowerCase();
    const visible = useMemo(() => visibleUnits.filter((unit) => {
        if (q === "")
            return true;
        if (unit.name.toLowerCase().includes(q))
            return true;
        return unit.tools.some((tool) => tool.name.toLowerCase().includes(q) || (tool.description ?? "").toLowerCase().includes(q));
    }), [visibleUnits, q]);
    const selected = visibleUnits.find((unit) => unit.unit === selectedUnit);
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
    /** 当前行的开关勾选态与写路径（按作用域分派）。 */
    const switchStateOf = (unit) => {
        if (scope === "global") {
            const invisible = unit.hostInjected === true ? false : isRowInvisible(unit, visibilityOf(unit), projects);
            return { checked: defaultEnabledOf(unit), disabled: unit.lockedReason !== undefined || invisible, invisible };
        }
        const entry = visibilityOf(unit);
        const override = workspaceOverrideOf(projectOverrides, "tools", unit.unit);
        const fallback = workspace === undefined ? true : workspaceDefaultOf(entry, workspace, globalOffOf(unit));
        const checked = override === "on" ? true : override === "off" ? false : fallback;
        return { checked, disabled: unit.lockedReason !== undefined, invisible: false, override };
    };
    /**
     * 写开关：
     *   - 全局视图 → `tools.setGlobalEnabled`（全局兜底默认）；
     *   - 工作区视图 → `overrides.toggle("tools", unit, {enabled})`（项目三态覆盖）。
     */
    const toggleDefault = useCallback(async (unit, next) => {
        const state = switchStateOf(unit);
        if (state.disabled || busyUnit !== undefined)
            return;
        setBusyUnit(unit.unit);
        setOpError(undefined);
        try {
            if (scope === "global") {
                await api.tools.setGlobalEnabled({ units: [unit.unit], enabled: next });
            }
            else {
                const result = await api.overrides.toggle("tools", unit.unit, { enabled: next });
                if (!result.ok) {
                    setOpError(result.errors.join("; "));
                    return;
                }
            }
        }
        catch (failure) {
            setOpError(String(failure instanceof Error ? failure.message : failure));
        }
        finally {
            if (mountedRef.current)
                setBusyUnit(undefined);
            setVersion((value) => value + 1);
        }
    }, 
    // switchStateOf 依赖 scope / overrides / projects；重建闭包由这些值驱动。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, busyUnit, scope, projectOverrides, globalOverrides, projects]);
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
    /** v21.3：稳定回调（配合 `ToolListRow` memo，避免切作用域全量重渲）。 */
    const rowActionsRef = useRef({ setSelectedUnit, toggleDefault, onRowKeyDown });
    rowActionsRef.current = { setSelectedUnit, toggleDefault, onRowKeyDown };
    const stableSelectUnit = useCallback((unit) => rowActionsRef.current.setSelectedUnit(unit.unit), []);
    const stableToggleUnit = useCallback((unit, next) => {
        void rowActionsRef.current.toggleDefault(unit, next);
    }, []);
    const stableRowKeyDown = useCallback((event, unit) => rowActionsRef.current.onRowKeyDown(event, unit), []);
    const listTitle = scope === "global" ? "全局 Tools" : `${projectName ?? "工作区"} · Tools`;
    const listNote = scope === "global" ? "所有工作区" : "仅此工作区";
    const defaultOnCount = visibleUnits.filter((unit) => defaultEnabledOf(unit)).length;
    return (_jsxs("div", { className: "skp-domain", children: [opError !== undefined && _jsx("div", { className: "skp-error", children: opError }), error !== undefined && _jsxs("div", { className: "skp-error", children: ["\u8BFB\u53D6\u5931\u8D25\uFF1A", error] }), error === undefined && listErrors.length > 0 && _jsx("div", { className: "skp-error", children: listErrors.join("\n") }), loading && data === undefined && _jsx("div", { className: "skp-status", children: "\u52A0\u8F7D\u4E2D\u2026" }), data !== undefined && error === undefined && (_jsxs("div", { className: "skp-body skp-tools-body", children: [_jsxs("div", { className: "skp-workspace-pane skp-tools-pane", children: [_jsxs("div", { className: "skp-list-head", children: [_jsx("span", { className: "skp-list-title", children: listTitle }), _jsx("span", { className: "skp-group-count", title: "\u5F53\u524D\u4F5C\u7528\u57DF\u53EF\u89C1\u5355\u5143\u6570", children: visibleUnits.length }), _jsx("span", { className: "skp-list-note", children: listNote }), loading && data !== undefined && _jsx("span", { className: "skp-refresh-note", children: "\u5237\u65B0\u4E2D\u2026" }), _jsx("span", { className: "skp-detail-head-spacer" }), _jsx("span", { className: "skp-pane-title-note", children: scope === "global" ? `${defaultOnCount} 默认启用` : "开关写工作区覆盖" })] }), scope === "global" && (_jsx("div", { className: "skp-pane-note", children: "\u5168\u5C40\u9ED8\u8BA4\u5199\u5165\u7EDF\u4E00\u5168\u5C40\u6587\u4EF6 \u00B7 \u6240\u6709\u5DE5\u4F5C\u533A\u751F\u6548\uFF1B\u53EF\u89C1\u6027\u6309\u5DE5\u4F5C\u533A\u63A7\u5236" })), scope === "workspace" && (_jsx("div", { className: "skp-pane-note", children: "\u53EA\u5217\u51FA\u672C\u5DE5\u4F5C\u533A\u53EF\u89C1\u7684 Tools \u00B7 \u9ED8\u8BA4\u5F00\u5173\u53EA\u4F5C\u7528\u4E8E\u672C\u5DE5\u4F5C\u533A" })), attributionSettling && _jsx("div", { className: "skp-pane-note", children: "\u6765\u6E90\u89E3\u6790\u4E2D\u2026" }), visibleUnits.length === 0 ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "skp-empty", children: listErrors.length > 0
                                            ? "当前外壳未提供工具注册表，无法列出 Tools。"
                                            : scope === "workspace"
                                                ? "本工作区没有可见的 Tools（可在全局视图调整可见范围）。"
                                                : "尚未发现 Tools。" }), hiddenCount > 0 && _jsxs("div", { className: "skp-pane-note", children: ["\u53E6\u6709 ", hiddenCount, " \u4E2A\u80FD\u529B\u672A\u5BF9\u6B64\u5916\u5DE5\u4F5C\u533A\u5F00\u653E"] })] })) : visible.length === 0 ? (_jsxs("div", { className: "skp-empty", children: ["\u6CA1\u6709\u5339\u914D\u300C", query.trim(), "\u300D\u7684 Tools\u3002"] })) : (_jsxs("div", { className: "skp-group-scroll", children: [_jsx("ul", { className: "skp-list", role: "listbox", "aria-label": "Tools", children: visible.map((unit) => {
                                            const state = switchStateOf(unit);
                                            const entry = visibilityOf(unit);
                                            return (_jsx(ToolListRow, { unit: unit, active: unit.unit === selectedUnit, scope: scope, projectName: projectName, projects: projects, visibilityEntry: entry, globalOff: globalOffOf(unit), checked: state.checked, disabled: state.disabled, invisible: state.invisible, override: state.override ?? "inherit", busy: busyUnit === unit.unit, rowRefs: rowRefs, onSelect: stableSelectUnit, onToggle: stableToggleUnit, onKeyDown: stableRowKeyDown }, unit.unit));
                                        }) }), hiddenCount > 0 && (_jsxs("div", { className: "skp-pane-note", title: "\u8FD9\u4E9B\u5355\u5143\u5728\u5168\u5C40\u89C6\u56FE\u91CC\u672A\u88AB\u5F00\u653E\u7ED9\u672C\u5DE5\u4F5C\u533A\uFF1B\u8BF7\u5728\u5168\u5C40\u89C6\u56FE\u7684\u300C\u53EF\u89C1\u8303\u56F4\u300D\u91CC\u5F00\u542F", children: ["\u53E6\u6709 ", hiddenCount, " \u4E2A\u80FD\u529B\u672A\u5BF9\u6B64\u5916\u5DE5\u4F5C\u533A\u5F00\u653E"] }))] }))] }), _jsx("div", { className: "skp-detail skp-detail-fixed", children: selected === undefined ? (_jsx("div", { className: "skp-detail-empty", children: "\u9009\u62E9\u4E00\u4E2A\u63D2\u4EF6\u67E5\u770B\u5DE5\u5177\u6E05\u5355\u4E0E\u53C2\u6570\u3002" })) : (_jsxs("div", { className: "skp-detail-card", children: [_jsxs("div", { className: "skp-detail-head", children: [_jsx("h3", { title: selected.name, children: selected.name }), _jsxs("span", { style: HEAD_TAGS_STYLE, children: [_jsx("span", { className: unitTagClass(selected), title: selected.hostInjected === true ? HOST_INJECTED_REASON : undefined, children: unitTagLabel(selected) }), _jsx("span", { className: "skp-tag skp-tag-channel", title: selected.attribution.packageName ?? selected.name, children: selected.name })] }), _jsx("span", { className: "skp-detail-head-spacer" }), _jsx("button", { type: "button", className: "skp-btn", onClick: () => void copyName(selected.name), children: copied ? "已复制" : "复制插件名" })] }), _jsxs("div", { className: "skp-detail-meta", children: [_jsxs("span", { className: "skp-detail-meta-item", children: [_jsx("span", { className: "skp-detail-meta-strong", children: "\u6765\u6E90\u5224\u5B9A\uFF1A" }), attributionLabel(selected), attributionDetail(selected) !== undefined ? ` · ${attributionDetail(selected) ?? ""}` : ""] }), attributionIsSpeculative(selected) && (_jsx("span", { className: "skp-tag skp-tag-warn", title: "\u6765\u6E90\u4E3A\u63A8\u6D4B\uFF0C\u8BF7\u6838\u5BF9\u5DE5\u5177\u6E05\u5355", children: "\u63A8\u6D4B" })), (selected.attribution.legacyUnit === true || typeof selected.attribution.legacyUnit === "string") && (_jsx("span", { className: "skp-note", title: typeof selected.attribution.legacyUnit === "string"
                                                ? `旧版键：${selected.attribution.legacyUnit}`
                                                : "旧版持久化键已迁移到新的插件单元", children: "\u65E7\u7248\u952E\u5DF2\u8FC1\u79FB" })), attributionSettling && _jsx("span", { className: "skp-note", children: "\u6765\u6E90\u89E3\u6790\u4E2D\u2026" }), _jsxs("span", { className: "skp-detail-meta-item", children: [_jsx("span", { className: "skp-detail-meta-strong", children: "\u6CE8\u5165\u65B9\u5F0F\uFF1A" }), selected.hostInjected === true
                                                    ? "宿主注入（@deepseek-ai/*，只读展示）"
                                                    : "插件运行时注册的非 MCP 工具（不落盘）"] })] }), attributionIsSpeculative(selected) && _jsx("p", { className: "skp-note skp-note-warn", children: "\u6765\u6E90\u4E3A\u63A8\u6D4B\uFF0C\u8BF7\u6838\u5BF9\u5DE5\u5177\u6E05\u5355" }), selected.description !== undefined && selected.description.trim().length > 0 && (_jsx("p", { className: "skp-note", children: selected.description })), _jsx("div", { className: "skp-note", children: selected.hostInjected === true
                                        ? `工具数 ${selected.toolCount} · 宿主注入：所有工作区默认启用，仅展示，不能关闭`
                                        : `工具数 ${selected.toolCount} · 开关为插件级：关闭后该插件全部工具默认不可用（不改已有对话的显式覆盖）` }), scope === "global" && selected.hostInjected !== true && (_jsx("dl", { className: "skp-detail-fields", children: _jsx(VisibilityDetailFields, { api: api, domain: "tools", capabilityKey: selected.unit, name: selected.name, entry: visibilityOf(selected), workspaces: projects, globalOff: globalOffOf(selected), onSaved: () => setVersion((value) => value + 1) }) })), _jsxs("div", { className: "skp-detail-inspect", children: [_jsxs("div", { className: "skp-detail-inspect-head", children: [_jsxs("span", { className: "skp-field-label", children: ["\u5DE5\u5177\u6E05\u5355\uFF08", selected.toolCount, "\uFF09"] }), _jsx("span", { className: "skp-test-stat", children: inspectLoading ? "正在读取参数…" : "点击工具查看参数与原始 JSON" })] }), inspectError !== undefined && (_jsxs("div", { className: "skp-note", children: ["\u53C2\u6570\u4E0D\u53EF\u7528\uFF1A", inspectError, "\uFF08\u4ECD\u53EF\u67E5\u770B\u5DE5\u5177\u540D\u79F0\u4E0E\u8BF4\u660E\uFF09"] })), displayTools.length === 0 ? (_jsx("div", { className: "skp-note", children: "\u5DE5\u5177\u6E05\u5355\u4E0D\u53EF\u89C1\uFF08\u8BE5\u5355\u5143\u5F53\u524D\u6CA1\u6709\u53EF\u89C1\u5DE5\u5177\uFF09\u3002" })) : (_jsx("div", { className: "skp-tool-accordion", role: "list", children: displayTools.map((tool) => (_jsx(ToolAccordionItem, { tool: tool, open: expandedTool === tool.name, onToggle: () => setExpandedTool(expandedTool === tool.name ? undefined : tool.name) }, tool.name))) }))] }), _jsx("p", { className: "skp-note", style: NOTE_STYLE, children: "\u63D2\u4EF6\u7EA7\u5F00\u5173\uFF0C\u4E0D\u63D0\u4F9B\u5355\u5DE5\u5177\u5F00\u5173\uFF1B\u65E0\u6CD5 restrict \u7684\u63D2\u4EF6\u5F00\u5173\u7F6E\u7070\u5E76\u8BF4\u660E\u539F\u56E0\uFF1B\u5BBF\u4E3B\u5185\u5EFA\u5DE5\u5177\u6309\u5BBF\u4E3B\u5305\u53EA\u8BFB\u5C55\u793A\uFF0C\u6052\u542F\u7528\u3001\u4E0D\u53EF\u5F00\u5173\u3002" })] })) })] }))] }));
}
