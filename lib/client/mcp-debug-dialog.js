import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * MCP 工具「调试调用」弹窗（v25）。
 *
 * 入口在 MCP 详情页「工具与参数」右栏：当前选中工具标题右侧的「▶ 调试」。
 * 弹窗按工具的 `inputSchema` 生成参数表单（表单 / JSON 双模式），执行一次真实
 * 的 MCP 工具调用，并在同一滚动区内就地展示结果。
 *
 * 数据来源两条路径（宿主 `mcp.invoke`）：
 *   - 配置条目：传 `entry` + `key`，宿主起一次性连接 `callTool`（不挂载、
 *     不影响正在运行的对话，与「测试连接」同源）；
 *   - 外部注入实例：传 `serverName`，宿主走已挂载工具注册表（`tools.execute`）；
 *     仅全局可见实例可调，其余返回业务失败并说明。
 *
 * 交互约定（与 Figma v25 一致）：
 *   - 参数区**保持展开**；结果紧接参数下方，执行完成后自动滚动到结果；
 *   - 关闭后再次打开同一工具会恢复草稿与上次结果（模块级内存缓存，切换服务器
 *     不清空；进程重载即清空）；
 *   - Esc 关闭、⌘/Ctrl + Enter 执行；执行中可取消（AbortSignal 传到宿主）。
 *
 * @module dsh-capability-settings/client/mcp-debug-dialog
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { SkpSelect } from "./select.js";
/** 嵌套对象最多自动展开的层数（再深就退回 JSON，避免无限递归/超宽表单）。 */
const MAX_NEST_DEPTH = 3;
/** true = 纯 JSON 对象（非 null / 数组）。 */
function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** schema 的 `type` 归一（字符串或联合数组取第一个可识别类型）。 */
function typeOf(prop) {
    const raw = prop.type;
    if (typeof raw === "string")
        return raw;
    if (Array.isArray(raw)) {
        const parts = raw.filter((part) => typeof part === "string" && part !== "null");
        if (parts.length === 1)
            return parts[0];
        if (parts.length > 1)
            return "union";
    }
    if (prop.anyOf !== undefined || prop.oneOf !== undefined)
        return "union";
    return undefined;
}
/** 读一个 schema 对象的 `properties`（非对象 / 空 → undefined）。 */
function propertiesOf(prop) {
    const properties = prop.properties;
    if (properties === null || typeof properties !== "object" || Array.isArray(properties))
        return undefined;
    return Object.keys(properties).length > 0 ? properties : undefined;
}
/** required 名单（只保留字符串）。 */
function requiredOf(prop) {
    return Array.isArray(prop.required) ? prop.required.filter((name) => typeof name === "string") : [];
}
/** 把一个 schema 属性展开成字段模型（object 带 properties 时递归）。 */
function fieldOf(name, raw, required, parentPath, depth) {
    const prop = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const enumValues = Array.isArray(prop.enum) && prop.enum.length > 0 ? prop.enum : undefined;
    const declared = typeOf(prop);
    const baseType = enumValues !== undefined
        ? "enum"
        : declared === "string" ||
            declared === "integer" ||
            declared === "number" ||
            declared === "boolean" ||
            declared === "array" ||
            declared === "object"
            ? declared
            : "unknown";
    const label = enumValues !== undefined
        ? declared !== undefined && declared !== "union"
            ? `${declared} (enum)`
            : "enum"
        : declared === "union"
            ? "union"
            : (declared ?? "unknown");
    const path = parentPath.length > 0 ? `${parentPath}.${name}` : name;
    const properties = baseType === "object" && depth < MAX_NEST_DEPTH ? propertiesOf(prop) : undefined;
    const children = properties !== undefined
        ? Object.entries(properties).map(([childName, childRaw]) => fieldOf(childName, childRaw, requiredOf(prop).includes(childName), path, depth + 1))
        : undefined;
    return {
        name,
        path,
        typeLabel: label,
        baseType,
        required,
        depth,
        ...(typeof prop.description === "string" && prop.description.trim().length > 0
            ? { description: prop.description.trim() }
            : {}),
        ...(enumValues !== undefined ? { enumValues } : {}),
        ...(prop.default !== undefined ? { defaultValue: prop.default } : {}),
        ...(children !== undefined ? { children } : {}),
    };
}
/** 从工具的 parameters（inputSchema）展开字段列表。 */
function fieldsOf(parameters) {
    if (parameters === undefined || parameters === null)
        return [];
    const properties = parameters.properties;
    if (properties === null || typeof properties !== "object" || Array.isArray(properties))
        return [];
    const required = requiredOf(parameters);
    return Object.entries(properties).map(([name, raw]) => fieldOf(name, raw, required.includes(name), "", 0));
}
/** 所有叶子字段（不含 object 分组本身）；用于判断「对象是否有内容」。 */
function leafFields(fields) {
    const out = [];
    for (const field of fields) {
        if (field.children !== undefined)
            out.push(...leafFields(field.children));
        else
            out.push(field);
    }
    return out;
}
/** true = 必填未满足（叶子必填为空；必填对象至少要有一个子字段有值）。 */
function requiredMissing(fields, draft) {
    return fields.some((field) => {
        if (field.children !== undefined) {
            const anyFilled = leafFields(field.children).some((leaf) => (draft[leaf.path] ?? "").trim().length > 0);
            if (field.required && !anyFilled)
                return true;
            return requiredMissing(field.children, draft);
        }
        return field.required && (draft[field.path] ?? "").trim().length === 0;
    });
}
/** 值的展示文本：字符串原样，其余 JSON 化（存进草稿 / 输入框）。 */
function displayValue(value) {
    if (typeof value === "string")
        return value;
    if (value === undefined)
        return "";
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
/** 对象参数字典 → 草稿（表单模式的初始值；叶子字段的 default）。 */
function draftOf(fields) {
    const draft = {};
    for (const field of fields) {
        if (field.children !== undefined)
            Object.assign(draft, draftOf(field.children));
        else if (field.defaultValue !== undefined)
            draft[field.path] = displayValue(field.defaultValue);
    }
    return draft;
}
/** JSON 参数（已解析）→ 草稿：只回填 schema 里已知的叶子字段。 */
function draftFromArgs(fields, source, draft) {
    for (const field of fields) {
        const raw = source[field.name];
        if (raw === undefined)
            continue;
        if (field.children !== undefined) {
            if (isPlainObject(raw))
                draftFromArgs(field.children, raw, draft);
            continue;
        }
        draft[field.path] = displayValue(raw);
    }
    return draft;
}
/** 校验单个叶子字段的文本，返回解析后的值或错误文案。 */
function parseField(field, text) {
    const trimmed = text.trim();
    if (field.baseType === "string")
        return { ok: true, value: text };
    if (trimmed.length === 0)
        return { ok: true };
    switch (field.baseType) {
        case "integer": {
            const value = Number(trimmed);
            if (!Number.isFinite(value) || !Number.isInteger(value))
                return { ok: false, error: "应为整数" };
            return { ok: true, value };
        }
        case "number": {
            const value = Number(trimmed);
            if (!Number.isFinite(value))
                return { ok: false, error: "应为数字" };
            return { ok: true, value };
        }
        case "boolean":
            if (trimmed !== "true" && trimmed !== "false")
                return { ok: false, error: "应为 true / false" };
            return { ok: true, value: trimmed === "true" };
        case "enum": {
            const values = field.enumValues ?? [];
            const match = values.find((value) => displayValue(value) === text || displayValue(value) === trimmed);
            if (match === undefined)
                return { ok: false, error: `允许值：${values.map(displayValue).join(" / ")}` };
            return { ok: true, value: match };
        }
        default: {
            try {
                const value = JSON.parse(text);
                if (field.baseType === "array" && !Array.isArray(value))
                    return { ok: false, error: "应为 JSON 数组" };
                if (field.baseType === "object" && !isPlainObject(value))
                    return { ok: false, error: "应为 JSON 对象" };
                return { ok: true, value };
            }
            catch {
                return { ok: false, error: "JSON 解析失败" };
            }
        }
    }
}
/**
 * 表单草稿 → 调用参数（递归收集必填 / 类型错误）。
 *
 * - 叶子字段：空且可选 → 跳过；必填为空 → 记错误；
 * - object（带 children）：递归构造子对象；必填但一个子字段都没填 → 记「必填对象未填写任何字段」。
 */
function buildArguments(fields, draft) {
    const fieldErrors = {};
    const value = buildObject(fields, draft, fieldErrors);
    const missing = Object.keys(fieldErrors).filter((path) => fieldErrors[path] === "必填参数未填写" || fieldErrors[path] === "必填对象未填写任何字段");
    const invalid = Object.keys(fieldErrors).filter((path) => fieldErrors[path] !== "必填参数未填写" && fieldErrors[path] !== "必填对象未填写任何字段");
    const errors = [];
    if (invalid.length > 0)
        errors.push(`参数格式不正确：${invalid.map((path) => `${path}（${fieldErrors[path]}）`).join("；")}`);
    if (missing.length > 0)
        errors.push(`必填参数未填写：${missing.join("、")}`);
    if (errors.length > 0)
        return { ok: false, errors, fieldErrors };
    return { ok: true, value };
}
/** buildArguments 的递归实现（把已填字段收进对象）。 */
function buildObject(fields, draft, fieldErrors) {
    const value = {};
    for (const field of fields) {
        if (field.children !== undefined) {
            const child = buildObject(field.children, draft, fieldErrors);
            if (Object.keys(child).length > 0)
                value[field.name] = child;
            else if (field.required)
                fieldErrors[field.path] = "必填对象未填写任何字段";
            continue;
        }
        const text = draft[field.path] ?? "";
        if (field.required && text.trim().length === 0) {
            fieldErrors[field.path] = "必填参数未填写";
            continue;
        }
        if (text.trim().length === 0)
            continue;
        const parsed = parseField(field, text);
        if (!parsed.ok) {
            fieldErrors[field.path] = parsed.error;
            continue;
        }
        if (parsed.value !== undefined)
            value[field.name] = parsed.value;
    }
    return value;
}
/**
 * JSON 模式文本 → 调用参数（对象形状 / 必填 / 已知字段类型；递归校验嵌套 object）。
 *
 * 返回的 `warnings` 是不在 schema 里的未知键（含嵌套路径），只提示不拦截。
 */
function parseJsonArguments(fields, text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch (error) {
        return { ok: false, errors: [`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`] };
    }
    if (!isPlainObject(parsed))
        return { ok: false, errors: ["arguments 必须是 JSON 对象（例如 { \"key\": \"value\" }）"] };
    const value = parsed;
    const errors = [];
    const warnings = [];
    validateObject(fields, value, "", errors, warnings);
    if (errors.length > 0)
        return { ok: false, errors };
    return {
        ok: true,
        value,
        warnings: warnings.length > 0 ? [`未知参数（schema 里没有，服务器可能忽略）：${warnings.join("、")}`] : [],
    };
}
/** 递归校验一个对象值（必填 / 叶子类型 / 未知键）。 */
function validateObject(fields, value, prefix, errors, warnings) {
    const byName = new Map(fields.map((field) => [field.name, field]));
    for (const field of fields) {
        if (field.required && value[field.name] === undefined)
            errors.push(`缺少必填参数：${field.path}`);
    }
    for (const [name, raw] of Object.entries(value)) {
        const field = byName.get(name);
        if (field === undefined) {
            warnings.push(prefix.length > 0 ? `${prefix}.${name}` : name);
            continue;
        }
        if (raw === null)
            continue;
        if (field.children !== undefined) {
            if (!isPlainObject(raw)) {
                errors.push(`${field.path}：应为对象`);
                continue;
            }
            validateObject(field.children, raw, field.path, errors, warnings);
            continue;
        }
        if (field.baseType === "number" && (typeof raw !== "number" || !Number.isFinite(raw))) {
            errors.push(`${field.path}：应为 number`);
        }
        else if (field.baseType === "integer" && (typeof raw !== "number" || !Number.isInteger(raw))) {
            errors.push(`${field.path}：应为 integer`);
        }
        else if (field.baseType === "string" && typeof raw !== "string") {
            errors.push(`${field.path}：应为 string`);
        }
        else if (field.baseType === "boolean" && typeof raw !== "boolean") {
            errors.push(`${field.path}：应为 boolean`);
        }
        else if (field.baseType === "array" && !Array.isArray(raw)) {
            errors.push(`${field.path}：应为数组`);
        }
        else if (field.baseType === "object" && !isPlainObject(raw)) {
            errors.push(`${field.path}：应为对象`);
        }
        else if (field.baseType === "enum" && !(field.enumValues ?? []).some((candidate) => displayValue(candidate) === displayValue(raw))) {
            errors.push(`${field.path}：不在允许值内（${(field.enumValues ?? []).map(displayValue).join(" / ")}）`);
        }
    }
}
/** 草稿 → 最佳努力 JSON：切到 JSON 模式时用（不校验、不报错，空值跳过）。 */
function draftToValue(fields, draft) {
    const value = {};
    for (const field of fields) {
        if (field.children !== undefined) {
            const child = draftToValue(field.children, draft);
            if (Object.keys(child).length > 0)
                value[field.name] = child;
            continue;
        }
        const text = draft[field.path] ?? "";
        if (text.trim().length === 0)
            continue;
        const parsed = parseField(field, text);
        value[field.name] = parsed.ok && parsed.value !== undefined ? parsed.value : text;
    }
    return value;
}
/** 「填入示例」的递归实现：按 default / enum 首项 / 类型占位填叶子字段。 */
function fillExampleInto(fields, out) {
    for (const field of fields) {
        if (field.children !== undefined) {
            fillExampleInto(field.children, out);
            continue;
        }
        if (field.defaultValue !== undefined)
            out[field.path] = displayValue(field.defaultValue);
        else if (field.enumValues !== undefined && field.enumValues.length > 0)
            out[field.path] = displayValue(field.enumValues[0]);
        else if (field.baseType === "boolean")
            out[field.path] = "true";
        else if (field.baseType === "integer" || field.baseType === "number")
            out[field.path] = "1";
        else if (field.baseType === "array")
            out[field.path] = "[]";
        else if (field.baseType === "object")
            out[field.path] = "{}";
        else
            out[field.path] = "";
    }
}
const DRAFT_CACHE = new Map();
// ---------------------------------------------------------------------------
// 弹窗组件
// ---------------------------------------------------------------------------
/** 一个结果内容块的渲染（text / image / resource / 其它）。 */
function ResultBlock({ block, index }) {
    const type = typeof block.type === "string" ? block.type : "unknown";
    if (type === "text" && typeof block.text === "string") {
        let text = block.text;
        try {
            text = JSON.stringify(JSON.parse(block.text), null, 2);
        }
        catch {
            /* 非 JSON 文本原样展示 */
        }
        return _jsx("pre", { className: "skp-dbg-code", children: text });
    }
    if (type === "image" && typeof block.data === "string") {
        const mime = typeof block.mimeType === "string" ? block.mimeType : "image/png";
        return _jsx("img", { className: "skp-dbg-img", src: `data:${mime};base64,${block.data}`, alt: `结果图片 ${index + 1}` });
    }
    if (type === "resource") {
        const resource = isPlainObject(block.resource) ? block.resource : undefined;
        const uri = resource !== undefined && typeof resource.uri === "string" ? resource.uri : undefined;
        const text = resource !== undefined && typeof resource.text === "string" ? resource.text : undefined;
        return (_jsxs("div", { className: "skp-dbg-resource", children: [uri !== undefined ? (_jsx("a", { className: "skp-link-btn", href: uri, target: "_blank", rel: "noreferrer", children: uri })) : (_jsx("span", { className: "skp-note", children: "\u8D44\u6E90\u5185\u5BB9" })), text !== undefined && _jsx("pre", { className: "skp-dbg-code", children: text })] }));
    }
    return _jsx("pre", { className: "skp-dbg-code", children: JSON.stringify(block, null, 2) });
}
/** 结果区：状态条 + 内容块 + structuredContent + 复制。 */
function ResultView({ result }) {
    const [copied, setCopied] = useState(false);
    const copy = () => {
        const text = result.ok
            ? JSON.stringify({
                content: result.content,
                ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
                isError: result.isError,
            }, null, 2)
            : result.errors.join("\n");
        void navigator.clipboard?.writeText(text).catch(() => undefined);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
    };
    if (!result.ok) {
        return (_jsxs("section", { className: "skp-dbg-result", "aria-label": "\u8C03\u7528\u5931\u8D25", children: [_jsxs("div", { className: "skp-dbg-result-head", children: [_jsx("span", { className: "skp-tag skp-tag-error", children: "! \u8C03\u7528\u5931\u8D25" }), _jsx("span", { className: "skp-dbg-spacer" }), _jsx("button", { type: "button", className: "skp-link-btn", onClick: copy, children: copied ? "已复制" : "复制错误" })] }), _jsx("pre", { className: "skp-dbg-code skp-dbg-code-error", children: result.errors.join("\n") })] }));
    }
    const statusTag = result.isError ? (_jsx("span", { className: "skp-tag skp-tag-error", children: "! \u5DE5\u5177\u8FD4\u56DE\u9519\u8BEF" })) : (_jsx("span", { className: "skp-tag skp-tag-global", children: "\u2713 \u6210\u529F" }));
    return (_jsxs("section", { className: "skp-dbg-result", "aria-label": "\u8C03\u7528\u7ED3\u679C", children: [_jsxs("div", { className: "skp-dbg-result-head", children: [statusTag, _jsxs("span", { className: "skp-test-stat", children: [result.elapsedMs, "ms"] }), _jsxs("span", { className: "skp-test-stat", children: [result.content.length, " \u4E2A\u5185\u5BB9\u5757"] }), result.isError && _jsx("span", { className: "skp-dbg-iserror", children: "isError = true" }), _jsx("span", { className: "skp-dbg-spacer" }), _jsx("button", { type: "button", className: "skp-link-btn", onClick: copy, children: copied ? "已复制" : "复制结果" })] }), result.content.length === 0 ? (_jsx("div", { className: "skp-note", children: "\u5DE5\u5177\u6CA1\u6709\u8FD4\u56DE\u5185\u5BB9\u3002" })) : (result.content.map((block, index) => (_jsx("div", { className: "skp-dbg-block", children: _jsx(ResultBlock, { block: block, index: index }) }, index)))), result.structuredContent !== undefined && (_jsxs("details", { className: "skp-dbg-details", children: [_jsx("summary", { children: "structuredContent" }), _jsx("pre", { className: "skp-dbg-code", children: JSON.stringify(result.structuredContent, null, 2) })] }))] }));
}
/** 调试弹窗：参数表单 + 执行 + 结果（同一滚动区）。 */
export function McpDebugDialog({ api, serverLabel, serverName, entry, entryKey, tool, onClose, }) {
    const fields = fieldsOf(tool.parameters);
    const cacheKey = `${entryKey ?? serverName ?? "server"}::${tool.name}`;
    const cached = DRAFT_CACHE.get(cacheKey);
    const [mode, setMode] = useState(cached?.mode ?? "form");
    const [draft, setDraft] = useState(cached?.draft ?? draftOf(fields));
    const [jsonText, setJsonText] = useState(cached?.jsonText ?? JSON.stringify(draftOf(fields), null, 2));
    const [fieldErrors, setFieldErrors] = useState({});
    const [errors, setErrors] = useState([]);
    const [warnings, setWarnings] = useState(cached?.warnings ?? []);
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState(cached?.result);
    const resultRef = useRef(null);
    const stateRef = useRef({ mode, draft, jsonText, result, warnings });
    stateRef.current = { mode, draft, jsonText, result, warnings };
    // 关闭时缓存草稿 + 结果（仅内存；进程重载即清空）。
    useEffect(() => () => {
        const latest = stateRef.current;
        DRAFT_CACHE.set(cacheKey, {
            mode: latest.mode,
            draft: latest.draft,
            jsonText: latest.jsonText,
            ...(latest.result !== undefined ? { result: latest.result } : {}),
            ...(latest.warnings.length > 0 ? { warnings: latest.warnings } : {}),
        });
    }, [cacheKey]);
    // 执行完成后把结果滚进视野（参数区保持展开，结果在下方）。
    useEffect(() => {
        if (result === undefined)
            return;
        resultRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, [result]);
    const setField = (path, value) => {
        setDraft((prev) => ({ ...prev, [path]: value }));
        setFieldErrors((prev) => {
            if (prev[path] === undefined)
                return prev;
            const next = { ...prev };
            delete next[path];
            return next;
        });
    };
    const fillExample = () => {
        const next = {};
        fillExampleInto(fields, next);
        setDraft(next);
        setFieldErrors({});
    };
    /** 切换模式：表单 → JSON 用当前参数格式化；JSON → 表单要求 JSON 合法。 */
    const switchMode = (nextMode) => {
        if (nextMode === mode)
            return;
        if (nextMode === "json") {
            setJsonText(JSON.stringify(draftToValue(fields, draft), null, 2));
            setMode("json");
            setErrors([]);
            setFieldErrors({});
            return;
        }
        const parsed = parseJsonArguments(fields, jsonText);
        if (!parsed.ok) {
            setErrors(parsed.errors);
            return;
        }
        const nextDraft = draftFromArgs(fields, parsed.value, { ...draft });
        setDraft(nextDraft);
        setWarnings(parsed.warnings);
        setMode("form");
        setErrors([]);
        setFieldErrors({});
    };
    const run = useCallback(async () => {
        if (running)
            return;
        let args;
        if (mode === "form") {
            const built = buildArguments(fields, stateRef.current.draft);
            if (!built.ok) {
                setErrors(built.errors);
                setFieldErrors(built.fieldErrors);
                return;
            }
            args = built.value;
            setFieldErrors({});
            setWarnings([]);
        }
        else {
            const parsed = parseJsonArguments(fields, stateRef.current.jsonText);
            if (!parsed.ok) {
                setErrors(parsed.errors);
                return;
            }
            args = parsed.value;
            setWarnings(parsed.warnings);
        }
        setErrors([]);
        setRunning(true);
        setResult(undefined);
        try {
            const input = entry !== undefined
                ? { ...(entryKey !== undefined ? { key: entryKey } : {}), entry, tool: tool.name, arguments: args }
                : { ...(serverName !== undefined ? { serverName } : {}), tool: tool.name, arguments: args };
            const next = await api.invoke(input);
            setResult(next);
        }
        catch (error) {
            setResult({ ok: false, errors: [error instanceof Error ? error.message : String(error)] });
        }
        finally {
            setRunning(false);
        }
    }, [api, entry, entryKey, fields, mode, running, serverName, tool.name]);
    // 键盘：Esc 关闭；⌘/Ctrl + Enter 执行。
    useEffect(() => {
        const onKey = (event) => {
            if (event.key === "Escape") {
                // 自绘下拉打开时，Esc 只关下拉（SkpSelect 自己处理），不要连带关弹窗。
                if (document.querySelector(".skp-dd-pop") !== null)
                    return;
                event.stopPropagation();
                onClose();
                return;
            }
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void run();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose, run]);
    const paramCount = fields.length;
    const requiredCount = fields.filter((field) => field.required).length;
    const jsonErrorCount = errors.length > 0;
    const missingRequired = mode === "form" && requiredMissing(fields, draft);
    const runDisabled = running || missingRequired;
    return (_jsx("div", { className: "skp-modal-overlay", onClick: onClose, children: _jsxs("div", { className: "skp-dbg-modal", role: "dialog", "aria-modal": "true", "aria-label": `调试 ${tool.name}`, onClick: (event) => event.stopPropagation(), children: [_jsxs("div", { className: "skp-dbg-head", children: [_jsxs("div", { className: "skp-dbg-head-main", children: [_jsx("code", { className: "skp-dbg-tool-name", children: tool.name }), _jsx("span", { className: "skp-tag skp-tag-flat", children: serverLabel }), _jsxs("code", { className: "skp-dbg-namespace", title: `mcp__${serverName ?? entryKey ?? "server"}__${tool.name}`, children: ["mcp__", serverName ?? entryKey ?? "server", "__", tool.name] })] }), _jsx("div", { className: "skp-dbg-seg", role: "tablist", "aria-label": "\u53C2\u6570\u8F93\u5165\u6A21\u5F0F", children: ["form", "json"].map((item) => (_jsx("button", { type: "button", role: "tab", "aria-selected": mode === item, className: mode === item ? "skp-dbg-seg-btn skp-dbg-seg-btn-active" : "skp-dbg-seg-btn", onClick: () => switchMode(item), children: item === "form" ? "表单" : "JSON" }, item))) }), _jsx("button", { type: "button", className: "skp-dbg-close", "aria-label": "\u5173\u95ED", onClick: onClose, children: "\u2715" })] }), _jsxs("div", { className: "skp-dbg-notice", children: [_jsx("span", { "aria-hidden": "true", children: "\u26A0" }), _jsxs("span", { children: ["\u8C03\u8BD5\u8C03\u7528\u4F1A\u771F\u5B9E\u6267\u884C\u4E00\u6B21\u5DE5\u5177\uFF08\u53EF\u80FD\u4EA7\u751F\u526F\u4F5C\u7528 / \u6D88\u8017\u989D\u5EA6\uFF09\uFF1B\u7ED3\u679C\u4E0D\u5199\u5165\u5BF9\u8BDD\u4E0A\u4E0B\u6587", entry !== undefined ? "，走一次性连接不挂载。" : "，走已挂载实例。"] })] }), _jsxs("div", { className: "skp-dbg-body", children: [tool.description !== undefined && tool.description.trim().length > 0 && (_jsx("p", { className: "skp-dbg-desc", children: tool.description.trim() })), mode === "form" ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "skp-dbg-params-head", children: [_jsx("span", { className: "skp-dbg-section-title", children: "\u53C2\u6570" }), _jsx("span", { className: "skp-test-stat", children: paramCount === 0 ? "该工具无参数" : `必填 ${requiredCount} · 可选 ${paramCount - requiredCount}` }), _jsx("span", { className: "skp-dbg-spacer" }), paramCount > 0 && (_jsx("button", { type: "button", className: "skp-link-btn", onClick: () => setDraft({}), children: "\u91CD\u7F6E" }))] }), paramCount === 0 ? (_jsx("div", { className: "skp-dbg-empty", children: "\u8BE5\u5DE5\u5177\u65E0\u53C2\u6570\uFF0C\u53EF\u76F4\u63A5\u6267\u884C\u3002" })) : (_jsx("div", { className: "skp-dbg-params", children: fields.map((field) => (_jsx(DebugFieldRow, { field: field, draft: draft, fieldErrors: fieldErrors, onChange: setField }, field.path))) }))] })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "skp-dbg-params-head", children: [_jsx("span", { className: "skp-dbg-section-title", children: "JSON \u53C2\u6570" }), _jsx("span", { className: "skp-test-stat", children: "arguments\uFF08\u5BF9\u8C61\uFF09" }), _jsx("span", { className: "skp-dbg-spacer" }), _jsx("button", { type: "button", className: "skp-link-btn", onClick: () => {
                                                try {
                                                    setJsonText(JSON.stringify(JSON.parse(jsonText), null, 2));
                                                }
                                                catch {
                                                    /* 非法 JSON 不格式化 */
                                                }
                                            }, children: "\u683C\u5F0F\u5316" })] }), _jsx("textarea", { className: "skp-input skp-textarea skp-dbg-json", value: jsonText, spellCheck: false, "aria-label": "arguments JSON", onChange: (event) => {
                                        setJsonText(event.target.value);
                                        setErrors([]);
                                    } }), _jsx("div", { className: "skp-note", children: "\u652F\u6301\u7C98\u8D34\u5B8C\u6574 arguments \u5BF9\u8C61 \u00B7 \u2318/Ctrl + Enter \u6267\u884C \u00B7 Esc \u5173\u95ED" })] })), !jsonErrorCount && warnings.length > 0 && (_jsx("div", { className: "skp-dbg-warn", children: warnings.join("\n") })), jsonErrorCount && _jsx("div", { className: "skp-error skp-dbg-errors", children: errors.join("\n") }), _jsxs("div", { ref: resultRef, children: [running && (_jsx("section", { className: "skp-dbg-result", children: _jsx("div", { className: "skp-dbg-result-head", children: _jsx("span", { className: "skp-tag skp-tag-warn", children: "\u23F3 \u8C03\u7528\u4E2D\u2026\uFF08\u6700\u957F 60s\uFF09" }) }) })), !running && result !== undefined && _jsx(ResultView, { result: result })] })] }), _jsxs("div", { className: "skp-dbg-footer", children: [_jsx("span", { className: "skp-dbg-footer-note", children: entry !== undefined ? "一次性连接 · 不挂载 · 不影响正在运行的对话" : "走已挂载实例 · 与真实调用同一连接" }), _jsx("span", { className: "skp-dbg-spacer" }), mode === "form" && paramCount > 0 && (_jsx("button", { type: "button", className: "skp-btn", onClick: fillExample, children: "\u586B\u5165\u793A\u4F8B" })), _jsx("button", { type: "button", className: "skp-btn skp-btn-primary", disabled: runDisabled, title: runDisabled ? "请先填写必填参数" : "执行一次真实调用（⌘/Ctrl + Enter）", onClick: () => void run(), children: running ? "执行中…" : "执行 ▶" })] })] }) }));
}
/**
 * 一个参数行：名称 / 类型 / 必填 / 说明 + 对应控件。
 *
 * object 且 schema 里有 `properties` → 递归渲染成带缩进的子表单卡片；
 * 叶子字段按类型渲染控件（enum 下拉 / boolean 开关 / array·object JSON 文本 / 文本）。
 */
function DebugFieldRow({ field, draft, fieldErrors, onChange, }) {
    const id = `skp-dbg-field-${field.path.replace(/[^A-Za-z0-9_-]/g, "-")}`;
    const value = draft[field.path] ?? "";
    const error = fieldErrors[field.path];
    const label = (_jsxs("div", { className: "skp-dbg-field-label", children: [_jsx("code", { className: "skp-dbg-field-name", title: field.path, children: field.name }), _jsx("span", { className: "skp-test-stat", children: field.typeLabel }), _jsx("span", { className: field.required ? "skp-tag skp-tag-warn" : "skp-tag skp-tag-flat", children: field.required ? "必填" : "可选" }), field.description !== undefined && _jsx("span", { className: "skp-dbg-field-desc", children: field.description })] }));
    // object（有 properties）：递归子表单卡片，子字段缩进一层。
    if (field.children !== undefined) {
        return (_jsxs("div", { className: error !== undefined ? "skp-dbg-group skp-dbg-group-error" : "skp-dbg-group", children: [_jsx("div", { className: "skp-dbg-group-head", children: label }), _jsx("div", { className: "skp-dbg-group-body", children: field.children.map((child) => (_jsx(DebugFieldRow, { field: child, draft: draft, fieldErrors: fieldErrors, onChange: onChange }, child.path))) }), error !== undefined && _jsx("div", { className: "skp-dbg-group-error-text", children: error })] }));
    }
    const control = (() => {
        if (field.baseType === "enum") {
            const options = (field.enumValues ?? []).map((raw, index) => ({
                value: String(index),
                label: displayValue(raw),
            }));
            const selected = (field.enumValues ?? []).findIndex((raw) => displayValue(raw) === value);
            return (_jsx(SkpSelect, { value: selected >= 0 ? String(selected) : "", ariaLabel: `${field.name} 允许值`, options: [{ value: "", label: "（未选择）" }, ...options], onChange: (next) => {
                    if (next === "")
                        return onChange(field.path, "");
                    const raw = (field.enumValues ?? [])[Number(next)];
                    if (raw !== undefined)
                        onChange(field.path, displayValue(raw));
                } }));
        }
        if (field.baseType === "boolean") {
            const checked = value === "true";
            return (_jsxs("label", { className: "skp-dbg-switch", children: [_jsxs("span", { className: "skp-switch", children: [_jsx("input", { id: id, type: "checkbox", checked: checked, onChange: (event) => onChange(field.path, event.target.checked ? "true" : "false") }), _jsx("span", { className: "skp-switch-track" })] }), _jsx("span", { className: "skp-dbg-switch-text", children: checked ? "true" : "false" })] }));
        }
        if (field.baseType === "array" || field.baseType === "object" || field.baseType === "unknown") {
            return (_jsx("textarea", { id: id, className: "skp-input skp-textarea skp-dbg-textarea", value: value, spellCheck: false, placeholder: field.baseType === "array" ? "[]" : "{}", onChange: (event) => onChange(field.path, event.target.value) }));
        }
        return (_jsx("input", { id: id, className: "skp-input", value: value, inputMode: field.baseType === "integer" || field.baseType === "number" ? "numeric" : undefined, placeholder: field.baseType === "integer" ? "整数" : field.baseType === "number" ? "数字" : "文本", onChange: (event) => onChange(field.path, event.target.value) }));
    })();
    return (_jsxs("div", { className: error !== undefined ? "skp-dbg-field skp-dbg-field-error" : "skp-dbg-field", children: [label, _jsx("div", { className: "skp-dbg-field-control", children: control }), error !== undefined && _jsx("div", { className: "skp-dbg-field-error-text", children: error })] }));
}
