/**
 * 技能详情的「文件 + 阅读器」内容区（本版新增）。
 *
 * 数据来源：现有 `skills.export` RPC（`exportFiles`）——它已递归返回技能目录
 * 下全部普通文件的相对路径 + base64 内容，因此**宿主不新增 RPC**：
 *   - 打开技能时拉一次全量清单 → base64 解码 → 前端建树；切换文件 0 请求；
 *   - `SKILL.md` 恒置顶并默认选中；flat 格式（单 `.md`）隐藏文件树、阅读器占满；
 *   - 目录 200 文件、树深 3 层硬上限；单文件预览 256 KB 截断；
 *   - 二进制 / 非 UTF-8 不渲染正文，显示类型 + 大小 + 下载；空文件给提示。
 *
 * 预览走零依赖的 `markdown.tsx`（L1，React 元素树，无
 * `dangerouslySetInnerHTML`）；解析器异常时回落到 `<pre>` 原文。
 *
 * 窄容器降级（按内容区实测宽度，见 UX §4.5）：≥732 文件树 220；632–731
 * 文件树 200；<632 折叠为「文件 (N)」下拉，阅读器占满。
 *
 * @module @chengdb/capability-panel/client/skill-content
 */
import type { ClientSkillSummary, SkillRef, SkillsApi } from "./api.js";
/** 组装一行的寻址入参：优先用宿主给的受管根；root 缺失时按 source 退化。 */
export declare function skillRefOf(summary: ClientSkillSummary): SkillRef;
/** 字节数 → 人类可读大小（1 位小数，去掉多余的 .0）。 */
export declare function formatSize(bytes: number): string;
/** 路径后缀 → 类型徽标（MD / JSON / PNG…；无后缀显示 FILE）。 */
export declare function fileTypeLabel(path: string): string;
/**
 * 内容区组件：文件树 + 阅读器。
 *
 * `refreshKey` 变化（父级的写操作版本号）时丢弃已拉取清单并重拉——写操作
 * 可能改变目录内容（导入 / 删除），因此不做「切文件不请求」之外的缓存。
 */
export declare function SkillContent({ summary, api, refreshKey, }: {
    summary: ClientSkillSummary;
    api: SkillsApi;
    /** 父级写操作计数：变化即重置缓存并重新拉取文件清单。 */
    refreshKey: number;
}): import("react").JSX.Element;
