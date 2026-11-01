import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * v20.1 两段作用域链（全局 → 工作区）。
 *
 * 全局视图的第二段不是「直接跳到某个工作区」——先展开一个工作区下拉，
 * 用户选中具体工作区后才切换。避免把「最近工作区 / 第一项」当成隐式落点，
 * 也避免用户不知道即将去哪个工作区（用户反馈 2026-11-01）。
 *
 * 工作区视图的第二段是纯展示（真实 effective 状态）。
 *
 * 下拉复用 `.skp-dd-pop` 的 fixed 定位与视口钳制思路；这里不直接复用
 * `SkpSelect`，因为触发按钮是三行卡片（label/title/note），而 `SkpSelect`
 * 的触发区只有单行 label。
 *
 * @module dsh-capability-settings/client/scope-chain
 */
import { useEffect, useRef, useState } from "react";
/** 从路径取 basename（兼容 POSIX / Windows 分隔符）。 */
function basenameOf(path) {
    const segments = path.split(/[\\/]/).filter((segment) => segment.length > 0);
    return segments[segments.length - 1] ?? path;
}
/**
 * 渲染两段作用域链。
 *
 * @param scope 当前面板作用域
 * @param projectName 工作区展示名（工作区视图第二段）
 * @param globalSeg 全局段文案
 * @param workspaceSeg 工作区段文案（工作区视图）
 * @param workspaces 全部工作区；全局视图点击第二段后展示
 * @param onSelectWorkspace 选中工作区后切换面板作用域
 */
export function ScopeChain({ scope, projectName, globalSeg, workspaceSeg, workspaces, onSelectWorkspace, }) {
    const [anchor, setAnchor] = useState(null);
    const rootRef = useRef(null);
    const buttonRef = useRef(null);
    const open = anchor !== null;
    const toggle = () => {
        if (open) {
            setAnchor(null);
            return;
        }
        const rect = buttonRef.current?.getBoundingClientRect();
        if (rect === undefined)
            return;
        const width = Math.max(280, Math.min(rect.width, 420));
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
        const top = Math.min(rect.bottom + 6, window.innerHeight - 120);
        setAnchor({ left, top, width });
    };
    useEffect(() => {
        if (!open)
            return;
        const onPointerDown = (event) => {
            if (rootRef.current !== null && event.target instanceof Node && !rootRef.current.contains(event.target)) {
                setAnchor(null);
            }
        };
        const onKeyDown = (event) => {
            if (event.key === "Escape")
                setAnchor(null);
        };
        const closeOnViewportChange = () => setAnchor(null);
        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("keydown", onKeyDown);
        window.addEventListener("resize", closeOnViewportChange);
        window.addEventListener("scroll", closeOnViewportChange, true);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("resize", closeOnViewportChange);
            window.removeEventListener("scroll", closeOnViewportChange, true);
        };
    }, [open]);
    return (_jsxs("div", { ref: rootRef, className: "skp-scope-chain", "aria-label": "\u4F5C\u7528\u57DF\u94FE", children: [_jsxs("div", { className: "skp-scope-chain-seg", children: [_jsxs("div", { className: "skp-scope-chain-head", children: [_jsx("span", { className: globalSeg.on ? "skp-dot skp-dot-enabled" : "skp-dot skp-dot-hollow", "aria-hidden": "true" }), _jsx("span", { className: "skp-scope-chain-label", children: "\u5168\u5C40" })] }), _jsx("div", { className: "skp-scope-chain-title", children: globalSeg.title }), _jsx("div", { className: "skp-scope-chain-note", children: globalSeg.note })] }), _jsx("span", { className: "skp-scope-chain-arrow", "aria-hidden": "true", children: "\u2192" }), scope === "global" ? (_jsxs(_Fragment, { children: [_jsxs("button", { ref: buttonRef, type: "button", className: "skp-scope-chain-seg skp-scope-chain-action", title: "\u9009\u62E9\u8981\u67E5\u770B\u7684\u5DE5\u4F5C\u533A\uFF1B\u9009\u4E2D\u540E\u5207\u5230\u8BE5\u5DE5\u4F5C\u533A\u89C6\u56FE", "aria-haspopup": "listbox", "aria-expanded": open, onClick: toggle, children: [_jsxs("div", { className: "skp-scope-chain-head", children: [_jsx("span", { className: "skp-dot skp-dot-partial", "aria-hidden": "true" }), _jsx("span", { className: "skp-scope-chain-label", children: "\u5DE5\u4F5C\u533A\u8986\u76D6" })] }), _jsx("div", { className: "skp-scope-chain-title", children: "\u5728\u300C\u5DE5\u4F5C\u533A\u300D\u4F5C\u7528\u57DF\u67E5\u770B \u2197" }), _jsx("div", { className: "skp-scope-chain-note", children: "\u5148\u9009\u62E9\u5DE5\u4F5C\u533A\uFF0C\u518D\u5207\u5230\u8BE5\u5DE5\u4F5C\u533A\u89C6\u56FE" })] }), open && anchor !== null && (_jsxs("div", { className: "skp-dd-pop skp-scope-chain-pop", role: "listbox", "aria-label": "\u9009\u62E9\u5DE5\u4F5C\u533A", style: { left: anchor.left, top: anchor.top, width: anchor.width, maxHeight: 320 }, children: [_jsx("div", { className: "skp-scope-chain-pop-head", children: "\u9009\u62E9\u5DE5\u4F5C\u533A" }), workspaces.length === 0 ? (_jsx("div", { className: "skp-empty skp-scope-chain-pop-empty", children: "\u8FD8\u6CA1\u6709\u5DF2\u77E5\u5DE5\u4F5C\u533A" })) : (workspaces.map((workspace) => (_jsx("button", { type: "button", role: "option", className: "skp-dd-opt", title: workspace.path, onClick: () => {
                                    setAnchor(null);
                                    onSelectWorkspace(workspace.path);
                                }, children: _jsx("span", { className: "skp-dd-opt-label", children: workspace.title?.trim() || basenameOf(workspace.path) }) }, workspace.path))))] }))] })) : (_jsxs("div", { className: "skp-scope-chain-seg", children: [_jsxs("div", { className: "skp-scope-chain-head", children: [_jsx("span", { className: workspaceSeg.on ? "skp-dot skp-dot-enabled" : "skp-dot skp-dot-hollow", "aria-hidden": "true" }), _jsxs("span", { className: "skp-scope-chain-label", children: ["\u5DE5\u4F5C\u533A ", projectName ?? "当前选择"] })] }), _jsx("div", { className: "skp-scope-chain-title", children: workspaceSeg.title }), _jsx("div", { className: "skp-scope-chain-note", children: workspaceSeg.note })] }))] }));
}
