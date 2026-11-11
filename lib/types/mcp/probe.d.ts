/**
 * MCP 服务器配置的**连通性探测**（宿主侧，只读、零副作用）。
 *
 * 用途：面板「测试」按钮在保存之前真实连接一份草稿配置，连上后列出该服务器
 * 暴露的工具名与入参（工具的 `inputSchema`），让用户当场确认配置是否正确。
 *
 * 与 `mcp/loader.ts` 的挂载路径**完全隔离**：
 *   - 只创建一次性的 `Client` + transport，用完即关（`finally` 里
 *     `client.close()`，再兜底 `transport.close()`），任何路径都不残留
 *     stdio 子进程；
 *   - **绝不**把工具注册进宿主 tools 注册表（不挂 mcp-client 桥接、不碰
 *     `ctx`），因此对存活的 session 零影响；
 *   - 任何失败都收敛成 `{ ok:false, errors }` 业务失败信封，绝不抛到 RPC 层。
 *
 * 超时：`timeoutMs` 缺省 {@link DEFAULT_PROBE_TIMEOUT_MS}，硬上限
 * {@link MAX_PROBE_TIMEOUT_MS}；超时通过 AbortSignal 中断 connect / listTools，
 * 回收子进程交给 SDK 的 `StdioClientTransport.close()`（stdin end → SIGTERM →
 * SIGKILL）。
 *
 * 连接序列与 `@deepseek-ai/dsh-mcp-client` 的桥接实现保持一致（同一 SDK 版本
 * 的 `Client` + `versionNegotiation:{mode:'auto'}` + `listTools(undefined,
 * {cacheMode:'refresh'})`），配置形状取自本仓库的 `toClientConfig`（`${VAR}`
 * 插值沿用同一函数，不另写一套）。
 *
 * @module dsh-capability-settings/mcp/probe
 */
import { Client } from "@modelcontextprotocol/client";
import type { McpServerEntry } from "./types.js";
/** 探测默认超时（毫秒）。 */
export declare const DEFAULT_PROBE_TIMEOUT_MS = 15000;
/** 探测硬上限（毫秒）：调用方给再大的值也会被夹到这里。 */
export declare const MAX_PROBE_TIMEOUT_MS = 60000;
/** 探测入参：一份（可能是尚未保存的草稿）条目 + 命名键。 */
export interface McpProbeInput {
    /** 条目键名：经 `sanitizeServerName` 变成桥接层命名空间（见 toClientConfig）。 */
    key: string;
    /** 待探测的条目。 */
    entry: McpServerEntry;
    /** 条目未写 cwd 时 stdio 用的兜底工作目录（通常是项目根）。 */
    cwd?: string;
    /** 探测超时（毫秒），缺省 {@link DEFAULT_PROBE_TIMEOUT_MS}，硬上限 {@link MAX_PROBE_TIMEOUT_MS}。 */
    timeoutMs?: number;
}
/** 探测出的一个工具：`parameters` 即 MCP 的 `inputSchema`（JSON Schema）。 */
export interface McpProbedTool {
    name: string;
    description?: string;
    /** 工具的 inputSchema；面板读它的 `properties` / `required` 渲染参数表。 */
    parameters?: Record<string, unknown>;
    outputSchema?: unknown;
}
/** 探测结果：成功带回工具清单与耗时，失败带回人类可读错误文案。 */
export type McpProbeResult = {
    ok: true;
    /** 规范化后的命名空间（与挂载后的 `mcp__<serverName>__*` 一致）。 */
    serverName: string;
    tools: McpProbedTool[];
    /** 连接 + 列工具的墙钟耗时（毫秒）。 */
    elapsedMs: number;
    /** 服务器自报的 instructions（有则截断到 {@link MAX_INSTRUCTION_CHARS}）。 */
    instruction?: string;
} | {
    ok: false;
    errors: string[];
};
/**
 * 一条已连接的一次性 MCP 会话（探测 / 调试调用共用）。
 *
 * 生命周期由调用方负责：任何路径都必须 `await session.close()`（内部会关
 * client 与 transport，回收 stdio 子进程）；`signal` 到点会自动 abort。
 */
export interface McpClientSession {
    /** 已 connect 的 SDK Client。 */
    client: Client;
    /** 硬超时用的 signal（connect / listTools / callTool 都传它）。 */
    signal: AbortSignal;
    /** 本次会话的超时预算（毫秒）。 */
    timeoutMs: number;
    /** 规范化后的命名空间（与挂载后的 `mcp__<serverName>__*` 一致）。 */
    serverName: string;
    /** 连接期间累计的服务器 stderr（截断到 {@link MAX_STDERR_CHARS}）。 */
    stderrTail(): string;
    /** 是否已因超时被中断。 */
    timedOut(): boolean;
    /** 一行人类可读的连接目标（只用于错误文案）。 */
    target: string;
    /** 关闭会话（幂等；绝不抛错）。 */
    close(): Promise<void>;
}
/** `openMcpSession` 的结果：成功给会话，失败给人类可读错误（不抛）。 */
export type McpSessionOpenResult = {
    ok: true;
    session: McpClientSession;
} | {
    ok: false;
    errors: string[];
};
/**
 * 打开一次**一次性** MCP 连接（不落盘、不注册工具、不碰 loader）。
 *
 * 连接序列与桥接层一致（同一 SDK Client + versionNegotiation auto + 配置
 * 形状取自 `toClientConfig`）。失败（含超时 / 命令不存在 / HTTP 鉴权失败）
 * 收敛成 `{ ok:false, errors }`；调用方在 `finally` 里仍要调用
 * `session.close()`（成功路径），失败路径这里已经收尾。
 */
export declare function openMcpSession(input: McpProbeInput): Promise<McpSessionOpenResult>;
/**
 * 真实连接一次 MCP 配置并列出其工具。
 *
 * 只读探测：不落盘、不改 loader 状态、不注册任何工具、不保留任何子进程。
 * 失败（含超时、命令不存在、HTTP 鉴权失败）统一返回 `{ ok:false, errors }`。
 */
export declare function probeMcpServer(input: McpProbeInput): Promise<McpProbeResult>;
