/**
 * 默认关闭声明的共享类型（全局层 + 项目层）。
 *
 * **全局层（B2，v20.1 新增 Skills；v20.2 新增 MCP；v21 新增 Tools + 可见性 + v2）**：
 * `<dshHome>/dsh-capability-settings/capability-global-overrides.json`
 *
 * ```jsonc
 * // version 2（v21；v1 仍兼容读取，缺省全部可见）
 * {
 *   "version": 2,
 *   "skills": ["foo", "bar"],   // 全局默认关闭兜底名单；空数组不落盘字段
 *   "mcp": ["figma"],
 *   "tools": ["dsh-foo"],
 *   "visibility": {
 *     "skills": { "pdf": { "mode": "all", "workspaces": { "/abs/projA": { "visible": true, "defaultEnabled": false } } } },
 *     "mcp": {}, "tools": {}
 *   }
 * }
 * ```
 *
 * 用于「全局默认关闭某 Skill / MCP server / Tools 单元」与「能力可见性（按工作区）」，
 * **不改技能文件、不改注入方配置**；工作区可以重新打开（项目覆盖的
 * `enabledSkills` / `enabledMcp` / `enabledTools`），会话显式开关仍最后覆盖。
 *
 * **项目层**：`<dshHome>/dsh-capability-settings/capability-overrides.json`
 * ——一个文件按**项目根**分 key，记录每个项目默认关闭的 MCP server / Skill，
 * 以及（B2）本项目显式重新打开的能力：
 *
 * ```jsonc
 * {
 *   "version": 1,
 *   "projects": {
 *     "/abs/path/to/project": {
 *       "updatedAt": 1761328800000,
 *       "cwd": "/abs/path/to/project/sub",
 *       "mcp": ["github"],
 *       "skills": ["project-disabled"],        // 本项目关闭
 *       "enabledSkills": ["global-disabled"],  // 本项目重新打开（覆盖全局默认）
 *       "enabledMcp": ["figma"],               // 本项目重新打开（覆盖全局默认，v20.2）
 *       "tools": ["dsh-foo"],                  // 本项目关闭（Tools 单元，v21）
 *       "enabledTools": ["dsh-bar"]            // 本项目重新打开（v21）
 *     }
 *   }
 * }
 * ```
 *
 * 同一名字同时出现在禁用名单 / 重新打开名单（`skills`/`enabledSkills`、
 * `mcp`/`enabledMcp`、`tools`/`enabledTools`）时**禁用优先**（读取时规范化，
 * 见 `shared/skill-defaults.ts` / `shared/mcp-defaults.ts`；UI 不应产生这种数据）。
 *
 * 旧格式（项目内 `.agents/capability-overrides.json` 的 `{ mcp, skills }`）
 * 仍然兼容读取，并在首次写入统一存储时迁移删除；对应 {@link CapabilityOverrides}。
 *
 * @module dsh-capability-settings/overrides/types
 */
import type { VisibilityDomain, VisibilityMode, VisibilitySets, WorkspaceVisibility } from "../shared/visibility.js";
/**
 * 可被默认开关 / 可见性管理的三个能力域：
 *
 *   - `mcp`：全局配置条目与运行时注入的 MCP 实例（项目原生条目不参与可见性）；
 *   - `skills`：技能（磁盘 / 注入）；
 *   - `tools`：Tools 域开关单元（一个插件 = 一个单元，key = unit id）。
 */
export type CapabilityDomain = "mcp" | "skills" | "tools";
/** 旧格式（项目内文件）的完整磁盘形状；只用于兼容读取与迁移。 */
export interface CapabilityOverrides {
    /** 被本项目禁用的全局 MCP server 键列表。 */
    mcp?: string[];
    /** 被本项目默认禁用的技能名列表（kebab-case）。 */
    skills?: string[];
    /**
     * 被本项目显式重新打开的技能名列表（B2；覆盖全局默认关闭）。
     * 旧文件一般没有该字段，读取时按缺省处理。
     */
    enabledSkills?: string[];
    /**
     * 被本项目显式重新打开的 MCP serverName 列表（v20.2；覆盖全局默认关闭）。
     * 旧文件一般没有该字段，读取时按缺省处理。
     */
    enabledMcp?: string[];
    /** 被本项目默认关闭的 Tools 单元 id（v21；旧文件没有该字段）。 */
    tools?: string[];
    /** 被本项目显式重新打开的 Tools 单元 id（v21；旧文件没有该字段）。 */
    enabledTools?: string[];
}
/**
 * 一个能力域 → 该域的项目级清单（规范化后：去重、trim、排序）。
 *
 * 保持既有形状（`sets()` / `get()` 的返回仍只有两域，兼容旧调用方与回归
 * 测试）；B2 的「项目重新打开」名单在 {@link OverridesSet} 上另加。
 */
export interface OverridesDomainSet {
    /** 本项目默认关闭的全局 MCP server 键。 */
    mcp: string[];
    /** 本项目默认关闭的技能名。 */
    skills: string[];
}
/**
 * 完整项目级声明（B2 / v20.2）：两域禁用清单 + 项目重新打开名单。
 *
 * `enabledSkills` / `enabledMcp` 不属于 `CapabilityDomain` 的两域之一，所以显式
 * 展开而不是映射类型；这两个字段只在内部计算 / 写盘路径使用（不改变 `sets()`
 * 的既有返回）。
 */
export interface OverridesSet extends OverridesDomainSet {
    /** 本项目默认关闭的 Tools 单元 id（v21）。 */
    tools: string[];
    /** 本项目显式重新打开的技能名（覆盖全局默认关闭）。 */
    enabledSkills: string[];
    /** 本项目显式重新打开的 MCP serverName（覆盖全局默认关闭，v20.2）。 */
    enabledMcp: string[];
    /** 本项目显式重新打开的 Tools 单元 id（v21）。 */
    enabledTools: string[];
}
/** 统一存储里一个项目的记录。 */
export interface OverridesProjectEntry {
    /** 最后写入时间（毫秒；仅供诊断 / 将来清理）。 */
    updatedAt: number;
    /** 最近一次写入时的工作区 cwd（诊断用；key 是项目根）。 */
    cwd?: string;
    /** 本项目默认关闭的全局 MCP server 键。 */
    mcp?: string[];
    /** 本项目默认关闭的技能名。 */
    skills?: string[];
    /** 本项目显式重新打开的技能名（B2）。 */
    enabledSkills?: string[];
    /** 本项目显式重新打开的 MCP serverName（v20.2）。 */
    enabledMcp?: string[];
    /** 本项目默认关闭的 Tools 单元 id（v21）。 */
    tools?: string[];
    /** 本项目显式重新打开的 Tools 单元 id（v21）。 */
    enabledTools?: string[];
}
/** 统一存储文件的完整形状（`version: 1`）。 */
export interface OverridesStore {
    version: number;
    /** 项目根 → 该项目默认关闭清单。 */
    projects: Record<string, OverridesProjectEntry>;
}
/** 面板视角的完整禁用状态（attach 上声明文件的绝对路径）。 */
export interface OverridesView extends OverridesDomainSet {
    /** 本项目默认关闭的 Tools 单元 id（v21；additive，`sets()` 形状不变）。 */
    tools: string[];
    /** 本项目显式重新打开的技能名（B2；additive，`sets()` 形状不变）。 */
    enabledSkills: string[];
    /** 本项目显式重新打开的 MCP serverName（v20.2；additive）。 */
    enabledMcp: string[];
    /** 本项目显式重新打开的 Tools 单元 id（v21；additive）。 */
    enabledTools: string[];
    /** 统一存储文件绝对路径（无项目时缺省）。 */
    filePath?: string;
    /** 当前项目根（统一存储的 key；无项目时缺省）。 */
    projectRoot?: string;
}
/** 全局覆盖文件的磁盘形状（`capability-global-overrides.json`）。 */
export interface GlobalOverridesFile {
    /** 文件版本（v21 起写 2；v1 仍兼容读取）。 */
    version: number;
    /** 全局默认关闭的技能名；空数组不落盘字段。 */
    skills?: string[];
    /** 全局默认关闭的 MCP serverName（`[A-Za-z0-9_-]{1,32}`）；空数组不落盘字段。 */
    mcp?: string[];
    /** 全局默认关闭的 Tools 单元 id（v21）；空数组不落盘字段。 */
    tools?: string[];
    /** 能力可见性（v21；全空时不落盘字段）。 */
    visibility?: VisibilitySets;
}
/** 全局覆盖的规范化内存形状。 */
export interface GlobalOverrides {
    /** 全局默认关闭的技能名（去重 / trim / 排序后的快照）。 */
    skills: string[];
    /** 全局默认关闭的 MCP serverName（去重 / trim / 排序后的快照）。 */
    mcp: string[];
    /** 全局默认关闭的 Tools 单元 id（v21）。 */
    tools: string[];
    /** 能力可见性（v21；三域恒齐全，未配置 = 空 map）。 */
    visibility: VisibilitySets;
}
/**
 * `overrides.globalGet` 视图：规范化清单 + 文件绝对路径。
 *
 * `errors` 是**附加**字段：全局文件损坏时读路径降级为空清单，同时把可读错误
 * 挂在这里，面板可选择性展示。
 */
export interface GlobalOverridesView extends GlobalOverrides {
    /** 全局覆盖文件绝对路径（缺失时也给出期望路径，便于排查）。 */
    filePath: string;
    /** 读路径降级原因（文件损坏 / 版本不认识）；缺失或正常时缺省。 */
    errors?: string[];
}
/** `overrides.globalToggle` 的入参（Skills / MCP / Tools 三个全局默认域）。 */
export interface GlobalOverrideToggleInput {
    domain: "skills" | "mcp" | "tools";
    /** 要切换默认关闭状态的技能名（kebab-case）/ MCP serverName / Tools 单元 id。 */
    key: string;
    /** true = 加入全局默认关闭名单；false = 从名单移除（恢复默认开启）。 */
    disabled: boolean;
}
/**
 * `overrides.setVisibility` 的入参（v21）。
 *
 * `workspaces` 是**完整映射**（面板整份提交，整份替换；避免增量合并歧义）：
 * key = 工作区 path（原样，不做 projectRoot 归一化；运行时按「projectRoot 精确
 * → path 精确 → cwd 最长前缀」匹配），value = `{visible?, defaultEnabled?}`。
 */
export interface GlobalVisibilityInput {
    /** 可见性域。 */
    domain: VisibilityDomain;
    /** 能力 key（skills = 技能名；mcp = serverName；tools = unit id）。 */
    key: string;
    /** 可见范围模式。 */
    mode: VisibilityMode;
    /** 工作区 path → 该工作区配置（完整映射）。 */
    workspaces: Record<string, WorkspaceVisibility>;
}
/**
 * 一个能力在某个工作区的默认态快照（`overrides.capabilityDefaults` 的返回）。
 *
 * 所有列表投影与三处运行时 gate 都从这一处取值，禁止各算一套。
 */
export interface CapabilityDefaults {
    /** 该能力在当前工作区是否可见（全局视图恒 true）。 */
    visible: boolean;
    /** 可见性模式（缺省 all；面板标签用）。 */
    visibilityMode: VisibilityMode;
    /** 显式配置为可见的工作区数（「指定 N」标签用）。 */
    visibleWorkspaceCount: number;
    /** 该工作区的**全局默认**：`workspaces[ws].defaultEnabled ?? !兜底全局关闭`。 */
    globalDefaultEnabled: boolean;
    /** 项目显式覆盖：true = 显式开；false = 显式关；缺省 = 无覆盖（跟随全局）。 */
    projectOverride?: boolean;
    /** 项目覆盖后的工作区默认 = `projectOverride ?? globalDefaultEnabled`。 */
    workspaceDefaultEnabled: boolean;
    /** 最终默认（含可见性门）：`visible && workspaceDefaultEnabled`。 */
    effectiveDefaultEnabled: boolean;
}
