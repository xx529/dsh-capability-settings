/**
 * 00-inspect.js — v12 落地前的**只读**结构勘察（贴进 use_figma 执行，不改画布）。
 *
 * 目的：把 4 个待打补丁的基线节点（v8 两帧技能页 + v11 04 结果帧）与 2 个 v12 参考帧
 * 的层级/名称/坐标导出成紧凑 JSON，供 apply-baseline.js 精确对齐。
 *
 * 目标：
 *   v8  page 42:3373  frame 42:3376（01 · 技能 · 项目）/ 42:3433（02 · 技能 · 全局）
 *   v11 page 56:7043  frame 56:7679（04 · 能力决策 · 结果）
 *   v12 page 88:8519  frame 88:8523（技能全局参考）/ 88:9011（决策结果参考）
 *
 * 返回：{ frames: [{ id, name, w, h, children: [节点摘要...] }] }
 *   - 节点摘要只到 2 层（足够定位），带 name / type / x / y / w / h / characters（文本）
 *   - 总字符量受控（每帧最多 ~420 条），不会撑爆工具输出
 */
await figma.loadAllPagesAsync();

const TARGETS = [
  "42:3376", // v8 01 技能·项目
  "42:3433", // v8 02 技能·全局
  "56:7679", // v11 04 能力决策·结果
  "88:8523", // v12 01 技能全局（参考）
  "88:9011", // v12 03 决策结果（参考）
];

const LIMIT = 420;

function summarize(node, depth, budget) {
  if (budget.count >= LIMIT) return null;
  budget.count += 1;
  const row = {
    id: node.id,
    name: String(node.name || ""),
    type: node.type,
    x: Math.round(node.x),
    y: Math.round(node.y),
    w: Math.round(node.width),
    h: Math.round(node.height),
  };
  if (node.visible === false) row.hidden = true;
  if (node.type === "TEXT") row.text = String(node.characters || "").slice(0, 80);
  // 动态页模式下 `"children" in node` 恒为 false（属性在原型上不可枚举），必须用数组判断。
  if (depth < 2 && Array.isArray(node.children)) {
    const kids = [];
    for (const child of node.children) {
      const s = summarize(child, depth + 1, budget);
      if (s) kids.push(s);
    }
    if (kids.length > 0) row.children = kids;
  }
  return row;
}

const frames = [];
for (const id of TARGETS) {
  let node;
  try {
    node = await figma.getNodeByIdAsync(id);
  } catch {
    node = null;
  }
  if (!node) {
    frames.push({ id, missing: true });
    continue;
  }
  frames.push({
    id: node.id,
    name: String(node.name || ""),
    page: node.parent && node.parent.type === "PAGE" ? String(node.parent.name) : undefined,
    w: Math.round(node.width),
    h: Math.round(node.height),
    children: summarize(node, 0, { count: 0 }).children || [],
  });
}

return { frameCount: frames.length, frames };
