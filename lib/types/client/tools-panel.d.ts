/**
 * 能力面板 · Tools 域（v13 R3 / 帧 06；v21 纳入可见性与工作区默认）。
 *
 * Tools 是**全局工具注册**：一个插件 = 一个开关单元，无单工具开关。两栏布局：
 *   - 左：插件单元列表；
 *   - 右：插件详情 + 只读工具清单（手风琴；schema 由 `tools.inspect` 懒加载）。
 *
 * 三层开关（v21，与 Skills / MCP 同构）：
 *   1. **可见性（全局唯一控制，按工作区）**：全局视图行内标签 + 「可见范围」编辑
 *      （`overrides.globalGet().visibility.tools` / `overrides.setVisibility`）；
 *   2. **每工作区默认开/关**：可见性弹层里按工作区配置；某工作区没有单独配置时
 *      走兜底 `!全局默认关闭(unit)`（`capability-global-overrides.json` 的 `tools`
 *      ∪ legacy `tools-global.json`，宿主已合并进行字段 `defaultEnabled`）；
 *   3. **工作区覆盖**：工作区视图的行尾开关写项目三态
 *      （`overrides.toggle("tools", unit, {enabled})` → `tools` / `enabledTools`）。
 *
 * 全局视图的行尾开关仍是**全局默认兜底**（`tools.setGlobalEnabled`，写统一全局文件）；
 * 不可见行的默认开关禁用并标「不可见 · 不参与默认」。
 *
 * @module dsh-capability-settings/client/tools-panel
 */
import type { CapabilityPanelApi } from "./api.js";
/**
 * Tools 域视图：两栏（插件列表 + 详情/只读工具清单）。
 *
 * @param query 根组件头部搜索框的值（按插件名 / 工具名 / 工具说明本地过滤）。
 * @param workspace 当前工作区（undefined = 全局视图；v21 起有工作区维度）。
 * @param projects 全部已知工作区（可见性标签 / 弹层 / 每工作区默认用）。
 */
export declare function ToolsView({ api, workspace, projects, query, onCount, }: {
    api: CapabilityPanelApi;
    workspace?: string;
    /** 全部已知工作区；旧调用方 / 测试夹具可缺省（按无工作区渲染）。 */
    projects?: Array<{
        path: string;
        title?: string;
    }>;
    query: string;
    /** 数据到达后上报单元总数（域 Tab 计数；全局口径）。 */
    onCount?: (count: number) => void;
}): import("react").JSX.Element;
