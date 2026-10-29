/**
 * Tools 开关单元 id 的规范形式：**归一化 npm 包名（含 scope）**。
 *
 * 设计：`docs/architecture/plugin-attribution-auto.md` D1/D2（unit id 迁移）。
 *
 *   - unit id（持久化键 `plugin:<unit>`）= 包名，例如 `@xmanrui/dsh-im`；
 *   - **展示名** = 包名去 scope，例如 `dsh-im`（7 个已知插件展示名保持不变）；
 *   - 旧 key（历史 display）通过 {@link canonicalUnitId} 读时归一；
 *     {@link legacyUnitOf} 给出可回滚的旧键，写盘时做**镜像双写**；
 *   - 无法识别的键（不是包名形态、也不是已知别名）返回 `undefined`：调用方
 *     **原样保留**，绝不删除用户数据。
 *
 * @module dsh-capability-settings/tools/attribution/unit-id
 */
/** 本插件自己的包名（D12：必须与 `package.json.name` 一致，单测断言）。 */
export declare const SELF_PACKAGE = "dsh-capability-settings";
/** 「来源未识别」单元 id（保持既有值，不属于包名空间）。 */
export declare const UNATTRIBUTED_UNIT = "__unattributed__";
/** 历史 display → 规范包名/展示名（读时归一 + 旧键镜像）。 */
export interface LegacyUnitAlias {
    /** 旧 unit id（历史持久化键里出现过的 display 形态）。 */
    legacy: string;
    /** 规范 unit id（完整包名）。 */
    packageId: string;
    /** 展示名（去 scope）。 */
    display: string;
}
/**
 * 旧 id 别名表（D1：仅 `dsh-im` / `dsh-popout-window` 两个 id 真正变化，
 * 其余 5 个 display 恰好等于包名）。
 */
export declare const LEGACY_UNIT_ALIASES: readonly LegacyUnitAlias[];
/** 归一去空白并小写（npm 包名大小写不敏感；统一小写保证幂等）。 */
export declare function normalizePackageId(raw: string): string;
/** 包名 → 展示名（去 scope）；空字符串回退原值。 */
export declare function displayNameOfPackage(packageId: string): string;
/**
 * 读取任意 unit/key 值 → 规范 unit id。
 *
 * - `__unattributed__` 原样返回（特殊单元）；
 * - 命中旧别名 → 新包名；
 * - 包名形态 → 归一化（小写）；
 * - 其它 → `undefined`（调用方保留原键，不删数据）。
 */
export declare function canonicalUnitId(raw: string): string | undefined;
/** 规范 unit id → 可回滚旧键（没有别名时 undefined）。 */
export declare function legacyUnitOf(packageId: string): string | undefined;
/** 是否为「来源未识别」单元（持久化特殊键）。 */
export declare function isUnattributedUnit(unit: string): boolean;
