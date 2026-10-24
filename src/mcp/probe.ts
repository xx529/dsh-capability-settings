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

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { toClientConfig, type McpClientConfig } from "./config-file.js";
import type { McpServerEntry } from "./types.js";

/** 探测默认超时（毫秒）。 */
export const DEFAULT_PROBE_TIMEOUT_MS = 15_000;

/** 探测硬上限（毫秒）：调用方给再大的值也会被夹到这里。 */
export const MAX_PROBE_TIMEOUT_MS = 60_000;

/** 探测超时下限（毫秒）：避免误传 0/负数把连接瞬间掐断。 */
const MIN_PROBE_TIMEOUT_MS = 500;

/** 连接期间最多保留的子进程 stderr 字符数（失败时拼进错误文案）。 */
const MAX_STDERR_CHARS = 4_000;

/** 服务器 instructions 最多回传的字符数（避免撑爆 RPC 响应）。 */
const MAX_INSTRUCTION_CHARS = 4_000;

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
export type McpProbeResult =
  | {
      ok: true;
      /** 规范化后的命名空间（与挂载后的 `mcp__<serverName>__*` 一致）。 */
      serverName: string;
      tools: McpProbedTool[];
      /** 连接 + 列工具的墙钟耗时（毫秒）。 */
      elapsedMs: number;
      /** 服务器自报的 instructions（有则截断到 {@link MAX_INSTRUCTION_CHARS}）。 */
      instruction?: string;
    }
  | { ok: false; errors: string[] };

/**
 * 真实连接一次 MCP 配置并列出其工具。
 *
 * 只读探测：不落盘、不改 loader 状态、不注册任何工具、不保留任何子进程。
 * 失败（含超时、命令不存在、HTTP 鉴权失败）统一返回 `{ ok:false, errors }`。
 */
export async function probeMcpServer(input: McpProbeInput): Promise<McpProbeResult> {
  const timeoutMs = clampTimeout(input.timeoutMs);
  const startedAt = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  // 硬超时：到点就中断 connect / listTools，不让探测无限挂起。
  // unref 让这个定时器本身不拖住宿主进程退出。
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  timer.unref();

  let client: Client | undefined;
  let transport: StdioClientTransport | StreamableHTTPClientTransport | undefined;
  let stderrTail = "";
  let target = describeInput(input);

  try {
    const config = toClientConfig(input.key, input.entry, input.cwd);
    target = describeConfig(config);
    transport = createTransport(config, (chunk) => {
      stderrTail = appendBounded(stderrTail, chunk, MAX_STDERR_CHARS);
    });

    client = new Client(
      { name: "capability-panel", version: "1.1.0" },
      {
        capabilities: {},
        versionNegotiation: { mode: "auto" },
        // 桥接层的同一套配置：不自动刷新列表（探测只拉一次）。
        listChanged: { tools: { autoRefresh: false, debounceMs: 0, onChanged: () => {} } },
      },
    );

    await client.connect(transport, { signal: controller.signal, timeout: timeoutMs });

    // 服务器未声明 tools 能力时不必发 tools/list（与桥接层同一口径）；
    // 未开 enforceStrictCapabilities，此处只是省一次往返。
    const listed = client.getServerCapabilities()?.tools === undefined
      ? []
      : (await client.listTools(undefined, { cacheMode: "refresh", signal: controller.signal, timeout: timeoutMs })).tools;
    const tools = listed.map(toProbedTool);

    const instructions = client.getInstructions()?.trim();
    return {
      ok: true,
      serverName: config.serverName,
      tools,
      elapsedMs: Date.now() - startedAt,
      ...(instructions !== undefined && instructions.length > 0 ? { instruction: instructions.slice(0, MAX_INSTRUCTION_CHARS) } : {}),
    };
  } catch (error) {
    return { ok: false, errors: failureMessages(error, { timedOut, timeoutMs, target, stderrTail }) };
  } finally {
    // 任何路径（成功 / 失败 / 超时）都在这里收尾：先关 client（内部会关
    // transport），再兜底关一次 transport（connect 中途失败时 client 可能
    // 还没接管 transport）。重复 close 幂等，关键是**不留下 stdio 子进程**。
    await closeQuietly(client);
    await closeQuietly(transport);
  }
}

/** 按传输方式建 transport；stdio 收集 stderr 供失败诊断（并防止管道反压）。 */
function createTransport(config: McpClientConfig, onStderr: (chunk: string) => void): StdioClientTransport | StreamableHTTPClientTransport {
  if (config.transport === "stdio") {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      // 只传条目自己的 env；PATH 等宿主变量由 SDK 的 getDefaultEnvironment 合并。
      env: config.env,
      // stderr 走 pipe：失败时能拿到服务器原始诊断，同时避免无人消费的
      // stderr 管道写满把子进程卡住。getter 在构造后即返回可监听的流。
      stderr: "pipe",
      // cwd 为空串时交给 spawn 继承宿主 cwd（空串对 spawn 是非法值）。
      ...(config.cwd.length > 0 ? { cwd: config.cwd } : {}),
    });
    transport.stderr?.on("data", (chunk: Buffer | string) => onStderr(String(chunk)));
    return transport;
  }
  return new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } });
}

/** 把 SDK 的工具对象投影成面板所需的形状（缺失字段不占位）。 */
function toProbedTool(tool: { name: string; description?: string; inputSchema?: unknown; outputSchema?: unknown }): McpProbedTool {
  const description = typeof tool.description === "string" ? tool.description.trim() : "";
  return {
    name: tool.name,
    ...(description.length > 0 ? { description } : {}),
    ...(tool.inputSchema !== undefined && tool.inputSchema !== null ? { parameters: tool.inputSchema as Record<string, unknown> } : {}),
    ...(tool.outputSchema !== undefined && tool.outputSchema !== null ? { outputSchema: tool.outputSchema } : {}),
  };
}

/** 组装失败文案：中文结论 + 原始错误 + 鉴权提示 + 服务器 stderr。 */
function failureMessages(error: unknown, ctx: { timedOut: boolean; timeoutMs: number; target: string; stderrTail: string }): string[] {
  const raw = error instanceof Error ? error.message : error === undefined || error === null ? "" : String(error);
  const messages = [ctx.timedOut ? `连接测试超时（超过 ${ctx.timeoutMs}ms）：${ctx.target}` : `无法连接 MCP 服务器：${ctx.target}`];
  if (raw.length > 0) messages.push(`原始错误：${raw}`);
  if (/HTTP (401|403)\b/.test(raw)) {
    messages.push("服务器要求鉴权：请在「请求头」里配置 Authorization 等凭据（值支持 ${VAR} 插值，取宿主环境变量）。");
  }
  const stderr = ctx.stderrTail.trim();
  if (stderr.length > 0) messages.push(`服务器 stderr：${stderr}`);
  return messages;
}

/** 一行人类可读的连接目标（只用于错误文案）。 */
function describeConfig(config: McpClientConfig): string {
  if (config.transport === "stdio") {
    return `命令 ${[config.command, ...config.args].filter((part) => part.length > 0).join(" ")}`;
  }
  return `URL ${config.url}`;
}

/** 在 config 还没算出来（toClientConfig 抛错）时的兜底描述。 */
function describeInput(input: McpProbeInput): string {
  const entry = input.entry;
  if (entry !== null && typeof entry === "object" && typeof entry.url === "string" && entry.url.length > 0) return `URL ${entry.url}`;
  const command = entry !== null && typeof entry === "object" && typeof entry.command === "string" ? entry.command : "";
  return command.length > 0 ? `命令 ${command}` : "该 MCP 服务器配置";
}

/** 超时值夹取：非有限值回落到默认值，再夹到 [min, max]。 */
function clampTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_PROBE_TIMEOUT_MS;
  return Math.min(Math.max(Math.floor(value), MIN_PROBE_TIMEOUT_MS), MAX_PROBE_TIMEOUT_MS);
}

/** 追加文本但只保留末尾 limit 个字符（stderr 诊断只需要最后一段）。 */
function appendBounded(current: string, chunk: string, limit: number): string {
  const next = `${current}${chunk}`;
  return next.length > limit ? next.slice(-limit) : next;
}

/** 关闭一个可关闭对象，吞掉错误（收尾失败不能改变探测结果）。 */
async function closeQuietly(target: { close(): Promise<void> } | undefined): Promise<void> {
  if (target === undefined) return;
  try {
    await target.close();
  } catch {
    // 关不掉也不抛：stdio 子进程回收由 SDK 的 close 内部兜底（SIGTERM/SIGKILL）。
  }
}
