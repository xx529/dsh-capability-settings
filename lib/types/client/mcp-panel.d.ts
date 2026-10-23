/**
 * Capability Panel 的 MCP 域视图。
 *
 * 布局与 Skills 域**同构**：左侧「全局 / 项目」作用域导航（ScopeNav）+ 中间
 * 列 + 右侧详情。项目 scope 下，工作区列表挂在 ScopeNav「项目」行下方（名称 =
 * 目录 basename，点选后钉选该项目，列表自身滚动；全局 scope 隐藏）；中间列只
 * 渲染当前列表标题与条目，未选工作区时显示「请选择左侧工作区」。全局 scope 显示
 * `~/.agents/mcp.json` 条目，并把「外部注入」（其它插件 / profile 在运行时挂载的
 * mcp-client）作为**第二组**只读展示（保留组头与计数，为空时不占位）。搜索框在
 * 根组件头部，由 `query` prop 传入，只过滤当前列表（全局 → server 名/summary；
 * 项目未选工作区 → 左侧工作区名/路径；项目已选 → server）。组容器样式由
 * styles.ts 的 `.skp-group*` / `.skp-scope-workspaces*` 统一提供（与 Skills 域共用）。
 *
 * 行 = 状态点 + 名称 + 标签（项目/全局/引用/导入/外部 + stdio/http +
 * 默认关闭/被遮蔽）+ meta（挂载状态 · 工具数）+ 命令/URL 摘要 + 行尾
 * 「默认」开关（语义不变 = 新建对话是否启用，写项目级 overrides 的 mcp 列表）。
 * 行内不提供文字按钮：启用/编辑/删除/导入/探测/使用记录都在详情卡。
 *
 * 详情把「工具与参数」做成左右两栏（ToolsInspector）：左侧工具列表可点选，
 * 右侧是该工具的参数表（参数/类型/必填/说明，来自 inputSchema 的
 * `properties` + `required`）；配置条目由「查看工具与参数」真连一次探测
 * （零副作用，见 `mcp/probe.ts`），外部注入实例直接取运行时注册表里的工具。
 *
 * @module @chengdb/capability-panel/client/mcp-panel
 */
import type { CapabilityPanelApi } from "./api.js";
/**
 * MCP 视图主组件：左侧「全局 / 项目」导航 + 中间列（全局列表 / 工作区选择 /
 * 某工作区的项目列表）+ 右侧详情。
 *
 * - **全局**：全局 `~/.agents/mcp.json` 条目 + 「外部注入」只读第二组；
 * - **项目**：中间列先列出所有工作区（点选 → `onSelectWorkspace(path)`），
 *   选中后显示该工作区 `.mcp.json` 的条目，顶部「‹ 工作区」可返回重选；
 * - **搜索**来自根组件头部输入框（`query` prop），只过滤当前列表；
 * - scope / 工作区切换清空选中；行尾「默认」开关写项目级 overrides（语义不变），
 *   行内没有文字按钮——启停/编辑/删除/导入/探测/使用记录都在详情卡。
 */
export declare function McpView({ api, query, projects, workspace, pinned, onSelectWorkspace, onCount, }: {
    api: CapabilityPanelApi;
    /** 根组件头部搜索框的值（即时本地过滤当前列表；不跨 scope）。 */
    query: string;
    /** 可选工作区列表（项目 scope 的工作区选择页用）。 */
    projects: Array<{
        path: string;
        title?: string;
    }>;
    /** 当前作用域解析出的工作区（完整路径；无工作区时是占位串）。 */
    workspace?: string;
    /** 显式钉选的工作区路径；undefined = 尚未选择工作区。 */
    pinned?: string;
    /** 选择/切换工作区（传 undefined = 回到工作区列表）。 */
    onSelectWorkspace(path?: string): void;
    /**
     * 数据到达后上报配置条目总数（本项目 + 全局，**不含**外部注入实例），供域 Tab
     * 计数；搜索不影响计数（外部注入在全局 scope 的第二组里单独显示计数）。
     */
    onCount?: (total: number) => void;
}): import("react").JSX.Element;
