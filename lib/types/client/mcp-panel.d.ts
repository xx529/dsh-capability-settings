/**
 * Capability Panel 的 MCP 域视图。
 *
 * 列表**同屏三组**（取消旧的「项目 / 全局」二选一 Tab）：
 *  - 本项目 `<项目根>/.mcp.json`：随项目生效，可启停/编辑/删除；
 *  - 全局 `~/.agents/mcp.json`：所有项目共享，面板里只做「导入到本项目」/
 *    编辑/删除（启停靠项目级引用或默认开关）；
 *  - 外部注入：其它插件 / profile 在运行时挂载的 mcp-client，只读，
 *    仅在该组非空时渲染。
 * 搜索跨三组即时过滤（key / serverName / summary，外部实例另匹配 source）；
 * 每组独立滚动（组头固定 + 组内滚动），组头带计数与一句说明。组容器样式
 * 由 styles.ts 的 `.skp-group*` 统一提供（与 Skills 域共用同一套）。
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
 * MCP 视图主组件：状态管理 + 拉取/重拉 + 三组列表 + 详情/表单。
 *
 * 写操作语义不变：项目条目可启停/编辑/删除；全局条目可「导入到本项目」
 * （登记项目级引用，内容跟随全局）/编辑/删除；外部注入只读。默认开关写
 * 项目级 overrides（新建对话的默认启用状态）。
 */
export declare function McpView({ api, workspace, onCount, }: {
    api: CapabilityPanelApi;
    workspace?: string;
    /**
     * 数据到达后上报配置条目总数（本项目 + 全局，**不含**外部注入实例），供域 Tab
     * 计数；搜索不影响计数（外部注入在组 C 单独显示计数）。
     */
    onCount?: (total: number) => void;
}): import("react").JSX.Element;
