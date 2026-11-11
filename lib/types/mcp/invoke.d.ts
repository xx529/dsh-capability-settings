/**
 * MCP 工具的**调试调用**（宿主侧，一次性连接、零挂载）。
 *
 * 与 `mcp/probe.ts` 的关系：
 *   - 复用同一个 `openMcpSession`（同一 SDK `Client` + `toClientConfig` +
 *     硬超时 + stderr 收集 + `finally` 关连接），因此**不挂载、不注册工具、
 *     不给存活 session 留副作用**；
 *   - 区别只在连上之后做的事：探测列 `tools/list`，这里调 `tools/call`。
 *
 * 调用结果按 MCP `CallToolResult` 原样回传（`content` / `structuredContent`
 * / `isError`），面板负责按 content 类型渲染。响应体有硬上限
 * {@link MAX_RESULT_CHARS}：超长文本会被截断并标记，避免一次调用把 RPC
 * 响应撑爆。
 *
 * @module dsh-capability-settings/mcp/invoke
 */
import type { McpServerEntry } from "./types.js";
/**
 * 面板调试调用的登记标记：作为 `tools.execute` 的 callId 前缀。
 *
 * 使用记录 guard（`mcp/usage.ts`）按这个前缀跳过记录——调试调用不是对话
 * 里的真实调用，不能混进「使用记录」。
 */
export declare const MCP_DEBUG_CALL_ID = "capability-panel-debug";
/** 调试调用默认超时（毫秒）：与探测一致。 */
export declare const DEFAULT_INVOKE_TIMEOUT_MS = 60000;
/** 调试调用硬上限（毫秒）。 */
export declare const MAX_INVOKE_TIMEOUT_MS = 60000;
/** 一次调试调用的入参（配置条目与外部实例二选一）。 */
export interface McpInvokeInput {
    /** 配置条目键名（决定命名空间；外部实例路径不用）。 */
    key?: string;
    /** 配置条目（配置条目路径必填；外部实例路径不传）。 */
    entry?: McpServerEntry;
    /** 外部注入实例的 serverName（配置条目路径不传）。 */
    serverName?: string;
    /** 服务器原始工具名（不是 `mcp__*` 公共名）。 */
    tool: string;
    /** 调用参数（必须是 JSON 对象；缺省 `{}`）。 */
    arguments?: unknown;
    /** 条目未写 cwd 时 stdio 用的兜底工作目录（通常是项目根 / 工作区）。 */
    cwd?: string;
    /** 超时（毫秒）；缺省 {@link DEFAULT_INVOKE_TIMEOUT_MS}，夹到硬上限。 */
    timeoutMs?: number;
}
/** 一个内容块（MCP `content` 数组元素，原样透传为可序列化 JSON）。 */
export type McpInvokeContent = Record<string, unknown>;
/** 调试调用结果：成功带内容块与耗时，失败带人类可读错误。 */
export type McpInvokeResult = {
    ok: true;
    /** MCP `CallToolResult.content`（text / image / resource …）。 */
    content: McpInvokeContent[];
    /** MCP `CallToolResult.structuredContent`（有则带上）。 */
    structuredContent?: unknown;
    /** 服务器是否把这次调用标记为工具错误。 */
    isError: boolean;
    /** 墙钟耗时（毫秒，含连接）。 */
    elapsedMs: number;
} | {
    ok: false;
    errors: string[];
};
/** 参数必须是 JSON 对象（不是数组 / null / 标量）。 */
export declare function normalizeInvokeArguments(value: unknown): {
    ok: true;
    value: Record<string, unknown>;
} | {
    ok: false;
    errors: string[];
};
/**
 * 通过**一次性连接**调用一个 MCP 工具（配置条目路径）。
 *
 * 失败（校验不过 / 连接失败 / 超时 / 服务器抛错）统一返回
 * `{ ok:false, errors }`，绝不抛到 RPC 层；任何路径都在 `finally` 关闭连接。
 */
export declare function callToolOnce(input: McpInvokeInput): Promise<McpInvokeResult>;
/**
 * 把 content 数组压到响应预算内：逐个累计序列化长度，超预算的文本块截断，
 * 后续块丢弃并补一个说明块。非文本块（image / resource）按整块保留到超限。
 */
export declare function boundInvokeContent(content: McpInvokeContent[]): McpInvokeContent[];
/** structuredContent 的预算：超长 JSON 截断成字符串说明。 */
export declare function boundInvokeValue(value: unknown): unknown;
