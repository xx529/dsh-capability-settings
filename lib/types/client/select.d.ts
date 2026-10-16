/**
 * 自绘下拉框（替代原生 <select>——原生的选项列表由浏览器渲染，
 * 无法定制样式，视觉与面板其余部分不一致）。
 *
 * 结构：触发按钮（.skp-dd-btn，带雪佛龙箭头）+ fixed 定位的弹出列表
 * （.skp-dd-pop）。弹出层用 getBoundingClientRect 锚定到按钮下方，因此不受
 * 父级 overflow:auto（如模态框）裁剪；列表项支持禁用、右侧 hint 与选中对勾。
 *
 * **视口钳制**（工作区很多时必须，否则列表会顶出屏幕）：打开时按按钮位置算
 * 出下方/上方可用空间，取宽裕的一侧展开（下方放不下"舒适高度"且上方更宽裕
 * 时向上弹），高度再夹在 [POP_MIN_HEIGHT, POP_MAX_HEIGHT] 内；水平方向按视口
 * 宽度钳制 `left`，并在渲染后用弹出层的实测宽度二次修正，保证右边缘不出屏。
 *
 * 关闭时机：点击组件外部（capture 阶段判定）、Esc、窗口缩放。**列表内部的
 * 滚动不关闭**（否则工作区一多就无法滚动选择），但页面/面板容器的滚动会关闭。
 *
 * @module @chengdb/capability-panel/client/select
 */
/** 下拉选项：value 为提交值，label 为展示文案，hint 为右侧弱化补充。 */
export interface SkpSelectOption {
    value: string;
    label: string;
    hint?: string;
    disabled?: boolean;
}
/**
 * 扁平风格下拉框。
 *
 * `className` 追加在根节点上（如头部作用域选择器的 `skp-dd-scope`
 * 限宽；表单字段内由 `.skp-field .skp-dd` 撑满整行）。
 */
export declare function SkpSelect({ value, options, onChange, disabled, ariaLabel, title, className, }: {
    value: string;
    options: SkpSelectOption[];
    onChange(value: string): void;
    disabled?: boolean;
    ariaLabel?: string;
    title?: string;
    className?: string;
}): import("react").JSX.Element;
