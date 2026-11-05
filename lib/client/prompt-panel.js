import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * 能力面板 · Prompt 域（v23）：首轮注入的指令文件（AGENTS.md / CLAUDE.md / *.local.md）。
 *
 * 语义边界（与宿主 `prompt/manager.ts` 对齐，客户端只展示与写策略）：
 *   - **全局与项目 prompt 叠加注入**（不是覆盖），每个文件独立启用；
 *   - 列表只包含**已存在**的文件（宿主已过滤），不出现「未创建 / 未识别」占位；
 *   - 渲染 / trim 去重 / 预算截断 / framing 全部由宿主完成，客户端不算；
 *   - **行内开关位置与 Skills / MCP 一致**：
 *       · 全局视图：行内**没有**单开关；全局 prompt 的「可见范围 / 每工作区默认」
 *         在行尾「可见：…」chip 打开的弹层里配；
 *       · 工作区视图：全局 prompt 行尾开关 = **本工作区默认**（写
 *         `prompt.setVisibility`，保留 mode 与其它工作区，只改
 *         `workspaces[list.projectRoot].defaultEnabled`）；项目 prompt 行尾开关 =
 *         **本项目默认**（写 `prompt.setProjectDefault`，key 口径由宿主按 cwd 向上找 `.git`）；
 *   - **冻结会话**（`list.frozen !== undefined`）：详情只读、隐藏编辑与开关，提示
 *     「本会话已冻结」。
 *
 * 详情页沿用 v22 外壳（`detail-shell.tsx`）：标题行 / 状态条 / 内容工具条 / 内容区；
 * 预览用 `MarkdownPreview`，编辑用 `.skp-prompt-editor` textarea，保存后仅新会话生效。
 *
 * @module dsh-capability-settings/client/prompt-panel
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { DetailPage, DetailStrip, DetailTitleBar, StripSeparator } from "./detail-shell.js";
import { MarkdownPreview } from "./markdown.js";
import { Modal } from "./modal.js";
import { useAsyncList } from "./panel-common.js";
// ---------------------------------------------------------------------------
// 展示原语
// ---------------------------------------------------------------------------
/** 状态 pill 文案（宿主 `state` 字典）。 */
const STATE_LABEL = {
    injected: "注入",
    truncated: "预算截断",
    omitted: "预算省略",
    disabled: "关闭",
    invisible: "不可见",
    duplicate: "重复折叠",
    "too-large": "超 1 MB",
    unreadable: "不可读",
};
/** 状态 pill 色调：注入 = success；关闭 = 灰；其余（被预算 / 去重 / 不可读）= warn。 */
function stateToneClass(state) {
    if (state === "injected")
        return "skp-prompt-status skp-prompt-status-injected";
    if (state === "disabled" || state === "invisible")
        return "skp-prompt-status skp-prompt-status-disabled";
    return "skp-prompt-status skp-prompt-status-warn";
}
/** 可见范围模式文案。 */
const MODE_LABEL = {
    all: "全部工作区",
    selected: "指定工作区",
    none: "全部不可见",
};
/** 作用域标签（标题行 / 行内）。 */
function scopeTagOf(file) {
    if (file.scope === "user-global") {
        return { label: "全局", className: "skp-tag skp-tag-global", title: "全局 prompt（$DSH_HOME/AGENTS.md）" };
    }
    if (file.scope === "agents-global") {
        return { label: "全局", className: "skp-tag skp-tag-global", title: "全局 prompt（$DSH_AGENTS_HOME/AGENTS.md）" };
    }
    return { label: "项目", className: "skp-tag skp-tag-project", title: "项目链 prompt（git 根 → 工作区目录，逐级叠加注入）" };
}
/** 字节数（< 1 MiB 用千分位精确值，便于与宿主预算对齐）。 */
function formatSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0)
        return "—";
    if (bytes >= 1024 * 1024)
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${Math.round(bytes).toLocaleString("en-US")} B`;
}
/** 路径最后一段（工作区 / 项目展示名）。 */
function baseName(path) {
    const trimmed = path.replace(/[\\/]+$/, "");
    const at = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
    return at >= 0 ? trimmed.slice(at + 1) || trimmed : trimmed || path;
}
/** 行数（用于「仅预览 N 行」提示）。 */
function lineCount(text) {
    if (text.length === 0)
        return 0;
    return text.split("\n").length;
}
/** 错误对象转可读文案。 */
function errorText(failure) {
    return String(failure instanceof Error ? failure.message : failure);
}
/** 全局 prompt 的可见范围摘要（详情状态条 / 行内 chip 共用）。 */
function visibilitySummaryText(file, scope) {
    const visibility = file.visibility;
    if (visibility === undefined)
        return "可见：全部工作区";
    const base = visibility.mode === "none" ? "不可见" : visibility.mode === "selected" ? "指定工作区" : "全部工作区";
    if (scope === "global")
        return `可见：${base}`;
    return `可见：${base} · 本工作区默认${visibility.defaultEnabled ? "开" : "关"}`;
}
/** 当前工作区的可见性 key（宿主语义项目根：从 cwd 向上找 `.git`）。 */
function currentRootOf(data, workspace) {
    if (data !== undefined && data.projectRoot.length > 0)
        return data.projectRoot;
    if (workspace !== undefined && workspace.length > 0)
        return workspace;
    return data?.cwd ?? "";
}
/**
 * 收集某个全局 prompt 在**所有已知工作区**上的可见/默认状态。
 *
 * 为什么需要逐工作区拉一次 `prompt.list({cwd})`：客户端 API 只把「当前作用域」
 * 的解析结果挂在 `file.visibility` 里（`mode/visible/defaultEnabled` 三元组），
 * 没有整份 `workspaces` 映射；而 `prompt.setVisibility` 是**整份替换**。要满足
 * 「只改当前工作区、保留其它工作区」，只能先按工作区读回各自的有效值，再整份写回。
 * 失败的工作区按宿主默认（可见 + 默认启用）降级，不阻塞弹层。
 */
async function loadVisibilitySnapshot(api, file, projects, current) {
    const rows = [];
    const seen = new Set();
    const add = (row) => {
        if (row.root.length === 0 || seen.has(row.root))
            return;
        seen.add(row.root);
        rows.push(row);
    };
    // v23.1：宿主列表现在带回完整可见性映射（含未在面板下拉里出现的工作区 key），
    // 一次读取即可整份写回；读不到时再退回逐工作区拉取（旧宿主兼容）。
    try {
        const list = await api.prompt.list();
        const entry = list.visibility[file.scope];
        if (entry !== undefined) {
            if (current !== undefined)
                add({ ...current, current: true });
            const roots = new Set([
                ...Object.keys(entry.workspaces),
                ...projects.map((project) => project.path),
                ...(current !== undefined ? [current.root] : []),
            ]);
            for (const root of roots) {
                if (root.length === 0 || seen.has(root))
                    continue;
                const project = projects.find((item) => item.path === root);
                add({
                    root,
                    title: project?.title?.trim() ?? baseName(root),
                    path: project?.path ?? root,
                    visible: entry.workspaces[root]?.visible ?? (entry.mode === "selected" ? false : true),
                    defaultEnabled: entry.workspaces[root]?.defaultEnabled ?? true,
                    current: current !== undefined && current.root === root,
                });
            }
            return { mode: entry.mode, rows };
        }
    }
    catch {
        /* 旧宿主 / 服务缺失：退回逐工作区读取 */
    }
    if (current !== undefined)
        add({ ...current, current: true });
    const resolved = await Promise.all(projects.map(async (project) => {
        try {
            const list = await api.prompt.list({ cwd: project.path });
            const found = list.files.find((item) => item.id === file.id);
            return {
                root: list.projectRoot.length > 0 ? list.projectRoot : project.path,
                title: project.title?.trim() ?? baseName(project.path),
                path: project.path,
                visible: found?.visibility?.visible ?? true,
                defaultEnabled: found?.visibility?.defaultEnabled ?? true,
                current: false,
            };
        }
        catch {
            return {
                root: project.path,
                title: project.title?.trim() ?? baseName(project.path),
                path: project.path,
                visible: true,
                defaultEnabled: true,
                current: false,
            };
        }
    }));
    for (const row of resolved)
        add(row);
    return { mode: file.visibility?.mode ?? "all", rows };
}
/**
 * Prompt 详情（v22 外壳）：
 * 标题行（名称 / 作用域 / 状态）+ 状态条（第 N 位 / 字节 / 预算 / sha1 / 可见范围）
 * + 工具条（预览 / 编辑 / 复制路径）+ 内容区（Markdown 预览 / 文本编辑器）。
 */
function PromptDetail({ api, file, list, frozen, scope, projectName, readVersion, onSaved, onOpenVisibility, }) {
    const [read, setRead] = useState({ status: "loading" });
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(undefined);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(undefined);
    const [copied, setCopied] = useState(false);
    const [localVersion, setLocalVersion] = useState(0);
    const isFrozen = frozen !== undefined;
    const isProject = file.scope === "project";
    // 正文读取：选中 / 保存后重读；冻结会话仍可预览（只读）。
    useEffect(() => {
        let alive = true;
        setRead({ status: "loading" });
        void api.prompt
            .read({ path: file.path })
            .then((value) => {
            if (!alive)
                return;
            setRead({ status: "ready", content: value.content, truncated: value.truncated, size: value.size });
        })
            .catch((failure) => {
            if (!alive)
                return;
            setRead({ status: "error", message: errorText(failure) });
        });
        return () => {
            alive = false;
        };
    }, [api, file.path, readVersion, localVersion]);
    // 切换文件时清空编辑器草稿与错误（组件按 file.id 做 key，正常会重挂；防御旧宿主）。
    useEffect(() => {
        setEditing(false);
        setDraft(undefined);
        setSaveError(undefined);
    }, [file.path]);
    const content = read.status === "ready" ? read.content : undefined;
    const dirty = editing && draft !== undefined && content !== undefined && draft !== content;
    const canEdit = !isFrozen && read.status === "ready" && !saving;
    const frozenFile = frozen?.files.find((item) => item.id === file.id);
    const enabledFiles = useMemo(() => list.files.filter((item) => item.enabled), [list.files]);
    const enabledIndex = enabledFiles.findIndex((item) => item.id === file.id);
    const order = frozenFile?.order ?? file.order ?? (enabledIndex >= 0 ? enabledIndex + 1 : undefined);
    const orderTotal = frozen !== undefined ? frozen.files.length : enabledFiles.length;
    const orderText = order !== undefined && file.enabled ? `第 ${order} / ${orderTotal} 位` : file.enabled ? "已启用" : "未注入";
    const size = frozenFile?.bytes ?? (read.status === "ready" ? read.size : file.size);
    const digest = frozenFile?.digest;
    const visibilityText = isProject
        ? "仅本项目"
        : visibilitySummaryText(file, scope === "workspace" ? "workspace" : "global");
    // 状态说明（预算 / 去重 / 超限 / 读取失败），直接解释「为什么不是注入」。
    const stateNote = (() => {
        if (file.state === "duplicate") {
            return `内容与保留的那一份重复，宿主按候选组去重折叠（不单独注入）${file.duplicateOf !== undefined ? `：${file.duplicateOf}` : ""}`;
        }
        if (file.state === "truncated") {
            const item = frozen?.truncated.find((entry) => entry.displayPath === file.displayPath);
            return item !== undefined
                ? `被预算截断：原文 ${formatSize(item.originalBytes)}，实际注入 ${formatSize(item.includedBytes)}`
                : "被预算截断（预算不足时先省略更宽泛的文件，再截断最具体的）";
        }
        if (file.state === "omitted")
            return "被预算整份省略：预算不足时按「宽泛 → 具体」省略更宽泛的文件";
        if (file.state === "too-large") {
            return `单文件超过 1 MiB（${formatSize(size)}），宿主静默跳过：不注入，也不计入预算省略名单`;
        }
        if (file.state === "unreadable")
            return "读取失败：宿主跳过该文件（检查权限 / 编码后重试）";
        if (file.state === "invisible")
            return "全局可见性对本工作区关闭：不注入；如需打开，请在全局视图的「可见范围」里配置";
        if (file.state === "disabled")
            return "默认关闭：本工作区 / 本项目的新会话不注入该文件；开关在列表行尾";
        return undefined;
    })();
    const enterEdit = () => {
        if (!canEdit)
            return;
        setDraft((current) => current ?? content ?? "");
        setSaveError(undefined);
        setEditing(true);
    };
    const cancelEdit = () => {
        if (saving)
            return;
        setDraft(undefined);
        setEditing(false);
        setSaveError(undefined);
    };
    const save = async () => {
        if (draft === undefined || saving)
            return;
        if (content === draft) {
            cancelEdit();
            return;
        }
        setSaving(true);
        setSaveError(undefined);
        try {
            await api.prompt.save({ path: file.path, content: draft });
            setDraft(undefined);
            setEditing(false);
            setLocalVersion((value) => value + 1);
            onSaved();
        }
        catch (failure) {
            setSaveError(errorText(failure));
        }
        finally {
            setSaving(false);
        }
    };
    const copyPath = async () => {
        try {
            await navigator.clipboard?.writeText(file.path);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        }
        catch {
            /* 剪贴板不可用时静默 */
        }
    };
    const draftBytes = useMemo(() => {
        if (draft === undefined)
            return 0;
        try {
            return new TextEncoder().encode(draft).length;
        }
        catch {
            return draft.length;
        }
    }, [draft]);
    const titleTags = (_jsxs(_Fragment, { children: [_jsx("span", { className: scopeTagOf(file).className, title: scopeTagOf(file).title, children: scopeTagOf(file).label }), file.kind === "local" && (_jsx("span", { className: "skp-tag skp-tag-flat", title: "\u672C\u5730\u8986\u76D6\u6587\u4EF6\uFF08\u4E0E\u57FA\u7840\u6587\u4EF6\u53E0\u52A0\u6CE8\u5165\uFF09", children: "local" })), _jsx("span", { className: stateToneClass(file.state), title: `宿主状态：${STATE_LABEL[file.state]}`, children: STATE_LABEL[file.state] }), isFrozen && _jsx("span", { className: "skp-tag skp-tag-flat", children: "\u672C\u4F1A\u8BDD\u5DF2\u51BB\u7ED3" })] }));
    return (_jsxs(DetailPage, { children: [_jsxs("div", { className: "skp-detail-head-wrap", children: [_jsx(DetailTitleBar, { title: file.name, tags: titleTags }), _jsxs(DetailStrip, { children: [_jsx("span", { className: "skp-strip-item skp-strip-ellipsis", title: file.path, children: file.displayPath }), _jsx(StripSeparator, {}), _jsx("span", { className: "skp-strip-item", children: file.enabled ? (_jsxs(_Fragment, { children: ["\u7B2C ", _jsx("span", { className: "skp-strip-strong", children: order ?? "—" }), " / ", orderTotal, " \u4F4D"] })) : (orderText) }), _jsx(StripSeparator, {}), _jsxs("span", { className: "skp-strip-item", title: `文件字节数 / 渲染预算`, children: [formatSize(size), " / ", formatSize(list.budget.maxBytes)] }), digest !== undefined && digest.length > 0 && (_jsxs(_Fragment, { children: [_jsx(StripSeparator, {}), _jsxs("span", { className: "skp-strip-item", title: "\u672C\u4F1A\u8BDD\u51BB\u7ED3\u6E05\u5355\u91CC\u7684\u5168\u6587 SHA-1", children: ["sha1 ", _jsx("span", { className: "skp-strip-strong", children: digest.slice(0, 8) })] })] })), !isProject && (_jsxs(_Fragment, { children: [_jsx(StripSeparator, {}), _jsx("span", { className: "skp-strip-item", title: file.path, children: visibilityText })] })), frozen !== undefined && (_jsxs(_Fragment, { children: [_jsx(StripSeparator, {}), _jsxs("span", { className: "skp-strip-item", children: ["\u51BB\u7ED3\u4E8E ", new Date(frozen.at).toLocaleTimeString()] })] })), !isProject && !isFrozen && scope === "global" && (_jsx("span", { className: "skp-strip-right", children: _jsx("button", { type: "button", className: "skp-strip-meta-btn", title: "\u6309\u5DE5\u4F5C\u533A\u914D\u7F6E\u53EF\u89C1\u8303\u56F4\u4E0E\u9ED8\u8BA4\u542F\u7528", onClick: onOpenVisibility, children: "\u7F16\u8F91\u53EF\u89C1\u8303\u56F4" }) }))] })] }), _jsxs("div", { className: "skp-detail-toolbar", children: [_jsx("button", { type: "button", className: editing ? "skp-btn" : "skp-btn skp-btn-primary", disabled: saving, onClick: () => {
                            if (saving)
                                return;
                            setEditing(false);
                            setSaveError(undefined);
                        }, children: "\u9884\u89C8" }), !isFrozen && (_jsx("button", { type: "button", className: editing ? "skp-btn skp-btn-primary" : "skp-btn", disabled: !canEdit, title: "\u7F16\u8F91 prompt \u6B63\u6587", onClick: enterEdit, children: "\u7F16\u8F91" })), _jsx("span", { className: "skp-toolbar-stat", children: isFrozen
                            ? "只读 · 本会话已冻结"
                            : editing
                                ? dirty
                                    ? "草稿未保存"
                                    : "无改动"
                                : read.status === "ready"
                                    ? `${lineCount(read.content)} 行`
                                    : read.status === "loading"
                                        ? "读取中…"
                                        : "正文不可用" }), _jsxs("span", { className: "skp-toolbar-right", children: [_jsx("button", { type: "button", className: "skp-btn", onClick: () => void copyPath(), children: copied ? "已复制路径" : "复制路径" }), editing && (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "skp-btn", disabled: saving, onClick: cancelEdit, children: "\u53D6\u6D88" }), _jsx("button", { type: "button", className: "skp-btn skp-btn-primary", disabled: saving || !dirty, title: dirty ? "保存到原文件（原子写）；只影响新会话" : "没有改动", onClick: () => void save(), children: saving ? "保存中…" : "保存" })] }))] })] }), _jsxs("div", { className: "skp-detail-body", children: [isFrozen && (_jsxs("div", { className: "skp-detail-readonly", children: [_jsx("span", { className: "skp-detail-readonly-icon", "aria-hidden": "true", children: "i" }), _jsx("span", { children: "\u672C\u4F1A\u8BDD\u5DF2\u51BB\u7ED3\uFF1A\u9996\u8F6E\u6CE8\u5165\u7684\u5185\u5BB9\u5728\u4F1A\u8BDD\u5F00\u59CB\u65F6\u56FA\u5B9A\uFF0C\u8BE6\u60C5\u53EA\u8BFB\uFF08\u7F16\u8F91\u4E0E\u5F00\u5173\u5DF2\u9690\u85CF\uFF09\u3002\u6539\u52A8\u53EA\u5F71\u54CD\u65B0\u4F1A\u8BDD\u3002" })] })), saveError !== undefined && _jsxs("div", { className: "skp-error", children: ["\u4FDD\u5B58\u5931\u8D25\uFF1A", saveError] }), read.status === "error" && (_jsxs("div", { className: "skp-error", children: ["\u8BFB\u53D6\u5931\u8D25\uFF1A", read.message, (file.state === "too-large" || size > 1024 * 1024) && "（文件超过 1 MiB，宿主会跳过注入，不支持预览 / 编辑）"] })), stateNote !== undefined && file.state !== "injected" && (_jsx("div", { className: "skp-note skp-note-warn", style: { marginBottom: 8 }, children: stateNote })), read.status === "loading" && !editing ? (_jsx("div", { className: "skp-detail-loading", children: "\u8BFB\u53D6\u4E2D\u2026" })) : editing ? (_jsxs("div", { className: "skp-prompt-editor-wrap", children: [_jsx("textarea", { className: "skp-prompt-editor", "aria-label": `编辑 ${file.name}`, spellCheck: false, value: draft ?? "", onChange: (event) => setDraft(event.target.value) }), _jsxs("div", { className: "skp-prompt-editor-meta", children: [_jsxs("span", { children: [formatSize(draftBytes), " \u00B7 ", lineCount(draft ?? ""), " \u884C"] }), dirty && _jsx("span", { className: "skp-prompt-warn", children: "\u672A\u4FDD\u5B58" }), _jsx("span", { style: { marginLeft: "auto" }, children: "\u4FDD\u5B58\u540E\u4EC5\u5BF9\u65B0\u4F1A\u8BDD\u751F\u6548" })] })] })) : read.status === "ready" ? (_jsxs("div", { style: { flex: "1 1 auto", minHeight: 0, overflowY: "auto", paddingRight: 4 }, children: [_jsx(MarkdownPreview, { source: read.content }), _jsxs("div", { className: "skp-prompt-editor-meta", style: { marginTop: 10 }, children: [_jsxs("span", { children: ["\u4EC5\u9884\u89C8 ", read.content.length > 255 * 1024 ? "前 256 KB" : "全文", " \u00B7 ", lineCount(read.content), " \u884C"] }), read.truncated && _jsx("span", { className: "skp-prompt-warn", children: "\u6B63\u6587\u8D85\u51FA\u9884\u89C8\u4E0A\u9650\uFF0C\u5DF2\u622A\u65AD\u663E\u793A" })] })] })) : null, _jsxs("div", { className: "skp-prompt-note", style: { marginTop: 10, flex: "none" }, children: [_jsx("span", { className: "skp-prompt-note-title", children: "\u4FDD\u5B58\u540E\uFF1A\u4EC5\u5BF9\u65B0\u4F1A\u8BDD\u751F\u6548" }), _jsx("span", { children: "\u65B0\u4F1A\u8BDD\u9996\u6B21\u8BFB\u53D6\u65B0\u5185\u5BB9\uFF1B\u5F53\u524D\u4F1A\u8BDD\u4FDD\u6301\u51BB\u7ED3\uFF08\u5DF2\u6CE8\u5165\u7684 prompt \u4E0D\u53D8\uFF09\u3002\u5F53\u524D\u4F1A\u8BDD\u7684\u6CE8\u5165\u9009\u62E9\u5728\u5BF9\u8BDD\u9996\u5C4F / \u4F1A\u8BDD\u300C\u80FD\u529B\u300D Tab \u91CC\u5355\u72EC\u8C03\u6574\u3002" })] })] })] }));
}
// ---------------------------------------------------------------------------
// 可见范围弹层
// ---------------------------------------------------------------------------
/** 整份写回时用的状态 key（顺序无关的 dirty 判定）。 */
function snapshotKey(mode, rows) {
    return `${mode}|${rows
        .map((row) => `${row.root}:${row.visible ? 1 : 0}:${row.defaultEnabled ? 1 : 0}`)
        .join(",")}`;
}
/**
 * 全局 prompt 的「可见范围」弹层（v23 帧 04）：
 * mode 三选（全部工作区 / 指定工作区 / 全部不可见）+ 每工作区的「可见 / 默认启用」两列；
 * 保存写 `prompt.setVisibility`（**整份替换**那个 scope 的配置）。
 */
function PromptVisibilityModal({ api, file, scope, projects, current, onClose, onSaved, }) {
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(undefined);
    const [initial, setInitial] = useState(undefined);
    const [mode, setMode] = useState("all");
    const [rows, setRows] = useState([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(undefined);
    useEffect(() => {
        let alive = true;
        setLoading(true);
        setLoadError(undefined);
        void loadVisibilitySnapshot(api, file, projects, current)
            .then((snapshot) => {
            if (!alive)
                return;
            setInitial(snapshot);
            setMode(snapshot.mode);
            setRows(snapshot.rows);
            setLoading(false);
        })
            .catch((failure) => {
            if (!alive)
                return;
            setLoadError(errorText(failure));
            setLoading(false);
        });
        return () => {
            alive = false;
        };
        // `current` 每个 render 都是新对象；用其 key 值作为依赖，避免弹层反复重载。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, file.id, projects, current?.root]);
    const dirty = initial !== undefined && (mode !== initial.mode || snapshotKey(mode, rows) !== snapshotKey(initial.mode, initial.rows));
    const setRow = (root, patch) => {
        setRows((prev) => prev.map((row) => (row.root === root ? { ...row, ...patch } : row)));
    };
    const save = async () => {
        if (saving || !dirty || file.scope === "project")
            return;
        setSaving(true);
        setError(undefined);
        try {
            const workspaces = {};
            for (const row of rows) {
                workspaces[row.root] = row.visible
                    ? { visible: true, defaultEnabled: row.defaultEnabled }
                    : { visible: false };
            }
            await api.prompt.setVisibility({ scope: file.scope, mode, workspaces });
            onSaved();
        }
        catch (failure) {
            setError(errorText(failure));
        }
        finally {
            setSaving(false);
        }
    };
    const note = mode === "none"
        ? "不可见：该工作区的任何会话都不能注入这个 prompt；会话首屏不能反向打开。"
        : mode === "selected"
            ? "仅勾选的工作区可见；新工作区默认不可见，需回来手动勾选。"
            : "全部工作区可见；可用「可见」列单独隐藏某个工作区。新工作区默认可见。";
    return (_jsx(Modal, { title: `${file.name} · 全局可见范围`, wide: true, onClose: onClose, header: _jsxs(_Fragment, { children: [_jsx("div", { className: "skp-vis-tip", title: file.path, children: file.displayPath }), _jsx("div", { className: "skp-vis-modal-note", children: "\u53EF\u89C1 = \u8BE5\u5DE5\u4F5C\u533A\u7684\u4F1A\u8BDD\u53EF\u4EE5\u6CE8\u5165\u8FD9\u4E2A prompt\uFF1B\u9ED8\u8BA4 = \u53EF\u89C1\u65F6\u662F\u5426\u9ED8\u8BA4\u542F\u7528\uFF08\u4F1A\u8BDD\u9996\u5C4F\u53EF\u518D\u5355\u72EC\u6539\uFF09\u3002" }), _jsx("div", { className: "skp-scope-seg", role: "group", "aria-label": "\u53EF\u89C1\u8303\u56F4\u6A21\u5F0F", children: Object.keys(MODE_LABEL).map((value) => (_jsx("button", { type: "button", className: mode === value ? "skp-scope-seg-btn skp-scope-seg-btn-active" : "skp-scope-seg-btn", "aria-pressed": mode === value, disabled: saving || loading, onClick: () => setMode(value), children: MODE_LABEL[value] }, value))) }), _jsx("div", { className: "skp-vis-modal-note", children: note }), loadError !== undefined && _jsxs("div", { className: "skp-error", children: ["\u53EF\u89C1\u6027\u8BFB\u53D6\u5931\u8D25\uFF1A", loadError] }), error !== undefined && _jsx("div", { className: "skp-error", children: error })] }), footer: _jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "skp-btn", disabled: saving, onClick: onClose, children: "\u53D6\u6D88" }), _jsx("button", { type: "button", className: dirty && !saving ? "skp-btn skp-btn-primary" : "skp-btn", disabled: saving || loading || !dirty, title: dirty ? "保存可见范围与每工作区默认" : "没有改动", onClick: () => void save(), children: saving ? "保存中…" : "保存" })] }), children: loading ? (_jsx("div", { className: "skp-status", children: "\u8BFB\u53D6\u5404\u5DE5\u4F5C\u533A\u53EF\u89C1\u6027\u2026" })) : rows.length === 0 ? (_jsx("div", { className: "skp-note", children: "\u8FD8\u6CA1\u6709\u5DF2\u77E5\u5DE5\u4F5C\u533A\uFF1B\u65B0\u5EFA\u5DE5\u4F5C\u533A\u540E\u518D\u6765\u914D\u7F6E\u3002" })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "skp-prompt-vis-row", style: { background: "transparent", boxShadow: "none", padding: "0 12px" }, children: [_jsx("span", { className: "skp-prompt-vis-name", style: { fontWeight: 600 }, children: "\u5DE5\u4F5C\u533A" }), _jsx("span", { className: "skp-prompt-vis-path", style: { fontWeight: 600 }, children: "\u9879\u76EE\u6839\uFF08\u53EF\u89C1\u6027 key\uFF09" }), _jsx("span", { className: "skp-prompt-vis-name", style: { flex: "none", width: 70, textAlign: "center" }, children: "\u53EF\u89C1" }), _jsx("span", { className: "skp-prompt-vis-name", style: { flex: "none", width: 90, textAlign: "right" }, children: "\u9ED8\u8BA4\u542F\u7528" })] }), _jsx("div", { role: "table", "aria-label": "\u5404\u5DE5\u4F5C\u533A\u53EF\u89C1\u6027\u4E0E\u9ED8\u8BA4\u542F\u7528", children: rows.map((row) => (_jsxs("div", { className: "skp-prompt-vis-row", role: "row", title: row.root, children: [_jsxs("span", { className: "skp-prompt-vis-name", role: "cell", title: row.title, children: [row.title, row.current && (_jsx("span", { className: "skp-tag skp-tag-flat", style: { marginLeft: 6 }, children: "\u5F53\u524D" }))] }), _jsx("span", { className: "skp-prompt-vis-path", role: "cell", title: row.path, children: row.root }), _jsx("span", { role: "cell", style: { flex: "none", width: 70, display: "flex", justifyContent: "center" }, children: _jsxs("label", { className: "skp-vis-check", title: "\u8BE5\u5DE5\u4F5C\u533A\u53EF\u89C1\uFF08\u53EF\u89C1\u6027\u9AD8\u4F18\u5148\u7EA7\u63A7\u5236\uFF09", children: [_jsx("input", { type: "checkbox", checked: row.visible, disabled: saving || mode === "none", "aria-label": `${row.title} 可见`, onChange: (event) => setRow(row.root, { visible: event.target.checked }) }), _jsx("span", { className: "skp-sr-only", children: "\u53EF\u89C1" })] }) }), _jsx("span", { role: "cell", style: { flex: "none", width: 90, display: "flex", justifyContent: "flex-end" }, children: _jsx("label", { className: "skp-row-toggle", title: row.visible ? "该工作区的默认开 / 关（工作区视图仍可覆盖）" : "不可见时默认开关不生效", children: _jsxs("span", { className: "skp-switch", children: [_jsx("input", { type: "checkbox", role: "switch", "aria-label": `${row.title} 默认启用`, checked: row.visible && row.defaultEnabled, disabled: saving || mode === "none" || !row.visible, onChange: (event) => setRow(row.root, { defaultEnabled: event.target.checked }) }), _jsx("span", { className: "skp-switch-track" })] }) }) })] }, row.root))) }), _jsx("div", { className: "skp-note", children: "\u4E0D\u53EF\u89C1 \u21D2 \u8BE5\u5DE5\u4F5C\u533A\u7684\u4EFB\u4F55\u4F1A\u8BDD\u90FD\u4E0D\u80FD\u6CE8\u5165\uFF1B\u4F1A\u8BDD\u9996\u5C4F\u4E0D\u80FD\u53CD\u5411\u6253\u5F00\u3002\u9ED8\u8BA4\u542F\u7528\u53EA\u5728\u53EF\u89C1\u65F6\u751F\u6548\u3002" })] })) }));
}
// ---------------------------------------------------------------------------
// Prompt 域视图
// ---------------------------------------------------------------------------
/**
 * Prompt 域视图：两栏（文件名列表 + 详情 / 编辑器）。
 *
 * - 全局视图：只列**全局** prompt（`file.scope !== "project"`）；行尾是「可见：…」chip；
 * - 工作区视图：全局 prompt（叠加注入）+ 项目链 prompt；行尾开关写默认层；
 * - 搜索来自根组件头部输入框（`query` prop），只过滤当前列表。
 *
 * @param query 根组件头部搜索框的当前值。
 * @param workspace 当前工作区路径（undefined = 全局视图）。
 * @param projects 全部已知工作区（可见范围弹层用）。
 */
export function PromptView({ api, workspace, projects = [], query, onCount, }) {
    const promptSupported = typeof api.prompt?.list === "function";
    const scope = workspace === undefined ? "global" : "workspace";
    const projectName = workspace === undefined
        ? undefined
        : (projects.find((project) => project.path === workspace)?.title?.trim() ?? baseName(workspace));
    const [selectedId, setSelectedId] = useState(undefined);
    const [busyId, setBusyId] = useState(undefined);
    const [opError, setOpError] = useState(undefined);
    const [visibilityFile, setVisibilityFile] = useState(undefined);
    const [readVersion, setReadVersion] = useState(0);
    const rowRefs = useRef(new Map());
    /** 可见性快照缓存（按文件 id；写操作后失效）。 */
    const visibilityCache = useRef(new Map());
    const { data, loading, error, reload } = useAsyncList(async () => typeof api.prompt?.list === "function"
        ? api.prompt.list()
        : {
            files: [],
            cwd: "",
            projectRoot: "",
            budget: { maxBytes: 65536, maxSourceBytes: 1048576 },
            engineAvailable: false,
            visibility: {},
            frozen: undefined,
            errors: ["Prompt 域不可用（宿主未提供 prompt API）"],
        }, [api, workspace, scope], { cacheKey: `prompt:${workspace ?? "global"}` });
    // 切换作用域后，可见性快照里「当前工作区」的 key 会变，必须失效缓存。
    useEffect(() => {
        visibilityCache.current.clear();
    }, [workspace]);
    const files = useMemo(() => data?.files ?? [], [data]);
    const isFrozen = data?.frozen !== undefined;
    /** 当前作用域展示的文件：全局视图只看全局 prompt；工作区视图两者叠加。 */
    const scopedFiles = useMemo(() => (scope === "global" ? files.filter((file) => file.scope !== "project") : files), [files, scope]);
    const globalFiles = useMemo(() => scopedFiles.filter((file) => file.scope !== "project"), [scopedFiles]);
    const projectFiles = useMemo(() => scopedFiles.filter((file) => file.scope === "project"), [scopedFiles]);
    const enabledCount = useMemo(() => scopedFiles.filter((file) => file.enabled).length, [scopedFiles]);
    // Tab 计数 = 当前作用域已启用文件数（搜索不影响计数；加载中不覆盖）。
    useEffect(() => {
        if (!loading && error === undefined)
            onCount?.(enabledCount);
    }, [enabledCount, loading, error, onCount]);
    // 首次到达 / 选中项消失时选中第一项。
    useEffect(() => {
        if (scopedFiles.length === 0) {
            if (selectedId !== undefined)
                setSelectedId(undefined);
            return;
        }
        if (selectedId !== undefined && scopedFiles.some((file) => file.id === selectedId))
            return;
        setSelectedId(scopedFiles[0]?.id);
    }, [scopedFiles, selectedId]);
    const q = query.trim().toLowerCase();
    const matches = (file) => {
        if (q.length === 0)
            return true;
        return (file.name.toLowerCase().includes(q) ||
            file.displayPath.toLowerCase().includes(q) ||
            file.path.toLowerCase().includes(q));
    };
    const matchedFiles = useMemo(() => scopedFiles.filter(matches), [scopedFiles, q]);
    const matchedGlobal = matchedFiles.filter((file) => file.scope !== "project");
    const matchedProject = matchedFiles.filter((file) => file.scope === "project");
    const selected = scopedFiles.find((file) => file.id === selectedId);
    /** 行尾开关的勾选态：全局 prompt = 本工作区默认；项目 prompt = 本项目默认。 */
    const checkedOf = (file) => {
        if (file.scope === "project")
            return file.defaultEnabled;
        return file.visibility?.defaultEnabled ?? file.defaultEnabled;
    };
    const toggleDisabledOf = (file) => {
        if (busyId === file.id)
            return true;
        // 全局 prompt 对本工作区不可见时，工作区视图不能反向打开（可见性是更上层的 gate）。
        if (file.scope !== "project" && file.state === "invisible")
            return true;
        return false;
    };
    const switchTitleOf = (file) => {
        if (file.scope === "project") {
            return checkedOf(file)
                ? "关闭：本项目的新会话默认不注入该文件（写项目级默认；其它项目不受影响）"
                : "打开：本项目的新会话默认注入该文件（写项目级默认）";
        }
        if (file.state === "invisible") {
            return "该全局 prompt 对本工作区不可见：先到全局视图的「可见范围」里打开可见性";
        }
        return checkedOf(file)
            ? "关闭：本工作区的新会话默认不注入该文件（只改本工作区的默认，保留可见范围与其它工作区）"
            : "打开：本工作区的新会话默认注入该文件（只改本工作区的默认，保留可见范围与其它工作区）";
    };
    /** 当前工作区可见性快照（弹层与「本工作区默认」开关共用）。 */
    const currentVisibilityRow = (file) => {
        if (scope !== "workspace" || data === undefined)
            return undefined;
        const root = currentRootOf(data, workspace);
        if (root.length === 0)
            return undefined;
        return {
            root,
            title: projectName ?? baseName(root),
            path: workspace ?? data.cwd,
            visible: file.visibility?.visible ?? true,
            defaultEnabled: file.visibility?.defaultEnabled ?? true,
        };
    };
    const snapshotFor = async (file) => {
        const cached = visibilityCache.current.get(file.id);
        if (cached !== undefined)
            return cached;
        const snapshot = await loadVisibilitySnapshot(api, file, projects, currentVisibilityRow(file));
        visibilityCache.current.set(file.id, snapshot);
        return snapshot;
    };
    /**
     * 写行尾开关：
     *   - 项目 prompt → `prompt.setProjectDefault`（宿主按 cwd 向上找 `.git` 算项目根）；
     *   - 全局 prompt（工作区视图）→ `prompt.setVisibility`：保留 mode 与其它工作区，
     *     只改 `workspaces[list.projectRoot].defaultEnabled`。
     */
    const toggleFile = async (file, next) => {
        if (isFrozen || busyId !== undefined)
            return;
        if (file.scope !== "project" && file.state === "invisible")
            return;
        setBusyId(file.id);
        setOpError(undefined);
        try {
            if (file.scope === "project") {
                const cwd = workspace ?? data?.cwd;
                await api.prompt.setProjectDefault({
                    ...(cwd !== undefined && cwd.length > 0 ? { cwd } : {}),
                    path: file.path,
                    enabled: next,
                });
            }
            else {
                if (data === undefined)
                    return;
                const snapshot = await snapshotFor(file);
                const root = currentRootOf(data, workspace);
                if (root.length === 0) {
                    setOpError("无法确定当前工作区对应的项目根，暂不能写默认开关");
                    return;
                }
                const rows = snapshot.rows.some((row) => row.root === root)
                    ? snapshot.rows
                    : [
                        ...snapshot.rows,
                        {
                            root,
                            title: projectName ?? baseName(root),
                            path: workspace ?? data.cwd,
                            visible: file.visibility?.visible ?? true,
                            defaultEnabled: file.visibility?.defaultEnabled ?? true,
                            current: true,
                        },
                    ];
                const workspaces = {};
                for (const row of rows) {
                    workspaces[row.root] = row.visible
                        ? { visible: true, defaultEnabled: row.root === root ? next : row.defaultEnabled }
                        : { visible: false };
                }
                await api.prompt.setVisibility({ scope: file.scope, mode: snapshot.mode, workspaces });
            }
            visibilityCache.current.delete(file.id);
            reload({ silent: true });
        }
        catch (failure) {
            setOpError(errorText(failure));
        }
        finally {
            setBusyId(undefined);
        }
    };
    const focusRow = (id) => {
        const element = rowRefs.current.get(id);
        element?.focus();
        element?.scrollIntoView({ block: "nearest" });
    };
    const onRowKeyDown = (event, id) => {
        if (matchedFiles.length === 0)
            return;
        const index = matchedFiles.findIndex((file) => file.id === id);
        if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
            event.preventDefault();
            const next = event.key === "Home"
                ? 0
                : event.key === "End"
                    ? matchedFiles.length - 1
                    : event.key === "ArrowDown"
                        ? Math.min(matchedFiles.length - 1, index + 1)
                        : Math.max(0, index - 1);
            const nextId = matchedFiles[next]?.id;
            if (nextId !== undefined) {
                setSelectedId(nextId);
                requestAnimationFrame(() => focusRow(nextId));
            }
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            setSelectedId(id);
        }
    };
    /** 单行：dot + 名称 + 作用域 + displayPath + 状态 pill；行尾按作用域给开关 / 可见性 chip。 */
    const renderRow = (file) => {
        const active = file.id === selectedId;
        const isProject = file.scope === "project";
        const scopeTag = scopeTagOf(file);
        const checked = checkedOf(file);
        const disabled = toggleDisabledOf(file);
        const chipMode = file.visibility?.mode ?? "all";
        return (_jsxs("li", { className: active ? "skp-row-wrap skp-row-wrap-active" : "skp-row-wrap", children: [_jsxs("button", { type: "button", role: "option", "aria-selected": active, tabIndex: active ? 0 : -1, className: active ? "skp-row skp-row-active" : "skp-row", ref: (element) => {
                        if (element === null)
                            rowRefs.current.delete(file.id);
                        else
                            rowRefs.current.set(file.id, element);
                    }, onClick: () => setSelectedId(file.id), onKeyDown: (event) => onRowKeyDown(event, file.id), children: [_jsxs("span", { className: "skp-row-name", children: [_jsx("span", { className: file.enabled ? "skp-dot skp-dot-enabled" : "skp-dot skp-dot-hollow", "aria-hidden": "true" }), _jsx("span", { className: "skp-row-title", title: file.name, children: file.name }), _jsx("span", { className: scopeTag.className, title: scopeTag.title, children: scopeTag.label }), file.kind === "local" && (_jsx("span", { className: "skp-tag skp-tag-flat", title: "\u672C\u5730\u8986\u76D6\u6587\u4EF6\uFF08\u4E0E\u57FA\u7840\u6587\u4EF6\u53E0\u52A0\u6CE8\u5165\uFF09", children: "local" }))] }), _jsx("span", { className: "skp-row-desc", title: file.displayPath, style: { fontFamily: "var(--ds-font-family-code,ui-monospace,monospace)", fontSize: 11, lineHeight: "16px" }, children: file.displayPath }), _jsxs("span", { className: "skp-row-meta", children: [_jsx("span", { className: stateToneClass(file.state), title: `宿主状态：${STATE_LABEL[file.state]}`, children: STATE_LABEL[file.state] }), _jsx("span", { children: formatSize(file.size) }), isFrozen && file.order !== undefined && _jsxs("span", { children: ["\u7B2C ", file.order, " \u4F4D"] }), file.duplicateOf !== undefined && (_jsxs("span", { title: file.duplicateOf, children: ["\u6298\u53E0\u81EA ", baseName(file.duplicateOf)] }))] })] }), scope === "global" && !isFrozen && (_jsxs("button", { type: "button", className: "skp-tag skp-tag-flat", title: `可见范围：${visibilitySummaryText(file, "global")}（点击按工作区配置可见与默认）`, onClick: () => setVisibilityFile(file), children: ["\u53EF\u89C1\uFF1A", MODE_LABEL[chipMode], " \u25BE"] })), scope === "workspace" && !isFrozen && (file.state === "duplicate" ? (_jsx("span", { className: "skp-row-default-label", title: "\u540C\u5019\u9009\u7EC4\u5185\u5BB9\u91CD\u590D\uFF0C\u5BBF\u4E3B\u81EA\u52A8\u6298\u53E0\uFF1B\u4E0D\u5355\u72EC\u6CE8\u5165\uFF0C\u56E0\u6B64\u6CA1\u6709\u72EC\u7ACB\u5F00\u5173", children: "\u81EA\u52A8\u5408\u5E76" })) : (_jsx("label", { className: "skp-row-toggle", title: switchTitleOf(file), children: _jsxs("span", { className: "skp-switch", children: [_jsx("input", { type: "checkbox", role: "switch", "aria-label": `${file.name} ${isProject ? "本项目默认启用" : "本工作区默认启用"}`, checked: checked, disabled: disabled, onChange: (event) => void toggleFile(file, event.target.checked) }), _jsx("span", { className: "skp-switch-track" })] }) })))] }, file.id));
    };
    const renderGroupHead = (title, count, note) => (_jsxs("div", { className: "skp-prompt-group-head", children: [_jsx("span", { children: title }), _jsx("span", { className: "skp-group-count", children: count }), _jsx("span", { className: "skp-prompt-group-note", children: note })] }));
    const listTitle = scope === "global" ? "全局 Prompt" : `${projectName ?? "工作区"} · Prompt`;
    const listNote = scope === "global" ? "所有工作区" : "仅此工作区";
    const projectRootName = data !== undefined && data.projectRoot.length > 0 ? baseName(data.projectRoot) : (projectName ?? "项目");
    const renderListBody = () => {
        if (loading && data === undefined)
            return _jsx("div", { className: "skp-status", children: "\u52A0\u8F7D\u4E2D\u2026" });
        if (error !== undefined)
            return _jsxs("div", { className: "skp-error", children: ["\u8BFB\u53D6\u5931\u8D25\uFF1A", error] });
        if (scopedFiles.length === 0) {
            return (_jsxs("div", { className: "skp-empty", children: [scope === "global"
                        ? "还没有已存在的全局 prompt 文件（$DSH_HOME/AGENTS.md、$DSH_AGENTS_HOME/AGENTS.md）。"
                        : "此工作区还没有已存在的 prompt 文件（项目根到工作区目录的 AGENTS.md / CLAUDE.md / *.local.md）。", _jsx("div", { className: "skp-pane-note", children: "\u5217\u8868\u53EA\u663E\u793A\u5DF2\u5B58\u5728\u4E14\u88AB\u5BBF\u4E3B\u8BC6\u522B\u7684\u6587\u4EF6\uFF1B\u672A\u521B\u5EFA\u7684\u6587\u4EF6\u4E0D\u4F1A\u51FA\u73B0\u3002" })] }));
        }
        if (matchedFiles.length === 0)
            return _jsxs("div", { className: "skp-empty", children: ["\u6CA1\u6709\u5339\u914D\u300C", query.trim(), "\u300D\u7684 prompt \u6587\u4EF6\u3002"] });
        return (_jsxs("div", { className: "skp-group-scroll skp-group-scroll-plain", children: [matchedGlobal.length > 0 && (_jsxs(_Fragment, { children: [renderGroupHead("全局（叠加注入）", globalFiles.length, scope === "global" ? "可见范围按工作区配置" : "叠加注入 · 行尾开关 = 本工作区默认"), _jsx("ul", { className: "skp-list", role: "listbox", "aria-label": "\u5168\u5C40 Prompt", children: matchedGlobal.map(renderRow) })] })), scope === "workspace" && matchedProject.length > 0 && (_jsxs(_Fragment, { children: [renderGroupHead(`项目链 · ${projectRootName}`, projectFiles.length, "git 根 → 工作区目录 · 行尾开关 = 本项目默认"), _jsx("ul", { className: "skp-list", role: "listbox", "aria-label": "\u9879\u76EE\u94FE Prompt", children: matchedProject.map(renderRow) })] }))] }));
    };
    if (!promptSupported) {
        return (_jsx("div", { className: "skp-status", role: "status", children: "Prompt \u57DF\u4E0D\u53EF\u7528\uFF08\u5BBF\u4E3B\u7248\u672C\u8F83\u65E7\u6216\u670D\u52A1\u672A\u5C31\u7EEA\uFF09" }));
    }
    const engineAvailable = data?.engineAvailable !== false;
    const visibilityCurrent = visibilityFile === undefined ? undefined : currentVisibilityRow(visibilityFile);
    return (_jsxs("div", { className: "skp-domain", children: [opError !== undefined && _jsx("div", { className: "skp-error", children: opError }), error !== undefined && _jsxs("div", { className: "skp-error", children: ["\u8BFB\u53D6\u5931\u8D25\uFF1A", error] }), error === undefined && data !== undefined && data.errors.length > 0 && (_jsx("div", { className: "skp-error", children: data.errors.join("\n") })), error === undefined && data !== undefined && !engineAvailable && (_jsxs("div", { className: "skp-prompt-note", style: { margin: "8px 0" }, children: [_jsx("span", { className: "skp-prompt-note-title", children: "\u5BBF\u4E3B\u6E32\u67D3\u5668\u4E0D\u53EF\u7528" }), _jsx("span", { children: "\u672C\u673A\u5BBF\u4E3B\u6E32\u67D3\u5668\u4E0D\u53EF\u7528\uFF1Aprompt \u5F00\u5173\u6682\u4E0D\u751F\u6548\uFF0C\u6CE8\u5165\u4ECD\u7531\u5BBF\u4E3B\u9ED8\u8BA4\u884C\u4E3A\u63D0\u4F9B\u3002" })] })), loading && data === undefined && _jsx("div", { className: "skp-status", children: "\u52A0\u8F7D\u4E2D\u2026" }), data !== undefined && error === undefined && (_jsxs("div", { className: "skp-body", children: [_jsxs("div", { className: "skp-list-pane", children: [_jsxs("div", { className: "skp-list-head", children: [_jsx("span", { className: "skp-list-title", title: listTitle, children: listTitle }), _jsx("span", { className: "skp-group-count", title: "\u5F53\u524D\u4F5C\u7528\u57DF\u5DF2\u5B58\u5728\u7684\u6587\u4EF6\u6570", children: q.length > 0 ? `${matchedFiles.length} / ${scopedFiles.length}` : scopedFiles.length }), _jsx("span", { className: "skp-list-note", children: listNote }), loading && data !== undefined && _jsx("span", { className: "skp-refresh-note", children: "\u5237\u65B0\u4E2D\u2026" }), _jsx("span", { className: "skp-detail-head-spacer" }), _jsxs("span", { className: "skp-pane-title-note", children: [enabledCount, " \u5DF2\u542F\u7528"] })] }), scope === "global" ? (_jsx("div", { className: "skp-pane-note", title: "\u5168\u5C40\u89C6\u56FE\u884C\u5185\u4E0D\u8BBE\u5355\u5F00\u5173\uFF08\u4E0E Skills / MCP \u4E00\u81F4\uFF09\uFF1A\u9ED8\u8BA4\u4E0E\u53EF\u89C1\u8303\u56F4\u5728\u884C\u5C3E\u300C\u53EF\u89C1\u8303\u56F4\u300D\u5F39\u5C42\u91CC\u6309\u5DE5\u4F5C\u533A\u914D\u7F6E", children: "\u884C\u5185\u4E0D\u8BBE\u5355\u5F00\u5173 \u00B7 \u9ED8\u8BA4\u4E0E\u53EF\u89C1\u8303\u56F4\u5728\u5F39\u5C42\u91CC\u6309\u5DE5\u4F5C\u533A\u914D" })) : (_jsx("div", { className: "skp-pane-note", title: "\u5168\u5C40 + \u9879\u76EE prompt \u53E0\u52A0\u6CE8\u5165\uFF08\u4E0D\u4E92\u76F8\u8986\u76D6\uFF09\uFF1B\u884C\u5C3E\u5F00\u5173\u53EA\u5199\u9ED8\u8BA4\u5C42\uFF0C\u4E0D\u6539\u6587\u4EF6\u5185\u5BB9", children: "\u53E0\u52A0\u6CE8\u5165\uFF08\u4E0D\u8986\u76D6\uFF09\u00B7 \u884C\u5C3E\u5F00\u5173\u53EA\u5199\u9ED8\u8BA4\u5C42\uFF0C\u4E0D\u6539\u6587\u4EF6\u5185\u5BB9" })), isFrozen && _jsx("div", { className: "skp-pane-note", children: "\u672C\u4F1A\u8BDD\u5DF2\u51BB\u7ED3 \u00B7 \u8BE6\u60C5\u53EA\u8BFB" }), renderListBody()] }), _jsx("div", { className: "skp-detail skp-detail-fixed skp-detail-flush", children: selected === undefined ? (_jsx("div", { className: "skp-detail-empty", children: scopedFiles.length === 0 ? "此作用域还没有可注入的 prompt 文件。" : "选择一个 prompt 文件查看内容。" })) : (_jsx(PromptDetail, { api: api, file: selected, list: data, ...(data.frozen !== undefined ? { frozen: data.frozen } : {}), scope: scope, ...(projectName !== undefined ? { projectName } : {}), readVersion: readVersion, onSaved: () => {
                                setReadVersion((value) => value + 1);
                                reload({ silent: true });
                            }, onOpenVisibility: () => setVisibilityFile(selected) }, selected.id)) })] })), visibilityFile !== undefined && visibilityFile.scope !== "project" && (_jsx(PromptVisibilityModal, { api: api, file: visibilityFile, scope: scope, projects: projects, ...(visibilityCurrent !== undefined ? { current: visibilityCurrent } : {}), onClose: () => setVisibilityFile(undefined), onSaved: () => {
                    visibilityCache.current.delete(visibilityFile.id);
                    setVisibilityFile(undefined);
                    reload({ silent: true });
                } }))] }));
}
