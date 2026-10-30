/**
 * 宿主技能注册表桥（registry bridge）。
 *
 * 面板的磁盘视图（`skills/manager.ts`）只覆盖本插件受管的 6 个根目录；
 * 宿主 `ctx.get("skills")`（`@deepseek-ai/dsh-skill` 的 `SkillRegistry`）里还有
 * 三类「注入条目」，模型实际能看到、面板却看不见：
 *
 *   - **DSH 随包 / 部署级 provider**（如 `dsh-skill-office`、`dsh-to-figma`）；
 *   - **插件运行时注册**（`ctx.skills.register(...)`，provider 缺省 `runtime`）；
 *   - **preset 层 provider**（preset 组合里挂的 `dsh-skill-filesystem`，只有带
 *     `scope: agent` 的读才看得见）。
 *
 * 本模块负责把这些条目 **additive 合并**进面板视图，并给出展示用的来源分类
 * （`origin` / `channel` / `provider`），同时承担三个派生能力：
 *
 *   1. 详情 fallback：磁盘读不到时用 `ctx.skills.get(name, {cwd, scope})` 取正文；
 *   2. 资源读取边界：只允许 `resourceBase.kind === "directory"` 且路径被限制在
 *      该目录内（拒绝 `..`、绝对路径、反斜杠、符号链接、realpath 逃逸）；
 *   3. 导出快照：注入技能导出为单文件正文快照（不打包资源）。
 *
 * 硬约束（`AGENTS.md`「MCP 关键模型」第 2 条）：
 *   - **只用 `ctx.get("skills")` 运行时对象**，不 import 插件自带的
 *     `@deepseek-ai/dsh-scope`（其 `kScope` 不是 `Symbol.for`，读不到宿主 scope）；
 *   - scope **直接把 agent 对象原样传进去**（`{ scope: agent }`），不自己构造
 *     scope key。
 *
 * 降级：registry 缺失 / `snapshot` 抛错 / `snapshot.complete === false` 时一律
 * 返回空注入行（面板仍完整显示磁盘技能），并在 `skills/change` 后重建缓存。
 *
 * @module dsh-capability-settings/skills/registry
 */

import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";

import { parseSkill, serializeSkill } from "./disk.js";
import { invocationPolicy } from "./types.js";
import type { RegistryResourceBaseKind, SkillFormat, SkillOrigin, SkillSpec, SkillSummaryView } from "./types.js";
import type { TransferResult } from "./transfer.js";

// ---------------------------------------------------------------------------
// 与 shadow 机制共用的常量（session.ts 从这里 import，避免字符串两处分叉）
// ---------------------------------------------------------------------------

/** shadow skill 的描述（仅出现在注册表内部，用户看不到正文）。 */
export const SHADOW_DESCRIPTION = "本会话已禁用（capability-panel）";

/** shadow 注册附带的 metadata 标记键（便于 `ctx.skills.get` 侧二次确认）。 */
export const SHADOW_METADATA_KEY = "capability-panel/shadow";

/** 判断一个 registry 摘要条目是否是**本插件自己**注册的 shadow。 */
export function isOwnShadow(entry: { provider?: string; description?: string } | undefined): boolean {
  return entry?.provider === "runtime" && entry?.description === SHADOW_DESCRIPTION;
}

// ---------------------------------------------------------------------------
// 宿主服务的最小结构类型（本地声明：仓库 devDep 的 dsh-skill 版本低于宿主，
// 见架构契约 §13-R1；只依赖运行时形状，不 import 宿主包）
// ---------------------------------------------------------------------------

/** registry 摘要条目（`SkillSummary` 的结构子集）。 */
export interface HostSkillSummary {
  readonly name: string;
  readonly description: string;
  readonly whenToUse?: string;
  readonly invocation?: { readonly modelInvocable: boolean; readonly userInvocable: boolean };
  readonly source?: string;
  readonly provider?: string;
  readonly path?: string;
  readonly resourceBase?:
    | { readonly kind: "directory"; readonly path: string }
    | { readonly kind: "url"; readonly url: string }
    | { readonly kind: "opaque"; readonly description: string };
}

/** 完整定义（`SkillDefinition` 的结构子集：带正文）。 */
export interface HostSkillDefinition extends HostSkillSummary {
  readonly content: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** 目录快照（`SkillCatalogSnapshot` 的结构子集）。 */
export interface HostSkillCatalogSnapshot {
  readonly skills: HostSkillSummary[];
  readonly complete?: boolean;
}

/** 读选项：`scope` 只接受 agent 对象原样传入（C2）。 */
export interface HostSkillViewOptions {
  cwd?: string;
  scope?: unknown;
}

/** 本模块用到的宿主 skills 服务子集。 */
export interface HostSkillsService {
  list?(options?: HostSkillViewOptions): Promise<HostSkillSummary[]>;
  snapshot?(options?: HostSkillViewOptions): Promise<HostSkillCatalogSnapshot>;
  get?(name: string, options?: HostSkillViewOptions): Promise<HostSkillDefinition | undefined>;
}

// ---------------------------------------------------------------------------
// 分类结果与合并入参
// ---------------------------------------------------------------------------

/** 分类后的注入行（合并与详情 fallback 共用）。 */
export interface ClassifiedInjectedRow {
  name: string;
  description: string;
  whenToUse?: string;
  invocation: { modelInvocable: boolean; userInvocable: boolean };
  origin: SkillOrigin;
  channel: string;
  provider: string;
  registrySource: string;
  resourceBaseKind?: RegistryResourceBaseKind;
  path?: string;
}

/** 合并入参（磁盘行用于同名去重，projectDisabled 用于 disabledInProject）。 */
export interface InjectedMergeInput {
  cwd?: string;
  sessionId?: string;
  /** 磁盘视图行（manager.list 结果）；同名时磁盘优先。 */
  diskRows: SkillSummaryView[];
  /** 项目默认禁用名单（overrides.skills）。 */
  projectDisabled: ReadonlySet<string>;
}

/** 详情 fallback 的结果（与 crud.ReadResult 兼容的超集）。 */
export interface RegistryReadResult {
  ok: true;
  spec: SkillSpec;
  body: string;
  format: SkillFormat;
  resources: string[];
  fromRegistry?: true;
  resourceBaseNote?: string;
  path?: string;
}

/** 资源读取错误码（架构契约 §7.3）。 */
export type SkillResourceErrorCode =
  | "not-found"
  | "escape"
  | "not-text"
  | "too-large"
  | "unsupported-base"
  | "registry-unavailable"
  | "requires-session"
  | "read-only";

/** `skills.readResource` 的结果。 */
export type SkillResourceResult =
  | { ok: true; path: string; size: number; content: string; truncated: boolean }
  | { ok: false; errors: string[]; code?: SkillResourceErrorCode };

/** 名字在当前 registry 视图里的性质（写拦截用）。 */
export interface RegistryNameVerdict {
  kind: "injected" | "disk-root" | "shadow";
  row?: ClassifiedInjectedRow;
}

/** 注册表桥的构造依赖。 */
export interface SkillRegistryBridgeDeps {
  /** 插件 ctx（只读；用 `ctx.get("skills")` 取宿主服务）。 */
  ctx: any;
  logger?: { warn?: (message: string) => void };
  /** 取某 session 的 live agent（scope 传参 + preset 归属解析用）。 */
  agentOf?: (sessionId: string) => any | undefined;
  /** 某个名字是否正被本插件的会话 shadow 遮蔽（清缓存时保留展示元数据）。 */
  isShadowed?: (sessionId: string, name: string) => boolean;
  /** 宿主服务访问器覆盖（测试/诊断用；缺省 `ctx.get("skills")`）。 */
  skillsService?: () => HostSkillsService | undefined;
}

/** 合并 / 详情 / 资源 / 导出 的公共入口。 */
export interface SkillRegistryBridge {
  /** 合并注入行（只返回注入行；磁盘行由调用方拼在其前面）。 */
  merge(input: InjectedMergeInput): Promise<SkillSummaryView[]>;
  /** 当前 scope 视图里属于注入条目的名字集合（项目默认只作用于这些名字）。 */
  injectedNames(agent: unknown, sessionId: string | undefined, cwd?: string): Promise<Set<string> | undefined>;
  /** 名字在当前视图里的性质（写拦截用；registry 不可用返回 undefined）。 */
  inspectName(name: string, options: { cwd?: string; sessionId?: string }): Promise<RegistryNameVerdict | undefined>;
  /** 详情 fallback（磁盘读不到时调用）。 */
  readDetail(input: { name: string; cwd?: string; sessionId?: string }): Promise<RegistryReadResult | undefined>;
  /** 完整定义（资源读取 / 导出用；registry 不可用或名字不存在返回 undefined）。 */
  getDefinition(input: { name: string; cwd?: string; sessionId?: string }): Promise<HostSkillDefinition | undefined>;
  /** 资源读取（路径边界见模块头注释）。 */
  readResource(input: { name: string; path: string; cwd?: string; sessionId?: string }): Promise<SkillResourceResult>;
  /** 注入行导出：单文件正文快照（`lossy: true`）。 */
  exportSnapshot(input: { name: string; cwd?: string; sessionId?: string }): Promise<TransferResult | undefined>;
  /** read-before-shadow：读一次 scope 快照并缓存注入元数据，返回该名字的分类。 */
  prepareShadow(agent: unknown, sessionId: string | undefined, cwd: string | undefined, name: string): Promise<ClassifiedInjectedRow | undefined>;
  /** read-after-shadow：确认该名字当前胜者就是本插件的 shadow；无法判定返回 undefined。 */
  verifyShadow(agent: unknown, sessionId: string | undefined, cwd: string | undefined, name: string): Promise<boolean | undefined>;
  /**
   * 批量 read-before-shadow（性能关键，见 `jev.apply` 的批量写入）。
   *
   * 一次全量目录发现即可拿到整批名字的注入元数据，以及「注册表里已被本插件
   * shadow 遮蔽、但本地没有 disposer」的 ghost 名字集合。逐条 `prepareShadow`
   * 会让每次 toggle 都重新做 2 次全量发现（`skills.register` 会让宿主
   * `collectCache` 整体失效），N 条 = O(N²) 磁盘扫描。
   *
   * registry 不可用 / snapshot 失败返回 undefined（调用方降级：不缓存元数据、
   * 不判 ghost）。
   */
  prepareShadows(
    agent: unknown,
    sessionId: string | undefined,
    cwd: string | undefined,
    names: ReadonlySet<string>,
  ): Promise<{ rows: Map<string, ClassifiedInjectedRow>; ownShadow: Set<string> } | undefined>;
  /**
   * 批量 read-after-shadow：一次 scope 快照校验整批名字的胜者是否本插件 shadow。
   *
   * 返回名字 → 是否仍是本插件 shadow；无法判定（registry 不可用 / agent 缺失 /
   * snapshot 失败）返回 undefined。名字不在快照里按 `false`（胜者不是 shadow）。
   */
  verifyShadows(agent: unknown, cwd: string | undefined, names: ReadonlySet<string>): Promise<Map<string, boolean> | undefined>;
  /** 把「正被本插件 shadow 遮蔽」的元数据写回缓存（register 触发的 skills/change 会清掉它）。 */
  keepShadowed(agent: unknown, sessionId: string | undefined, row: ClassifiedInjectedRow): void;
  /** 该名字是否已知为注入条目（用于项目默认的热更新判定）。 */
  knowsInjected(sessionId: string, name: string): boolean;
  /** 清空某个 session 的缓存（agent 销毁 / 插件卸载）。 */
  invalidateSession(sessionId: string): void;
  /** 卸载：移除监听并清空缓存。 */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// 分类表（单一事实源：只有这里把 registry 字段映射成 origin/channel）
// ---------------------------------------------------------------------------

/** 已知「插件自定义 source」→ 展示渠道名（§4.3 扩展点）。 */
const KNOWN_PLUGIN_SOURCES: ReadonlyMap<string, string> = new Map([["dsh-remote", "dsh-remote"]]);

/**
 * 已知「runtime 注册（provider=runtime, source=runtime）」注入插件的技能名前缀
 * → 展示渠道名（Lead 任务 task-12）。
 *
 * registry 的 `SkillSummary` 不暴露 registration 归属（架构契约 §2.4 / §13-R2），
 * 只能按**技能名前缀**识别注入方。匹配规则：名字精确等于前缀，或以 `前缀-`
 * 开头（带 `-` 边界，避免 `dsh-diff-approvalx` 这类误伤）；未命中仍回退
 * {@link RUNTIME_CHANNEL}。扩展新插件时在此追加（值 = 展示用渠道名）。
 */
const KNOWN_RUNTIME_NAME_PREFIXES: ReadonlyArray<{ prefix: string; channel: string }> = [
  { prefix: "dsh-diff-approval", channel: "dsh-diff-approval" },
];

/** 无法识别注入方时的统一渠道名（Lead 裁定 R2）。 */
const RUNTIME_CHANNEL = "插件运行时注入";

/**
 * 按已知运行时技能名前缀解析注入方渠道名（精确前缀 + `-` 边界）。
 *
 * @param name 技能名
 * @returns 命中时返回展示渠道名；未命中返回 undefined（调用方回退统一文案）
 */
function runtimeChannelOf(name: string): string | undefined {
  for (const entry of KNOWN_RUNTIME_NAME_PREFIXES) {
    if (name === entry.prefix || name.startsWith(`${entry.prefix}-`)) return entry.channel;
  }
  return undefined;
}

/** preset 名解析失败时的渠道名。 */
const UNKNOWN_PRESET_CHANNEL = "预设（未知）";

/** 元数据缓存上限（LRU）。 */
const META_CACHE_LIMIT = 256;

/** 单文件资源读取上限（256 KiB，架构契约 §8.3）。 */
const RESOURCE_MAX_BYTES = 256 * 1024;

/** 资源目录一层条目上限（超出截断）。 */
const RESOURCE_LIST_LIMIT = 200;

/** scope 缓存键（"global" 或 `session:<id>`）。 */
function scopeKeyOf(sessionId: string | undefined): string {
  return sessionId === undefined ? "global" : `session:${sessionId}`;
}

/** 从 ctx 取宿主 skills 服务（任何异常都降级为 undefined）。 */
function defaultSkillsService(ctx: any): HostSkillsService | undefined {
  try {
    const service = ctx?.get?.("skills");
    return service === undefined ? undefined : (service as HostSkillsService);
  } catch {
    return undefined;
  }
}

/** registry 条目 → `Map<name, entry>`（同名理论上不会出现，防御性保留先到者）。 */
function byName(entries: readonly HostSkillSummary[]): Map<string, HostSkillSummary> {
  const map = new Map<string, HostSkillSummary>();
  for (const entry of entries) {
    if (typeof entry?.name !== "string" || entry.name.length === 0) continue;
    if (!map.has(entry.name)) map.set(entry.name, entry);
  }
  return map;
}

/** 校验一条 registry 摘要是否可用（字段漂移时丢弃单条，不整批失败）。 */
function isUsableSummary(entry: HostSkillSummary | undefined): entry is HostSkillSummary {
  return (
    typeof entry?.name === "string" &&
    entry.name.length > 0 &&
    typeof entry?.description === "string" &&
    entry.description.length > 0
  );
}

/** 读一次快照；异常 / 形状漂移都返回 undefined（由调用方降级）。 */
async function safeSnapshot(skills: HostSkillsService, options: HostSkillViewOptions): Promise<HostSkillCatalogSnapshot | undefined> {
  if (typeof skills.snapshot !== "function") return undefined;
  try {
    const snapshot = await skills.snapshot(options);
    if (snapshot === undefined || snapshot === null || !Array.isArray(snapshot.skills)) return undefined;
    return snapshot;
  } catch {
    return undefined;
  }
}

/** 资源基准类别的安全取值。 */
function resourceBaseKindOf(entry: HostSkillSummary): RegistryResourceBaseKind | undefined {
  const base = entry.resourceBase;
  if (base === undefined || base === null) return undefined;
  if (base.kind === "directory" || base.kind === "url" || base.kind === "opaque") return base.kind;
  return undefined;
}

/**
 * 资源基准的展示/路径信息。
 *
 * 只有 `kind === "directory"` 才返回可读目录；url / opaque 只给说明文案。
 */
function resourceBaseOf(entry: HostSkillDefinition | HostSkillSummary): {
  kind?: RegistryResourceBaseKind;
  directory?: string;
  note?: string;
} {
  const base = entry.resourceBase;
  if (base === undefined || base === null) return {};
  if (base.kind === "directory" && typeof base.path === "string" && base.path.length > 0) {
    return { kind: "directory", directory: base.path };
  }
  if (base.kind === "url") return { kind: "url", note: "资源在远端，本地不可浏览" };
  if (base.kind === "opaque") {
    const description = typeof base.description === "string" ? base.description : "";
    return { kind: "opaque", note: description.length > 0 ? description : "该技能不提供可浏览资源" };
  }
  return {};
}

/** 把 registry 的调用策略反投影成 frontmatter 形态（只用于 UI 展示，不落盘）。 */
function invocationFrontmatter(invocation: HostSkillSummary["invocation"]): SkillSpec["invocation"] {
  const modelInvocable = invocation?.modelInvocable !== false;
  const userInvocable = invocation?.userInvocable !== false;
  return {
    ...(modelInvocable ? {} : { "disable-model-invocation": true }),
    ...(userInvocable ? {} : { "user-invocable": false }),
  };
}

/**
 * 解析 agent 绑定的 preset id（展示用渠道名；失败返回 undefined，行照常保留）。
 *
 * 用宿主 profile 层的 `agentPresets` 服务的**只读**访问器，不读 preset 文件。
 */
function presetIdOf(ctx: any, agent: unknown): string | undefined {
  try {
    const presets = ctx?.get?.("agentPresets");
    const scopedCtx = (agent as { ctx?: unknown } | undefined)?.ctx;
    const composed = presets?.composedPreset?.(scopedCtx);
    if (typeof composed === "string" && composed.length > 0) return composed;
    const first = presets?.inspectCompositions?.(scopedCtx)?.[0];
    if (typeof first?.id === "string" && first.id.length > 0) return first.id;
    return undefined;
  } catch {
    return undefined;
  }
}

/** 构造注册表桥。 */
export function createSkillRegistryBridge(deps: SkillRegistryBridgeDeps): SkillRegistryBridge {
  /** 上一次成功的注入行（按 scope）。 */
  const lastGood = new Map<string, SkillSummaryView[]>();
  /** 注入元数据缓存（key = `${scopeKey}::${name}`；仅 agent scope 使用）。 */
  const metaCache = new Map<string, ClassifiedInjectedRow>();
  /** preset id 缓存（sessionId → presetId；`undefined` 也缓存，避免重复解析失败）。 */
  const presetCache = new Map<string, string | undefined>();
  /** 已警告过的降级原因（避免每次 list 刷日志）。 */
  const warned = new Set<string>();
  /** 生命周期监听 disposer。 */
  const listeners: Array<() => void> = [];
  let disposed = false;

  /** 取宿主 skills 服务（deps 覆盖优先）。 */
  function service(): HostSkillsService | undefined {
    if (deps.skillsService !== undefined) return deps.skillsService();
    return defaultSkillsService(deps.ctx);
  }

  /** 只 warn 一次（同一 key）。 */
  function warnOnce(key: string, message: string): void {
    if (warned.has(key)) return;
    warned.add(key);
    deps.logger?.warn?.(message);
  }

  /** 取 session 对应的 live agent（没有就是冷会话）。 */
  function agentFor(sessionId: string | undefined): any | undefined {
    if (sessionId === undefined) return undefined;
    try {
      return deps.agentOf?.(sessionId);
    } catch {
      return undefined;
    }
  }

  /** 缓存一条元数据（LRU：超出上限淘汰最旧插入项）。 */
  function cacheMeta(scope: string, row: ClassifiedInjectedRow): void {
    const key = `${scope}::${row.name}`;
    metaCache.delete(key);
    metaCache.set(key, row);
    while (metaCache.size > META_CACHE_LIMIT) {
      const oldest = metaCache.keys().next().value;
      if (oldest === undefined) break;
      metaCache.delete(oldest);
    }
  }

  /** 某个 scope 已缓存的元数据（保持插入顺序）。 */
  function cachedMetas(scope: string): ClassifiedInjectedRow[] {
    const prefix = `${scope}::`;
    const rows: ClassifiedInjectedRow[] = [];
    for (const [key, row] of metaCache) {
      if (key.startsWith(prefix)) rows.push(row);
    }
    return rows;
  }

  /** 清空某个 scope 的全部缓存。 */
  function clearScope(scope: string): void {
    lastGood.delete(scope);
    const prefix = `${scope}::`;
    for (const key of [...metaCache.keys()]) {
      if (key.startsWith(prefix)) metaCache.delete(key);
    }
  }

  /**
   * `skills/change`：清 last-good；元数据缓存只保留「当前正被本插件 shadow
   * 遮蔽」的条目——否则 register shadow 触发的 change 会把「被遮蔽条目仍需
   * 展示为关闭态」（AC-5）所需的元数据一并清掉。
   */
  function onSkillsChange(): void {
    lastGood.clear();
    presetCache.clear();
    for (const key of [...metaCache.keys()]) {
      const separator = key.indexOf("::");
      if (separator < 0) {
        metaCache.delete(key);
        continue;
      }
      const scope = key.slice(0, separator);
      const name = key.slice(separator + 2);
      if (!scope.startsWith("session:")) {
        metaCache.delete(key);
        continue;
      }
      const sessionId = scope.slice("session:".length);
      let shadowed = false;
      try {
        shadowed = deps.isShadowed?.(sessionId, name) === true;
      } catch {
        shadowed = false;
      }
      if (!shadowed) metaCache.delete(key);
    }
  }

  // —— 生命周期监听（与 index.ts 的 disposer 风格一致） ——
  try {
    if (typeof deps.ctx?.on === "function") {
      const offChange = deps.ctx.on("skills/change", () => onSkillsChange());
      if (typeof offChange === "function") listeners.push(offChange);
      const offDisposed = deps.ctx.on("agent/disposed", ({ agent }: any) => {
        if (typeof agent?.id === "string") {
          clearScope(`session:${agent.id}`);
          presetCache.delete(agent.id);
        }
      });
      if (typeof offDisposed === "function") listeners.push(offDisposed);
    }
  } catch {
    // 监听注册失败只影响缓存新鲜度，不影响读取：静默降级。
  }

  /** 解析 preset 名（按 session 缓存）。 */
  function presetIdFor(sessionId: string | undefined, agent: unknown): string | undefined {
    if (sessionId === undefined) return undefined;
    if (presetCache.has(sessionId)) return presetCache.get(sessionId);
    const id = presetIdOf(deps.ctx, agent);
    presetCache.set(sessionId, id);
    return id;
  }

  /**
   * 分类一条 registry 条目（映射表见架构契约 §4.1；Lead 裁定 R3：不引入
   * `origin: "disk"`——宿主 filesystem provider 的磁盘条目不是注入行，
   * 返回 undefined 表示「不合并」）。
   */
  function classify(
    entry: HostSkillSummary,
    globalByName: ReadonlyMap<string, HostSkillSummary>,
    context: { agent: unknown; sessionId: string | undefined },
  ): ClassifiedInjectedRow | undefined {
    const provider = typeof entry.provider === "string" ? entry.provider : "";
    const source = typeof entry.source === "string" ? entry.source : "";
    if (provider.length === 0) return undefined;

    /** 该名字在无 scope 读里的胜者身份是否与当前条目不同（= 近层条目）。 */
    const globalWinner = globalByName.get(entry.name);
    const fromPresetLayer =
      globalWinner === undefined || globalWinner.provider !== provider || globalWinner.source !== source;

    let origin: SkillOrigin;
    let channel: string;
    if (provider === "dsh-office") {
      origin = "bundled";
      channel = "DSH 内置（Office）";
    } else if (provider === "dsh-figma") {
      origin = "plugin";
      channel = "dsh-to-figma";
    } else if (provider === "runtime" && source === "dsh-remote") {
      origin = "plugin";
      channel = "dsh-remote";
    } else if (provider === "runtime" && KNOWN_PLUGIN_SOURCES.has(source)) {
      origin = "plugin";
      channel = KNOWN_PLUGIN_SOURCES.get(source) ?? RUNTIME_CHANNEL;
    } else if (provider === "runtime") {
      // registry 不暴露注入 fiber：先按已知技能名前缀识别注入插件（task-12），
      // 未命中再回退统一渠道名（Lead 裁定 R2）。
      origin = "plugin";
      channel = runtimeChannelOf(entry.name) ?? RUNTIME_CHANNEL;
    } else if (provider === "filesystem") {
      if (source === "custom" && fromPresetLayer) {
        origin = "preset";
        channel = presetIdFor(context.sessionId, context.agent) ?? UNKNOWN_PRESET_CHANNEL;
      } else if (source === "bundled") {
        origin = "bundled";
        channel = "DSH 内置（随包技能目录）";
      } else {
        // project-* / user-* / 全局 custom：宿主磁盘根条目，不是注入行；
        // 面板磁盘视图是权威来源（R3：不引入 origin:"disk"）。
        return undefined;
      }
    } else {
      // 未知插件 provider：兜底成 plugin，渠道名直接用 provider 原值。
      origin = "plugin";
      channel = provider;
    }

    const row: ClassifiedInjectedRow = {
      name: entry.name,
      description: entry.description,
      invocation: {
        modelInvocable: entry.invocation?.modelInvocable !== false,
        userInvocable: entry.invocation?.userInvocable !== false,
      },
      origin,
      channel,
      provider,
      registrySource: source,
    };
    if (typeof entry.whenToUse === "string" && entry.whenToUse.length > 0) row.whenToUse = entry.whenToUse;
    const baseKind = resourceBaseKindOf(entry);
    if (baseKind !== undefined) row.resourceBaseKind = baseKind;
    if (typeof entry.path === "string" && entry.path.length > 0) row.path = entry.path;
    return row;
  }

  /** 分类行 → 面板摘要行（注入行的 source 恒为 "external"，不带 root）。 */
  function toSummaryView(row: ClassifiedInjectedRow, disabledInProject: boolean): SkillSummaryView {
    return {
      name: row.name,
      description: row.description,
      ...(row.whenToUse !== undefined ? { whenToUse: row.whenToUse } : {}),
      invocation: row.invocation,
      source: "external",
      format: "directory",
      readOnly: true,
      ...(row.path !== undefined ? { path: row.path } : {}),
      injected: true,
      origin: row.origin,
      channel: row.channel,
      provider: row.provider,
      registrySource: row.registrySource,
      ...(row.resourceBaseKind !== undefined ? { resourceBaseKind: row.resourceBaseKind } : {}),
      contentReadOnly: true,
      disabledInProject,
    };
  }

  /** 合并注入行（只返回注入行；同名磁盘行优先）。 */
  async function merge(input: InjectedMergeInput): Promise<SkillSummaryView[]> {
    if (disposed) return [];
    const skills = service();
    if (skills === undefined || typeof skills.snapshot !== "function") {
      warnOnce("registry-unavailable", "capability-panel: 宿主技能注册表不可用，仅显示磁盘技能");
      return [];
    }
    const scope = scopeKeyOf(input.sessionId);
    const agent = agentFor(input.sessionId);
    const globalSnapshot = await safeSnapshot(skills, { cwd: input.cwd });
    if (globalSnapshot === undefined) return lastGood.get(scope) ?? [];
    const viewSnapshot =
      agent !== undefined ? await safeSnapshot(skills, { cwd: input.cwd, scope: agent }) : globalSnapshot;
    if (viewSnapshot === undefined) return lastGood.get(scope) ?? [];
    // 不完整快照不更新 last-good（types `SkillCatalogSnapshot.complete`）。
    if (viewSnapshot.complete === false) return lastGood.get(scope) ?? [];

    const globalByName = byName(globalSnapshot.skills);
    const diskNames = new Set(input.diskRows.map((row) => row.name));
    const winners = new Map<string, HostSkillSummary>();
    const rows: SkillSummaryView[] = [];
    for (const entry of viewSnapshot.skills) {
      if (!isUsableSummary(entry)) {
        warnOnce("invalid-entry", "capability-panel: 宿主技能注册表返回了字段异常的条目，已跳过");
        continue;
      }
      winners.set(entry.name, entry);
      if (isOwnShadow(entry)) continue;
      if (diskNames.has(entry.name)) continue;
      const row = classify(entry, globalByName, { agent, sessionId: input.sessionId });
      if (row === undefined) continue;
      if (agent !== undefined) cacheMeta(scope, row);
      rows.push(toSummaryView(row, input.projectDisabled.has(row.name)));
    }

    // 被本插件 shadow 遮蔽的注入条目：用缓存元数据补行（会话关闭后仍要
    // 「看得见、能再打开」，见架构契约 §5.5 / AC-5）。
    if (agent !== undefined) {
      const seen = new Set(rows.map((row) => row.name));
      for (const row of cachedMetas(scope)) {
        if (seen.has(row.name) || diskNames.has(row.name)) continue;
        const winner = winners.get(row.name);
        if (winner !== undefined && isOwnShadow(winner)) {
          seen.add(row.name);
          rows.push(toSummaryView(row, input.projectDisabled.has(row.name)));
        }
      }
    }

    rows.sort((a, b) => a.name.localeCompare(b.name));
    lastGood.set(scope, rows);
    return rows;
  }

  /** 当前 scope 下的注入名字集合（项目默认只作用于这些名字）。 */
  async function injectedNames(agent: unknown, sessionId: string | undefined, cwd?: string): Promise<Set<string> | undefined> {
    const skills = service();
    if (skills === undefined || typeof skills.snapshot !== "function") return undefined;
    const globalSnapshot = await safeSnapshot(skills, { cwd });
    if (globalSnapshot === undefined) return undefined;
    // live 会话（有 agent）才带 scope；冷会话退化为无 scope 读。
    const viewSnapshot =
      sessionId !== undefined && agent !== undefined
        ? await safeSnapshot(skills, { cwd, scope: agent })
        : globalSnapshot;
    if (viewSnapshot === undefined) return undefined;
    const globalByName = byName(globalSnapshot.skills);
    const scope = scopeKeyOf(sessionId !== undefined && agent !== undefined ? sessionId : undefined);
    const names = new Set<string>();
    for (const entry of viewSnapshot.skills) {
      if (!isUsableSummary(entry) || isOwnShadow(entry)) continue;
      const row = classify(entry, globalByName, { agent, sessionId: sessionId !== undefined && agent !== undefined ? sessionId : undefined });
      if (row === undefined) continue;
      if (sessionId !== undefined && agent !== undefined) cacheMeta(scope, row);
      names.add(row.name);
    }
    return names;
  }

  /** 名字在当前视图里的性质（写拦截用）。 */
  async function inspectName(
    name: string,
    options: { cwd?: string; sessionId?: string },
  ): Promise<RegistryNameVerdict | undefined> {
    const skills = service();
    if (skills === undefined || typeof skills.snapshot !== "function") return undefined;
    const agent = agentFor(options.sessionId);
    const globalSnapshot = await safeSnapshot(skills, { cwd: options.cwd });
    if (globalSnapshot === undefined) return undefined;
    const viewSnapshot =
      agent !== undefined ? await safeSnapshot(skills, { cwd: options.cwd, scope: agent }) : globalSnapshot;
    if (viewSnapshot === undefined) return undefined;

    const classifyWinner = (entry: HostSkillSummary, withAgent: unknown): RegistryNameVerdict => {
      if (isOwnShadow(entry)) return { kind: "shadow" };
      const row = classify(entry, byName(globalSnapshot.skills), { agent: withAgent, sessionId: options.sessionId });
      return row === undefined ? { kind: "disk-root" } : { kind: "injected", row };
    };

    const winner = viewSnapshot.skills.find((entry) => entry?.name === name);
    if (winner !== undefined) return classifyWinner(winner, agent);
    // 当前 scope 看不到（例如 preset 层条目在冷会话）：再查 global 层，
    // 避免把「模型实际可见的注入技能」当成磁盘技能放行写操作。
    const globalWinner = globalSnapshot.skills.find((entry) => entry?.name === name);
    if (globalWinner === undefined) return undefined;
    return classifyWinner(globalWinner, undefined);
  }

  /** 一次 `skills.get`（异常降级 undefined）。 */
  async function safeGet(
    skills: HostSkillsService,
    name: string,
    options: HostSkillViewOptions,
  ): Promise<HostSkillDefinition | undefined> {
    if (typeof skills.get !== "function") return undefined;
    try {
      return await skills.get(name, options);
    } catch {
      return undefined;
    }
  }

  /** 判断一个 definition 是否是本插件的 shadow 占位（description 或 metadata 标记）。 */
  function isOwnShadowDefinition(definition: HostSkillDefinition | undefined): boolean {
    if (definition === undefined) return false;
    if (isOwnShadow(definition)) return true;
    const metadata = definition.metadata as Record<string, unknown> | undefined;
    return metadata !== undefined && metadata[SHADOW_METADATA_KEY] === true;
  }

  /**
   * 从 shadow 前缓存的磁盘路径重建 definition（preset 层条目在无 scope 读里
   * 不可见，只能靠 read-before-shadow 缓存的 path 取真实正文）。
   */
  async function definitionFromSkillPath(path: string, fallbackName: string): Promise<HostSkillDefinition | undefined> {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      return undefined;
    }
    const parsed = parseSkill(raw);
    if (parsed === undefined) return undefined;
    const directory = basename(path) === "SKILL.md" ? dirname(path) : undefined;
    return {
      name: parsed.spec.name.length > 0 ? parsed.spec.name : fallbackName,
      description: parsed.spec.description,
      ...(parsed.spec.whenToUse !== undefined && parsed.spec.whenToUse.length > 0
        ? { whenToUse: parsed.spec.whenToUse }
        : {}),
      invocation: invocationPolicy(parsed.spec.invocation),
      // 来源字段只用于组装正文/资源，不参与展示分类。
      provider: "runtime",
      source: "runtime",
      content: parsed.body,
      ...(directory !== undefined ? { resourceBase: { kind: "directory" as const, path: directory } } : {}),
      ...(parsed.spec.metadata !== undefined ? { metadata: parsed.spec.metadata } : {}),
    };
  }

  /** 取某个 session 在 shadow 前缓存的注入元数据（含 path）。 */
  function cachedMetaFor(
    sessionId: string | undefined,
    agent: unknown,
    name: string,
  ): ClassifiedInjectedRow | undefined {
    const scope = scopeKeyOf(sessionId !== undefined && agent !== undefined ? sessionId : undefined);
    return metaCache.get(`${scope}::${name}`);
  }

  /**
   * 取完整定义（`ctx.skills.get`）。
   *
   * **shadow 感知**：有 live agent 时宿主按「近层赢」合并，我方 agent 层 shadow
   * 会成为 get 的胜者（空正文/占位 description/无 resourceBase）——此时回退：
   * 1. 无 scope 再读一次 global 真实条目（office/figma/remote 等）；
   * 2. 仍取不到（preset 层）用 read-before-shadow 缓存的 path 读磁盘正文；
   * 3. 都没有才返回 undefined（调用方按 not-found 处理），绝不把占位条目当真实内容。
   */
  async function getDefinition(input: { name: string; cwd?: string; sessionId?: string }): Promise<HostSkillDefinition | undefined> {
    const skills = service();
    if (skills === undefined) return undefined;
    const agent = agentFor(input.sessionId);
    const scoped = await safeGet(skills, input.name, {
      cwd: input.cwd,
      ...(agent !== undefined ? { scope: agent } : {}),
    });
    if (scoped !== undefined && !isOwnShadowDefinition(scoped)) return scoped;
    if (scoped !== undefined) {
      const globalDefinition = await safeGet(skills, input.name, { cwd: input.cwd });
      if (globalDefinition !== undefined && !isOwnShadowDefinition(globalDefinition)) return globalDefinition;
    }
    const row = cachedMetaFor(input.sessionId, agent, input.name);
    if (row?.path !== undefined) {
      const fromPath = await definitionFromSkillPath(row.path, input.name);
      if (fromPath !== undefined) return fromPath;
    }
    return undefined;
  }

  /**
   * 从 registry 给出的磁盘路径直接读详情（修 §8.5：项目技能详情此前恒 not found）。
   * 路径来自宿主，不是客户端输入。
   */
  async function readDetailFromPath(path: string): Promise<RegistryReadResult | undefined> {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      return undefined;
    }
    const parsed = parseSkill(raw);
    if (parsed === undefined) return undefined;
    const format: SkillFormat = basename(path) === "SKILL.md" ? "directory" : "flat";
    let resources: string[] = [];
    if (format === "directory") {
      try {
        const entries = await readdir(dirname(path), { encoding: "utf8" });
        resources = entries.filter((entry) => entry !== "SKILL.md").slice(0, RESOURCE_LIST_LIMIT);
      } catch {
        resources = [];
      }
    }
    return { ok: true, spec: parsed.spec, body: parsed.body, format, resources, path };
  }

  /** 列出一层资源条目名（排除 SKILL.md 自身；目录不可读返回空）。 */
  async function listResourceNames(directory: string): Promise<string[]> {
    try {
      const entries = await readdir(directory, { withFileTypes: true, encoding: "utf8" });
      return entries
        .filter((entry) => entry.name !== "SKILL.md")
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b))
        .slice(0, RESOURCE_LIST_LIMIT);
    } catch {
      return [];
    }
  }

  /** 详情 fallback：磁盘读不到时走 registry（磁盘同源条目优先按文件读）。 */
  async function readDetail(input: { name: string; cwd?: string; sessionId?: string }): Promise<RegistryReadResult | undefined> {
    const skills = service();
    if (skills === undefined) return undefined;
    // 1) registry 胜者带磁盘路径 → 直接按磁盘读（项目/自定义根的详情修复）。
    const agent = agentFor(input.sessionId);
    const globalSnapshot = await safeSnapshot(skills, { cwd: input.cwd });
    const viewSnapshot =
      globalSnapshot !== undefined && agent !== undefined
        ? await safeSnapshot(skills, { cwd: input.cwd, scope: agent })
        : globalSnapshot;
    const winner = viewSnapshot?.skills.find((entry) => entry?.name === input.name);
    if (winner !== undefined && !isOwnShadow(winner) && typeof winner.path === "string" && winner.path.length > 0) {
      const fromDisk = await readDetailFromPath(winner.path);
      if (fromDisk !== undefined) return fromDisk;
    }
    // 2) registry 注入条目 → ctx.skills.get 取正文。
    const definition = await getDefinition(input);
    if (definition === undefined) return undefined;
    const base = resourceBaseOf(definition);
    const resources = base.directory !== undefined ? await listResourceNames(base.directory) : [];
    return {
      ok: true,
      spec: {
        name: definition.name,
        description: definition.description,
        ...(typeof definition.whenToUse === "string" && definition.whenToUse.length > 0 ? { whenToUse: definition.whenToUse } : {}),
        invocation: invocationFrontmatter(definition.invocation),
      },
      body: definition.content,
      format: "directory",
      resources,
      fromRegistry: true,
      ...(base.note !== undefined ? { resourceBaseNote: base.note } : {}),
    };
  }

  /** 校验客户端传来的资源相对路径；非法返回错误文案（POSIX 相对路径）。 */
  function validateResourcePath(path: unknown): string | undefined {
    if (typeof path !== "string" || path.length === 0) return "资源路径必须是相对路径";
    if (path.includes("\\")) return "资源路径不允许使用反斜杠";
    if (path.startsWith("/") || /^[a-zA-Z]:/.test(path)) return "资源路径不允许是绝对路径";
    const segments = path.split("/");
    if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return "资源路径不允许包含 . 或 .. 段";
    return undefined;
  }

  /** 资源读取（路径边界：目录基准只来自宿主；拒绝符号链接与 realpath 逃逸）。 */
  async function readResource(input: {
    name: string;
    path: string;
    cwd?: string;
    sessionId?: string;
  }): Promise<SkillResourceResult> {
    const definition = await getDefinition(input);
    if (definition === undefined) {
      return { ok: false, errors: [`skill "${input.name}" 不在宿主技能注册表中`], code: "not-found" };
    }
    const base = resourceBaseOf(definition);
    if (base.directory === undefined) {
      return {
        ok: false,
        errors: [base.note ?? "该技能不提供可浏览的资源"],
        code: "unsupported-base",
      };
    }
    const pathError = validateResourcePath(input.path);
    if (pathError !== undefined) return { ok: false, errors: [pathError], code: "escape" };

    const root = resolve(base.directory);
    const target = resolve(root, input.path);
    if (target !== root && !target.startsWith(root + sep)) {
      return { ok: false, errors: ["资源路径不允许"], code: "escape" };
    }
    let linkInfo;
    try {
      linkInfo = await lstat(target);
    } catch {
      return { ok: false, errors: ["资源文件不存在"], code: "not-found" };
    }
    if (linkInfo.isSymbolicLink()) return { ok: false, errors: ["资源路径不允许（符号链接）"], code: "escape" };
    if (!linkInfo.isFile()) return { ok: false, errors: ["资源路径不是文件"], code: "not-found" };

    let realRoot: string;
    let realTarget: string;
    try {
      realRoot = await realpath(root);
      realTarget = await realpath(target);
    } catch {
      return { ok: false, errors: ["资源文件不存在"], code: "not-found" };
    }
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) {
      return { ok: false, errors: ["资源路径不允许"], code: "escape" };
    }

    let info;
    try {
      info = await stat(realTarget);
    } catch {
      return { ok: false, errors: ["资源文件不存在"], code: "not-found" };
    }
    if (!info.isFile()) return { ok: false, errors: ["资源路径不是文件"], code: "not-found" };
    if (info.size > RESOURCE_MAX_BYTES) {
      return {
        ok: false,
        errors: [`资源文件过大（${info.size} 字节 > ${RESOURCE_MAX_BYTES} 字节）`],
        code: "too-large",
      };
    }

    let buffer: Buffer;
    try {
      buffer = await readFile(realTarget);
    } catch {
      return { ok: false, errors: ["资源文件读取失败"], code: "not-found" };
    }
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      return { ok: false, errors: ["该文件不是 UTF-8 文本，无法预览"], code: "not-text" };
    }
    return { ok: true, path: input.path, size: buffer.byteLength, content, truncated: false };
  }

  /** 注入行导出：正文快照（frontmatter + body），不打包资源。 */
  async function exportSnapshot(input: { name: string; cwd?: string; sessionId?: string }): Promise<TransferResult | undefined> {
    const detail = await readDetail(input);
    if (detail === undefined) return undefined;
    const serialized = serializeSkill(detail.spec, detail.body);
    return {
      ok: true,
      name: input.name,
      format: "flat",
      files: [{ path: `${input.name}.md`, content: Buffer.from(serialized, "utf8").toString("base64") }],
      lossy: true,
    };
  }

  /** read-before-shadow：缓存 scope 视图里所有注入元数据，并返回目标名字的分类。 */
  async function prepareShadow(
    agent: unknown,
    sessionId: string | undefined,
    cwd: string | undefined,
    name: string,
  ): Promise<ClassifiedInjectedRow | undefined> {
    const prepared = await prepareShadows(agent, sessionId, cwd, new Set([name]));
    return prepared?.rows.get(name);
  }

  /**
   * 批量 read-before-shadow：**一次**全量目录发现完成整批的元数据缓存 + ghost 判定。
   *
   * 与 {@link prepareShadow} 的语义逐项对齐：缓存 scope 视图里**所有**注入行
   * 的元数据（不只是本批名字，保持 `cachedMetas` 的展示口径不变），返回本批
   * 名字的分类行；`ownShadow` = 快照里胜者已是本插件 shadow 的名字（本地没
   * disposer 的 ghost，恢复/禁用都要据此判真假成功）。
   */
  async function prepareShadows(
    agent: unknown,
    sessionId: string | undefined,
    cwd: string | undefined,
    names: ReadonlySet<string>,
  ): Promise<{ rows: Map<string, ClassifiedInjectedRow>; ownShadow: Set<string> } | undefined> {
    const skills = service();
    if (skills === undefined || typeof skills.snapshot !== "function") return undefined;
    const globalSnapshot = await safeSnapshot(skills, { cwd });
    if (globalSnapshot === undefined) return undefined;
    const viewSnapshot =
      agent !== undefined ? await safeSnapshot(skills, { cwd, scope: agent }) : globalSnapshot;
    if (viewSnapshot === undefined) return undefined;
    const globalByName = byName(globalSnapshot.skills);
    const scope = scopeKeyOf(sessionId !== undefined && agent !== undefined ? sessionId : undefined);
    const rows = new Map<string, ClassifiedInjectedRow>();
    const ownShadow = new Set<string>();
    for (const entry of viewSnapshot.skills) {
      if (!isUsableSummary(entry)) continue;
      if (isOwnShadow(entry)) {
        if (names.has(entry.name)) ownShadow.add(entry.name);
        continue;
      }
      const row = classify(entry, globalByName, { agent, sessionId });
      if (row === undefined) continue;
      if (agent !== undefined) cacheMeta(scope, row);
      if (names.has(row.name) && !rows.has(row.name)) rows.set(row.name, row);
    }
    return { rows, ownShadow };
  }

  /** read-after-shadow：胜者是否已是本插件的 shadow（无法判定返回 undefined）。 */
  async function verifyShadow(
    agent: unknown,
    _sessionId: string | undefined,
    cwd: string | undefined,
    name: string,
  ): Promise<boolean | undefined> {
    const verified = await verifyShadows(agent, cwd, new Set([name]));
    if (verified === undefined) return undefined;
    return verified.get(name) === true;
  }

  /** 批量 read-after-shadow：一次 scope 快照校验整批名字的胜者。 */
  async function verifyShadows(
    agent: unknown,
    cwd: string | undefined,
    names: ReadonlySet<string>,
  ): Promise<Map<string, boolean> | undefined> {
    const skills = service();
    if (skills === undefined || typeof skills.snapshot !== "function" || agent === undefined) return undefined;
    const snapshot = await safeSnapshot(skills, { cwd, scope: agent });
    if (snapshot === undefined) return undefined;
    /** 快照按名字排序；同名取首个（与 `Array.find` 的旧实现一致）。 */
    const winners = new Map<string, HostSkillSummary>();
    for (const entry of snapshot.skills) {
      if (entry === undefined || entry === null || typeof entry.name !== "string") continue;
      if (!winners.has(entry.name)) winners.set(entry.name, entry);
    }
    const result = new Map<string, boolean>();
    for (const name of names) result.set(name, isOwnShadow(winners.get(name)));
    return result;
  }

  /** 把「正被本插件 shadow 遮蔽」的元数据写回缓存。 */
  function keepShadowed(agent: unknown, sessionId: string | undefined, row: ClassifiedInjectedRow): void {
    if (agent === undefined || sessionId === undefined) return;
    cacheMeta(scopeKeyOf(sessionId), row);
  }

  /** 该名字是否已知为注入条目（项目默认热更新判定）。 */
  function knowsInjected(sessionId: string, name: string): boolean {
    return metaCache.has(`${scopeKeyOf(sessionId)}::${name}`);
  }

  /** 清空某个 session 的缓存。 */
  function invalidateSession(sessionId: string): void {
    clearScope(scopeKeyOf(sessionId));
    presetCache.delete(sessionId);
  }

  /** 卸载：移除监听并清空缓存。 */
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const off of listeners) {
      try {
        off();
      } catch {
        /* 卸载阶段忽略监听解绑异常 */
      }
    }
    listeners.length = 0;
    lastGood.clear();
    metaCache.clear();
    presetCache.clear();
    warned.clear();
  }

  return {
    merge,
    injectedNames,
    inspectName,
    readDetail,
    getDefinition,
    readResource,
    exportSnapshot,
    prepareShadow,
    verifyShadow,
    prepareShadows,
    verifyShadows,
    keepShadowed,
    knowsInjected,
    invalidateSession,
    dispose,
  };
}
