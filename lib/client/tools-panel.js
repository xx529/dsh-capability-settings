import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * 能力面板 · Tools 域（v13 R3 / 帧 06）。
 *
 * Tools 是**全局工具注册**，没有项目 / 工作区维度（UX v1.8 §2.4 / §2.5）：
 * 因此本视图没有左导航、没有工作区列表，只有**两栏**：
 *   - 左：插件单元列表（一个插件 = 一个开关单元，`N 个工具`）；
 *   - 右：插件详情 + **只读**工具清单（无逐工具开关、无参数表）。
 *
 * 开关语义（A5 已拍板「主面板也要能开关」）：主面板自身没有 sessionId，
 * 由 `api.currentSessionId()` 从客户端 sessions 快照解析当前会话：
 *   - 解析到 → 行/详情开关可点，写 `tools.setSessionEnabled`（只作用于该会话，
 *     不改项目默认）；
 *   - 解析不到 → 开关置灰 + 提示 `请在对话首屏设置本会话开关`（只读）。
 *
 * 契约：docs/architecture/v13-implementation.md §5.1 / §9.4 / 附录 A。
 *
 * @module dsh-capability-settings/client/tools-panel
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
/** 详情标题右侧标签行的排版（与 mcp-panel 的 HEAD_TAGS_STYLE 同形）。 */
const HEAD_TAGS_STYLE = { display: "inline-flex", alignItems: "center", gap: 6, flex: "none" };
/** 不做成按钮的说明文本（关闭影响条 / 只读说明）。 */
const CLOSE_IMPACT_STYLE = { margin: "10px 0 0" };
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
/** 详情「来源判定」文案（frontend 直抄方案 §7.6 / §9.4）。 */
function attributionText(unit) {
    if (unit.attribution.matchedBy === "unknown")
        return "来源未识别（不是宿主内置）";
    const pattern = unit.attribution.pattern ?? unit.name;
    const matched = unit.attribution.matchedBy === "exact" ? `精确匹配 ${pattern}` : `前缀 ${pattern}`;
    return `${matched} → ${unit.name}（插件清单映射表）`;
}
/**
 * Tools 域视图：两栏（插件列表 + 详情/只读工具清单），无左导航。
 *
 * @param query 根组件头部搜索框的值（按插件名 / 工具名 / 工具说明本地过滤）。
 * @param workspace 当前工作区（只作为重新拉取的信号：会话切换后 currentSessionId 可能变化）。
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
    const mountedRef = useRef(true);
    const rowRefs = useRef(new Map());
    // A5：解析当前会话（解析不到 → 只读）。每次拉取前重读，跟随会话切换。
    const resolvedSessionId = api.currentSessionId?.();
    const sessionId = typeof resolvedSessionId === "string" && resolvedSessionId.length > 0 ? resolvedSessionId : undefined;
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
        void api.tools
            .list(sessionId !== undefined ? { sessionId } : {})
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
    }, [api, sessionId, workspace, version]);
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
    /** 写会话开关（A5）：只有解析到当前会话且单元未锁定时才允许。 */
    const toggleUnit = useCallback(async (unit, next) => {
        if (sessionId === undefined || unit.lockedReason !== undefined || busyUnit !== undefined)
            return;
        setBusyUnit(unit.unit);
        setOpError(undefined);
        try {
            await api.tools.setSessionEnabled({ units: [unit.unit], enabled: next, sessionId });
        }
        catch (failure) {
            setOpError(String(failure instanceof Error ? failure.message : failure));
        }
        finally {
            if (mountedRef.current)
                setBusyUnit(undefined);
            setVersion((value) => value + 1);
        }
    }, [api, busyUnit, sessionId]);
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
    return (_jsxs("div", { className: "skp-domain", children: [opError !== undefined && _jsx("div", { className: "skp-error", children: opError }), error !== undefined && _jsxs("div", { className: "skp-error", children: ["\u8BFB\u53D6\u5931\u8D25\uFF1A", error] }), error === undefined && listErrors.length > 0 && _jsx("div", { className: "skp-error", children: listErrors.join("\n") }), loading && data === undefined && _jsx("div", { className: "skp-status", children: "\u52A0\u8F7D\u4E2D\u2026" }), data !== undefined && error === undefined && (_jsxs("div", { className: "skp-body skp-tools-body", children: [_jsxs("div", { className: "skp-workspace-pane skp-tools-pane", children: [_jsxs("div", { className: "skp-pane-title", children: [_jsx("span", { className: "skp-pane-title-text", children: "Tools" }), _jsx("span", { className: "skp-group-count", children: units.length }), _jsxs("span", { className: "skp-pane-title-note", children: ["\u00B7 ", units.filter((unit) => unit.enabledInSession).length, " \u542F\u7528 \u00B7 \u63D2\u4EF6\u7EA7\u5F00\u5173\uFF08\u6574\u63D2\u4EF6\u751F\u6548\uFF09"] })] }), units.length === 0 ? (_jsx("div", { className: "skp-empty", children: listErrors.length > 0 ? "当前外壳未提供工具注册表，无法列出 Tools。" : "尚未发现 Tools。" })) : visible.length === 0 ? (_jsxs("div", { className: "skp-empty", children: ["\u6CA1\u6709\u5339\u914D\u300C", query.trim(), "\u300D\u7684 Tools\u3002"] })) : (_jsx("div", { className: "skp-group-scroll", children: _jsx("ul", { className: "skp-list", role: "listbox", "aria-label": "Tools", children: visible.map((unit) => {
                                        const active = unit.unit === selectedUnit;
                                        const locked = unit.lockedReason !== undefined;
                                        const readOnly = sessionId === undefined;
                                        return (_jsxs("li", { className: active ? "skp-row-wrap skp-row-wrap-active" : "skp-row-wrap", children: [_jsxs("button", { type: "button", role: "option", "aria-selected": active, tabIndex: active ? 0 : -1, className: active ? "skp-row skp-row-active" : "skp-row", ref: (element) => {
                                                        if (element === null)
                                                            rowRefs.current.delete(unit.unit);
                                                        else
                                                            rowRefs.current.set(unit.unit, element);
                                                    }, onClick: () => setSelectedUnit(unit.unit), onKeyDown: (event) => onRowKeyDown(event, unit.unit), children: [_jsxs("span", { className: "skp-row-name", children: [_jsx("span", { className: unit.enabledInSession ? "skp-dot skp-dot-enabled" : "skp-dot skp-dot-hollow", "aria-hidden": "true" }), _jsx("span", { className: "skp-sr-only", children: unit.enabledInSession ? "已启用" : "已关闭" }), _jsx("span", { className: "skp-row-title", title: unit.name, children: unit.name })] }), _jsxs("span", { className: "skp-row-meta", children: [_jsx("span", { className: unitTagClass(unit), title: unit.kind === "unattributed" ? "来源未识别：不是宿主内置工具" : "插件运行时注册（非 MCP）", children: unit.kind === "unattributed" ? "未识别" : "插件" }), _jsxs("span", { className: "skp-tag skp-tag-flat", children: [unit.toolCount, " \u4E2A\u5DE5\u5177"] })] })] }), _jsxs("label", { className: "skp-row-toggle", title: locked
                                                        ? (unit.lockedReason ?? "该插件无法按会话关闭")
                                                        : readOnly
                                                            ? "请在对话首屏设置本会话开关"
                                                            : unit.enabledInSession
                                                                ? "关闭：该插件全部工具在本会话不可见（不改项目默认）"
                                                                : "开启：恢复该插件全部工具（仅当前会话）", children: [_jsx("span", { className: "skp-row-default-label", children: "\u542F\u7528" }), _jsxs("span", { className: "skp-switch", children: [_jsx("input", { type: "checkbox", role: "switch", "aria-label": `启用 ${unit.name}`, checked: unit.enabledInSession, disabled: locked || readOnly || busyUnit === unit.unit, onChange: (event) => void toggleUnit(unit, event.target.checked) }), _jsx("span", { className: "skp-switch-track" })] })] })] }, unit.unit));
                                    }) }) }))] }), _jsx("div", { className: "skp-detail skp-detail-fixed", children: selected === undefined ? (_jsx("div", { className: "skp-detail-empty", children: "\u9009\u62E9\u4E00\u4E2A\u63D2\u4EF6\u67E5\u770B\u5DE5\u5177\u6E05\u5355\uFF08\u53EA\u8BFB\uFF09\u3002" })) : (_jsxs("div", { className: "skp-detail-card", children: [_jsxs("div", { className: "skp-detail-head", children: [_jsx("h3", { title: selected.name, children: selected.name }), _jsxs("span", { style: HEAD_TAGS_STYLE, children: [_jsx("span", { className: selected.kind === "unattributed" ? "skp-tag skp-tag-warn" : "skp-tag skp-tag-plugin", children: selected.kind === "unattributed" ? "未识别" : "插件" }), _jsx("span", { className: "skp-tag skp-tag-channel", title: selected.attribution.packageName ?? selected.name, children: selected.name })] }), _jsx("span", { className: "skp-detail-head-spacer" }), _jsx("button", { type: "button", className: "skp-btn", onClick: () => void copyName(selected.name), children: copied ? "已复制" : "复制插件名" })] }), _jsxs("div", { className: "skp-detail-actions", children: [_jsxs("span", { className: "skp-row-toggle", style: { marginLeft: 0 }, children: [_jsx("span", { className: "skp-row-default-label", children: "\u672C\u4F1A\u8BDD" }), _jsxs("span", { className: "skp-switch", children: [_jsx("input", { type: "checkbox", role: "switch", "aria-label": `启用 ${selected.name}`, checked: selected.enabledInSession, disabled: selected.lockedReason !== undefined || sessionId === undefined || busyUnit === selected.unit, onChange: (event) => void toggleUnit(selected, event.target.checked) }), _jsx("span", { className: "skp-switch-track" })] })] }), _jsxs("span", { className: "skp-note", children: [selected.enabledInSession ? "已启用" : "已关闭", sessionId === undefined ? " · 请在对话首屏设置本会话开关" : " · 仅当前会话"] })] }), _jsxs("div", { className: "skp-detail-meta", children: [_jsxs("span", { className: "skp-detail-meta-item", children: [_jsx("span", { className: "skp-detail-meta-strong", children: "\u6765\u6E90\u5224\u5B9A\uFF1A" }), attributionText(selected)] }), _jsxs("span", { className: "skp-detail-meta-item", children: [_jsx("span", { className: "skp-detail-meta-strong", children: "\u6CE8\u5165\u65B9\u5F0F\uFF1A" }), "\u63D2\u4EF6\u8FD0\u884C\u65F6\u6CE8\u518C\u7684\u975E MCP \u5DE5\u5177\uFF08\u4E0D\u843D\u76D8\uFF09"] })] }), _jsxs("div", { className: "skp-note", children: ["\u5DE5\u5177\u6570 ", selected.toolCount, " \u00B7 \u5F00\u5173\u4E3A\u63D2\u4EF6\u7EA7\uFF1A\u5173\u95ED\u540E\u8BE5\u63D2\u4EF6\u5168\u90E8\u5DE5\u5177\u5728\u672C\u4F1A\u8BDD\u4E0D\u53EF\u89C1"] }), _jsxs("div", { className: "skp-detail-inspect", children: [_jsxs("div", { className: "skp-detail-inspect-head", children: [_jsxs("span", { className: "skp-field-label", children: ["\u5DE5\u5177\u6E05\u5355\uFF08", selected.toolCount, "\uFF09\u00B7 \u53EA\u8BFB"] }), _jsx("span", { className: "skp-test-stat", children: "\u65E0\u9010\u5DE5\u5177\u5F00\u5173\u3001\u65E0\u53C2\u6570\u8868" })] }), selected.tools.length === 0 ? (_jsx("div", { className: "skp-note", children: "\u5DE5\u5177\u6E05\u5355\u4E0D\u53EF\u89C1\uFF08\u8BE5\u5355\u5143\u5F53\u524D\u6CA1\u6709\u53EF\u89C1\u5DE5\u5177\uFF09\u3002" })) : (_jsx("ul", { className: "skp-tools-list", children: selected.tools.map((tool) => (_jsxs("li", { className: "skp-tools-item", children: [_jsx("span", { className: "skp-tools-name", children: tool.name }), _jsx("span", { className: "skp-tools-desc", children: tool.description ?? "（无说明）" })] }, tool.name))) }))] }), _jsxs("div", { className: "skp-tools-impact", style: CLOSE_IMPACT_STYLE, children: ["\u5173\u95ED\u8BE5\u63D2\u4EF6\u540E\uFF0C\u672C\u4F1A\u8BDD\u6A21\u578B\u770B\u4E0D\u5230\u5B83\u7684\u5168\u90E8 ", selected.toolCount, " \u4E2A\u5DE5\u5177\uFF1B\u80FD\u529B\u51B3\u7B56\uFF08Jev\uFF09\u4EE5\u63D2\u4EF6\u6574\u4F53\u8BA1\u5206\uFF0C\u9009\u4E2D\u624D\u4F1A\u542F\u7528\u8BE5\u63D2\u4EF6\u5168\u90E8\u5DE5\u5177\uFF1B\u4E0D\u6539\u9879\u76EE\u9ED8\u8BA4"] }), _jsx("p", { className: "skp-note", style: CLOSE_IMPACT_STYLE, children: "\u63D2\u4EF6\u7EA7\u5F00\u5173\uFF0C\u4E0D\u63D0\u4F9B\u5355\u5DE5\u5177\u5F00\u5173\uFF1B\u65E0\u6CD5 restrict \u7684\u63D2\u4EF6\u5F00\u5173\u7F6E\u7070\u5E76\u8BF4\u660E\u539F\u56E0\uFF1B\u5BBF\u4E3B\u5185\u5EFA\u57FA\u7840\u5DE5\u5177\u4E0D\u8FDB\u5165\u672C\u57DF\u3002" }), _jsx("p", { className: "skp-note", children: "\u203B \u672C\u7248\u4E0D\u505A\u53C2\u6570\u8868\uFF1ATools \u6CA1\u6709\u7EDF\u4E00\u7684 inputSchema \u627F\u8BFA\uFF1B\u5DE5\u5177\u6E05\u5355\u53EA\u8BFB\u5C55\u793A\u540D\u79F0\u4E0E\u8BF4\u660E\u3002" })] })) })] }))] }));
}
