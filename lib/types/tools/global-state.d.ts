/**
 * Tools 域**全局默认**开关的持久化存储。
 *
 * 用户澄清后的两层语义（覆盖早期「Tools 只有会话级开关」的 A5 设计）：
 *
 *   - **能力面板 = 全局默认**：写本文件，决定所有会话（含新建会话）的默认态；
 *   - **会话首屏 = 本会话覆盖**：仍写 `session-capabilities.json` 的 `tools` 域；
 *   - 生效值：`effective(unit) = 会话覆盖[unit] ?? !globalDisabled.has(unit)`。
 *
 * 存储契约：
 *
 *   - 文件：`<dshHome>/dsh-capability-settings/tools-global.json`
 *     （与 `session-capabilities.json` / `jev.json` 同目录；目录 0700、文件 0600）；
 *   - 形状：`{ "version": 1, "disabled": ["<unit>", …] }`；`disabled` = **全局默认
 *     关闭**的开关单元 id 列表（缺省空表 = 全部启用）；
 *   - 写：`shared/file-lock.ts` 进程内串行 + `shared/atomic-write.ts` 原子写；
 *     锁内重读磁盘合并（多面板标签页 / 双写不丢更新）；
 *   - 读：文件缺失 / 空 / JSON 损坏 / version 不认识 → `warn` + 按**全部启用**
 *     降级（不阻断任何域）；写入失败 → `warn`，本次运行内仍生效；
 *   - 存活的 unit 才会被 manager 读取（文件里已卸载插件的残留 id 无害、不主动删，
 *     留待将来的 reconcile 懒清理——任务要求「不删用户数据」）。
 *
 * @module dsh-capability-settings/tools/global-state
 */
/** 当前数据文件版本；版本不认识时整份忽略（不猜测迁移）。 */
export declare const TOOLS_GLOBAL_VERSION = 1;
/** 数据文件名。 */
export declare const TOOLS_GLOBAL_FILE_NAME = "tools-global.json";
/** 插件数据目录名（与 session-capabilities.json / jev.json 共用）。 */
export declare const TOOLS_GLOBAL_DIR_NAME = "dsh-capability-settings";
/** 配置目录：`<dshHome>/dsh-capability-settings`。 */
export declare function toolsGlobalDir(dshHome?: string): string;
/** 数据文件：`<dshHome>/dsh-capability-settings/tools-global.json`。 */
export declare function toolsGlobalFile(dshHome?: string): string;
/** 结构化 logger 子集（与插件其它模块一致，缺省静默）。 */
export interface ToolsGlobalLogger {
    warn?: (message: string) => void;
}
/** 构造参数。 */
export interface ToolsGlobalStoreDeps {
    /** dsh home 覆盖（缺省 `resolveDshHome()`）。 */
    dshHome?: string;
    /** 日志（缺省静默）。 */
    logger?: ToolsGlobalLogger;
}
/** 批量设置全局默认的结果（业务失败收在 `ok:false`）。 */
export type ToolsGlobalSetResult = {
    ok: true;
    applied: number;
} | {
    ok: false;
    errors: string[];
};
/** 全局默认开关存储（组合根单例；`tools.list` / manager 共用）。 */
export interface ToolsGlobalStore {
    /** 数据文件绝对路径（诊断 / 测试）。 */
    readonly filePath: string;
    /** 懒加载磁盘快照（幂等；读取失败降级为空表，不抛）。 */
    ready(): Promise<void>;
    /** 当前「全局默认关闭」的 unit id 集合（同步快照；调用方先 `await ready()`）。 */
    disabled(): ReadonlySet<string>;
    /**
     * 批量设置全局默认：`enabled === false` → 加入 disabled；`true` → 移出。
     *
     * 幂等（无变化不写盘，`applied:0`）；锁内读盘合并；写失败 → `warn` +
     * `{ok:false, errors}`（内存镜像仍生效）。
     */
    setEnabled(units: readonly string[], enabled: boolean): Promise<ToolsGlobalSetResult>;
    /** 卸载：停止后续写入（进行中的写盘不会被打断）。 */
    dispose(): void;
}
/**
 * 创建全局默认开关存储（组合根单例）。
 *
 * @param deps dsh home / 日志
 */
export declare function createToolsGlobalStore(deps?: ToolsGlobalStoreDeps): ToolsGlobalStore;
