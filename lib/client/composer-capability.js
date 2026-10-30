import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * 会话「本会话能力」配置区（首屏入口 + 配置弹窗 + 会话内整页）。
 *
 * 两个入口（在 src/client.ts 注册）：
 *   - 首屏（hero）：`conversation.input.left` 工具行预留位里的 icon+计数入口
 *     （书/插头/工具箱 + ✦ + 滑杆），点击打开居中弹窗（55% 遮罩 + 10px 背景模糊）；
 *     ✦ 仍触发能力决策，结果面板 fixed 落在输入卡下方。active 相位不渲染入口。
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
 * @module dsh-capability-settings/client/composer-capability
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
/**
 * 首屏入口三域图标（扁平单色，随 currentColor）：
 * 书 = Skills、插头 = MCP、工具箱 = Tools（Figma v14 对齐）。
 */
function BookIcon() {
    return (_jsx("svg", { width: "12", height: "12", viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true", children: _jsx("path", { d: "M3 7 11 9v11L3 18ZM21 7 13 9v11l8-2ZM11 9h2", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round", strokeLinejoin: "round" }) }));
}
function PlugIcon() {
    return (_jsx("svg", { width: "12", height: "12", viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true", children: _jsx("path", { d: "M12 22v-5M9 8V2M15 8V2M6 8h12v3l-1.5 2.5L14.5 15 12 15.7 9.5 15 7.5 13.5 6 11Z", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round", strokeLinejoin: "round" }) }));
}
function ToolboxIcon() {
    return (_jsx("svg", { width: "12", height: "12", viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true", children: _jsx("path", { d: "M3 9h18v11H3ZM8 9V5h8v4M3 12.5h18M9 14h6", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round", strokeLinejoin: "round" }) }));
}
/** 入口右侧「配置」：滑杆图标。 */
function SlidersIcon() {
    return (_jsxs("svg", { width: "12", height: "12", viewBox: "0 0 12 12", fill: "none", "aria-hidden": "true", children: [_jsx("path", { d: "M1 2.6h10M1 6h10M1 9.4h10", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round" }), _jsx("circle", { cx: "3.6", cy: "2.6", r: "1.5", fill: "var(--dsw-alias-bg-layer-1,#fff)", stroke: "currentColor", strokeWidth: "1.1" }), _jsx("circle", { cx: "8.2", cy: "6", r: "1.5", fill: "var(--dsw-alias-bg-layer-1,#fff)", stroke: "currentColor", strokeWidth: "1.1" }), _jsx("circle", { cx: "5.4", cy: "9.4", r: "1.5", fill: "var(--dsw-alias-bg-layer-1,#fff)", stroke: "currentColor", strokeWidth: "1.1" })] }));
}
/** 能力决策（填充四角星）。 */
function DecisionStarIcon() {
    return (_jsx("svg", { width: "12", height: "12", viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true", children: _jsx("path", { d: "M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8Z", fill: "currentColor" }) }));
}
function SearchIcon() {
    return (_jsxs("svg", { width: "12", height: "12", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [_jsx("circle", { cx: "7", cy: "7", r: "4.5", stroke: "currentColor", strokeWidth: "1.3" }), _jsx("path", { d: "M10.5 10.5L14 14", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round" })] }));
}
const EMPTY_SNAPSHOT = {
    skills: [],
    servers: [],
    externals: [],
    tools: [],
    attributionSettling: false,
    mounts: {},
    settling: false,
};
/** 项目来源判定（与 shared/skill-sources 的语义一致，客户端侧保持轻量）。 */
function sourceIsProject(source) {
    return source.startsWith("project-");
}
/**
 * 技能卡片的来源标签：
 *   - 注入行按 `origin` 显示 内置 / 插件 / 预设（配色见 tone），渠道名单独成小标签；
 *   - 磁盘行仍是 项目 / 全局（只读兼容根加「只读」后缀）。
 */
function skillTag(skill) {
    if (skill.injected === true) {
        return skill.origin === "bundled" ? "内置" : skill.origin === "preset" ? "预设" : "插件";
    }
    return sourceIsProject(skill.source) ? "项目" : skill.readOnly ? "全局 · 只读" : "全局";
}
/** 技能卡片来源标签的配色。 */
function skillTone(skill) {
    if (skill.injected === true) {
        return skill.origin === "bundled" ? "bundled" : skill.origin === "preset" ? "preset" : "plugin";
    }
    return sourceIsProject(skill.source) ? "project" : "global";
}
function skillEnabled(skill) {
    // 注入行：会话视图的 enabledInSession 已含项目默认；缺失时按项目默认回落。
    if (skill.injected === true && typeof skill.enabledInSession !== "boolean")
        return skill.disabledInProject !== true;
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
    const [skills, mcp, statuses, runtime, toolsView] = await Promise.all([
        skillsPromise,
        api.mcp.list(),
        api.mcp.status().catch(() => []),
        api.mcp.runtime({ cwd: workspace }).catch(() => ({ servers: [] })),
        // v13 Tools 域：宿主/tools 服务缺失时降级为空数组（不阻断另两域，UI 出空态）。
        api.tools.list().catch(() => ({
            units: [],
            totalGlobalTools: 0,
            excludedBuiltinCount: 0,
            errors: [],
            attributionSettling: false,
        })),
    ]);
    return {
        skills: skills.filter((skill) => skill.shadowStub !== true),
        servers: mcp.servers,
        externals: runtime.servers,
        tools: toolsView.units,
        attributionSettling: toolsView.attributionSettling === true,
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
            return { code, title: "当前会话没有可评分的 Skills / MCP / Tools", body: "切换项目或稍后重试。", primary: "retry", secondary: "cancel" };
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
/**
 * 决策结果行的来源小标签（Figma v12-03）：
 * 全局（绿）/ 项目（蓝）/ 内置（琥珀）/ 注入插件（紫，显示渠道名）/
 * 预设渠道（灰，`预设 <channel>`）。
 *
 * 字段全部是宿主 additive：旧宿主没有 `origin` / `channel` 时按 `source`
 * 回落（注入行缺 `source` 时只显示 kind，不猜来源）。
 */
function rankSourceTag(item) {
    // Tools 行名称就是插件名，再挂一枚来源标签会重复（结果行只有 `插件` + `N 个工具`）。
    // origin / channel 仍写进数据供诊断与未来复用。
    if (item.kind === "tool")
        return undefined;
    if (item.origin === "bundled")
        return { label: "内置", tone: "bundled" };
    if (item.origin === "plugin") {
        return { label: item.channel !== undefined && item.channel.length > 0 ? item.channel : "插件注入", tone: "plugin" };
    }
    if (item.origin === "preset") {
        return {
            label: item.channel !== undefined && item.channel.length > 0 ? `预设 ${item.channel}` : "预设渠道",
            tone: "preset",
        };
    }
    if (item.source === "external")
        return { label: "注入", tone: "external" };
    if (item.source === "project")
        return { label: "项目", tone: "project" };
    if (item.source === "global")
        return { label: "全局", tone: "global" };
    return undefined;
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
    const { enabled, disabled } = counts;
    if (result.pending) {
        const detail = enabled === 0 && disabled > 0
            ? `关闭 ${disabled} 项，当前会话未启用任何能力`
            : disabled === 0 && enabled > 0
                ? `启用 ${enabled} 项`
                : `启用 ${enabled} · 关闭 ${disabled}`;
        return `已加入本会话，发送首条消息后生效（${detail}）${skippedSuffix}`;
    }
    if (enabled === 0 && disabled > 0)
        return `已应用：关闭 ${disabled} 项（当前会话未启用任何能力）${skippedSuffix}`;
    if (disabled === 0 && enabled > 0)
        return `已应用：启用 ${enabled} 项（仅当前会话）${skippedSuffix}`;
    return `已应用：启用 ${enabled} 项、关闭 ${disabled} 项（仅当前会话）${skippedSuffix}`;
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
    }, []);
    const pushToast = useCallback((text, tone = "ok") => setToast({ text, tone }), []);
    useEffect(() => {
        if (toast === undefined)
            return;
        const timer = window.setTimeout(() => setToast(undefined), 4400);
        return () => window.clearTimeout(timer);
    }, [toast]);
    // 倒计时不再展示（用户要求去掉等待期文本），也不再有 100ms 刷新的 ticker；
    // 自动触发行为不变，仍由下面的 setTimeout 驱动。
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
                        // 分母 = 宿主实枚举数（含不可应用项）；旧宿主缺字段时回退本次条数。
                        total: typeof result.capabilitiesTotal === "number" && Number.isFinite(result.capabilitiesTotal) ? result.capabilitiesTotal : items.length,
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
        timerRef.current = window.setTimeout(() => {
            timerRef.current = undefined;
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
        // 0 选中是合法筛选结果（= 关闭全部可应用能力）：提交空 plan，由宿主筛选语义处理。
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
    return {
        state,
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
    // FINDING-03：结果列表“可滚”的可见提示（macOS overlay 滚动条默认不可见）。
    // 只在内容真的溢出时显示底部渐隐；滚动/尺寸变化时重算。
    const listRef = useRef(null);
    const [listScrollable, setListScrollable] = useState(false);
    const updateListScrollable = useCallback(() => {
        const element = listRef.current;
        if (element === null)
            return;
        setListScrollable(element.scrollHeight - element.clientHeight > 2);
    }, []);
    useEffect(() => {
        updateListScrollable();
        const element = listRef.current;
        if (element === null || typeof ResizeObserver === "undefined")
            return;
        const observer = new ResizeObserver(updateListScrollable);
        observer.observe(element);
        return () => observer.disconnect();
    }, [updateListScrollable, items.length, loading]);
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
                        }, children: "\u00D7" })] }), errorPhase && errorInfo !== undefined ? (_jsxs("div", { className: "skp-decision-error", role: "alert", children: [_jsx("p", { className: "skp-decision-error-title", children: errorInfo.title }), _jsx("p", { className: "skp-decision-error-body", children: errorInfo.body })] })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "skp-decision-threshold", children: [_jsx("span", { className: "skp-decision-threshold-label", children: "\u76F8\u5173\u5EA6\u9608\u503C" }), _jsx("input", { className: "skp-decision-range", type: "range", min: 0, max: 1, step: DECISION_THRESHOLD_STEP, value: state.threshold, "aria-label": "\u76F8\u5173\u5EA6\u9608\u503C", "aria-valuetext": state.threshold.toFixed(2), disabled: loading || applying, onChange: (event) => props.onThreshold(Number(event.target.value)) }), _jsx("span", { className: "skp-decision-threshold-value", children: state.threshold.toFixed(2) }), !loading && _jsxs("span", { className: "skp-decision-count", children: ["\u5DF2\u9009 ", selectedCount, " / ", total] })] }), noMatch && selectedCount === 0 && (_jsxs("p", { className: "skp-decision-nomatch", children: ["\u6CA1\u6709\u8FBE\u5230\u9608\u503C ", state.threshold.toFixed(2), " \u7684\u80FD\u529B\uFF1B\u53EF\u76F4\u63A5\u5E94\u7528\uFF0C\u5F53\u524D\u4F1A\u8BDD\u5C06\u4E0D\u542F\u7528\u4EFB\u4F55\u80FD\u529B\uFF08\u53EF\u8C03\u4F4E\u9608\u503C\u6216\u624B\u52A8\u52FE\u9009\uFF09"] }))] })), pendingOutcome !== undefined && _jsx("div", { className: "skp-decision-banner", children: pendingOutcomeText(pendingOutcome) }), loading ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "skp-decision-loading", role: "status", "aria-live": "off", children: [_jsx("span", { className: "skp-decision-spinner", "aria-hidden": "true" }), "\u6B63\u5728\u8BC4\u5206\u2026 \u00B7 1 \u6B21\u8BF7\u6C42 \u00B7 ", total, " \u4E2A\u80FD\u529B"] }), _jsx(DecisionSkeleton, {})] })) : errorPhase ? null : (_jsxs("div", { className: "skp-decision-list-wrap", children: [_jsxs("ul", { className: "skp-decision-list", ref: listRef, onScroll: updateListScrollable, children: [items.map((item) => {
                                const checked = isCheckedItem(item, state.manual, state.threshold);
                                const unavailable = !item.applicable;
                                const manual = state.manual[item.id] !== undefined;
                                const below = !unavailable && !checked && !manual && item.score < state.threshold;
                                const reasonText = item.reason === undefined ? undefined : RANK_REASON_TEXT[item.reason] ?? item.reason;
                                const reasonId = `skp-decision-reason-${item.id.slice(4)}`;
                                // 来源小标签（全局 / 项目 / 内置 / 注入插件 / 预设渠道）；旧宿主缺字段时不渲染。
                                const srcTag = rankSourceTag(item);
                                // FINDING-04：Tools 行的工具数已由 `N 个工具` 标签表达，说明列不再重复数量；
                                // 改成帧 08 的口径（说明「插件注入 + 以插件整体计分」）。宿主原文留在 title。
                                const descText = item.kind === "tool" ? "插件注入 · 能力决策以插件整体计分" : item.description;
                                return (_jsxs("li", { className: `skp-decision-row${checked ? " skp-decision-row-selected" : ""}${manual ? " skp-decision-row-manual" : ""}${below ? " skp-decision-row-below" : ""}${unavailable ? " skp-decision-row-unavailable" : ""}`, children: [_jsx("label", { className: "skp-decision-check", children: _jsx("input", { type: "checkbox", checked: checked, disabled: unavailable || applying, "aria-label": `选择 ${item.name}`, "aria-disabled": unavailable ? true : undefined, "aria-describedby": unavailable && reasonText !== undefined ? reasonId : undefined, onChange: () => props.onToggle(item.id) }) }), _jsx("span", { className: `skp-decision-kind skp-decision-kind-${item.kind}`, children: item.kind === "skill" ? "Skills" : item.kind === "mcp" ? "MCP" : "插件" }), _jsxs("span", { className: "skp-decision-name-cell", children: [_jsx("span", { className: "skp-decision-name", title: item.name, children: item.name }), item.kind === "tool" && typeof item.toolCount === "number" && item.toolCount > 0 && (_jsxs("span", { className: "skp-decision-toolcount", title: "\u8BE5\u63D2\u4EF6\u63D0\u4F9B\u7684\u5DE5\u5177\u6570\uFF08\u4EE5\u63D2\u4EF6\u6574\u4F53\u8BA1\u5206/\u542F\u7528\uFF09", children: [item.toolCount, " \u4E2A\u5DE5\u5177"] })), srcTag !== undefined && (_jsx("span", { className: `skp-decision-src skp-decision-src-${srcTag.tone}`, title: "\u80FD\u529B\u6765\u6E90", children: srcTag.label }))] }), _jsxs("span", { className: "skp-decision-desc-cell", children: [_jsx("span", { className: "skp-decision-desc", title: item.description.length > 0 ? item.description : descText, children: descText.length > 0 ? descText : "—" }), reasonText !== undefined && (_jsx("span", { className: "skp-decision-reason", id: reasonId, children: reasonText }))] }), _jsx("span", { className: "skp-decision-bar", "aria-hidden": "true", children: _jsx("i", { style: { width: `${Math.round(Math.min(1, Math.max(0, item.score)) * 100)}%` } }) }), _jsx("span", { className: "skp-decision-score", "aria-label": `相关度 ${item.score.toFixed(2)}`, children: item.score.toFixed(2) })] }, item.id));
                            }), items.length === 0 && _jsx("li", { className: "skp-decision-empty", children: "\u6CA1\u6709\u53EF\u8BC4\u5206\u7684\u80FD\u529B" })] }), listScrollable && _jsx("div", { className: "skp-decision-list-fade", "aria-hidden": "true" })] })), !loading && !errorPhase && items.some((item) => item.kind === "tool") && (_jsx("p", { className: "skp-decision-note", children: "Tools \u4EE5\u63D2\u4EF6\u6574\u4F53\u8BA1\u5206\u4E0E\u542F\u7528\uFF1A\u9009\u4E2D\u5373\u5F00\u542F\u8BE5\u63D2\u4EF6\u5168\u90E8\u5DE5\u5177\uFF1BJev \u53EA\u6536\u7A84\uFF0C\u4E0D\u91CD\u65B0\u6253\u5F00\u5DF2\u5173\u95ED\u7684\u80FD\u529B\u3002" })), state.applyError !== undefined && (_jsxs("div", { className: "skp-decision-applyerr", role: "alert", children: [_jsx("span", { className: "skp-decision-applyerr-text", children: state.applyError }), _jsx("button", { type: "button", className: "skp-decision-link", onClick: props.onApply, children: "\u91CD\u8BD5" })] })), _jsx("div", { className: "skp-decision-foot", children: errorPhase ? (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "skp-decision-btn skp-decision-btn-primary", disabled: errorInfo?.primary === "retry" && errorInfo.code !== "config-error" && (draft === undefined || draft === ""), title: errorInfo?.primary === "retry" && errorInfo.code !== "config-error" && (draft === undefined || draft === "") ? "输入框已清空" : undefined, onClick: errorInfo?.primary === "config" ? props.onGoConfig : props.onRetry, children: errorInfo?.primary === "config" ? "去配置" : "重试" }), errorInfo?.secondary === "config" && errorInfo.primary !== "config" && (_jsx("button", { type: "button", className: "skp-decision-btn", onClick: props.onGoConfig, children: "\u53BB\u914D\u7F6E" })), _jsx("button", { type: "button", className: "skp-decision-btn", onClick: () => props.onClose(true), children: "\u53D6\u6D88" })] })) : loading ? (_jsx("button", { type: "button", className: "skp-decision-btn skp-decision-btn-primary", onClick: props.onCancel, children: "\u53D6\u6D88\u8BC4\u5206" })) : (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "skp-decision-btn", disabled: applying || draftCleared || draft === undefined, title: draftCleared || draft === undefined ? "输入框已清空" : undefined, onClick: props.onRescore, children: "\u91CD\u65B0\u8BC4\u5206" }), _jsx("button", { type: "button", className: "skp-decision-btn", disabled: applying, onClick: () => props.onClose(true), children: "\u53D6\u6D88" }), _jsx("button", { type: "button", className: "skp-decision-btn skp-decision-btn-primary", disabled: applying, onClick: props.onApply, children: applying ? "应用中…" : selectedCount === 0 ? "应用（关闭全部）" : `应用所选（${selectedCount}）` })] })) })] }));
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
            tone: skillTone(skill),
            ...(skill.injected === true ? { injected: true } : {}),
            ...(skill.injected === true && skill.channel !== undefined && skill.channel.length > 0 ? { channel: skill.channel } : {}),
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
            tone: server.scope === "project" ? "project" : "global",
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
        // v13 R4 三态：有插件展示名 → `插件` + channel 第二枚标签；
        // 命名空间合成但无映射 → `未识别`（琥珀）；其余 → `外部注入`。
        const hasChannel = typeof server.channel === "string" && server.channel.length > 0;
        const synthesized = server.synthesized === true || server.origin === "namespace";
        const tag = hasChannel ? "插件" : synthesized ? "未识别" : "外部注入";
        const tone = hasChannel ? "plugin" : synthesized ? "unattributed" : "external";
        const meta = server.restrictable !== true
            ? "不可在当前对话关闭"
            : hasChannel
                ? server.tools.length > 0
                    ? `${server.tools.length} 个工具`
                    : (server.source ?? server.channel)
                : server.tools.length > 0
                    ? synthesized
                        ? `${server.tools.length} 个工具 · 来源未识别`
                        : `${server.tools.length} 个工具`
                    : typeof server.source === "string" && server.source.length > 0
                        ? server.source
                        : "外部实例";
        rows.push({
            id,
            kind: "mcp",
            name: server.serverName,
            tag,
            tone,
            meta,
            enabled: pending[id] ?? externalEnabled(server),
            disabled: server.restrictable !== true,
            dot: server.restrictable ? "mounted" : "none",
            target: server.serverName,
            writeKind: "server",
            locked: server.restrictable !== true,
            ...(hasChannel ? { channel: server.channel } : {}),
            ...(synthesized ? { synthesized: true } : {}),
        });
    }
    return rows;
}
/**
 * Tools 域行（v13 R3）：一个插件 = 一行；来源未识别合并成一个单元排最后。
 * `pending` 覆盖会话态（乐观回显 / 批量执行中）。
 */
export function buildToolRows(snapshot, pending) {
    const rows = snapshot.tools.map((unit) => {
        const id = `tool:${unit.unit}`;
        const unattributed = unit.kind === "unattributed";
        const locked = unit.lockedReason !== undefined;
        const toolCount = unit.toolCount;
        const defaultEnabled = unit.defaultEnabled ?? unit.enabledInSession ?? true;
        return {
            id,
            kind: "tool",
            name: unit.name,
            tag: unattributed ? "未识别" : "插件",
            tone: (unattributed ? "unattributed" : "plugin"),
            description: `${toolCount} 个工具 · ${unattributed ? "来源未识别" : "插件注入"}`,
            meta: `${toolCount} 个工具`,
            // 首屏 = 本会话生效值（会话覆盖 ?? 全局默认）。adapter 已归一；旧宿主/夹具
            // 缺新字段时按旧 `enabledInSession` 再按默认开启回落。
            enabled: pending[id] ?? unit.enabled ?? unit.enabledInSession ?? unit.defaultEnabled ?? true,
            disabled: locked,
            unit: unit.unit,
            explicit: unit.explicit === true,
            defaultEnabled,
            ...(locked ? { lockedReason: unit.lockedReason } : {}),
        };
    });
    // 已识别插件按展示名排序，来源未识别恒排最后（UX v1.8 §5.4）。
    return rows.sort((a, b) => {
        const aUn = a.tone === "unattributed" ? 1 : 0;
        const bUn = b.tone === "unattributed" ? 1 : 0;
        if (aUn !== bUn)
            return aUn - bUn;
        return a.name.localeCompare(b.name);
    });
}
// ---------------------------------------------------------------------------
// 开关
// ---------------------------------------------------------------------------
/**
 * 卡片内的整插件 / 单条开关。
 *
 * **必须阻断冒泡**（FINDING-01）：卡片外层也可点（`onClick` = 切换），若不阻断，
 * 点一次开关会同时触发 input 的 `onChange` 与卡片的 `onClick`，发出两条相同 RPC。
 * label 上的 onClick/onKeyDown 覆盖「点轨道」「键盘 Space」两种激活路径。
 */
function DockSwitch({ checked, disabled, title, onChange }) {
    return (_jsxs("label", { className: "skp-dock-switch", title: title, onClick: (event) => event.stopPropagation(), onKeyDown: (event) => event.stopPropagation(), children: [_jsx("input", { type: "checkbox", checked: checked, disabled: disabled, "aria-label": title, onChange: onChange }), _jsx("span", { className: "skp-dock-switch-track" })] }));
}
/** 事件目标是否落在卡片内的开关上（FINDING-01 的兜底短路，兼容键盘触发）。 */
function isSwitchEventTarget(target) {
    const element = target;
    return typeof element?.closest === "function" && element.closest(".skp-dock-switch") !== null;
}
function Tag({ label, tone }) {
    return _jsx("span", { className: `skp-dock-tag skp-dock-tag-${tone}`, children: label });
}
// ---------------------------------------------------------------------------
// 卡片 / Tab / 面板
// ---------------------------------------------------------------------------
export function CapabilityCard({ row, busy, onToggle }) {
    const desc = row.kind === "skill" ? row.description : row.kind === "tool" ? row.description : row.meta;
    const title = row.kind === "tool"
        ? row.disabled
            ? (row.lockedReason ?? "该插件无法在当前会话切换")
            : row.enabled
                ? "关闭：本会话关闭此插件全部工具（全局默认不变）"
                : "开启：本会话启用（覆盖全局默认）"
        : row.disabled
            ? "该能力无法在当前会话切换，请到能力面板管理"
            : row.name;
    return (_jsxs("div", { className: `skp-dock-card${row.enabled ? " skp-dock-card-on" : ""}${row.disabled ? " skp-dock-card-disabled" : ""}`, role: "button", tabIndex: 0, "aria-pressed": row.enabled, title: title, onClick: (event) => {
            // 开关自己处理激活（见 DockSwitch）：卡片不再重复触发，保证一次点击一条 RPC。
            if (isSwitchEventTarget(event.target))
                return;
            if (!row.disabled && !busy)
                onToggle();
        }, onKeyDown: (event) => {
            if (isSwitchEventTarget(event.target))
                return;
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (!row.disabled && !busy)
                    onToggle();
            }
        }, children: [_jsxs("div", { className: "skp-dock-card-head", children: [_jsx("span", { className: "skp-dock-card-icon", children: row.kind === "skill" ? _jsx(SparkleIcon, { size: 13 }) : row.kind === "tool" ? _jsx(ToolIcon, {}) : _jsx(McpIcon, {}) }), _jsx("span", { className: "skp-dock-card-name", children: row.name }), _jsx(DockSwitch, { checked: row.enabled, disabled: row.disabled || busy, title: row.enabled ? "在当前会话关闭（不落盘）" : "在当前会话恢复", onChange: () => {
                            if (!row.disabled && !busy)
                                onToggle();
                        } })] }), _jsx("p", { className: "skp-dock-card-desc", children: desc }), _jsxs("div", { className: "skp-dock-card-foot", children: [_jsx(Tag, { label: row.tag, tone: row.tone }), row.kind === "tool" && row.explicit && (_jsx("span", { className: "skp-dock-tag skp-dock-tag-override", title: `全局默认${row.defaultEnabled ? "开启" : "关闭"}；本会话单独设置`, children: "\u672C\u4F1A\u8BDD\u8986\u76D6" })), row.kind === "skill" && row.channel !== undefined && (_jsx("span", { className: "skp-dock-tag-channel", title: `${row.channel} · 注入方 / 渠道名（内容只读，开关只作用于当前会话）`, children: row.channel })), row.kind === "mcp" && row.channel !== undefined && (_jsx("span", { className: "skp-dock-tag-channel", title: `${row.channel} · 插件来源（命名空间 / 注入方归一后的展示名）`, children: row.channel })), row.kind === "skill" ? (row.meta !== undefined && _jsx("span", { className: "skp-dock-card-meta", children: row.meta })) : row.kind === "mcp" ? (_jsx("span", { className: `skp-dock-dot skp-dock-dot-${row.dot}`, title: row.meta })) : null] })] }));
}
function McpIcon() {
    return (_jsxs("svg", { width: "13", height: "13", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [_jsx("path", { d: "M6 3v4a2 2 0 0 0 4 0V3", stroke: "currentColor", strokeWidth: "1.2", strokeLinecap: "round" }), _jsx("path", { d: "M8 9v4", stroke: "currentColor", strokeWidth: "1.2", strokeLinecap: "round" })] }));
}
/** Tools 域卡片的图标（插件单元；与 skill / MCP 区分）。 */
function ToolIcon() {
    return (_jsx("svg", { width: "13", height: "13", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: _jsx("path", { d: "M9.5 2.5a3.2 3.2 0 0 0-4.2 4.2L2.6 9.4a1.4 1.4 0 0 0 2 2l2.7-2.7a3.2 3.2 0 0 0 4.2-4.2l-2 2-1.4-1.4 2-2z", stroke: "currentColor", strokeWidth: "1.2", strokeLinejoin: "round" }) }));
}
/** 批量动作的三域执行顺序（与宿主 §6.2-6 一致：skills → mcp → tools）。 */
const BULK_DOMAINS = ["skills", "mcp", "tools"];
const IDLE_BULK = { phase: "idle", doneDomains: 0, totalDomains: BULK_DOMAINS.length, failed: [], failedDomains: [] };
export function CapabilityPanel(props) {
    const { mode, loading, error, skillRows, mcpRows, toolRows, pending, busy, onToggle, onReset, onCollapse, onManage, onRefresh, onRetry, onBulk, onRetryBulk, bulkState, initialTab, } = props;
    const [tab, setTab] = useState(initialTab ?? "skills");
    const [query, setQuery] = useState("");
    const [resetBusy, setResetBusy] = useState(false);
    const skillsOn = skillRows.filter((row) => row.enabled).length;
    const mcpOn = mcpRows.filter((row) => row.enabled).length;
    const toolsOn = toolRows.filter((row) => row.enabled).length;
    // 已启用的注入技能数（来源为插件 / DSH 内置 / Agent 预设），用于底栏统计文案。
    const injectedOn = skillRows.filter((row) => row.injected === true && row.enabled).length;
    const rows = tab === "skills" ? skillRows : tab === "mcp" ? mcpRows : toolRows;
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (q === "")
            return rows;
        return rows.filter((row) => {
            const text = `${row.name} ${row.kind === "skill" ? row.description : row.kind === "tool" ? row.description : row.meta}`;
            return text.toLowerCase().includes(q);
        });
    }, [rows, query]);
    // 计数口径（UX v1.8 §3.5）：三域已启用数相加 / 三域单元数相加；Tools 按插件计。
    const totalOn = skillsOn + mcpOn + toolsOn;
    const total = skillRows.length + mcpRows.length + toolRows.length;
    // 可开关单元（锁定/不可切换的行不参与批量目标态判定）。
    const switchableRows = [...skillRows, ...mcpRows, ...toolRows].filter((row) => !row.disabled);
    const canEnable = switchableRows.some((row) => !row.enabled);
    const canDisable = switchableRows.some((row) => row.enabled);
    const bulkRunning = bulkState.phase === "running";
    const bulkAction = bulkState.action;
    const bulkError = bulkState.error;
    const bulkFailed = bulkState.failed.length;
    const actionLabel = (action, running) => {
        if (running && bulkAction === action)
            return action === "enable" ? "全部开启中…" : "全部关闭中…";
        // idle/partial 态下若上次动作是另一方向，按钮恢复常态文案。
        return action === "enable" ? "全部开启" : "全部关闭";
    };
    const progressText = bulkRunning && bulkAction !== undefined
        ? `${bulkAction === "enable" ? "正在开启" : bulkAction === "disable" ? "正在关闭" : "正在恢复"} ${bulkState.doneDomains} / ${bulkState.totalDomains} 个域…`
        : undefined;
    return (_jsxs("div", { className: `skp-dock-panel skp-dock-panel-${mode}`, children: [_jsxs("div", { className: "skp-dock-head", children: [_jsx("span", { className: "skp-dock-title-icon", children: _jsx(SparkleIcon, {}) }), _jsx("span", { className: "skp-dock-title", children: "\u672C\u4F1A\u8BDD\u80FD\u529B" }), mode === "modal" && _jsx("span", { className: "skp-dock-scope", children: "\u4EC5\u5F53\u524D\u4F1A\u8BDD" }), (mode === "view" || mode === "modal") && (_jsx("span", { className: "skp-dock-subtitle", children: mode === "modal" ? "开关只作用于当前对话 · 不改项目默认" : "开关只作用于当前会话，不修改项目默认" })), _jsxs("div", { className: "skp-dock-head-right", children: [_jsxs("label", { className: "skp-dock-search", children: [_jsx("span", { className: "skp-dock-search-icon", children: _jsx(SearchIcon, {}) }), _jsx("input", { type: "search", value: query, placeholder: "\u641C\u7D22\u80FD\u529B", "aria-label": "\u641C\u7D22\u80FD\u529B", onChange: (event) => setQuery(event.target.value) })] }), mode === "modal" ? (_jsx("button", { type: "button", className: "skp-dock-modal-close", title: "\u5173\u95ED", "aria-label": "\u5173\u95ED", onClick: onCollapse, children: "\u2715" })) : (mode !== "view" && (_jsx("button", { type: "button", className: "skp-dock-icon-btn", title: "\u6536\u8D77", "aria-label": "\u6536\u8D77", onClick: onCollapse, children: _jsx(ChevronIcon, { up: true }) })))] })] }), _jsxs("div", { className: "skp-dock-tab-row", children: [_jsxs("div", { className: "skp-dock-tabs", role: "tablist", children: [_jsxs("button", { type: "button", role: "tab", "aria-selected": tab === "skills", className: `skp-dock-tab${tab === "skills" ? " skp-dock-tab-active" : ""}`, onClick: () => setTab("skills"), children: ["Skills", _jsxs("span", { className: "skp-dock-tab-count", children: [skillsOn, " / ", skillRows.length] })] }), _jsxs("button", { type: "button", role: "tab", "aria-selected": tab === "mcp", className: `skp-dock-tab${tab === "mcp" ? " skp-dock-tab-active" : ""}`, onClick: () => setTab("mcp"), children: ["MCP", _jsxs("span", { className: "skp-dock-tab-count", children: [mcpOn, " / ", mcpRows.length] })] }), _jsxs("button", { type: "button", role: "tab", "aria-selected": tab === "tools", className: `skp-dock-tab${tab === "tools" ? " skp-dock-tab-active" : ""}`, onClick: () => setTab("tools"), children: ["Tools", _jsxs("span", { className: "skp-dock-tab-count", children: [toolsOn, " / ", toolRows.length] })] })] }), _jsx("span", { className: "skp-dock-spacer" }), onManage !== undefined && (_jsx("button", { type: "button", className: "skp-dock-link", onClick: onManage, children: "\u7BA1\u7406\u5168\u90E8 \u2197" }))] }), _jsxs("div", { className: "skp-dock-rail", role: "group", "aria-label": "\u672C\u4F1A\u8BDD\u5168\u5C40\u5F00\u5173", children: [_jsx("button", { type: "button", className: "skp-dock-rail-btn skp-dock-rail-btn-primary", "aria-disabled": bulkRunning || !canEnable ? true : undefined, disabled: bulkRunning || !canEnable, title: bulkRunning ? "批量执行中" : !canEnable ? "已全部开启" : "作用于本会话的 Skills · MCP · Tools 三域整体", onClick: () => onBulk("enable"), children: actionLabel("enable", bulkRunning) }), _jsx("button", { type: "button", className: "skp-dock-rail-btn", "aria-disabled": bulkRunning || !canDisable ? true : undefined, disabled: bulkRunning || !canDisable, title: bulkRunning ? "批量执行中" : !canDisable ? "已全部关闭" : "作用于本会话的 Skills · MCP · Tools 三域整体", onClick: () => onBulk("disable"), children: actionLabel("disable", bulkRunning) }), _jsxs("span", { className: "skp-dock-rail-count", children: ["\u5DF2\u542F\u7528 ", totalOn, " / ", total] }), _jsx("span", { className: "skp-dock-rail-note", children: "\u4EC5\u5F53\u524D\u4F1A\u8BDD \u00B7 \u4E0D\u6539\u9879\u76EE\u9ED8\u8BA4" }), progressText !== undefined && _jsx("span", { className: "skp-dock-rail-progress", children: progressText }), !bulkRunning && bulkFailed > 0 && (_jsxs("button", { type: "button", className: "skp-dock-rail-fail", title: "\u53EA\u91CD\u653E\u5931\u8D25\u57DF", onClick: onRetryBulk, children: [bulkFailed, " \u9879\u5931\u8D25 \u00B7 \u91CD\u8BD5"] })), !bulkRunning && bulkError !== undefined && _jsx("span", { className: "skp-dock-rail-fail", children: bulkError })] }), error !== undefined && (_jsxs("div", { className: "skp-dock-banner", role: "alert", children: [_jsx("span", { children: error }), onRetry !== undefined && (_jsx("button", { type: "button", className: "skp-dock-link", onClick: onRetry, children: "\u91CD\u8BD5" }))] })), _jsxs("div", { className: "skp-dock-grid", role: "tabpanel", children: [tab === "tools" && props.snapshot.attributionSettling && (_jsx("div", { className: "skp-dock-grid-note", children: "\u6765\u6E90\u89E3\u6790\u4E2D\u2026" })), loading && filtered.length === 0 ? (_jsx("div", { className: "skp-dock-empty", children: "\u52A0\u8F7D\u4E2D\u2026" })) : filtered.length === 0 ? (_jsxs("div", { className: "skp-dock-empty", children: [query.trim() !== ""
                                ? `没有匹配「${query.trim()}」的能力`
                                : tab === "skills"
                                    ? "本会话暂无可配置的 Skills"
                                    : tab === "mcp"
                                        ? "本会话暂无可配置的 MCP"
                                        : "本会话暂无可配置的 Tools", query.trim() !== "" && (_jsx("button", { type: "button", className: "skp-dock-link", onClick: () => setQuery(""), children: "\u6E05\u7A7A\u641C\u7D22" }))] })) : (filtered.map((row) => (_jsx(CapabilityCard, { row: row, busy: bulkRunning || busy[row.id] === true, onToggle: () => onToggle(row) }, row.id))))] }), _jsxs("div", { className: "skp-dock-foot", children: [_jsxs("span", { className: "skp-dock-foot-note", children: [totalOn, " / ", total, " \u9879\u5DF2\u542F\u7528", injectedOn > 0 ? ` · 其中 ${injectedOn} 项来自插件 / DSH 内置 / Agent 预设` : "", " \u00B7 \u5F00\u5173\u53EA\u4F5C\u7528\u4E8E\u5F53\u524D\u5BF9\u8BDD"] }), _jsx("button", { type: "button", className: "skp-dock-btn", disabled: resetBusy || bulkRunning, title: "\u6E05\u9664\u672C\u4F1A\u8BDD\u7684\u663E\u5F0F\u5F00\u5173\uFF0C\u6062\u590D\u9ED8\u8BA4\uFF08Skills / MCP / Tools \u4E09\u57DF\uFF1BTools \u56DE\u843D\u5230\u5168\u5C40\u9ED8\u8BA4\uFF09", onClick: () => {
                            setResetBusy(true);
                            Promise.resolve(onReset()).finally(() => setResetBusy(false));
                        }, children: "\u6062\u590D\u9ED8\u8BA4" }), mode !== "view" && (_jsx("button", { type: "button", className: "skp-dock-btn skp-dock-btn-primary", onClick: onCollapse, children: "\u5B8C\u6210" }))] })] }));
}
// ---------------------------------------------------------------------------
// 会话控制器：一次拉取 + 开关/恢复默认（hero / overlay / view 共用）
// ---------------------------------------------------------------------------
function useCapabilityController(api, workspace, enabled = true) {
    const { snapshot, loading, error, setError, refresh } = useCapabilitySnapshot(api, workspace, enabled);
    const [pending, setPending] = useState({});
    const [busy, setBusy] = useState({});
    // 冷会话「能力决策」应用走宿主排队，写入前快照里没有会话态；这里做乐观回显，
    // 让 chips 立即出现（UX §8.6「冷会话 chips 立即回显」）。Tools 按单元 id 记。
    const [optimistic, setOptimistic] = useState({ skills: {}, mcp: {}, tools: {} });
    const [bulkState, setBulkState] = useState(IDLE_BULK);
    const bulkRef = useRef(IDLE_BULK);
    bulkRef.current = bulkState;
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
    const toolRows = useMemo(() => buildToolRows(snapshot, pending).map((row) => {
        if (pending[row.id] !== undefined)
            return row;
        const value = optimistic.tools[row.unit];
        return value === undefined ? row : { ...row, enabled: value };
    }), [snapshot, pending, optimistic.tools]);
    const applyOptimistic = useCallback((items) => {
        setOptimistic((prev) => {
            const skills = { ...prev.skills };
            const mcp = { ...prev.mcp };
            const tools = { ...prev.tools };
            for (const item of items) {
                if (item.kind === "skill") {
                    skills[item.name] = true;
                    continue;
                }
                if (item.kind === "tool") {
                    // rank 的 name 是插件展示名；行按单元 id 记，先解析回快照单元。
                    const unit = snapshot.tools.find((candidate) => candidate.name === item.name) ?? snapshot.tools.find((candidate) => candidate.unit === item.name);
                    if (unit !== undefined)
                        tools[unit.unit] = true;
                    continue;
                }
                // rank 的 name 是 serverName；composer 行名对项目条目用的是 key，
                // 因此先按 serverName / key 在快照里解析出行名。
                const server = snapshot.servers.find((candidate) => candidate.serverName === item.name) ?? snapshot.servers.find((candidate) => candidate.key === item.name);
                mcp[server?.key ?? item.name] = true;
            }
            return { skills, mcp, tools };
        });
    }, [snapshot.servers, snapshot.tools]);
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
            else if (row.kind === "mcp") {
                await api.mcp.setSessionEnabled({ target: row.target, kind: row.writeKind, enabled: next });
            }
            else {
                // Tools：一条 RPC 关掉该插件全部工具（宿主重算 restrict deny 名单）。
                await api.tools.setSessionEnabled({ units: [row.unit], enabled: next });
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
    /**
     * 行 3 控制条的三域批量（R1）：**按域串行**调用 `session.setBulk` 取粗粒度进度，
     * 部分失败只进 `failed[]`（宿主不回滚），这里聚合成 `{n} 项失败 · 重试`。
     * 重试只重放失败域（同一 action）。
     */
    const runBulk = useCallback(async (action, retryDomains) => {
        if (bulkRef.current.phase === "running")
            return;
        const domains = retryDomains !== undefined && retryDomains.length > 0 ? retryDomains : BULK_DOMAINS;
        // 乐观回显：enable/disable 时把参与域的可开关行先切到目标态；reset 不清空（回默认）。
        const optimisticTarget = action === "enable" ? true : action === "disable" ? false : undefined;
        const targetRows = [
            ...(domains.includes("skills") ? skillRows : []),
            ...(domains.includes("mcp") ? mcpRows : []),
            ...(domains.includes("tools") ? toolRows : []),
        ].filter((row) => !row.disabled && optimisticTarget !== undefined);
        const optimisticMap = {};
        for (const row of targetRows)
            optimisticMap[row.id] = optimisticTarget === true;
        if (targetRows.length > 0)
            setPending((prev) => ({ ...prev, ...optimisticMap }));
        const nextState = {
            phase: "running",
            action,
            doneDomains: 0,
            totalDomains: domains.length,
            failed: [],
            failedDomains: [],
        };
        setBulkState(nextState);
        setError(undefined);
        const collectedFailed = [];
        const failedDomains = [];
        let bulkError;
        let done = 0;
        for (const domain of domains) {
            try {
                const result = await api.session.setBulk({ action, domains: [domain] });
                if (!result.ok) {
                    bulkError = result.errors.join("; ");
                    failedDomains.push(domain);
                }
                else if (result.failed.length > 0) {
                    collectedFailed.push(...result.failed);
                    failedDomains.push(domain);
                }
            }
            catch (err) {
                bulkError = String(err instanceof Error ? err.message : err);
                failedDomains.push(domain);
            }
            finally {
                done += 1;
                setBulkState((prev) => (prev.phase === "running" ? { ...prev, doneDomains: done } : prev));
            }
        }
        // 失败行回滚乐观态（让 UI 显示宿主真实状态）；成功行留给 refresh 后的快照。
        if (failedDomains.length > 0) {
            const failedIds = new Set(collectedFailed
                .map((failure) => rowIdOfBulkFailure(failure, snapshot))
                .filter((id) => id !== undefined));
            setPending((prev) => {
                const copy = { ...prev };
                for (const id of failedIds)
                    delete copy[id];
                return copy;
            });
        }
        const finalState = {
            phase: collectedFailed.length > 0 || failedDomains.length > 0 ? "partial" : "idle",
            action,
            doneDomains: done,
            totalDomains: domains.length,
            failed: collectedFailed,
            failedDomains,
            ...(bulkError !== undefined ? { error: bulkError } : {}),
        };
        setBulkState(finalState);
        refresh();
    }, [api, refresh, setError, skillRows, mcpRows, toolRows, snapshot]);
    /** 重试：只重放上一轮的失败域（同一 action）。 */
    const retryBulk = useCallback(() => {
        const state = bulkRef.current;
        if (state.action === undefined || state.failedDomains.length === 0)
            return;
        void runBulk(state.action, state.failedDomains);
    }, [runBulk]);
    /** 恢复默认 = `session.setBulk({action:"reset"})`：只清显式会话覆盖，不改项目默认。 */
    const reset = useCallback(async () => {
        await runBulk("reset");
    }, [runBulk]);
    return {
        snapshot,
        loading,
        error,
        refresh,
        skillRows,
        mcpRows,
        toolRows,
        pending,
        busy,
        bulkState,
        toggle,
        onBulk: (action) => void runBulk(action),
        retryBulk,
        reset,
        applyOptimistic,
    };
}
/** 批量失败项 → composer 行 id（`failed[]` 的 target 按域映射回行）。 */
function rowIdOfBulkFailure(failure, snapshot) {
    if (failure.domain === "skills")
        return `skill:${failure.target}`;
    if (failure.domain === "tools")
        return `tool:${failure.target}`;
    if (failure.kind === "mcp-project") {
        const server = snapshot.servers.find((candidate) => candidate.key === failure.target);
        return server !== undefined ? `mcp:project:${server.key}` : undefined;
    }
    const server = snapshot.servers.find((candidate) => candidate.key === failure.target) ??
        snapshot.servers.find((candidate) => candidate.serverName === failure.target);
    if (server !== undefined)
        return server.scope === "project" ? `mcp:project:${server.key}` : `mcp:global:${server.key}`;
    if (snapshot.externals.some((candidate) => candidate.serverName === failure.target))
        return `mcp:external:${failure.target}`;
    return undefined;
}
// ---------------------------------------------------------------------------
// 首屏入口：收进输入框底部工具行（conversation.input.left）
//
// 设计（Figma v14）：
//   - 收起态只在工具行预留位显示「书 8 / 插头 5 / 工具箱 3 + ✦ + 滑杆」，
//     不再单独占输入框下方一条，也不再内联下拉展开；
//   - 点击计数区 / 滑杆 → 居中弹窗（背景模糊），弹窗内复用 CapabilityPanel；
//   - ✦ 仍是「能力决策」手动入口，结果面板沿用 v13（fixed 落在输入卡下方）。
// hero 相位之外（active / settling）组件不渲染入口，但保留壳节点用于相位探测。
// ---------------------------------------------------------------------------
export function ComposerCapabilityEntry(props) {
    const { api, onManage } = props;
    const slot = props.slotProps;
    if (slot !== undefined && typeof slot.useInput === "function") {
        return _jsx(EntryWithSubscribedDraft, { api: api, onManage: onManage, slotProps: slot, useInput: slot.useInput });
    }
    return _jsx(EntryBody, { api: api, onManage: onManage, slotProps: slot, slotDraft: undefined });
}
/**
 * 槽 standardProps 可用分支：`useInput` 是订阅式 hook，草稿变化即重渲染。
 * 单独成组件是为了避免在 props 形态切换时改变 EntryBody 的 hooks 顺序。
 */
function EntryWithSubscribedDraft({ api, onManage, slotProps, useInput, }) {
    const draft = useInput((state) => (typeof state?.draft === "string" ? state.draft : ""));
    return _jsx(EntryBody, { api: api, onManage: onManage, slotProps: slotProps, slotDraft: draft });
}
function EntryBody({ api, onManage, slotProps, slotDraft, }) {
    const { ref, phase } = useConversationPhase();
    const isHero = phase === "hero";
    const workspace = useWorkspaceLabel(api);
    const controller = useCapabilityController(api, workspace, isHero);
    const rect = useComposerCardRect(isHero, ref);
    const [modalOpen, setModalOpen] = useState(false);
    const contentRef = useRef(null);
    const entryRef = useRef(null);
    const modalRef = useRef(null);
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
    // 三域能力单元总数（Tools 按插件计；用于「N 个能力」与决策面板估算分母）。
    const totalCapabilities = controller.skillRows.length + controller.mcpRows.length + controller.toolRows.length;
    // 冷会话技能走宿主排队应用（架构 §8.6），不按 canToggleInSession 置灰，
    // 因此这里只把「外部不可 restrict 实例 / 锁定插件」从可切换集合里排除。
    const switchableCapabilities = controller.skillRows.length +
        controller.mcpRows.filter((row) => !row.locked).length +
        controller.toolRows.filter((row) => !row.disabled).length;
    const returnFocusToEntry = useCallback((returnFocus) => {
        if (!returnFocus)
            return;
        requestAnimationFrame(() => {
            entryRef.current?.querySelector(".skp-dock-entry-decision")?.focus();
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
    let entryTooltip = configured
        ? autoOff
            ? "自动触发默认关闭 · 可在 Jev 模型 Tab 开启"
            : "根据输入框草稿，为 Skills、MCP 与 Tools 打分并勾选相关能力（仅当前会话）"
        : "尚未配置 Jev 模型，点击去配置";
    if (decision.state?.phase === "applying") {
        entryDisabled = true;
        entryGuide = false;
        entryTooltip = "正在应用所选能力";
    }
    else if (decision.state?.phase === "loading") {
        entryDisabled = true;
        entryGuide = false;
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
        entryTooltip = "当前会话没有可评分的 Skills / MCP / Tools";
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
    // 弹窗关闭：状态复位 + 焦点还给入口。
    const closeModal = useCallback(() => {
        setModalOpen(false);
        requestAnimationFrame(() => entryRef.current?.querySelector(".skp-dock-entry-config")?.focus());
    }, []);
    // 相位切走（hero → active）时关闭弹窗，避免弹层残留在对话页。
    useEffect(() => {
        if (!isHero)
            setModalOpen(false);
    }, [isHero]);
    // 弹窗 a11y：Esc 关闭 + Tab 焦点圈定在弹窗内（capture，避免被宿主输入框快捷键抢走）。
    useEffect(() => {
        if (!modalOpen)
            return;
        const onKeyDown = (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeModal();
                return;
            }
            if (event.key !== "Tab")
                return;
            const root = modalRef.current;
            if (root === null)
                return;
            const focusables = Array.from(root.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')).filter((node) => node.offsetParent !== null);
            if (focusables.length === 0)
                return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            const active = document.activeElement;
            if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
            }
            else if (event.shiftKey && active === first) {
                event.preventDefault();
                last.focus();
            }
        };
        document.addEventListener("keydown", onKeyDown, true);
        const frame = requestAnimationFrame(() => {
            modalRef.current?.querySelector(".skp-dock-modal-close")?.focus();
        });
        return () => {
            cancelAnimationFrame(frame);
            document.removeEventListener("keydown", onKeyDown, true);
        };
    }, [modalOpen, closeModal]);
    // 入口三域计数（已启用数；加载中显示 —）。
    const skillsOn = controller.skillRows.filter((row) => row.enabled).length;
    const mcpOn = controller.mcpRows.filter((row) => row.enabled).length;
    const toolsOn = controller.toolRows.filter((row) => row.enabled).length;
    const countsLoading = controller.loading && totalCapabilities === 0;
    const countText = (value) => (countsLoading ? "—" : String(value));
    const countTitle = (label, on, total) => `${label}：已启用 ${on} / ${total} · 点击配置本会话能力`;
    const viewportHeight = typeof window === "undefined" ? 900 : window.innerHeight;
    const decisionStyle = rect === undefined
        ? undefined
        : (() => {
            const maxHeight = Math.max(180, Math.min(decision.state !== undefined ? 560 : 360, viewportHeight - rect.top - 24));
            return { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, maxHeight: `${maxHeight}px` };
        })();
    return (_jsxs("div", { ref: ref, className: "skp-dock-entry-host", children: [isHero && (_jsxs("div", { ref: entryRef, className: "skp-dock-entry", role: "group", "aria-label": "\u672C\u4F1A\u8BDD\u80FD\u529B", children: [_jsxs("button", { type: "button", className: "skp-dock-entry-item", title: countTitle("Skills", skillsOn, controller.skillRows.length), "aria-label": `配置 Skills：已启用 ${skillsOn} / ${controller.skillRows.length}`, onClick: () => setModalOpen(true), children: [_jsx("span", { className: "skp-dock-entry-icon", children: _jsx(BookIcon, {}) }), _jsx("span", { className: "skp-dock-entry-count", children: countText(skillsOn) })] }), _jsxs("button", { type: "button", className: "skp-dock-entry-item", title: countTitle("MCP", mcpOn, controller.mcpRows.length), "aria-label": `配置 MCP：已启用 ${mcpOn} / ${controller.mcpRows.length}`, onClick: () => setModalOpen(true), children: [_jsx("span", { className: "skp-dock-entry-icon", children: _jsx(PlugIcon, {}) }), _jsx("span", { className: "skp-dock-entry-count", children: countText(mcpOn) })] }), _jsxs("button", { type: "button", className: "skp-dock-entry-item", title: countTitle("Tools", toolsOn, controller.toolRows.length), "aria-label": `配置 Tools：已启用 ${toolsOn} / ${controller.toolRows.length}`, onClick: () => setModalOpen(true), children: [_jsx("span", { className: "skp-dock-entry-icon", children: _jsx(ToolboxIcon, {}) }), _jsx("span", { className: "skp-dock-entry-count", children: countText(toolsOn) })] }), _jsx("span", { className: "skp-dock-entry-sep", "aria-hidden": "true" }), _jsxs("button", { type: "button", className: "skp-dock-entry-btn skp-dock-entry-decision", title: entryTooltip, "aria-label": "\u80FD\u529B\u51B3\u7B56", "aria-disabled": entryDisabled ? true : undefined, onClick: onEntryClick, children: [_jsx(DecisionStarIcon, {}), entryGuide && _jsx("i", { className: "skp-dock-entry-guide-dot", "aria-hidden": "true" })] }), _jsx("button", { type: "button", className: "skp-dock-entry-btn skp-dock-entry-config", title: "\u914D\u7F6E\u672C\u4F1A\u8BDD\u80FD\u529B", "aria-label": "\u914D\u7F6E\u672C\u4F1A\u8BDD\u80FD\u529B", onClick: () => setModalOpen(true), children: _jsx(SlidersIcon, {}) })] })), isHero && decision.state !== undefined && decisionStyle !== undefined && (_jsxs("div", { ref: contentRef, className: "skp-dock-fixed", style: decisionStyle, children: [_jsx(DecisionPanel, { state: decision.state, config: jevConfig.state, draft: draft, estimateTotal: totalCapabilities, titleRef: titleRef, onClose: decision.close, onCancel: decision.cancelScoring, onRescore: decision.rescore, onRetry: decision.retry, onGoConfig: decision.goConfig, onThreshold: decision.setThreshold, onToggle: decision.toggleItem, onApply: decision.apply }), decision.toast !== undefined && (_jsx("div", { className: `skp-decision-toast skp-decision-toast-${decision.toast.tone}`, role: "status", children: decision.toast.text }))] })), isHero && modalOpen && (_jsx("div", { className: "skp-dock-modal-backdrop", onMouseDown: (event) => {
                    if (event.target === event.currentTarget)
                        closeModal();
                }, children: _jsx("div", { ref: modalRef, className: "skp-dock-modal", role: "dialog", "aria-modal": "true", "aria-label": "\u672C\u4F1A\u8BDD\u80FD\u529B", children: _jsx(CapabilityPanel, { mode: "modal", loading: controller.loading, error: controller.error, snapshot: controller.snapshot, skillRows: controller.skillRows, mcpRows: controller.mcpRows, toolRows: controller.toolRows, pending: controller.pending, busy: controller.busy, onToggle: (row) => void controller.toggle(row), onReset: controller.reset, onBulk: controller.onBulk, onRetryBulk: controller.retryBulk, bulkState: controller.bulkState, onRefresh: controller.refresh, onCollapse: closeModal, ...(onManage !== undefined ? { onManage } : {}), onRetry: controller.refresh }) }) })), _jsx("span", { className: "skp-sr-only", role: "status", "aria-live": "polite", children: decision.liveMessage })] }));
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
    return (_jsx("div", { ref: rootRef, className: "skp-cap-view", "data-capability-view-session": sessionId ?? "", children: _jsx("div", { className: "skp-cap-view-inner", children: _jsx(CapabilityPanel, { mode: "view", loading: controller.loading, error: controller.error, snapshot: controller.snapshot, skillRows: controller.skillRows, mcpRows: controller.mcpRows, toolRows: controller.toolRows, pending: controller.pending, busy: controller.busy, onToggle: (row) => void controller.toggle(row), onReset: controller.reset, onBulk: controller.onBulk, onRetryBulk: controller.retryBulk, bulkState: controller.bulkState, onRefresh: controller.refresh, onCollapse: () => undefined, ...(onManage !== undefined ? { onManage } : {}), onRetry: controller.refresh }) }) }));
}
