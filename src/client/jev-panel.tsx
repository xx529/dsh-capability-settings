/**
 * 「Jev 模型」配置页（能力面板第三个域 Tab）。
 *
 * 纯客户端表单：配置读写、密钥掩码、测试连接全部走 `api.jev.*`（宿主进程
 * 持有密钥并发请求，浏览器永不接触明文，见架构 §4）。三块内容：
 *   1. Base URL / 模型名 / API Key 来源（直接填写 | 环境变量）；
 *   2. 「能力决策」区：自动评分开关 + 三个门槛（停顿阈值 / 最少触发字数 /
 *      最少修改间隔字符数）
 *   3. 测试连接 / 恢复默认 / 保存（保存成功**不关闭、不跳转**）。
 *
 * 关键约定（评审 checklist）：
 *   - 保存校验本地先做一遍（范围 / 必填 / 格式），失败不发 RPC；宿主返回的
 *     `issues` 再落到同一批行内错误上（双保险）。
 *   - 密钥只单向下发：输入框为空且已有文件密钥时提交**不带** `apiKey` 字段
 *     （避免把掩码写回文件）；切到「环境变量」保存时提交 `apiKey: ""` 让宿主
 *     删除文件密钥（架构 §3.6）。
 *   - 未保存草稿在**同一面板会话内**切 Tab 不丢：本组件由 panel.tsx 常驻挂载，
 *     用 `active` 控制显隐，不随切 Tab 卸载（AC-CFG-16）。
 *   - 测试连接按 RPC 契约使用**已保存配置**（`jev.test` payload 被忽略，
 *     架构 §5.3）；表单有未保存修改时结果行会注明。
 *
 * @module dsh-capability-settings/client/jev-panel
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CapabilityPanelApi, JevConfigInput, JevConfigIssue, JevConfigView, JevErrorCode } from "./api.js";

/** 密钥来源模式：直接填写（宿主文件）/ 环境变量（宿主进程 env）。 */
type KeyMode = "direct" | "env";

/** 与宿主 `defaultJevConfig()` 对齐的默认值（架构 §3.4）。 */
const DEFAULT_BASE_URL = "https://api.typesafe.ai";
const DEFAULT_MODEL = "jev-latest";
const DEFAULT_ENV_NAME = "TYPESAFE_API_KEY";
const DEFAULT_PAUSE_MS = 1000;
const DEFAULT_MIN_CHARS = 10;
const DEFAULT_MIN_EDIT_CHARS = 4;

/**
 * 配置保存成功的全局事件名（F3 修复的发送端）。
 *
 * hero 的 `jev.getConfig` 只在挂载时读一次；配置页保存成功后广播该事件，
 * composer 侧（task-25）监听后重新读取配置，使「未配置」蓝点 / 自动触发门槛
 * 在同一挂载内即时更新。事件不带 detail（监听方自行 `getConfig`）。
 */
export const JEV_CONFIG_CHANGED_EVENT = "capability-panel:jev-config-changed";

/** 广播配置变更（仅在保存成功分支调用；无 window 的环境静默跳过）。 */
function notifyJevConfigChanged(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new window.CustomEvent(JEV_CONFIG_CHANGED_EVENT));
  } catch {
    /* 非浏览器/测试环境没有 CustomEvent：忽略（不影响保存结果） */
  }
}

/** UX §5.8 的完整中文文案（可直抄副本，集中放这里便于对照）。 */
const COPY = {
  title: "Jev 模型",
  /** R5：删除独立 callout，说明并入副标题两行（A10 已拍板文案）。 */
  subtitle: "用 Jev 模型给 Skills、MCP 与 Tools 打分，自动选出与本轮草稿最相关的能力。",
  subtitle2: "一次请求完成；发送输入框草稿与能力名称、描述（Tools 为插件名与工具说明摘要）；草稿仅用于本次评分、不落盘，结果只写当前会话。",
  /** 密钥安全承诺收进 API Key ⓘ（R5）。 */
  keySafety: "密钥仅存宿主，不下发浏览器",
  baseUrl: "Base URL",
  baseUrlHint: "留空使用默认值 https://api.typesafe.ai",
  model: "模型名",
  modelPlaceholder: "jev-latest",
  modelHint: "Jev 模型名，默认 jev-latest。",
  keyMode: "API Key 来源",
  modeDirect: "直接填写",
  modeEnv: "环境变量",
  apiKey: "API Key",
  apiKeyPlaceholder: "粘贴 API Key",
  apiKeyHint: "密钥仅保存在宿主侧；更换后需点「保存」才会生效。",
  changeKey: "更换",
  envName: "环境变量名",
  envNameHint: "宿主从自身进程环境读取；变量应在启动 DSH 的环境中设置。",
  autoSection: "能力决策",
  autoEnable: "输入停顿后自动评分",
  autoEnableHint: "开启后，在对话首屏停止输入达到阈值会自动发起 1 次评分（默认关闭）。",
  autoNoKey: "当前没有可用的 API Key：自动评分不会触发。请先填写并保存密钥，或配置环境变量。",
  pause: "停顿阈值",
  pauseHint: "停止输入达到该时长后自动发起 1 次评分 · 修改量达到阈值后可再次触发",
  minChars: "最少触发字数",
  minCharsHint: "草稿字符数达到该值才可能自动触发（默认 10）",
  minEdit: "最少修改间隔字符数",
  minEditHint: "距上一次能力决策累计插入+删除字符数达到该值，才会再次自动触发（默认 4）",
  cost: "成本：每次约 1 次请求（$0.0003–0.001）",
  autoPrivacy: "开启后，草稿会在停止输入时自动发送到你配置的 Jev 服务，请确认符合你的隐私预期。",
  test: "测试连接",
  testing: "测试中…",
  testRunning: "正在连接 Jev 服务…",
  testFormHint: "测试使用当前表单配置，无需先保存。",
  testFormSuffix: "（测试使用当前表单配置）",
  retry: "重试",
  save: "保存",
  saving: "保存中…",
  saveOk: "Jev 配置已保存",
  reset: "恢复默认",
  resetConfirm: "确认恢复默认",
  cancel: "取消",
  resetTip: "已恢复默认值，保存后生效",
  dirty: "有未保存的修改",
  saveScope: "全局生效 · 保存后立即使用",
  loading: "正在读取配置…",
  unconfiguredTip: "尚未配置 Jev 模型。保存后可在首屏使用「能力决策」。",
  loadError: "读取配置失败：",
  saveError: "保存失败：",
} as const;

/** 本地校验失败的行内错误（与宿主 `issues[].field` 共用同一批字段）。 */
interface FieldErrors {
  baseURL?: string;
  model?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  pauseMs?: string;
  minChars?: string;
  minEditChars?: string;
}

/** 表单状态：数字字段保留字符串，便于展示「非法输入」的行内错误。 */
interface FormState {
  baseURL: string;
  model: string;
  keyMode: KeyMode;
  apiKeyDraft: string;
  replacingKey: boolean;
  showKey: boolean;
  apiKeyEnv: string;
  autoEnabled: boolean;
  pauseMs: string;
  minChars: string;
  minEditChars: string;
}

/** 测试连接的四种状态（结果常驻到下次测试 / 保存）。 */
type TestState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; model: string; latencyMs: number }
  | { kind: "error"; text: string };

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

const ERR_BASE_URL = "Base URL 需以 http:// 或 https:// 开头";
const ERR_KEY_REQUIRED = "请填写 API Key，或切换到「环境变量」";
const ERR_ENV_REQUIRED = "请填写环境变量名";
const ERR_ENV_FORMAT = "环境变量名只能包含字母、数字和下划线，且不能以数字开头";
const ERR_MODEL_REQUIRED = "请填写模型名";
const ERR_PAUSE_RANGE = "停顿阈值需在 300–3000 ms 之间（步长 100）";
const ERR_MIN_CHARS_RANGE = "最少触发字数需在 1–200 之间";
const ERR_MIN_EDIT_RANGE = "最少修改间隔字符数需在 1–100 之间";

/** 读取失败 / 保存失败等异常的可读消息。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 过长的错误信息截断，避免撑破结果行（宿主已脱敏，这里只控长度）。 */
function shorten(text: string, max = 180): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/** 空串按默认值处理（UX：Base URL 留空 = 存默认值；末尾 `/` 规范化）。 */
function normalizeBaseURL(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed.length === 0 ? DEFAULT_BASE_URL : trimmed;
}

/** 严格非负整数解析：`"1e3"` / `"1.5"` / 空串一律视为非法。 */
function parseIntStrict(value: string): number | undefined {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/** 默认表单：Base URL / 模型默认值、**直接填写**、自动触发默认关闭（AC-CFG-3）。 */
function defaultForm(): FormState {
  return {
    baseURL: DEFAULT_BASE_URL,
    model: DEFAULT_MODEL,
    keyMode: "direct",
    apiKeyDraft: "",
    replacingKey: false,
    showKey: false,
    apiKeyEnv: DEFAULT_ENV_NAME,
    autoEnabled: false,
    pauseMs: String(DEFAULT_PAUSE_MS),
    minChars: String(DEFAULT_MIN_CHARS),
    minEditChars: String(DEFAULT_MIN_EDIT_CHARS),
  };
}

/** 从 getConfig 视图生成表单；`keyMode` 缺省按已保存来源推断。 */
function formFromView(view: JevConfigView, keyMode?: KeyMode): FormState {
  return {
    baseURL: view.baseURL,
    model: view.model,
    keyMode: keyMode ?? (view.apiKeySource === "env" ? "env" : "direct"),
    apiKeyDraft: "",
    replacingKey: false,
    showKey: false,
    apiKeyEnv: view.apiKeyEnv ?? DEFAULT_ENV_NAME,
    autoEnabled: view.autoTrigger.enabled,
    pauseMs: String(view.autoTrigger.pauseMs),
    minChars: String(view.autoTrigger.minChars),
    minEditChars: String(view.autoTrigger.minEditChars),
  };
}

/** 表单是否有未保存修改（决定「有未保存的修改」提示与主按钮高亮）。 */
function isDirty(form: FormState, saved: JevConfigView, savedKeyMode: KeyMode): boolean {
  if (normalizeBaseURL(form.baseURL) !== normalizeBaseURL(saved.baseURL)) return true;
  if (form.model.trim() !== saved.model.trim()) return true;
  if (form.keyMode !== savedKeyMode) return true;
  if (form.keyMode === "direct" && form.apiKeyDraft.trim().length > 0) return true;
  if (form.keyMode === "env" && form.apiKeyEnv.trim() !== (saved.apiKeyEnv ?? DEFAULT_ENV_NAME)) return true;
  if (form.autoEnabled !== saved.autoTrigger.enabled) return true;
  if (parseIntStrict(form.pauseMs) !== saved.autoTrigger.pauseMs) return true;
  if (parseIntStrict(form.minChars) !== saved.autoTrigger.minChars) return true;
  return parseIntStrict(form.minEditChars) !== saved.autoTrigger.minEditChars;
}

/** 宿主 `issues[].field` → 行内字段（宿主字段名见架构 §3.5）。 */
function issueFieldOf(field: string): keyof FieldErrors | undefined {
  if (field.includes("baseURL") || field.includes("base_url")) return "baseURL";
  if (field === "model" || field.endsWith(".model")) return "model";
  if (field.includes("apiKeyEnv")) return "apiKeyEnv";
  if (field.includes("apiKey")) return "apiKey";
  if (field.includes("pauseMs")) return "pauseMs";
  if (field.includes("minChars")) return "minChars";
  if (field.includes("minEdit")) return "minEditChars";
  return undefined;
}

/** 把宿主返回的结构化 issues 落到行内错误（按已知字段；未知字段并入错误条）。 */
function issuesToErrors(issues: JevConfigIssue[] | undefined): FieldErrors {
  const next: FieldErrors = {};
  for (const issue of issues ?? []) {
    const field = issueFieldOf(issue.field);
    if (field !== undefined) next[field] = issue.message;
  }
  return next;
}

/**
 * 测试失败的分类文案（UX §5.8 + 架构 §5.4 的 code → 中文映射）。
 * `envMode` 取自**已保存**配置的密钥来源：环境变量模式下 `no-config`
 * 说明宿主进程没有该变量（宿主错误文案是英文，不能靠它判断）。
 */
function testErrorText(
  code: JevErrorCode,
  model: string,
  envName: string,
  errors: string[],
  envMode: boolean,
): string {
  const joinErrors = (): string => (errors.length > 0 ? shorten(errors[0] as string) : "");
  switch (code) {
    case "auth":
      return "API Key 无效或无权限（401）";
    case "rate-limit":
      return "请求过多，请稍后重试（429）";
    case "overloaded":
      return "服务繁忙，请稍后重试（529）";
    case "timeout":
      return "连接超时";
    case "context-too-long":
      return "内容过长，请精简草稿后重试";
    case "network":
      return "无法连接 Base URL（网络不可达或地址错误）";
    case "empty-capabilities":
      return "当前会话没有可评分的能力";
    case "no-config":
      return envMode || errors.some((item) => item.includes("环境变量"))
        ? `宿主环境变量 ${envName.length > 0 ? envName : DEFAULT_ENV_NAME} 未设置`
        : "尚未配置 Jev 模型（缺少 API Key）";
    default:
      if (errors.some((item) => item.includes("404"))) return `模型 ${model} 不可用（404）`;
      return joinErrors().length > 0 ? `请求参数有误：${joinErrors()}` : "请求参数有误";
  }
}

/** 输入框类名：错误态加红边。 */
function inputClass(invalid: boolean): string {
  return invalid ? "skp-jev-input skp-jev-input-invalid" : "skp-jev-input";
}

/**
 * 配置页本体。
 *
 * `active` 只控制显隐：切换域 Tab 时组件**不卸载**，未保存草稿因此保留
 * （AC-CFG-16）；关闭能力面板后整棵子树卸载，草稿按 UX 丢弃。
 */
export function JevPanel({ api, active }: { api: CapabilityPanelApi; active: boolean }) {
  const [phase, setPhase] = useState<"loading" | "ready" | "load-error">("loading");
  const [loadError, setLoadError] = useState("");
  const [saved, setSaved] = useState<JevConfigView | null>(null);
  /** 已保存配置的密钥来源模式（只在读取/保存成功时更新，避免视图漂移）。 */
  const [savedKeyMode, setSavedKeyMode] = useState<KeyMode>("direct");
  const [form, setForm] = useState<FormState>(defaultForm);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveState, setSaveState] = useState<"idle" | "saving">("idle");
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [savedNotice, setSavedNotice] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetTip, setResetTip] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const apiKeyRef = useRef<HTMLInputElement | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /** 读取配置：失败进 load-error（表单禁用 + 重试）。 */
  const load = useCallback(async () => {
    setPhase("loading");
    setLoadError("");
    try {
      const view = await api.jev.getConfig();
      if (!aliveRef.current) return;
      setSaved(view);
      setSavedKeyMode(view.apiKeySource === "env" ? "env" : "direct");
      setForm(formFromView(view));
      setErrors({});
      setSaveErrors([]);
      setSavedNotice(false);
      setResetTip(false);
      setResetConfirm(false);
      setTest({ kind: "idle" });
      setPhase("ready");
    } catch (error) {
      if (!aliveRef.current) return;
      setLoadError(shorten(messageOf(error)));
      setPhase("load-error");
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const disabled = phase !== "ready" || saveState === "saving";
  const busy = saveState === "saving" || test.kind === "running";
  const dirty = saved !== null && isDirty(form, saved, savedKeyMode);
  const showUnconfigured = phase === "ready" && saved !== null && !saved.hasApiKey;
  /** 直接填写模式下是否已有宿主文件密钥（有则可留空 = 不修改）。 */
  const hasSavedFileKey = saved !== null && saved.apiKeySource === "file" && saved.hasApiKey;
  const savedLast4 = saved?.apiKeyLast4 ?? "****";
  const keyMeta =
    saved === null
      ? undefined
      : saved.apiKeySource === "file"
        ? `已保存 · 尾号 ${savedLast4}（来源：直接填写）`
        : saved.apiKeySource === "env"
          ? `已保存 · 尾号 ${savedLast4}（来源：环境变量 ${form.apiKeyEnv.trim() || DEFAULT_ENV_NAME}）`
          : "未保存密钥";

  /** 任一字段编辑：清掉保存结果 / 行内错误，取消恢复默认的待确认态。 */
  const update = (patch: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setErrors({});
    setSaveErrors([]);
    setSavedNotice(false);
    setResetTip(false);
    setResetConfirm(false);
  };

  /** 本地校验：通过则返回提交给宿主的 config；失败返回行内错误。 */
  const validate = (): { config: JevConfigInput; errors: FieldErrors } => {
    const nextErrors: FieldErrors = {};
    const baseURL = normalizeBaseURL(form.baseURL);
    if (!/^https?:\/\//i.test(baseURL)) {
      nextErrors.baseURL = ERR_BASE_URL;
    } else {
      try {
        new URL(baseURL);
      } catch {
        nextErrors.baseURL = ERR_BASE_URL;
      }
    }

    const model = form.model.trim();
    if (model.length === 0) nextErrors.model = ERR_MODEL_REQUIRED;

    const envName = form.apiKeyEnv.trim();
    if (form.keyMode === "env") {
      if (envName.length === 0) nextErrors.apiKeyEnv = ERR_ENV_REQUIRED;
      else if (!ENV_NAME_PATTERN.test(envName)) nextErrors.apiKeyEnv = ERR_ENV_FORMAT;
    } else if (form.apiKeyDraft.trim().length === 0 && !hasSavedFileKey) {
      nextErrors.apiKey = ERR_KEY_REQUIRED;
    }

    const pause = parseIntStrict(form.pauseMs);
    if (pause === undefined || pause < 300 || pause > 3000 || pause % 100 !== 0) {
      nextErrors.pauseMs = ERR_PAUSE_RANGE;
    }
    const minChars = parseIntStrict(form.minChars);
    if (minChars === undefined || minChars < 1 || minChars > 200) nextErrors.minChars = ERR_MIN_CHARS_RANGE;
    const minEditChars = parseIntStrict(form.minEditChars);
    if (minEditChars === undefined || minEditChars < 1 || minEditChars > 100) {
      nextErrors.minEditChars = ERR_MIN_EDIT_RANGE;
    }

    const config: JevConfigInput = {
      baseURL,
      model,
      autoTrigger: {
        enabled: form.autoEnabled,
        pauseMs: pause ?? DEFAULT_PAUSE_MS,
        minChars: minChars ?? DEFAULT_MIN_CHARS,
        minEditChars: minEditChars ?? DEFAULT_MIN_EDIT_CHARS,
      },
    };
    if (form.keyMode === "env") {
      config.apiKeyEnv = envName;
      // 空串 = 让宿主删除已保存的文件密钥（架构 §3.6）。
      config.apiKey = "";
    } else if (form.apiKeyDraft.trim().length > 0) {
      config.apiKey = form.apiKeyDraft.trim();
    }
    return { config, errors: nextErrors };
  };

  /**
   * 用当前表单值组装「仅本次测试」的 config（不写盘，AC-CFG-10）。
   *
   * 只校验与探针相关的字段（Base URL / 模型 / 密钥来源）；autoTrigger 仅在
   * 三个数字都合法时附带（测试与自动触发无关，非法值不应阻止测试）。
   * timeoutMs 一期没有 UI，不附带（宿主沿用已保存值）。
   */
  const buildTestConfig = (): { config: JevConfigInput } | { error: string } => {
    const baseURL = normalizeBaseURL(form.baseURL);
    if (!/^https?:\/\//i.test(baseURL)) return { error: ERR_BASE_URL };
    try {
      new URL(baseURL);
    } catch {
      return { error: ERR_BASE_URL };
    }
    const model = form.model.trim();
    if (model.length === 0) return { error: ERR_MODEL_REQUIRED };
    const config: JevConfigInput = { baseURL, model };
    if (form.keyMode === "env") {
      const envName = form.apiKeyEnv.trim();
      if (envName.length === 0) return { error: ERR_ENV_REQUIRED };
      if (!ENV_NAME_PATTERN.test(envName)) return { error: ERR_ENV_FORMAT };
      config.apiKeyEnv = envName;
      // 空串 = 本次探针不使用文件 key（宿主按 apiKeyEnv 读进程 env）。
      config.apiKey = "";
    } else if (form.apiKeyDraft.trim().length > 0) {
      config.apiKey = form.apiKeyDraft.trim();
    } else if (!hasSavedFileKey) {
      return { error: ERR_KEY_REQUIRED };
    }
    const pause = parseIntStrict(form.pauseMs);
    const minChars = parseIntStrict(form.minChars);
    const minEditChars = parseIntStrict(form.minEditChars);
    if (
      pause !== undefined &&
      pause >= 300 &&
      pause <= 3000 &&
      pause % 100 === 0 &&
      minChars !== undefined &&
      minChars >= 1 &&
      minChars <= 200 &&
      minEditChars !== undefined &&
      minEditChars >= 1 &&
      minEditChars <= 100
    ) {
      config.autoTrigger = { enabled: form.autoEnabled, pauseMs: pause, minChars, minEditChars };
    }
    return { config };
  };

  const handleSave = async (): Promise<void> => {
    if (phase !== "ready" || busy) return;
    const validation = validate();
    setErrors(validation.errors);
    setSaveErrors([]);
    setSavedNotice(false);
    if (Object.keys(validation.errors).length > 0) return;
    setSaveState("saving");
    try {
      const result = await api.jev.setConfig({ config: validation.config });
      if (!aliveRef.current) return;
      if (!result.ok) {
        setErrors(issuesToErrors(result.issues));
        setSaveErrors(result.errors.length > 0 ? result.errors : ["配置校验未通过"]);
        return;
      }
      // 保存成功：停留在配置 Tab，重新读取以更新掩码 / 来源（AC-CFG-19）。
      setSavedKeyMode(form.keyMode);
      try {
        const view = await api.jev.getConfig();
        if (!aliveRef.current) return;
        setSaved(view);
        setForm((prev) => {
          const next = formFromView(view, prev.keyMode);
          // 宿主视图当前不下发变量名时，保留用户刚填的值（避免显示回默认名）。
          return { ...next, apiKeyEnv: view.apiKeyEnv ?? prev.apiKeyEnv };
        });
      } catch {
        /* 回读失败不覆盖已保存的成功结果：下次打开该 Tab 会重新读取。 */
      }
      setErrors({});
      setSaveErrors([]);
      setSavedNotice(true);
      setTest({ kind: "idle" });
      // F3：写盘已成功（回读失败也不影响事实），通知 composer 侧重新读取配置。
      notifyJevConfigChanged();
    } catch (error) {
      if (!aliveRef.current) return;
      setSaveErrors([shorten(messageOf(error))]);
    } finally {
      if (aliveRef.current) setSaveState("idle");
    }
  };

  const handleTest = async (): Promise<void> => {
    if (phase !== "ready" || busy) return;
    const built = buildTestConfig();
    if ("error" in built) {
      // 表单值本身不合法：不发请求，直接按字段错误给出原因。
      setTest({ kind: "error", text: built.error });
      return;
    }
    setTest({ kind: "running" });
    try {
      // 透传当前表单 config（不写盘）；宿主合并出仅本次探针使用的临时配置。
      const result = await api.jev.test({ config: { config: built.config } });
      if (!aliveRef.current) return;
      if (result.ok) {
        setTest({
          kind: "ok",
          model: result.model.length > 0 ? result.model : form.model.trim(),
          latencyMs: Math.round(result.latencyMs),
        });
      } else {
        setTest({
          kind: "error",
          text: testErrorText(
            result.code,
            form.model.trim(),
            built.config.apiKeyEnv ?? form.apiKeyEnv.trim(),
            result.errors,
            built.config.apiKeyEnv !== undefined,
          ),
        });
      }
    } catch (error) {
      if (!aliveRef.current) return;
      setTest({ kind: "error", text: `无法连接宿主服务：${shorten(messageOf(error))}` });
    }
  };

  /** 恢复默认：两次确认（第一次只进入待确认态，第二次才重置表单，不写配置）。 */
  const handleReset = (): void => {
    if (phase !== "ready" || busy) return;
    if (!resetConfirm) {
      setResetConfirm(true);
      setResetTip(false);
      return;
    }
    setResetConfirm(false);
    setForm(defaultForm());
    setErrors({});
    setSaveErrors([]);
    setSavedNotice(false);
    setResetTip(true);
    setTest({ kind: "idle" });
  };

  return (
    <div className="skp-jev" role="tabpanel" aria-label={COPY.title} style={active ? undefined : { display: "none" }}>
      <div className="skp-jev-inner">
        {showUnconfigured && (
          <div className="skp-jev-top">
            <div className="skp-jev-banner" role="status">
              {COPY.unconfiguredTip}
            </div>
          </div>
        )}

        <div className="skp-jev-card">
          <h3 className="skp-jev-title">{COPY.title}</h3>
          <p className="skp-jev-subtitle">{COPY.subtitle}</p>
          <p className="skp-jev-subtitle skp-jev-subtitle-sub">{COPY.subtitle2}</p>

          {phase === "loading" && <div className="skp-jev-loading">{COPY.loading}</div>}

          {phase === "load-error" && (
            <div className="skp-jev-error-bar" role="alert">
              <span>
                {COPY.loadError}
                {loadError}
              </span>
              <button type="button" className="skp-link-btn" onClick={() => void load()}>
                重试
              </button>
            </div>
          )}

          {/* Base URL */}
          <div className="skp-jev-field">
            <label className="skp-jev-label" htmlFor="skp-jev-baseurl">
              {COPY.baseUrl}
            </label>
            <input
              id="skp-jev-baseurl"
              className={inputClass(errors.baseURL !== undefined)}
              type="text"
              inputMode="url"
              spellCheck={false}
              value={form.baseURL}
              placeholder={DEFAULT_BASE_URL}
              disabled={disabled}
              aria-invalid={errors.baseURL !== undefined}
              aria-describedby="skp-jev-baseurl-desc"
              onChange={(event) => update({ baseURL: event.target.value })}
            />
            {errors.baseURL !== undefined ? (
              <span className="skp-jev-err" id="skp-jev-baseurl-desc" role="alert">
                {errors.baseURL}
              </span>
            ) : (
              <span className="skp-jev-hint" id="skp-jev-baseurl-desc">
                {COPY.baseUrlHint}
              </span>
            )}
          </div>

          {/* 模型名 */}
          <div className="skp-jev-field">
            <label className="skp-jev-label" htmlFor="skp-jev-model">
              {COPY.model}
            </label>
            <input
              id="skp-jev-model"
              className={inputClass(errors.model !== undefined)}
              type="text"
              spellCheck={false}
              value={form.model}
              placeholder={COPY.modelPlaceholder}
              disabled={disabled}
              aria-invalid={errors.model !== undefined}
              aria-describedby="skp-jev-model-desc"
              onChange={(event) => update({ model: event.target.value })}
            />
            {errors.model !== undefined ? (
              <span className="skp-jev-err" id="skp-jev-model-desc" role="alert">
                {errors.model}
              </span>
            ) : (
              <span className="skp-jev-hint" id="skp-jev-model-desc">
                {COPY.modelHint}
              </span>
            )}
          </div>

          {/* API Key 来源（分段控件） */}
          <div className="skp-jev-field">
            <span className="skp-jev-label" id="skp-jev-keymode-label">
              {COPY.keyMode}
            </span>
            <div className="skp-jev-seg" role="radiogroup" aria-labelledby="skp-jev-keymode-label">
              <button
                type="button"
                role="radio"
                aria-checked={form.keyMode === "direct"}
                className={form.keyMode === "direct" ? "skp-jev-seg-btn skp-jev-seg-btn-active" : "skp-jev-seg-btn"}
                disabled={disabled}
                onClick={() => update({ keyMode: "direct", showKey: false, replacingKey: false })}
              >
                {COPY.modeDirect}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={form.keyMode === "env"}
                className={form.keyMode === "env" ? "skp-jev-seg-btn skp-jev-seg-btn-active" : "skp-jev-seg-btn"}
                disabled={disabled}
                onClick={() => update({ keyMode: "env", showKey: false, replacingKey: false })}
              >
                {COPY.modeEnv}
              </button>
            </div>
          </div>

          {form.keyMode === "direct" ? (
            /* FINDING-05：password 输入必须在 form 内（Chrome「Password field is not
               contained in a form」VERBOSE）。这里只包住 API Key 字段本身，提交被阻止，
               不影响其它表单交互。 */
            <form className="skp-jev-field" onSubmit={(event) => event.preventDefault()} noValidate>
              <span className="skp-jev-label-row">
                <label className="skp-jev-label" htmlFor="skp-jev-apikey">
                  {COPY.apiKey}
                </label>
                <button
                  type="button"
                  className="skp-jev-info"
                  title={COPY.keySafety}
                  aria-label="密钥存储说明"
                  aria-describedby="skp-jev-apikey-safety"
                >
                  <span aria-hidden="true">ⓘ</span>
                </button>
                <span className="skp-jev-key-safety" id="skp-jev-apikey-safety">
                  {COPY.keySafety}
                </span>
              </span>
              <div className="skp-jev-input-row">
                <input
                  id="skp-jev-apikey"
                  ref={apiKeyRef}
                  className={inputClass(errors.apiKey !== undefined)}
                  type={form.showKey ? "text" : "password"}
                  autoComplete="new-password"
                  spellCheck={false}
                  value={form.apiKeyDraft}
                  placeholder={hasSavedFileKey && !form.replacingKey ? `已保存 · 尾号 ${savedLast4}` : COPY.apiKeyPlaceholder}
                  disabled={disabled}
                  aria-invalid={errors.apiKey !== undefined}
                  aria-describedby="skp-jev-apikey-desc"
                  onChange={(event) => update({ apiKeyDraft: event.target.value })}
                />
                <button
                  type="button"
                  className="skp-jev-btn-icon"
                  aria-label={form.showKey ? "隐藏 API Key" : "显示 API Key"}
                  disabled={disabled}
                  onClick={() => setForm((prev) => ({ ...prev, showKey: !prev.showKey }))}
                >
                  {form.showKey ? "隐藏" : "显示"}
                </button>
                {hasSavedFileKey && (
                  <button
                    type="button"
                    className="skp-jev-btn-icon"
                    disabled={disabled}
                    onClick={() => {
                      setForm((prev) => ({ ...prev, replacingKey: true, showKey: false }));
                      apiKeyRef.current?.focus();
                    }}
                  >
                    {COPY.changeKey}
                  </button>
                )}
              </div>
              {errors.apiKey !== undefined ? (
                <span className="skp-jev-err" id="skp-jev-apikey-desc" role="alert">
                  {errors.apiKey}
                </span>
              ) : (
                <span className="skp-jev-hint" id="skp-jev-apikey-desc">
                  {COPY.apiKeyHint}
                  {keyMeta !== undefined && <span className="skp-jev-key-meta">{keyMeta}</span>}
                </span>
              )}
            </form>
          ) : (
            <div className="skp-jev-field">
              <label className="skp-jev-label" htmlFor="skp-jev-envname">
                {COPY.envName}
              </label>
              <input
                id="skp-jev-envname"
                className={inputClass(errors.apiKeyEnv !== undefined)}
                type="text"
                spellCheck={false}
                value={form.apiKeyEnv}
                placeholder={DEFAULT_ENV_NAME}
                disabled={disabled}
                aria-invalid={errors.apiKeyEnv !== undefined}
                aria-describedby="skp-jev-envname-desc"
                onChange={(event) => update({ apiKeyEnv: event.target.value })}
              />
              {errors.apiKeyEnv !== undefined ? (
                <span className="skp-jev-err" id="skp-jev-envname-desc" role="alert">
                  {errors.apiKeyEnv}
                </span>
              ) : (
                <span className="skp-jev-hint" id="skp-jev-envname-desc">
                  {COPY.envNameHint}
                  {keyMeta !== undefined && <span className="skp-jev-key-meta">{keyMeta}</span>}
                </span>
              )}
            </div>
          )}

          {/* 能力决策 */}
          <div className="skp-jev-section">
            <h4 className="skp-jev-section-title">{COPY.autoSection}</h4>

            <div className="skp-jev-switch-row">
              <span className="skp-jev-switch-text">
                <span className="skp-jev-label skp-jev-label-strong">{COPY.autoEnable}</span>
                <span className="skp-jev-hint">{COPY.autoEnableHint}</span>
                {form.autoEnabled && saved !== null && !saved.hasApiKey && (
                  <span className="skp-jev-err" role="status">
                    {COPY.autoNoKey}
                  </span>
                )}
              </span>
              <label className="skp-switch" title={COPY.autoEnable}>
                <input
                  type="checkbox"
                  checked={form.autoEnabled}
                  disabled={disabled}
                  aria-label={COPY.autoEnable}
                  onChange={(event) => update({ autoEnabled: event.target.checked })}
                />
                <span className="skp-switch-track" />
              </label>
            </div>

            <div className="skp-jev-field">
              <div className="skp-jev-num-row">
                <label className="skp-jev-label" htmlFor="skp-jev-pause">
                  {COPY.pause}
                </label>
                <input
                  id="skp-jev-pause"
                  className={`${inputClass(errors.pauseMs !== undefined)} skp-jev-num`}
                  type="number"
                  min={300}
                  max={3000}
                  step={100}
                  value={form.pauseMs}
                  disabled={disabled}
                  aria-invalid={errors.pauseMs !== undefined}
                  aria-describedby="skp-jev-pause-desc"
                  onChange={(event) => update({ pauseMs: event.target.value })}
                />
                <span className="skp-jev-unit">ms</span>
              </div>
              {errors.pauseMs !== undefined ? (
                <span className="skp-jev-err" id="skp-jev-pause-desc" role="alert">
                  {errors.pauseMs}
                </span>
              ) : (
                <span className="skp-jev-hint" id="skp-jev-pause-desc">
                  {COPY.pauseHint}
                </span>
              )}
            </div>

            <div className="skp-jev-field">
              <div className="skp-jev-num-row">
                <label className="skp-jev-label" htmlFor="skp-jev-minchars">
                  {COPY.minChars}
                </label>
                <input
                  id="skp-jev-minchars"
                  className={`${inputClass(errors.minChars !== undefined)} skp-jev-num`}
                  type="number"
                  min={1}
                  max={200}
                  step={1}
                  value={form.minChars}
                  disabled={disabled}
                  aria-invalid={errors.minChars !== undefined}
                  aria-describedby="skp-jev-minchars-desc"
                  onChange={(event) => update({ minChars: event.target.value })}
                />
                <span className="skp-jev-unit">字</span>
              </div>
              {errors.minChars !== undefined ? (
                <span className="skp-jev-err" id="skp-jev-minchars-desc" role="alert">
                  {errors.minChars}
                </span>
              ) : (
                <span className="skp-jev-hint" id="skp-jev-minchars-desc">
                  {COPY.minCharsHint}
                </span>
              )}
            </div>

            <div className="skp-jev-field">
              <div className="skp-jev-num-row">
                <label className="skp-jev-label" htmlFor="skp-jev-minedit">
                  {COPY.minEdit}
                </label>
                <input
                  id="skp-jev-minedit"
                  className={`${inputClass(errors.minEditChars !== undefined)} skp-jev-num`}
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={form.minEditChars}
                  disabled={disabled}
                  aria-invalid={errors.minEditChars !== undefined}
                  aria-describedby="skp-jev-minedit-desc"
                  onChange={(event) => update({ minEditChars: event.target.value })}
                />
                <span className="skp-jev-unit">字</span>
              </div>
              {errors.minEditChars !== undefined ? (
                <span className="skp-jev-err" id="skp-jev-minedit-desc" role="alert">
                  {errors.minEditChars}
                </span>
              ) : (
                <span className="skp-jev-hint" id="skp-jev-minedit-desc">
                  {COPY.minEditHint}
                </span>
              )}
            </div>

            <div className="skp-jev-callout">
              <span>
                草稿 ≥ {parseIntStrict(form.minChars) ?? DEFAULT_MIN_CHARS} 字符 · 修改 ≥{" "}
                {parseIntStrict(form.minEditChars) ?? DEFAULT_MIN_EDIT_CHARS} 字符 · 停顿{" "}
                {parseIntStrict(form.pauseMs) ?? DEFAULT_PAUSE_MS}ms
              </span>
              <span>{COPY.cost}</span>
              <span>{COPY.autoPrivacy}</span>
            </div>
          </div>

          {/* 测试连接（使用已保存配置，不落盘不改会话） */}
          <div className="skp-jev-test">
            <div className="skp-jev-test-actions">
              <button type="button" className="skp-btn" onClick={() => void handleTest()} disabled={disabled || test.kind === "running"}>
                {test.kind === "running" ? COPY.testing : COPY.test}
              </button>
              <span className="skp-jev-hint">{COPY.testFormHint}</span>
            </div>
            {test.kind === "running" && <div className="skp-jev-test-running">{COPY.testRunning}</div>}
            {test.kind === "ok" && (
              <div className="skp-jev-test-ok" role="status">
                <span aria-hidden="true">✓</span>
                <span>
                  连接成功 · 模型 {test.model} · 耗时 {test.latencyMs} ms
                </span>
                <span className="skp-jev-hint">{COPY.testFormSuffix}</span>
              </div>
            )}
            {test.kind === "error" && (
              <>
                <div className="skp-jev-test-err" role="alert">
                  <span>连接失败：{test.text}</span>
                  <button type="button" className="skp-link-btn" onClick={() => void handleTest()}>
                    {COPY.retry}
                  </button>
                </div>
                <span className="skp-jev-hint">{COPY.testFormSuffix}</span>
              </>
            )}
          </div>

          {/* 动作区：恢复默认 / 保存（保存成功不关闭、不跳转） */}
          <div className="skp-jev-actions">
            <div className="skp-jev-actions-left">
              {resetConfirm ? (
                <>
                  <button type="button" className="skp-btn" disabled={disabled} onClick={handleReset}>
                    {COPY.resetConfirm}
                  </button>
                  <button type="button" className="skp-link-btn" onClick={() => setResetConfirm(false)}>
                    {COPY.cancel}
                  </button>
                </>
              ) : (
                <button type="button" className="skp-btn" disabled={disabled} onClick={handleReset}>
                  {COPY.reset}
                </button>
              )}
              {resetTip && <span className="skp-jev-hint">{COPY.resetTip}</span>}
              {dirty && !resetTip && <span className="skp-jev-dirty">{COPY.dirty}</span>}
            </div>
            <div className="skp-jev-actions-right">
              {savedNotice && (
                <span className="skp-jev-saved-note" role="status">
                  {COPY.saveOk}
                </span>
              )}
              <span className="skp-jev-actions-note">{COPY.saveScope}</span>
              <button
                type="button"
                className={dirty ? "skp-btn skp-btn-primary" : "skp-btn"}
                disabled={disabled}
                onClick={() => void handleSave()}
              >
                {saveState === "saving" ? COPY.saving : COPY.save}
              </button>
            </div>
          </div>

          {saveErrors.length > 0 && (
            <div className="skp-jev-error-bar" role="alert">
              <span>
                {COPY.saveError}
                {saveErrors.map((item) => shorten(item)).join("；")}
              </span>
              <button type="button" className="skp-link-btn" onClick={() => void handleSave()}>
                {COPY.retry}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
