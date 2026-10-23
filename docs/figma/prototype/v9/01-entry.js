// 01-entry.js — v9 帧 01：首屏 capability-panel 内新增「✦ 自动选择」入口
// 前置：先执行 00-init.js；本脚本幂等（先清 v9/ 前缀节点再重绘，保留克隆底座）
const PAGE_NAME = 'Capability Panel · Jev 模型 v9';
const FRAME_NAME = '01 · 首屏 · 自动选择入口';
await figma.loadAllPagesAsync();

const F = {
  r: { family: 'PingFang SC', style: 'Regular' },
  m: { family: 'PingFang SC', style: 'Medium' },
  sb: { family: 'PingFang SC', style: 'Semibold' },
};
for (const k of ['r', 'm', 'sb']) await figma.loadFontAsync(F[k]);

const C = { panel: '#23272F', blue: '#61AFEF', blueLt: '#8FBCFF', t3: '#7F8794' };
const rgb = (h) => { h = h.replace('#', ''); return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 }; };
const paint = (h, o) => ({ type: 'SOLID', color: rgb(h), opacity: o == null ? 1 : o });
function box(p, name, x, y, w, h, o) {
  o = o || {}; const n = figma.createFrame(); p.appendChild(n); n.name = name;
  n.x = x; n.y = y; n.resize(w, h); n.clipsContent = o.clip !== false;
  n.fills = o.fill ? [paint(o.fill, o.fillOp)] : []; n.cornerRadius = o.r || 0;
  n.strokes = o.stroke ? [paint(o.stroke, o.strokeOp)] : []; n.strokeWeight = 1; n.strokeAlign = 'INSIDE'; n.effects = [];
  return n;
}
function text(p, name, x, y, w, h, chars, o) {
  o = o || {}; const n = figma.createText(); p.appendChild(n); n.name = name;
  n.fontName = o.font || F.r; n.fontSize = o.size || 13.5;
  n.lineHeight = { value: o.lh || Math.round((o.size || 13.5) * 1.55), unit: 'PIXELS' };
  n.fills = [paint(o.color || '#E3E6EA')]; n.textAutoResize = 'NONE'; n.characters = chars;
  n.resize(w, h); n.x = x; n.y = y;
  n.textAlignHorizontal = o.align || 'LEFT'; n.textAlignVertical = o.valign || 'CENTER';
  return n;
}
function absOf(n, root) { let x = 0, y = 0, p = n; while (p && p !== root) { x += p.x; y += p.y; p = p.parent; } return { x, y }; }

// ---------- 定位 ----------
const page = figma.root.children.find((p) => p.type === 'PAGE' && p.name === PAGE_NAME);
if (!page) throw new Error('页面不存在：先执行 00-init.js');
await figma.setCurrentPageAsync(page);
const fr = page.children.find((n) => n.type === 'FRAME' && n.name === FRAME_NAME);
if (!fr) throw new Error('画框不存在：先执行 00-init.js');

// ---------- 幂等清理（保留克隆底座） ----------
for (const n of [...fr.findAll((n) => String(n.name || '').indexOf('v9/') === 0)]) { if (!n.removed) n.remove(); }

const panel = fr.findOne((n) => n.name === 'capability-panel');
if (!panel) throw new Error('capability-panel 不存在：底稿 4:7 结构变化');

// 复位为入口态：面板 920×320、底座子节点恢复可见、base hero 注释恢复可见
panel.resize(920, 320);
for (const c of [...panel.children]) c.visible = true;
for (const n of fr.findAll((n) => n.type === 'TEXT' && String(n.characters || '').indexOf('首屏默认展开') >= 0)) n.visible = true;

// ---------- 新增「✦ 自动选择」入口 ----------
const btn = box(panel, 'v9/auto/btn', 720, 44, 112, 28, { fill: C.blue, fillOp: 0.12, r: 8, stroke: C.blue, strokeOp: 0.35 });
text(btn, 'v9/auto/btn-t', 0, 0, 112, 28, '✦ 自动选择', { size: 12, font: F.m, color: C.blueLt, align: 'CENTER', lh: 28 });

// ---------- 帧底注释 ----------
const abs = absOf(panel, fr);
text(fr, 'v9/note', abs.x, 860, 780, 16, '※ 新增：「自动选择」入口（草稿非空时可用）', { size: 10.5, color: C.t3, lh: 16 });

const out = { frame: fr.id, panel: panel.id, button: btn.id, note: '入口按钮 112×28 @ panel(720,44)' };
console.log(JSON.stringify(out));
return out;
