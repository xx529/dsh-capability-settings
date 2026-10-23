/**
 * 「Jev 模型」配置页（能力面板第三个域 Tab）。
 *
 * 纯客户端表单：配置读写、密钥掩码、测试连接全部走 `api.jev.*`（宿主进程
 * 持有密钥并发请求，浏览器永不接触明文，见架构 §4）。三块内容：
 *   1. Base URL / 模型名 / API Key 来源（直接填写 | 环境变量）；
 *   2. 「能力决策」区：自动评分开关 + 三个门槛（停顿阈值 / 最少触发字数 /
 *      最少修改间隔字符数）
 *   3. 测试连接 / 恢复默认 / 保存（保存成功**不关闭、不跳转**）。
 *
 * 关键约定（评审 checklist）：
 *   - 保存校验本地先做一遍（范围 / 必填 / 格式），失败不发 RPC；宿主返回的
 *     `issues` 再落到同一批行内错误上（双保险）。
 *   - 密钥只单向下发：输入框为空且已有文件密钥时提交**不带** `apiKey` 字段
 *     （避免把掩码写回文件）；切到「环境变量」保存时提交 `apiKey: ""` 让宿主
 *     删除文件密钥（架构 §3.6）。
 *   - 未保存草稿在**同一面板会话内**切 Tab 不丢：本组件由 panel.tsx 常驻挂载，
 *     用 `active` 控制显隐，不随切 Tab 卸载（AC-CFG-16）。
 *   - 测试连接按 RPC 契约使用**已保存配置**（`jev.test` payload 被忽略，
 *     架构 §5.3）；表单有未保存修改时结果行会注明。
 *
 * @module @chengdb/capability-panel/client/jev-panel
 */
import type { CapabilityPanelApi } from "./api.js";
/**
 * 配置保存成功的全局事件名（F3 修复的发送端）。
 *
 * hero 的 `jev.getConfig` 只在挂载时读一次；配置页保存成功后广播该事件，
 * composer 侧（task-25）监听后重新读取配置，使「未配置」蓝点 / 自动触发门槛
 * 在同一挂载内即时更新。事件不带 detail（监听方自行 `getConfig`）。
 */
export declare const JEV_CONFIG_CHANGED_EVENT = "capability-panel:jev-config-changed";
/**
 * 配置页本体。
 *
 * `active` 只控制显隐：切换域 Tab 时组件**不卸载**，未保存草稿因此保留
 * （AC-CFG-16）；关闭能力面板后整棵子树卸载，草稿按 UX 丢弃。
 */
export declare function JevPanel({ api, active }: {
    api: CapabilityPanelApi;
    active: boolean;
}): import("react").JSX.Element;
