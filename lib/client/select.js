import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * 自绘下拉框（替代原生 <select>——原生的选项列表由浏览器渲染，
 * 无法定制样式，视觉与面板其余部分不一致）。
 *
 * 结构：触发按钮（.skp-dd-btn，带雪佛龙箭头）+ fixed 定位的弹出列表
 * （.skp-dd-pop）。弹出层用 getBoundingClientRect 锚定到按钮下方，因此不受
 * 父级 overflow:auto（如模态框）裁剪；列表项支持禁用、右侧 hint 与选中对勾。
 *
 * **视口钳制**（工作区很多时必须，否则列表会顶出屏幕）：打开时按按钮位置算
 * 出下方/上方可用空间，取宽裕的一侧展开（下方放不下"舒适高度"且上方更宽裕
 * 时向上弹），高度再夹在 [POP_MIN_HEIGHT, POP_MAX_HEIGHT] 内；水平方向按视口
 * 宽度钳制 `left`，并在渲染后用弹出层的实测宽度二次修正，保证右边缘不出屏。
 *
 * 关闭时机：点击组件外部（capture 阶段判定）、Esc、窗口缩放。**列表内部的
 * 滚动不关闭**（否则工作区一多就无法滚动选择），但页面/面板容器的滚动会关闭。
 *
 * @module @chengdb/capability-panel/client/select
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
/** 与视口边缘的最小间距。 */
const VIEWPORT_MARGIN = 8;
/** 与触发按钮之间的间距。 */
const POP_GAP = 6;
/** 高度下限 / 上限 / "舒适高度"（下方小于舒适高度且上方更宽裕时向上弹）。 */
const POP_MIN_HEIGHT = 120;
const POP_MAX_HEIGHT = 480;
const POP_COMFORT_HEIGHT = 240;
/** 宽度下限与上限（超出上限的标签靠 ellipsis 收敛）。 */
const POP_MIN_WIDTH = 200;
const POP_MAX_WIDTH = 520;
/**
 * 扁平风格下拉框。
 *
 * `className` 追加在根节点上（如头部作用域选择器的 `skp-dd-scope`
 * 限宽；表单字段内由 `.skp-field .skp-dd` 撑满整行）。
 */
export function SkpSelect({ value, options, onChange, disabled, ariaLabel, title, className, }) {
    const [anchor, setAnchor] = useState(null);
    const rootRef = useRef(null);
    const btnRef = useRef(null);
    const popRef = useRef(null);
    const open = anchor !== null;
    const selected = options.find((option) => option.value === value);
    // 打开期间：点外部 / Esc / 窗口缩放关闭；滚动只在"非列表内部"时关闭。
    useEffect(() => {
        if (!open)
            return;
        const close = () => setAnchor(null);
        const onPointerDown = (event) => {
            if (rootRef.current !== null && event.target instanceof Node && !rootRef.current.contains(event.target)) {
                close();
            }
        };
        const onKeyDown = (event) => {
            if (event.key === "Escape")
                close();
        };
        const onScroll = (event) => {
            // 列表自身的滚动必须放行（工作区多时靠它翻到底），其余容器滚动才关。
            if (rootRef.current !== null && event.target instanceof Node && rootRef.current.contains(event.target))
                return;
            close();
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("keydown", onKeyDown);
        window.addEventListener("resize", close);
        window.addEventListener("scroll", onScroll, true);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("resize", close);
            window.removeEventListener("scroll", onScroll, true);
        };
    }, [open]);
    // 渲染后用实测宽度二次钳制 left：minWidth 只是下限，长标签会把弹层撑得比
    // 预估更宽，只按 minWidth 钳制仍可能顶出右边界。
    useLayoutEffect(() => {
        if (anchor === null)
            return;
        const el = popRef.current;
        if (el === null)
            return;
        const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - VIEWPORT_MARGIN - el.getBoundingClientRect().width);
        if (anchor.left > maxLeft)
            setAnchor({ ...anchor, left: maxLeft });
    }, [anchor]);
    /** 打开时按按钮视口位置锚定弹出层，并保证不越出视口。 */
    const toggle = () => {
        if (disabled === true)
            return;
        if (open) {
            setAnchor(null);
            return;
        }
        const rect = btnRef.current?.getBoundingClientRect();
        if (rect === undefined)
            return;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const spaceBelow = vh - rect.bottom - POP_GAP - VIEWPORT_MARGIN;
        const spaceAbove = rect.top - POP_GAP - VIEWPORT_MARGIN;
        const openUp = spaceBelow < Math.min(POP_COMFORT_HEIGHT, spaceAbove);
        const maxHeight = Math.max(POP_MIN_HEIGHT, Math.min(POP_MAX_HEIGHT, openUp ? spaceAbove : spaceBelow));
        const maxWidth = Math.max(POP_MIN_WIDTH, Math.min(POP_MAX_WIDTH, vw - VIEWPORT_MARGIN * 2));
        const width = Math.min(Math.max(rect.width, POP_MIN_WIDTH), maxWidth);
        const left = Math.min(Math.max(VIEWPORT_MARGIN, rect.left), Math.max(VIEWPORT_MARGIN, vw - VIEWPORT_MARGIN - width));
        setAnchor(openUp
            ? { left, bottom: vh - rect.top + POP_GAP, width, maxHeight, maxWidth }
            : { left, top: rect.bottom + POP_GAP, width, maxHeight, maxWidth });
    };
    return (_jsxs("div", { ref: rootRef, className: className === undefined ? "skp-dd" : `skp-dd ${className}`, children: [_jsx("button", { ref: btnRef, type: "button", className: "skp-dd-btn", disabled: disabled, "aria-haspopup": "listbox", "aria-expanded": open, "aria-label": ariaLabel, title: title, onClick: toggle, children: _jsx("span", { className: "skp-dd-label", children: selected?.label ?? value }) }), open && (_jsx("div", { ref: popRef, className: "skp-dd-pop", role: "listbox", style: {
                    left: anchor.left,
                    ...(anchor.top === undefined ? {} : { top: anchor.top }),
                    ...(anchor.bottom === undefined ? {} : { bottom: anchor.bottom }),
                    minWidth: anchor.width,
                    maxWidth: anchor.maxWidth,
                    maxHeight: anchor.maxHeight,
                }, children: options.map((option) => {
                    const active = option.value === value;
                    return (_jsxs("button", { type: "button", role: "option", "aria-selected": active, className: active ? "skp-dd-opt skp-dd-opt-active" : "skp-dd-opt", disabled: option.disabled, onClick: () => {
                            onChange(option.value);
                            setAnchor(null);
                        }, children: [_jsx("span", { className: "skp-dd-opt-label", children: option.label }), option.hint !== undefined && _jsx("span", { className: "skp-dd-hint", children: option.hint }), active && (_jsx("span", { className: "skp-dd-check", "aria-hidden": "true", children: "\u2713" }))] }, option.value));
                }) }))] }));
}
