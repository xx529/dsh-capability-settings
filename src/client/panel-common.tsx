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

import { useCallback, useEffect, useRef, useState } from "react";
import { isProjectSkillSource } from "../shared/skill-sources.js";

/** 面板是否附着在一个可写工作区上（workspaceLabel 无工作区时返回占位字符串）。 */
export function hasWorkspaceLabel(workspace: string | undefined): boolean {
  return workspace !== undefined && workspace !== "（无工作区）";
}

/** source 是否属于"项目系"（决定分组归属，composer 弹层的分组口径与此一致）。 */
export const isProjectSource = isProjectSkillSource;

// ---------------------------------------------------------------------------
// v21.3：模块级列表缓存（按作用域/工作区 key）
//
// 切换能力作用域 / 工作区时，先把上一次拿到的同 key 数据**同步**渲染出来
//（缓存命中），同时在后台刷新；无缓存则保留旧数据（stale-while-revalidate），
// 避免列表先清空成「加载中…」。缓存只活到页面卸载（模块级 Map，容量受 key
// 数量限制：三域 × 全局/工作区数）。
// ---------------------------------------------------------------------------

const asyncListCache = new Map<string, unknown>();

/** 清空异步列表缓存（`prefix` 给定时只清该前缀，如 `skills:`；测试用/强制刷新用）。 */
export function clearAsyncListCache(prefix?: string): void {
  if (prefix === undefined) {
    asyncListCache.clear();
    return;
  }
  for (const key of [...asyncListCache.keys()]) {
    if (key.startsWith(prefix)) asyncListCache.delete(key);
  }
}

/**
 * 两域视图共用的"拉取 + 重拉"状态机（v21.3 带可选缓存）。
 *
 * `load` 由调用方组装（Skills 直接 list；MCP 把 list+status+runtime 合并
 * 投影成单个结果对象），返回的结果整体存进 `data`，视图从 `data` 派生
 * 各自的行/错误。依赖变化（挂载、工作区切换）与显式 `reload()` 都会触发
 * 拉取。
 *
 * **`cacheKey`（可选）**：
 * - 同 key 的最近结果缓存在模块级 Map；依赖变化时，若新 key 有缓存则
 *   **渲染阶段同步**返回缓存数据，同时后台刷新（stale-while-revalidate）；
 * - 新 key 无缓存时保留旧 `data`（不清空、不闪「加载中」），刷新完成后替换；
 * - `data` 是否为「本 key 的新鲜结果」由 `loading` 单独表达，视图可据此显示
 *   轻量「刷新中…」而不是整屏 loading。
 *
 * 内部用请求序号守卫：并发触发（连点写操作、工作区快速切换）时只让
 * **最新一次**请求的结果落地，防乱序旧响应覆盖新状态。
 */
export function useAsyncList<T>(
  load: () => Promise<T>,
  deps: readonly unknown[],
  options?: { cacheKey?: string },
): {
  data: T | undefined;
  loading: boolean;
  error: string | undefined;
  reload: (options?: { silent?: boolean }) => void;
} {
  const cacheKey = options?.cacheKey;
  /** 渲染期读取缓存：deps 变化后第一次 render 就能拿到新 key 的缓存（同步渲染）。 */
  const cached = cacheKey !== undefined ? (asyncListCache.get(cacheKey) as T | undefined) : undefined;
  const [state, setState] = useState<{ key?: string; data?: T }>(() => {
    if (cacheKey !== undefined && cached !== undefined) return { key: cacheKey, data: cached };
    return {};
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const seq = useRef(0);
  // `load` 每次 render 都是新函数，用 ref 取最新版，避免把它在 deps 里放大重拉。
  const loadRef = useRef(load);
  loadRef.current = load;

  /**
   * 当前应渲染的数据：
   * - 已对齐到当前 key ⇒ state.data（含后台刷新中的旧值）；
   * - 未对齐但有缓存 ⇒ 缓存（同步渲染，不等 effect）；
   * - 未对齐且无缓存 ⇒ 保留上一次数据（stale-while-revalidate）。
   */
  const data = cacheKey !== undefined && state.key !== cacheKey && cached !== undefined ? cached : state.data;

  const reload = useCallback((options?: { silent?: boolean }) => {
    const run = ++seq.current;
    const key = cacheKey;
    // `silent`：后台轮询（宿主还在重挂时）不要闪「加载中…」把已渲染的列表换成
    // 占位——只有首次加载与用户动作触发的刷新才显示 loading。
    if (options?.silent !== true) setLoading(true);
    setError(undefined);
    loadRef.current()
      .then((value) => {
        if (run !== seq.current) return;
        if (key !== undefined) asyncListCache.set(key, value);
        setState({ key, data: value });
      })
      .catch((err) => {
        if (run !== seq.current) return;
        setError(String(err));
      })
      .finally(() => {
        if (run !== seq.current) return;
        setLoading(false);
      });
    // 依赖由调用方按场景指定（api / workspace / refresh 语义拆分到 load）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, ...deps]);

  useEffect(() => {
    // 缓存命中的 key 先对齐 state（render 阶段已能显示），再后台刷新。
    if (cacheKey !== undefined) {
      const hit = asyncListCache.get(cacheKey) as T | undefined;
      if (hit !== undefined) setState({ key: cacheKey, data: hit });
    }
    reload();
    return () => {
      seq.current += 1; // 卸载或依赖变化后丢弃仍在途的响应
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  return { data, loading, error, reload };
}
