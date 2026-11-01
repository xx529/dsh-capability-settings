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
}: {
  scope: "global" | "workspace";
  projectName?: string;
  globalSeg: ScopeChainSegment;
  workspaceSeg: ScopeChainSegment;
  workspaces: ScopeChainWorkspace[];
  onSelectWorkspace(path: string): void;
}) {
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
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
    const top = Math.min(rect.bottom + 6, window.innerHeight - 120);
    setAnchor({ left, top, width });
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
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="skp-scope-chain" aria-label="作用域链">
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
              className="skp-dd-pop skp-scope-chain-pop"
              role="listbox"
              aria-label="选择工作区"
              style={{ left: anchor.left, top: anchor.top, width: anchor.width, maxHeight: 320 }}
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
