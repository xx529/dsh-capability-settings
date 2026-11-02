/**
 * 能力可见性（v21）的**纯计算 + 归一化**（Skills / MCP / Tools 三域共用）。
 *
 * 存储：`<dshHome>/dsh-capability-settings/capability-global-overrides.json`
 * 的 `visibility` 字段（version 2，见 `overrides/global-file.ts`）：
 *
 * ```jsonc
 * {
 *   "visibility": {
 *     "skills": {
 *       "pdf": {
 *         "mode": "all",                       // all | selected | none（缺省 all）
 *         "workspaces": {                      // key = 工作区 path（原样，不归一化）
 *           "/abs/projA": { "visible": true, "defaultEnabled": false },
 *           "/abs/projB": { "visible": false } // visible:false 优先于 mode=all
 *         }
 *       }
 *     },
 *     "mcp":   {},
 *     "tools": {}
 *   }
 * }
 * ```
 *
 * 语义（契约 §1 / §3）：
 *
 *   - **可见性**：能力 × 工作区；`projectRoot === undefined`（全局视图）恒可见。
 *     `mode=all` 全部可见（`visible:false` 单独隐藏某工作区）；`mode=selected`
 *     只有显式列出的工作区可见（`visible !== false`）；`mode=none` 全部不可见。
 *   - **每工作区默认**：`workspaces[ws].defaultEnabled ?? !全局默认关闭名单(name)`
 *     —— 工作区没有单独配置时回落到「兜底全局默认」（skills/mcp 的全局名单、
 *     tools 的 `tools-global.json` ∪ 全局文件 `tools`），保证既有语义不变。
 *   - **工作区覆盖**：项目层 `mcp`/`skills`/`tools`（禁用）+ `enabledMcp`/
 *     `enabledSkills`/`enabledTools`（重新打开）三态，见 `overrides/*`。
 *
 * 工作区 key 的匹配口径（与客户端一致）：**以 `workspaces` 里原样的 path 为 key**；
 * 运行时按「projectRoot 精确 → cwd 精确 → 是最长 cwd 前缀的 key」匹配，因此
 * 子目录工作区也能命中，同仓库不同工作区可分别配置。
 *
 * 本模块不读文件、不碰宿主服务；坏数据（未知 mode / workspaces 非对象等）按
 * 最宽容口径降级（all / 空 map）并收集可读错误，供 global-file 的读路径透出。
 *
 * @module dsh-capability-settings/shared/visibility
 */

/**
 * 对**不可见能力**写会话开关时的业务失败文案（三域统一，契约 §4）。
 *
 * 不可见 = 全局可见性把该能力对当前工作区关闭；会话开关不能反向打开。
 */
export const INVISIBLE_CAPABILITY_ERROR = "能力对当前工作区不可见，请先在全局开启可见";

/** 可见性三域（与 `CapabilityDomain` 同集合）。 */
export type VisibilityDomain = "skills" | "mcp" | "tools";

/** 可见性模式。 */
export type VisibilityMode = "all" | "selected" | "none";

/** 三个可见性域（固定顺序：skills / mcp / tools）。 */
export const VISIBILITY_DOMAINS: readonly VisibilityDomain[] = ["skills", "mcp", "tools"] as const;

/** 某工作区在一个能力上的可见性配置。 */
export interface WorkspaceVisibility {
  /** false = 该工作区不可见（优先于 `mode=all`）；缺省 = 按 mode。 */
  visible?: boolean;
  /** 该工作区的默认开/关；缺省 = 回落「兜底全局默认」。 */
  defaultEnabled?: boolean;
}

/** 一个能力（技能 / MCP server / Tools 单元）的可见性配置。 */
export interface CapabilityVisibility {
  /** 可见范围模式；缺省 = `all`。 */
  mode: VisibilityMode;
  /** 工作区 path → 该工作区配置（`visible:false` 优先于 mode=all）。 */
  workspaces: Record<string, WorkspaceVisibility>;
}

/** 三域全部可见性配置：domain → key → 条目。 */
export type VisibilitySets = Record<VisibilityDomain, Record<string, CapabilityVisibility>>;

/** 工作区匹配目标：项目根与（可选的）会话/面板 cwd。 */
export interface WorkspaceTarget {
  /** 由 cwd 推导的项目根（`findProjectRoot`）。 */
  projectRoot?: string;
  /** 真实工作区 / 会话 cwd（可能比项目根深）。 */
  cwd?: string;
}

/** 构造一份全空可见性（三域都是空 map）。 */
export function emptyVisibilitySets(): VisibilitySets {
  return { skills: {}, mcp: {}, tools: {} };
}

/** 构造一份默认条目（all + 空 workspaces）。 */
export function emptyCapabilityVisibility(): CapabilityVisibility {
  return { mode: "all", workspaces: {} };
}

/** 归一 mode：未知值按 `all`（宽容降级）。 */
export function normalizeMode(value: unknown): VisibilityMode {
  return value === "selected" || value === "none" || value === "all" ? value : "all";
}

/**
 * 归一一个工作区配置。
 *
 * @returns 合法对象（忽略非布尔字段）；非对象返回 undefined
 */
export function normalizeWorkspaceVisibility(value: unknown, errors?: string[], label = "workspace"): WorkspaceVisibility | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    errors?.push(`invalid visibility ${label}: must be an object`);
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const out: WorkspaceVisibility = {};
  if (source.visible !== undefined) {
    if (typeof source.visible !== "boolean") errors?.push(`invalid visibility ${label}.visible: must be a boolean`);
    else out.visible = source.visible;
  }
  if (source.defaultEnabled !== undefined) {
    if (typeof source.defaultEnabled !== "boolean") errors?.push(`invalid visibility ${label}.defaultEnabled: must be a boolean`);
    else out.defaultEnabled = source.defaultEnabled;
  }
  return out;
}

/**
 * 归一一个能力的可见性条目。
 *
 * @returns 合法条目（`workspaces` 里坏值丢弃并收集错误）
 */
export function normalizeCapabilityVisibility(
  value: unknown,
  errors?: string[],
  label = "capability",
): CapabilityVisibility | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    errors?.push(`invalid visibility ${label}: must be an object`);
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const mode = source.mode === undefined ? "all" : normalizeMode(source.mode);
  if (source.mode !== undefined && source.mode !== "all" && source.mode !== "selected" && source.mode !== "none") {
    errors?.push(`invalid visibility ${label}.mode: must be "all" | "selected" | "none"`);
  }
  const workspaces: Record<string, WorkspaceVisibility> = {};
  const rawWorkspaces = source.workspaces;
  if (rawWorkspaces !== undefined) {
    if (rawWorkspaces === null || typeof rawWorkspaces !== "object" || Array.isArray(rawWorkspaces)) {
      errors?.push(`invalid visibility ${label}.workspaces: must be an object`);
    } else {
      for (const [workspaceKey, raw] of Object.entries(rawWorkspaces as Record<string, unknown>)) {
        const key = workspaceKey.trim();
        if (key.length === 0) continue;
        const entry = normalizeWorkspaceVisibility(raw, errors, `${label}.workspaces[${key}]`);
        if (entry !== undefined) workspaces[key] = entry;
      }
    }
  }
  return { mode, workspaces };
}

/**
 * 归一整个 `visibility` 字段（三域）。
 *
 * 非对象 / 坏域 / 坏条目：按空 map / 默认 all 降级，并把错误收进 `errors`
 * （global-file 的读路径据此决定是否报错，写路径要求 `errors.length === 0`）。
 *
 * @param raw 磁盘上的原始值
 * @returns `{ sets, errors }`；`sets` 恒为三域齐全的结构
 */
export function normalizeVisibilitySets(raw: unknown): { sets: VisibilitySets; errors: string[] } {
  const sets = emptyVisibilitySets();
  const errors: string[] = [];
  if (raw === undefined) return { sets, errors };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { sets, errors: ['invalid global capability overrides: "visibility" must be an object'] };
  }
  const source = raw as Record<string, unknown>;
  for (const domain of VISIBILITY_DOMAINS) {
    const rawDomain = source[domain];
    if (rawDomain === undefined) continue;
    if (rawDomain === null || typeof rawDomain !== "object" || Array.isArray(rawDomain)) {
      errors.push(`invalid global capability overrides: "visibility.${domain}" must be an object`);
      continue;
    }
    for (const [rawKey, rawEntry] of Object.entries(rawDomain as Record<string, unknown>)) {
      const key = rawKey.trim();
      if (key.length === 0) continue;
      const entry = normalizeCapabilityVisibility(rawEntry, errors, `${domain}.${key}`);
      // 语义等价缺省的条目（all + 空 workspaces）不落内存，保持「未配置 = all」单一表示。
      if (entry !== undefined && !(entry.mode === "all" && Object.keys(entry.workspaces).length === 0)) {
        sets[domain][key] = entry;
      }
    }
  }
  return { sets, errors };
}

/** 取某能力的可见性条目（缺省 = all）。 */
export function visibilityEntryOf(
  sets: VisibilitySets,
  domain: VisibilityDomain,
  key: string,
): CapabilityVisibility | undefined {
  return sets[domain]?.[key];
}

/** 取某能力的可见性模式（缺省 all）。 */
export function visibilityModeOf(sets: VisibilitySets, domain: VisibilityDomain, key: string): VisibilityMode {
  return normalizeMode(visibilityEntryOf(sets, domain, key)?.mode);
}

/** 显式配置为可见的工作区数量（`visible !== false`；前端标签「指定 N」用）。 */
export function visibleWorkspaceCount(entry: CapabilityVisibility | undefined): number {
  if (entry === undefined) return 0;
  return Object.values(entry.workspaces).filter((workspace) => workspace.visible !== false).length;
}

/** 归一工作区路径用于前缀匹配（去尾斜杠、统一 `/`）。 */
function normalizePath(value: string): string {
  const slashed = value.replace(/\\/g, "/");
  if (slashed.length <= 1) return slashed;
  return slashed.replace(/\/+$/, "");
}

/**
 * 在 `workspaces` 的 key 集合里为某个目标找到匹配的 key。
 *
 * 顺序：projectRoot 精确 → cwd 精确 → 「是 cwd 前缀的最长 key」。
 * 都没有返回 undefined（调用方按 mode 的缺省语义处理）。
 */
export function workspaceMatchKey(
  keys: readonly string[],
  target: WorkspaceTarget | undefined,
): string | undefined {
  if (target === undefined) return undefined;
  const projectRoot = target.projectRoot !== undefined ? normalizePath(target.projectRoot) : undefined;
  const cwd = target.cwd !== undefined ? normalizePath(target.cwd) : undefined;
  if (projectRoot !== undefined && keys.includes(projectRoot)) return projectRoot;
  if (cwd !== undefined && keys.includes(cwd)) return cwd;
  if (cwd === undefined) return undefined;
  let best: string | undefined;
  for (const key of keys) {
    const normalized = normalizePath(key);
    if (normalized.length === 0) continue;
    if (cwd !== normalized && !cwd.startsWith(`${normalized}/`)) continue;
    if (best === undefined || normalized.length > normalizePath(best).length) best = key;
  }
  return best;
}

/** 目标是否全局视图（没有工作区上下文 = 全部可见）。 */
function isGlobalTarget(target: WorkspaceTarget | undefined): boolean {
  return target === undefined || (target.projectRoot === undefined && target.cwd === undefined);
}

/**
 * 该能力在某工作区是否**可见**（契约 §3）。
 *
 * `target` 缺省 / 无工作区上下文（全局视图）→ true。
 * 未知工作区：mode=all ⇒ true、selected ⇒ false、none ⇒ false（缺省条目 = all）。
 */
export function visibleIn(
  sets: VisibilitySets,
  domain: VisibilityDomain,
  key: string,
  target: WorkspaceTarget | undefined,
): boolean {
  if (isGlobalTarget(target)) return true;
  const entry = visibilityEntryOf(sets, domain, key);
  if (entry === undefined) return true;
  const mode = normalizeMode(entry.mode);
  if (mode === "none") return false;
  const matched = workspaceMatchKey(Object.keys(entry.workspaces), target);
  const workspace = matched !== undefined ? entry.workspaces[matched] : undefined;
  if (mode === "selected") return workspace !== undefined && workspace.visible !== false;
  // mode=all：未列出的工作区可见；列出的按 visible（缺省可见）。
  return workspace === undefined || workspace.visible !== false;
}

/** 判断名字是否落在「兜底全局默认关闭」名单里。 */
export function isGloballyDisabled(globalDisabled: readonly string[] | ReadonlySet<string>, key: string): boolean {
  // 数组与 Set 都支持；用方法探测避免 `instanceof Set`（ReadonlySet 类型不是 Set）。
  if (typeof (globalDisabled as ReadonlySet<string>).has === "function") {
    return (globalDisabled as ReadonlySet<string>).has(key);
  }
  return (globalDisabled as readonly string[]).includes(key);
}

/**
 * 该能力在某工作区的**全局默认**（每工作区默认，契约 §3）。
 *
 * `workspaces[ws].defaultEnabled ?? !兜底全局默认关闭(name)`（缺省条目 = 后者）。
 * 全局视图（无工作区上下文）下直接取兜底默认。
 */
export function perWorkspaceDefault(
  sets: VisibilitySets,
  domain: VisibilityDomain,
  key: string,
  target: WorkspaceTarget | undefined,
  globalDisabled: readonly string[] | ReadonlySet<string>,
): boolean {
  if (!isGlobalTarget(target)) {
    const entry = visibilityEntryOf(sets, domain, key);
    if (entry !== undefined) {
      const matched = workspaceMatchKey(Object.keys(entry.workspaces), target);
      const workspace = matched !== undefined ? entry.workspaces[matched] : undefined;
      if (workspace?.defaultEnabled !== undefined) return workspace.defaultEnabled;
    }
  }
  return !isGloballyDisabled(globalDisabled, key);
}

/**
 * 某工作区里**不可见**的能力名列表（指定域内所有显式配置过的 key 中过滤）。
 *
 * 只遍历 `visibility` 里出现过的 key（未配置 = 可见），供运行时 gate 用；
 * 调用方仍需按能力是否存在过滤（避免给不存在的名字做无效投影）。
 */
export function invisibleKeysForWorkspace(
  sets: VisibilitySets,
  domain: VisibilityDomain,
  target: WorkspaceTarget | undefined,
): string[] {
  if (isGlobalTarget(target)) return [];
  return Object.keys(sets[domain] ?? {}).filter((key) => !visibleIn(sets, domain, key, target)).sort();
}
