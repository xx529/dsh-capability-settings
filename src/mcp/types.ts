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

/** 一条 MCP server 条目所在的作用域。 */
export type McpScope = "project" | "global";

/**
 * 磁盘上 `mcpServers` 的一条条目。`type` 对 stdio 条目可以省略
 * （Claude Code 惯例）；`"http"` 与 `"sse"` 都会映射到桥接层的
 * `streamable-http` 传输。
 */
export interface McpServerEntry {
  /** 传输方式：stdio / http / sse（缺省按 command 或 url 推断）。 */
  type?: "stdio" | "http" | "sse";
  /** stdio 传输时启动的命令。 */
  command?: string;
  /** 命令参数。 */
  args?: string[];
  /** 子进程环境变量（值支持 `${VAR}` 插值）。 */
  env?: Record<string, string>;
  /** stdio 子进程工作目录（缺省用项目根）。 */
  cwd?: string;
  /** http / sse 传输的端点 URL。 */
  url?: string;
  /** http 请求头（值支持 `${VAR}` 插值）。 */
  headers?: Record<string, string>;
  /** 单次工具调用超时（毫秒），映射到桥接层 toolCallTimeoutMs。 */
  timeoutMs?: number;
  /** 为 true 时保留条目但不挂载。 */
  disabled?: boolean;
  /**
   * 「从全局导入」标记：importToProject 写入项目副本。面板据此把项目区
   * 详情卡的归属徽标显示为「全局」、移除按钮命名为「移出」（与 skills
   * 的导入标记同一语义）。只出现在项目条目上。
   */
  importedFromGlobal?: boolean;
}

/** 面板视角下的一条 server 配置（跨作用域合并后的视图）。 */
export interface McpServerView {
  /** 文件里写的条目键名。 */
  key: string;
  /** 桥接层挂载用的规范化命名空间（工具形如 `mcp__<serverName>__*`）。 */
  serverName: string;
  /** 归类后的传输方式（stdio / http）。 */
  transport: "stdio" | "http";
  scope: McpScope;
  /** 是否启用（disabled 键缺省为启用）。 */
  enabled: boolean;
  /** 为 true 时表示同名项目条目遮蔽了这个全局条目。 */
  shadowed: boolean;
  /** 一行人类可读摘要（命令行或 URL）。 */
  summary: string;
  /** 原始条目，回填到编辑表单里。 */
  entry: McpServerEntry;
  /** 声明这条条目的文件绝对路径。 */
  filePath: string;
  /**
   * 为 true 表示这条视图是**项目级引用**（`.agents/capability-imports.json`
   * 里登记的引用）：内容实时取自同名全局条目（不是物理副本），启停是
   * 引用上的项目级 `disabled` 标记。引用条目与项目原生条目同级参与
   * 挂载合并（遮蔽全局原版）。
   */
  reference?: boolean;
  /**
   * 为 true 表示这条**项目**条目与全局条目同源：引用视图（reference）
   * 恒带此标记；旧版「导入 = 物理复制」时期导入的副本（条目里带
   * `importedFromGlobal` 标记）也带此标记。面板据此把归属徽标显示为
   * 「全局」、移除按钮命名为「移出」。
   */
  importedFromGlobal?: boolean;
  /**
   * 为 true 表示这个**全局** server 被当前项目（list 的 cwd）在项目级声明为
   * 禁用：本项目的 session 不会挂载它（loader 跳过），面板保留展示（带
   * "本项目禁用"标记）。只对全局条目设置；项目条目恒缺省。
   */
  disabledInProject?: boolean;
}

/** 合并列表操作的结果；单个文件解析失败不致命，收集到 errors 里。 */
export interface McpListResult {
  servers: McpServerView[];
  errors: string[];
}

/** 一条 server 在一个 session 内的实时挂载状态。 */
export type McpMountState = "mounted" | "failed" | "conflict";

/**
 * 一条挂载记录的归属层：
 *
 *   - `global`：全应用共享的全局单例层（挂在插件自己的 ctx 上，
 *     `serverName` 按 `ctx.root` 预留，所有 session 复用同一份进程/连接）；
 *   - `session`：该 session 独占的项目层（挂在 `agent.ctx` 上，`serverName`
 *     按该 agent 的作用域预留，天然按会话隔离）。
 *
 * 省略时按 `session` 解读，保证旧客户端（只读
 * `status[].servers[].{key,serverName,state,error}`）的语义不变。
 */
export type McpMountScope = "global" | "session";

/**
 * 一条「按会话屏蔽全局 server」的结果（`tools.restrict` 能力的可观测性）。
 *
 * 项目级「禁用全局 server」在全局层成为共享单例后无法靠"不挂载"实现，
 * 只能在 session 上屏蔽该 session 继承到的全局工具；本视图让面板能看到
 * 屏蔽是否真的生效，以及降级原因。
 */
export interface McpRestrictionView {
  /** 被屏蔽的全局 server 条目键。 */
  key: string;
  /**
   * `applied` = 已生效；`skipped` = 当前没有可屏蔽的全局工具（server 尚未
   * 连接、或宿主未注册任何该 server 的工具），本次未调用 restrict；
   * `failed` = restrict 调用抛错（已降级，全局工具对本会话仍可见）。
   */
  state: "applied" | "skipped" | "failed";
  error?: string;
}

/** 某个 session（或全局层）的 MCP 实时挂载状态视图。 */
export interface McpStatusView {
  sessionId: string;
  /** 该 session 的项目根（无工作区时缺省）。全局层缺省。 */
  projectRoot?: string;
  /** 本记录的归属层；缺省按 `session` 解读（向后兼容）。 */
  scope?: McpMountScope;
  servers: Array<{
    key: string;
    serverName: string;
    state: McpMountState;
    error?: string;
  }>;
  /** 该 session 上「全局 server 被本项目屏蔽」的结果（仅 session 层携带）。 */
  restrictions?: McpRestrictionView[];
  /**
   * 后台是否还有重挂在进行（全局换代 / 本 session 换代）。
   *
   * 写入路径不再等待重挂完成（见 `manager.reloadFor` 的注释），所以 RPC 返回
   * 后挂载状态可能还在收敛；面板在 `settling` 为真时短暂轮询，几秒内自行刷新。
   */
  settling?: boolean;
}
// ---------------------------------------------------------------------------
// MCP 工具调用使用记录（内存内、只读、不落盘）
// ---------------------------------------------------------------------------

/** 环形缓冲容量：进程内最多保留多少条调用记录（超出丢弃最旧的）。 */
export const MCP_USAGE_CAPACITY = 200;

/** 面板一次最多展示多少条（"只显示最近的 n 条"）。 */
export const MCP_USAGE_VIEW_LIMIT = 50;

/**
 * 一条 MCP 工具调用记录。
 *
 * 语义边界：记录的是**调用尝试**（在 `tools.guard` 里、执行前同步记录），
 * 不代表工具执行成功；只用于"最近谁在什么时候调了什么"的只读展示。
 */
export interface McpUsageEntry {
  /** 调用时间（epoch 毫秒）。 */
  time: number;
  /** 桥接层 serverName（对应面板视图的 `serverName`）。 */
  serverName: string;
  /** 已去掉 `mcp__<serverName>__` 前缀的工具名。 */
  tool: string;
  /** 调用方 session id（非 agent 发起的调用为空串）。 */
  sessionId: string;
}

/** `mcp.usage` 的返回：最近若干条记录 + 本次生效的条数上限。 */
export interface McpUsageView {
  entries: McpUsageEntry[];
  /** 本次返回实际使用的"最近 n 条"上限（面板据此显示文案）。 */
  limit: number;
}

// ---------------------------------------------------------------------------
// 运行时注入的 MCP（不是本插件配置文件里的条目）——只读展示
// ---------------------------------------------------------------------------

/**
 * 一个**运行时注入**的 MCP server 视图。
 *
 * 来源：别的插件或 profile 在 root / agent 作用域直接挂 `@deepseek-ai/dsh-mcp-client`
 * （典型是 profile 的 `cordis.patch.yml` 里插入的 mcp-client 条目）。这类实例不在
 * 本插件的配置文件里，因此**只读**：面板不管理、不编辑、不卸载它们。
 */
export interface McpRuntimeServerView {
  /** 实例的 serverName（工具名 `mcp__<serverName>__<tool>` 里的那段）。 */
  serverName: string;
  /** 从全局工具注册表反推到的工具（agent 作用域注入的实例可能为空）。 */
  tools: Array<{ name: string; description?: string }>;
  /** 本次运行被调用过的次数（来自内存使用记录；0 = 没调用过或不可见）。 */
  calls: number;
}

/** `mcp.runtime` 的返回。 */
export interface McpRuntimeView {
  servers: McpRuntimeServerView[];
}
