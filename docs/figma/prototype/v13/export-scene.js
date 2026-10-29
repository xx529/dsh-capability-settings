// export-scene.js — v13 八帧 → 可重导入 scene JSON 的「紧凑序列化」导出器（贴进 use_figma 执行）
//
// 为什么不是直接用 tools/export-scene.js 的分片拼接：
//   单帧 JSON 45–102KB，8 帧合计 ~458KB，分片回传会把大量 token 带进对话。
//   这里用短键 + 十六进制色值的紧凑结构（~11–26KB/帧），本地用 decode-scene.py 还原成
//   tools/export-scene.js 相同的 scene 契约（{ nodes: [FRAME] }）。
//
// 用法：
//   1) 改 TARGET_NODE_ID 为要导出的帧 id；整段贴进 use_figma，返回 { id, nodes, compact }（nodes = 可见可导出节点数）。
//   2) 把返回的 compact 字符串存成 /tmp/v13-XX.compact.json；
//   3) python3 docs/figma/prototype/v13/decode-scene.py /tmp/v13-XX.compact.json docs/figma/scenes/v13-XX.scene.json <nodes>；
//   4) 校验 JSON.parse 成功、nodes.length === 1、节点签名数与画布一致。
//
// 已知限制（同 tools/export-scene.js）：跳过 VECTOR 等非 scene 类型、跳过 visible=false、不导出渐变/阴影/图片。
const TARGET_NODE_ID = '106:5';

await figma.loadAllPagesAsync();
const TYPE = { FRAME: 'F', TEXT: 'T', RECTANGLE: 'R', ELLIPSE: 'E', COMPONENT: 'C', SECTION: 'S', STICKY: 'Y', SHAPE_WITH_TEXT: 'H' };
const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
function fillStr(node) {
  const a = [];
  for (const f of node.fills ?? []) {
    if (f.type === 'SOLID' && f.visible !== false) a.push(hex(f.color) + (f.opacity === undefined || f.opacity === 1 ? '' : '/' + Number(f.opacity.toFixed(3))));
  }
  return a.length ? a.join(',') : null;
}
function strokeStr(node) {
  const a = [];
  for (const s of node.strokes ?? []) {
    if (s.type === 'SOLID' && s.visible !== false) a.push(hex(s.color) + (s.opacity === undefined || s.opacity === 1 ? '' : '/' + Number(s.opacity.toFixed(3))));
  }
  return a.length ? a.join(',') : null;
}
let count = 0;
function compact(node) {
  if (node.visible === false) return null;
  if (!TYPE[node.type]) return null;
  count++;
  const o = { t: TYPE[node.type], n: node.name };
  if (node.layoutMode && node.layoutMode !== 'NONE') {
    o.L = {
      m: node.layoutMode,
      p: node.primaryAxisSizingMode,
      c: node.counterAxisSizingMode,
      g: node.itemSpacing,
      pt: node.paddingTop, pb: node.paddingBottom, pl: node.paddingLeft, pr: node.paddingRight,
      pa: node.primaryAxisAlignItems, ca: node.counterAxisAlignItems,
    };
  } else {
    o.x = Math.round(node.x * 100) / 100;
    o.y = Math.round(node.y * 100) / 100;
  }
  o.w = Math.round(node.width * 100) / 100;
  o.h = Math.round(node.height * 100) / 100;
  const f = fillStr(node); if (f) o.f = f;
  const s = strokeStr(node); if (s) { o.s = s; o.sw = node.strokeWeight; o.sa = node.strokeAlign; }
  if (node.cornerRadius !== undefined && node.cornerRadius !== 0 && node.cornerRadius !== figma.mixed) o.cr = node.cornerRadius;
  if (node.clipsContent === true) o.cl = 1;
  if (node.type === 'TEXT') {
    o.tx = {
      c: node.characters,
      f: node.fontName && node.fontName.family,
      y: node.fontName && node.fontName.style,
      s: node.fontSize,
      ar: node.textAutoResize,
    };
    if (node.lineHeight && node.lineHeight.unit === 'PIXELS') o.tx.lh = node.lineHeight.value;
    if (node.letterSpacing && node.letterSpacing.unit === 'PIXELS') o.tx.ls = node.letterSpacing.value;
    if (node.textAlignHorizontal) o.tx.ah = node.textAlignHorizontal;
    if (node.textAlignVertical) o.tx.av = node.textAlignVertical;
  }
  const kids = [];
  for (const child of node.children ?? []) {
    const k = compact(child);
    if (k) kids.push(k);
  }
  if (kids.length) o.c = kids;
  return o;
}
const target = await figma.getNodeByIdAsync(TARGET_NODE_ID);
if (!target) throw new Error('节点不存在 ' + TARGET_NODE_ID);
const root = compact(target);
const compactStr = JSON.stringify(root);
return { id: TARGET_NODE_ID, name: target.name, nodes: count, compact: compactStr };