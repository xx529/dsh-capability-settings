import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
 * **两份 api，切勿合并（防回归）**：
 *   - 面板自身用 client.ts 中带「项目钉选」的 `api`：`currentWorkspaceCwd`
 *     是 `selection.cwd ?? 当前会话工作区`，所以头部「项目作用域」下拉框
 *     能把项目级视图钉到任意工作区；
 *   - composer（输入框工具行：Skills / MCP 按钮与弹层）在 client.ts 中用
 *     单独的 `composerApi`：`currentWorkspaceCwd` **只**取当前会话自己的
 *     工作区，`selectedProject()` 恒为 undefined。两者共用同一份
 *     `subscribeWorkspace` 回调集合，因此都会随会话工作区切换刷新。
 *   若把面板这份 api 交给 composer，就会出现在面板里把项目作用域钉到 A
 *   工作区后、B 工作区的对话框弹层列出 A 的项目级技能/MCP 的串味 bug。
 *
 * 根容器按能力域分 Tab（**只剩两个**：技能 / MCP，带数据量计数），第二行
 * 是「域 Tab + 搜索框」：搜索框由根组件持有，按域切换 placeholder，两个
 * 视图只接收 `query` 做本地过滤（视图内不再有搜索/安装行）：
 *   - Skills：左列 200–220px 的 ScopeNav（全局 / 项目 + 行尾「+」安装），
 *     中间列按 scope 显示全局技能、工作区选择列表或选中工作区的项目技能
 *     （项目 scope 未选工作区时先列全部工作区，点击 = `api.selectProject`）；
 *     详情页带完整文件树 + SKILL.md 阅读器（见 skill-content.tsx）；
 *   - MCP：同构的左导航 + 中间列（全局含外部注入 / 项目→工作区下钻），
 *     带每个 session 的实时挂载状态（见 mcp-panel.tsx）。
 *
 * 快捷消息域已整体下线（2026-10 产品决定），域 Tab 不再有第三个入口。
 *
 * 布局刻意保持朴素（自带 CSS 类，见 styles.ts），对未经确认的 UI 原语
 * 组件零硬依赖。
 *
 * @module dsh-capability-settings/client/panel
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { McpView } from "./mcp-panel.js";
import { ToolsView } from "./tools-panel.js";
import { JevPanel } from "./jev-panel.js";
import { Modal } from "./modal.js";
import { SkpSelect } from "./select.js";
import { isProjectSource, useAsyncList } from "./panel-common.js";
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
    // 域、工作区标签、下拉框选项、钉选状态各自维护一份 useState；
    // 起始值取自 api 的快照方法。
    //
    // 初始域优先消费外部 pending（`setPanelDomain`）；初始化器只读不写，
    // 避开 React StrictMode 双调用初始化器的副作用问题，pending 由下方
    // effect 在挂载后清空。
    const [domain, setDomain] = useState(() => pendingPanelDomain ?? "skills");
    /** 当前域的搜索词（搜索框在头部，按域切换 placeholder；切域清空）。 */
    const [query, setQuery] = useState("");
    const [workspace, setWorkspace] = useState(() => api.workspaceLabel());
    const [projects, setProjects] = useState(() => api.projects());
    const [pinned, setPinned] = useState(() => api.selectedProject());
    // 域 Tab 计数：由各域视图在数据到达后回填（加载中显示 —）。
    // 口径（UX §3.2 定稿，Lead 2026-10-23 裁决 A）：
    //   - 技能 = 项目条目数 + 全局条目数（含只读、含屏蔽占位，不去重）；
    //   - MCP  = 项目配置条目数 + 全局配置条目数，**不含**外部注入
    //     （外部注入在组 C 单独计数，由 McpView 自己展示）。
    // 搜索不改变 Tab 计数（Tab 计数是总量）。
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
    // 工作区标签/项目选项/钉选状态都会随"当前工作区解析完成或变化、
    // 用户挑选项目"而变；数据源是快照（SnapshotStore），本身不具备响应性，
    // 所以订阅借由 adapter 暴露的 subscribeWorkspace 手动同步。
    useEffect(() => {
        let alive = true;
        const update = () => {
            if (!alive)
                return;
            setWorkspace(api.workspaceLabel());
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
    // 页面 chrome 由主区域提供（侧栏切换主面板 = 关闭）；这里只渲染
    // 标题行 + 域 Tab 与当前域视图。
    //
    // Jev 配置页没有「项目作用域」语义：选中该 Tab 时隐藏工作区路径、项目下拉框
    // 与搜索框（UX v1.5 §5.1 / AC-CFG-2），切回条目域后全部恢复。
    const jevActive = domain === "jev";
    /** Tools 是全局工具注册：不显示项目作用域 / 工作区列表（UX v1.8 §2.5）。 */
    const toolsActive = domain === "tools";
    return (_jsxs("section", { className: "skp-panel", "aria-label": "\u80FD\u529B\u9762\u677F", children: [_jsxs("header", { className: "skp-header", children: [_jsxs("div", { className: "skp-title-row", children: [_jsxs("div", { className: "skp-title-main", children: [_jsx("h2", { children: "\u80FD\u529B\u9762\u677F" }), jevActive ? null : toolsActive ? (_jsx("span", { className: "skp-workspace", title: "\u5168\u5C40\u5DE5\u5177\u6CE8\u518C \u00B7 \u4E0D\u533A\u5206\u9879\u76EE / \u5DE5\u4F5C\u533A", children: "\u5168\u5C40\u5DE5\u5177\u6CE8\u518C \u00B7 \u4E0D\u533A\u5206\u9879\u76EE / \u5DE5\u4F5C\u533A" })) : (workspace !== undefined && (_jsx("span", { className: "skp-workspace", title: workspace, children: workspace })))] }), !jevActive && (toolsActive ? (_jsx("div", { className: "skp-title-tools", children: _jsx(SkpSelect, { className: "skp-dd-scope", value: "", disabled: true, ariaLabel: "\u5DE5\u5177\u4F5C\u7528\u57DF", title: "\u5168\u5C40\u5DE5\u5177\u6CE8\u518C \u00B7 \u4E0D\u533A\u5206\u9879\u76EE / \u5DE5\u4F5C\u533A", options: [{ value: "", label: "全局工具" }], onChange: () => undefined }) })) : (_jsx("div", { className: "skp-title-tools", children: _jsx(SkpSelect, { className: "skp-dd-scope", value: pinned ?? "", title: workspace, ariaLabel: "\u9879\u76EE\u4F5C\u7528\u57DF", options: [
                                        { value: "", label: "跟随当前会话" },
                                        ...projects.map((p) => ({ value: p.path, label: p.title ?? p.path })),
                                        // 钉选的项目不在已知列表里时也保留为选项，避免"消失"。
                                        ...(pinned !== undefined && !projects.some((p) => p.path === pinned) ? [{ value: pinned, label: pinned }] : []),
                                    ], onChange: (value) => api.selectProject(value === "" ? undefined : value) }) })))] }), _jsxs("div", { className: "skp-header-row", children: [_jsx("div", { className: "skp-tabs", role: "tablist", children: DOMAIN_ORDER.map((d) => (_jsxs("button", { role: "tab", "aria-selected": domain === d, className: domain === d ? "skp-tab skp-tab-active" : "skp-tab", onClick: () => {
                                        setDomain(d);
                                        setQuery("");
                                        // 首次进入 Jev 域才挂载配置页；之后常驻以保留未保存草稿。
                                        if (d === "jev")
                                            setJevMounted(true);
                                    }, children: [_jsx("span", { children: DOMAIN_LABEL[d] }), d !== "jev" && _jsx("span", { className: "skp-tab-count", children: counts[d] ?? "—" })] }, d))) }), domain !== "jev" && (_jsx("input", { className: "skp-search skp-header-search", type: "search", "aria-label": DOMAIN_SEARCH_PLACEHOLDER[domain], placeholder: DOMAIN_SEARCH_PLACEHOLDER[domain], value: query, onChange: (event) => setQuery(event.target.value), onKeyDown: (event) => {
                                    if (event.key === "Escape" && query.length > 0) {
                                        event.preventDefault();
                                        setQuery("");
                                    }
                                } }))] })] }), jevActive
                ? null
                : domain === "tools"
                    ? (_jsx(ToolsView, { api: api, workspace: workspace, query: query, onCount: setToolsCount }))
                    : domain === "skills"
                        ? (_jsx(SkillsView, { api: api, workspace: workspace, projects: projects, query: query, pinned: pinned, onSelectWorkspace: (path) => api.selectProject(path), onCount: setSkillsCount }))
                        : (_jsx(McpView, { api: api, workspace: workspace, projects: projects, query: query, pinned: pinned, onSelectWorkspace: (path) => api.selectProject(path), onCount: setMcpCount })), jevMounted && _jsx(JevPanel, { api: api, active: jevActive })] }));
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
        return `Agent 预设 · 仅在「${item.channel ?? "未知预设"}」的会话可见`;
    return item.channel !== undefined && item.channel.length > 0 ? `${item.channel} 运行时注入（不落盘）` : "插件运行时注入（不落盘）";
}
/** 注入行的只读原因条文案（详情页顶部）。 */
function injectedReadonlyNote(item) {
    const channel = item.channel !== undefined && item.channel.length > 0 ? item.channel : "插件";
    if (item.origin === "bundled") {
        return "内容只读 · DSH 内置 Skills（无磁盘副本）；可在列表 / 会话中启用或禁用，不可编辑或删除。";
    }
    if (item.origin === "preset") {
        return `内容只读 · 由 Agent 预设「${channel}」提供（无磁盘副本，仅该预设的会话可见）；只能在会话中启用或禁用，不可编辑或删除。`;
    }
    return `内容只读 · 由插件 ${channel} 运行时注册（无磁盘副本）；可在列表 / 会话中启用或禁用，不可编辑或删除。`;
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
                    ? "由当前 Agent 预设渠道提供，只在绑定该预设的会话里可见"
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
        label: isProject ? "项目" : "全局",
        className: isProject ? "skp-tag skp-tag-project" : "skp-tag skp-tag-global",
        title: isProject ? "本项目内的 Skills，只在本项目生效" : "全局 Skills，对所有项目生效",
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
            title: "已生成屏蔽占位，使同名全局 Skills 在本项目不可用；删除占位即恢复",
        });
    }
    else if (isProject && hasGlobal) {
        tags.push({ key: "override", label: "覆盖全局", className: "skp-tag skp-tag-relation", title: "本项目生效的是这份项目副本；同名全局 Skills 被遮蔽" });
    }
    else if (!isProject && item.projectShadow === "stub") {
        tags.push({
            key: "disabled-in-project",
            label: "本项目已禁用",
            className: "skp-tag skp-tag-warn",
            title: "本项目内已放置屏蔽占位，此 Skills 在本项目不可用（不影响其它项目）",
        });
    }
    else if (!isProject && item.projectShadow === "skill") {
        tags.push({
            key: "project-copy",
            label: "项目副本生效中",
            className: "skp-tag skp-tag-readonly",
            title: "本项目内已有同名 Skills，按优先级本项目中生效的是项目副本",
        });
    }
    return tags;
}
/** 行开关的勾选态（语义见任务规格 / docs/ux/panel-upgrade.md §3.5、§5.3）。 */
function skillSwitchChecked(item) {
    if (item.injected === true) {
        // 注入行：开关表达「本项目默认是否禁用」（写 capability-overrides.json 的 skills 清单）。
        return item.disabledInProject !== true;
    }
    if (isProjectSource(item.source)) {
        // 屏蔽占位 = "在本项目禁用同名全局"的占位条目，本身不应显示为启用。
        if (item.shadowStub === true)
            return false;
        // 项目普通条目：模型与用户两个方向都开才算启用。
        return item.modelInvocable && item.userInvocable;
    }
    // 全局条目：开关表达"本项目是否禁用（有无屏蔽占位）"。
    return item.projectShadow !== "stub";
}
/** 行开关是否置灰 + tooltip（只读 / 项目副本生效中 / 无工作区）。 */
function skillSwitchDisabled(item, hasWorkspace) {
    if (item.injected === true) {
        if (!hasWorkspace) {
            return { disabled: true, title: "先选择工作区，才能设置此注入 Skills 在本项目的默认启停" };
        }
        return {
            disabled: false,
            title: skillSwitchChecked(item)
                ? "关闭：在本项目默认禁用此注入 Skills（写入 .agents/capability-overrides.json，不影响其它项目与其它会话）"
                : "打开：恢复此注入 Skills 在本项目默认可用",
        };
    }
    if (item.readOnly) {
        return { disabled: true, title: "只读来源（.claude 兼容目录），无法修改或删除" };
    }
    if (!hasWorkspace) {
        return { disabled: true, title: "需要可写的工作区才能修改 Skills" };
    }
    const isProject = isProjectSource(item.source);
    if (isProject) {
        if (item.shadowStub === true) {
            return { disabled: false, title: "打开：删除屏蔽占位，恢复同名全局 Skills 在本项目可用" };
        }
        return {
            disabled: false,
            title: skillSwitchChecked(item)
                ? "关闭：模型与用户都不可调用"
                : "打开：恢复模型与用户调用（写入项目副本 frontmatter）",
        };
    }
    if (item.projectShadow === "skill") {
        return { disabled: true, title: "本项目已有同名 Skills（项目副本生效中），请在项目副本上操作" };
    }
    if (item.projectShadow === "stub") {
        return { disabled: false, title: "打开：删除本项目内的屏蔽占位，恢复此全局 Skills 在本项目可用" };
    }
    return {
        disabled: false,
        title: skillSwitchChecked(item)
            ? "关闭：在本项目内禁用此全局 Skills（生成屏蔽占位，不影响其它项目）"
            : "打开：恢复此全局 Skills 在本项目可用",
    };
}
/** 取路径最后一段作为工作区显示名（兼容 POSIX / Windows 分隔符）。 */
function basenameOf(path) {
    const segments = path.split(/[\\/]/).filter((segment) => segment.length > 0);
    return segments[segments.length - 1] ?? path;
}
/**
 * Skills 视图：左侧 ScopeNav（全局 / 项目）+ 中间列 + 右侧详情。
 *
 *  - 全局：中间列显示全部全局技能（含只读/被本项目遮蔽状态标签）；
 *  - 项目：未选工作区时先列全部工作区（点击 = api.selectProject，进入该
 *    工作区的项目技能）；已选工作区时显示「‹ 工作区」返回行 + 该项目技能。
 *
 * 搜索词由根组件头部的同一输入框提供（query），按当前列表过滤：技能名称/
 * 描述，或工作区名/完整路径。行内只有状态点、标签、两行描述与行尾「启用」
 * 开关；导出/导入/删除等动作全部在右侧详情（含文件树与阅读器）。
 */
function SkillsView({ api, workspace, projects, query, pinned, onSelectWorkspace, onCount, }) {
    const skillsApi = api.skills;
    const [scope, setScope] = useState("project");
    const [selected, setSelected] = useState(undefined);
    /** 关系标签互跳的目标行：切 scope / 选工作区后待列表出现再选中。 */
    const [pendingSelect, setPendingSelect] = useState(undefined);
    const [installOpen, setInstallOpen] = useState(false);
    const [installScope, setInstallScope] = useState("project");
    const [opError, setOpError] = useState(undefined);
    const [busyRow, setBusyRow] = useState(undefined);
    /** 写操作计数：传给 SkillContent，变化时清空文件缓存并重拉。 */
    const [contentVersion, setContentVersion] = useState(0);
    const rowRefs = useRef(new Map());
    // 挂载时、工作区变化时（项目作用域列表依赖该 cwd 解析）、写操作后重新拉取。
    const { data: allItems, loading, error, reload } = useAsyncList(() => skillsApi.list(), [skillsApi, workspace]);
    const items = allItems ?? [];
    const projectItems = useMemo(() => items.filter((item) => isProjectSource(item.source)), [items]);
    // 注入行（宿主 registry：内置 / 插件运行时 / preset）单独分组；它们既不是
    // 项目条目也不是磁盘全局条目，但按架构口径计入「全局」计数。
    const injectedItems = useMemo(() => items.filter((item) => item.injected === true), [items]);
    const diskGlobalItems = useMemo(() => items.filter((item) => !isProjectSource(item.source) && item.injected !== true), [items]);
    const globalItems = useMemo(() => [...diskGlobalItems, ...injectedItems], [diskGlobalItems, injectedItems]);
    // 域 Tab 计数 = 全部条目（含只读、含屏蔽占位、含注入，不去重；搜索不影响）。
    useEffect(() => {
        if (!loading && error === undefined)
            onCount?.(items.length);
    }, [items.length, loading, error, onCount]);
    const q = query.trim().toLowerCase();
    const matchesSkill = (item) => q.length === 0 ||
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        // 注入行的渠道名（插件 / preset 名）也参与搜索。
        (item.channel !== undefined && item.channel.toLowerCase().includes(q));
    const diskGlobalVisible = useMemo(() => diskGlobalItems.filter(matchesSkill), [diskGlobalItems, q]);
    const injectedVisible = useMemo(() => injectedItems.filter(matchesSkill), [injectedItems, q]);
    const globalVisible = useMemo(() => [...diskGlobalVisible, ...injectedVisible], [diskGlobalVisible, injectedVisible]);
    const projectVisible = useMemo(() => projectItems.filter(matchesSkill), [projectItems, q]);
    const workspaceVisible = useMemo(() => projects.filter((project) => q.length === 0 || basenameOf(project.path).toLowerCase().includes(q) || project.path.toLowerCase().includes(q)), [projects, q]);
    /** 项目 scope 且尚未选择工作区 → 中间列只显示空态，工作区列表在左导航内。 */
    const showWorkspacePicker = scope === "project" && pinned === undefined;
    /** 当前中间列可选的技能行（决定键盘导航与关系互跳的落点）。 */
    const visibleSkills = useMemo(() => (showWorkspacePicker ? [] : scope === "global" ? globalVisible : projectVisible), [showWorkspacePicker, scope, globalVisible, projectVisible]);
    const visibleKeys = useMemo(() => visibleSkills.map(skillRowKey), [visibleSkills]);
    const selectedItem = items.find((item) => skillRowKey(item) === selected);
    // 工作区切换（含顶部项目下拉 / 左侧工作区列表 / 返回）一律清空选中；
    // pendingSelect 不清——关系互跳会在新列表到达后重新选中目标行。
    useEffect(() => {
        setSelected(undefined);
    }, [workspace, pinned]);
    // 关系标签互跳：切换 scope / 工作区后，等目标行出现再选中。
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
    /** 切 scope：清空选中与待跳目标（搜索结果保留，作用域切换后仍可沿用）。 */
    const switchScope = (next) => {
        if (scope === next)
            return;
        setScope(next);
        setSelected(undefined);
        setPendingSelect(undefined);
        setOpError(undefined);
    };
    /** 选择 / 清除工作区：清空选中，写回面板钉选状态（列表随 workspace 重拉）。 */
    const chooseWorkspace = (path) => {
        // 点工作区 = 进入项目 scope（全局态下也保留工作区列表，点选即切回项目）。
        setScope("project");
        setSelected(undefined);
        setPendingSelect(undefined);
        onSelectWorkspace(path);
    };
    /**
     * 关系标签互跳：项目行「覆盖全局」→ 全局同名行；全局行「项目副本生效中 /
     * 本项目已禁用」→ 项目行。跨 scope 时先切换 scope；项目侧尚未选工作区时
     * 自动钉选当前工作区（若在已知项目列表里），等列表刷新后再选中目标行。
     */
    const jumpToRelated = (item) => {
        // 注入行没有磁盘同名关系（磁盘优先已在宿主去重），不参与互跳。
        if (item.injected === true)
            return;
        const isProject = isProjectSource(item.source);
        let target;
        if (isProject) {
            if (item.shadowStub === true)
                return;
            target = globalItems.find((globalItem) => globalItem.name === item.name);
        }
        else if (item.projectShadow === "stub") {
            target = projectItems.find((entry) => entry.name === item.name && entry.shadowStub === true);
        }
        else if (item.projectShadow === "skill") {
            target = projectItems.find((entry) => entry.name === item.name && entry.shadowStub !== true);
        }
        if (target === undefined)
            return;
        const targetKey = skillRowKey(target);
        if (!isProject) {
            // 全局行 → 项目行：切到项目 scope；未选工作区时尝试钉选当前工作区。
            if (pinned !== undefined) {
                setScope("project");
                setSelected(undefined);
                setPendingSelect(targetKey);
                return;
            }
            const match = projects.find((project) => project.path === workspace);
            if (match === undefined)
                return;
            setScope("project");
            setSelected(undefined);
            setPendingSelect(targetKey);
            onSelectWorkspace(match.path);
            return;
        }
        // 项目行 → 全局行：全局 scope 无需工作区，直接切过去。
        setScope("global");
        setSelected(undefined);
        setPendingSelect(targetKey);
    };
    /** 行内统一开关：按行类型分派到 setEnabled / enableInProject / disableInProject / overrides.toggle。 */
    const toggleRow = async (item, next) => {
        const key = skillRowKey(item);
        if (busyRow !== undefined)
            return;
        setBusyRow(key);
        setOpError(undefined);
        try {
            const isProject = isProjectSource(item.source);
            // 注入行没有磁盘文件：本项目默认启停只能走项目级声明
            // （`.agents/capability-overrides.json` 的 skills 清单），宿主写盘后
            // 对该项目的 live 会话增量 reconcile（注册/解除会话 shadow）。
            if (item.injected === true) {
                if (skillSwitchChecked(item) === next)
                    return;
                const result = await api.overrides.toggle("skills", item.name);
                if (!result.ok) {
                    setOpError(result.errors.join("; "));
                    return;
                }
            }
            else {
                const result = isProject
                    ? item.shadowStub === true
                        ? next
                            ? await skillsApi.enableInProject({ name: item.name })
                            : { ok: true }
                        : await skillsApi.setEnabled({ ...skillRefOf(item), enabled: next })
                    : next
                        ? await skillsApi.enableInProject({ name: item.name })
                        : await skillsApi.disableInProject({ name: item.name, fromRoot: item.root });
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
    const openInstall = (target) => {
        setInstallScope(target);
        setInstallOpen(true);
    };
    /** ScopeNav 一行：作用域名 + 计数 + 右侧「+」安装入口。 */
    const renderScopeItem = (target, label, count) => {
        const addDisabled = target === "project" && pinned === undefined;
        const addTitle = addDisabled ? "先选择工作区" : target === "global" ? "安装 Skills 到全局" : "安装 Skills 到本项目";
        return (_jsxs("div", { className: scope === target ? "skp-scope-item skp-scope-item-active" : "skp-scope-item", children: [_jsxs("button", { type: "button", className: "skp-scope-main", "aria-pressed": scope === target, onClick: () => switchScope(target), children: [_jsx("span", { className: "skp-scope-label", children: label }), _jsx("span", { className: "skp-scope-count", children: count })] }), _jsx("button", { type: "button", className: "skp-scope-add", disabled: addDisabled, title: addTitle, "aria-label": addTitle, onClick: () => openInstall(target), children: "+" })] }));
    };
    /** 当前 scope 的技能列表（空态区分「没有」与搜索「无匹配」）。 */
    const renderSkillList = (list, group) => {
        if (list.length === 0) {
            if (q.length > 0) {
                return _jsxs("div", { className: "skp-empty", children: ["\u6CA1\u6709\u5339\u914D\u300C", query.trim(), "\u300D\u7684 Skills\u3002"] });
            }
            return (_jsxs("div", { className: "skp-empty", children: [_jsx("div", { children: group === "global" ? "还没有全局 Skills。" : "本项目还没有 Skills。" }), _jsx("button", { type: "button", className: "skp-btn", style: { marginTop: 10 }, onClick: () => openInstall(group), children: group === "global" ? "安装到全局" : "安装到本项目" })] }));
        }
        return (_jsx("div", { className: "skp-group-scroll", children: _jsx("ul", { className: "skp-list", role: "listbox", "aria-label": group === "global" ? "全局 Skills" : "本项目 Skills", children: list.map((item) => (_jsx("li", { role: "presentation", children: renderRow(item) }, skillRowKey(item)))) }) }));
    };
    /** 一组技能行（列表容器 + 可访问性标签）。 */
    const renderRows = (list, label) => (_jsx("ul", { className: "skp-list", role: "listbox", "aria-label": label, children: list.map((item) => (_jsx("li", { role: "presentation", children: renderRow(item) }, skillRowKey(item)))) }));
    /**
     * 全局 scope 的技能列表：磁盘全局行 + 单独的「注入技能」分组
     * （Figma v12：注入行带来源标签与「内容只读 · 可启停」说明）。
     */
    const renderGlobalList = () => {
        const empty = diskGlobalVisible.length === 0 && injectedVisible.length === 0;
        if (empty) {
            return renderSkillList([], "global");
        }
        return (_jsxs("div", { className: "skp-group-scroll", children: [diskGlobalVisible.length > 0 && renderRows(diskGlobalVisible, "全局 Skills"), injectedVisible.length > 0 && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "skp-list-group-head", children: [_jsx("span", { className: "skp-list-group-title", children: "\u6CE8\u5165 Skills" }), _jsx("span", { className: "skp-group-count", children: injectedItems.length }), _jsx("span", { className: "skp-list-group-note", children: "\u5185\u5BB9\u53EA\u8BFB \u00B7 \u53EF\u542F\u505C" })] }), renderRows(injectedVisible, "注入 Skills")] }))] }));
    };
    /**
     * ScopeNav「项目」行下方的工作区列表（仅 project scope 渲染，nav 内自身滚动）。
     * 未选工作区时跟随搜索词过滤名称/路径；已选中工作区时保持完整列表方便切换。
     */
    const renderScopeWorkspaces = () => {
        const list = pinned === undefined ? workspaceVisible : projects;
        if (list.length === 0) {
            return _jsx("div", { className: "skp-scope-empty", children: pinned === undefined && q.length > 0 ? "无匹配" : "没有工作区" });
        }
        return (_jsx("div", { className: "skp-scope-workspaces", role: "listbox", "aria-label": "\u5DE5\u4F5C\u533A", children: list.map((project) => {
                const active = project.path === pinned;
                return (_jsx("button", { type: "button", role: "option", "aria-selected": active, className: active ? "skp-scope-workspace skp-scope-workspace-active" : "skp-scope-workspace", title: project.path, onClick: () => chooseWorkspace(project.path), children: _jsx("span", { className: "skp-scope-workspace-name", children: basenameOf(project.path) }) }, project.path));
            }) }));
    };
    const renderRow = (item) => {
        const key = skillRowKey(item);
        const isProject = isProjectSource(item.source);
        const isInjected = item.injected === true;
        const state = invocationState(item);
        const checked = skillSwitchChecked(item);
        const tags = skillTags(item, diskGlobalItems.some((global) => global.name === item.name));
        const switcher = skillSwitchDisabled(item, pinned !== undefined);
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
                : "本项目已禁用"
            : item.shadowStub === true
                ? "屏蔽占位"
                : item.readOnly
                    ? "只读"
                    : state === "full"
                        ? "已启用"
                        : state === "partial"
                            ? "部分禁用"
                            : "已禁用";
        return (_jsxs("div", { role: "option", "aria-selected": selected === key, tabIndex: selected === key ? 0 : -1, className: selected === key ? "skp-row skp-row-active" : "skp-row", ref: (element) => {
                if (element === null)
                    rowRefs.current.delete(key);
                else
                    rowRefs.current.set(key, element);
            }, onClick: () => selectRow(key), onKeyDown: (event) => onRowKeyDown(event, key), children: [_jsxs("div", { className: "skp-row-name", children: [(isProject || isInjected) && (_jsxs(_Fragment, { children: [_jsx("span", { className: dotClass, "aria-hidden": "true" }), _jsx("span", { className: "skp-sr-only", children: dotText })] })), _jsx("span", { className: "skp-row-title", title: item.name, children: item.name })] }), _jsxs("div", { className: "skp-row-mid", children: [_jsx("div", { className: "skp-row-tags", children: tags.map((tag) => tag.key === "override" || tag.key === "disabled-in-project" || tag.key === "project-copy" ? (_jsx("button", { type: "button", className: tag.className, title: tag.title, onClick: (event) => {
                                    event.stopPropagation();
                                    jumpToRelated(item);
                                }, children: tag.label }, tag.key)) : (_jsx("span", { className: tag.className, title: tag.title, children: tag.label }, tag.key))) }), _jsxs("label", { className: "skp-row-toggle", title: switcher.title, onClick: (event) => event.stopPropagation(), onKeyDown: (event) => event.stopPropagation(), children: [_jsx("span", { className: "skp-row-default-label", children: "\u542F\u7528" }), _jsxs("span", { className: "skp-switch", children: [_jsx("input", { type: "checkbox", role: "switch", "aria-label": `启用 ${item.name}`, checked: skillSwitchChecked(item), disabled: switcher.disabled || busyRow === key, onChange: (event) => void toggleRow(item, event.target.checked) }), _jsx("span", { className: "skp-switch-track" })] })] })] }), _jsx("div", { className: "skp-row-desc", children: item.description.length > 0 ? item.description : "（无描述）" })] }));
    };
    return (_jsxs("div", { className: "skp-domain", children: [opError !== undefined && _jsx("div", { className: "skp-error", children: opError }), error !== undefined && _jsxs("div", { className: "skp-error", children: ["\u8BFB\u53D6\u5931\u8D25\uFF1A", error] }), loading && allItems === undefined && _jsx("div", { className: "skp-status", children: "\u52A0\u8F7D\u4E2D\u2026" }), allItems !== undefined && error === undefined && (_jsxs("div", { className: "skp-body", children: [_jsxs("nav", { className: "skp-scope-nav", "aria-label": "Skills \u4F5C\u7528\u57DF", children: [renderScopeItem("global", "全局", globalItems.length), renderScopeItem("project", "项目", pinned === undefined ? "—" : projectItems.length), renderScopeWorkspaces()] }), _jsxs("div", { className: "skp-workspace-pane", children: [_jsx("div", { className: "skp-pane-title", children: scope === "global" ? (_jsxs(_Fragment, { children: [_jsx("span", { className: "skp-pane-title-text", children: "\u5168\u5C40 Skills" }), _jsx("span", { className: "skp-group-count", children: globalVisible.length })] })) : pinned === undefined ? (_jsx("span", { className: "skp-pane-title-text", children: "\u9879\u76EE" })) : (_jsxs(_Fragment, { children: [_jsx("span", { className: "skp-pane-title-text", title: pinned, children: basenameOf(pinned) }), _jsx("span", { className: "skp-group-count", children: projectVisible.length })] })) }), scope === "global" ? (renderGlobalList()) : pinned === undefined ? (_jsx("div", { className: "skp-empty", children: "\u8BF7\u9009\u62E9\u5DE6\u4FA7\u5DE5\u4F5C\u533A" })) : (renderSkillList(projectVisible, "project"))] }), _jsx("div", { className: "skp-detail skp-detail-fixed", children: selectedItem !== undefined ? (_jsx(SkillDetail, { summary: selectedItem, api: skillsApi, hasWorkspace: pinned !== undefined, contentVersion: contentVersion, onChanged: () => {
                                setContentVersion((value) => value + 1);
                                reload({ silent: true });
                            }, onRemoved: () => {
                                setSelected(undefined);
                                setContentVersion((value) => value + 1);
                                reload({ silent: true });
                            } }, skillRowKey(selectedItem))) : (_jsx("div", { className: "skp-detail-empty", children: items.length === 0
                                ? "还没有任何 Skills。Skills 让 agent 在特定任务上按固定做法工作。"
                                : scope === "project" && showWorkspacePicker
                                    ? "请选择左侧工作区，再查看或安装本项目 Skills。"
                                    : "选择一个条目查看说明与全部文件内容。" })) })] })), installOpen && (_jsx(InstallDialog, { api: skillsApi, hasWorkspace: pinned !== undefined, defaultScope: installScope, onClose: () => setInstallOpen(false), onInstalled: () => {
                    setInstallOpen(false);
                    setContentVersion((value) => value + 1);
                    reload({ silent: true });
                } }))] }));
}
/**
 * 详情卡片：标题 / 动作区 / 元信息 + **文件树与阅读器**（本版新增）。
 *
 * 动作与元信息沿用旧实现（启用/禁用、模型/用户调用开关、导入到本项目、
 * 在本项目禁用/恢复、导出、导出到路径…、删除），删除确认从「两击」改为
 * 模态对话框；内容区见 skill-content.tsx。
 */
function SkillDetail({ summary, api, hasWorkspace, contentVersion, onChanged, onRemoved, }) {
    const [busy, setBusy] = useState(false);
    const [opError, setOpError] = useState(undefined);
    const [confirmImport, setConfirmImport] = useState(false);
    const [exportPathOpen, setExportPathOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const isGlobal = isGlobalSkillSource(summary.source);
    // 宿主 registry 注入行：正文/资源只读、无磁盘副本，但保留启停（本项目 / 本会话）。
    const injected = summary.injected === true;
    const state = invocationState(summary);
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
    /** 在本项目内禁用这个全局 skill：生成 shadow stub（不影响其它项目）。 */
    const doDisableInProject = async () => {
        setBusy(true);
        setOpError(undefined);
        try {
            const result = await api.disableInProject({ name: summary.name, fromRoot: summary.root });
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
    /** 恢复：删除本项目内的 shadow stub，该全局技能重新对本项目可见。 */
    const doEnableInProject = async () => {
        setBusy(true);
        setOpError(undefined);
        try {
            const result = await api.enableInProject({ name: summary.name });
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
        ? "将删除本项目内的屏蔽占位，同名全局 Skills 在本项目恢复可用。"
        : isGlobal
            ? "将删除全局 Skills，所有项目都将不再可用。此操作不可撤销。"
            : "将删除本项目中的这份 Skills（含目录下的所有文件）。此操作不可撤销。";
    return (_jsxs("div", { className: "skp-detail-card", children: [_jsxs("div", { className: "skp-detail-head", children: [_jsx("h3", { title: summary.name, children: summary.name }), injected ? (_jsxs(_Fragment, { children: [_jsx("span", { className: originTagClass(summary), title: "\u6CE8\u5165\u6765\u6E90\u7C7B\u522B\uFF08\u5185\u7F6E / \u63D2\u4EF6 / \u9884\u8BBE\u6E20\u9053\uFF09", children: originLabel(summary) }), _jsx("span", { className: "skp-tag skp-tag-flat", children: summary.format === "directory" ? "目录" : ".md" }), summary.channel !== undefined && summary.channel.length > 0 && (_jsx("span", { className: "skp-tag skp-tag-channel", title: "\u6CE8\u5165\u65B9 / \u6E20\u9053\u540D\uFF08\u53EA\u8BFB\u6765\u6E90\uFF0C\u65E0\u78C1\u76D8\u526F\u672C\uFF09", children: summary.channel }))] })) : (_jsxs(_Fragment, { children: [_jsx("span", { className: isGlobal ? "skp-tag skp-tag-global" : "skp-tag skp-tag-project", title: isGlobal ? "全局 Skills（对所有项目生效）" : "本项目内的 Skills", children: isGlobal ? "全局" : "项目" }), _jsx("span", { className: "skp-tag skp-tag-flat", children: summary.format === "directory" ? "目录" : ".md" }), summary.readOnly && _jsx("span", { className: "skp-badge", children: "\u53EA\u8BFB" })] })), !injected && summary.shadowStub === true && (_jsx("span", { className: "skp-badge", title: "\u5C4F\u853D\u5360\u4F4D\uFF1A\u4F7F\u540C\u540D\u5168\u5C40 Skills \u5728\u672C\u9879\u76EE\u4E0D\u53EF\u7528\uFF1B\u5220\u9664\u672C\u6761\u76EE\u5373\u53EF\u6062\u590D", children: "\u5C4F\u853D\u5360\u4F4D" })), isGlobal && summary.projectShadow === "stub" && (_jsx("span", { className: "skp-badge", title: "\u672C\u9879\u76EE\u5185\u5DF2\u653E\u7F6E\u5C4F\u853D\u5360\u4F4D\uFF0C\u6B64 Skills \u5728\u672C\u9879\u76EE\u4E0D\u53EF\u7528\uFF08\u4E0D\u5F71\u54CD\u5176\u5B83\u9879\u76EE\uFF09", children: "\u672C\u9879\u76EE\u5DF2\u7981\u7528" })), isGlobal && summary.projectShadow === "skill" && (_jsx("span", { className: "skp-badge", title: "\u9879\u76EE\u533A\u6709\u540C\u540D Skills\uFF0C\u6309\u5BBF\u4E3B\u4F18\u5148\u7EA7\u5728\u672C\u9879\u76EE\u751F\u6548\u7684\u662F\u9879\u76EE\u526F\u672C", children: "\u9879\u76EE\u526F\u672C\u751F\u6548\u4E2D" })), _jsx("span", { className: "skp-detail-head-spacer" }), summary.path !== undefined && (_jsx("button", { type: "button", className: "skp-link-btn", title: summary.path, onClick: () => void copyPath(), children: copied ? "已复制" : "复制路径" }))] }), injected && (_jsxs("div", { className: "skp-detail-readonly", children: [_jsx("span", { className: "skp-detail-readonly-icon", "aria-hidden": "true", children: "i" }), _jsx("span", { children: injectedReadonlyNote(summary) })] })), !summary.readOnly && !injected && (_jsxs("div", { className: "skp-detail-actions", children: [!isGlobal && summary.shadowStub !== true && (_jsx("button", { type: "button", className: `skp-btn ${state === "full" ? "skp-state-on" : state === "partial" ? "skp-state-partial" : "skp-state-off"}`, disabled: busy, title: state === "full" ? "点击禁用（用户与模型都不可调用）" : "点击启用（恢复用户与模型调用）", onClick: () => void doSetEnabled(state !== "full"), children: state === "full" ? "已启用" : state === "none" ? "已禁用" : "部分禁用" })), isGlobal && state !== "full" && (_jsx("button", { type: "button", className: "skp-btn skp-state-off", disabled: busy, title: "\u6B64\u5168\u5C40 Skills \u5F53\u524D\u4E3A\u7981\u7528\u72B6\u6001\uFF1B\u70B9\u51FB\u6062\u590D\u542F\u7528\uFF08\u5BF9\u6240\u6709\u9879\u76EE\u751F\u6548\uFF09", onClick: () => void doSetEnabled(true), children: "\u5DF2\u7981\u7528" })), hasWorkspace && isGlobal && (_jsx("button", { type: "button", className: confirmImport ? "skp-btn skp-btn-danger" : "skp-btn", disabled: busy, title: confirmImport
                            ? "项目内已有同名 Skills，再次点击将覆盖为全局副本"
                            : "复制到本项目（.agents/skills），此后可在本项目内独立启停", onClick: () => void doImport(confirmImport), children: confirmImport ? "确认覆盖项目内的同名 Skills？" : "导入到本项目" })), hasWorkspace && isGlobal && summary.projectShadow === undefined && (_jsx("button", { type: "button", className: "skp-btn", disabled: busy, title: "\u5728\u672C\u9879\u76EE\u5185\u7981\u7528\u6B64\u5168\u5C40 Skills\uFF08\u751F\u6210\u5C4F\u853D\u5360\u4F4D\uFF0C\u6A21\u578B\u4E0E\u7528\u6237\u8C03\u7528\u90FD\u88AB\u5BBF\u4E3B\u539F\u751F\u62D2\u7EDD\uFF1B\u4E0D\u5F71\u54CD\u5176\u5B83\u9879\u76EE\uFF0C\u53EF\u968F\u65F6\u6062\u590D\uFF09", onClick: () => void doDisableInProject(), children: "\u5728\u672C\u9879\u76EE\u7981\u7528" })), hasWorkspace && isGlobal && summary.projectShadow === "stub" && (_jsx("button", { type: "button", className: "skp-btn", disabled: busy, title: "\u5220\u9664\u672C\u9879\u76EE\u5185\u7684\u5C4F\u853D\u5360\u4F4D\uFF0C\u6062\u590D\u6B64\u5168\u5C40 Skills \u5728\u672C\u9879\u76EE\u53EF\u7528", onClick: () => void doEnableInProject(), children: "\u5728\u672C\u9879\u76EE\u6062\u590D" })), _jsx("button", { type: "button", className: "skp-btn", disabled: busy, onClick: () => void doExportDownload(), children: "\u5BFC\u51FA" }), _jsx("button", { type: "button", className: "skp-btn", disabled: busy, onClick: () => setExportPathOpen(true), children: "\u5BFC\u51FA\u5230\u8DEF\u5F84\u2026" }), _jsx("button", { type: "button", className: "skp-btn skp-btn-danger-ghost", disabled: busy, title: deleteBody, onClick: () => setDeleteOpen(true), children: "\u5220\u9664" })] })), (summary.description.length > 0 || summary.whenToUse !== undefined) && (_jsxs("div", { className: "skp-detail-desc", children: [summary.description.length > 0 && _jsx("p", { className: "skp-detail-desc-text", children: summary.description }), summary.whenToUse !== undefined && (_jsxs("p", { className: "skp-detail-desc-text", children: [_jsx("span", { className: "skp-detail-meta-strong", children: "\u4F7F\u7528\u65F6\u673A" }), " ", summary.whenToUse] }))] })), _jsxs("div", { className: "skp-detail-meta", children: [_jsxs("span", { className: "skp-detail-meta-item", children: ["\u6765\u6E90", " ", _jsx("span", { className: "skp-detail-meta-strong", children: injected ? (summary.channel !== undefined && summary.channel.length > 0 ? summary.channel : originLabel(summary)) : summary.source })] }), _jsx("span", { className: "skp-detail-meta-item", children: injected ? injectedOriginText(summary) : summary.format === "directory" ? "目录格式" : "单文件" }), (injected || summary.readOnly || !isGlobal) && (_jsxs("span", { className: "skp-detail-meta-item", children: ["\u8C03\u7528\u65B9\u5F0F", injected || summary.readOnly || summary.shadowStub === true ? (_jsxs("span", { className: "skp-detail-meta-strong", children: ["\u6A21\u578B ", summary.modelInvocable ? "✓" : "✗", " \u00B7 \u7528\u6237 ", summary.userInvocable ? "✓" : "✗"] })) : (_jsxs("span", { className: "skp-invoke-btns", children: [_jsxs("button", { type: "button", className: `skp-btn ${summary.modelInvocable ? "skp-state-on" : "skp-state-off"}`, disabled: busy, title: summary.modelInvocable
                                            ? "点击关闭模型调用（agent 不再自动触发；用户仍可 /name 调用）"
                                            : "点击开启模型调用（agent 可自动触发）", onClick: () => void doSetInvocation(!summary.modelInvocable, summary.userInvocable), children: ["\u6A21\u578B ", summary.modelInvocable ? "✓" : "✗"] }), _jsxs("button", { type: "button", className: `skp-btn ${summary.userInvocable ? "skp-state-on" : "skp-state-off"}`, disabled: busy, title: summary.userInvocable
                                            ? "点击关闭用户调用（输入框 /name 不再注入此 Skills；模型仍可自动触发）"
                                            : "点击开启用户调用（输入框 /name 可注入此 Skills）", onClick: () => void doSetInvocation(summary.modelInvocable, !summary.userInvocable), children: ["\u7528\u6237 ", summary.userInvocable ? "✓" : "✗"] })] }))] })), summary.path !== undefined && (_jsx("button", { type: "button", className: "skp-detail-path", title: summary.path, onClick: () => void copyPath(), children: summary.path }))] }), opError !== undefined && _jsx("div", { className: "skp-error", children: opError }), _jsx(SkillContent, { summary: summary, api: api, refreshKey: contentVersion }), exportPathOpen && _jsx(ExportToPathDialog, { summary: summary, api: api, onClose: () => setExportPathOpen(false) }), deleteOpen && (_jsxs(Modal, { title: `删除 Skills 「${summary.name}」？`, onClose: () => setDeleteOpen(false), children: [_jsx("p", { className: "skp-modal-text", children: deleteBody }), _jsxs("div", { className: "skp-modal-actions", children: [_jsx("button", { type: "button", className: "skp-btn", autoFocus: true, onClick: () => setDeleteOpen(false), children: "\u53D6\u6D88" }), _jsx("button", { type: "button", className: "skp-btn skp-btn-danger", disabled: busy, onClick: () => void doRemove(), children: busy ? "删除中…" : "删除" })] })] }))] }));
}
/** 安装对话框的来源模式与 Tab 文案。 */
const INSTALL_MODE = { upload: "上传", path: "宿主路径", url: "URL" };
/**
 * 安装对话框：三种来源——浏览器上传（单个 .md / 整个 skill 目录 / .zip
 * 压缩包）、宿主磁盘路径、URL 下载（GitHub 仓库 / .zip / raw .md）。
 *
 * 作用域默认「本项目」（无工作区时默认「全局」、项目项置灰），可手动切到
 * 全局——对应「同屏双组」后不再有当前区概念，安装入口统一在工具条 /
 * 空组引导行（`defaultScope` 决定预选项）。
 */
function InstallDialog({ api, hasWorkspace, defaultScope, onClose, onInstalled, }) {
    const [mode, setMode] = useState("upload");
    const [scopeChoice, setScopeChoice] = useState(defaultScope === "global" || !hasWorkspace ? "global" : "project-agents");
    const [overwrite, setOverwrite] = useState(false);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState([]);
    const [sourcePath, setSourcePath] = useState("");
    const [url, setUrl] = useState("");
    const [picked, setPicked] = useState(undefined);
    const fileInputRef = useRef(null);
    const dirInputRef = useRef(null);
    const zipInputRef = useRef(null);
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
        const scope = scopeChoice === "global" ? "global" : "project";
        const target = scopeChoice === "project-agents" ? ".agents" : scopeChoice === "project-dsh" ? ".dsh" : undefined;
        try {
            const result = mode === "upload"
                ? await api.installUpload({ scope, target, files: picked?.files ?? [], overwrite })
                : mode === "path"
                    ? await api.installFromPath({ scope, target, sourcePath: sourcePath.trim(), overwrite })
                    : await api.installFromUrl({ scope, target, url: url.trim(), overwrite });
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
    return (_jsx(Modal, { title: "\u5B89\u88C5 Skills", onClose: onClose, children: _jsxs("div", { className: "skp-form", children: [_jsx("div", { className: "skp-tabs", role: "tablist", children: Object.keys(INSTALL_MODE).map((m) => (_jsx("button", { role: "tab", "aria-selected": mode === m, className: mode === m ? "skp-tab skp-tab-active" : "skp-tab", onClick: () => setMode(m), children: INSTALL_MODE[m] }, m))) }), mode === "upload" && (_jsxs("div", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "\u6765\u6E90" }), _jsxs("div", { className: "skp-subheader-row", children: [_jsx("button", { type: "button", className: "skp-btn", onClick: () => fileInputRef.current?.click(), children: "\u9009\u62E9 .md \u6587\u4EF6" }), _jsx("button", { type: "button", className: "skp-btn", onClick: () => dirInputRef.current?.click(), children: "\u9009\u62E9\u6587\u4EF6\u5939" }), _jsx("button", { type: "button", className: "skp-btn", onClick: () => zipInputRef.current?.click(), children: "\u9009\u62E9 .zip" })] }), _jsx("input", { ref: fileInputRef, type: "file", accept: ".md,text/markdown", hidden: true, onChange: (e) => void onPickFile(e.currentTarget) }), _jsx("input", { ref: (el) => {
                                dirInputRef.current = el;
                                el?.setAttribute("webkitdirectory", "");
                            }, type: "file", multiple: true, hidden: true, onChange: (e) => void onPickDirectory(e.currentTarget) }), _jsx("input", { ref: zipInputRef, type: "file", accept: ".zip,application/zip", hidden: true, onChange: (e) => void onPickArchive(e.currentTarget) }), _jsx("span", { className: "skp-note", children: picked !== undefined ? `已选择：${picked.label}` : "选择单个 <名称>.md 文件、包含 SKILL.md 的文件夹，或 .zip 压缩包。" })] })), mode === "path" && (_jsxs("div", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "\u5BBF\u4E3B\u4E0A\u7684\u6E90\u8DEF\u5F84" }), _jsx("input", { className: "skp-input", type: "text", placeholder: "/path/to/skill \u76EE\u5F55\u6216 <\u540D\u79F0>.md", value: sourcePath, onChange: (e) => setSourcePath(e.target.value) })] })), mode === "url" && (_jsxs("div", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "\u4E0B\u8F7D URL" }), _jsx("input", { className: "skp-input", type: "url", placeholder: "https://github.com/<owner>/<repo>[/tree/<branch>/<dir>] \u6216 .zip / .md \u94FE\u63A5", value: url, onChange: (e) => setUrl(e.target.value) }), _jsx("span", { className: "skp-note", children: "\u652F\u6301 GitHub \u4ED3\u5E93\uFF08\u6574\u5E93\u6216 /tree/\u2026 \u5B50\u76EE\u5F55\uFF09\u3001.zip \u94FE\u63A5\u6216 raw .md \u94FE\u63A5\u3002" })] })), _jsxs("div", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "\u5B89\u88C5\u5230" }), _jsx(SkpSelect, { value: scopeChoice, ariaLabel: "\u5B89\u88C5\u76EE\u6807", options: [
                                { value: "project-agents", label: "项目 — .agents/skills（默认）", disabled: !hasWorkspace },
                                { value: "project-dsh", label: "项目 — .dsh/skills（旧）", disabled: !hasWorkspace },
                                { value: "global", label: "全局 — ~/.agents/skills" },
                            ], onChange: (value) => setScopeChoice(value) })] }), _jsxs("label", { className: "skp-field skp-field-inline", children: [_jsx("input", { type: "checkbox", checked: overwrite, onChange: (e) => setOverwrite(e.target.checked) }), "\u540C\u540D Skills \u5DF2\u5B58\u5728\u65F6\u8986\u76D6"] }), errors.length > 0 && _jsx("div", { className: "skp-error", children: errors.join("\n") }), _jsxs("div", { className: "skp-modal-actions", children: [_jsx("button", { type: "button", className: "skp-btn", onClick: onClose, children: "\u53D6\u6D88" }), _jsx("button", { type: "button", className: "skp-btn skp-btn-primary", disabled: !canSubmit, onClick: doInstall, children: busy ? "安装中…" : "安装" })] })] }) }));
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
