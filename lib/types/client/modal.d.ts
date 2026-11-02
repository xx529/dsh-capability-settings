/**
 * 轻量模态框外壳：点遮罩关闭，点内容不穿透。
 *
 * 供 Skills 安装（panel.tsx）与 MCP 添加（mcp-panel.tsx）等弹窗场景共用；
 * 样式见 styles.ts 的 `skp-modal-overlay` / `skp-modal`。
 *
 * v21：支持可选 **固定头 / 固定底**（`header` / `footer`）——传入后弹层改为
 * 「标题 + 固定头 + 内容滚动区 + 固定底栏」结构，底部按钮不随内容滚动；
 * 不传时保持旧结构（整块内容滚动），既有弹窗行为不变。
 *
 * @module dsh-capability-settings/client/modal
 */
import type { ReactNode } from "react";
/** 模态框外壳：标题 + 内容；点遮罩关闭（内容区点击已拦截）。 */
export declare function Modal({ title, children, header, footer, onClose, }: {
    title: string;
    children: ReactNode;
    /** 可选：固定头（不随内容滚动），如可见性弹层的模式分段 + 说明。 */
    header?: ReactNode;
    /** 可选：固定底栏（不随内容滚动），如「取消 / 保存」。传入后内容区独立滚动。 */
    footer?: ReactNode;
    onClose: () => void;
}): import("react").JSX.Element;
