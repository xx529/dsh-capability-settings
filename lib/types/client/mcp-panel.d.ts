/**
 * Capability Panel 的 MCP 域视图（v20.1 能力中心）。
 *
 * 与 Skills 域**同构的两栏**：列表 + 详情。作用域唯一入口在根组件 header
 * （全局 / 工作区 ▾，工作区下拉列出全部工作区），**左栏 ScopeNav 已删除**，
 * 面板与当前对话所在工作区解耦、默认进入全局。列表标题栏固定写
 * 「全局 MCP」/「HtDot · MCP」+ 计数 + 作用域提示 + 内联「＋ 添加 MCP」。
 *
 * - **全局作用域**：`~/.agents/mcp.json` 条目（行尾开关 = 全局默认，写配置
 *   文件 `disabled`）；「外部注入」（其它插件 / profile 在运行时挂载的
 *   mcp-client）作为第二组，**配置只读、默认开关可写**：全局视图写独立文件
 *   `capability-global-overrides.json` 的 `mcp` 名单（不改注入方配置、不卸载实例）；
 * - **工作区作用域**：该工作区 `.mcp.json` 条目 + 引用的全局配置；行尾开关 =
 *   该工作区的默认（写项目 overrides，仅此工作区生效）；
 * - 按契约 §3.6：**不展示某会话的挂载状态**；连接健康以详情「查看工具与参数」
 *   的真实探测结果为准（零副作用，见 `mcp/probe.ts`）；
 * - 详情用同款两段作用域链（全局 → 工作区），只到工作区。
 *
 * 搜索框在根组件头部，由 `query` prop 传入，只过滤当前列表。行内不提供文字
 * 按钮：启用/编辑/删除/引用/探测/使用记录都在详情卡。
 *
 * @module dsh-capability-settings/client/mcp-panel
 */
import type { CapabilityPanelApi } from "./api.js";
/**
 * MCP 视图主组件（v20.1）：**两栏**（列表 + 详情），不再有左栏 ScopeNav。
 *
 * - **全局作用域**：全局 `~/.agents/mcp.json` 条目（开关 = 全局默认，写配置文件
 *   `disabled`）+ 「外部注入」（配置只读，行尾开关写全局默认关闭名单）；
 * - **工作区作用域**：该工作区 `.mcp.json` 条目（本项目） + 引用的全局配置；
 *   行尾开关 = **该工作区的默认**（写项目 overrides，仅此工作区生效；外部注入
 *   行可覆盖全局默认）；
 * - **搜索**来自根组件头部输入框（`query` prop），只过滤当前列表；
 * - 列表标题栏固定「类型 + 作用域」+ 计数 + 内联「＋ 添加 MCP」，落点由
 *   当前作用域直接确定；行内没有文字按钮——启停/编辑/删除/导入/探测都在详情卡。
 * - 按契约 §3.6：不展示「某会话的挂载状态」（挂载是会话级事实），连接健康
 *   以详情页「查看工具与参数」的真实探测结果为准。
 */
export declare function McpView({ api, query, projects, workspace, onSelectWorkspace, onCount, }: {
    api: CapabilityPanelApi;
    /** 根组件头部搜索框的值（即时本地过滤当前列表；不跨作用域）。 */
    query: string;
    /** 全部已知工作区（作用域链入口选项；不再在左栏列出）。 */
    projects: Array<{
        path: string;
        title?: string;
    }>;
    /** 当前工作区路径（undefined = 全局作用域）。 */
    workspace?: string;
    /** 切换作用域（传 undefined = 回全局）。 */
    onSelectWorkspace(path?: string): void;
    /** 数据到达后上报当前作用域总数（域 Tab 计数）。 */
    onCount?: (total: number) => void;
}): import("react").JSX.Element;
