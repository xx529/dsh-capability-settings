/**
 * Prompt 域（首轮注入的指令文件）的共享类型。
 *
 * 语义边界（与宿主 `@deepseek-ai/dsh-agent-instructions` 对齐）：
 *
 *   - 候选 = 全局 `$DSH_HOME/AGENTS.md`、`$DSH_AGENTS_HOME/AGENTS.md`，以及
 *     项目根（向上找 `.git`）到会话 cwd 每层的 `AGENTS.md` / `CLAUDE.md` +
 *     `AGENTS.local.md` / `CLAUDE.local.md`；
 *   - 全局与项目是**叠加注入**（不是覆盖）：每个文件独立启用，全部按顺序交给
 *     宿主渲染；只有同一候选组内容重复时由宿主去重；
 *   - 本插件**不自行拼接 / 去重 / 算预算**：渲染交给宿主导出的
 *     `loadBaselineInstructions`，我们只控制「传哪些文件给它」。
 *
 * @module dsh-capability-settings/prompt/types
 */
export {};
