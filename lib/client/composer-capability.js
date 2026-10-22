import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
    const { mode, loading, error, skillRows, mcpRows, pending, busy, onToggle, onReset, onCollapse, onManage, onRefresh, onRetry, initialTab } = props;
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
    return (_jsxs("div", { className: `skp-dock-panel skp-dock-panel-${mode}`, children: [_jsxs("div", { className: "skp-dock-head", children: [_jsx("span", { className: "skp-dock-title-icon", children: _jsx(SparkleIcon, {}) }), _jsx("span", { className: "skp-dock-title", children: "\u672C\u4F1A\u8BDD\u80FD\u529B" }), mode === "view" && _jsx("span", { className: "skp-dock-subtitle", children: "\u5F00\u5173\u53EA\u4F5C\u7528\u4E8E\u5F53\u524D\u4F1A\u8BDD\uFF0C\u4E0D\u4FEE\u6539\u9879\u76EE\u9ED8\u8BA4" }), _jsxs("div", { className: "skp-dock-head-right", children: [_jsxs("label", { className: "skp-dock-search", children: [_jsx("span", { className: "skp-dock-search-icon", children: _jsx(SearchIcon, {}) }), _jsx("input", { type: "search", value: query, placeholder: "\u641C\u7D22\u80FD\u529B", "aria-label": "\u641C\u7D22\u80FD\u529B", onChange: (event) => setQuery(event.target.value) })] }), mode !== "view" && (_jsx("button", { type: "button", className: "skp-dock-icon-btn", title: "\u6536\u8D77", "aria-label": "\u6536\u8D77", onClick: onCollapse, children: _jsx(ChevronIcon, { up: true }) }))] })] }), _jsxs("div", { className: "skp-dock-tab-row", children: [_jsxs("div", { className: "skp-dock-tabs", role: "tablist", children: [_jsxs("button", { type: "button", role: "tab", "aria-selected": tab === "skills", className: `skp-dock-tab${tab === "skills" ? " skp-dock-tab-active" : ""}`, onClick: () => setTab("skills"), children: ["Skills", _jsxs("span", { className: "skp-dock-tab-count", children: [skillsOn, " / ", skillRows.length] })] }), _jsxs("button", { type: "button", role: "tab", "aria-selected": tab === "mcp", className: `skp-dock-tab${tab === "mcp" ? " skp-dock-tab-active" : ""}`, onClick: () => setTab("mcp"), children: ["MCP \u670D\u52A1\u5668", _jsxs("span", { className: "skp-dock-tab-count", children: [mcpOn, " / ", mcpRows.length] })] })] }), _jsx("span", { className: "skp-dock-spacer" }), onManage !== undefined && (_jsx("button", { type: "button", className: "skp-dock-link", onClick: onManage, children: "\u7BA1\u7406\u5168\u90E8 \u2197" }))] }), error !== undefined && (_jsxs("div", { className: "skp-dock-banner", role: "alert", children: [_jsx("span", { children: error }), onRetry !== undefined && (_jsx("button", { type: "button", className: "skp-dock-link", onClick: onRetry, children: "\u91CD\u8BD5" }))] })), _jsx("div", { className: "skp-dock-grid", role: "tabpanel", children: loading && filtered.length === 0 ? (_jsx("div", { className: "skp-dock-empty", children: "\u52A0\u8F7D\u4E2D\u2026" })) : filtered.length === 0 ? (_jsxs("div", { className: "skp-dock-empty", children: [query.trim() !== "" ? `没有匹配「${query.trim()}」的能力` : tab === "skills" ? "本会话暂无可配置的 Skills" : "本会话暂无可配置的 MCP 服务器", query.trim() !== "" && (_jsx("button", { type: "button", className: "skp-dock-link", onClick: () => setQuery(""), children: "\u6E05\u7A7A\u641C\u7D22" }))] })) : (filtered.map((row) => _jsx(CapabilityCard, { row: row, busy: busy[row.id] === true, onToggle: () => onToggle(row) }, row.id))) }), _jsxs("div", { className: "skp-dock-foot", children: [_jsxs("span", { className: "skp-dock-foot-note", children: [totalOn, " / ", total, " \u9879\u5DF2\u542F\u7528 \u00B7 \u5F00\u5173\u53EA\u4F5C\u7528\u4E8E\u5F53\u524D\u5BF9\u8BDD"] }), _jsx("button", { type: "button", className: "skp-dock-btn", disabled: resetBusy, onClick: () => {
                            setResetBusy(true);
                            Promise.resolve(onReset()).finally(() => setResetBusy(false));
                        }, children: "\u6062\u590D\u9ED8\u8BA4" }), mode !== "view" && (_jsx("button", { type: "button", className: "skp-dock-btn skp-dock-btn-primary", onClick: onCollapse, children: "\u5B8C\u6210" }))] })] }));
}
// ---------------------------------------------------------------------------
// 收起态能力条
// ---------------------------------------------------------------------------
export function CapabilityBar({ skillRows, mcpRows, loading, onExpand }) {
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
        }, children: [_jsx("span", { className: "skp-dock-title-icon", children: _jsx(SparkleIcon, {}) }), _jsx("span", { className: "skp-dock-bar-title", children: "\u672C\u4F1A\u8BDD\u80FD\u529B" }), _jsx("span", { className: "skp-dock-bar-divider" }), loading && enabled.length === 0 ? (_jsx("span", { className: "skp-dock-bar-hint", children: "\u52A0\u8F7D\u4E2D\u2026" })) : visible.length === 0 ? (_jsx("span", { className: "skp-dock-bar-hint", children: "\u672A\u542F\u7528\u4EFB\u4F55\u80FD\u529B" })) : (_jsxs("span", { className: "skp-dock-chips", children: [visible.map((item) => (_jsxs("span", { className: `skp-dock-chip skp-dock-chip-${item.kind}`, children: [_jsx("i", { className: "skp-dock-chip-dot" }), item.name] }, item.id))), overflow > 0 && _jsxs("span", { className: "skp-dock-chip skp-dock-chip-more", children: ["+", overflow] })] })), _jsx("span", { className: "skp-dock-spacer" }), _jsxs("span", { className: "skp-dock-count", children: [enabled.length, " / ", total, " \u542F\u7528"] }), _jsxs("button", { type: "button", className: "skp-dock-config-btn", onClick: onExpand, children: ["\u914D\u7F6E", _jsx(ChevronIcon, {})] })] }));
}
// ---------------------------------------------------------------------------
// 会话控制器：一次拉取 + 开关/恢复默认（hero / overlay / view 共用）
// ---------------------------------------------------------------------------
function useCapabilityController(api, workspace, enabled = true) {
    const { snapshot, loading, error, setError, refresh } = useCapabilitySnapshot(api, workspace, enabled);
    const [pending, setPending] = useState({});
    const [busy, setBusy] = useState({});
    const skillRows = useMemo(() => buildSkillRows(snapshot, pending), [snapshot, pending]);
    const mcpRows = useMemo(() => buildMcpRows(snapshot, pending), [snapshot, pending]);
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
    return { snapshot, loading, error, refresh, skillRows, mcpRows, pending, busy, toggle, reset };
}
// ---------------------------------------------------------------------------
// 首屏（hero）：fixed 面板（active 相位返回零高占位）
// ---------------------------------------------------------------------------
export function ComposerCapabilityHero({ api, onManage }) {
    const { ref, phase } = useConversationPhase();
    const isHero = phase === "hero";
    const workspace = useWorkspaceLabel(api);
    const controller = useCapabilityController(api, workspace, isHero);
    const rect = useComposerCardRect(isHero, ref);
    const [open, setOpen] = useState(true);
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
    return (_jsx("div", { ref: ref, className: "skp-dock-hero-anchor", children: _jsx("div", { className: "skp-dock-fixed", style: style, children: open ? (_jsx(CapabilityPanel, { mode: "hero", loading: controller.loading, error: controller.error, snapshot: controller.snapshot, skillRows: controller.skillRows, mcpRows: controller.mcpRows, pending: controller.pending, busy: controller.busy, onToggle: (row) => void controller.toggle(row), onReset: controller.reset, onRefresh: controller.refresh, onCollapse: () => setOpen(false), ...(onManage !== undefined ? { onManage } : {}), onRetry: controller.refresh })) : (_jsx(CapabilityBar, { skillRows: controller.skillRows, mcpRows: controller.mcpRows, loading: controller.loading, onExpand: () => setOpen(true) })) }) }));
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
