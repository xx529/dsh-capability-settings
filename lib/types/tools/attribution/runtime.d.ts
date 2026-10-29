/**
 * T0 运行时栈归属：在 `tools/change` 监听器里抓注册调用栈，从帧路径反推插件包。
 *
 * 设计：`docs/architecture/plugin-attribution-auto.md` §5（D5/§5.2/§5.3）。
 * 证据：`docs/research/plugin-attribution-heuristics.md` §4（同步 emit；默认 10 帧
 * 不够，需临时抬到 48；单次 ~8µs，零文件 IO）。
 *
 * 纪律：
 *   - 监听器内任何异常都吞掉（绝不能影响注册流程）；
 *   - `stackTraceLimit` 必须 `finally` 恢复；
 *   - 连续 3 次失败 → 本进程禁用 T0（warn 一次），后续靠静态层；
 *   - bridge（dsh-mcp-client）帧 / 宿主帧（app.asar、@deepseek-ai/*）/ 自身包帧
 *     一律不归属。
 *
 * @module dsh-capability-settings/tools/attribution/runtime
 */
/** 运行时捕获依赖。 */
export interface RuntimeAttributorDeps {
    /** 宿主插件 ctx（要 `on("tools/change")`）。 */
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
}
/** 一次 tools/change 的捕获结果。 */
export interface RuntimeCapture {
    /** 本次新增的工具名（差集）。 */
    tools: string[];
    /** 注册方包名（目录名归一前的 npm 包名候选）。 */
    packageName: string;
    /** 其中 `mcp__<ns>__*` 的命名空间。 */
    namespaces: string[];
    /** 捕获时间（epoch ms）。 */
    at: number;
}
/** 运行时归属器。 */
export interface RuntimeAttributor {
    /** 移除监听（热重载/卸载）。 */
    dispose(): void;
    /** 本进程是否已因连续失败禁用 T0。 */
    disabled(): boolean;
    /** 连续失败计数（诊断）。 */
    failures(): number;
}
/**
 * 从 `Error().stack` 里解析注册方包名（纯函数，单测直接覆盖各路径形态）。
 *
 * 规则：逐帧取文件路径 → 跳过 node:/internal/<anonymous>/宿主帧 → 取最后一个
 * `/node_modules/` 之后的首段（scoped 取两段）→ 排除 bridge 与自身包。
 *
 * @param stack `new Error().stack` 原文
 * @param selfPackage 自身包名（缺省 {@link SELF_PACKAGE}）
 */
export declare function parsePackageFromStack(stack: string | undefined, selfPackage?: string): string | undefined;
/** 提取本次栈里的全部候选（诊断用；正常取第一个）。 */
export declare function parsePackagesFromStack(stack: string | undefined, selfPackage?: string): string[];
/**
 * 创建 T0 运行时归属器（监听一挂、基线一取，之后每次注册顺手捕获）。
 *
 * @param deps 上下文/快照/回调
 */
export declare function createRuntimeAttributor(deps: RuntimeAttributorDeps): RuntimeAttributor;
