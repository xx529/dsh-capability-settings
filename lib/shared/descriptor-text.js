/**
 * 能力描述文本的**凭据脱敏**（宿主 / 客户端 / Jev prompt 共用）。
 *
 * 背景：MCP 配置的 `args` / URL 常常内联 API Key（本机活例：
 * `mcp-remote … --header "Authorization: Bearer as_sk_…"`、
 * `--api-key ctx7sk-…`）。这些文本原来会被当作「能力描述」：
 *
 *   1. 面板列表/详情直接显示（截图/共享屏幕泄露）；
 *   2. `jev.rank` 原样放进 question，发给第三方 Jev API（真实外发泄露）。
 *
 * 本模块只做**保守的文本掩码**：命中可疑凭据形态就替换成 `***`，不能
 * 200% 保证覆盖所有自定义凭据；因此 MCP 的描述生成还会**完全丢弃原始
 * args**（见 `jev/descriptors.ts` 的推导逻辑），这里只作为纵深防线。
 *
 * 纯字符串实现（不 import node 内置），可被客户端 bundle 直接复用。
 *
 * @module dsh-capability-settings/shared/descriptor-text
 */
/** 掩码占位符（不带空格，避免被误读成多个参数）。 */
export const SECRET_MASK = "***";
/**
 * 敏感 flag：命中时把它后面的**一个值**整体掩码。
 *
 * 覆盖 `--header` / `--api-key` / `--token` / `--secret` / `--password`
 * 等常见形态；`-H` / `-e` 单独处理（避免把 `-h/--help` 误伤）。
 */
const SENSITIVE_FLAG_PATTERN = /(--?(?:header|api[-_]?key|apikey|token|secret|password|passwd|authorization|auth|cookie|key)\b(?:=|\s+))("[^"]*"|'[^']*'|[^\s"']+)/gi;
/** `-H "Header: value"`（curl 风格）。 */
const SHORT_HEADER_PATTERN = /(\s-H\s+)("[^"]*"|'[^']*'|[^\s"']+)/g;
/** `Bearer <token>`（大小写不敏感；token 至少 4 个字符才掩码）。 */
const BEARER_PATTERN = /(\bBearer\s+)[A-Za-z0-9._~+/=:-]{4,}/gi;
/** `Authorization: <value>` / `Authorization=<value>`。 */
const AUTHORIZATION_PATTERN = /(\bAuthorization\s*[:=]\s*)(?:Bearer\s+)?[^\s"',;]+/gi;
/** `Basic <base64>`（HTTP Basic 凭据）。 */
const BASIC_AUTH_PATTERN = /(\bBasic\s+)[A-Za-z0-9+/=]{4,}/gi;
/** 通用 `api_key=…` / `token: …` 形态（大小写不敏感，值为引号内或到空白）。 */
const ASSIGNMENT_SECRET_PATTERN = /\b(api[-_]?key|apikey|token|secret|password|passwd|auth|authorization)(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s"'&]+)/gi;
/** 环境变量式 `FOO_TOKEN=…` / `BAR_API_KEY=…`（值为非空白）。 */
const ENV_SECRET_PATTERN = /\b([A-Z0-9_]{2,}(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|AUTH)[A-Z0-9_]*=)[^\s"'&]+/g;
/** 常见 API Key 前缀（`sk-` / `as_sk_` / `tvly-` / `ctx7sk-` / GitHub token…）。 */
const TOKEN_PREFIX_PATTERN = /\b(?:sk|as_sk|ctx7sk|tvly|pk|rk|ghp|gho|github_pat)[-_][A-Za-z0-9_-]{8,}\b/gi;
/** URL query 里的凭据参数（`?api_key=…` / `&token=…`）。 */
const URL_QUERY_SECRET_PATTERN = /([?&](?:api[-_]?key|apikey|key|token|access_token|auth)=)[^&\s"']+/gi;
/**
 * 对可能含凭据的文本做掩码（幂等；非字符串/空串返回空串）。
 *
 * 注意：这里**只做文本替换**，不做结构化解析；调用方不要依赖它保留
 * 原始格式。需要保留 URL / 包名等结构信息时，用 `jev/descriptors.ts`
 * 的推导函数，而不是直接展示原文。
 */
export function sanitizeDescriptorText(text) {
    if (typeof text !== "string" || text.length === 0)
        return "";
    let out = text;
    // 先按下发顺序处理：带 flag 的整段值 → 再单独兜底 token 形态。
    out = out.replace(SENSITIVE_FLAG_PATTERN, `$1${SECRET_MASK}`);
    out = out.replace(SHORT_HEADER_PATTERN, `$1${SECRET_MASK}`);
    out = out.replace(BEARER_PATTERN, `$1${SECRET_MASK}`);
    out = out.replace(BASIC_AUTH_PATTERN, `$1${SECRET_MASK}`);
    out = out.replace(AUTHORIZATION_PATTERN, `$1${SECRET_MASK}`);
    out = out.replace(ASSIGNMENT_SECRET_PATTERN, `$1$2${SECRET_MASK}`);
    out = out.replace(ENV_SECRET_PATTERN, `$1${SECRET_MASK}`);
    out = out.replace(TOKEN_PREFIX_PATTERN, SECRET_MASK);
    out = out.replace(URL_QUERY_SECRET_PATTERN, `$1${SECRET_MASK}`);
    // 收尾：连续掩码折叠成一个（`--header=*** Bearer ***` → `--header=***`）。
    out = out.replace(/(?:\*{3}[ \t]+)+(?:\*{3})/gu, SECRET_MASK);
    out = out.replace(/\*{3}\s+(?:Bearer|Basic)\s+\*{3}/giu, SECRET_MASK);
    return out;
}
/** 从文本中取 URL 的 host（不合法/非 http(s) 返回 undefined）。 */
export function hostOfUrl(value) {
    if (typeof value !== "string" || value.length === 0)
        return undefined;
    try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:")
            return undefined;
        return url.host.length > 0 ? url.host : undefined;
    }
    catch {
        return undefined;
    }
}
/** 把路径的最后一段（`/a/b/chrome_mcp.py` → `chrome_mcp.py`；兼容 Windows 分隔符）。 */
export function baseNameOfPath(value) {
    const parts = value.split(/[\\/]+/u).filter((part) => part.length > 0);
    return parts.length > 0 ? parts[parts.length - 1] : value;
}
/**
 * 这些 flag 的下一个**参数**是敏感值（`--header` / `--api-key` / `-H` …）。
 *
 * 用结构化（按单个 arg）掩码，而不是在拼好的字符串上做正则：`--header`
 * 的值本身可能含空格（`authorization: Bearer …`），只有按参数边界才能
 * 精确替换整段值。
 */
const SENSITIVE_ARG_FLAGS = new Set([
    "--header",
    "--headers",
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
    "-h",
    "-e",
    "--env",
]);
/** arg 是否 `--flag=value` 形态的敏感 flag（返回 flag 名，否则 undefined）。 */
function sensitiveFlagName(arg) {
    const lower = arg.toLowerCase();
    const equal = lower.indexOf("=");
    const name = equal >= 0 ? lower.slice(0, equal) : lower;
    return SENSITIVE_ARG_FLAGS.has(name) ? name : undefined;
}
/**
 * 按参数边界掩码敏感 flag 的值（保留 flag 本身，值替换成 `***`）。
 *
 * 只掩码**下一个参数**；`--header=Authorization: Bearer x` 这类内联值也覆盖。
 * 非敏感参数原样保留，交给 {@link sanitizeDescriptorText} 做文本兜底。
 */
export function maskSensitiveArgs(args) {
    const out = [];
    let maskNext = false;
    for (const arg of args) {
        if (typeof arg !== "string")
            continue;
        if (maskNext) {
            out.push(SECRET_MASK);
            maskNext = false;
            continue;
        }
        const flag = sensitiveFlagName(arg);
        if (flag !== undefined) {
            const equal = arg.indexOf("=");
            if (equal >= 0) {
                out.push(`${arg.slice(0, equal)}=${SECRET_MASK}`);
                continue;
            }
            out.push(arg);
            maskNext = true;
            continue;
        }
        out.push(arg);
    }
    return out;
}
/** 把参数数组按 shell 风格拼成一行（敏感值已掩码），再整体做文本兜底。 */
export function formatMaskedArgs(args) {
    return sanitizeDescriptorText(maskSensitiveArgs(args).join(" "));
}
