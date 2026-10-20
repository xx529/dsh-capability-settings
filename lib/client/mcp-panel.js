import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * Capability Panel 的 MCP 域视图。
 *
 * 顶部在「项目 / 全局」两区之间切换（两区分离 + 导入制，与 Skills 域同一
 * 模型，见 panel.tsx 的 SkillsView）：每区列表只含该作用域配置文件里的真实
 * 条目（项目 `<项目根>/.mcp.json` / 全局 `~/.agents/mcp.json`，兼容旧位置
 * dsh home / `~/.claude`；同名键项目遮蔽全局），叠加每个 session 的实时
 * 挂载状态，按搜索词过滤。**全局区没有启停开关**——写操作只有
 * 「导入到本项目」（物理复制快照，此后在本项目内独立控制）/编辑/删除；
 * 启停只出现在项目区。写入直接落配置文件，宿主在每次写操作后重挂受影响
 * session 的连接。
 *
 * @module @chengdb/capability-panel/client/mcp-panel
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { summarizeEntry, transportOf, validateEntry } from "../mcp/entry-util.js";
import { Modal } from "./modal.js";
import { SkpSelect } from "./select.js";
import { hasWorkspaceLabel, useAsyncList, ZoneTabs } from "./panel-common.js";
import { aggregateMounts, MOUNT_LABEL } from "./mcp-common.js";
/** 复合行 id：同一个 key 可能同时存在于 project 与 global 两个作用域。 */
function rowId(server) {
    return `${server.scope}:${server.key}`;
}
/**
 * 行圆点的 tooltip：以启用/禁用为主语义（与 Skills / 快捷消息同一套口径），
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
 * MCP 视图主组件：状态管理 + 拉取/重拉 + 列表 + 详情/表单。
 * 两区制：项目区条目可启停/编辑/删除；全局区条目只有「导入到本项目」/
 * 编辑/删除（导入 = 物理复制快照到 `<项目根>/.mcp.json`，项目内已有同名
 * 时两击确认覆盖；同名项目条目遮蔽全局条目）。
 */
export function McpView({ api, workspace }) {
    const mcpApi = api.mcp;
    const [opError, setOpError] = useState(undefined);
    const [zone, setZone] = useState("project");
    const [query, setQuery] = useState("");
    const [selected, setSelected] = useState(undefined);
    /** 选中的「外部注入」实例（serverName）；与 selected 互斥。 */
    const [selectedExternalName, setSelectedExternalName] = useState(undefined);
    // 编辑态：undefined = 空闲；非空 = 正在弹窗里编辑这条 server（McpEditDialog）。
    const [editServer, setEditServer] = useState(undefined);
    // 新增弹窗开关（表单 / JSON 两种模式见 McpAddDialog）。
    const [addOpen, setAddOpen] = useState(false);
    // 二次确认删除：记录"待确认的行 id"，再点一次才真正删除。
    const [confirmDelete, setConfirmDelete] = useState(undefined);
    // 二次确认导入覆盖：项目内已有同名时记录"待确认的行 id"，再点一次带 overwrite。
    const [confirmImport, setConfirmImport] = useState(undefined);
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
    const servers = data?.servers ?? [];
    const listErrors = data?.listErrors ?? [];
    const mounts = data?.mounts ?? {};
    const settling = data?.settling === true;
    /** 外部注入（非本插件配置）的 MCP：与配置条目同列表展示，只读。 */
    const runtimeServers = data?.runtimeServers ?? [];
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
    // 过滤：当前区 + 搜索词（命中 key 或摘要）。
    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        return servers.filter((server) => {
            const inZone = server.scope === zone;
            const inQuery = q.length === 0 || server.key.toLowerCase().includes(q) || server.summary.toLowerCase().includes(q);
            return inZone && inQuery;
        });
    }, [servers, zone, query]);
    const selectedServer = servers.find((s) => rowId(s) === selected);
    /** 外部注入的实例只在「全局」区展示（它们是运行时全局挂载，不属于任何项目配置）。 */
    const visibleExternal = useMemo(() => {
        if (zone !== "global")
            return [];
        const q = query.trim().toLowerCase();
        return runtimeServers.filter((server) => q.length === 0 ||
            server.serverName.toLowerCase().includes(q) ||
            (server.source ?? "").toLowerCase().includes(q) ||
            (server.summary ?? "").toLowerCase().includes(q));
    }, [runtimeServers, zone, query]);
    const selectedExternal = selectedExternalName === undefined ? undefined : runtimeServers.find((s) => s.serverName === selectedExternalName);
    const noWorkspace = !hasWorkspaceLabel(workspace);
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
    /** 启用/禁用切换（直接写入配置文件，落盘后宿主自动重挂；只出现在项目区）。 */
    const onToggle = (server) => {
        void runOp(mcpApi.setEnabled({ scope: server.scope, key: server.key, enabled: !server.enabled }));
    };
    /**
     * 导入这条**全局** server 到当前项目：物理复制到 `<项目根>/.mcp.json`
     * （快照语义——全局后续更新不回流；同名项目条目遮蔽全局）。项目内已有
     * 同名（未确认覆盖）时进入"确认覆盖"态，再次点击带 overwrite 覆盖项目
     * 副本。成功后重拉列表（切到项目区可见、可独立控制，宿主热重挂本项目
     * 的 session）。
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
    return (_jsxs("div", { className: "skp-domain", children: [_jsxs("div", { className: "skp-subheader", children: [_jsx(ZoneTabs, { value: zone, onChange: (z) => {
                            setZone(z);
                            setSelected(undefined);
                            setSelectedExternalName(undefined);
                            setConfirmDelete(undefined);
                            setConfirmImport(undefined);
                        } }), _jsx("input", { className: "skp-search", type: "search", placeholder: "\u641C\u7D22 MCP \u670D\u52A1\u5668\u2026", value: query, onChange: (e) => setQuery(e.target.value) }), _jsxs("button", { type: "button", className: "skp-btn skp-btn-primary", disabled: zone === "project" && noWorkspace, title: zone === "project" && noWorkspace ? "项目区需要可写的工作区才能添加" : undefined, onClick: () => {
                            setEditServer(undefined);
                            setSelected(undefined);
                            setAddOpen(true);
                        }, children: ["+ \u6DFB\u52A0", zone === "project" ? "到项目" : "到全局"] })] }), listErrors.length > 0 && _jsx("div", { className: "skp-error", children: listErrors.join("\n") }), opError && _jsx("div", { className: "skp-error", children: opError }), error && _jsx("div", { className: "skp-error", children: error }), loading && _jsx("div", { className: "skp-status", children: "\u52A0\u8F7D\u4E2D\u2026" }), !loading && (_jsxs("div", { className: "skp-body", children: [_jsxs("ul", { className: "skp-list", children: [visible.map((server) => {
                                const id = rowId(server);
                                const mount = mounts[server.key];
                                return (_jsx("li", { children: _jsxs("button", { className: selected === id ? "skp-row skp-row-active" : "skp-row", onClick: () => {
                                            setSelected(id);
                                            setSelectedExternalName(undefined);
                                            setEditServer(undefined);
                                            setConfirmDelete(undefined);
                                            setConfirmImport(undefined);
                                        }, children: [_jsxs("span", { className: "skp-row-name", children: [zone === "project" && (_jsx("span", { className: `skp-dot ${server.enabled ? "skp-dot-enabled" : ""}`, title: rowDotTitle(server, mount) })), server.key, _jsx("span", { className: server.scope === "global" || server.reference === true ? "skp-tag skp-tag-flat" : "skp-tag skp-tag-directory", children: server.reference === true ? "引用" : server.importedFromGlobal === true ? "导入" : server.scope === "global" ? "全局" : "项目" })] }), _jsxs("span", { className: "skp-row-meta", children: [_jsx("span", { className: "skp-tag skp-tag-flat", children: server.transport }), !server.enabled && _jsx("span", { className: "skp-tag skp-tag-readonly", children: "\u5DF2\u7981\u7528" }), server.enabled && mount === undefined && settling && _jsx("span", { className: "skp-tag skp-tag-flat", children: "\u6302\u8F7D\u4E2D\u2026" }), server.enabled && mount?.state === "failed" && _jsx("span", { className: "skp-tag skp-tag-error", children: "\u6302\u8F7D\u5931\u8D25" }), server.enabled && mount?.state === "conflict" && _jsx("span", { className: "skp-tag skp-tag-warn", children: "\u51B2\u7A81" }), server.shadowed && _jsx("span", { className: "skp-tag skp-tag-directory", children: "\u88AB\u906E\u853D" })] }), _jsx("span", { className: "skp-row-desc", children: server.summary })] }) }, id));
                            }), visibleExternal.map((server) => {
                                const id = `external:${server.serverName}`;
                                return (_jsx("li", { children: _jsxs("button", { className: selectedExternalName === server.serverName ? "skp-row skp-row-active" : "skp-row", onClick: () => {
                                            setSelectedExternalName(server.serverName);
                                            setSelected(undefined);
                                            setEditServer(undefined);
                                            setConfirmDelete(undefined);
                                            setConfirmImport(undefined);
                                        }, children: [_jsxs("span", { className: "skp-row-name", children: [server.serverName, _jsx("span", { className: "skp-tag skp-tag-readonly", children: "\u5916\u90E8" }), server.source !== undefined && _jsx("span", { className: "skp-tag skp-tag-flat", children: server.source }), server.disabledInProject === true && _jsx("span", { className: "skp-tag skp-tag-warn", children: "\u672C\u9879\u76EE\u5DF2\u7981\u7528" })] }), _jsxs("span", { className: "skp-row-meta", children: [server.transport !== undefined && _jsx("span", { className: "skp-tag skp-tag-flat", children: server.transport }), _jsx("span", { className: "skp-test-stat", children: server.tools.length > 0 ? `${server.tools.length} 个工具` : "工具不可见" }), server.calls > 0 && _jsxs("span", { className: "skp-test-stat", children: ["\u8C03\u7528 ", server.calls, " \u6B21"] })] }), _jsx("span", { className: "skp-row-desc", children: server.summary ?? "运行时注入，不由能力面板管理（只读）" })] }) }, id));
                            }), visible.length === 0 && visibleExternal.length === 0 && (_jsx("li", { className: "skp-empty", children: zone === "project"
                                    ? "本项目还没有 MCP 服务器。可到「全局」区导入，或点「+ 添加到项目」。"
                                    : "还没有全局 MCP 服务器。点「+ 添加到全局」添加。" }))] }), _jsx("div", { className: "skp-detail", children: selectedExternal !== undefined ? (_jsx(McpExternalDetail, { api: mcpApi, server: selectedExternal })) : selectedServer ? (_jsx(McpDetail, { api: mcpApi, server: selectedServer, mount: mounts[selectedServer.key], hasWorkspace: !noWorkspace, confirmingDelete: confirmDelete === rowId(selectedServer), confirmingImport: confirmImport === rowId(selectedServer), onEdit: () => setEditServer(selectedServer), onToggle: () => onToggle(selectedServer), onDelete: () => onDelete(selectedServer), onImport: () => void onImport(selectedServer) })) : (_jsx("div", { className: "skp-detail-empty", children: "\u9009\u62E9\u4E00\u4E2A\u670D\u52A1\u5668\u67E5\u770B\u8BE6\u60C5\uFF0C\u6216\u65B0\u589E\u4E00\u4E2A\u3002" })) })] })), addOpen && (_jsx(McpAddDialog, { api: mcpApi, servers: servers, workspace: workspace, defaultScope: zone, onClose: () => setAddOpen(false), onMutated: () => reload() })), editServer !== undefined && (_jsx(McpEditDialog, { api: mcpApi, server: editServer, workspace: workspace, onClose: () => setEditServer(undefined), onSaved: () => reload() }))] }));
}
// ---------------------------------------------------------------------------
// 详情卡片
// ---------------------------------------------------------------------------
/** 详情卡片：归属徽标 + 只读展示条目字段 + 挂载状态 + 写操作。与 Skills
 *  详情同一模型：**项目区**条目 = 启用/禁用状态按钮、编辑、删除（两击
 *  确认）；**全局区**条目 = 「导入到本项目」（物理复制快照，项目内已有
 *  同名时两击确认覆盖）、编辑、删除——全局条目不在面板里启停，需要
 *  项目级控制时先导入再在项目副本上操作。 */
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
 * 每个工具的**说明与参数**（与「查看工具与参数」同源：来自工具注册表），以及使用记录。
 * 不提供编辑/删除/测试——配置与生命周期都在注入方。
 */
function McpExternalDetail({ api, server }) {
    return (_jsxs("div", { className: "skp-detail-card", children: [_jsxs("div", { className: "skp-detail-head", children: [_jsx("h3", { children: server.serverName }), _jsx("span", { className: "skp-tag skp-tag-readonly", children: "\u5916\u90E8\u6CE8\u5165" })] }), _jsxs("dl", { className: "skp-detail-fields", children: [_jsx("dt", { children: "\u6765\u6E90" }), _jsx("dd", { children: server.source ?? "运行时注入（来源不可识别）" }), _jsx("dt", { children: "\u6CE8\u5165\u65B9\u5F0F" }), _jsx("dd", { children: server.origin === "entry" ? "loader 条目（profile patch insert）" : "动态 fiber（其它插件在 apply 中挂载）" }), _jsx("dt", { children: "\u547D\u540D\u7A7A\u95F4" }), _jsx("dd", { children: _jsxs("code", { children: ["mcp__", server.serverName, "__*"] }) }), server.transport !== undefined && (_jsxs(_Fragment, { children: [_jsx("dt", { children: "\u4F20\u8F93\u65B9\u5F0F" }), _jsxs("dd", { children: [server.transport, server.summary !== undefined ? ` · ${server.summary}` : ""] })] })), _jsx("dt", { children: "\u672C\u9879\u76EE\u5F00\u5173" }), _jsxs("dd", { children: [server.restrictable
                                ? "可在对话框的 MCP 弹层里按项目启用/禁用（走项目级声明 + tools.restrict 屏蔽，不卸载实例）。"
                                : "该实例按会话作用域注入，无法按项目禁用。", server.disabledInProject === true ? "当前：本项目已禁用。" : ""] }), _jsx("dt", { children: "\u672C\u6B21\u8FD0\u884C\u8C03\u7528" }), _jsx("dd", { children: server.calls > 0 ? `${server.calls} 次` : "还没有调用记录" }), _jsx("dt", { children: "\u7BA1\u7406" }), _jsx("dd", { children: "\u7531\u6CE8\u5165\u65B9\u7BA1\u7406\uFF1B\u80FD\u529B\u9762\u677F\u53EA\u8BFB\u5C55\u793A\uFF0C\u4E0D\u63D0\u4F9B\u7F16\u8F91/\u5220\u9664/\u5378\u8F7D\u3002" })] }), _jsxs("div", { className: "skp-detail-inspect", children: [_jsxs("div", { className: "skp-detail-inspect-head", children: [_jsx("span", { className: "skp-field-label", children: "\u5DE5\u5177\u4E0E\u53C2\u6570" }), _jsxs("span", { className: "skp-test-stat", children: [server.tools.length, " \u4E2A\u5DE5\u5177"] })] }), server.tools.length === 0 ? (_jsx("div", { className: "skp-note", children: "\u5DE5\u5177\u6E05\u5355\u4E0D\u53EF\u89C1\uFF08\u8BE5\u5B9E\u4F8B\u6309\u4F1A\u8BDD\u4F5C\u7528\u57DF\u6CE8\u5165\uFF0C\u53EA\u80FD\u7EDF\u8BA1\u8C03\u7528\u6B21\u6570\uFF09\u3002" })) : (_jsx("div", { className: "skp-test-tools", children: server.tools.map((tool) => (_jsx(McpToolCard, { tool: { name: tool.name, ...(tool.description !== undefined ? { description: tool.description } : {}), ...(tool.parameters !== undefined ? { parameters: tool.parameters } : {}) } }, tool.name))) }))] }), _jsx("div", { className: "skp-detail-inspect", children: _jsx(McpUsageSection, { api: api, serverName: server.serverName }) })] }));
}
function McpDetail({ api, server, mount, hasWorkspace, confirmingDelete, confirmingImport, onEdit, onToggle, onDelete, onImport, }) {
    const isGlobal = server.scope === "global";
    /** 项目区里来自全局导入的副本（条目带导入标记）：徽标按"出身"标「全局」。 */
    const imported = !isGlobal && server.importedFromGlobal === true;
    /** 项目级引用（内容跟随全局，启停是项目级标记；不提供「编辑」）。 */
    const isReference = server.reference === true;
    /** 移除按钮文案：全局导入的副本 = 「移出」（全局原版仍在全局区）；其余 = 「删除」。 */
    const removeVerb = imported ? "移出" : "删除";
    // 「查看工具与参数」：真连一次该条目（零副作用探测），就地展开描述 + 工具 + 参数。
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
        }
        catch (error) {
            setInspect({ open: true, testing: false, result: { ok: false, errors: [String(error)] } });
        }
    };
    return (_jsxs("div", { className: "skp-detail-card", children: [_jsxs("div", { className: "skp-detail-head", children: [_jsx("h3", { children: server.key }), _jsx("span", { className: isGlobal || imported ? "skp-tag skp-tag-global" : "skp-tag skp-tag-project", title: isGlobal
                            ? server.shadowed
                                ? "全局服务器（对所有项目生效）；当前被本项目内的同名条目遮蔽"
                                : "全局服务器（对所有项目生效）"
                            : isReference
                                ? "本项目内对全局服务器的引用（内容跟随全局，启停只作用于本项目）"
                                : imported
                                    ? "本项目内来自全局导入的副本（遮蔽全局同名条目，控制只作用于本项目）"
                                    : "本项目内的服务器（遮蔽全局同名条目）", children: isGlobal || imported ? "全局" : "项目" })] }), _jsxs("div", { className: "skp-detail-actions", children: [!isGlobal && (_jsx("button", { type: "button", className: `skp-btn ${server.enabled ? "skp-state-on" : "skp-state-off"}`, title: isReference
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
                                    : "删除本项目中的这个服务器", onClick: onDelete, children: confirmingDelete ? `确认${removeVerb}？` : removeVerb })] }), _jsxs("dl", { className: "skp-detail-fields", children: [_jsx("dt", { children: "\u547D\u540D\u7A7A\u95F4" }), _jsxs("dd", { children: ["mcp__", server.serverName, "__*"] }), server.transport === "stdio" ? (_jsxs(_Fragment, { children: [_jsx("dt", { children: "\u547D\u4EE4" }), _jsx("dd", { className: "skp-path", children: server.entry.command }), (server.entry.args ?? []).length > 0 && (_jsxs(_Fragment, { children: [_jsx("dt", { children: "\u53C2\u6570" }), _jsx("dd", { className: "skp-path", children: (server.entry.args ?? []).join(" ") })] }))] })) : (_jsxs(_Fragment, { children: [_jsx("dt", { children: "URL" }), _jsx("dd", { className: "skp-path", children: server.entry.url })] })), _jsx("dt", { children: "\u914D\u7F6E\u6587\u4EF6" }), _jsx("dd", { className: "skp-path", children: server.filePath }), _jsx("dt", { children: "\u72B6\u6001" }), _jsx("dd", { children: mount === undefined ? "未挂载到当前会话" : MOUNT_LABEL[mount.state] }), mount?.error !== undefined && (_jsxs(_Fragment, { children: [_jsx("dt", { children: "\u9519\u8BEF" }), _jsx("dd", { className: "skp-path", children: mount.error })] }))] }), usageOpen && (_jsx("div", { className: "skp-detail-inspect", children: _jsx(McpUsageSection, { api: api, serverName: server.serverName }) })), inspect.open && (_jsxs("div", { className: "skp-detail-inspect", children: [_jsxs("div", { className: "skp-detail-inspect-head", children: [_jsx("span", { className: "skp-field-label", children: "\u5DE5\u5177\u4E0E\u53C2\u6570" }), _jsx("button", { type: "button", className: "skp-link-btn", disabled: inspect.testing, onClick: () => void runInspect(), children: inspect.testing ? "连接中…" : "重新测试" })] }), inspect.result === undefined ? (_jsx("div", { className: "skp-note", children: "\u6B63\u5728\u8FDE\u63A5\u5E76\u8BFB\u53D6\u5DE5\u5177\u6E05\u5355\u2026" })) : (_jsx(McpTestReport, { result: inspect.result }))] }))] }));
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
                                ], onChange: (value) => setTransport(value === "http" ? "http" : "stdio") })] }), transport === "stdio" ? (_jsxs(_Fragment, { children: [_jsxs("label", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "\u547D\u4EE4" }), _jsx("input", { className: "skp-input", value: command, placeholder: "npx", onChange: (e) => setCommand(e.target.value) })] }), _jsxs("label", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "\u53C2\u6570\uFF08\u6BCF\u884C\u4E00\u4E2A\uFF09" }), _jsx("textarea", { className: "skp-input skp-textarea", value: args, placeholder: "-y\n@modelcontextprotocol/server-github", onChange: (e) => setArgs(e.target.value) })] }), _jsxs("label", { className: "skp-field", children: [_jsxs("span", { className: "skp-field-label", children: ["\u73AF\u5883\u53D8\u91CF\uFF08\u6BCF\u884C KEY=VALUE\uFF0C\u652F\u6301 $", "${VAR}", "\uFF09"] }), _jsx("textarea", { className: "skp-input skp-textarea", value: env, placeholder: "GITHUB_TOKEN=${GITHUB_TOKEN}", onChange: (e) => setEnv(e.target.value) })] })] })) : (_jsxs(_Fragment, { children: [_jsxs("label", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "URL" }), _jsx("input", { className: "skp-input", value: url, placeholder: "http://localhost:3000/mcp", onChange: (e) => setUrl(e.target.value) })] }), _jsxs("label", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "\u8BF7\u6C42\u5934\uFF08\u6BCF\u884C KEY=VALUE\uFF09" }), _jsx("textarea", { className: "skp-input skp-textarea", value: headers, onChange: (e) => setHeaders(e.target.value) })] })] })), _jsxs("label", { className: "skp-field", children: [_jsx("span", { className: "skp-field-label", children: "\u5DE5\u5177\u8C03\u7528\u8D85\u65F6\uFF08ms\uFF0C\u53EF\u9009\uFF09" }), _jsx("input", { className: "skp-input", value: timeoutMs, inputMode: "numeric", placeholder: "60000", onChange: (e) => setTimeoutMs(e.target.value) })] }), _jsxs("label", { className: "skp-field skp-field-inline", children: [_jsx("input", { type: "checkbox", checked: disabled, onChange: (e) => setDisabled(e.target.checked) }), _jsx("span", { children: "\u7981\u7528\uFF08\u4FDD\u7559\u5728\u914D\u7F6E\u6587\u4EF6\u4E2D\uFF0C\u4E0D\u6302\u8F7D\uFF09" })] }), testing && _jsx("div", { className: "skp-status", children: "\u6B63\u5728\u8FDE\u63A5\u5E76\u8BFB\u53D6\u5DE5\u5177\u5217\u8868\u2026" }), testResult !== undefined && _jsx(McpTestReport, { result: testResult }), _jsxs("div", { className: actionsClass, children: [_jsx("button", { type: "button", className: "skp-btn", disabled: busy, title: "\u7528\u5F53\u524D\u8868\u5355\u5185\u5BB9\u771F\u5B9E\u8FDE\u63A5\u4E00\u6B21\uFF08\u4E0D\u4FDD\u5B58\u3001\u4E0D\u6302\u8F7D\uFF09\uFF0C\u5217\u51FA\u8BE5\u670D\u52A1\u5668\u7684\u5DE5\u5177\u4E0E\u53C2\u6570", onClick: () => void runTest(), children: testing ? "测试中…" : "测试连接" }), _jsx("button", { type: "button", className: "skp-btn skp-btn-primary", disabled: busy, onClick: () => void submit(), children: saving ? (isNew ? "添加中…" : "保存中…") : isNew ? "添加" : "保存" }), _jsx("button", { type: "button", className: "skp-btn", onClick: onCancel, children: "\u53D6\u6D88" })] })] })] }));
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
/**
 * 「测试连接」/「查看工具与参数」的报告卡片。
 *
 * 排版要点（此前用 `skp-import-*` 兼职渲染，长描述挤成一团、列表被 200px 截断）：
 *  - 顶部只放状态徽标 + 工具数 / 参数总数 / 耗时，一眼可读；
 *  - `instruction`（服务器提示，常常是上千字的说明）单独成块并**默认折叠 3 行**，
 *    需要时点「展开」，不再淹没工具清单；
 *  - 每个工具一张卡片：等宽字体工具名 + 参数个数 + 描述（折叠 3 行，完整文本在
 *    `title` 里）；参数按「名字 + 类型 + 必填/可选」一行徽标、说明另起一行，
 *    允许任意换行（长 URL / 长英文单词不撑破布局）；
 *  - 工具列表自身滚动（`max-height:min(46vh,420px)`），既不截断内容也不把
 *    表单按钮或详情字段顶出屏幕。
 */
function McpTestReport({ result }) {
    if (!result.ok)
        return _jsx("div", { className: "skp-error", children: result.errors.join("\n") });
    const parameterTotal = result.tools.reduce((sum, tool) => sum + toolParameters(tool).length, 0);
    const hasInstruction = typeof result.instruction === "string" && result.instruction.trim().length > 0;
    return (_jsxs("div", { className: "skp-test", children: [_jsxs("div", { className: "skp-test-head", children: [_jsx("span", { className: "skp-tag skp-tag-global", children: "\u8FDE\u63A5\u6B63\u5E38" }), _jsxs("span", { className: "skp-test-stat", children: [result.tools.length, " \u4E2A\u5DE5\u5177"] }), parameterTotal > 0 && _jsxs("span", { className: "skp-test-stat", children: [parameterTotal, " \u4E2A\u53C2\u6570"] }), _jsxs("span", { className: "skp-test-stat", children: ["\u8017\u65F6 ", result.elapsedMs, "ms"] })] }), hasInstruction && _jsx(McpInstruction, { text: result.instruction }), result.tools.length === 0 ? (_jsx("div", { className: "skp-note", children: "\u8FDE\u63A5\u6210\u529F\uFF0C\u4F46\u670D\u52A1\u5668\u672A\u66B4\u9732\u4EFB\u4F55\u5DE5\u5177\u3002" })) : (_jsx("div", { className: "skp-test-tools", children: result.tools.map((tool) => (_jsx(McpToolCard, { tool: tool }, tool.name))) }))] }));
}
/** 服务器提示（`instructions`）：默认折叠 3 行，点「展开/收起」切换。 */
function McpInstruction({ text }) {
    const [expanded, setExpanded] = useState(false);
    return (_jsxs("div", { className: "skp-test-instruction", children: [_jsxs("div", { className: "skp-test-instruction-head", children: [_jsx("span", { className: "skp-field-label", children: "\u670D\u52A1\u5668\u63D0\u793A" }), _jsx("button", { type: "button", className: "skp-link-btn", onClick: () => setExpanded((value) => !value), children: expanded ? "收起" : "展开" })] }), _jsx("p", { className: expanded ? "skp-test-instruction-body" : "skp-test-instruction-body skp-clamp-3", children: text })] }));
}
/** 单个工具卡片：名字 + 参数个数 + 描述 + 参数列表。 */
function McpToolCard({ tool }) {
    const parameters = toolParameters(tool);
    const description = typeof tool.description === "string" ? tool.description.trim() : "";
    return (_jsxs("section", { className: "skp-tool", children: [_jsxs("div", { className: "skp-tool-head", children: [_jsx("code", { className: "skp-tool-name", children: tool.name }), _jsx("span", { className: "skp-test-stat", children: parameters.length > 0 ? `${parameters.length} 个参数` : "无参数" })] }), description.length > 0 && (_jsx("p", { className: "skp-tool-desc skp-clamp-3", title: description, children: description })), parameters.length > 0 && (_jsx("ul", { className: "skp-params", children: parameters.map((parameter) => (_jsxs("li", { className: "skp-param", children: [_jsxs("div", { className: "skp-param-head", children: [_jsx("code", { className: "skp-param-name", children: parameter.name }), _jsx("span", { className: "skp-tag skp-tag-flat", children: parameter.type }), _jsx("span", { className: parameter.required ? "skp-tag skp-tag-warn" : "skp-tag skp-tag-flat", children: parameter.required ? "必填" : "可选" })] }), parameter.description !== undefined && parameter.description.trim().length > 0 && (_jsx("p", { className: "skp-param-desc", children: parameter.description }))] }, parameter.name))) }))] }));
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
