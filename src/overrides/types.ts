/**
 * 默认关闭声明的共享类型（全局层 + 项目层）。
 *
 * **全局层（B2，v20.1 新增）**：`<dshHome>/dsh-capability-settings/capability-global-overrides.json`
 *
 * ```jsonc
 * { "version": 1, "skills": ["foo", "bar"] }   // = 全局默认关闭名单；空数组不落盘字段
 * ```
 *
 * 用于「全局默认关闭某 Skill」，**不改技能文件**；工作区可以重新打开
 * （项目覆盖的 `enabledSkills`），会话显式开关仍最后覆盖。
 *
 * **项目层**：`<dshHome>/dsh-capability-settings/capability-overrides.json`
 * ——一个文件按**项目根**分 key，记录每个项目默认关闭的 MCP server / Skill，
 * 以及（B2）本项目显式重新打开的 Skill：
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
 *       "enabledSkills": ["global-disabled"]   // 本项目重新打开（覆盖全局默认）
 *     }
 *   }
 * }
 * ```
 *
 * 同一名字同时出现在 `skills` 与 `enabledSkills` 时**禁用优先**（读取时规范化，
 * 见 `shared/skill-defaults.ts`；UI 不应产生这种数据）。
 *
 * 旧格式（项目内 `.agents/capability-overrides.json` 的 `{ mcp, skills }`）
 * 仍然兼容读取，并在首次写入统一存储时迁移删除；对应 {@link CapabilityOverrides}。
 *
 * @module dsh-capability-settings/overrides/types
 */

/** 可被项目级禁用的能力域（mcp = 配置文件条目；skills = 技能）。 */
export type CapabilityDomain = "mcp" | "skills";

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
 * 完整项目级声明（B2）：两域禁用清单 + 项目重新打开名单。
 *
 * `enabledSkills` 不属于 `CapabilityDomain` 的两域之一，所以显式展开而不是
 * 映射类型；该字段只在内部计算 / 写盘路径使用（不改变 `sets()` 的既有返回）。
 */
export interface OverridesSet extends OverridesDomainSet {
  /** 本项目显式重新打开的技能名（覆盖全局默认关闭）。 */
  enabledSkills: string[];
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
}

/** 统一存储文件的完整形状（`version: 1`）。 */
export interface OverridesStore {
  version: number;
  /** 项目根 → 该项目默认关闭清单。 */
  projects: Record<string, OverridesProjectEntry>;
}

/** 面板视角的完整禁用状态（attach 上声明文件的绝对路径）。 */
export interface OverridesView extends OverridesDomainSet {
  /** 统一存储文件绝对路径（无项目时缺省）。 */
  filePath?: string;
  /** 当前项目根（统一存储的 key；无项目时缺省）。 */
  projectRoot?: string;
}

// ---------------------------------------------------------------------------
// 全局层（B2）
// ---------------------------------------------------------------------------

/** 全局覆盖文件的磁盘形状（`capability-global-overrides.json`）。 */
export interface GlobalOverridesFile {
  /** 文件版本（当前只支持 1）。 */
  version: number;
  /** 全局默认关闭的技能名；空数组不落盘字段。 */
  skills?: string[];
}

/** 全局覆盖的规范化内存形状。 */
export interface GlobalOverrides {
  /** 全局默认关闭的技能名（去重 / trim / 排序后的快照）。 */
  skills: string[];
}

/**
 * `overrides.globalGet` 视图：规范化清单 + 文件绝对路径。
 *
 * `errors` 是**附加**字段（契约 §2.1 只要求 `skills` / `filePath`）：全局文件
 * 损坏时读路径降级为空清单，同时把可读错误挂在这里，面板可选择性展示。
 */
export interface GlobalOverridesView extends GlobalOverrides {
  /** 全局覆盖文件绝对路径（缺失时也给出期望路径，便于排查）。 */
  filePath: string;
  /** 读路径降级原因（文件损坏 / 版本不认识）；缺失或正常时缺省。 */
  errors?: string[];
}

/** `overrides.globalToggle` 的入参（全局层目前只有 skills 域）。 */
export interface GlobalOverrideToggleInput {
  domain: "skills";
  /** 要切换默认关闭状态的技能名（kebab-case）。 */
  key: string;
  /** true = 加入全局默认关闭名单；false = 从名单移除（恢复默认开启）。 */
  disabled: boolean;
}
