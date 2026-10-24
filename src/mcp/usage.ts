/**
 * MCP 工具调用的**内存内使用记录**（只读展示用，**绝不落盘**）。
 *
 * 为什么放在宿主：工具调用的分发发生在宿主进程里，插件可通过 `tools.guard`
 * 旁路观察（契约原文：「Register a monotonic guard after the extensible
 * `tools/pre-execute` waterfall. A plain-context guard applies globally …
 * synchronous check; a returned string denies the execution.」）。本模块注册的
 * guard 永远返回 `undefined`（放行），只把 `mcp__<serverName>__<tool>` 这类
 * 调用记进一个固定容量的环形缓冲，因此：
 *  - **零副作用**：不写文件、不影响执行、不影响其它 guard；
 *  - **进程内生命周期**：插件重载/应用重启即清空，符合"不需要持久化"的诉求；
 *  - 记录失败一律吞掉（不能让一次记录拖垮工具调用）。
 *
 * 会话标题不在宿主：`SessionHeader` 只有 id/cwd 等字段、没有标题（标题由客户端按
 * 会话事件派生）。所以这里只记 `sessionId`，面板用自己的会话快照解析成标题，
 * 拿不到时退化为会话 id。
 *
 * @module dsh-capability-settings/mcp/usage
 */

import { MCP_USAGE_CAPACITY, MCP_USAGE_VIEW_LIMIT, type McpUsageEntry, type McpUsageView } from "./types.js";

/** 一条调用记录的输入（时间由记录方填）。 */
export interface McpUsageRecordInput {
  /** 桥接层的 serverName（面板用 `McpServerView.serverName` 对应）。 */
  serverName: string;
  /** 已去掉 `mcp__<serverName>__` 前缀的工具名。 */
  tool: string;
  /** 调用方 session id（拿不到时为空串）。 */
  sessionId: string;
}

/** 内存使用记录器。 */
export interface McpUsageLog {
  /** 追加一条记录；超出容量时丢弃最旧的（环形缓冲）。 */
  record(input: McpUsageRecordInput): void;
  /** 只读查询：按 serverName 过滤，最多返回最近 `limit` 条。 */
  query(input?: { serverName?: string; limit?: number }): McpUsageView;
  /** 当前保留的记录总数（诊断/测试用）。 */
  size(): number;
  /** 记录里出现过的 serverName（去重，最近在前的顺序不保证）。 */
  serverNames(): string[];
  /** 某个 server 的记录条数（用于"本次运行调用 N 次"）。 */
  count(serverName: string): number;
}

/** 工具名前缀：桥接层注册 MCP 工具时的命名空间约定。 */
const MCP_TOOL_PREFIX = "mcp__";

/**
 * 从桥接层工具名解析出 serverName 与原始工具名。
 *
 * 约定是 `mcp__<serverName>__<tool>`；serverName 由 `sanitizeServerName` 保证只含
 * `[A-Za-z0-9_-]`，所以**第一个** `__` 之后就是工具名本身（工具名里即使含 `__`
 * 也不影响切分）。非 MCP 工具或畸形名字返回 undefined（不记录）。
 */
export function parseMcpToolName(name: string): { serverName: string; tool: string } | undefined {
  if (typeof name !== "string" || !name.startsWith(MCP_TOOL_PREFIX)) return undefined;
  const rest = name.slice(MCP_TOOL_PREFIX.length);
  const split = rest.indexOf("__");
  if (split <= 0) return undefined;
  const serverName = rest.slice(0, split);
  const tool = rest.slice(split + 2);
  if (serverName.length === 0 || tool.length === 0) return undefined;
  return { serverName, tool };
}

/**
 * 创建内存使用记录器。
 *
 * @param capacity 环形缓冲容量（缺省 {@link MCP_USAGE_CAPACITY}）。
 */
export function createMcpUsageLog(capacity: number = MCP_USAGE_CAPACITY): McpUsageLog {
  const safeCapacity = Math.max(1, Math.trunc(capacity));
  const entries: McpUsageEntry[] = [];
  return {
    record(input) {
      entries.push({
        time: Date.now(),
        serverName: input.serverName,
        tool: input.tool,
        sessionId: typeof input.sessionId === "string" ? input.sessionId : "",
      });
      if (entries.length > safeCapacity) entries.splice(0, entries.length - safeCapacity);
    },
    query(input) {
      const requested = Math.trunc(input?.limit ?? MCP_USAGE_VIEW_LIMIT);
      const limit = Math.min(safeCapacity, Math.max(1, Number.isFinite(requested) ? requested : MCP_USAGE_VIEW_LIMIT));
      const filtered =
        typeof input?.serverName === "string" && input.serverName.length > 0
          ? entries.filter((entry) => entry.serverName === input.serverName)
          : entries;
      // 复制出去：调用方拿到的永远是快照，不能改到缓冲里。
      return { entries: filtered.slice(-limit).map((entry) => ({ ...entry })), limit };
    },
    size() {
      return entries.length;
    },
    serverNames() {
      return [...new Set(entries.map((entry) => entry.serverName))];
    },
    count(serverName) {
      let total = 0;
      for (const entry of entries) if (entry.serverName === serverName) total += 1;
      return total;
    },
  };
}

/**
 * 在全应用范围旁路记录 MCP 工具调用。
 *
 * 从插件自己的 ctx 注册 → 契约上「plain-context guard applies globally」，因此
 * 所有 session 的 MCP 调用都会经过这里。**永远返回 `undefined` 放行**，任何记录
 * 异常都在内部吞掉；`tools` / `tools.guard` 不可用（旧外壳）时注册为空操作。
 *
 * @returns 卸载 guard 的 disposer（插件卸载/HMR 时由 ctx.effect 调用）。
 */
export function registerMcpUsageGuard(ctx: any, usage: McpUsageLog): () => void {
  try {
    const tools = ctx.get?.("tools");
    if (typeof tools?.guard !== "function") return () => undefined;
    return tools.guard((execution: any) => {
      try {
        const parsed = parseMcpToolName(typeof execution?.name === "string" ? execution.name : "");
        if (parsed !== undefined) {
          const sessionId = execution?.agent?.id;
          usage.record({
            serverName: parsed.serverName,
            tool: parsed.tool,
            sessionId: typeof sessionId === "string" ? sessionId : "",
          });
        }
      } catch {
        /* 记录失败绝不影响工具执行 */
      }
      // 永远放行：这个 guard 只观察，不拦截。
      return undefined;
    });
  } catch {
    return () => undefined;
  }
}
