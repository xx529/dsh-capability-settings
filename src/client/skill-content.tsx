/**
 * 技能详情的「文件 + 阅读器」内容区（本版新增）。
 *
 * 数据来源：现有 `skills.export` RPC（`exportFiles`）——它已递归返回技能目录
 * 下全部普通文件的相对路径 + base64 内容，因此**宿主不新增 RPC**：
 *   - 打开技能时拉一次全量清单 → base64 解码 → 前端建树；切换文件 0 请求；
 *   - `SKILL.md` 恒置顶并默认选中；flat 格式（单 `.md`）隐藏文件树、阅读器占满；
 *   - 目录 200 文件、树深 3 层硬上限；单文件预览 256 KB 截断；
 *   - 二进制 / 非 UTF-8 不渲染正文，显示类型 + 大小 + 下载；空文件给提示。
 *
 * 预览走零依赖的 `markdown.tsx`（L1，React 元素树，无
 * `dangerouslySetInnerHTML`）；解析器异常时回落到 `<pre>` 原文。
 *
 * 窄容器降级（按内容区实测宽度，见 UX §4.5）：≥732 文件树 220；632–731
 * 文件树 200；<632 折叠为「文件 (N)」下拉，阅读器占满。
 *
 * @module @chengdb/capability-panel/client/skill-content
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ClientSkillSummary, SkillRef, SkillsApi } from "./api.js";
import { MarkdownPreview, stripFrontmatter } from "./markdown.js";
import { SkpSelect } from "./select.js";
import { base64ToBytes, downloadBytes } from "./zip.js";

/** 目录最多展示的文件数（超出只保留排序后前 200）。 */
const MAX_FILES = 200;
/** 树最多 3 层（相对技能根目录）。 */
const MAX_DEPTH = 3;
/** 单文件预览上限（字节）。 */
const MAX_PREVIEW_BYTES = 256 * 1024;
/** 文件树常驻宽度：基准 220，1000–1099 档 200。 */
const TREE_WIDTH_WIDE = 220;
const TREE_WIDTH_MEDIUM = 200;
/** 内容区宽度低于该值时文件树折叠为下拉（≈主区 <1000，见 UX §4.5）。 */
const TREE_COLLAPSE_WIDTH = 632;
/** 文件树保持 220 宽所需的内容区宽度（≈主区 ≥1100）。 */
const TREE_WIDE_WIDTH = 732;

/** 组装一行的寻址入参：优先用宿主给的受管根；root 缺失时按 source 退化。 */
export function skillRefOf(summary: ClientSkillSummary): SkillRef {
  return summary.root !== undefined
    ? { name: summary.name, root: summary.root }
    : summary.source === "project-dsh"
      ? { name: summary.name, scope: "project", target: ".dsh" }
      : summary.source === "project-agents"
        ? { name: summary.name, scope: "project", target: ".agents" }
        : { name: summary.name, scope: "global" };
}

/** 一个已解码的技能文件。 */
interface SkillFile {
  path: string;
  bytes: Uint8Array;
  size: number;
  /** 无法按 UTF-8 解码 / 含 NUL 字节时视为二进制。 */
  binary: boolean;
  /** 文本内容（二进制时为空串）；超 256 KB 时只含前 256 KB。 */
  text: string;
  truncated: boolean;
}

interface TreeNode {
  name: string;
  path: string;
  kind: "root" | "dir" | "file";
  depth: number;
  children?: TreeNode[];
  file?: SkillFile;
  /** 目录内文件数（含子目录）。 */
  count?: number;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      files: SkillFile[];
      root: TreeNode;
      /** 导出清单里的文件总数（含隐藏/超深/被 200 上限截掉的）。 */
      totalCount: number;
      shownCount: number;
      hiddenCount: number;
      deeperCount: number;
      overLimitCount: number;
    };

/** 字节数 → 人类可读大小（1 位小数，去掉多余的 .0）。 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${trimZero(kb.toFixed(1))} KB`;
  return `${trimZero((kb / 1024).toFixed(1))} MB`;
}

function trimZero(text: string): string {
  return text.endsWith(".0") ? text.slice(0, -2) : text;
}

/** 路径后缀 → 类型徽标（MD / JSON / PNG…；无后缀显示 FILE）。 */
export function fileTypeLabel(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "FILE";
  return base.slice(dot + 1).toUpperCase().slice(0, 4);
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** 隐藏文件（以 `.` 开头的段）与导出里可能出现的空路径不展示。 */
function isHiddenPath(path: string): boolean {
  return path.split("/").some((segment) => segment.startsWith("."));
}

function pathDepth(path: string): number {
  return path.split("/").length;
}

/** 文本解码：含 NUL 或非 UTF-8 视为二进制；超上限按字符边界截断。 */
function decodeFile(path: string, base64: string): SkillFile {
  const bytes = base64ToBytes(base64);
  const size = bytes.length;
  if (bytes.includes(0)) {
    return { path, bytes, size, binary: true, text: "", truncated: false };
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let full: string;
  try {
    full = decoder.decode(bytes);
  } catch {
    return { path, bytes, size, binary: true, text: "", truncated: false };
  }
  if (size <= MAX_PREVIEW_BYTES) {
    return { path, bytes, size, binary: false, text: full, truncated: false };
  }
  // 按 UTF-8 字符边界取前 256 KB：从上限处回退掉续字节，剩余部分按宽松模式解码。
  let end = MAX_PREVIEW_BYTES;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, end));
  return { path, bytes, size, binary: false, text, truncated: true };
}

/** 文件排序：SKILL.md 恒第一；其余按深度、再按名称（不区分大小写）。 */
function sortFiles<T extends { path: string }>(files: T[]): T[] {
  const skill = files.find((file) => file.path === "SKILL.md");
  const rest = files.filter((file) => file.path !== "SKILL.md");
  rest.sort((a, b) => {
    const depth = pathDepth(a.path) - pathDepth(b.path);
    if (depth !== 0) return depth;
    return a.path.toLowerCase().localeCompare(b.path.toLowerCase());
  });
  return skill === undefined ? rest : [skill, ...rest];
}

/** 以文件清单构建树（目录由路径前缀推导）；同层 SKILL.md → 目录 → 文件 → 名称。 */
function buildTree(files: SkillFile[], rootName: string): TreeNode {
  const root: TreeNode = { name: rootName, path: "", kind: "root", depth: 0, children: [] };
  for (const file of files) {
    const segments = file.path.split("/");
    let parent = root;
    segments.forEach((segment, index) => {
      const isLeaf = index === segments.length - 1;
      const path = segments.slice(0, index + 1).join("/");
      parent.children ??= [];
      let node = parent.children.find((child) => child.path === path);
      if (node === undefined) {
        node = isLeaf
          ? { name: segment, path, kind: "file", depth: index + 1, file }
          : { name: segment, path, kind: "dir", depth: index + 1, children: [] };
        parent.children.push(node);
      }
      parent = node;
    });
  }
  sortTree(root);
  countTree(root);
  return root;
}

function sortTree(node: TreeNode): void {
  if (node.children === undefined) return;
  node.children.sort((a, b) => {
    if (a.kind === "file" && a.name === "SKILL.md") return -1;
    if (b.kind === "file" && b.name === "SKILL.md") return 1;
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
  for (const child of node.children) sortTree(child);
}

function countTree(node: TreeNode): number {
  if (node.kind === "file") return 1;
  let total = 0;
  for (const child of node.children ?? []) total += countTree(child);
  node.count = total;
  return total;
}

/** 扁平成「根 / 目录 / 文件」行；折叠目录的子树不展开。 */
function flattenTree(root: TreeNode, collapsed: ReadonlySet<string>): Array<{ node: TreeNode; depth: number }> {
  const rows: Array<{ node: TreeNode; depth: number }> = [];
  const visit = (node: TreeNode, depth: number) => {
    rows.push({ node, depth });
    if (node.kind === "file" || collapsed.has(node.path)) return;
    for (const child of node.children ?? []) visit(child, depth + 1);
  };
  visit(root, 0);
  return rows;
}

/** 单个文件的「下载」：复用导出时拿到的字节，不再发请求。 */
function downloadFile(file: SkillFile): void {
  const type = fileTypeLabel(file.path);
  const mime = type === "MD" ? "text/markdown" : type === "JSON" ? "application/json" : type === "PNG" ? "image/png" : "application/octet-stream";
  downloadBytes(basename(file.path), file.bytes, mime);
}

/**
 * 内容区组件：文件树 + 阅读器。
 *
 * `refreshKey` 变化（父级的写操作版本号）时丢弃已拉取清单并重拉——写操作
 * 可能改变目录内容（导入 / 删除），因此不做「切文件不请求」之外的缓存。
 */
export function SkillContent({
  summary,
  api,
  refreshKey,
}: {
  summary: ClientSkillSummary;
  api: SkillsApi;
  /** 父级写操作计数：变化即重置缓存并重新拉取文件清单。 */
  refreshKey: number;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selectedPath, setSelectedPath] = useState<string | undefined>(undefined);
  const [view, setView] = useState<"preview" | "source">("preview");
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [activeIndex, setActiveIndex] = useState(0);
  /** 重试计数：失败态点「重试」时自增，触发重新拉取。 */
  const [retry, setRetry] = useState(0);
  const [contentWidth, setContentWidth] = useState(TREE_WIDE_WIDTH);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const resetVersion = useRef(0);

  /** 拉取并解码整份文件清单（只在挂载 / 切技能 / 写操作后执行）。 */
  useEffect(() => {
    const version = ++resetVersion.current;
    let alive = true;
    setState({ status: "loading" });
    setSelectedPath(undefined);
    setCollapsed(new Set());
    setView("preview");
    api
      .exportFiles(skillRefOf(summary))
      .then((result) => {
        if (!alive || version !== resetVersion.current) return;
        if (!result.ok) {
          setState({ status: "error", message: result.errors.join("; ") });
          return;
        }
        const hidden = result.files.filter((file) => isHiddenPath(file.path)).length;
        const visible = result.files.filter((file) => !isHiddenPath(file.path));
        const deep = visible.filter((file) => pathDepth(file.path) > MAX_DEPTH).length;
        const withinDepth = visible.filter((file) => pathDepth(file.path) <= MAX_DEPTH);
        const ordered = sortFiles(withinDepth);
        const overLimit = Math.max(0, ordered.length - MAX_FILES);
        const shown = ordered.slice(0, MAX_FILES).map((file) => decodeFile(file.path, file.content));
        const root = buildTree(shown, summary.name);
        const defaultFile =
          shown.find((file) => file.path === "SKILL.md") ?? shown[0];
        setState({
          status: "ready",
          files: shown,
          root,
          totalCount: result.files.length,
          shownCount: shown.length,
          hiddenCount: hidden,
          deeperCount: deep,
          overLimitCount: overLimit,
        });
        setSelectedPath(defaultFile?.path);
        if (defaultFile !== undefined) {
          const index = flattenTree(root, new Set()).findIndex((row) => row.node.path === defaultFile.path);
          setActiveIndex(index >= 0 ? index : 0);
        }
      })
      .catch((error) => {
        if (!alive || version !== resetVersion.current) return;
        setState({ status: "error", message: String(error) });
      });
    return () => {
      alive = false;
    };
  }, [api, summary.name, summary.root, summary.source, refreshKey, retry]);

  /** 监听内容区宽度，决定文件树宽度与是否折叠为下拉（UX §4.5）。 */
  useEffect(() => {
    const element = contentRef.current;
    if (element === null) return;
    const update = (width: number) => {
      if (width > 0) setContentWidth(width);
    };
    update(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) update(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const rows = useMemo(
    () => (state.status === "ready" ? flattenTree(state.root, collapsed) : []),
    [state, collapsed],
  );
  const selectedFile = useMemo(() => {
    if (state.status !== "ready" || selectedPath === undefined) return undefined;
    return state.files.find((file) => file.path === selectedPath);
  }, [state, selectedPath]);

  // 折叠树时把下拉的当前项对齐到已选文件（保持选中，不丢状态）。
  const showTree = summary.format !== "flat";
  const treeCollapsed = showTree && contentWidth < TREE_COLLAPSE_WIDTH;
  const treeWidth = contentWidth >= TREE_WIDE_WIDTH ? TREE_WIDTH_WIDE : TREE_WIDTH_MEDIUM;

  const toggleDir = (node: TreeNode) => {
    if (node.kind === "file" || node.kind === "root") return;
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(node.path)) next.delete(node.path);
      else next.add(node.path);
      return next;
    });
  };

  const focusRow = (index: number) => {
    const row = rows[index];
    if (row === undefined) return;
    setActiveIndex(index);
    requestAnimationFrame(() => rowRefs.current.get(row.node.path)?.scrollIntoView({ block: "nearest" }));
  };

  const onTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (rows.length === 0) return;
    const current = rows[activeIndex];
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusRow(Math.min(rows.length - 1, activeIndex + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusRow(Math.max(0, activeIndex - 1));
      return;
    }
    if (event.key === "ArrowRight" && current !== undefined) {
      event.preventDefault();
      if (current.node.kind !== "file") {
        if (collapsed.has(current.node.path)) toggleDir(current.node);
        else if (current.node.children !== undefined) focusRow(Math.min(rows.length - 1, activeIndex + 1));
      }
      return;
    }
    if (event.key === "ArrowLeft" && current !== undefined) {
      event.preventDefault();
      if (current.node.kind !== "file" && !collapsed.has(current.node.path) && current.node.kind === "dir") {
        toggleDir(current.node);
        return;
      }
      const parentPath = current.node.path.slice(0, current.node.path.lastIndexOf("/"));
      const parentIndex = rows.findIndex((row) => row.node.path === parentPath);
      if (parentIndex >= 0) focusRow(parentIndex);
      return;
    }
    if (event.key === "Enter" && current !== undefined) {
      event.preventDefault();
      if (current.node.kind === "file") {
        setSelectedPath(current.node.path);
      } else {
        toggleDir(current.node);
      }
    }
  };

  const copySelected = async () => {
    if (selectedFile === undefined || selectedFile.binary) return;
    try {
      await navigator.clipboard?.writeText(selectedFile.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用时静默：按钮无副作用 */
    }
  };

  const selectFile = (path: string) => {
    setSelectedPath(path);
    setView("preview");
    const index = rows.findIndex((row) => row.node.path === path);
    if (index >= 0) setActiveIndex(index);
  };

  return (
    <div
      className={treeCollapsed ? "skp-skill-content skp-skill-content-collapsed" : "skp-skill-content"}
      ref={contentRef}
    >
      {showTree && !treeCollapsed && (
        <div
          className="skp-file-tree"
          role="tree"
          aria-label="技能文件"
          tabIndex={0}
          ref={treeRef}
          style={{ width: treeWidth }}
          onKeyDown={onTreeKeyDown}
          onFocus={() => {
            if (rows.length > 0) focusRow(activeIndex);
          }}
        >
          <div className="skp-file-tree-head">
            <span className="skp-file-tree-title">技能文件</span>
            <span
              className="skp-group-count"
              title={
                state.status === "ready"
                  ? `${state.totalCount} 个文件中显示 ${state.shownCount} 个${state.hiddenCount > 0 ? `（隐藏 ${state.hiddenCount}）` : ""}${state.deeperCount > 0 ? `，${state.deeperCount} 个超出 3 层未显示` : ""}`
                  : undefined
              }
            >
              {state.status === "ready" && state.overLimitCount > 0 ? `${state.shownCount}+` : state.status === "ready" ? state.shownCount : "—"}
            </span>
          </div>
          <div className="skp-file-tree-scroll">
            {state.status === "loading" && <FileTreeSkeleton />}
            {state.status === "error" && (
              <div className="skp-file-tree-error">
                <span>文件列表读取失败</span>
                <button type="button" className="skp-link-btn" onClick={() => setRetry((value) => value + 1)}>
                  重试
                </button>
              </div>
            )}
            {state.status === "ready" && rows.length === 0 && <div className="skp-file-tree-empty">目录中没有可显示的文件</div>}
            {state.status === "ready" &&
              rows.map(({ node, depth }, index) => {
                if (node.kind === "root") {
                  return (
                    <div
                      key="__root__"
                      id="skp-tree-root"
                      role="treeitem"
                      aria-expanded="true"
                      aria-level={1}
                      className="skp-tree-row skp-tree-root"
                      style={{ paddingLeft: 12 + depth * 14 }}
                    >
                      <span className="skp-tree-chevron">▾</span>
                      <span className="skp-tree-name">{node.name}/</span>
                      {node.count !== undefined && <span className="skp-tree-count">{node.count}</span>}
                    </div>
                  );
                }
                const isFile = node.kind === "file";
                const isCollapsed = collapsed.has(node.path);
                const selected = isFile && node.path === selectedPath;
                const active = index === activeIndex;
                return (
                  <div
                    key={node.path}
                    id={`skp-tree-${node.path.replace(/[^a-zA-Z0-9_-]/g, "_")}`}
                    role="treeitem"
                    aria-selected={isFile ? selected : undefined}
                    aria-expanded={isFile ? undefined : !isCollapsed}
                    aria-level={depth + 1}
                    className={[
                      "skp-tree-row",
                      isFile ? "skp-tree-file" : "skp-tree-dir",
                      selected ? "skp-tree-row-active" : "",
                      active ? "skp-tree-row-focus" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={{ paddingLeft: 12 + depth * 14 }}
                    ref={(element) => {
                      if (element === null) rowRefs.current.delete(node.path);
                      else rowRefs.current.set(node.path, element);
                    }}
                    onClick={() => (isFile ? selectFile(node.path) : toggleDir(node))}
                  >
                    {!isFile && (
                      <span className="skp-tree-chevron" aria-hidden="true">
                        {isCollapsed ? "▸" : "▾"}
                      </span>
                    )}
                    {!isFile && (
                      <>
                        <span className="skp-tree-name">{node.name}/</span>
                        <span className="skp-tree-count">{node.count ?? 0}</span>
                      </>
                    )}
                    {isFile && (
                      <>
                        <span className="skp-tree-badge">{fileTypeLabel(node.path)}</span>
                        <span className="skp-tree-name">{node.name}</span>
                        <span className="skp-tree-size">{formatSize(node.file?.size ?? 0)}</span>
                      </>
                    )}
                  </div>
                );
              })}
            {state.status === "ready" && state.deeperCount > 0 && (
              <div className="skp-tree-note">…（{state.deeperCount} 个更深层文件未显示）</div>
            )}
          </div>
        </div>
      )}

      {showTree && treeCollapsed && state.status === "ready" && (
        <div className="skp-file-picker">
          <span className="skp-file-picker-label">文件 ({state.shownCount})</span>
          <SkpSelect
            className="skp-file-picker-dd"
            value={selectedPath ?? ""}
            ariaLabel="选择技能文件"
            options={state.files.map((file) => ({ value: file.path, label: file.path, hint: formatSize(file.size) }))}
            onChange={selectFile}
          />
        </div>
      )}

      <div className="skp-reader">
        <div className="skp-reader-head">
          <span className="skp-reader-name" title={selectedFile?.path}>
            {selectedFile === undefined ? "文件" : basename(selectedFile.path)}
          </span>
          {selectedFile !== undefined && (
            <span className="skp-reader-meta">
              {formatSize(selectedFile.size)} · {fileTypeLabel(selectedFile.path)}
            </span>
          )}
          <div className="skp-reader-seg" role="group" aria-label="内容视图">
            <button
              type="button"
              className={view === "preview" ? "skp-reader-seg-btn skp-reader-seg-active" : "skp-reader-seg-btn"}
              aria-pressed={view === "preview"}
              onClick={() => setView("preview")}
            >
              预览
            </button>
            <button
              type="button"
              className={view === "source" ? "skp-reader-seg-btn skp-reader-seg-active" : "skp-reader-seg-btn"}
              aria-pressed={view === "source"}
              onClick={() => setView("source")}
            >
              源码
            </button>
          </div>
          {selectedFile !== undefined && !selectedFile.binary && (
            <button type="button" className="skp-link-btn skp-reader-copy" onClick={() => void copySelected()}>
              {copied ? "已复制" : "复制全文"}
            </button>
          )}
        </div>
        <div className="skp-reader-body" tabIndex={0} aria-label={selectedFile === undefined ? "文件内容" : `${basename(selectedFile.path)} 内容`}>
          {state.status === "loading" && <ReaderSkeleton />}
          {state.status === "error" && (
            <div className="skp-reader-state">
              <p className="skp-reader-error">文件列表读取失败：{state.message}</p>
              <button type="button" className="skp-link-btn" onClick={() => setRetry((value) => value + 1)}>
                重试
              </button>
            </div>
          )}
          {state.status === "ready" && selectedFile === undefined && (
            <div className="skp-reader-state skp-reader-state-muted">此技能没有可预览的文件</div>
          )}
          {state.status === "ready" && selectedFile !== undefined && (
            <ReaderContent
              key={selectedFile.path}
              file={selectedFile}
              view={view}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** 阅读器正文：文本（预览/源码）、二进制、空文件、截断条。 */
function ReaderContent({ file, view }: { file: SkillFile; view: "preview" | "source" }) {
  if (file.binary) {
    return (
      <div className="skp-reader-state skp-reader-binary">
        <span className="skp-reader-badge">{fileTypeLabel(file.path)}</span>
        <p className="skp-reader-binary-title">二进制文件，无法预览</p>
        <p className="skp-reader-state-muted">大小 {formatSize(file.size)}</p>
        <button type="button" className="skp-btn" onClick={() => downloadFile(file)}>
          下载此文件
        </button>
      </div>
    );
  }
  if (file.text.length === 0) {
    return <div className="skp-reader-state skp-reader-state-muted">此文件为空</div>;
  }
  const isMarkdown = fileTypeLabel(file.path) === "MD";
  const useMarkdown = view === "preview" && isMarkdown;
  return (
    <>
      {useMarkdown ? (
        <MarkdownPreview source={stripFrontmatter(file.text)} />
      ) : (
        <pre className="skp-reader-text">{file.text}</pre>
      )}
      {file.truncated && (
        <div className="skp-reader-truncated">
          <span>已截断，仅显示前 256 KB</span>
          <button type="button" className="skp-link-btn" onClick={() => downloadFile(file)}>
            下载完整文件
          </button>
        </div>
      )}
    </>
  );
}

function FileTreeSkeleton() {
  return (
    <div className="skp-skeleton-tree" aria-hidden="true">
      {[80, 65, 90, 55, 70].map((width, index) => (
        <span key={index} className="skp-skeleton-line" style={{ width: `${width}%` }} />
      ))}
    </div>
  );
}

function ReaderSkeleton() {
  return (
    <div className="skp-skeleton-reader" aria-hidden="true">
      <span className="skp-skeleton-line" style={{ width: "62%", height: 14 }} />
      <span className="skp-skeleton-line" style={{ width: "86%", height: 14 }} />
      <span className="skp-skeleton-line" style={{ width: "100%", height: 120 }} />
    </div>
  );
}
