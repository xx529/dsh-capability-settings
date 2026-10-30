/**
 * 归属 resolver：T0 运行时（调用方身份优先）→ T1 静态字面量 → T2 MCP namespace
 * → T4 人工表 → T3 相似度。
 *
 * 设计：`docs/architecture/plugin-attribution-auto.md` §4（D3/D4）/ §5–§8。
 *
 * 纪律：
 *   - `resolveTool` / `resolveNamespace` **同步**（枚举路径不能 await）；
 *   - 扫描/缓存全部异步后台，绝不阻塞 `tools.list`；未就绪时退化为
 *     T0（已捕获）+ T4 + unknown（最差 = 改造前的表行为）；
 *   - 任一层失败逐层短路，异常只 warn；
 *   - `enableAutoAttribution === false` → 纯 T4（人工表）行为，不挂 T0、不扫描；
 *   - **T0 尽早挂**：tools 服务一可用就挂（不等面板首次查询），但扫描/缓存仍
 *     惰性启动，不拖慢宿主启动；
 *   - 身份映射：`fiber.name → 包 id`（loader entries）与「包根 realpath → 包 id」
 *     （解决 `link:`/`@local/*` 帧路径不含 `node_modules` 的老问题）。
 *
 * @module dsh-capability-settings/tools/attribution/resolver
 */
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { parseMcpToolName } from "../../mcp/usage.js";
import { attributeMcpNamespace, attributeTool, isHostBuiltinTool } from "../../shared/plugin-attribution.js";
import { createAttributionCache } from "./cache.js";
import { createRuntimeAttributor } from "./runtime.js";
import { DEFAULT_SCAN_LIMITS, isHostPackage, rankSimilarity, resolvePackageRoots, scanPackages, } from "./scan.js";
import { canonicalUnitId, displayNameOfPackage, normalizePackageId } from "./unit-id.js";
import { errMessage } from "../../shared/errors.js";
/** 未知结果单例工厂（每次新对象，避免调用方改到共享引用）。 */
function unknownAttribution() {
    return { matchedBy: "unknown", confidence: "low" };
}
/** T4：人工表（prefix/exact 旧值保留，保证旧客户端文案不变）。 */
/** T4 人工表解析（导出给无 resolver 的旧装配/测试用）。 */
export function tableToolAttribution(toolName) {
    const rule = attributeTool(toolName);
    if (rule === undefined)
        return undefined;
    const raw = rule.packageName ?? rule.display;
    const packageId = canonicalUnitId(raw) ?? canonicalUnitId(rule.display);
    if (packageId === undefined)
        return undefined;
    return {
        packageId,
        display: rule.display,
        matchedBy: rule.match,
        confidence: "high",
        pattern: rule.pattern,
    };
}
/** T4：MCP 命名空间表兜底（保留 `namespace` 值给既有 MCP UI 文案）。 */
function tableNamespaceAttribution(namespace) {
    const rule = attributeMcpNamespace(namespace);
    if (rule === undefined)
        return undefined;
    const packageId = canonicalUnitId(rule.packageName ?? rule.display);
    if (packageId === undefined)
        return undefined;
    return { packageId, display: rule.display, matchedBy: "namespace", confidence: "high", pattern: namespace };
}
/** 创建归属 resolver（组合根单例）。 */
export function createAttributionResolver(deps) {
    const logger = deps.logger;
    const enabled = deps.enabled !== false;
    const ctx = deps.ctx;
    /** 运行时捕获（T0；**不含** `mcp__*`）。 */
    const runtime = new Map();
    /** 运行时捕获的插件自注册 MCP 命名空间（T0'；只接受身份信号）。 */
    const runtimeNamespace = new Map();
    /** 交叉校验识别出的注册拦截器包（兜底路径跳过；持久化到缓存）。 */
    const suspects = new Set();
    /** fiber 名 → 包 id（loader entries + 已扫描包名/展示名）。 */
    const fiberToPackage = new Map();
    /** 包根（原路径 + realpath）→ 包 id，按目录长度倒序前缀匹配。 */
    let dirPackages = [];
    /** 字面量 → 候选包集合（T1）。 */
    const literalOwners = new Map();
    /** 命名空间 → 候选包集合（T2）。 */
    const namespaceOwners = new Map();
    /** 已扫描的包（T3 用；键 = 规范包名）。 */
    const packages = new Map();
    /** 包根（刷新时复用；只内存，不写缓存）。 */
    let roots = [];
    /** 包 id → package.json description（additive；只内存）。 */
    const descriptionByPackage = new Map();
    let settling = false;
    let scanDone = false;
    let lastScanMs = 0;
    let cacheHit = false;
    let failures = 0;
    let lastFailure;
    let started = false;
    let t0Attached = false;
    let disposed = false;
    let hostVersion = deps.hostVersion ?? "unknown";
    let cache;
    let runtimeAttributor;
    let flushTimer;
    let lazyScanTimer;
    let lazyScans = 0;
    const counters = {
        runtimeHits: 0,
        literalHits: 0,
        tableHits: 0,
        similarityHits: 0,
        namespaceHits: 0,
        unknownHits: 0,
    };
    const unknownNames = new Set();
    const conflictWarned = new Set();
    /** 重建字面量/命名空间索引（扫描结果/缓存 hydrate 共用）。 */
    function applyScans(scans) {
        for (const [packageId, result] of scans)
            packages.set(normalizePackageId(packageId), result);
        literalOwners.clear();
        namespaceOwners.clear();
        for (const [packageId, result] of packages) {
            if (isHostPackage(packageId))
                continue;
            for (const literal of result.literals) {
                let owners = literalOwners.get(literal);
                if (owners === undefined) {
                    owners = new Set();
                    literalOwners.set(literal, owners);
                }
                owners.add(packageId);
            }
            for (const namespace of result.namespaceHints) {
                let owners = namespaceOwners.get(namespace);
                if (owners === undefined) {
                    owners = new Set();
                    namespaceOwners.set(namespace, owners);
                }
                owners.add(packageId);
            }
        }
    }
    /** 同步取当前全局工具定义（异常给空数组，绝不抛）。 */
    function schemasOf() {
        try {
            const schemas = ctx?.get?.("tools")?.schemas?.();
            if (!Array.isArray(schemas))
                return [];
            return schemas;
        }
        catch {
            return [];
        }
    }
    /** 重建 fiber 名 → 包 id 映射（同步、零 IO；loader 不可用时只用已扫描包名）。 */
    function rebuildFiberMap() {
        fiberToPackage.clear();
        for (const packageId of packages.keys()) {
            const normalized = normalizePackageId(packageId);
            fiberToPackage.set(normalized, normalized);
            const display = displayNameOfPackage(normalized);
            if (!fiberToPackage.has(display))
                fiberToPackage.set(display, normalized);
        }
        try {
            const loader = ctx?.loader ?? ctx?.get?.("loader");
            const raw = typeof loader?.entries === "function" ? loader.entries() : undefined;
            const entries = Array.isArray(raw) ? raw : raw !== undefined && raw !== null && typeof raw[Symbol.iterator] === "function" ? [...raw] : [];
            for (const entry of entries) {
                const name = typeof entry?.options?.name === "string" ? entry.options.name : "";
                const packageId = normalizePackageId(name);
                if (packageId.length === 0 || isHostPackage(packageId))
                    continue;
                const fiberName = entry?.ctx?.fiber?.name ?? entry?.fiber?.name;
                if (typeof fiberName === "string" && fiberName.length > 0)
                    fiberToPackage.set(fiberName, packageId);
                fiberToPackage.set(packageId, packageId);
                const display = displayNameOfPackage(packageId);
                if (!fiberToPackage.has(display))
                    fiberToPackage.set(display, packageId);
            }
        }
        catch {
            /* loader 不可用：只用已扫描包名兜底 */
        }
    }
    /** 重建「包根 → 包 id」映射（含 realpath，覆盖 `link:`/`@local/*` 真实路径帧）。 */
    async function rebuildDirMap(roots) {
        const seen = new Set();
        const list = [];
        for (const root of roots) {
            const packageId = normalizePackageId(root.packageId);
            if (packageId.length === 0)
                continue;
            let real = root.dir;
            try {
                real = await realpath(root.dir);
            }
            catch {
                real = root.dir;
            }
            for (const dir of [root.dir, real]) {
                const value = dir.replace(/\\/g, "/").replace(/\/+$/, "");
                if (value.length === 0)
                    continue;
                const key = `${value}\u0000${packageId}`;
                if (seen.has(key))
                    continue;
                seen.add(key);
                list.push({ dir: value, packageId });
            }
        }
        list.sort((left, right) => right.dir.length - left.dir.length);
        dirPackages = list;
    }
    /** 栈帧路径 → 包 id（包根前缀匹配；未命中返回 undefined 交给 node_modules 解析）。 */
    function packageOfPath(filePath) {
        const normalized = filePath.replace(/\\/g, "/");
        for (const entry of dirPackages) {
            if (normalized === entry.dir || normalized.startsWith(`${entry.dir}/`))
                return entry.packageId;
        }
        return undefined;
    }
    /** fiber 名 → 包 id。 */
    function packageOfFiber(fiberName) {
        return fiberToPackage.get(fiberName);
    }
    /** 登记一个交叉校验识别出的拦截器包（写缓存；幂等）。 */
    function addSuspect(packageId) {
        const normalized = normalizePackageId(packageId);
        if (normalized.length === 0 || suspects.has(normalized) || isHostPackage(normalized))
            return;
        suspects.add(normalized);
        void cache?.save({ interceptors: [...suspects] });
    }
    /** 挂 T0（幂等、同步、零文件 IO；tools 服务可用即可挂）。 */
    function attachT0() {
        if (!enabled || disposed || t0Attached)
            return;
        t0Attached = true;
        rebuildFiberMap();
        runtimeAttributor = createRuntimeAttributor({
            ctx,
            logger,
            knownSchemas: schemasOf,
            packageOfFiber,
            packageOfPath,
            suspectPackages: () => suspects,
            onSuspect: addSuspect,
            onCapture: (capture) => {
                for (const tool of capture.tools) {
                    runtime.set(tool, { package: capture.packageName, at: capture.at, confidence: capture.confidence });
                }
                // T0'：命名空间只认**身份信号**（high）；`mcp__*` 不写工具归属。
                if (capture.confidence === "high") {
                    for (const namespace of capture.namespaces)
                        runtimeNamespace.set(namespace, capture.packageName);
                }
                scheduleFlush();
            },
        });
        runtimeAttributor.attach();
    }
    /**
     * 尽早挂 T0（不等面板首次查询）：tools 服务已就绪 → 立即挂；否则等
     * `ctx.inject(["tools"])` 的就绪回调（cordis 保证依赖可用后才回调）。
     * 扫描/缓存仍走惰性 {@link ensureStarted}，不拖慢宿主启动。
     */
    function attachT0Early() {
        if (!enabled)
            return;
        let available = false;
        try {
            available = ctx?.get?.("tools", false) !== undefined;
        }
        catch {
            available = false;
        }
        if (available) {
            attachT0();
            return;
        }
        try {
            const inject = ctx?.inject;
            if (typeof inject === "function") {
                inject.call(ctx, ["tools"], () => attachT0());
            }
        }
        catch {
            /* 旧装配：退回首次查询时挂（ensureStarted） */
        }
    }
    /** 首次使用前启动（T0 已尽早挂；这里补缓存/扫描）。 */
    function ensureStarted() {
        if (!enabled || disposed)
            return;
        attachT0();
        if (started)
            return;
        started = true;
        void init();
    }
    /** 探测宿主版本指纹（`@deepseek-ai/dsh-tools` 的 package.version）。 */
    async function detectHostVersion() {
        if (deps.hostVersion !== undefined)
            return deps.hostVersion;
        try {
            const packagesService = ctx?.get?.("pluginPackages");
            const found = typeof packagesService?.packageOf === "function" ? packagesService.packageOf("@deepseek-ai/dsh-tools", undefined) : undefined;
            if (typeof found?.dir !== "string")
                return "unknown";
            const raw = await readFile(join(found.dir, "package.json"), "utf8");
            const version = JSON.parse(raw).version;
            return typeof version === "string" && version.length > 0 ? version : "unknown";
        }
        catch {
            return "unknown";
        }
    }
    /** 把缓存内容 hydrate 进内存索引（v2：runtime 不含 `mcp__*`，拦截器包先载入）。 */
    function hydrateFromCache(file) {
        const scans = new Map();
        for (const [packageId, scan] of Object.entries(file.packages)) {
            scans.set(packageId, {
                version: scan.version,
                mtimeMs: scan.mtimeMs,
                literals: Array.isArray(scan.literals) ? scan.literals : [],
                namespaceHints: Array.isArray(scan.namespaceHints) ? scan.namespaceHints : [],
            });
        }
        applyScans(scans);
        for (const packageId of file.interceptors ?? []) {
            const normalized = normalizePackageId(packageId);
            if (normalized.length > 0 && !isHostPackage(normalized))
                suspects.add(normalized);
        }
        for (const [tool, entry] of Object.entries(file.runtime)) {
            if (typeof entry?.package !== "string" || entry.package.length === 0)
                continue;
            // `mcp__*` 恒归 MCP 域（命名空间层），不参与工具归属。
            if (tool.startsWith("mcp__"))
                continue;
            // 拦截器污染的历史条目不可信（v1 已被 cache 迁移丢弃，这里防手工/旧版回填）。
            if (suspects.has(normalizePackageId(entry.package)))
                continue;
            runtime.set(tool, {
                package: entry.package,
                at: typeof entry.at === "number" ? entry.at : 0,
                confidence: entry.confidence === "medium" ? "medium" : "high",
            });
        }
    }
    /** 异步初始化：读缓存（命中零扫描）→ 否则后台全量扫描。 */
    async function init() {
        try {
            hostVersion = deps.hostVersion ?? (await detectHostVersion());
            cache = createAttributionCache({ dshHome: deps.dshHome, hostVersion, logger });
            const cached = await cache.load();
            if (cached !== undefined) {
                hydrateFromCache({
                    packages: cached.packages,
                    runtime: cached.runtime,
                    ...(cached.interceptors !== undefined ? { interceptors: cached.interceptors } : {}),
                });
                cacheHit = true;
                scanDone = true;
                // 缓存命中也可能缺包根（新装插件）：后台增量补齐（不阻塞）。
                void refresh({ force: false }).catch(() => undefined);
                return;
            }
            settling = true;
            await refresh({ force: true });
            settling = false;
        }
        catch (error) {
            settling = false;
            scanDone = true;
            failures += 1;
            lastFailure = errMessage(error);
            logger?.warn?.(`capability-panel: 归属初始化失败，退化为人工表（${errMessage(error)}）`);
        }
    }
    /** 全量/增量扫描（force=false 时只补缺失包）。 */
    async function refresh(options = {}) {
        if (!enabled || disposed)
            return;
        const force = options.force === true;
        settling = true;
        try {
            const discovered = await resolvePackageRoots(ctx);
            roots = discovered;
            // 包描述与扫描结果解耦：扫描超时/失败也保留（readPackageMeta 与 version 同读）。
            descriptionByPackage.clear();
            for (const root of discovered) {
                const description = root.description?.trim();
                if (description === undefined || description.length === 0)
                    continue;
                const packageId = normalizePackageId(root.packageId);
                if (packageId.length > 0)
                    descriptionByPackage.set(packageId, description);
            }
            await rebuildDirMap(discovered);
            rebuildFiberMap();
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
                const packagesUpdate = {};
                for (const [packageId, result] of report.packages)
                    packagesUpdate[packageId] = result;
                await cache.save({
                    packages: packagesUpdate,
                    ...(Object.keys(report.failures).length > 0
                        ? {
                            failures: Object.fromEntries(Object.entries(report.failures).map(([packageId, reason]) => [packageId, { reason, at: Date.now() }])),
                        }
                        : {}),
                });
            }
            logger?.info?.(`attribution scan: packages=${report.packages.size} literals=${report.files} ms=${report.ms}`);
        }
        catch (error) {
            failures += 1;
            lastFailure = errMessage(error);
            logger?.warn?.(`capability-panel: 归属扫描失败（${errMessage(error)}）`);
        }
        finally {
            settling = false;
        }
    }
    /** 2s debounce 写缓存（T0 增量；不阻塞注册路径）。 */
    function scheduleFlush() {
        if (!enabled || disposed || cache === undefined || flushTimer !== undefined)
            return;
        flushTimer = setTimeout(() => {
            flushTimer = undefined;
            if (disposed || cache === undefined)
                return;
            const runtimeUpdate = Object.fromEntries(runtime);
            void cache.save({ runtime: runtimeUpdate, interceptors: [...suspects] });
        }, 2000);
        if (typeof flushTimer === "object" && flushTimer !== null && "unref" in flushTimer) {
            flushTimer.unref?.();
        }
    }
    /** 是否已过「静态索引可用」阶段（T3 只在索引就绪后用，避免假阴性后又被覆盖）。 */
    function staticReady() {
        return scanDone;
    }
    /** 请求惰性扫描（去抖 1s；每次进程最多 3 次，防抖动风暴）。 */
    function requestScan() {
        if (!enabled || disposed || lazyScanTimer !== undefined || lazyScans >= 3)
            return;
        lazyScanTimer = setTimeout(() => {
            lazyScanTimer = undefined;
            lazyScans += 1;
            void refresh({ force: false });
        }, 1000);
        if (typeof lazyScanTimer === "object" && lazyScanTimer !== null && "unref" in lazyScanTimer) {
            lazyScanTimer.unref?.();
        }
    }
    /** 记录 T1 与 T4 冲突（warn 一次/tool）。 */
    function noteConflict(toolName, tablePackage, literalPackage) {
        if (conflictWarned.has(toolName))
            return;
        conflictWarned.add(toolName);
        logger?.warn?.(`capability-panel: 工具 ${toolName} 的包扫描归属（${literalPackage}）与人工表（${tablePackage}）冲突，采用更高优先级的扫描结果`);
    }
    /** 同步解析一个工具名。 */
    function resolveTool(toolName) {
        if (typeof toolName !== "string" || toolName.length === 0)
            return unknownAttribution();
        if (!enabled)
            return tableToolAttribution(toolName) ?? unknownAttribution();
        ensureStarted();
        // `mcp__*` 恒归 MCP 域：工具归属只用 runtime 的非 MCP 部分（防御性二次过滤）。
        const captured = parseMcpToolName(toolName) === undefined ? runtime.get(toolName) : undefined;
        if (captured !== undefined) {
            counters.runtimeHits += 1;
            return {
                packageId: captured.package,
                display: displayNameOfPackage(captured.package),
                matchedBy: "runtime",
                confidence: captured.confidence,
            };
        }
        const table = tableToolAttribution(toolName);
        const owners = literalOwners.get(toolName);
        if (owners !== undefined && owners.size === 1) {
            const packageId = [...owners][0];
            counters.literalHits += 1;
            const result = {
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
            const result = { ...table };
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
                if (unknownNames.size < 32)
                    unknownNames.add(toolName);
                return { ...unknownAttribution(), ambiguous: true };
            }
        }
        counters.unknownHits += 1;
        if (unknownNames.size < 32)
            unknownNames.add(toolName);
        // 出现未知工具 → 请求后台惰性扫描（不阻塞）。
        if (staticReady())
            requestScan();
        return unknownAttribution();
    }
    /** 同步解析 MCP 命名空间。 */
    function resolveNamespace(namespace) {
        if (typeof namespace !== "string" || namespace.length === 0)
            return undefined;
        if (!enabled)
            return tableNamespaceAttribution(namespace);
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
            const packageId = [...owners][0];
            counters.namespaceHits += 1;
            return { packageId, display: displayNameOfPackage(packageId), matchedBy: "namespace", confidence: "high", pattern: namespace };
        }
        const table = tableNamespaceAttribution(namespace);
        if (table !== undefined)
            counters.namespaceHits += 1;
        return table;
    }
    /** 是否仍在后台收敛（未启动也视为 false：不阻塞首屏）。 */
    function settlingNow() {
        return enabled && (settling || (started && !scanDone && !cacheHit));
    }
    /** 诊断快照。 */
    function snapshot() {
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
            runtimeAttached: t0Attached,
            ...(suspects.size > 0 ? { interceptors: [...suspects] } : {}),
        };
    }
    /** 诊断计数（内部用；通过 snapshot 之外的 API 不暴露）。 */
    function countersSnapshot() {
        return { ...counters };
    }
    // 供测试/诊断读取各层命中（additive 方法，非契约必需）。
    resolveTool.counters = () => countersSnapshot();
    // 组合根：T0 尽早挂（tools 服务可用即挂；扫描/缓存仍惰性）。
    attachT0Early();
    return {
        resolveTool,
        resolveNamespace,
        packageDescription(packageId) {
            if (typeof packageId !== "string" || packageId.length === 0)
                return undefined;
            return descriptionByPackage.get(normalizePackageId(packageId));
        },
        settling: settlingNow,
        refresh,
        requestScan,
        snapshot,
        dispose() {
            disposed = true;
            runtimeAttributor?.dispose();
            if (flushTimer !== undefined)
                clearTimeout(flushTimer);
            if (lazyScanTimer !== undefined)
                clearTimeout(lazyScanTimer);
            flushTimer = undefined;
            lazyScanTimer = undefined;
            cache?.dispose();
        },
    };
}
/** 工具名是否为 Tools 域候选（域名恒等判定：非 mcp、非宿主内建）。 */
export function isToolCandidates(name) {
    if (typeof name !== "string" || name.length === 0)
        return false;
    if (parseMcpToolName(name) !== undefined)
        return false;
    if (isHostBuiltinTool(name))
        return false;
    return true;
}
