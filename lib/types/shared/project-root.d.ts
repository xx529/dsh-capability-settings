/**
 * 项目根 = **当前工作区目录本身**（v2.0 起）。
 *
 * 历史行为是从 cwd 向上找第一个含 `.git` / `.dsh` / `.agents` / `.claude` /
 * `dsh.json` 的祖先目录，导致「工作区」是子目录时，项目级 MCP / Skills 配置
 * 落到父目录、被同根多个工作区共享（与面板「工作区」语义不一致，用户明确要求
 * 以工作区目录为项目配置的归属）。
 *
 * 现在所有「项目级」路径都直接使用工作区目录：
 *   - 项目级 MCP：`<工作区>/.mcp.json`
 *   - 项目级 Skills：`<工作区>/.agents/skills`（以及 `.dsh` 兼容路径）
 *   - 项目级 overrides / imports：按工作区目录存放
 *   - MCP loader 的项目层条目、会话项目默认投影同样按工作区目录解析
 *
 * 不再向上探测，也**不兼容**旧的项目根（祖先目录）配置——旧文件不会被读取。
 *
 * @module dsh-capability-settings/shared/project-root
 */
/**
 * 返回工作区目录（= 项目根）。
 *
 * 保留函数名以兼容既有调用方；语义是「项目级配置的归属目录 = 工作区自身」。
 *
 * @param cwd 工作区路径（绝对路径）
 * @returns 规范化后的工作区绝对路径
 */
export declare function findProjectRoot(cwd: string): string;
