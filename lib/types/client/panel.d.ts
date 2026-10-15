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
 * **两份 api，切勿合并（防回归）**：
 *   - 面板自身用 client.ts 中带「项目钉选」的 `api`：`currentWorkspaceCwd`
 *     是 `selection.cwd ?? 当前会话工作区`，所以头部「项目作用域」下拉框
 *     能把项目级视图钉到任意工作区；
 *   - composer（输入框工具行：快捷消息 / Skills / MCP 三个按钮与弹层）在
 *     client.ts 中用单独的 `composerApi`：`currentWorkspaceCwd` **只**取当前
 *     会话自己的工作区，`selectedProject()` 恒为 undefined。两者共用同一份
 *     `subscribeWorkspace` 回调集合，因此都会随会话工作区切换刷新。
 *   若把面板这份 api 交给 composer，就会出现在面板里把项目作用域钉到 A
 *   工作区后、B 工作区的对话框弹层列出 A 的项目级技能/MCP 的串味 bug。
 *
 * 根容器按能力域分 Tab：
 *   - 快捷消息：项目 + 全局快捷语，支持搜索/过滤与详情视图（见
 *     `quick-messages-panel.tsx`）；
 *   - Skills：项目 + 全局技能，支持搜索/过滤与详情视图；
 *   - MCP：项目 `.mcp.json` + 全局 `mcp.json` 的 server 管理，
 *     带每个 session 的实时挂载状态（见 `mcp-panel.tsx`）。
 *
 * 布局刻意保持朴素（自带 CSS 类，见 styles.ts），对未经确认的 UI 原语
 * 组件零硬依赖。
 *
 * @module @chengdb/capability-panel/client/panel
 */
import type { CapabilityPanelApi } from "./api.js";
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
