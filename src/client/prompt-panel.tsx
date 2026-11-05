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
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type {
  CapabilityPanelApi,
  ClientPromptFile,
  ClientPromptList,
  ClientPromptManifest,
  ClientPromptState,
  ClientVisibilityMode,
  ClientWorkspaceVisibility,
  WorkspaceOption,
} from "./api.js";
import { DetailPage, DetailStrip, DetailTitleBar, StripSeparator } from "./detail-shell.js";
import { MarkdownPreview } from "./markdown.js";
import { Modal } from "./modal.js";
import { useAsyncList } from "./panel-common.js";

// ---------------------------------------------------------------------------
// 展示原语
// ---------------------------------------------------------------------------

/** 状态 pill 文案（宿主 `state` 字典）。 */
const STATE_LABEL: Record<ClientPromptState, string> = {
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
function stateToneClass(state: ClientPromptState): string {
  if (state === "injected") return "skp-prompt-status skp-prompt-status-injected";
  if (state === "disabled" || state === "invisible") return "skp-prompt-status skp-prompt-status-disabled";
  return "skp-prompt-status skp-prompt-status-warn";
}

/** 可见范围模式文案。 */
const MODE_LABEL: Record<ClientVisibilityMode, string> = {
  all: "全部工作区",
  selected: "指定工作区",
  none: "全部不可见",
};

/** 作用域标签（标题行 / 行内）。 */
function scopeTagOf(file: Pick<ClientPromptFile, "scope">): { label: string; className: string; title: string } {
  if (file.scope === "user-global") {
    return { label: "全局", className: "skp-tag skp-tag-global", title: "全局 prompt（$DSH_HOME/AGENTS.md）" };
  }
  if (file.scope === "agents-global") {
    return { label: "全局", className: "skp-tag skp-tag-global", title: "全局 prompt（$DSH_AGENTS_HOME/AGENTS.md）" };
  }
  return { label: "项目", className: "skp-tag skp-tag-project", title: "项目链 prompt（git 根 → 工作区目录，逐级叠加注入）" };
}

/** 字节数（< 1 MiB 用千分位精确值，便于与宿主预算对齐）。 */
function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${Math.round(bytes).toLocaleString("en-US")} B`;
}

/** 路径最后一段（工作区 / 项目展示名）。 */
function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const at = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return at >= 0 ? trimmed.slice(at + 1) || trimmed : trimmed || path;
}

/** 行数（用于「仅预览 N 行」提示）。 */
function lineCount(text: string): number {
  if (text.length === 0) return 0;
  return text.split("\n").length;
}

/** 错误对象转可读文案。 */
function errorText(failure: unknown): string {
  return String(failure instanceof Error ? failure.message : failure);
}

/** 全局 prompt 的可见范围摘要（详情状态条 / 行内 chip 共用）。 */
function visibilitySummaryText(
  file: Pick<ClientPromptFile, "visibility">,
  scope: "global" | "workspace",
): string {
  const visibility = file.visibility;
  if (visibility === undefined) return "可见：全部工作区";
  const base =
    visibility.mode === "none" ? "不可见" : visibility.mode === "selected" ? "指定工作区" : "全部工作区";
  if (scope === "global") return `可见：${base}`;
  return `可见：${base} · 本工作区默认${visibility.defaultEnabled ? "开" : "关"}`;
}

/** 当前工作区的可见性 key（宿主语义项目根：从 cwd 向上找 `.git`）。 */
function currentRootOf(data: ClientPromptList | undefined, workspace: string | undefined): string {
  if (data !== undefined && data.projectRoot.length > 0) return data.projectRoot;
  if (workspace !== undefined && workspace.length > 0) return workspace;
  return data?.cwd ?? "";
}

// ---------------------------------------------------------------------------
// 可见范围弹层的数据收集
// ---------------------------------------------------------------------------

/** 弹层里的一行工作区。 */
interface VisibilityRow {
  root: string;
  title: string;
  path: string;
  visible: boolean;
  defaultEnabled: boolean;
  current: boolean;
}

/** 打开弹层 / 写工作区默认前的完整可见性快照。 */
interface VisibilitySnapshot {
  mode: ClientVisibilityMode;
  rows: VisibilityRow[];
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
async function loadVisibilitySnapshot(
  api: CapabilityPanelApi,
  file: ClientPromptFile,
  projects: WorkspaceOption[],
  current: Omit<VisibilityRow, "current"> | undefined,
): Promise<VisibilitySnapshot> {
  const rows: VisibilityRow[] = [];
  const seen = new Set<string>();
  const add = (row: VisibilityRow) => {
    if (row.root.length === 0 || seen.has(row.root)) return;
    seen.add(row.root);
    rows.push(row);
  };
  // v23.1：宿主列表现在带回完整可见性映射（含未在面板下拉里出现的工作区 key），
  // 一次读取即可整份写回；读不到时再退回逐工作区拉取（旧宿主兼容）。
  try {
    const list = await api.prompt.list();
    const entry = list.visibility[file.scope];
    if (entry !== undefined) {
      if (current !== undefined) add({ ...current, current: true });
      const roots = new Set<string>([
        ...Object.keys(entry.workspaces),
        ...projects.map((project) => project.path),
        ...(current !== undefined ? [current.root] : []),
      ]);
      for (const root of roots) {
        if (root.length === 0 || seen.has(root)) continue;
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
  } catch {
    /* 旧宿主 / 服务缺失：退回逐工作区读取 */
  }
  if (current !== undefined) add({ ...current, current: true });
  const resolved = await Promise.all(
    projects.map(async (project) => {
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
      } catch {
        return {
          root: project.path,
          title: project.title?.trim() ?? baseName(project.path),
          path: project.path,
          visible: true,
          defaultEnabled: true,
          current: false,
        };
      }
    }),
  );
  for (const row of resolved) add(row);
  return { mode: file.visibility?.mode ?? "all", rows };
}

// ---------------------------------------------------------------------------
// 详情页
// ---------------------------------------------------------------------------

/** 正文读取状态。 */
type ReadState =
  | { status: "loading" }
  | { status: "ready"; content: string; truncated: boolean; size: number }
  | { status: "error"; message: string };

/**
 * Prompt 详情（v22 外壳）：
 * 标题行（名称 / 作用域 / 状态）+ 状态条（第 N 位 / 字节 / 预算 / sha1 / 可见范围）
 * + 工具条（预览 / 编辑 / 复制路径）+ 内容区（Markdown 预览 / 文本编辑器）。
 */
function PromptDetail({
  api,
  file,
  list,
  frozen,
  scope,
  projectName,
  readVersion,
  onSaved,
  onOpenVisibility,
}: {
  api: CapabilityPanelApi;
  file: ClientPromptFile;
  list: ClientPromptList;
  frozen?: ClientPromptManifest;
  scope: "global" | "workspace";
  projectName?: string;
  /** 保存成功后自增：强制重读正文。 */
  readVersion: number;
  /** 列表侧需要随之刷新（文件大小 / 状态变化）。 */
  onSaved: () => void;
  onOpenVisibility(): void;
}) {
  const [read, setRead] = useState<ReadState>({ status: "loading" });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
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
        if (!alive) return;
        setRead({ status: "ready", content: value.content, truncated: value.truncated, size: value.size });
      })
      .catch((failure) => {
        if (!alive) return;
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
  const orderText =
    order !== undefined && file.enabled ? `第 ${order} / ${orderTotal} 位` : file.enabled ? "已启用" : "未注入";
  const size = frozenFile?.bytes ?? (read.status === "ready" ? read.size : file.size);
  const digest = frozenFile?.digest;
  const visibilityText = isProject
    ? "仅本项目"
    : visibilitySummaryText(file, scope === "workspace" ? "workspace" : "global");

  // 状态说明（预算 / 去重 / 超限 / 读取失败），直接解释「为什么不是注入」。
  const stateNote = (() => {
    if (file.state === "duplicate") {
      return `内容与保留的那一份重复，宿主按候选组去重折叠（不单独注入）${
        file.duplicateOf !== undefined ? `：${file.duplicateOf}` : ""
      }`;
    }
    if (file.state === "truncated") {
      const item = frozen?.truncated.find((entry) => entry.displayPath === file.displayPath);
      return item !== undefined
        ? `被预算截断：原文 ${formatSize(item.originalBytes)}，实际注入 ${formatSize(item.includedBytes)}`
        : "被预算截断（预算不足时先省略更宽泛的文件，再截断最具体的）";
    }
    if (file.state === "omitted") return "被预算整份省略：预算不足时按「宽泛 → 具体」省略更宽泛的文件";
    if (file.state === "too-large") {
      return `单文件超过 1 MiB（${formatSize(size)}），宿主静默跳过：不注入，也不计入预算省略名单`;
    }
    if (file.state === "unreadable") return "读取失败：宿主跳过该文件（检查权限 / 编码后重试）";
    if (file.state === "invisible") return "全局可见性对本工作区关闭：不注入；如需打开，请在全局视图的「可见范围」里配置";
    if (file.state === "disabled") return "默认关闭：本工作区 / 本项目的新会话不注入该文件；开关在列表行尾";
    return undefined;
  })();

  const enterEdit = () => {
    if (!canEdit) return;
    setDraft((current) => current ?? content ?? "");
    setSaveError(undefined);
    setEditing(true);
  };

  const cancelEdit = () => {
    if (saving) return;
    setDraft(undefined);
    setEditing(false);
    setSaveError(undefined);
  };

  const save = async () => {
    if (draft === undefined || saving) return;
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
    } catch (failure) {
      setSaveError(errorText(failure));
    } finally {
      setSaving(false);
    }
  };

  const copyPath = async () => {
    try {
      await navigator.clipboard?.writeText(file.path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用时静默 */
    }
  };

  const draftBytes = useMemo(() => {
    if (draft === undefined) return 0;
    try {
      return new TextEncoder().encode(draft).length;
    } catch {
      return draft.length;
    }
  }, [draft]);

  const titleTags = (
    <>
      <span className={scopeTagOf(file).className} title={scopeTagOf(file).title}>
        {scopeTagOf(file).label}
      </span>
      {file.kind === "local" && (
        <span className="skp-tag skp-tag-flat" title="本地覆盖文件（与基础文件叠加注入）">
          local
        </span>
      )}
      <span className={stateToneClass(file.state)} title={`宿主状态：${STATE_LABEL[file.state]}`}>
        {STATE_LABEL[file.state]}
      </span>
      {isFrozen && <span className="skp-tag skp-tag-flat">本会话已冻结</span>}
    </>
  );

  return (
    <DetailPage>
      <div className="skp-detail-head-wrap">
        <DetailTitleBar title={file.name} tags={titleTags} />
        <DetailStrip>
          <span className="skp-strip-item skp-strip-ellipsis" title={file.path}>
            {file.displayPath}
          </span>
          <StripSeparator />
          <span className="skp-strip-item">
            {file.enabled ? (
              <>
                第 <span className="skp-strip-strong">{order ?? "—"}</span> / {orderTotal} 位
              </>
            ) : (
              orderText
            )}
          </span>
          <StripSeparator />
          <span className="skp-strip-item" title={`文件字节数 / 渲染预算`}>
            {formatSize(size)} / {formatSize(list.budget.maxBytes)}
          </span>
          {digest !== undefined && digest.length > 0 && (
            <>
              <StripSeparator />
              <span className="skp-strip-item" title="本会话冻结清单里的全文 SHA-1">
                sha1 <span className="skp-strip-strong">{digest.slice(0, 8)}</span>
              </span>
            </>
          )}
          {!isProject && (
            <>
              <StripSeparator />
              <span className="skp-strip-item" title={file.path}>
                {visibilityText}
              </span>
            </>
          )}
          {frozen !== undefined && (
            <>
              <StripSeparator />
              <span className="skp-strip-item">冻结于 {new Date(frozen.at).toLocaleTimeString()}</span>
            </>
          )}
          {!isProject && !isFrozen && scope === "global" && (
            <span className="skp-strip-right">
              <button
                type="button"
                className="skp-strip-meta-btn"
                title="按工作区配置可见范围与默认启用"
                onClick={onOpenVisibility}
              >
                编辑可见范围
              </button>
            </span>
          )}
        </DetailStrip>
      </div>

      <div className="skp-detail-toolbar">
        <button
          type="button"
          className={editing ? "skp-btn" : "skp-btn skp-btn-primary"}
          disabled={saving}
          onClick={() => {
            if (saving) return;
            setEditing(false);
            setSaveError(undefined);
          }}
        >
          预览
        </button>
        {!isFrozen && (
          <button
            type="button"
            className={editing ? "skp-btn skp-btn-primary" : "skp-btn"}
            disabled={!canEdit}
            title="编辑 prompt 正文"
            onClick={enterEdit}
          >
            编辑
          </button>
        )}
        <span className="skp-toolbar-stat">
          {isFrozen
            ? "只读 · 本会话已冻结"
            : editing
              ? dirty
                ? "草稿未保存"
                : "无改动"
              : read.status === "ready"
                ? `${lineCount(read.content)} 行`
                : read.status === "loading"
                  ? "读取中…"
                  : "正文不可用"}
        </span>
        <span className="skp-toolbar-right">
          <button type="button" className="skp-btn" onClick={() => void copyPath()}>
            {copied ? "已复制路径" : "复制路径"}
          </button>
          {editing && (
            <>
              <button type="button" className="skp-btn" disabled={saving} onClick={cancelEdit}>
                取消
              </button>
              <button
                type="button"
                className="skp-btn skp-btn-primary"
                disabled={saving || !dirty}
                title={dirty ? "保存到原文件（原子写）；只影响新会话" : "没有改动"}
                onClick={() => void save()}
              >
                {saving ? "保存中…" : "保存"}
              </button>
            </>
          )}
        </span>
      </div>

      <div className="skp-detail-body">
        {isFrozen && (
          <div className="skp-detail-readonly">
            <span className="skp-detail-readonly-icon" aria-hidden="true">
              i
            </span>
            <span>
              本会话已冻结：首轮注入的内容在会话开始时固定，详情只读（编辑与开关已隐藏）。改动只影响新会话。
            </span>
          </div>
        )}
        {saveError !== undefined && <div className="skp-error">保存失败：{saveError}</div>}
        {read.status === "error" && (
          <div className="skp-error">
            读取失败：{read.message}
            {(file.state === "too-large" || size > 1024 * 1024) && "（文件超过 1 MiB，宿主会跳过注入，不支持预览 / 编辑）"}
          </div>
        )}
        {stateNote !== undefined && file.state !== "injected" && (
          <div className="skp-note skp-note-warn" style={{ marginBottom: 8 }}>
            {stateNote}
          </div>
        )}

        {read.status === "loading" && !editing ? (
          <div className="skp-detail-loading">读取中…</div>
        ) : editing ? (
          <div className="skp-prompt-editor-wrap">
            <textarea
              className="skp-prompt-editor"
              aria-label={`编辑 ${file.name}`}
              spellCheck={false}
              value={draft ?? ""}
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="skp-prompt-editor-meta">
              <span>
                {formatSize(draftBytes)} · {lineCount(draft ?? "")} 行
              </span>
              {dirty && <span className="skp-prompt-warn">未保存</span>}
              <span style={{ marginLeft: "auto" }}>保存后仅对新会话生效</span>
            </div>
          </div>
        ) : read.status === "ready" ? (
          <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", paddingRight: 4 }}>
            <MarkdownPreview source={read.content} />
            <div className="skp-prompt-editor-meta" style={{ marginTop: 10 }}>
              <span>
                仅预览 {read.content.length > 255 * 1024 ? "前 256 KB" : "全文"} · {lineCount(read.content)} 行
              </span>
              {read.truncated && <span className="skp-prompt-warn">正文超出预览上限，已截断显示</span>}
            </div>
          </div>
        ) : null}

        <div className="skp-prompt-note" style={{ marginTop: 10, flex: "none" }}>
          <span className="skp-prompt-note-title">保存后：仅对新会话生效</span>
          <span>
            新会话首次读取新内容；当前会话保持冻结（已注入的 prompt 不变）。当前会话的注入选择在对话首屏 / 会话「能力」
            Tab 里单独调整。
          </span>
        </div>

        <div className="skp-prompt-note" style={{ marginTop: 8, flex: "none" }}>
          <span className="skp-prompt-note-title">首轮注入规则（由本插件按宿主语义复刻）</span>
          <span>
            顺序：$DSH_HOME/AGENTS.md → $DSH_AGENTS_HOME/AGENTS.md → 项目根到工作区目录逐级（每级 AGENTS.md →
            CLAUDE.md → *.local.md）
          </span>
          <span>
            去重：同一候选组内 trim 后内容 SHA-1 相同者只注入一次（CLAUDE.md 复制 AGENTS.md 时折叠）；全局与项目
            <span className="skp-strip-strong">叠加注入</span>，不互相覆盖。
          </span>
          <span>
            预算：默认 {formatSize(list.budget.maxBytes)}；超限先省略更宽泛的文件，再截断最具体的，并在正文写入 budget
            提示。
          </span>
          <span>
            上限：单文件 &gt; {formatSize(list.budget.maxSourceBytes)} 静默跳过（不注入，也不计入预算省略名单）。
          </span>
          {projectName !== undefined && <span>项目根：{list.projectRoot || projectName}</span>}
        </div>
      </div>
    </DetailPage>
  );
}

// ---------------------------------------------------------------------------
// 可见范围弹层
// ---------------------------------------------------------------------------

/** 整份写回时用的状态 key（顺序无关的 dirty 判定）。 */
function snapshotKey(mode: ClientVisibilityMode, rows: VisibilityRow[]): string {
  return `${mode}|${rows
    .map((row) => `${row.root}:${row.visible ? 1 : 0}:${row.defaultEnabled ? 1 : 0}`)
    .join(",")}`;
}

/**
 * 全局 prompt 的「可见范围」弹层（v23 帧 04）：
 * mode 三选（全部工作区 / 指定工作区 / 全部不可见）+ 每工作区的「可见 / 默认启用」两列；
 * 保存写 `prompt.setVisibility`（**整份替换**那个 scope 的配置）。
 */
function PromptVisibilityModal({
  api,
  file,
  scope,
  projects,
  current,
  onClose,
  onSaved,
}: {
  api: CapabilityPanelApi;
  file: ClientPromptFile;
  /** 当前面板作用域（决定「当前」标记与文案）。 */
  scope: "global" | "workspace";
  projects: WorkspaceOption[];
  /** 工作区视图的当前工作区行（key = list.projectRoot）。 */
  current?: Omit<VisibilityRow, "current">;
  onClose(): void;
  onSaved(): void;
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [initial, setInitial] = useState<VisibilitySnapshot | undefined>(undefined);
  const [mode, setMode] = useState<ClientVisibilityMode>("all");
  const [rows, setRows] = useState<VisibilityRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(undefined);
    void loadVisibilitySnapshot(api, file, projects, current)
      .then((snapshot) => {
        if (!alive) return;
        setInitial(snapshot);
        setMode(snapshot.mode);
        setRows(snapshot.rows);
        setLoading(false);
      })
      .catch((failure) => {
        if (!alive) return;
        setLoadError(errorText(failure));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
    // `current` 每个 render 都是新对象；用其 key 值作为依赖，避免弹层反复重载。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, file.id, projects, current?.root]);

  const dirty =
    initial !== undefined && (mode !== initial.mode || snapshotKey(mode, rows) !== snapshotKey(initial.mode, initial.rows));

  const setRow = (root: string, patch: Partial<Pick<VisibilityRow, "visible" | "defaultEnabled">>) => {
    setRows((prev) => prev.map((row) => (row.root === root ? { ...row, ...patch } : row)));
  };

  const save = async () => {
    if (saving || !dirty || file.scope === "project") return;
    setSaving(true);
    setError(undefined);
    try {
      const workspaces: Record<string, ClientWorkspaceVisibility> = {};
      for (const row of rows) {
        workspaces[row.root] = row.visible
          ? { visible: true, defaultEnabled: row.defaultEnabled }
          : { visible: false };
      }
      await api.prompt.setVisibility({ scope: file.scope, mode, workspaces });
      onSaved();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setSaving(false);
    }
  };

  const note =
    mode === "none"
      ? "不可见：该工作区的任何会话都不能注入这个 prompt；会话首屏不能反向打开。"
      : mode === "selected"
        ? "仅勾选的工作区可见；新工作区默认不可见，需回来手动勾选。"
        : "全部工作区可见；可用「可见」列单独隐藏某个工作区。新工作区默认可见。";

  return (
    <Modal
      title={`${file.name} · 全局可见范围`}
      wide
      onClose={onClose}
      header={
        <>
          <div className="skp-vis-tip" title={file.path}>
            {file.displayPath}
          </div>
          <div className="skp-vis-modal-note">
            可见 = 该工作区的会话可以注入这个 prompt；默认 = 可见时是否默认启用（会话首屏可再单独改）。
          </div>
          <div className="skp-scope-seg" role="group" aria-label="可见范围模式">
            {(Object.keys(MODE_LABEL) as ClientVisibilityMode[]).map((value) => (
              <button
                key={value}
                type="button"
                className={mode === value ? "skp-scope-seg-btn skp-scope-seg-btn-active" : "skp-scope-seg-btn"}
                aria-pressed={mode === value}
                disabled={saving || loading}
                onClick={() => setMode(value)}
              >
                {MODE_LABEL[value]}
              </button>
            ))}
          </div>
          <div className="skp-vis-modal-note">{note}</div>
          {loadError !== undefined && <div className="skp-error">可见性读取失败：{loadError}</div>}
          {error !== undefined && <div className="skp-error">{error}</div>}
        </>
      }
      footer={
        <>
          <button type="button" className="skp-btn" disabled={saving} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className={dirty && !saving ? "skp-btn skp-btn-primary" : "skp-btn"}
            disabled={saving || loading || !dirty}
            title={dirty ? "保存可见范围与每工作区默认" : "没有改动"}
            onClick={() => void save()}
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </>
      }
    >
      {loading ? (
        <div className="skp-status">读取各工作区可见性…</div>
      ) : rows.length === 0 ? (
        <div className="skp-note">还没有已知工作区；新建工作区后再来配置。</div>
      ) : (
        <>
          <div className="skp-prompt-vis-row" style={{ background: "transparent", boxShadow: "none", padding: "0 12px" }}>
            <span className="skp-prompt-vis-name" style={{ fontWeight: 600 }}>
              工作区
            </span>
            <span className="skp-prompt-vis-path" style={{ fontWeight: 600 }}>
              项目根（可见性 key）
            </span>
            <span className="skp-prompt-vis-name" style={{ flex: "none", width: 70, textAlign: "center" }}>
              可见
            </span>
            <span className="skp-prompt-vis-name" style={{ flex: "none", width: 90, textAlign: "right" }}>
              默认启用
            </span>
          </div>
          <div role="table" aria-label="各工作区可见性与默认启用">
            {rows.map((row) => (
              <div key={row.root} className="skp-prompt-vis-row" role="row" title={row.root}>
                <span className="skp-prompt-vis-name" role="cell" title={row.title}>
                  {row.title}
                  {row.current && (
                    <span className="skp-tag skp-tag-flat" style={{ marginLeft: 6 }}>
                      当前
                    </span>
                  )}
                </span>
                <span className="skp-prompt-vis-path" role="cell" title={row.path}>
                  {row.root}
                </span>
                <span role="cell" style={{ flex: "none", width: 70, display: "flex", justifyContent: "center" }}>
                  <label className="skp-vis-check" title="该工作区可见（可见性高优先级控制）">
                    <input
                      type="checkbox"
                      checked={row.visible}
                      disabled={saving || mode === "none"}
                      aria-label={`${row.title} 可见`}
                      onChange={(event) => setRow(row.root, { visible: event.target.checked })}
                    />
                    <span className="skp-sr-only">可见</span>
                  </label>
                </span>
                <span role="cell" style={{ flex: "none", width: 90, display: "flex", justifyContent: "flex-end" }}>
                  <label
                    className="skp-row-toggle"
                    title={
                      row.visible ? "该工作区的默认开 / 关（工作区视图仍可覆盖）" : "不可见时默认开关不生效"
                    }
                  >
                    <span className="skp-switch">
                      <input
                        type="checkbox"
                        role="switch"
                        aria-label={`${row.title} 默认启用`}
                        checked={row.visible && row.defaultEnabled}
                        disabled={saving || mode === "none" || !row.visible}
                        onChange={(event) => setRow(row.root, { defaultEnabled: event.target.checked })}
                      />
                      <span className="skp-switch-track" />
                    </span>
                  </label>
                </span>
              </div>
            ))}
          </div>
          <div className="skp-note">
            不可见 ⇒ 该工作区的任何会话都不能注入；会话首屏不能反向打开。默认启用只在可见时生效。
          </div>
        </>
      )}
    </Modal>
  );
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
export function PromptView({
  api,
  workspace,
  projects = [],
  query,
  onCount,
}: {
  api: CapabilityPanelApi;
  /** 当前工作区路径（undefined = 全局作用域）。 */
  workspace?: string;
  /** 全部已知工作区（可见范围弹层 / 工作区默认用）。 */
  projects?: WorkspaceOption[];
  /** 根组件头部搜索框的当前值。 */
  query: string;
  /** 数据到达后上报「已启用文件数」（域 Tab 计数）。 */
  onCount?: (count: number) => void;
}) {
  const promptSupported = typeof api.prompt?.list === "function";
  const scope: "global" | "workspace" = workspace === undefined ? "global" : "workspace";
  const projectName =
    workspace === undefined
      ? undefined
      : (projects.find((project) => project.path === workspace)?.title?.trim() ?? baseName(workspace));

  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | undefined>(undefined);
  const [opError, setOpError] = useState<string | undefined>(undefined);
  const [visibilityFile, setVisibilityFile] = useState<ClientPromptFile | undefined>(undefined);
  const [readVersion, setReadVersion] = useState(0);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  /** 可见性快照缓存（按文件 id；写操作后失效）。 */
  const visibilityCache = useRef(new Map<string, VisibilitySnapshot>());

  const { data, loading, error, reload } = useAsyncList(
    async () =>
      typeof api.prompt?.list === "function"
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
          },
    [api, workspace, scope],
    { cacheKey: `prompt:${workspace ?? "global"}` },
  );

  // 切换作用域后，可见性快照里「当前工作区」的 key 会变，必须失效缓存。
  useEffect(() => {
    visibilityCache.current.clear();
  }, [workspace]);

  const files = useMemo(() => data?.files ?? [], [data]);
  const isFrozen = data?.frozen !== undefined;
  /** 当前作用域展示的文件：全局视图只看全局 prompt；工作区视图两者叠加。 */
  const scopedFiles = useMemo(
    () => (scope === "global" ? files.filter((file) => file.scope !== "project") : files),
    [files, scope],
  );
  const globalFiles = useMemo(() => scopedFiles.filter((file) => file.scope !== "project"), [scopedFiles]);
  const projectFiles = useMemo(() => scopedFiles.filter((file) => file.scope === "project"), [scopedFiles]);
  const enabledCount = useMemo(() => scopedFiles.filter((file) => file.enabled).length, [scopedFiles]);

  // Tab 计数 = 当前作用域已启用文件数（搜索不影响计数；加载中不覆盖）。
  useEffect(() => {
    if (!loading && error === undefined) onCount?.(enabledCount);
  }, [enabledCount, loading, error, onCount]);

  // 首次到达 / 选中项消失时选中第一项。
  useEffect(() => {
    if (scopedFiles.length === 0) {
      if (selectedId !== undefined) setSelectedId(undefined);
      return;
    }
    if (selectedId !== undefined && scopedFiles.some((file) => file.id === selectedId)) return;
    setSelectedId(scopedFiles[0]?.id);
  }, [scopedFiles, selectedId]);

  const q = query.trim().toLowerCase();
  const matches = (file: ClientPromptFile): boolean => {
    if (q.length === 0) return true;
    return (
      file.name.toLowerCase().includes(q) ||
      file.displayPath.toLowerCase().includes(q) ||
      file.path.toLowerCase().includes(q)
    );
  };
  const matchedFiles = useMemo(() => scopedFiles.filter(matches), [scopedFiles, q]);
  const matchedGlobal = matchedFiles.filter((file) => file.scope !== "project");
  const matchedProject = matchedFiles.filter((file) => file.scope === "project");
  const selected = scopedFiles.find((file) => file.id === selectedId);

  /** 行尾开关的勾选态：全局 prompt = 本工作区默认；项目 prompt = 本项目默认。 */
  const checkedOf = (file: ClientPromptFile): boolean => {
    if (file.scope === "project") return file.defaultEnabled;
    return file.visibility?.defaultEnabled ?? file.defaultEnabled;
  };

  const toggleDisabledOf = (file: ClientPromptFile): boolean => {
    if (busyId === file.id) return true;
    // 全局 prompt 对本工作区不可见时，工作区视图不能反向打开（可见性是更上层的 gate）。
    if (file.scope !== "project" && file.state === "invisible") return true;
    return false;
  };

  const switchTitleOf = (file: ClientPromptFile): string => {
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
  const currentVisibilityRow = (file: ClientPromptFile): Omit<VisibilityRow, "current"> | undefined => {
    if (scope !== "workspace" || data === undefined) return undefined;
    const root = currentRootOf(data, workspace);
    if (root.length === 0) return undefined;
    return {
      root,
      title: projectName ?? baseName(root),
      path: workspace ?? data.cwd,
      visible: file.visibility?.visible ?? true,
      defaultEnabled: file.visibility?.defaultEnabled ?? true,
    };
  };

  const snapshotFor = async (file: ClientPromptFile): Promise<VisibilitySnapshot> => {
    const cached = visibilityCache.current.get(file.id);
    if (cached !== undefined) return cached;
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
  const toggleFile = async (file: ClientPromptFile, next: boolean) => {
    if (isFrozen || busyId !== undefined) return;
    if (file.scope !== "project" && file.state === "invisible") return;
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
      } else {
        if (data === undefined) return;
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
        const workspaces: Record<string, ClientWorkspaceVisibility> = {};
        for (const row of rows) {
          workspaces[row.root] = row.visible
            ? { visible: true, defaultEnabled: row.root === root ? next : row.defaultEnabled }
            : { visible: false };
        }
        await api.prompt.setVisibility({ scope: file.scope, mode: snapshot.mode, workspaces });
      }
      visibilityCache.current.delete(file.id);
      reload({ silent: true });
    } catch (failure) {
      setOpError(errorText(failure));
    } finally {
      setBusyId(undefined);
    }
  };

  const focusRow = (id: string) => {
    const element = rowRefs.current.get(id);
    element?.focus();
    element?.scrollIntoView({ block: "nearest" });
  };

  const onRowKeyDown = (event: ReactKeyboardEvent<HTMLElement>, id: string) => {
    if (matchedFiles.length === 0) return;
    const index = matchedFiles.findIndex((file) => file.id === id);
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next =
        event.key === "Home"
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
  const renderRow = (file: ClientPromptFile) => {
    const active = file.id === selectedId;
    const isProject = file.scope === "project";
    const scopeTag = scopeTagOf(file);
    const checked = checkedOf(file);
    const disabled = toggleDisabledOf(file);
    const chipMode = file.visibility?.mode ?? "all";
    return (
      <li key={file.id} className={active ? "skp-row-wrap skp-row-wrap-active" : "skp-row-wrap"}>
        <button
          type="button"
          role="option"
          aria-selected={active}
          tabIndex={active ? 0 : -1}
          className={active ? "skp-row skp-row-active" : "skp-row"}
          ref={(element) => {
            if (element === null) rowRefs.current.delete(file.id);
            else rowRefs.current.set(file.id, element);
          }}
          onClick={() => setSelectedId(file.id)}
          onKeyDown={(event) => onRowKeyDown(event, file.id)}
        >
          <span className="skp-row-name">
            <span
              className={file.enabled ? "skp-dot skp-dot-enabled" : "skp-dot skp-dot-hollow"}
              aria-hidden="true"
            />
            <span className="skp-row-title" title={file.name}>
              {file.name}
            </span>
            <span className={scopeTag.className} title={scopeTag.title}>
              {scopeTag.label}
            </span>
            {file.kind === "local" && (
              <span className="skp-tag skp-tag-flat" title="本地覆盖文件（与基础文件叠加注入）">
                local
              </span>
            )}
          </span>
          <span
            className="skp-row-desc"
            title={file.displayPath}
            style={{ fontFamily: "var(--ds-font-family-code,ui-monospace,monospace)", fontSize: 11, lineHeight: "16px" }}
          >
            {file.displayPath}
          </span>
          <span className="skp-row-meta">
            <span className={stateToneClass(file.state)} title={`宿主状态：${STATE_LABEL[file.state]}`}>
              {STATE_LABEL[file.state]}
            </span>
            <span>{formatSize(file.size)}</span>
            {isFrozen && file.order !== undefined && <span>第 {file.order} 位</span>}
            {file.duplicateOf !== undefined && (
              <span title={file.duplicateOf}>折叠自 {baseName(file.duplicateOf)}</span>
            )}
          </span>
        </button>
        {/* 全局视图：行内无开关；全局 prompt 的可见范围在弹层里配（与 Skills/MCP 同口径）。 */}
        {scope === "global" && !isFrozen && (
          <button
            type="button"
            className="skp-tag skp-tag-flat"
            title={`可见范围：${visibilitySummaryText(file, "global")}（点击按工作区配置可见与默认）`}
            onClick={() => setVisibilityFile(file)}
          >
            可见：{MODE_LABEL[chipMode]} ▾
          </button>
        )}
        {/* 工作区视图：行尾开关写默认层（全局 = 本工作区默认；项目 = 本项目默认）。 */}
        {scope === "workspace" && !isFrozen && (
          file.state === "duplicate" ? (
            <span
              className="skp-row-default-label"
              title="同候选组内容重复，宿主自动折叠；不单独注入，因此没有独立开关"
            >
              自动合并
            </span>
          ) : (
            <label className="skp-row-toggle" title={switchTitleOf(file)}>
              <span className="skp-switch">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={`${file.name} ${isProject ? "本项目默认启用" : "本工作区默认启用"}`}
                  checked={checked}
                  disabled={disabled}
                  onChange={(event) => void toggleFile(file, event.target.checked)}
                />
                <span className="skp-switch-track" />
              </span>
            </label>
          )
        )}
      </li>
    );
  };

  const renderGroupHead = (title: string, count: number, note: string) => (
    <div className="skp-prompt-group-head">
      <span>{title}</span>
      <span className="skp-group-count">{count}</span>
      <span className="skp-prompt-group-note">{note}</span>
    </div>
  );

  const listTitle = scope === "global" ? "全局 Prompt" : `${projectName ?? "工作区"} · Prompt`;
  const listNote = scope === "global" ? "所有工作区" : "仅此工作区";
  const projectRootName = data !== undefined && data.projectRoot.length > 0 ? baseName(data.projectRoot) : (projectName ?? "项目");

  const renderListBody = () => {
    if (loading && data === undefined) return <div className="skp-status">加载中…</div>;
    if (error !== undefined) return <div className="skp-error">读取失败：{error}</div>;
    if (scopedFiles.length === 0) {
      return (
        <div className="skp-empty">
          {scope === "global"
            ? "还没有已存在的全局 prompt 文件（$DSH_HOME/AGENTS.md、$DSH_AGENTS_HOME/AGENTS.md）。"
            : "此工作区还没有已存在的 prompt 文件（项目根到工作区目录的 AGENTS.md / CLAUDE.md / *.local.md）。"}
          <div className="skp-pane-note">列表只显示已存在且被宿主识别的文件；未创建的文件不会出现。</div>
        </div>
      );
    }
    if (matchedFiles.length === 0) return <div className="skp-empty">没有匹配「{query.trim()}」的 prompt 文件。</div>;
    return (
      <div className="skp-group-scroll skp-group-scroll-plain">
        {matchedGlobal.length > 0 && (
          <>
            {renderGroupHead(
              "全局（叠加注入）",
              globalFiles.length,
              scope === "global" ? "可见范围按工作区配置" : "叠加注入 · 行尾开关 = 本工作区默认",
            )}
            <ul className="skp-list" role="listbox" aria-label="全局 Prompt">
              {matchedGlobal.map(renderRow)}
            </ul>
          </>
        )}
        {scope === "workspace" && matchedProject.length > 0 && (
          <>
            {renderGroupHead(`项目链 · ${projectRootName}`, projectFiles.length, "git 根 → 工作区目录 · 行尾开关 = 本项目默认")}
            <ul className="skp-list" role="listbox" aria-label="项目链 Prompt">
              {matchedProject.map(renderRow)}
            </ul>
          </>
        )}
      </div>
    );
  };

  if (!promptSupported) {
    return (
      <div className="skp-status" role="status">
        Prompt 域不可用（宿主版本较旧或服务未就绪）
      </div>
    );
  }
  const engineAvailable = data?.engineAvailable !== false;
  const visibilityCurrent = visibilityFile === undefined ? undefined : currentVisibilityRow(visibilityFile);

  return (
    <div className="skp-domain">
      {opError !== undefined && <div className="skp-error">{opError}</div>}
      {error !== undefined && <div className="skp-error">读取失败：{error}</div>}
      {error === undefined && data !== undefined && data.errors.length > 0 && (
        <div className="skp-error">{data.errors.join("\n")}</div>
      )}
      {error === undefined && data !== undefined && !engineAvailable && (
        <div className="skp-prompt-note" style={{ margin: "8px 0" }}>
          <span className="skp-prompt-note-title">宿主渲染器不可用</span>
          <span>本机宿主渲染器不可用：prompt 开关暂不生效，注入仍由宿主默认行为提供。</span>
        </div>
      )}
      {loading && data === undefined && <div className="skp-status">加载中…</div>}

      {data !== undefined && error === undefined && (
        <div className="skp-body">
          {/* 左列：分组列表。 */}
          <div className="skp-list-pane">
            <div className="skp-list-head">
              <span className="skp-list-title" title={listTitle}>
                {listTitle}
              </span>
              <span className="skp-group-count" title="当前作用域已存在的文件数">
                {q.length > 0 ? `${matchedFiles.length} / ${scopedFiles.length}` : scopedFiles.length}
              </span>
              <span className="skp-list-note">{listNote}</span>
              {loading && data !== undefined && <span className="skp-refresh-note">刷新中…</span>}
              <span className="skp-detail-head-spacer" />
              <span className="skp-pane-title-note">{enabledCount} 已启用</span>
            </div>
            {scope === "global" ? (
              <div
                className="skp-pane-note"
                title="全局视图行内不设单开关（与 Skills / MCP 一致）：默认与可见范围在行尾「可见范围」弹层里按工作区配置"
              >
                行内不设单开关 · 默认与可见范围在弹层里按工作区配
              </div>
            ) : (
              <div
                className="skp-pane-note"
                title="全局 + 项目 prompt 叠加注入（不互相覆盖）；行尾开关只写默认层，不改文件内容"
              >
                叠加注入（不覆盖）· 行尾开关只写默认层，不改文件内容
              </div>
            )}
            {isFrozen && <div className="skp-pane-note">本会话已冻结 · 详情只读</div>}
            {renderListBody()}
          </div>

          {/* 右列：详情（v22 外壳）。 */}
          <div className="skp-detail skp-detail-fixed skp-detail-flush">
            {selected === undefined ? (
              <div className="skp-detail-empty">
                {scopedFiles.length === 0 ? "此作用域还没有可注入的 prompt 文件。" : "选择一个 prompt 文件查看内容。"}
              </div>
            ) : (
              <PromptDetail
                key={selected.id}
                api={api}
                file={selected}
                list={data}
                {...(data.frozen !== undefined ? { frozen: data.frozen } : {})}
                scope={scope}
                {...(projectName !== undefined ? { projectName } : {})}
                readVersion={readVersion}
                onSaved={() => {
                  setReadVersion((value) => value + 1);
                  reload({ silent: true });
                }}
                onOpenVisibility={() => setVisibilityFile(selected)}
              />
            )}
          </div>
        </div>
      )}

      {visibilityFile !== undefined && visibilityFile.scope !== "project" && (
        <PromptVisibilityModal
          api={api}
          file={visibilityFile}
          scope={scope}
          projects={projects}
          {...(visibilityCurrent !== undefined ? { current: visibilityCurrent } : {})}
          onClose={() => setVisibilityFile(undefined)}
          onSaved={() => {
            visibilityCache.current.delete(visibilityFile.id);
            setVisibilityFile(undefined);
            reload({ silent: true });
          }}
        />
      )}
    </div>
  );
}
