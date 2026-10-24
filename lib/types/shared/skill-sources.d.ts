/**
 * skill 来源（source）的作用域分类——宿主端（skills/manager.ts）与客户端
 * （panel-common.tsx / panel.tsx）共用的单一事实源，避免两端各自维护一份
 * 来源清单而在新增来源时 drift。
 *
 *   - 项目系：project-dsh / project-agents / project-claude，外加历史遗留的
 *     `custom`（rank 介于项目与全局之间，面板分组口径一直把它归入项目侧）；
 *   - 全局系：user-dsh / user-agents / user-claude；
 *   - `bundled` 两侧都不归（只读内置条目，不进面板的磁盘视图）；
 *   - `external` 两侧都不归：宿主 registry 注入条目（内置/插件/preset），
 *     由 `injected` / `origin` / `channel` 单独渲染，不参与磁盘分区的写权限判断。
 *
 * @module dsh-capability-settings/shared/skill-sources
 */
/** source 是否属于"项目系"（决定面板「项目」区归属，composer 弹层的分组口径与此一致）。 */
export declare function isProjectSkillSource(source: string): boolean;
/** source 是否属于"全局系"（决定面板「全局」区归属与归属徽标着色）。 */
export declare function isGlobalSkillSource(source: string): boolean;
/** source 是否为宿主 registry 注入条目（既非项目也非全局，内容只读）。 */
export declare function isInjectedSkillSource(source: string): boolean;
