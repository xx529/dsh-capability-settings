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
import type { McpServerEntry } from "../mcp/types.js";
/** 输入形状：MCP 配置条目 / 运行时实例共用的最小子集。 */
export interface McpDescriptorInput {
    /** 传输方式（决定是否走 URL 推导）。 */
    transport: "stdio" | "http";
    /** 作者手填描述（最高优先级；可缺省）。 */
    description?: string;
    /** 原始条目（有则优先从 command/args/url 推导；缺省时退回 summary）。 */
    entry?: Pick<McpServerEntry, "command" | "args" | "url">;
    /** 面板/运行时摘要（命令行或 URL；仅用于推导，绝不回原文）。 */
    summary?: string;
}
/**
 * 生成一条 MCP 能力的描述（已脱敏，未截断；截断由 `jev/apply.ts` 统一做）。
 *
 * 作者手填描述优先；否则从配置条目/摘要推导；最后回退最小描述。
 */
export declare function describeMcpServer(input: McpDescriptorInput): string;
/** 外部注入 MCP 实例的输入（`mcp.runtime` 视图字段，只读）。 */
export interface ExternalMcpDescriptorInput {
    summary?: string;
    channel?: string;
    origin?: string;
    transport?: "stdio" | "http";
}
/**
 * 生成外部注入 MCP 实例的描述。
 *
 * 与配置条目一样只回结构化结论；注入方名字放在兜底文案里（帮助模型区分
 * 「哪个插件带的 server」，但不把原始命令行发出去）。
 */
export declare function describeExternalMcp(input: ExternalMcpDescriptorInput): string;
/** Tools 插件单元的输入（`tools.list` 视图子集）。 */
export interface PluginUnitDescriptorInput {
    /** npm 包描述（`package.json.description`；缺省时退回占位文案）。 */
    description?: string;
    toolCount: number;
}
/**
 * 生成一个插件单元的描述：优先 npm 包描述（已含插件用途），否则保留旧占位。
 *
 * 包描述通常较长（本机 `dsh-remote` 约 300 字符），截断交给调用方；
 * 这里先做凭据掩码（包描述理论上不含密钥，但防御性处理）。
 */
export declare function describePluginUnit(input: PluginUnitDescriptorInput): string;
