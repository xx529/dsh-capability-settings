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
import type { CapabilityPanelApi, ClientMcpRuntimeServer, ClientMcpServer, ClientSkillSummary, ClientToolsUnit, SessionBulkAction, SessionBulkDomain, SessionBulkFailure } from "./api.js";
import { type MountInfo } from "./mcp-common.js";
export interface CapabilitySnapshot {
    skills: ClientSkillSummary[];
    servers: ClientMcpServer[];
    externals: ClientMcpRuntimeServer[];
    /** Tools 域（v13）：插件级开关单元；tools 服务不可用时降级为空数组。 */
    tools: ClientToolsUnit[];
    /** true = 宿主仍在解析插件归属（task-32 additive）：首屏显示轻量「来源解析中…」，不阻塞开关。 */
    attributionSettling: boolean;
    mounts: Record<string, MountInfo>;
    settling: boolean;
}
/** 卡片底部的来源标签配色（项目蓝 / 全局绿 / 内置琥珀 / 插件紫 / 预设灰 / 外部橙 / 未识别琥珀）。 */
type TagTone = "project" | "global" | "bundled" | "plugin" | "preset" | "external" | "unattributed";
export interface SkillRow {
    id: string;
    kind: "skill";
    name: string;
    description: string;
    tag: string;
    /** 来源标签配色（与 tag 文案配对）。 */
    tone: TagTone;
    /** 注入行的注入方 / 渠道名（如 `dsh-to-figma` / `cordis`）；磁盘行缺省。 */
    channel?: string;
    /** true = 宿主 registry 注入行（来源标签 + 渠道小标签，内容只读但可在会话启停）。 */
    injected?: boolean;
    enabled: boolean;
    disabled: boolean;
    meta?: string;
}
export interface McpRow {
    id: string;
    kind: "mcp";
    name: string;
    tag: string;
    tone: TagTone;
    meta: string;
    enabled: boolean;
    disabled: boolean;
    dot: string;
    /** 写会话开关时的 target（项目条目 = key；global/外部 = serverName）。 */
    target: string;
    writeKind: "project" | "server";
    /** restrict 无法生效的外部实例（按会话注入）。 */
    locked: boolean;
    /** 插件展示名（v13 R4：第二枚标签；缺省 = 无插件来源）。 */
    channel?: string;
    /** true = 命名空间合成行（详情/卡片可加「合成」说明）。 */
    synthesized?: boolean;
}
/**
 * Tools 域的一行（v13 R3）：一个插件 = 一个开关单元，无单工具开关。
 *
 * `unit` 是宿主给的开关单元 id（写 `tools.setSessionEnabled` 用），
 * `toolCount` 只用于描述与详情，**Tab 分母是插件数**。
 */
export interface ToolRow {
    id: string;
    kind: "tool";
    name: string;
    tag: string;
    tone: TagTone;
    /** 卡片描述（如 `13 个工具 · 插件注入`）。 */
    description: string;
    /** 行内工具数标签（如 `13 个工具`）。 */
    meta: string;
    enabled: boolean;
    disabled: boolean;
    /** 开关单元 id（`__unattributed__` = 来源未识别）。 */
    unit: string;
    /**
     * true = 本会话存在**显式覆盖**（`tools.list` additive 字段 `explicit`；
     * 旧宿主缺省按 false）。卡片据此显示 `本会话覆盖` 小标签。
     */
    explicit: boolean;
    /** 全局默认（覆盖标签的 title 用：`全局默认开启/关闭；本会话单独设置`）。 */
    defaultEnabled: boolean;
    /** 不可开关原因（正常缺省）。 */
    lockedReason?: string;
}
export type Row = SkillRow | McpRow | ToolRow;
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
/**
 * Tools 域行（v13 R3）：一个插件 = 一行；来源未识别合并成一个单元排最后。
 * `pending` 覆盖会话态（乐观回显 / 批量执行中）。
 */
export declare function buildToolRows(snapshot: CapabilitySnapshot, pending: Record<string, boolean>): ToolRow[];
export declare function CapabilityCard({ row, busy, onToggle }: {
    row: Row;
    busy: boolean;
    onToggle: () => void;
}): import("react").JSX.Element;
type TabId = "skills" | "mcp" | "tools";
/** 行 3 控制条的批量态（idle / 执行中 / 部分失败）。 */
export interface BulkState {
    phase: "idle" | "running" | "partial";
    /** 本次 / 上次动作；idle 且从未执行时缺省。 */
    action?: SessionBulkAction;
    /** 已完成的域数（进度文案用）。 */
    doneDomains: number;
    /** 本次要跑的域总数（重试时只含失败域）。 */
    totalDomains: number;
    /** 聚合的逐项失败（`{n} 项失败 · 重试`）。 */
    failed: SessionBulkFailure[];
    /** 含失败的域（重试只重放这些域）。 */
    failedDomains: SessionBulkDomain[];
    /** 传输层 / 业务失败的一次性文案。 */
    error?: string;
}
interface PanelProps {
    mode: "dock" | "hero" | "overlay" | "view";
    loading: boolean;
    error?: string;
    snapshot: CapabilitySnapshot;
    skillRows: SkillRow[];
    mcpRows: McpRow[];
    /** Tools 域行（v13 R3）：一个插件一行。 */
    toolRows: ToolRow[];
    pending: Record<string, boolean>;
    busy: Record<string, boolean>;
    onToggle: (row: Row) => void;
    onReset: () => void;
    onRefresh: () => void;
    onCollapse: () => void;
    onManage?: () => void;
    onRetry?: () => void;
    /** 行 3 控制条：三域批量开关（R1）。 */
    onBulk: (action: SessionBulkAction) => void;
    /** 重试只重放失败域。 */
    onRetryBulk: () => void;
    bulkState: BulkState;
    /** 入口「✦ 能力决策」（展开态在 tabs 行右侧；仅 hero 传入）。 */
    decisionEntry?: ReactNode;
    /** 自动触发默认关闭的弱提示（与入口同排，窄容器隐藏）。 */
    decisionHint?: string;
}
export declare function CapabilityPanel(props: PanelProps & {
    initialTab?: TabId;
}): import("react").JSX.Element;
export declare function CapabilityBar({ skillRows, mcpRows, toolRows, loading, onExpand, decisionEntry, }: {
    skillRows: SkillRow[];
    mcpRows: McpRow[];
    /** Tools 域行（v13）：chips 与计数含第三域。 */
    toolRows: ToolRow[];
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
