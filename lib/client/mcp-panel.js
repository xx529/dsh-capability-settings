import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * Capability Panel 的 MCP 域视图。
 *
 * 布局与 Skills 域**同构**：左侧「全局 / 项目」作用域导航（ScopeNav）+ 中间
 * 列 + 右侧详情。项目 scope 下，工作区列表挂在 ScopeNav「项目」行下方（名称 =
 * 目录 basename，点选后钉选该项目，列表自身滚动；全局 scope 隐藏）；中间列只
 * 渲染当前列表标题与条目，未选工作区时显示「请选择左侧工作区」。全局 scope 显示
 * `~/.agents/mcp.json` 条目，并把「外部注入」（其它插件 / profile 在运行时挂载的
 * mcp-client）作为**第二组**只读展示（保留组头与计数，为空时不占位）。搜索框在
 * 根组件头部，由 `query` prop 传入，只过滤当前列表（全局 → server 名/summary；
 * 项目未选工作区 → 左侧工作区名/路径；项目已选 → server）。组容器样式由
 * styles.ts 的 `.skp-group*` / `.skp-scope-workspaces*` 统一提供（与 Skills 域共用）。
 *
 * 行 = 状态点 + 名称 + 标签（项目/全局/引用/导入/外部 + stdio/http +
 * 默认关闭/被遮蔽）+ meta（挂载状态 · 工具数）+ 命令/URL 摘要 + 行尾
 * 「默认」开关（语义不变 = 新建对话是否启用，写项目级 overrides 的 mcp 列表）。
 * 行内不提供文字按钮：启用/编辑/删除/导入/探测/使用记录都在详情卡。
 *
 * 详情把「工具与参数」做成左右两栏（ToolsInspector）：左侧工具列表可点选，
 * 右侧是该工具的参数表（参数/类型/必填/说明，来自 inputSchema 的
 * `properties` + `required`）；配置条目由「查看工具与参数」真连一次探测
 * （零副作用，见 `mcp/probe.ts`），外部注入实例直接取运行时注册表里的工具。
 *
 * @module dsh-capability-settings/client/mcp-panel
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { summarizeEntry, transportOf, validateEntry } from "../mcp/entry-util.js";
import { Modal } from "./modal.js";
import { SkpSelect } from "./select.js";
import { hasWorkspaceLabel, useAsyncList } from "./panel-common.js";
import { aggregateMounts, MOUNT_LABEL } from "./mcp-common.js";
/** 复合行 id：同一个 key 可能同时存在于 project 与 global 两个作用域。 */
function rowId(server) {
    return `${server.scope}:${server.key}`;
}
/**
 * 行圆点的 tooltip：以启用/禁用为主语义（与 Skills 同一套口径），
 * 挂载状态（未挂载 / 失败 / 冲突）作为补充说明收进同一句。
 */
function rowDotTitle(server, mount) {
    if (!server.enabled)
        return "已禁用（不挂载）";
    if (mount === undefined)
        return "已启用 · 未挂载到当前会话";
    return mount.error !== undefined ? `已启用 · ${MOUNT_LABEL[mount.state]}：${mount.error}` : `已启用 · ${MOUNT_LABEL[mount.state]}`;
}
/**
 * 行首状态点的外观（沿用现有 `.skp-dot*` 类，缺的颜色用 CSS 变量兜底）：
 * 绿 = 已挂载；蓝 = 已启用但未挂载到当前会话；橙 = 默认关闭 / 名称冲突；
 * 红 = 挂载失败；灰 = 配置内禁用。
 */
function serverDot(server, mount) {
    if (!server.enabled)
        return { className: "skp-dot" };
    if (server.disabledInProject === true)
        return { className: "skp-dot", style: { background: "var(--skp-warn)" } };
    if (mount?.state === "failed")
        return { className: "skp-dot", style: { background: "var(--skp-error)" } };
    if (mount?.state === "conflict")
        return { className: "skp-dot", style: { background: "var(--skp-warn)" } };
    if (mount !== undefined)
        return { className: "skp-dot skp-dot-enabled" };
    return { className: "skp-dot skp-dot-partial" };
}
/**
 * 行的 meta 行文案：挂载状态 + 工具数。配置条目的工具数不进配置（不新增
 * 宿主字段），本次运行内探测成功后就地回填，未探测时显示「工具数未知」。
 */
function rowMetaText(server, mount, settling, toolCount) {
    const tools = toolCount !== undefined ? `${toolCount} 个工具` : "工具数未知";
    if (!server.enabled)
        return `已禁用 · ${tools}`;
    if (mount === undefined)
        return `${settling ? "挂载中…" : "未挂载到当前会话"} · ${tools}`;
    if (mount.state === "conflict")
        return `名称冲突 · ${tools}`;
    return `${MOUNT_LABEL[mount.state]} · ${tools}`;
}
/** 行摘要：单行省略（覆盖 `.skp-row-desc` 的两行 clamp，保证行高 72）。 */
const ROW_SUMMARY_STYLE = {
    display: "block",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    WebkitLineClamp: "unset",
};
/** 详情头右侧的标签组（两个标签并排，无对应样式类）。 */
const HEAD_TAGS_STYLE = { display: "inline-flex", alignItems: "center", gap: 6, flex: "none" };
/** 检视区标题行右侧（计数 / 重新测试并排）。 */
const INSPECT_HEAD_RIGHT_STYLE = {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    justifyContent: "flex-end",
};
/** 参数表：四列网格（参数 / 类型 / 必填 / 说明）。 */
const PARAM_GRID_STYLE = {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, .8fr) 56px minmax(0, 2fr)",
    columnGap: 10,
    minWidth: 0,
};
/** 参数表单元格（表头与数据行共用，只有内边距/边框）。 */
const PARAM_CELL_STYLE = {
    padding: "7px 0",
    borderBottom: "1px solid var(--skp-border)",
    minWidth: 0,
};
/** 参数表表头单元格（去掉上内边距）。 */
const PARAM_HEAD_CELL_STYLE = { ...PARAM_CELL_STYLE, paddingTop: 0 };
/**
 * 一条配置条目行（本项目 / 全局共用）。
 *
 * 点行 = 选中（详情卡跟着换）；行尾「默认」开关独立，不改变选中。行内不渲染
 * 任何文字按钮——启用/编辑/删除/导入/探测/使用记录全部在详情卡里，与 Skills
 * 域同一口径。
 */
function McpServerRow({ server, mount, settling, toolCount, selected, onSelect, onToggleDefault, }) {
    const dot = serverDot(server, mount);
    /** 归属标签按「出身」：引用 / 旧版导入副本本质是全局条目，标「引用」「导入」。 */
    const scopeTag = server.reference === true
        ? { label: "引用", className: "skp-tag skp-tag-flat" }
        : server.importedFromGlobal === true
            ? { label: "导入", className: "skp-tag skp-tag-flat" }
            : server.scope === "global"
                ? { label: "全局", className: "skp-tag skp-tag-global" }
                : { label: "项目", className: "skp-tag skp-tag-project" };
    const defaultOff = server.enabled !== false && server.disabledInProject === true;
    return (_jsxs("li", { className: selected ? "skp-row-wrap skp-row-wrap-active" : "skp-row-wrap", children: [_jsxs("button", { type: "button", className: selected ? "skp-row skp-row-active" : "skp-row", style: { minHeight: 72 }, onClick: onSelect, children: [_jsxs("span", { className: "skp-row-name", children: [_jsx("span", { className: dot.className, style: dot.style, title: rowDotTitle(server, mount) }), _jsx("span", { className: "skp-row-title", title: server.key, children: server.key }), _jsx("span", { className: scopeTag.className, children: scopeTag.label })] }), _jsxs("span", { className: "skp-row-meta", children: [_jsx("span", { className: "skp-tag skp-tag-flat", children: server.transport }), defaultOff && (_jsx("span", { className: "skp-tag skp-tag-warn", title: "\u9ED8\u8BA4\u5173\u95ED\uFF1A\u65B0\u5EFA\u5BF9\u8BDD\u4E0D\u542F\u7528\uFF1B\u53EF\u5728\u8F93\u5165\u6846\u7684 MCP \u5F39\u5C42\u91CC\u6309\u5F53\u524D\u5BF9\u8BDD\u624B\u52A8\u5F00\u542F", children: "\u9ED8\u8BA4\u5173\u95ED" })), server.shadowed && (_jsx("span", { className: "skp-tag skp-tag-directory", title: "\u88AB\u672C\u9879\u76EE\u5185\u7684\u540C\u540D\u6761\u76EE\u906E\u853D\uFF1A\u672C\u9879\u76EE\u7684\u6761\u76EE\u4F18\u5148\u751F\u6548", children: "\u88AB\u906E\u853D" })), _jsx("span", { children: rowMetaText(server, mount, settling, toolCount) })] }), _jsx("span", { className: "skp-row-desc", style: ROW_SUMMARY_STYLE, title: server.summary, children: server.summary })] }), _jsxs("label", { className: "skp-row-toggle", title: server.enabled === false
                    ? "该条目在配置里被禁用（到编辑表单里启用）"
                    : defaultOff
                        ? "默认关闭：新建对话不启用；点此改为默认开启"
                        : "默认开启：新建对话启用；点此改为默认关闭", children: [_jsx("span", { className: "skp-row-default-label", children: "\u9ED8\u8BA4" }), _jsxs("span", { className: "skp-switch", children: [_jsx("input", { type: "checkbox", checked: server.enabled !== false && server.disabledInProject !== true, disabled: server.enabled === false, onChange: onToggleDefault }), _jsx("span", { className: "skp-switch-track" })] })] })] }));
}
/**
 * 一条「外部注入」实例行：只读，同样有行尾「默认」开关（能否按项目屏蔽由
 * `restrictable` 决定；不可屏蔽时置灰 + tooltip 说明原因）。
 */
function McpExternalRow({ server, selected, onSelect, onToggleDefault, }) {
    const defaultOff = server.disabledInProject === true;
    const dot = defaultOff ? { className: "skp-dot", style: { background: "var(--skp-warn)" } } : { className: "skp-dot skp-dot-enabled" };
    const toolText = server.tools.length > 0 ? `${server.tools.length} 个工具` : "工具数未知";
    const meta = server.calls > 0 ? `${toolText} · 调用 ${server.calls} 次` : toolText;
    const summary = server.summary ?? "运行时注入，不由能力面板管理（只读）";
    return (_jsxs("li", { className: selected ? "skp-row-wrap skp-row-wrap-active" : "skp-row-wrap", children: [_jsxs("button", { type: "button", className: selected ? "skp-row skp-row-active" : "skp-row", style: { minHeight: 72 }, onClick: onSelect, children: [_jsxs("span", { className: "skp-row-name", children: [_jsx("span", { className: dot.className, style: dot.style, title: defaultOff ? "默认关闭（新建对话不启用）" : "运行时注入的实例" }), _jsx("span", { className: "skp-row-title", title: server.serverName, children: server.serverName }), _jsx("span", { className: "skp-tag skp-tag-readonly", children: "\u5916\u90E8" })] }), _jsxs("span", { className: "skp-row-meta", children: [server.source !== undefined && _jsx("span", { className: "skp-tag skp-tag-flat", children: server.source }), server.transport !== undefined && _jsx("span", { className: "skp-tag skp-tag-flat", children: server.transport }), defaultOff && (_jsx("span", { className: "skp-tag skp-tag-warn", title: "\u9ED8\u8BA4\u5173\u95ED\uFF1A\u65B0\u5EFA\u5BF9\u8BDD\u4E0D\u542F\u7528\uFF1B\u53EF\u5728\u8F93\u5165\u6846\u7684 MCP \u5F39\u5C42\u91CC\u6309\u5F53\u524D\u5BF9\u8BDD\u624B\u52A8\u5F00\u542F", children: "\u9ED8\u8BA4\u5173\u95ED" })), _jsx("span", { children: meta })] }), _jsx("span", { className: "skp-row-desc", style: ROW_SUMMARY_STYLE, title: summary, children: summary })] }), _jsxs("label", { className: "skp-row-toggle", title: server.restrictable
                    ? defaultOff
                        ? "默认关闭：新建对话不启用；点此改为默认开启"
                        : "默认开启：新建对话启用；点此改为默认关闭"
                    : "该实例按会话注入，无法按项目默认关闭", children: [_jsx("span", { className: "skp-row-default-label", children: "\u9ED8\u8BA4" }), _jsxs("span", { className: "skp-switch", children: [_jsx("input", { type: "checkbox", checked: server.restrictable ? !defaultOff : true, disabled: !server.restrictable, onChange: onToggleDefault }), _jsx("span", { className: "skp-switch-track" })] })] })] }));
}
/** 路径最后一段（工作区名）；空串/纯分隔符回退为原串。 */
function baseName(path) {
    const trimmed = path.replace(/[\\/]+$/, "");
    const at = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
    return at >= 0 ? trimmed.slice(at + 1) || trimmed : trimmed || path;
}
/**
 * MCP 视图主组件：左侧「全局 / 项目」导航 + 中间列（全局列表 / 工作区选择 /
 * 某工作区的项目列表）+ 右侧详情。
 *
 * - **全局**：全局 `~/.agents/mcp.json` 条目 + 「外部注入」只读第二组；
 * - **项目**：中间列先列出所有工作区（点选 → `onSelectWorkspace(path)`），
 *   选中后显示该工作区 `.mcp.json` 的条目，顶部「‹ 工作区」可返回重选；
 * - **搜索**来自根组件头部输入框（`query` prop），只过滤当前列表；
 * - scope / 工作区切换清空选中；行尾「默认」开关写项目级 overrides（语义不变），
 *   行内没有文字按钮——启停/编辑/删除/导入/探测/使用记录都在详情卡。
 */
export function McpView({ api, query, projects, workspace, pinned, onSelectWorkspace, onCount, }) {
    const mcpApi = api.mcp;
    const [scope, setScope] = useState("project");
    const [opError, setOpError] = useState(undefined);
    const [selected, setSelected] = useState(undefined);
    /** 选中的「外部注入」实例（serverName）；与 selected 互斥。 */
    const [selectedExternalName, setSelectedExternalName] = useState(undefined);
    /** 默认开关（项目级 overrides）最近一次操作失败的错误。 */
    const [defaultError, setDefaultError] = useState(undefined);
    // 编辑态：undefined = 空闲；非空 = 正在弹窗里编辑这条 server（McpEditDialog）。
    const [editServer, setEditServer] = useState(undefined);
    // 新增弹窗开关（表单 / JSON 两种模式见 McpAddDialog）。
    const [addOpen, setAddOpen] = useState(false);
    // 新增弹窗的默认作用域（scope nav 的「+」按行作用域；空组 CTA 显式指定）。
    const [addScope, setAddScope] = useState("global");
    // 二次确认删除：记录"待确认的行 id"，再点一次才真正删除。
    const [confirmDelete, setConfirmDelete] = useState(undefined);
    // 二次确认导入覆盖：项目内已有同名时记录"待确认的行 id"，再点一次带 overwrite。
    const [confirmImport, setConfirmImport] = useState(undefined);
    /** 本次运行内探测成功回填的工具数（serverName → 工具数）；不落盘、不新增宿主字段。 */
    const [toolCounts, setToolCounts] = useState({});
    /**
     * 拉取 list + status 并聚合成单一结果（挂载时、工作区变化时自动执行，
     * 写操作后显式 reload()）。挂载状态按 server.key 聚合：任一 session 已
     * 挂载即视为"已挂载"，全部未挂载时才取最差状态（见 mcp-common.ts）。
     */
    const { data, loading, error, reload } = useAsyncList(async () => {
        const [list, statuses, runtime] = await Promise.all([
            mcpApi.list(),
            mcpApi.status().catch(() => []),
            // 运行时注入的 MCP（其它插件/profile 挂的 mcp-client）：只读展示，失败不影响主列表。
            mcpApi.runtime({ cwd: workspace }).catch(() => ({ servers: [] })),
        ]);
        return {
            servers: list.servers,
            listErrors: list.errors,
            mounts: aggregateMounts(statuses),
            runtimeServers: runtime.servers,
            // 宿主后台还在重挂（写入不再阻塞 RPC，见 manager.reloadFor）→ 面板据此轮询。
            settling: statuses.some((status) => status.settling === true),
        };
    }, [mcpApi, workspace]);
    /**
     * 面板「默认」开关：写项目级 `.agents/capability-overrides.json` 的 mcp 列表。
     *
     * 语义 = **新建对话的默认开关**：会话没有手动覆盖时跟随它；已有会话可以在输入框
     * 的 MCP 弹层里按当前对话手动覆盖（内存内）。切换后静默重拉列表刷新标记。
     */
    const toggleDefault = async (key) => {
        setDefaultError(undefined);
        const result = await api.overrides.toggle("mcp", key);
        if (!result.ok)
            setDefaultError(result.errors.join("; "));
        reload({ silent: true });
    };
    const servers = data?.servers ?? [];
    const listErrors = data?.listErrors ?? [];
    const mounts = data?.mounts ?? {};
    const settling = data?.settling === true;
    /** 外部注入（非本插件配置）的 MCP：归入全局 scope 的第二组展示，只读。 */
    const runtimeServers = data?.runtimeServers ?? [];
    // 域 Tab 计数：只算配置条目（本项目 + 全局）；外部注入在全局 scope 的第二组里
    // 单独显示计数。数据到达后上报，搜索不改变计数（Lead 裁决 / UX §3.2）。
    useEffect(() => {
        if (data === undefined)
            return;
        onCount?.(data.servers.length);
    }, [data, onCount]);
    /**
     * 写操作返回时宿主可能还在后台重挂（全局换代要逐条起进程 + 握手）：只要
     * `status().settling` 为真就每 800ms 静默重拉一次（上限 ~20 次 ≈16s），让
     * 「已挂载 / 未挂载」自行收敛——不阻塞写入 RPC 是"删掉立刻消失"的关键。
     *
     * 依赖里**必须带 `data`**：每次静默重拉都会换一个新的 data 对象，effect 才会
     * 重新排下一个定时器；只依赖 `settling` 的话，settling 一直为真 ⇒ 依赖没变
     * ⇒ 只轮询一次就停了。
     */
    const settleTries = useRef(0);
    useEffect(() => {
        if (!settling) {
            settleTries.current = 0;
            return;
        }
        if (settleTries.current >= 20)
            return;
        const timer = window.setTimeout(() => {
            settleTries.current += 1;
            reload({ silent: true });
        }, 800);
        return () => window.clearTimeout(timer);
    }, [settling, data, reload]);
    /** 项目 scope 下已钉选的工作区（未选 = 中间列提示先选左侧工作区）。 */
    const projectPath = pinned;
    const projectName = projectPath === undefined ? undefined : (projects.find((project) => project.path === projectPath)?.title ?? baseName(projectPath));
    /** scope / 工作区切换：清空选中与待确认态（详情跟走）。 */
    useEffect(() => {
        setSelected(undefined);
        setSelectedExternalName(undefined);
        setEditServer(undefined);
        setConfirmDelete(undefined);
        setConfirmImport(undefined);
    }, [scope, projectPath, workspace]);
    const trimmedQuery = query.trim();
    const q = trimmedQuery.toLowerCase();
    const matchesServer = (server) => q.length === 0 ||
        server.key.toLowerCase().includes(q) ||
        server.serverName.toLowerCase().includes(q) ||
        server.summary.toLowerCase().includes(q);
    const matchesExternal = (server) => q.length === 0 ||
        server.serverName.toLowerCase().includes(q) ||
        (server.source ?? "").toLowerCase().includes(q) ||
        (server.summary ?? "").toLowerCase().includes(q);
    const globalServers = servers.filter((server) => server.scope === "global");
    const projectServers = servers.filter((server) => server.scope === "project");
    const visibleGlobal = globalServers.filter(matchesServer);
    const visibleProject = projectServers.filter(matchesServer);
    const visibleExternal = runtimeServers.filter(matchesExternal);
    const searching = trimmedQuery.length > 0;
    const visibleProjects = projects.filter((project) => {
        if (q.length === 0)
            return true;
        return baseName(project.path).toLowerCase().includes(q) || project.path.toLowerCase().includes(q);
    });
    /** 左侧导航工作区列表：未选工作区时搜索过滤（已选工作区时搜索只过滤服务器）。 */
    const navProjects = projectPath === undefined ? visibleProjects : projects;
    const selectedServer = servers.find((s) => rowId(s) === selected);
    const selectedExternal = selectedExternalName === undefined ? undefined : runtimeServers.find((s) => s.serverName === selectedExternalName);
    /** 执行一次写操作：失败写 opError；成功清错误并重拉列表。返回是否成功。 */
    const runOp = async (op) => {
        const result = await op;
        if (!result.ok) {
            setOpError(result.errors.join("; "));
            return false;
        }
        setOpError(undefined);
        reload();
        return true;
    };
    /** 启用/禁用切换（直接写入配置文件，落盘后宿主自动重挂；只出现在项目条目）。 */
    const onToggle = (server) => {
        void runOp(mcpApi.setEnabled({ scope: server.scope, key: server.key, enabled: !server.enabled }));
    };
    /**
     * 导入这条**全局** server 到当前项目：登记项目级引用（内容跟随全局，启停是
     * 引用上的项目级标记）。项目内已有同名引用时进入"确认覆盖"态，再次点击带
     * overwrite 重新登记。成功后重拉列表（宿主热重挂本项目的 session）。
     */
    const onImport = async (server) => {
        const id = rowId(server);
        const result = await mcpApi.importToProject({ key: server.key, overwrite: confirmImport === id });
        if (!result.ok) {
            if (result.existed === true) {
                setConfirmImport(id);
                return;
            }
            setOpError(result.errors.join("; "));
            return;
        }
        setOpError(undefined);
        setConfirmImport(undefined);
        reload();
    };
    /** 删除：第一次点击进入确认态；同一行再次点击才真正删除并清空选中。 */
    const onDelete = (server) => {
        const id = rowId(server);
        if (confirmDelete !== id) {
            setConfirmDelete(id);
            return;
        }
        setConfirmDelete(undefined);
        void runOp(mcpApi.remove({ scope: server.scope, key: server.key })).then((ok) => {
            if (ok)
                setSelected(undefined);
        });
    };
    /** 选中一条配置条目：清掉外部实例选中与所有待确认态。 */
    const selectServer = (server) => {
        setSelected(rowId(server));
        setSelectedExternalName(undefined);
        setEditServer(undefined);
        setConfirmDelete(undefined);
        setConfirmImport(undefined);
    };
    /** 选中一个外部注入实例：与配置条目选中互斥。 */
    const selectExternal = (server) => {
        setSelectedExternalName(server.serverName);
        setSelected(undefined);
        setEditServer(undefined);
        setConfirmDelete(undefined);
        setConfirmImport(undefined);
    };
    const openAdd = (target) => {
        setEditServer(undefined);
        setAddScope(target);
        setAddOpen(true);
    };
    /** ScopeNav 一行：作用域名 + 计数 + 右侧「+」添加入口（与技能域同构）。 */
    const renderScopeItem = (target, label, count) => {
        const disabled = target === "project" && projectPath === undefined;
        const title = disabled
            ? "先选择工作区"
            : target === "global"
                ? "添加全局 MCP 服务器"
                : `添加项目 MCP 服务器（${projectName ?? projectPath}）`;
        return (_jsxs("div", { className: scope === target ? "skp-scope-item skp-scope-item-active" : "skp-scope-item", children: [_jsxs("button", { type: "button", className: "skp-scope-main", "aria-pressed": scope === target, onClick: () => setScope(target), children: [_jsx("span", { className: "skp-scope-label", children: label }), _jsx("span", { className: "skp-scope-count", children: count })] }), _jsx("button", { type: "button", className: "skp-scope-add", disabled: disabled, title: title, "aria-label": title, onClick: () => openAdd(target), children: "+" })] }));
    };
    /**
     * ScopeNav「项目」行下方的工作区列表（仅 project scope 渲染，nav 内自身滚动）。
     * 未选工作区时跟随搜索词过滤名称/路径；已选中工作区时保持完整列表方便切换。
     */
    const renderScopeWorkspaces = () => {
        const list = navProjects;
        if (list.length === 0) {
            return _jsx("div", { className: "skp-scope-empty", children: projectPath === undefined && searching ? "无匹配" : "没有工作区" });
        }
        return (_jsx("div", { className: "skp-scope-workspaces", role: "listbox", "aria-label": "\u5DE5\u4F5C\u533A", children: list.map((project) => {
                const active = project.path === projectPath;
                return (_jsx("button", { type: "button", role: "option", "aria-selected": active, className: active ? "skp-scope-workspace skp-scope-workspace-active" : "skp-scope-workspace", title: project.path, onClick: () => {
                        setScope("project");
                        onSelectWorkspace(project.path);
                    }, children: _jsx("span", { className: "skp-scope-workspace-name", children: baseName(project.path) }) }, project.path));
            }) }));
    };
    /** 非空的服务器列表（组内滚动 + listbox 语义）。 */
    const renderServerScroll = (list, label) => (_jsx("div", { className: "skp-group-scroll", children: _jsx("ul", { className: "skp-list", role: "listbox", "aria-label": label, children: list.map((server) => (_jsx(McpServerRow, { server: server, mount: mounts[server.key], settling: settling, toolCount: toolCounts[server.serverName], selected: selected === rowId(server), onSelect: () => selectServer(server), onToggleDefault: () => void toggleDefault(server.key) }, rowId(server)))) }) }));
    /** 当前 scope 的服务器列表（空态区分「还没有」与搜索「无匹配」）。 */
    const renderServerList = (list, group) => {
        if (list.length === 0) {
            if (searching)
                return _jsxs("div", { className: "skp-empty", children: ["\u6CA1\u6709\u5339\u914D\u300C", trimmedQuery, "\u300D\u7684 MCP \u670D\u52A1\u5668\u3002"] });
            return (_jsxs("div", { className: "skp-empty", children: [_jsx("div", { children: group === "global" ? "还没有全局 MCP 服务器。" : "本项目还没有 MCP 服务器。" }), _jsx("button", { type: "button", className: "skp-btn", style: { marginTop: 10 }, onClick: () => openAdd(group), children: group === "global" ? "添加全局 MCP" : "添加到本项目" })] }));
        }
        return renderServerScroll(list, group === "global" ? "全局 MCP 服务器" : "本项目 MCP 服务器");
    };
    /** 全局 scope 的第二组：外部注入（只读，保留组头与计数；为空时不占位）。 */
    const renderExternalGroup = () => visibleExternal.length > 0 ? (_jsxs("section", { className: "skp-group", role: "group", "aria-label": `外部注入（${visibleExternal.length}）`, children: [_jsxs("div", { className: "skp-group-head", children: [_jsx("span", { className: "skp-group-title", children: "\u5916\u90E8\u6CE8\u5165" }), _jsx("span", { className: "skp-group-count", children: visibleExternal.length }), _jsx("span", { className: "skp-group-note", children: "\u8FD0\u884C\u65F6\u6CE8\u5165 \u00B7 \u53EA\u8BFB" })] }), _jsx("div", { className: "skp-group-scroll", children: _jsx("ul", { className: "skp-list", role: "listbox", "aria-label": "\u5916\u90E8\u6CE8\u5165 MCP", children: visibleExternal.map((server) => (_jsx(McpExternalRow, { server: server, selected: selectedExternalName === server.serverName, onSelect: () => selectExternal(server), onToggleDefault: () => void toggleDefault(server.serverName) }, `external:${server.serverName}`))) }) })] })) : null;
    return (_jsxs("div", { className: "skp-domain", children: [listErrors.length > 0 && _jsx("div", { className: "skp-error", children: listErrors.join("\n") }), opError && _jsx("div", { className: "skp-error", children: opError }), error && _jsx("div", { className: "skp-error", children: error }), defaultError !== undefined && _jsx("div", { className: "skp-error", children: defaultError }), loading && data === undefined && _jsx("div", { className: "skp-status", children: "\u52A0\u8F7D\u4E2D\u2026" }), data !== undefined && (_jsxs("div", { className: "skp-body", children: [_jsxs("nav", { className: "skp-scope-nav", "aria-label": "MCP \u4F5C\u7528\u57DF", children: [renderScopeItem("global", "全局", globalServers.length), renderScopeItem("project", "项目", projectPath === undefined ? "—" : projectServers.length), renderScopeWorkspaces()] }), _jsxs("div", { className: "skp-workspace-pane", children: [_jsx("div", { className: "skp-pane-title", children: scope === "global" ? (_jsxs(_Fragment, { children: [_jsx("span", { className: "skp-pane-title-text", children: "\u5168\u5C40 MCP" }), _jsx("span", { className: "skp-group-count", children: visibleGlobal.length })] })) : projectPath === undefined ? (_jsx("span", { className: "skp-pane-title-text", children: "\u672C\u9879\u76EE" })) : (_jsxs(_Fragment, { children: [_jsx("span", { className: "skp-pane-title-text", title: projectPath, children: baseName(projectPath) }), _jsx("span", { className: "skp-group-count", children: visibleProject.length })] })) }), scope === "global" ? (searching && visibleGlobal.length === 0 && visibleExternal.length === 0 ? (_jsxs("div", { className: "skp-empty", children: ["\u6CA1\u6709\u5339\u914D\u300C", trimmedQuery, "\u300D\u7684 MCP \u670D\u52A1\u5668\u3002"] })) : (_jsxs(_Fragment, { children: [searching
                                        ? visibleGlobal.length > 0 && renderServerScroll(visibleGlobal, "全局 MCP 服务器")
                                        : renderServerList(visibleGlobal, "global"), renderExternalGroup()] }))) : projectPath === undefined ? (_jsx("div", { className: "skp-empty", children: "\u8BF7\u9009\u62E9\u5DE6\u4FA7\u5DE5\u4F5C\u533A\u3002" })) : (renderServerList(visibleProject, "project"))] }), _jsx("div", { className: "skp-detail", children: selectedExternal !== undefined ? (_jsx(McpExternalDetail, { api: mcpApi, server: selectedExternal }, selectedExternal.serverName)) : selectedServer ? (_jsx(McpDetail, { api: mcpApi, server: selectedServer, mount: mounts[selectedServer.key], hasWorkspace: projectPath !== undefined, confirmingDelete: confirmDelete === rowId(selectedServer), confirmingImport: confirmImport === rowId(selectedServer), onEdit: () => setEditServer(selectedServer), onToggle: () => onToggle(selectedServer), onDelete: () => onDelete(selectedServer), onImport: () => void onImport(selectedServer), onToolCount: (count) => setToolCounts((prev) => (prev[selectedServer.serverName] === count ? prev : { ...prev, [selectedServer.serverName]: count })) }, rowId(selectedServer))) : (_jsx("div", { className: "skp-detail-empty", children: scope === "project" && projectPath === undefined
                                ? "先选择一个工作区，再查看或添加本项目 MCP 服务器。"
                                : "选择一个服务器查看详情，或新增一个。" })) })] })), addOpen && (_jsx(McpAddDialog, { api: mcpApi, servers: servers, workspace: workspace, defaultScope: addScope, onClose: () => setAddOpen(false), onMutated: () => reload() })), editServer !== undefined && (_jsx(McpEditDialog, { api: mcpApi, server: editServer, workspace: workspace, onClose: () => setEditServer(undefined), onSaved: () => reload() }))] }));
}
// ---------------------------------------------------------------------------
// 详情卡片
// ---------------------------------------------------------------------------
/**
 * 「使用记录」只读区：最近谁（哪个 session）在什么时候调用了该 server 的哪个 tool。
 *
 * 数据来自宿主内存（`tools.guard` 旁路记录，见 `mcp/usage.ts`）——插件/进程重载即
 * 清空、**不落盘**；打开期间每 2s 静默刷新。详情卡与「外部注入」详情共用这一块。
 */
function McpUsageSection({ api, serverName }) {
    const [view, setView] = useState(undefined);
    const [error, setError] = useState(undefined);
    useEffect(() => {
        let cancelled = false;
        let timer;
        const load = async () => {
            try {
                const next = await api.usage({ serverName });
                if (cancelled)
                    return;
                setView(next);
                setError(undefined);
            }
            catch (err) {
                if (cancelled)
                    return;
                setError(String(err));
            }
            if (!cancelled)
                timer = window.setTimeout(() => void load(), 2000);
        };
        void load();
        return () => {
            cancelled = true;
            if (timer !== undefined)
                window.clearTimeout(timer);
        };
    }, [api, serverName]);
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "skp-detail-inspect-head", children: [_jsx("span", { className: "skp-field-label", children: "\u4F7F\u7528\u8BB0\u5F55" }), _jsxs("span", { className: "skp-test-stat", children: ["\u4EC5\u672C\u6B21\u8FD0\u884C \u00B7 \u4E0D\u843D\u76D8", view === undefined ? "" : ` · 最近 ${view.limit} 条`] })] }), error !== undefined && _jsx("div", { className: "skp-error", children: error }), view === undefined ? (_jsx("div", { className: "skp-note", children: "\u8BFB\u53D6\u4E2D\u2026" })) : view.entries.length === 0 ? (_jsx("div", { className: "skp-note", children: "\u672C\u6B21\u8FD0\u884C\u8FD8\u6CA1\u6709\u8C03\u7528\u8BB0\u5F55\u3002" })) : (_jsx("ul", { className: "skp-usage", children: view.entries
                    .slice()
                    .reverse()
                    .map((entry, index) => (_jsxs("li", { className: "skp-usage-row", children: [_jsx("span", { className: "skp-usage-time", title: new Date(entry.time).toLocaleString(), children: formatUsageTime(entry.time) }), _jsx("span", { className: "skp-usage-session", title: entry.sessionId === "" ? undefined : entry.sessionId, children: entry.sessionTitle ?? (entry.sessionId.length > 0 ? `会话 ${entry.sessionId.slice(-8)}` : "—") }), _jsx("code", { className: "skp-usage-tool", title: entry.serverName, children: entry.tool })] }, `${entry.time}-${entry.tool}-${index}`))) }))] }));
}
/**
 * 「外部注入」MCP 的**只读**详情。
 *
 * 这些实例不在本插件配置文件里（其它插件/profile 在运行时挂的 mcp-client），所以
 * 只展示能观察到的信息：来源插件、注入方式、命名空间、传输/命令摘要（能读到才有）、
 * 每个工具的说明与参数（来自工具注册表，与「查看工具与参数」同源），以及使用记录。
 * 不提供编辑/删除/测试——配置与生命周期都在注入方。
 *
 * 工具区与配置条目共用 `ToolsInspector`（左工具列表 + 右参数表）；「工具与参数」
 * 与「使用记录」都是折叠区，默认收起。
 */
function McpExternalDetail({ api, server }) {
    const [toolsOpen, setToolsOpen] = useState(false);
    // 「使用记录」：宿主内存里的 MCP 工具调用记录（只读、不落盘），打开才拉取。
    const [usageOpen, setUsageOpen] = useState(false);
    const hasTools = server.tools.length > 0;
    return (_jsxs("div", { className: "skp-detail-card", children: [_jsxs("div", { className: "skp-detail-head", children: [_jsx("h3", { children: server.serverName }), _jsxs("span", { style: HEAD_TAGS_STYLE, children: [_jsx("span", { className: "skp-tag skp-tag-readonly", children: "\u5916\u90E8\u6CE8\u5165" }), _jsx("span", { className: "skp-tag skp-tag-flat", children: "\u53EA\u8BFB" })] })] }), _jsxs("div", { className: "skp-note", children: ["\u53EA\u8BFB\u539F\u56E0\uFF1A\u8BE5 MCP \u7531 ", server.source ?? "其它插件", " \u5728\u8FD0\u884C\u65F6\u6CE8\u5165\uFF0C\u80FD\u529B\u9762\u677F\u53EA\u80FD\u67E5\u770B\u4E0E\u8BB0\u5F55\u8C03\u7528\uFF0C\u4E0D\u80FD\u7F16\u8F91\u6216\u5220\u9664\u3002"] }), _jsxs("div", { className: "skp-detail-actions", children: [_jsx("button", { type: "button", className: "skp-btn", title: hasTools ? "查看该实例暴露的工具与参数（数据来自运行时工具注册表，不重新连接）" : "该实例的工具清单不可见（只能统计调用次数）", onClick: () => setToolsOpen((open) => !open), children: toolsOpen ? "收起工具与参数" : "查看工具与参数" }), _jsx("button", { type: "button", className: "skp-btn", onClick: () => setUsageOpen((open) => !open), children: usageOpen ? "收起使用记录" : "使用记录" })] }), _jsxs("dl", { className: "skp-detail-fields", children: [_jsx("dt", { children: "\u6765\u6E90" }), _jsx("dd", { children: server.source ?? "运行时注入（来源不可识别）" }), _jsx("dt", { children: "\u6CE8\u5165\u65B9\u5F0F" }), _jsx("dd", { children: server.origin === "entry" ? "loader 条目（profile patch insert）" : "动态 fiber（其它插件在 apply 中挂载）" }), _jsx("dt", { children: "\u547D\u540D\u7A7A\u95F4" }), _jsx("dd", { children: _jsxs("code", { children: ["mcp__", server.serverName, "__*"] }) }), server.transport !== undefined && (_jsxs(_Fragment, { children: [_jsx("dt", { children: "\u4F20\u8F93\u65B9\u5F0F" }), _jsxs("dd", { children: [server.transport, server.summary !== undefined ? ` · ${server.summary}` : ""] })] })), _jsx("dt", { children: "\u9ED8\u8BA4 / \u5F53\u524D\u5BF9\u8BDD" }), _jsxs("dd", { children: [server.restrictable
                                ? "面板列表里的「默认」开关决定新建对话是否启用；输入框的 MCP 弹层里可按当前对话单独开启/关闭（用 tools.restrict 屏蔽或恢复其工具，不卸载共享实例）。"
                                : "该实例按会话作用域注入，无法在当前对话里屏蔽。", server.disabledInProject === true ? "当前默认：关闭（新建对话不启用）。" : "当前默认：开启。"] }), _jsx("dt", { children: "\u672C\u6B21\u8FD0\u884C\u8C03\u7528" }), _jsx("dd", { children: server.calls > 0 ? `${server.calls} 次` : "还没有调用记录" }), _jsx("dt", { children: "\u7BA1\u7406" }), _jsx("dd", { children: "\u7531\u6CE8\u5165\u65B9\u7BA1\u7406\uFF1B\u80FD\u529B\u9762\u677F\u53EA\u8BFB\u5C55\u793A\uFF0C\u4E0D\u63D0\u4F9B\u7F16\u8F91/\u5220\u9664/\u5378\u8F7D\u3002" })] }), toolsOpen && (_jsxs("div", { className: "skp-detail-inspect", children: [_jsxs("div", { className: "skp-detail-inspect-head", children: [_jsx("span", { className: "skp-field-label", children: "\u5DE5\u5177\u4E0E\u53C2\u6570" }), _jsx("span", { className: "skp-test-stat", children: hasTools ? `${server.tools.length} 个工具 · 点击工具查看参数` : "工具清单不可见" })] }), hasTools ? (_jsx(ToolsInspector, { tools: server.tools })) : (_jsx("div", { className: "skp-note", children: "\u5DE5\u5177\u6E05\u5355\u4E0D\u53EF\u89C1\uFF08\u8BE5\u5B9E\u4F8B\u6309\u4F1A\u8BDD\u4F5C\u7528\u57DF\u6CE8\u5165\uFF0C\u53EA\u80FD\u7EDF\u8BA1\u8C03\u7528\u6B21\u6570\uFF09\u3002" }))] })), usageOpen && (_jsx("div", { className: "skp-detail-inspect", children: _jsx(McpUsageSection, { api: api, serverName: server.serverName }) }))] }));
}
/**
 * 配置条目详情：归属徽标 + 字段 + 写操作 + 「工具与参数」（真连一次探测，
 * 两栏工具/参数）/「使用记录」两个折叠区。
 *
 * 动作语义沿用现状：**项目条目** = 启用/禁用、编辑、删除（两击确认）；
 * **全局条目** = 「导入到本项目」（登记项目级引用，同名时两击确认）、编辑、
 * 删除；全局条目自身 disabled 时给一个直接的恢复入口。
 */
function McpDetail({ api, server, mount, hasWorkspace, confirmingDelete, confirmingImport, onEdit, onToggle, onDelete, onImport, onToolCount, }) {
    const isGlobal = server.scope === "global";
    /** 项目区里来自全局导入的副本（条目带导入标记）：徽标按"出身"标「全局」。 */
    const imported = !isGlobal && server.importedFromGlobal === true;
    /** 项目级引用（内容跟随全局，启停是项目级标记；不提供「编辑」）。 */
    const isReference = server.reference === true;
    /** 移除按钮文案：全局导入的副本 = 「移出」（全局原版仍在全局区）；其余 = 「删除」。 */
    const removeVerb = imported ? "移出" : "删除";
    // 「查看工具与参数」：真连一次该条目（零副作用探测），用两栏检视器展开工具与参数。
    const [inspect, setInspect] = useState({
        open: false,
        testing: false,
    });
    // 「使用记录」：宿主内存里的 MCP 工具调用记录（只读、不落盘）。
    // 打开时拉一次，打开期间每 2s 刷新；关闭/切服务器即停。
    const [usageOpen, setUsageOpen] = useState(false);
    // 换选中的服务器时收起并丢弃上一次的结果，避免把 A 的清单显示在 B 上。
    useEffect(() => {
        setInspect({ open: false, testing: false });
        setUsageOpen(false);
    }, [server.key, server.scope]);
    /** 跑一次探测；失败以 `{ ok:false, errors }` 归一（不抛异常，就地展示）。 */
    const runInspect = async () => {
        setInspect({ open: true, testing: true });
        try {
            const result = await api.test({ entry: server.entry, key: server.key });
            setInspect({ open: true, testing: false, result });
            if (result.ok)
                onToolCount?.(result.tools.length);
        }
        catch (error) {
            setInspect({ open: true, testing: false, result: { ok: false, errors: [String(error)] } });
        }
    };
    return (_jsxs("div", { className: "skp-detail-card", children: [_jsxs("div", { className: "skp-detail-head", children: [_jsx("h3", { children: server.key }), _jsxs("span", { style: HEAD_TAGS_STYLE, children: [_jsx("span", { className: isGlobal || imported ? "skp-tag skp-tag-global" : "skp-tag skp-tag-project", title: isGlobal
                                    ? server.shadowed
                                        ? "全局服务器（对所有项目生效）；当前被本项目内的同名条目遮蔽"
                                        : "全局服务器（对所有项目生效）"
                                    : isReference
                                        ? "本项目内对全局服务器的引用（内容跟随全局，启停只作用于本项目）"
                                        : imported
                                            ? "本项目内来自全局导入的副本（遮蔽全局同名条目，控制只作用于本项目）"
                                            : "本项目内的服务器（遮蔽全局同名条目）", children: isGlobal || imported ? "全局" : "项目" }), isReference && (_jsx("span", { className: "skp-tag skp-tag-flat", title: "\u5F15\u7528\uFF1A\u5185\u5BB9\u8DDF\u968F\u5168\u5C40\uFF0C\u542F\u505C\u53EA\u4F5C\u7528\u4E8E\u672C\u9879\u76EE", children: "\u5F15\u7528" }))] })] }), _jsxs("div", { className: "skp-detail-actions", children: [!isGlobal && (_jsx("button", { type: "button", className: `skp-btn ${server.enabled ? "skp-state-on" : "skp-state-off"}`, title: isReference
                            ? server.enabled
                                ? "点击在本项目禁用该引用（本项目不再挂载，全局配置不变）"
                                : "点击在本项目启用该引用（全局配置不变）"
                            : server.enabled
                                ? "点击禁用（保留在配置文件中，不挂载）"
                                : "点击启用（写入配置文件并挂载）", onClick: onToggle, children: server.enabled ? "已启用" : "已禁用" })), isGlobal && !server.enabled && (_jsx("button", { type: "button", className: "skp-btn skp-state-off", title: "\u6B64\u5168\u5C40\u670D\u52A1\u5668\u5F53\u524D\u4E3A\u7981\u7528\u72B6\u6001\uFF1B\u70B9\u51FB\u6062\u590D\u542F\u7528\uFF08\u5BF9\u6240\u6709\u9879\u76EE\u751F\u6548\uFF09", onClick: onToggle, children: "\u5DF2\u7981\u7528" })), isGlobal && hasWorkspace && (_jsx("button", { type: "button", className: confirmingImport ? "skp-btn skp-btn-danger" : "skp-btn", title: confirmingImport
                            ? "项目内已有同名引用，再次点击将重新登记（保留原启停状态，全局配置不变）"
                            : "在本项目登记对全局服务器的引用（内容跟随全局，可在本项目启停）", onClick: onImport, children: confirmingImport ? "确认重复导入同名引用？" : "导入到本项目" })), !isReference && (_jsx("button", { type: "button", className: "skp-btn", onClick: onEdit, children: "\u7F16\u8F91" })), _jsx("button", { type: "button", className: "skp-btn", disabled: inspect.testing, title: inspect.open
                            ? "收起工具与参数"
                            : "真连一次该服务器并列出它的描述、工具与参数（不落盘、不注册工具、不影响已挂载的连接）", onClick: () => {
                            if (inspect.open)
                                setInspect({ open: false, testing: false });
                            else
                                void runInspect();
                        }, children: inspect.testing ? "连接中…" : inspect.open ? "收起工具列表" : "查看工具与参数" }), _jsx("button", { type: "button", className: "skp-btn", title: "\u67E5\u770B\u6700\u8FD1\u54EA\u4E2A\u4F1A\u8BDD\u5728\u4EC0\u4E48\u65F6\u5019\u8C03\u7528\u4E86\u8FD9\u4E2A MCP \u7684\u54EA\u4E2A\u5DE5\u5177\uFF08\u4EC5\u672C\u6B21\u8FD0\u884C\u7684\u5185\u5B58\u8BB0\u5F55\uFF0C\u4E0D\u843D\u76D8\uFF09", onClick: () => setUsageOpen((open) => !open), children: usageOpen ? "收起使用记录" : "使用记录" }), _jsx("button", { type: "button", className: confirmingDelete ? "skp-btn skp-btn-danger" : "skp-btn skp-btn-danger-ghost", title: isGlobal
                            ? "删除此全局服务器；各项目内的引用不受影响（变为悬空引用）"
                            : isReference
                                ? "移出本项目（移除对全局服务器的引用，全局原版仍在全局区）"
                                : imported
                                    ? "移出本项目（移除全局导入的副本，全局原版仍在全局区）"
                                    : "删除本项目中的这个服务器", onClick: onDelete, children: confirmingDelete ? `确认${removeVerb}？` : removeVerb })] }), isReference && _jsx("div", { className: "skp-note", children: "\u5F15\u7528\uFF1A\u5185\u5BB9\u8DDF\u968F\u5168\u5C40\uFF0C\u542F\u505C\u53EA\u4F5C\u7528\u4E8E\u672C\u9879\u76EE\u3002" }), _jsxs("dl", { className: "skp-detail-fields", children: [_jsx("dt", { children: "\u547D\u540D\u7A7A\u95F4" }), _jsxs("dd", { children: ["mcp__", server.serverName, "__*"] }), server.transport === "stdio" ? (_jsxs(_Fragment, { children: [_jsx("dt", { children: "\u547D\u4EE4" }), _jsx("dd", { className: "skp-path", children: server.entry.command }), (server.entry.args ?? []).length > 0 && (_jsxs(_Fragment, { children: [_jsx("dt", { children: "\u53C2\u6570" }), _jsx("dd", { className: "skp-path", children: (server.entry.args ?? []).join(" ") })] }))] })) : (_jsxs(_Fragment, { children: [_jsx("dt", { children: "URL" }), _jsx("dd", { className: "skp-path", children: server.entry.url })] })), _jsx("dt", { children: "\u914D\u7F6E\u6587\u4EF6" }), _jsx("dd", { className: "skp-path", children: server.filePath }), _jsx("dt", { children: "\u72B6\u6001" }), _jsx("dd", { children: mount === undefined ? "未挂载到当前会话" : MOUNT_LABEL[mount.state] }), mount?.error !== undefined && (_jsxs(_Fragment, { children: [_jsx("dt", { children: "\u9519\u8BEF" }), _jsx("dd", { className: "skp-path", children: mount.error })] }))] }), inspect.open && (_jsxs("div", { className: "skp-detail-inspect", children: [_jsxs("div", { className: "skp-detail-inspect-head", children: [_jsx("span", { className: "skp-field-label", children: "\u5DE5\u5177\u4E0E\u53C2\u6570" }), _jsxs("span", { style: INSPECT_HEAD_RIGHT_STYLE, children: [inspect.result?.ok === true && inspect.result.tools.length > 0 && (_jsx("span", { className: "skp-test-stat", children: "\u70B9\u51FB\u5DE5\u5177\u67E5\u770B\u53C2\u6570" })), _jsx("button", { type: "button", className: "skp-link-btn", disabled: inspect.testing, onClick: () => void runInspect(), children: inspect.testing ? "连接中…" : "重新测试" })] })] }), inspect.result === undefined ? (_jsx("div", { className: "skp-note", children: "\u6B63\u5728\u8FDE\u63A5\u5E76\u8BFB\u53D6\u5DE5\u5177\u6E05\u5355\u2026" })) : (_jsx(ToolsReport, { result: inspect.result }))] })), usageOpen && (_jsx("div", { className: "skp-detail-inspect", children: _jsx(McpUsageSection, { api: api, serverName: server.serverName }) }))] }));
}
// ---------------------------------------------------------------------------
// 新增 / 编辑表单
// ---------------------------------------------------------------------------
/**
 * 新增 / 编辑表单（分别内嵌在添加 / 编辑弹窗里，见 McpAddDialog / McpEditDialog）。
 *
 * 多行文本框承载 env / headers（每行 `KEY=VALUE`）与 args（每行一个参数），
 * 提交时解析成结构化字段；新增时 scope 与 name 可改（编辑改名 = 删除后重建，
 * 这里用禁用态规避）。
 *
 * `embedded` 为 true 时褪掉卡片外壳与自带标题，直接作为弹窗内容；
 * 此时按钮行由 `actionsClass` 指定落到弹窗底部的对齐方式。
 * onSave 抛错（如宿主校验/落盘失败）时把错误信息展示在表单顶部。
 */
function McpForm({ api, mode, server, workspace, embedded, actionsClass = "skp-detail-actions", defaultScope, onCancel, onSave, }) {
    // 编辑态用现有条目回填；新增态从空对象起步。
    const entry = server?.entry ?? {};
    const [scope, setScope] = useState(server?.scope ?? defaultScope ?? (workspace !== undefined ? "project" : "global"));
    const [key, setKey] = useState(server?.key ?? "");
    const [transport, setTransport] = useState(server?.transport ?? "stdio");
    const [command, setCommand] = useState(entry.command ?? "");
    const [args, setArgs] = useState((entry.args ?? []).join("\n"));
    const [env, setEnv] = useState(recordToLines(entry.env));
    const [url, setUrl] = useState(entry.url ?? "");
    const [headers, setHeaders] = useState(recordToLines(entry.headers));
    const [timeoutMs, setTimeoutMs] = useState(entry.timeoutMs !== undefined ? String(entry.timeoutMs) : "");
    const [disabled, setDisabled] = useState(entry.disabled === true);
    const [errors, setErrors] = useState([]);
    const [saving, setSaving] = useState(false);
    // 「测试连接」：结果（成功含工具清单 / 失败含错误文案）与进行中标志。
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState(undefined);
    const isNew = mode === "new";
    // 没有工作区时不能创建项目级条目（占位标签口径收敛在 panel-common.hasWorkspaceLabel）。
    const noWorkspace = !hasWorkspaceLabel(workspace);
    /**
     * 从当前表单值构建条目（保存与测试共用同一口径，避免"能测不能存"漂移）。
     * 有校验问题时返回问题列表；测试与保存都直接展示这些问题。
     */
    const buildEntry = () => {
        const problems = [];
        if (key.trim().length === 0)
            problems.push("名称不能为空");
        if (transport === "stdio" && command.trim().length === 0)
            problems.push('stdio 服务器需要填写「命令」');
        if (transport === "http" && url.trim().length === 0)
            problems.push('http 服务器需要填写「URL」');
        const envRecord = linesToRecord(env, "env", problems);
        const headerRecord = linesToRecord(headers, "headers", problems);
        const timeout = timeoutMs.trim().length === 0 ? undefined : Number(timeoutMs);
        if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0))
            problems.push("超时必须是正数（ms）");
        if (problems.length > 0)
            return { ok: false, problems };
        // 只把"有内容的可选字段"写进条目，保持配置文件最小化。
        // 「全局导入」标记随编辑保留（改字段不抹掉"来自全局导入"的身份）。
        const importMarker = entry.importedFromGlobal === true ? { importedFromGlobal: true } : {};
        const next = transport === "stdio"
            ? {
                type: "stdio",
                command: command.trim(),
                args: linesToArray(args),
                ...(Object.keys(envRecord).length > 0 ? { env: envRecord } : {}),
                ...(timeout !== undefined ? { timeoutMs: timeout } : {}),
                ...(disabled ? { disabled: true } : {}),
                ...importMarker,
            }
            : {
                type: "http",
                url: url.trim(),
                ...(Object.keys(headerRecord).length > 0 ? { headers: headerRecord } : {}),
                ...(timeout !== undefined ? { timeoutMs: timeout } : {}),
                ...(disabled ? { disabled: true } : {}),
                ...importMarker,
            };
        return { ok: true, entry: next };
    };
    /** 保存（客户端前置校验与宿主 validateEntry 同口径，快速反馈）。 */
    const submit = async () => {
        const built = buildEntry();
        if (!built.ok) {
            setErrors(built.problems);
            return;
        }
        setSaving(true);
        try {
            await onSave(scope, key.trim(), built.entry);
            setErrors([]);
        }
        catch (error) {
            // 宿主校验 / 落盘失败：把错误展示在表单顶部（编辑态此前走面板级
            // opError，新增态弹窗内没有该通道，统一收敛到表单内）。
            setErrors([error instanceof Error ? error.message : String(error)]);
        }
        finally {
            setSaving(false);
        }
    };
    /**
     * 「测试」：把当前表单草稿直接交给宿主真实连接（不落盘、不挂载），
     * 结果就地展示工具名与参数。失败只更新 testResult，不抛异常。
     */
    const runTest = async () => {
        const built = buildEntry();
        if (!built.ok) {
            setErrors(built.problems);
            setTestResult(undefined);
            return;
        }
        setErrors([]);
        setTesting(true);
        setTestResult(undefined);
        try {
            setTestResult(await api.test({ entry: built.entry, key: key.trim() }));
        }
        catch (error) {
            // 传输层异常（RPC 断线等）：按失败结果展示，不冒泡到渲染层。
            setTestResult({ ok: false, errors: [error instanceof Error ? error.message : String(error)] });
        }
        finally {
            setTesting(false);
        }
    };
    const busy = saving || testing;
    return (_jsxs("div", { className: embedded ? undefined : "skp-detail-card", children: [!embedded && _jsx("h3", { children: isNew ? "添加 MCP 服务器" : `编辑 ${server?.key}` }), errors.length > 0 && _jsx("div", { className: "skp-error", children: errors.join("\n") }), _jsxs("div", { className: "skp-form", children: [_jsxs("label", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "\u4F5C\u7528\u57DF" }), _jsx(SkpSelect, { value: scope, disabled: !isNew, ariaLabel: "\u670D\u52A1\u5668\u4F5C\u7528\u57DF", options: [
                                    // 无工作区时禁用项目选项（项目作用域需要 cwd）。
                                    { value: "project", label: "项目（.mcp.json）", disabled: noWorkspace },
                                    { value: "global", label: "全局（~/.agents/mcp.json）" },
                                ], onChange: (value) => setScope(value === "project" ? "project" : "global") })] }), _jsxs("label", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "\u540D\u79F0" }), _jsx("input", { className: "skp-input", value: key, disabled: !isNew, placeholder: "github", onChange: (e) => setKey(e.target.value) })] }), _jsxs("label", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "\u4F20\u8F93\u65B9\u5F0F" }), _jsx(SkpSelect, { value: transport, ariaLabel: "\u4F20\u8F93\u65B9\u5F0F", options: [
                                    { value: "stdio", label: "stdio（启动本地命令）" },
                                    { value: "http", label: "http（流式 HTTP 端点）" },
                                ], onChange: (value) => setTransport(value === "http" ? "http" : "stdio") })] }), transport === "stdio" ? (_jsxs(_Fragment, { children: [_jsxs("label", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "\u547D\u4EE4" }), _jsx("input", { className: "skp-input", value: command, placeholder: "npx", onChange: (e) => setCommand(e.target.value) })] }), _jsxs("label", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "\u53C2\u6570\uFF08\u6BCF\u884C\u4E00\u4E2A\uFF09" }), _jsx("textarea", { className: "skp-input skp-textarea", value: args, placeholder: "-y\n@modelcontextprotocol/server-github", onChange: (e) => setArgs(e.target.value) })] }), _jsxs("label", { className: "skp-field", children: [_jsxs("span", { className: "skp-field-label", children: ["\u73AF\u5883\u53D8\u91CF\uFF08\u6BCF\u884C KEY=VALUE\uFF0C\u652F\u6301 $", "${VAR}", "\uFF09"] }), _jsx("textarea", { className: "skp-input skp-textarea", value: env, placeholder: "GITHUB_TOKEN=${GITHUB_TOKEN}", onChange: (e) => setEnv(e.target.value) })] })] })) : (_jsxs(_Fragment, { children: [_jsxs("label", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "URL" }), _jsx("input", { className: "skp-input", value: url, placeholder: "http://localhost:3000/mcp", onChange: (e) => setUrl(e.target.value) })] }), _jsxs("label", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "\u8BF7\u6C42\u5934\uFF08\u6BCF\u884C KEY=VALUE\uFF09" }), _jsx("textarea", { className: "skp-input skp-textarea", value: headers, onChange: (e) => setHeaders(e.target.value) })] })] })), _jsxs("label", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "\u5DE5\u5177\u8C03\u7528\u8D85\u65F6\uFF08ms\uFF0C\u53EF\u9009\uFF09" }), _jsx("input", { className: "skp-input", value: timeoutMs, inputMode: "numeric", placeholder: "60000", onChange: (e) => setTimeoutMs(e.target.value) })] }), _jsxs("label", { className: "skp-field skp-field-inline", children: [_jsx("input", { type: "checkbox", checked: disabled, onChange: (e) => setDisabled(e.target.checked) }), _jsx("span", { children: "\u7981\u7528\uFF08\u4FDD\u7559\u5728\u914D\u7F6E\u6587\u4EF6\u4E2D\uFF0C\u4E0D\u6302\u8F7D\uFF09" })] }), testing && _jsx("div", { className: "skp-status", children: "\u6B63\u5728\u8FDE\u63A5\u5E76\u8BFB\u53D6\u5DE5\u5177\u5217\u8868\u2026" }), testResult !== undefined && _jsx(ToolsReport, { result: testResult }), _jsxs("div", { className: actionsClass, children: [_jsx("button", { type: "button", className: "skp-btn", disabled: busy, title: "\u7528\u5F53\u524D\u8868\u5355\u5185\u5BB9\u771F\u5B9E\u8FDE\u63A5\u4E00\u6B21\uFF08\u4E0D\u4FDD\u5B58\u3001\u4E0D\u6302\u8F7D\uFF09\uFF0C\u5217\u51FA\u8BE5\u670D\u52A1\u5668\u7684\u5DE5\u5177\u4E0E\u53C2\u6570", onClick: () => void runTest(), children: testing ? "测试中…" : "测试连接" }), _jsx("button", { type: "button", className: "skp-btn skp-btn-primary", disabled: busy, onClick: () => void submit(), children: saving ? (isNew ? "添加中…" : "保存中…") : isNew ? "添加" : "保存" }), _jsx("button", { type: "button", className: "skp-btn", onClick: onCancel, children: "\u53D6\u6D88" })] })] })] }));
}
/**
 * 「工具与参数」手风琴检视器（配置条目与外部注入共用）：
 *  - 每个工具一行，只显示工具名 + 参数个数（不显示 description）；
 *  - 点工具名在其**下方**展开参数表（参数 / 类型 / 必填 / 说明），再点收起；
 *    同一时间只展开一个工具；
 *  - 参数从 `tool.parameters` 的 `properties` + `required` 展开；无参数显示「无参数」。
 *
 * 展开/收起只改变本地状态，**不重新探测**（探测由调用方控制）；工具清单变化
 * （重新测试 / 换服务器）时若当前展开项已不存在则自动收起。
 */
function ToolsInspector({ tools }) {
    // 手风琴：默认全部收起；点工具名展开其参数表，再点收起（同一时间只展开一个）。
    const [expandedName, setExpandedName] = useState(undefined);
    useEffect(() => {
        setExpandedName((current) => (current !== undefined && tools.some((tool) => tool.name === current) ? current : undefined));
    }, [tools]);
    return (_jsx("div", { className: "skp-tool-accordion", role: "list", children: tools.map((tool) => {
            const open = expandedName === tool.name;
            const parameters = toolParameters(tool);
            return (_jsxs("div", { className: open ? "skp-tool-item skp-tool-item-open" : "skp-tool-item", role: "listitem", children: [_jsxs("button", { type: "button", className: "skp-tool-trigger", "aria-expanded": open, title: tool.name, onClick: () => setExpandedName(open ? undefined : tool.name), children: [_jsx("span", { className: "skp-tool-chevron", "aria-hidden": "true", children: open ? "▾" : "▸" }), _jsx("code", { className: "skp-tool-name", children: tool.name }), _jsx("span", { className: "skp-tool-count", children: parameters.length > 0 ? `${parameters.length} 个参数` : "无参数" })] }), open && (_jsx("div", { className: "skp-tool-body", children: parameters.length === 0 ? (_jsx("div", { className: "skp-note", children: "\u65E0\u53C2\u6570" })) : (_jsxs("div", { style: PARAM_GRID_STYLE, children: [["参数", "类型", "必填", "说明"].map((label) => (_jsx("span", { className: "skp-field-label", style: PARAM_HEAD_CELL_STYLE, children: label }, label))), parameters.map((parameter) => (_jsxs(Fragment, { children: [_jsx("code", { className: "skp-param-name", style: PARAM_CELL_STYLE, children: parameter.name }), _jsx("span", { className: "skp-test-stat", style: PARAM_CELL_STYLE, children: parameter.type }), _jsx("span", { style: PARAM_CELL_STYLE, children: _jsx("span", { className: parameter.required ? "skp-tag skp-tag-warn" : "skp-tag skp-tag-flat", children: parameter.required ? "必填" : "可选" }) }), _jsx("span", { className: "skp-param-desc", style: PARAM_CELL_STYLE, children: parameter.description !== undefined && parameter.description.trim().length > 0
                                                ? parameter.description
                                                : "—" })] }, parameter.name)))] })) }))] }, tool.name));
        }) }));
}
/**
 * 「测试连接」/「查看工具与参数」的成功报告：状态行（连接正常 / 工具数 / 耗时）
 * + 服务器提示（默认折叠 3 行）+ 两栏工具/参数检视器。失败只展示错误块。
 */
function ToolsReport({ result }) {
    if (!result.ok)
        return _jsx("div", { className: "skp-error", children: result.errors.join("\n") });
    const instruction = typeof result.instruction === "string" ? result.instruction.trim() : "";
    return (_jsxs("div", { className: "skp-test", children: [_jsxs("div", { className: "skp-test-head", children: [_jsx("span", { className: "skp-tag skp-tag-global", children: "\u8FDE\u63A5\u6B63\u5E38" }), _jsxs("span", { className: "skp-test-stat", children: [result.tools.length, " \u4E2A\u5DE5\u5177"] }), _jsxs("span", { className: "skp-test-stat", children: ["\u8017\u65F6 ", result.elapsedMs, "ms"] })] }), instruction.length > 0 && _jsx(McpInstruction, { text: instruction }), result.tools.length === 0 ? (_jsx("div", { className: "skp-note", children: "\u8FDE\u63A5\u6210\u529F\uFF0C\u4F46\u670D\u52A1\u5668\u672A\u66B4\u9732\u4EFB\u4F55\u5DE5\u5177\u3002" })) : (_jsx(ToolsInspector, { tools: result.tools }))] }));
}
/** 服务器提示（`instructions`）：默认折叠 3 行，点「展开/收起」切换。 */
function McpInstruction({ text }) {
    const [expanded, setExpanded] = useState(false);
    return (_jsxs("div", { className: "skp-test-instruction", children: [_jsxs("div", { className: "skp-test-instruction-head", children: [_jsx("span", { className: "skp-field-label", children: "\u670D\u52A1\u5668\u63D0\u793A" }), _jsx("button", { type: "button", className: "skp-link-btn", onClick: () => setExpanded((value) => !value), children: expanded ? "收起" : "展开" })] }), _jsx("p", { className: expanded ? "skp-test-instruction-body" : "skp-test-instruction-body skp-clamp-3", children: text })] }));
}
/**
 * 使用记录的时间列：当天只显示 `HH:mm:ss`，跨天补上 `MM-DD `（避免不同日期的
 * 记录看起来一样）。时间来自宿主 `Date.now()`，客户端本地时区格式化。
 */
function formatUsageTime(time) {
    if (!Number.isFinite(time) || time <= 0)
        return "—";
    const date = new Date(time);
    const pad = (value) => String(value).padStart(2, "0");
    const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    const now = new Date();
    const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
    return sameDay ? clock : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock}`;
}
/** 从工具的 `inputSchema` 展开参数（`properties` + `required`）。 */
function toolParameters(tool) {
    const schema = tool.parameters;
    if (schema === undefined || schema === null)
        return [];
    const properties = schema.properties;
    if (properties === null || typeof properties !== "object" || Array.isArray(properties))
        return [];
    const required = Array.isArray(schema.required) ? schema.required.filter((name) => typeof name === "string") : [];
    return Object.entries(properties).map(([name, raw]) => {
        const property = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
        const description = typeof property.description === "string" ? property.description : undefined;
        return {
            name,
            type: schemaType(property),
            required: required.includes(name),
            ...(description !== undefined ? { description } : {}),
        };
    });
}
/** 一个 JSON Schema 属性的类型名（联合类型用 ` | ` 连接，缺 type 时给结构提示）。 */
function schemaType(property) {
    const type = property.type;
    if (typeof type === "string")
        return type;
    if (Array.isArray(type)) {
        const parts = type.filter((part) => typeof part === "string");
        if (parts.length > 0)
            return parts.join(" | ");
    }
    if (Array.isArray(property.enum))
        return "enum";
    if (property.anyOf !== undefined || property.oneOf !== undefined)
        return "union";
    return "unknown";
}
// ---------------------------------------------------------------------------
// 添加弹窗（表单 / JSON）
// ---------------------------------------------------------------------------
/**
 * 添加 MCP 服务器弹窗：与技能安装弹窗同构（Modal + 模式 Tab）。
 *
 * - 表单：沿用 McpForm（embedded 内嵌）逐字段填写单个条目；
 * - JSON：粘贴 .mcp.json 或裸服务器映射，实时预览后批量添加。
 */
function McpAddDialog({ api, servers, workspace, defaultScope, onClose, onMutated, }) {
    const [tab, setTab] = useState("form");
    return (_jsxs(Modal, { title: "\u6DFB\u52A0 MCP \u670D\u52A1\u5668", onClose: onClose, children: [_jsx("div", { className: "skp-tabs", role: "tablist", children: ["form", "json"].map((t) => (_jsx("button", { role: "tab", "aria-selected": tab === t, className: tab === t ? "skp-tab skp-tab-active" : "skp-tab", onClick: () => setTab(t), children: t === "form" ? "表单" : "JSON" }, t))) }), _jsx("div", { hidden: tab !== "form", children: _jsx(McpForm, { api: api, mode: "new", workspace: workspace, embedded: true, actionsClass: "skp-modal-actions", defaultScope: defaultScope, onCancel: onClose, onSave: async (scope, key, entry) => {
                        const result = await api.upsert({ scope, key, entry });
                        if (!result.ok)
                            throw new Error(result.errors.join("; "));
                        onMutated();
                        onClose();
                    } }) }), _jsx("div", { hidden: tab !== "json", children: _jsx(McpJsonImport, { api: api, servers: servers, workspace: workspace, defaultScope: defaultScope, onClose: onClose, onMutated: onMutated }) })] }));
}
/**
 * 编辑 MCP 服务器弹窗：与新增同款外壳（Modal + 内嵌 McpForm）。
 * 只含表单（JSON 批量导入只属于新增场景）；scope 与 name 在编辑态锁定
 * （改名 = 删除后重建，沿用 McpForm 的禁用态规避）。
 */
function McpEditDialog({ api, server, workspace, onClose, onSaved, }) {
    return (_jsx(Modal, { title: `编辑 ${server.key}`, onClose: onClose, children: _jsx(McpForm, { api: api, mode: "edit", server: server, workspace: workspace, embedded: true, actionsClass: "skp-modal-actions", onCancel: onClose, onSave: async (scope, key, entry) => {
                const result = await api.upsert({ scope, key, entry });
                if (!result.ok)
                    throw new Error(result.errors.join("; "));
                onSaved();
                onClose();
            } }) }));
}
/**
 * 解析"添加 MCP 服务器"的 JSON 文本为条目清单。
 *
 * 接受两种形状：
 *   - 完整配置文件：`{ "mcpServers": { … } }`（可直接粘贴 .mcp.json）；
 *   - 裸映射：`{ "github": { … }, "web": { … } }`。
 * 顶层必须是对象；逐条用与宿主同口径的 validateEntry 校验
 * （见 mcp/entry-util.ts），任一非法条目都会整体返回错误与逐条原因。
 */
function parseMcpJson(text) {
    let data;
    try {
        data = JSON.parse(text);
    }
    catch (error) {
        return { ok: false, errors: [`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`] };
    }
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
        return { ok: false, errors: ['JSON 顶层必须是对象，例如 { "mcpServers": { … } } 或 { "服务器名": { … } }'] };
    }
    const root = data;
    // 裸映射的每个值都不是对象 → 更像"单条条目缺名称键"，给出明确提示。
    if (Object.keys(root).length > 0 && Object.values(root).every((v) => v === null || typeof v !== "object" || Array.isArray(v))) {
        return { ok: false, errors: ['看起来是单条服务器条目，缺少名称键；请用 { "服务器名": { … } } 包裹。'] };
    }
    // 完整配置文件取 mcpServers 键；否则把顶层本身当服务器映射。
    let servers;
    if (typeof root.mcpServers === "object" && root.mcpServers !== null && !Array.isArray(root.mcpServers)) {
        servers = root.mcpServers;
    }
    else if ("mcpServers" in root && Object.keys(root).length === 1) {
        return { ok: false, errors: ['「mcpServers」必须是服务器对象映射。'] };
    }
    else {
        servers = root;
    }
    const entries = [];
    const problems = [];
    for (const [key, value] of Object.entries(servers)) {
        if (value === null || typeof value !== "object" || Array.isArray(value)) {
            problems.push(`${key}: 条目必须是对象`);
            continue;
        }
        const entry = value;
        const entryProblems = validateEntry(key, entry);
        if (entryProblems.length > 0) {
            problems.push(`${key}: ${entryProblems.join("; ")}`);
            continue;
        }
        entries.push({ key, entry });
    }
    if (problems.length > 0)
        return { ok: false, errors: problems };
    if (entries.length === 0)
        return { ok: false, errors: ["没有可添加的服务器条目。"] };
    return { ok: true, entries };
}
/** JSON 文本框占位示例（两种形状都能贴）。 */
const JSON_PLACEHOLDER = `{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "\${GITHUB_TOKEN}" }
    },
    "web": { "type": "http", "url": "http://localhost:3000/mcp" }
  }
}`;
/**
 * JSON 批量添加面板：粘贴 .mcp.json 或裸服务器映射，实时解析并预览
 * （新增 / 覆盖 / 跳过与逐条错误），确认后逐条写入。
 *
 * 逐条**串行** upsert：并发读写同一配置文件会互相覆盖（读-改-写竞态），
 * 串行保证每次写入都基于最新文件内容。
 */
function McpJsonImport({ api, servers, workspace, defaultScope, onClose, onMutated, }) {
    // 没有工作区时不能创建项目级条目（占位标签口径收敛在 panel-common.hasWorkspaceLabel）。
    const noWorkspace = !hasWorkspaceLabel(workspace);
    const [text, setText] = useState("");
    const [scope, setScope] = useState(defaultScope ?? (noWorkspace ? "global" : "project"));
    const [overwrite, setOverwrite] = useState(false);
    const [busy, setBusy] = useState(false);
    const [opErrors, setOpErrors] = useState([]);
    // 实时解析：文本一变预览区就刷新（整体非法时展示解析错误）。
    const parse = useMemo(() => parseMcpJson(text), [text]);
    // 预览行：标注每条的状态（将新增 / 将覆盖 / 已存在跳过），供确认与冲突提示。
    const preview = useMemo(() => {
        if (!parse.ok)
            return undefined;
        return parse.entries.map(({ key, entry }) => {
            const exists = servers.some((s) => s.scope === scope && s.key === key);
            return { key, entry, exists, overwriting: exists && overwrite, skipped: exists && !overwrite };
        });
    }, [parse, servers, scope, overwrite]);
    const addable = preview?.filter((item) => !item.skipped) ?? [];
    const doAdd = async () => {
        setBusy(true);
        setOpErrors([]);
        const failures = [];
        let added = 0;
        for (const { key, entry } of addable) {
            const result = await api.upsert({ scope, key, entry });
            if (result.ok)
                added += 1;
            else
                failures.push(`${key}: ${result.errors.join("; ")}`);
        }
        onMutated(); // 已写入的部分先刷新列表与冲突检测
        if (failures.length > 0) {
            setOpErrors([`已添加 ${added} 个，失败 ${failures.length} 个：`, ...failures]);
            setBusy(false);
            return;
        }
        onClose();
    };
    return (_jsxs("div", { className: "skp-form", children: [_jsxs("label", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "JSON \u914D\u7F6E" }), _jsx("textarea", { className: "skp-input skp-textarea skp-json-field", value: text, spellCheck: false, placeholder: JSON_PLACEHOLDER, onChange: (e) => {
                            setText(e.target.value);
                            setOpErrors([]);
                        } }), _jsxs("span", { className: "skp-note", children: ["\u652F\u6301\u5B8C\u6574 .mcp.json\uFF08\u542B mcpServers \u952E\uFF09\uFF0C\u6216\u76F4\u63A5\u7C98\u8D34 ", `{ "服务器名": { … } }`, " \u6620\u5C04\u3002"] })] }), !parse.ok && text.trim().length > 0 && _jsx("div", { className: "skp-error", children: parse.errors.join("\n") }), preview !== undefined && preview.length > 0 && (_jsxs("div", { className: "skp-field", children: [_jsxs("span", { className: "skp-field-label", children: ["\u5C06\u6DFB\u52A0 ", addable.length, "/", preview.length, " \u4E2A"] }), _jsx("ul", { className: "skp-import-list", children: preview.map(({ key, entry, overwriting, skipped }) => (_jsxs("li", { className: "skp-import-item", children: [_jsx("span", { className: "skp-import-name", children: key }), _jsx("span", { className: "skp-tag skp-tag-flat", children: transportOf(entry) }), _jsx("span", { className: "skp-import-desc", children: summarizeEntry(entry) }), _jsx("span", { className: `skp-import-note ${overwriting ? "skp-import-note-over" : skipped ? "skp-import-note-skip" : "skp-import-note-add"}`, children: overwriting ? "将覆盖" : skipped ? "已存在，跳过" : "将新增" })] }, key))) })] })), _jsxs("div", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "\u6DFB\u52A0\u5230" }), _jsx(SkpSelect, { value: scope, ariaLabel: "\u6DFB\u52A0\u76EE\u6807\u4F5C\u7528\u57DF", options: [
                            // 无工作区时禁用项目选项（项目作用域需要 cwd）。
                            { value: "project", label: "项目（.mcp.json）", disabled: noWorkspace },
                            { value: "global", label: "全局（~/.agents/mcp.json）" },
                        ], onChange: (value) => setScope(value === "project" ? "project" : "global") })] }), _jsxs("label", { className: "skp-field skp-field-inline", children: [_jsx("input", { type: "checkbox", checked: overwrite, onChange: (e) => setOverwrite(e.target.checked) }), "\u540C\u540D\u670D\u52A1\u5668\u5DF2\u5B58\u5728\u65F6\u8986\u76D6"] }), opErrors.length > 0 && _jsx("div", { className: "skp-error", children: opErrors.join("\n") }), _jsxs("div", { className: "skp-modal-actions", children: [_jsx("button", { type: "button", className: "skp-btn", onClick: onClose, children: "\u53D6\u6D88" }), _jsx("button", { type: "button", className: "skp-btn skp-btn-primary", disabled: busy || addable.length === 0, onClick: () => void doAdd(), children: busy ? "添加中…" : `添加 ${addable.length} 个` })] })] }));
}
// ---------------------------------------------------------------------------
// 文本帮助函数（KEY=VALUE 行 ⇄ 记录、一行一个 ⇄ 数组）
// ---------------------------------------------------------------------------
/** 记录 → 每行 `KEY=VALUE` 的文本（多行文本框回填用）。 */
function recordToLines(record) {
    return Object.entries(record ?? {})
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
}
/** 文本 → 记录；非法行（不以 `KEY=` 开头）记入 problems 并跳过。 */
function linesToRecord(text, field, problems) {
    const out = {};
    for (const rawLine of text.split("\n")) {
        const line = rawLine.trim();
        if (line.length === 0)
            continue;
        const eq = line.indexOf("=");
        if (eq <= 0) {
            problems.push(`${field}：行「${line}」不是 KEY=VALUE 格式`);
            continue;
        }
        out[line.slice(0, eq).trim()] = line.slice(eq + 1);
    }
    return out;
}
/** 文本 → 参数数组：按行拆分、trim、跳过空行。 */
function linesToArray(text) {
    return text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}
