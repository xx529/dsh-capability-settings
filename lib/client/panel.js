import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Capability Panel 的 React 视图（占据**主区域**的页面，不再是浮层）。
 *
 * 入口在**侧栏上方**：本插件向 `sidebar.panellist`（ui-sidebar 的「全局
 * 面板」图标排，位于工作区列表之上、`sidebar.settings` 页脚之上）注册
 * `{ id: 'capability-panel', order: 30, label: '能力面板' }` 与图标本体，
 * 并向 `main` keyed slot 注册同名的 `key: 'capability-panel'` 页面组件。
 * 侧栏自己渲染按钮 / tooltip / label 文本，点击时把主区域切到该 key
 * （与 plugins / schedules / dsh-context 同构）；两者必须成对注册——侧栏
 * 选择没有对应 main 条目的 id 会抛错。浮层外壳、backdrop 与关闭按钮都已
 * 随之删除。
 *
 * **v20.1 信息架构（能力中心）**：只保留两条轴 + 一个解释层。
 *   1. 类型 = Tab（Skills / MCP / Tools，Jev 用分隔线单独成组）；
 *   2. 作用域 = 头部常驻分段控件（全局 / 工作区 ▾，工作区下拉列出全部
 *      工作区）——**面板与当前对话所在工作区完全解耦，默认进入全局**；
 *      `src/client.ts` 的面板 api `currentWorkspaceCwd = () => selection.cwd`
 *      （undefined = 全局，禁止 session fallback）；
 *   3. 详情 = 两段作用域链（全局 → 工作区，逐段标 继承 / 覆盖 / 来源）；
 *      **面板不涉及会话层级**，会话级开关在对话上方的「能力」Tab。
 *
 * 左栏 ScopeNav / 工作区列表已删除；列表标题栏固定写「类型 + 作用域」
 * （`全局 Skills` / `HtDot · Skills` / `HtDot · MCP`）+ 计数 + 作用域提示 +
 * 内联「＋ 添加 Skill / ＋ 添加 MCP」入口，弹窗落点由当前 Tab × 当前作用域
 * 直接确定（不再二次选择）。
 *
 * **两份 api，切勿合并（防回归）**：面板这份 api 的 cwd 只取用户在面板里
 * 显式选择的作用域；composer（输入框工具行 / 首屏入口）在 client.ts 中用
 * 单独的每会话 api，`currentWorkspaceCwd` 只取该会话自己的工作区。两者共用
 * 同一份 `subscribeWorkspace` 回调集合。若把面板这份 api 交给 composer，
 * 就会出现跨工作区串味 bug。
 *
 * 布局刻意保持朴素（自带 CSS 类，见 styles.ts），对未经确认的 UI 原语
 * 组件零硬依赖。
 *
 * @module dsh-capability-settings/client/panel
 */
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { McpView } from "./mcp-panel.js";
import { ToolsView } from "./tools-panel.js";
import { JevPanel } from "./jev-panel.js";
import { Modal } from "./modal.js";
import { ScopeChain } from "./scope-chain.js";
import { SkpSelect } from "./select.js";
import { DetailPage, DetailStrip, DetailTitleBar, MetaCell, MetaGrid, MoreMenu, StripSeparator, ToggleSwitch, } from "./detail-shell.js";
import { isProjectSource, useAsyncList } from "./panel-common.js";
import { EMPTY_VISIBILITY_SETS, VisibilityDetailFields, VisibilityEditControl, VisibilityRowMeta, isRowInvisible, safeGlobalGet, safeOverridesGet, visibilityEntryOf, visibilityModeOf, visibleWorkspaceCountOf, workspaceOverrideOf, } from "./visibility.js";
import { SkillContent, skillRefOf } from "./skill-content.js";
import { isGlobalSkillSource } from "../shared/skill-sources.js";
import { locateSkillRoot, rerootEntries, stripCommonTopFolder } from "../shared/skill-locate.js";
import { unzip } from "./unzip.js";
import { base64ToBytes, buildZip, downloadBytes } from "./zip.js";
/** 外部（client.ts）请求面板切域时派发的 window 自定义事件名。 */
const PANEL_DOMAIN_EVENT = "capability-panel:set-domain";
/**
 * 待应用的目标域：面板**尚未挂载**时，`openCapabilityPanel(domain)` 先把目标
 * 记在这里，由 CapabilityPanel 首次渲染读取并清空；面板已挂载时改用事件即时
 * 切换（见 setPanelDomain）。
 */
let pendingPanelDomain;
/**
 * 请求能力面板切到指定域（由 client.ts 的 `openCapabilityPanel(domain?)` 在
 * `layout.selectPanel("capability-panel")` 之前调用）。
 *
 * 覆盖两种时序：
 *   - 面板**已挂载**：派发 `capability-panel:set-domain`，组件监听后立即切 Tab；
 *   - 面板**未挂载**：目标留在模块级 pending，组件首次渲染直接落在该域
 *     （hero「去配置」因此能一步打开 Jev Tab，AC-ENT-4）。
 *
 * `undefined` = 保持当前域（无参打开面板的旧行为）。
 */
export function setPanelDomain(domain) {
    pendingPanelDomain = domain;
    if (typeof window === "undefined")
        return;
    try {
        window.dispatchEvent(new window.CustomEvent(PANEL_DOMAIN_EVENT, { detail: domain }));
    }
    catch {
        /* 非浏览器/测试环境没有 CustomEvent：只走 pending 路径 */
    }
}
/** 域 Tab 的展示文案（当前硬编码中文，见 client.ts 的 locale 说明）。 */
const DOMAIN_LABEL = {
    // 全站命名统一（UX v1.8 §2.1）：技能 → Skills、MCP 服务器 → MCP、插件工具 → Tools。
    skills: "Skills",
    mcp: "MCP",
    tools: "Tools",
    jev: "Jev 模型",
};
const DOMAIN_ORDER = ["skills", "mcp", "tools", "jev"];
/**
 * 各域的搜索占位符（搜索框在根组件头部，切换域时切换文案）。
 * `jev` 域没有搜索框，故不在此表内（渲染处按 `domain !== "jev"` 隐藏）。
 */
const DOMAIN_SEARCH_PLACEHOLDER = {
    skills: "搜索 Skills…",
    mcp: "搜索 MCP…",
    tools: "搜索插件或工具…",
};
/**
 * 面板根组件：头部（标题 + 项目下拉框 + 域 Tab）+ 当前域视图。
 *
 * 它是主区域页面的本体（见 panel-entry.tsx 的 CapabilityPanelPage），自带
 * `.skp-panel`（height:100% / flex column），因此不再需要浮层外壳与关闭
 * 按钮——关闭 = 侧栏切换到别的主面板。
 */
export function CapabilityPanel({ api }) {
    // 域、工作区列表、作用域选择各自维护一份 useState；起始值取自 api 快照方法。
    //
    // 初始域优先消费外部 pending（`setPanelDomain`）；初始化器只读不写，
    // 避开 React StrictMode 双调用初始化器的副作用问题，pending 由下方
    // effect 在挂载后清空。
    const [domain, setDomain] = useState(() => pendingPanelDomain ?? "skills");
    /** 当前域的搜索词（搜索框在头部，按域切换 placeholder；切域清空）。 */
    const [query, setQuery] = useState("");
    const [projects, setProjects] = useState(() => api.projects());
    /** 面板作用域：undefined = 全局（默认），路径 = 用户选中的工作区。 */
    const [pinned, setPinned] = useState(() => api.selectedProject());
    // 域 Tab 计数：由各域视图在数据到达后回填（加载中显示 —）。
    // 口径（v20.1 统一）：Tab 计数 = 该域全部条目总数（不随作用域/搜索变化）；
    // 列表标题栏显示「当前作用域可见数 / 当前作用域总数」。
    const [skillsCount, setSkillsCount] = useState(undefined);
    const [mcpCount, setMcpCount] = useState(undefined);
    const [toolsCount, setToolsCount] = useState(undefined);
    /**
     * Jev 配置页在首次进入该 Tab 时挂载，之后**常驻**（用 active 控制显隐）：
     * 这样在同一面板会话内切到技能/MCP 再切回来，未保存的表单草稿仍在
     * （AC-CFG-16）；关闭能力面板后整棵子树卸载，草稿丢弃。
     * 若初始域就是 jev（pending），同样要挂载。
     */
    const [jevMounted, setJevMounted] = useState(() => pendingPanelDomain === "jev");
    // 消费 pending + 监听外部切域事件：挂载期间 `setPanelDomain(domain)` 会
    // 立即切 Tab（清空搜索词，沿用点 Tab 的既有规则）；卸载移除监听。
    useEffect(() => {
        pendingPanelDomain = undefined;
        const onSetDomain = (event) => {
            pendingPanelDomain = undefined;
            const detail = event.detail;
            if (detail !== "skills" && detail !== "mcp" && detail !== "tools" && detail !== "jev")
                return;
            setDomain(detail);
            setQuery("");
            if (detail === "jev")
                setJevMounted(true);
        };
        window.addEventListener(PANEL_DOMAIN_EVENT, onSetDomain);
        return () => window.removeEventListener(PANEL_DOMAIN_EVENT, onSetDomain);
    }, []);
    // 工作区选项 / 作用域选择都会随「工作区列表变化、用户切换作用域」而变；
    // 数据源是快照（SnapshotStore），本身不具备响应性，所以订阅借由 adapter
    // 暴露的 subscribeWorkspace 手动同步。**面板不再监听当前对话工作区**：
    // 面板的 cwd 只取 selection（见 client.ts 契约 §3.1）。
    useEffect(() => {
        let alive = true;
        const update = () => {
            if (!alive)
                return;
            setProjects(api.projects());
            setPinned(api.selectedProject());
        };
        const unsub = api.subscribeWorkspace(update);
        update();
        return () => {
            alive = false; // 卸载后丢弃异步通知，避免对已卸载组件 setState
            unsub();
        };
    }, [api]);
    // Jev 域无条目计数（不是条目域，无「总数」语义），恒为 undefined。
    const counts = {
        skills: skillsCount,
        mcp: mcpCount,
        tools: toolsCount,
        jev: undefined,
    };
    const jevActive = domain === "jev";
    /** 作用域：未选择工作区 = 全局（面板默认，与当前对话无关）。 */
    // v21：Tools 也纳入可见性/工作区默认，三域共用同一作用域控件。
    const workspaceSelected = pinned !== undefined;
    const activeProject = pinned === undefined ? undefined : projects.find((project) => project.path === pinned);
    /** 工作区展示名：优先工作区 title，其次目录 basename（统一 HtDot 口径）。 */
    const projectName = pinned === undefined ? undefined : (activeProject?.title ?? basenameOf(pinned));
    /** 切换作用域：undefined = 全局；路径 = 该工作区。 */
    const selectWorkspace = (path) => api.selectProject(path);
    // 页面 chrome 由主区域提供（侧栏切换主面板 = 关闭）；这里只渲染
    // 标题行（标题 + 作用域分段）+ 域 Tab 与当前域视图。
    return (_jsxs("section", { className: "skp-panel", "aria-label": "\u80FD\u529B\u9762\u677F", children: [_jsxs("header", { className: "skp-header", children: [_jsxs("div", { className: "skp-title-row", children: [_jsxs("div", { className: "skp-title-main", children: [_jsx("h2", { children: "\u80FD\u529B\u4E2D\u5FC3" }), !jevActive &&
                                        (workspaceSelected ? (_jsxs(_Fragment, { children: [_jsx("span", { className: "skp-scope-badge", children: "\u5DE5\u4F5C\u533A\u89C6\u56FE" }), _jsx("span", { className: "skp-workspace", title: pinned, children: projectName })] })) : (_jsxs(_Fragment, { children: [_jsx("span", { className: "skp-scope-badge", children: "\u5168\u5C40\u89C6\u56FE" }), _jsx("span", { className: "skp-workspace", children: "\u6240\u6709\u5DE5\u4F5C\u533A\u751F\u6548" })] })))] }), !jevActive && (_jsx("div", { className: "skp-title-tools", children: _jsxs("div", { className: "skp-scope-seg", role: "group", "aria-label": "\u4F5C\u7528\u57DF", children: [_jsx("button", { type: "button", className: workspaceSelected ? "skp-scope-seg-btn" : "skp-scope-seg-btn skp-scope-seg-btn-active", "aria-pressed": !workspaceSelected, title: "\u7BA1\u7406\u5168\u5C40\u80FD\u529B\uFF08\u6240\u6709\u5DE5\u4F5C\u533A\u751F\u6548\uFF09", onClick: () => selectWorkspace(undefined), children: "\u5168\u5C40" }), _jsx(SkpSelect, { className: "skp-dd-scope skp-scope-seg-select", value: pinned ?? "", title: workspaceSelected ? pinned : "从全部工作区中选择", ariaLabel: "\u5DE5\u4F5C\u533A\u4F5C\u7528\u57DF", options: [
                                                // 未选工作区时显示占位项（点击无副作用），让分段读作「工作区 ▾」。
                                                ...(pinned === undefined ? [{ value: "", label: "工作区 ▾" }] : []),
                                                ...projects.map((project) => ({
                                                    value: project.path,
                                                    label: `工作区 · ${project.title ?? basenameOf(project.path)}`,
                                                    ...(pinned === project.path ? { hint: "当前" } : {}),
                                                })),
                                                // 已选工作区不在已知列表里时也保留为选项，避免“消失”。
                                                ...(pinned !== undefined && !projects.some((project) => project.path === pinned)
                                                    ? [{ value: pinned, label: `工作区 · ${basenameOf(pinned)}` }]
                                                    : []),
                                            ], onChange: (value) => selectWorkspace(value === "" ? undefined : value) })] }) }))] }), _jsxs("div", { className: "skp-header-row", children: [_jsx("div", { className: "skp-tabs", role: "tablist", children: DOMAIN_ORDER.map((d) => (_jsxs(Fragment, { children: [d === "jev" && _jsx("span", { className: "skp-tab-sep", "aria-hidden": "true" }), _jsxs("button", { role: "tab", "aria-selected": domain === d, className: domain === d ? "skp-tab skp-tab-active" : "skp-tab", onClick: () => {
                                                setDomain(d);
                                                setQuery("");
                                                // 首次进入 Jev 域才挂载配置页；之后常驻以保留未保存草稿。
                                                if (d === "jev")
                                                    setJevMounted(true);
                                            }, children: [_jsx("span", { children: DOMAIN_LABEL[d] }), d !== "jev" && _jsx("span", { className: "skp-tab-count", children: counts[d] ?? "—" })] })] }, d))) }), domain !== "jev" && (_jsx("input", { className: "skp-search skp-header-search", type: "search", "aria-label": DOMAIN_SEARCH_PLACEHOLDER[domain], placeholder: DOMAIN_SEARCH_PLACEHOLDER[domain], value: query, onChange: (event) => setQuery(event.target.value), onKeyDown: (event) => {
                                    if (event.key === "Escape" && query.length > 0) {
                                        event.preventDefault();
                                        setQuery("");
                                    }
                                } }))] })] }), jevActive ? null : domain === "tools" ? (_jsx(ToolsView, { api: api, workspace: pinned, projects: projects, query: query, onCount: setToolsCount })) : domain === "skills" ? (_jsx(SkillsView, { api: api, workspace: pinned, projects: projects, query: query, onSelectWorkspace: selectWorkspace, onCount: setSkillsCount })) : (_jsx(McpView, { api: api, workspace: pinned, projects: projects, query: query, onSelectWorkspace: selectWorkspace, onCount: setMcpCount })), jevMounted && _jsx(JevPanel, { api: api, active: jevActive })] }));
}
// ---------------------------------------------------------------------------
// Skills 域视图
// ---------------------------------------------------------------------------
/** 技能行的复合 key：同名技能可能同时存在于两个作用域，必须带分组前缀。 */
function skillRowKey(item) {
    const group = isProjectSource(item.source) ? "project" : "global";
    return `${group}:${item.source}:${item.name}`;
}
/** 调用状态三分：全启用 / 全禁用 / 部分禁用（仅其中一个方向被关）。 */
function invocationState(item) {
    if (item.modelInvocable && item.userInvocable)
        return "full";
    if (!item.modelInvocable && !item.userInvocable)
        return "none";
    return "partial";
}
/** 注入来源的展示文案（与 Figma v12 标签语义一致）。 */
function originLabel(item) {
    return item.origin === "bundled" ? "内置" : item.origin === "preset" ? "预设" : "插件";
}
/** 注入来源标签的配色类（内置琥珀 / 插件紫 / 预设灰）。 */
function originTagClass(item) {
    return item.origin === "bundled" ? "skp-tag skp-tag-bundled" : item.origin === "preset" ? "skp-tag skp-tag-preset" : "skp-tag skp-tag-plugin";
}
/** 注入行的「来源 + 渠道」说明（详情页 meta 用）。 */
function injectedOriginText(item) {
    if (item.origin === "bundled")
        return "DSH 内置（随包提供）";
    if (item.origin === "preset")
        return `Agent 预设 · 仅在「${item.channel ?? "未知预设"}」的对话可见`;
    return item.channel !== undefined && item.channel.length > 0 ? `${item.channel} 运行时注入（不落盘）` : "插件运行时注入（不落盘）";
}
/** 注入行的只读原因条文案（详情页顶部）。 */
function injectedReadonlyNote(item) {
    const channel = item.channel !== undefined && item.channel.length > 0 ? item.channel : "插件";
    if (item.origin === "bundled") {
        return "内容只读 · DSH 内置 Skills（无磁盘副本）；可在列表 / 本页启用或禁用，不可编辑或删除。";
    }
    if (item.origin === "preset") {
        return `内容只读 · 由 Agent 预设「${channel}」提供（无磁盘副本，仅绑定该预设的对话可见）；可在本页启用或禁用，不可编辑或删除。`;
    }
    return `内容只读 · 由插件 ${channel} 运行时注册（无磁盘副本）；可在列表 / 本页启用或禁用，不可编辑或删除。`;
}
/** 行左标签的排序与文案：scope → 格式 → 关系（最多 3 个）。 */
function skillTags(item, hasGlobal) {
    const tags = [];
    if (item.injected === true) {
        // 注入行没有「全局/项目」磁盘归属：来源标签（内置/插件/预设）+ 格式 + 渠道名。
        tags.push({
            key: "origin",
            label: originLabel(item),
            className: originTagClass(item),
            title: item.origin === "bundled"
                ? "DSH 随包提供的 Skills（只读）"
                : item.origin === "preset"
                    ? "由当前 Agent 预设渠道提供，只在绑定该预设的对话里可见"
                    : "由插件在运行时注册的 Skills（只读）",
        });
        tags.push({
            key: "format",
            label: item.format === "directory" ? "目录" : ".md",
            className: "skp-tag skp-tag-flat",
            title: item.format === "directory" ? "目录型 Skills（SKILL.md + 其他文件）" : "单文件 Skills",
        });
        if (item.channel !== undefined && item.channel.length > 0) {
            tags.push({
                key: "channel",
                label: item.channel,
                className: "skp-tag skp-tag-channel",
                title: "注入方 / 渠道名（只读来源：没有可编辑的磁盘副本）",
            });
        }
        return tags;
    }
    const isProject = isProjectSource(item.source);
    tags.push({
        key: "scope",
        label: isProject ? "本项" : "全局",
        className: isProject ? "skp-tag skp-tag-project" : "skp-tag skp-tag-global",
        title: isProject ? "仅存在于所选工作区的 Skills" : "全局 Skills，对所有工作区生效",
    }, {
        key: "format",
        label: item.format === "directory" ? "目录" : ".md",
        className: "skp-tag skp-tag-flat",
        title: item.format === "directory" ? "目录型 Skills（SKILL.md + 其他文件）" : "单文件 Skills",
    });
    if (item.readOnly) {
        tags.push({ key: "readonly", label: "只读", className: "skp-tag skp-tag-readonly", title: "只读来源，无法修改或删除" });
    }
    else if (isProject && item.shadowStub === true) {
        tags.push({
            key: "stub",
            label: "屏蔽占位",
            className: "skp-tag skp-tag-warn",
            title: "已生成屏蔽占位，使同名全局 Skills 在本工作区不可用；删除占位即恢复",
        });
    }
    else if (isProject && hasGlobal) {
        tags.push({ key: "override", label: "覆盖全局", className: "skp-tag skp-tag-relation", title: "本工作区生效的是这份副本；同名全局 Skills 被遮蔽" });
    }
    else if (!isProject && item.projectShadow === "stub") {
        tags.push({
            key: "disabled-in-project",
            label: "工作区默认关闭",
            className: "skp-tag skp-tag-warn",
            title: "该工作区已禁用同名全局 Skills；可在工作区作用域重新打开（不影响其它工作区）",
        });
    }
    else if (!isProject && item.projectShadow === "skill") {
        tags.push({
            key: "project-copy",
            label: "工作区副本生效中",
            className: "skp-tag skp-tag-readonly",
            title: "工作区已有同名 Skills，按优先级该工作区生效的是工作区副本",
        });
    }
    return tags;
}
/**
 * 全局视图的开关勾选态 = **全局默认是否启用**（v20.1 B2：独立
 * `capability-global-overrides.json`，不修改技能文件）。
 * 旧宿主没有 `globalDefaultDisabled` 时回退到旧的项目遮蔽口径。
 */
function globalDefaultEnabledOf(item) {
    if (item.globalDefaultDisabled !== undefined)
        return !item.globalDefaultDisabled;
    if (item.projectShadow === "stub")
        return false;
    return item.disabledInProject !== true;
}
/**
 * 工作区视图的开关勾选态 = **有效默认值**（契约 §1.3：全局默认 < 工作区显式）。
 * 优先用宿主投影的 `effectiveDefaultEnabled`；旧宿主按可见字段回退。
 */
/** frontmatter YAML 的 key 是否需要引号（只处理保守集合）。 */
function yamlKey(key) {
    return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? key : JSON.stringify(key);
}
/**
 * frontmatter YAML 值序列化：标量按 YAML 安全形式输出（数字/布尔/null 原样，
 * 其余字符串按需加双引号）；对象 / 数组用 JSON flow 形式（JSON 是合法 YAML），
 * **不做字段推断**——只输出 spec 里真实存在的值。
 */
function yamlScalar(value) {
    if (typeof value === "string") {
        const plain = value.length > 0 && /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(value);
        const reserved = /^(?:true|false|null|yes|no|on|off|~|\d+(?:\.\d+)?)$/i.test(value);
        return plain && !reserved ? value : JSON.stringify(value);
    }
    if (typeof value === "number" || typeof value === "boolean")
        return String(value);
    if (value === null || value === undefined)
        return "null";
    try {
        return JSON.stringify(value);
    }
    catch {
        return JSON.stringify(String(value));
    }
}
/**
 * 由 `SkillSpec` 还原 frontmatter YAML（字段与磁盘 frontmatter 一一对应：
 * name / description / whenToUse / 扁平 invocation 键 / metadata）。不臆造未知字段。
 */
function frontmatterYamlOf(spec) {
    const lines = [`name: ${yamlScalar(spec.name)}`, `description: ${yamlScalar(spec.description)}`];
    if (spec.whenToUse !== undefined && spec.whenToUse.trim().length > 0) {
        lines.push(`whenToUse: ${yamlScalar(spec.whenToUse)}`);
    }
    const invocation = spec.invocation ?? {};
    for (const key of ["disable-model-invocation", "user-invocable"]) {
        if (invocation[key] !== undefined)
            lines.push(`${yamlKey(key)}: ${yamlScalar(invocation[key])}`);
    }
    const metadata = spec.metadata ?? {};
    const metadataEntries = Object.entries(metadata);
    if (metadataEntries.length > 0) {
        lines.push("metadata:");
        for (const [key, value] of metadataEntries)
            lines.push(`  ${yamlKey(key)}: ${yamlScalar(value)}`);
    }
    return lines.join("\n");
}
/** metadata 值展示：标量原样；对象 / 数组用紧凑 JSON（嵌套对象可读预览）。 */
function metadataValueText(value) {
    if (value === null)
        return "null";
    if (typeof value === "string")
        return value;
    if (typeof value === "number" || typeof value === "boolean")
        return String(value);
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
/**
 * 「Frontmatter / 触发规则」区块（Skills 详情）：
 * 展示 read 拿到的 spec（名称 / 描述 / 使用时机 / 调用策略 / metadata），
 * 并提供由 spec 生成的原始 frontmatter YAML 折叠块。样式沿用 `.skp-detail-*`。
 */
function SkillFrontmatterSection({ spec }) {
    const metadataEntries = Object.entries(spec.metadata ?? {});
    const modelInvocable = spec.invocation?.["disable-model-invocation"] !== true;
    const userInvocable = spec.invocation?.["user-invocable"] !== false;
    return (_jsxs("section", { className: "skp-frontmatter", "aria-label": "Frontmatter / \u89E6\u53D1\u89C4\u5219", children: [_jsxs("div", { className: "skp-detail-inspect-head", children: [_jsx("span", { className: "skp-field-label", children: "Frontmatter / \u89E6\u53D1\u89C4\u5219" }), _jsx("span", { className: "skp-test-stat", children: "\u6765\u81EA SKILL.md frontmatter \u00B7 \u53EA\u8BFB" })] }), _jsxs("dl", { className: "skp-frontmatter-fields", children: [_jsx("dt", { children: "\u540D\u79F0" }), _jsx("dd", { children: _jsx("code", { children: spec.name }) }), _jsx("dt", { children: "\u63CF\u8FF0" }), _jsx("dd", { children: spec.description.length > 0 ? spec.description : "—" }), spec.whenToUse !== undefined && spec.whenToUse.trim().length > 0 && (_jsxs(_Fragment, { children: [_jsx("dt", { children: "\u4F7F\u7528\u65F6\u673A / \u89E6\u53D1\u89C4\u5219" }), _jsx("dd", { children: spec.whenToUse })] })), _jsx("dt", { children: "\u8C03\u7528\u7B56\u7565" }), _jsxs("dd", { children: ["\u6A21\u578B ", modelInvocable ? "✓" : "✗", " \u00B7 \u7528\u6237 ", userInvocable ? "✓" : "✗"] }), metadataEntries.length > 0 && (_jsxs(_Fragment, { children: [_jsx("dt", { children: "metadata" }), _jsx("dd", { children: _jsx("ul", { className: "skp-frontmatter-meta", children: metadataEntries.map(([key, value]) => (_jsxs("li", { className: "skp-frontmatter-meta-row", children: [_jsx("span", { className: "skp-frontmatter-key", children: key }), _jsx("span", { className: "skp-frontmatter-value", title: metadataValueText(value), children: metadataValueText(value) })] }, key))) }) })] }))] }), _jsxs("details", { className: "skp-frontmatter-raw", children: [_jsx("summary", { children: "\u539F\u59CB frontmatter\uFF08YAML\uFF09" }), _jsx("pre", { className: "skp-frontmatter-yaml", children: frontmatterYamlOf(spec) })] })] }));
}
function effectiveDefaultEnabledOf(item) {
    if (item.effectiveDefaultEnabled !== undefined)
        return item.effectiveDefaultEnabled;
    if (item.projectDefaultEnabled === true)
        return true;
    if (item.projectDefaultDisabled === true)
        return false;
    if (item.projectShadow === "stub")
        return false;
    return item.globalDefaultDisabled !== true && item.disabledInProject !== true;
}
/**
 * 行开关是否置灰 + tooltip。
 *
 * - 全局视图：写全局默认（独立文件）；注入行也可启停（readOnly 只限制内容编辑）；
 * - 工作区视图：项目磁盘条目的开关写 frontmatter（只读/无工作区时置灰）；
 *   全局 / 注入条目写「工作区显式启用/禁用」（B2）。
 *
 * 注意判序：`canToggleGlobal` 必须先于 `readOnly` 判——宿主 `skills.list` 里
 * **所有注入行**都带 `readOnly:true`（内容只读），把 readOnly 当开关禁用条件
 * 会把「插件注入 · 只读 · 可启停」整组错误置灰（verifier V20-05j）。
 */
function skillSwitchDisabled(item, scope) {
    /** true = 内容只读但开关可写（注入行）：readOnly 不拦启停。 */
    const contentOnlyReadOnly = item.readOnly && item.injected !== true;
    if (scope === "global") {
        if (item.canToggleGlobal === false) {
            return {
                disabled: true,
                title: item.globalToggleBlockedReason ?? "该条目由同层注入提供，无法设置全局默认",
            };
        }
        if (contentOnlyReadOnly)
            return { disabled: true, title: "只读来源，无法修改" };
        const enabled = globalDefaultEnabledOf(item);
        return {
            disabled: false,
            title: enabled
                ? "关闭：所有工作区默认不启用（写全局默认名单，不修改 Skills 文件；工作区可重新打开）"
                : "打开：恢复此 Skill 的全局默认启用",
        };
    }
    if (contentOnlyReadOnly)
        return { disabled: true, title: "只读来源（.claude 兼容目录），无法修改" };
    if (isProjectSource(item.source)) {
        if (item.shadowStub === true) {
            return { disabled: false, title: "打开：删除屏蔽占位，恢复同名全局 Skill 在本工作区可用" };
        }
        const on = item.modelInvocable && item.userInvocable;
        return {
            disabled: false,
            title: on ? "关闭：本工作区内的这份 Skill 模型与用户都不可调用（写 frontmatter）" : "打开：恢复模型与用户调用（写 frontmatter）",
        };
    }
    const enabled = effectiveDefaultEnabledOf(item);
    return {
        disabled: false,
        title: enabled ? "关闭：仅此工作区默认不启用（写项目覆盖）" : "打开：仅此工作区默认启用（可覆盖全局默认关闭）",
    };
}
/** 取路径最后一段作为工作区显示名（兼容 POSIX / Windows 分隔符）。 */
function basenameOf(path) {
    const segments = path.split(/[\\/]/).filter((segment) => segment.length > 0);
    return segments[segments.length - 1] ?? path;
}
/**
 * Skills 视图（v20.1）：**两栏**（列表 + 详情），不再有左栏 ScopeNav 与工作区列表。
 *
 *  - **全局作用域**（`workspace === undefined`）：列表 = 磁盘全局 Skills +
 *    宿主注入 Skills（按来源分组）；行尾开关写**全局默认**
 *    （`overrides.globalToggle` → `capability-global-overrides.json`）。
 *  - **工作区作用域**（`workspace` = 用户选中的工作区）：列表 = 本项目独有条目
 *    + 引用的全局能力（按来源分组）；行尾开关写**该工作区的有效默认**
 *    （B2：项目磁盘条目走 frontmatter，全局 / 注入条目走 overrides 显式启用/禁用）。
 *
 * 作用域入口只在根部 header（全局 / 工作区 ▾），本视图不提供第二套导航；
 * 列表标题栏固定「类型 + 作用域」与内联「＋ 添加 Skill」入口，类型与落点由
 * 当前 Tab × 当前作用域直接决定（弹窗不再二次选择）。
 *
 * 搜索词由根组件头部的同一输入框提供（query），只过滤当前列表；计数口径 =
 * Tab 与列表标题共享「当前作用域总数」，搜索时标题显示「匹配 / 总数」。
 */
function SkillsView({ api, workspace, projects, query, onSelectWorkspace, onCount, }) {
    const skillsApi = api.skills;
    const [selected, setSelected] = useState(undefined);
    /** 关系标签互跳的目标行：切作用域后待列表出现再选中。 */
    const [pendingSelect, setPendingSelect] = useState(undefined);
    const [installOpen, setInstallOpen] = useState(false);
    const [opError, setOpError] = useState(undefined);
    const [busyRow, setBusyRow] = useState(undefined);
    /** 写操作计数：传给 SkillContent，变化时清空文件缓存并重拉。 */
    const [contentVersion, setContentVersion] = useState(0);
    /** 全局默认层（独立文件）：文件路径 + 损坏警告；开关后重读。 */
    const [globalOverrides, setGlobalOverrides] = useState(undefined);
    const [globalVersion, setGlobalVersion] = useState(0);
    /** v21：工作区视图的项目 overrides（判断「跟随全局默认 / 已覆盖」）。 */
    const [projectOverrides, setProjectOverrides] = useState(undefined);
    /** 写操作计数：工作区 overrides 变化后重读（「跟随 / 已覆盖」标签）。 */
    const [writeVersion, setWriteVersion] = useState(0);
    const rowRefs = useRef(new Map());
    const scope = workspace === undefined ? "global" : "workspace";
    const workspaceSelected = scope === "workspace";
    const projectName = workspace === undefined ? undefined : (projects.find((project) => project.path === workspace)?.title ?? basenameOf(workspace));
    /** 当前全局可见性集合（旧宿主 / v1 文件 ⇒ 全空 = 全部可见）。 */
    const visibilitySets = globalOverrides?.visibility ?? EMPTY_VISIBILITY_SETS;
    /** 某 skill 的可见性配置（global 视图的行标签 / 详情用）。 */
    const visibilityOf = (name) => visibilityEntryOf(visibilitySets, "skills", name);
    /** 兜底默认：名字在全局默认关闭名单里。 */
    const globalOffOf = (item) => item.globalDefaultDisabled === true || globalOverrides?.skills.includes(item.name) === true;
    // 挂载时、作用域变化时（列表 cwd 变化）、写操作后重新拉取。
    // 全局作用域 cwd = undefined（宿主只返回全局 + 注入），工作区作用域 cwd = 该
    // 工作区（宿主返回项目 + 全局 + 注入，并投影 v20.1 的有效默认字段）。
    // v21：行数据之外还要工作区视图的 `hiddenCount`（可见性过滤掉的条数）。
    const { data, loading, error, reload } = useAsyncList(async () => {
        const view = skillsApi.listView !== undefined ? await skillsApi.listView() : { skills: await skillsApi.list(), hiddenCount: 0 };
        return { items: view.skills, hiddenCount: view.hiddenCount ?? 0 };
    }, [skillsApi, workspace], 
    // v21.3：按作用域缓存，切换回已访问过的工作区/全局时同步出旧列表再后台刷新。
    { cacheKey: `skills:${workspace ?? "global"}` });
    const items = data?.items ?? [];
    const hiddenCount = data?.hiddenCount ?? 0;
    const projectItems = useMemo(() => items.filter((item) => isProjectSource(item.source)), [items]);
    const globalItems = useMemo(() => items.filter((item) => !isProjectSource(item.source)), [items]);
    const injectedItems = useMemo(() => globalItems.filter((item) => item.injected === true), [globalItems]);
    const diskGlobalItems = useMemo(() => globalItems.filter((item) => item.injected !== true), [globalItems]);
    /** v21：工作区视图里因可见性被隐藏的**全局**条目（宿主已过滤，这里防御旧宿主）。 */
    const workspaceGlobalItems = useMemo(() => (scope === "workspace" ? globalItems.filter((item) => item.visibleInWorkspace !== false) : globalItems), [globalItems, scope]);
    // 全局默认层（开关的真实来源）：只在全局作用域需要文件路径/损坏警告，
    // 但重复读取很便宜，切换作用域后也重读一次，保证 warning 不陈旧。
    useEffect(() => {
        let alive = true;
        void safeGlobalGet(api).then((value) => {
            if (alive)
                setGlobalOverrides(value);
        });
        return () => {
            alive = false;
        };
    }, [api, globalVersion]);
    // v21：工作区视图读项目 overrides（判断「跟随全局默认 / 已覆盖」）。写操作后随
    // writeVersion 重读。
    useEffect(() => {
        if (scope !== "workspace") {
            setProjectOverrides(undefined);
            return;
        }
        let alive = true;
        void safeOverridesGet(api).then((value) => {
            if (alive)
                setProjectOverrides(value);
        });
        return () => {
            alive = false;
        };
    }, [api, scope, workspace, writeVersion]);
    /**
     * 当前作用域总数（Tab 与列表标题共用同一口径）：
     * 全局视图 = 全部条目；工作区视图 = 可见条目（v21 计数可见口径）。
     */
    const scopeTotal = scope === "global" ? globalItems.length : projectItems.length + workspaceGlobalItems.length;
    // Tab 计数 = 当前作用域总数（不随搜索变化；列表标题显示同一数字）。
    useEffect(() => {
        if (!loading && error === undefined)
            onCount?.(scopeTotal);
    }, [scopeTotal, loading, error, onCount]);
    const q = query.trim().toLowerCase();
    const matchesSkill = (item) => q.length === 0 ||
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        // 注入行的渠道名（插件 / preset 名）也参与搜索。
        (item.channel !== undefined && item.channel.toLowerCase().includes(q));
    /** 当前作用域参与渲染的全局条目（工作区视图已按可见性过滤）。 */
    const globalItemsForScope = scope === "global" ? globalItems : workspaceGlobalItems;
    const visibleProject = useMemo(() => projectItems.filter(matchesSkill), [projectItems, q]);
    const visibleGlobal = useMemo(() => globalItemsForScope.filter(matchesSkill), [globalItemsForScope, q]);
    const visibleDiskGlobal = useMemo(() => diskGlobalItems.filter((item) => scope === "global" || item.visibleInWorkspace !== false).filter(matchesSkill), [diskGlobalItems, scope, q]);
    const visibleInjected = useMemo(() => injectedItems.filter((item) => scope === "global" || item.visibleInWorkspace !== false).filter(matchesSkill), [injectedItems, scope, q]);
    /** 当前作用域可见行（决定键盘导航与选中查找）。 */
    const visibleItems = useMemo(() => (scope === "global" ? visibleGlobal : [...visibleProject, ...visibleGlobal]), [scope, visibleGlobal, visibleProject]);
    const visibleKeys = useMemo(() => visibleItems.map(skillRowKey), [visibleItems]);
    const selectedItem = items.find((item) => skillRowKey(item) === selected);
    // 作用域切换清空选中；pendingSelect 保留（关系互跳会在新列表到达后重新选中）。
    useEffect(() => {
        setSelected(undefined);
    }, [workspace]);
    useEffect(() => {
        if (pendingSelect === undefined)
            return;
        if (!visibleKeys.includes(pendingSelect))
            return;
        setSelected(pendingSelect);
        setPendingSelect(undefined);
    }, [pendingSelect, visibleKeys]);
    // `/` 聚焦头部搜索框（输入框 / 文本域 / contenteditable 内不生效）。
    useEffect(() => {
        const onKeyDown = (event) => {
            if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey)
                return;
            const active = document.activeElement;
            const tagName = active?.tagName.toLowerCase();
            if (tagName === "input" || tagName === "textarea" || active?.isContentEditable === true)
                return;
            event.preventDefault();
            document.querySelector(".skp-header-search")?.focus();
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, []);
    const selectRow = (key) => {
        setSelected(key);
        setOpError(undefined);
    };
    const focusRow = (key) => {
        const element = rowRefs.current.get(key);
        if (element === undefined)
            return;
        element.focus();
        element.scrollIntoView({ block: "nearest" });
    };
    /** 行内统一开关：按「当前作用域 × 行类型」分派（全部真实调用后端）。 */
    const toggleRow = async (item, next) => {
        const key = skillRowKey(item);
        if (busyRow !== undefined)
            return;
        setBusyRow(key);
        setOpError(undefined);
        try {
            const isProject = isProjectSource(item.source);
            if (scope === "global") {
                // v20.1 B2：全局默认 = 独立文件里的关闭名单，不修改技能文件。
                const result = await api.overrides.globalToggle({ domain: "skills", key: item.name, disabled: !next });
                if (!result.ok) {
                    setOpError(result.errors.join("; "));
                    return;
                }
                setGlobalVersion((value) => value + 1);
            }
            else if (isProject) {
                // 项目磁盘条目：内容属于该工作区，开关仍写 frontmatter（模型/用户双方向）。
                const result = item.shadowStub === true
                    ? next
                        ? await skillsApi.enableInProject({ name: item.name })
                        : { ok: true }
                    : await skillsApi.setEnabled({ ...skillRefOf(item), enabled: next });
                if (!result.ok) {
                    setOpError(result.errors.join("; "));
                    return;
                }
            }
            else {
                // 全局 / 注入条目：写该工作区的显式启用/禁用（B2，覆盖全局默认）。
                const result = await api.overrides.setSkillDefault({ key: item.name, enabled: next });
                if (!result.ok) {
                    setOpError(result.errors.join("; "));
                    return;
                }
            }
            setContentVersion((value) => value + 1);
        }
        catch (failure) {
            setOpError(String(failure));
        }
        finally {
            setBusyRow(undefined);
            setWriteVersion((value) => value + 1);
            // 写后静默重拉：不整页 loading、不改选中与滚动位置。
            reload({ silent: true });
        }
    };
    const onRowKeyDown = (event, key) => {
        if (visibleKeys.length === 0)
            return;
        const index = visibleKeys.indexOf(key);
        if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
            event.preventDefault();
            const next = event.key === "Home"
                ? 0
                : event.key === "End"
                    ? visibleKeys.length - 1
                    : event.key === "ArrowDown"
                        ? Math.min(visibleKeys.length - 1, index + 1)
                        : Math.max(0, index - 1);
            const nextKey = visibleKeys[next];
            if (nextKey !== undefined) {
                selectRow(nextKey);
                requestAnimationFrame(() => focusRow(nextKey));
            }
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            selectRow(key);
        }
    };
    /** 列表标题栏的内联添加（类型 + 落点已由当前 Tab × 作用域决定）。 */
    const addLabel = "＋ 添加 Skill";
    const addTitle = scope === "global" ? "添加 Skill 到全局" : `添加 Skill 到工作区 ${projectName ?? "工作区"}`;
    /** 列表标题：全局 = 「全局 Skills」；工作区 = 「HtDot · Skills」。 */
    const listTitle = scope === "global" ? "全局 Skills" : `${projectName ?? "工作区"} · Skills`;
    const listNote = scope === "global" ? "所有工作区" : "仅此工作区";
    /** v21.3：稳定回调（配合 `SkillListRow` 的 React.memo，避免切换作用域时全量重渲）。 */
    const rowActionsRef = useRef({ selectRow, toggleRow, onRowKeyDown });
    rowActionsRef.current = { selectRow, toggleRow, onRowKeyDown };
    const stableSelectRow = useCallback((key) => rowActionsRef.current.selectRow(key), []);
    const stableToggleRow = useCallback((item, next) => {
        void rowActionsRef.current.toggleRow(item, next);
    }, []);
    const stableRowKeyDown = useCallback((event, key) => rowActionsRef.current.onRowKeyDown(event, key), []);
    /** 一组技能行（列表容器 + 可访问性标签）。行组件 memo 化，只重渲状态变化的行。 */
    const renderRows = (list, label) => (_jsx("ul", { className: "skp-list", role: "listbox", "aria-label": label, children: list.map((item) => {
            const key = skillRowKey(item);
            const isProject = isProjectSource(item.source);
            const visibilityEditable = scope === "global" && !isProject;
            const entry = visibilityOf(item.name);
            const invisible = visibilityEditable && isRowInvisible(item, entry, projects);
            const overrideState = workspaceSelected && !isProject ? workspaceOverrideOf(projectOverrides, "skills", item.name) : "inherit";
            const switcher = skillSwitchDisabled(item, scope);
            return (_jsx("li", { role: "presentation", children: _jsx(SkillListRow, { item: item, selected: selected === key, busy: busyRow === key, scope: scope, projectName: projectName, projects: projects, visibilityEntry: entry, globalOff: globalOffOf(item), invisible: invisible, overrideState: overrideState, hasDiskGlobal: diskGlobalItems.some((global) => global.name === item.name), switchDisabled: switcher.disabled, switchTitle: switcher.title, rowRefs: rowRefs, onSelect: stableSelectRow, onToggle: stableToggleRow, onKeyDown: stableRowKeyDown }) }, key));
        }) }));
    /** 一个分组头（标题 + 计数 + 说明）。 */
    const renderGroupHead = (title, count, note) => (_jsxs("div", { className: "skp-list-group-head", children: [_jsx("span", { className: "skp-list-group-title", children: title }), _jsx("span", { className: "skp-group-count", children: count }), _jsx("span", { className: "skp-list-group-note", children: note })] }));
    /** 空态：按「一个都没有」与「搜索无匹配」区分，并给原地添加入口。 */
    const renderEmpty = () => {
        if (q.length > 0) {
            return _jsxs("div", { className: "skp-empty", children: ["\u6CA1\u6709\u5339\u914D\u300C", query.trim(), "\u300D\u7684 Skills\u3002"] });
        }
        return (_jsxs("div", { className: "skp-empty", children: [_jsx("div", { children: scope === "global" ? "全局还没有 Skills。" : `工作区 ${projectName ?? ""} 还没有 Skills。` }), _jsx("button", { type: "button", className: "skp-btn", style: { marginTop: 10 }, onClick: () => setInstallOpen(true), children: scope === "global" ? "添加到全局" : "添加到此工作区" })] }));
    };
    /** 列表主体：全局 = 用户安装 + 插件注入；工作区 = 本项目 + 引用的全局能力。 */
    const renderListBody = () => {
        if (loading && data === undefined)
            return _jsx("div", { className: "skp-status", children: "\u52A0\u8F7D\u4E2D\u2026" });
        if (error !== undefined)
            return _jsxs("div", { className: "skp-error", children: ["\u8BFB\u53D6\u5931\u8D25\uFF1A", error] });
        if (scope === "global") {
            if (visibleDiskGlobal.length === 0 && visibleInjected.length === 0)
                return renderEmpty();
            return (_jsxs("div", { className: "skp-group-scroll skp-group-scroll-plain", children: [visibleDiskGlobal.length > 0 && (_jsxs(_Fragment, { children: [renderGroupHead("用户安装", diskGlobalItems.length, "~/.agents/skills"), renderRows(visibleDiskGlobal, "用户安装的全局 Skills")] })), visibleInjected.length > 0 && (_jsxs(_Fragment, { children: [renderGroupHead("插件注入", injectedItems.length, "只读 · 可启停"), renderRows(visibleInjected, "插件注入的 Skills")] }))] }));
        }
        if (visibleProject.length === 0 && visibleGlobal.length === 0) {
            if (hiddenCount > 0) {
                return (_jsxs("div", { className: "skp-group-scroll skp-group-scroll-plain", children: [_jsx("div", { className: "skp-empty", children: "\u672C\u5DE5\u4F5C\u533A\u6CA1\u6709\u53EF\u89C1\u7684 Skills\u3002" }), _jsxs("div", { className: "skp-pane-note", children: ["\u53E6\u6709 ", hiddenCount, " \u4E2A\u80FD\u529B\u672A\u5BF9\u6B64\u5916\u5DE5\u4F5C\u533A\u5F00\u653E"] })] }));
            }
            return renderEmpty();
        }
        return (_jsxs("div", { className: "skp-group-scroll skp-group-scroll-plain", children: [visibleProject.length > 0 && (_jsxs(_Fragment, { children: [renderGroupHead(`本项目 · ${projectName ?? "工作区"}`, projectItems.length, "工作区独有"), renderRows(visibleProject, "本项目 Skills")] })), visibleGlobal.length > 0 && (_jsxs(_Fragment, { children: [renderGroupHead("引用的全局能力", globalItemsForScope.length, `开关作用于 ${projectName ?? "此工作区"}`), renderRows(visibleGlobal, "引用的全局 Skills")] })), hiddenCount > 0 && (_jsxs("div", { className: "skp-pane-note", title: "\u8FD9\u4E9B\u80FD\u529B\u5728\u5168\u5C40\u89C6\u56FE\u91CC\u672A\u88AB\u5F00\u653E\u7ED9\u672C\u5DE5\u4F5C\u533A\uFF1B\u8BF7\u5728\u5168\u5C40\u89C6\u56FE\u7684\u300C\u53EF\u89C1\u8303\u56F4\u300D\u91CC\u5F00\u542F", children: ["\u53E6\u6709 ", hiddenCount, " \u4E2A\u80FD\u529B\u672A\u5BF9\u6B64\u5916\u5DE5\u4F5C\u533A\u5F00\u653E"] }))] }));
    };
    return (_jsxs("div", { className: "skp-domain", children: [opError !== undefined && _jsx("div", { className: "skp-error", children: opError }), scope === "global" && globalOverrides?.errors !== undefined && globalOverrides.errors.length > 0 && (_jsxs("div", { className: "skp-error", children: ["\u5168\u5C40\u9ED8\u8BA4\u540D\u5355\u8BFB\u53D6\u5931\u8D25\uFF08\u6309\u7A7A\u540D\u5355\u5904\u7406\uFF09\uFF1A", globalOverrides.errors.join("; ")] })), _jsxs("div", { className: "skp-body", children: [_jsxs("div", { className: "skp-list-pane", children: [_jsxs("div", { className: "skp-list-head", children: [_jsxs("span", { className: "skp-list-title", title: listTitle, children: [_jsx("span", { className: "skp-list-title-scope", children: scope === "global" ? "全局" : (projectName ?? "工作区") }), _jsx("span", { className: "skp-list-title-type", children: scope === "global" ? " Skills" : " · Skills" })] }), _jsx("span", { className: "skp-group-count", title: "\u5F53\u524D\u4F5C\u7528\u57DF\u603B\u6570", children: q.length > 0 ? `${visibleItems.length} / ${scopeTotal}` : scopeTotal }), _jsx("span", { className: "skp-list-note", children: listNote }), loading && data !== undefined && _jsx("span", { className: "skp-refresh-note", children: "\u5237\u65B0\u4E2D\u2026" }), _jsx("span", { className: "skp-detail-head-spacer" }), _jsx("button", { type: "button", className: "skp-btn skp-btn-primary skp-list-add", title: addTitle, "aria-label": addTitle, onClick: () => setInstallOpen(true), children: addLabel })] }), scope === "global" && (_jsx("div", { className: "skp-pane-note", title: globalOverrides?.filePath, children: globalOverrides?.filePath !== undefined
                                    ? `全局默认写入 ${globalOverrides.filePath}`
                                    : "全局默认对所有工作区生效；工作区可单独覆盖" })), scope === "workspace" && (_jsxs("div", { className: "skp-pane-note", children: ["\u5F00\u5173\u4F5C\u7528\u4E8E ", projectName ?? "此工作区", " \u7684\u9ED8\u8BA4\u503C \u00B7 \u5176\u5B83\u5DE5\u4F5C\u533A\u4E0D\u53D7\u5F71\u54CD"] })), renderListBody()] }), _jsx("div", { className: "skp-detail skp-detail-fixed skp-detail-flush", children: selectedItem !== undefined ? (_jsx(SkillDetail, { summary: selectedItem, api: skillsApi, scope: scope, workspace: workspace, projectName: projectName, workspaces: projects, onSelectWorkspace: onSelectWorkspace, visibility: scope === "global" && !isProjectSource(selectedItem.source)
                                ? {
                                    api,
                                    entry: visibilityOf(selectedItem.name),
                                    globalOff: globalOffOf(selectedItem),
                                    onSaved: () => {
                                        setGlobalVersion((value) => value + 1);
                                        setWriteVersion((value) => value + 1);
                                        reload({ silent: true });
                                    },
                                }
                                : undefined, contentVersion: contentVersion, onChanged: () => {
                                setContentVersion((value) => value + 1);
                                reload({ silent: true });
                            }, onRemoved: () => {
                                setSelected(undefined);
                                setContentVersion((value) => value + 1);
                                reload({ silent: true });
                            } }, skillRowKey(selectedItem))) : (_jsx("div", { className: "skp-detail-empty", children: scopeTotal === 0
                                ? "此作用域还没有 Skills。用列表标题栏的「＋ 添加 Skill」添加一个。"
                                : "选择一个条目查看说明与全部文件内容。" })) })] }), installOpen && (_jsx(InstallDialog, { api: skillsApi, scope: scope === "global" ? "global" : "project", workspace: workspace, projectName: projectName, onClose: () => setInstallOpen(false), onInstalled: () => {
                    setInstallOpen(false);
                    setContentVersion((value) => value + 1);
                    reload({ silent: true });
                } }))] }));
}
/**
 * 详情卡片（v20.1）：标题 / 两段作用域链（全局 → 工作区）/ 动作区 / 元信息 +
 * **文件树与阅读器**（见 skill-content.tsx）。
 *
 * 作用域链只到工作区：全局视图第二段是「在「工作区」作用域查看 ↗」入口；
 * 工作区视图第二段显示该工作区的真实有效状态。会话级开关不进入本面板。
 */
function SkillDetail({ summary, api, scope, workspace, projectName, workspaces, onSelectWorkspace, visibility, contentVersion, onChanged, onRemoved, }) {
    const [busy, setBusy] = useState(false);
    const [opError, setOpError] = useState(undefined);
    const [confirmImport, setConfirmImport] = useState(false);
    const [exportPathOpen, setExportPathOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    /** v22：长元数据（frontmatter / 可见范围 / 路径 / 调用方式）默认收起。 */
    const [metaOpen, setMetaOpen] = useState(false);
    /**
     * v21.2：详情 frontmatter（`skills.read` 的 spec：name/description/whenToUse/
     * invocation/metadata）。读取失败或注入行 fallback 失败时静默降级（不渲染区块，
     * 不阻塞详情）；写操作后随 contentVersion 重读。
     */
    const [frontmatter, setFrontmatter] = useState(undefined);
    useEffect(() => {
        let alive = true;
        setFrontmatter(undefined);
        void api
            .read(summary.name, skillRefOf(summary))
            .then((detail) => {
            if (alive && detail !== undefined)
                setFrontmatter(detail.spec);
        })
            .catch(() => {
            /* 静默降级：保留摘要行，不渲染 frontmatter 区块 */
        });
        return () => {
            alive = false;
        };
    }, [api, summary.name, summary.root, summary.source, contentVersion]);
    const isGlobal = isGlobalSkillSource(summary.source);
    const isProject = isProjectSource(summary.source);
    const hasWorkspace = workspace !== undefined;
    // 宿主 registry 注入行：正文/资源只读、无磁盘副本，但保留启停。
    const injected = summary.injected === true;
    const state = invocationState(summary);
    /** 两段作用域链（全局 → 工作区）的文案：回答「为什么是现在这个状态」。 */
    const globalSegment = (() => {
        if (isProject)
            return { on: false, title: "未配置", note: "本项只存在于所选工作区" };
        const on = globalDefaultEnabledOf(summary);
        return {
            on,
            title: on ? "已安装 · 默认启用" : "已安装 · 默认关闭",
            note: on ? "对所有工作区生效" : "全局默认关闭；工作区可重新打开",
        };
    })();
    const workspaceSegment = (() => {
        if (isProject) {
            return {
                on: summary.shadowStub !== true,
                title: summary.shadowStub === true ? "屏蔽占位" : "本项独有 · 默认启用",
                note: "来源：本项目 .agents/skills",
            };
        }
        if (summary.projectDefaultEnabled === true) {
            return { on: true, title: "默认启用（重新打开）", note: "来源：工作区覆盖 · 覆盖全局默认关闭" };
        }
        if (summary.projectDefaultDisabled === true || summary.projectShadow === "stub") {
            return { on: false, title: "已关闭（覆盖）", note: "来源：工作区覆盖 · 仅此工作区默认关闭" };
        }
        if (summary.projectDefaultEnabled === false || summary.projectDefaultDisabled === false) {
            return {
                on: effectiveDefaultEnabledOf(summary),
                title: effectiveDefaultEnabledOf(summary) ? "默认启用" : "已关闭",
                note: "来源：工作区覆盖（capability-overrides.json）",
            };
        }
        return {
            on: effectiveDefaultEnabledOf(summary),
            title: effectiveDefaultEnabledOf(summary) ? "默认启用" : "已关闭",
            note: "未配置工作区覆盖 · 跟随全局默认",
        };
    })();
    // 删除确认对话框：Esc = 取消（与 UX §7.9 一致）。
    useEffect(() => {
        if (!deleteOpen)
            return;
        const onKeyDown = (event) => {
            if (event.key === "Escape")
                setDeleteOpen(false);
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [deleteOpen]);
    /** 一键启用/禁用：开关状态 = 模型与用户都可用（两者任一被关即视为禁用）。 */
    const doSetEnabled = async (next) => {
        setBusy(true);
        setOpError(undefined);
        try {
            const result = await api.setEnabled({ ...skillRefOf(summary), enabled: next });
            if (!result.ok) {
                setOpError(result.errors.join("; "));
                return;
            }
            onChanged();
        }
        catch (failure) {
            setOpError(String(failure));
        }
        finally {
            setBusy(false);
        }
    };
    /** 细粒度切换其中一个调用方向（另一个方向保持原样）。 */
    const doSetInvocation = async (modelInvocable, userInvocable) => {
        setBusy(true);
        setOpError(undefined);
        try {
            const result = await api.setInvocation({ ...skillRefOf(summary), modelInvocable, userInvocable });
            if (!result.ok) {
                setOpError(result.errors.join("; "));
                return;
            }
            onChanged();
        }
        catch (failure) {
            setOpError(String(failure));
        }
        finally {
            setBusy(false);
        }
    };
    /** 导出为浏览器下载：flat ⇒ 单个 .md；directory ⇒ 打 zip（store-only）。 */
    const doExportDownload = async () => {
        setBusy(true);
        setOpError(undefined);
        try {
            const result = await api.exportFiles(skillRefOf(summary));
            if (!result.ok) {
                setOpError(result.errors.join("; "));
                return;
            }
            if (result.format === "flat" && result.files.length === 1) {
                downloadBytes(`${result.name}.md`, base64ToBytes(result.files[0].content), "text/markdown");
            }
            else {
                const zip = buildZip(result.files.map((file) => ({ name: `${result.name}/${file.path}`, data: base64ToBytes(file.content) })));
                downloadBytes(`${result.name}.zip`, zip, "application/zip");
            }
        }
        catch (failure) {
            setOpError(String(failure));
        }
        finally {
            setBusy(false);
        }
    };
    /** 确认后删除（对话框已收集用户确认，不再两击）。 */
    const doRemove = async () => {
        setBusy(true);
        setOpError(undefined);
        try {
            const result = await api.remove(skillRefOf(summary));
            if (!result.ok) {
                setOpError(result.errors.join("; "));
                setDeleteOpen(false);
                return;
            }
            setDeleteOpen(false);
            onRemoved();
        }
        catch (failure) {
            setOpError(String(failure));
            setDeleteOpen(false);
        }
        finally {
            setBusy(false);
        }
    };
    /** 导入这个全局 skill 到当前项目（项目内已有同名时二次确认覆盖）。 */
    const doImport = async (overwrite) => {
        setBusy(true);
        setOpError(undefined);
        try {
            const result = await api.importToProject({ name: summary.name, fromRoot: summary.root, overwrite });
            if (!result.ok) {
                if (result.existed === true) {
                    setConfirmImport(true);
                    return;
                }
                setOpError(result.errors.join("; "));
                return;
            }
            onChanged();
        }
        catch (failure) {
            setOpError(String(failure));
        }
        finally {
            setBusy(false);
        }
    };
    const copyPath = async () => {
        if (summary.path === undefined)
            return;
        try {
            await navigator.clipboard?.writeText(summary.path);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        }
        catch {
            /* 剪贴板不可用时静默 */
        }
    };
    const deleteBody = summary.shadowStub === true
        ? "将删除工作区内的屏蔽占位，同名全局 Skills 在本工作区恢复可用。"
        : isGlobal
            ? "将删除全局 Skills，所有工作区都将不再可用。此操作不可撤销。"
            : "将删除本工作区中的这份 Skills（含目录下的所有文件）。此操作不可撤销。";
    const sourceText = injected
        ? (summary.channel !== undefined && summary.channel.length > 0 ? summary.channel : originLabel(summary))
        : summary.source;
    const formatText = injected
        ? injectedOriginText(summary)
        : summary.format === "directory"
            ? "目录格式"
            : "单文件";
    const invocationNode = injected || summary.readOnly || summary.shadowStub === true ? (_jsxs("span", { children: ["\u6A21\u578B ", summary.modelInvocable ? "✓" : "✗", " \u00B7 \u7528\u6237 ", summary.userInvocable ? "✓" : "✗"] })) : (_jsxs("span", { className: "skp-invoke-btns", children: [_jsxs("button", { type: "button", className: `skp-btn ${summary.modelInvocable ? "skp-state-on" : "skp-state-off"}`, disabled: busy, title: summary.modelInvocable
                    ? "点击关闭模型调用（agent 不再自动触发；用户仍可 /name 调用）"
                    : "点击开启模型调用（agent 可自动触发）", onClick: () => void doSetInvocation(!summary.modelInvocable, summary.userInvocable), children: ["\u6A21\u578B ", summary.modelInvocable ? "✓" : "✗"] }), _jsxs("button", { type: "button", className: `skp-btn ${summary.userInvocable ? "skp-state-on" : "skp-state-off"}`, disabled: busy, title: summary.userInvocable
                    ? "点击关闭用户调用（输入框 /name 不再注入此 Skills；模型仍可自动触发）"
                    : "点击开启用户调用（输入框 /name 可注入此 Skills）", onClick: () => void doSetInvocation(summary.modelInvocable, !summary.userInvocable), children: ["\u7528\u6237 ", summary.userInvocable ? "✓" : "✗"] })] }));
    /** v22：低频与破坏性动作收进 ⋯ 菜单（启停开关常驻标题行）。 */
    const menuItems = [];
    if (summary.path !== undefined) {
        menuItems.push({ key: "copy-path", label: copied ? "已复制路径" : "复制路径", onSelect: () => void copyPath() });
    }
    if (!summary.readOnly && !injected) {
        if (hasWorkspace && isGlobal) {
            menuItems.push({
                key: "import",
                label: confirmImport ? "确认覆盖工作区内的同名 Skills？" : "复制到本工作区",
                danger: confirmImport,
                title: confirmImport
                    ? "工作区内已有同名 Skills，再次点击将覆盖为全局副本"
                    : "复制到本工作区（.agents/skills），此后可在本工作区独立启停",
                onSelect: () => void doImport(confirmImport),
            });
        }
        menuItems.push({ key: "export", label: "导出", onSelect: () => void doExportDownload() });
        menuItems.push({ key: "export-path", label: "导出到路径…", onSelect: () => setExportPathOpen(true) });
        menuItems.push({ key: "delete", label: "删除", danger: true, title: deleteBody, onSelect: () => setDeleteOpen(true) });
    }
    const toggleTitle = injected || summary.readOnly
        ? "只读条目不可启停"
        : state === "partial"
            ? "部分禁用（模型 / 用户其一已关）：点击启用全部调用方向"
            : state === "full"
                ? isGlobal
                    ? "全局默认在列表行尾设置；此处切换会同时影响所有工作区"
                    : "点击禁用（用户与模型都不可调用）"
                : "点击启用（恢复用户与模型调用）";
    return (_jsxs(DetailPage, { children: [_jsxs("div", { className: "skp-detail-head-wrap", children: [_jsx(DetailTitleBar, { title: summary.name, tags: injected ? (_jsxs(_Fragment, { children: [_jsx("span", { className: originTagClass(summary), title: "\u6CE8\u5165\u6765\u6E90\u7C7B\u522B\uFF08\u5185\u7F6E / \u63D2\u4EF6 / \u9884\u8BBE\u6E20\u9053\uFF09", children: originLabel(summary) }), _jsx("span", { className: "skp-tag skp-tag-flat", children: summary.format === "directory" ? "目录" : ".md" }), summary.channel !== undefined && summary.channel.length > 0 && (_jsx("span", { className: "skp-tag skp-tag-channel", title: "\u6CE8\u5165\u65B9 / \u6E20\u9053\u540D\uFF08\u53EA\u8BFB\u6765\u6E90\uFF0C\u65E0\u78C1\u76D8\u526F\u672C\uFF09", children: summary.channel }))] })) : (_jsxs(_Fragment, { children: [_jsx("span", { className: isGlobal ? "skp-tag skp-tag-global" : "skp-tag skp-tag-project", title: isGlobal ? "全局 Skills（对所有工作区生效）" : "仅存在于所选工作区的 Skills", children: isGlobal ? "全局" : "本项" }), _jsx("span", { className: "skp-tag skp-tag-flat", children: summary.format === "directory" ? "目录" : ".md" }), summary.readOnly && _jsx("span", { className: "skp-badge", children: "\u53EA\u8BFB" })] })), right: _jsxs(_Fragment, { children: [!injected && !summary.readOnly && (_jsx(ToggleSwitch, { checked: state !== "none", partial: state === "partial", disabled: busy || (isGlobal && state === "full"), label: state === "full" ? "已启用" : state === "none" ? "已禁用" : "部分禁用", title: toggleTitle, onChange: (next) => void doSetEnabled(next) })), menuItems.length > 0 && _jsx(MoreMenu, { items: menuItems })] }) }), summary.shadowStub === true && _jsx("span", { className: "skp-badge skp-badge-inline", children: "\u5C4F\u853D\u5360\u4F4D" }), isGlobal && summary.projectShadow === "stub" && _jsx("span", { className: "skp-badge skp-badge-inline", children: "\u5DE5\u4F5C\u533A\u9ED8\u8BA4\u5173\u95ED" }), isGlobal && summary.projectShadow === "skill" && (_jsx("span", { className: "skp-badge skp-badge-inline", children: "\u5DE5\u4F5C\u533A\u526F\u672C\u751F\u6548\u4E2D" })), summary.description.length > 0 && (_jsx("div", { className: "skp-detail-desc", children: _jsx("p", { className: "skp-detail-desc-text", title: summary.description, children: summary.description }) })), injected && (_jsxs("div", { className: "skp-detail-readonly", children: [_jsx("span", { className: "skp-detail-readonly-icon", "aria-hidden": "true", children: "i" }), _jsx("span", { children: injectedReadonlyNote(summary) })] })), _jsxs(DetailStrip, { children: [_jsx(ScopeChain, { compact: true, scope: scope, projectName: projectName, globalSeg: globalSegment, workspaceSeg: workspaceSegment, workspaces: workspaces, onSelectWorkspace: onSelectWorkspace }), _jsx(StripSeparator, {}), _jsxs("span", { className: "skp-strip-item", children: ["\u6765\u6E90 ", _jsx("span", { className: "skp-strip-strong", children: sourceText })] }), _jsx(StripSeparator, {}), _jsx("span", { className: "skp-strip-item", children: formatText }), summary.path !== undefined && (_jsxs(_Fragment, { children: [_jsx(StripSeparator, {}), _jsx("button", { type: "button", className: "skp-link-btn skp-strip-item", title: summary.path, onClick: () => void copyPath(), children: copied ? "已复制路径" : "复制路径" })] })), _jsxs("span", { className: "skp-strip-right", children: [visibility !== undefined && (_jsx(VisibilityEditControl, { api: visibility.api, domain: "skills", capabilityKey: summary.name, name: summary.name, entry: visibility.entry, workspaces: workspaces, globalOff: visibility.globalOff, onSaved: visibility.onSaved })), _jsxs("button", { type: "button", className: "skp-strip-meta-btn", "aria-expanded": metaOpen, onClick: () => setMetaOpen((value) => !value), children: ["\u5143\u6570\u636E ", metaOpen ? "⌃" : "⌄"] })] })] })] }), metaOpen && (_jsxs(Modal, { wide: true, title: `元数据 · ${summary.name}`, onClose: () => setMetaOpen(false), children: [_jsxs(MetaGrid, { children: [_jsx(MetaCell, { label: "\u6765\u6E90", children: sourceText }), _jsx(MetaCell, { label: "\u683C\u5F0F", children: summary.format === "directory" ? "目录（多文件）" : "单文件" }), summary.path !== undefined && (_jsx(MetaCell, { label: "\u8DEF\u5F84", mono: true, title: summary.path, children: summary.path })), _jsx(MetaCell, { label: "\u8C03\u7528\u65B9\u5F0F", children: invocationNode }), summary.whenToUse !== undefined && (_jsx(MetaCell, { label: "\u4F7F\u7528\u65F6\u673A", title: summary.whenToUse, children: summary.whenToUse }))] }), visibility !== undefined && (_jsx("dl", { className: "skp-detail-fields", style: { marginTop: 12 }, children: _jsx(VisibilityDetailFields, { summaryOnly: true, api: visibility.api, domain: "skills", capabilityKey: summary.name, name: summary.name, entry: visibility.entry, workspaces: workspaces, globalOff: visibility.globalOff, onSaved: visibility.onSaved }) })), frontmatter !== undefined && _jsx(SkillFrontmatterSection, { spec: frontmatter }), _jsxs("div", { className: "skp-modal-actions", children: [summary.path !== undefined && (_jsx("button", { type: "button", className: "skp-btn", onClick: () => void copyPath(), children: copied ? "已复制路径" : "复制路径" })), _jsx("button", { type: "button", className: "skp-btn", onClick: () => setMetaOpen(false), children: "\u5173\u95ED" })] })] })), opError !== undefined && (_jsx("div", { className: "skp-error", style: { margin: "8px 24px 0" }, children: opError })), _jsx("div", { className: "skp-detail-body", children: _jsx(SkillContent, { summary: summary, api: api, refreshKey: contentVersion }) }), exportPathOpen && _jsx(ExportToPathDialog, { summary: summary, api: api, onClose: () => setExportPathOpen(false) }), deleteOpen && (_jsxs(Modal, { title: `删除 Skills 「${summary.name}」？`, onClose: () => setDeleteOpen(false), children: [_jsx("p", { className: "skp-modal-text", children: deleteBody }), _jsxs("div", { className: "skp-modal-actions", children: [_jsx("button", { type: "button", className: "skp-btn", autoFocus: true, onClick: () => setDeleteOpen(false), children: "\u53D6\u6D88" }), _jsx("button", { type: "button", className: "skp-btn skp-btn-danger", disabled: busy, onClick: () => void doRemove(), children: busy ? "删除中…" : "删除" })] })] }))] }));
}
/**
 * Skills 列表单行（v21.3，`React.memo`）：列表 160+ 行时避免切作用域/选中/搜索
 * 引发全量重渲。props 全部为原始值或稳定引用（回调由父级 ref 包装成稳定函数）。
 */
const SkillListRow = memo(function SkillListRow({ item, selected, busy, scope, projectName, projects, visibilityEntry, globalOff, invisible, overrideState, hasDiskGlobal, switchDisabled, switchTitle, rowRefs, onSelect, onToggle, onKeyDown, }) {
    const key = skillRowKey(item);
    const isProject = isProjectSource(item.source);
    const isInjected = item.injected === true;
    const state = invocationState(item);
    /** 只有「全局视图里的全局条目」编辑可见性；项目自己的条目不参与。 */
    const visibilityEditable = scope === "global" && !isProject;
    const mode = item.visibilityMode ?? visibilityModeOf(visibilityEntry);
    const visibleCount = item.visibleWorkspaceCount ?? visibleWorkspaceCountOf(visibilityEntry, projects);
    // 开关勾选态：全局视图 = 全局默认；工作区视图 = 有效默认；项目磁盘行 = 调用状态。
    const checked = scope === "global"
        ? globalDefaultEnabledOf(item)
        : isProject
            ? item.shadowStub === true
                ? false
                : item.modelInvocable && item.userInvocable
            : effectiveDefaultEnabledOf(item);
    const tags = skillTags(item, hasDiskGlobal);
    const dotClass = isInjected
        ? checked
            ? "skp-dot skp-dot-enabled"
            : "skp-dot skp-dot-hollow"
        : item.shadowStub === true || item.readOnly
            ? "skp-dot skp-dot-hollow"
            : state === "full"
                ? "skp-dot skp-dot-enabled"
                : state === "partial"
                    ? "skp-dot skp-dot-partial"
                    : "skp-dot";
    const dotText = isInjected
        ? checked
            ? "已启用"
            : "默认关闭"
        : item.shadowStub === true
            ? "屏蔽占位"
            : item.readOnly
                ? "只读"
                : state === "full"
                    ? "已启用"
                    : state === "partial"
                        ? "部分禁用"
                        : "已禁用";
    // v21 UX 修订：全局视图行尾不再有单开关（默认按工作区在弹层里配）；
    // 工作区视图保留行尾默认开关（写本工作区覆盖）。
    /** 项目自己的技能没有「全局默认」可言：不显示「跟随全局/已覆盖」文案。 */
    const switchLabel = isProject ? "" : `默认 · ${overrideState === "inherit" ? "跟随全局" : "已覆盖"}`;
    return (_jsxs("div", { role: "option", "aria-selected": selected, tabIndex: selected ? 0 : -1, className: selected ? "skp-row skp-row-active" : "skp-row", ref: (element) => {
            if (element === null)
                rowRefs.current.delete(key);
            else
                rowRefs.current.set(key, element);
        }, onClick: () => onSelect(key), onKeyDown: (event) => onKeyDown(event, key), children: [_jsxs("div", { className: "skp-row-name", children: [(isProject || isInjected || scope === "workspace") && (_jsxs(_Fragment, { children: [_jsx("span", { className: dotClass, "aria-hidden": "true" }), _jsx("span", { className: "skp-sr-only", children: dotText })] })), _jsx("span", { className: "skp-row-title", title: item.name, children: item.name })] }), _jsxs("div", { className: "skp-row-mid", children: [_jsxs("div", { className: "skp-row-tags", children: [tags.map((tag) => (_jsx("span", { className: tag.className, title: tag.title, children: tag.label }, tag.key))), visibilityEditable && (_jsx(VisibilityRowMeta, { entry: visibilityEntry, workspaces: projects, globalOff: globalOff, mode: mode, count: visibleCount, invisible: invisible })), overrideState !== "inherit" && (_jsx("span", { className: "skp-tag skp-tag-warn", title: overrideState === "on"
                                    ? "本工作区显式打开该能力（覆盖全局的每工作区默认）；点行尾开关可关闭"
                                    : "本工作区显式关闭该能力（覆盖全局的每工作区默认）；点行尾开关可打开", children: "\u5DF2\u8986\u76D6" }))] }), scope === "workspace" && (_jsxs("label", { className: "skp-row-toggle", title: switchTitle, onClick: (event) => event.stopPropagation(), onKeyDown: (event) => event.stopPropagation(), children: [switchLabel.length > 0 && _jsx("span", { className: "skp-row-default-label", children: switchLabel }), _jsxs("span", { className: "skp-switch", children: [_jsx("input", { type: "checkbox", role: "switch", "aria-label": `启用 ${item.name}`, checked: checked, disabled: switchDisabled || busy, onChange: (event) => onToggle(item, event.target.checked) }), _jsx("span", { className: "skp-switch-track" })] })] }))] }), _jsx("div", { className: "skp-row-desc", children: item.description.length > 0 ? item.description : "（无描述）" })] }));
});
// ---------------------------------------------------------------------------
// 模态框
// ---------------------------------------------------------------------------
// 外壳（skp-modal-overlay / skp-modal）抽到了 modal.tsx 供 Skills 与 MCP
// 两个域共用；这里的对话框组件只负责各自的内容与提交逻辑。
/** 安装对话框的来源模式与 Tab 文案。 */
const INSTALL_MODE = { upload: "上传", path: "宿主路径", url: "URL" };
/**
 * 安装对话框（v20.1）：**固定落点**，不再二次选择类型 / 作用域。
 *
 * 类型与落点由「当前 Tab × 当前作用域」决定（Skills + 全局 / Skills + 某工作区），
 * 因此顶部固定一张「落点」卡：作用域徽章 + 写入路径 + 「仅此作用域生效 ·
 * 与当前对话无关」，并提示换落点要先切换顶部作用域。弹窗内只填内容：
 * 上传（.md / 文件夹 / .zip）、宿主路径、URL 三种来源，校验 `SKILL.md`。
 */
function InstallDialog({ api, scope, workspace, projectName, onClose, onInstalled, }) {
    const [mode, setMode] = useState("upload");
    const [overwrite, setOverwrite] = useState(false);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState([]);
    const [sourcePath, setSourcePath] = useState("");
    const [url, setUrl] = useState("");
    const [picked, setPicked] = useState(undefined);
    const fileInputRef = useRef(null);
    const dirInputRef = useRef(null);
    const zipInputRef = useRef(null);
    const isGlobal = scope === "global";
    const title = isGlobal ? "添加 Skill 到全局" : `添加 Skill 到工作区 ${projectName ?? "工作区"}`;
    const targetPath = isGlobal ? "~/.agents/skills/" : `${workspace ?? "<工作区>"}/.agents/skills/`;
    /** 选中单个 .md 文件（flat 安装）。 */
    const onPickFile = async (input) => {
        const file = input.files?.[0];
        input.value = ""; // 允许重复选同一文件
        if (file === undefined)
            return;
        setErrors([]);
        try {
            const content = await fileToBase64(file);
            setPicked({ label: file.name, files: [{ path: file.name, content }] });
        }
        catch (failure) {
            setErrors([String(failure)]);
        }
    };
    /**
     * 选中整个目录（directory 安装）：webkitRelativePath 形如
     * `<folder>/<rel>`，剥掉首段得到 skill 内部相对路径；根上必须有 SKILL.md。
     */
    const onPickDirectory = async (input) => {
        const files = Array.from(input.files ?? []);
        input.value = "";
        if (files.length === 0)
            return;
        setErrors([]);
        try {
            const payload = [];
            let folder = "";
            for (const file of files) {
                const relative = file.webkitRelativePath || file.name;
                const segments = relative.split("/");
                folder = segments[0] ?? folder;
                const inner = segments.slice(1).join("/");
                if (inner.length === 0)
                    continue; // 目录占位项，跳过
                payload.push({ path: inner, content: await fileToBase64(file) });
            }
            if (!payload.some((entry) => entry.path === "SKILL.md")) {
                setPicked(undefined);
                setErrors([`文件夹 "${folder}" 的根目录下没有 SKILL.md`]);
                return;
            }
            setPicked({ label: `${folder}/（${payload.length} 个文件）`, files: payload });
        }
        catch (failure) {
            setErrors([String(failure)]);
        }
    };
    /**
     * 选中 .zip 压缩包：浏览器端解压 → 剥公共顶层文件夹 → 与宿主下载安装
     * 同一套 locate 口径定位 skill 根（唯一 SKILL.md 或单 flat .md）→
     * 重定根为上传清单。
     */
    const onPickArchive = async (input) => {
        const file = input.files?.[0];
        input.value = "";
        if (file === undefined)
            return;
        setErrors([]);
        try {
            const entries = await unzip(new Uint8Array(await file.arrayBuffer()));
            const stripped = stripCommonTopFolder(entries.map((entry) => entry.path));
            const normalized = entries.map((entry, i) => ({ ...entry, path: stripped[i] }));
            const located = locateSkillRoot(normalized.map((entry) => entry.path));
            if (!located.ok) {
                setPicked(undefined);
                setErrors([located.error]);
                return;
            }
            const payload = rerootEntries(normalized, located.root).map((entry) => ({ path: entry.path, content: bytesToBase64(entry.data) }));
            setPicked({ label: `${file.name}（${payload.length} 个文件）`, files: payload });
        }
        catch (failure) {
            setPicked(undefined);
            setErrors([String(failure)]);
        }
    };
    const doInstall = async () => {
        setBusy(true);
        setErrors([]);
        // 落点已由列表标题栏决定（global / 指定工作区），这里不再判断/切换。
        const writableScope = isGlobal ? "global" : "project";
        const target = isGlobal ? undefined : ".agents";
        try {
            const result = mode === "upload"
                ? await api.installUpload({ scope: writableScope, target, files: picked?.files ?? [], overwrite })
                : mode === "path"
                    ? await api.installFromPath({ scope: writableScope, target, sourcePath: sourcePath.trim(), overwrite })
                    : await api.installFromUrl({ scope: writableScope, target, url: url.trim(), overwrite });
            if (!result.ok) {
                setErrors(result.errors);
                return;
            }
            onInstalled();
        }
        catch (failure) {
            setErrors([String(failure)]);
        }
        finally {
            setBusy(false);
        }
    };
    const canSubmit = !busy &&
        (mode === "upload" ? picked !== undefined : mode === "path" ? sourcePath.trim().length > 0 : url.trim().length > 0);
    return (_jsx(Modal, { title: title, onClose: onClose, children: _jsxs("div", { className: "skp-form", children: [_jsxs("div", { className: "skp-landing", children: [_jsxs("div", { className: "skp-landing-head", children: [_jsx("span", { className: "skp-landing-icon", "aria-hidden": "true", children: "\u2316" }), _jsx("span", { className: "skp-field-label", children: "\u843D\u70B9" }), _jsx("span", { className: isGlobal ? "skp-tag skp-tag-global" : "skp-tag skp-tag-project", children: isGlobal ? "全局" : `工作区 ${projectName ?? "工作区"}` }), _jsx("span", { className: "skp-landing-note", children: "\u4EC5\u6B64\u4F5C\u7528\u57DF\u751F\u6548 \u00B7 \u4E0E\u5F53\u524D\u5BF9\u8BDD\u65E0\u5173" }), _jsx("span", { className: "skp-detail-head-spacer" }), _jsx("span", { className: "skp-landing-hint", children: "\u8981\u6362\u843D\u70B9\uFF1F\u5148\u5207\u6362\u9876\u90E8\u4F5C\u7528\u57DF" })] }), _jsx("code", { className: "skp-landing-path", title: targetPath, children: targetPath })] }), _jsx("div", { className: "skp-tabs", role: "tablist", children: Object.keys(INSTALL_MODE).map((m) => (_jsx("button", { role: "tab", "aria-selected": mode === m, className: mode === m ? "skp-tab skp-tab-active" : "skp-tab", onClick: () => setMode(m), children: INSTALL_MODE[m] }, m))) }), mode === "upload" && (_jsxs("div", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "\u6765\u6E90" }), _jsxs("div", { className: "skp-subheader-row", children: [_jsx("button", { type: "button", className: "skp-btn", onClick: () => fileInputRef.current?.click(), children: "\u9009\u62E9 .md \u6587\u4EF6" }), _jsx("button", { type: "button", className: "skp-btn", onClick: () => dirInputRef.current?.click(), children: "\u9009\u62E9\u6587\u4EF6\u5939" }), _jsx("button", { type: "button", className: "skp-btn", onClick: () => zipInputRef.current?.click(), children: "\u9009\u62E9 .zip" })] }), _jsx("input", { ref: fileInputRef, type: "file", accept: ".md,text/markdown", hidden: true, onChange: (e) => void onPickFile(e.currentTarget) }), _jsx("input", { ref: (el) => {
                                dirInputRef.current = el;
                                el?.setAttribute("webkitdirectory", "");
                            }, type: "file", multiple: true, hidden: true, onChange: (e) => void onPickDirectory(e.currentTarget) }), _jsx("input", { ref: zipInputRef, type: "file", accept: ".zip,application/zip", hidden: true, onChange: (e) => void onPickArchive(e.currentTarget) }), _jsx("span", { className: "skp-note", children: picked !== undefined ? `已选择：${picked.label}` : "选择单个 <名称>.md 文件、包含 SKILL.md 的文件夹，或 .zip 压缩包。" })] })), mode === "path" && (_jsxs("div", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "\u5BBF\u4E3B\u4E0A\u7684\u6E90\u8DEF\u5F84" }), _jsx("input", { className: "skp-input", type: "text", placeholder: "/path/to/skill \u76EE\u5F55\u6216 <\u540D\u79F0>.md", value: sourcePath, onChange: (e) => setSourcePath(e.target.value) })] })), mode === "url" && (_jsxs("div", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "\u4E0B\u8F7D URL" }), _jsx("input", { className: "skp-input", type: "url", placeholder: "https://github.com/<owner>/<repo>[/tree/<branch>/<dir>] \u6216 .zip / .md \u94FE\u63A5", value: url, onChange: (e) => setUrl(e.target.value) }), _jsx("span", { className: "skp-note", children: "\u652F\u6301 GitHub \u4ED3\u5E93\uFF08\u6574\u5E93\u6216 /tree/\u2026 \u5B50\u76EE\u5F55\uFF09\u3001.zip \u94FE\u63A5\u6216 raw .md \u94FE\u63A5\u3002" })] })), _jsxs("label", { className: "skp-field skp-field-inline", children: [_jsx("input", { type: "checkbox", checked: overwrite, onChange: (e) => setOverwrite(e.target.checked) }), "\u540C\u540D Skills \u5DF2\u5B58\u5728\u65F6\u8986\u76D6"] }), errors.length > 0 && _jsx("div", { className: "skp-error", children: errors.join("\n") }), _jsxs("div", { className: "skp-modal-actions", children: [_jsx("button", { type: "button", className: "skp-btn", onClick: onClose, children: "\u53D6\u6D88" }), _jsx("button", { type: "button", className: "skp-btn skp-btn-primary", disabled: !canSubmit, onClick: doInstall, children: busy ? "安装中…" : "安装" })] })] }) }));
}
/** 导出到宿主路径的小对话框：目标目录 + 覆盖开关。 */
function ExportToPathDialog({ summary, api, onClose }) {
    const [destDir, setDestDir] = useState("");
    const [overwrite, setOverwrite] = useState(false);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState([]);
    const doExport = async () => {
        setBusy(true);
        setErrors([]);
        try {
            const result = await api.exportToPath({ ...skillRefOf(summary), destDir: destDir.trim(), overwrite });
            if (!result.ok) {
                setErrors(result.errors);
                return;
            }
            onClose();
        }
        catch (failure) {
            setErrors([String(failure)]);
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsx(Modal, { title: `将「${summary.name}」导出到路径`, onClose: onClose, children: _jsxs("div", { className: "skp-form", children: [_jsxs("div", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "\u5BBF\u4E3B\u4E0A\u7684\u76EE\u6807\u76EE\u5F55" }), _jsx("input", { className: "skp-input", type: "text", placeholder: "/path/to/\u76EE\u6807\u76EE\u5F55", value: destDir, onChange: (e) => setDestDir(e.target.value) })] }), _jsxs("label", { className: "skp-field skp-field-inline", children: [_jsx("input", { type: "checkbox", checked: overwrite, onChange: (e) => setOverwrite(e.target.checked) }), "\u76EE\u6807\u5DF2\u5B58\u5728\u65F6\u8986\u76D6"] }), errors.length > 0 && _jsx("div", { className: "skp-error", children: errors.join("\n") }), _jsxs("div", { className: "skp-modal-actions", children: [_jsx("button", { type: "button", className: "skp-btn", onClick: onClose, children: "\u53D6\u6D88" }), _jsx("button", { type: "button", className: "skp-btn skp-btn-primary", disabled: busy || destDir.trim().length === 0, onClick: doExport, children: busy ? "导出中…" : "导出" })] })] }) }));
}
/** File → base64（readAsDataURL 剥掉 `data:…;base64,` 前缀）。 */
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error(`读取 ${file.name} 失败`));
        reader.onload = () => {
            const dataUrl = String(reader.result);
            resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
        };
        reader.readAsDataURL(file);
    });
}
/** 字节 → base64（分块避免 fromCharCode 参数过长）。 */
function bytesToBase64(bytes) {
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}
