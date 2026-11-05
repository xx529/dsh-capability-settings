/**
 * 会话能力弹层 / 会话「能力」Tab 的第 4 个域：Prompt（首轮注入的指令文件，v23）。
 *
 * 语义（与宿主 `src/prompt/*` 对齐）：
 *   - 候选 = 全局 `~/.dsh/AGENTS.md`、`~/.agents/AGENTS.md` + 项目根→cwd 每层的
 *     `AGENTS.md` / `CLAUDE.md`（含 `*.local.md`）；全局与项目**叠加注入**，不是覆盖；
 *   - 首屏（hero / modal）可编辑：卡片开关写**本会话首屏显式选择**
 *     `api.prompt.setSessionSelection({ selected })`；默认全选 = 未设置选择时
 *     `list().files[].enabled` 全为 true（与 DSH 原生一致）；
 *   - 会话内（view）只读：数据以 `list().frozen`（manifest）为唯一权威，
 *     只展示状态、不发任何开关请求；
 *   - Prompt **不参与** Jev 能力决策、不参与三域批量动作（`BULK_DOMAINS` 仍三域）。
 *
 * 为什么单独一个文件：`composer-capability.tsx` 已经 3k 行，Prompt 是独立域；
 * 这里只复用主文件已有的 `skp-dock-*` 样式原语（样式表 `styles.ts` 归他人维护，
 * 本批不改），因此开关/标签/图标在这里各自内联一份小实现（不跨文件循环依赖）。
 *
 * @module dsh-capability-settings/client/prompt-tab
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CapabilityPanelApi,
  ClientPromptFile,
  ClientPromptList,
  ClientPromptManifest,
  ClientPromptScope,
} from "./api.js";
import { formatSize } from "./skill-content.js";
import { createPortal } from "react-dom";
import { MarkdownPreview } from "./markdown.js";

// ---------------------------------------------------------------------------
// 图标（内联 SVG，颜色走 currentColor；与 composer-capability 的图标套系同档）
// ---------------------------------------------------------------------------

/** 指令文件：文档图标。 */
function DocIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 2.5h5l3 3v8H4v-11z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M9 2.5v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M6 8.5h4M6 10.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** 冻结：锁。 */
function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.5 7V5.5a2.5 2.5 0 0 1 5 0V7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 数据层：一次拉取 + 首屏写入 + 只读冻结清单
// ---------------------------------------------------------------------------

/** Prompt Tab 的视图状态（面板标题计数与内容共用）。 */
export interface PromptTabData {
  list?: ClientPromptList;
  /** 本会话冻结清单（只读页的唯一权威数据源）。 */
  frozen?: ClientPromptManifest;
  files: ClientPromptFile[];
  loading: boolean;
  error?: string;
  /** 正在写的文件 id（写会话选择期间禁用全部开关）。 */
  pendingId?: string;
  /** 首屏：当前会注入的文件数（`enabled`）。 */
  enabledCount: number;
  /** 只读页：首轮冻结清单里的文件数。 */
  injectedCount: number;
  fileCount: number;
  refresh: () => void;
  toggle: (file: ClientPromptFile) => void;
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 两个 id 集合是否完全一致（顺序无关）。 */
function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((item) => set.has(item));
}

/**
 * Prompt Tab 数据控制器：`list()` 每会话 API（adapter 自动注入 sessionId）。
 *
 * 写口径（二选一，见 `toggle` 注释）：**与默认启用集合一致时写 `null`**（清除
 * 显式选择、跟随默认层），否则写整份 `selected` 数组。
 *
 * @param api 面板 / 每会话 api（旧宿主可能缺 `prompt`，运行时降级提示）。
 * @param readOnly 只读页（mode="view"）；`true` 时额外读 `manifest` 兜底。
 */
export function usePromptTabData(api: CapabilityPanelApi | undefined, readOnly: boolean): PromptTabData {
  const [list, setList] = useState<ClientPromptList | undefined>(undefined);
  const [frozen, setFrozen] = useState<ClientPromptManifest | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pendingId, setPendingId] = useState<string | undefined>(undefined);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    if (api === undefined || typeof api.prompt?.list !== "function") {
      setLoading(false);
      setError("Prompt 域不可用（宿主未提供 prompt API）");
      return;
    }
    let alive = true;
    setLoading(true);
    setError(undefined);
    void (async () => {
      try {
        const next = await api.prompt.list();
        if (!alive) return;
        setList(next);
        // 只读页优先 `list().frozen`；宿主未随列表下发时再单独读一次 manifest
        // （旧宿主兼容；正常路径不会多打一条 RPC）。
        let nextFrozen = next.frozen;
        if (nextFrozen === undefined && readOnly && next.sessionId !== undefined) {
          nextFrozen = await api.prompt.manifest({ sessionId: next.sessionId });
          if (!alive) return;
        }
        setFrozen(nextFrozen);
        if (next.errors.length > 0) setError(next.errors.join("; "));
      } catch (err) {
        if (alive) setError(errMessage(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [api, readOnly, tick]);

  const toggle = useCallback(
    (file: ClientPromptFile) => {
      if (api === undefined || list === undefined || pendingId !== undefined) return;
      const files = list.files;
      const current = files.filter((candidate) => candidate.enabled).map((candidate) => candidate.id);
      const next = file.enabled ? current.filter((id) => id !== file.id) : [...current, file.id];
      const defaults = files
        .filter((candidate) => (candidate.visibility?.visible ?? true) && candidate.defaultEnabled)
        .map((candidate) => candidate.id);
      // 写 null = 清除本会话显式选择、跟随默认层（默认全选，与 DSH 原生一致）；
      // 只有偏离默认时才落整份 selected（避免把项目/全局默认关闭的文件误打开）。
      const selected = sameStringSet(next, defaults) ? null : next;
      setPendingId(file.id);
      setError(undefined);
      void (async () => {
        try {
          await api.prompt.setSessionSelection({ selected });
        } catch (err) {
          setError(errMessage(err));
        } finally {
          setPendingId(undefined);
          refresh();
        }
      })();
    },
    [api, list, pendingId, refresh],
  );

  const files = list?.files ?? [];
  return {
    ...(list !== undefined ? { list } : {}),
    ...(frozen !== undefined ? { frozen } : {}),
    files,
    loading,
    ...(error !== undefined ? { error } : {}),
    ...(pendingId !== undefined ? { pendingId } : {}),
    enabledCount: files.filter((file) => file.enabled).length,
    injectedCount: frozen?.files.length ?? 0,
    fileCount: files.length,
    refresh,
    toggle,
  };
}

// ---------------------------------------------------------------------------
// 展示原语（本地实现，样式复用 skp-dock-*；见文件头「为什么单独一个文件」）
// ---------------------------------------------------------------------------

type PromptTagTone = "project" | "global" | "bundled" | "preset" | "external";

function PromptTag({ label, tone, title }: { label: string; tone: PromptTagTone; title?: string }) {
  return (
    <span className={`skp-dock-tag skp-dock-tag-${tone}`} title={title}>
      {label}
    </span>
  );
}

/** 与 composer-capability 的 DockSwitch 同款（行为：拦截冒泡，卡片不再重复触发）。 */
function PromptSwitch({
  checked,
  disabled,
  title,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  title?: string;
  onChange: () => void;
}) {
  return (
    <label
      className="skp-dock-switch"
      title={title}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <input type="checkbox" checked={checked} disabled={disabled} aria-label={title} onChange={onChange} />
      <span className="skp-dock-switch-track" />
    </label>
  );
}

/** 事件目标是否落在开关上（键盘触发兜底，避免卡片重复写一次）。 */
function isSwitchEventTarget(target: EventTarget | null): boolean {
  const element = target as { closest?: (selector: string) => Element | null } | null;
  return typeof element?.closest === "function" && element.closest(".skp-dock-switch") !== null;
}

function scopeLabel(scope: ClientPromptScope): string {
  return scope === "project" ? "项目" : "全局";
}

function scopeTitle(scope: ClientPromptScope): string {
  return scope === "user-global"
    ? "用户全局（~/.dsh）"
    : scope === "agents-global"
      ? "Agent 全局（~/.agents）"
      : "项目（项目根 → 当前工作区目录）";
}

/** 首屏可编辑卡片的作用域 / 策略标签（与面板 `PromptState` 字典同口径）。 */
function editableStatusTag(file: ClientPromptFile): { label: string; tone: PromptTagTone; title: string } {
  if (file.state === "duplicate") {
    return {
      label: "折叠",
      tone: "bundled",
      title: file.duplicateOf !== undefined ? `与 ${file.duplicateOf} 内容重复，只注入一次` : "与同组文件内容重复，只注入一次",
    };
  }
  if (file.state === "invisible") return { label: "不可见", tone: "external", title: "全局可见范围对本工作区关闭（会话页无法反开关）" };
  if (file.state === "too-large") return { label: "超 1 MiB", tone: "external", title: "单文件超过预算源上限，宿主会静默跳过" };
  if (file.state === "unreadable") return { label: "不可读", tone: "external", title: "文件读取失败" };
  if (file.sessionExplicit === false) return { label: "本会话关闭", tone: "preset", title: "本会话首屏显式关闭（不影响默认层）" };
  if (file.sessionExplicit === true) return { label: "本会话开启", tone: "global", title: "本会话首屏显式开启（不影响默认层）" };
  if (file.projectDefault === false) return { label: "项目关闭", tone: "preset", title: "项目级默认关闭：本项目的新会话默认不注入" };
  if (file.projectDefault === true) return { label: "项目默认开启", tone: "global", title: "项目级默认开启，覆盖全局默认" };
  if (file.enabled) return { label: "默认启用", tone: "global", title: "未做会话选择时跟随默认层启用" };
  return { label: "默认关闭", tone: "preset", title: "默认关闭" };
}

/** 只读页状态 pill：✓ 已注入 / 未注入 / 不注入（以冻结清单为权威）。 */
function readonlyStatusPill(
  file: ClientPromptFile,
  frozen: ClientPromptManifest | undefined,
): { label: string; tone: "injected" | "disabled" | "warn"; title: string } {
  const manifestFile =
    frozen === undefined
      ? undefined
      : (frozen.files.find((candidate) => candidate.id === file.id) ??
        frozen.files.find((candidate) => candidate.displayPath === file.displayPath));
  if (manifestFile !== undefined) {
    const truncated = frozen?.truncated.some((item) => item.displayPath === file.displayPath) === true;
    return truncated
      ? { label: "✓ 已注入", tone: "warn", title: `已注入（超出预算被截断）· 第 ${manifestFile.order} 位 · ${manifestFile.bytes} B` }
      : { label: "✓ 已注入", tone: "injected", title: `已进入本会话首轮上下文 · 第 ${manifestFile.order} 位 · ${manifestFile.bytes} B` };
  }
  if (frozen?.omitted.some((item) => item.displayPath === file.displayPath) === true) {
    return { label: "未注入", tone: "warn", title: "超出预算上限，本会话被整份省略" };
  }
  if (file.enabled === false) return { label: "不注入", tone: "disabled", title: "默认关闭或全局可见性关闭，本会话不注入" };
  if (file.state === "duplicate") {
    return { label: "未注入", tone: "disabled", title: "与同组文件内容重复，宿主自动合并、只注入一份" };
  }
  if (file.state === "too-large") return { label: "未注入", tone: "disabled", title: "单文件超过预算源上限，宿主跳过" };
  if (file.state === "invisible") return { label: "不注入", tone: "disabled", title: "全局可见范围对本工作区关闭" };
  if (file.state === "unreadable") return { label: "未注入", tone: "disabled", title: "文件读取失败，宿主跳过" };
  return {
    label: "未注入",
    tone: "disabled",
    title: frozen === undefined ? "本会话首轮尚未冻结（冻结后按实际注入结果显示）" : "未进入本会话注入清单",
  };
}

// ---------------------------------------------------------------------------
// 内容
// ---------------------------------------------------------------------------

/** 只读冻结 banner：本会话首轮注入已固化，改文件 / 开关都不会影响本会话。 */
function FreezeBanner({ frozen, onRefresh }: { frozen: ClientPromptManifest | undefined; onRefresh: () => void }) {
  const at =
    frozen === undefined
      ? undefined
      : new Date(frozen.at).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="skp-dock-rail" role="note">
      <span className="skp-dock-rail-count" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <LockIcon />
        {frozen !== undefined ? "本会话首轮已注入并冻结" : "本会话首轮注入尚未冻结"}
      </span>
      <span
        className="skp-dock-foot-note"
        title={
          frozen !== undefined
            ? "文件修改、面板编辑与开关都不会改变本会话的模型上下文；如需调整请新开会话（面板中的改动只对新会话生效）。"
            : "首轮开始后固化；本页只展示首轮注入结果，不能修改、不能开关。"
        }
      >
        {frozen !== undefined
          ? "文件修改、面板编辑与开关都不会改变本会话的模型上下文；如需调整请新开会话。"
          : "首轮开始后固化，本页只读。"}
      </span>
      {at !== undefined && <span className="skp-dock-rail-note">{at}</span>}
      <button type="button" className="skp-dock-link" onClick={onRefresh}>
        刷新
      </button>
    </div>
  );
}

/** 宿主渲染管线不可用时的轻量降级提示（开关不生效，注入仍走宿主默认）。 */
function EngineDegraded() {
  return (
    <div className="skp-dock-rail" role="note">
      <span className="skp-dock-rail-count" style={{ color: "var(--dsw-alias-state-warn-primary,#f59e0b)" }}>
        宿主渲染管线不可用
      </span>
      <span className="skp-dock-foot-note">开关键类暂不生效，首轮仍按宿主默认注入；如需完整控制请到能力面板查看。</span>
    </div>
  );
}

/** 首屏可编辑卡片：标题行右端开关；开关后整份写本会话选择。 */
function EditablePromptCard({ file, busy, onToggle }: { file: ClientPromptFile; busy: boolean; onToggle: () => void }) {
  const duplicate = file.state === "duplicate";
  const toggleable = !duplicate && file.state !== "invisible" && file.state !== "too-large" && file.state !== "unreadable";
  const status = editableStatusTag(file);
  const switchTitle = file.enabled
    ? `关闭：本会话首轮不注入 ${file.name}（不落盘、不改默认）`
    : `开启：本会话首轮注入 ${file.name}（不改默认）`;
  const cardState = duplicate ? "" : file.enabled ? " skp-dock-card-on" : " skp-dock-card-off";
  return (
    <div
      className={`skp-dock-card${cardState}${toggleable ? "" : " skp-dock-card-disabled"}`}
      role={toggleable ? "button" : undefined}
      tabIndex={toggleable ? 0 : undefined}
      aria-pressed={toggleable && !duplicate ? file.enabled : undefined}
      title={toggleable ? switchTitle : file.path}
      onClick={(event) => {
        if (isSwitchEventTarget(event.target)) return;
        if (toggleable && !busy) onToggle();
      }}
      onKeyDown={(event) => {
        if (isSwitchEventTarget(event.target)) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (toggleable && !busy) onToggle();
        }
      }}
    >
      <div className="skp-dock-card-head">
        <span className="skp-dock-card-icon">
          <DocIcon />
        </span>
        <span className="skp-dock-card-name" title={file.path}>
          {file.name}
        </span>
        {duplicate ? (
          <span className="skp-dock-tag skp-dock-tag-bundled" title="与同组文件内容重复，由宿主自动合并、只注入一份">
            自动合并
          </span>
        ) : (
          <PromptSwitch checked={file.enabled} disabled={!toggleable || busy} title={switchTitle} onChange={onToggle} />
        )}
      </div>
      <p className="skp-dock-card-desc" title={file.path}>
        {file.displayPath}
      </p>
      <div className="skp-dock-card-foot">
        <PromptTag label={scopeLabel(file.scope)} tone={file.scope === "project" ? "project" : "global"} title={scopeTitle(file.scope)} />
        <PromptTag label={status.label} tone={status.tone} title={status.title} />
        <span className="skp-dock-card-meta">{formatSize(file.size)}</span>
      </div>
    </div>
  );
}

/** 会话内只读卡片：标题行右端换成状态 pill，无开关、无点击写操作。 */
function ReadonlyPromptCard({ file, frozen }: { file: ClientPromptFile; frozen: ClientPromptManifest | undefined }) {
  const pill = readonlyStatusPill(file, frozen);
  const manifestFile =
    frozen === undefined ? undefined : (frozen.files.find((candidate) => candidate.id === file.id) ?? frozen.files.find((candidate) => candidate.displayPath === file.displayPath));
  const status = editableStatusTag(file);
  // 卡片高亮 = 该文件确实在本会话冻结清单里（截断也算已注入）。
  const cardState = manifestFile !== undefined ? " skp-dock-card-on" : " skp-dock-card-off";
  return (
    <div className={`skp-dock-card${cardState} skp-dock-card-disabled`} title={file.path}>
      <div className="skp-dock-card-head">
        <span className="skp-dock-card-icon">
          <DocIcon />
        </span>
        <span className="skp-dock-card-name" title={file.path}>
          {file.name}
        </span>
        <span className={`skp-prompt-status skp-prompt-status-${pill.tone}`} title={pill.title}>
          {pill.label}
        </span>
      </div>
      <p className="skp-dock-card-desc" title={file.path}>
        {file.displayPath}
      </p>
      <div className="skp-dock-card-foot">
        <PromptTag label={scopeLabel(file.scope)} tone={file.scope === "project" ? "project" : "global"} title={scopeTitle(file.scope)} />
        {manifestFile !== undefined ? (
          <PromptTag label={`第 ${manifestFile.order} 位`} tone="preset" title="宿主首轮注入顺序" />
        ) : (
          <PromptTag label={status.label} tone={status.tone} title={status.title} />
        )}
        <span className="skp-dock-card-meta">{formatSize(file.size)}</span>
      </div>
    </div>
  );
}

/**
 * 把宿主渲染的 baseline 正文整理成「可读的 Markdown」：
 *
 *   - 去掉插件控制的 `<system-reminder>` 包裹；
 *   - 去掉固定 intro（"The following workspace instructions…" / replacement / budget 提示）；
 *   - 每个文件的 `Instructions from: <path>` 升级成二级标题，正文按原 Markdown 渲染。
 *
 * 只影响展示，不改会话里实际注入的内容。
 */
function frozenPreviewMarkdown(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "<system-reminder>" || trimmed === "</system-reminder>") continue;
    if (
      trimmed.startsWith("The following workspace instructions may be relevant") ||
      trimmed.startsWith("This complete workspace instruction baseline replaces") ||
      trimmed.startsWith("Workspace instructions were omitted or truncated") ||
      trimmed.startsWith("Workspace instruction budget ")
    ) {
      continue;
    }
    const section = /^Instructions from: (.+)$/.exec(trimmed);
    if (section !== null) {
      out.push(`## ${section[1]}`);
      continue;
    }
    out.push(line);
  }
  return out.join("\n").trim();
}

/** 只读正文预览：Markdown 渲染 + 「查看全部」弹层；不落会话日志、不可编辑。 */
function FrozenPreview({ text, fileCount }: { text: string; fileCount: number }) {
  const [open, setOpen] = useState(false);
  const source = frozenPreviewMarkdown(text);
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);
  const lines = source.split("\n").length;
  return (
    <>
      <div className="skp-dock-rail" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
          <span className="skp-dock-rail-count">已注入内容预览 · 共 {fileCount} 个文件</span>
          <span style={{ flex: "1 1 auto" }} />
          <button type="button" className="skp-dock-link" onClick={() => setOpen(true)}>
            查看全部
          </button>
        </div>
        <div className="skp-prompt-frozen" style={{ maxHeight: 200, overflow: "hidden" }}>
          <MarkdownPreview source={source} />
        </div>
        <span className="skp-dock-rail-note">只读预览 · 全文 {lines} 行 · 不可修改 / 不可开关</span>
      </div>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div className="skp-prompt-full-overlay" onClick={() => setOpen(false)}>
              <div
                className="skp-prompt-full-panel"
                role="dialog"
                aria-label={`已注入内容 · 共 ${fileCount} 个文件`}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="skp-prompt-full-head">
                  <span className="skp-prompt-full-title">已注入内容 · 共 {fileCount} 个文件</span>
                  <button type="button" className="skp-prompt-full-close" aria-label="关闭" onClick={() => setOpen(false)}>
                    ✕
                  </button>
                </div>
                <div className="skp-prompt-full-body">
                  <MarkdownPreview source={source} />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/**
 * Prompt Tab 内容：banner / 汇总行 / 卡片网格 / （只读）正文预览。
 *
 * @param data `usePromptTabData` 的返回值。
 * @param readOnly 会话内只读（mode="view"）。
 * @param query 页头搜索词（复用面板既有搜索框）。
 * @param onClearQuery 清空搜索（空态里的「清空搜索」）。
 */
export function PromptTab({
  data,
  readOnly,
  query,
  onClearQuery,
}: {
  data: PromptTabData;
  readOnly: boolean;
  query: string;
  onClearQuery?: () => void;
}) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return data.files;
    return data.files.filter((file) => `${file.name} ${file.displayPath} ${scopeLabel(file.scope)}`.toLowerCase().includes(q));
  }, [data.files, query]);

  const busy = data.pendingId !== undefined;
  const injectable = data.files.filter((file) => file.enabled && file.state !== "duplicate");
  const merged = data.files.filter((file) => file.enabled && file.state === "duplicate");
  const injectBytes = injectable.reduce((sum, file) => sum + file.size, 0);
  const budget = data.list?.budget.maxBytes ?? 65536;
  const degraded = data.list?.engineAvailable === false;

  return (
    <>
      {readOnly ? (
        <FreezeBanner frozen={data.frozen} onRefresh={data.refresh} />
      ) : (
        <div className="skp-dock-rail" role="note">
          <span className="skp-dock-rail-count">将注入 {injectable.length} 个文件</span>
          <span className="skp-dock-rail-note">
            预计 {formatSize(injectBytes)} / {formatSize(budget)}
          </span>
          {merged.length > 0 && (
            <span className="skp-dock-rail-note" title={merged.map((file) => file.displayPath).join(" · ")}>
              （{merged.map((file) => file.name).join("、")} 内容重复，自动合并）
            </span>
          )}
          <span className="skp-dock-spacer" />
          <span className="skp-dock-rail-note">开始时冻结 · 之后本会话不可改</span>
        </div>
      )}

      {degraded && <EngineDegraded />}

      {data.error !== undefined && (
        <div className="skp-dock-banner" role="alert">
          <span>{data.error}</span>
          <button type="button" className="skp-dock-link" onClick={data.refresh}>
            重试
          </button>
        </div>
      )}

      <div className="skp-dock-grid skp-dock-grid-prompt" role="tabpanel">
        {data.loading && data.files.length === 0 ? (
          <div className="skp-dock-empty">加载中…</div>
        ) : filtered.length === 0 ? (
          <div className="skp-dock-empty">
            {query.trim() !== ""
              ? `没有匹配「${query.trim()}」的 Prompt`
              : data.files.length === 0
                ? "未发现可注入的 Prompt 文件"
                : "没有可展示的 Prompt"}
            {query.trim() !== "" && onClearQuery !== undefined && (
              <button type="button" className="skp-dock-link" onClick={onClearQuery}>
                清空搜索
              </button>
            )}
          </div>
        ) : readOnly ? (
          filtered.map((file) => <ReadonlyPromptCard key={file.id} file={file} frozen={data.frozen} />)
        ) : (
          filtered.map((file) => <EditablePromptCard key={file.id} file={file} busy={busy} onToggle={() => data.toggle(file)} />)
        )}
      </div>

      {readOnly && data.frozen?.text !== undefined && data.frozen.text.length > 0 && (
        <FrozenPreview text={data.frozen.text} fileCount={data.frozen.files.length} />
      )}

    </>
  );
}
