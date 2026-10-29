/**
 * 归属 resolver：T0 运行时栈 → T1 静态字面量 → T2 MCP namespace → T4 人工表 → T3 相似度。
 *
 * 设计：`docs/architecture/plugin-attribution-auto.md` §4（D3/D4）/ §5–§8。
 *
 * 纪律：
 *   - `resolveTool` / `resolveNamespace` **同步**（枚举路径不能 await）；
 *   - 扫描/缓存全部异步后台，绝不阻塞 `tools.list`；未就绪时退化为
 *     T0（已捕获）+ T4 + unknown（最差 = 改造前的表行为）；
 *   - 任一层失败逐层短路，异常只 warn；
 *   - `enableAutoAttribution === false` → 纯 T4（人工表）行为，不挂 T0、不扫描。
 *
 * @module dsh-capability-settings/tools/attribution/resolver
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parseMcpToolName } from "../../mcp/usage.js";
import { attributeMcpNamespace, attributeTool, isHostBuiltinTool } from "../../shared/plugin-attribution.js";
import type { McpNamespaceRule } from "../../shared/plugin-attribution.js";
import { createAttributionCache, type AttributionCache } from "./cache.js";
import { createRuntimeAttributor, type RuntimeAttributor } from "./runtime.js";
import {
  DEFAULT_SCAN_LIMITS,
  isHostPackage,
  rankSimilarity,
  resolvePackageRoots,
  scanPackages,
  type PackageRoot,
  type PackageScanResult,
} from "./scan.js";
import type { NamespaceAttribution, ResolverSnapshot, ToolAttribution } from "./types.js";
import { canonicalUnitId, displayNameOfPackage, normalizePackageId } from "./unit-id.js";
import { errMessage } from "../../shared/errors.js";

/** resolver 构造依赖。 */
export interface AttributionResolverDeps {
  /** 宿主插件 ctx（`on("tools/change")` / `get("tools")` / `get("pluginPackages")`）。 */
  ctx: any;
  dshHome?: string;
  logger?: { warn?: (message: string) => void; info?: (message: string) => void };
  /** `enableAutoAttribution` 开关（缺省 true）。 */
  enabled?: boolean;
  /** 宿主版本指纹覆盖（测试/诊断；缺省自动探测 dsh-tools 版本）。 */
  hostVersion?: string;
}

/** 归属 resolver（对外契约，见设计 §4.3）。 */
export interface AttributionResolver {
  /** 同步：工具名 → 归属（未就绪时退化 T0/T4/unknown）。 */
  resolveTool(toolName: string): ToolAttribution;
  /** MCP 命名空间 → 插件（R4 channel 用；T0' > T2 > 表兜底）。 */
  resolveNamespace(namespace: string): NamespaceAttribution | undefined;
  /** 后台扫描/缓存是否仍在进行（`tools.list.attributionSettling`）。 */
  settling(): boolean;
  /** 强制刷新（按需全量重扫；诊断/测试）。 */
  refresh(options?: { force?: boolean }): Promise<void>;
  /** 列表出现未归属工具时请求惰性扫描（异步、去抖、不阻塞）。 */
  requestScan(): void;
  /** 诊断快照。 */
  snapshot(): ResolverSnapshot;
  dispose(): void;
}

/** 未知结果单例工厂（每次新对象，避免调用方改到共享引用）。 */
function unknownAttribution(): ToolAttribution {
  return { matchedBy: "unknown", confidence: "low" };
}

/** T4：人工表（prefix/exact 旧值保留，保证旧客户端文案不变）。 */
/** T4 人工表解析（导出给无 resolver 的旧装配/测试用）。 */
export function tableToolAttribution(toolName: string): ToolAttribution | undefined {
  const rule = attributeTool(toolName);
  if (rule === undefined) return undefined;
  const raw = rule.packageName ?? rule.display;
  const packageId = canonicalUnitId(raw) ?? canonicalUnitId(rule.display);
  if (packageId === undefined) return undefined;
  return {
    packageId,
    display: rule.display,
    matchedBy: rule.match,
    confidence: "high",
    pattern: rule.pattern,
  };
}

/** T4：MCP 命名空间表兜底（保留 `namespace` 值给既有 MCP UI 文案）。 */
function tableNamespaceAttribution(namespace: string): NamespaceAttribution | undefined {
  const rule: McpNamespaceRule | undefined = attributeMcpNamespace(namespace);
  if (rule === undefined) return undefined;
  const packageId = canonicalUnitId(rule.packageName ?? rule.display);
  if (packageId === undefined) return undefined;
  return { packageId, display: rule.display, matchedBy: "namespace", confidence: "high", pattern: namespace };
}

/** 统计各层命中（诊断）。 */
interface ResolverCounters {
  runtimeHits: number;
  literalHits: number;
  tableHits: number;
  similarityHits: number;
  namespaceHits: number;
  unknownHits: number;
}

/** 创建归属 resolver（组合根单例）。 */
export function createAttributionResolver(deps: AttributionResolverDeps): AttributionResolver {
  const logger = deps.logger;
  const enabled = deps.enabled !== false;
  const ctx = deps.ctx;

  /** 运行时捕获（T0）。 */
  const runtime = new Map<string, { package: string; at: number }>();
  /** 运行时捕获的 MCP 命名空间（T0'）。 */
  const runtimeNamespace = new Map<string, string>();
  /** 字面量 → 候选包集合（T1）。 */
  const literalOwners = new Map<string, Set<string>>();
  /** 命名空间 → 候选包集合（T2）。 */
  const namespaceOwners = new Map<string, Set<string>>();
  /** 已扫描的包（T3 用；键 = 规范包名）。 */
  const packages = new Map<string, PackageScanResult>();
  /** 包根（刷新时复用；只内存，不写缓存）。 */
  let roots: PackageRoot[] = [];

  let settling = false;
  let scanDone = false;
  let lastScanMs = 0;
  let cacheHit = false;
  let failures = 0;
  let lastFailure: string | undefined;
  let started = false;
  let disposed = false;
  let hostVersion = deps.hostVersion ?? "unknown";

  let cache: AttributionCache | undefined;
  let runtimeAttributor: RuntimeAttributor | undefined;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let lazyScanTimer: ReturnType<typeof setTimeout> | undefined;
  let lazyScans = 0;

  const counters: ResolverCounters = {
    runtimeHits: 0,
    literalHits: 0,
    tableHits: 0,
    similarityHits: 0,
    namespaceHits: 0,
    unknownHits: 0,
  };
  const unknownNames = new Set<string>();
  const conflictWarned = new Set<string>();

  /** 重建字面量/命名空间索引（扫描结果/缓存 hydrate 共用）。 */
  function applyScans(scans: Map<string, PackageScanResult>): void {
    for (const [packageId, result] of scans) packages.set(normalizePackageId(packageId), result);
    literalOwners.clear();
    namespaceOwners.clear();
    for (const [packageId, result] of packages) {
      if (isHostPackage(packageId)) continue;
      for (const literal of result.literals) {
        let owners = literalOwners.get(literal);
        if (owners === undefined) {
          owners = new Set<string>();
          literalOwners.set(literal, owners);
        }
        owners.add(packageId);
      }
      for (const namespace of result.namespaceHints) {
        let owners = namespaceOwners.get(namespace);
        if (owners === undefined) {
          owners = new Set<string>();
          namespaceOwners.set(namespace, owners);
        }
        owners.add(packageId);
      }
    }
  }

  /** 首次使用前启动（同步挂 T0，异步读缓存/扫描）。 */
  function ensureStarted(): void {
    if (started || !enabled) return;
    started = true;
    // T0 必须最早挂（覆盖窗口最大）。
    runtimeAttributor = createRuntimeAttributor({
      ctx,
      logger,
      knownSchemas: (): Array<{ name: string; description?: unknown; parameters?: unknown }> => {
        try {
          const schemas = ctx?.get?.("tools")?.schemas?.();
          if (!Array.isArray(schemas)) return [];
          return schemas as Array<{ name: string; description?: unknown; parameters?: unknown }>;
        } catch {
          return [];
        }
      },
      onCapture: (capture): void => {
        for (const tool of capture.tools) runtime.set(tool, { package: capture.packageName, at: capture.at });
        for (const namespace of capture.namespaces) runtimeNamespace.set(namespace, capture.packageName);
        scheduleFlush();
      },
    });
    void init();
  }

  /** 探测宿主版本指纹（`@deepseek-ai/dsh-tools` 的 package.version）。 */
  async function detectHostVersion(): Promise<string> {
    if (deps.hostVersion !== undefined) return deps.hostVersion;
    try {
      const packagesService = ctx?.get?.("pluginPackages");
      const found = typeof packagesService?.packageOf === "function" ? packagesService.packageOf("@deepseek-ai/dsh-tools", undefined) : undefined;
      if (typeof found?.dir !== "string") return "unknown";
      const raw = await readFile(join(found.dir, "package.json"), "utf8");
      const version = (JSON.parse(raw) as { version?: unknown }).version;
      return typeof version === "string" && version.length > 0 ? version : "unknown";
    } catch {
      return "unknown";
    }
  }

  /** 把缓存内容 hydrate 进内存索引。 */
  function hydrateFromCache(file: {
    packages: Record<string, PackageScanResult>;
    runtime: Record<string, { package: string; at: number }>;
  }): void {
    const scans = new Map<string, PackageScanResult>();
    for (const [packageId, scan] of Object.entries(file.packages)) {
      scans.set(packageId, {
        version: scan.version,
        mtimeMs: scan.mtimeMs,
        literals: Array.isArray(scan.literals) ? scan.literals : [],
        namespaceHints: Array.isArray(scan.namespaceHints) ? scan.namespaceHints : [],
      });
    }
    applyScans(scans);
    for (const [tool, entry] of Object.entries(file.runtime)) {
      if (typeof entry?.package !== "string" || entry.package.length === 0) continue;
      runtime.set(tool, { package: entry.package, at: typeof entry.at === "number" ? entry.at : 0 });
      if (tool.startsWith("mcp__")) {
        const parsed = parseMcpToolName(tool);
        if (parsed !== undefined) runtimeNamespace.set(parsed.serverName, entry.package);
      }
    }
  }

  /** 异步初始化：读缓存（命中零扫描）→ 否则后台全量扫描。 */
  async function init(): Promise<void> {
    try {
      hostVersion = deps.hostVersion ?? (await detectHostVersion());
      cache = createAttributionCache({ dshHome: deps.dshHome, hostVersion, logger });
      const cached = await cache.load();
      if (cached !== undefined) {
        hydrateFromCache({ packages: cached.packages, runtime: cached.runtime });
        cacheHit = true;
        scanDone = true;
        // 缓存命中也可能缺包根（新装插件）：后台增量补齐（不阻塞）。
        void refresh({ force: false }).catch(() => undefined);
        return;
      }
      settling = true;
      await refresh({ force: true });
      settling = false;
    } catch (error) {
      settling = false;
      scanDone = true;
      failures += 1;
      lastFailure = errMessage(error);
      logger?.warn?.(`capability-panel: 归属初始化失败，退化为人工表（${errMessage(error)}）`);
    }
  }

  /** 全量/增量扫描（force=false 时只补缺失包）。 */
  async function refresh(options: { force?: boolean } = {}): Promise<void> {
    if (!enabled || disposed) return;
    const force = options.force === true;
    settling = true;
    try {
      const discovered = await resolvePackageRoots(ctx);
      roots = discovered;
      const targets = force ? discovered : discovered.filter((root) => !packages.has(normalizePackageId(root.packageId)));
      if (targets.length === 0) {
        scanDone = true;
        settling = false;
        return;
      }
      const report = await scanPackages(targets, DEFAULT_SCAN_LIMITS, logger);
      applyScans(report.packages);
      lastScanMs = report.ms;
      scanDone = true;
      for (const [packageId, reason] of Object.entries(report.failures)) {
        failures += 1;
        lastFailure = `${packageId}: ${reason}`;
      }
      if (report.packages.size > 0 && cache !== undefined) {
        const packagesUpdate: Record<string, PackageScanResult> = {};
        for (const [packageId, result] of report.packages) packagesUpdate[packageId] = result;
        await cache.save({
          packages: packagesUpdate,
          ...(Object.keys(report.failures).length > 0
            ? {
                failures: Object.fromEntries(
                  Object.entries(report.failures).map(([packageId, reason]) => [packageId, { reason, at: Date.now() }]),
                ),
              }
            : {}),
        });
      }
      logger?.info?.(
        `attribution scan: packages=${report.packages.size} literals=${report.files} ms=${report.ms}`,
      );
    } catch (error) {
      failures += 1;
      lastFailure = errMessage(error);
      logger?.warn?.(`capability-panel: 归属扫描失败（${errMessage(error)}）`);
    } finally {
      settling = false;
    }
  }

  /** 2s debounce 写缓存（T0 增量；不阻塞注册路径）。 */
  function scheduleFlush(): void {
    if (!enabled || disposed || cache === undefined || flushTimer !== undefined) return;
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      if (disposed || cache === undefined) return;
      const runtimeUpdate = Object.fromEntries(runtime);
      void cache.save({ runtime: runtimeUpdate });
    }, 2000);
    if (typeof flushTimer === "object" && flushTimer !== null && "unref" in flushTimer) {
      (flushTimer as { unref?: () => void }).unref?.();
    }
  }

  /** 是否已过「静态索引可用」阶段（T3 只在索引就绪后用，避免假阴性后又被覆盖）。 */
  function staticReady(): boolean {
    return scanDone;
  }

  /** 请求惰性扫描（去抖 1s；每次进程最多 3 次，防抖动风暴）。 */
  function requestScan(): void {
    if (!enabled || disposed || lazyScanTimer !== undefined || lazyScans >= 3) return;
    lazyScanTimer = setTimeout(() => {
      lazyScanTimer = undefined;
      lazyScans += 1;
      void refresh({ force: false });
    }, 1000);
    if (typeof lazyScanTimer === "object" && lazyScanTimer !== null && "unref" in lazyScanTimer) {
      (lazyScanTimer as { unref?: () => void }).unref?.();
    }
  }

  /** 记录 T1 与 T4 冲突（warn 一次/tool）。 */
  function noteConflict(toolName: string, tablePackage: string, literalPackage: string): void {
    if (conflictWarned.has(toolName)) return;
    conflictWarned.add(toolName);
    logger?.warn?.(
      `capability-panel: 工具 ${toolName} 的包扫描归属（${literalPackage}）与人工表（${tablePackage}）冲突，采用更高优先级的扫描结果`,
    );
  }

  /** 同步解析一个工具名。 */
  function resolveTool(toolName: string): ToolAttribution {
    if (typeof toolName !== "string" || toolName.length === 0) return unknownAttribution();
    if (!enabled) return tableToolAttribution(toolName) ?? unknownAttribution();
    ensureStarted();
    const captured = runtime.get(toolName);
    if (captured !== undefined) {
      counters.runtimeHits += 1;
      return {
        packageId: captured.package,
        display: displayNameOfPackage(captured.package),
        matchedBy: "runtime",
        confidence: "high",
      };
    }
    const table = tableToolAttribution(toolName);
    const owners = literalOwners.get(toolName);
    if (owners !== undefined && owners.size === 1) {
      const packageId = [...owners][0] as string;
      counters.literalHits += 1;
      const result: ToolAttribution = {
        packageId,
        display: displayNameOfPackage(packageId),
        matchedBy: "literal",
        confidence: "high",
        pattern: toolName,
      };
      if (table !== undefined && table.packageId !== packageId) {
        result.conflictsWithTable = true;
        noteConflict(toolName, table.packageId ?? "?", packageId);
      }
      return result;
    }
    if (table !== undefined) {
      counters.tableHits += 1;
      const result: ToolAttribution = { ...table };
      if (owners !== undefined && owners.size > 1 && table.packageId !== undefined && !owners.has(table.packageId)) {
        result.conflictsWithTable = true;
      }
      return result;
    }
    if (staticReady()) {
      const ranked = rankSimilarity(packages.keys(), toolName);
      const best = ranked[0];
      const second = ranked[1];
      if (best !== undefined && best.score >= 0.5) {
        const margin = best.score - (second?.score ?? 0);
        if (margin >= 0.3) {
          counters.similarityHits += 1;
          return {
            packageId: best.packageId,
            display: displayNameOfPackage(best.packageId),
            matchedBy: "similarity",
            confidence: "medium",
            pattern: best.packageId,
            evidence: `score=${best.score.toFixed(2)} margin=${margin.toFixed(2)}`,
          };
        }
        counters.unknownHits += 1;
        if (unknownNames.size < 32) unknownNames.add(toolName);
        return { ...unknownAttribution(), ambiguous: true };
      }
    }
    counters.unknownHits += 1;
    if (unknownNames.size < 32) unknownNames.add(toolName);
    // 出现未知工具 → 请求后台惰性扫描（不阻塞）。
    if (staticReady()) requestScan();
    return unknownAttribution();
  }

  /** 同步解析 MCP 命名空间。 */
  function resolveNamespace(namespace: string): NamespaceAttribution | undefined {
    if (typeof namespace !== "string" || namespace.length === 0) return undefined;
    if (!enabled) return tableNamespaceAttribution(namespace);
    ensureStarted();
    const runtimePackage = runtimeNamespace.get(namespace);
    if (runtimePackage !== undefined) {
      counters.namespaceHits += 1;
      return {
        packageId: runtimePackage,
        display: displayNameOfPackage(runtimePackage),
        matchedBy: "runtime",
        confidence: "high",
        pattern: namespace,
      };
    }
    const owners = namespaceOwners.get(namespace);
    if (owners !== undefined && owners.size === 1) {
      const packageId = [...owners][0] as string;
      counters.namespaceHits += 1;
      return { packageId, display: displayNameOfPackage(packageId), matchedBy: "namespace", confidence: "high", pattern: namespace };
    }
    const table = tableNamespaceAttribution(namespace);
    if (table !== undefined) counters.namespaceHits += 1;
    return table;
  }

  /** 是否仍在后台收敛（未启动也视为 false：不阻塞首屏）。 */
  function settlingNow(): boolean {
    return enabled && (settling || (started && !scanDone && !cacheHit));
  }

  /** 诊断快照。 */
  function snapshot(): ResolverSnapshot {
    return {
      enabled,
      settling: settlingNow(),
      runtimeDisabled: runtimeAttributor?.disabled() === true,
      packages: packages.size,
      literals: literalOwners.size,
      runtime: runtime.size,
      namespace: runtimeNamespace.size,
      unknownSample: [...unknownNames].slice(0, 32),
      failures,
      ...(lastFailure !== undefined ? { lastFailure } : {}),
      lastScanMs,
      cacheHit,
    };
  }

  /** 诊断计数（内部用；通过 snapshot 之外的 API 不暴露）。 */
  function countersSnapshot(): ResolverCounters {
    return { ...counters };
  }
  // 供测试/诊断读取各层命中（additive 方法，非契约必需）。
  (resolveTool as unknown as { counters?: () => ResolverCounters }).counters = () => countersSnapshot();

  return {
    resolveTool,
    resolveNamespace,
    settling: settlingNow,
    refresh,
    requestScan,
    snapshot,
    dispose(): void {
      disposed = true;
      runtimeAttributor?.dispose();
      if (flushTimer !== undefined) clearTimeout(flushTimer);
      if (lazyScanTimer !== undefined) clearTimeout(lazyScanTimer);
      flushTimer = undefined;
      lazyScanTimer = undefined;
      cache?.dispose();
    },
  };
}

/** 工具名是否为 Tools 域候选（域名恒等判定：非 mcp、非宿主内建）。 */
export function isToolCandidates(name: string): boolean {
  if (typeof name !== "string" || name.length === 0) return false;
  if (parseMcpToolName(name) !== undefined) return false;
  if (isHostBuiltinTool(name)) return false;
  return true;
}

export type { PackageScanResult };
