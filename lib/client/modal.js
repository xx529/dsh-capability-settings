import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
/** 模态框外壳：标题 + 内容；点遮罩关闭（内容区点击已拦截）。 */
export function Modal({ title, children, header, footer, wide = false, onClose, }) {
    const fixed = header !== undefined || footer !== undefined;
    const sizeClass = wide ? " skp-modal-wide" : "";
    return (_jsx("div", { className: "skp-modal-overlay", onClick: onClose, children: _jsxs("div", { className: (fixed ? "skp-modal skp-modal-fixed" : "skp-modal") + sizeClass, role: "dialog", "aria-label": title, onClick: (e) => e.stopPropagation(), children: [_jsx("h3", { children: title }), fixed ? (_jsxs(_Fragment, { children: [header !== undefined && _jsx("div", { className: "skp-modal-header", children: header }), _jsx("div", { className: "skp-modal-scroll", children: children }), footer !== undefined && _jsx("div", { className: "skp-modal-footer", children: footer })] })) : (children)] }) }));
}
