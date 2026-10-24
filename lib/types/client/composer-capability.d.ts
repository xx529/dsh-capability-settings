/**
 * 输入框下方的「本会话能力」配置区（Composer Capability Dock）。
 *
 * 两个入口（在 src/client.ts 注册）：
 * 三个入口（在 src/client.ts 注册）：
 *   - 首屏（hero）：`conversation.input.dock` 里的零高锚点 + `position: fixed`
 *     面板，位置跟随输入卡（[data-composer-card] 的 rect + ResizeObserver），
 *     视觉上落在输入框下方、默认展开；active 相位该组件返回 null。
 *   - 会话中（conversation.view，顶部 Tab「能力」）：整页管理本会话能力；
 *     进入该 Tab 时会临时隐藏输入框（不需要对话输入），切回其它 Tab 恢复。
 *
 * 语义：所有开关只写入**当前会话**（内存态、不落盘），不改项目默认。
 *   - Skills：关闭 = 宿主 agent 作用域注册同名 runtime shadow（只可关闭/恢复，
 *     不能强制开启文件级禁用项）；
 *   - MCP：复用既有会话开关（项目条目挂载/卸载，global/外部实例 restrict）。
 *
 * 组件完全自绘：样式在 styles.ts 的 `skp-dock-*` 类（只用宿主 `--dsw-*` token，
 * 因为 composer 子树拿不到 `.skp-panel` 的 `--skp-*`）。
 *
 * @module dsh-capability-settings/client/composer-capability
 */
import type { ReactNode } from "react";
import type { CapabilityPanelApi, ClientMcpRuntimeServer, ClientMcpServer, ClientSkillSummary } from "./api.js";
import { type MountInfo } from "./mcp-common.js";
export interface CapabilitySnapshot {
    skills: ClientSkillSummary[];
    servers: ClientMcpServer[];
    externals: ClientMcpRuntimeServer[];
    mounts: Record<string, MountInfo>;
    settling: boolean;
}
export interface SkillRow {
    id: string;
    kind: "skill";
    name: string;
    description: string;
    tag: string;
    enabled: boolean;
    disabled: boolean;
    meta?: string;
}
export interface McpRow {
    id: string;
    kind: "mcp";
    name: string;
    tag: string;
    meta: string;
    enabled: boolean;
    disabled: boolean;
    dot: string;
    /** 写会话开关时的 target（项目条目 = key；global/外部 = serverName）。 */
    target: string;
    writeKind: "project" | "server";
    /** restrict 无法生效的外部实例（按会话注入）。 */
    locked: boolean;
}
export type Row = SkillRow | McpRow;
/** 能力面板域 Tab（`onManage` 可指定打开哪个 Tab，由 src/client.ts 接线）。 */
export type PanelDomain = "skills" | "mcp" | "jev";
/**
 * 宿主 `conversation.input.dock` 槽透传的 standardProps 子集。
 *
 * 真机契约（app.asar 只读核对）：该槽 ownerProps 为 `InputZone { session, input }`，
 * standardProps 含 `useInput: SnapshotSelectorHook<InputState>`。旧外壳可能两者都
 * 没有，因此全部可选。
 */
export interface HeroSlotProps {
    /** 订阅式草稿选择器（首选草稿来源，变化即重渲染）。 */
    useInput?: (selector: (state: any) => string) => string;
    /** 点时刻草稿（InputZone ownerProps，次选）。 */
    input?: {
        draft?: string;
    };
    sessionId?: string;
}
/** `ComposerCapabilityHero` 的入参（由 `src/client.ts` 的槽注册回调装配）。 */
export interface ComposerCapabilityHeroProps {
    api: CapabilityPanelApi;
    /** 打开能力面板；传 `"jev"` 时停在「Jev 模型」Tab。 */
    onManage?: (domain?: PanelDomain) => void;
    /** 宿主槽 standardProps（`useInput` / `input`），旧外壳可能不传。 */
    slotProps?: HeroSlotProps;
}
export declare function buildSkillRows(snapshot: CapabilitySnapshot, pending: Record<string, boolean>): SkillRow[];
export declare function buildMcpRows(snapshot: CapabilitySnapshot, pending: Record<string, boolean>): McpRow[];
export declare function CapabilityCard({ row, busy, onToggle }: {
    row: Row;
    busy: boolean;
    onToggle: () => void;
}): import("react").JSX.Element;
type TabId = "skills" | "mcp";
interface PanelProps {
    mode: "dock" | "hero" | "overlay" | "view";
    loading: boolean;
    error?: string;
    snapshot: CapabilitySnapshot;
    skillRows: SkillRow[];
    mcpRows: McpRow[];
    pending: Record<string, boolean>;
    busy: Record<string, boolean>;
    onToggle: (row: Row) => void;
    onReset: () => void;
    onRefresh: () => void;
    onCollapse: () => void;
    onManage?: () => void;
    onRetry?: () => void;
    /** 入口「✦ 能力决策」（展开态在 tabs 行右侧；仅 hero 传入）。 */
    decisionEntry?: ReactNode;
    /** 自动触发默认关闭的弱提示（与入口同排，窄容器隐藏）。 */
    decisionHint?: string;
    /** 自动触发停顿倒计时（aria-live="off"，不干扰读屏）。 */
    decisionWaiting?: {
        elapsedMs: number;
        pauseMs: number;
    } | undefined;
}
export declare function CapabilityPanel(props: PanelProps & {
    initialTab?: TabId;
}): import("react").JSX.Element;
export declare function CapabilityBar({ skillRows, mcpRows, loading, onExpand, decisionEntry, }: {
    skillRows: SkillRow[];
    mcpRows: McpRow[];
    loading: boolean;
    onExpand: () => void;
    /** 入口「✦ 能力决策」（紧邻「配置」左侧；仅 hero 传入）。 */
    decisionEntry?: ReactNode;
}): import("react").JSX.Element;
export declare function ComposerCapabilityHero(props: ComposerCapabilityHeroProps): import("react").JSX.Element;
export declare function SessionCapabilityView({ apiFor, sessionId: initialSessionId, onManage, }: {
    apiFor: (sessionId: string | undefined) => CapabilityPanelApi;
    sessionId?: string;
    onManage?: () => void;
}): import("react").JSX.Element;
export {};
