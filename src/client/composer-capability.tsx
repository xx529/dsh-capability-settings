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
import type {
  CapabilityPanelApi,
  ClientMcpRuntimeServer,
  ClientMcpServer,
  ClientSkillSummary,
  OpResult,
} from "./api.js";
import { useWorkspaceLabel } from "./composer-common.js";
import { aggregateMounts, MOUNT_LABEL, type MountInfo } from "./mcp-common.js";

// ---------------------------------------------------------------------------
// 图标（内联 SVG，颜色走 currentColor）
// ---------------------------------------------------------------------------

function SparkleIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2l1.5 3.8L13.5 7l-4 1.2L8 12 6.5 8.2 2.5 7l4-1.2L8 2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon({ up = false, size = 12 }: { up?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d={up ? "m5 10 3-3 3 3" : "m5 6 3 3 3-3"} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 数据快照
// ---------------------------------------------------------------------------

export interface CapabilitySnapshot {
  skills: ClientSkillSummary[];
  servers: ClientMcpServer[];
  externals: ClientMcpRuntimeServer[];
  mounts: Record<string, MountInfo>;
  settling: boolean;
}

export interface SkillRow {
  id: string;
  kind: "skill";
  name: string;
  description: string;
  tag: string;
  enabled: boolean;
  disabled: boolean;
  meta?: string;
}

export interface McpRow {
  id: string;
  kind: "mcp";
  name: string;
  tag: string;
  meta: string;
  enabled: boolean;
  disabled: boolean;
  dot: string;
  /** 写会话开关时的 target（项目条目 = key；global/外部 = serverName）。 */
  target: string;
  writeKind: "project" | "server";
  /** restrict 无法生效的外部实例（按会话注入）。 */
  locked: boolean;
}

export type Row = SkillRow | McpRow;

const EMPTY_SNAPSHOT: CapabilitySnapshot = { skills: [], servers: [], externals: [], mounts: {}, settling: false };

/** 项目来源判定（与 shared/skill-sources 的语义一致，客户端侧保持轻量）。 */
function sourceIsProject(source: string): boolean {
  return source.startsWith("project-");
}

function skillTag(skill: ClientSkillSummary): string {
  return sourceIsProject(skill.source) ? "项目" : skill.readOnly ? "全局 · 只读" : "全局";
}

function skillEnabled(skill: ClientSkillSummary): boolean {
  return skill.enabledInSession !== false;
}

function defaultMcpEnabled(server: ClientMcpServer): boolean {
  return server.enabled && server.disabledInProject !== true;
}

function mcpEnabled(server: ClientMcpServer): boolean {
  return server.enabledInSession ?? defaultMcpEnabled(server);
}

function externalEnabled(server: ClientMcpRuntimeServer): boolean {
  const fallback = server.restrictable ? server.disabledInProject !== true : true;
  return server.enabledInSession ?? fallback;
}

// ---------------------------------------------------------------------------
// 数据拉取
// ---------------------------------------------------------------------------

async function fetchSnapshot(api: CapabilityPanelApi, workspace: string): Promise<CapabilitySnapshot> {
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
    api.mcp.runtime({ cwd: workspace }).catch(() => ({ servers: [] as ClientMcpRuntimeServer[] })),
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
function useCapabilitySnapshot(api: CapabilityPanelApi, workspace: string, enabled = true) {
  const [snapshot, setSnapshot] = useState<CapabilitySnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
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
        if (!mountedRef.current || seq !== seqRef.current) return;
        setSnapshot(next);
        setError(undefined);
      })
      .catch((err) => {
        if (!mountedRef.current || seq !== seqRef.current) return;
        setError(String(err instanceof Error ? err.message : err));
      })
      .finally(() => {
        if (!mountedRef.current || seq !== seqRef.current) return;
        setLoading(false);
      });
  }, [api, workspace, version, enabled]);

  // MCP 写操作后宿主 fire-and-forget 重挂：settling 为真时静默轮询收敛。
  useEffect(() => {
    if (!snapshot.settling) return;
    let cancelled = false;
    let attempts = 0;
    const timer = setInterval(() => {
      if (cancelled) return;
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
  const ref = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<string | undefined>(undefined);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const root = el.closest("[data-phase]");
    const read = () => setPhase(root?.getAttribute("data-phase") ?? undefined);
    read();
    if (root === null) return;
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-phase"] });
    return () => observer.disconnect();
  }, []);
  return { ref, phase };
}

interface CardRect {
  left: number;
  top: number;
  width: number;
}

/** hero 固定面板：跟随输入卡的视口位置（ResizeObserver + 滚动/resize 重算）。 */
function useComposerCardRect(active: boolean, hostRef: { current: HTMLDivElement | null }) {
  const [rect, setRect] = useState<CardRect | undefined>(undefined);
  useEffect(() => {
    if (!active) return;
    const host = hostRef.current;
    const root = host?.closest("[data-phase]") as HTMLElement | null;
    if (root === null) return;
    let frame = 0;
    const read = () => {
      const card = root.querySelector("[data-composer-card]") as HTMLElement | null;
      if (card === null) return;
      const box = card.getBoundingClientRect();
      const next: CardRect = { left: box.left, top: box.bottom + 8, width: box.width };
      setRect((prev) => (prev !== undefined && prev.left === next.left && prev.top === next.top && prev.width === next.width ? prev : next));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(read);
    };
    read();
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    const card = root.querySelector("[data-composer-card]") as HTMLElement | null;
    if (card !== null) observer.observe(card);
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

export function buildSkillRows(snapshot: CapabilitySnapshot, pending: Record<string, boolean>): SkillRow[] {
  // 同名跨根（项目 vs 全局）只保留第一行：磁盘列表按「项目根在前 + 名称排序」
  // 返回，第一行即宿主实际生效的那份；会话 shadow 按名字生效，重复行没有意义。
  const seen = new Set<string>();
  const unique = snapshot.skills.filter((skill) => {
    if (seen.has(skill.name)) return false;
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

export function buildMcpRows(snapshot: CapabilitySnapshot, pending: Record<string, boolean>): McpRow[] {
  const rows: McpRow[] = [];
  const project = snapshot.servers.filter((server) => server.scope === "project");
  // 全局条目只保留全局已启用的（全局已禁用的本项目也无法生效，去能力面板处理）。
  const global = snapshot.servers.filter((server) => server.scope === "global" && server.enabled);
  for (const server of [...project, ...global]) {
    const id = `mcp:${server.scope}:${server.key}`;
    const mounted = snapshot.mounts[server.key];
    const meta =
      server.scope === "global"
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
      meta:
        server.restrictable !== true
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

function DockSwitch({ checked, disabled, title, onChange }: { checked: boolean; disabled?: boolean; title?: string; onChange: () => void }) {
  return (
    <label className="skp-dock-switch" title={title}>
      <input type="checkbox" checked={checked} disabled={disabled} aria-label={title} onChange={onChange} />
      <span className="skp-dock-switch-track" />
    </label>
  );
}

function Tag({ label }: { label: string }) {
  const tone = label === "项目" ? "project" : label === "外部" ? "external" : "global";
  return <span className={`skp-dock-tag skp-dock-tag-${tone}`}>{label}</span>;
}

// ---------------------------------------------------------------------------
// 卡片 / Tab / 面板
// ---------------------------------------------------------------------------

export function CapabilityCard({ row, busy, onToggle }: { row: Row; busy: boolean; onToggle: () => void }) {
  return (
    <div
      className={`skp-dock-card${row.enabled ? " skp-dock-card-on" : ""}${row.disabled ? " skp-dock-card-disabled" : ""}`}
      role="button"
      tabIndex={0}
      aria-pressed={row.enabled}
      title={row.disabled ? "该能力无法在当前会话切换，请到能力面板管理" : row.name}
      onClick={() => {
        if (!row.disabled && !busy) onToggle();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (!row.disabled && !busy) onToggle();
        }
      }}
    >
      <div className="skp-dock-card-head">
        <span className="skp-dock-card-icon">{row.kind === "skill" ? <SparkleIcon size={13} /> : <McpIcon />}</span>
        <span className="skp-dock-card-name">{row.name}</span>
        <DockSwitch
          checked={row.enabled}
          disabled={row.disabled || busy}
          title={row.enabled ? "在当前会话关闭（不落盘）" : "在当前会话恢复"}
          onChange={() => {
            if (!row.disabled && !busy) onToggle();
          }}
        />
      </div>
      <p className="skp-dock-card-desc">{row.kind === "skill" ? row.description : row.meta}</p>
      <div className="skp-dock-card-foot">
        <Tag label={row.tag} />
        {row.kind === "skill" ? (
          row.meta !== undefined && <span className="skp-dock-card-meta">{row.meta}</span>
        ) : (
          <span className={`skp-dock-dot skp-dock-dot-${row.dot}`} title={row.meta} />
        )}
      </div>
    </div>
  );
}

function McpIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 3v4a2 2 0 0 0 4 0V3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M8 9v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

type TabId = "skills" | "mcp";

interface PanelProps {
  mode: "dock" | "hero" | "overlay" | "view";
  loading: boolean;
  error?: string;
  snapshot: CapabilitySnapshot;
  skillRows: SkillRow[];
  mcpRows: McpRow[];
  pending: Record<string, boolean>;
  busy: Record<string, boolean>;
  onToggle: (row: Row) => void;
  onReset: () => void;
  onRefresh: () => void;
  onCollapse: () => void;
  onManage?: () => void;
  onRetry?: () => void;
}

export function CapabilityPanel(props: PanelProps & { initialTab?: TabId }) {
  const { mode, loading, error, skillRows, mcpRows, pending, busy, onToggle, onReset, onCollapse, onManage, onRefresh, onRetry, initialTab } = props;
  const [tab, setTab] = useState<TabId>(initialTab ?? "skills");
  const [query, setQuery] = useState("");
  const [resetBusy, setResetBusy] = useState(false);

  const skillsOn = skillRows.filter((row) => row.enabled).length;
  const mcpOn = mcpRows.filter((row) => row.enabled).length;
  const rows: Row[] = tab === "skills" ? skillRows : mcpRows;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return rows;
    return rows.filter((row) => `${row.name} ${row.kind === "skill" ? row.description : row.meta}`.toLowerCase().includes(q));
  }, [rows, query]);

  const totalOn = skillsOn + mcpOn;
  const total = skillRows.length + mcpRows.length;

  return (
    <div className={`skp-dock-panel skp-dock-panel-${mode}`}>
      {/* 头部：标题 + 作用域 + 搜索 + 收起 */}
      <div className="skp-dock-head">
        <span className="skp-dock-title-icon">
          <SparkleIcon />
        </span>
        <span className="skp-dock-title">本会话能力</span>
        {mode === "view" && <span className="skp-dock-subtitle">开关只作用于当前会话，不修改项目默认</span>}
        <div className="skp-dock-head-right">
          <label className="skp-dock-search">
            <span className="skp-dock-search-icon">
              <SearchIcon />
            </span>
            <input
              type="search"
              value={query}
              placeholder="搜索能力"
              aria-label="搜索能力"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {mode !== "view" && (
            <button type="button" className="skp-dock-icon-btn" title="收起" aria-label="收起" onClick={onCollapse}>
              <ChevronIcon up />
            </button>
          )}
        </div>
      </div>

      {/* Tab 栏：能力类型（后续类型从这里扩展） */}
      <div className="skp-dock-tab-row">
        <div className="skp-dock-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "skills"}
            className={`skp-dock-tab${tab === "skills" ? " skp-dock-tab-active" : ""}`}
            onClick={() => setTab("skills")}
          >
            Skills
            <span className="skp-dock-tab-count">
              {skillsOn} / {skillRows.length}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "mcp"}
            className={`skp-dock-tab${tab === "mcp" ? " skp-dock-tab-active" : ""}`}
            onClick={() => setTab("mcp")}
          >
            MCP 服务器
            <span className="skp-dock-tab-count">
              {mcpOn} / {mcpRows.length}
            </span>
          </button>
        </div>
        <span className="skp-dock-spacer" />
        {onManage !== undefined && (
          <button type="button" className="skp-dock-link" onClick={onManage}>
            管理全部 ↗
          </button>
        )}
      </div>

      {error !== undefined && (
        <div className="skp-dock-banner" role="alert">
          <span>{error}</span>
          {onRetry !== undefined && (
            <button type="button" className="skp-dock-link" onClick={onRetry}>
              重试
            </button>
          )}
        </div>
      )}

      {/* 卡片网格 */}
      <div className="skp-dock-grid" role="tabpanel">
        {loading && filtered.length === 0 ? (
          <div className="skp-dock-empty">加载中…</div>
        ) : filtered.length === 0 ? (
          <div className="skp-dock-empty">
            {query.trim() !== "" ? `没有匹配「${query.trim()}」的能力` : tab === "skills" ? "本会话暂无可配置的 Skills" : "本会话暂无可配置的 MCP 服务器"}
            {query.trim() !== "" && (
              <button type="button" className="skp-dock-link" onClick={() => setQuery("")}>
                清空搜索
              </button>
            )}
          </div>
        ) : (
          filtered.map((row) => <CapabilityCard key={row.id} row={row} busy={busy[row.id] === true} onToggle={() => onToggle(row)} />)
        )}
      </div>

      {/* 底栏 */}
      <div className="skp-dock-foot">
        <span className="skp-dock-foot-note">
          {totalOn} / {total} 项已启用 · 开关只作用于当前对话
        </span>
        <button
          type="button"
          className="skp-dock-btn"
          disabled={resetBusy}
          onClick={() => {
            setResetBusy(true);
            Promise.resolve(onReset()).finally(() => setResetBusy(false));
          }}
        >
          恢复默认
        </button>
        {mode !== "view" && (
          <button type="button" className="skp-dock-btn skp-dock-btn-primary" onClick={onCollapse}>
            完成
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 收起态能力条
// ---------------------------------------------------------------------------

export function CapabilityBar({ skillRows, mcpRows, loading, onExpand }: { skillRows: SkillRow[]; mcpRows: McpRow[]; loading: boolean; onExpand: () => void }) {
  const mcpEnabled = mcpRows.filter((row) => row.enabled).map((row) => ({ id: row.id, name: row.name, kind: "mcp" as const }));
  const enabled = [
    ...mcpEnabled.slice(0, 2),
    ...skillRows.filter((row) => row.enabled).map((row) => ({ id: row.id, name: row.name, kind: "skill" as const })),
    ...mcpEnabled.slice(2),
  ];
  const visible = enabled.slice(0, 5);
  const overflow = enabled.length - visible.length;
  const total = skillRows.length + mcpRows.length;
  return (
    <div
      className="skp-dock-bar"
      role="button"
      tabIndex={0}
      aria-label="展开本会话能力配置"
      onClick={onExpand}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onExpand();
        }
      }}
    >
      <span className="skp-dock-title-icon">
        <SparkleIcon />
      </span>
      <span className="skp-dock-bar-title">本会话能力</span>
      <span className="skp-dock-bar-divider" />
      {loading && enabled.length === 0 ? (
        <span className="skp-dock-bar-hint">加载中…</span>
      ) : visible.length === 0 ? (
        <span className="skp-dock-bar-hint">未启用任何能力</span>
      ) : (
        <span className="skp-dock-chips">
          {visible.map((item) => (
            <span key={item.id} className={`skp-dock-chip skp-dock-chip-${item.kind}`}>
              <i className="skp-dock-chip-dot" />
              {item.name}
            </span>
          ))}
          {overflow > 0 && <span className="skp-dock-chip skp-dock-chip-more">+{overflow}</span>}
        </span>
      )}
      <span className="skp-dock-spacer" />
      <span className="skp-dock-count">
        {enabled.length} / {total} 启用
      </span>
      <button type="button" className="skp-dock-config-btn" onClick={onExpand}>
        配置
        <ChevronIcon />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 会话控制器：一次拉取 + 开关/恢复默认（hero / overlay / view 共用）
// ---------------------------------------------------------------------------

function useCapabilityController(api: CapabilityPanelApi, workspace: string, enabled = true) {
  const { snapshot, loading, error, setError, refresh } = useCapabilitySnapshot(api, workspace, enabled);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const skillRows = useMemo(() => buildSkillRows(snapshot, pending), [snapshot, pending]);
  const mcpRows = useMemo(() => buildMcpRows(snapshot, pending), [snapshot, pending]);

  useEffect(() => {
    setPending({});
  }, [snapshot]);

  const toggle = useCallback(
    async (row: Row) => {
      const next = !row.enabled;
      setPending((prev) => ({ ...prev, [row.id]: next }));
      setBusy((prev) => ({ ...prev, [row.id]: true }));
      setError(undefined);
      try {
        if (row.kind === "skill") {
          const result = await api.skills.setSessionEnabled({ name: row.name, enabled: next });
          if (!result.ok) throw new Error(result.errors.join("; "));
        } else {
          await api.mcp.setSessionEnabled({ target: row.target, kind: row.writeKind, enabled: next });
        }
      } catch (err) {
        setPending((prev) => ({ ...prev, [row.id]: !next }));
        setError(String(err instanceof Error ? err.message : err));
      } finally {
        setBusy((prev) => {
          const copy = { ...prev };
          delete copy[row.id];
          return copy;
        });
        refresh();
      }
    },
    [api, refresh, setError],
  );

  const reset = useCallback(async () => {
    setError(undefined);
    try {
      const hidden = snapshot.skills.filter((skill) => skill.enabledInSession === false);
      await Promise.all(hidden.map((skill) => api.skills.setSessionEnabled({ name: skill.name, enabled: true })));
      // MCP：逐条清掉显式会话覆盖；restrictable=false 的外部实例无覆盖可清。
      const overrides = [
        ...snapshot.servers.filter((server) => server.enabledInSession !== undefined).map((server) => ({
          target: server.scope === "project" ? server.key : server.serverName,
          kind: (server.scope === "project" ? "project" : "server") as "project" | "server",
        })),
        ...snapshot.externals
          .filter((server) => server.enabledInSession !== undefined && server.restrictable === true)
          .map((server) => ({ target: server.serverName, kind: "server" as const })),
      ];
      await Promise.all(overrides.map((item) => api.mcp.setSessionEnabled({ target: item.target, kind: item.kind, enabled: undefined })));
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      refresh();
    }
  }, [api, refresh, setError, snapshot]);

  return { snapshot, loading, error, refresh, skillRows, mcpRows, pending, busy, toggle, reset };
}

// ---------------------------------------------------------------------------
// 首屏（hero）：fixed 面板（active 相位返回零高占位）
// ---------------------------------------------------------------------------

export function ComposerCapabilityHero({ api, onManage }: { api: CapabilityPanelApi; onManage?: () => void }) {
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
  const placeholder = <div ref={ref} className="skp-dock-hero-anchor" aria-hidden="true" />;
  if (!isHero || rect === undefined) return placeholder;

  const viewportHeight = typeof window === "undefined" ? 900 : window.innerHeight;
  const maxHeight = Math.max(180, Math.min(360, viewportHeight - rect.top - 24));
  const style = { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, maxHeight: `${maxHeight}px` };

  return (
    <div ref={ref} className="skp-dock-hero-anchor">
      <div className="skp-dock-fixed" style={style}>
        {open ? (
          <CapabilityPanel
            mode="hero"
            loading={controller.loading}
            error={controller.error}
            snapshot={controller.snapshot}
            skillRows={controller.skillRows}
            mcpRows={controller.mcpRows}
            pending={controller.pending}
            busy={controller.busy}
            onToggle={(row) => void controller.toggle(row)}
            onReset={controller.reset}
            onRefresh={controller.refresh}
            onCollapse={() => setOpen(false)}
            {...(onManage !== undefined ? { onManage } : {})}
            onRetry={controller.refresh}
          />
        ) : (
          <CapabilityBar skillRows={controller.skillRows} mcpRows={controller.mcpRows} loading={controller.loading} onExpand={() => setOpen(true)} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 会话内整页：conversation.view 的「能力」Tab
// ---------------------------------------------------------------------------

export function SessionCapabilityView({
  apiFor,
  sessionId: initialSessionId,
  onManage,
}: {
  apiFor: (sessionId: string | undefined) => CapabilityPanelApi;
  sessionId?: string;
  onManage?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [sessionId, setSessionId] = useState<string | undefined>(initialSessionId);

  // `conversation.view` 的渲染参数只带 inspectCall/openView 等，没有 sessionId；
  // 这里从外层会话容器（[data-conversation-session]）补读一次，确保 api 绑定到
  // 当前会话（composerApiFor(sessionId)），避免退化成「当前工作区第一项」。
  useEffect(() => {
    if (sessionId !== undefined) return;
    const host = rootRef.current?.closest("[data-conversation-session]");
    const value = host?.getAttribute("data-conversation-session");
    if (typeof value === "string" && value !== "") setSessionId(value);
  }, [sessionId]);

  // 外壳若复用实例只替换 props，也要跟随切换会话。
  useEffect(() => {
    if (initialSessionId !== undefined) setSessionId(initialSessionId);
  }, [initialSessionId]);

  // 「能力」Tab 是管理页，不需要对话输入框：挂载期间给会话容器加类，
  // 由 CSS 隐藏 [data-composer-seat]；切回其它 Tab（组件卸载）即恢复。
  useEffect(() => {
    const host = rootRef.current?.closest("[data-conversation-content]");
    if (!(host instanceof HTMLElement)) return;
    host.classList.add("skp-cap-view-host");
    return () => {
      host.classList.remove("skp-cap-view-host");
    };
  }, []);

  const api = useMemo(() => apiFor(sessionId), [apiFor, sessionId]);
  const workspace = useWorkspaceLabel(api);
  const controller = useCapabilityController(api, workspace, true);
  return (
    <div ref={rootRef} className="skp-cap-view" data-capability-view-session={sessionId ?? ""}>
      <div className="skp-cap-view-inner">
        <CapabilityPanel
          mode="view"
          loading={controller.loading}
          error={controller.error}
          snapshot={controller.snapshot}
          skillRows={controller.skillRows}
          mcpRows={controller.mcpRows}
          pending={controller.pending}
          busy={controller.busy}
          onToggle={(row) => void controller.toggle(row)}
          onReset={controller.reset}
          onRefresh={controller.refresh}
          onCollapse={() => undefined}
          {...(onManage !== undefined ? { onManage } : {})}
          onRetry={controller.refresh}
        />
      </div>
    </div>
  );
}
