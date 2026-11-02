/**
 * 能力可见性（v21）的**纯计算 + 归一化**（Skills / MCP / Tools 三域共用）。
 *
 * 存储：`<dshHome>/dsh-capability-settings/capability-global-overrides.json`
 * 的 `visibility` 字段（version 2，见 `overrides/global-file.ts`）：
 *
 * ```jsonc
 * {
 *   "visibility": {
 *     "skills": {
 *       "pdf": {
 *         "mode": "all",                       // all | selected | none（缺省 all）
 *         "workspaces": {                      // key = 工作区 path（原样，不归一化）
 *           "/abs/projA": { "visible": true, "defaultEnabled": false },
 *           "/abs/projB": { "visible": false } // visible:false 优先于 mode=all
 *         }
 *       }
 *     },
 *     "mcp":   {},
 *     "tools": {}
 *   }
 * }
 * ```
 *
 * 语义（契约 §1 / §3）：
 *
 *   - **可见性**：能力 × 工作区；`projectRoot === undefined`（全局视图）恒可见。
 *     `mode=all` 全部可见（`visible:false` 单独隐藏某工作区）；`mode=selected`
 *     只有显式列出的工作区可见（`visible !== false`）；`mode=none` 全部不可见。
 *   - **每工作区默认**：`workspaces[ws].defaultEnabled ?? !全局默认关闭名单(name)`
 *     —— 工作区没有单独配置时回落到「兜底全局默认」（skills/mcp 的全局名单、
 *     tools 的 `tools-global.json` ∪ 全局文件 `tools`），保证既有语义不变。
 *   - **工作区覆盖**：项目层 `mcp`/`skills`/`tools`（禁用）+ `enabledMcp`/
 *     `enabledSkills`/`enabledTools`（重新打开）三态，见 `overrides/*`。
 *
 * 工作区 key 的匹配口径（与客户端一致）：**以 `workspaces` 里原样的 path 为 key**；
 * 运行时按「projectRoot 精确 → cwd 精确 → 是最长 cwd 前缀的 key」匹配，因此
 * 子目录工作区也能命中，同仓库不同工作区可分别配置。
 *
 * 本模块不读文件、不碰宿主服务；坏数据（未知 mode / workspaces 非对象等）按
 * 最宽容口径降级（all / 空 map）并收集可读错误，供 global-file 的读路径透出。
 *
 * @module dsh-capability-settings/shared/visibility
 */
/**
 * 对**不可见能力**写会话开关时的业务失败文案（三域统一，契约 §4）。
 *
 * 不可见 = 全局可见性把该能力对当前工作区关闭；会话开关不能反向打开。
 */
export declare const INVISIBLE_CAPABILITY_ERROR = "\u80FD\u529B\u5BF9\u5F53\u524D\u5DE5\u4F5C\u533A\u4E0D\u53EF\u89C1\uFF0C\u8BF7\u5148\u5728\u5168\u5C40\u5F00\u542F\u53EF\u89C1";
/** 可见性三域（与 `CapabilityDomain` 同集合）。 */
export type VisibilityDomain = "skills" | "mcp" | "tools";
/** 可见性模式。 */
export type VisibilityMode = "all" | "selected" | "none";
/** 三个可见性域（固定顺序：skills / mcp / tools）。 */
export declare const VISIBILITY_DOMAINS: readonly VisibilityDomain[];
/** 某工作区在一个能力上的可见性配置。 */
export interface WorkspaceVisibility {
    /** false = 该工作区不可见（优先于 `mode=all`）；缺省 = 按 mode。 */
    visible?: boolean;
    /** 该工作区的默认开/关；缺省 = 回落「兜底全局默认」。 */
    defaultEnabled?: boolean;
}
/** 一个能力（技能 / MCP server / Tools 单元）的可见性配置。 */
export interface CapabilityVisibility {
    /** 可见范围模式；缺省 = `all`。 */
    mode: VisibilityMode;
    /** 工作区 path → 该工作区配置（`visible:false` 优先于 mode=all）。 */
    workspaces: Record<string, WorkspaceVisibility>;
}
/** 三域全部可见性配置：domain → key → 条目。 */
export type VisibilitySets = Record<VisibilityDomain, Record<string, CapabilityVisibility>>;
/** 工作区匹配目标：项目根与（可选的）会话/面板 cwd。 */
export interface WorkspaceTarget {
    /** 由 cwd 推导的项目根（`findProjectRoot`）。 */
    projectRoot?: string;
    /** 真实工作区 / 会话 cwd（可能比项目根深）。 */
    cwd?: string;
}
/** 构造一份全空可见性（三域都是空 map）。 */
export declare function emptyVisibilitySets(): VisibilitySets;
/** 构造一份默认条目（all + 空 workspaces）。 */
export declare function emptyCapabilityVisibility(): CapabilityVisibility;
/** 归一 mode：未知值按 `all`（宽容降级）。 */
export declare function normalizeMode(value: unknown): VisibilityMode;
/**
 * 归一一个工作区配置。
 *
 * @returns 合法对象（忽略非布尔字段）；非对象返回 undefined
 */
export declare function normalizeWorkspaceVisibility(value: unknown, errors?: string[], label?: string): WorkspaceVisibility | undefined;
/**
 * 归一一个能力的可见性条目。
 *
 * @returns 合法条目（`workspaces` 里坏值丢弃并收集错误）
 */
export declare function normalizeCapabilityVisibility(value: unknown, errors?: string[], label?: string): CapabilityVisibility | undefined;
/**
 * 归一整个 `visibility` 字段（三域）。
 *
 * 非对象 / 坏域 / 坏条目：按空 map / 默认 all 降级，并把错误收进 `errors`
 * （global-file 的读路径据此决定是否报错，写路径要求 `errors.length === 0`）。
 *
 * @param raw 磁盘上的原始值
 * @returns `{ sets, errors }`；`sets` 恒为三域齐全的结构
 */
export declare function normalizeVisibilitySets(raw: unknown): {
    sets: VisibilitySets;
    errors: string[];
};
/** 取某能力的可见性条目（缺省 = all）。 */
export declare function visibilityEntryOf(sets: VisibilitySets, domain: VisibilityDomain, key: string): CapabilityVisibility | undefined;
/** 取某能力的可见性模式（缺省 all）。 */
export declare function visibilityModeOf(sets: VisibilitySets, domain: VisibilityDomain, key: string): VisibilityMode;
/** 显式配置为可见的工作区数量（`visible !== false`；前端标签「指定 N」用）。 */
export declare function visibleWorkspaceCount(entry: CapabilityVisibility | undefined): number;
/**
 * 在 `workspaces` 的 key 集合里为某个目标找到匹配的 key。
 *
 * 顺序：projectRoot 精确 → cwd 精确 → 「是 cwd 前缀的最长 key」。
 * 都没有返回 undefined（调用方按 mode 的缺省语义处理）。
 */
export declare function workspaceMatchKey(keys: readonly string[], target: WorkspaceTarget | undefined): string | undefined;
/**
 * 该能力在某工作区是否**可见**（契约 §3）。
 *
 * `target` 缺省 / 无工作区上下文（全局视图）→ true。
 * 未知工作区：mode=all ⇒ true、selected ⇒ false、none ⇒ false（缺省条目 = all）。
 */
export declare function visibleIn(sets: VisibilitySets, domain: VisibilityDomain, key: string, target: WorkspaceTarget | undefined): boolean;
/** 判断名字是否落在「兜底全局默认关闭」名单里。 */
export declare function isGloballyDisabled(globalDisabled: readonly string[] | ReadonlySet<string>, key: string): boolean;
/**
 * 该能力在某工作区的**全局默认**（每工作区默认，契约 §3）。
 *
 * `workspaces[ws].defaultEnabled ?? !兜底全局默认关闭(name)`（缺省条目 = 后者）。
 * 全局视图（无工作区上下文）下直接取兜底默认。
 */
export declare function perWorkspaceDefault(sets: VisibilitySets, domain: VisibilityDomain, key: string, target: WorkspaceTarget | undefined, globalDisabled: readonly string[] | ReadonlySet<string>): boolean;
/**
 * 某工作区里**不可见**的能力名列表（指定域内所有显式配置过的 key 中过滤）。
 *
 * 只遍历 `visibility` 里出现过的 key（未配置 = 可见），供运行时 gate 用；
 * 调用方仍需按能力是否存在过滤（避免给不存在的名字做无效投影）。
 */
export declare function invisibleKeysForWorkspace(sets: VisibilitySets, domain: VisibilityDomain, target: WorkspaceTarget | undefined): string[];
