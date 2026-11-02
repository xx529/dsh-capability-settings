/**
 * 读写**全局**默认关闭名单（B2 Skills / v20.2 MCP）：
 * `capability-global-overrides.json`。
 *
 * 磁盘形状（契约 §1.1）：
 *
 * ```jsonc
 * // <dshHome>/dsh-capability-settings/capability-global-overrides.json
 * { "version": 1, "skills": ["foo", "bar"], "mcp": ["figma"] }
 * ```
 *
 * 语义边界：
 *
 *   - `skills` = 全局默认关闭的技能名；`mcp` = 全局默认关闭的 MCP serverName；
 *     **空数组不落盘字段**（文件最小化为 `{version:1}`）；
 *   - 不改任何技能文件 / MCP 配置文件（不写 frontmatter、不生成 shadow stub、
 *     不改注入方配置、不卸载共享实例）；
 *   - 写入：原子写（临时文件 + rename）+ 父目录按需创建 + **文件 0600**；
 *     读-改-写整段的互斥由调用方（`overrides/manager.ts`）用 `withFileLock` 包住；
 *   - 读取：文件缺失 / 空文件 → 空名单（宽容）；JSON 非法 / 顶层非对象 /
 *     `version` 不认识 / `skills` 或 `mcp` 不是字符串数组 → 抛**带文件名的
 *     可读错误**（读路径由调用方降级为空名单并把错误透出，写路径显式报错）。
 *
 * 与项目统一存储（`capability-overrides.json`）分离：全局默认是「一层」，
 * 项目覆盖是「另一层」，两者读取互不降级（全局文件坏了不影响项目编辑）。
 *
 * @module dsh-capability-settings/overrides/global-file
 */

import { atomicWriteText } from "../shared/atomic-write.js";
import { readJsonDocument } from "../shared/json-config.js";

import { normalizeList } from "./config-file.js";
import type { GlobalOverrides, GlobalOverridesFile } from "./types.js";

/** 全局覆盖文件的当前版本；版本不认识时整份拒绝（不猜测迁移）。 */
export const GLOBAL_OVERRIDES_VERSION = 1;

/**
 * 全局覆盖文件里的名单字段（技能名 / MCP serverName）。
 *
 * 两域读写逻辑完全一致，收敛成一次循环，避免新增一层时漏掉某一侧。
 */
const GLOBAL_LIST_FIELDS = ["skills", "mcp"] as const;

/** 构造一份空的全局覆盖（skills = []、mcp = []）。 */
export function emptyGlobalOverrides(): GlobalOverrides {
  return { skills: [], mcp: [] };
}

/**
 * 读取全局覆盖文件。
 *
 * - 文件缺失 / 空 → 空名单（不报错）；
 * - JSON 非法 / 顶层非对象 → 抛带文件名的 Error；
 * - `version` 不认识 → 抛错；
 * - `skills` / `mcp` 存在但不是字符串数组 → 抛带文件名的 Error（手改写坏时
 *   显式暴露）。
 *
 * @param filePath 全局覆盖文件绝对路径
 * @returns 规范化后的全局清单
 */
export async function readGlobalOverrides(filePath: string): Promise<GlobalOverrides> {
  const parsed = await readJsonDocument(filePath, "global capability overrides");
  if (parsed === undefined) return emptyGlobalOverrides();
  if (parsed.version !== GLOBAL_OVERRIDES_VERSION) {
    throw new Error(
      `unsupported global capability overrides version in ${filePath}: ${String(parsed.version)} (expected ${GLOBAL_OVERRIDES_VERSION})`,
    );
  }
  const out = emptyGlobalOverrides();
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
 * 原子写入全局覆盖文件（自动创建父目录；文件 0600；空名单不落盘对应字段）。
 *
 * 调用方负责把「读-改-写」整段包进 `withFileLock`（见 `manager.globalToggle`）。
 *
 * @param filePath 全局覆盖文件绝对路径
 * @param overrides 规范化前的全局清单
 */
export async function writeGlobalOverrides(filePath: string, overrides: GlobalOverrides): Promise<void> {
  const body: GlobalOverridesFile = { version: GLOBAL_OVERRIDES_VERSION };
  for (const field of GLOBAL_LIST_FIELDS) {
    const values = normalizeList(overrides[field] ?? []);
    if (values.length > 0) body[field] = values;
  }
  await atomicWriteText(filePath, `${JSON.stringify(body, null, 2)}\n`, "capability-global-overrides", { mode: 0o600 });
}
