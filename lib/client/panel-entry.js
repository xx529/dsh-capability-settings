import { jsx as _jsx } from "react/jsx-runtime";
import { CapabilityPanel } from "./panel.js";
/**
 * 主区域页面：把面板本体铺满 layout 的主区域。
 *
 * `.skp-panel` 自带 `height:100%;display:flex;flex-direction:column`；外面这层
 * `.skp-main` 负责在主区域的 flex 列里撑满高度并把内部滚动限制在页面内
 * （`min-height:0` 让 `.skp-body` 的 `flex:1` 能收缩、列表/详情各自滚动，
 * 而不是把整页顶高）。背景改用宿主的基色，避免"卡片底色"被当成整页底色。
 */
export function CapabilityPanelPage({ api }) {
    return (_jsx("div", { className: "skp-main", children: _jsx(CapabilityPanel, { api: api }) }));
}
/**
 * 侧栏「全局面板」图标（`sidebar.panellist` 的注册组件）。
 *
 * 只渲染图标本身，放在侧栏的 `panelGlyph` span 内：
 *   - `size` 由侧栏给出（展开 16 / 收起 18），兜底 18 并夹在 16–20px；
 *   - 颜色继承 `currentColor`（侧栏 `panelRow` 设为 label-primary，选中背景
 *     由侧栏的 `panelActive` 处理）；`active === true` 时再加一层强调色
 *     作为选中态提示。
 *
 * 注意该子树位于 `.skp-panel` **之外**，拿不到本插件的 `--skp-*` 令牌，
 * 样式只能用宿主 `--dsw-alias-*`（与 styles.ts 里 `.skp-composer-*` 同约定）。
 */
export function CapabilityPanelNavIcon({ size, active }) {
    const px = typeof size === "number" && Number.isFinite(size) ? Math.min(20, Math.max(16, size)) : 18;
    return (_jsx("span", { className: active === true ? "skp-nav-glyph skp-nav-glyph-active" : "skp-nav-glyph", "aria-hidden": "true", children: _jsx("svg", { width: px, height: px, viewBox: "0 0 24 24", fill: "none", focusable: "false", "aria-hidden": "true", children: _jsx("path", { d: "M12 2.2 14.1 9.9 21.8 12 14.1 14.1 12 21.8 9.9 14.1 2.2 12 9.9 9.9Z", fill: "currentColor" }) }) }));
}
