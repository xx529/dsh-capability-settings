/**
 * 能力面板 · Tools 域（v13 R3 / 帧 06）。
 *
 * Tools 是**全局工具注册**，没有项目 / 工作区维度（UX v1.8 §2.4 / §2.5）：
 * 因此本视图没有左导航、没有工作区列表，只有**两栏**：
 *   - 左：插件单元列表（一个插件 = 一个开关单元，`N 个工具`）；
 *   - 右：插件详情 + **只读**工具清单（手风琴；schema 由 `tools.inspect` 懒加载，
 *     可展开看参数表与原始 JSON）。
 *
 * 开关语义（**覆盖 v13 A5**）：能力面板 = **全局默认**（所有会话），
 * 会话首屏 /「能力」Tab = **本会话覆盖**（全局关闭时仍可在首屏单独开启）。
 * 因此本页：
 *   - 行 / 详情开关展示并写 `defaultEnabled`（`tools.setGlobalEnabled`），
 *     不需要 sessionId，也不显示任何具体会话状态；
 *   - 详情补一句「本会话可在对话首屏单独覆盖」，把两层关系说清。
 *
 * 契约：docs/architecture/v13-implementation.md §5.1 / §9.4 / 附录 A +
 * task-20 两层语义（`defaultEnabled` / `enabled`、`tools.setGlobalEnabled`）。
 *
 * @module dsh-capability-settings/client/tools-panel
 */
import type { CapabilityPanelApi } from "./api.js";
/**
 * Tools 域视图：两栏（插件列表 + 详情/只读工具清单），无左导航。
 *
 * @param query 根组件头部搜索框的值（按插件名 / 工具名 / 工具说明本地过滤）。
 * @param workspace 当前工作区（只作为重新拉取的信号：工作区/会话切换时刷新列表）。
 */
export declare function ToolsView({ api, query, workspace, onCount, }: {
    api: CapabilityPanelApi;
    query: string;
    workspace?: string;
    /** 数据到达后上报单元总数（域 Tab 计数）。 */
    onCount?: (count: number) => void;
}): import("react").JSX.Element;
