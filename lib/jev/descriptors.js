/**
 * Jev 能力描述层：把 MCP 服务器与 Tools 插件单元整理成「给模型判断用」的
 * 一句话描述，并保证**原始 args / URL / 凭据永不进入 prompt**。
 *
 * 现状（改造前）：
 *   - MCP 配置条目的描述 = `row.summary` = 原始命令行（`npx -y mcp-remote …`），
 *     既没有语义，还会把 `--header "Bearer …"` / `--api-key …` 原样发给第三方
 *     Jev API；
 *   - 外部注入实例写死「外部注入的 MCP 实例」；
 *   - Tools 插件单元写死「N 个工具 · 插件注入」，浪费了现成的 npm 包描述。
 *
 * 本模块的推导规则（按顺序短路）：
 *   1. 作者手填 `description`（MCP 配置扩展字段）→ 脱敏后原样使用；
 *   2. 从配置结构推导：远程 URL → host；python/node 脚本 → 脚本名；
 *      `npx/bunx/… <包>` → 包名；其他命令 → 可执行文件名；
 *   3. 运行时实例的 `summary`：先按命令行拆解推导（只回结构化结论，不回原文）；
 *   4. 都拿不到 → 保留原有的最小描述（`MCP 服务器（transport）`）。
 *
 * @module dsh-capability-settings/jev/descriptors
 */
import { baseNameOfPath, hostOfUrl, sanitizeDescriptorText } from "../shared/descriptor-text.js";
/** 通过「包 → 命令」启动的 runner（`npx`/`bunx` 等的下一个位置参数是包名）。 */
const PACKAGE_RUNNERS = new Set(["npx", "bunx", "pnpx", "uvx"]);
/** 通过「解释器 → 脚本」启动的 runner。 */
const SCRIPT_RUNNERS = new Set(["node", "bun", "deno", "python", "python3", "python3.11", "python3.12", "python3.13"]);
/**
 * 这些 flag 的**下一个参数是值**，推导位置参数时要跳过（否则会把 token /
 * header 值误当成包名）。
 */
const FLAGS_WITH_VALUE = new Set([
    "--header",
    "--api-key",
    "--apikey",
    "--api_key",
    "--token",
    "--secret",
    "--password",
    "--passwd",
    "--authorization",
    "--auth",
    "--cookie",
    "--key",
    "--env",
    "-e",
    "--cwd",
    "--config",
    "--proxy",
    "-p",
    "--port",
    "--host",
    "--timeout",
    "--transport",
    "--header-file",
]);
/** 绝对/相对 URL。 */
const URL_PATTERN = /^https?:\/\//iu;
/** 脚本扩展名（Python / Node / Deno / TS）。 */
const SCRIPT_PATTERN = /\.(?:py|m?js|cjs|ts)$/iu;
/** 包名形态（含 `@scope/name`）。 */
const PACKAGE_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/iu;
/** 版本后缀（`@latest` / `@1.2.3` / `@^2`）。 */
const VERSION_SUFFIX_PATTERN = /@(?:latest|next|beta|canary|[\^~]?[\d][0-9A-Za-z.^~-]*)$/u;
/** 去掉包名上的版本后缀（`tavily-mcp@latest` → `tavily-mcp`）。 */
function stripVersionSuffix(spec) {
    return spec.replace(VERSION_SUFFIX_PATTERN, "");
}
/** 该 token 是否像一个 npm 包名。 */
function looksLikePackage(token) {
    if (token.length === 0 || token.length > 214)
        return false;
    if (URL_PATTERN.test(token) || SCRIPT_PATTERN.test(token))
        return false;
    if (/[\\/]/u.test(token) && !token.startsWith("@"))
        return false;
    return PACKAGE_PATTERN.test(token);
}
/** 取第一个非 flag 的位置参数（跳过已知带值 flag 的值）。 */
function firstPositional(args) {
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (typeof arg !== "string" || arg.length === 0)
            continue;
        if (arg.startsWith("-")) {
            if (FLAGS_WITH_VALUE.has(arg.toLowerCase()) || FLAGS_WITH_VALUE.has(arg))
                index += 1;
            continue;
        }
        return arg;
    }
    return undefined;
}
/** `command + args + url` 的结构化推导（返回 undefined = 推不出）。 */
function deriveFromEntry(command, args, url, transport) {
    if (transport === "http") {
        const host = hostOfUrl(url);
        return host !== undefined ? `远程 MCP 端点 ${host}（http）` : undefined;
    }
    const argv = Array.isArray(args) ? args : [];
    const runner = typeof command === "string" && command.length > 0 ? baseNameOfPath(command).toLowerCase() : "";
    // 1) 任意位置出现 URL：绝大多数 remote 包装器（mcp-remote 等）都在这里。
    const urlArg = argv.find((arg) => typeof arg === "string" && URL_PATTERN.test(arg));
    if (urlArg !== undefined) {
        const host = hostOfUrl(urlArg);
        return host !== undefined ? `远程 MCP 端点 ${host}（stdio）` : undefined;
    }
    // 2) 解释器 + 脚本：只保留脚本文件名（绝不带路径/参数）。
    if (SCRIPT_RUNNERS.has(runner)) {
        const script = argv.find((arg) => typeof arg === "string" && SCRIPT_PATTERN.test(arg));
        if (script !== undefined)
            return `MCP 脚本 ${baseNameOfPath(script)}（stdio）`;
        return undefined;
    }
    // 3) 包 runner：下一个位置参数是包名。
    if (PACKAGE_RUNNERS.has(runner)) {
        const positional = firstPositional(argv);
        if (positional === undefined)
            return undefined;
        const spec = stripVersionSuffix(positional);
        if (!looksLikePackage(spec))
            return undefined;
        return `MCP 服务包 ${spec}（stdio）`;
    }
    // 4) 直接可执行文件（`open-computer-use mcp` 这类）。
    if (runner.length > 0)
        return `MCP 命令 ${baseNameOfPath(command ?? runner)}（stdio）`;
    return undefined;
}
/** 从一行 summary（可能是完整命令行）推导；只返回结构化结论，不回原文。 */
function deriveFromSummaryLine(summary, transport) {
    const text = summary.trim();
    if (text.length === 0)
        return undefined;
    // summary 里的 URL 可能前面带命令（`npx -y mcp-remote https://…`）。
    const urlMatch = text.match(/https?:\/\/[^\s"']+/iu);
    if (urlMatch !== null) {
        const host = hostOfUrl(urlMatch[0]);
        if (host !== undefined)
            return transport === "http" ? `远程 MCP 端点 ${host}（http）` : `远程 MCP 端点 ${host}（stdio）`;
    }
    const tokens = text.split(/\s+/u).filter((token) => token.length > 0);
    const command = tokens[0]?.replace(/^["']|["']$/gu, "");
    // 首 token 不像可执行文件（例如未来宿主把它换成人类摘要）→ 交给调用方
    // 作为纯文本描述处理，不要硬套命令行推导。
    if (command === undefined || !/^[A-Za-z0-9_./\\-]+$/u.test(command))
        return undefined;
    const args = tokens.slice(1);
    return deriveFromEntry(command, args, undefined, transport);
}
/**
 * 生成一条 MCP 能力的描述（已脱敏，未截断；截断由 `jev/apply.ts` 统一做）。
 *
 * 作者手填描述优先；否则从配置条目/摘要推导；最后回退最小描述。
 */
export function describeMcpServer(input) {
    const authored = sanitizeDescriptorText(input.description ?? "").trim();
    if (authored.length > 0)
        return authored;
    const fromEntry = input.entry !== undefined
        ? deriveFromEntry(input.entry.command, input.entry.args, input.entry.url, input.transport)
        : undefined;
    if (fromEntry !== undefined)
        return fromEntry;
    if (typeof input.summary === "string" && input.summary.trim().length > 0) {
        const fromSummary = deriveFromSummaryLine(input.summary, input.transport);
        if (fromSummary !== undefined)
            return fromSummary;
        // 无法按命令行解释的 summary（旧 fixture / 未来的人类摘要字段）：脱敏后
        // 原样使用，避免丢信息。
        const sanitizedSummary = sanitizeDescriptorText(input.summary).trim();
        if (sanitizedSummary.length > 0)
            return sanitizedSummary;
    }
    return `MCP 服务器（${input.transport}）`;
}
/**
 * 生成外部注入 MCP 实例的描述。
 *
 * 与配置条目一样只回结构化结论；注入方名字放在兜底文案里（帮助模型区分
 * 「哪个插件带的 server」，但不把原始命令行发出去）。
 */
export function describeExternalMcp(input) {
    const transport = input.transport ?? "stdio";
    if (typeof input.summary === "string" && input.summary.trim().length > 0) {
        const derived = deriveFromSummaryLine(input.summary, transport);
        if (derived !== undefined)
            return derived;
    }
    const source = (input.channel ?? input.origin ?? "").trim();
    return source.length > 0 ? `由 ${source} 注入的 MCP 实例` : "外部注入的 MCP 实例";
}
/**
 * 生成一个插件单元的描述：优先 npm 包描述（已含插件用途），否则保留旧占位。
 *
 * 包描述通常较长（本机 `dsh-remote` 约 300 字符），截断交给调用方；
 * 这里先做凭据掩码（包描述理论上不含密钥，但防御性处理）。
 */
export function describePluginUnit(input) {
    const description = sanitizeDescriptorText(input.description ?? "").trim();
    if (description.length > 0)
        return description;
    return `${input.toolCount} 个工具 · 插件注入`;
}
