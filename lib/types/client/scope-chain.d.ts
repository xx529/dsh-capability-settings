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
export declare function ScopeChain({ scope, projectName, globalSeg, workspaceSeg, workspaces, onSelectWorkspace, }: {
    scope: "global" | "workspace";
    projectName?: string;
    globalSeg: ScopeChainSegment;
    workspaceSeg: ScopeChainSegment;
    workspaces: ScopeChainWorkspace[];
    onSelectWorkspace(path: string): void;
}): import("react").JSX.Element;
