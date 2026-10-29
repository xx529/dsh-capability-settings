/**
 * 工具参数表（JSON Schema → 参数行）的**单一实现**。
 *
 * 两个面板共用：
 *   - `mcp-panel.tsx` 的「查看工具与参数」检视器（MCP 探测结果 / 外部注入实例的工具）；
 *   - `tools-panel.tsx` 的 Tools 详情手风琴（`tools.inspect` 按需返回的 schema）。
 *
 * 只负责「把 inputSchema 展开成参数/类型/必填/说明」与渲染这张表，不关心数据
 * 来源；样式一律复用 styles.ts 里的 `.skp-param-*` / `.skp-field-label` /
 * `.skp-test-stat` / `.skp-tag-*` 类（与 MCP 面板同形）。
 *
 * @module dsh-capability-settings/client/tool-schema
 */
/** 参数表的一行（从 inputSchema 的 `properties` + `required` 展开）。 */
export interface ToolParameter {
    name: string;
    type: string;
    required: boolean;
    description?: string;
}
/**
 * 从工具的 `parameters`（JSON Schema 原样）展开参数行。
 * 无 `properties`（或形状不对）时返回空数组。
 */
export declare function toolParameters(parameters: Record<string, unknown> | undefined): ToolParameter[];
/**
 * 参数表（参数 / 类型 / 必填 / 说明）；无参数时渲染 `emptyText` 弱说明。
 *
 * 两个面板的 DOM 结构与类名完全一致，tester 的 `.skp-param-name` 等断言在
 * MCP 检视器与 Tools 详情里通用。
 */
export declare function ToolParameterTable({ parameters, emptyText, }: {
    parameters: readonly ToolParameter[];
    emptyText?: string;
}): import("react").JSX.Element;
