/**
 * 归属扫描缓存 `<dshHome>/dsh-capability-settings/tool-attribution.json`（D7/§8）。
 *
 * 契约：
 *   - `version: 3`；`hostVersion` / `selfPackage` 作为整体失效键；
 *   - **< v3 迁移**：保留 `packages` 扫描结果（省一次全量重扫）；`v1` 的
 *     `runtime` 全丢（`dsh-context` 包装 `register` 污染）；`v2` 的 `runtime`
 *     逐条校验——与人工表冲突的条目视为被监听拦截器污染（本机
 *     `dsh-trace-inspect/desc-inject`）丢弃，不冲突的保留；`interceptors` 不跨
 *     版本复用；
 *   - 单包失效键 = 包名 + version + mtimeMs（宿主版本变化时整份失效）；
 *   - 原子写（0600 / 目录 0700）+ `withFileLock` 锁内**读盘合并**（多实例/多次
 *     写入不丢别人的包结果）+ 进程内串行队列；
 *   - 损坏 / 未知 version → warn + 按空缓存继续（后台重建），**不抛**；
 *   - 只存包名/版本/mtime/字面量（**不存绝对路径**）。
 *
 * @module dsh-capability-settings/tools/attribution/cache
 */
import { type CachedPackageScan, type CachedRuntimeAttribution, type ToolAttributionCacheFile } from "./types.js";
/** 缓存文件路径：`<dshHome>/dsh-capability-settings/tool-attribution.json`。 */
export declare function attributionCacheFile(dshHome?: string): string;
/** 缓存读写器。 */
export interface AttributionCache {
    readonly filePath: string;
    /** 读缓存；缺失/损坏/未知 version/宿主版本不符 → undefined（warn 由调用方决定）。 */
    load(): Promise<ToolAttributionCacheFile | undefined>;
    /**
     * 合并写：只覆盖 `update` 里给出的包/运行时/失败项，其余保留磁盘上的值。
     * 内部串行（同一进程多次调用排队）；写失败只 warn，不抛。
     */
    save(update: CacheUpdate): Promise<void>;
    dispose(): void;
}
/** 一次缓存更新（可选字段；缺省 = 不更新该部分）。 */
export interface CacheUpdate {
    packages?: Record<string, CachedPackageScan>;
    runtime?: Record<string, CachedRuntimeAttribution>;
    failures?: Record<string, {
        reason: string;
        at: number;
    }>;
    /** 交叉校验识别出的拦截器包（并集合并，最多 50 个）。 */
    interceptors?: string[];
    /** 是否**替换** packages（默认合并）。 */
    replacePackages?: boolean;
}
/** 缓存构造依赖。 */
export interface AttributionCacheDeps {
    dshHome?: string;
    /** 宿主版本指纹（`@deepseek-ai/dsh-tools` 版本；探测不到 "unknown"）。 */
    hostVersion: string;
    logger?: {
        warn?: (message: string) => void;
    };
    now?: () => number;
}
/** 创建缓存读写器。 */
export declare function createAttributionCache(deps: AttributionCacheDeps): AttributionCache;
