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
export declare const SECRET_MASK = "***";
/**
 * 对可能含凭据的文本做掩码（幂等；非字符串/空串返回空串）。
 *
 * 注意：这里**只做文本替换**，不做结构化解析；调用方不要依赖它保留
 * 原始格式。需要保留 URL / 包名等结构信息时，用 `jev/descriptors.ts`
 * 的推导函数，而不是直接展示原文。
 */
export declare function sanitizeDescriptorText(text: string): string;
/** 从文本中取 URL 的 host（不合法/非 http(s) 返回 undefined）。 */
export declare function hostOfUrl(value: string | undefined): string | undefined;
/** 把路径的最后一段（`/a/b/chrome_mcp.py` → `chrome_mcp.py`；兼容 Windows 分隔符）。 */
export declare function baseNameOfPath(value: string): string;
/**
 * 按参数边界掩码敏感 flag 的值（保留 flag 本身，值替换成 `***`）。
 *
 * 只掩码**下一个参数**；`--header=Authorization: Bearer x` 这类内联值也覆盖。
 * 非敏感参数原样保留，交给 {@link sanitizeDescriptorText} 做文本兜底。
 */
export declare function maskSensitiveArgs(args: readonly string[]): string[];
/** 把参数数组按 shell 风格拼成一行（敏感值已掩码），再整体做文本兜底。 */
export declare function formatMaskedArgs(args: readonly string[]): string;
