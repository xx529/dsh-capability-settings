/**
 * capability-panel 的客户端插件入口。
 *
 * 发布后的 bundle 会把本模块包裹进
 * `window.__ModuleLoader__.load({ id, factory })`（由 tsdown 生成，平台模块
 * 外部化）；这里的源码只导出 `inject` 与 `apply`。
 *
 * 面板入口位于**侧栏上方**（ui-sidebar 的「全局面板」图标排
 * `sidebar.panellist`，在工作区列表之上、Settings 页脚之上）：注册
 * `{ id: 'capability-panel', order: 30 }` 与图标本体，同时把同名 key 注册进
 * `main` keyed slot——侧栏点击时把主区域切到该 key，面板因此**占据主区域**
 * 而不是弹出浮层（与 plugins / schedules / dsh-context 同构）。两个注册必须
 * 成对：侧栏选择没有对应 main 条目的 id 会抛错。纯增量——不遮蔽任何内置 UI，
 * 也不绑定任何 session。
 *
 * **本文件持有两份 api（务必保持分开，见下方 `composerApi` 的注释）**：
 * 带项目钉选的 `api` 只给面板用；composer（输入框工具行）用只跟随当前会话
 * 工作区的 `composerApi`。
 *
 * @module dsh-capability-settings/client
 */
/** 客户端强依赖的服务。 */
export declare const inject: string[];
/**
 * 客户端插件主体：注入样式、注册 locale、构造传输适配器、注册侧栏入口。
 */
export declare function apply(ctx: any): void;
