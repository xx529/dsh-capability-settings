/**
 * Skills 三层默认值的**纯计算**（全局默认 → 工作区显式 → 会话显式）。
 *
 * 存储位置（见 `overrides/*`）：
 *
 *   - 全局默认关闭名单：`<dshHome>/dsh-capability-settings/capability-global-overrides.json`
 *     的 `skills: string[]`（B2 新增层）；
 *   - 工作区覆盖：同一 dsh home 下 `capability-overrides.json` 里
 *     `projects.<项目根>.skills`（本项目关闭）与 `.enabledSkills`
 *     （本项目重新打开，可覆盖全局默认）。
 *
 * 有效默认（契约 §1.3）：
 *
 * ```
 * effectiveDefault = projectEnabled
 *                      ? true
 *                      : (projectDisabled || globalDisabled) ? false : true
 * effectiveDisabled = (global.skills ∪ project.skills) \ project.enabledSkills
 * ```
 *
 * 两条不变量：
 *
 *   1. 同一名字**不同时**出现在项目 `skills` 与 `enabledSkills`（读取时规范化，
 *      写路径保证）。契约 §1.2 的「禁用优先」由这条规范化落地；
 *   2. 本模块不读文件、不碰宿主服务，只看集合，供面板列表与运行时投影共用，
 *      避免两处各算一套口径。
 *
 * 会话显式开关（`skills/session.ts`）仍最后覆盖本结果：`session explicit > 本模块`。
 *
 * @module dsh-capability-settings/shared/skill-defaults
 */

/** 三层默认值的集合快照（只读；调用方不得原地修改）。 */
export interface SkillDefaultSets {
  /** 全局默认关闭名单（`capability-global-overrides.json` 的 `skills`）。 */
  globalDisabled: ReadonlySet<string>;
  /** 本项目显式重新打开的名单（`projects.<根>.enabledSkills`）。 */
  projectEnabled: ReadonlySet<string>;
  /** 本项目关闭的名单（`projects.<根>.skills`）。 */
  projectDisabled: ReadonlySet<string>;
}

/** 全空快照（无项目 / 无配置时的默认值）。 */
export const EMPTY_SKILL_DEFAULT_SETS: SkillDefaultSets = {
  globalDisabled: new Set<string>(),
  projectEnabled: new Set<string>(),
  projectDisabled: new Set<string>(),
};

/** 面板 / 会话列表行上的四个默认态字段（契约 §2.2）。 */
export interface SkillDefaultFlags {
  /** 名字在全局默认关闭名单里。 */
  globalDefaultDisabled: boolean;
  /** 名字在本项目 `enabledSkills` 里（重新打开）。 */
  projectDefaultEnabled: boolean;
  /** 名字在本项目 `skills` 里（关闭）。 */
  projectDefaultDisabled: boolean;
  /** 按契约 §1.3 计算的有效默认（面板开关显示用）。 */
  effectiveDefaultEnabled: boolean;
}

/**
 * 由原始名单构造集合快照，并强制「禁用优先」不变量：
 * `enabledSkills` 里与 `skills` 同名的条目被剔除。
 *
 * 空数组 / undefined 都当作空名单；名字原样保留（规范化 / trim 在写读层完成）。
 *
 * @param input.globalSkills 全局默认关闭名单
 * @param input.projectSkills 本项目关闭名单
 * @param input.projectEnabledSkills 本项目重新打开名单
 * @returns 三层集合快照
 */
export function skillDefaultSets(input: {
  globalSkills?: readonly string[];
  projectSkills?: readonly string[];
  projectEnabledSkills?: readonly string[];
}): SkillDefaultSets {
  const projectDisabled = new Set((input.projectSkills ?? []).filter((name) => name.length > 0));
  const projectEnabled = new Set(
    (input.projectEnabledSkills ?? []).filter((name) => name.length > 0 && !projectDisabled.has(name)),
  );
  return {
    globalDisabled: new Set((input.globalSkills ?? []).filter((name) => name.length > 0)),
    projectEnabled,
    projectDisabled,
  };
}

/**
 * 有效默认关闭集合：`(global ∪ projectDisabled) \ projectEnabled`。
 *
 * @param sets 三层集合快照
 * @returns 新的可变集合（调用方可自行增删）
 */
export function effectiveDisabledSkills(sets: SkillDefaultSets): Set<string> {
  const out = new Set<string>(sets.globalDisabled);
  for (const name of sets.projectDisabled) out.add(name);
  for (const name of sets.projectEnabled) out.delete(name);
  return out;
}

/**
 * 单个名字的四个默认态字段（契约 §1.3 / §2.2）。
 *
 * @param sets 三层集合快照
 * @param name 技能名
 * @returns 行字段
 */
export function skillDefaultFlags(sets: SkillDefaultSets, name: string): SkillDefaultFlags {
  const globalDefaultDisabled = sets.globalDisabled.has(name);
  const projectDefaultEnabled = sets.projectEnabled.has(name);
  const projectDefaultDisabled = sets.projectDisabled.has(name);
  const effectiveDefaultEnabled = projectDefaultEnabled
    ? true
    : projectDefaultDisabled || globalDefaultDisabled
      ? false
      : true;
  return { globalDefaultDisabled, projectDefaultEnabled, projectDefaultDisabled, effectiveDefaultEnabled };
}

/**
 * 给列表行附加四个默认态字段（不修改入参，返回新对象）。
 *
 * @param rows 带 `name` 的行（磁盘 summary / 会话 summary 均可）
 * @param sets 三层集合快照
 * @returns 附加字段后的新行数组
 */
export function annotateSkillDefaults<T extends { name: string }>(
  rows: readonly T[],
  sets: SkillDefaultSets,
): Array<T & SkillDefaultFlags> {
  return rows.map((row) => ({ ...row, ...skillDefaultFlags(sets, row.name) }));
}
