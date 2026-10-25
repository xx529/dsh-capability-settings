/**
 * 项目级"默认关闭"的共享类型。
 *
 * 用途：允许在**单个项目**里默认禁用某些能力，而不改动全局配置文件——
 * 声明统一写在 `<dshHome>/dsh-capability-settings/capability-overrides.json`
 * 里，按**项目根**分 key（见 `paths.ts` / `config-file.ts`），影响范围仅限该项目：
 *
 *   - MCP：自动挂载器为本项目的 session 解析配置时跳过被禁用的全局 server
 *     （项目自身的同名条目不受影响）；
 *   - Skills：**只对宿主 registry 注入的技能**（内置 / 插件 / preset）生效。
 *     注入技能没有磁盘文件，禁停 = 在该项目 live 会话的 agent 作用域注册同名
 *     runtime shadow（见 `skills/session.ts`）。磁盘技能的项目级禁停仍走
 *     frontmatter + shadow stub（`skills/shadow.ts`），不写这份声明
 *     （Lead 裁定 R7）。
 *
 * 统一存储的磁盘形状（空项目 / 空域都不落盘）：
 *
 * ```jsonc
 * {
 *   "version": 1,
 *   "projects": {
 *     "/abs/path/to/project": {
 *       "updatedAt": 1761328800000,
 *       "cwd": "/abs/path/to/project/sub",
 *       "mcp": ["github"],
 *       "skills": ["figma-workbench"]
 *     }
 *   }
 * }
 * ```
 *
 * 旧格式（项目内 `.agents/capability-overrides.json` 的 `{ mcp, skills }`）
 * 仍然兼容读取，并在首次写入统一存储时迁移删除；对应 {@link CapabilityOverrides}。
 *
 * @module dsh-capability-settings/overrides/types
 */

/** 可被项目级禁用的能力域（mcp = 配置文件条目；skills = 宿主注入技能）。 */
export type CapabilityDomain = "mcp" | "skills";

/** 旧格式（项目内文件）的完整磁盘形状；只用于兼容读取与迁移。 */
export interface CapabilityOverrides {
  /** 被本项目禁用的全局 MCP server 键列表。 */
  mcp?: string[];
  /** 被本项目默认禁用的注入技能名列表（kebab-case）。 */
  skills?: string[];
}

/** 一个能力域 → 该域的项目级禁用清单（规范化后：去重、trim、排序）。 */
export type OverridesSet = { [K in CapabilityDomain]: string[] };

/** 统一存储里一个项目的记录。 */
export interface OverridesProjectEntry {
  /** 最后写入时间（毫秒；仅供诊断 / 将来清理）。 */
  updatedAt: number;
  /** 最近一次写入时的工作区 cwd（诊断用；key 是项目根）。 */
  cwd?: string;
  /** 本项目默认关闭的全局 MCP server 键。 */
  mcp?: string[];
  /** 本项目默认关闭的注入技能名。 */
  skills?: string[];
}

/** 统一存储文件的完整形状（`version: 1`）。 */
export interface OverridesStore {
  version: number;
  /** 项目根 → 该项目默认关闭清单。 */
  projects: Record<string, OverridesProjectEntry>;
}

/** 面板视角的完整禁用状态（attach 上声明文件的绝对路径）。 */
export interface OverridesView extends OverridesSet {
  /** 统一存储文件绝对路径（无项目时缺省）。 */
  filePath?: string;
  /** 当前项目根（统一存储的 key；无项目时缺省）。 */
  projectRoot?: string;
}
