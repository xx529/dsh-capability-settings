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
import type {
  CapabilityPanelApi,
  ClientMcpServer,
  ClientMcpTool,
  ClientMcpRuntimeServer,
  ClientMcpUsageView,
  McpApi,
  McpTestResult,
  OpResult,
} from "./api.js";
import { summarizeEntry, transportOf, validateEntry } from "../mcp/entry-util.js";
import type { McpScope, McpServerEntry } from "../mcp/types.js";
import { Modal } from "./modal.js";
import { SkpSelect } from "./select.js";
import { hasWorkspaceLabel, useAsyncList, ZoneTabs, type PanelZone } from "./panel-common.js";
import { aggregateMounts, MOUNT_LABEL, type MountInfo } from "./mcp-common.js";

/** 复合行 id：同一个 key 可能同时存在于 project 与 global 两个作用域。 */
function rowId(server: Pick<ClientMcpServer, "scope" | "key">): string {
  return `${server.scope}:${server.key}`;
}

/**
 * 行圆点的 tooltip：以启用/禁用为主语义（与 Skills / 快捷消息同一套口径），
 * 挂载状态（未挂载 / 失败 / 冲突）作为补充说明收进同一句。
 */
function rowDotTitle(server: ClientMcpServer, mount: MountInfo | undefined): string {
  if (!server.enabled) return "已禁用（不挂载）";
  if (mount === undefined) return "已启用 · 未挂载到当前会话";
  return mount.error !== undefined ? `已启用 · ${MOUNT_LABEL[mount.state]}：${mount.error}` : `已启用 · ${MOUNT_LABEL[mount.state]}`;
}

/**
 * MCP 视图主组件：状态管理 + 拉取/重拉 + 列表 + 详情/表单。
 * 两区制：项目区条目可启停/编辑/删除；全局区条目只有「导入到本项目」/
 * 编辑/删除（导入 = 物理复制快照到 `<项目根>/.mcp.json`，项目内已有同名
 * 时两击确认覆盖；同名项目条目遮蔽全局条目）。
 */
export function McpView({ api, workspace }: { api: CapabilityPanelApi; workspace?: string }) {
  const mcpApi = api.mcp;
  const [opError, setOpError] = useState<string | undefined>(undefined);
  const [zone, setZone] = useState<PanelZone>("project");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | undefined>(undefined);
  /** 选中的「外部注入」实例（serverName）；与 selected 互斥。 */
  const [selectedExternalName, setSelectedExternalName] = useState<string | undefined>(undefined);
  // 编辑态：undefined = 空闲；非空 = 正在弹窗里编辑这条 server（McpEditDialog）。
  const [editServer, setEditServer] = useState<ClientMcpServer | undefined>(undefined);
  // 新增弹窗开关（表单 / JSON 两种模式见 McpAddDialog）。
  const [addOpen, setAddOpen] = useState(false);
  // 二次确认删除：记录"待确认的行 id"，再点一次才真正删除。
  const [confirmDelete, setConfirmDelete] = useState<string | undefined>(undefined);
  // 二次确认导入覆盖：项目内已有同名时记录"待确认的行 id"，再点一次带 overwrite。
  const [confirmImport, setConfirmImport] = useState<string | undefined>(undefined);

  /**
   * 拉取 list + status 并聚合成单一结果（挂载时、工作区变化时自动执行，
   * 写操作后显式 reload()）。挂载状态按 server.key 聚合：任一 session 已
   * 挂载即视为"已挂载"，全部未挂载时才取最差状态（见 mcp-common.ts）。
   */
  const { data, loading, error, reload } = useAsyncList(
    async () => {
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
    },
    [mcpApi, workspace],
  );
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
    if (settleTries.current >= 20) return;
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
    if (zone !== "global") return [];
    const q = query.trim().toLowerCase();
    return runtimeServers.filter(
      (server) =>
        q.length === 0 ||
        server.serverName.toLowerCase().includes(q) ||
        (server.source ?? "").toLowerCase().includes(q) ||
        (server.summary ?? "").toLowerCase().includes(q),
    );
  }, [runtimeServers, zone, query]);
  const selectedExternal =
    selectedExternalName === undefined ? undefined : runtimeServers.find((s) => s.serverName === selectedExternalName);
  const noWorkspace = !hasWorkspaceLabel(workspace);

  /** 执行一次写操作：失败写 opError；成功清错误并重拉列表。返回是否成功。 */
  const runOp = async (op: Promise<OpResult>): Promise<boolean> => {
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
  const onToggle = (server: ClientMcpServer) => {
    void runOp(mcpApi.setEnabled({ scope: server.scope, key: server.key, enabled: !server.enabled }));
  };

  /**
   * 导入这条**全局** server 到当前项目：物理复制到 `<项目根>/.mcp.json`
   * （快照语义——全局后续更新不回流；同名项目条目遮蔽全局）。项目内已有
   * 同名（未确认覆盖）时进入"确认覆盖"态，再次点击带 overwrite 覆盖项目
   * 副本。成功后重拉列表（切到项目区可见、可独立控制，宿主热重挂本项目
   * 的 session）。
   */
  const onImport = async (server: ClientMcpServer) => {
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
  const onDelete = (server: ClientMcpServer) => {
    const id = rowId(server);
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    setConfirmDelete(undefined);
    void runOp(mcpApi.remove({ scope: server.scope, key: server.key })).then((ok) => {
      if (ok) setSelected(undefined);
    });
  };

  return (
    <div className="skp-domain">
      <div className="skp-subheader">
        {/* 区 Tab：项目 / 全局。切换时清空选中与确认态，避免上个区的残留。 */}
        <ZoneTabs
          value={zone}
          onChange={(z) => {
            setZone(z);
            setSelected(undefined);
            setSelectedExternalName(undefined);
            setConfirmDelete(undefined);
            setConfirmImport(undefined);
          }}
        />
        <input
          className="skp-search"
          type="search"
          placeholder="搜索 MCP 服务器…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className="skp-btn skp-btn-primary"
          disabled={zone === "project" && noWorkspace}
          title={zone === "project" && noWorkspace ? "项目区需要可写的工作区才能添加" : undefined}
          onClick={() => {
            setEditServer(undefined);
            setSelected(undefined);
            setAddOpen(true);
          }}
        >
          + 添加{zone === "project" ? "到项目" : "到全局"}
        </button>
      </div>

      {/* 非致命错误行：列表读取问题 / 写操作失败提示。 */}
      {listErrors.length > 0 && <div className="skp-error">{listErrors.join("\n")}</div>}
      {opError && <div className="skp-error">{opError}</div>}
      {error && <div className="skp-error">{error}</div>}
      {loading && <div className="skp-status">加载中…</div>}

      {!loading && (
        <div className="skp-body">
          <ul className="skp-list">
            {visible.map((server) => {
              const id = rowId(server);
              const mount = mounts[server.key];
              return (
                <li key={id}>
                  <button
                    className={selected === id ? "skp-row skp-row-active" : "skp-row"}
                    onClick={() => {
                      setSelected(id);
                      setSelectedExternalName(undefined);
                      setEditServer(undefined);
                      setConfirmDelete(undefined);
                      setConfirmImport(undefined);
                    }}
                  >
                    <span className="skp-row-name">
                      {/* 状态圆点（仅项目区渲染——全局条目恒定可用、无启停状态，
                          与 skills 全局区同一口径）：绿=启用、灰=禁用；挂载异常
                          （失败/冲突/未挂载）用 meta 标签 + tooltip 表达。 */}
                      {zone === "project" && (
                        <span
                          className={`skp-dot ${server.enabled ? "skp-dot-enabled" : ""}`}
                          title={rowDotTitle(server, mount)}
                        />
                      )}
                      {server.key}
                      {/* 来源标记（需求：每个 MCP 名称旁标出来源）：全局 / 项目 / 引用 / 导入 */}
                      <span className={server.scope === "global" || server.reference === true ? "skp-tag skp-tag-flat" : "skp-tag skp-tag-directory"}>
                        {server.reference === true ? "引用" : server.importedFromGlobal === true ? "导入" : server.scope === "global" ? "全局" : "项目"}
                      </span>
                    </span>
                    <span className="skp-row-meta">
                      <span className="skp-tag skp-tag-flat">{server.transport}</span>
                      {!server.enabled && <span className="skp-tag skp-tag-readonly">已禁用</span>}
                      {/* 启用但挂载异常的实时信号：失败红 / 冲突橙（tooltip 里有详情）。 */}
                      {/* 还在后台重挂时，尚未拿到状态的条目显示「挂载中…」，
                          避免看起来像"未挂载"而误判失败。 */}
                      {server.enabled && mount === undefined && settling && <span className="skp-tag skp-tag-flat">挂载中…</span>}
                      {server.enabled && mount?.state === "failed" && <span className="skp-tag skp-tag-error">挂载失败</span>}
                      {server.enabled && mount?.state === "conflict" && <span className="skp-tag skp-tag-warn">冲突</span>}
                      {server.shadowed && <span className="skp-tag skp-tag-directory">被遮蔽</span>}
                    </span>
                    <span className="skp-row-desc">{server.summary}</span>
                  </button>
                </li>
              );
            })}
            {/* 外部注入的 MCP：与配置条目同列表展示，标「外部 · 来源」，只读。 */}
            {visibleExternal.map((server) => {
              const id = `external:${server.serverName}`;
              return (
                <li key={id}>
                  <button
                    className={selectedExternalName === server.serverName ? "skp-row skp-row-active" : "skp-row"}
                    onClick={() => {
                      setSelectedExternalName(server.serverName);
                      setSelected(undefined);
                      setEditServer(undefined);
                      setConfirmDelete(undefined);
                      setConfirmImport(undefined);
                    }}
                  >
                    <span className="skp-row-name">
                      {server.serverName}
                      <span className="skp-tag skp-tag-readonly">外部</span>
                      {server.source !== undefined && <span className="skp-tag skp-tag-flat">{server.source}</span>}
                      {server.disabledInProject === true && <span className="skp-tag skp-tag-warn">本项目已禁用</span>}
                    </span>
                    <span className="skp-row-meta">
                      {server.transport !== undefined && <span className="skp-tag skp-tag-flat">{server.transport}</span>}
                      <span className="skp-test-stat">{server.tools.length > 0 ? `${server.tools.length} 个工具` : "工具不可见"}</span>
                      {server.calls > 0 && <span className="skp-test-stat">调用 {server.calls} 次</span>}
                    </span>
                    <span className="skp-row-desc">{server.summary ?? "运行时注入，不由能力面板管理（只读）"}</span>
                  </button>
                </li>
              );
            })}
            {visible.length === 0 && visibleExternal.length === 0 && (
              <li className="skp-empty">
                {zone === "project"
                  ? "本项目还没有 MCP 服务器。可到「全局」区导入，或点「+ 添加到项目」。"
                  : "还没有全局 MCP 服务器。点「+ 添加到全局」添加。"}
              </li>
            )}
          </ul>

          <div className="skp-detail">
            {selectedExternal !== undefined ? (
              <McpExternalDetail api={mcpApi} server={selectedExternal} />
            ) : selectedServer ? (
              <McpDetail
                api={mcpApi}
                server={selectedServer}
                mount={mounts[selectedServer.key]}
                hasWorkspace={!noWorkspace}
                confirmingDelete={confirmDelete === rowId(selectedServer)}
                confirmingImport={confirmImport === rowId(selectedServer)}
                onEdit={() => setEditServer(selectedServer)}
                onToggle={() => onToggle(selectedServer)}
                onDelete={() => onDelete(selectedServer)}
                onImport={() => void onImport(selectedServer)}
              />
            ) : (
              <div className="skp-detail-empty">选择一个服务器查看详情，或新增一个。</div>
            )}
          </div>
        </div>
      )}

      {/* 新增弹窗：表单 / JSON 两种模式（与技能安装弹窗同构；默认作用域跟随当前区）。 */}
      {addOpen && (
        <McpAddDialog
          api={mcpApi}
          servers={servers}
          workspace={workspace}
          defaultScope={zone}
          onClose={() => setAddOpen(false)}
          onMutated={() => reload()}
        />
      )}
      {/* 编辑弹窗：与新增同款外壳（Modal + 内嵌表单）。 */}
      {editServer !== undefined && (
        <McpEditDialog
          api={mcpApi}
          server={editServer}
          workspace={workspace}
          onClose={() => setEditServer(undefined)}
          onSaved={() => reload()}
        />
      )}
    </div>
  );
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
function McpUsageSection({ api, serverName }: { api: McpApi; serverName: string }) {
  const [view, setView] = useState<ClientMcpUsageView | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        const next = await api.usage({ serverName });
        if (cancelled) return;
        setView(next);
        setError(undefined);
      } catch (err) {
        if (cancelled) return;
        setError(String(err));
      }
      if (!cancelled) timer = window.setTimeout(() => void load(), 2000);
    };
    void load();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [api, serverName]);
  return (
    <>
      <div className="skp-detail-inspect-head">
        <span className="skp-field-label">使用记录</span>
        <span className="skp-test-stat">仅本次运行 · 不落盘{view === undefined ? "" : ` · 最近 ${view.limit} 条`}</span>
      </div>
      {error !== undefined && <div className="skp-error">{error}</div>}
      {view === undefined ? (
        <div className="skp-note">读取中…</div>
      ) : view.entries.length === 0 ? (
        <div className="skp-note">本次运行还没有调用记录。</div>
      ) : (
        <ul className="skp-usage">
          {/* 最新在上 */}
          {view.entries
            .slice()
            .reverse()
            .map((entry, index) => (
              <li key={`${entry.time}-${entry.tool}-${index}`} className="skp-usage-row">
                <span className="skp-usage-time" title={new Date(entry.time).toLocaleString()}>
                  {formatUsageTime(entry.time)}
                </span>
                <span className="skp-usage-session" title={entry.sessionId === "" ? undefined : entry.sessionId}>
                  {entry.sessionTitle ?? (entry.sessionId.length > 0 ? `会话 ${entry.sessionId.slice(-8)}` : "—")}
                </span>
                <code className="skp-usage-tool" title={entry.serverName}>
                  {entry.tool}
                </code>
              </li>
            ))}
        </ul>
      )}
    </>
  );
}

/**
 * 「外部注入」MCP 的**只读**详情。
 *
 * 这些实例不在本插件配置文件里（其它插件/profile 在运行时挂的 mcp-client），所以
 * 只展示能观察到的信息：来源插件、注入方式、命名空间、传输/命令摘要（能读到才有）、
 * 每个工具的**说明与参数**（与「查看工具与参数」同源：来自工具注册表），以及使用记录。
 * 不提供编辑/删除/测试——配置与生命周期都在注入方。
 */
function McpExternalDetail({ api, server }: { api: McpApi; server: ClientMcpRuntimeServer }) {
  return (
    <div className="skp-detail-card">
      <div className="skp-detail-head">
        <h3>{server.serverName}</h3>
        <span className="skp-tag skp-tag-readonly">外部注入</span>
      </div>
      <dl className="skp-detail-fields">
        <dt>来源</dt>
        <dd>{server.source ?? "运行时注入（来源不可识别）"}</dd>
        <dt>注入方式</dt>
        <dd>{server.origin === "entry" ? "loader 条目（profile patch insert）" : "动态 fiber（其它插件在 apply 中挂载）"}</dd>
        <dt>命名空间</dt>
        <dd>
          <code>mcp__{server.serverName}__*</code>
        </dd>
        {server.transport !== undefined && (
          <>
            <dt>传输方式</dt>
            <dd>
              {server.transport}
              {server.summary !== undefined ? ` · ${server.summary}` : ""}
            </dd>
          </>
        )}
        <dt>本项目开关</dt>
        <dd>
          {server.restrictable
            ? "可在对话框的 MCP 弹层里按项目启用/禁用（走项目级声明 + tools.restrict 屏蔽，不卸载实例）。"
            : "该实例按会话作用域注入，无法按项目禁用。"}
          {server.disabledInProject === true ? "当前：本项目已禁用。" : ""}
        </dd>
        <dt>本次运行调用</dt>
        <dd>{server.calls > 0 ? `${server.calls} 次` : "还没有调用记录"}</dd>
        <dt>管理</dt>
        <dd>由注入方管理；能力面板只读展示，不提供编辑/删除/卸载。</dd>
      </dl>
      <div className="skp-detail-inspect">
        <div className="skp-detail-inspect-head">
          <span className="skp-field-label">工具与参数</span>
          <span className="skp-test-stat">{server.tools.length} 个工具</span>
        </div>
        {server.tools.length === 0 ? (
          <div className="skp-note">工具清单不可见（该实例按会话作用域注入，只能统计调用次数）。</div>
        ) : (
          <div className="skp-test-tools">
            {server.tools.map((tool) => (
              <McpToolCard key={tool.name} tool={{ name: tool.name, ...(tool.description !== undefined ? { description: tool.description } : {}), ...(tool.parameters !== undefined ? { parameters: tool.parameters } : {}) }} />
            ))}
          </div>
        )}
      </div>
      <div className="skp-detail-inspect">
        <McpUsageSection api={api} serverName={server.serverName} />
      </div>
    </div>
  );
}

function McpDetail({
  api,
  server,
  mount,
  hasWorkspace,
  confirmingDelete,
  confirmingImport,
  onEdit,
  onToggle,
  onDelete,
  onImport,
}: {
  /** 面板 API：详情页的「查看工具与参数」直接复用 `mcp.test` 探测通道。 */
  api: McpApi;
  server: ClientMcpServer;
  mount?: MountInfo;
  /** 面板是否附着在可写工作区上（全局条目的「导入到本项目」需要 cwd）。 */
  hasWorkspace: boolean;
  confirmingDelete: boolean;
  confirmingImport: boolean;
  onEdit(): void;
  onToggle(): void;
  onDelete(): void;
  onImport(): void;
}) {
  const isGlobal = server.scope === "global";
  /** 项目区里来自全局导入的副本（条目带导入标记）：徽标按"出身"标「全局」。 */
  const imported = !isGlobal && server.importedFromGlobal === true;
  /** 项目级引用（内容跟随全局，启停是项目级标记；不提供「编辑」）。 */
  const isReference = server.reference === true;
  /** 移除按钮文案：全局导入的副本 = 「移出」（全局原版仍在全局区）；其余 = 「删除」。 */
  const removeVerb = imported ? "移出" : "删除";
  // 「查看工具与参数」：真连一次该条目（零副作用探测），就地展开描述 + 工具 + 参数。
  const [inspect, setInspect] = useState<{ open: boolean; testing: boolean; result?: McpTestResult }>({
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
    } catch (error) {
      setInspect({ open: true, testing: false, result: { ok: false, errors: [String(error)] } });
    }
  };
  return (
    <div className="skp-detail-card">
      {/* 头部：标题 + 归属徽标。徽标按"出身"显示：与全局同源的项目区条目
          （引用 / 旧版导入副本）也标「全局」（绿）；被项目级同名条目遮蔽的
          全局条目在 tooltip 里说明。 */}
      <div className="skp-detail-head">
        <h3>{server.key}</h3>
        <span
          className={isGlobal || imported ? "skp-tag skp-tag-global" : "skp-tag skp-tag-project"}
          title={
            isGlobal
              ? server.shadowed
                ? "全局服务器（对所有项目生效）；当前被本项目内的同名条目遮蔽"
                : "全局服务器（对所有项目生效）"
              : isReference
                ? "本项目内对全局服务器的引用（内容跟随全局，启停只作用于本项目）"
                : imported
                  ? "本项目内来自全局导入的副本（遮蔽全局同名条目，控制只作用于本项目）"
                  : "本项目内的服务器（遮蔽全局同名条目）"
          }
        >
          {isGlobal || imported ? "全局" : "项目"}
        </span>
      </div>
      <div className="skp-detail-actions">
        {/* 启用/禁用只对**项目区**条目渲染：全局条目不在面板里启停
            （全局配置里的 disabled 标记仍可在编辑弹窗里调整）。 */}
        {!isGlobal && (
          <button
            type="button"
            className={`skp-btn ${server.enabled ? "skp-state-on" : "skp-state-off"}`}
            title={
              isReference
                ? server.enabled
                  ? "点击在本项目禁用该引用（本项目不再挂载，全局配置不变）"
                  : "点击在本项目启用该引用（全局配置不变）"
                : server.enabled
                  ? "点击禁用（保留在配置文件中，不挂载）"
                  : "点击启用（写入配置文件并挂载）"
            }
            onClick={onToggle}
          >
            {server.enabled ? "已启用" : "已禁用"}
          </button>
        )}
        {/* 全局区禁用恢复：全局条目自身 disabled（旧数据）时给一个直接的
            恢复入口（对所有项目生效）。启用态的全局条目不提供禁用——
            项目级停用走「导入到本项目」后的引用启停。 */}
        {isGlobal && !server.enabled && (
          <button
            type="button"
            className="skp-btn skp-state-off"
            title="此全局服务器当前为禁用状态；点击恢复启用（对所有项目生效）"
            onClick={onToggle}
          >
            已禁用
          </button>
        )}
        {/* 导入到本项目：只对有工作区的全局条目渲染。登记项目级引用，
            已有同名引用时进入"确认"态（二次点击幂等重导入）。 */}
        {isGlobal && hasWorkspace && (
          <button
            type="button"
            className={confirmingImport ? "skp-btn skp-btn-danger" : "skp-btn"}
            title={
              confirmingImport
                ? "项目内已有同名引用，再次点击将重新登记（保留原启停状态，全局配置不变）"
                : "在本项目登记对全局服务器的引用（内容跟随全局，可在本项目启停）"
            }
            onClick={onImport}
          >
            {confirmingImport ? "确认重复导入同名引用？" : "导入到本项目"}
          </button>
        )}
        {/* 引用条目不提供「编辑」（内容就是全局条目，请到全局区编辑）。 */}
        {!isReference && (
          <button type="button" className="skp-btn" onClick={onEdit}>
            编辑
          </button>
        )}
        {/* 查看工具与参数：不必进编辑弹窗，详情页直接真连一次并列出描述/工具/参数
            （零副作用探测：不落盘、不注册工具、不影响已挂载连接）。 */}
        <button
          type="button"
          className="skp-btn"
          disabled={inspect.testing}
          title={
            inspect.open
              ? "收起工具与参数"
              : "真连一次该服务器并列出它的描述、工具与参数（不落盘、不注册工具、不影响已挂载的连接）"
          }
          onClick={() => {
            if (inspect.open) setInspect({ open: false, testing: false });
            else void runInspect();
          }}
        >
          {inspect.testing ? "连接中…" : inspect.open ? "收起工具列表" : "查看工具与参数"}
        </button>
        {/* 使用记录：最近谁（哪个 session）在什么时候调用了这个 server 的哪个 tool。
            数据只在宿主内存里，插件/进程重载即清空——纯只读，不落盘。 */}
        <button
          type="button"
          className="skp-btn"
          title="查看最近哪个会话在什么时候调用了这个 MCP 的哪个工具（仅本次运行的内存记录，不落盘）"
          onClick={() => setUsageOpen((open) => !open)}
        >
          {usageOpen ? "收起使用记录" : "使用记录"}
        </button>
        {/* 二次确认：confirmingDelete 时按钮变红并显示确认文案。 */}
        <button
          type="button"
          className={confirmingDelete ? "skp-btn skp-btn-danger" : "skp-btn skp-btn-danger-ghost"}
          title={
            isGlobal
              ? "删除此全局服务器；各项目内的引用不受影响（变为悬空引用）"
              : isReference
                ? "移出本项目（移除对全局服务器的引用，全局原版仍在全局区）"
                : imported
                  ? "移出本项目（移除全局导入的副本，全局原版仍在全局区）"
                  : "删除本项目中的这个服务器"
          }
          onClick={onDelete}
        >
          {confirmingDelete ? `确认${removeVerb}？` : removeVerb}
        </button>
      </div>
      <dl className="skp-detail-fields">
        <dt>命名空间</dt>
        <dd>mcp__{server.serverName}__*</dd>
        {/* 按传输方式展示不同字段：stdio 显示命令与参数，http 显示 URL。 */}
        {server.transport === "stdio" ? (
          <>
            <dt>命令</dt>
            <dd className="skp-path">{server.entry.command}</dd>
            {(server.entry.args ?? []).length > 0 && (
              <>
                <dt>参数</dt>
                <dd className="skp-path">{(server.entry.args ?? []).join(" ")}</dd>
              </>
            )}
          </>
        ) : (
          <>
            <dt>URL</dt>
            <dd className="skp-path">{server.entry.url}</dd>
          </>
        )}
        <dt>配置文件</dt>
        <dd className="skp-path">{server.filePath}</dd>
        <dt>状态</dt>
        <dd>{mount === undefined ? "未挂载到当前会话" : MOUNT_LABEL[mount.state]}</dd>
        {mount?.error !== undefined && (
          <>
            <dt>错误</dt>
            <dd className="skp-path">{mount.error}</dd>
          </>
        )}
      </dl>
      {/* 「查看工具与参数」的结果：与上方字段用分隔线隔开，报告自身滚动，
          不会把详情页顶长到看不见操作按钮。 */}
      {usageOpen && (
        <div className="skp-detail-inspect">
          <McpUsageSection api={api} serverName={server.serverName} />
        </div>
      )}
      {inspect.open && (
        <div className="skp-detail-inspect">
          <div className="skp-detail-inspect-head">
            <span className="skp-field-label">工具与参数</span>
            <button type="button" className="skp-link-btn" disabled={inspect.testing} onClick={() => void runInspect()}>
              {inspect.testing ? "连接中…" : "重新测试"}
            </button>
          </div>
          {inspect.result === undefined ? (
            <div className="skp-note">正在连接并读取工具清单…</div>
          ) : (
            <McpTestReport result={inspect.result} />
          )}
        </div>
      )}
    </div>
  );
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
function McpForm({
  api,
  mode,
  server,
  workspace,
  embedded,
  actionsClass = "skp-detail-actions",
  defaultScope,
  onCancel,
  onSave,
}: {
  api: McpApi;
  mode: "new" | "edit";
  server?: ClientMcpServer;
  workspace?: string;
  /** 内嵌到弹窗：去掉卡片外壳与自带标题，直接渲染字段。 */
  embedded?: boolean;
  /** 按钮行容器类；弹窗内传 `skp-modal-actions`（右对齐）。 */
  actionsClass?: string;
  /** 新增态的初始作用域（跟随面板当前区；缺省按有无工作区推导）。 */
  defaultScope?: McpScope;
  onCancel(): void;
  onSave(scope: McpScope, key: string, entry: McpServerEntry): Promise<void>;
}) {
  // 编辑态用现有条目回填；新增态从空对象起步。
  const entry = server?.entry ?? {};
  const [scope, setScope] = useState<McpScope>(server?.scope ?? defaultScope ?? (workspace !== undefined ? "project" : "global"));
  const [key, setKey] = useState(server?.key ?? "");
  const [transport, setTransport] = useState<"stdio" | "http">(server?.transport ?? "stdio");
  const [command, setCommand] = useState(entry.command ?? "");
  const [args, setArgs] = useState((entry.args ?? []).join("\n"));
  const [env, setEnv] = useState(recordToLines(entry.env));
  const [url, setUrl] = useState(entry.url ?? "");
  const [headers, setHeaders] = useState(recordToLines(entry.headers));
  const [timeoutMs, setTimeoutMs] = useState(entry.timeoutMs !== undefined ? String(entry.timeoutMs) : "");
  const [disabled, setDisabled] = useState(entry.disabled === true);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  // 「测试连接」：结果（成功含工具清单 / 失败含错误文案）与进行中标志。
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<McpTestResult | undefined>(undefined);

  const isNew = mode === "new";
  // 没有工作区时不能创建项目级条目（占位标签口径收敛在 panel-common.hasWorkspaceLabel）。
  const noWorkspace = !hasWorkspaceLabel(workspace);

  /**
   * 从当前表单值构建条目（保存与测试共用同一口径，避免"能测不能存"漂移）。
   * 有校验问题时返回问题列表；测试与保存都直接展示这些问题。
   */
  const buildEntry = (): { ok: true; entry: McpServerEntry } | { ok: false; problems: string[] } => {
    const problems: string[] = [];
    if (key.trim().length === 0) problems.push("名称不能为空");
    if (transport === "stdio" && command.trim().length === 0) problems.push('stdio 服务器需要填写「命令」');
    if (transport === "http" && url.trim().length === 0) problems.push('http 服务器需要填写「URL」');
    const envRecord = linesToRecord(env, "env", problems);
    const headerRecord = linesToRecord(headers, "headers", problems);
    const timeout = timeoutMs.trim().length === 0 ? undefined : Number(timeoutMs);
    if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) problems.push("超时必须是正数（ms）");
    if (problems.length > 0) return { ok: false, problems };
    // 只把"有内容的可选字段"写进条目，保持配置文件最小化。
    // 「全局导入」标记随编辑保留（改字段不抹掉"来自全局导入"的身份）。
    const importMarker = entry.importedFromGlobal === true ? { importedFromGlobal: true as const } : {};
    const next: McpServerEntry =
      transport === "stdio"
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
    } catch (error) {
      // 宿主校验 / 落盘失败：把错误展示在表单顶部（编辑态此前走面板级
      // opError，新增态弹窗内没有该通道，统一收敛到表单内）。
      setErrors([error instanceof Error ? error.message : String(error)]);
    } finally {
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
    } catch (error) {
      // 传输层异常（RPC 断线等）：按失败结果展示，不冒泡到渲染层。
      setTestResult({ ok: false, errors: [error instanceof Error ? error.message : String(error)] });
    } finally {
      setTesting(false);
    }
  };

  const busy = saving || testing;

  return (
    <div className={embedded ? undefined : "skp-detail-card"}>
      {!embedded && <h3>{isNew ? "添加 MCP 服务器" : `编辑 ${server?.key}`}</h3>}
      {errors.length > 0 && <div className="skp-error">{errors.join("\n")}</div>}
      <div className="skp-form">
        <label className="skp-field">
          <span className="skp-field-label">作用域</span>
          <SkpSelect
            value={scope}
            disabled={!isNew}
            ariaLabel="服务器作用域"
            options={[
              // 无工作区时禁用项目选项（项目作用域需要 cwd）。
              { value: "project", label: "项目（.mcp.json）", disabled: noWorkspace },
              { value: "global", label: "全局（~/.agents/mcp.json）" },
            ]}
            onChange={(value) => setScope(value === "project" ? "project" : "global")}
          />
        </label>
        <label className="skp-field">
          <span className="skp-field-label">名称</span>
          <input className="skp-input" value={key} disabled={!isNew} placeholder="github" onChange={(e) => setKey(e.target.value)} />
        </label>
        <label className="skp-field">
          <span className="skp-field-label">传输方式</span>
          <SkpSelect
            value={transport}
            ariaLabel="传输方式"
            options={[
              { value: "stdio", label: "stdio（启动本地命令）" },
              { value: "http", label: "http（流式 HTTP 端点）" },
            ]}
            onChange={(value) => setTransport(value === "http" ? "http" : "stdio")}
          />
        </label>
        {/* 按传输方式渲染对应字段：stdio → command/args/env；http → url/headers。 */}
        {transport === "stdio" ? (
          <>
            <label className="skp-field">
              <span className="skp-field-label">命令</span>
              <input className="skp-input" value={command} placeholder="npx" onChange={(e) => setCommand(e.target.value)} />
            </label>
            <label className="skp-field">
              <span className="skp-field-label">参数（每行一个）</span>
              <textarea className="skp-input skp-textarea" value={args} placeholder={"-y\n@modelcontextprotocol/server-github"} onChange={(e) => setArgs(e.target.value)} />
            </label>
            <label className="skp-field">
              <span className="skp-field-label">环境变量（每行 KEY=VALUE，支持 ${"${VAR}"}）</span>
              <textarea className="skp-input skp-textarea" value={env} placeholder={"GITHUB_TOKEN=${GITHUB_TOKEN}"} onChange={(e) => setEnv(e.target.value)} />
            </label>
          </>
        ) : (
          <>
            <label className="skp-field">
              <span className="skp-field-label">URL</span>
              <input className="skp-input" value={url} placeholder="http://localhost:3000/mcp" onChange={(e) => setUrl(e.target.value)} />
            </label>
            <label className="skp-field">
              <span className="skp-field-label">请求头（每行 KEY=VALUE）</span>
              <textarea className="skp-input skp-textarea" value={headers} onChange={(e) => setHeaders(e.target.value)} />
            </label>
          </>
        )}
        <label className="skp-field">
          <span className="skp-field-label">工具调用超时（ms，可选）</span>
          <input className="skp-input" value={timeoutMs} inputMode="numeric" placeholder="60000" onChange={(e) => setTimeoutMs(e.target.value)} />
        </label>
        <label className="skp-field skp-field-inline">
          <input type="checkbox" checked={disabled} onChange={(e) => setDisabled(e.target.checked)} />
          <span>禁用（保留在配置文件中，不挂载）</span>
        </label>
        {/* 测试结果：成功给出工具名 + 参数（名字/类型/是否必填/说明），
            失败给出宿主侧的中文错误文案（含原始错误 / stderr 摘要）。 */}
        {testing && <div className="skp-status">正在连接并读取工具列表…</div>}
        {testResult !== undefined && <McpTestReport result={testResult} />}
        <div className={actionsClass}>
          {/* 「测试连接」= 次级按钮，与保存同级：用当前表单草稿真实连一次
              （不落盘、不挂载），成功/失败都在表单内就地展示。 */}
          <button
            type="button"
            className="skp-btn"
            disabled={busy}
            title="用当前表单内容真实连接一次（不保存、不挂载），列出该服务器的工具与参数"
            onClick={() => void runTest()}
          >
            {testing ? "测试中…" : "测试连接"}
          </button>
          <button type="button" className="skp-btn skp-btn-primary" disabled={busy} onClick={() => void submit()}>
            {saving ? (isNew ? "添加中…" : "保存中…") : isNew ? "添加" : "保存"}
          </button>
          <button type="button" className="skp-btn" onClick={onCancel}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 「测试连接」结果展示
// ---------------------------------------------------------------------------

/** 面板渲染用的一条工具参数（从 inputSchema 展开）。 */
interface ToolParameter {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

/**
 * 使用记录的时间列：当天只显示 `HH:mm:ss`，跨天补上 `MM-DD `（避免不同日期的
 * 记录看起来一样）。时间来自宿主 `Date.now()`，客户端本地时区格式化。
 */
function formatUsageTime(time: number): string {
  if (!Number.isFinite(time) || time <= 0) return "—";
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, "0");
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
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
function McpTestReport({ result }: { result: McpTestResult }) {
  if (!result.ok) return <div className="skp-error">{result.errors.join("\n")}</div>;
  const parameterTotal = result.tools.reduce((sum, tool) => sum + toolParameters(tool).length, 0);
  const hasInstruction = typeof result.instruction === "string" && result.instruction.trim().length > 0;
  return (
    <div className="skp-test">
      <div className="skp-test-head">
        <span className="skp-tag skp-tag-global">连接正常</span>
        <span className="skp-test-stat">{result.tools.length} 个工具</span>
        {parameterTotal > 0 && <span className="skp-test-stat">{parameterTotal} 个参数</span>}
        <span className="skp-test-stat">耗时 {result.elapsedMs}ms</span>
      </div>
      {hasInstruction && <McpInstruction text={result.instruction as string} />}
      {result.tools.length === 0 ? (
        <div className="skp-note">连接成功，但服务器未暴露任何工具。</div>
      ) : (
        <div className="skp-test-tools">
          {result.tools.map((tool) => (
            <McpToolCard key={tool.name} tool={tool} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 服务器提示（`instructions`）：默认折叠 3 行，点「展开/收起」切换。 */
function McpInstruction({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="skp-test-instruction">
      <div className="skp-test-instruction-head">
        <span className="skp-field-label">服务器提示</span>
        <button type="button" className="skp-link-btn" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "收起" : "展开"}
        </button>
      </div>
      <p className={expanded ? "skp-test-instruction-body" : "skp-test-instruction-body skp-clamp-3"}>{text}</p>
    </div>
  );
}

/** 单个工具卡片：名字 + 参数个数 + 描述 + 参数列表。 */
function McpToolCard({ tool }: { tool: ClientMcpTool }) {
  const parameters = toolParameters(tool);
  const description = typeof tool.description === "string" ? tool.description.trim() : "";
  return (
    <section className="skp-tool">
      <div className="skp-tool-head">
        <code className="skp-tool-name">{tool.name}</code>
        <span className="skp-test-stat">{parameters.length > 0 ? `${parameters.length} 个参数` : "无参数"}</span>
      </div>
      {description.length > 0 && (
        <p className="skp-tool-desc skp-clamp-3" title={description}>
          {description}
        </p>
      )}
      {parameters.length > 0 && (
        <ul className="skp-params">
          {parameters.map((parameter) => (
            <li key={parameter.name} className="skp-param">
              <div className="skp-param-head">
                <code className="skp-param-name">{parameter.name}</code>
                <span className="skp-tag skp-tag-flat">{parameter.type}</span>
                <span className={parameter.required ? "skp-tag skp-tag-warn" : "skp-tag skp-tag-flat"}>
                  {parameter.required ? "必填" : "可选"}
                </span>
              </div>
              {parameter.description !== undefined && parameter.description.trim().length > 0 && (
                <p className="skp-param-desc">{parameter.description}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 从工具的 `inputSchema` 展开参数（`properties` + `required`）。 */
function toolParameters(tool: ClientMcpTool): ToolParameter[] {
  const schema = tool.parameters;
  if (schema === undefined || schema === null) return [];
  const properties = schema.properties;
  if (properties === null || typeof properties !== "object" || Array.isArray(properties)) return [];
  const required = Array.isArray(schema.required) ? schema.required.filter((name): name is string => typeof name === "string") : [];
  return Object.entries(properties as Record<string, unknown>).map(([name, raw]) => {
    const property = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
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
function schemaType(property: Record<string, unknown>): string {
  const type = property.type;
  if (typeof type === "string") return type;
  if (Array.isArray(type)) {
    const parts = type.filter((part): part is string => typeof part === "string");
    if (parts.length > 0) return parts.join(" | ");
  }
  if (Array.isArray(property.enum)) return "enum";
  if (property.anyOf !== undefined || property.oneOf !== undefined) return "union";
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
function McpAddDialog({
  api,
  servers,
  workspace,
  defaultScope,
  onClose,
  onMutated,
}: {
  api: McpApi;
  servers: ClientMcpServer[];
  workspace?: string;
  /** 初始作用域（跟随面板当前区）。 */
  defaultScope?: McpScope;
  onClose(): void;
  /** 任意写操作成功后刷新列表（不关闭弹窗）。 */
  onMutated(): void;
}) {
  const [tab, setTab] = useState<"form" | "json">("form");

  return (
    <Modal title="添加 MCP 服务器" onClose={onClose}>
      <div className="skp-tabs" role="tablist">
        {(["form", "json"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? "skp-tab skp-tab-active" : "skp-tab"}
            onClick={() => setTab(t)}
          >
            {t === "form" ? "表单" : "JSON"}
          </button>
        ))}
      </div>
      {/* 两个子面板常驻挂载：切 Tab 不丢已填内容。 */}
      <div hidden={tab !== "form"}>
        <McpForm
          api={api}
          mode="new"
          workspace={workspace}
          embedded
          actionsClass="skp-modal-actions"
          defaultScope={defaultScope}
          onCancel={onClose}
          onSave={async (scope, key, entry) => {
            const result = await api.upsert({ scope, key, entry });
            if (!result.ok) throw new Error(result.errors.join("; "));
            onMutated();
            onClose();
          }}
        />
      </div>
      <div hidden={tab !== "json"}>
        <McpJsonImport api={api} servers={servers} workspace={workspace} defaultScope={defaultScope} onClose={onClose} onMutated={onMutated} />
      </div>
    </Modal>
  );
}

/**
 * 编辑 MCP 服务器弹窗：与新增同款外壳（Modal + 内嵌 McpForm）。
 * 只含表单（JSON 批量导入只属于新增场景）；scope 与 name 在编辑态锁定
 * （改名 = 删除后重建，沿用 McpForm 的禁用态规避）。
 */
function McpEditDialog({
  api,
  server,
  workspace,
  onClose,
  onSaved,
}: {
  api: McpApi;
  server: ClientMcpServer;
  workspace?: string;
  onClose(): void;
  /** 保存成功后刷新列表（不关闭弹窗）。 */
  onSaved(): void;
}) {
  return (
    <Modal title={`编辑 ${server.key}`} onClose={onClose}>
      <McpForm
        api={api}
        mode="edit"
        server={server}
        workspace={workspace}
        embedded
        actionsClass="skp-modal-actions"
        onCancel={onClose}
        onSave={async (scope, key, entry) => {
          const result = await api.upsert({ scope, key, entry });
          if (!result.ok) throw new Error(result.errors.join("; "));
          onSaved();
          onClose();
        }}
      />
    </Modal>
  );
}

/** parseMcpJson 解析出的单个条目（键 + 原始条目）。 */
type ParsedMcpEntry = { key: string; entry: McpServerEntry };

/**
 * 解析"添加 MCP 服务器"的 JSON 文本为条目清单。
 *
 * 接受两种形状：
 *   - 完整配置文件：`{ "mcpServers": { … } }`（可直接粘贴 .mcp.json）；
 *   - 裸映射：`{ "github": { … }, "web": { … } }`。
 * 顶层必须是对象；逐条用与宿主同口径的 validateEntry 校验
 * （见 mcp/entry-util.ts），任一非法条目都会整体返回错误与逐条原因。
 */
function parseMcpJson(text: string): { ok: true; entries: ParsedMcpEntry[] } | { ok: false; errors: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`] };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, errors: ['JSON 顶层必须是对象，例如 { "mcpServers": { … } } 或 { "服务器名": { … } }'] };
  }
  const root = data as Record<string, unknown>;
  // 裸映射的每个值都不是对象 → 更像"单条条目缺名称键"，给出明确提示。
  if (Object.keys(root).length > 0 && Object.values(root).every((v) => v === null || typeof v !== "object" || Array.isArray(v))) {
    return { ok: false, errors: ['看起来是单条服务器条目，缺少名称键；请用 { "服务器名": { … } } 包裹。'] };
  }
  // 完整配置文件取 mcpServers 键；否则把顶层本身当服务器映射。
  let servers: unknown;
  if (typeof root.mcpServers === "object" && root.mcpServers !== null && !Array.isArray(root.mcpServers)) {
    servers = root.mcpServers;
  } else if ("mcpServers" in root && Object.keys(root).length === 1) {
    return { ok: false, errors: ['「mcpServers」必须是服务器对象映射。'] };
  } else {
    servers = root;
  }
  const entries: ParsedMcpEntry[] = [];
  const problems: string[] = [];
  for (const [key, value] of Object.entries(servers as Record<string, unknown>)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      problems.push(`${key}: 条目必须是对象`);
      continue;
    }
    const entry = value as McpServerEntry;
    const entryProblems = validateEntry(key, entry);
    if (entryProblems.length > 0) {
      problems.push(`${key}: ${entryProblems.join("; ")}`);
      continue;
    }
    entries.push({ key, entry });
  }
  if (problems.length > 0) return { ok: false, errors: problems };
  if (entries.length === 0) return { ok: false, errors: ["没有可添加的服务器条目。"] };
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
function McpJsonImport({
  api,
  servers,
  workspace,
  defaultScope,
  onClose,
  onMutated,
}: {
  api: McpApi;
  servers: ClientMcpServer[];
  workspace?: string;
  /** 初始目标作用域（跟随面板当前区）。 */
  defaultScope?: McpScope;
  onClose(): void;
  onMutated(): void;
}) {
  // 没有工作区时不能创建项目级条目（占位标签口径收敛在 panel-common.hasWorkspaceLabel）。
  const noWorkspace = !hasWorkspaceLabel(workspace);
  const [text, setText] = useState("");
  const [scope, setScope] = useState<McpScope>(defaultScope ?? (noWorkspace ? "global" : "project"));
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [opErrors, setOpErrors] = useState<string[]>([]);

  // 实时解析：文本一变预览区就刷新（整体非法时展示解析错误）。
  const parse = useMemo(() => parseMcpJson(text), [text]);

  // 预览行：标注每条的状态（将新增 / 将覆盖 / 已存在跳过），供确认与冲突提示。
  const preview = useMemo(() => {
    if (!parse.ok) return undefined;
    return parse.entries.map(({ key, entry }) => {
      const exists = servers.some((s) => s.scope === scope && s.key === key);
      return { key, entry, exists, overwriting: exists && overwrite, skipped: exists && !overwrite };
    });
  }, [parse, servers, scope, overwrite]);

  const addable = preview?.filter((item) => !item.skipped) ?? [];

  const doAdd = async () => {
    setBusy(true);
    setOpErrors([]);
    const failures: string[] = [];
    let added = 0;
    for (const { key, entry } of addable) {
      const result = await api.upsert({ scope, key, entry });
      if (result.ok) added += 1;
      else failures.push(`${key}: ${result.errors.join("; ")}`);
    }
    onMutated(); // 已写入的部分先刷新列表与冲突检测
    if (failures.length > 0) {
      setOpErrors([`已添加 ${added} 个，失败 ${failures.length} 个：`, ...failures]);
      setBusy(false);
      return;
    }
    onClose();
  };

  return (
    <div className="skp-form">
      <label className="skp-field">
        <span className="skp-field-label">JSON 配置</span>
        <textarea
          className="skp-input skp-textarea skp-json-field"
          value={text}
          spellCheck={false}
          placeholder={JSON_PLACEHOLDER}
          onChange={(e) => {
            setText(e.target.value);
            setOpErrors([]);
          }}
        />
        <span className="skp-note">支持完整 .mcp.json（含 mcpServers 键），或直接粘贴 {`{ "服务器名": { … } }`} 映射。</span>
      </label>

      {!parse.ok && text.trim().length > 0 && <div className="skp-error">{parse.errors.join("\n")}</div>}

      {preview !== undefined && preview.length > 0 && (
        <div className="skp-field">
          <span className="skp-field-label">将添加 {addable.length}/{preview.length} 个</span>
          <ul className="skp-import-list">
            {preview.map(({ key, entry, overwriting, skipped }) => (
              <li key={key} className="skp-import-item">
                <span className="skp-import-name">{key}</span>
                <span className="skp-tag skp-tag-flat">{transportOf(entry)}</span>
                <span className="skp-import-desc">{summarizeEntry(entry)}</span>
                <span className={`skp-import-note ${overwriting ? "skp-import-note-over" : skipped ? "skp-import-note-skip" : "skp-import-note-add"}`}>
                  {overwriting ? "将覆盖" : skipped ? "已存在，跳过" : "将新增"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="skp-field">
        <span className="skp-field-label">添加到</span>
        <SkpSelect
          value={scope}
          ariaLabel="添加目标作用域"
          options={[
            // 无工作区时禁用项目选项（项目作用域需要 cwd）。
            { value: "project", label: "项目（.mcp.json）", disabled: noWorkspace },
            { value: "global", label: "全局（~/.agents/mcp.json）" },
          ]}
          onChange={(value) => setScope(value === "project" ? "project" : "global")}
        />
      </div>

      <label className="skp-field skp-field-inline">
        <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
        同名服务器已存在时覆盖
      </label>

      {opErrors.length > 0 && <div className="skp-error">{opErrors.join("\n")}</div>}

      <div className="skp-modal-actions">
        <button type="button" className="skp-btn" onClick={onClose}>
          取消
        </button>
        <button type="button" className="skp-btn skp-btn-primary" disabled={busy || addable.length === 0} onClick={() => void doAdd()}>
          {busy ? "添加中…" : `添加 ${addable.length} 个`}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 文本帮助函数（KEY=VALUE 行 ⇄ 记录、一行一个 ⇄ 数组）
// ---------------------------------------------------------------------------

/** 记录 → 每行 `KEY=VALUE` 的文本（多行文本框回填用）。 */
function recordToLines(record: Record<string, string> | undefined): string {
  return Object.entries(record ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

/** 文本 → 记录；非法行（不以 `KEY=` 开头）记入 problems 并跳过。 */
function linesToRecord(text: string, field: string, problems: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
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
function linesToArray(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}