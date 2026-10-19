/**
 * MCP 管理域的共享类型。
 *
 * 磁盘形状刻意与 Claude Code 的 `.mcp.json` 兼容：
 *
 * ```jsonc
 * {
 *   "mcpServers": {
 *     "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "TOKEN": "${GITHUB_TOKEN}" } },
 *     "web":    { "type": "http", "url": "http://localhost:3000/mcp", "headers": { "Authorization": "Bearer ..." } }
 *   }
 * }
 * ```
 *
 * 超出 Claude Code 形状的扩展字段：
 *   - `"disabled": true` —— 保留条目但跳过挂载；
 *   - `"timeoutMs"` —— 映射到桥接层的单次工具调用超时；
 *   - `"cwd"` —— 覆盖子进程工作目录（仅 stdio）；
 *   - `"importedFromGlobal": true` —— 「从全局导入」标记（只出现在项目
 *     副本上，见 manager.ts 的 importToProject）。
 *
 * @module @chengdb/capability-panel/mcp/types
 */
// ---------------------------------------------------------------------------
// MCP 工具调用使用记录（内存内、只读、不落盘）
// ---------------------------------------------------------------------------
/** 环形缓冲容量：进程内最多保留多少条调用记录（超出丢弃最旧的）。 */
export const MCP_USAGE_CAPACITY = 200;
/** 面板一次最多展示多少条（"只显示最近的 n 条"）。 */
export const MCP_USAGE_VIEW_LIMIT = 50;
