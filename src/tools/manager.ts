/**
 * Tools 域（插件级会话开关）：枚举 → 插件归组 → 会话记录 → `tools.restrict` 应用。
 *
 * 方案：`docs/architecture/v13-implementation.md` §2 / §3 / §5（唯一权威）。
 *
 * 关键口径（不得偏离）：
 *
 *   - **枚举源唯一**：`ctx.root.get("tools").schemas()`（全局视图）。`restrict`
 *     只能屏蔽"继承层"的名字，而 agent 自身层注册的插件工具**枚举不到** ⇒
 *     不显示（不是显示后置灰，方案 §2.2 的规格修正）。
 *   - **一个插件 = 一个开关单元**：关闭 = 对该插件在本会话的全部可继承工具
 *     `tools.restrict({deny})`；deny 名单**每次重算**，持久化只存 `plugin:<unit>`。
 *   - **A4 未识别单元**：可开关、计入分母、不进 Jev 候选。
 *   - **A3 无项目默认**：键缺失 = 默认开启；`enabled:true` 写显式 true（为了
 *     与将来的项目默认语义稳定），`enabled:undefined` 才是"恢复默认"。
 *   - **R2 预留**：{@link applyForAgent} 是纯函数式"对任意 agent 作用域应用
 *     restrict"的入口，不假设自己只被会话创建路径调用（第一批不实现继承本身）。
 *
 * 生命周期与 `mcp/loader.ts` 同构：`agent/created` 首轮应用、`agent/disposed`
 * 只清内存（磁盘留给重启恢复）、`tools/change` 微任务合并后重算。
 *
 * **默认快照冻结（v21.2）**：全局默认 / 可见性 / 每工作区默认的变更**只影响新建
 * 会话**。会话创建时把当时的默认快照冻结进 `record.defaults`；之后的重算
 * （`tools/change` / 会话级开关）都用冻结快照，写盘不向 live agent 传播。
 *
 * @module dsh-capability-settings/tools/manager
 */

import { errMessage } from "../shared/errors.js";
import type { CapabilityDefaults } from "../overrides/types.js";
import { INVISIBLE_CAPABILITY_ERROR } from "../shared/visibility.js";
import { HOST_INJECTED_REASON } from "../shared/host-injected.js";
import { attributeTool, hostBuiltinUnitOf, isHostBuiltinTool } from "../shared/plugin-attribution.js";
import { parseMcpToolName } from "../mcp/usage.js";
import type { SessionStateMeta, SessionStateStore } from "../session-state.js";
import {
  applyRestrict,
  computeDenyNames,
  sameDenyNames,
  TOOLS_RESTRICT_UNAVAILABLE,
  type RestrictOutcome,
  type ToolsRestrictionState,
} from "./restrict.js";
import {
  UNATTRIBUTED_DISPLAY,
  UNATTRIBUTED_UNIT,
  unitKeyOf,
  unitOfKey,
  type HostToolBrief,
  type ToolsInspectResult,
  type ToolsInspectedTool,
  type ToolsListView,
  type ToolsSetGlobalResult,
  type ToolsSetSessionResult,
  type ToolsUnitView,
} from "./types.js";
import type { ToolsGlobalStore } from "./global-state.js";
import { tableToolAttribution, type AttributionResolver } from "./attribution/resolver.js";
import { displayNameOfPackage, legacyUnitOf } from "./attribution/unit-id.js";
import type { ToolAttribution } from "./attribution/types.js";

/** 结构化 logger 子集（与插件其它模块一致，缺省静默）。 */
export interface ToolsLogger {
  warn?(message: string): void;
  info?(message: string): void;
}

/** 工具说明的码点上限（与 Jev 的 `DESCRIPTION_LIMIT` 同口径）。 */
export const TOOL_DESCRIPTION_LIMIT = 200;

/**
 * `tools.inspect` 输出的软告警阈值（UTF-8 字节）。
 *
 * 详情页要拿完整 schema（用户明确要求对齐 dsh-context 的检视器、可看原始 JSON），
 * 所以**不裁剪字段**；只在整包超过该阈值时记一条 warning（便于诊断"详情页很慢"），
 * 严禁静默丢 `parameters`。
 */
export const TOOL_INSPECT_WARN_BYTES = 1024 * 1024;

/** 旧外壳（无 `tools.restrict`）时的单元锁定文案。 */
export const LOCKED_RESTRICT_UNAVAILABLE = "当前外壳不支持按会话关闭";

/** 枚举结果（内部；`names` 是当前全局视图里的全部工具名，deny 过滤用）。 */
interface ToolsEnumeration {
  units: Array<{
    unit: string;
    name: string;
    kind: "plugin" | "unattributed";
    /** true = 宿主注入（`@deepseek-ai/*`）：只读展示，不参与任何开关。 */
    hostInjected: boolean;
    /** 单元级归属（聚合多条工具结果；`mixed` 表示依据不一致）。 */
    attribution: ToolsUnitView["attribution"];
    /** 轻量视图（name + 截断 description）：`tools.list` / deny 计算用。 */
    tools: HostToolBrief[];
    /**
     * 完整视图（name + **不截断** description + 原始 `parameters`）：
     * `tools.inspect` 懒加载用，只在同一次枚举里顺带收集（不额外扫 schemas，
     * 避免与归属逻辑二次漂移；枚举结果本身按调用即弃，不常驻内存）。
     */
    details: ToolsInspectedTool[];
  }>;
  /** 全局工具总数（诊断）。 */
  totalGlobalTools: number;
  /** 被判定为宿主内建、但**未**以只读单元展示的条数（v26 起恒 0；保留诊断字段）。 */
  excludedBuiltinCount: number;
  /** 当前全局视图里的全部工具名。 */
  names: ReadonlySet<string>;
  /** 服务缺失/异常原因（不阻断其它域）。 */
  errors: string[];
}

/** 一个 session 的 restrict 簿记。 */
interface ToolsSessionRecord {
  agent: any;
  cwd?: string;
  /** 本代会话显式关单元 → 展示名（重算时用）。 */
  targets: Array<{ unit: string; name: string }>;
  restrictDisposers: Array<() => void>;
  appliedDeny: string[];
  restrictions: Array<{ unit: string; state: ToolsRestrictionState; error?: string }>;
  /** 串行化本 session 的重算（与 mcp loader 同款）。 */
  queue: Promise<void>;
  /** 降级 warning 只打一次，避免 `tools/change` 刷新刷屏。 */
  restrictWarned?: boolean;
  /**
   * v21.2：本会话**创建时冻结**的默认快照（unit → 当时的默认态）。
   *
   * 语义：全局默认 / 可见性 / 每工作区默认的变更**只影响新会话**；已存在的
   * live session 不能因为配置变化而改变 restrict。创建后新出现的 unit 首次
   * 重算时惰性补入（取那一刻的配置，相当于它"加入会话"时的默认）。
   */
  defaults: Map<string, CapabilityDefaults>;
  /**
   * v21.2：旧装配（无 `capabilityDefaults` 注入）的全局兜底快照；与会话同时
   * 冻结，避免 `tools-global.json` / 全局 `tools` 变更影响已存在会话。
   */
  globals?: Set<string>;
}

/** 构造依赖。 */
export interface ToolsManagerDeps {
  /**
   * 会话级开关的持久化存储（可选）：提供时开关按 sessionId 落盘，agent 重建 /
   * 宿主重启后恢复；省略时纯内存（headless / 旧装配）。
   */
  state?: SessionStateStore;
  /** 宿主日志（结构子集）。 */
  logger?: ToolsLogger;
  /**
   * 全局默认存储（`tools-global.json`，能力面板开关）。提供时
   * `effective = 会话覆盖 ?? 全局默认`；省略时按「全部启用」处理（旧装配）。
   */
  global?: ToolsGlobalStore;
  /** 全局 tools 服务访问器（测试注入；缺省 `ctx.root.get("tools") ?? ctx.get("tools")`）。 */
  globalTools?: () => any;
  /**
   * v21：可见性 + 每工作区默认 + 全局兜底的批量入口
   * （`overrides.capabilityDefaultsMany("tools", units, cwd)`）。缺省 = 全部可见、用
   * `globallyDisabled` 的旧语义。
   */
  capabilityDefaults?: (units: readonly string[], cwd?: string) => Promise<Map<string, CapabilityDefaults>>;
  /**
   * v21：全局兜底关闭集合（`tools-global.json` disabled ∪ 全局文件 `tools` 的并集）。
   *
   * 提供时优先用它（旧 store 继续保留只读兼容）；缺省回退 `deps.global`（旧装配）。
   */
  globalDefaults?: () => Promise<ReadonlySet<string>>;
  /**
   * v21：写全局兜底默认（写 `capability-global-overrides.json` 的 `tools`）。
   *
   * 提供时 `setGlobalEnabled` 用它（不再写 `tools-global.json`）；缺省回退
   * `deps.global.setEnabled`（旧装配 / 测试）。
   */
  writeGlobalDefaults?: (units: readonly string[], enabled: boolean) => Promise<ToolsSetGlobalResult>;
  /**
   * 自动归属 resolver（T0/T1/T2/T3 + 表兜底）。缺省 = 纯人工表（旧装配/测试）。
   */
  resolver?: AttributionResolver;
}

/** 挂到 `ctx.capabilityPanel.tools` 的服务形状（方案 §5.1）。 */
export interface ToolsManager {
  /** 枚举插件单元 + 本会话开关（不传 sessionId = 只读视图，供主面板）。 */
  list(input?: { sessionId?: string }): Promise<ToolsListView>;
  /**
   * 懒加载单个单元的工具 schema（`tools.inspect`）：**完整** description +
   * 原始 `parameters` JSON Schema（不裁剪内容）。
   *
   * `unit` 接受裸 unit（= `tools.list` 的 `units[].unit`）或 `plugin:<unit>`
   * 持久化键形态；成功 value = `{ unit, tools }`，业务失败 = `{ok:false,errors}`。
   * `tools.list` 保持轻量（只 name + 200 码点 description），schema 只在这里取。
   */
  inspect(input: unknown): Promise<ToolsInspectResult>;
  /**
   * 设置本会话的插件开关（**batch-first**；单条 = 长度 1 的数组）。
   *
   * `units` 只接受单元 id（不是工具名）：宿主自己重算 deny 名单。
   * `enabled` 三种取值语义见方案 §5.3。
   */
  setSessionEnabled(input: unknown): Promise<ToolsSetSessionResult>;
  /**
   * 设置**全局默认**（能力面板开关；v21.2 起只写配置，**只影响新建会话**）。
   *
   * `{units, enabled}`；写盘后只刷新内存镜像（供列表投影与新会话初始化），
   * **不**对 live agent 重新 apply——默认变更不能改变已存在会话的 restrict。
   * 会话首屏的开关仍走 {@link setSessionEnabled}（只写本会话覆盖，即时生效）。
   */
  setGlobalEnabled(input: unknown): Promise<ToolsSetGlobalResult>;
  /** 本会话的显式开关快照（诊断；键带 `plugin:` 前缀）。 */
  sessionToggleState(sessionId?: string): Record<string, boolean>;
  /**
   * v21.2：可见性 / 每工作区默认写入后**只刷新内存镜像**（供列表投影 / 新建会话
   * 初始化），不传播到已存在的 live session（默认 / 可见性只影响新会话）。
   */
  refreshFromVisibility(): Promise<void>;
  /** 卸载：移除生命周期监听、解除已应用的 restrict、清空内存状态。 */
  dispose(): void;
}

/** 码点截断（不追加省略号）。 */
function truncateCodepoints(text: string, limit: number): string {
  const codepoints = Array.from(text);
  return codepoints.length <= limit ? text : codepoints.slice(0, limit).join("");
}

/**
 * 枚举全局工具视图 → 按插件聚合成开关单元（纯函数，无副作用）。
 *
 * 归属顺序（方案 §2.1，按序短路）：`mcp__*` → 宿主内建（只读宿主单元）→ 插件
 * 映射 → 未识别。
 *
 * @param access 全局 tools 服务访问器（`() => ctx.root.get("tools")`）
 */
function enumerateGlobalTools(
  access: () => any,
  resolve: (toolName: string) => ToolAttribution = (toolName) => tableToolAttribution(toolName) ?? { matchedBy: "unknown", confidence: "low" },
): ToolsEnumeration {
  const empty = (errors: string[]): ToolsEnumeration => ({
    units: [],
    totalGlobalTools: 0,
    excludedBuiltinCount: 0,
    names: new Set<string>(),
    errors,
  });
  let toolsService: any;
  try {
    toolsService = access();
  } catch (error) {
    return empty([`读取宿主 tools 服务失败：${errMessage(error)}`]);
  }
  if (toolsService === undefined || toolsService === null || typeof toolsService.schemas !== "function") {
    return empty(['宿主 tools 服务不可用（ctx.get("tools").schemas 缺失）']);
  }
  let schemas: unknown;
  try {
    schemas = toolsService.schemas();
  } catch (error) {
    return empty([`读取全局工具清单失败：${errMessage(error)}`]);
  }
  if (!Array.isArray(schemas)) return empty(["全局工具清单形状异常（schemas() 未返回数组）"]);
  // 空白注册表（宿主 tools 服务可能尚未就绪）：给空态原因，面板显示说明而非"没有插件"。
  if (schemas.length === 0) return empty(["全局工具注册表为空（宿主 tools 服务可能尚未就绪）"]);

  const byUnit = new Map<string, ToolsEnumeration["units"][number]>();
  const names = new Set<string>();
  let excludedBuiltinCount = 0;
  for (const schema of schemas) {
    const raw = schema as { name?: unknown; description?: unknown } | null | undefined;
    const name = typeof raw?.name === "string" ? raw.name : "";
    if (name.length === 0) continue;
    names.add(name);
    // 规则 1：任何可解析的 mcp__<ns>__<tool> 恒归 MCP 域（Tools 永不出现）。
    if (parseMcpToolName(name) !== undefined) continue;
    // 规则 2：宿主内建工具 → 只读「宿主」单元（v26 起不再直接丢弃）。
    // 分组只服务展示：core 工具按宿主包，未命中精确/前缀规则的落到 generic；
    // 这些单元在 list/computeTargets 里恒启用且不参与 restrict。
    const builtin = isHostBuiltinTool(name);
    const attribution: ToolAttribution = builtin
      ? {
          packageId: hostBuiltinUnitOf(name),
          display: displayNameOfPackage(hostBuiltinUnitOf(name)),
          matchedBy: "builtin",
          confidence: "high",
          hostInjected: true,
        }
      : resolve(name);
    const packageId = attribution.packageId;
    const unit = packageId !== undefined ? packageId : UNATTRIBUTED_UNIT;
    const display =
      packageId !== undefined
        ? attribution.display ?? displayNameOfPackage(packageId)
        : UNATTRIBUTED_DISPLAY;
    const kind: "plugin" | "unattributed" = packageId === undefined ? "unattributed" : "plugin";
    let entry = byUnit.get(unit);
    if (entry === undefined) {
      entry = {
        unit,
        name: display,
        kind,
        hostInjected: attribution.hostInjected === true,
        tools: [],
        details: [],
        attribution: {
          matchedBy: attribution.matchedBy,
          ...(attribution.pattern !== undefined ? { pattern: attribution.pattern } : {}),
          ...(packageId !== undefined ? { packageName: packageId } : {}),
          confidence: attribution.confidence,
          ...(attribution.conflictsWithTable === true ? { conflictsWithTable: true } : {}),
          ...(attribution.ambiguous === true ? { ambiguous: true } : {}),
          ...(legacyUnitOf(unit) !== undefined ? { legacyUnit: legacyUnitOf(unit) } : {}),
        },
      };
      byUnit.set(unit, entry);
    } else {
      // 单元级归属聚合：取最高优先级依据；不同依据 = mixed（诊断）。
      const priority: Record<string, number> = {
        builtin: 7,
        runtime: 6,
        literal: 5,
        table: 4,
        namespace: 4,
        similarity: 3,
        prefix: 2,
        exact: 2,
        source: 1,
        unknown: 0,
      };
      const currentRank = priority[entry.attribution.matchedBy] ?? 0;
      const candidateRank = priority[attribution.matchedBy] ?? 0;
      if (candidateRank > currentRank) {
        entry.attribution = {
          ...entry.attribution,
          matchedBy: attribution.matchedBy,
          confidence: attribution.confidence,
          ...(attribution.pattern !== undefined ? { pattern: attribution.pattern } : {}),
        };
      } else if (candidateRank !== currentRank) {
        entry.attribution = { ...entry.attribution, mixed: true };
      }
      if (attribution.conflictsWithTable === true) entry.attribution = { ...entry.attribution, conflictsWithTable: true };
      if (attribution.hostInjected === true) entry.hostInjected = true;
    }
    const fullDescription = typeof raw?.description === "string" && raw.description.length > 0 ? raw.description : undefined;
    // 轻量视图（list）：description 截断到 200 码点。
    const briefDescription =
      fullDescription !== undefined ? truncateCodepoints(fullDescription, TOOL_DESCRIPTION_LIMIT) : undefined;
    entry.tools.push(briefDescription !== undefined ? { name, description: briefDescription } : { name });
    // 完整视图（inspect）：不截断 description，原始 parameters 原样保留（不裁剪内容）。
    const parameters = (raw as { parameters?: unknown } | undefined)?.parameters;
    entry.details.push({
      name,
      ...(fullDescription !== undefined ? { description: fullDescription } : {}),
      ...(parameters !== null && typeof parameters === "object" && !Array.isArray(parameters)
        ? { parameters: parameters as Record<string, unknown> }
        : {}),
    });
  }
  const units = [...byUnit.values()];
  for (const unit of units) {
    unit.tools.sort((a, b) => a.name.localeCompare(b.name));
    unit.details.sort((a, b) => a.name.localeCompare(b.name));
  }
  units.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "plugin" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return { units, totalGlobalTools: schemas.length, excludedBuiltinCount, names, errors: [] };
}

/** 单元级归属的确定性选择：命中规则优先，其次模式越长越优先，最后按模式字典序。 */
function isBetterAttribution(
  current: ToolsUnitView["attribution"],
  candidate: ToolsUnitView["attribution"],
): boolean {
  if (current.matchedBy === "unknown") return candidate.matchedBy !== "unknown";
  if (candidate.matchedBy === "unknown") return false;
  const currentLength = current.pattern?.length ?? 0;
  const candidateLength = candidate.pattern?.length ?? 0;
  if (candidateLength !== currentLength) return candidateLength > currentLength;
  return (candidate.pattern ?? "") < (current.pattern ?? "");
}

/**
 * 单元在某个会话的**生效值**：`effective = 会话覆盖 ?? 全局默认`。
 *
 * 两层语义的唯一口径（用户澄清：能力面板 = 全局默认、会话首屏 = 本会话覆盖）。
 * 纯函数，不读任何存储；`applyForAgent`（R2 预留）与 manager 共用。
 *
 * @param unit 裸 unit id
 * @param toggles 该会话的显式覆盖（`plugin:<unit>` → boolean；缺省 = 无覆盖）
 * @param globallyDisabled 全局默认关闭的 unit 集合（`tools-global.json`）
 */
export function effectiveEnabled(
  unit: string,
  toggles: ReadonlyMap<string, boolean> | undefined,
  globallyDisabled: ReadonlySet<string>,
): boolean {
  const explicit = toggles?.get(unitKeyOf(unit));
  if (explicit !== undefined) return explicit;
  return !globallyDisabled.has(unit);
}

/**
 * v21：带可见性 / 每工作区默认的生效值。
 *
 * 优先级：**不可见 ⇒ 强制关（会话显式不能打开）** > 会话显式 > 工作区默认
 * （可见性 + 每工作区全局默认 + 项目三态，来自 `overrides.capabilityDefaults`）。
 * 缺省 / 无快照时回退 {@link effectiveEnabled}（旧语义）。
 *
 * @param unit 裸 unit id
 * @param toggles 会话显式覆盖（`plugin:<unit>` → boolean）
 * @param defaults 能力默认快照（可缺省）
 * @param globallyDisabled 旧全局兜底（仅在无快照时使用）
 */
export function effectiveEnabledFor(
  unit: string,
  toggles: ReadonlyMap<string, boolean> | undefined,
  defaults: ReadonlyMap<string, CapabilityDefaults> | undefined,
  globallyDisabled: ReadonlySet<string> = new Set<string>(),
): boolean {
  const capability = defaults?.get(unit);
  if (capability !== undefined && !capability.visible) return false;
  const explicit = toggles?.get(unitKeyOf(unit));
  if (explicit !== undefined) return explicit;
  if (capability !== undefined) return capability.effectiveDefaultEnabled;
  return !globallyDisabled.has(unit);
}

/**
 * 从「会话覆盖 + 可见性/工作区默认 + 全局兜底」算出本会话要关闭的单元 + 工具清单
 * （纯函数）。目标 = 所有 effective=false 的单元；插件已卸载 / 改名后残留的会话键
 * 不会命中任何单元，自然被忽略（方案 §3.4）。
 */
function computeTargets(
  toggles: ReadonlyMap<string, boolean> | undefined,
  enumeration: ToolsEnumeration,
  globallyDisabled: ReadonlySet<string>,
  defaults?: ReadonlyMap<string, CapabilityDefaults>,
): { targets: Array<{ unit: string; name: string }>; targetTools: HostToolBrief[][] } {
  const targets: Array<{ unit: string; name: string }> = [];
  const targetTools: HostToolBrief[][] = [];
  for (const unit of enumeration.units) {
    // 宿主注入能力是运行基线：所有工作区默认需要，任何默认/会话状态都不能把它关掉。
    if (unit.hostInjected) continue;
    if (effectiveEnabledFor(unit.unit, toggles, defaults, globallyDisabled)) continue;
    targets.push({ unit: unit.unit, name: unit.name });
    targetTools.push(unit.tools);
  }
  targets.sort((a, b) => a.name.localeCompare(b.name));
  return { targets, targetTools };
}

/** 对某个 agent 的一次性应用结果（R2 预留形态的返回值）。 */
export interface ApplyForAgentResult {
  /** 本会话要关闭的单元（空 = 无需屏蔽）。 */
  targets: Array<{ unit: string; name: string }>;
  /** restrict 执行结果（`applied` 时带 disposer 供调用方释放）。 */
  outcome: RestrictOutcome;
}

/** 默认的全局 tools 访问器：从 agent 的 scoped ctx 反查 root 视图。 */
function rootToolsOf(agent: any): any {
  try {
    return agent?.ctx?.root?.get?.("tools") ?? agent?.ctx?.get?.("tools");
  } catch {
    return undefined;
  }
}

/**
 * 对**任意 agent 作用域**应用 Tools restrict（R2 派生继承的唯一复用点）。
 *
 * 纯函数式：只读 `toggles` / 全局视图，只通过 `agent.ctx` 施加 restrict，
 * 不依赖本模块的会话记录、不假设自己被会话创建路径调用（提案 §5.1 的 child 侧
 * 就是再调一次同一个函数）。**第一批不调用它实现继承**，只保证形态可用。
 *
 * @param agent 目标 agent（需要 `agent.ctx`；stub 直接返回空结果）
 * @param sessionId 目标会话 id（仅诊断/日志）
 * @param toggles 该作用域的会话覆盖表（`plugin:<unit>` → boolean）
 * @param options.globalTools 全局视图访问器（缺省从 agent.ctx 反查 root）
 * @param options.globallyDisabled 全局默认关闭的 unit 集合（缺省空 = 全部启用）。
 *   传入后按 `effective = 会话覆盖 ?? 全局默认` 计算；**不从全局存储读**（R2
 *   子 agent 继承时由调用方投影父级/全局集合进来即可）。
 * @param options.logger 降级 warning 日志
 */
export function applyForAgent(
  agent: any,
  sessionId: string,
  toggles: ReadonlyMap<string, boolean>,
  options: {
    globalTools?: () => any;
    logger?: ToolsLogger;
    globallyDisabled?: ReadonlySet<string>;
    /** v21：可见性 + 每工作区默认快照（缺省 = 全部可见、按 globallyDisabled）。 */
    capabilityDefaults?: ReadonlyMap<string, CapabilityDefaults>;
    resolveTool?: (toolName: string) => ToolAttribution;
  } = {},
): ApplyForAgentResult {
  if (agent?.ctx === undefined) return { targets: [], outcome: { state: "skipped", deny: [] } };
  const enumeration = enumerateGlobalTools(
    options.globalTools ?? (() => rootToolsOf(agent)),
    options.resolveTool ?? ((name) => tableToolAttribution(name) ?? { matchedBy: "unknown", confidence: "low" }),
  );
  const { targets, targetTools } = computeTargets(
    toggles,
    enumeration,
    options.globallyDisabled ?? new Set<string>(),
    options.capabilityDefaults,
  );
  if (targets.length === 0) return { targets: [], outcome: { state: "skipped", deny: [] } };
  const deny = computeDenyNames(targetTools, enumeration.names);
  const outcome = applyRestrict(agent?.ctx?.get?.("tools"), deny);
  if (outcome.state === "failed") {
    options.logger?.warn?.(
      `capability-panel: 关闭插件工具失败（session ${sessionId}，${targets.map((target) => target.name).join(", ")}）：${outcome.error ?? "unknown"}`,
    );
  }
  return { targets, outcome };
}

/**
 * 创建 Tools 域管理器（组合根单例）。
 *
 * @param ctx 宿主插件上下文（用到 `on` / `get` / `logger` / `root`）
 * @param deps 持久化存储 / 日志 / 全局工具访问器
 */
export function createToolsManager(ctx: any, deps: ToolsManagerDeps = {}): ToolsManager {
  const logger = deps.logger ?? ctx?.logger;
  /** 全局 tools 访问器：优先依赖注入（测试），否则 root 视图。 */
  const globalTools = (): any => {
    if (deps.globalTools !== undefined) return deps.globalTools();
    try {
      return ctx?.root?.get?.("tools") ?? ctx?.get?.("tools");
    } catch {
      return undefined;
    }
  };

  const sessions = new Map<string, ToolsSessionRecord>();
  /** sessionId → 显式开关（`plugin:<unit>` → boolean）。 */
  const sessionToggles = new Map<string, Map<string, boolean>>();
  /** 已从磁盘恢复过开关的 session（每个 session 只 hydrate 一次）。 */
  const hydratedSessions = new Set<string>();
  const listeners: Array<() => void> = [];
  let disposed = false;
  /**
   * 全局默认关闭的单元缓存（`tools-global.json` 的内存镜像）。
   *
   * `effective = 会话覆盖 ?? !globalDisabled.has(unit)`；由 {@link refreshGlobal}
   * 从 `deps.global` 拉取，避免每次 list/重算都读盘。
   */
  let globalDisabled = new Set<string>();
  let globalHydrated = false;

  /** 会话 header 创建时间（防 sessionId 复用；取不到就不带）。 */
  function headerCreatedAtOf(agent: any): number | undefined {
    const value = agent?.session?.header?.createdAt;
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }

  /** 会话记录 → 落盘元数据（cwd 仅诊断、headerCreatedAt 防 id 复用）。 */
  function metaOf(record: ToolsSessionRecord | undefined): SessionStateMeta {
    const meta: SessionStateMeta = {};
    if (record?.cwd !== undefined) meta.cwd = record.cwd;
    const createdAt = headerCreatedAtOf(record?.agent);
    if (createdAt !== undefined) meta.headerCreatedAt = createdAt;
    return meta;
  }

  /** 按 agent.id 找记录（`sessions` 的键就是 agent id）。 */
  function findRecord(sessionId: string | undefined): ToolsSessionRecord | undefined {
    if (sessionId === undefined) return undefined;
    return sessions.get(sessionId);
  }

  /** 从 `deps.global` 刷新全局默认镜像（失败退化为「全部启用」，不阻断）。 */
  async function refreshGlobal(): Promise<void> {
    // v21：优先用组合根注入的并集口径（旧 tools-global.json ∪ 全局文件 tools）。
    if (deps.globalDefaults !== undefined) {
      try {
        globalDisabled = new Set(await deps.globalDefaults());
      } catch (error) {
        logger?.warn?.(`capability-panel: 读取全局 Tools 兜底默认失败，按全部启用继续：${errMessage(error)}`);
        globalDisabled = new Set<string>();
      }
      globalHydrated = true;
      return;
    }
    const store = deps.global;
    if (store === undefined) {
      globalDisabled = new Set<string>();
      globalHydrated = true;
      return;
    }
    await store.ready();
    globalDisabled = new Set(store.disabled());
    globalHydrated = true;
  }

  /**
   * v21：批量读取能力默认快照（可见性 + 每工作区默认 + 项目三态）。
   *
   * 缺省 / 失败返回空 map ⇒ 回退「全部可见 + 旧全局兜底」语义（旧装配 / 测试）。
   */
  async function capabilityDefaultsFor(
    cwd: string | undefined,
    units: readonly string[],
  ): Promise<Map<string, CapabilityDefaults>> {
    if (deps.capabilityDefaults === undefined || units.length === 0) return new Map();
    try {
      return await deps.capabilityDefaults([...new Set(units)], cwd);
    } catch (error) {
      logger?.warn?.(`capability-panel: 读取 Tools 可见性/默认失败（${errMessage(error)}），按全部可见处理`);
      return new Map();
    }
  }

  /** 首次使用前 hydrate（幂等；读盘失败按全部启用，绝不让 Tools 域整体失败）。 */
  async function hydrateGlobal(): Promise<void> {
    if (globalHydrated) return;
    try {
      await refreshGlobal();
    } catch (error) {
      logger?.warn?.(`capability-panel: 读取全局 Tools 默认失败，按全部启用继续：${errMessage(error)}`);
      globalDisabled = new Set<string>();
      globalHydrated = true;
    }
  }

  /**
   * 从持久化存储恢复某 session 的显式开关（幂等；每个 session 一次）。
   *
   * 内存里已有的键优先：同一运行内用户刚改过的开关不被磁盘旧值覆盖。
   * 读取前先 `await state.ready()`；失败降级为"无显式覆盖"（不阻断其它域）。
   */
  async function hydrateToggles(sessionId: string | undefined, meta: SessionStateMeta = {}): Promise<void> {
    const state = deps.state;
    if (state === undefined || sessionId === undefined || hydratedSessions.has(sessionId)) return;
    await state.ready();
    hydratedSessions.add(sessionId);
    // sessionId 复用（header 创建时间不一致）⇒ 旧记录已作废。
    if (!state.verifySession(sessionId, meta)) return;
    const stored = state.tools(sessionId);
    const keys = Object.keys(stored);
    if (keys.length === 0) return;
    let toggles = sessionToggles.get(sessionId);
    if (toggles === undefined) {
      toggles = new Map<string, boolean>();
      sessionToggles.set(sessionId, toggles);
    }
    for (const key of keys) if (!toggles.has(key)) toggles.set(key, stored[key]);
  }

  /** 释放本 session 上一代的 restrict（同步；换代与重算前都会调用）。 */
  function releaseRestrictions(record: ToolsSessionRecord): void {
    const disposers = record.restrictDisposers;
    record.restrictDisposers = [];
    record.appliedDeny = [];
    record.restrictions = [];
    for (const dispose of disposers) {
      try {
        dispose();
      } catch (error) {
        logger?.warn?.(
          `capability-panel: 解除插件工具屏蔽失败（session ${record.agent?.id}）：${errMessage(error)}`,
        );
      }
    }
  }

  /**
   * 按当前全局工具清单（重）计算本 session 的 plugin 屏蔽。全程同步，不与其它
   * 队列的异步挂载交错。幂等：名单与上一代完全一致时直接返回（`tools.restrict`
   * 自身也会触发 `tools/change`，这条短路是刷新路径不形成循环的关键）。
   */
  function applyRecord(record: ToolsSessionRecord, enumeration: ToolsEnumeration): void {
    const sessionId = typeof record.agent?.id === "string" ? record.agent.id : undefined;
    const toggles = sessionId !== undefined ? sessionToggles.get(sessionId) : undefined;
    // v21.2：用**本会话创建时冻结的**默认快照，而非当前配置文件（默认 / 可见性
    // 变更只影响新会话；会话级显式开关仍按 `toggles` 即时生效）。
    const { targets, targetTools } = computeTargets(
      toggles,
      enumeration,
      record.globals ?? new Set<string>(),
      record.defaults,
    );
    record.targets = targets;
    if (targets.length === 0) {
      if (record.restrictDisposers.length > 0 || record.restrictions.length > 0) releaseRestrictions(record);
      return;
    }
    const deny = computeDenyNames(targetTools, enumeration.names);
    if (record.restrictDisposers.length > 0 && sameDenyNames(deny, record.appliedDeny)) return;
    releaseRestrictions(record);
    const agentTools = record.agent?.ctx?.get?.("tools");
    const outcome = applyRestrict(agentTools, deny);
    if (outcome.state === "applied") {
      if (typeof outcome.dispose === "function") record.restrictDisposers.push(outcome.dispose);
      record.appliedDeny = deny;
    } else if (record.restrictWarned !== true) {
      record.restrictWarned = true;
      const reason =
        outcome.error ??
        (typeof agentTools?.restrict !== "function" ? TOOLS_RESTRICT_UNAVAILABLE : "empty deny list");
      logger?.warn?.(
        `capability-panel: 无法关闭插件工具（session ${record.agent?.id}，${targets.map((target) => target.name).join(", ")}）：${reason}`,
      );
    }
    record.restrictions = targets.map((target) => ({
      unit: target.unit,
      state: outcome.state,
      ...(outcome.error !== undefined ? { error: outcome.error } : {}),
    }));
  }

  /**
   * v21.2：取本会话冻结的默认快照；创建后新出现的 unit 惰性补入（保留"只对新
   * 会话生效"的语义，同时保证后来注册的工具也能按它加入会话时的默认被评估）。
   *
   * 冻结发生在**首次重算**（即 agent 创建时的初始化路径），之后配置变化不再影响
   * 已存在会话。旧装配没有 `capabilityDefaults` 时，额外冻结当时的全局兜底镜像。
   */
  async function frozenDefaultsOf(record: ToolsSessionRecord, units: readonly string[]): Promise<void> {
    const missing = units.filter((unit) => !record.defaults.has(unit));
    if (missing.length > 0) {
      const fetched = await capabilityDefaultsFor(record.cwd, missing);
      for (const [unit, capability] of fetched) record.defaults.set(unit, capability);
    }
    if (record.globals === undefined) record.globals = new Set(globalDisabled);
  }

  /** 本 session 串行化重算：先补 hydration（会话覆盖 + 冻结默认），再按当前视图应用 restrict。 */
  function scheduleRefresh(record: ToolsSessionRecord): Promise<void> {
    const run = record.queue.then(async () => {
      if (disposed) return;
      await hydrateGlobal();
      await hydrateToggles(typeof record.agent?.id === "string" ? record.agent.id : undefined, metaOf(record));
      const enumeration = enumerateGlobalTools(
        globalTools,
        deps.resolver?.resolveTool ?? ((name) => tableToolAttribution(name) ?? { matchedBy: "unknown", confidence: "low" }),
      );
      await frozenDefaultsOf(
        record,
        enumeration.units.map((unit) => unit.unit),
      );
      applyRecord(record, enumeration);
    });
    record.queue = run.catch(() => undefined);
    return run;
  }

  /** 工具集变化后的刷新合并标记：同一轮同步变更只安排一次微任务重算。 */
  let refreshQueued = false;

  /**
   * `tools/change`（「A tool was registered or unregistered, or a scoped
   * restriction changed」）后的重算：restrict 只能按当前已注册的名字屏蔽，首轮
   * 名单会漏掉插件懒加载后注册的工具。微任务合并 + `applyRecord` 幂等短路，
   * 不会自激。
   */
  function scheduleRefreshAll(): void {
    if (refreshQueued || disposed) return;
    refreshQueued = true;
    queueMicrotask(() => {
      refreshQueued = false;
      if (disposed) return;
      // 全局默认必须先 hydrate：用空集合重算会把「全局默认关闭」的 deny 误释放。
      void (async () => {
        await hydrateGlobal();
        if (disposed) return;
        const enumeration = enumerateGlobalTools(globalTools, deps.resolver?.resolveTool ?? ((name) => tableToolAttribution(name) ?? { matchedBy: "unknown", confidence: "low" }));
        const units = enumeration.units.map((unit) => unit.unit);
        for (const record of sessions.values()) {
          await frozenDefaultsOf(record, units);
          if (disposed) return;
          applyRecord(record, enumeration);
        }
      })();
    });
  }

  /** 登记一个 agent 并触发首轮应用（跳过无 ctx/id 的 stub）。 */
  function mountAgent(agent: any): void {
    if (agent?.ctx === undefined || agent?.id === undefined) return;
    if (sessions.has(agent.id)) return;
    const cwd = typeof agent.session?.header?.cwd === "string" ? agent.session.header.cwd : undefined;
    const record: ToolsSessionRecord = {
      agent,
      ...(cwd !== undefined ? { cwd } : {}),
      targets: [],
      restrictDisposers: [],
      appliedDeny: [],
      restrictions: [],
      queue: Promise.resolve(),
      defaults: new Map(),
    };
    sessions.set(agent.id, record);
    scheduleRefresh(record).catch((error) => {
      logger?.warn?.(`capability-panel: Tools restrict sweep failed for session ${agent.id}: ${String(error)}`);
    });
  }

  // —— 生命周期监听（与 mcp loader 同款）——
  if (typeof ctx?.on === "function") {
    const offCreated = ctx.on("agent/created", (payload: any) => mountAgent(payload?.agent));
    if (typeof offCreated === "function") listeners.push(offCreated as () => void);
    const offDisposed = ctx.on("agent/disposed", (payload: any) => {
      const sessionId = payload?.agent?.id;
      if (typeof sessionId !== "string") return;
      // 只清内存：磁盘记录要留给宿主重启后恢复（见 session-state.ts）。
      sessions.delete(sessionId);
      sessionToggles.delete(sessionId);
      hydratedSessions.delete(sessionId);
    });
    if (typeof offDisposed === "function") listeners.push(offDisposed as () => void);
    const offToolsChange = ctx.on("tools/change", () => scheduleRefreshAll());
    if (typeof offToolsChange === "function") listeners.push(offToolsChange as () => void);
  }
  // 插件加载时已经存活的 agent（resume / 历史 session）补应用。
  try {
    for (const agent of ctx?.get?.("agents")?.list?.() ?? []) mountAgent(agent);
  } catch {
    /* agents 服务不可用：按无存量会话处理 */
  }

  /**
   * `tools.list` 主体：枚举单元 + 本会话开关 +（v21）可见性投影。
   *
   * 传入 `cwd` 时按工作区计算可见性 / 每工作区默认：**不可见的单元从工作区视图
   * 隐藏**并计入 `hiddenCount`（全局视图仍返回全部单元，带「不可见」标签）。
   */
  async function list(input?: { cwd?: string; sessionId?: string }): Promise<ToolsListView> {
    const sessionId = typeof input?.sessionId === "string" && input.sessionId.length > 0 ? input.sessionId : undefined;
    const cwd = typeof input?.cwd === "string" && input.cwd.length > 0 ? input.cwd : undefined;
    await hydrateGlobal();
    const enumeration = enumerateGlobalTools(globalTools, deps.resolver?.resolveTool ?? ((name) => tableToolAttribution(name) ?? { matchedBy: "unknown", confidence: "low" }));
    const record = findRecord(sessionId);
    if (sessionId !== undefined) await hydrateToggles(sessionId, metaOf(record));
    const toggles = sessionId !== undefined ? sessionToggles.get(sessionId) : undefined;
    // v21：可见性 + 每工作区默认（一次批量读取；旧装配返回空 map ⇒ 旧语义）。
    // v21.2：带 sessionId 的 live 会话用**冻结快照**展示（默认 / 可见性变更只影响
    // 新会话；已存在会话的生效值保持创建时口径）；面板只读视图（无 sessionId）
    // 仍按当前配置展示。
    const unitIds = enumeration.units.map((unit) => unit.unit);
    let defaults: Map<string, CapabilityDefaults>;
    if (record !== undefined) {
      await frozenDefaultsOf(record, unitIds);
      defaults = record.defaults;
    } else {
      defaults = await capabilityDefaultsFor(cwd, unitIds);
    }
    // 旧外壳（无 agent 级 restrict）→ 开关从一开始就置灰，不等用户点了才失败。
    let lockedReason: string | undefined;
    if (record !== undefined) {
      const agentTools = record.agent?.ctx?.get?.("tools");
      if (typeof agentTools?.restrict !== "function") lockedReason = LOCKED_RESTRICT_UNAVAILABLE;
    }
    const workspaceView = cwd !== undefined || record?.cwd !== undefined;
    let hiddenCount = 0;
    const units: ToolsUnitView[] = [];
    for (const unit of enumeration.units) {
      // 插件用途描述（package.json description）：扫描未完成 / 包根读不到时缺省；
      // 不阻塞列表（Jev 侧有占位兜底）。
      const description = deps.resolver?.packageDescription?.(unit.unit);
      const briefTools = unit.tools.map((tool) => ({ ...tool }));
      if (unit.hostInjected) {
        // 宿主注入：只读展示、恒启用。忽略并清空可见性/默认/显式覆盖的投影，
        // 面板与运行时都不能把它关掉（所有工作区默认需要）。
        units.push({
          unit: unit.unit,
          name: unit.name,
          kind: unit.kind,
          hostInjected: true,
          ...(description !== undefined && description.trim().length > 0 ? { description: description.trim() } : {}),
          tools: briefTools,
          toolCount: unit.tools.length,
          attribution: { ...unit.attribution },
          defaultEnabled: true,
          enabled: true,
          enabledInSession: true,
          explicit: false,
          lockedReason: HOST_INJECTED_REASON,
        });
        continue;
      }
      const key = unitKeyOf(unit.unit);
      const explicit = toggles?.has(key) === true;
      const capability = defaults.get(unit.unit);
      const visible = capability?.visible ?? true;
      if (workspaceView && !visible) {
        hiddenCount += 1;
        continue; // 工作区视图不展示不可见单元
      }
      // 两层语义：`defaultEnabled` = 当前视图口径的默认（工作区 = 每工作区默认 +
      // 项目覆盖；全局视图 = 兜底全局默认）；`enabled` = 本会话生效
      // （会话覆盖 ?? 默认）。`enabledInSession` 是恒等 legacy 别名。
      const effectiveDefault =
        capability !== undefined
          ? capability.effectiveDefaultEnabled
          : !globalDisabled.has(unit.unit);
      const defaultEnabled = workspaceView
        ? capability !== undefined
          ? capability.workspaceDefaultEnabled
          : effectiveDefault
        : capability !== undefined
          ? capability.globalDefaultEnabled
          : effectiveDefault;
      const enabled = explicit ? toggles?.get(key) === true : effectiveDefault;
      const restriction = record?.restrictions.find((entry) => entry.unit === unit.unit);
      units.push({
        unit: unit.unit,
        name: unit.name,
        kind: unit.kind,
        ...(description !== undefined && description.trim().length > 0 ? { description: description.trim() } : {}),
        tools: briefTools,
        toolCount: unit.tools.length,
        attribution: { ...unit.attribution },
        defaultEnabled,
        enabled,
        enabledInSession: enabled,
        explicit,
        ...(capability !== undefined
          ? {
              visibilityMode: capability.visibilityMode,
              visibleWorkspaceCount: capability.visibleWorkspaceCount,
              ...(!workspaceView && capability.visibilityMode === "none" ? { disabledByVisibility: true } : {}),
              globalDefaultEnabled: capability.globalDefaultEnabled,
              workspaceDefaultEnabled: capability.workspaceDefaultEnabled,
              ...(capability.projectOverride !== undefined ? { projectOverride: capability.projectOverride } : {}),
              ...(workspaceView ? { visibleInWorkspace: capability.visible } : {}),
            }
          : {}),
        ...(lockedReason !== undefined ? { lockedReason } : {}),
        ...(restriction !== undefined
          ? { restriction: { state: restriction.state, ...(restriction.error !== undefined ? { error: restriction.error } : {}) } }
          : {}),
      });
    }
    return {
      units,
      totalGlobalTools: enumeration.totalGlobalTools,
      excludedBuiltinCount: enumeration.excludedBuiltinCount,
      errors: [...enumeration.errors],
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(cwd !== undefined ? { cwd } : {}),
      hiddenCount,
      ...(deps.resolver !== undefined ? { attributionSettling: deps.resolver.settling() } : {}),
    };
  }

  /**
   * `tools.inspect` 主体：懒加载单个单元的工具 schema。
   *
   * 设计约束：
   *   - **复用 `tools.list` 同一次枚举逻辑**（同一份归属/边界判定，不另起扫描，
   *     避免两套口径漂移）；完整 description 与原始 `parameters` 在同一次
   *     `schemas()` 扫描里顺带收集，不常驻内存；
   *   - `unit` 兼容裸 unit（= `tools.list` 的 `units[].unit`）与 `plugin:<unit>`
   *     持久化键两种写法，归一后匹配；
   *   - 成功 value = `{ unit, tools }`（**无 `ok` 字段**）；业务失败 =
   *     `{ok:false, errors}`：unit 未知 / tools 服务缺失 / schemas 抛错；
   *   - `sessionId` 目前仅做入参兼容、不参与枚举（inspect 是全局注册表视图，
   *     保留给将来「按会话可见性裁剪」）。
   */
  async function inspect(input: unknown): Promise<ToolsInspectResult> {
    if (disposed) return { ok: false, errors: ["tools manager disposed"] };
    const payload =
      input !== null && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
    const rawUnit = typeof payload.unit === "string" ? payload.unit.trim() : "";
    if (rawUnit.length === 0) return { ok: false, errors: ["unit is required"] };
    // 兼容两种写法：`plugin:<unit>`（持久化键，任务书示例）与裸 unit（list 返回形）。
    const unit = unitOfKey(rawUnit) ?? rawUnit;
    const enumeration = enumerateGlobalTools(globalTools, deps.resolver?.resolveTool ?? ((name) => tableToolAttribution(name) ?? { matchedBy: "unknown", confidence: "low" }));
    if (enumeration.errors.length > 0) return { ok: false, errors: [...enumeration.errors] };
    const found = enumeration.units.find((entry) => entry.unit === unit);
    if (found === undefined) return { ok: false, errors: [`unknown tools unit: ${rawUnit}`] };
    const tools: ToolsInspectedTool[] = found.details.map((tool) => ({ ...tool }));
    // 软保护：详情页要**完整** schema（用户明确要求可看原始 JSON），因此只告警、
    // 绝不裁剪字段；阈值仅用于排查"详情页很慢"。
    try {
      const bytes = Buffer.byteLength(JSON.stringify({ unit: found.unit, tools }), "utf8");
      if (bytes > TOOL_INSPECT_WARN_BYTES) {
        logger?.warn?.(
          `capability-panel: tools.inspect 输出较大（unit ${found.unit}，${bytes} bytes > ${TOOL_INSPECT_WARN_BYTES}）；按完整 schema 返回，未裁剪`,
        );
      }
    } catch {
      /* 序列化失败（异常 schema，如循环引用）：不影响返回 */
    }
    return { unit: found.unit, tools };
  }

  /** `tools.setSessionEnabled` 主体（batch-first；只信 unit id，工具名宿主重算）。 */
  async function setSessionEnabled(input: unknown): Promise<ToolsSetSessionResult> {
    if (disposed) return { ok: false, errors: ["tools manager disposed"] };
    const payload =
      input !== null && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
    const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
    if (sessionId.length === 0) return { ok: false, errors: ["sessionId is required"] };
    if (!Array.isArray(payload.units)) return { ok: false, errors: ["units must be an array"] };
    const enabled = payload.enabled;
    if (enabled !== undefined && typeof enabled !== "boolean") {
      return { ok: false, errors: ["enabled must be boolean or undefined"] };
    }
    const record = findRecord(sessionId);
    await hydrateGlobal();
    await hydrateToggles(sessionId, metaOf(record));
    const enumeration = enumerateGlobalTools(globalTools, deps.resolver?.resolveTool ?? ((name) => tableToolAttribution(name) ?? { matchedBy: "unknown", confidence: "low" }));
    const known = new Map(enumeration.units.map((unit) => [unit.unit, unit]));
    /** 宿主注入单元：先摘出去（全局/工作区默认都不允许写）。 */
    const hostUnits = new Set(enumeration.units.filter((unit) => unit.hostInjected).map((unit) => unit.unit));
    // v21：不可见单元不能写会话开关（混合请求时跳过不可见项；全不可见 ⇒ 业务失败）。
    const requestedAll = [
      ...new Set(
        payload.units.filter((unit): unit is string => typeof unit === "string" && unit.length > 0 && known.has(unit)),
      ),
    ];
    if (requestedAll.length > 0 && requestedAll.every((unit) => hostUnits.has(unit))) {
      return { ok: false, errors: [HOST_INJECTED_REASON] };
    }
    const requestedUnits = requestedAll.filter((unit) => !hostUnits.has(unit));
    // v21.2：live 会话用冻结快照判定可见性（创建后的全局可见性变更不影响本会话，
    // 会话级开关仍可正常写）；冷会话按当前配置。
    let defaults: Map<string, CapabilityDefaults>;
    if (record !== undefined) {
      await frozenDefaultsOf(record, requestedUnits);
      defaults = record.defaults;
    } else {
      defaults = await capabilityDefaultsFor(undefined, requestedUnits);
    }
    const visibleUnits = new Set(requestedUnits.filter((unit) => defaults.get(unit)?.visible !== false));
    if (requestedUnits.length > 0 && visibleUnits.size === 0) {
      return { ok: false, errors: [INVISIBLE_CAPABILITY_ERROR] };
    }
    let toggles = sessionToggles.get(sessionId);
    if (toggles === undefined) {
      toggles = new Map<string, boolean>();
      sessionToggles.set(sessionId, toggles);
    }
    let applied = 0;
    /** 本批落盘条目（`undefined` = 清除该键）；一次 `setToggles` 落盘。 */
    const writes: Record<string, boolean | undefined> = {};
    const seen = new Set<string>();
    for (const rawUnit of payload.units) {
      if (typeof rawUnit !== "string" || rawUnit.length === 0) continue;
      if (seen.has(rawUnit)) continue;
      seen.add(rawUnit);
      // 只接受当前枚举出的单元 id：客户端注入的任意名字一律忽略（不改 deny）。
      if (!known.has(rawUnit)) continue;
      // v21：不可见单元不写（混合请求跳过；composer 不会渲染它们）。
      if (!visibleUnits.has(rawUnit)) continue;
      const key = unitKeyOf(rawUnit);
      const has = toggles.has(key);
      // 当前生效值（无覆盖时跟随可见性/每工作区默认，旧装配回退全局兜底）。
      const capability = defaults.get(rawUnit);
      const current = has
        ? toggles.get(key) === true
        : capability !== undefined
          ? capability.effectiveDefaultEnabled
          : !globalDisabled.has(rawUnit);
      if (enabled === undefined) {
        if (!has) continue; // 本来就是默认，无需清除
        toggles.delete(key);
        writes[key] = undefined;
        applied += 1;
        continue;
      }
      if (current === enabled) continue; // 已是目标态：幂等短路（applied 不计）
      toggles.set(key, enabled);
      writes[key] = enabled;
      applied += 1;
    }
    if (Object.keys(writes).length > 0 && deps.state !== undefined) {
      // 落盘失败只 warn（本次运行内仍生效），不向 RPC 抛。
      await deps.state.setToggles(sessionId, "tools", writes, record !== undefined ? metaOf(record) : {});
    }
    if (record !== undefined) await scheduleRefresh(record);
    return { ok: true, applied };
  }

  /**
   * `tools.setGlobalEnabled` 主体：设置**全局默认**（能力面板开关）。
   *
   * - 写 `tools-global.json`（`{version:1, disabled:string[]}`）：`enabled=false`
   *   加入 disabled、`true` 移出；幂等（无变化 `applied:0` 且不写盘）；
   * - 只接受当前枚举出的单元 id（客户端无法注入任意名字），兼容裸 unit 与
   *   `plugin:<unit>` 两种写法；
   * - **只写配置**（v21.2）：写成功后只刷新本管理器的内存镜像（供列表投影与
   *   **新建会话**初始化使用），**不再扇出到 live agent**——默认变更只影响新会话，
   *   已存在 session 的 restrict 不受影响；会话级开关仍走 {@link setSessionEnabled}
   *   即时生效。
   */
  async function setGlobalEnabled(input: unknown): Promise<ToolsSetGlobalResult> {
    if (disposed) return { ok: false, errors: ["tools manager disposed"] };
    const payload =
      input !== null && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
    if (!Array.isArray(payload.units)) return { ok: false, errors: ["units must be an array"] };
    if (typeof payload.enabled !== "boolean") return { ok: false, errors: ["enabled must be a boolean"] };
    const store = deps.global;
    if (store === undefined && deps.writeGlobalDefaults === undefined) {
      return { ok: false, errors: ["tools global store unavailable"] };
    }
    await hydrateGlobal();
    const enumeration = enumerateGlobalTools(globalTools, deps.resolver?.resolveTool ?? ((name) => tableToolAttribution(name) ?? { matchedBy: "unknown", confidence: "low" }));
    if (enumeration.errors.length > 0) return { ok: false, errors: [...enumeration.errors] };
    const known = new Set(enumeration.units.map((unit) => unit.unit));
    const hostUnits = new Set(enumeration.units.filter((unit) => unit.hostInjected).map((unit) => unit.unit));
    const requested: string[] = [];
    const seen = new Set<string>();
    let hostRequested = false;
    for (const raw of payload.units) {
      if (typeof raw !== "string") continue;
      const unit = unitOfKey(raw) ?? raw.trim();
      if (unit.length === 0 || seen.has(unit) || !known.has(unit)) continue;
      seen.add(unit);
      if (hostUnits.has(unit)) {
        hostRequested = true;
        continue;
      }
      requested.push(unit);
    }
    if (requested.length === 0) {
      return hostRequested ? { ok: false, errors: [HOST_INJECTED_REASON] } : { ok: true, applied: 0 };
    }
    // v21：全局兜底写入 `capability-global-overrides.json` 的 `tools`（旧
    // tools-global.json 只读兼容）；旧装配回退旧 store。
    const result =
      deps.writeGlobalDefaults !== undefined
        ? await deps.writeGlobalDefaults(requested, payload.enabled)
        : await (store as ToolsGlobalStore).setEnabled(requested, payload.enabled);
    // 无论写盘成败都刷新内存镜像：store 在内存里已生效（本次运行内保持一致）。
    // v21.2：**不扇出到 live agent**——默认变更只影响新建会话（agent/created 时
    // 由 frozenDefaultsOf 取当时的配置），已存在的 session 保持创建时的快照。
    await refreshGlobal();
    return result.ok ? { ok: true, applied: result.applied } : result;
  }

  /**
   * v21.2：可见性 / 每工作区默认写入后的**内存镜像刷新**（不传播到 live 会话）。
   *
   * 只重读全局兜底（旧 ∪ 新名单），供列表投影与**新建会话**的初始化使用；
   * 按用户要求，默认 / 可见性变更**只影响新会话**，这里**不再**扇出到 live
   * agent 重算 restrict（已存在 session 保持自己的冻结快照；会话级开关另行即时
   * 生效）。组合根当前不再调用本方法，保留为显式/诊断入口。
   */
  async function refreshFromVisibility(): Promise<void> {
    if (disposed) return;
    globalHydrated = false;
    try {
      await hydrateGlobal();
    } catch (error) {
      logger?.warn?.(`capability-panel: 刷新 Tools 默认失败，按全部启用继续：${errMessage(error)}`);
    }
  }

  /** 本会话的显式开关快照（诊断；键带 `plugin:` 前缀）。 */
  function sessionToggleState(sessionId?: string): Record<string, boolean> {
    if (sessionId === undefined) return {};
    return Object.fromEntries(sessionToggles.get(sessionId) ?? []);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const off of listeners) {
      try {
        off();
      } catch {
        /* 监听移除失败不阻断卸载 */
      }
    }
    listeners.length = 0;
    // best-effort 解除已应用的 restrict：agent 可能仍存活，插件卸载 / 热重载不会
    // 自动回收 agent 作用域上的 restrict（否则会留下「插件已卸载、工具仍被隐藏」）。
    for (const record of sessions.values()) {
      releaseRestrictions(record);
    }
    sessions.clear();
    sessionToggles.clear();
    hydratedSessions.clear();
  }

  return {
    list,
    inspect,
    setSessionEnabled,
    setGlobalEnabled,
    sessionToggleState,
    refreshFromVisibility,
    dispose,
  };
}

export type { ToolsRestrictionState };
