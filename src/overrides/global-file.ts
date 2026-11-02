/**
 * 读写**全局**默认关闭名单 + 能力可见性（B2 Skills / v20.2 MCP / v21 Tools + 可见性）：
 * `capability-global-overrides.json`。
 *
 * 磁盘形状（契约 v21 §2.1）：
 *
 * ```jsonc
 * // <dshHome>/dsh-capability-settings/capability-global-overrides.json
 * {
 *   "version": 2,
 *   "skills": ["foo", "bar"],     // 全局默认关闭兜底名单；空数组不落盘字段
 *   "mcp": ["figma"],
 *   "tools": ["dsh-foo"],
 *   "visibility": {               // 能力 × 工作区可见性；全空时不落盘
 *     "skills": { "pdf": { "mode": "all", "workspaces": { "/abs/projA": { "visible": true, "defaultEnabled": false } } } },
 *     "mcp": {}, "tools": {}
 *   }
 * }
 * ```
 *
 * 语义边界：
 *
 *   - 三份名单 = 「兜底全局默认关闭」；**空数组不落盘字段**（文件最小化为 `{version:2}`）；
 *   - `visibility` = 能力可见性（见 `shared/visibility.ts`）；未配置的能力恒可见且
 *     走兜底默认；`mode=all` + 空 workspaces 的条目被移除（等价缺省）；
 *   - **版本兼容**：v1 文件按「全部可见 + 现有默认关闭语义不变」读取（缺 `tools` /
 *     `visibility` 时按空）；首次写入升 v2。不认识的版本整份拒绝（不猜测迁移）；
 *   - 不改任何技能文件 / MCP 配置文件 / 注入方配置；
 *   - 写入：原子写 + 父目录按需创建 + **文件 0600**；读-改-写整段的互斥由调用方
 *     （`overrides/manager.ts`）用 `withFileLock` 包住；
 *   - 读取：文件缺失 / 空 → 空清单（宽容）；JSON 非法 / 顶层非对象 / 版本不认识 /
 *     名单不是字符串数组 → 抛**带文件名的可读错误**（写路径显式报错；读路径由
 *     manager 降级）。`visibility` 坏值**不抛**：按最宽容口径（all / 空 map）降级，
 *     并把可读错误收进 `errors`（contract §2.1「坏 visibility 读路径降级 + 回传错误」）。
 *
 * @module dsh-capability-settings/overrides/global-file
 */

import { atomicWriteText } from "../shared/atomic-write.js";
import { readJsonDocument } from "../shared/json-config.js";
import { emptyVisibilitySets, normalizeVisibilitySets } from "../shared/visibility.js";
import type { VisibilitySets } from "../shared/visibility.js";

import { normalizeList } from "./config-file.js";
import type { GlobalOverrides, GlobalOverridesFile } from "./types.js";

/** 全局覆盖文件当前写入的版本（v21 升 2；读兼容 1）。 */
export const GLOBAL_OVERRIDES_VERSION = 2;

/** 兼容读取的旧版本（缺 `tools` / `visibility` ⇒ 全部可见、现有语义不变）。 */
export const GLOBAL_OVERRIDES_LEGACY_VERSION = 1;

/**
 * 全局覆盖文件里的名单字段（技能名 / MCP serverName / Tools 单元 id）。
 *
 * 三域读写逻辑完全一致，收敛成一次循环，避免新增一层时漏掉某一侧。
 */
export const GLOBAL_LIST_FIELDS = ["skills", "mcp", "tools"] as const;

/** 一次读取的结果：规范化清单 + 可降级的可见性错误。 */
export interface GlobalOverridesReadResult {
  overrides: GlobalOverrides;
  /** 可降级错误（目前只有 `visibility` 坏值）；名单/版本错误仍直接抛。 */
  errors: string[];
}

/** 构造一份空的全局覆盖（三名单为空、三域可见性为空）。 */
export function emptyGlobalOverrides(): GlobalOverrides {
  return { skills: [], mcp: [], tools: [], visibility: emptyVisibilitySets() };
}

/** 归一 / 校验三份名单（非法形状抛带文件名的错误）。 */
function parseLists(parsed: Record<string, unknown>, filePath: string): Pick<GlobalOverrides, "skills" | "mcp" | "tools"> {
  const out: Pick<GlobalOverrides, "skills" | "mcp" | "tools"> = { skills: [], mcp: [], tools: [] };
  for (const field of GLOBAL_LIST_FIELDS) {
    const raw = parsed[field];
    if (raw === undefined) continue;
    if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) {
      throw new Error(`invalid global capability overrides in ${filePath}: "${field}" must be an array of strings`);
    }
    out[field] = normalizeList(raw);
  }
  return out;
}

/**
 * 读取全局覆盖文件（**宽容可见性**）。
 *
 * 名单 / 版本错误直接抛（与旧行为一致）；`visibility` 坏值降级为「全部可见」并
 * 把可读错误收进 `errors`，由 manager 透出给面板（不让一处手误拖垮全局默认层）。
 *
 * @param filePath 全局覆盖文件绝对路径
 */
export async function readGlobalOverridesDocument(filePath: string): Promise<GlobalOverridesReadResult> {
  const parsed = await readJsonDocument(filePath, "global capability overrides");
  if (parsed === undefined) return { overrides: emptyGlobalOverrides(), errors: [] };
  const version = parsed.version;
  if (version !== GLOBAL_OVERRIDES_VERSION && version !== GLOBAL_OVERRIDES_LEGACY_VERSION) {
    throw new Error(
      `unsupported global capability overrides version in ${filePath}: ${String(version)} (expected ${GLOBAL_OVERRIDES_VERSION}, legacy ${GLOBAL_OVERRIDES_LEGACY_VERSION})`,
    );
  }
  const lists = parseLists(parsed, filePath);
  // v1 ⇒ 契约 §7：全部可见（不读取 visibility，迁移无感）。
  if (version === GLOBAL_OVERRIDES_LEGACY_VERSION) {
    return { overrides: { ...lists, visibility: emptyVisibilitySets() }, errors: [] };
  }
  const { sets, errors } = normalizeVisibilitySets(parsed.visibility);
  return { overrides: { ...lists, visibility: sets }, errors };
}

/**
 * 严格读取全局覆盖文件（写路径用）。
 *
 * 与宽容版的唯一区别：`visibility` 有坏值 ⇒ 抛错（避免读-改-写静默丢掉用户配置）。
 */
export async function readGlobalOverrides(filePath: string): Promise<GlobalOverrides> {
  const { overrides, errors } = await readGlobalOverridesDocument(filePath);
  if (errors.length > 0) throw new Error(`invalid global capability overrides in ${filePath}: ${errors.join("; ")}`);
  return overrides;
}

/** 三域可见性是否全空（全空不落盘该字段）。 */
function isEmptyVisibility(visibility: VisibilitySets): boolean {
  return Object.values(visibility).every((domain) => Object.keys(domain).length === 0);
}

/** 判定一份 `mode=all` + 空 workspaces 的条目等价缺省（写盘时移除）。 */
function isEmptyVisibilityEntry(entry: VisibilitySets["skills"][string]): boolean {
  return entry.mode === "all" && Object.keys(entry.workspaces).length === 0;
}

/**
 * 原子写入全局覆盖文件（自动创建父目录；文件 0600；空名单 / 空可见性不落盘对应字段）。
 *
 * 调用方负责把「读-改-写」整段包进 `withFileLock`（见 `manager.globalToggle` /
 * `manager.setVisibility`）。`mode=all` + 空 workspaces 的可见性条目在归一后
 * 被移除（等价缺省全可见），保持文件最小化。
 *
 * @param filePath 全局覆盖文件绝对路径
 * @param overrides 规范化前的全局数据
 */
export async function writeGlobalOverrides(filePath: string, overrides: GlobalOverrides): Promise<void> {
  const body: GlobalOverridesFile = { version: GLOBAL_OVERRIDES_VERSION };
  for (const field of GLOBAL_LIST_FIELDS) {
    const values = normalizeList(overrides[field] ?? []);
    if (values.length > 0) body[field] = values;
  }
  const { sets, errors } = normalizeVisibilitySets(overrides.visibility ?? emptyVisibilitySets());
  if (errors.length > 0) throw new Error(`invalid visibility to write: ${errors.join("; ")}`);
  const visibility = emptyVisibilitySets();
  for (const domain of GLOBAL_LIST_FIELDS) {
    for (const [key, entry] of Object.entries(sets[domain])) {
      if (isEmptyVisibilityEntry(entry)) continue;
      visibility[domain][key] = entry;
    }
  }
  if (!isEmptyVisibility(visibility)) body.visibility = visibility;
  await atomicWriteText(filePath, `${JSON.stringify(body, null, 2)}\n`, "capability-global-overrides", { mode: 0o600 });
}
