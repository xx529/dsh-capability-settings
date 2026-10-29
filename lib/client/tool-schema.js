import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { Fragment } from "react";
/** 参数表栅格：参数 / 类型 / 必填 / 说明 四列。 */
const PARAM_GRID_STYLE = {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, .8fr) 56px minmax(0, 2fr)",
    columnGap: 10,
    minWidth: 0,
};
/** 参数表单元格（表头与数据行共用，只有内边距/边框）。 */
const PARAM_CELL_STYLE = {
    padding: "7px 0",
    borderBottom: "1px solid var(--skp-border)",
    minWidth: 0,
};
/** 参数表表头单元格（去掉上内边距）。 */
const PARAM_HEAD_CELL_STYLE = { ...PARAM_CELL_STYLE, paddingTop: 0 };
/** true = 该属性声明了非空 `enum`（对齐 dsh-context：类型列标 `(enum)`）。 */
function hasEnum(property) {
    return Array.isArray(property.enum) && property.enum.length > 0;
}
/**
 * enum 允许值的展示文本（字符串原样、其余 JSON 化），用于类型列 title。
 * 无 enum 时返回 undefined。
 */
function enumOptions(property) {
    if (!hasEnum(property))
        return undefined;
    return property.enum.map((value) => {
        if (typeof value === "string")
            return value;
        if (value === null)
            return "null";
        return JSON.stringify(value);
    });
}
/**
 * 一个 JSON Schema 属性的类型名（联合类型用 ` | ` 连接；缺 type 时给结构提示）。
 *
 * 含 `enum` 时补 ` (enum)` 指示（如 `string (enum)`）——dsh-context 的检视器
 * 同样把可选值的约束放在类型列；允许值明细走 {@link enumOptions} 的 title。
 */
function schemaType(property) {
    const type = property.type;
    let base;
    if (typeof type === "string")
        base = type;
    else if (Array.isArray(type)) {
        const parts = type.filter((part) => typeof part === "string");
        if (parts.length > 0)
            base = parts.join(" | ");
    }
    if (base === undefined) {
        // 只有 enum 没有 type：类型本身就是枚举集合（沿用旧口径 `enum`）。
        if (hasEnum(property))
            return "enum";
        if (property.anyOf !== undefined || property.oneOf !== undefined)
            return "union";
        return "unknown";
    }
    return hasEnum(property) ? `${base} (enum)` : base;
}
/**
 * 从工具的 `parameters`（JSON Schema 原样）展开参数行。
 * 无 `properties`（或形状不对）时返回空数组。
 */
export function toolParameters(parameters) {
    if (parameters === undefined || parameters === null)
        return [];
    const properties = parameters.properties;
    if (properties === null || typeof properties !== "object" || Array.isArray(properties))
        return [];
    const required = Array.isArray(parameters.required)
        ? parameters.required.filter((name) => typeof name === "string")
        : [];
    return Object.entries(properties).map(([name, raw]) => {
        const property = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
        const description = typeof property.description === "string" ? property.description : undefined;
        const options = enumOptions(property);
        return {
            name,
            type: schemaType(property),
            required: required.includes(name),
            ...(description !== undefined ? { description } : {}),
            ...(options !== undefined ? { options } : {}),
        };
    });
}
/**
 * 参数表（参数 / 类型 / 必填 / 说明）；无参数时渲染 `emptyText` 弱说明。
 *
 * 两个面板的 DOM 结构与类名完全一致，tester 的 `.skp-param-name` 等断言在
 * MCP 检视器与 Tools 详情里通用。
 */
export function ToolParameterTable({ parameters, emptyText = "无参数", }) {
    if (parameters.length === 0)
        return _jsx("div", { className: "skp-note", children: emptyText });
    return (_jsxs("div", { style: PARAM_GRID_STYLE, children: [["参数", "类型", "必填", "说明"].map((label) => (_jsx("span", { className: "skp-field-label", style: PARAM_HEAD_CELL_STYLE, children: label }, label))), parameters.map((parameter) => (_jsxs(Fragment, { children: [_jsx("code", { className: "skp-param-name", style: PARAM_CELL_STYLE, children: parameter.name }), _jsx("span", { className: "skp-test-stat", style: PARAM_CELL_STYLE, title: parameter.options !== undefined && parameter.options.length > 0
                            ? `允许值：${parameter.options.join(" / ")}`
                            : undefined, "aria-label": parameter.options !== undefined && parameter.options.length > 0
                            ? `${parameter.type}，允许值：${parameter.options.join(" / ")}`
                            : undefined, children: parameter.type }), _jsx("span", { style: PARAM_CELL_STYLE, children: _jsx("span", { className: parameter.required ? "skp-tag skp-tag-warn" : "skp-tag skp-tag-flat", children: parameter.required ? "必填" : "可选" }) }), _jsx("span", { className: "skp-param-desc", style: PARAM_CELL_STYLE, children: parameter.description !== undefined && parameter.description.trim().length > 0 ? parameter.description : "—" })] }, parameter.name)))] }));
}
