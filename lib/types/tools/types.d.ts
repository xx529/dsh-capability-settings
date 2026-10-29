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
export declare const UNATTRIBUTED_UNIT = "__unattributed__";
/** 未识别来源单元的展示名（卡片标题 / 详情标题）。 */
export declare const UNATTRIBUTED_DISPLAY = "\u6765\u6E90\u672A\u8BC6\u522B";
/** 持久化键前缀：`plugin:<unit>`（本批唯一使用的前缀）。 */
export declare const PLUGIN_UNIT_KEY_PREFIX = "plugin:";
/** 开关单元 id → 持久化键（`plugin:<unit>`）。 */
export declare function unitKeyOf(unit: string): string;
/**
 * 持久化键 → 开关单元 id。
 *
 * 只认 `plugin:` 前缀；`tool:` 是未来 per-tool 覆盖的预留前缀，本批读端忽略
 * （返回 undefined），避免旧版把新键当真。
 */
export declare function unitOfKey(key: string): string | undefined;
/** 该单元的工具（`restrict` 用 `name`；UI 只读展示 `name` + 截断后的说明）。 */
export interface HostToolBrief {
    /** 完整工具名（restrict 用这个名字；UI 只读展示）。 */
    name: string;
    /** 一句话说明（截断到 200 码点，与 Jev 的 DESCRIPTION_LIMIT 同口径）。 */
    description?: string;
}
/** 一个插件单元在视图里的样子（卡片 / 面板行共用）。 */
export interface ToolsUnitView {
    /** 开关单元 id（持久化键 = `plugin:<unit>`；未识别 = `"__unattributed__"`）。 */
    unit: string;
    /** 展示名（卡片标题 / 详情标题）。 */
    name: string;
    /** plugin = 已识别插件；unattributed = 来源未识别。 */
    kind: "plugin" | "unattributed";
    /** 该单元当前可见的全部工具。 */
    tools: HostToolBrief[];
    /** 工具数（卡片描述与 Jev toolCount 用）。 */
    toolCount: number;
    /** 归属判定（详情「来源判定」文案）。 */
    attribution: {
        matchedBy: "prefix" | "exact" | "unknown";
        /** 命中的模式原文（未识别缺省）。 */
        pattern?: string;
        /** 包名（已识别才有）。 */
        packageName?: string;
    };
    /** 本会话生效开关（显式覆盖 > 默认 true）。 */
    enabledInSession: boolean;
    /** 是否有显式会话覆盖（「恢复默认」是否可点）。 */
    explicit: boolean;
    /**
     * 不可开关原因；正常缺省。第一批唯一可能来源 = 当前 agent 作用域缺少
     * `tools.restrict`（旧外壳 / 服务缺失），或该 unit 含被契约禁止的名字
     * （`run_code` 等，理论不会出现）。
     */
    lockedReason?: string;
    /** 上一次 restrict 的降级状态（仅传了 sessionId 时；诊断/文案用）。 */
    restriction?: {
        state: "applied" | "skipped" | "failed";
        error?: string;
    };
}
/** `tools.list` 的返回。 */
export interface ToolsListView {
    units: ToolsUnitView[];
    /** 全局工具总数（诊断）。 */
    totalGlobalTools: number;
    /** 被判定为宿主内建而排除的条数（诊断；不下发名单）。 */
    excludedBuiltinCount: number;
    /** 服务缺失/异常时的原因（不阻断其它域）。 */
    errors: string[];
    /** 本次查询绑定的会话（没传 sessionId 时缺省；enabledInSession 恒为默认值）。 */
    sessionId?: string;
}
/**
 * `tools.setSessionEnabled` 入参（**batch-first**：单条 = 长度 1 的数组）。
 *
 * 客户端只传 `unit`（不是工具名）：宿主自己从当前全局视图重算 deny 名单，
 * 防止客户端注入任意 deny 名单。
 */
export interface ToolsSetSessionInput {
    sessionId: string;
    /** 单元 id 列表。 */
    units: string[];
    /** true=开启（写 true）；false=关闭；undefined=清除显式覆盖（恢复默认）。 */
    enabled: boolean | undefined;
}
/** `tools.setSessionEnabled` 结果（业务失败收在 `ok:false`）。 */
export type ToolsSetSessionResult = {
    ok: true;
    applied: number;
} | {
    ok: false;
    errors: string[];
};
/** 默认开启（Tools 域没有项目级默认，A3：键缺失 = 默认开启）。 */
export declare const TOOLS_DEFAULT_ENABLED = true;
