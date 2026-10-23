/**
 * Jev 管理器：RPC 五个端点的实现装配。
 *
 * 职责：
 *
 *   - `getConfig` / `setConfig`：配置读写（委托 `config-file.ts`），只回掩码视图；
 *   - `test`：最小成本探针（1 条能力 + 1 条 noul），验证地址/密钥/模型/可解析性；
 *   - `rank`：枚举能力 → 一次 `POST /v1/systemone` → 解析/排序 → 返回结果；
 *   - `apply`：委托 `apply.ts` 的事务与冷会话排队；
 *   - 生命周期：内部持有 `agent/created` / `agent/disposed` 监听与两张内存表，
 *     `dispose()` 统一卸载（见架构 §8.7）。
 *
 * 所有网络请求都在宿主进程发出（客户端拿不到 key，也读不到 env）。
 *
 * @module @chengdb/capability-panel/jev/manager
 */
import type { JevCapabilityService } from "./apply.js";
import type { JevLogger } from "./types.js";
import type { JevHostContext } from "./types.js";
/** 管理器构造参数。 */
export interface JevManagerDeps {
    ctx: JevHostContext;
    /** dsh home 覆盖（缺省由 `resolveDshHome` 解析）。 */
    dshHome?: string;
    /** 延迟求值的服务访问器（避免与 `capabilityPanel` 服务构造顺序耦合）。 */
    service: () => JevCapabilityService | undefined;
    logger?: JevLogger;
    /** 可注入的 fetch（测试用；默认全局 fetch）。 */
    fetchImpl?: typeof fetch;
    /** 可注入的 sleep（测试用；默认 setTimeout）。 */
    sleep?: (ms: number) => Promise<void>;
    /** 可注入的时钟（测试用；默认 Date.now）。 */
    now?: () => number;
}
/** 对 RPC 暴露的 Jev 服务形状（`PanelRpcService.jev`）。 */
export interface JevManager {
    getConfig(): Promise<unknown>;
    setConfig(input: unknown): Promise<unknown>;
    /**
     * 连通性探针（additive：payload 可为 `{config?: JevConfigInput}`）。
     *
     * 带 `config` 时用「已保存配置 + 本次表单值」的临时配置测试（不落盘）；
     * 缺省 / 空对象时沿用已保存配置（旧行为）。
     */
    test(input?: unknown, signal?: AbortSignal): Promise<unknown>;
    rank(input: unknown, signal?: AbortSignal): Promise<unknown>;
    apply(input: unknown): Promise<unknown>;
    /** 卸载：移除生命周期监听、清空内存队列（由组合根并入 disposers）。 */
    dispose(): void;
}
/**
 * 创建 Jev 管理器（宿主生命周期内单例）。
 */
export declare function createJevManager(deps: JevManagerDeps): JevManager;
