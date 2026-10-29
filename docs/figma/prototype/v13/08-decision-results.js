// 08-decision-results.js — v13 帧 08：能力决策 · 结果（含 Tools，插件级计分）
// 版式沿用 v11-04（56:7679，只读参考，不改基线页）：阈值行 + 6 行结果（Skills / MCP / Tools 混合、按分数降序）+ 底部已选 x/30。
// Tools 行 = 插件名 + `插件` 紫标签 + `17 个工具` 标签 + 分数/选中态；选中插件 = 开启该插件全部工具；Jev 只收窄不扩权。
// 前置：00-init.js（会在 (1520,3300) 建 08 帧）；幂等：先删 base-*/v13/ 再克隆重绘。帧不存在时自动创建。
const PAGE_NAME = 'Capability Panel · 全局开关与派生 v13';
const FRAME_NAME = '08 · 能力决策 · 结果（含 Tools）';
const BASE_ID = '56:7679';
await figma.loadAllPagesAsync();

const F = {
  r: { family: 'PingFang SC', style: 'Regular' },
  m: { family: 'PingFang SC', style: 'Medium' },
  sb: { family: 'PingFang SC', style: 'Semibold' },
  code: { family: 'Menlo', style: 'Regular' },
};
for (const k of ['r', 'm', 'sb', 'code']) await figma.loadFontAsync(F[k]);

const C = { blue: '#61AFEF', blueLt: '#8FBCFF', green: '#98C379', purple: '#B79CFF', t1: '#E3E6EA', t3: '#7F8794', grey: '#4A505C' };
const rgb = (h) => { h = h.replace('#', ''); return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 }; };
const paint = (h, o) => ({ type: 'SOLID', color: rgb(h), opacity: o == null ? 1 : o });
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
function monoW(s, fs) { return Math.ceil(s.length * fs * 0.62); }

const page = figma.root.children.find((p) => p.type === 'PAGE' && p.name === PAGE_NAME);
if (!page) throw new Error('页面不存在：先执行 00-init.js');
await figma.setCurrentPageAsync(page);
let fr = page.children.find((n) => n.type === 'FRAME' && n.name === FRAME_NAME);
if (!fr) {
  fr = figma.createFrame(); page.appendChild(fr);
  fr.name = FRAME_NAME; fr.x = 1520; fr.y = 3300; fr.resize(1440, 900);
  fr.clipsContent = true; fr.fills = [paint('#1E222B')]; fr.strokes = []; fr.effects = [];
  text(page, FRAME_NAME + ' · 帧标题', 1520, 3266, 1200, 22, FRAME_NAME, { size: 17, font: F.sb, color: '#DEE3EC', lh: 22 });
}
for (const n of [...fr.findAll((n) => String(n.name || '').indexOf('v13/') === 0)]) { if (!n.removed) n.remove(); }
for (const c of [...fr.children]) c.remove();
const src = await figma.getNodeByIdAsync(BASE_ID);
const base = src.clone(); base.name = 'base-56-7679';
fr.appendChild(base); base.x = 0; base.y = 0;

const panel = fr.findOne((n) => n.name === 'capability-panel');
if (!panel) throw new Error('capability-panel 不存在（56:7679 结构变化）');

// ---------- 6 行结果：Skills / MCP / Tools(插件) 混合、按分数降序 ----------
const ROWS = [
  { name: 'agent-orchestration-advisor', type: 'Skills', color: C.blue, desc: '设计多 agent 工作流与交接边界', score: '0.93', val: 0.93, sel: true, src: '全局', mono: false },
  { name: 'figma-workbench', type: 'Skills', color: C.blue, desc: 'Figma 设计稿读写（本地桥）', score: '0.91', val: 0.91, sel: true, src: 'dsh-to-figma', mono: false },
  { name: 'AnySearch', type: 'MCP', color: C.green, desc: '联网搜索与页面正文提取', score: '0.85', val: 0.85, sel: true, src: '全局', mono: false },
  { name: 'dsh-univer-office', type: '插件', color: C.purple, desc: '插件注入 · 表格 / 文档 / 幻灯片', score: '0.82', val: 0.82, sel: true, src: '13 个工具', mono: true },
  { name: 'dsh-remote', type: '插件', color: C.purple, desc: '插件注入 · 远端 DSH 部署与排障', score: '0.66', val: 0.66, sel: false, src: '19 个工具', mono: true },
  { name: 'context7', type: 'MCP', color: C.green, desc: '文档与代码示例检索（低于阈值）', score: '0.42', val: 0.42, sel: false, src: '全局', mono: false },
];
const rowYs = [91, 132, 174, 215, 256, 298];
ROWS.forEach((r, i) => {
  // 选中勾
  const check = panel.findOne((n) => n.name === 'v11/row/' + i + '/check');
  if (check) check.visible = r.sel;
  // 类型标签（Skills / MCP / 插件）：宽度按文案收紧，文字居中、深色
  const typeW = r.type === 'Skills' ? 52 : (r.type === 'MCP' ? 42 : 40);
  const typeFrame = panel.findOne((n) => n.name === 'v11/row/' + i + '/type');
  if (typeFrame) {
    typeFrame.resize(typeW, 16);
    typeFrame.fills = [paint(r.color)];
    const t = typeFrame.findOne((n) => n.type === 'TEXT');
    if (t) { t.characters = r.type; t.resize(typeW, 16); t.fontSize = 9.5; t.textAlignHorizontal = 'CENTER'; t.fills = [paint('#0F1115')]; }
  }
  // 名称（起点随类型标签宽度；未选中行名称降为灰色）
  const nameText = panel.findOne((n) => n.name === 'v11/row/' + i + '/name');
  if (nameText) {
    nameText.characters = r.name;
    nameText.fontName = r.mono ? F.code : F.m;
    nameText.fontSize = r.mono ? 12.5 : 13;
    nameText.x = 46 + typeW + 8;
    nameText.resize(306 - 8 - nameText.x, 37);
    if (!r.sel) nameText.fills = [paint(C.t3)];
  }
  // 来源 / 工具数标签（x=306 列）
  const srcTag = panel.findOne((n) => n.name === 'v12/src/' + i);
  let srcW = 0;
  if (srcTag) {
    const fs = r.src.indexOf('dsh') === 0 ? 10 : (r.src.indexOf('个工具') >= 0 ? 10 : 10.5);
    srcW = (r.src.indexOf('dsh') === 0 ? monoW(r.src, fs) : txtw(r.src, fs)) + 10;
    srcTag.x = 306; srcTag.resize(srcW, 16);
    srcTag.fills = [paint('#FFFFFF', 0.06)];
    const st = srcTag.findOne((n) => n.type === 'TEXT');
    if (st) {
      st.characters = r.src; st.fontSize = fs;
      st.fontName = r.src.indexOf('dsh') === 0 ? F.code : F.m;
      st.fills = [paint(C.t3)];
      st.resize(srcW, 16);
    }
  }
  // 说明（起点随来源标签宽度）
  const descText = panel.findOne((n) => n.name === 'v11/row/' + i + '/desc');
  if (descText) {
    const dx = 306 + (srcW || 31) + 8;
    descText.characters = r.desc;
    descText.x = dx; descText.resize(680 - 8 - dx, 37);
  }
  // 分数与条
  const scoreText = panel.findOne((n) => n.name === 'v11/row/' + i + '/score');
  if (scoreText) scoreText.characters = r.score;
  const barFill = panel.findOne((n) => n.name === 'v11/row/' + i + '/bar-fill');
  if (barFill) {
    barFill.resize(Math.round(r.val * 160), 6);
    barFill.fills = [paint(r.sel ? C.green : C.grey)];
  }
  // 行分隔线位置不动
});

// 真实窗口口径：只保留 4 行完整 + 第 5 行渐隐示意，第 6 行隐藏
for (let i = 0; i < 6; i++) {
  const ns = ['check', 'type', 'name', 'desc', 'bar', 'bar-fill', 'score', 'line']
    .map((k) => panel.findOne((n) => n.name === 'v11/row/' + i + '/' + k)).filter(Boolean);
  const src = panel.findOne((n) => n.name === 'v12/src/' + i);
  if (src) ns.push(src);
  if (i === 5) for (const n of ns) n.visible = false;
}
function fadeBox(name, y, h, op) {
  const n = figma.createFrame(); panel.appendChild(n); n.name = name;
  n.x = 20; n.y = y; n.resize(880, h); n.clipsContent = false;
  n.fills = [{ type: 'SOLID', color: { r: 0x23 / 255, g: 0x27 / 255, b: 0x2f / 255 }, opacity: op }];
  n.strokes = []; n.effects = [];
}
for (const n of [...panel.findAll((n) => String(n.name || '').indexOf('v13/fade') === 0 || String(n.name || '').indexOf('v13/scroll') === 0)]) { if (!n.removed) n.remove(); }
fadeBox('v13/fade/0', 236, 64, 0.35);
fadeBox('v13/fade/1', 252, 48, 0.55);
fadeBox('v13/fade/2', 270, 30, 0.80);
text(panel, 'v13/scroll/hint', 20, 300, 640, 14, '▼ 列表可滚动 · 共 6 行（此处仅展开示意）', { size: 9.5, color: '#7F8794', lh: 14 });

// ---------- 头部计数 / 底部按钮 / 说明 ----------
const selText = panel.findOne((n) => n.name === 'v11/thr/selected');
if (selText) { selText.characters = '已选 4 / 30'; selText.resize(160, 28); }
const applyText = panel.findOne((n) => n.name === 'v11/foot/apply/t');
if (applyText) applyText.characters = '应用所选（4）';
const footLine = panel.findOne((n) => n.name === 'v11/line/foot'); if (footLine) footLine.y = 330;
for (const nm of ['v11/foot/rescore', 'v11/foot/cancel', 'v11/foot/apply']) {
  const b = panel.findOne((n) => n.name === nm); if (b) b.y = 344;
}
text(panel, 'v13/note/tools', 20, 378, 880, 12,
  'Tools 以插件整体计分与启用：选中即开启该插件全部工具；Jev 只收窄，不重新打开已关闭的能力。',
  { size: 10, color: C.t3, lh: 12 });

// 实现约束注（新增节点，不改既有内容）
for (const n of [...fr.findAll((n) => n.name === 'v13/note/impl')]) { if (!n.removed) n.remove(); }
text(fr, 'v13/note/impl', 388, 452, 860, 16, '※ 实现约束：结果面板从输入卡下方约 308px，可滚动 + 底部 20px 渐隐；末行可达即合格（不要求 6 行全显）', { size: 10, color: C.t3, lh: 15 });

// ---------- 帧注 ----------
const frameNote = fr.findOne((n) => n.name === 'v11/note');
if (frameNote) {
  frameNote.characters = '※ 900px 高窗口下约 3 行可见，列表可滚动；6 行仅为展开示意，验收以可滚 + 渐隐 + 末行可达为准';
  frameNote.resize(1100, 16);
} else {
  text(fr, 'v13/note', 388, 882, 1100, 16, '※ 结果单元 = Skills / MCP / Tools(插件)；已选 4 / 30；Tools 插件行 = 整插件开关，不逐工具。', { size: 10.5, color: C.t3, lh: 16 });
}

const out = { frame: fr.id, panel: panel.id, rows: ROWS.length, selected: 4 };
console.log(JSON.stringify(out));
return out;