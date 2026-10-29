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
import type { RuntimeSignal } from "./types.js";
/** 运行时捕获依赖。 */
export interface RuntimeAttributorDeps {
    /** 宿主插件 ctx（要 `on("internal/get")` / `on("tools/change")`）。 */
    ctx: any;
    /** 同步取当前全局工具名（`schemas()`；旧装配）。 */
    knownNames?: () => string[];
    /** 同步取当前全局工具定义（name + description + parameters；优先于 knownNames）。 */
    knownSchemas?: () => Array<{
        name: string;
        description?: unknown;
        parameters?: unknown;
    }>;
    /** 新增归属（写内存索引 + 标记 dirty）。 */
    onCapture?: (capture: RuntimeCapture) => void;
    logger?: {
        warn?: (message: string) => void;
    };
    selfPackage?: string;
    /** fiber 名 → 包 id（`ctx.loader.entries()` 的 `entry.options.name` / 已扫描包）。 */
    packageOfFiber?: (fiberName: string) => string | undefined;
    /** 栈帧文件路径 → 包 id（包根 realpath 前缀 / `node_modules` 解析）。 */
    packageOfPath?: (filePath: string) => string | undefined;
    /** 交叉校验识别出的拦截器包（resolver 负责写缓存）。 */
    onSuspect?: (packageId: string) => void;
    /** 已有拦截器包（缓存 hydrate / 前序学习；兜底路径跳过）。 */
    suspectPackages?: () => ReadonlySet<string>;
}
/** 一次 tools/change 的捕获结果。 */
export interface RuntimeCapture {
    /** 本次新增的**非 MCP** 工具名（`mcp__*` 不进 Tools 域，只派生命名空间）。 */
    tools: string[];
    /** 注册方包名（归一化 npm 包名）。 */
    packageName: string;
    /** 本次新增的 `mcp__<ns>__*` 命名空间（仅身份信号可信时写入）。 */
    namespaces: string[];
    /** 捕获时间（epoch ms）。 */
    at: number;
    /** `high` = 调用方身份；`medium` = 注册栈兜底。 */
    confidence: "high" | "medium";
    signal: RuntimeSignal;
}
/** 运行时归属器。 */
export interface RuntimeAttributor {
    /** 挂监听（幂等；tools 服务可用时由 resolver 调用）。 */
    attach(): void;
    /** 移除监听（热重载/卸载）。 */
    dispose(): void;
    /** 本进程是否已因连续失败禁用 T0。 */
    disabled(): boolean;
    /** 连续失败计数（诊断）。 */
    failures(): number;
    /** 监听是否已挂上。 */
    attached(): boolean;
    /** 已识别的拦截器包（诊断；含本地学习与 resolver 注入）。 */
    suspects(): string[];
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
export declare function parsePackageFromStack(stack: string | undefined, selfPackage?: string): string | undefined;
/** 提取本次栈里的全部候选（诊断用）。 */
export declare function parsePackagesFromStack(stack: string | undefined, selfPackage?: string): string[];
/**
 * 创建 T0 运行时归属器（`attach()` 后生效；由 resolver 在 tools 服务可用时挂上）。
 *
 * @param deps 上下文/快照/身份解析/回调
 */
export declare function createRuntimeAttributor(deps: RuntimeAttributorDeps): RuntimeAttributor;
