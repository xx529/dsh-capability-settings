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
export {};
