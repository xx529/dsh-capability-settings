/**
 * `react-dom` 的最小类型声明。
 *
 * 本插件只用到 `createPortal`（「查看全部」弹层挂到 `document.body`，避免被面板容器
 * 的 overflow / transform 裁切）。运行期 `react-dom` 是客户端的 external 依赖，
 * 仓库没有安装 `@types/react-dom`（避免为一个函数引入整包类型依赖）。
 *
 * @module dsh-capability-settings/client/react-dom
 */

declare module "react-dom" {
  import type { ReactNode } from "react";

  /** 把子树挂到 `container` 下，事件仍按 React 树冒泡。 */
  export function createPortal(children: ReactNode, container: Element | DocumentFragment): ReactNode;
}
