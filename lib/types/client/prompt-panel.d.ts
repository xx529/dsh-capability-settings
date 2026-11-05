/**
 * 能力面板 · Prompt 域（v23）：首轮注入的指令文件（AGENTS.md / CLAUDE.md / *.local.md）。
 *
 * 语义边界（与宿主 `prompt/manager.ts` 对齐，客户端只展示与写策略）：
 *   - **全局与项目 prompt 叠加注入**（不是覆盖），每个文件独立启用；
 *   - 列表只包含**已存在**的文件（宿主已过滤），不出现「未创建 / 未识别」占位；
 *   - 渲染 / trim 去重 / 预算截断 / framing 全部由宿主完成，客户端不算；
 *   - **行内开关位置与 Skills / MCP 一致**：
 *       · 全局视图：行内**没有**单开关；全局 prompt 的「可见范围 / 每工作区默认」
 *         在行尾「可见：…」chip 打开的弹层里配；
 *       · 工作区视图：全局 prompt 行尾开关 = **本工作区默认**（写
 *         `prompt.setVisibility`，保留 mode 与其它工作区，只改
 *         `workspaces[list.projectRoot].defaultEnabled`）；项目 prompt 行尾开关 =
 *         **本项目默认**（写 `prompt.setProjectDefault`，key 口径由宿主按 cwd 向上找 `.git`）；
 *   - **冻结会话**（`list.frozen !== undefined`）：详情只读、隐藏编辑与开关，提示
 *     「本会话已冻结」。
 *
 * 详情页沿用 v22 外壳（`detail-shell.tsx`）：标题行 / 状态条 / 内容工具条 / 内容区；
 * 预览用 `MarkdownPreview`，编辑用 `.skp-prompt-editor` textarea，保存后仅新会话生效。
 *
 * @module dsh-capability-settings/client/prompt-panel
 */
import type { CapabilityPanelApi, WorkspaceOption } from "./api.js";
/**
 * Prompt 域视图：两栏（文件名列表 + 详情 / 编辑器）。
 *
 * - 全局视图：只列**全局** prompt（`file.scope !== "project"`）；行尾是「可见：…」chip；
 * - 工作区视图：全局 prompt（叠加注入）+ 项目链 prompt；行尾开关写默认层；
 * - 搜索来自根组件头部输入框（`query` prop），只过滤当前列表。
 *
 * @param query 根组件头部搜索框的当前值。
 * @param workspace 当前工作区路径（undefined = 全局视图）。
 * @param projects 全部已知工作区（可见范围弹层用）。
 */
export declare function PromptView({ api, workspace, projects, query, onCount, }: {
    api: CapabilityPanelApi;
    /** 当前工作区路径（undefined = 全局作用域）。 */
    workspace?: string;
    /** 全部已知工作区（可见范围弹层 / 工作区默认用）。 */
    projects?: WorkspaceOption[];
    /** 根组件头部搜索框的当前值。 */
    query: string;
    /** 数据到达后上报「已启用文件数」（域 Tab 计数）。 */
    onCount?: (count: number) => void;
}): import("react").JSX.Element;
