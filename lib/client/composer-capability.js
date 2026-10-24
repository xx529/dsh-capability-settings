import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * 输入框下方的「本会话能力」配置区（Composer Capability Dock）。
 *
 * 两个入口（在 src/client.ts 注册）：
 * 三个入口（在 src/client.ts 注册）：
 *   - 首屏（hero）：`conversation.input.dock` 里的零高锚点 + `position: fixed`
 *     面板，位置跟随输入卡（[data-composer-card] 的 rect + ResizeObserver），
 *     视觉上落在输入框下方、默认展开；active 相位该组件返回 null。
 *   - 会话中（conversation.view，顶部 Tab「能力」）：整页管理本会话能力；
 *     进入该 Tab 时会临时隐藏输入框（不需要对话输入），切回其它 Tab 恢复。
 *
 * 语义：所有开关只写入**当前会话**（内存态、不落盘），不改项目默认。
 *   - Skills：关闭 = 宿主 agent 作用域注册同名 runtime shadow（只可关闭/恢复，
 *     不能强制开启文件级禁用项）；
 *   - MCP：复用既有会话开关（项目条目挂载/卸载，global/外部实例 restrict）。
 *
 * 组件完全自绘：样式在 styles.ts 的 `skp-dock-*` 类（只用宿主 `--dsw-*` token，
 * 因为 composer 子树拿不到 `.skp-panel` 的 `--skp-*`）。
 *
 * @module @chengdb/capability-panel/client/composer-capability
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceLabel } from "./composer-common.js";
import { JEV_CONFIG_CHANGED_EVENT } from "./jev-panel.js";
import { aggregateMounts, MOUNT_LABEL } from "./mcp-common.js";
// ---------------------------------------------------------------------------
// 图标（内联 SVG，颜色走 currentColor）
// ---------------------------------------------------------------------------
function SparkleIcon({ size = 14 }) {
    return (_jsx("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: _jsx("path", { d: "M8 2l1.5 3.8L13.5 7l-4 1.2L8 12 6.5 8.2 2.5 7l4-1.2L8 2z", stroke: "currentColor", strokeWidth: "1.2", strokeLinejoin: "round" }) }));
}
function ChevronIcon({ up = false, size = 12 }) {
    return (_jsx("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: _jsx("path", { d: up ? "m5 10 3-3 3 3" : "m5 6 3 3 3-3", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round" }) }));
}
function SearchIcon() {
    return (_jsxs("svg", { width: "12", height: "12", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [_jsx("circle", { cx: "7", cy: "7", r: "4.5", stroke: "currentColor", strokeWidth: "1.3" }), _jsx("path", { d: "M10.5 10.5L14 14", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round" })] }));
}
const EMPTY_SNAPSHOT = { skills: [], servers: [], externals: [], mounts: {}, settling: false };
/** 项目来源判定（与 shared/skill-sources 的语义一致，客户端侧保持轻量）。 */
function sourceIsProject(source) {
    return source.startsWith("project-");
}
function skillTag(skill) {
    return sourceIsProject(skill.source) ? "项目" : skill.readOnly ? "全局 · 只读" : "全局";
}
function skillEnabled(skill) {
    return skill.enabledInSession !== false;
}
function defaultMcpEnabled(server) {
    return server.enabled && server.disabledInProject !== true;
}
function mcpEnabled(server) {
    return server.enabledInSession ?? defaultMcpEnabled(server);
}
function externalEnabled(server) {
    const fallback = server.restrictable ? server.disabledInProject !== true : true;
    return server.enabledInSession ?? fallback;
}
// ---------------------------------------------------------------------------
// 数据拉取
// ---------------------------------------------------------------------------
async function fetchSnapshot(api, workspace) {
    // sessionList 需要每会话 api；外壳没把 sessionId 传进来时（例如 conversation.view
    // 的 DOM 兜底也失败）退化为只读的全量列表，开关在 UI 上置灰而不是整块报错。
    const skillsPromise = api.skills.sessionList().catch(async () => {
        const rows = await api.skills.list();
        return rows.map((row) => ({ ...row, enabledInSession: true, canToggleInSession: false }));
    });
    const [skills, mcp, statuses, runtime] = await Promise.all([
        skillsPromise,
        api.mcp.list(),
        api.mcp.status().catch(() => []),
        api.mcp.runtime({ cwd: workspace }).catch(() => ({ servers: [] })),
    ]);
    return {
        skills: skills.filter((skill) => skill.shadowStub !== true),
        servers: mcp.servers,
        externals: runtime.servers,
        mounts: aggregateMounts(statuses),
        settling: statuses.some((status) => status.settling === true),
    };
}
// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
/** 能力区数据：首次加载 + 写后刷新 + MCP settling 静默轮询收敛。 */
function useCapabilitySnapshot(api, workspace, enabled = true) {
    const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(undefined);
    const [version, setVersion] = useState(0);
    const seqRef = useRef(0);
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);
    useEffect(() => {
        if (!enabled) {
            setLoading(false);
            return;
        }
        const seq = ++seqRef.current;
        setLoading(true);
        fetchSnapshot(api, workspace)
            .then((next) => {
            if (!mountedRef.current || seq !== seqRef.current)
                return;
            setSnapshot(next);
            setError(undefined);
        })
            .catch((err) => {
            if (!mountedRef.current || seq !== seqRef.current)
                return;
            setError(String(err instanceof Error ? err.message : err));
        })
            .finally(() => {
            if (!mountedRef.current || seq !== seqRef.current)
                return;
            setLoading(false);
        });
    }, [api, workspace, version, enabled]);
    // MCP 写操作后宿主 fire-and-forget 重挂：settling 为真时静默轮询收敛。
    useEffect(() => {
        if (!snapshot.settling)
            return;
        let cancelled = false;
        let attempts = 0;
        const timer = setInterval(() => {
            if (cancelled)
                return;
            attempts += 1;
            if (attempts > 20) {
                clearInterval(timer);
                return;
            }
            setVersion((value) => value + 1);
        }, 800);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [snapshot.settling]);
    const refresh = useCallback(() => setVersion((value) => value + 1), []);
    return { snapshot, loading, error, setError, refresh };
}
/** 会话相位（hero / active）：只用于 hero 固定面板的挂载判定。 */
function useConversationPhase() {
    const ref = useRef(null);
    const [phase, setPhase] = useState(undefined);
    useEffect(() => {
        const el = ref.current;
        if (el === null)
            return;
        const root = el.closest("[data-phase]");
        const read = () => setPhase(root?.getAttribute("data-phase") ?? undefined);
        read();
        if (root === null)
            return;
        const observer = new MutationObserver(read);
        observer.observe(root, { attributes: true, attributeFilter: ["data-phase"] });
        return () => observer.disconnect();
    }, []);
    return { ref, phase };
}
/** hero 固定面板：跟随输入卡的视口位置（ResizeObserver + 滚动/resize 重算）。 */
function useComposerCardRect(active, hostRef) {
    const [rect, setRect] = useState(undefined);
    useEffect(() => {
        if (!active)
            return;
        const host = hostRef.current;
        const root = host?.closest("[data-phase]");
        if (root === null)
            return;
        let frame = 0;
        const read = () => {
            const card = root.querySelector("[data-composer-card]");
            if (card === null)
                return;
            const box = card.getBoundingClientRect();
            const next = { left: box.left, top: box.bottom + 8, width: box.width };
            setRect((prev) => (prev !== undefined && prev.left === next.left && prev.top === next.top && prev.width === next.width ? prev : next));
        };
        const schedule = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(read);
        };
        read();
        const observer = new ResizeObserver(schedule);
        observer.observe(root);
        const card = root.querySelector("[data-composer-card]");
        if (card !== null)
            observer.observe(card);
        window.addEventListener("resize", schedule);
        document.addEventListener("scroll", schedule, true);
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            window.removeEventListener("resize", schedule);
            document.removeEventListener("scroll", schedule, true);
        };
    }, [active, hostRef]);
    return rect;
}
/** 结果面板阈值默认值与步长（UX §6.5）。 */
const DECISION_DEFAULT_THRESHOLD = 0.5;
const DECISION_THRESHOLD_STEP = 0.05;
const DISABLED_AUTO_PREFS = { enabled: false, pauseMs: 1000, minChars: 10, minEditChars: 4 };
/** 宿主 chip / 附件占位符（与架构 §9.3 REFERENCE_PLACEHOLDER_RE 一致）。 */
const CHIP_PLACEHOLDER_RE = /[\uE100-\uE11D\uFFFC]/gu;
/** 零宽字符（从 contenteditable innerText 里剔除）。 */
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/gu;
/** 草稿清洗：去 chip/附件占位符与零宽字符，再 `trim()`。 */
function cleanDraft(text) {
    return text.replace(CHIP_PLACEHOLDER_RE, "").replace(ZERO_WIDTH_RE, "").trim();
}
/** 按 Unicode 码点计字符数（中文计 1）。 */
function draftLength(text) {
    return Array.from(text).length;
}
/** 编辑量：前后缀对齐后的「删除 + 插入」码点数（架构 §9.4）。 */
function diffAmount(prev, next) {
    const a = Array.from(prev);
    const b = Array.from(next);
    let p = 0;
    while (p < a.length && p < b.length && a[p] === b[p])
        p += 1;
    let s = 0;
    while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s])
        s += 1;
    return a.length - p - s + (b.length - p - s);
}
/** 停顿/倒计时的秒数显示（1 位小数）。 */
function formatSeconds(ms) {
    return (ms / 1000).toFixed(1);
}
/** 取消（abort）不应进入错误态。 */
function isAbortError(error) {
    return error instanceof DOMException ? error.name === "AbortError" : error instanceof Error && error.name === "AbortError";
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
// ---------------------------------------------------------------------------
// Jev 配置：hero 挂载时读取；配置保存事件 / 相位回落 / 窗口 focus 时刷新
//
// 配置页（能力面板「Jev 模型」Tab）与本组件可能同时挂载：用户在配置页保存后
// 首屏 hero 不会重挂，因此必须用事件把「配置已变化」传过来（tester F3）。
// 事件由 jev-panel.tsx 派发（task-24），本组件只消费；刷新静默进行——成功前
// 保留旧配置（不闪 loading、不清空未配置引导），失败也保留旧配置，不打断输入。
// ---------------------------------------------------------------------------
/** window focus 兜底刷新的最小间隔，避免窗口反复聚焦触发密集 getConfig。 */
const JEV_CONFIG_FOCUS_REFRESH_MS = 2000;
function useJevConfig(api) {
    const [state, setState] = useState({ status: "loading" });
    const seqRef = useRef(0);
    const mountedRef = useRef(true);
    const lastLoadAtRef = useRef(0);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);
    /** `silent`：后台刷新——成功前保留旧配置，失败也保留（异常静默）。 */
    const refresh = useCallback((options) => {
        const silent = options?.silent === true;
        lastLoadAtRef.current = Date.now();
        const seq = ++seqRef.current;
        if (!silent)
            setState({ status: "loading" });
        api.jev
            .getConfig()
            .then((view) => {
            if (!mountedRef.current || seq !== seqRef.current)
                return;
            setState({ status: "ready", view });
        })
            .catch((error) => {
            if (!mountedRef.current || seq !== seqRef.current)
                return;
            // 静默刷新失败：保留当前已就绪/已失败状态；只有初始加载仍保持 loading 时才落错误。
            setState((prev) => (silent && prev.status !== "loading" ? prev : { status: "error", message: messageOf(error) }));
        });
    }, [api]);
    const reload = useCallback(() => refresh(), [refresh]);
    const refreshSilently = useCallback(() => refresh({ silent: true }), [refresh]);
    useEffect(() => {
        reload();
    }, [reload]);
    // 配置保存事件 + 窗口 focus 兜底（focus 有最小间隔，不做轮询）。
    useEffect(() => {
        if (typeof window === "undefined")
            return;
        const onConfigChanged = () => refreshSilently();
        const onFocus = () => {
            if (Date.now() - lastLoadAtRef.current < JEV_CONFIG_FOCUS_REFRESH_MS)
                return;
            refreshSilently();
        };
        window.addEventListener(JEV_CONFIG_CHANGED_EVENT, onConfigChanged);
        window.addEventListener("focus", onFocus);
        return () => {
            window.removeEventListener(JEV_CONFIG_CHANGED_EVENT, onConfigChanged);
            window.removeEventListener("focus", onFocus);
        };
    }, [refreshSilently]);
    return { state, reload, refreshSilently };
}
/**
 * DOM 兜底草稿读取（contenteditable 没有 `value`，只能读 innerText）。
 *
 * - `observeDraft=false` 时（槽 props 已给草稿）仍监听 composition，
 *   用于自动触发时的 IME 门槛；
 * - 监听整棵文档的 characterData/childList 变化并按内容去重，避免高频 setState；
 * - 元素找不到时返回 `draft: undefined`（入口据此禁用）。
 */
function useDomDraftReader(anchorRef, observeDraft) {
    const [reading, setReading] = useState({ isComposing: false });
    useEffect(() => {
        if (typeof document === "undefined")
            return;
        const read = () => {
            const anchor = anchorRef.current;
            const root = (anchor?.closest("[data-phase]") ?? document.body);
            const input = root.querySelector("[data-composer-card] [data-composer-input]");
            const next = input === null ? undefined : cleanDraft(input.innerText ?? input.textContent ?? "");
            setReading((prev) => (prev.draft === next ? prev : { ...prev, draft: next }));
        };
        let observer;
        if (observeDraft) {
            read();
            observer = new MutationObserver(read);
            observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        }
        const onStart = () => setReading((prev) => (prev.isComposing ? prev : { ...prev, isComposing: true }));
        const onEnd = () => {
            setReading((prev) => ({ ...prev, isComposing: false }));
            if (observeDraft)
                window.setTimeout(read, 0);
        };
        document.addEventListener("compositionstart", onStart, true);
        document.addEventListener("compositionend", onEnd, true);
        return () => {
            observer?.disconnect();
            document.removeEventListener("compositionstart", onStart, true);
            document.removeEventListener("compositionend", onEnd, true);
        };
    }, [anchorRef, observeDraft]);
    return reading;
}
const CONFIG_ERROR_INFO = {
    code: "config-error",
    title: "读取 Jev 配置失败",
    body: "请稍后重试，或到「Jev 模型」Tab 检查。",
    primary: "retry",
    secondary: "config",
};
/** rank 业务错误码 → UX §6.11 文案。 */
function rankErrorInfo(code, errors) {
    switch (code) {
        case "auth":
            return { code, title: "评分失败：API Key 无效或无权限", body: "请到「Jev 模型」Tab 检查 API Key 或环境变量。", primary: "config", secondary: "cancel" };
        case "no-config":
            return { code, title: "评分失败：尚未配置 Jev 模型", body: "请先完成配置。", primary: "config", secondary: "cancel" };
        case "context-too-long":
            return { code, title: "评分失败：输入内容超出模型上下文上限", body: "请缩短输入框草稿后重试。", primary: "retry", secondary: "cancel" };
        case "timeout":
            return { code, title: "评分失败：请求超时", body: "Jev 服务响应超时，请稍后重试。", primary: "retry", secondary: "cancel" };
        case "network":
            return { code, title: "评分失败：无法连接 Jev 服务", body: "请检查网络后重试；若使用代理，请确认宿主可访问。", primary: "retry", secondary: "cancel" };
        case "rate-limit":
            return { code, title: "评分失败：请求过于频繁", body: "请稍后重试。", primary: "retry", secondary: "cancel" };
        case "overloaded":
            return { code, title: "评分失败：Jev 服务暂时不可用", body: "这是服务端问题，请稍后重试。", primary: "retry", secondary: "cancel" };
        case "empty-capabilities":
            return { code, title: "当前会话没有可评分的技能或 MCP 服务器", body: "切换项目或稍后重试。", primary: "retry", secondary: "cancel" };
        case "bad-request":
        default:
            return { code: code === "bad-request" ? code : "unknown", title: "评分失败：请求无法完成", body: errors[0] ?? "请稍后重试。", primary: "retry", secondary: "cancel" };
    }
}
/** rank item 的不可切换原因（UX §6.8 / 架构 §7.3）。 */
const RANK_REASON_TEXT = {
    "hard-disabled": "该能力已在配置中禁用",
    "not-restrictable": "不可在当前对话关闭",
    "not-toggleable": "当前会话无法切换该能力",
    shadowed: "被同名能力覆盖",
    "no-answer": "未获得评分",
};
/** 预勾选口径：手改优先；否则「可切换且分数 ≥ 阈值」（含等于）。 */
function isCheckedItem(item, manual, threshold) {
    const override = manual[item.id];
    if (override !== undefined)
        return override;
    return item.applicable && item.score >= threshold;
}
/** 当前勾选项（不可切换项永不进入计划）。 */
function checkedItems(state) {
    if (state.data === undefined)
        return [];
    return state.data.items.filter((item) => item.applicable && isCheckedItem(item, state.manual, state.threshold));
}
/**
 * 冷会话排队目标数（宿主 pending 支的 enabled/disabled = 已写入条数，恒为 0）。
 *
 * 用 rank 快照推算「若现在开始对话」会发生什么：勾选且当前关闭 → 将启用；
 * 未勾选且当前开启 → 将关闭（筛选语义）。仅统计 applicable 项。
 */
function plannedApplyCounts(items, selected) {
    const selectedIds = new Set(selected.map((item) => item.id));
    let enabled = 0;
    let disabled = 0;
    for (const item of items) {
        if (!item.applicable)
            continue;
        const isSelected = selectedIds.has(item.id);
        if (isSelected) {
            if (item.enabledInSession !== true)
                enabled += 1;
        }
        else if (item.enabledInSession === true) {
            disabled += 1;
        }
    }
    return { enabled, disabled };
}
/**
 * 应用结果 → toast 文案（筛选语义：启用 X / 关闭 Y；冷会话排队 + 跳过数合并）。
 *
 * - live：宿主返回 `enabled` / `disabled`；旧宿主只有 `applied`（只启用、不关闭），
 *   缺失时 `enabled` 回退 `applied`、`disabled` 回退 0。
 * - pending：新宿主已写入数为 0（排队），若宿主回传的非零计数则优先采用；
 *   否则用 `planned`（rank 快照推算的目标计数），避免出现「启用 0 · 关闭 0」。
 */
function applyToastText(result, skipped, planned) {
    const hostEnabled = typeof result.enabled === "number" && Number.isFinite(result.enabled) ? result.enabled : undefined;
    const hostDisabled = typeof result.disabled === "number" && Number.isFinite(result.disabled) ? result.disabled : undefined;
    let counts;
    if (result.pending) {
        const hostHasCounts = (hostEnabled ?? 0) + (hostDisabled ?? 0) > 0;
        counts = hostHasCounts
            ? { enabled: hostEnabled ?? 0, disabled: hostDisabled ?? 0 }
            : { enabled: planned?.enabled ?? result.applied, disabled: planned?.disabled ?? 0 };
    }
    else {
        counts = { enabled: hostEnabled ?? result.applied, disabled: hostDisabled ?? 0 };
    }
    const skippedSuffix = skipped > 0 ? `；${skipped} 项不可切换已跳过` : "";
    if (result.pending) {
        return `已加入本会话，发送首条消息后生效（启用 ${counts.enabled} · 关闭 ${counts.disabled}）${skippedSuffix}`;
    }
    return `已应用：启用 ${counts.enabled} 项、关闭 ${counts.disabled} 项（仅当前会话）${skippedSuffix}`;
}
/** 排队结果回执（pendingOutcome）的一次性提示文案。 */
function pendingOutcomeText(outcome) {
    const parts = [`上次排队应用：成功 ${outcome.applied} 项`];
    if (outcome.failed > 0)
        parts.push(`失败 ${outcome.failed} 项`);
    if (outcome.errors.length > 0)
        parts.push(outcome.errors[0]);
    return parts.join(" · ");
}
function useDecision(options) {
    const { api, enabled, draft, isComposing, config, reloadConfig, capabilitiesReady, onManage, onRefreshCapabilities, onOptimisticApplied, onClosed } = options;
    const [state, setState] = useState(undefined);
    const [countdown, setCountdown] = useState(undefined);
    const [nowTick, setNowTick] = useState(0);
    const [toast, setToast] = useState(undefined);
    const [liveMessage, setLiveMessage] = useState("");
    const timerRef = useRef(undefined);
    const lastDraftRef = useRef(undefined);
    const editCharsRef = useRef(0);
    const silentDraftRef = useRef(undefined);
    const inFlightRef = useRef(undefined);
    const runIdRef = useRef(0);
    const beginRef = useRef(() => undefined);
    const stateRef = useRef(undefined);
    const prefs = config.status === "ready" ? { ...config.view.autoTrigger } : DISABLED_AUTO_PREFS;
    const configured = config.status === "ready" && config.view.hasApiKey;
    const clearTimer = useCallback(() => {
        if (timerRef.current !== undefined) {
            window.clearTimeout(timerRef.current);
            timerRef.current = undefined;
        }
        setCountdown(undefined);
    }, []);
    const pushToast = useCallback((text, tone = "ok") => setToast({ text, tone }), []);
    useEffect(() => {
        if (toast === undefined)
            return;
        const timer = window.setTimeout(() => setToast(undefined), 4400);
        return () => window.clearTimeout(timer);
    }, [toast]);
    // 倒计时每 100ms 刷新一次（只驱动展示，不进 aria-live）。
    useEffect(() => {
        if (countdown === undefined)
            return;
        setNowTick(Date.now());
        const timer = window.setInterval(() => setNowTick(Date.now()), 100);
        return () => window.clearInterval(timer);
    }, [countdown]);
    useEffect(() => () => {
        if (timerRef.current !== undefined)
            window.clearTimeout(timerRef.current);
        inFlightRef.current?.controller.abort();
    }, []);
    function begin(origin, threshold) {
        const snapshot = draft;
        if (snapshot === undefined || snapshot === "")
            return;
        if (inFlightRef.current !== undefined)
            return;
        const runId = ++runIdRef.current;
        const controller = new AbortController();
        inFlightRef.current = { runId, controller };
        editCharsRef.current = 0;
        setCountdown(undefined);
        setState({ phase: "loading", origin, pauseMs: prefs.pauseMs, threshold, manual: {} });
        if (origin === "auto")
            setLiveMessage("停顿时长已达，已自动发起评分");
        void (async () => {
            try {
                const result = await api.jev.rank({ draft: snapshot }, controller.signal);
                if (runId !== runIdRef.current)
                    return;
                if (!result.ok) {
                    setState({ phase: "error", origin, pauseMs: prefs.pauseMs, threshold, manual: {}, error: rankErrorInfo(result.code, result.errors) });
                    return;
                }
                const items = result.items;
                const checkedCount = items.filter((item) => item.applicable && item.score >= threshold).length;
                setState({
                    phase: "results",
                    origin,
                    pauseMs: prefs.pauseMs,
                    threshold,
                    manual: {},
                    data: {
                        items,
                        model: result.model,
                        total: items.length,
                        ...(result.pendingOutcome !== undefined ? { pendingOutcome: result.pendingOutcome } : {}),
                    },
                });
                setLiveMessage(`评分完成，共 ${items.length} 个能力，已勾选 ${checkedCount} 项`);
            }
            catch (error) {
                if (runId !== runIdRef.current)
                    return;
                if (isAbortError(error))
                    return;
                setState({
                    phase: "error",
                    origin,
                    pauseMs: prefs.pauseMs,
                    threshold,
                    manual: {},
                    error: { code: "network", title: "评分失败：无法连接 Jev 服务", body: "请检查网络后重试；若使用代理，请确认宿主可访问。", primary: "retry", secondary: "cancel" },
                });
            }
            finally {
                if (runId === runIdRef.current)
                    inFlightRef.current = undefined;
            }
        })();
    }
    beginRef.current = begin;
    stateRef.current = state;
    // 草稿变化：累计编辑量、解除静默、重置停顿计时；满足门槛时启动计时。
    // 结果面板打开期间（phase==="results"）允许按新草稿在停顿到点后重新自动评分（UX §7.2）。
    useEffect(() => {
        if (draft === undefined) {
            clearTimer();
            lastDraftRef.current = undefined;
            editCharsRef.current = 0;
            return;
        }
        const previous = lastDraftRef.current;
        // 首次取到草稿（含整段粘贴）也计入编辑量：基线视为空草稿。
        editCharsRef.current += previous === undefined ? draftLength(draft) : diffAmount(previous, draft);
        lastDraftRef.current = draft;
        if (draft === "") {
            editCharsRef.current = 0;
            silentDraftRef.current = undefined;
        }
        else if (silentDraftRef.current !== undefined && silentDraftRef.current !== draft) {
            silentDraftRef.current = undefined;
        }
        clearTimer();
        if (!enabled)
            return;
        const phase = stateRef.current?.phase;
        if (phase !== undefined && phase !== "results")
            return;
        if (!capabilitiesReady)
            return;
        if (!prefs.enabled || !configured)
            return;
        if (draft === "")
            return;
        if (draftLength(draft) < prefs.minChars)
            return;
        if (editCharsRef.current < prefs.minEditChars)
            return;
        if (isComposing)
            return;
        if (inFlightRef.current !== undefined)
            return;
        if (silentDraftRef.current !== undefined)
            return;
        const pauseMs = prefs.pauseMs;
        const startedAt = Date.now();
        setCountdown({ startedAt, pauseMs });
        timerRef.current = window.setTimeout(() => {
            timerRef.current = undefined;
            setCountdown(undefined);
            const current = stateRef.current;
            beginRef.current("auto", current !== undefined && current.phase === "results" ? current.threshold : DECISION_DEFAULT_THRESHOLD);
        }, pauseMs);
        return clearTimer;
    }, [draft, enabled, config.status, capabilitiesReady, isComposing, clearTimer, prefs.enabled, prefs.pauseMs, prefs.minChars, prefs.minEditChars, configured, state?.phase]);
    // hero 结束：停表、作废在途请求、重置编辑基线（首条消息后不再自动触发）。
    useEffect(() => {
        if (enabled)
            return;
        clearTimer();
        if (inFlightRef.current !== undefined) {
            inFlightRef.current.controller.abort();
            inFlightRef.current = undefined;
            runIdRef.current += 1;
        }
        lastDraftRef.current = undefined;
        editCharsRef.current = 0;
        silentDraftRef.current = undefined;
        setState(undefined);
    }, [enabled, clearTimer]);
    function startManual() {
        if (draft === undefined || draft === "")
            return;
        begin("manual", stateRef.current?.threshold ?? DECISION_DEFAULT_THRESHOLD);
    }
    function startConfigError() {
        setState({
            phase: "error",
            origin: "manual",
            pauseMs: prefs.pauseMs,
            threshold: DECISION_DEFAULT_THRESHOLD,
            manual: {},
            error: CONFIG_ERROR_INFO,
        });
    }
    function cancelScoring() {
        const current = stateRef.current;
        if (current?.phase !== "loading")
            return;
        const inFlight = inFlightRef.current;
        if (inFlight !== undefined) {
            inFlight.controller.abort();
            inFlightRef.current = undefined;
        }
        runIdRef.current += 1;
        silentDraftRef.current = draft;
        editCharsRef.current = 0;
        setCountdown(undefined);
        setState(undefined);
        setLiveMessage("已取消本次能力决策");
        // 自动触发路径不把焦点从输入框抢走；手动触发才把焦点还给入口。
        onClosed(current.origin === "manual");
    }
    function close(returnFocus = true) {
        const current = stateRef.current;
        if (current === undefined)
            return;
        if (current.phase === "loading" || current.phase === "applying")
            return;
        setState(undefined);
        onClosed(returnFocus);
    }
    function rescore() {
        const current = stateRef.current;
        if (current === undefined)
            return;
        begin("manual", current.threshold);
    }
    function goConfig() {
        onManage?.("jev");
        setState(undefined);
        onClosed(false);
    }
    function retry() {
        const current = stateRef.current;
        if (current === undefined || current.phase !== "error" || current.error === undefined)
            return;
        if (current.error.code === "config-error") {
            reloadConfig();
            setState(undefined);
            onClosed(false);
            return;
        }
        if (current.error.code === "no-config") {
            goConfig();
            return;
        }
        begin(current.origin, current.threshold);
    }
    function setThreshold(value) {
        const rounded = Math.round(value / DECISION_THRESHOLD_STEP) * DECISION_THRESHOLD_STEP;
        const next = Math.min(1, Math.max(0, Number(rounded.toFixed(2))));
        setState((current) => (current === undefined ? current : { ...current, threshold: next }));
    }
    function toggleItem(id) {
        setState((current) => {
            if (current === undefined || current.data === undefined)
                return current;
            const item = current.data.items.find((candidate) => candidate.id === id);
            if (item === undefined || !item.applicable)
                return current;
            const checked = isCheckedItem(item, current.manual, current.threshold);
            return { ...current, manual: { ...current.manual, [id]: !checked } };
        });
    }
    function apply() {
        const current = stateRef.current;
        if (current === undefined || current.phase !== "results" || current.data === undefined)
            return;
        const selected = checkedItems(current);
        if (selected.length === 0)
            return;
        const plan = selected.map((item) => ({ id: item.id, kind: item.kind, name: item.name, enabled: true }));
        setState({ ...current, phase: "applying", applyError: undefined });
        void (async () => {
            try {
                const result = await api.jev.apply({ plan });
                if (!result.ok) {
                    setState((latest) => (latest === undefined ? latest : { ...latest, phase: "results", applyError: `应用失败：${result.errors[0] ?? result.code}` }));
                    return;
                }
                const failed = result.failed ?? [];
                if (failed.length > 0) {
                    setState((latest) => (latest === undefined ? latest : { ...latest, phase: "results", applyError: `应用失败：${failed[0]?.reason ?? "写入失败"}` }));
                    return;
                }
                // 冷会话排队：宿主此时没有写会话态，先乐观回显 chips（UX §8.6）。
                if (result.pending) {
                    onOptimisticApplied(selected.map((item) => ({ kind: item.kind, name: item.name })));
                }
                onRefreshCapabilities();
                // task-42 后 skipped 也包含「状态已一致」项（reason already-applied），
                // 它们不是「不可切换」，不能计入提示；只统计真正不可应用/未知的跳过。
                const notableSkipped = result.skipped.filter((item) => item.reason !== "already-applied").length;
                const baseText = applyToastText(result, notableSkipped, result.pending && current.data !== undefined ? plannedApplyCounts(current.data.items, selected) : undefined);
                const voidText = result.pendingOutcome === undefined ? baseText : `${baseText} · ${pendingOutcomeText(result.pendingOutcome)}`;
                setState(undefined);
                pushToast(voidText, "ok");
                setLiveMessage(voidText);
                onClosed(true);
            }
            catch (error) {
                if (isAbortError(error))
                    return;
                setState((latest) => (latest === undefined ? latest : { ...latest, phase: "results", applyError: `应用失败：${messageOf(error)}` }));
            }
        })();
    }
    const countdownInfo = countdown === undefined
        ? undefined
        : { elapsedMs: Math.max(0, Math.min(countdown.pauseMs, nowTick - countdown.startedAt)), pauseMs: countdown.pauseMs };
    return {
        state,
        countdown: countdownInfo,
        toast,
        liveMessage,
        start: startManual,
        startConfigError,
        cancelScoring,
        close,
        rescore,
        retry,
        goConfig,
        setThreshold,
        toggleItem,
        apply,
    };
}
// ---------------------------------------------------------------------------
// 「✦ 能力决策」入口与结果面板
// ---------------------------------------------------------------------------
/** 两态入口按钮（展开面板 tabs 行 / 收起能力条右侧，视觉必须一致）。 */
function DecisionEntryButton({ inBar, label, tooltip, disabled, guide, onClick, }) {
    return (_jsxs("button", { type: "button", className: `skp-decision-entry${inBar ? " skp-decision-entry-bar" : ""}`, title: tooltip, "aria-label": "\u6839\u636E\u8F93\u5165\u6846\u8349\u7A3F\u4E3A\u672C\u4F1A\u8BDD\u80FD\u529B\u505A\u80FD\u529B\u51B3\u7B56", "aria-disabled": disabled ? true : undefined, onClick: (event) => {
            // 收起态能力条本身是 role="button"（点击展开），入口不能触发它。
            event.stopPropagation();
            if (disabled)
                return;
            onClick();
        }, children: [_jsx("span", { className: "skp-decision-entry-star", "aria-hidden": "true", children: "\u2726" }), _jsx("span", { className: "skp-decision-entry-label", children: label }), guide && _jsx("i", { className: "skp-decision-entry-dot", "aria-hidden": "true" })] }));
}
/** 评分中骨架（5 行，与结果行同高）。 */
function DecisionSkeleton() {
    return (_jsx("div", { className: "skp-decision-skeleton", "aria-hidden": "true", children: [0, 1, 2, 3, 4].map((index) => (_jsxs("div", { className: "skp-decision-skel-row", children: [_jsx("span", { className: "skp-decision-skel-dot" }), _jsx("span", { className: "skp-decision-skel-line skp-decision-skel-line-a" }), _jsx("span", { className: "skp-decision-skel-line skp-decision-skel-line-b" }), _jsx("span", { className: "skp-decision-skel-line skp-decision-skel-line-c" })] }, index))) }));
}
/**
 * 「✦ 能力决策」结果面板（fixed 容器内替换 hero 内容）。
 *
 * a11y（UX §9）：`role="dialog"` + `aria-modal="false"`（不阻断输入框）、
 * `aria-labelledby` 标题；倒计时不播报；评分完成、应用结果由 hero 的 polite
 * live 节点播报；Esc 只在结果/错误态关闭。
 */
function DecisionPanel(props) {
    const { state, config, draft, estimateTotal, titleRef } = props;
    const loading = state.phase === "loading";
    const applying = state.phase === "applying";
    const errorPhase = state.phase === "error";
    const data = state.data;
    const items = data?.items ?? [];
    const total = data?.total ?? estimateTotal;
    const model = data?.model ?? (config.status === "ready" ? config.view.model : "");
    const selected = checkedItems(state);
    const selectedCount = selected.length;
    const draftCleared = !loading && !errorPhase && !applying && draft === "";
    const noMatch = !loading && !errorPhase && items.length > 0 && items.every((item) => !item.applicable || item.score < state.threshold);
    const pendingOutcome = data?.pendingOutcome;
    const errorInfo = state.error;
    const titleId = "skp-decision-title";
    return (_jsxs("div", { className: "skp-decision-panel", role: "dialog", "aria-modal": false, "aria-labelledby": titleId, onKeyDown: (event) => {
            if (event.key !== "Escape")
                return;
            if (loading || applying)
                return;
            event.preventDefault();
            props.onClose(true);
        }, children: [_jsxs("div", { className: "skp-decision-head", children: [_jsxs("div", { className: "skp-decision-title", id: titleId, ref: titleRef, tabIndex: -1, children: [_jsx("span", { className: "skp-decision-star", "aria-hidden": "true", children: "\u2726" }), "\u80FD\u529B\u51B3\u7B56"] }), model.length > 0 && (_jsxs("span", { className: "skp-decision-badge", title: model, children: ["Jev \u00B7 ", model] })), state.origin === "auto" && (_jsx("span", { className: "skp-decision-badge skp-decision-badge-auto", title: `停顿 ${formatSeconds(state.pauseMs)}s 后自动发起`, children: "\u81EA\u52A8" })), _jsx("button", { type: "button", className: "skp-decision-close", "aria-label": "\u5173\u95ED", title: loading ? "评分中，取消请点「取消评分」" : applying ? "正在应用所选能力" : "关闭", "aria-disabled": loading || applying ? true : undefined, onClick: () => {
                            if (loading || applying)
                                return;
                            props.onClose(true);
                        }, children: "\u00D7" })] }), errorPhase && errorInfo !== undefined ? (_jsxs("div", { className: "skp-decision-error", role: "alert", children: [_jsx("p", { className: "skp-decision-error-title", children: errorInfo.title }), _jsx("p", { className: "skp-decision-error-body", children: errorInfo.body })] })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "skp-decision-threshold", children: [_jsx("span", { className: "skp-decision-threshold-label", children: "\u76F8\u5173\u5EA6\u9608\u503C" }), _jsx("input", { className: "skp-decision-range", type: "range", min: 0, max: 1, step: DECISION_THRESHOLD_STEP, value: state.threshold, "aria-label": "\u76F8\u5173\u5EA6\u9608\u503C", "aria-valuetext": state.threshold.toFixed(2), disabled: loading || applying, onChange: (event) => props.onThreshold(Number(event.target.value)) }), _jsx("span", { className: "skp-decision-threshold-value", children: state.threshold.toFixed(2) }), !loading && _jsxs("span", { className: "skp-decision-count", children: ["\u5DF2\u9009 ", selectedCount, " / ", total] })] }), noMatch && selectedCount === 0 && (_jsxs("p", { className: "skp-decision-nomatch", children: ["\u6CA1\u6709\u8FBE\u5230\u9608\u503C ", state.threshold.toFixed(2), " \u7684\u80FD\u529B\uFF0C\u53EF\u8C03\u4F4E\u9608\u503C\u6216\u624B\u52A8\u52FE\u9009"] }))] })), pendingOutcome !== undefined && _jsx("div", { className: "skp-decision-banner", children: pendingOutcomeText(pendingOutcome) }), loading ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "skp-decision-loading", role: "status", "aria-live": "off", children: [_jsx("span", { className: "skp-decision-spinner", "aria-hidden": "true" }), "\u6B63\u5728\u8BC4\u5206\u2026 \u00B7 1 \u6B21\u8BF7\u6C42 \u00B7 ", total, " \u4E2A\u80FD\u529B"] }), _jsx(DecisionSkeleton, {})] })) : errorPhase ? null : (_jsxs("ul", { className: "skp-decision-list", children: [items.map((item) => {
                        const checked = isCheckedItem(item, state.manual, state.threshold);
                        const unavailable = !item.applicable;
                        const manual = state.manual[item.id] !== undefined;
                        const below = !unavailable && !checked && !manual && item.score < state.threshold;
                        const reasonText = item.reason === undefined ? undefined : RANK_REASON_TEXT[item.reason] ?? item.reason;
                        const reasonId = `skp-decision-reason-${item.id.slice(4)}`;
                        return (_jsxs("li", { className: `skp-decision-row${checked ? " skp-decision-row-selected" : ""}${manual ? " skp-decision-row-manual" : ""}${below ? " skp-decision-row-below" : ""}${unavailable ? " skp-decision-row-unavailable" : ""}`, children: [_jsx("label", { className: "skp-decision-check", children: _jsx("input", { type: "checkbox", checked: checked, disabled: unavailable || applying, "aria-label": `选择 ${item.name}`, "aria-disabled": unavailable ? true : undefined, "aria-describedby": unavailable && reasonText !== undefined ? reasonId : undefined, onChange: () => props.onToggle(item.id) }) }), _jsx("span", { className: `skp-decision-kind skp-decision-kind-${item.kind}`, children: item.kind === "skill" ? "技能" : "MCP" }), _jsx("span", { className: "skp-decision-name", title: item.name, children: item.name }), _jsxs("span", { className: "skp-decision-desc-cell", children: [_jsx("span", { className: "skp-decision-desc", title: item.description, children: item.description.length > 0 ? item.description : "—" }), reasonText !== undefined && (_jsx("span", { className: "skp-decision-reason", id: reasonId, children: reasonText }))] }), _jsx("span", { className: "skp-decision-bar", "aria-hidden": "true", children: _jsx("i", { style: { width: `${Math.round(Math.min(1, Math.max(0, item.score)) * 100)}%` } }) }), _jsx("span", { className: "skp-decision-score", "aria-label": `相关度 ${item.score.toFixed(2)}`, children: item.score.toFixed(2) })] }, item.id));
                    }), items.length === 0 && _jsx("li", { className: "skp-decision-empty", children: "\u6CA1\u6709\u53EF\u8BC4\u5206\u7684\u80FD\u529B" })] })), state.applyError !== undefined && (_jsxs("div", { className: "skp-decision-applyerr", role: "alert", children: [_jsx("span", { className: "skp-decision-applyerr-text", children: state.applyError }), _jsx("button", { type: "button", className: "skp-decision-link", onClick: props.onApply, children: "\u91CD\u8BD5" })] })), _jsx("div", { className: "skp-decision-foot", children: errorPhase ? (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "skp-decision-btn skp-decision-btn-primary", disabled: errorInfo?.primary === "retry" && errorInfo.code !== "config-error" && (draft === undefined || draft === ""), title: errorInfo?.primary === "retry" && errorInfo.code !== "config-error" && (draft === undefined || draft === "") ? "输入框已清空" : undefined, onClick: errorInfo?.primary === "config" ? props.onGoConfig : props.onRetry, children: errorInfo?.primary === "config" ? "去配置" : "重试" }), errorInfo?.secondary === "config" && errorInfo.primary !== "config" && (_jsx("button", { type: "button", className: "skp-decision-btn", onClick: props.onGoConfig, children: "\u53BB\u914D\u7F6E" })), _jsx("button", { type: "button", className: "skp-decision-btn", onClick: () => props.onClose(true), children: "\u53D6\u6D88" })] })) : loading ? (_jsx("button", { type: "button", className: "skp-decision-btn skp-decision-btn-primary", onClick: props.onCancel, children: "\u53D6\u6D88\u8BC4\u5206" })) : (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "skp-decision-btn", disabled: applying || draftCleared || draft === undefined, title: draftCleared || draft === undefined ? "输入框已清空" : undefined, onClick: props.onRescore, children: "\u91CD\u65B0\u8BC4\u5206" }), _jsx("button", { type: "button", className: "skp-decision-btn", disabled: applying, onClick: () => props.onClose(true), children: "\u53D6\u6D88" }), _jsx("button", { type: "button", className: "skp-decision-btn skp-decision-btn-primary", disabled: applying || selectedCount === 0, title: selectedCount === 0 ? "至少勾选一项" : undefined, onClick: props.onApply, children: applying ? "应用中…" : `应用所选（${selectedCount}）` })] })) })] }));
}
// ---------------------------------------------------------------------------
// 视图模型
// ---------------------------------------------------------------------------
export function buildSkillRows(snapshot, pending) {
    // 同名跨根（项目 vs 全局）只保留第一行：磁盘列表按「项目根在前 + 名称排序」
    // 返回，第一行即宿主实际生效的那份；会话 shadow 按名字生效，重复行没有意义。
    const seen = new Set();
    const unique = snapshot.skills.filter((skill) => {
        if (seen.has(skill.name))
            return false;
        seen.add(skill.name);
        return true;
    });
    return unique.map((skill) => {
        const id = `skill:${skill.name}`;
        const canToggle = skill.canToggleInSession !== false;
        return {
            id,
            kind: "skill",
            name: skill.name,
            description: skill.description,
            tag: skillTag(skill),
            enabled: pending[id] ?? skillEnabled(skill),
            disabled: !canToggle,
            ...(canToggle ? {} : { meta: "会话未激活" }),
        };
    });
}
export function buildMcpRows(snapshot, pending) {
    const rows = [];
    const project = snapshot.servers.filter((server) => server.scope === "project");
    // 全局条目只保留全局已启用的（全局已禁用的本项目也无法生效，去能力面板处理）。
    const global = snapshot.servers.filter((server) => server.scope === "global" && server.enabled);
    for (const server of [...project, ...global]) {
        const id = `mcp:${server.scope}:${server.key}`;
        const mounted = snapshot.mounts[server.key];
        const meta = server.scope === "global"
            ? "共享实例"
            : mounted === undefined
                ? "未挂载"
                : mounted.error ?? MOUNT_LABEL[mounted.state];
        rows.push({
            id,
            kind: "mcp",
            name: server.key,
            tag: server.scope === "project" ? "项目" : "全局",
            meta,
            enabled: pending[id] ?? mcpEnabled(server),
            disabled: false,
            dot: server.scope === "global" ? (mcpEnabled(server) ? "mounted" : "none") : (mounted?.state ?? "none"),
            target: server.scope === "project" ? server.key : server.serverName,
            writeKind: server.scope === "project" ? "project" : "server",
            locked: false,
        });
    }
    for (const server of snapshot.externals) {
        const id = `mcp:external:${server.serverName}`;
        rows.push({
            id,
            kind: "mcp",
            name: server.serverName,
            tag: "外部",
            meta: server.restrictable !== true
                ? "不可在当前对话关闭"
                : server.tools.length > 0
                    ? `${server.tools.length} 个工具`
                    : typeof server.source === "string" && server.source.length > 0
                        ? server.source
                        : "外部实例",
            enabled: pending[id] ?? externalEnabled(server),
            disabled: server.restrictable !== true,
            dot: server.restrictable ? "mounted" : "none",
            target: server.serverName,
            writeKind: "server",
            locked: server.restrictable !== true,
        });
    }
    return rows;
}
// ---------------------------------------------------------------------------
// 开关
// ---------------------------------------------------------------------------
function DockSwitch({ checked, disabled, title, onChange }) {
    return (_jsxs("label", { className: "skp-dock-switch", title: title, children: [_jsx("input", { type: "checkbox", checked: checked, disabled: disabled, "aria-label": title, onChange: onChange }), _jsx("span", { className: "skp-dock-switch-track" })] }));
}
function Tag({ label }) {
    const tone = label === "项目" ? "project" : label === "外部" ? "external" : "global";
    return _jsx("span", { className: `skp-dock-tag skp-dock-tag-${tone}`, children: label });
}
// ---------------------------------------------------------------------------
// 卡片 / Tab / 面板
// ---------------------------------------------------------------------------
export function CapabilityCard({ row, busy, onToggle }) {
    return (_jsxs("div", { className: `skp-dock-card${row.enabled ? " skp-dock-card-on" : ""}${row.disabled ? " skp-dock-card-disabled" : ""}`, role: "button", tabIndex: 0, "aria-pressed": row.enabled, title: row.disabled ? "该能力无法在当前会话切换，请到能力面板管理" : row.name, onClick: () => {
            if (!row.disabled && !busy)
                onToggle();
        }, onKeyDown: (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (!row.disabled && !busy)
                    onToggle();
            }
        }, children: [_jsxs("div", { className: "skp-dock-card-head", children: [_jsx("span", { className: "skp-dock-card-icon", children: row.kind === "skill" ? _jsx(SparkleIcon, { size: 13 }) : _jsx(McpIcon, {}) }), _jsx("span", { className: "skp-dock-card-name", children: row.name }), _jsx(DockSwitch, { checked: row.enabled, disabled: row.disabled || busy, title: row.enabled ? "在当前会话关闭（不落盘）" : "在当前会话恢复", onChange: () => {
                            if (!row.disabled && !busy)
                                onToggle();
                        } })] }), _jsx("p", { className: "skp-dock-card-desc", children: row.kind === "skill" ? row.description : row.meta }), _jsxs("div", { className: "skp-dock-card-foot", children: [_jsx(Tag, { label: row.tag }), row.kind === "skill" ? (row.meta !== undefined && _jsx("span", { className: "skp-dock-card-meta", children: row.meta })) : (_jsx("span", { className: `skp-dock-dot skp-dock-dot-${row.dot}`, title: row.meta }))] })] }));
}
function McpIcon() {
    return (_jsxs("svg", { width: "13", height: "13", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [_jsx("path", { d: "M6 3v4a2 2 0 0 0 4 0V3", stroke: "currentColor", strokeWidth: "1.2", strokeLinecap: "round" }), _jsx("path", { d: "M8 9v4", stroke: "currentColor", strokeWidth: "1.2", strokeLinecap: "round" })] }));
}
export function CapabilityPanel(props) {
    const { mode, loading, error, skillRows, mcpRows, pending, busy, onToggle, onReset, onCollapse, onManage, onRefresh, onRetry, initialTab, decisionEntry, decisionHint, decisionWaiting } = props;
    const [tab, setTab] = useState(initialTab ?? "skills");
    const [query, setQuery] = useState("");
    const [resetBusy, setResetBusy] = useState(false);
    const skillsOn = skillRows.filter((row) => row.enabled).length;
    const mcpOn = mcpRows.filter((row) => row.enabled).length;
    const rows = tab === "skills" ? skillRows : mcpRows;
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (q === "")
            return rows;
        return rows.filter((row) => `${row.name} ${row.kind === "skill" ? row.description : row.meta}`.toLowerCase().includes(q));
    }, [rows, query]);
    const totalOn = skillsOn + mcpOn;
    const total = skillRows.length + mcpRows.length;
    return (_jsxs("div", { className: `skp-dock-panel skp-dock-panel-${mode}`, children: [_jsxs("div", { className: "skp-dock-head", children: [_jsx("span", { className: "skp-dock-title-icon", children: _jsx(SparkleIcon, {}) }), _jsx("span", { className: "skp-dock-title", children: "\u672C\u4F1A\u8BDD\u80FD\u529B" }), mode === "view" && _jsx("span", { className: "skp-dock-subtitle", children: "\u5F00\u5173\u53EA\u4F5C\u7528\u4E8E\u5F53\u524D\u4F1A\u8BDD\uFF0C\u4E0D\u4FEE\u6539\u9879\u76EE\u9ED8\u8BA4" }), _jsxs("div", { className: "skp-dock-head-right", children: [_jsxs("label", { className: "skp-dock-search", children: [_jsx("span", { className: "skp-dock-search-icon", children: _jsx(SearchIcon, {}) }), _jsx("input", { type: "search", value: query, placeholder: "\u641C\u7D22\u80FD\u529B", "aria-label": "\u641C\u7D22\u80FD\u529B", onChange: (event) => setQuery(event.target.value) })] }), mode !== "view" && (_jsx("button", { type: "button", className: "skp-dock-icon-btn", title: "\u6536\u8D77", "aria-label": "\u6536\u8D77", onClick: onCollapse, children: _jsx(ChevronIcon, { up: true }) }))] })] }), _jsxs("div", { className: "skp-dock-tab-row", children: [_jsxs("div", { className: "skp-dock-tabs", role: "tablist", children: [_jsxs("button", { type: "button", role: "tab", "aria-selected": tab === "skills", className: `skp-dock-tab${tab === "skills" ? " skp-dock-tab-active" : ""}`, onClick: () => setTab("skills"), children: ["Skills", _jsxs("span", { className: "skp-dock-tab-count", children: [skillsOn, " / ", skillRows.length] })] }), _jsxs("button", { type: "button", role: "tab", "aria-selected": tab === "mcp", className: `skp-dock-tab${tab === "mcp" ? " skp-dock-tab-active" : ""}`, onClick: () => setTab("mcp"), children: ["MCP \u670D\u52A1\u5668", _jsxs("span", { className: "skp-dock-tab-count", children: [mcpOn, " / ", mcpRows.length] })] })] }), _jsx("span", { className: "skp-dock-spacer" }), decisionHint !== undefined && _jsx("span", { className: "skp-decision-hint", children: decisionHint }), decisionEntry, onManage !== undefined && (_jsx("button", { type: "button", className: "skp-dock-link", onClick: onManage, children: "\u7BA1\u7406\u5168\u90E8 \u2197" }))] }), decisionWaiting !== undefined && (_jsxs("div", { className: "skp-decision-countdown", "aria-live": "off", children: ["\u505C\u987F ", formatSeconds(decisionWaiting.elapsedMs), "s / ", formatSeconds(decisionWaiting.pauseMs), "s \u00B7 \u5373\u5C06\u80FD\u529B\u51B3\u7B56"] })), error !== undefined && (_jsxs("div", { className: "skp-dock-banner", role: "alert", children: [_jsx("span", { children: error }), onRetry !== undefined && (_jsx("button", { type: "button", className: "skp-dock-link", onClick: onRetry, children: "\u91CD\u8BD5" }))] })), _jsx("div", { className: "skp-dock-grid", role: "tabpanel", children: loading && filtered.length === 0 ? (_jsx("div", { className: "skp-dock-empty", children: "\u52A0\u8F7D\u4E2D\u2026" })) : filtered.length === 0 ? (_jsxs("div", { className: "skp-dock-empty", children: [query.trim() !== "" ? `没有匹配「${query.trim()}」的能力` : tab === "skills" ? "本会话暂无可配置的 Skills" : "本会话暂无可配置的 MCP 服务器", query.trim() !== "" && (_jsx("button", { type: "button", className: "skp-dock-link", onClick: () => setQuery(""), children: "\u6E05\u7A7A\u641C\u7D22" }))] })) : (filtered.map((row) => _jsx(CapabilityCard, { row: row, busy: busy[row.id] === true, onToggle: () => onToggle(row) }, row.id))) }), _jsxs("div", { className: "skp-dock-foot", children: [_jsxs("span", { className: "skp-dock-foot-note", children: [totalOn, " / ", total, " \u9879\u5DF2\u542F\u7528 \u00B7 \u5F00\u5173\u53EA\u4F5C\u7528\u4E8E\u5F53\u524D\u5BF9\u8BDD"] }), _jsx("button", { type: "button", className: "skp-dock-btn", disabled: resetBusy, onClick: () => {
                            setResetBusy(true);
                            Promise.resolve(onReset()).finally(() => setResetBusy(false));
                        }, children: "\u6062\u590D\u9ED8\u8BA4" }), mode !== "view" && (_jsx("button", { type: "button", className: "skp-dock-btn skp-dock-btn-primary", onClick: onCollapse, children: "\u5B8C\u6210" }))] })] }));
}
// ---------------------------------------------------------------------------
// 收起态能力条
// ---------------------------------------------------------------------------
export function CapabilityBar({ skillRows, mcpRows, loading, onExpand, decisionEntry, }) {
    const mcpEnabled = mcpRows.filter((row) => row.enabled).map((row) => ({ id: row.id, name: row.name, kind: "mcp" }));
    const enabled = [
        ...mcpEnabled.slice(0, 2),
        ...skillRows.filter((row) => row.enabled).map((row) => ({ id: row.id, name: row.name, kind: "skill" })),
        ...mcpEnabled.slice(2),
    ];
    const visible = enabled.slice(0, 5);
    const overflow = enabled.length - visible.length;
    const total = skillRows.length + mcpRows.length;
    return (_jsxs("div", { className: "skp-dock-bar", role: "button", tabIndex: 0, "aria-label": "\u5C55\u5F00\u672C\u4F1A\u8BDD\u80FD\u529B\u914D\u7F6E", onClick: onExpand, onKeyDown: (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onExpand();
            }
        }, children: [_jsx("span", { className: "skp-dock-title-icon", children: _jsx(SparkleIcon, {}) }), _jsx("span", { className: "skp-dock-bar-title", children: "\u672C\u4F1A\u8BDD\u80FD\u529B" }), _jsx("span", { className: "skp-dock-bar-divider" }), loading && enabled.length === 0 ? (_jsx("span", { className: "skp-dock-bar-hint", children: "\u52A0\u8F7D\u4E2D\u2026" })) : visible.length === 0 ? (_jsx("span", { className: "skp-dock-bar-hint", children: "\u672A\u542F\u7528\u4EFB\u4F55\u80FD\u529B" })) : (_jsxs("span", { className: "skp-dock-chips", children: [visible.map((item) => (_jsxs("span", { className: `skp-dock-chip skp-dock-chip-${item.kind}`, children: [_jsx("i", { className: "skp-dock-chip-dot" }), item.name] }, item.id))), overflow > 0 && _jsxs("span", { className: "skp-dock-chip skp-dock-chip-more", children: ["+", overflow] })] })), _jsx("span", { className: "skp-dock-spacer" }), _jsxs("span", { className: "skp-dock-count", children: [enabled.length, " / ", total, " \u542F\u7528"] }), decisionEntry, _jsxs("button", { type: "button", className: "skp-dock-config-btn", onClick: onExpand, children: ["\u914D\u7F6E", _jsx(ChevronIcon, {})] })] }));
}
// ---------------------------------------------------------------------------
// 会话控制器：一次拉取 + 开关/恢复默认（hero / overlay / view 共用）
// ---------------------------------------------------------------------------
function useCapabilityController(api, workspace, enabled = true) {
    const { snapshot, loading, error, setError, refresh } = useCapabilitySnapshot(api, workspace, enabled);
    const [pending, setPending] = useState({});
    const [busy, setBusy] = useState({});
    // 冷会话「能力决策」应用走宿主排队，写入前快照里没有会话态；这里做乐观回显，
    // 让 chips 立即出现（UX §8.6「冷会话 chips 立即回显」）。
    const [optimistic, setOptimistic] = useState({ skills: {}, mcp: {} });
    const skillRows = useMemo(() => buildSkillRows(snapshot, pending).map((row) => {
        if (pending[row.id] !== undefined)
            return row;
        const value = optimistic.skills[row.name];
        return value === undefined ? row : { ...row, enabled: value };
    }), [snapshot, pending, optimistic.skills]);
    const mcpRows = useMemo(() => buildMcpRows(snapshot, pending).map((row) => {
        if (pending[row.id] !== undefined)
            return row;
        const value = optimistic.mcp[row.name];
        return value === undefined ? row : { ...row, enabled: value };
    }), [snapshot, pending, optimistic.mcp]);
    const applyOptimistic = useCallback((items) => {
        setOptimistic((prev) => {
            const skills = { ...prev.skills };
            const mcp = { ...prev.mcp };
            for (const item of items) {
                if (item.kind === "skill") {
                    skills[item.name] = true;
                    continue;
                }
                // rank 的 name 是 serverName；composer 行名对项目条目用的是 key，
                // 因此先按 serverName / key 在快照里解析出行名。
                const server = snapshot.servers.find((candidate) => candidate.serverName === item.name) ?? snapshot.servers.find((candidate) => candidate.key === item.name);
                mcp[server?.key ?? item.name] = true;
            }
            return { skills, mcp };
        });
    }, [snapshot.servers]);
    useEffect(() => {
        setPending({});
    }, [snapshot]);
    const toggle = useCallback(async (row) => {
        const next = !row.enabled;
        setPending((prev) => ({ ...prev, [row.id]: next }));
        setBusy((prev) => ({ ...prev, [row.id]: true }));
        setError(undefined);
        try {
            if (row.kind === "skill") {
                const result = await api.skills.setSessionEnabled({ name: row.name, enabled: next });
                if (!result.ok)
                    throw new Error(result.errors.join("; "));
            }
            else {
                await api.mcp.setSessionEnabled({ target: row.target, kind: row.writeKind, enabled: next });
            }
        }
        catch (err) {
            setPending((prev) => ({ ...prev, [row.id]: !next }));
            setError(String(err instanceof Error ? err.message : err));
        }
        finally {
            setBusy((prev) => {
                const copy = { ...prev };
                delete copy[row.id];
                return copy;
            });
            refresh();
        }
    }, [api, refresh, setError]);
    const reset = useCallback(async () => {
        setError(undefined);
        try {
            const hidden = snapshot.skills.filter((skill) => skill.enabledInSession === false);
            await Promise.all(hidden.map((skill) => api.skills.setSessionEnabled({ name: skill.name, enabled: true })));
            // MCP：逐条清掉显式会话覆盖；restrictable=false 的外部实例无覆盖可清。
            const overrides = [
                ...snapshot.servers.filter((server) => server.enabledInSession !== undefined).map((server) => ({
                    target: server.scope === "project" ? server.key : server.serverName,
                    kind: (server.scope === "project" ? "project" : "server"),
                })),
                ...snapshot.externals
                    .filter((server) => server.enabledInSession !== undefined && server.restrictable === true)
                    .map((server) => ({ target: server.serverName, kind: "server" })),
            ];
            await Promise.all(overrides.map((item) => api.mcp.setSessionEnabled({ target: item.target, kind: item.kind, enabled: undefined })));
        }
        catch (err) {
            setError(String(err instanceof Error ? err.message : err));
        }
        finally {
            refresh();
        }
    }, [api, refresh, setError, snapshot]);
    return { snapshot, loading, error, refresh, skillRows, mcpRows, pending, busy, toggle, reset, applyOptimistic };
}
// ---------------------------------------------------------------------------
// 首屏（hero）：fixed 面板（active 相位返回零高占位）
// ---------------------------------------------------------------------------
export function ComposerCapabilityHero(props) {
    const { api, onManage } = props;
    const slot = props.slotProps;
    if (slot !== undefined && typeof slot.useInput === "function") {
        return _jsx(HeroWithSubscribedDraft, { api: api, onManage: onManage, slotProps: slot, useInput: slot.useInput });
    }
    return _jsx(HeroBody, { api: api, onManage: onManage, slotProps: slot, slotDraft: undefined });
}
/**
 * 槽 standardProps 可用分支：`useInput` 是订阅式 hook，草稿变化即重渲染。
 * 单独成组件是为了避免在 props 形态切换时改变 HeroBody 的 hooks 顺序。
 */
function HeroWithSubscribedDraft({ api, onManage, slotProps, useInput, }) {
    const draft = useInput((state) => (typeof state?.draft === "string" ? state.draft : ""));
    return _jsx(HeroBody, { api: api, onManage: onManage, slotProps: slotProps, slotDraft: draft });
}
function HeroBody({ api, onManage, slotProps, slotDraft, }) {
    const { ref, phase } = useConversationPhase();
    const isHero = phase === "hero";
    const workspace = useWorkspaceLabel(api);
    const controller = useCapabilityController(api, workspace, isHero);
    const rect = useComposerCardRect(isHero, ref);
    const [open, setOpen] = useState(true);
    const contentRef = useRef(null);
    const titleRef = useRef(null);
    // 草稿三级降级：useInput（已订阅）→ input.draft（点时刻）→ DOM 兜底。
    const staticDraft = typeof slotProps?.input?.draft === "string" ? slotProps.input.draft : undefined;
    const dom = useDomDraftReader(ref, slotDraft === undefined && staticDraft === undefined);
    const rawDraft = slotDraft !== undefined ? slotDraft : staticDraft !== undefined ? staticDraft : dom.draft;
    const draft = rawDraft === undefined ? undefined : cleanDraft(rawDraft);
    const jevConfig = useJevConfig(api);
    // 相位兜底：从 active 回到 hero（组件不卸载）时重读一次配置，覆盖外壳未派发
    // 配置事件 / 配置页与本组件不同挂载期的遗漏。首次进入 hero（初始 undefined
    // → "hero"）由挂载时加载覆盖，不重复请求。
    const lastPhaseRef = useRef(undefined);
    useEffect(() => {
        const previous = lastPhaseRef.current;
        lastPhaseRef.current = phase;
        if (previous !== undefined && previous !== "hero" && phase === "hero")
            jevConfig.refreshSilently();
    }, [phase, jevConfig.refreshSilently]);
    const totalCapabilities = controller.skillRows.length + controller.mcpRows.length;
    // 冷会话技能走宿主排队应用（架构 §8.6），不按 canToggleInSession 置灰，
    // 因此这里只把「外部不可 restrict 实例」从可切换集合里排除。
    const switchableCapabilities = controller.skillRows.length + controller.mcpRows.filter((row) => !row.locked).length;
    const returnFocusToEntry = useCallback((returnFocus) => {
        if (!returnFocus)
            return;
        requestAnimationFrame(() => {
            contentRef.current?.querySelector(".skp-decision-entry")?.focus();
        });
    }, []);
    const decision = useDecision({
        api,
        enabled: isHero,
        draft,
        isComposing: dom.isComposing,
        config: jevConfig.state,
        reloadConfig: jevConfig.reload,
        capabilitiesReady: !controller.loading && totalCapabilities > 0 && switchableCapabilities > 0,
        onManage,
        onRefreshCapabilities: controller.refresh,
        onOptimisticApplied: controller.applyOptimistic,
        onClosed: returnFocusToEntry,
    });
    // 手动触发的评分态把焦点移到面板标题（自动触发不移动焦点）。
    const previousPhaseRef = useRef(undefined);
    useEffect(() => {
        const currentPhase = decision.state?.phase;
        const wasInactive = previousPhaseRef.current === undefined;
        previousPhaseRef.current = currentPhase;
        if (!wasInactive || currentPhase === undefined)
            return;
        if (decision.state?.origin !== "manual")
            return;
        requestAnimationFrame(() => titleRef.current?.focus());
    }, [decision.state]);
    const configured = jevConfig.state.status === "ready" && jevConfig.state.view.hasApiKey;
    const autoOff = jevConfig.state.status === "ready" && !jevConfig.state.view.autoTrigger.enabled;
    let entryDisabled = false;
    let entryGuide = jevConfig.state.status === "ready" && !configured;
    let entryLabel = "能力决策";
    let entryTooltip = configured
        ? autoOff
            ? "自动触发默认关闭 · 可在 Jev 模型 Tab 开启"
            : "根据输入框草稿，为技能和 MCP 打分并勾选相关能力（仅当前会话）"
        : "尚未配置 Jev 模型，点击去配置";
    if (decision.state?.phase === "applying") {
        entryDisabled = true;
        entryGuide = false;
        entryLabel = "应用中…";
        entryTooltip = "正在应用所选能力";
    }
    else if (decision.state?.phase === "loading") {
        entryDisabled = true;
        entryGuide = false;
        entryLabel = "评分中…";
        entryTooltip = "正在评分，请稍候";
    }
    else if (jevConfig.state.status === "loading") {
        entryDisabled = true;
        entryGuide = false;
        entryTooltip = "正在读取 Jev 配置…";
    }
    else if (controller.loading) {
        entryDisabled = true;
        entryGuide = false;
        entryTooltip = "正在加载本会话能力…";
    }
    else if (draft === undefined) {
        entryDisabled = true;
        entryGuide = false;
        entryTooltip = "无法读取输入框内容";
    }
    else if (draft === "") {
        entryDisabled = true;
        entryGuide = false;
        entryTooltip = "先在输入框写下你要做的事";
    }
    else if (totalCapabilities === 0) {
        entryDisabled = true;
        entryGuide = false;
        entryTooltip = "当前会话没有可评分的技能或 MCP 服务器";
    }
    else if (switchableCapabilities === 0) {
        entryDisabled = true;
        entryGuide = false;
        entryTooltip = "当前会话没有可切换的能力";
    }
    else if (jevConfig.state.status === "error") {
        entryGuide = false;
        entryTooltip = "读取 Jev 配置失败，点击查看详情";
    }
    const onEntryClick = () => {
        if (entryDisabled)
            return;
        if (jevConfig.state.status === "error") {
            decision.startConfigError();
            return;
        }
        if (jevConfig.state.status !== "ready")
            return;
        if (!jevConfig.state.view.hasApiKey) {
            onManage?.("jev");
            return;
        }
        decision.start();
    };
    const decisionHint = jevConfig.state.status === "ready" && jevConfig.state.view.hasApiKey && autoOff ? "自动触发默认关闭 · 可在 Jev 模型 Tab 开启" : undefined;
    const entryButton = (inBar) => (_jsx(DecisionEntryButton, { inBar: inBar, label: entryLabel, tooltip: entryTooltip, disabled: entryDisabled, guide: entryGuide, onClick: onEntryClick }));
    const countdown = decision.countdown;
    // 零高锚点：input.dock 里的真实 DOM（hero 时负责相位探测 + 定位面板）。
    // 不用 portal：fixed 元素不受祖先 overflow 裁剪，且避免引入 react-dom 类型
    // 依赖（本插件客户端 bundle 只外置 react / react-dom / jsx-runtime，源码
    // 侧没有 @types/react-dom）。
    const placeholder = _jsx("div", { ref: ref, className: "skp-dock-hero-anchor", "aria-hidden": "true" });
    if (!isHero || rect === undefined)
        return placeholder;
    const viewportHeight = typeof window === "undefined" ? 900 : window.innerHeight;
    const maxHeight = Math.max(180, Math.min(360, viewportHeight - rect.top - 24));
    const style = { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, maxHeight: `${maxHeight}px` };
    return (_jsx("div", { ref: ref, className: "skp-dock-hero-anchor", children: _jsxs("div", { ref: contentRef, className: "skp-dock-fixed", style: style, children: [decision.state !== undefined ? (_jsx(DecisionPanel, { state: decision.state, config: jevConfig.state, draft: draft, estimateTotal: totalCapabilities, titleRef: titleRef, onClose: decision.close, onCancel: decision.cancelScoring, onRescore: decision.rescore, onRetry: decision.retry, onGoConfig: decision.goConfig, onThreshold: decision.setThreshold, onToggle: decision.toggleItem, onApply: decision.apply })) : open ? (_jsx(CapabilityPanel, { mode: "hero", loading: controller.loading, error: controller.error, snapshot: controller.snapshot, skillRows: controller.skillRows, mcpRows: controller.mcpRows, pending: controller.pending, busy: controller.busy, onToggle: (row) => void controller.toggle(row), onReset: controller.reset, onRefresh: controller.refresh, onCollapse: () => setOpen(false), ...(onManage !== undefined ? { onManage } : {}), onRetry: controller.refresh, decisionEntry: entryButton(false), ...(decisionHint !== undefined ? { decisionHint } : {}), ...(countdown !== undefined ? { decisionWaiting: countdown } : {}) })) : (_jsxs("div", { className: "skp-decision-bar-wrap", children: [_jsx(CapabilityBar, { skillRows: controller.skillRows, mcpRows: controller.mcpRows, loading: controller.loading, onExpand: () => setOpen(true), decisionEntry: entryButton(true) }), countdown !== undefined && (_jsxs("div", { className: "skp-decision-countdown skp-decision-countdown-bar", "aria-live": "off", children: ["\u505C\u987F ", formatSeconds(countdown.elapsedMs), "s / ", formatSeconds(countdown.pauseMs), "s \u00B7 \u5373\u5C06\u80FD\u529B\u51B3\u7B56"] }))] })), decision.toast !== undefined && (_jsx("div", { className: `skp-decision-toast skp-decision-toast-${decision.toast.tone}`, role: "status", children: decision.toast.text })), _jsx("span", { className: "skp-sr-only", role: "status", "aria-live": "polite", children: decision.liveMessage })] }) }));
}
// ---------------------------------------------------------------------------
// 会话内整页：conversation.view 的「能力」Tab
// ---------------------------------------------------------------------------
export function SessionCapabilityView({ apiFor, sessionId: initialSessionId, onManage, }) {
    const rootRef = useRef(null);
    const [sessionId, setSessionId] = useState(initialSessionId);
    // `conversation.view` 的渲染参数只带 inspectCall/openView 等，没有 sessionId；
    // 这里从外层会话容器（[data-conversation-session]）补读一次，确保 api 绑定到
    // 当前会话（composerApiFor(sessionId)），避免退化成「当前工作区第一项」。
    useEffect(() => {
        if (sessionId !== undefined)
            return;
        const host = rootRef.current?.closest("[data-conversation-session]");
        const value = host?.getAttribute("data-conversation-session");
        if (typeof value === "string" && value !== "")
            setSessionId(value);
    }, [sessionId]);
    // 外壳若复用实例只替换 props，也要跟随切换会话。
    useEffect(() => {
        if (initialSessionId !== undefined)
            setSessionId(initialSessionId);
    }, [initialSessionId]);
    // 「能力」Tab 是管理页，不需要对话输入框：挂载期间给会话容器加类，
    // 由 CSS 隐藏 [data-composer-seat]；切回其它 Tab（组件卸载）即恢复。
    useEffect(() => {
        const host = rootRef.current?.closest("[data-conversation-content]");
        if (!(host instanceof HTMLElement))
            return;
        host.classList.add("skp-cap-view-host");
        return () => {
            host.classList.remove("skp-cap-view-host");
        };
    }, []);
    const api = useMemo(() => apiFor(sessionId), [apiFor, sessionId]);
    const workspace = useWorkspaceLabel(api);
    const controller = useCapabilityController(api, workspace, true);
    return (_jsx("div", { ref: rootRef, className: "skp-cap-view", "data-capability-view-session": sessionId ?? "", children: _jsx("div", { className: "skp-cap-view-inner", children: _jsx(CapabilityPanel, { mode: "view", loading: controller.loading, error: controller.error, snapshot: controller.snapshot, skillRows: controller.skillRows, mcpRows: controller.mcpRows, pending: controller.pending, busy: controller.busy, onToggle: (row) => void controller.toggle(row), onReset: controller.reset, onRefresh: controller.refresh, onCollapse: () => undefined, ...(onManage !== undefined ? { onManage } : {}), onRetry: controller.refresh }) }) }));
}
