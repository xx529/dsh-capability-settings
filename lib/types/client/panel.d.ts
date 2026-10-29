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
 *   - composer（输入框工具行：Skills / MCP 按钮与弹层）在 client.ts 中用
 *     单独的 `composerApi`：`currentWorkspaceCwd` **只**取当前会话自己的
 *     工作区，`selectedProject()` 恒为 undefined。两者共用同一份
 *     `subscribeWorkspace` 回调集合，因此都会随会话工作区切换刷新。
 *   若把面板这份 api 交给 composer，就会出现在面板里把项目作用域钉到 A
 *   工作区后、B 工作区的对话框弹层列出 A 的项目级技能/MCP 的串味 bug。
 *
 * 根容器按能力域分 Tab（**只剩两个**：技能 / MCP，带数据量计数），第二行
 * 是「域 Tab + 搜索框」：搜索框由根组件持有，按域切换 placeholder，两个
 * 视图只接收 `query` 做本地过滤（视图内不再有搜索/安装行）：
 *   - Skills：左列 200–220px 的 ScopeNav（全局 / 项目 + 行尾「+」安装），
 *     中间列按 scope 显示全局技能、工作区选择列表或选中工作区的项目技能
 *     （项目 scope 未选工作区时先列全部工作区，点击 = `api.selectProject`）；
 *     详情页带完整文件树 + SKILL.md 阅读器（见 skill-content.tsx）；
 *   - MCP：同构的左导航 + 中间列（全局含外部注入 / 项目→工作区下钻），
 *     带每个 session 的实时挂载状态（见 mcp-panel.tsx）。
 *
 * 快捷消息域已整体下线（2026-10 产品决定），域 Tab 不再有第三个入口。
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
