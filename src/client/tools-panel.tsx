/**
 * 能力面板 · Tools 域（v13 R3 / 帧 06）。
 *
 * Tools 是**全局工具注册**，没有项目 / 工作区维度（UX v1.8 §2.4 / §2.5）：
 * 因此本视图没有左导航、没有工作区列表，只有**两栏**：
 *   - 左：插件单元列表（一个插件 = 一个开关单元，`N 个工具`）；
 *   - 右：插件详情 + **只读**工具清单（无逐工具开关、无参数表）。
 *
 * 开关语义（A5 已拍板「主面板也要能开关」）：主面板自身没有 sessionId，
 * 由 `api.currentSessionId()` 从客户端 sessions 快照解析当前会话：
 *   - 解析到 → 行/详情开关可点，写 `tools.setSessionEnabled`（只作用于该会话，
 *     不改项目默认）；
 *   - 解析不到 → 开关置灰 + 提示 `请在对话首屏设置本会话开关`（只读）。
 *
 * 契约：docs/architecture/v13-implementation.md §5.1 / §9.4 / 附录 A。
 *
 * @module dsh-capability-settings/client/tools-panel
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { CapabilityPanelApi, ClientToolsList, ClientToolsUnit } from "./api.js";

/** 详情标题右侧标签行的排版（与 mcp-panel 的 HEAD_TAGS_STYLE 同形）。 */
const HEAD_TAGS_STYLE: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, flex: "none" };

/** 不做成按钮的说明文本（关闭影响条 / 只读说明）。 */
const CLOSE_IMPACT_STYLE: CSSProperties = { margin: "10px 0 0" };

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
 * Tools 域视图：两栏（插件列表 + 详情/只读工具清单），无左导航。
 *
 * @param query 根组件头部搜索框的值（按插件名 / 工具名 / 工具说明本地过滤）。
 * @param workspace 当前工作区（只作为重新拉取的信号：会话切换后 currentSessionId 可能变化）。
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
  const mountedRef = useRef(true);
  const rowRefs = useRef(new Map<string, HTMLElement>());

  // A5：解析当前会话（解析不到 → 只读）。每次拉取前重读，跟随会话切换。
  const resolvedSessionId = api.currentSessionId?.();
  const sessionId = typeof resolvedSessionId === "string" && resolvedSessionId.length > 0 ? resolvedSessionId : undefined;

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
    void api.tools
      .list(sessionId !== undefined ? { sessionId } : {})
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
  }, [api, sessionId, workspace, version]);

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

  /** 写会话开关（A5）：只有解析到当前会话且单元未锁定时才允许。 */
  const toggleUnit = useCallback(
    async (unit: ClientToolsUnit, next: boolean) => {
      if (sessionId === undefined || unit.lockedReason !== undefined || busyUnit !== undefined) return;
      setBusyUnit(unit.unit);
      setOpError(undefined);
      try {
        await api.tools.setSessionEnabled({ units: [unit.unit], enabled: next, sessionId });
      } catch (failure) {
        setOpError(String(failure instanceof Error ? failure.message : failure));
      } finally {
        if (mountedRef.current) setBusyUnit(undefined);
        setVersion((value) => value + 1);
      }
    },
    [api, busyUnit, sessionId],
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
                · {units.filter((unit) => unit.enabledInSession).length} 启用 · 插件级开关（整插件生效）
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
                    const readOnly = sessionId === undefined;
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
                              className={unit.enabledInSession ? "skp-dot skp-dot-enabled" : "skp-dot skp-dot-hollow"}
                              aria-hidden="true"
                            />
                            <span className="skp-sr-only">{unit.enabledInSession ? "已启用" : "已关闭"}</span>
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
                              ? (unit.lockedReason ?? "该插件无法按会话关闭")
                              : readOnly
                                ? "请在对话首屏设置本会话开关"
                                : unit.enabledInSession
                                  ? "关闭：该插件全部工具在本会话不可见（不改项目默认）"
                                  : "开启：恢复该插件全部工具（仅当前会话）"
                          }
                        >
                          <span className="skp-row-default-label">启用</span>
                          <span className="skp-switch">
                            <input
                              type="checkbox"
                              role="switch"
                              aria-label={`启用 ${unit.name}`}
                              checked={unit.enabledInSession}
                              disabled={locked || readOnly || busyUnit === unit.unit}
                              onChange={(event) => void toggleUnit(unit, event.target.checked)}
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
              <div className="skp-detail-empty">选择一个插件查看工具清单（只读）。</div>
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

                {/* 开关 + 状态（A5：解析到当前会话时可点；否则只读并说明去处）。 */}
                <div className="skp-detail-actions">
                  <span className="skp-row-toggle" style={{ marginLeft: 0 }}>
                    <span className="skp-row-default-label">本会话</span>
                    <span className="skp-switch">
                      <input
                        type="checkbox"
                        role="switch"
                        aria-label={`启用 ${selected.name}`}
                        checked={selected.enabledInSession}
                        disabled={selected.lockedReason !== undefined || sessionId === undefined || busyUnit === selected.unit}
                        onChange={(event) => void toggleUnit(selected, event.target.checked)}
                      />
                      <span className="skp-switch-track" />
                    </span>
                  </span>
                  <span className="skp-note">
                    {selected.enabledInSession ? "已启用" : "已关闭"}
                    {sessionId === undefined ? " · 请在对话首屏设置本会话开关" : " · 仅当前会话"}
                  </span>
                </div>

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
                  工具数 {selected.toolCount} · 开关为插件级：关闭后该插件全部工具在本会话不可见
                </div>

                <div className="skp-detail-inspect">
                  <div className="skp-detail-inspect-head">
                    <span className="skp-field-label">
                      工具清单（{selected.toolCount}）· 只读
                    </span>
                    <span className="skp-test-stat">无逐工具开关、无参数表</span>
                  </div>
                  {selected.tools.length === 0 ? (
                    <div className="skp-note">工具清单不可见（该单元当前没有可见工具）。</div>
                  ) : (
                    <ul className="skp-tools-list">
                      {selected.tools.map((tool) => (
                        <li key={tool.name} className="skp-tools-item">
                          <span className="skp-tools-name">{tool.name}</span>
                          <span className="skp-tools-desc">{tool.description ?? "（无说明）"}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* 关闭影响（琥珀条）：插件级开关的后果说清。 */}
                <div className="skp-tools-impact" style={CLOSE_IMPACT_STYLE}>
                  关闭该插件后，本会话模型看不到它的全部 {selected.toolCount} 个工具；能力决策（Jev）以插件整体计分，选中才会启用该插件全部工具；不改项目默认
                </div>

                <p className="skp-note" style={CLOSE_IMPACT_STYLE}>
                  插件级开关，不提供单工具开关；无法 restrict 的插件开关置灰并说明原因；宿主内建基础工具不进入本域。
                </p>
                <p className="skp-note">
                  ※ 本版不做参数表：Tools 没有统一的 inputSchema 承诺；工具清单只读展示名称与说明。
                </p>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
