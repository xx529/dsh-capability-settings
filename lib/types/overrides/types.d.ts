/**
 * 项目级"全局能力禁用"的共享类型。
 *
 * 用途：允许在**单个项目**里禁用某些**全局**能力，而不改动全局配置文件——
 * 禁用声明只写在项目的 `.agents/capability-overrides.json` 里（读取兼容旧位置
 * `.dsh` / `.claude`），影响范围仅限该项目：
 *
 *   - MCP：自动挂载器为本项目的 session 解析配置时跳过被禁用的全局 server
 *     （项目自身的同名条目不受影响）；
 *   - Skills：**只对宿主 registry 注入的技能**（内置 / 插件 / preset）生效。
 *     注入技能没有磁盘文件，禁停 = 在该项目 live 会话的 agent 作用域注册同名
 *     runtime shadow（见 `skills/session.ts`）。磁盘技能的项目级禁停仍走
 *     frontmatter + shadow stub（`skills/shadow.ts`），不写这份声明
 *     （Lead 裁定 R7）。
 *
 * 磁盘形状（保持最小化：空数组不落盘）：
 *
 * ```jsonc
 * {
 *   "mcp": ["github"],
 *   "skills": ["figma-workbench"]
 * }
 * ```
 *
 * @module dsh-capability-settings/overrides/types
 */
/** 可被项目级禁用的能力域（mcp = 配置文件条目；skills = 宿主注入技能）。 */
export type CapabilityDomain = "mcp" | "skills";
/** 项目级禁用声明的完整磁盘形状。 */
export interface CapabilityOverrides {
    /** 被本项目禁用的全局 MCP server 键列表。 */
    mcp?: string[];
    /** 被本项目默认禁用的注入技能名列表（kebab-case）。 */
    skills?: string[];
}
/** 一个能力域 → 该域的项目级禁用清单（规范化后：去重、trim、排序）。 */
export type OverridesSet = {
    [K in CapabilityDomain]: string[];
};
/** 面板视角的完整禁用状态（attach 上声明文件的绝对路径）。 */
export interface OverridesView extends OverridesSet {
    /** 声明文件绝对路径（无项目时缺省）。 */
    filePath?: string;
}
