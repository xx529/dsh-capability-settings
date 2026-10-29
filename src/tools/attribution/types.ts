/**
 * 自动归属（resolver）的共享类型与缓存文件契约。
 *
 * 设计：`docs/architecture/plugin-attribution-auto.md` §4.3 / §7 / §8
 * （字段名是契约，不得改名）。
 *
 * @module dsh-capability-settings/tools/attribution/types
 */

/** 归属依据（additive；旧值 `prefix` / `exact` / `source` 继续被识别）。 */
export type AttributionMatchedBy =
  | "runtime"
  | "literal"
  | "namespace"
  | "table"
  | "similarity"
  | "prefix"
  | "exact"
  | "source"
  | "unknown";

/** 置信度（UI 决定是否标「推测」）。 */
export type AttributionConfidence = "high" | "medium" | "low";

/**
 * 运行时归属（T0）用到的信号，只做置信度/诊断区分，不是 UI 契约。
 *
 * - `access`：**调用方身份**——`internal/get` 里 cordis 在服务解析点创建的
 *   `Error` 栈（第一帧即访问方插件）＋ `fiber.name`。它不经过任何
 *   `tools.register` 拦截器，置信度 high。
 * - `register-stack`：兜底——`tools/change` 监听器里的注册调用栈，取**最后一个**
 *   第三方帧（最靠近真实调用方），并拒绝已识别的拦截器包，置信度 medium。
 */
export type RuntimeSignal = "access" | "register-stack";

/** 单个工具名 → 插件包的归属结果。 */
export interface ToolAttribution {
  /** 命中时的包 id（= Tools unit）；unknown 缺省。 */
  packageId?: string;
  /** 展示名（去 scope；表回退时用表 display）。 */
  display?: string;
  matchedBy: AttributionMatchedBy;
  confidence: AttributionConfidence;
  /** 命中依据原文：字面量 / 规则 pattern / 命名空间 / 包名。 */
  pattern?: string;
  /** 诊断：T1/T3 结果与人工表（T4）不一致。 */
  conflictsWithTable?: boolean;
  /** 诊断：有多个同等候选（T1 歧义 / T3 margin 不足）。 */
  ambiguous?: boolean;
  /** 人读一句（诊断用；UI 文案以 matchedBy 为主）。 */
  evidence?: string;
}

/** MCP 命名空间 → 插件归属（R4 channel 用）。 */
export interface NamespaceAttribution {
  packageId?: string;
  display?: string;
  matchedBy: AttributionMatchedBy;
  confidence: AttributionConfidence;
  pattern?: string;
}

/** resolver 诊断快照（日志/tester；不跨 RPC）。 */
export interface ResolverSnapshot {
  /** `enableAutoAttribution` 是否开启。 */
  enabled: boolean;
  /** 是否仍在后台扫描/回填（`tools.list.attributionSettling`）。 */
  settling: boolean;
  /** T0 是否已因连续失败禁用。 */
  runtimeDisabled: boolean;
  /** 已知包数 / 字面量索引大小 / 运行时命中数。 */
  packages: number;
  literals: number;
  runtime: number;
  namespace: number;
  /** 当前仍为 unknown 的候选工具名（诊断样例，最多 32 个）。 */
  unknownSample: string[];
  /** 累计失败次数与最近一次原因。 */
  failures: number;
  lastFailure?: string;
  /** 最近一次扫描耗时（毫秒；缓存命中为 0）。 */
  lastScanMs: number;
  cacheHit: boolean;
  /** 交叉校验识别出的拦截器包（兜底路径跳过它们；诊断用）。 */
  interceptors?: string[];
  /** T0 监听是否已挂上（tools 服务就绪即挂）。 */
  runtimeAttached?: boolean;
}

/** 缓存文件里的单包扫描结果（不含绝对路径）。 */
export interface CachedPackageScan {
  /** 包版本。 */
  version: string;
  /** 包根 mtimeMs（目录 mtime；探测不到为 0）。 */
  mtimeMs: number;
  /** 扫描到的「像工具名」的字面量（已过滤）。 */
  literals: string[];
  /** 命名空间字面量（`mcp__<ns>__` 里出现过的 ns）。 */
  namespaceHints: string[];
}

/** 缓存里的运行时归属条目。 */
export interface CachedRuntimeAttribution {
  package: string;
  at: number;
  /** 信号置信度（v2 起写入；旧条目缺省视为 high）。 */
  confidence?: AttributionConfidence;
}

/**
 * 缓存文件 v2 形状（`<dshHome>/.../tool-attribution.json`）。
 *
 * v1 → v2 迁移：**保留** `packages` 扫描结果，**丢弃** `runtime`（v1 的运行时
 * 归属可能被 `register` 拦截器污染，不能跨进程复用）与 `interceptors`。
 */
export interface ToolAttributionCacheFile {
  version: 2;
  generatedAt: number;
  /** 宿主版本指纹（`@deepseek-ai/dsh-tools` 的 package version；探测不到为 "unknown"）。 */
  hostVersion: string;
  /** 写缓存的插件包名（D12；换包名/换实现时旧缓存自动无效）。 */
  selfPackage: string;
  packages: Record<string, CachedPackageScan>;
  /** T0 运行时捕获（tool → packageId + 时间；**不含** `mcp__*`）。 */
  runtime: Record<string, CachedRuntimeAttribution>;
  /** 最近失败（包名 → 原因/时间；诊断）。 */
  failures?: Record<string, { reason: string; at: number }>;
  /** 交叉校验识别出的拦截器包（兜底路径跳过；最多 50 个）。 */
  interceptors?: string[];
}

/** 当前缓存版本。 */
export const TOOL_ATTRIBUTION_CACHE_VERSION = 2;

/** 缓存文件名。 */
export const TOOL_ATTRIBUTION_CACHE_FILE = "tool-attribution.json";
