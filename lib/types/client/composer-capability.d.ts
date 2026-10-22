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
 * @module @chengdb/capability-panel/client/composer-capability
 */
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
}
export declare function CapabilityPanel(props: PanelProps & {
    initialTab?: TabId;
}): import("react").JSX.Element;
export declare function CapabilityBar({ skillRows, mcpRows, loading, onExpand }: {
    skillRows: SkillRow[];
    mcpRows: McpRow[];
    loading: boolean;
    onExpand: () => void;
}): import("react").JSX.Element;
export declare function ComposerCapabilityHero({ api, onManage }: {
    api: CapabilityPanelApi;
    onManage?: () => void;
}): import("react").JSX.Element;
export declare function SessionCapabilityView({ apiFor, sessionId: initialSessionId, onManage, }: {
    apiFor: (sessionId: string | undefined) => CapabilityPanelApi;
    sessionId?: string;
    onManage?: () => void;
}): import("react").JSX.Element;
export {};
