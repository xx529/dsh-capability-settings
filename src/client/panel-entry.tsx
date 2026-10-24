/**
 * 能力面板的**入口外壳**：主区域页面包装 + 侧栏 `sidebar.panellist` 图标。
 *
 * 两处注册都在 client.ts（root 作用域，成对出现）：
 *   - `main` keyed slot，`key: 'capability-panel'` → `CapabilityPanelPage`：
 *     侧栏点击入口后，主区域（layout 的 centerCol）渲染的就是它，与
 *     plugins / schedules / dsh-context 同构。main 槽的 owner props 为空，
 *     但框架会注入一组 standardProps（usePanelInfo / useSessions / …）；
 *     本页面不消费它们，只接自己的 `api`。
 *   - `sidebar.panellist` list slot，`id: 'capability-panel'` →
 *     `CapabilityPanelNavIcon`：只提供**图标本体**。按钮（tooltip、
 *     `aria-label`、折叠提示、label 文本、选中背景）全部由侧栏渲染：
 *     它把注册组件包在 `<span class="…panelGlyph" aria-hidden="true">` 里，
 *     owner props 为 `{ size, active }`（size = 侧栏展开 16 / 收起 18）。
 *
 * 因此这里**不要**再包一层 button，也不要渲染 label 文本（会与侧栏自己的
 * label 重复）；图标颜色默认继承侧栏按钮的 `currentColor`。
 *
 * 面板 API 有两份（钉选 / 不钉选），区别与防回归说明见 panel.tsx 顶部注释
 * 与 client.ts 的 `composerApi` 定义。
 *
 * @module dsh-capability-settings/client/panel-entry
 */

import type { CapabilityPanelApi } from "./api.js";
import { CapabilityPanel } from "./panel.js";

/**
 * 主区域页面：把面板本体铺满 layout 的主区域。
 *
 * `.skp-panel` 自带 `height:100%;display:flex;flex-direction:column`；外面这层
 * `.skp-main` 负责在主区域的 flex 列里撑满高度并把内部滚动限制在页面内
 * （`min-height:0` 让 `.skp-body` 的 `flex:1` 能收缩、列表/详情各自滚动，
 * 而不是把整页顶高）。背景改用宿主的基色，避免"卡片底色"被当成整页底色。
 */
export function CapabilityPanelPage({ api }: { api: CapabilityPanelApi }) {
  return (
    <div className="skp-main">
      <CapabilityPanel api={api} />
    </div>
  );
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
export function CapabilityPanelNavIcon({ size, active }: { size?: number; active?: boolean }) {
  const px = typeof size === "number" && Number.isFinite(size) ? Math.min(20, Math.max(16, size)) : 18;
  return (
    <span className={active === true ? "skp-nav-glyph skp-nav-glyph-active" : "skp-nav-glyph"} aria-hidden="true">
      {/* 四角星（沿用旧底部入口的 ✦ 语义），纯 currentColor，零原语依赖。 */}
      <svg width={px} height={px} viewBox="0 0 24 24" fill="none" focusable="false" aria-hidden="true">
        <path d="M12 2.2 14.1 9.9 21.8 12 14.1 14.1 12 21.8 9.9 14.1 2.2 12 9.9 9.9Z" fill="currentColor" />
      </svg>
    </span>
  );
}
