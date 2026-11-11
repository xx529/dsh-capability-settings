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
import type { ClientMcpTool, McpApi, McpInvokeInput, McpInvokeResult } from "./api.js";
import type { McpServerEntry } from "../mcp/types.js";
import { SkpSelect } from "./select.js";

// ---------------------------------------------------------------------------
// 参数模型：从 inputSchema 展开成可编辑字段
// ---------------------------------------------------------------------------

/** 字段的基础类型（决定渲染控件与参数强制转换）。 */
type DebugBaseType = "string" | "integer" | "number" | "boolean" | "array" | "object" | "enum" | "unknown";

/** 一个参数的可编辑模型。 */
interface DebugField {
  name: string;
  /** 类型列展示文本（string / integer / string (enum) …）。 */
  typeLabel: string;
  baseType: DebugBaseType;
  required: boolean;
  description?: string;
  /** enum 的原始允许值（保留 JSON 值，提交时按原类型回填）。 */
  enumValues?: unknown[];
  /** schema.default（「填入示例」优先用它）。 */
  defaultValue?: unknown;
}

/** true = 纯 JSON 对象（非 null / 数组）。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** schema 的 `type` 归一（字符串或联合数组取第一个可识别类型）。 */
function typeOf(prop: Record<string, unknown>): string | undefined {
  const raw = prop.type;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    const parts = raw.filter((part): part is string => typeof part === "string" && part !== "null");
    if (parts.length === 1) return parts[0];
    if (parts.length > 1) return "union";
  }
  if (prop.anyOf !== undefined || prop.oneOf !== undefined) return "union";
  return undefined;
}

/** 把一个 schema 属性展开成字段模型。 */
function fieldOf(name: string, raw: unknown, required: boolean): DebugField {
  const prop = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const enumValues = Array.isArray(prop.enum) && prop.enum.length > 0 ? (prop.enum as unknown[]) : undefined;
  const declared = typeOf(prop);
  const baseType: DebugBaseType =
    enumValues !== undefined
      ? "enum"
      : declared === "string" ||
          declared === "integer" ||
          declared === "number" ||
          declared === "boolean" ||
          declared === "array" ||
          declared === "object"
        ? declared
        : "unknown";
  const label =
    enumValues !== undefined
      ? declared !== undefined && declared !== "union"
        ? `${declared} (enum)`
        : "enum"
      : declared === "union"
        ? "union"
        : (declared ?? "unknown");
  return {
    name,
    typeLabel: label,
    baseType,
    required,
    ...(typeof prop.description === "string" && prop.description.trim().length > 0
      ? { description: prop.description.trim() }
      : {}),
    ...(enumValues !== undefined ? { enumValues } : {}),
    ...(prop.default !== undefined ? { defaultValue: prop.default } : {}),
  };
}

/** 从工具的 parameters（inputSchema）展开字段列表。 */
function fieldsOf(parameters: Record<string, unknown> | undefined): DebugField[] {
  if (parameters === undefined || parameters === null) return [];
  const properties = parameters.properties;
  if (properties === null || typeof properties !== "object" || Array.isArray(properties)) return [];
  const required = Array.isArray(parameters.required)
    ? parameters.required.filter((name): name is string => typeof name === "string")
    : [];
  return Object.entries(properties as Record<string, unknown>).map(([name, raw]) => fieldOf(name, raw, required.includes(name)));
}

/** 值的展示文本：字符串原样，其余 JSON 化（存进草稿 / 输入框）。 */
function displayValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** 对象参数字典 → 草稿（表单模式的初始值）。 */
function draftOf(fields: readonly DebugField[]): Record<string, string> {
  const draft: Record<string, string> = {};
  for (const field of fields) {
    if (field.defaultValue !== undefined) draft[field.name] = displayValue(field.defaultValue);
  }
  return draft;
}

/** 校验单个字段的文本，返回解析后的值或错误文案。 */
function parseField(field: DebugField, text: string): { ok: true; value?: unknown } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (field.baseType === "string") return { ok: true, value: text };
  if (trimmed.length === 0) return { ok: true };
  switch (field.baseType) {
    case "integer": {
      const value = Number(trimmed);
      if (!Number.isFinite(value) || !Number.isInteger(value)) return { ok: false, error: "应为整数" };
      return { ok: true, value };
    }
    case "number": {
      const value = Number(trimmed);
      if (!Number.isFinite(value)) return { ok: false, error: "应为数字" };
      return { ok: true, value };
    }
    case "boolean":
      if (trimmed !== "true" && trimmed !== "false") return { ok: false, error: "应为 true / false" };
      return { ok: true, value: trimmed === "true" };
    case "enum": {
      const values = field.enumValues ?? [];
      const match = values.find((value) => displayValue(value) === text || displayValue(value) === trimmed);
      if (match === undefined) return { ok: false, error: `允许值：${values.map(displayValue).join(" / ")}` };
      return { ok: true, value: match };
    }
    default: {
      try {
        const value: unknown = JSON.parse(text);
        if (field.baseType === "array" && !Array.isArray(value)) return { ok: false, error: "应为 JSON 数组" };
        if (field.baseType === "object" && !isPlainObject(value)) return { ok: false, error: "应为 JSON 对象" };
        return { ok: true, value };
      } catch {
        return { ok: false, error: "JSON 解析失败" };
      }
    }
  }
}

/** 表单草稿 → 调用参数（必填 / 类型错误全部收集）。 */
function buildArguments(
  fields: readonly DebugField[],
  draft: Record<string, string>,
): { ok: true; value: Record<string, unknown> } | { ok: false; errors: string[]; fieldErrors: Record<string, string> } {
  const errors: string[] = [];
  const fieldErrors: Record<string, string> = {};
  const value: Record<string, unknown> = {};
  for (const field of fields) {
    const text = draft[field.name] ?? "";
    if (field.required && text.trim().length === 0) {
      fieldErrors[field.name] = "必填参数未填写";
      continue;
    }
    if (text.trim().length === 0) continue;
    const parsed = parseField(field, text);
    if (!parsed.ok) {
      fieldErrors[field.name] = parsed.error;
      continue;
    }
    if (parsed.value !== undefined) value[field.name] = parsed.value;
  }
  const missing = Object.keys(fieldErrors).filter((name) => fieldErrors[name] === "必填参数未填写");
  if (missing.length > 0) errors.push(`必填参数未填写：${missing.join("、")}`);
  const invalid = Object.keys(fieldErrors).filter((name) => fieldErrors[name] !== "必填参数未填写");
  if (invalid.length > 0) errors.push(`参数格式不正确：${invalid.map((name) => `${name}（${fieldErrors[name]}）`).join("；")}`);
  if (errors.length > 0) return { ok: false, errors, fieldErrors };
  return { ok: true, value };
}

/** JSON 模式文本 → 调用参数（对象形状 / 必填 / 已知字段类型）。 */
function parseJsonArguments(
  fields: readonly DebugField[],
  text: string,
): { ok: true; value: Record<string, unknown>; warnings: string[] } | { ok: false; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`] };
  }
  if (!isPlainObject(parsed)) return { ok: false, errors: ["arguments 必须是 JSON 对象（例如 { \"key\": \"value\" }）"] };
  const value = parsed as Record<string, unknown>;
  const errors: string[] = [];
  const byName = new Map(fields.map((field) => [field.name, field]));
  for (const field of fields) {
    if (field.required && value[field.name] === undefined) errors.push(`缺少必填参数：${field.name}`);
  }
  for (const [name, raw] of Object.entries(value)) {
    const field = byName.get(name);
    if (field === undefined) continue;
    if (raw === null) continue;
    if (field.baseType === "number" && (typeof raw !== "number" || !Number.isFinite(raw))) {
      errors.push(`${name}：应为 number`);
    } else if (field.baseType === "integer" && (typeof raw !== "number" || !Number.isInteger(raw))) {
      errors.push(`${name}：应为 integer`);
    } else if (field.baseType === "string" && typeof raw !== "string") {
      errors.push(`${name}：应为 string`);
    } else if (field.baseType === "boolean" && typeof raw !== "boolean") {
      errors.push(`${name}：应为 boolean`);
    } else if (field.baseType === "array" && !Array.isArray(raw)) {
      errors.push(`${name}：应为数组`);
    } else if (field.baseType === "object" && !isPlainObject(raw)) {
      errors.push(`${name}：应为对象`);
    } else if (field.baseType === "enum" && !(field.enumValues ?? []).some((candidate) => displayValue(candidate) === displayValue(raw))) {
      errors.push(`${name}：不在允许值内（${(field.enumValues ?? []).map(displayValue).join(" / ")}）`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  const unknown = Object.keys(value).filter((name) => !byName.has(name));
  return {
    ok: true,
    value,
    warnings: unknown.length > 0 ? [`未知参数（schema 里没有，服务器可能忽略）：${unknown.join("、")}`] : [],
  };
}

// ---------------------------------------------------------------------------
// 草稿缓存（关闭后再次打开同一工具恢复）
// ---------------------------------------------------------------------------

interface DebugDraftCache {
  mode: "form" | "json";
  draft: Record<string, string>;
  jsonText: string;
  result?: McpInvokeResult;
  warnings?: string[];
}

const DRAFT_CACHE = new Map<string, DebugDraftCache>();

// ---------------------------------------------------------------------------
// 弹窗组件
// ---------------------------------------------------------------------------

/** 一个结果内容块的渲染（text / image / resource / 其它）。 */
function ResultBlock({ block, index }: { block: Record<string, unknown>; index: number }) {
  const type = typeof block.type === "string" ? block.type : "unknown";
  if (type === "text" && typeof block.text === "string") {
    let text = block.text;
    try {
      text = JSON.stringify(JSON.parse(block.text), null, 2);
    } catch {
      /* 非 JSON 文本原样展示 */
    }
    return <pre className="skp-dbg-code">{text}</pre>;
  }
  if (type === "image" && typeof block.data === "string") {
    const mime = typeof block.mimeType === "string" ? block.mimeType : "image/png";
    return <img className="skp-dbg-img" src={`data:${mime};base64,${block.data}`} alt={`结果图片 ${index + 1}`} />;
  }
  if (type === "resource") {
    const resource = isPlainObject(block.resource) ? block.resource : undefined;
    const uri = resource !== undefined && typeof resource.uri === "string" ? resource.uri : undefined;
    const text = resource !== undefined && typeof resource.text === "string" ? resource.text : undefined;
    return (
      <div className="skp-dbg-resource">
        {uri !== undefined ? (
          <a className="skp-link-btn" href={uri} target="_blank" rel="noreferrer">
            {uri}
          </a>
        ) : (
          <span className="skp-note">资源内容</span>
        )}
        {text !== undefined && <pre className="skp-dbg-code">{text}</pre>}
      </div>
    );
  }
  return <pre className="skp-dbg-code">{JSON.stringify(block, null, 2)}</pre>;
}

/** 结果区：状态条 + 内容块 + structuredContent + 复制。 */
function ResultView({ result }: { result: McpInvokeResult }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const text = result.ok
      ? JSON.stringify(
          {
            content: result.content,
            ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
            isError: result.isError,
          },
          null,
          2,
        )
      : result.errors.join("\n");
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  if (!result.ok) {
    return (
      <section className="skp-dbg-result" aria-label="调用失败">
        <div className="skp-dbg-result-head">
          <span className="skp-tag skp-tag-error">! 调用失败</span>
          <span className="skp-dbg-spacer" />
          <button type="button" className="skp-link-btn" onClick={copy}>
            {copied ? "已复制" : "复制错误"}
          </button>
        </div>
        <pre className="skp-dbg-code skp-dbg-code-error">{result.errors.join("\n")}</pre>
      </section>
    );
  }
  const statusTag = result.isError ? (
    <span className="skp-tag skp-tag-error">! 工具返回错误</span>
  ) : (
    <span className="skp-tag skp-tag-global">✓ 成功</span>
  );
  return (
    <section className="skp-dbg-result" aria-label="调用结果">
      <div className="skp-dbg-result-head">
        {statusTag}
        <span className="skp-test-stat">{result.elapsedMs}ms</span>
        <span className="skp-test-stat">{result.content.length} 个内容块</span>
        {result.isError && <span className="skp-dbg-iserror">isError = true</span>}
        <span className="skp-dbg-spacer" />
        <button type="button" className="skp-link-btn" onClick={copy}>
          {copied ? "已复制" : "复制结果"}
        </button>
      </div>
      {result.content.length === 0 ? (
        <div className="skp-note">工具没有返回内容。</div>
      ) : (
        result.content.map((block, index) => (
          <div key={index} className="skp-dbg-block">
            <ResultBlock block={block} index={index} />
          </div>
        ))
      )}
      {result.structuredContent !== undefined && (
        <details className="skp-dbg-details">
          <summary>structuredContent</summary>
          <pre className="skp-dbg-code">{JSON.stringify(result.structuredContent, null, 2)}</pre>
        </details>
      )}
    </section>
  );
}

/** 调试弹窗：参数表单 + 执行 + 结果（同一滚动区）。 */
export function McpDebugDialog({
  api,
  serverLabel,
  serverName,
  entry,
  entryKey,
  tool,
  onClose,
}: {
  api: McpApi;
  /** 服务器展示名（头部徽章）。 */
  serverLabel: string;
  /** 外部注入实例路径：serverName。 */
  serverName?: string;
  /** 配置条目路径：条目本身 + 键名。 */
  entry?: McpServerEntry;
  entryKey?: string;
  tool: ClientMcpTool;
  onClose: () => void;
}) {
  const fields = fieldsOf(tool.parameters);
  const cacheKey = `${entryKey ?? serverName ?? "server"}::${tool.name}`;
  const cached = DRAFT_CACHE.get(cacheKey);
  const [mode, setMode] = useState<"form" | "json">(cached?.mode ?? "form");
  const [draft, setDraft] = useState<Record<string, string>>(cached?.draft ?? draftOf(fields));
  const [jsonText, setJsonText] = useState(cached?.jsonText ?? JSON.stringify(draftOf(fields), null, 2));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>(cached?.warnings ?? []);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<McpInvokeResult | undefined>(cached?.result);
  const resultRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ mode, draft, jsonText, result, warnings });
  stateRef.current = { mode, draft, jsonText, result, warnings };

  // 关闭时缓存草稿 + 结果（仅内存；进程重载即清空）。
  useEffect(
    () => () => {
      const latest = stateRef.current;
      DRAFT_CACHE.set(cacheKey, {
        mode: latest.mode,
        draft: latest.draft,
        jsonText: latest.jsonText,
        ...(latest.result !== undefined ? { result: latest.result } : {}),
        ...(latest.warnings.length > 0 ? { warnings: latest.warnings } : {}),
      });
    },
    [cacheKey],
  );

  // 执行完成后把结果滚进视野（参数区保持展开，结果在下方）。
  useEffect(() => {
    if (result === undefined) return;
    resultRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [result]);

  const setField = (name: string, value: string) => {
    setDraft((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => {
      if (prev[name] === undefined) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const fillExample = () => {
    const next: Record<string, string> = {};
    for (const field of fields) {
      if (field.defaultValue !== undefined) next[field.name] = displayValue(field.defaultValue);
      else if (field.enumValues !== undefined && field.enumValues.length > 0) next[field.name] = displayValue(field.enumValues[0]);
      else if (field.baseType === "boolean") next[field.name] = "true";
      else if (field.baseType === "integer" || field.baseType === "number") next[field.name] = "1";
      else if (field.baseType === "array") next[field.name] = "[]";
      else if (field.baseType === "object") next[field.name] = "{}";
      else next[field.name] = "";
    }
    setDraft(next);
    setFieldErrors({});
  };

  /** 切换模式：表单 → JSON 用当前参数格式化；JSON → 表单要求 JSON 合法。 */
  const switchMode = (nextMode: "form" | "json") => {
    if (nextMode === mode) return;
    if (nextMode === "json") {
      const built = buildArguments(fields, draft);
      setJsonText(JSON.stringify(built.ok ? built.value : draft, null, 2));
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
    const nextDraft = { ...draft };
    for (const field of fields) {
      const value = parsed.value[field.name];
      if (value !== undefined) nextDraft[field.name] = displayValue(value);
    }
    setDraft(nextDraft);
    setWarnings(parsed.warnings);
    setMode("form");
    setErrors([]);
    setFieldErrors({});
  };

  const run = useCallback(async () => {
    if (running) return;
    let args: Record<string, unknown>;
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
    } else {
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
      const input: McpInvokeInput =
        entry !== undefined
          ? { ...(entryKey !== undefined ? { key: entryKey } : {}), entry, tool: tool.name, arguments: args }
          : { ...(serverName !== undefined ? { serverName } : {}), tool: tool.name, arguments: args };
      const next = await api.invoke(input);
      setResult(next);
    } catch (error) {
      setResult({ ok: false, errors: [error instanceof Error ? error.message : String(error)] });
    } finally {
      setRunning(false);
    }
  }, [api, entry, entryKey, fields, mode, running, serverName, tool.name]);

  // 键盘：Esc 关闭；⌘/Ctrl + Enter 执行。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // 自绘下拉打开时，Esc 只关下拉（SkpSelect 自己处理），不要连带关弹窗。
        if (document.querySelector(".skp-dd-pop") !== null) return;
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
  const requiredMissing =
    mode === "form" && fields.some((field) => field.required && (draft[field.name] ?? "").trim().length === 0);
  const runDisabled = running || requiredMissing;

  return (
    <div className="skp-modal-overlay" onClick={onClose}>
      <div
        className="skp-dbg-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`调试 ${tool.name}`}
        onClick={(event) => event.stopPropagation()}
      >
        {/* 头部：工具名 + 服务器 + 命名空间 + 表单/JSON + 关闭 */}
        <div className="skp-dbg-head">
          <div className="skp-dbg-head-main">
            <code className="skp-dbg-tool-name">{tool.name}</code>
            <span className="skp-tag skp-tag-flat">{serverLabel}</span>
            <code className="skp-dbg-namespace" title={`mcp__${serverName ?? entryKey ?? "server"}__${tool.name}`}>
              mcp__{serverName ?? entryKey ?? "server"}__{tool.name}
            </code>
          </div>
          <div className="skp-dbg-seg" role="tablist" aria-label="参数输入模式">
            {(["form", "json"] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={mode === item}
                className={mode === item ? "skp-dbg-seg-btn skp-dbg-seg-btn-active" : "skp-dbg-seg-btn"}
                onClick={() => switchMode(item)}
              >
                {item === "form" ? "表单" : "JSON"}
              </button>
            ))}
          </div>
          <button type="button" className="skp-dbg-close" aria-label="关闭" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* 常驻安全提示 */}
        <div className="skp-dbg-notice">
          <span aria-hidden="true">⚠</span>
          <span>
            调试调用会真实执行一次工具（可能产生副作用 / 消耗额度）；结果不写入对话上下文
            {entry !== undefined ? "，走一次性连接不挂载。" : "，走已挂载实例。"}
          </span>
        </div>

        <div className="skp-dbg-body">
          {tool.description !== undefined && tool.description.trim().length > 0 && (
            <p className="skp-dbg-desc">{tool.description.trim()}</p>
          )}

          {mode === "form" ? (
            <>
              <div className="skp-dbg-params-head">
                <span className="skp-dbg-section-title">参数</span>
                <span className="skp-test-stat">
                  {paramCount === 0 ? "该工具无参数" : `必填 ${requiredCount} · 可选 ${paramCount - requiredCount}`}
                </span>
                <span className="skp-dbg-spacer" />
                {paramCount > 0 && (
                  <button type="button" className="skp-link-btn" onClick={() => setDraft({})}>
                    重置
                  </button>
                )}
              </div>
              {paramCount === 0 ? (
                <div className="skp-dbg-empty">该工具无参数，可直接执行。</div>
              ) : (
                <div className="skp-dbg-params">
                  {fields.map((field) => (
                    <DebugFieldRow
                      key={field.name}
                      field={field}
                      value={draft[field.name] ?? ""}
                      error={fieldErrors[field.name]}
                      onChange={(value) => setField(field.name, value)}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="skp-dbg-params-head">
                <span className="skp-dbg-section-title">JSON 参数</span>
                <span className="skp-test-stat">arguments（对象）</span>
                <span className="skp-dbg-spacer" />
                <button
                  type="button"
                  className="skp-link-btn"
                  onClick={() => {
                    try {
                      setJsonText(JSON.stringify(JSON.parse(jsonText), null, 2));
                    } catch {
                      /* 非法 JSON 不格式化 */
                    }
                  }}
                >
                  格式化
                </button>
              </div>
              <textarea
                className="skp-input skp-textarea skp-dbg-json"
                value={jsonText}
                spellCheck={false}
                aria-label="arguments JSON"
                onChange={(event) => {
                  setJsonText(event.target.value);
                  setErrors([]);
                }}
              />
              <div className="skp-note">支持粘贴完整 arguments 对象 · ⌘/Ctrl + Enter 执行 · Esc 关闭</div>
            </>
          )}

          {/* 校验 / 警告 / 错误 */}
          {!jsonErrorCount && warnings.length > 0 && (
            <div className="skp-dbg-warn">{warnings.join("\n")}</div>
          )}
          {jsonErrorCount && <div className="skp-error skp-dbg-errors">{errors.join("\n")}</div>}

          {/* 结果（参数下方，同一滚动区） */}
          <div ref={resultRef}>
            {running && (
              <section className="skp-dbg-result">
                <div className="skp-dbg-result-head">
                  <span className="skp-tag skp-tag-warn">⏳ 调用中…（最长 60s）</span>
                </div>
              </section>
            )}
            {!running && result !== undefined && <ResultView result={result} />}
          </div>
        </div>

        {/* 固定底栏 */}
        <div className="skp-dbg-footer">
          <span className="skp-dbg-footer-note">
            {entry !== undefined ? "一次性连接 · 不挂载 · 不影响正在运行的对话" : "走已挂载实例 · 与真实调用同一连接"}
          </span>
          <span className="skp-dbg-spacer" />
          {mode === "form" && paramCount > 0 && (
            <button type="button" className="skp-btn" onClick={fillExample}>
              填入示例
            </button>
          )}
          <button
            type="button"
            className="skp-btn skp-btn-primary"
            disabled={runDisabled}
            title={runDisabled ? "请先填写必填参数" : "执行一次真实调用（⌘/Ctrl + Enter）"}
            onClick={() => void run()}
          >
            {running ? "执行中…" : "执行 ▶"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 一个参数行：名称 / 类型 / 必填 / 说明 + 对应控件。 */
function DebugFieldRow({
  field,
  value,
  error,
  onChange,
}: {
  field: DebugField;
  value: string;
  error?: string;
  onChange(value: string): void;
}) {
  const id = `skp-dbg-field-${field.name}`;
  const control = (() => {
    if (field.baseType === "enum") {
      const options = (field.enumValues ?? []).map((raw, index) => ({
        value: String(index),
        label: displayValue(raw),
      }));
      const selected = (field.enumValues ?? []).findIndex((raw) => displayValue(raw) === value);
      return (
        <SkpSelect
          value={selected >= 0 ? String(selected) : ""}
          ariaLabel={`${field.name} 允许值`}
          options={[{ value: "", label: "（未选择）" }, ...options]}
          onChange={(next) => {
            if (next === "") return onChange("");
            const raw = (field.enumValues ?? [])[Number(next)];
            if (raw !== undefined) onChange(displayValue(raw));
          }}
        />
      );
    }
    if (field.baseType === "boolean") {
      const checked = value === "true";
      return (
        <label className="skp-dbg-switch">
          <span className="skp-switch">
            <input
              id={id}
              type="checkbox"
              checked={checked}
              onChange={(event) => onChange(event.target.checked ? "true" : "false")}
            />
            <span className="skp-switch-track" />
          </span>
          <span className="skp-dbg-switch-text">{checked ? "true" : "false"}</span>
        </label>
      );
    }
    if (field.baseType === "array" || field.baseType === "object" || field.baseType === "unknown") {
      return (
        <textarea
          id={id}
          className="skp-input skp-textarea skp-dbg-textarea"
          value={value}
          spellCheck={false}
          placeholder={field.baseType === "array" ? "[]" : "{}"}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    }
    return (
      <input
        id={id}
        className="skp-input"
        value={value}
        inputMode={field.baseType === "integer" || field.baseType === "number" ? "numeric" : undefined}
        placeholder={field.baseType === "integer" ? "整数" : field.baseType === "number" ? "数字" : "文本"}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  })();
  return (
    <div className={error !== undefined ? "skp-dbg-field skp-dbg-field-error" : "skp-dbg-field"}>
      <div className="skp-dbg-field-label">
        <code className="skp-dbg-field-name">{field.name}</code>
        <span className="skp-test-stat">{field.typeLabel}</span>
        <span className={field.required ? "skp-tag skp-tag-warn" : "skp-tag skp-tag-flat"}>
          {field.required ? "必填" : "可选"}
        </span>
        {field.description !== undefined && <span className="skp-dbg-field-desc">{field.description}</span>}
      </div>
      <div className="skp-dbg-field-control">{control}</div>
      {error !== undefined && <div className="skp-dbg-field-error-text">{error}</div>}
    </div>
  );
}
