/**
 * 能力域面板共用的模型与小组件（Skills / MCP 两域视图共用）。
 *
 * 收敛了各处复制的小工具与标记：
 *   - `hasWorkspaceLabel`：面板是否附着在可写工作区上（workspaceLabel
 *     无工作区时返回占位字符串）；
 *   - `isProjectSource`：source 是否属于"项目系"（决定分组归属，
 *     composer 弹层的分组口径与此一致；清单的单一事实源在
 *     shared/skill-sources.ts，与宿主端共用）；
 *   - `useAsyncList`：两域视图高度同构的"挂载/依赖变化时拉取 + 显式重拉"
 *     状态机（loading/error/请求序号守卫）。
 *
 * 旧的 `PanelZone` / `ZoneTabs`（项目 / 全局二选一 Tab）已随「双组同屏」
 * 改版删除：作用域现在由同一列表列里的两个分组表达，两个域各自渲染
 * `skp-group*` 结构（样式见 styles.ts）。
 *
 * @module dsh-capability-settings/client/panel-common
 */
import { isProjectSkillSource } from "../shared/skill-sources.js";
/** 面板是否附着在一个可写工作区上（workspaceLabel 无工作区时返回占位字符串）。 */
export declare function hasWorkspaceLabel(workspace: string | undefined): boolean;
/** source 是否属于"项目系"（决定分组归属，composer 弹层的分组口径与此一致）。 */
export declare const isProjectSource: typeof isProjectSkillSource;
/**
 * 两域视图共用的"拉取 + 重拉"状态机。
 *
 * `load` 由调用方组装（Skills 直接 list；MCP 把 list+status+runtime 合并
 * 投影成单个结果对象），返回的结果整体存进 `data`，视图从 `data` 派生
 * 各自的行/错误。依赖变化（挂载、工作区切换）与显式 `reload()` 都会触发
 * 拉取。
 *
 * 内部用请求序号守卫：并发触发（连点写操作、工作区快速切换）时只让
 * **最新一次**请求的结果落地，防乱序旧响应覆盖新状态。
 */
export declare function useAsyncList<T>(load: () => Promise<T>, deps: readonly unknown[]): {
    data: T | undefined;
    loading: boolean;
    error: string | undefined;
    reload: (options?: {
        silent?: boolean;
    }) => void;
};
