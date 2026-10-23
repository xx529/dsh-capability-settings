// 04-results.js — v11 帧 04：能力决策结果面板（6 行分数 · 阈值 0.50 · 已选 5/37）
// 2026-10-24 用户反馈：删除说明文案 v11/hdr/desc；阈值行上移，行距重新分配以消除空隙
// 前置：先执行 00-init.js；幂等：清 v11/ 节点 → 隐藏底座面板子节点 → 按高度自适应重绘
const PAGE_NAME = 'Capability Panel · 能力决策 v11';
const FRAME_NAME = '04 · 能力决策 · 结果';
await figma.loadAllPagesAsync();

const F = {
  r: { family: 'PingFang SC', style: 'Regular' },
  m: { family: 'PingFang SC', style: 'Medium' },
  sb: { family: 'PingFang SC', style: 'Semibold' },
  code: { family: 'Menlo', style: 'Regular' },
};
for (const k of ['r', 'm', 'sb', 'code']) await figma.loadFontAsync(F[k]);

const C = { blue: '#61AFEF', blueLt: '#8FBCFF', green: '#98C379', warn: '#D19A66', t1: '#E3E6EA', t2: '#9DA5B4', t3: '#7F8794', ink: '#0F1115' };
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
  if (o.trunc) { try { n.textTruncation = 'ENDING'; } catch (e) {} }
  return n;
}
const hline = (p, name, x, y, w, op) => box(p, name, x, y, w, 1, { fill: '#FFFFFF', fillOp: op == null ? 0.06 : op, clip: false });
function absOf(n, root) { let x = 0, y = 0, p = n; while (p && p !== root) { x += p.x; y += p.y; p = p.parent; } return { x, y }; }
function btn(p, name, x, y, w, h, label, o) {
  o = o || {}; const n = box(p, name, x, y, w, h, { fill: o.fill, fillOp: o.fillOp, r: 8, stroke: o.stroke, strokeOp: o.strokeOp });
  text(n, name + '/t', 0, 0, w, h, label, { size: o.size || 11.5, font: o.font || F.m, color: o.color || C.t2, align: 'CENTER', lh: h });
  return n;
}

// ---------- 定位 + 清理 + 底座隐藏 ----------
const page = figma.root.children.find((p) => p.type === 'PAGE' && p.name === PAGE_NAME);
if (!page) throw new Error('页面不存在：先执行 00-init.js');
await figma.setCurrentPageAsync(page);
const fr = page.children.find((n) => n.type === 'FRAME' && n.name === FRAME_NAME);
if (!fr) throw new Error('画框不存在：先执行 00-init.js');
for (const n of [...fr.findAll((n) => String(n.name || '').indexOf('v11/') === 0)]) { if (!n.removed) n.remove(); }

const panel = fr.findOne((n) => n.name === 'capability-panel');
if (!panel) throw new Error('capability-panel 不存在：底稿 4:7 结构变化');
for (const c of [...panel.children]) c.visible = false;
for (const n of fr.findAll((n) => n.type === 'TEXT' && String(n.characters || '').indexOf('首屏默认展开') >= 0)) n.visible = false;

// 高度自适应：底座面板帧内绝对 y=480（main 偏移 48），430 会越过 900 且无注释位 → 取可用高度
const abs = absOf(panel, fr);
const H = Math.max(360, Math.min(430, 900 - abs.y - 26));
panel.resize(920, H);

// ---------- 头部 ----------
text(panel, 'v11/hdr/title', 20, 12, 180, 22, '✦ 能力决策', { size: 13.5, font: F.sb, lh: 22 });
const badge = box(panel, 'v11/hdr/badge', 124, 15, 68, 18, { fill: C.blue, fillOp: 0.12, r: 4 });
text(badge, 'v11/hdr/badge-t', 0, 0, 68, 18, 'jev-latest', { size: 10, font: F.code, color: C.blueLt, align: 'CENTER', lh: 18 });
text(panel, 'v11/hdr/close', 872, 12, 28, 28, '×', { size: 18, color: C.t3, align: 'CENTER', lh: 28 });
// ---------- 阈值行（删除说明行后上移，紧贴标题） ----------
text(panel, 'v11/thr/label', 20, 40, 32, 28, '阈值', { size: 11, color: C.t3, lh: 28 });
box(panel, 'v11/thr/track', 58, 52, 180, 4, { fill: '#FFFFFF', fillOp: 0.12, r: 2, clip: false });
box(panel, 'v11/thr/fill', 58, 52, 90, 4, { fill: C.blue, r: 2, clip: false });
box(panel, 'v11/thr/knob', 142, 48, 12, 12, { fill: '#E3E6EA', r: 6, clip: false });
text(panel, 'v11/thr/value', 244, 40, 40, 28, '0.50', { size: 11.5, font: F.m, lh: 28 });
text(panel, 'v11/thr/selected', 740, 40, 160, 28, '已选 5 / 37', { size: 11.5, color: C.t2, align: 'RIGHT', lh: 28 });
hline(panel, 'v11/line/head', 20, 74, 880);

// ---------- 6 行结果 ----------
const ROWS = [
  { type: '技能', name: 'agent-orchestration-advisor', desc: '设计多 agent 工作流与交接边界', score: 0.93 },
  { type: '技能', name: 'live-shopping-ops', desc: '大促页面巡检与价格监控', score: 0.88 },
  { type: 'MCP', name: 'AnySearch', desc: '联网搜索与页面正文提取', score: 0.81 },
  { type: 'MCP', name: 'playwright', desc: '浏览器自动化与端到端回归', score: 0.76 },
  { type: '技能', name: 'session-retrospective', desc: '整理对话决策与待办，产出小结', score: 0.64 },
  { type: '技能', name: 'brand-guidelines', desc: '统一品牌文案与配色（低于阈值）', score: 0.42 },
];
const footerTop = H - 58;
const pitch = (footerTop - 88) / 6;
const rh = Math.max(28, Math.min(38, pitch - 4));
function scoreColor(s, dim) { if (dim) return C.t3; if (s >= 0.8) return C.green; if (s >= 0.7) return C.blueLt; return C.blue; }
ROWS.forEach((r, i) => {
  const dim = i === 5, y = 80 + i * pitch, cy = Math.round((rh - 16) / 2), nm = 'v11/row/' + i;
  // 行内坐标一律相对 panel：纵向必须带行偏移 y（container 层不额外引入）
  const cb = box(panel, nm + '/check', 20, y + cy, 16, 16, { fill: dim ? null : C.blue, r: 4, stroke: dim ? '#FFFFFF' : null, strokeOp: 0.2, clip: false });
  if (!dim) text(cb, nm + '/check-t', 0, 0, 16, 16, '√', { size: 10, color: C.ink, align: 'CENTER', lh: 16 });
  const isMcp = r.type === 'MCP', tagColor = dim ? C.t3 : (isMcp ? C.green : C.blueLt);
  const tb = box(panel, nm + '/type', 46, y + cy, 38, 16, { fill: dim ? '#FFFFFF' : (isMcp ? C.green : C.blue), fillOp: 0.12, r: 4 });
  text(tb, nm + '/type-t', 0, 0, 38, 16, r.type, { size: 9.5, font: F.m, color: tagColor, align: 'CENTER', lh: 16 });
  text(panel, nm + '/name', 92, y, 190, rh, r.name, { size: 13, font: F.m, color: dim ? C.t2 : C.t1, lh: rh, trunc: true });
  text(panel, nm + '/desc', 290, y, 370, rh, r.desc, { size: 11.5, color: dim ? C.t3 : C.t2, lh: rh, trunc: true });
  const sc = scoreColor(r.score, dim), barY = y + Math.round((rh - 6) / 2);
  box(panel, nm + '/bar', 680, barY, 160, 6, { fill: '#FFFFFF', fillOp: 0.08, r: 3, clip: false });
  box(panel, nm + '/bar-fill', 680, barY, Math.round(160 * r.score), 6, { fill: dim ? '#4A505C' : sc, fillOp: dim ? 1 : 0.85, r: 3, clip: false });
  text(panel, nm + '/score', 848, y, 52, rh, r.score.toFixed(2), { size: 12, font: F.m, color: sc, align: 'RIGHT', lh: rh });
  hline(panel, nm + '/line', 20, y + rh, 880, 0.04);
});

// ---------- 底栏 ----------
hline(panel, 'v11/line/foot', 20, footerTop, 880);
btn(panel, 'v11/foot/rescore', 20, footerTop + 14, 84, 30, '重新评分', { stroke: '#FFFFFF', strokeOp: 0.14 });
btn(panel, 'v11/foot/cancel', 700, footerTop + 14, 70, 30, '取消', { stroke: '#FFFFFF', strokeOp: 0.14 });
btn(panel, 'v11/foot/apply', 784, footerTop + 14, 116, 30, '应用所选（5）', { fill: C.blue, color: C.ink });

// ---------- 帧底注释 ----------
const noteY = Math.min(884, abs.y + H + 8);
text(fr, 'v11/note', abs.x, noteY, 780, 16, '※ 结果按分数降序 · 阈值只改预勾选 · 应用只写当前会话', { size: 10.5, color: C.t3, lh: 16 });

const out = { frame: fr.id, panel: panel.id, height: H, rows: ROWS.length, noteY };
console.log(JSON.stringify(out));
return out;
