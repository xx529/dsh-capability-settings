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
export {};
