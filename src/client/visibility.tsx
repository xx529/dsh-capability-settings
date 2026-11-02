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
import type { ReactNode } from "react";
import type {
  CapabilityPanelApi,
  ClientCapabilityDomain,
  ClientCapabilityVisibility,
  ClientGlobalOverrides,
  ClientOverrides,
  ClientVisibilityMode,
  ClientVisibilitySets,
  ClientWorkspaceVisibility,
} from "./api.js";
import { Modal } from "./modal.js";

/** 面板里工作区选项的最小形状（与 scope-chain / panel 的 projects 一致）。 */
export interface VisibilityWorkspace {
  path: string;
  title?: string;
}

/** 空可见性集合（旧宿主 / v1 全局文件缺省）。 */
export const EMPTY_VISIBILITY_SETS: ClientVisibilitySets = { skills: {}, mcp: {}, tools: {} };

/**
 * 防御性读取全局层（旧宿主 / 测试夹具可能没有 `overrides.globalGet`）：
 * 失败返回 undefined，调用方按「全部可见 / 空名单」降级。
 */
export function safeGlobalGet(api: CapabilityPanelApi): Promise<ClientGlobalOverrides | undefined> {
  const overrides = api.overrides;
  if (overrides === undefined || typeof overrides.globalGet !== "function") return Promise.resolve(undefined);
  try {
    return Promise.resolve(overrides.globalGet()).catch(() => undefined);
  } catch {
    return Promise.resolve(undefined);
  }
}

/** 防御性读取项目 overrides（旧宿主 / 测试夹具可能没有 `overrides.get`）。 */
export function safeOverridesGet(api: CapabilityPanelApi): Promise<ClientOverrides | undefined> {
  const overrides = api.overrides;
  if (overrides === undefined || typeof overrides.get !== "function") return Promise.resolve(undefined);
  try {
    return Promise.resolve(overrides.get()).catch(() => undefined);
  } catch {
    return Promise.resolve(undefined);
  }
}

/** 工作区展示名：优先 title，其次目录 basename。 */
export function visibilityWorkspaceTitle(workspace: VisibilityWorkspace): string {
  if (workspace.title !== undefined && workspace.title.trim().length > 0) return workspace.title;
  const segments = workspace.path.split(/[\\/]/).filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? workspace.path;
}

/** 取某个能力的可见性配置（不存在 = 未配置 ⇒ 全部可见、走兜底默认）。 */
export function visibilityEntryOf(
  sets: ClientVisibilitySets | undefined,
  domain: ClientCapabilityDomain,
  key: string,
): ClientCapabilityVisibility | undefined {
  return sets?.[domain]?.[key];
}

/** 可见性模式（缺省 = all，兼容旧宿主 / v1 文件）。 */
export function visibilityModeOf(entry: ClientCapabilityVisibility | undefined): ClientVisibilityMode {
  return entry?.mode ?? "all";
}

/** 某工作区是否可见（与宿主 `visibleIn` 同构：mode + visible:false 覆盖）。 */
export function isWorkspaceVisible(
  entry: ClientCapabilityVisibility | undefined,
  workspacePath: string,
): boolean {
  const mode = visibilityModeOf(entry);
  if (mode === "none") return false;
  const state = entry?.workspaces?.[workspacePath];
  if (state?.visible === false) return false;
  if (mode === "selected") return entry !== undefined && Object.hasOwn(entry.workspaces, workspacePath);
  return true;
}

/** 可见的工作区数；`workspaces` 缺省时用配置里显式出现的 key。 */
export function visibleWorkspaceCountOf(
  entry: ClientCapabilityVisibility | undefined,
  workspaces: VisibilityWorkspace[],
): number {
  if (visibilityModeOf(entry) === "none") return 0;
  const paths = workspaces.length > 0 ? workspaces.map((workspace) => workspace.path) : Object.keys(entry?.workspaces ?? {});
  return paths.filter((path) => isWorkspaceVisible(entry, path)).length;
}

/**
 * 能力是否「不可见」（行尾默认开关应禁用 + 标「不可见 · 不参与默认」）：
 * mode=none，或 selected 模式下没有任何可见工作区。
 */
export function isInvisibleCapability(
  entry: ClientCapabilityVisibility | undefined,
  workspaces: VisibilityWorkspace[],
): boolean {
  const mode = visibilityModeOf(entry);
  if (mode === "none") return true;
  if (mode !== "selected") return false;
  return visibleWorkspaceCountOf(entry, workspaces) === 0;
}

/**
 * 行级不可见判定：宿主行字段优先（`disabledByVisibility` / `visibilityMode` +
 * `visibleWorkspaceCount`），缺省时回落到可见性配置 + 工作区列表计算。
 */
export function isRowInvisible(
  row: { visibilityMode?: ClientVisibilityMode; visibleWorkspaceCount?: number; disabledByVisibility?: boolean },
  entry: ClientCapabilityVisibility | undefined,
  workspaces: VisibilityWorkspace[],
): boolean {
  if (row.disabledByVisibility === true) return true;
  if (row.visibilityMode === "none") return true;
  if (row.visibilityMode === "selected" && (row.visibleWorkspaceCount ?? 0) === 0) return true;
  return isInvisibleCapability(entry, workspaces);
}

/** 某工作区的默认开/关：显式 defaultEnabled 优先，否则走兜底 `!globalOff`。 */
export function workspaceDefaultOf(
  entry: ClientCapabilityVisibility | undefined,
  workspacePath: string,
  globalOff: boolean,
): boolean {
  const explicit = entry?.workspaces?.[workspacePath]?.defaultEnabled;
  return typeof explicit === "boolean" ? explicit : !globalOff;
}

/** 全局视图行内的默认摘要（只在可见工作区上统计；不可见时 undefined）。 */
export function defaultSummaryOf(
  entry: ClientCapabilityVisibility | undefined,
  workspaces: VisibilityWorkspace[],
  globalOff: boolean,
): { on: number; off: number } | undefined {
  if (isInvisibleCapability(entry, workspaces)) return undefined;
  const paths = workspaces.length > 0 ? workspaces.map((workspace) => workspace.path) : Object.keys(entry?.workspaces ?? {});
  let on = 0;
  let off = 0;
  for (const path of paths) {
    if (!isWorkspaceVisible(entry, path)) continue;
    if (workspaceDefaultOf(entry, path, globalOff)) on += 1;
    else off += 1;
  }
  return { on, off };
}

/** 详情一行式可见范围摘要（v21 UX 修订：详情不再内联表格/分段）。 */
export function visibilitySummaryText(
  entry: ClientCapabilityVisibility | undefined,
  workspaces: VisibilityWorkspace[],
  globalOff: boolean,
): string {
  const mode = visibilityModeOf(entry);
  if (mode === "none") return "可见范围：不可见（所有工作区与对话首屏都不出现）";
  const scopeText = mode === "selected" ? `指定 ${visibleWorkspaceCountOf(entry, workspaces)} 个工作区` : "全部工作区";
  const summary = defaultSummaryOf(entry, workspaces, globalOff);
  return summary === undefined ? `可见范围：${scopeText}` : `可见范围：${scopeText} · 默认：${summary.on} 开 / ${summary.off} 关`;
}

/** 工作区视图的「跟随全局默认 / 已覆盖」状态。 */
export type WorkspaceOverrideState = "inherit" | "on" | "off";

/** 从项目 overrides 判断某能力在本工作区是否有显式默认覆盖。 */
export function workspaceOverrideOf(
  overrides: ClientOverrides | undefined,
  domain: ClientCapabilityDomain,
  key: string,
): WorkspaceOverrideState {
  if (overrides === undefined) return "inherit";
  const enabledOf = (): string[] | undefined =>
    domain === "skills"
      ? overrides.enabledSkills
      : domain === "mcp"
        ? overrides.enabledMcp
        : overrides.enabledTools;
  const disabledOf = (): string[] | undefined =>
    domain === "skills" ? overrides.skills : domain === "mcp" ? overrides.mcp : overrides.tools;
  if (enabledOf()?.includes(key) === true) return "on";
  if (disabledOf()?.includes(key) === true) return "off";
  return "inherit";
}

/** 行内可见性标签（全部工作区 / 指定 N / 不可见）。 */
export function VisibilityBadge({
  entry,
  workspaces,
  mode,
  count,
}: {
  entry?: ClientCapabilityVisibility;
  workspaces: VisibilityWorkspace[];
  /** 宿主投影的 visibilityMode 优先（全局视图）。 */
  mode?: ClientVisibilityMode;
  /** 宿主投影的 visibleWorkspaceCount 优先。 */
  count?: number;
}): ReactNode {
  const resolvedMode = mode ?? visibilityModeOf(entry);
  const resolvedCount = count ?? visibleWorkspaceCountOf(entry, workspaces);
  const label =
    resolvedMode === "none" ? "不可见" : resolvedMode === "selected" ? `指定 ${resolvedCount} 个工作区` : "全部工作区";
  const className = resolvedMode === "none" ? "skp-tag skp-tag-warn" : "skp-tag skp-tag-flat";
  const title =
    resolvedMode === "none"
      ? "不可见：工作区列表 / 对话首屏都不出现，运行时强制关闭"
      : resolvedMode === "selected"
        ? `仅 ${resolvedCount} 个工作区可见；其它工作区与对话首屏完全不出现`
        : "全部工作区可见（可在可见范围里单独隐藏某个工作区）";
  return (
    <span className={className} title={title}>
      {label}
    </span>
  );
}

/** 行内「默认：N 开 / M 关」摘要 + 可见性标签（三域行 meta 区共用）。 */
export function VisibilityRowMeta({
  entry,
  workspaces,
  globalOff,
  mode,
  count,
  invisible,
  summaryClassName = "skp-vis-summary",
}: {
  entry?: ClientCapabilityVisibility;
  workspaces: VisibilityWorkspace[];
  globalOff: boolean;
  mode?: ClientVisibilityMode;
  count?: number;
  /** 行级不可见（宿主字段优先）：不可见时不展示「默认 N 开/M 关」摘要。 */
  invisible?: boolean;
  summaryClassName?: string;
}): ReactNode {
  const summary = invisible === true ? undefined : defaultSummaryOf(entry, workspaces, globalOff);
  return (
    <>
      <VisibilityBadge entry={entry} workspaces={workspaces} mode={mode} count={count} />
      {summary !== undefined && (
        <span
          className={summaryClassName}
          title="每个工作区的默认开/关（可在「可见范围」里按工作区设置；工作区仍可覆盖）"
        >
          默认：{summary.on} 开 / {summary.off} 关
        </span>
      )}
    </>
  );
}

/**
 * 详情「可见范围」摘要 + 编辑入口（全局视图用；v21 UX 修订）。
 *
 * 详情不再内联分段控件与工作区表格（太长、把详情裁掉），只保留一行摘要：
 * 「可见范围：全部工作区 · 默认：N 开 / M 关」；模式与每工作区默认都在
 * 「编辑可见范围」弹层里配置（弹层内已有分段 + 表格）。
 */
export function VisibilityDetailFields({
  api,
  domain,
  capabilityKey,
  name,
  entry,
  workspaces,
  globalOff,
  onSaved,
}: {
  api: CapabilityPanelApi;
  domain: ClientCapabilityDomain;
  /** 可见性存储 key：skills=name / mcp=serverName / tools=unit。 */
  capabilityKey: string;
  /** 展示名（弹层标题用）。 */
  name: string;
  entry?: ClientCapabilityVisibility;
  workspaces: VisibilityWorkspace[];
  /** 兜底默认：名字在全局默认关闭名单里。 */
  globalOff: boolean;
  /** 保存成功后回调（面板重拉列表 + 全局层）。 */
  onSaved: () => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const summary = visibilitySummaryText(entry, workspaces, globalOff);
  return (
    <>
      <dt>可见范围</dt>
      <dd>
        <div className="skp-vis-detail-head">
          <span className="skp-vis-detail-summary" title={summary}>
            {summary}
          </span>
          <button type="button" className="skp-btn" onClick={() => setOpen(true)}>
            编辑可见范围
          </button>
        </div>
        {open && (
          <VisibilityModal
            api={api}
            domain={domain}
            capabilityKey={capabilityKey}
            name={name}
            entry={entry}
            workspaces={workspaces}
            globalOff={globalOff}
            onClose={() => setOpen(false)}
            onSaved={() => {
              setOpen(false);
              onSaved();
            }}
          />
        )}
      </dd>
    </>
  );
}

/** 单个工作区的编辑状态。 */
interface WorkspaceEditState {
  visible: boolean;
  /** undefined = 跟随兜底默认（不落盘 defaultEnabled）。 */
  defaultEnabled?: boolean;
}

/** 由现有配置初始化弹层状态。 */
function initEditState(
  entry: ClientCapabilityVisibility | undefined,
  workspaces: VisibilityWorkspace[],
): Record<string, WorkspaceEditState> {
  const state: Record<string, WorkspaceEditState> = {};
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
 * 可见范围编辑弹层：顶部模式分段 + 工作区表格（可见 checkbox + 默认开/关）。
 * 保存提交**整份** workspaces 映射（`overrides.setVisibility`）。
 */
export function VisibilityModal({
  api,
  domain,
  capabilityKey,
  name,
  entry,
  workspaces,
  globalOff,
  onClose,
  onSaved,
}: {
  api: CapabilityPanelApi;
  domain: ClientCapabilityDomain;
  capabilityKey: string;
  name: string;
  entry?: ClientCapabilityVisibility;
  workspaces: VisibilityWorkspace[];
  globalOff: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<ClientVisibilityMode>(visibilityModeOf(entry));
  const [edit, setEdit] = useState<Record<string, WorkspaceEditState>>(() => initEditState(entry, workspaces));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const setModeAndDefaults = (next: ClientVisibilityMode) => {
    setMode(next);
    // 模式切换的默认可见态：全部 ⇒ 全勾选；不可见 ⇒ 全不勾；指定 ⇒ 保留当前勾选。
    if (next === "none" || next === "all") {
      setEdit((current) => {
        const copy = { ...current };
        for (const path of Object.keys(copy)) copy[path] = { ...copy[path], visible: next === "all" };
        return copy;
      });
    }
  };

  const setWorkspaceVisible = (path: string, visible: boolean) => {
    setEdit((current) => ({ ...current, [path]: { ...(current[path] ?? { visible }), visible } }));
  };

  const setWorkspaceDefault = (path: string, defaultEnabled: boolean) => {
    setEdit((current) => ({ ...current, [path]: { ...(current[path] ?? { visible: true }), defaultEnabled } }));
  };

  /**
   * 提交载荷：契约 §4 的**完整映射**（每个已知工作区都显式一行）：
   * - `visible` 恒写；
   * - `defaultEnabled` 只在「可见且用户显式设置过」时写（不可见 / 跟随兜底不落）；
   * - 不可见模式（none）各工作区 `{visible:false}`。
   * 完整映射避免宿主增量合并歧义；`mode=all` 全可见时等价于「未配置」。
   */
  const buildWorkspaces = (): Record<string, ClientWorkspaceVisibility> => {
    const payload: Record<string, ClientWorkspaceVisibility> = {};
    for (const workspace of workspaces) {
      const item = edit[workspace.path];
      if (item === undefined) continue;
      const visible = mode === "none" ? false : item.visible;
      const explicitDefault =
        visible && typeof item.defaultEnabled === "boolean" ? { defaultEnabled: item.defaultEnabled } : {};
      payload[workspace.path] = { visible, ...explicitDefault };
    }
    return payload;
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const result = await api.overrides.setVisibility({
        domain,
        key: capabilityKey,
        mode,
        workspaces: buildWorkspaces(),
      });
      if (!result.ok) {
        setError(result.errors.join("; "));
        return;
      }
      onSaved();
    } catch (failure) {
      setError(String(failure instanceof Error ? failure.message : failure));
    } finally {
      setSaving(false);
    }
  };

  const allVisible = () => {
    setMode("all");
    setEdit((current) => {
      const copy = { ...current };
      for (const path of Object.keys(copy)) copy[path] = { ...copy[path], visible: true };
      return copy;
    });
  };

  return (
    <Modal title={`可见范围 · ${name}`} onClose={onClose}>
      <div className="skp-vis-modal">
        <div className="skp-vis-mode-row">
          <div className="skp-scope-seg" role="group" aria-label="可见范围">
            {(
              [
                { value: "all", label: "全部" },
                { value: "selected", label: "指定" },
                { value: "none", label: "不可见" },
              ] as Array<{ value: ClientVisibilityMode; label: string }>
            ).map((segment) => (
              <button
                key={segment.value}
                type="button"
                className={mode === segment.value ? "skp-scope-seg-btn skp-scope-seg-btn-active" : "skp-scope-seg-btn"}
                aria-pressed={mode === segment.value}
                onClick={() => setModeAndDefaults(segment.value)}
              >
                {segment.label}
              </button>
            ))}
          </div>
          <button type="button" className="skp-link-btn" onClick={allVisible}>
            全部工作区可见
          </button>
        </div>

        <div className="skp-vis-modal-note">
          {mode === "all"
            ? "全部工作区可见；可单独隐藏某个工作区、或为每个工作区设默认开/关。新工作区默认可见、走兜底默认。"
            : mode === "selected"
              ? "仅勾选的工作区可见；新工作区默认不可见，需手动勾选。"
              : "不可见：工作区列表 / 对话首屏都不出现，运行时强制关闭（会话开关不能打开）；旧覆盖保留不删。"}
        </div>

        {workspaces.length === 0 ? (
          <div className="skp-note">还没有已知工作区；新建工作区后再来配置。</div>
        ) : (
          <div className="skp-vis-table" role="table" aria-label="各工作区可见性与默认">
            <div className="skp-vis-table-head" role="row">
              <span role="columnheader">工作区</span>
              <span role="columnheader">可见</span>
              <span role="columnheader">默认</span>
            </div>
            {workspaces.map((workspace) => {
              const item = edit[workspace.path] ?? { visible: false };
              const visible = mode === "none" ? false : item.visible;
              const defaultOn = item.defaultEnabled ?? !globalOff;
              return (
                <div key={workspace.path} className="skp-vis-table-row" role="row" title={workspace.path}>
                  <span className="skp-vis-ws-name" role="cell">
                    {visibilityWorkspaceTitle(workspace)}
                  </span>
                  <span role="cell">
                    <label className="skp-vis-check">
                      <input
                        type="checkbox"
                        checked={visible}
                        disabled={mode === "none"}
                        aria-label={`${visibilityWorkspaceTitle(workspace)} 可见`}
                        onChange={(event) => setWorkspaceVisible(workspace.path, event.target.checked)}
                      />
                      <span>可见</span>
                    </label>
                  </span>
                  <span role="cell">
                    <label className="skp-row-toggle skp-vis-default-toggle" title="该工作区的默认开/关（工作区仍可覆盖）">
                      <span className="skp-row-default-label">{defaultOn ? "默认开" : "默认关"}</span>
                      <span className="skp-switch">
                        <input
                          type="checkbox"
                          role="switch"
                          aria-label={`${visibilityWorkspaceTitle(workspace)} 默认开启`}
                          checked={defaultOn}
                          disabled={mode === "none" || !visible || saving}
                          onChange={(event) => setWorkspaceDefault(workspace.path, event.target.checked)}
                        />
                        <span className="skp-switch-track" />
                      </span>
                    </label>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {error !== undefined && <div className="skp-error">{error}</div>}
        <div className="skp-modal-actions">
          <button type="button" className="skp-btn" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="button" className="skp-btn skp-btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
