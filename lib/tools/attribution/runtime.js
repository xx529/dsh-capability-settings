/**
 * T0 运行时归属：**调用方身份优先，注册栈兜底**。
 *
 * 背景（为什么不是纯栈归属）：宿主调用链是
 * `tools.register() → ScopedLayers.effect() → ctx.emit("tools/change")`（同步），
 * 所以在监听器里 `new Error().stack` 能拿到注册栈；但**任何插件只要包装了
 * `tools.register`，它的包装函数就会出现在栈里、且比真实注册方更靠近 registry**
 * ——「取第一个第三方帧」会稳定命中拦截器（本机实测：`dsh-context` 用自己的
 * 归属补丁重写了 `register`，导致我们所有工具都被判成它）。
 *
 * 因此主信号改为 cordis 的 `internal/get`：服务解析时 cordis 在代理 get trap 里
 * 创建 `new Error(...)`（`@deepseek-ai/cordis` 的 `ReflectService.handler.get`），
 * 这个 error 的栈第一帧就是**发起访问的插件**，不经过任何 `register` 包装；
 * 同时事件参数里的 `ctx.fiber.name` 给出插件身份。`tools/change` 与「服务访问」
 * 在 `ctx.tools.register(...)` 里是同一段同步代码，所以在 change 触发时刻取
 * 「本宏任务内最近一次 internal/get」即可精确配对。
 *
 * 纪律：
 *   - 监听器内任何异常都吞掉（绝不能影响注册/服务解析流程）；`internal/get` 的
 *     `next()` 原样调用、原样返回（服务解析异常必须继续向上抛）；
 *   - `stackTraceLimit` 必须 `finally` 恢复；
 *   - 连续 3 次失败 → 本进程禁用 T0（warn 一次），后续靠静态层；
 *   - 身份不可用就**不归属**（宁缺勿错），不拿注册栈去猜；
 *   - 兜底路径取栈里**最后一个**第三方帧（最靠近真实调用方），并跳过交叉校验
 *     识别出的拦截器包。
 *
 * 设计：`docs/architecture/plugin-attribution-auto.md` §5（v14 修订：身份优先）。
 * 取证：`docs/research/plugin-attribution-heuristics.md` §4 +
 * `notes/verify/attribution-t0-signal.mjs`（最小复现）。
 *
 * @module dsh-capability-settings/tools/attribution/runtime
 */
import { normalizePackageId, SELF_PACKAGE } from "./unit-id.js";
/** 栈帧里可忽略的宿主/框架帧特征。 */
const HOST_FRAME_MARKERS = ["app.asar", "/@deepseek-ai/", "\\@deepseek-ai\\"];
/** bridge 包（工具异步注册时栈里只剩它的帧）。 */
const BRIDGE_PACKAGE = "dsh-mcp-client";
/** 交叉校验连续不一致多少次后把候选包记为拦截器。 */
const SUSPECT_THRESHOLD = 2;
/** 抓栈时临时抬到的帧数（默认 10 不够）。 */
const STACK_LIMIT = 48;
/** 是否为宿主/框架/bridge/自身包（不作为插件归属）。 */
function isHostLikePackage(packageId, selfPackage) {
    const id = normalizePackageId(packageId);
    if (id.length === 0)
        return true;
    if (id.startsWith("@deepseek-ai/"))
        return true;
    if (id === BRIDGE_PACKAGE || id.startsWith(`${BRIDGE_PACKAGE}/`))
        return true;
    if (id === selfPackage || id.startsWith(`${selfPackage}/`))
        return true;
    return false;
}
/** 从单帧路径里解析「包目录名候选」（`node_modules/<pkg>`）。 */
function packageFromPath(rawPath) {
    const path = rawPath.replace(/\\/g, "/").replace(/^file:\/\//, "");
    if (!path.includes("node_modules"))
        return undefined;
    if (HOST_FRAME_MARKERS.some((marker) => path.includes(marker.replace(/\\/g, "/"))))
        return undefined;
    // 取**最后一个** node_modules（pnpm 嵌套布局里内层才是真实包根）。
    const index = path.lastIndexOf("/node_modules/");
    if (index < 0)
        return undefined;
    const rest = path.slice(index + "/node_modules/".length);
    const parts = rest.split("/");
    if (parts.length === 0)
        return undefined;
    let candidate;
    if (parts[0]?.startsWith("@")) {
        if (parts[1] === undefined || parts[1].length === 0)
            return undefined;
        candidate = `${parts[0]}/${parts[1]}`;
    }
    else {
        candidate = parts[0] ?? "";
    }
    if (candidate.length === 0)
        return undefined;
    return normalizePackageId(candidate);
}
/** 从 `Error().stack` 提取文件路径（去掉 `at ` / `async ` / 行号列号）。 */
function frameFiles(stack) {
    const files = [];
    for (const raw of stack.split("\n").slice(1)) {
        let line = raw.trim();
        if (!line.startsWith("at "))
            continue;
        line = line.slice(3);
        if (line.startsWith("async "))
            line = line.slice(6);
        const match = line.match(/\(?((?:file:\/\/)?[^()\s]+?):\d+:\d+\)?\s*$/);
        if (match === null)
            continue;
        const file = match[1] ?? "";
        // 非文件帧。
        if (file.startsWith("node:") || file.startsWith("internal/") || file.includes("<anonymous>"))
            continue;
        files.push(file);
    }
    return files;
}
/** 逐帧解析包名（顺序保留、去重；供「第一个/最后一个帧」两种取法复用）。 */
function packagesInStack(stack, selfPackage, packageOfPath) {
    if (typeof stack !== "string" || stack.length === 0)
        return [];
    const found = [];
    for (const file of frameFiles(stack)) {
        let candidate;
        try {
            candidate = packageOfPath?.(file) ?? packageFromPath(file);
        }
        catch {
            candidate = packageFromPath(file);
        }
        if (candidate === undefined)
            continue;
        const normalized = normalizePackageId(candidate);
        if (isHostLikePackage(normalized, selfPackage))
            continue;
        if (!found.includes(normalized))
            found.push(normalized);
    }
    return found;
}
/**
 * 从 `Error().stack` 里解析注册方包名（**兼容入口**：取第一个第三方帧）。
 *
 * ⚠️ 平台上有插件包装 `tools.register` 时该取法会命中拦截器——T0 主路径已改用
 * 调用方身份（`internal/get`），本函数仅保留给旧装配/单测直接调用。
 *
 * @param stack `new Error().stack` 原文
 * @param selfPackage 自身包名（缺省 {@link SELF_PACKAGE}）
 */
export function parsePackageFromStack(stack, selfPackage = SELF_PACKAGE) {
    return packagesInStack(stack, normalizePackageId(selfPackage))[0];
}
/** 提取本次栈里的全部候选（诊断用）。 */
export function parsePackagesFromStack(stack, selfPackage = SELF_PACKAGE) {
    return packagesInStack(stack, normalizePackageId(selfPackage));
}
/** 从工具名解析 MCP 命名空间（仅 `mcp__<ns>__<tool>`）。 */
function namespaceOfToolName(name) {
    if (!name.startsWith("mcp__"))
        return undefined;
    const rest = name.slice("mcp__".length);
    const split = rest.indexOf("__");
    if (split <= 0)
        return undefined;
    return rest.slice(0, split);
}
/** 抓一次调用栈（`finally` 恢复全局 limit）。 */
function captureStack() {
    const oldLimit = Error.stackTraceLimit;
    try {
        Error.stackTraceLimit = STACK_LIMIT;
        return new Error().stack;
    }
    catch {
        return undefined;
    }
    finally {
        Error.stackTraceLimit = oldLimit;
    }
}
/**
 * 创建 T0 运行时归属器（`attach()` 后生效；由 resolver 在 tools 服务可用时挂上）。
 *
 * @param deps 上下文/快照/身份解析/回调
 */
export function createRuntimeAttributor(deps) {
    const logger = deps.logger;
    const selfPackage = normalizePackageId(deps.selfPackage ?? SELF_PACKAGE);
    /** 已知工具 → 定义签名（同名替换也能识别）。 */
    let known = new Map();
    /** 基线是否已建立（tools 服务刚就绪时的第一轮差异不算归属）。 */
    let knownReady = false;
    /** 本宏任务内最近一次「服务访问」的身份记录。 */
    let access;
    let accessTimer;
    /** 本地学习的拦截器候选（候选包 → 交叉校验不一致次数）。 */
    const disagreements = new Map();
    /** 曾作为「调用方身份」出现过的包（避免把真实插件误判成拦截器）。 */
    const ownerSeen = new Set();
    /** 本地学习的拦截器包。 */
    const suspected = new Set();
    const offs = [];
    let failures = 0;
    let disabled = false;
    let disposed = false;
    let attached = false;
    /** 定义签名：description + parameters 的规范化 JSON（同名替换判定）。 */
    function signatureOf(item) {
        try {
            return `${String(item.description ?? "")}\u0001${JSON.stringify(item.parameters ?? null)}`;
        }
        catch {
            return "unserializable";
        }
    }
    /** 同步取当前工具定义（失败给空数组：宁可漏捕一次，绝不抛出）。 */
    function schemasNow() {
        try {
            const schemas = deps.knownSchemas?.();
            if (Array.isArray(schemas))
                return schemas;
            const names = deps.knownNames?.() ?? [];
            return (Array.isArray(names) ? names : []).map((name) => ({ name }));
        }
        catch {
            return [];
        }
    }
    /** 是否为已知拦截器（本地学习 + resolver 注入）。 */
    function isInterceptor(packageId) {
        if (suspected.has(packageId))
            return true;
        try {
            return deps.suspectPackages?.().has(packageId) === true;
        }
        catch {
            return false;
        }
    }
    /** 记录一次交叉校验不一致；达到阈值后把候选包登记为拦截器。 */
    function noteDisagreement(packageId) {
        if (ownerSeen.has(packageId) || isInterceptor(packageId))
            return;
        const count = (disagreements.get(packageId) ?? 0) + 1;
        disagreements.set(packageId, count);
        if (count < SUSPECT_THRESHOLD)
            return;
        suspected.add(packageId);
        logger?.warn?.(`capability-panel: T0 交叉校验发现工具注册拦截器包 ${packageId}（${count} 次），兜底归属将跳过它`);
        try {
            deps.onSuspect?.(packageId);
        }
        catch {
            /* 拦截器登记失败不影响注册流程 */
        }
    }
    /** 记录「服务访问」身份（只在本宏任务内有效；异常吞掉）。 */
    function recordAccess(originCtx, error) {
        const fiber = originCtx?.fiber?.name;
        const stack = error instanceof Error ? error.stack : undefined;
        const fiberName = typeof fiber === "string" && fiber.length > 0 ? fiber : undefined;
        if (fiberName === undefined && stack === undefined) {
            access = undefined;
            return;
        }
        access = {
            ...(fiberName !== undefined ? { fiber: fiberName } : {}),
            ...(stack !== undefined ? { stack } : {}),
            at: Date.now(),
        };
        if (accessTimer === undefined) {
            accessTimer = setTimeout(() => {
                accessTimer = undefined;
                access = undefined;
            }, 0);
            if (typeof accessTimer === "object" && accessTimer !== null && "unref" in accessTimer) {
                accessTimer.unref?.();
            }
        }
    }
    /** 身份信号 → 包 id（fiber 名优先，其次访问点栈；宿主/自身一律不可用）。 */
    function identityPackage(record) {
        let byFiber;
        if (record.fiber !== undefined) {
            try {
                byFiber = deps.packageOfFiber?.(record.fiber);
            }
            catch {
                byFiber = undefined;
            }
        }
        const byStack = packagesInStack(record.stack, selfPackage, deps.packageOfPath)[0];
        const candidate = byFiber ?? byStack;
        if (candidate === undefined)
            return undefined;
        const packageId = normalizePackageId(candidate);
        if (isHostLikePackage(packageId, selfPackage))
            return undefined;
        return packageId;
    }
    /** 本次注册方（身份优先；兜底取注册栈最后一个第三方帧并跳过拦截器）。 */
    function resolveOwner() {
        const stack = captureStack();
        if (access !== undefined) {
            const packageId = identityPackage(access);
            if (packageId === undefined)
                return undefined;
            ownerSeen.add(packageId);
            // 交叉校验：注册栈里排在拦截器位置的包（只在身份可信时才敢判定）。
            const interceptorCandidate = packagesInStack(stack, selfPackage, deps.packageOfPath)[0];
            if (interceptorCandidate !== undefined && interceptorCandidate !== packageId)
                noteDisagreement(interceptorCandidate);
            return { packageId, confidence: "high", signal: "access" };
        }
        const candidates = packagesInStack(stack, selfPackage, deps.packageOfPath);
        const fallback = candidates[candidates.length - 1];
        if (fallback === undefined || isInterceptor(fallback))
            return undefined;
        return { packageId: fallback, confidence: "medium", signal: "register-stack" };
    }
    /** 捕获一次（异常全吞；连续 3 次失败禁用 T0）。 */
    function capture() {
        if (disabled || disposed || !attached)
            return;
        try {
            const schemas = schemasNow();
            if (schemas.length === 0)
                return;
            const next = new Map();
            const changed = [];
            for (const item of schemas) {
                const name = typeof item?.name === "string" ? item.name : "";
                if (name.length === 0)
                    continue;
                const signature = signatureOf(item);
                next.set(name, signature);
                // 新增或**同名替换（定义签名变化）**都算一次注册事件。
                if (known.get(name) !== signature)
                    changed.push(name);
            }
            const baselineEmpty = !knownReady || known.size === 0;
            known = next;
            knownReady = true;
            // 基线建立期（tools 服务刚就绪）与「同名同定义替换」都不归属：
            // 绝不把上一批工具整体重归给当前注册方。
            if (changed.length === 0 || baselineEmpty)
                return;
            const owner = resolveOwner();
            if (owner === undefined)
                return;
            const tools = [];
            const namespaces = [];
            for (const name of changed) {
                const namespace = namespaceOfToolName(name);
                if (namespace !== undefined) {
                    // `mcp__*` 恒归 MCP 域：只从**可信身份**派生命名空间，绝不写工具归属。
                    if (owner.signal === "access" && !namespaces.includes(namespace))
                        namespaces.push(namespace);
                    continue;
                }
                tools.push(name);
            }
            if (tools.length === 0 && namespaces.length === 0)
                return;
            try {
                deps.onCapture?.({
                    tools,
                    packageName: owner.packageId,
                    namespaces,
                    at: Date.now(),
                    confidence: owner.confidence,
                    signal: owner.signal,
                });
            }
            catch {
                /* 回调失败不影响注册流程 */
            }
        }
        catch (error) {
            failures += 1;
            if (failures >= 3 && !disabled) {
                disabled = true;
                logger?.warn?.(`capability-panel: T0 运行时归属连续失败 ${failures} 次，本进程降级到静态归属（${String(error)}）`);
            }
        }
    }
    /**
     * `internal/get` 瀑布监听：放行服务解析，顺手记下访问方身份。
     *
     * 注意：必须**原样调用 next 并原样返回**（异常继续向上抛），这里只做旁路记录。
     */
    function onInternalGet(originCtx, prop, error, next) {
        const proceed = next;
        if (typeof proceed !== "function")
            return undefined;
        if (prop !== "tools")
            return proceed();
        const value = proceed();
        try {
            recordAccess(originCtx, error);
        }
        catch {
            /* 身份记录失败不影响服务解析 */
        }
        return value;
    }
    /** 挂监听（幂等；`tools` 服务就绪即可挂，不受 `tools/change` 首帧影响）。 */
    function attach() {
        if (attached || disposed || disabled)
            return;
        attached = true;
        // 基线：挂监听前已注册的工具不归 T0（交给 T1/T2/T3/T4 回填）。
        known = new Map();
        for (const item of schemasNow()) {
            const name = typeof item?.name === "string" ? item.name : "";
            if (name.length > 0)
                known.set(name, signatureOf(item));
        }
        knownReady = known.size > 0;
        try {
            const offGet = deps.ctx?.on?.("internal/get", onInternalGet);
            if (typeof offGet === "function")
                offs.push(offGet);
        }
        catch (error) {
            logger?.warn?.(`capability-panel: 无法挂载 internal/get 身份监听（${String(error)}），本次运行只用注册栈兜底`);
        }
        try {
            const offChange = deps.ctx?.on?.("tools/change", capture);
            if (typeof offChange === "function")
                offs.push(offChange);
            else
                disabled = true;
        }
        catch (error) {
            logger?.warn?.(`capability-panel: 无法挂载 T0 tools/change 监听（${String(error)}），本次运行仅用静态归属`);
            disabled = true;
        }
    }
    return {
        attach,
        dispose() {
            disposed = true;
            if (accessTimer !== undefined)
                clearTimeout(accessTimer);
            accessTimer = undefined;
            access = undefined;
            for (const off of offs.splice(0)) {
                try {
                    off();
                }
                catch {
                    /* 卸载阶段忽略 */
                }
            }
        },
        disabled() {
            return disabled;
        },
        failures() {
            return failures;
        },
        attached() {
            return attached;
        },
        suspects() {
            return [...suspected];
        },
    };
}
