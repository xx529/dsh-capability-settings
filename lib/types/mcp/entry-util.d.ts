/**
 * MCP 条目的纯函数工具（无 Node 依赖，宿主与浏览器端通用）。
 *
 * 传输归类 / 摘要 / 校验这三组逻辑同时被宿主（写入前校验、列表投影，
 * 见 config-file.ts）与浏览器端（「添加 MCP 服务器」弹窗的 JSON 预览校验）
 * 使用，独立成模块避免两侧口径漂移。
 *
 * @module dsh-capability-settings/mcp/entry-util
 */
import type { McpServerEntry } from "./types.js";
/**
 * 归类条目的传输方式：显式 `type` 优先；`url` 存在且无 command 视为 http。
 * 扩展的 `"sse"` 也归类为 http（桥接层统一走 streamable-http）。
 */
export declare function transportOf(entry: McpServerEntry): "stdio" | "http";
/**
 * 生成面板列表用的一行摘要：http 显示 URL，stdio 显示"命令 参数"。
 *
 * **凭据掩码（P0 安全修复）**：args / URL 里常内联 token（本机活例
 * `--header "Authorization: Bearer …"`、`--api-key …`）。该摘要在两处使用：
 *   - 面板列表/详情直接显示；
 *   - Jev 能力决策用它当能力描述（会把字符串原样发给第三方 Jev API）。
 * 因此在**源头**就做脱敏；需要结构信息的地方（Jev 描述推导）再从条目
 * 的 command/args/url 推导，绝不回拼原文。
 */
export declare function summarizeEntry(entry: McpServerEntry): string;
/**
 * 校验面板提交的条目，返回问题列表；空列表表示可挂载。
 *
 * 检查项：键名非空且 ≤ 64 字符；stdio 必须有 command、args 必须是字符串数组；
 * http 必须有 url；env / headers 必须是"字符串值"的对象；timeoutMs 必须是正数。
 */
export declare function validateEntry(key: string, entry: McpServerEntry): string[];
