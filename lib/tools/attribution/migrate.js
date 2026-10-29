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
import { canonicalUnitId, legacyUnitOf, UNATTRIBUTED_UNIT } from "./unit-id.js";
/** 归一单个持久化 unit 键（`__unattributed__` 原样返回）。 */
export function canonicalizeUnitKey(raw) {
    return canonicalUnitId(raw);
}
/** unit → 需要同时写入的旧键（无别名时 undefined）。 */
export function mirrorKeyFor(unit) {
    if (unit === UNATTRIBUTED_UNIT)
        return undefined;
    return legacyUnitOf(unit);
}
/** 批量归一 `plugin:<unit>` 形式的开关表（未识别的键原样保留在 `unknown`）。 */
export function canonicalizeToggleKeys(entries) {
    const canonical = {};
    const unknown = [];
    const mirrors = [];
    let rewritten = 0;
    for (const [key, value] of Object.entries(entries)) {
        const prefix = "plugin:";
        if (!key.startsWith(prefix)) {
            // 既有的 `tool:` 预留前缀等未知键：原样保留，不猜。
            if (!(key in canonical))
                canonical[key] = value;
            unknown.push(key);
            continue;
        }
        const rawUnit = key.slice(prefix.length);
        const unit = canonicalizeUnitKey(rawUnit);
        if (unit === undefined) {
            canonical[key] = value;
            unknown.push(key);
            continue;
        }
        const canonicalKey = `${prefix}${unit}`;
        if (canonicalKey !== key)
            rewritten += 1;
        canonical[canonicalKey] = value;
        const mirror = mirrorKeyFor(unit);
        if (mirror !== undefined)
            mirrors.push({ unit, legacy: `${prefix}${mirror}` });
    }
    return {
        entries: canonical,
        report: { changed: rewritten > 0, rewritten, unknown, mirrors },
    };
}
/** 批量归一 `disabled` 字符串列表（保留未知项到 `unknown`，镜像旧键）。 */
export function canonicalizeUnitList(entries) {
    const units = [];
    const unknown = [];
    const mirrors = [];
    let rewritten = 0;
    for (const raw of entries) {
        if (typeof raw !== "string" || raw.length === 0)
            continue;
        const unit = canonicalizeUnitKey(raw);
        if (unit === undefined) {
            unknown.push(raw);
            continue;
        }
        if (unit !== raw.trim())
            rewritten += 1;
        if (!units.includes(unit))
            units.push(unit);
        const mirror = mirrorKeyFor(unit);
        if (mirror !== undefined)
            mirrors.push({ unit, legacy: mirror });
    }
    return { units, report: { changed: rewritten > 0, rewritten, unknown, mirrors } };
}
/**
 * 构建「规范化 + 旧键镜像 + 未知键保留」的最终列表（写盘用）。
 *
 * 顺序：规范 unit（按输入顺序）→ 镜像旧键 → 未知键；去重。
 */
export function buildMirroredUnitList(units, unknown = []) {
    const out = [];
    const seen = new Set();
    let addedMirrors = 0;
    const push = (value) => {
        if (seen.has(value))
            return;
        seen.add(value);
        out.push(value);
    };
    for (const unit of units) {
        push(unit);
        const mirror = mirrorKeyFor(unit);
        if (mirror !== undefined && !seen.has(mirror)) {
            push(mirror);
            addedMirrors += 1;
        }
    }
    for (const value of unknown)
        push(value);
    return { list: out, addedMirrors };
}
/** 判断列表是否已经「规范化 + 含镜像」（避免重复写盘）。 */
export function isUnitListSettled(entries) {
    const set = new Set(entries.map((entry) => entry.trim()));
    for (const raw of entries) {
        const unit = canonicalizeUnitKey(raw);
        if (unit === undefined)
            continue; // 未知项不参与判断（原样保留）
        if (unit !== raw.trim()) {
            // 旧键镜像：只有规范键同时存在才算 settled（未迁移的旧键要求写回）。
            if (!set.has(unit))
                return false;
            continue;
        }
        const mirror = mirrorKeyFor(unit);
        if (mirror !== undefined && !set.has(mirror))
            return false;
    }
    return true;
}
