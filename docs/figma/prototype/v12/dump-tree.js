/**
 * dump-tree.js — **只读**导出 3 个基线帧的「可导出节点签名」（贴进 use_figma 执行）。
 *
 * 用途：给 scene JSON 的 JSON 层重放（patch-scenes.mjs）提供 Figma 真值。
 * 签名规则与 docs/figma/tools/export-scene.js **完全一致**：
 *   - 跳过 visible === false；
 *   - 只保留 FRAME / TEXT / RECTANGLE / ELLIPSE / COMPONENT / SECTION / STICKY / SHAPE_WITH_TEXT；
 *   - 每个节点输出 `type|name|x|y|width|height`（TEXT 追加 `|characters`，换行转义为 \n）；
 *   - 坐标/尺寸按 export-scene.js 的 Math.round(v*100)/100 取整（这里用同式）。
 *
 * 返回：{ frames: [{ id, name, count, sig: [...] }] }
 * 期望条量：v8-01 ≈ 60、v8-02 ≈ 200、v11-04 ≈ 170（< 500，可一次回传）。
 */
await figma.loadAllPagesAsync();

const SUPPORTED = new Set(["FRAME", "TEXT", "RECTANGLE", "ELLIPSE", "COMPONENT", "SECTION", "STICKY", "SHAPE_WITH_TEXT"]);
const round = (v) => Math.round(v * 100) / 100;
const TARGETS = ["42:3376", "42:3433", "56:7679"];

function walk(node, out) {
  if (node.visible === false) return;
  if (!SUPPORTED.has(node.type)) return;
  const head = [node.type, String(node.name || ""), round(node.x), round(node.y), round(node.width), round(node.height)];
  if (node.type === "TEXT") head.push(String(node.characters || "").replace(/\n/g, "\\n"));
  out.push(head.join("|"));
  for (const child of node.children || []) walk(child, out);
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
  const sig = [];
  walk(node, sig);
  frames.push({ id: node.id, name: String(node.name || ""), count: sig.length, sig });
}
return { frames };
