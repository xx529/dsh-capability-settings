/**
 * 能力面板 · Tools 域（v13 R3 / 帧 06）。
 *
 * Tools 是**全局工具注册**，没有项目 / 工作区维度（UX v1.8 §2.4 / §2.5）：
 * 因此本视图没有左导航、没有工作区列表，只有**两栏**：
 *   - 左：插件单元列表（一个插件 = 一个开关单元，`N 个工具`）；
 *   - 右：插件详情 + **只读**工具清单（无逐工具开关、无参数表）。
 *
 * 开关语义（A5 已拍板「主面板也要能开关」）：主面板自身没有 sessionId，
 * 由 `api.currentSessionId()` 从客户端 sessions 快照解析当前会话：
 *   - 解析到 → 行/详情开关可点，写 `tools.setSessionEnabled`（只作用于该会话，
 *     不改项目默认）；
 *   - 解析不到 → 开关置灰 + 提示 `请在对话首屏设置本会话开关`（只读）。
 *
 * 契约：docs/architecture/v13-implementation.md §5.1 / §9.4 / 附录 A。
 *
 * @module dsh-capability-settings/client/tools-panel
 */
import type { CapabilityPanelApi } from "./api.js";
/**
 * Tools 域视图：两栏（插件列表 + 详情/只读工具清单），无左导航。
 *
 * @param query 根组件头部搜索框的值（按插件名 / 工具名 / 工具说明本地过滤）。
 * @param workspace 当前工作区（只作为重新拉取的信号：会话切换后 currentSessionId 可能变化）。
 */
export declare function ToolsView({ api, query, workspace, onCount, }: {
    api: CapabilityPanelApi;
    query: string;
    workspace?: string;
    /** 数据到达后上报单元总数（域 Tab 计数）。 */
    onCount?: (count: number) => void;
}): import("react").JSX.Element;
