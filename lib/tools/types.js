/**
 * Tools 域（插件级开关）的契约类型。
 *
 * 方案：`docs/architecture/v13-implementation.md` §5.1（唯一权威）。
 * 与客户端类型镜像同名字段、同义（客户端镜像在 `src/client/api.ts`，本文件是
 * 宿主侧**唯一**定义处；客户端不得反向 import 宿主模块）。
 *
 * 域边界（方案 §2.1，互斥）：`mcp__*` 恒归 MCP 域，宿主内建工具不入任何域，
 * Tools 只收「插件直接注册的非 mcp 工具」，一个插件 = 一个开关单元；识别不到
 * 来源的合并成唯一单元 `__unattributed__`（A4：可开关、计入分母、不进 Jev 候选）。
 *
 * @module dsh-capability-settings/tools/types
 */
/** 未识别来源单元 id（固定常量；`__` 前缀避免与插件展示名冲突）。 */
export const UNATTRIBUTED_UNIT = "__unattributed__";
/** 未识别来源单元的展示名（卡片标题 / 详情标题）。 */
export const UNATTRIBUTED_DISPLAY = "来源未识别";
/** 持久化键前缀：`plugin:<unit>`（本批唯一使用的前缀）。 */
export const PLUGIN_UNIT_KEY_PREFIX = "plugin:";
/** 开关单元 id → 持久化键（`plugin:<unit>`）。 */
export function unitKeyOf(unit) {
    return `${PLUGIN_UNIT_KEY_PREFIX}${unit}`;
}
/**
 * 持久化键 → 开关单元 id。
 *
 * 只认 `plugin:` 前缀；`tool:` 是未来 per-tool 覆盖的预留前缀，本批读端忽略
 * （返回 undefined），避免旧版把新键当真。
 */
export function unitOfKey(key) {
    return typeof key === "string" && key.startsWith(PLUGIN_UNIT_KEY_PREFIX)
        ? key.slice(PLUGIN_UNIT_KEY_PREFIX.length)
        : undefined;
}
/** 默认开启（Tools 域没有项目级默认，A3：键缺失 = 默认开启）。 */
export const TOOLS_DEFAULT_ENABLED = true;
