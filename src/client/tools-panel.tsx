/**
 * 能力面板 · Tools 域（v13 R3 / 帧 06）。
 *
 * Tools 是**全局工具注册**，没有项目 / 工作区维度（UX v1.8 §2.4 / §2.5）：
 * 因此本视图没有左导航、没有工作区列表，只有**两栏**：
 *   - 左：插件单元列表（一个插件 = 一个开关单元，`N 个工具`）；
 *   - 右：插件详情 + **只读**工具清单（手风琴；schema 由 `tools.inspect` 懒加载，
 *     可展开看参数表与原始 JSON）。
 *
 * 开关语义（**覆盖 v13 A5**）：能力面板 = **全局默认**（所有会话），
 * 会话首屏 /「能力」Tab = **本会话覆盖**（全局关闭时仍可在首屏单独开启）。
 * 因此本页：
 *   - 行 / 详情开关展示并写 `defaultEnabled`（`tools.setGlobalEnabled`），
 *     不需要 sessionId，也不显示任何具体会话状态；
 *   - 详情补一句「本会话可在对话首屏单独覆盖」，把两层关系说清。
 *
 * 契约：docs/architecture/v13-implementation.md §5.1 / §9.4 / 附录 A +
 * task-20 两层语义（`defaultEnabled` / `enabled`、`tools.setGlobalEnabled`）。
 *
 * @module dsh-capability-settings/client/tools-panel
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import type {
  CapabilityPanelApi,
  ClientToolInspectTool,
  ClientToolsList,
  ClientToolsUnit,
} from "./api.js";
import { ToolParameterTable, toolParameters } from "./tool-schema.js";

/** 详情标题右侧标签行的排版（与 mcp-panel 的 HEAD_TAGS_STYLE 同形）。 */
const HEAD_TAGS_STYLE: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, flex: "none" };

/** 详情底部弱说明的上外边距。 */
const NOTE_STYLE: CSSProperties = { margin: "10px 0 0" };

/**
 * 单元的**全局默认**开关：新宿主给 `defaultEnabled`；旧宿主/夹具只有单层
 * `enabledInSession` 时回落到它，再缺省按默认开启（与宿主 `TOOLS_DEFAULT_ENABLED` 一致）。
 */
function defaultEnabledOf(unit: ClientToolsUnit): boolean {
  return unit.defaultEnabled ?? unit.enabledInSession ?? true;
}

/** 未识别单元的琥珀标签类（复用既有 warn 标签）。 */
function unitTagClass(unit: ClientToolsUnit): string {
  return unit.kind === "unattributed" ? "skp-tag skp-tag-warn" : "skp-tag skp-tag-plugin";
}

/**
 * 单元排序：保持宿主枚举顺序（帧 06 的插件顺序来自运行时注册顺序），只把
 * 来源未识别恒排最后（UX v1.8 §5.4 的分组语义）。
 */
function sortUnits(units: ClientToolsUnit[]): ClientToolsUnit[] {
  return [...units.filter((unit) => unit.kind !== "unattributed"), ...units.filter((unit) => unit.kind === "unattributed")];
}

/** 详情「来源判定」文案（frontend 直抄方案 §7.6 / §9.4）。 */
function attributionText(unit: ClientToolsUnit): string {
  if (unit.attribution.matchedBy === "unknown") return "来源未识别（不是宿主内置）";
  const pattern = unit.attribution.pattern ?? unit.name;
  const matched = unit.attribution.matchedBy === "exact" ? `精确匹配 ${pattern}` : `前缀 ${pattern}`;
  return `${matched} → ${unit.name}（插件清单映射表）`;
}

/**
 * 一个工具的手风琴行：行 = 工具名 + `N 个参数/无参数`；展开后显示说明、
 * 参数表（参数/类型/必填/说明）与可折叠的原始 JSON（`parameters` pretty）。
 */
function ToolAccordionItem({ tool, open, onToggle }: { tool: ClientToolInspectTool; open: boolean; onToggle(): void }) {
  const [rawOpen, setRawOpen] = useState(false);
  const parameters = useMemo(() => toolParameters(tool.parameters), [tool.parameters]);
  const description = tool.description?.trim() ?? "";
  return (
    <div className={open ? "skp-tool-item skp-tool-item-open" : "skp-tool-item"} role="listitem">
      <button
        type="button"
        className="skp-tool-trigger"
        aria-expanded={open}
        title={tool.name}
        onClick={onToggle}
      >
        <span className="skp-tool-chevron" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <code className="skp-tool-name">{tool.name}</code>
        <span className="skp-tool-count">{parameters.length > 0 ? `${parameters.length} 个参数` : "无参数"}</span>
      </button>
      {open && (
        <div className="skp-tool-body">
          {description.length > 0 && <p className="skp-tool-desc">{description}</p>}
          <ToolParameterTable parameters={parameters} />
          <div className="skp-tools-raw">
            <button
              type="button"
              className="skp-link-btn"
              aria-expanded={rawOpen}
              onClick={() => setRawOpen((value) => !value)}
            >
              {rawOpen ? "收起原始 JSON" : "查看原始 JSON"}
            </button>
            {rawOpen && <pre className="skp-tools-raw-json">{JSON.stringify(tool.parameters ?? {}, null, 2)}</pre>}
          </div>
        </div>
      )}
    </div>
  );
}

/** 单个单元的 schema 懒加载状态（按 unit 缓存）。 */
type InspectState =
  | { status: "loading" }
  | { status: "ready"; tools: ClientToolInspectTool[] }
  | { status: "error"; message: string };

/**
 * Tools 域视图：两栏（插件列表 + 详情/只读工具清单），无左导航。
 *
 * @param query 根组件头部搜索框的值（按插件名 / 工具名 / 工具说明本地过滤）。
 * @param workspace 当前工作区（只作为重新拉取的信号：工作区/会话切换时刷新列表）。
 */
export function ToolsView({
  api,
  query,
  workspace,
  onCount,
}: {
  api: CapabilityPanelApi;
  query: string;
  workspace?: string;
  /** 数据到达后上报单元总数（域 Tab 计数）。 */
  onCount?: (count: number) => void;
}) {
  const [data, setData] = useState<ClientToolsList | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [version, setVersion] = useState(0);
  const [selectedUnit, setSelectedUnit] = useState<string | undefined>(undefined);
  const [busyUnit, setBusyUnit] = useState<string | undefined>(undefined);
  const [opError, setOpError] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  /** `tools.inspect` 结果缓存（按 unit；选中时才拉，刷新列表不复用过期数据）。 */
  const [inspectCache, setInspectCache] = useState<Record<string, InspectState>>({});
  /** 手风琴当前展开的工具（同一时间只展开一个）。 */
  const [expandedTool, setExpandedTool] = useState<string | undefined>(undefined);
  const mountedRef = useRef(true);
  const rowRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    // 主面板只看/写全局默认：不传 sessionId（全局态与会话无关）。
    void api.tools
      .list()
      .then((view) => {
        if (cancelled) return;
        setData(view);
      })
      .catch((failure) => {
        if (cancelled) return;
        setError(String(failure instanceof Error ? failure.message : failure));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, workspace, version]);

  const units = useMemo(() => sortUnits(data?.units ?? []), [data]);

  // 计数回填（搜索不影响计数）；加载中不覆盖。
  useEffect(() => {
    if (!loading && error === undefined) onCount?.(units.length);
  }, [units.length, loading, error, onCount]);

  // 首次到达 / 当前选中消失时选中第一项（帧 06 默认展开详情）。
  useEffect(() => {
    if (units.length === 0) {
      if (selectedUnit !== undefined) setSelectedUnit(undefined);
      return;
    }
    if (selectedUnit !== undefined && units.some((unit) => unit.unit === selectedUnit)) return;
    setSelectedUnit(units[0]?.unit);
  }, [units, selectedUnit]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      units.filter((unit) => {
        if (q === "") return true;
        if (unit.name.toLowerCase().includes(q)) return true;
        return unit.tools.some(
          (tool) => tool.name.toLowerCase().includes(q) || (tool.description ?? "").toLowerCase().includes(q),
        );
      }),
    [units, q],
  );

  const selected = units.find((unit) => unit.unit === selectedUnit);

  // 选中单元时懒加载工具 schema（按 unit 缓存）：失败/旧宿主降级为 list 的 name+description。
  const inspectState = selectedUnit === undefined ? undefined : inspectCache[selectedUnit];
  useEffect(() => {
    if (selectedUnit === undefined) return;
    if (inspectCache[selectedUnit] !== undefined) return;
    setInspectCache((prev) => (prev[selectedUnit] !== undefined ? prev : { ...prev, [selectedUnit]: { status: "loading" } }));
    void api.tools
      .inspect({ unit: selectedUnit })
      .then((view) => {
        if (!mountedRef.current) return;
        setInspectCache((prev) => ({ ...prev, [selectedUnit]: { status: "ready", tools: view.tools } }));
      })
      .catch((failure) => {
        if (!mountedRef.current) return;
        setInspectCache((prev) => ({
          ...prev,
          [selectedUnit]: { status: "error", message: String(failure instanceof Error ? failure.message : failure) },
        }));
      });
  }, [api, selectedUnit, inspectCache]);

  // 切换插件时收起展开的工具（避免沿用上一个插件的工具名）。
  useEffect(() => {
    setExpandedTool(undefined);
  }, [selectedUnit]);

  const inspectedTools = inspectState?.status === "ready" ? inspectState.tools : undefined;
  const inspectLoading = inspectState?.status === "loading";
  const inspectError = inspectState?.status === "error" ? inspectState.message : undefined;
  // inspect 未就绪时退回 `tools.list` 的轻量清单（仅名称 + 说明），保证列表不空。
  const displayTools: ClientToolInspectTool[] =
    inspectedTools ??
    (selected?.tools ?? []).map((tool) => ({
      name: tool.name,
      ...(tool.description !== undefined ? { description: tool.description } : {}),
    }));

  /**
   * 写**全局默认**开关（能力面板语义）：不需要 sessionId，也不碰任何会话覆盖。
   * 全局关闭后，单个会话仍可在对话首屏单独开启。
   */
  const toggleDefault = useCallback(
    async (unit: ClientToolsUnit, next: boolean) => {
      if (unit.lockedReason !== undefined || busyUnit !== undefined) return;
      setBusyUnit(unit.unit);
      setOpError(undefined);
      try {
        await api.tools.setGlobalEnabled({ units: [unit.unit], enabled: next });
      } catch (failure) {
        setOpError(String(failure instanceof Error ? failure.message : failure));
      } finally {
        if (mountedRef.current) setBusyUnit(undefined);
        setVersion((value) => value + 1);
      }
    },
    [api, busyUnit],
  );

  const copyName = async (name: string) => {
    try {
      await navigator.clipboard?.writeText(name);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用时静默 */
    }
  };

  const focusRow = (unit: string) => {
    const element = rowRefs.current.get(unit);
    element?.focus();
    element?.scrollIntoView({ block: "nearest" });
  };

  const onRowKeyDown = (event: ReactKeyboardEvent<HTMLElement>, unit: string) => {
    if (visible.length === 0) return;
    const index = visible.findIndex((item) => item.unit === unit);
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? visible.length - 1
            : event.key === "ArrowDown"
              ? Math.min(visible.length - 1, index + 1)
              : Math.max(0, index - 1);
      const nextUnit = visible[next]?.unit;
      if (nextUnit !== undefined) {
        setSelectedUnit(nextUnit);
        requestAnimationFrame(() => focusRow(nextUnit));
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      setSelectedUnit(unit);
    }
  };

  const listErrors = data?.errors ?? [];

  return (
    <div className="skp-domain">
      {opError !== undefined && <div className="skp-error">{opError}</div>}
      {error !== undefined && <div className="skp-error">读取失败：{error}</div>}
      {error === undefined && listErrors.length > 0 && <div className="skp-error">{listErrors.join("\n")}</div>}
      {loading && data === undefined && <div className="skp-status">加载中…</div>}

      {data !== undefined && error === undefined && (
        <div className="skp-body skp-tools-body">
          {/* 中间列：插件单元列表（无左导航 / 无工作区维度）。 */}
          <div className="skp-workspace-pane skp-tools-pane">
            <div className="skp-pane-title">
              <span className="skp-pane-title-text">Tools</span>
              <span className="skp-group-count">{units.length}</span>
              <span className="skp-pane-title-note">
                · {units.filter((unit) => defaultEnabledOf(unit)).length} 默认启用 · 插件级开关（整插件生效）
              </span>
            </div>
            {units.length === 0 ? (
              <div className="skp-empty">
                {listErrors.length > 0 ? "当前外壳未提供工具注册表，无法列出 Tools。" : "尚未发现 Tools。"}
              </div>
            ) : visible.length === 0 ? (
              <div className="skp-empty">没有匹配「{query.trim()}」的 Tools。</div>
            ) : (
              <div className="skp-group-scroll">
                <ul className="skp-list" role="listbox" aria-label="Tools">
                  {visible.map((unit) => {
                    const active = unit.unit === selectedUnit;
                    const locked = unit.lockedReason !== undefined;
                    return (
                      <li key={unit.unit} className={active ? "skp-row-wrap skp-row-wrap-active" : "skp-row-wrap"}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={active}
                          tabIndex={active ? 0 : -1}
                          className={active ? "skp-row skp-row-active" : "skp-row"}
                          ref={(element) => {
                            if (element === null) rowRefs.current.delete(unit.unit);
                            else rowRefs.current.set(unit.unit, element);
                          }}
                          onClick={() => setSelectedUnit(unit.unit)}
                          onKeyDown={(event) => onRowKeyDown(event, unit.unit)}
                        >
                          <span className="skp-row-name">
                            <span
                              className={defaultEnabledOf(unit) ? "skp-dot skp-dot-enabled" : "skp-dot skp-dot-hollow"}
                              aria-hidden="true"
                            />
                            <span className="skp-sr-only">{defaultEnabledOf(unit) ? "默认已启用" : "默认已关闭"}</span>
                            <span className="skp-row-title" title={unit.name}>
                              {unit.name}
                            </span>
                          </span>
                          <span className="skp-row-meta">
                            <span className={unitTagClass(unit)} title={unit.kind === "unattributed" ? "来源未识别：不是宿主内置工具" : "插件运行时注册（非 MCP）"}>
                              {unit.kind === "unattributed" ? "未识别" : "插件"}
                            </span>
                            <span className="skp-tag skp-tag-flat">{unit.toolCount} 个工具</span>
                          </span>
                        </button>
                        <label
                          className="skp-row-toggle"
                          title={
                            locked
                              ? (unit.lockedReason ?? "该插件无法开关")
                              : defaultEnabledOf(unit)
                                ? "关闭：关闭后所有会话默认不可用；单个会话仍可在对话首屏单独开启"
                                : "开启：所有会话默认可用（单个会话可在对话首屏单独关闭）"
                          }
                        >
                          <span className="skp-row-default-label">默认</span>
                          <span className="skp-switch">
                            <input
                              type="checkbox"
                              role="switch"
                              aria-label={`默认启用 ${unit.name}`}
                              checked={defaultEnabledOf(unit)}
                              disabled={locked || busyUnit === unit.unit}
                              onChange={(event) => void toggleDefault(unit, event.target.checked)}
                            />
                            <span className="skp-switch-track" />
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>

          {/* 右侧详情 + 只读工具清单。 */}
          <div className="skp-detail skp-detail-fixed">
            {selected === undefined ? (
              <div className="skp-detail-empty">选择一个插件查看工具清单与参数。</div>
            ) : (
              <div className="skp-detail-card">
                <div className="skp-detail-head">
                  <h3 title={selected.name}>{selected.name}</h3>
                  <span style={HEAD_TAGS_STYLE}>
                    <span className={selected.kind === "unattributed" ? "skp-tag skp-tag-warn" : "skp-tag skp-tag-plugin"}>
                      {selected.kind === "unattributed" ? "未识别" : "插件"}
                    </span>
                    <span className="skp-tag skp-tag-channel" title={selected.attribution.packageName ?? selected.name}>
                      {selected.name}
                    </span>
                  </span>
                  <span className="skp-detail-head-spacer" />
                  <button type="button" className="skp-btn" onClick={() => void copyName(selected.name)}>
                    {copied ? "已复制" : "复制插件名"}
                  </button>
                </div>

                {/* 开关只在左侧列表行（详情不再重复操作行，也不出现「本会话」）。 */}

                {/* 来源判定 / 注入方式（方案 §9.4 文案）。 */}
                <div className="skp-detail-meta">
                  <span className="skp-detail-meta-item">
                    <span className="skp-detail-meta-strong">来源判定：</span>
                    {attributionText(selected)}
                  </span>
                  <span className="skp-detail-meta-item">
                    <span className="skp-detail-meta-strong">注入方式：</span>
                    插件运行时注册的非 MCP 工具（不落盘）
                  </span>
                </div>

                <div className="skp-note">
                  工具数 {selected.toolCount} · 开关为插件级：关闭后该插件全部工具在所有会话默认不可见（不改已有会话的显式覆盖）
                </div>

                <div className="skp-detail-inspect">
                  <div className="skp-detail-inspect-head">
                    <span className="skp-field-label">工具清单（{selected.toolCount}）</span>
                    <span className="skp-test-stat">
                      {inspectLoading ? "正在读取参数…" : "点击工具查看参数与原始 JSON"}
                    </span>
                  </div>
                  {inspectError !== undefined && (
                    <div className="skp-note">参数不可用：{inspectError}（仍可查看工具名称与说明）</div>
                  )}
                  {displayTools.length === 0 ? (
                    <div className="skp-note">工具清单不可见（该单元当前没有可见工具）。</div>
                  ) : (
                    <div className="skp-tool-accordion" role="list">
                      {displayTools.map((tool) => (
                        <ToolAccordionItem
                          key={tool.name}
                          tool={tool}
                          open={expandedTool === tool.name}
                          onToggle={() => setExpandedTool(expandedTool === tool.name ? undefined : tool.name)}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <p className="skp-note" style={NOTE_STYLE}>
                  插件级开关，不提供单工具开关；无法 restrict 的插件开关置灰并说明原因；宿主内建基础工具不进入本域。
                </p>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
