/**
 * skills 在磁盘上的核心 CRUD 操作。传输无关：这些函数只接收一个已解析的
 * 根目录（由 `roots.ts` 解析）并返回纯结果对象，因此同一套函数既可以支撑
 * CLI、宿主 RPC 方法，也可以支撑未来的其它入口。
 *
 * @module dsh-capability-settings/skills/crud
 */

import { join } from "node:path";

import {
  deleteSkill,
  listResources,
  listSkillEntries,
  readSkill,
  resolveSkillEntry,
  resourceDirectory,
  skillFilePath,
  writeSkill,
} from "./disk.js";
import { isSkillName, validateSpec } from "./validate.js";
import type { SkillFormat, SkillSpec } from "./types.js";

/** 兼容旧调用方：磁盘条目枚举的实现已下沉到 disk.ts（与 resolveSkillEntry 同源）。 */
export { listSkillEntries } from "./disk.js";
export type { SkillEntry } from "./disk.js";

/**
 * 校验一个将被拼进文件路径的 skill 名。
 *
 * 所有以 `root + name` 定位文件的入口都必须在第一时间拒绝非法名：`name`
 * 来自 RPC 入参，若形如 `../x` 可越出受管根删除/读取任意 `.md` 文件（install
 * 路径已有 isSkillName 前置校验，crud / export 路径同样需要）。统一返回与
 * crud 各函数一致的 `{ ok: false, errors }` 形状。
 */
function nameGuard<T extends { ok: boolean; errors?: string[] }>(name: unknown, source: string): T | undefined {
  if (isSkillName(name)) return undefined;
  return { ok: false, errors: [`invalid skill name "${String(name)}" (from ${source})`] } as T;
}

/** 创建 skill 的入参。 */
export interface CreateOptions {
  /** 已解析到具体 skills 根的目标目录。 */
  root: string;
  /** 磁盘布局（flat / directory）。 */
  format: SkillFormat;
  /** skill 元数据（写盘前会先过 validateSpec 校验）。 */
  spec: SkillSpec;
  /** 技能正文。 */
  body: string;
  /** 为 true 时允许覆盖同名已存在的 skill。 */
  overwrite?: boolean;
}

/** 创建 / 更新的结果。 */
export interface CreateResult {
  /** 是否成功。 */
  ok: boolean;
  /** 失败时的错误信息列表。 */
  errors?: string[];
  /** 成功时实际写入的文件绝对路径。 */
  path?: string;
  /** 目标 skill 是否已存在（存在且被覆盖时仍为 true）。 */
  existed?: boolean;
}

/**
 * 创建 skill：先校验 spec，再检查同名冲突（布局不同视为冲突；同名
 * 且未要求覆盖也视为冲突），最后落盘。
 */
export async function createSkill(options: CreateOptions): Promise<CreateResult> {
  const validation = validateSpec(options.spec);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const existing = await resolveSkillEntry(options.root, options.spec.name);
  if (existing !== undefined && existing.format !== options.format) {
    return {
      ok: false,
      errors: [`skill "${options.spec.name}" already exists in a different format (${existing.format})`],
    };
  }
  if (existing !== undefined && options.overwrite !== true) {
    return { ok: false, errors: [`skill "${options.spec.name}" already exists`], existed: true };
  }
  // 覆盖时写回原磁盘条目（目录名可能与 frontmatter 名不同），避免留下两个同名条目。
  const entryName = existing?.entryName ?? options.spec.name;
  const path = await writeSkill(options.root, entryName, options.format, options.spec, options.body);
  return { ok: true, path, existed: existing !== undefined };
}

/** 更新 skill 的入参。 */
export interface UpdateOptions {
  root: string;
  name: string;
  /** 未传时自动按磁盘现状探测布局；探测不到即视为"不存在"。 */
  format?: SkillFormat;
  spec: SkillSpec;
  body: string;
}

/** 更新 skill：校验 spec 与名称，探测（或显式指定）布局后整体覆盖写回。 */
export async function updateSkill(options: UpdateOptions): Promise<CreateResult> {
  const rejected = nameGuard<CreateResult>(options.name, "update");
  if (rejected !== undefined) return rejected;
  const validation = validateSpec(options.spec);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const entry = await resolveSkillEntry(options.root, options.name);
  if (entry === undefined) return { ok: false, errors: [`skill "${options.name}" not found`] };
  const format = options.format ?? entry.format;
  const path = await writeSkill(options.root, entry.entryName, format, options.spec, options.body);
  return { ok: true, path };
}

/** 删除 skill；目标不存在或名称非法时返回错误信息而不是抛异常。 */
export async function removeSkill(root: string, name: string): Promise<{ ok: boolean; errors?: string[] }> {
  const rejected = nameGuard(name, "remove");
  if (rejected !== undefined) return rejected;
  const entry = await resolveSkillEntry(root, name);
  if (entry === undefined) return { ok: false, errors: [`skill "${name}" not found`] };
  await deleteSkill(root, entry.entryName, entry.format);
  return { ok: true };
}

/** 设置 skill 启用状态的入参。 */
export interface SetEnabledOptions {
  root: string;
  name: string;
  /**
   * true = 完全启用；false = 完全禁用。
   *
   * DSH 没有单一的"启用键"，调用策略由 frontmatter 的两个扁平布尔表达
   * （`disable-model-invocation` / `user-invocable`）。本操作把它们作为
   * 一个整体：禁用 ⇒ 用户与模型都不可调用；启用 ⇒ 两个键都清除
   * （frontmatter 缺省即双启用，写盘保持最小化，不输出多余的 true/false）。
   */
  enabled: boolean;
}

/** 细粒度调节调用方式的入参。 */
export interface SetInvocationOptions {
  root: string;
  name: string;
  /**
   * 期望的调用策略：模型（agent 自动触发）与用户（输入框 `/name` 口令）
   * 两个方向分别开关。启用的一方对应的 frontmatter 键被清除，禁用的一方
   * 写入对应键，互不干扰；与 {@link setSkillEnabled} 共用同一套读改写逻辑。
   */
  modelInvocable: boolean;
  userInvocable: boolean;
}

/**
 * 细粒度调节 skill 的调用方式：读取原文件，把两个方向（模型 / 用户）的
 * 期望状态整体写回，正文与其它元数据（whenToUse / metadata 等）原样保留。
 *
 * 按方向推导 frontmatter 键（写盘保持最小化）：
 *   - 模型不可调用 ⇒ 写 `disable-model-invocation: true`，可调用则清除该键；
 *   - 用户不可调用 ⇒ 写 `user-invocable: false`，可调用则清除该键。
 */
export async function setSkillInvocation(options: SetInvocationOptions): Promise<{ ok: boolean; errors?: string[] }> {
  const rejected = nameGuard(options.name, "setInvocation");
  if (rejected !== undefined) return rejected;
  const entry = await resolveSkillEntry(options.root, options.name);
  if (entry === undefined) return { ok: false, errors: [`skill "${options.name}" not found`] };
  const parsed = await readSkill(options.root, entry.entryName, entry.format);
  if (parsed === undefined) return { ok: false, errors: [`skill "${options.name}" could not be parsed`] };
  const invocation = {
    ...(options.modelInvocable === true ? {} : { "disable-model-invocation": true }),
    ...(options.userInvocable === true ? {} : { "user-invocable": false }),
  };
  await writeSkill(options.root, entry.entryName, entry.format, { ...parsed.spec, invocation }, parsed.body);
  return { ok: true };
}

/**
 * 一键启用/禁用 skill：整体启停只是细调的两个方向取同值（全开 / 全关），
 * 复用 {@link setSkillInvocation} 的读改写实现。
 */
export async function setSkillEnabled(options: SetEnabledOptions): Promise<{ ok: boolean; errors?: string[] }> {
  return setSkillInvocation({
    root: options.root,
    name: options.name,
    modelInvocable: options.enabled === true,
    userInvocable: options.enabled === true,
  });
}

/** 读取详情的结果。 */
export interface ReadResult {
  ok: boolean;
  errors?: string[];
  spec?: SkillSpec;
  body?: string;
  format?: SkillFormat;
  /** directory 布局下的资源文件列表。 */
  resources?: string[];
  /**
   * 仅注入行（registry fallback）：true = 详情来自宿主技能注册表，
   * 内容只读、没有磁盘文件可写（见 skills/registry.ts）。
   */
  fromRegistry?: true;
  /** 仅注入行：资源浏览的降级说明（url / opaque 基准不可浏览）。 */
  resourceBaseNote?: string;
  /** 详情实际来源的文件绝对路径（registry 命中磁盘条目时透传）。 */
  path?: string;
  /** 业务错误码（见 remote.ts / 架构契约 §7.3）。 */
  code?: string;
}

/**
 * 读取 skill 详情：探测布局 → 解析文件 → （directory 布局）列出资源。
 * 目标缺失或解析失败时返回带错误信息的 ok: false。
 */
export async function readSkillDetail(root: string, name: string): Promise<ReadResult> {
  const rejected = nameGuard<ReadResult>(name, "read");
  if (rejected !== undefined) return rejected;
  const entry = await resolveSkillEntry(root, name);
  if (entry === undefined) return { ok: false, errors: [`skill "${name}" not found`] };
  const parsed = await readSkill(root, entry.entryName, entry.format);
  if (parsed === undefined) return { ok: false, errors: [`skill "${name}" could not be parsed`] };
  const resources = entry.format === "directory" ? await listResources(root, entry.entryName) : [];
  return { ok: true, spec: parsed.spec, body: parsed.body, format: entry.format, resources };
}

/**
 * 列出某个根目录下磁盘上已有的全部 skill（flat 的 `<name>.md` +
 * directory 的 `<name>/SKILL.md`），按名称排序。
 * 根目录不存在视为空列表。
 */
export async function listSkillNames(root: string): Promise<string[]> {
  const entries = await listSkillEntries(root);
  return entries.map((entry) => entry.name);
}

/** 克隆操作的结果。 */
export interface CloneResult {
  ok: boolean;
  errors?: string[];
  path?: string;
}

/**
 * 把 skill 从一个根复制到另一个根（可选改名）。
 * directory 布局会把兄弟资源文件一并复制到目标目录。
 * 注意：此函数目前仅作为公开 API 导出（index.ts），面板 UI 尚未调用。
 */
export async function cloneSkill(fromRoot: string, toRoot: string, name: string, newName?: string): Promise<CloneResult> {
  const rejected = nameGuard<CloneResult>(name, "clone") ?? (newName !== undefined ? nameGuard<CloneResult>(newName, "clone") : undefined);
  if (rejected !== undefined) return rejected;
  const entry = await resolveSkillEntry(fromRoot, name);
  if (entry === undefined) return { ok: false, errors: [`skill "${name}" not found`] };
  const parsed = await readSkill(fromRoot, entry.entryName, entry.format);
  if (parsed === undefined) return { ok: false, errors: [`skill "${name}" could not be parsed`] };

  const targetName = newName ?? name;
  const spec: SkillSpec = { ...parsed.spec, name: targetName };
  await writeSkill(toRoot, targetName, entry.format, spec, parsed.body);

  // 复制 directory 布局下的兄弟资源文件。
  if (entry.format === "directory") {
    const { copyFile } = await import("node:fs/promises");
    const sourceDir = resourceDirectory(fromRoot, entry.entryName);
    const targetDir = resourceDirectory(toRoot, targetName);
    const resources = await listResources(fromRoot, entry.entryName);
    for (const resource of resources) {
      await copyFile(join(sourceDir, resource), join(targetDir, resource));
    }
  }
  return { ok: true, path: skillFilePath(toRoot, targetName, entry.format) };
}