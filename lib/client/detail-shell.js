import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * v22 详情页外壳：能力中心「Skills / MCP」两个详情页共用的头部与菜单原语。
 *
 * 设计目标（见 `docs/figma/preview/v22-*`，页面 `Capability Panel · 详情页内容优先 v22 草案`）：
 * 把详情页从「整列滚动 + 元数据堆叠」改成「固定头部三段 + 内容区独立滚动」：
 *
 * ```
 * 标题行（名称 / 徽章 / 开关 / ⋯ 菜单）
 * 状态条（作用域链摘要 · 来源 · 命名空间 … | 使用记录 · 元数据 ⌄）
 * 内容工具条（由各域自己渲染）
 * 内容区（flex:1，内部滚动）
 * ```
 *
 * 长元数据（URL / 配置文件 / frontmatter / 可见范围 …）由 `MetaPanel` 承载，
 * 默认收起、点状态条右侧「元数据」展开；低频与破坏性动作收进 `MoreMenu`。
 *
 * 纯展示组件，不含业务状态；MCP / Skills 两个域各自传入数据与回调。
 *
 * @module dsh-capability-settings/client/detail-shell
 */
import { useEffect, useRef, useState } from "react";
/** 详情页根容器：固定头部 + 可滚动内容（样式见 `.skp-detail-page`）。 */
export function DetailPage({ children }) {
    return _jsx("div", { className: "skp-detail-page", children: children });
}
/** 标题行：名称 + 徽章；右侧由调用方放开关 / 菜单。 */
export function DetailTitleBar({ title, tags, right, }) {
    return (_jsxs("div", { className: "skp-detail-title-row", children: [_jsx("h3", { title: title, children: title }), tags !== undefined && _jsx("span", { className: "skp-detail-title-tags", children: tags }), _jsx("span", { className: "skp-detail-head-spacer" }), right] }));
}
/** 状态条：单行摘要；超宽省略，不换行。 */
export function DetailStrip({ children }) {
    return _jsx("div", { className: "skp-detail-strip", children: children });
}
/** 状态条里的分隔竖线。 */
export function StripSeparator() {
    return _jsx("span", { className: "skp-strip-sep", "aria-hidden": "true" });
}
/**
 * 启用开关（详情页常驻）：`checked` / `partial` 表达三态（全开 / 部分 / 全关）。
 * 语义由调用方决定（Skills = 模型与用户都可调用；MCP = 配置内启用）。
 */
export function ToggleSwitch({ checked, partial = false, disabled = false, title, label, onChange, }) {
    return (_jsxs("label", { className: "skp-switch-wrap", title: title, children: [label !== undefined && _jsx("span", { className: "skp-switch-label", children: label }), _jsxs("span", { className: ["skp-switch", checked ? "skp-switch-on" : "", partial ? "skp-switch-partial" : ""]
                    .filter(Boolean)
                    .join(" "), children: [_jsx("input", { type: "checkbox", role: "switch", "aria-checked": checked, "aria-label": label ?? title ?? "启用", checked: checked, disabled: disabled, onChange: (event) => onChange(event.target.checked) }), _jsx("span", { className: "skp-switch-knob", "aria-hidden": "true" })] })] }));
}
/**
 * 低频 / 破坏性动作收进 `⋯` 菜单：点外部或 Esc 关闭；菜单项点击后自动收起。
 */
export function MoreMenu({ items, label = "更多操作" }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);
    useEffect(() => {
        if (!open)
            return;
        const onPointerDown = (event) => {
            if (rootRef.current !== null && event.target instanceof Node && !rootRef.current.contains(event.target)) {
                setOpen(false);
            }
        };
        const onKeyDown = (event) => {
            if (event.key === "Escape")
                setOpen(false);
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [open]);
    const visible = items.filter((item) => item.label.length > 0);
    return (_jsxs("div", { className: "skp-more", ref: rootRef, children: [_jsx("button", { type: "button", className: "skp-more-btn", "aria-haspopup": "menu", "aria-expanded": open, "aria-label": label, title: label, onClick: () => setOpen((value) => !value), children: "\u22EF" }), open && (_jsx("div", { className: "skp-more-pop", role: "menu", "aria-label": label, children: visible.map((item) => (_jsx("button", { type: "button", role: "menuitem", disabled: item.disabled, title: item.title, className: item.danger ? "skp-more-item skp-more-item-danger" : "skp-more-item", onClick: () => {
                        if (item.disabled === true)
                            return;
                        setOpen(false);
                        item.onSelect();
                    }, children: item.label }, item.key))) }))] }));
}
/** 元数据面板（默认收起；展开后内容区整体下移，自身不滚动）。 */
export function MetaPanel({ children }) {
    return _jsx("div", { className: "skp-meta-panel", children: children });
}
/** 元数据网格（3 列；窄容器降为 2 列 / 1 列）。 */
export function MetaGrid({ children }) {
    return _jsx("div", { className: "skp-meta-grid", children: children });
}
/** 元数据单元：小标题 + 值（单行省略，完整值走 title）。 */
export function MetaCell({ label, mono = false, title, children, }) {
    return (_jsxs("div", { className: "skp-meta-cell", children: [_jsx("span", { className: "skp-meta-label", children: label }), _jsx("span", { className: mono ? "skp-meta-value skp-meta-mono" : "skp-meta-value", title: title, children: children })] }));
}
