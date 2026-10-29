// 04-hero-closed.js — v13 帧 04：首屏 hero · 全部关闭后状态（无二次确认、无提醒条）
// 控制条：已启用 0 / 30，全部开启可用、全部关闭禁用；三域卡片全关；无提醒条 / 快捷按钮。
// 面板高度 356（标准高度），帧注在 y=856。
// 前置：00-init.js；幂等（先删 base-* 与 v13/，再从 88:8797 克隆后重绘）
const PAGE_NAME = 'Capability Panel · 全局开关与派生 v13';
const FRAME_NAME = '04 · 首屏 hero · 全部关闭后状态';
const BASE_ID = '88:8797';
await figma.loadAllPagesAsync();

const F = {
  r: { family: 'PingFang SC', style: 'Regular' },
  m: { family: 'PingFang SC', style: 'Medium' },
  sb: { family: 'PingFang SC', style: 'Semibold' },
  code: { family: 'Menlo', style: 'Regular' },
};
for (const k of ['r', 'm', 'sb', 'code']) await figma.loadFontAsync(F[k]);

const C = { rail: '#1B1F27', card: '#222A35', cardOff: '#1B1F27', tabOn: '#2E3540', blue: '#61AFEF', blueLt: '#8FBCFF', t1: '#E3E6EA', t2: '#9DA5B4', t3: '#7F8794', warn: '#D19A66' };
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

const page = figma.root.children.find((p) => p.type === 'PAGE' && p.name === PAGE_NAME);
if (!page) throw new Error('页面不存在：先执行 00-init.js');
await figma.setCurrentPageAsync(page);
const fr = page.children.find((n) => n.type === 'FRAME' && n.name === FRAME_NAME);
if (!fr) throw new Error('画框不存在：' + FRAME_NAME);
for (const n of [...fr.findAll((n) => String(n.name || '').indexOf('v13/') === 0)]) { if (!n.removed) n.remove(); }
for (const c of [...fr.children]) c.remove();
const src = await figma.getNodeByIdAsync(BASE_ID);
const base = src.clone(); base.name = 'base-88-8797';
fr.appendChild(base); base.x = 0; base.y = 0;

const panel = fr.findOne((n) => n.name === 'capability-panel');
panel.resize(920, 356);

// 三域 Tab（Skills 激活；计数全 0）
const track = panel.findOne((n) => n.name === 'tabs');
track.resize(424, 28);
const skillsTab = track.findOne((n) => n.name === 'tab-skills-active');
const mcpTab = track.findOne((n) => n.name === 'tab-mcp');
const tabTools = box(track, 'tab-tools', 277, 3, 140, 22, { fill: null, r: 7 });
text(tabTools, 'Tools', 10, 2, 56, 18, 'Tools', { size: 11.5, color: C.t3, lh: 18 });
text(tabTools, '0 / 6', 68, 2, 56, 18, '0 / 6', { size: 11, color: '#6F7787', lh: 18 });
const skillsCnt = skillsTab.findOne((n) => n.type === 'TEXT' && /\//.test(String(n.characters || '')));
if (skillsCnt) skillsCnt.characters = '0 / 15';
const mcpName = mcpTab.findOne((n) => n.type === 'TEXT' && String(n.characters || '').indexOf('MCP') === 0);
if (mcpName) mcpName.characters = 'MCP';
const mcpCnt = mcpTab.findOne((n) => n.type === 'TEXT' && /\//.test(String(n.characters || '')));
if (mcpCnt) mcpCnt.characters = '0 / 9';
const hint = panel.findOne((n) => n.type === 'TEXT' && String(n.characters || '').indexOf('自动触发默认关闭') === 0);
if (hint) { hint.characters = '自动触发默认关闭'; hint.resize(240, 28); hint.x = 470; hint.textAlignHorizontal = 'RIGHT'; }

// 行 3 控制条（0 / 30：全部开启可用、全部关闭禁用）
const ctl = box(panel, 'v13/ctl', 14, 80, 892, 36, { fill: C.rail, r: 8 });
function pillBtn(p, name, x, y, w, h, label, o) {
  o = o || {};
  const n = box(p, name, x, y, w, h, { fill: o.fill, fillOp: o.fillOp, r: 6, stroke: o.stroke, strokeOp: o.strokeOp });
  text(n, name + '/t', 0, 0, w, h, label, { size: 11, font: F.m, color: o.color || C.t2, align: 'CENTER', lh: h });
  return n;
}
pillBtn(ctl, 'v13/ctl/btn-on', 10, 6, 64, 24, '全部开启', { fill: C.blue, fillOp: 0.14, stroke: C.blue, strokeOp: 0.45, color: C.blueLt });
pillBtn(ctl, 'v13/ctl/btn-off', 80, 6, 64, 24, '全部关闭', { fill: '#FFFFFF', fillOp: 0.04, stroke: '#FFFFFF', strokeOp: 0.08, color: '#5E6673' });
text(ctl, 'v13/ctl/count', 152, 6, 100, 24, '已启用 0 / 30', { size: 11.5, font: F.m, color: C.t1, lh: 24 });
text(ctl, 'v13/ctl/scope', 258, 6, 150, 24, '仅当前会话 · 不改项目默认', { size: 10.5, color: C.t3, lh: 24 });
text(ctl, 'v13/ctl/derive-note', 420, 6, 170, 24, '派生 agent 整体继承三域', { size: 10.5, color: C.t3, lh: 24 });
text(ctl, 'v13/ctl/derive-label', 670, 6, 58, 24, '派生继承', { size: 11, color: C.t2, lh: 24 });
const seg = box(ctl, 'v13/ctl/seg', 736, 6, 146, 24, { fill: C.panel, r: 6, stroke: '#FFFFFF', strokeOp: 0.06 });
const segOn = box(seg, 'v13/ctl/seg-on', 3, 3, 70, 18, { fill: C.tabOn, r: 4 });
text(segOn, 'v13/ctl/seg-on-t', 0, 0, 70, 18, '继承', { size: 11, font: F.m, color: C.t1, align: 'CENTER', lh: 18 });
text(seg, 'v13/ctl/seg-off-t', 73, 3, 70, 18, '不继承', { size: 11, color: C.t3, align: 'CENTER', lh: 18 });

// 卡片：全关 + 两行下移
const cards = panel.findAll((n) => String(n.name || '').indexOf('card-') === 0);
cards.forEach((c, i) => {
  c.y = i < 4 ? 126 : 220;
  c.fills = [paint(C.cardOff)];
  c.strokes = [];
  const swNode = c.findOne((n) => String(n.name || '').indexOf('switch') === 0);
  if (swNode) {
    swNode.fills = [paint('#FFFFFF', 0.13)];
    const knob = swNode.children[0];
    if (knob) { knob.x = 2; knob.fills = [paint('#C9CED8')]; }
  }
  const nameText = c.findOne((n) => n.type === 'TEXT' && (n.fontName || {}).style === 'Semibold');
  if (nameText) nameText.fills = [paint(C.t2)];
});

const fl = panel.findOne((n) => n.name === 'footer-line'); if (fl) { fl.y = 318; }
const footText = panel.findOne((n) => n.type === 'TEXT' && String(n.characters || '').indexOf('项已启用') >= 0);
if (footText) { footText.characters = '0 / 30 项已启用 · 开关只作用于当前对话'; footText.resize(640, 16); footText.x = 14; footText.y = 326; }
const reset = panel.findOne((n) => n.name === 'reset-default'); if (reset) reset.y = 322;
const done = panel.findOne((n) => n.name === 'done'); if (done) done.y = 322;
const heroNote = fr.findOne((n) => n.type === 'TEXT' && String(n.characters || '').indexOf('首屏默认展开') >= 0);
if (heroNote) heroNote.visible = false;
const oldNote = fr.findOne((n) => n.type === 'TEXT' && String(n.characters || '').indexOf('点按立即决策') >= 0);
if (oldNote) oldNote.visible = false;
text(fr, 'v13/note', 276, 856, 1000, 16, '※ 全部关闭后状态：控制条 0/30、全部关闭禁用、全部开启可用；无二次确认、无提醒条', { size: 10.5, color: C.t3, lh: 16 });

const out = { frame: fr.id, panel: panel.id, cards: cards.length };
console.log(JSON.stringify(out));
return out;