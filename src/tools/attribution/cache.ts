/**
 * 归属扫描缓存 `<dshHome>/dsh-capability-settings/tool-attribution.json`（D7/§8）。
 *
 * 契约：
 *   - `version: 2`；`hostVersion` / `selfPackage` 作为整体失效键；
 *   - **v1 → v2 迁移**：保留 `packages` 扫描结果（省一次全量重扫），丢弃
 *     `runtime` 与 `interceptors` —— v1 的运行时归属可能被 `register` 拦截器
 *     污染（本机 `dsh-context` 案例），不能跨进程复用；`interceptors` 是 v2
 *     新增的交叉校验结果；
 *   - 单包失效键 = 包名 + version + mtimeMs（宿主版本变化时整份失效）；
 *   - 原子写（0600 / 目录 0700）+ `withFileLock` 锁内**读盘合并**（多实例/多次
 *     写入不丢别人的包结果）+ 进程内串行队列；
 *   - 损坏 / 未知 version → warn + 按空缓存继续（后台重建），**不抛**；
 *   - 只存包名/版本/mtime/字面量（**不存绝对路径**）。
 *
 * @module dsh-capability-settings/tools/attribution/cache
 */

import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";

import { atomicWriteText } from "../../shared/atomic-write.js";
import { errMessage } from "../../shared/errors.js";
import { withFileLock } from "../../shared/file-lock.js";
import { readJsonDocument } from "../../shared/json-config.js";
import { SESSION_STATE_DIR_NAME } from "../../session-state.js";
import {
  TOOL_ATTRIBUTION_CACHE_FILE,
  TOOL_ATTRIBUTION_CACHE_VERSION,
  type CachedPackageScan,
  type CachedRuntimeAttribution,
  type ToolAttributionCacheFile,
} from "./types.js";
import { SELF_PACKAGE } from "./unit-id.js";

/** 目录/文件权限（与既有配置文件一致）。 */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** 缓存文件路径：`<dshHome>/dsh-capability-settings/tool-attribution.json`。 */
export function attributionCacheFile(dshHome?: string): string {
  return join(resolveDshHome(dshHome), SESSION_STATE_DIR_NAME, TOOL_ATTRIBUTION_CACHE_FILE);
}

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
  failures?: Record<string, { reason: string; at: number }>;
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
  logger?: { warn?: (message: string) => void };
  now?: () => number;
}

/** 清洗一个单包扫描结果。 */
function sanitizePackage(raw: unknown): CachedPackageScan | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const literals = Array.isArray(value.literals)
    ? value.literals.filter((item): item is string => typeof item === "string").slice(0, 50000)
    : [];
  const namespaceHints = Array.isArray(value.namespaceHints)
    ? value.namespaceHints.filter((item): item is string => typeof item === "string").slice(0, 500)
    : [];
  return {
    version: typeof value.version === "string" ? value.version : "unknown",
    mtimeMs: typeof value.mtimeMs === "number" && Number.isFinite(value.mtimeMs) ? Math.trunc(value.mtimeMs) : 0,
    literals,
    namespaceHints,
  };
}

/** 清洗拦截器包名单（只接受包名形态，去重、最多 50 个）。 */
function sanitizeInterceptors(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const found: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const value = item.trim().toLowerCase();
    if (value.length === 0 || value.length > 214 || found.includes(value)) continue;
    found.push(value);
  }
  return found.slice(0, 50);
}

/**
 * 整体校验缓存文件。
 *
 * v1 兼容：`version: 1` 的 `packages` 继续可用（省一次全量扫描），但 v1 的
 * `runtime` 可能被注册拦截器污染，**一律丢弃**；`interceptors` 为 v2 新增。
 */
function sanitizeCache(raw: Record<string, unknown>, deps: AttributionCacheDeps): ToolAttributionCacheFile | undefined {
  const rawVersion = typeof raw.version === "number" ? raw.version : undefined;
  const legacy = rawVersion === 1;
  if (rawVersion !== TOOL_ATTRIBUTION_CACHE_VERSION && !legacy) return undefined;
  if (typeof raw.selfPackage === "string" && raw.selfPackage !== SELF_PACKAGE) return undefined;
  const hostVersion = typeof raw.hostVersion === "string" ? raw.hostVersion : "unknown";
  if (hostVersion !== "unknown" && deps.hostVersion !== "unknown" && hostVersion !== deps.hostVersion) return undefined;
  const packages: Record<string, CachedPackageScan> = {};
  const rawPackages = raw.packages !== null && typeof raw.packages === "object" ? (raw.packages as Record<string, unknown>) : {};
  for (const [key, value] of Object.entries(rawPackages)) {
    const scan = sanitizePackage(value);
    if (scan !== undefined) packages[key] = scan;
  }
  const runtime: ToolAttributionCacheFile["runtime"] = {};
  const rawRuntime =
    !legacy && raw.runtime !== null && typeof raw.runtime === "object" ? (raw.runtime as Record<string, unknown>) : {};
  for (const [tool, value] of Object.entries(rawRuntime)) {
    // `mcp__*` 恒归 MCP 域（命名空间层），v2 起不再把工具归属写进 runtime。
    if (tool.startsWith("mcp__")) continue;
    if (value === null || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    if (typeof entry.package !== "string" || entry.package.length === 0) continue;
    const confidence = entry.confidence === "medium" ? "medium" : "high";
    runtime[tool] = {
      package: entry.package,
      at: typeof entry.at === "number" ? entry.at : 0,
      confidence,
    };
  }
  const failures: ToolAttributionCacheFile["failures"] = {};
  const rawFailures = raw.failures !== null && typeof raw.failures === "object" ? (raw.failures as Record<string, unknown>) : {};
  for (const [key, value] of Object.entries(rawFailures)) {
    if (value === null || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    if (typeof entry.reason !== "string") continue;
    failures[key] = { reason: entry.reason, at: typeof entry.at === "number" ? entry.at : 0 };
  }
  return {
    version: TOOL_ATTRIBUTION_CACHE_VERSION,
    generatedAt: typeof raw.generatedAt === "number" ? raw.generatedAt : 0,
    hostVersion,
    selfPackage: SELF_PACKAGE,
    packages,
    runtime,
    failures,
    interceptors: legacy ? [] : sanitizeInterceptors(raw.interceptors),
  };
}

/** 创建缓存读写器。 */
export function createAttributionCache(deps: AttributionCacheDeps): AttributionCache {
  const logger = deps.logger;
  const now = deps.now ?? (() => Date.now());
  const filePath = attributionCacheFile(deps.dshHome);
  /** 进程内串行：写缓存不并发互相覆盖。 */
  let queue: Promise<void> = Promise.resolve();
  let disposed = false;

  return {
    filePath,

    async load(): Promise<ToolAttributionCacheFile | undefined> {
      try {
        const raw = await readJsonDocument(filePath, "tool attribution cache");
        if (raw === undefined) return undefined;
        return sanitizeCache(raw, deps);
      } catch (error) {
        logger?.warn?.(`capability-panel: 归属缓存损坏，按空缓存重建（${errMessage(error)}）`);
        return undefined;
      }
    },

    save(update: CacheUpdate): Promise<void> {
      if (disposed) return Promise.resolve();
      const run = queue.then(async () => {
        try {
          await withFileLock(filePath, async () => {
            let disk: ToolAttributionCacheFile | undefined;
            try {
              const raw = await readJsonDocument(filePath, "tool attribution cache");
              disk = raw === undefined ? undefined : sanitizeCache(raw, deps);
            } catch {
              disk = undefined;
            }
            const packages = update.replacePackages === true ? {} : { ...(disk?.packages ?? {}) };
            Object.assign(packages, update.packages ?? {});
            // runtime：按 `at` 取更新，最多保留 500 条。
            const runtime: ToolAttributionCacheFile["runtime"] = update.replacePackages === true ? {} : { ...(disk?.runtime ?? {}) };
            for (const [tool, entry] of Object.entries(update.runtime ?? {})) {
              const previous = runtime[tool];
              if (previous === undefined || entry.at >= previous.at) runtime[tool] = entry;
            }
            const runtimeEntries = Object.entries(runtime)
              .sort((left, right) => right[1].at - left[1].at)
              .slice(0, 500);
            const failures = { ...(disk?.failures ?? {}), ...(update.failures ?? {}) };
            const failureEntries = Object.entries(failures)
              .sort((left, right) => right[1].at - left[1].at)
              .slice(0, 50);
            const interceptors = sanitizeInterceptors([
              ...(disk?.interceptors ?? []),
              ...(update.interceptors ?? []),
            ]);
            const body: ToolAttributionCacheFile = {
              version: TOOL_ATTRIBUTION_CACHE_VERSION,
              generatedAt: now(),
              hostVersion: deps.hostVersion,
              selfPackage: SELF_PACKAGE,
              packages,
              runtime: Object.fromEntries(runtimeEntries),
              failures: Object.fromEntries(failureEntries),
              interceptors,
            };
            const dir = join(resolveDshHome(deps.dshHome), SESSION_STATE_DIR_NAME);
            await mkdir(dir, { recursive: true, mode: DIR_MODE });
            await chmod(dir, DIR_MODE).catch(() => undefined);
            await atomicWriteText(filePath, `${JSON.stringify(body, null, 2)}\n`, "tool-attribution", { mode: FILE_MODE });
          });
        } catch (error) {
          logger?.warn?.(`capability-panel: 写入归属缓存失败（${errMessage(error)}）`);
        }
      });
      queue = run.catch(() => undefined);
      return run;
    },

    dispose(): void {
      disposed = true;
    },
  };
}
