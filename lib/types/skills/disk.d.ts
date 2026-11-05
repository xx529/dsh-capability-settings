/**
 * skill 文件在磁盘上的读写，与文件系统 provider（`dsh-skill-filesystem`）
 * 解析的格式逐字节兼容：
 *
 *   - flat：      <root>/<name>.md            （frontmatter + body）
 *   - directory： <root>/<name>/SKILL.md      （+ 同目录的兄弟资源文件）
 *
 * frontmatter 用 `---` 行包裹的 YAML。调用策略存放在两个扁平布尔键
 * （`disable-model-invocation`、`user-invocable`）上；因为两者缺省都是
 * "启用"，只在取值偏离默认时才输出对应的键，保证落盘文件最小化、
 * 并且读回再写回（round-trip）后内容不膨胀。
 *
 * @module dsh-capability-settings/skills/disk
 */
import type { SkillFormat, SkillSpec } from "./types.js";
/** 一个已解析的 skill：spec（frontmatter 元数据）+ 正文。 */
export interface ParsedSkill {
    spec: SkillSpec;
    body: string;
}
/**
 * 序列化完整的 skill 文件内容（frontmatter 分隔 + YAML + 空行 + 正文）。
 *
 * @param spec skill 元数据
 * @param body 技能正文（写盘前会 trim）
 * @returns 完整的 `<name>.md` / `SKILL.md` 文本
 */
export declare function serializeSkill(spec: SkillSpec, body: string): string;
/**
 * 把 skill 文件文本解析回 spec + 正文。
 *
 * 与 provider 的 `parseFrontmatter` 口径一致：首行必须是 `---`、找到闭合的
 * `---` 行、中间是 YAML map、正文整体 trim。格式非法时返回 `undefined`
 * （调用方据此跳过该条目，而不是抛错中断整个列表）。
 *
 * @param raw skill 文件原文
 * @returns 解析结果；非法输入返回 undefined
 */
export declare function parseSkill(raw: string): ParsedSkill | undefined;
/**
 * 给定格式与根目录，计算 skill 文件路径。
 * flat → `<root>/<name>.md`；directory → `<root>/<name>/SKILL.md`。
 */
export declare function skillFilePath(root: string, name: string, format: SkillFormat): string;
/** directory 布局下该 skill 的资源基准目录（即 `<root>/<name>`）。 */
export declare function resourceDirectory(root: string, name: string): string;
/**
 * 读取一个 skill 文件；文件不存在时返回 `undefined`（不抛错）。
 *
 * @param root skills 根目录
 * @param name 技能名
 * @param format 磁盘布局（决定文件路径）
 * @returns 解析结果；缺失或解析失败返回 undefined
 */
export declare function readSkill(root: string, name: string, format: SkillFormat): Promise<ParsedSkill | undefined>;
/**
 * 写入一个 skill 文件。
 *
 * 采用"临时文件 + rename"的原子写入（shared/atomic-write.ts），避免写一半
 * 留下残缺文件；目录布局会自动创建父目录。写操作按文件加锁（shared/file-lock
 * 的 withFileLock），与 mcp 域的写路径同一口径：
 * 多面板标签页并发写同一 skill 时串行化，避免互相覆盖。
 *
 * @returns 实际写入的文件绝对路径
 */
export declare function writeSkill(root: string, name: string, format: SkillFormat, spec: SkillSpec, body: string): Promise<string>;
/** 删除一个 skill：directory 连资源目录一起递归删，flat 只删文件。 */
export declare function deleteSkill(root: string, name: string, format: SkillFormat): Promise<void>;
/**
 * 通过探测磁盘判断某个名字的 skill 属于哪种布局：
 * 先看 `<name>.md` 是否为文件（flat），再看 `<name>/SKILL.md`（directory）。
 * 都不存在则返回 undefined。
 */
export declare function detectFormat(root: string, name: string): Promise<SkillFormat | undefined>;
/** 一次 readdir（withFileTypes）同时得出每个 skill 的名称与磁盘布局。 */
export interface SkillEntry {
    name: string;
    format: SkillFormat;
}
/**
 * 单趟扫描磁盘列出技能：用 `withFileTypes` 区分文件/目录，省掉
 * `detectFormat` 对每个名字的多次 stat。
 *
 * 与 {@link detectFormat} 的判定口径一致：`<name>.md` 文件优先（flat），
 * 其次 `<name>/SKILL.md` 目录（directory）；同名两者并存时 flat 优先。
 */
export declare function listSkillEntries(root: string): Promise<SkillEntry[]>;
/** frontmatter 名称到磁盘条目的解析结果。 */
export interface ResolvedSkillEntry {
    /** 磁盘条目名（flat 为 `<entryName>.md`，directory 为 `<entryName>/`）。 */
    entryName: string;
    format: SkillFormat;
}
/**
 * 把 skill 的 **frontmatter 名称**解析成磁盘条目。
 *
 * 受管布局以 `<name>.md` / `<name>/SKILL.md` 为约定，但宿主注册技能时以
 * frontmatter `name` 为权威名称，目录/文件名可以不同（`skill-filesystem`
 * 的发现口径）。面板列表用 frontmatter 名称展示，因此所有「按名称找磁盘
 * 路径」的读写入口都必须先过这里，否则名称与条目名不一致时会误报 not
 * found（宿主 fallback 在无 agent 作用域的面板里看不到磁盘技能）。
 *
 * 快路径：名称即条目名（常规布局，行为与 detectFormat 一致）。
 * 慢路径：扫描根目录，按 SKILL.md / `<file>.md` 的 frontmatter name 匹配，
 * 与 {@link listSkillEntries} + 解析的口径一致。
 *
 * @param root 受管 skills 根目录
 * @param name frontmatter 名称
 * @returns 条目名与布局；根下没有该技能返回 undefined
 */
export declare function resolveSkillEntry(root: string, name: string): Promise<ResolvedSkillEntry | undefined>;
/**
 * 列出 directory 布局 skill 下的兄弟资源文件（排除 SKILL.md 本身）。
 * 目录缺失或不可读时返回空数组。
 */
export declare function listResources(root: string, name: string): Promise<string[]>;
