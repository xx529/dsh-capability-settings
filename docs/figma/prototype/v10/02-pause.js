// 02-pause.js — v10 帧 02：输入停顿自动触发（草稿 + 「自主决策进行中」等待卡）
// 前置：先执行 00-init.js；幂等：清 v10/ 节点 → 改 composer 草稿 → 隐藏面板子节点 → 重绘等待卡
const PAGE_NAME = 'Capability Panel · 自主决策 v10';
const FRAME_NAME = '02 · 输入停顿 · 自动触发';
await figma.loadAllPagesAsync();

const F = {
  r: { family: 'PingFang SC', style: 'Regular' },
  m: { family: 'PingFang SC', style: 'Medium' },
  sb: { family: 'PingFang SC', style: 'Semibold' },
  code: { family: 'Menlo', style: 'Regular' },
};
for (const k of ['r', 'm', 'sb', 'code']) await figma.loadFontAsync(F[k]);

const C = { blue: '#61AFEF', blueLt: '#8FBCFF', green: '#98C379', t1: '#E3E6EA', t2: '#9DA5B4', t3: '#7F8794' };
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
  n.fills = [paint(o.color || C.t1)]; n.textAutoResize = 'NONE'; n.characters = chars;
  n.resize(w, h); n.x = x; n.y = y;
  n.textAlignHorizontal = o.align || 'LEFT'; n.textAlignVertical = o.valign || 'CENTER';
  return n;
}
function absOf(n, root) { let x = 0, y = 0, p = n; while (p && p !== root) { x += p.x; y += p.y; p = p.parent; } return { x, y }; }

// ---------- 定位 + 清理 ----------
const page = figma.root.children.find((p) => p.type === 'PAGE' && p.name === PAGE_NAME);
if (!page) throw new Error('页面不存在：先执行 00-init.js');
await figma.setCurrentPageAsync(page);
const fr = page.children.find((n) => n.type === 'FRAME' && n.name === FRAME_NAME);
if (!fr) throw new Error('画框不存在：先执行 00-init.js');
for (const n of [...fr.findAll((n) => String(n.name || '').indexOf('v10/') === 0)]) { if (!n.removed) n.remove(); }

// ---------- 1. composer 换成真实草稿 ----------
const DRAFT = '帮我梳理 DSH 插件接入 Jev 的批量打分方案，重点看配置项与触发时机';
const composer = fr.findOne((n) => n.name === 'composer-card');
const draftNode = composer && composer.findAll((n) => n.type === 'TEXT' && String(n.characters || '').indexOf('描述你想要构建') >= 0)[0];
if (draftNode) {
  draftNode.characters = DRAFT;
  draftNode.fills = [paint(C.t1)];
  try { draftNode.resize(700, 22); } catch (e) {}
}
// ---------- 2. 等待卡（capability-panel 区域） ----------
const panel = fr.findOne((n) => n.name === 'capability-panel');
if (!panel) throw new Error('capability-panel 不存在：底稿 4:7 结构变化');
for (const c of [...panel.children]) c.visible = false;
for (const n of fr.findAll((n) => n.type === 'TEXT' && String(n.characters || '').indexOf('首屏默认展开') >= 0)) n.visible = false;
const abs = absOf(panel, fr);
const H = 168;
panel.resize(920, H);

// 标题 + 「停顿 1.0s」徽标
text(panel, 'v10/wait/title', 20, 14, 440, 22, '✦ 自主决策 · 已开启', { size: 13.5, font: F.sb, lh: 22 });
const pill = box(panel, 'v10/wait/pill', 790, 15, 110, 18, { fill: C.blue, fillOp: 0.12, r: 999 });
text(pill, 'v10/wait/pill-t', 0, 0, 110, 18, '停顿 1.0s 自动触发', { size: 9.5, font: F.m, color: C.blueLt, align: 'CENTER', lh: 18 });

// 状态行
box(panel, 'v10/wait/dot', 20, 52, 8, 8, { fill: C.blue, r: 4, clip: false });
text(panel, 'v10/wait/status', 36, 44, 280, 24, '检测到输入停顿', { size: 12.5, font: F.m, lh: 24 });
text(panel, 'v10/wait/eta', 700, 44, 200, 24, '1.0s 后自动发起', { size: 11.5, color: C.t3, align: 'RIGHT', lh: 24 });

// 进度 90%
box(panel, 'v10/wait/track', 20, 76, 700, 6, { fill: '#FFFFFF', fillOp: 0.1, r: 3, clip: false });
box(panel, 'v10/wait/fill', 20, 76, 630, 6, { fill: C.blue, r: 3, clip: false });
text(panel, 'v10/wait/time', 740, 68, 160, 22, '0.9s / 1.0s', { size: 11, font: F.code, color: C.t2, align: 'RIGHT', lh: 22 });

// 说明两行
text(panel, 'v10/wait/desc', 20, 96, 760, 18, '停顿满 1.0s 将自动评分 37 个能力', { size: 12, color: C.t2, lh: 18 });
text(panel, 'v10/wait/note', 20, 120, 760, 16, '每次草稿只自动触发一次 · 可在配置中调整停顿阈值', { size: 10.5, color: C.t3, lh: 16 });

// ---------- 3. 帧底时间线注释 ----------
text(fr, 'v10/timeline', abs.x, 862, 900, 16, '输入 → 停顿计时 1.0s → 自动发起 1 次请求 → 结果面板', { size: 11, color: C.t3, lh: 16 });

const out = { frame: fr.id, panel: panel.id, height: H, draft: !!draftNode, timeline: 'abs.x=' + abs.x };
console.log(JSON.stringify(out));
return out;
