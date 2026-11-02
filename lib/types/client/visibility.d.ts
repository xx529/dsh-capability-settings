/**
 * 能力可见性（v21）三域共用的展示与编辑组件。
 *
 * 契约：`notes/redesign/visibility-contract.md` §4 / §6。
 * - 可见性是**全局唯一控制**（按工作区），只有全局视图能改：
 *   `mode`（全部 / 指定 / 不可见）+ `workspaces[项目根]`（可见 + 默认开/关）。
 * - 每工作区默认开/关是「该工作区的初始默认」，工作区视图仍可再覆盖（三态），
 *   会话显式开关优先级最高；这些更下层逻辑不在本文件。
 * - 行内标签 / 默认摘要吃宿主投影的 `visibilityMode` / `visibleWorkspaceCount`；
 *   缺省（旧宿主）时用 `overrides.globalGet().visibility` 自行计算。
 *
 * 存储与 RPC：`overrides.globalGet` 读 `visibility`，`overrides.setVisibility`
 * 提交**整份** workspaces 映射（key = 项目根，与 workspaces[].path 原样对应）。
 *
 * @module dsh-capability-settings/client/visibility
 */
import type { ReactNode } from "react";
import type { CapabilityPanelApi, ClientCapabilityDomain, ClientCapabilityVisibility, ClientGlobalOverrides, ClientOverrides, ClientVisibilityMode, ClientVisibilitySets } from "./api.js";
/** 面板里工作区选项的最小形状（与 scope-chain / panel 的 projects 一致）。 */
export interface VisibilityWorkspace {
    path: string;
    title?: string;
}
/** 空可见性集合（旧宿主 / v1 全局文件缺省）。 */
export declare const EMPTY_VISIBILITY_SETS: ClientVisibilitySets;
/**
 * 防御性读取全局层（旧宿主 / 测试夹具可能没有 `overrides.globalGet`）：
 * 失败返回 undefined，调用方按「全部可见 / 空名单」降级。
 */
export declare function safeGlobalGet(api: CapabilityPanelApi): Promise<ClientGlobalOverrides | undefined>;
/** 防御性读取项目 overrides（旧宿主 / 测试夹具可能没有 `overrides.get`）。 */
export declare function safeOverridesGet(api: CapabilityPanelApi): Promise<ClientOverrides | undefined>;
/** 工作区展示名：优先 title，其次目录 basename。 */
export declare function visibilityWorkspaceTitle(workspace: VisibilityWorkspace): string;
/** 取某个能力的可见性配置（不存在 = 未配置 ⇒ 全部可见、走兜底默认）。 */
export declare function visibilityEntryOf(sets: ClientVisibilitySets | undefined, domain: ClientCapabilityDomain, key: string): ClientCapabilityVisibility | undefined;
/** 可见性模式（缺省 = all，兼容旧宿主 / v1 文件）。 */
export declare function visibilityModeOf(entry: ClientCapabilityVisibility | undefined): ClientVisibilityMode;
/** 某工作区是否可见（与宿主 `visibleIn` 同构：mode + visible:false 覆盖）。 */
export declare function isWorkspaceVisible(entry: ClientCapabilityVisibility | undefined, workspacePath: string): boolean;
/** 可见的工作区数；`workspaces` 缺省时用配置里显式出现的 key。 */
export declare function visibleWorkspaceCountOf(entry: ClientCapabilityVisibility | undefined, workspaces: VisibilityWorkspace[]): number;
/**
 * 能力是否「不可见」（行尾默认开关应禁用 + 标「不可见 · 不参与默认」）：
 * mode=none，或 selected 模式下没有任何可见工作区。
 */
export declare function isInvisibleCapability(entry: ClientCapabilityVisibility | undefined, workspaces: VisibilityWorkspace[]): boolean;
/**
 * 行级不可见判定：宿主行字段优先（`disabledByVisibility` / `visibilityMode` +
 * `visibleWorkspaceCount`），缺省时回落到可见性配置 + 工作区列表计算。
 */
export declare function isRowInvisible(row: {
    visibilityMode?: ClientVisibilityMode;
    visibleWorkspaceCount?: number;
    disabledByVisibility?: boolean;
}, entry: ClientCapabilityVisibility | undefined, workspaces: VisibilityWorkspace[]): boolean;
/** 某工作区的默认开/关：显式 defaultEnabled 优先，否则走兜底 `!globalOff`。 */
export declare function workspaceDefaultOf(entry: ClientCapabilityVisibility | undefined, workspacePath: string, globalOff: boolean): boolean;
/** 全局视图行内的默认摘要（只在可见工作区上统计；不可见时 undefined）。 */
export declare function defaultSummaryOf(entry: ClientCapabilityVisibility | undefined, workspaces: VisibilityWorkspace[], globalOff: boolean): {
    on: number;
    off: number;
} | undefined;
/** 工作区视图的「跟随全局默认 / 已覆盖」状态。 */
export type WorkspaceOverrideState = "inherit" | "on" | "off";
/** 从项目 overrides 判断某能力在本工作区是否有显式默认覆盖。 */
export declare function workspaceOverrideOf(overrides: ClientOverrides | undefined, domain: ClientCapabilityDomain, key: string): WorkspaceOverrideState;
/** 行内可见性标签（全部工作区 / 指定 N / 不可见）。 */
export declare function VisibilityBadge({ entry, workspaces, mode, count, }: {
    entry?: ClientCapabilityVisibility;
    workspaces: VisibilityWorkspace[];
    /** 宿主投影的 visibilityMode 优先（全局视图）。 */
    mode?: ClientVisibilityMode;
    /** 宿主投影的 visibleWorkspaceCount 优先。 */
    count?: number;
}): ReactNode;
/** 行内「默认：N 开 / M 关」摘要 + 可见性标签（三域行 meta 区共用）。 */
export declare function VisibilityRowMeta({ entry, workspaces, globalOff, mode, count, invisible, summaryClassName, }: {
    entry?: ClientCapabilityVisibility;
    workspaces: VisibilityWorkspace[];
    globalOff: boolean;
    mode?: ClientVisibilityMode;
    count?: number;
    /** 行级不可见（宿主字段优先）：不可见时不展示「默认 N 开/M 关」摘要。 */
    invisible?: boolean;
    summaryClassName?: string;
}): ReactNode;
/** 详情「可见范围」分段 + 工作区表格 + 编辑入口（全局视图用）。 */
export declare function VisibilityDetailFields({ api, domain, capabilityKey, name, entry, workspaces, globalOff, onSaved, }: {
    api: CapabilityPanelApi;
    domain: ClientCapabilityDomain;
    /** 可见性存储 key：skills=name / mcp=serverName / tools=unit。 */
    capabilityKey: string;
    /** 展示名（弹层标题用）。 */
    name: string;
    entry?: ClientCapabilityVisibility;
    workspaces: VisibilityWorkspace[];
    /** 兜底默认：名字在全局默认关闭名单里。 */
    globalOff: boolean;
    /** 保存成功后回调（面板重拉列表 + 全局层）。 */
    onSaved: () => void;
}): ReactNode;
/**
 * 可见范围编辑弹层：顶部模式分段 + 工作区表格（可见 checkbox + 默认开/关）。
 * 保存提交**整份** workspaces 映射（`overrides.setVisibility`）。
 */
export declare function VisibilityModal({ api, domain, capabilityKey, name, entry, workspaces, globalOff, onClose, onSaved, }: {
    api: CapabilityPanelApi;
    domain: ClientCapabilityDomain;
    capabilityKey: string;
    name: string;
    entry?: ClientCapabilityVisibility;
    workspaces: VisibilityWorkspace[];
    globalOff: boolean;
    onClose: () => void;
    onSaved: () => void;
}): import("react").JSX.Element;
