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
import { type PackageScanResult } from "./scan.js";
import type { NamespaceAttribution, ResolverSnapshot, ToolAttribution } from "./types.js";
/** resolver 构造依赖。 */
export interface AttributionResolverDeps {
    /** 宿主插件 ctx（`on("tools/change")` / `get("tools")` / `get("pluginPackages")`）。 */
    ctx: any;
    dshHome?: string;
    logger?: {
        warn?: (message: string) => void;
        info?: (message: string) => void;
    };
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
    /**
     * 插件包描述（additive；`package.json.description`）。
     *
     * 扫描尚未完成 / 包根读不到时返回 undefined，调用方回退占位文案。
     * 同步方法：只读内存映射，不触发 IO，不阻塞 `tools.list`。
     */
    packageDescription?(packageId: string): string | undefined;
    /** 后台扫描/缓存是否仍在进行（`tools.list.attributionSettling`）。 */
    settling(): boolean;
    /** 强制刷新（按需全量重扫；诊断/测试）。 */
    refresh(options?: {
        force?: boolean;
    }): Promise<void>;
    /** 列表出现未归属工具时请求惰性扫描（异步、去抖、不阻塞）。 */
    requestScan(): void;
    /** 诊断快照。 */
    snapshot(): ResolverSnapshot;
    dispose(): void;
}
/** T4：人工表（prefix/exact 旧值保留，保证旧客户端文案不变）。 */
/** T4 人工表解析（导出给无 resolver 的旧装配/测试用）。 */
export declare function tableToolAttribution(toolName: string): ToolAttribution | undefined;
/** 创建归属 resolver（组合根单例）。 */
export declare function createAttributionResolver(deps: AttributionResolverDeps): AttributionResolver;
/** 工具名是否为 Tools 域候选（域名恒等判定：非 mcp、非宿主内建）。 */
export declare function isToolCandidates(name: string): boolean;
export type { PackageScanResult };
