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
 * @module @chengdb/capability-panel/client
 */

import { createElement } from "react";
import { createPanelApi } from "./client/api-adapter.js";
import { installStyles } from "./client/styles.js";
import { CapabilityPanelNavIcon, CapabilityPanelPage } from "./client/panel-entry.js";
import { ComposerMcpButton, ComposerMcpOverlay } from "./client/composer-mcp.js";
import { ComposerSkillsButton, ComposerSkillsOverlay } from "./client/composer-skills.js";
import { ComposerQuickButton, ComposerQuickOverlay } from "./client/composer-quick.js";

/** locale 字典的命名空间。 */
const NS = "capabilityPanel";

/**
 * 简体中文词典。
 * 注意：当前面板组件直接使用硬编码文案（见 panel.tsx / mcp-panel.tsx /
 * quick-messages-panel.tsx），这组 dictionary 注册后暂无组件读取，属于
 * 后续接入本地化的预留脚手架，两边内容暂时一致。
 */
const zh = {
  "panel.title": "能力面板",
  "panel.domain.skills": "技能",
  "panel.domain.mcp": "MCP",
  "panel.scope.all": "全部",
  "panel.scope.project": "项目",
  "panel.scope.global": "全局",
  "panel.search": "搜索…",
  "panel.loading": "加载中…",
  "panel.empty": "没有匹配项。",
  "panel.readonly": "只读",
  "panel.none": "（无工作区）",
};

/** 英文词典，键集合与 zh 完全一致（类型上互相约束，防止漏键）。 */
const en: Record<keyof typeof zh, string> = {
  "panel.title": "Capabilities",
  "panel.domain.skills": "Skills",
  "panel.domain.mcp": "MCP",
  "panel.scope.all": "All",
  "panel.scope.project": "Project",
  "panel.scope.global": "Global",
  "panel.search": "Search…",
  "panel.loading": "Loading…",
  "panel.empty": "Nothing matches.",
  "panel.readonly": "Read-only",
  "panel.none": "(no workspace)",
};

/** 客户端强依赖的服务。 */
export const inject = ["connection", "slots", "locale", "workspaces"];

/**
 * 客户端插件主体：注入样式、注册 locale、构造传输适配器、注册侧栏入口。
 */
export function apply(ctx: any) {
  const disposers: Array<() => void> = [];
  disposers.push(installStyles());

  // 注册 locale 词典（命名空间隔离，见上方注释——目前为预留脚手架）。
  if (ctx.locale?.register) {
    disposers.push(ctx.locale.register(NS, { zh, en }));
  }

  // 构建传输无关的面板 API（CapabilityPanelApi）。面板可以在头部下拉框里
  // 钉选一个项目（selection.cwd）；未钉选时，"project" 作用域跟随当前
  // session 的工作区，其次是最新使用过的工作区。**这份 api 只给面板用**，
  // composer 见下面的 composerApi。
  const workspaceListeners = new Set<() => void>();
  const notifyWorkspaceListeners = () => {
    for (const listener of workspaceListeners) {
      try {
        listener();
      } catch {
        /* 单个监听器的失败不能影响其它监听器 */
      }
    }
  };
  // 钉选状态：cwd 为 undefined 表示"跟随当前 session / 最近工作区"。
  const selection: { cwd: string | undefined } = { cwd: undefined };
  /** 两个 api 共用同一份订阅集合（各自订阅时都进这里）。 */
  const subscribeWorkspace = (listener: () => void) => {
    workspaceListeners.add(listener);
    return () => {
      workspaceListeners.delete(listener);
    };
  };
  const api = createPanelApi({
    rpc: ctx.get("connection")?.rpc,
    currentWorkspaceCwd: () => selection.cwd ?? currentWorkspaceCwd(ctx),
    subscribeWorkspace,
    listProjects: () => listWorkspaceOptions(ctx),
    selectedProject: () => selection.cwd,
    selectProject: (path) => {
      if (selection.cwd === path) return;
      selection.cwd = path;
      notifyWorkspaceListeners();
    },
  });

  // composer（输入框工具行：快捷消息 / Skills / MCP 三个按钮与弹层）专用
  // 实例：项目作用域**只跟随当前会话自己的工作区**，永远不读面板的钉选
  // 状态 `selection.cwd`。否则在面板里把「项目作用域」钉到 A 工作区后，B
  // 工作区的对话框弹层会列出 A 的项目级技能/MCP（串味 bug）。
  // 订阅回调集合与上面那份共用（subscribeWorkspace），所以两边都会随会话
  // 工作区切换刷新；`selectedProject` / `selectProject` 恒为空操作——composer
  // 不提供钉选入口。
  const composerApi = createPanelApi({
    rpc: ctx.get("connection")?.rpc,
    currentWorkspaceCwd: () => currentWorkspaceCwd(ctx),
    subscribeWorkspace,
    listProjects: () => listWorkspaceOptions(ctx),
    selectedProject: () => undefined,
    selectProject: () => {
      /* composer 不钉选项目：项目作用域恒跟随当前会话 */
    },
  });

  // sessions / workspaces 的基线都是异步解析的 SnapshotStore，所以订阅图
  // 变化：当解析出的 cwd（或工作区列表本身）变化时重新读取两份快照并
  // 通知面板（下拉框选项要跟着新增/移除的工作区刷新，不只是 cwd 移动；
  // 钉选状态下的通知同样是为了刷新下拉框选项）。只有快照内容真正变化
  // 时才通知，避免无意义的重渲染。
  //
  // 这里跟踪**两个** cwd：面板侧的（钉选优先）与 composer 侧的（纯会话）。
  // 面板钉选到 A 时 session 从 B 切到 C，面板侧没变、但 composer 侧变了，
  // 仍必须通知，否则 composer 会继续显示 B 的项目级内容。
  let lastPanelCwd = selection.cwd ?? currentWorkspaceCwd(ctx);
  let lastSessionCwd = currentWorkspaceCwd(ctx);
  let lastItemsKey = workspaceItemsKey(ctx);
  const onGraphChange = () => {
    const sessionCwd = currentWorkspaceCwd(ctx);
    const panelCwd = selection.cwd ?? sessionCwd;
    const itemsKey = workspaceItemsKey(ctx);
    if (panelCwd === lastPanelCwd && sessionCwd === lastSessionCwd && itemsKey === lastItemsKey) return;
    lastPanelCwd = panelCwd;
    lastSessionCwd = sessionCwd;
    lastItemsKey = itemsKey;
    notifyWorkspaceListeners();
  };
  const unsubSessions = ctx.get("sessions")?.list?.subscribe?.(onGraphChange);
  const unsubWorkspaces = ctx.get("workspaces")?.list?.subscribe?.(onGraphChange);
  if (typeof unsubSessions === "function") disposers.push(unsubSessions);
  if (typeof unsubWorkspaces === "function") disposers.push(unsubWorkspaces);

  // 注册侧栏上方（工作区列表之上）的全局面板入口 + 主区域页面。
  //
  // `sidebar.panellist`（kind list、root 作用域）是 ui-sidebar 的「全局
  // 面板」图标排：侧栏自己渲染按钮、tooltip、aria-label、折叠提示与 label
  // 文本（从注册元数据解析），并把注册组件渲染成图标（owner props
  // `{ size, active }`，见 panel-entry.tsx）。我们只给元数据 + 图标本体。
  // order 30 排在 dsh-context（20）之后。
  //
  // `main`（kind keyed、root 作用域）用同一个 id 作为 key：侧栏点击入口时
  // 布局把主区域切到这个 key 的组件。**两者必须成对注册**——侧栏选择没有
  // 对应 main 条目的 id 会抛错。组件不消费 main 槽注入的 standardProps，
  // 只接面板自己的 api（带项目钉选的那份）。
  if (ctx.slots?.inject && ctx.slots.register) {
    const disposeMain = ctx.slots.inject("main", () =>
      ctx.slots.register({ name: "main", key: "capability-panel" }, () => CapabilityPanelPage({ api })),
    );
    if (typeof disposeMain === "function") disposers.push(disposeMain);

    const disposePanellist = ctx.slots.inject("sidebar.panellist", () =>
      ctx.slots.register({ name: "sidebar.panellist", id: "capability-panel", order: 30, label: "能力面板" }, (props: { size?: number; active?: boolean }) =>
        CapabilityPanelNavIcon({ size: props?.size, active: props?.active }),
      ),
    );
    if (typeof disposePanellist === "function") disposers.push(disposePanellist);
  }

  // 输入框工具行的能力工具组：快捷消息（见 composer-quick.tsx）、
  // Skills 快捷输入（见 composer-skills.tsx）与 MCP 快捷开关（见
  // composer-mcp.tsx）三个按钮合并在同一个 `conversation.input.left` 条目里
  // （圆角容器 + 2px 间距，视觉上是一个按钮组），顺序与面板域 Tab 一致：
  // 快捷消息 / Skills / MCP。按钮从 owner props（InputZone）读 input
  // 草稿快照；三个弹层仍分别注册在 `conversation.input.overlay`，开合状态
  // 各自独立、外部点击互斥关闭。Skills 与快捷消息弹层从 session 标准套件
  // 读 useInput / inputActions：Skills 点击某行把 `/name ` 追加进草稿（宿主
  // ui-skill '/' 源的同款口令形式），快捷消息点击把正文追加进草稿。
  // 三个按钮与三个弹层一律用 `composerApi`（只跟随当前会话工作区，不含
  // 面板的钉选），切勿换回上面的 `api`——那会造成跨工作区串味。
  if (ctx.slots?.inject && ctx.slots.register) {
    const disposeTools = ctx.slots.inject("conversation.input.left", () =>
      ctx.slots.register({ name: "conversation.input.left", id: "capability-panel-tools", order: 10, label: "能力工具" }, (props: any) =>
        createElement(
          "div",
          { className: "skp-composer-tools" },
          ComposerQuickButton(),
          ComposerSkillsButton({ api: composerApi, draft: typeof props?.input?.draft === "string" ? props.input.draft : "" }),
          ComposerMcpButton({ api: composerApi }),
        ),
      ),
    );
    if (typeof disposeTools === "function") disposers.push(disposeTools);
    const disposeSkillsOverlay = ctx.slots.inject("conversation.input.overlay", () =>
      ctx.slots.register({ name: "conversation.input.overlay", id: "capability-panel-skills", order: 5, label: "Skills" }, (props: any) =>
        ComposerSkillsOverlay({
          api: composerApi,
          useInput: typeof props?.useInput === "function" ? props.useInput : undefined,
          inputActions: typeof props?.inputActions?.setDraft === "function" ? props.inputActions : undefined,
        }),
      ),
    );
    if (typeof disposeSkillsOverlay === "function") disposers.push(disposeSkillsOverlay);

    // 快捷消息的弹层（按钮已并入上方"能力工具"组条目）：同样注册在
    // `conversation.input.overlay`，与 Skills 弹层共用 session 标准套件的
    // useInput / inputActions。
    const disposeQuickOverlay = ctx.slots.inject("conversation.input.overlay", () =>
      ctx.slots.register({ name: "conversation.input.overlay", id: "capability-panel-quick", order: 7, label: "快捷消息" }, (props: any) =>
        ComposerQuickOverlay({
          api: composerApi,
          useInput: typeof props?.useInput === "function" ? props.useInput : undefined,
          inputActions: typeof props?.inputActions?.setDraft === "function" ? props.inputActions : undefined,
        }),
      ),
    );
    if (typeof disposeQuickOverlay === "function") disposers.push(disposeQuickOverlay);

    // MCP 快捷开关的弹层（按钮已并入上方"能力工具"组条目）：同样注册在
    // `conversation.input.overlay`。开合状态由 composer-mcp 模块内的微存储
    // 跨两棵 React 树共享。
    const disposeOverlay = ctx.slots.inject("conversation.input.overlay", () =>
      ctx.slots.register({ name: "conversation.input.overlay", id: "capability-panel-mcp", order: 10, label: "MCP 服务器" }, () =>
        ComposerMcpOverlay({ api: composerApi }),
      ),
    );
    if (typeof disposeOverlay === "function") disposers.push(disposeOverlay);
  }

  ctx.effect?.(() => () => {
    for (const dispose of disposers) dispose();
  }, "capability-panel: client");
}

/**
 * 推导当前活动的工作区目录（若存在）。
 *
 * 最高保真来源是当前 session 自己的工作目录（`sessions.list` →
 * `byId[current].cwd`）；session 存在但还没有 cwd 时，回退到包含它的
 * Workspace；没有当前 session 时（例如从 hero 屏打开设置）用最近活跃的
 * workspace，再退到第一个注册的 workspace。
 *
 * 注意：workspaces 快照在 `workspaces.list`（SnapshotStore）上——服务本身
 * 没有 getSnapshot，且没有 `current` 字段；它暴露 `items` /
 * `recentWorkspaceId` / `baselinesReady`。
 */
function currentWorkspaceCwd(ctx: any): string | undefined {
  let current: string | undefined;
  try {
    const sessions = ctx.get("sessions");
    const snap = sessions?.list?.getSnapshot?.();
    current = snap?.current;
    if (typeof current === "string") {
      const cwd = snap?.byId?.[current]?.cwd;
      if (typeof cwd === "string" && cwd.length > 0) return cwd;
    }
  } catch {
    /* sessions 服务可能缺席 */
  }
  try {
    const workspaces = ctx.get("workspaces");
    const items: Array<{ workspaceId: string; path?: string; sessionIds?: string[] }> =
      workspaces?.list?.getSnapshot?.()?.items ?? [];
    if (typeof current === "string") {
      const owned = items.find((w) => w.sessionIds?.includes?.(current));
      if (owned?.path) return owned.path;
    }
    const recent = workspaces?.list?.getSnapshot?.()?.recentWorkspaceId;
    if (typeof recent === "string") {
      const item = items.find((w) => w.workspaceId === recent);
      if (item?.path) return item.path;
    }
    return items[0]?.path;
  } catch {
    return undefined;
  }
}

/** 读取已知工作区，供面板的项目下拉框使用。 */
function listWorkspaceOptions(ctx: any): Array<{ id: string; path: string; title?: string }> {
  try {
    // WorkspaceRuntime.list 是 SnapshotStore——服务本身没有 getSnapshot
    // （早期直接调 `workspaces.getSnapshot()` 正是下拉框为空的 bug 根源）。
    const items: Array<{ workspaceId?: string; path?: string; title?: string }> =
      ctx.get("workspaces")?.list?.getSnapshot?.()?.items ?? [];
    return items
      .filter((w) => typeof w.path === "string" && w.path.length > 0)
      .map((w) => ({
        id: String(w.workspaceId ?? w.path),
        path: w.path as string,
        ...(typeof w.title === "string" && w.title.length > 0 ? { title: w.title } : {}),
      }));
  } catch {
    return [];
  }
}

/** 工作区列表的廉价变更检测键（用于判断是否需要刷新下拉框）。 */
function workspaceItemsKey(ctx: any): string {
  return listWorkspaceOptions(ctx)
    .map((o) => `${o.id}:${o.path}:${o.title ?? ""}`)
    .join("|");
}