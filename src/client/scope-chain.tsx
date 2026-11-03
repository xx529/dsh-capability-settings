/**
 * v20.1 两段作用域链（全局 → 工作区）。
 *
 * 全局视图的第二段不是「直接跳到某个工作区」——先展开一个工作区下拉，
 * 用户选中具体工作区后才切换。避免把「最近工作区 / 第一项」当成隐式落点，
 * 也避免用户不知道即将去哪个工作区（用户反馈 2026-11-01）。
 *
 * 工作区视图的第二段是纯展示（真实 effective 状态）。
 *
 * 下拉复用 `.skp-dd-pop` 的 fixed 定位与视口钳制思路；这里不直接复用
 * `SkpSelect`，因为触发按钮是三行卡片（label/title/note），而 `SkpSelect`
 * 的触发区只有单行 label。
 *
 * @module dsh-capability-settings/client/scope-chain
 */

import { useEffect, useRef, useState } from "react";

/** 工作区选项（只依赖面板 api 已有的 path/title）。 */
export interface ScopeChainWorkspace {
  path: string;
  title?: string;
}

/** 作用域链一段的展示状态。 */
export interface ScopeChainSegment {
  on: boolean;
  title: string;
  note: string;
}

/** 从路径取 basename（兼容 POSIX / Windows 分隔符）。 */
function basenameOf(path: string): string {
  const segments = path.split(/[\\/]/).filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? path;
}

/**
 * 渲染两段作用域链。
 *
 * @param scope 当前面板作用域
 * @param projectName 工作区展示名（工作区视图第二段）
 * @param globalSeg 全局段文案
 * @param workspaceSeg 工作区段文案（工作区视图）
 * @param workspaces 全部工作区；全局视图点击第二段后展示
 * @param onSelectWorkspace 选中工作区后切换面板作用域
 */
export function ScopeChain({
  scope,
  projectName,
  globalSeg,
  workspaceSeg,
  workspaces,
  onSelectWorkspace,
  compact = false,
}: {
  scope: "global" | "workspace";
  projectName?: string;
  globalSeg: ScopeChainSegment;
  workspaceSeg: ScopeChainSegment;
  workspaces: ScopeChainWorkspace[];
  onSelectWorkspace(path: string): void;
  /** v22：详情状态条里的单行紧凑态（隐藏 note，只保留 全局 → 工作区 摘要）。 */
  compact?: boolean;
}) {
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const open = anchor !== null;

  const toggle = () => {
    if (open) {
      setAnchor(null);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    const width = Math.max(280, Math.min(rect.width, 420));
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    // 下拉默认向下；下方空间不足且上方更宽裕时向上弹，并保证最大高度
    // 严格落在视口内（工作区多时靠内部滚动，不能顶出屏幕）。
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
    const available = Math.max(120, openUp ? spaceAbove : spaceBelow);
    const maxHeight = Math.min(360, available);
    const top = openUp ? Math.max(8, rect.top - 6 - maxHeight) : rect.bottom + 6;
    setAnchor({ left, top, width, maxHeight });
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current !== null && event.target instanceof Node && !rootRef.current.contains(event.target)) {
        setAnchor(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAnchor(null);
    };
    const closeOnViewportChange = () => setAnchor(null);
    // 下拉列表自身滚动时保持打开（否则工作区一多就无法滚轮选择）；
    // 页面/详情栏滚动、窗口缩放才关闭。
    const onScroll = (event: Event) => {
      if (popRef.current !== null && event.target instanceof Node && popRef.current.contains(event.target)) return;
      setAnchor(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={compact ? "skp-scope-chain skp-scope-chain-compact" : "skp-scope-chain"} aria-label="作用域链">
      <div className="skp-scope-chain-seg">
        <div className="skp-scope-chain-head">
          <span className={globalSeg.on ? "skp-dot skp-dot-enabled" : "skp-dot skp-dot-hollow"} aria-hidden="true" />
          <span className="skp-scope-chain-label">全局</span>
        </div>
        <div className="skp-scope-chain-title">{globalSeg.title}</div>
        <div className="skp-scope-chain-note">{globalSeg.note}</div>
      </div>
      <span className="skp-scope-chain-arrow" aria-hidden="true">
        →
      </span>
      {scope === "global" ? (
        <>
          <button
            ref={buttonRef}
            type="button"
            className="skp-scope-chain-seg skp-scope-chain-action"
            title="选择要查看的工作区；选中后切到该工作区视图"
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={toggle}
          >
            <div className="skp-scope-chain-head">
              <span className="skp-dot skp-dot-partial" aria-hidden="true" />
              <span className="skp-scope-chain-label">工作区覆盖</span>
            </div>
            <div className="skp-scope-chain-title">在「工作区」作用域查看 ↗</div>
            <div className="skp-scope-chain-note">先选择工作区，再切到该工作区视图</div>
          </button>
          {open && anchor !== null && (
            <div
              ref={popRef}
              className="skp-dd-pop skp-scope-chain-pop"
              role="listbox"
              aria-label="选择工作区"
              style={{ left: anchor.left, top: anchor.top, width: anchor.width, maxHeight: anchor.maxHeight }}
            >
              <div className="skp-scope-chain-pop-head">选择工作区</div>
              {workspaces.length === 0 ? (
                <div className="skp-empty skp-scope-chain-pop-empty">还没有已知工作区</div>
              ) : (
                workspaces.map((workspace) => (
                  <button
                    key={workspace.path}
                    type="button"
                    role="option"
                    className="skp-dd-opt"
                    title={workspace.path}
                    onClick={() => {
                      setAnchor(null);
                      onSelectWorkspace(workspace.path);
                    }}
                  >
                    <span className="skp-dd-opt-label">{workspace.title?.trim() || basenameOf(workspace.path)}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </>
      ) : (
        <div className="skp-scope-chain-seg">
          <div className="skp-scope-chain-head">
            <span className={workspaceSeg.on ? "skp-dot skp-dot-enabled" : "skp-dot skp-dot-hollow"} aria-hidden="true" />
            <span className="skp-scope-chain-label">工作区 {projectName ?? "当前选择"}</span>
          </div>
          <div className="skp-scope-chain-title">{workspaceSeg.title}</div>
          <div className="skp-scope-chain-note">{workspaceSeg.note}</div>
        </div>
      )}
    </div>
  );
}
