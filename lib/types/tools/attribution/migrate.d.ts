/**
 * unit id 迁移辅助（D2）：读时别名归一 + 旧键镜像 + 未知键保留。
 *
 * 设计：`docs/architecture/plugin-attribution-auto.md` §3。
 *
 * 只做**纯数据变换**，不碰磁盘：磁盘读写在 `tools/global-state.ts` 与
 * `session-state.ts` 的既有原子写/锁路径内完成（两个文件各自独立、幂等、
 * 崩溃可续）。
 *
 * @module dsh-capability-settings/tools/attribution/migrate
 */
/** 迁移报告（供日志/诊断；不跨 RPC）。 */
export interface MigrationReport {
    /** 是否有任何键被改写（false = 已是最新，无需写盘）。 */
    changed: boolean;
    /** 改写的键数（旧键 → 新键）。 */
    rewritten: number;
    /** 需要保留的未知键（原样写回，绝不删除）。 */
    unknown: string[];
    /** 需要镜像的旧键（可回滚；`新键 → 旧键`）。 */
    mirrors: Array<{
        unit: string;
        legacy: string;
    }>;
}
/** 归一单个持久化 unit 键（`__unattributed__` 原样返回）。 */
export declare function canonicalizeUnitKey(raw: string): string | undefined;
/** unit → 需要同时写入的旧键（无别名时 undefined）。 */
export declare function mirrorKeyFor(unit: string): string | undefined;
/** 批量归一 `plugin:<unit>` 形式的开关表（未识别的键原样保留在 `unknown`）。 */
export declare function canonicalizeToggleKeys(entries: Readonly<Record<string, boolean | undefined>>): {
    entries: Record<string, boolean | undefined>;
    report: MigrationReport;
};
/** 批量归一 `disabled` 字符串列表（保留未知项到 `unknown`，镜像旧键）。 */
export declare function canonicalizeUnitList(entries: readonly string[]): {
    units: string[];
    report: MigrationReport;
};
/**
 * 构建「规范化 + 旧键镜像 + 未知键保留」的最终列表（写盘用）。
 *
 * 顺序：规范 unit（按输入顺序）→ 镜像旧键 → 未知键；去重。
 */
export declare function buildMirroredUnitList(units: readonly string[], unknown?: readonly string[]): {
    list: string[];
    addedMirrors: number;
};
/** 判断列表是否已经「规范化 + 含镜像」（避免重复写盘）。 */
export declare function isUnitListSettled(entries: readonly string[]): boolean;
