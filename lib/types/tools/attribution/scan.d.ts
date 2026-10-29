/**
 * T1/T2/T3 的静态侧：包根发现 + 源码字面量索引 + 名字相似度。
 *
 * 设计：`docs/architecture/plugin-attribution-auto.md` §6（T1/T2）与 §5 相似度阈值；
 * 证据 §3（本机 26 个第三方 bundle 扫描 0.46s / 23k 字面量，跳 artifacts 与大文件）。
 *
 * 安全：**只读文本、绝不执行**被测插件的代码；跳过 node_modules/artifacts/test
 * 与大文件；单包/总量 deadline 到点放弃（记 failures），不阻塞事件循环。
 *
 * @module dsh-capability-settings/tools/attribution/scan
 */
import { normalizePackageId } from "./unit-id.js";
/** 一个可扫描的插件包根。 */
export interface PackageRoot {
    /** 规范包名（= 候选 unit id）。 */
    packageId: string;
    /** 包根绝对路径（只在内存使用，**不写缓存**）。 */
    dir: string;
    version: string;
    mtimeMs: number;
}
/** 扫描限额（D8 性能预算）。 */
export interface ScanLimits {
    /** 单文件字节上限。 */
    fileBytes: number;
    /** 单包文件数上限。 */
    filesPerPackage: number;
    /** 单包 deadline（毫秒）。 */
    deadlineMs: number;
    /** 单包累计读入字节上限。 */
    totalBytes: number;
}
/** 默认限额（证据 §3.2 / §10 R6）。 */
export declare const DEFAULT_SCAN_LIMITS: ScanLimits;
/** 扫描产物（可写入缓存；不含绝对路径）。 */
export interface PackageScanResult {
    version: string;
    mtimeMs: number;
    literals: string[];
    namespaceHints: string[];
}
/** 扫描汇总。 */
export interface ScanReport {
    packages: Map<string, PackageScanResult>;
    files: number;
    bytes: number;
    ms: number;
    /** 包名 → 失败原因（超时/读失败；诊断）。 */
    failures: Record<string, string>;
}
/** 宿主/框架包：永不作为插件归属（app.asar 与 profile 内的 @deepseek-ai/* 包）。 */
export declare function isHostPackage(packageId: string): boolean;
/**
 * 发现可扫描的第三方插件包根（D6）。
 *
 * 首选宿主 `pluginPackages.packageOf(name, baseUrl)?.dir`（官方消费范例
 * `dsh-tool-cordis`）；拿不到的条目回退 `createRequire(baseUrl).resolve.paths(name)`
 * 探测；仍拿不到 → 跳过该包（仅 T0/T3 覆盖）。自身包与宿主包一律排除。
 */
export declare function resolvePackageRoots(ctx: any): Promise<PackageRoot[]>;
/** 从源码文本提取字面量（纯字符串正则，不执行代码）。 */
export declare function extractLiterals(source: string): {
    literals: string[];
    namespaces: string[];
};
/**
 * 扫描一个包（异步、限额、让出事件循环）。返回 undefined = 超时/失败。
 */
export declare function scanPackage(root: PackageRoot, limits?: ScanLimits): Promise<PackageScanResult | undefined>;
/** 批量扫描（串行；单包超时记 failures）。 */
export declare function scanPackages(roots: readonly PackageRoot[], limits?: ScanLimits, logger?: {
    warn?: (message: string) => void;
}): Promise<ScanReport>;
/** 分词。 */
export declare function tokenizeName(value: string): string[];
/**
 * T3 相似度：包名 token ∩ 工具名 token / min(token 数)。
 *
 * 阈值由 resolver 决定（设计：score ≥0.5 且 margin ≥0.3 才采用）。
 */
export declare function similarityScore(packageId: string, toolName: string): number;
/** 计算最佳/次佳相似度（供 margin 判定）。 */
export declare function rankSimilarity(packageIds: Iterable<string>, toolName: string): Array<{
    packageId: string;
    score: number;
}>;
/** 包名归一工具（re-export 方便调用方一处 import）。 */
export { normalizePackageId };
