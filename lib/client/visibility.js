import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * 能力可见性（v21）三域共用的展示与编辑组件。
 *
 * 契约：`notes/redesign/visibility-contract.md` §4 / §6。
 * - 可见性是**全局唯一控制**（按工作区），只有全局视图能改：
 *   `mode`（全部 / 指定 / 不可见）+ `workspaces[项目根]`（可见 + 默认开/关）。
 * - 每工作区默认开/关是「该工作区的初始默认」，工作区视图仍可再覆盖（三态），
 *   会话显式开关优先级最高；这些更下层逻辑不在本文件。
 * - 行内标签 / 默认摘要吃宿主投影的 `visibilityMode` / `visibleWorkspaceCount`；
 *   缺省（旧宿主）时用 `overrides.globalGet().visibility` 自行计算。
 *
 * 存储与 RPC：`overrides.globalGet` 读 `visibility`，`overrides.setVisibility`
 * 提交**整份** workspaces 映射（key = 项目根，与 workspaces[].path 原样对应）。
 *
 * @module dsh-capability-settings/client/visibility
 */
import { useState } from "react";
import { Modal } from "./modal.js";
/** 空可见性集合（旧宿主 / v1 全局文件缺省）。 */
export const EMPTY_VISIBILITY_SETS = { skills: {}, mcp: {}, tools: {} };
/**
 * v21.2：可见性 / 每工作区默认的**生效范围**说明（用户要求确认语义）。
 * 改动只影响新建对话；已有对话保持原状态（会话「能力」Tab 可单独调整）。
 */
export const VISIBILITY_EFFECT_NOTE = "可见性与默认改动只对新建对话生效；已有对话保持原状态，可在会话「能力」Tab 单独调整";
/**
 * 防御性读取全局层（旧宿主 / 测试夹具可能没有 `overrides.globalGet`）：
 * 失败返回 undefined，调用方按「全部可见 / 空名单」降级。
 */
export function safeGlobalGet(api) {
    const overrides = api.overrides;
    if (overrides === undefined || typeof overrides.globalGet !== "function")
        return Promise.resolve(undefined);
    try {
        return Promise.resolve(overrides.globalGet()).catch(() => undefined);
    }
    catch {
        return Promise.resolve(undefined);
    }
}
/** 防御性读取项目 overrides（旧宿主 / 测试夹具可能没有 `overrides.get`）。 */
export function safeOverridesGet(api) {
    const overrides = api.overrides;
    if (overrides === undefined || typeof overrides.get !== "function")
        return Promise.resolve(undefined);
    try {
        return Promise.resolve(overrides.get()).catch(() => undefined);
    }
    catch {
        return Promise.resolve(undefined);
    }
}
/** 工作区展示名：优先 title，其次目录 basename。 */
export function visibilityWorkspaceTitle(workspace) {
    if (workspace.title !== undefined && workspace.title.trim().length > 0)
        return workspace.title;
    const segments = workspace.path.split(/[\\/]/).filter((segment) => segment.length > 0);
    return segments[segments.length - 1] ?? workspace.path;
}
/** 取某个能力的可见性配置（不存在 = 未配置 ⇒ 全部可见、走兜底默认）。 */
export function visibilityEntryOf(sets, domain, key) {
    return sets?.[domain]?.[key];
}
/** 可见性模式（缺省 = all，兼容旧宿主 / v1 文件）。 */
export function visibilityModeOf(entry) {
    return entry?.mode ?? "all";
}
/** 某工作区是否可见（与宿主 `visibleIn` 同构：mode + visible:false 覆盖）。 */
export function isWorkspaceVisible(entry, workspacePath) {
    const mode = visibilityModeOf(entry);
    if (mode === "none")
        return false;
    const state = entry?.workspaces?.[workspacePath];
    if (state?.visible === false)
        return false;
    if (mode === "selected")
        return entry !== undefined && Object.hasOwn(entry.workspaces, workspacePath);
    return true;
}
/** 可见的工作区数；`workspaces` 缺省时用配置里显式出现的 key。 */
export function visibleWorkspaceCountOf(entry, workspaces) {
    if (visibilityModeOf(entry) === "none")
        return 0;
    const paths = workspaces.length > 0 ? workspaces.map((workspace) => workspace.path) : Object.keys(entry?.workspaces ?? {});
    return paths.filter((path) => isWorkspaceVisible(entry, path)).length;
}
/**
 * 能力是否「不可见」（行尾默认开关应禁用 + 标「不可见 · 不参与默认」）：
 * mode=none，或 selected 模式下没有任何可见工作区。
 */
export function isInvisibleCapability(entry, workspaces) {
    const mode = visibilityModeOf(entry);
    if (mode === "none")
        return true;
    if (mode !== "selected")
        return false;
    return visibleWorkspaceCountOf(entry, workspaces) === 0;
}
/**
 * 行级不可见判定：宿主行字段优先（`disabledByVisibility` / `visibilityMode` +
 * `visibleWorkspaceCount`），缺省时回落到可见性配置 + 工作区列表计算。
 */
export function isRowInvisible(row, entry, workspaces) {
    if (row.disabledByVisibility === true)
        return true;
    if (row.visibilityMode === "none")
        return true;
    if (row.visibilityMode === "selected" && (row.visibleWorkspaceCount ?? 0) === 0)
        return true;
    return isInvisibleCapability(entry, workspaces);
}
/** 某工作区的默认开/关：显式 defaultEnabled 优先，否则走兜底 `!globalOff`。 */
export function workspaceDefaultOf(entry, workspacePath, globalOff) {
    const explicit = entry?.workspaces?.[workspacePath]?.defaultEnabled;
    return typeof explicit === "boolean" ? explicit : !globalOff;
}
/** 全局视图行内的默认摘要（只在可见工作区上统计；不可见时 undefined）。 */
export function defaultSummaryOf(entry, workspaces, globalOff) {
    if (isInvisibleCapability(entry, workspaces))
        return undefined;
    const paths = workspaces.length > 0 ? workspaces.map((workspace) => workspace.path) : Object.keys(entry?.workspaces ?? {});
    let on = 0;
    let off = 0;
    for (const path of paths) {
        if (!isWorkspaceVisible(entry, path))
            continue;
        if (workspaceDefaultOf(entry, path, globalOff))
            on += 1;
        else
            off += 1;
    }
    return { on, off };
}
/** 详情一行式可见范围摘要（v21 UX 修订：详情不再内联表格/分段）。 */
export function visibilitySummaryText(entry, workspaces, globalOff) {
    const mode = visibilityModeOf(entry);
    if (mode === "none")
        return "可见范围：不可见（所有工作区与对话首屏都不出现）";
    const scopeText = mode === "selected" ? `指定 ${visibleWorkspaceCountOf(entry, workspaces)} 个工作区` : "全部工作区";
    const summary = defaultSummaryOf(entry, workspaces, globalOff);
    return summary === undefined ? `可见范围：${scopeText}` : `可见范围：${scopeText} · 默认：${summary.on} 开 / ${summary.off} 关`;
}
/** 从项目 overrides 判断某能力在本工作区是否有显式默认覆盖。 */
export function workspaceOverrideOf(overrides, domain, key) {
    if (overrides === undefined)
        return "inherit";
    const enabledOf = () => domain === "skills"
        ? overrides.enabledSkills
        : domain === "mcp"
            ? overrides.enabledMcp
            : overrides.enabledTools;
    const disabledOf = () => domain === "skills" ? overrides.skills : domain === "mcp" ? overrides.mcp : overrides.tools;
    if (enabledOf()?.includes(key) === true)
        return "on";
    if (disabledOf()?.includes(key) === true)
        return "off";
    return "inherit";
}
/** 行内可见性标签（全部工作区 / 指定 N / 不可见）。 */
export function VisibilityBadge({ entry, workspaces, mode, count, }) {
    const resolvedMode = mode ?? visibilityModeOf(entry);
    const resolvedCount = count ?? visibleWorkspaceCountOf(entry, workspaces);
    const label = resolvedMode === "none" ? "不可见" : resolvedMode === "selected" ? `指定 ${resolvedCount} 个工作区` : "全部工作区";
    const className = resolvedMode === "none" ? "skp-tag skp-tag-warn" : "skp-tag skp-tag-flat";
    const title = resolvedMode === "none"
        ? "不可见：工作区列表 / 对话首屏都不出现，运行时强制关闭"
        : resolvedMode === "selected"
            ? `仅 ${resolvedCount} 个工作区可见；其它工作区与对话首屏完全不出现`
            : "全部工作区可见（可在可见范围里单独隐藏某个工作区）";
    return (_jsx("span", { className: className, title: title, children: label }));
}
/** 行内「默认：N 开 / M 关」摘要 + 可见性标签（三域行 meta 区共用）。 */
export function VisibilityRowMeta({ entry, workspaces, globalOff, mode, count, invisible, summaryClassName = "skp-vis-summary", }) {
    const summary = invisible === true ? undefined : defaultSummaryOf(entry, workspaces, globalOff);
    return (_jsxs(_Fragment, { children: [_jsx(VisibilityBadge, { entry: entry, workspaces: workspaces, mode: mode, count: count }), summary !== undefined && (_jsxs("span", { className: summaryClassName, title: "\u6BCF\u4E2A\u5DE5\u4F5C\u533A\u7684\u9ED8\u8BA4\u5F00/\u5173\uFF08\u53EF\u5728\u300C\u53EF\u89C1\u8303\u56F4\u300D\u91CC\u6309\u5DE5\u4F5C\u533A\u8BBE\u7F6E\uFF1B\u5DE5\u4F5C\u533A\u4ECD\u53EF\u8986\u76D6\uFF09", children: ["\u9ED8\u8BA4\uFF1A", summary.on, " \u5F00 / ", summary.off, " \u5173"] }))] }));
}
/**
 * 详情「可见范围」摘要 + 编辑入口（全局视图用；v21 UX 修订）。
 *
 * 详情不再内联分段控件与工作区表格（太长、把详情裁掉），只保留一行摘要：
 * 「可见范围：全部工作区 · 默认：N 开 / M 关」；模式与每工作区默认都在
 * 「编辑可见范围」弹层里配置（弹层内已有分段 + 表格）。
 */
export function VisibilityDetailFields({ api, domain, capabilityKey, name, entry, workspaces, globalOff, onSaved, }) {
    const [open, setOpen] = useState(false);
    const summary = visibilitySummaryText(entry, workspaces, globalOff);
    return (_jsxs(_Fragment, { children: [_jsx("dt", { children: "\u53EF\u89C1\u8303\u56F4" }), _jsxs("dd", { children: [_jsxs("div", { className: "skp-vis-detail-head", children: [_jsx("span", { className: "skp-vis-detail-summary", title: summary, children: summary }), _jsx("button", { type: "button", className: "skp-btn", onClick: () => setOpen(true), children: "\u7F16\u8F91\u53EF\u89C1\u8303\u56F4" })] }), _jsx("div", { className: "skp-vis-tip", children: VISIBILITY_EFFECT_NOTE }), open && (_jsx(VisibilityModal, { api: api, domain: domain, capabilityKey: capabilityKey, name: name, entry: entry, workspaces: workspaces, globalOff: globalOff, onClose: () => setOpen(false), onSaved: () => {
                            setOpen(false);
                            onSaved();
                        } }))] })] }));
}
/** 由现有配置初始化弹层状态。 */
function initEditState(entry, workspaces) {
    const state = {};
    for (const workspace of workspaces) {
        const explicit = entry?.workspaces?.[workspace.path]?.defaultEnabled;
        state[workspace.path] = {
            visible: isWorkspaceVisible(entry, workspace.path),
            ...(typeof explicit === "boolean" ? { defaultEnabled: explicit } : {}),
        };
    }
    return state;
}
/**
 * 可见范围编辑弹层（v21.1）：
 * - **没有模式分段**：模式在保存时由行状态推导（全可见 ⇒ all；全不可见 ⇒ none；
 *   其余 ⇒ selected）；新工作区语义在说明文案里说清。
 * - 工作区表格：每行 [可见 checkbox] + [默认开/关]；表头的「全选/全不选」「全部
 *   默认开/关」是批量切换按钮（默认列只作用于可见行）。
 * - 固定 footer + dirty 态（无改动时保存置灰且不发 RPC）。
 * - 冲突决策：保存返回 `code:"visibility-conflicts"` 时弹二级确认框
 *   （取消 / 保留工作区配置 keep / 清除工作区的开启配置 clear 后重试）。
 */
export function VisibilityModal({ api, domain, capabilityKey, name, entry, workspaces, globalOff, onClose, onSaved, }) {
    const [edit, setEdit] = useState(() => initEditState(entry, workspaces));
    /** 打开时的初始快照（用于 dirty 判定；弹层生命周期内不变）。 */
    const [initial] = useState(() => initEditState(entry, workspaces));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(undefined);
    /** 冲突二级确认框的数据（非空 = 打开）；`conflictError` 是二级框内的错误位。 */
    const [conflict, setConflict] = useState(undefined);
    const [conflictError, setConflictError] = useState(undefined);
    const visibleOf = (path) => edit[path]?.visible === true;
    const defaultOnOf = (path) => edit[path]?.defaultEnabled ?? !globalOff;
    const visibleWorkspaces = workspaces.filter((workspace) => visibleOf(workspace.path));
    const allRowsVisible = workspaces.length > 0 && visibleWorkspaces.length === workspaces.length;
    const noRowsVisible = visibleWorkspaces.length === 0;
    /**
     * 保存时推导 mode（用户要求，v21.1）：所有行可见 ⇒ all；全部不可见 ⇒ none；
     * 其余 ⇒ selected。空工作区列表按 all（等价于删除条目）。
     */
    const derivedMode = workspaces.length === 0 ? "all" : allRowsVisible ? "all" : noRowsVisible ? "none" : "selected";
    /** 所有可见行的默认是否都为开（决定默认列批量按钮的方向与文案）。 */
    const allVisibleDefaultsOn = visibleWorkspaces.length > 0 && visibleWorkspaces.every((workspace) => defaultOnOf(workspace.path));
    /** 状态规范化 key：按 workspaces 顺序遍历，顺序无关、等价映射即不 dirty。 */
    const stateKey = (state) => workspaces
        .map((workspace) => {
        const item = state[workspace.path];
        const visible = item?.visible === true;
        const fallback = item?.defaultEnabled === undefined ? "-" : item.defaultEnabled ? "1" : "0";
        return `${workspace.path}:${visible ? 1 : 0}:${fallback}`;
    })
        .join("|");
    /** 有改动才允许保存（取消始终可用）。 */
    const dirty = stateKey(edit) !== stateKey(initial);
    /** 批量：可见列——按当前状态反转（半选时先全选）。 */
    const toggleVisibleAll = () => {
        const next = !allRowsVisible;
        setEdit((current) => {
            const copy = { ...current };
            for (const workspace of workspaces)
                copy[workspace.path] = { ...(copy[workspace.path] ?? { visible: next }), visible: next };
            return copy;
        });
    };
    /** 批量：默认列——所有可见行按当前状态反转（有任一关闭则全开，全开则全关）。 */
    const toggleDefaultAll = () => {
        if (visibleWorkspaces.length === 0)
            return;
        const next = !allVisibleDefaultsOn;
        setEdit((current) => {
            const copy = { ...current };
            for (const workspace of visibleWorkspaces) {
                copy[workspace.path] = { ...(copy[workspace.path] ?? { visible: true }), defaultEnabled: next };
            }
            return copy;
        });
    };
    const setWorkspaceVisible = (path, visible) => {
        setEdit((current) => ({ ...current, [path]: { ...(current[path] ?? { visible }), visible } }));
    };
    const setWorkspaceDefault = (path, defaultEnabled) => {
        setEdit((current) => ({ ...current, [path]: { ...(current[path] ?? { visible: true }), defaultEnabled } }));
    };
    /**
     * 提交载荷：**完整映射**（每个已知工作区都显式一行）：
     * - `visible` 恒写；不可见行 `visible:false`（不带 defaultEnabled）；
     * - `defaultEnabled` 只在「可见且用户显式设置过」时写。
     */
    const buildWorkspaces = () => {
        const payload = {};
        for (const workspace of workspaces) {
            const item = edit[workspace.path];
            if (item === undefined) {
                payload[workspace.path] = { visible: false };
                continue;
            }
            const visible = item.visible;
            const explicitDefault = visible && typeof item.defaultEnabled === "boolean" ? { defaultEnabled: item.defaultEnabled } : {};
            payload[workspace.path] = { visible, ...explicitDefault };
        }
        return payload;
    };
    /** 一次保存请求；`resolveConflicts` 用于冲突确认后的重试。 */
    const requestSave = async (resolveConflicts) => {
        if (saving || (!dirty && resolveConflicts === undefined))
            return;
        setSaving(true);
        const isRetry = resolveConflicts !== undefined;
        if (isRetry)
            setConflictError(undefined);
        else
            setError(undefined);
        const showError = (message) => {
            if (isRetry)
                setConflictError(message);
            else
                setError(message);
        };
        try {
            const result = await api.overrides.setVisibility({
                domain,
                key: capabilityKey,
                mode: derivedMode,
                workspaces: buildWorkspaces(),
                ...(resolveConflicts !== undefined ? { resolveConflicts } : {}),
            });
            if (!result.ok) {
                const conflicts = result.conflicts ?? [];
                if (!isRetry && result.code === "visibility-conflicts" && conflicts.length > 0) {
                    // 首次保存遇到冲突：不关弹窗，弹二级确认。
                    setConflict(conflicts);
                    setConflictError(undefined);
                    return;
                }
                showError(result.errors.join("; "));
                return;
            }
            setConflict(undefined);
            onSaved();
        }
        catch (failure) {
            showError(String(failure instanceof Error ? failure.message : failure));
        }
        finally {
            setSaving(false);
        }
    };
    /** 关闭冲突确认框（回到主弹层继续编辑）。 */
    const dismissConflict = () => {
        if (saving)
            return;
        setConflict(undefined);
        setConflictError(undefined);
    };
    const headerNote = derivedMode === "all"
        ? "全部工作区可见；新工作区默认可见、走兜底默认。可用表头批量按钮全选 / 全部默认开/关。"
        : derivedMode === "selected"
            ? "仅勾选的工作区可见；新工作区默认不可见，需手动勾选。"
            : "不可见：工作区列表 / 对话首屏都不出现，运行时强制关闭（会话开关不能打开）；旧覆盖保留不删。";
    return (_jsxs(_Fragment, { children: [_jsx(Modal, { title: `可见范围 · ${name}`, onClose: onClose, header: _jsxs(_Fragment, { children: [_jsx("div", { className: "skp-vis-modal-note", children: headerNote }), _jsx("div", { className: "skp-vis-tip", children: VISIBILITY_EFFECT_NOTE }), error !== undefined && _jsx("div", { className: "skp-error", children: error })] }), footer: _jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "skp-btn", onClick: onClose, children: "\u53D6\u6D88" }), _jsx("button", { type: "button", className: dirty && !saving ? "skp-btn skp-btn-primary" : "skp-btn", disabled: saving || !dirty, title: dirty ? "保存可见范围与每工作区默认" : "没有改动", onClick: () => void requestSave(), children: saving ? "保存中…" : "保存" })] }), children: workspaces.length === 0 ? (_jsx("div", { className: "skp-note", children: "\u8FD8\u6CA1\u6709\u5DF2\u77E5\u5DE5\u4F5C\u533A\uFF1B\u65B0\u5EFA\u5DE5\u4F5C\u533A\u540E\u518D\u6765\u914D\u7F6E\u3002" })) : (_jsxs("div", { className: "skp-vis-table", role: "table", "aria-label": "\u5404\u5DE5\u4F5C\u533A\u53EF\u89C1\u6027\u4E0E\u9ED8\u8BA4", children: [_jsxs("div", { className: "skp-vis-table-head", role: "row", children: [_jsx("span", { role: "columnheader", children: "\u5DE5\u4F5C\u533A" }), _jsxs("span", { role: "columnheader", className: "skp-vis-col-head", children: [_jsx("span", { children: "\u53EF\u89C1" }), _jsx("button", { type: "button", className: "skp-vis-batch", disabled: saving, title: allRowsVisible ? "全部不勾选（当前已全选）" : "全部勾选（半选时先全选）", onClick: toggleVisibleAll, children: allRowsVisible ? "全不选" : "全选" })] }), _jsxs("span", { role: "columnheader", className: "skp-vis-col-head", children: [_jsx("span", { children: "\u9ED8\u8BA4" }), _jsx("button", { type: "button", className: "skp-vis-batch", disabled: saving || visibleWorkspaces.length === 0, title: visibleWorkspaces.length === 0
                                                ? "没有可见工作区"
                                                : allVisibleDefaultsOn
                                                    ? "所有可见工作区默认关"
                                                    : "所有可见工作区默认开", onClick: toggleDefaultAll, children: allVisibleDefaultsOn ? "全部默认关" : "全部默认开" })] })] }), workspaces.map((workspace) => {
                            const visible = visibleOf(workspace.path);
                            const defaultOn = defaultOnOf(workspace.path);
                            return (_jsxs("div", { className: "skp-vis-table-row", role: "row", title: workspace.path, children: [_jsx("span", { className: "skp-vis-ws-name", role: "cell", children: visibilityWorkspaceTitle(workspace) }), _jsx("span", { role: "cell", children: _jsxs("label", { className: "skp-vis-check", children: [_jsx("input", { type: "checkbox", checked: visible, disabled: saving, "aria-label": `${visibilityWorkspaceTitle(workspace)} 可见`, onChange: (event) => setWorkspaceVisible(workspace.path, event.target.checked) }), _jsx("span", { children: "\u53EF\u89C1" })] }) }), _jsx("span", { role: "cell", children: _jsxs("label", { className: "skp-row-toggle skp-vis-default-toggle", title: "\u8BE5\u5DE5\u4F5C\u533A\u7684\u9ED8\u8BA4\u5F00/\u5173\uFF08\u5DE5\u4F5C\u533A\u4ECD\u53EF\u8986\u76D6\uFF09", children: [_jsx("span", { className: "skp-row-default-label", children: defaultOn ? "默认开" : "默认关" }), _jsxs("span", { className: "skp-switch", children: [_jsx("input", { type: "checkbox", role: "switch", "aria-label": `${visibilityWorkspaceTitle(workspace)} 默认开启`, checked: defaultOn, disabled: saving || !visible, onChange: (event) => setWorkspaceDefault(workspace.path, event.target.checked) }), _jsx("span", { className: "skp-switch-track" })] })] }) })] }, workspace.path));
                        })] })) }), conflict !== undefined && (_jsxs(Modal, { title: "\u53EF\u89C1\u6027\u51B2\u7A81", onClose: dismissConflict, header: _jsx("div", { className: "skp-note", children: "\u4EE5\u4E0B\u5DE5\u4F5C\u533A\u663E\u5F0F\u5F00\u542F\u4E86\u8BE5\u80FD\u529B\uFF0C\u4F46\u672C\u6B21\u5C06\u8BBE\u4E3A\u4E0D\u53EF\u89C1\uFF1A" }), footer: _jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "skp-btn", disabled: saving, onClick: dismissConflict, children: "\u53D6\u6D88" }), _jsx("button", { type: "button", className: "skp-btn", disabled: saving, onClick: () => void requestSave("keep"), children: saving ? "处理中…" : "保留工作区配置" }), _jsx("button", { type: "button", className: "skp-btn skp-btn-danger-ghost", disabled: saving, title: "\u79FB\u9664\u8FD9\u4E9B\u5DE5\u4F5C\u533A\u7684\u663E\u5F0F\u5F00\u542F\u914D\u7F6E\uFF1B\u5176\u5B83\u9ED8\u8BA4\u4E0D\u53D8", onClick: () => void requestSave("clear"), children: "\u6E05\u9664\u5DE5\u4F5C\u533A\u7684\u5F00\u542F\u914D\u7F6E" })] }), children: [_jsx("ul", { className: "skp-vis-conflict-list", "aria-label": "\u51B2\u7A81\u5DE5\u4F5C\u533A", children: conflict.map((item) => (_jsxs("li", { className: "skp-vis-conflict-row", title: item.projectRoot, children: [_jsx("span", { className: "skp-vis-ws-name", children: visibilityWorkspaceTitle({ path: item.workspace }) }), item.projectRoot !== item.workspace && _jsx("span", { className: "skp-vis-conflict-root", children: item.projectRoot })] }, `${item.workspace}|${item.projectRoot}`))) }), _jsx("div", { className: "skp-note", children: "\u300C\u4FDD\u7559\u5DE5\u4F5C\u533A\u914D\u7F6E\u300D\u4FDD\u7559\u8FD9\u4E9B\u5DE5\u4F5C\u533A\u73B0\u6709\u7684\u663E\u5F0F\u5F00\u542F\uFF1B\u300C\u6E05\u9664\u5DE5\u4F5C\u533A\u7684\u5F00\u542F\u914D\u7F6E\u300D\u4F1A\u79FB\u9664\u5B83\u4EEC\u7684\u663E\u5F0F\u5F00\u542F\uFF0C\u5176\u5B83\u9ED8\u8BA4\u4E0D\u53D8\u3002" }), conflictError !== undefined && _jsx("div", { className: "skp-error", children: conflictError })] }))] }));
}
