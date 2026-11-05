/**
 * 会话能力弹层 / 会话「能力」Tab 的第 4 个域：Prompt（首轮注入的指令文件，v23）。
 *
 * 语义（与宿主 `src/prompt/*` 对齐）：
 *   - 候选 = 全局 `~/.dsh/AGENTS.md`、`~/.agents/AGENTS.md` + 项目根→cwd 每层的
 *     `AGENTS.md` / `CLAUDE.md`（含 `*.local.md`）；全局与项目**叠加注入**，不是覆盖；
 *   - 首屏（hero / modal）可编辑：卡片开关写**本会话首屏显式选择**
 *     `api.prompt.setSessionSelection({ selected })`；默认全选 = 未设置选择时
 *     `list().files[].enabled` 全为 true（与 DSH 原生一致）；
 *   - 会话内（view）只读：数据以 `list().frozen`（manifest）为唯一权威，
 *     只展示状态、不发任何开关请求；
 *   - Prompt **不参与** Jev 能力决策、不参与三域批量动作（`BULK_DOMAINS` 仍三域）。
 *
 * 为什么单独一个文件：`composer-capability.tsx` 已经 3k 行，Prompt 是独立域；
 * 这里只复用主文件已有的 `skp-dock-*` 样式原语（样式表 `styles.ts` 归他人维护，
 * 本批不改），因此开关/标签/图标在这里各自内联一份小实现（不跨文件循环依赖）。
 *
 * @module dsh-capability-settings/client/prompt-tab
 */
import type { CapabilityPanelApi, ClientPromptFile, ClientPromptList, ClientPromptManifest } from "./api.js";
/** Prompt Tab 的视图状态（面板标题计数与内容共用）。 */
export interface PromptTabData {
    list?: ClientPromptList;
    /** 本会话冻结清单（只读页的唯一权威数据源）。 */
    frozen?: ClientPromptManifest;
    files: ClientPromptFile[];
    loading: boolean;
    error?: string;
    /** 正在写的文件 id（写会话选择期间禁用全部开关）。 */
    pendingId?: string;
    /** 首屏：当前会注入的文件数（`enabled`）。 */
    enabledCount: number;
    /** 只读页：首轮冻结清单里的文件数。 */
    injectedCount: number;
    fileCount: number;
    refresh: () => void;
    toggle: (file: ClientPromptFile) => void;
}
/**
 * Prompt Tab 数据控制器：`list()` 每会话 API（adapter 自动注入 sessionId）。
 *
 * 写口径（二选一，见 `toggle` 注释）：**与默认启用集合一致时写 `null`**（清除
 * 显式选择、跟随默认层），否则写整份 `selected` 数组。
 *
 * @param api 面板 / 每会话 api（旧宿主可能缺 `prompt`，运行时降级提示）。
 * @param readOnly 只读页（mode="view"）；`true` 时额外读 `manifest` 兜底。
 */
export declare function usePromptTabData(api: CapabilityPanelApi | undefined, readOnly: boolean): PromptTabData;
/**
 * Prompt Tab 内容：banner / 汇总行 / 卡片网格 / （只读）正文预览。
 *
 * @param data `usePromptTabData` 的返回值。
 * @param readOnly 会话内只读（mode="view"）。
 * @param query 页头搜索词（复用面板既有搜索框）。
 * @param onClearQuery 清空搜索（空态里的「清空搜索」）。
 */
export declare function PromptTab({ data, readOnly, query, onClearQuery, }: {
    data: PromptTabData;
    readOnly: boolean;
    query: string;
    onClearQuery?: () => void;
}): import("react").JSX.Element;
