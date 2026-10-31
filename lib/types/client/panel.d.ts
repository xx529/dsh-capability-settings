/**
 * Capability Panel 的 React 视图（占据**主区域**的页面，不再是浮层）。
 *
 * 入口在**侧栏上方**：本插件向 `sidebar.panellist`（ui-sidebar 的「全局
 * 面板」图标排，位于工作区列表之上、`sidebar.settings` 页脚之上）注册
 * `{ id: 'capability-panel', order: 30, label: '能力面板' }` 与图标本体，
 * 并向 `main` keyed slot 注册同名的 `key: 'capability-panel'` 页面组件。
 * 侧栏自己渲染按钮 / tooltip / label 文本，点击时把主区域切到该 key
 * （与 plugins / schedules / dsh-context 同构）；两者必须成对注册——侧栏
 * 选择没有对应 main 条目的 id 会抛错。浮层外壳、backdrop 与关闭按钮都已
 * 随之删除。
 *
 * **v20.1 信息架构（能力中心）**：只保留两条轴 + 一个解释层。
 *   1. 类型 = Tab（Skills / MCP / Tools，Jev 用分隔线单独成组）；
 *   2. 作用域 = 头部常驻分段控件（全局 / 工作区 ▾，工作区下拉列出全部
 *      工作区）——**面板与当前对话所在工作区完全解耦，默认进入全局**；
 *      `src/client.ts` 的面板 api `currentWorkspaceCwd = () => selection.cwd`
 *      （undefined = 全局，禁止 session fallback）；
 *   3. 详情 = 两段作用域链（全局 → 工作区，逐段标 继承 / 覆盖 / 来源）；
 *      **面板不涉及会话层级**，会话级开关在对话上方的「能力」Tab。
 *
 * 左栏 ScopeNav / 工作区列表已删除；列表标题栏固定写「类型 + 作用域」
 * （`全局 Skills` / `HtDot · Skills` / `HtDot · MCP`）+ 计数 + 作用域提示 +
 * 内联「＋ 添加 Skill / ＋ 添加 MCP」入口，弹窗落点由当前 Tab × 当前作用域
 * 直接确定（不再二次选择）。
 *
 * **两份 api，切勿合并（防回归）**：面板这份 api 的 cwd 只取用户在面板里
 * 显式选择的作用域；composer（输入框工具行 / 首屏入口）在 client.ts 中用
 * 单独的每会话 api，`currentWorkspaceCwd` 只取该会话自己的工作区。两者共用
 * 同一份 `subscribeWorkspace` 回调集合。若把面板这份 api 交给 composer，
 * 就会出现跨工作区串味 bug。
 *
 * 布局刻意保持朴素（自带 CSS 类，见 styles.ts），对未经确认的 UI 原语
 * 组件零硬依赖。
 *
 * @module dsh-capability-settings/client/panel
 */
import type { CapabilityPanelApi } from "./api.js";
/**
 * 域 Tab 的取值（v13：Skills / MCP / Tools / Jev 模型四域）。
 * `jev` 是配置页而不是条目域：无计数、无搜索、无左导航（见 UX v1.8 §7.1）；
 * `tools` 是全局工具注册：无项目 / 工作区维度、无左导航（见 UX v1.8 §2.5）。
 * 导出给 client.ts 的 `openCapabilityPanel(domain?)` 复用。
 */
export type DomainTab = "skills" | "mcp" | "tools" | "jev";
/**
 * 请求能力面板切到指定域（由 client.ts 的 `openCapabilityPanel(domain?)` 在
 * `layout.selectPanel("capability-panel")` 之前调用）。
 *
 * 覆盖两种时序：
 *   - 面板**已挂载**：派发 `capability-panel:set-domain`，组件监听后立即切 Tab；
 *   - 面板**未挂载**：目标留在模块级 pending，组件首次渲染直接落在该域
 *     （hero「去配置」因此能一步打开 Jev Tab，AC-ENT-4）。
 *
 * `undefined` = 保持当前域（无参打开面板的旧行为）。
 */
export declare function setPanelDomain(domain?: DomainTab): void;
/**
 * 面板根组件：头部（标题 + 项目下拉框 + 域 Tab）+ 当前域视图。
 *
 * 它是主区域页面的本体（见 panel-entry.tsx 的 CapabilityPanelPage），自带
 * `.skp-panel`（height:100% / flex column），因此不再需要浮层外壳与关闭
 * 按钮——关闭 = 侧栏切换到别的主面板。
 */
export declare function CapabilityPanel({ api }: {
    api: CapabilityPanelApi;
}): import("react").JSX.Element;
