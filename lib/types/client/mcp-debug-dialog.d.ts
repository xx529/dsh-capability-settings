/**
 * MCP 工具「调试调用」弹窗（v25）。
 *
 * 入口在 MCP 详情页「工具与参数」右栏：当前选中工具标题右侧的「▶ 调试」。
 * 弹窗按工具的 `inputSchema` 生成参数表单（表单 / JSON 双模式），执行一次真实
 * 的 MCP 工具调用，并在同一滚动区内就地展示结果。
 *
 * 数据来源两条路径（宿主 `mcp.invoke`）：
 *   - 配置条目：传 `entry` + `key`，宿主起一次性连接 `callTool`（不挂载、
 *     不影响正在运行的对话，与「测试连接」同源）；
 *   - 外部注入实例：传 `serverName`，宿主走已挂载工具注册表（`tools.execute`）；
 *     仅全局可见实例可调，其余返回业务失败并说明。
 *
 * 交互约定（与 Figma v25 一致）：
 *   - 参数区**保持展开**；结果紧接参数下方，执行完成后自动滚动到结果；
 *   - 关闭后再次打开同一工具会恢复草稿与上次结果（模块级内存缓存，切换服务器
 *     不清空；进程重载即清空）；
 *   - Esc 关闭、⌘/Ctrl + Enter 执行；执行中可取消（AbortSignal 传到宿主）。
 *
 * @module dsh-capability-settings/client/mcp-debug-dialog
 */
import type { ClientMcpTool, McpApi } from "./api.js";
import type { McpServerEntry } from "../mcp/types.js";
/** 同服务器的其它工具（用于「元素字段按某个工具 schema 推断」）。 */
export interface DebugSchemaContext {
    tools?: readonly {
        name: string;
        parameters?: Record<string, unknown>;
    }[];
}
/** 调试弹窗：参数表单 + 执行 + 结果（同一滚动区）。 */
export declare function McpDebugDialog({ api, serverLabel, serverName, entry, entryKey, tool, serverTools, onClose, }: {
    api: McpApi;
    /** 服务器展示名（头部徽章）。 */
    serverLabel: string;
    /** 同服务器的其它工具（用于自由格式 object 元素的字段推断）。 */
    serverTools?: readonly ClientMcpTool[];
    /** 外部注入实例路径：serverName。 */
    serverName?: string;
    /** 配置条目路径：条目本身 + 键名。 */
    entry?: McpServerEntry;
    entryKey?: string;
    tool: ClientMcpTool;
    onClose: () => void;
}): import("react").JSX.Element;
