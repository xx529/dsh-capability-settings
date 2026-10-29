// 01-hero-skills.js — v13 帧 01：首屏 hero · 本会话能力（Skills）
// 新增：三域 Tab（Skills / MCP 服务器 / Tools）+ 行 3 控制条（全局一键开/关 + 派生继承）
// 前置：00-init.js；幂等（先删 base-* 与 v13/ 节点，再从 88:8797 重新克隆并改）
const PAGE_NAME = 'Capability Panel · 全局开关与派生 v13';
const FRAME_NAME = '01 · 首屏 hero · 本会话能力（Skills）';
const BASE_ID = '88:8797';
await figma.loadAllPagesAsync();

const F = {
  r: { family: 'PingFang SC', style: 'Regular' },
  m: { family: 'PingFang SC', style: 'Medium' },
  sb: { family: 'PingFang SC', style: 'Semibold' },
  code: { family: 'Menlo', style: 'Regular' },
};
for (const k of ['r', 'm', 'sb', 'code']) await figma.loadFontAsync(F[k]);

const C = { panel: '#23272F', rail: '#1B1F27', tabOn: '#2E3540', blue: '#61AFEF', blueLt: '#8FBCFF', t1: '#E3E6EA', t2: '#9DA5B4', t3: '#7F8794', ink: '#0F1115', purple: '#B79CFF', warn: '#D19A66' };
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
function txtw(s, fs) { let w = 0; for (const ch of s) w += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? fs : fs * 0.55; return Math.ceil(w); }

// ---------- 定位 + 复位 ----------
const page = figma.root.children.find((p) => p.type === 'PAGE' && p.name === PAGE_NAME);
if (!page) throw new Error('页面不存在：先执行 00-init.js');
await figma.setCurrentPageAsync(page);
const fr = page.children.find((n) => n.type === 'FRAME' && n.name === FRAME_NAME);
if (!fr) throw new Error('画框不存在：' + FRAME_NAME);
for (const n of [...fr.findAll((n) => String(n.name || '').indexOf('v13/') === 0)]) { if (!n.removed) n.remove(); }
for (const c of [...fr.children]) c.remove();
const src = await figma.getNodeByIdAsync(BASE_ID);
if (!src) throw new Error('底座不存在 ' + BASE_ID);
const base = src.clone(); base.name = 'base-' + BASE_ID.replace(':', '-');
fr.appendChild(base); base.x = 0; base.y = 0;

const panel = fr.findOne((n) => n.name === 'capability-panel');
if (!panel) throw new Error('capability-panel 不存在');
panel.resize(920, 356);

// ---------- 三域 Tab：轨加宽 + 第三枚 ----------
const track = panel.findOne((n) => n.name === 'tabs');
const mcpTab01 = track.findOne((n) => n.name === 'tab-mcp');
const mcpName01 = mcpTab01 && mcpTab01.findOne((n) => n.type === 'TEXT' && String(n.characters || '').indexOf('MCP') === 0);
if (mcpName01) mcpName01.characters = 'MCP';
const mcpCnt01 = mcpTab01 && mcpTab01.findOne((n) => n.type === 'TEXT' && /\//.test(String(n.characters || '')));
if (mcpCnt01) mcpCnt01.characters = '5 / 9';
const skillsCnt01 = track.findOne((n) => n.name === 'tab-skills-active');
const sc01 = skillsCnt01 && skillsCnt01.findOne((n) => n.type === 'TEXT' && /\//.test(String(n.characters || '')));
if (sc01) sc01.characters = '8 / 15';
track.resize(424, 28);
const topic = ['Skills', 'MCP', 'Tools'];
const tabTools = box(track, 'tab-tools', 277, 3, 140, 22, { fill: null, r: 7 });
text(tabTools, 'Tools', 10, 2, 56, 18, 'Tools', { size: 11.5, color: C.t3, lh: 18 });
text(tabTools, '3 / 6', 68, 2, 56, 18, '3 / 6', { size: 11, color: '#6F7787', lh: 18 });

// 「自动触发默认关闭」缩短并右对齐，避免与三 Tab 相撞
const hint = panel.findOne((n) => n.type === 'TEXT' && String(n.characters || '').indexOf('自动触发默认关闭') === 0);
if (hint) { hint.characters = '自动触发默认关闭'; hint.resize(240, 28); hint.x = 470; hint.textAlignHorizontal = 'RIGHT'; }

// ---------- 行 3：本会话控制条 ----------
const ctl = box(panel, 'v13/ctl', 14, 80, 892, 36, { fill: C.rail, r: 8 });

function pillBtn(p, name, x, y, w, h, label, o) {
  o = o || {};
  const n = box(p, name, x, y, w, h, { fill: o.fill, fillOp: o.fillOp, r: 6, stroke: o.stroke, strokeOp: o.strokeOp });
  text(n, name + '/t', 0, 0, w, h, label, { size: 11, font: F.m, color: o.color || C.t2, align: 'CENTER', lh: h });
  return n;
}
pillBtn(ctl, 'v13/ctl/btn-on', 10, 6, 64, 24, '全部开启', { fill: C.blue, fillOp: 0.12, stroke: C.blue, strokeOp: 0.35, color: C.blueLt });
pillBtn(ctl, 'v13/ctl/btn-off', 80, 6, 64, 24, '全部关闭', { stroke: '#FFFFFF', strokeOp: 0.14, color: '#C9CED8' });
text(ctl, 'v13/ctl/count', 152, 6, 100, 24, '已启用 16 / 30', { size: 11.5, font: F.m, color: C.t1, lh: 24 });
text(ctl, 'v13/ctl/scope', 258, 6, 150, 24, '仅当前会话 · 不改项目默认', { size: 10.5, color: C.t3, lh: 24 });
text(ctl, 'v13/ctl/derive-note', 420, 6, 170, 24, '派生 agent 整体继承三域', { size: 10.5, color: C.t3, lh: 24 });

text(ctl, 'v13/ctl/derive-label', 670, 6, 58, 24, '派生继承', { size: 11, color: C.t2, lh: 24 });
const seg = box(ctl, 'v13/ctl/seg', 736, 6, 146, 24, { fill: C.panel, r: 6, stroke: '#FFFFFF', strokeOp: 0.06 });
const segOn = box(seg, 'v13/ctl/seg-on', 3, 3, 70, 18, { fill: C.tabOn, r: 4 });
text(segOn, 'v13/ctl/seg-on-t', 0, 0, 70, 18, '继承', { size: 11, font: F.m, color: C.t1, align: 'CENTER', lh: 18 });
text(seg, 'v13/ctl/seg-off-t', 73, 3, 70, 18, '不继承', { size: 11, color: C.t3, align: 'CENTER', lh: 18 });

// ---------- 卡片 / 底栏整体下移 46px ----------
for (const c of [...panel.children]) {
  if (String(c.name || '').indexOf('card-') === 0) c.y += 46;
}
const fl = panel.findOne((n) => n.name === 'footer-line');
if (fl) fl.y = 318;
const footText = panel.findOne((n) => n.type === 'TEXT' && String(n.characters || '').indexOf('项已启用') >= 0);
if (footText) {
  footText.characters = '16 / 30 项已启用 · 其中 4 项来自插件 / DSH 内置 / Agent 预设 · 开关只作用于当前对话';
  footText.resize(640, 16); footText.x = 14; footText.y = 326;
}
const reset = panel.findOne((n) => n.name === 'reset-default'); if (reset) reset.y = 322;
const done = panel.findOne((n) => n.name === 'done'); if (done) done.y = 322;

// 底栏说明（弱化）保留在框架底部
const heroNote = fr.findOne((n) => n.type === 'TEXT' && String(n.characters || '').indexOf('首屏默认展开') >= 0);
if (heroNote) heroNote.visible = false;
const oldNote0 = fr.findOne((n) => n.type === 'TEXT' && String(n.characters || '').indexOf('点按立即决策') >= 0);
if (oldNote0) oldNote0.visible = false;

// ---------- 帧注 ----------
text(fr, 'v13/note', 276, 856, 900, 16, '※ 新增：三域 Tab · 全局开关 · 派生继承；计数为示例口径，以运行时枚举为准', { size: 10.5, color: C.t3, lh: 16 });

const out = {
  frame: fr.id, panel: panel.id, tabs: track.id, tabTools: tabTools.id, controlRow: ctl.id,
  buttons: [ctl.findOne((n) => n.name === 'v13/ctl/btn-on').id, ctl.findOne((n) => n.name === 'v13/ctl/btn-off').id],
  seg: seg.id, cards: panel.findAll((n) => String(n.name).indexOf('card-') === 0).length,
};
console.log(JSON.stringify(out));
return out;