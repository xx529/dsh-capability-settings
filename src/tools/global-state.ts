/**
 * Tools 域**全局默认**开关的持久化存储。
 *
 * 用户澄清后的两层语义（覆盖早期「Tools 只有会话级开关」的 A5 设计）：
 *
 *   - **能力面板 = 全局默认**：写本文件，决定所有会话（含新建会话）的默认态；
 *   - **会话首屏 = 本会话覆盖**：仍写 `session-capabilities.json` 的 `tools` 域；
 *   - 生效值：`effective(unit) = 会话覆盖[unit] ?? !globalDisabled.has(unit)`。
 *
 * 存储契约：
 *
 *   - 文件：`<dshHome>/dsh-capability-settings/tools-global.json`
 *     （与 `session-capabilities.json` / `jev.json` 同目录；目录 0700、文件 0600）；
 *   - 形状：`{ "version": 1, "disabled": ["<unit>", …] }`；`disabled` = **全局默认
 *     关闭**的开关单元 id 列表（缺省空表 = 全部启用）；
 *   - 写：`shared/file-lock.ts` 进程内串行 + `shared/atomic-write.ts` 原子写；
 *     锁内重读磁盘合并（多面板标签页 / 双写不丢更新）；
 *   - 读：文件缺失 / 空 / JSON 损坏 / version 不认识 → `warn` + 按**全部启用**
 *     降级（不阻断任何域）；写入失败 → `warn`，本次运行内仍生效；
 *   - 存活的 unit 才会被 manager 读取（文件里已卸载插件的残留 id 无害、不主动删，
 *     留待将来的 reconcile 懒清理——任务要求「不删用户数据」）。
 *
 * @module dsh-capability-settings/tools/global-state
 */

import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";

import { atomicWriteText } from "../shared/atomic-write.js";
import { errMessage } from "../shared/errors.js";
import { withFileLock } from "../shared/file-lock.js";
import { readJsonDocument } from "../shared/json-config.js";
import { SESSION_STATE_DIR_NAME } from "../session-state.js";

/** 当前数据文件版本；版本不认识时整份忽略（不猜测迁移）。 */
export const TOOLS_GLOBAL_VERSION = 1;

/** 数据文件名。 */
export const TOOLS_GLOBAL_FILE_NAME = "tools-global.json";

/** 插件数据目录名（与 session-capabilities.json / jev.json 共用）。 */
export const TOOLS_GLOBAL_DIR_NAME = SESSION_STATE_DIR_NAME;

/** 目录目标权限。 */
const DIR_MODE = 0o700;
/** 文件目标权限（与既有配置文件一致的最小权限）。 */
const FILE_MODE = 0o600;

/** 配置目录：`<dshHome>/dsh-capability-settings`。 */
export function toolsGlobalDir(dshHome?: string): string {
  return join(resolveDshHome(dshHome), TOOLS_GLOBAL_DIR_NAME);
}

/** 数据文件：`<dshHome>/dsh-capability-settings/tools-global.json`。 */
export function toolsGlobalFile(dshHome?: string): string {
  return join(toolsGlobalDir(dshHome), TOOLS_GLOBAL_FILE_NAME);
}

/** 结构化 logger 子集（与插件其它模块一致，缺省静默）。 */
export interface ToolsGlobalLogger {
  warn?: (message: string) => void;
}

/** 构造参数。 */
export interface ToolsGlobalStoreDeps {
  /** dsh home 覆盖（缺省 `resolveDshHome()`）。 */
  dshHome?: string;
  /** 日志（缺省静默）。 */
  logger?: ToolsGlobalLogger;
}

/** 批量设置全局默认的结果（业务失败收在 `ok:false`）。 */
export type ToolsGlobalSetResult = { ok: true; applied: number } | { ok: false; errors: string[] };

/** 全局默认开关存储（组合根单例；`tools.list` / manager 共用）。 */
export interface ToolsGlobalStore {
  /** 数据文件绝对路径（诊断 / 测试）。 */
  readonly filePath: string;
  /** 懒加载磁盘快照（幂等；读取失败降级为空表，不抛）。 */
  ready(): Promise<void>;
  /** 当前「全局默认关闭」的 unit id 集合（同步快照；调用方先 `await ready()`）。 */
  disabled(): ReadonlySet<string>;
  /**
   * 批量设置全局默认：`enabled === false` → 加入 disabled；`true` → 移出。
   *
   * 幂等（无变化不写盘，`applied:0`）；锁内读盘合并；写失败 → `warn` +
   * `{ok:false, errors}`（内存镜像仍生效）。
   */
  setEnabled(units: readonly string[], enabled: boolean): Promise<ToolsGlobalSetResult>;
  /** 卸载：停止后续写入（进行中的写盘不会被打断）。 */
  dispose(): void;
}

/** 清洗 disabled 数组：只收非空字符串、去重、保序。 */
function sanitizeDisabled(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const unit = item.trim();
    if (unit.length === 0) continue;
    seen.add(unit);
  }
  return [...seen];
}

/** 整份快照清洗：版本不认识时抛错（调用方降级为空表 + warn）。 */
function sanitizeSnapshot(raw: Record<string, unknown>): Set<string> {
  if (raw.version !== TOOLS_GLOBAL_VERSION) {
    throw new Error(`unsupported tools-global version: ${String(raw.version)}`);
  }
  return new Set(sanitizeDisabled(raw.disabled));
}

/** 归一输入 unit 列表（去空、去重；同时兼容 `plugin:<unit>` 持久化键写法）。 */
function normalizeUnits(units: readonly unknown[]): string[] {
  const seen = new Set<string>();
  for (const item of units) {
    if (typeof item !== "string") continue;
    const raw = item.trim();
    if (raw.length === 0) continue;
    const unit = raw.startsWith("plugin:") ? raw.slice("plugin:".length) : raw;
    if (unit.length === 0) continue;
    seen.add(unit);
  }
  return [...seen];
}

/**
 * 创建全局默认开关存储（组合根单例）。
 *
 * @param deps dsh home / 日志
 */
export function createToolsGlobalStore(deps: ToolsGlobalStoreDeps = {}): ToolsGlobalStore {
  const logger = deps.logger;
  const filePath = toolsGlobalFile(deps.dshHome);
  const dir = toolsGlobalDir(deps.dshHome);
  /** 内存镜像（磁盘 + 本次运行内的改动）。 */
  let image = new Set<string>();
  /** 懒加载 promise（失败也 resolve，避免每次调用重试）。 */
  let loaded: Promise<void> | undefined;
  let disposed = false;

  /** 日志 warn 包装（缺省静默）。 */
  function warn(message: string): void {
    logger?.warn?.(message);
  }

  /** 读盘并清洗；失败降级为「全部启用」。 */
  async function load(): Promise<void> {
    try {
      const raw = await readJsonDocument(filePath, "tools global defaults");
      image = raw === undefined ? new Set<string>() : sanitizeSnapshot(raw);
    } catch (error) {
      warn(`capability-panel: 读取全局 Tools 默认失败，按"全部启用"继续（${errMessage(error)}）`);
      image = new Set<string>();
    }
  }

  /** 懒加载（幂等）。 */
  function ready(): Promise<void> {
    loaded ??= load();
    return loaded;
  }

  /** 写盘：目录 0700 / 文件 0600 / 原子写。 */
  async function writeSnapshot(disabled: ReadonlySet<string>): Promise<void> {
    const body = `${JSON.stringify({ version: TOOLS_GLOBAL_VERSION, disabled: [...disabled].sort() }, null, 2)}\n`;
    await mkdir(dir, { recursive: true, mode: DIR_MODE });
    await chmod(dir, DIR_MODE).catch(() => undefined);
    await atomicWriteText(filePath, body, "tools-global", { mode: FILE_MODE });
  }

  return {
    filePath,

    ready,

    disabled(): ReadonlySet<string> {
      return new Set(image);
    },

    async setEnabled(units, enabled): Promise<ToolsGlobalSetResult> {
      if (disposed) return { ok: false, errors: ["tools global store disposed"] };
      const requested = normalizeUnits(units);
      if (requested.length === 0) return { ok: true, applied: 0 };
      await ready();
      try {
        return await withFileLock(filePath, async () => {
          // 锁内重读磁盘，合并其它写者；读失败退回内存镜像（不丢本次运行改动）。
          let disk: Set<string>;
          try {
            const raw = await readJsonDocument(filePath, "tools global defaults");
            disk = raw === undefined ? new Set<string>() : sanitizeSnapshot(raw);
          } catch (error) {
            warn(`capability-panel: 合并全局 Tools 默认时读取旧文件失败，改为以内存镜像为准（${errMessage(error)}）`);
            disk = new Set(image);
          }
          let changed = 0;
          for (const unit of requested) {
            if (enabled) {
              if (disk.delete(unit)) changed += 1;
            } else if (!disk.has(unit)) {
              disk.add(unit);
              changed += 1;
            }
          }
          // 无变化不写盘（幂等；避免每次点击都刷一次 mtime）。
          if (changed > 0) {
            image = disk;
            try {
              await writeSnapshot(disk);
            } catch (error) {
              // 写入失败：内存仍生效（本次运行内），向调用方返回业务失败。
              warn(
                `capability-panel: 保存全局 Tools 默认失败（仅本次运行内生效，重启后会丢失该次修改）：${errMessage(error)}`,
              );
              return { ok: false, errors: [errMessage(error)] };
            }
          }
          return { ok: true, applied: changed };
        });
      } catch (error) {
        warn(`capability-panel: 保存全局 Tools 默认失败：${errMessage(error)}`);
        return { ok: false, errors: [errMessage(error)] };
      }
    },

    dispose(): void {
      disposed = true;
    },
  };
}
