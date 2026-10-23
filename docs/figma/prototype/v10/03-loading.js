// 03-loading.js — v10 帧 03：自主决策评分中（自动触发 · 骨架行 + 取消可用 + 应用禁用）
// 前置：先执行 00-init.js；幂等：清 v10/ 节点 → 隐藏底座面板子节点 → 重绘
const PAGE_NAME = 'Capability Panel · 自主决策 v10';
const FRAME_NAME = '03 · 自主决策 · 评分中';
await figma.loadAllPagesAsync();

const F = {
  r: { family: 'PingFang SC', style: 'Regular' },
  m: { family: 'PingFang SC', style: 'Medium' },
  sb: { family: 'PingFang SC', style: 'Semibold' },
  code: { family: 'Menlo', style: 'Regular' },
};
for (const k of ['r', 'm', 'sb', 'code']) await figma.loadFontAsync(F[k]);

const C = { blue: '#61AFEF', blueLt: '#8FBCFF', t1: '#E3E6EA', t2: '#9DA5B4', t3: '#7F8794', muted: '#4E5563' };
const rgb = (h) => { h = h.replace('#', ''); return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 }; };
const paint = (h, o) => ({ type: 'SOLID', color: rgb(h), opacity: o == null ? 1 : o });
function box(p, name, x, y, w, h, o) {
  o = o || {}; const n = figma.createFrame(); p.appendChild(n); n.name = name;
  n.x = x; n.y = y; n.resize(w, h); n.clipsContent = o.clip !== false;
  n.fills = o.fill ? [paint(o.fill, o.fillOp)] : []; n.cornerRadius = o.r || 0;
  n.strokes = o.stroke ? [paint(o.stroke, o.strokeOp)] : []; n.strokeWeight = 1; n.strokeAlign = 'INSIDE'; n.effects = [];
  return n;
}
function txtw(s, fs) { let w = 0; for (const ch of s) w += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? fs : fs * 0.55; return Math.ceil(w); }
function text(p, name, x, y, w, h, chars, o) {
  o = o || {}; const n = figma.createText(); p.appendChild(n); n.name = name;
  n.fontName = o.font || F.r; n.fontSize = o.size || 13.5;
  n.lineHeight = { value: o.lh || Math.round((o.size || 13.5) * 1.55), unit: 'PIXELS' };
  n.fills = [paint(o.color || C.t1)]; n.textAutoResize = 'NONE'; n.characters = chars;
  n.resize(w, h); n.x = x; n.y = y;
  n.textAlignHorizontal = o.align || 'LEFT'; n.textAlignVertical = o.valign || 'CENTER';
  return n;
}
const hline = (p, name, x, y, w, op) => box(p, name, x, y, w, 1, { fill: '#FFFFFF', fillOp: op == null ? 0.06 : op, clip: false });
function absOf(n, root) { let x = 0, y = 0, p = n; while (p && p !== root) { x += p.x; y += p.y; p = p.parent; } return { x, y }; }
function btn(p, name, x, y, w, h, label, o) {
  o = o || {}; const n = box(p, name, x, y, w, h, { fill: o.fill, fillOp: o.fillOp, r: 8, stroke: o.stroke, strokeOp: o.strokeOp });
  text(n, name + '/t', 0, 0, w, h, label, { size: o.size || 11.5, font: o.font || F.m, color: o.color || C.t2, align: 'CENTER', lh: h });
  return n;
}

// ---------- 定位 + 清理 ----------
const page = figma.root.children.find((p) => p.type === 'PAGE' && p.name === PAGE_NAME);
if (!page) throw new Error('页面不存在：先执行 00-init.js');
await figma.setCurrentPageAsync(page);
const fr = page.children.find((n) => n.type === 'FRAME' && n.name === FRAME_NAME);
if (!fr) throw new Error('画框不存在：先执行 00-init.js');
for (const n of [...fr.findAll((n) => String(n.name || '').indexOf('v10/') === 0)]) { if (!n.removed) n.remove(); }

const panel = fr.findOne((n) => n.name === 'capability-panel');
if (!panel) throw new Error('capability-panel 不存在：底稿 4:7 结构变化');
for (const c of [...panel.children]) c.visible = false;
for (const n of fr.findAll((n) => n.type === 'TEXT' && String(n.characters || '').indexOf('首屏默认展开') >= 0)) n.visible = false;

const abs = absOf(panel, fr);
const H = Math.max(340, Math.min(380, 900 - abs.y - 26));
panel.resize(920, H);

// ---------- 头部（关闭置灰） ----------
text(panel, 'v10/hdr/title', 20, 12, 260, 22, '✦ 自主决策 · 自动触发', { size: 13.5, font: F.sb, lh: 22 });
const badge = box(panel, 'v10/hdr/badge', 190, 15, 68, 18, { fill: C.blue, fillOp: 0.12, r: 4 });
text(badge, 'v10/hdr/badge-t', 0, 0, 68, 18, 'jev-latest', { size: 10, font: F.code, color: C.blueLt, align: 'CENTER', lh: 18 });
text(panel, 'v10/hdr/close', 872, 12, 28, 28, '×', { size: 18, color: C.muted, align: 'CENTER', lh: 28 });
text(panel, 'v10/hdr/desc', 20, 40, 620, 16, '输入停顿 1.0s 后自动发起 · 37 个能力 · 1 次请求', { size: 11.5, color: C.t3, lh: 16 });

// ---------- 状态行（spinner + 文案） ----------
const ring = figma.createEllipse(); panel.appendChild(ring); ring.name = 'v10/st/spinner';
ring.x = 20; ring.y = 73; ring.resize(14, 14); ring.fills = [];
ring.strokes = [paint(C.blue)]; ring.strokeWeight = 1.8; ring.effects = [];
box(panel, 'v10/st/spinner-dot', 31, 74, 5, 5, { fill: C.blue, r: 3, clip: false });
text(panel, 'v10/st/text', 42, 64, 160, 28, '正在评分…', { size: 12.5, font: F.m, lh: 28 });
text(panel, 'v10/st/meta', 700, 64, 200, 28, '1 次请求 · 37 个能力', { size: 11.5, color: C.t3, align: 'RIGHT', lh: 28 });
hline(panel, 'v10/line/head', 20, 98, 880);

// ---------- 5 条骨架行 ----------
const footerTop = H - 58;
const sTop = 104, sBottom = footerTop - 34, pitch = (sBottom - sTop) / 5;
for (let i = 0; i < 5; i++) {
  const y = Math.round(sTop + i * pitch), nm = 'v10/sk/' + i;
  const row = box(panel, nm, 0, y, 920, 28, { clip: false });
  box(row, nm + '/check', 20, 5, 16, 16, { fill: '#FFFFFF', fillOp: 0.06, r: 4, clip: false });
  box(row, nm + '/type', 46, 6, 38, 14, { fill: '#FFFFFF', fillOp: 0.06, r: 4, clip: false });
  box(row, nm + '/name', 92, 6, 170, 14, { fill: '#FFFFFF', fillOp: 0.09, r: 4, clip: false });
  box(row, nm + '/desc', 290, 9, 300, 10, { fill: '#FFFFFF', fillOp: 0.06, r: 4, clip: false });
  box(row, nm + '/bar', 680, 8, 160, 8, { fill: '#FFFFFF', fillOp: 0.06, r: 4, clip: false });
  box(row, nm + '/bar-fill', 680, 8, Math.round(160 * (0.9 - i * 0.12)), 8, { fill: C.blue, fillOp: 0.18, r: 4, clip: false });
}

// ---------- 请求小字 + 底栏 ----------
text(panel, 'v10/req', 20, footerTop - 26, 620, 16, 'POST /v1/systemone · model jev-latest', { size: 10, font: F.code, color: C.t3, lh: 16 });
hline(panel, 'v10/line/foot', 20, footerTop, 880);
btn(panel, 'v10/foot/cancel', 20, footerTop + 14, 88, 30, '取消评分', { stroke: '#FFFFFF', strokeOp: 0.14 });
btn(panel, 'v10/foot/apply', 784, footerTop + 14, 116, 30, '应用所选', { fill: '#FFFFFF', fillOp: 0.06, color: C.t3 });

// ---------- 帧底注释 ----------
const noteY = Math.min(884, abs.y + H + 8);
text(fr, 'v10/note', abs.x, noteY, 780, 16, '※ 自动触发中 · 可取消', { size: 10.5, color: C.t3, lh: 16 });

const out = { frame: fr.id, panel: panel.id, height: H, skeletons: 5, noteY, trigger: 'input-pause-1.0s' };
console.log(JSON.stringify(out));
return out;
