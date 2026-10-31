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
export {};
