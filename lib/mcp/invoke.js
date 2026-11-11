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
import { openMcpSession } from "./probe.js";
import { validateEntry } from "./entry-util.js";
/**
 * 面板调试调用的登记标记：作为 `tools.execute` 的 callId 前缀。
 *
 * 使用记录 guard（`mcp/usage.ts`）按这个前缀跳过记录——调试调用不是对话
 * 里的真实调用，不能混进「使用记录」。
 */
export const MCP_DEBUG_CALL_ID = "capability-panel-debug";
/** 调试调用默认超时（毫秒）：与探测一致。 */
export const DEFAULT_INVOKE_TIMEOUT_MS = 60_000;
/** 调试调用硬上限（毫秒）。 */
export const MAX_INVOKE_TIMEOUT_MS = 60_000;
/** 回传内容的最长字符数（超出后截断文本块并标记）。 */
const MAX_RESULT_CHARS = 200_000;
/** 参数必须是 JSON 对象（不是数组 / null / 标量）。 */
export function normalizeInvokeArguments(value) {
    if (value === undefined || value === null)
        return { ok: true, value: {} };
    if (typeof value !== "object" || Array.isArray(value)) {
        return { ok: false, errors: ["调用参数必须是 JSON 对象（例如 { \"key\": \"value\" }）"] };
    }
    return { ok: true, value: value };
}
/** 超时夹取：非有限值回落到默认值，再夹到 [500, MAX]。 */
function clampInvokeTimeout(value) {
    if (value === undefined || !Number.isFinite(value))
        return DEFAULT_INVOKE_TIMEOUT_MS;
    return Math.min(Math.max(Math.floor(value), 500), MAX_INVOKE_TIMEOUT_MS);
}
/**
 * 通过**一次性连接**调用一个 MCP 工具（配置条目路径）。
 *
 * 失败（校验不过 / 连接失败 / 超时 / 服务器抛错）统一返回
 * `{ ok:false, errors }`，绝不抛到 RPC 层；任何路径都在 `finally` 关闭连接。
 */
export async function callToolOnce(input) {
    const startedAt = Date.now();
    const key = typeof input.key === "string" && input.key.trim().length > 0 ? input.key.trim() : "server";
    const entry = input.entry !== null && typeof input.entry === "object" && !Array.isArray(input.entry)
        ? input.entry
        : {};
    const entryErrors = validateEntry(key, entry);
    if (entryErrors.length > 0)
        return { ok: false, errors: entryErrors };
    const tool = typeof input.tool === "string" ? input.tool.trim() : "";
    if (tool.length === 0)
        return { ok: false, errors: ["工具名不能为空"] };
    const args = normalizeInvokeArguments(input.arguments);
    if (!args.ok)
        return args;
    const opened = await openMcpSession({
        key,
        entry,
        ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
        timeoutMs: clampInvokeTimeout(input.timeoutMs),
    });
    if (!opened.ok)
        return opened;
    const session = opened.session;
    try {
        const raw = await session.client.callTool({ name: tool, arguments: args.value }, { signal: session.signal, timeout: session.timeoutMs });
        // 服务器未声明 tools 能力时 SDK 会直接报错；这里只做形状归一。
        const content = Array.isArray(raw.content) ? raw.content : [];
        const bounded = boundInvokeContent(content);
        const structuredContent = raw.structuredContent;
        return {
            ok: true,
            content: bounded,
            ...(structuredContent !== undefined ? { structuredContent: boundInvokeValue(structuredContent) } : {}),
            isError: raw.isError === true,
            elapsedMs: Date.now() - startedAt,
        };
    }
    catch (error) {
        const messages = [`工具调用失败：${session.target}`];
        const raw = error instanceof Error ? error.message : error === undefined || error === null ? "" : String(error);
        if (session.timedOut())
            messages[0] = `工具调用超时（超过 ${session.timeoutMs}ms）：${session.target}`;
        if (raw.length > 0)
            messages.push(`原始错误：${raw}`);
        const stderr = session.stderrTail().trim();
        if (stderr.length > 0)
            messages.push(`服务器 stderr：${stderr}`);
        return { ok: false, errors: messages };
    }
    finally {
        await session.close();
    }
}
/**
 * 把 content 数组压到响应预算内：逐个累计序列化长度，超预算的文本块截断，
 * 后续块丢弃并补一个说明块。非文本块（image / resource）按整块保留到超限。
 */
export function boundInvokeContent(content) {
    const out = [];
    let used = 0;
    for (const block of content) {
        const size = safeLength(block);
        if (used + size <= MAX_RESULT_CHARS) {
            out.push(block);
            used += size;
            continue;
        }
        const remaining = MAX_RESULT_CHARS - used;
        if (remaining > 200 && block.type === "text" && typeof block.text === "string") {
            out.push({ ...block, text: `${block.text.slice(0, remaining - 120)}\n…（内容过长，已截断）` });
            used = MAX_RESULT_CHARS;
        }
        out.push({ type: "text", text: `（结果过大，已省略剩余 ${content.length - out.length + 1} 个内容块；请缩小返回范围或直接看服务器日志。）` });
        break;
    }
    return out;
}
/** 单个值的 JSON 长度（无法序列化时按 0 处理，避免把调用拖垮）。 */
function safeLength(value) {
    try {
        const text = JSON.stringify(value);
        return typeof text === "string" ? text.length : 0;
    }
    catch {
        return 0;
    }
}
/** structuredContent 的预算：超长 JSON 截断成字符串说明。 */
export function boundInvokeValue(value) {
    if (safeLength(value) <= MAX_RESULT_CHARS / 4)
        return value;
    try {
        return `${JSON.stringify(value).slice(0, MAX_RESULT_CHARS / 4)}\n…（结构化内容过长，已截断）`;
    }
    catch {
        return "（结构化内容无法序列化）";
    }
}
