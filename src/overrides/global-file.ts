/**
 * 读写**全局**默认关闭名单（B2）：`capability-global-overrides.json`。
 *
 * 磁盘形状（契约 §1.1）：
 *
 * ```jsonc
 * // <dshHome>/dsh-capability-settings/capability-global-overrides.json
 * { "version": 1, "skills": ["foo", "bar"] }
 * ```
 *
 * 语义边界：
 *
 *   - `skills` = 全局默认关闭名单；**空数组不落盘字段**（文件最小化为 `{version:1}`）；
 *   - 不改任何技能文件（不写 frontmatter、不生成 shadow stub）；
 *   - 写入：原子写（临时文件 + rename）+ 父目录按需创建 + **文件 0600**；
 *     读-改-写整段的互斥由调用方（`overrides/manager.ts`）用 `withFileLock` 包住；
 *   - 读取：文件缺失 / 空文件 → 空名单（宽容）；JSON 非法 / 顶层非对象 /
 *     `version` 不认识 / `skills` 不是字符串数组 → 抛**带文件名的可读错误**
 *     （读路径由调用方降级为空名单并把错误透出，写路径显式报错）。
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

/** 构造一份空的全局覆盖（skills = []）。 */
export function emptyGlobalOverrides(): GlobalOverrides {
  return { skills: [] };
}

/**
 * 读取全局覆盖文件。
 *
 * - 文件缺失 / 空 → 空名单（不报错）；
 * - JSON 非法 / 顶层非对象 → 抛带文件名的 Error；
 * - `version` 不认识 → 抛错；
 * - `skills` 存在但不是字符串数组 → 抛带文件名的 Error（手改写坏时显式暴露）。
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
  const raw = parsed.skills;
  if (raw === undefined) return emptyGlobalOverrides();
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) {
    throw new Error(`invalid global capability overrides in ${filePath}: "skills" must be an array of strings`);
  }
  return { skills: normalizeList(raw) };
}

/**
 * 原子写入全局覆盖文件（自动创建父目录；文件 0600；空名单不落盘 `skills` 字段）。
 *
 * 调用方负责把「读-改-写」整段包进 `withFileLock`（见 `manager.globalToggle`）。
 *
 * @param filePath 全局覆盖文件绝对路径
 * @param overrides 规范化前的全局清单
 */
export async function writeGlobalOverrides(filePath: string, overrides: GlobalOverrides): Promise<void> {
  const skills = normalizeList(overrides.skills);
  const body: GlobalOverridesFile = {
    version: GLOBAL_OVERRIDES_VERSION,
    ...(skills.length > 0 ? { skills } : {}),
  };
  await atomicWriteText(filePath, `${JSON.stringify(body, null, 2)}\n`, "capability-global-overrides", { mode: 0o600 });
}
