// 07-jev-config.js — v13 帧 07：Jev 模型配置页（说明并入副标题、删密钥路径行）
// 改动：① 删除 callout「一次请求给全部能力打分 / 仅发送能力名称与描述…」；说明并入副标题两行小字；
//       ② Base URL 起整体上移，卡片高度按内容重算（740 → 654）；③ 保留删除密钥路径/权限整行；
//       ④ 保留 API Key 标签旁 ⓘ + 「密钥仅存宿主，不下发浏览器」；⑤ 副标题文案「Skills 与 MCP」（本版不含 Tools）。
// 前置：00-init.js；幂等（先删 base-* 与 v13/，再从 56:7890 克隆后重绘）
const PAGE_NAME = 'Capability Panel · 全局开关与派生 v13';
const FRAME_NAME = '07 · 能力面板 · Jev 模型 · 配置（说明并入副标题）';
const BASE_ID = '56:7890';
await figma.loadAllPagesAsync();

const F = {
  r: { family: 'PingFang SC', style: 'Regular' },
  m: { family: 'PingFang SC', style: 'Medium' },
  sb: { family: 'PingFang SC', style: 'Semibold' },
  code: { family: 'Menlo', style: 'Regular' },
};
for (const k of ['r', 'm', 'sb', 'code']) await figma.loadFontAsync(F[k]);

const C = { rail: '#1B1F27', tabOn: '#2E3540', t1: '#E3E6EA', t2: '#9DA5B4', t3: '#7F8794', blueLt: '#8FBCFF' };
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
const base = src.clone(); base.name = 'base-56-7890';
fr.appendChild(base); base.x = 0; base.y = 0;

const card = fr.findOne((n) => n.name === 'v11/card');
if (!card) throw new Error('v11/card 不存在');

// 0) 主面板四 Tab（Skills / MCP / Tools / Jev 模型，Jev 激活）
const oldTabs = fr.findOne((n) => n.name === 'v11/tabs');
if (oldTabs) oldTabs.visible = false;
const tabs = box(fr, 'v13/tabs', 276, 60, 560, 36, { fill: C.rail, r: 8 });
const tabDefs = [ { label: 'Skills', count: '15', active: false }, { label: 'MCP', count: '9', active: false }, { label: 'Tools', count: '6', active: false }, { label: 'Jev 模型', count: '', active: true } ];
tabDefs.forEach((t, i) => {
  const x = 3 + i * 138;
  const f = box(tabs, 'v13/tabs/' + i, x, 3, 138, 30, { fill: t.active ? C.tabOn : null, r: t.active ? 6 : 0 });
  text(f, 'v13/tabs/' + i + '/t', 0, 0, 138, 30, t.label, { size: 13, font: t.active ? F.sb : F.r, color: t.active ? C.t1 : C.t3, align: 'CENTER', lh: 30 });
  if (t.count) text(f, 'v13/tabs/' + i + '/c', 104, 0, 30, 30, t.count, { size: 10.5, color: t.active ? C.blueLt : '#6F7787', align: 'RIGHT', lh: 30 });
});

// 1) 删除 callout 与密钥路径行
const info = card.findOne((n) => n.name === 'v11/c/info');
if (info) info.remove();
const keyHint = card.findOne((n) => n.type === 'TEXT' && String(n.characters || '').indexOf('密钥仅存宿主') >= 0);
if (keyHint) keyHint.remove();

// 2) 副标题改两行（说明并入）
const sub = card.findOne((n) => n.name === 'v11/c/sub');
if (sub) {
  sub.characters = '用 Jev 模型给 Skills、MCP 与 Tools 打分，自动选出与本轮草稿最相关的能力。';
  sub.resize(764, 20);
}
text(card, 'v13/c/sub2', 28, 78, 764, 18, '一次请求完成；发送输入框草稿与能力名称、描述（Tools 为插件名与工具说明摘要）；草稿仅用于本次评分、不落盘，结果只写当前会话。', { size: 10.5, color: C.t3, lh: 18 });

// 3) Base URL 起整体上移：原 base-label 156 → 110（-46）
for (const c of [...card.children]) {
  if (c.name === 'v13/c/sub2' || c.name === 'v11/c/title' || c.name === 'v11/c/sub') continue;
  if (c.y >= 156) c.y -= 46;
}

// 4) API Key ⓘ（位置随 key-label 374 → 328）
const keyLabel = card.findOne((n) => n.name === 'v11/c/key-label');
if (keyLabel) {
  const dot = box(card, 'v13/key-info', 92, 328, 13, 13, { fill: '#FFFFFF', fillOp: 0.06, r: 999 });
  text(dot, 'v13/key-info/t', 0, 0, 13, 13, 'i', { size: 8, font: F.m, color: C.t3, align: 'CENTER', lh: 13 });
  text(card, 'v13/key-info/hint', 112, 328, 240, 13, '密钥仅存宿主，不下发浏览器', { size: 10, color: C.t3, lh: 13 });
}

// 5) 卡片高度按内容重算：底栏 save 616 + 34 + 22 = 672 → 取 672；居中 (796-672)/2 = 62
card.resize(820, 672);
card.y = 62;

// 6) 帧注
text(fr, 'v13/note', 276, 862, 1100, 16, '※ 删 callout + 密钥路径整行：说明并入副标题两行 → Base URL 起上移 46px，卡片 740→672；安全承诺并入 API Key ⓘ', { size: 10.5, color: C.t3, lh: 16 });

const out = { frame: fr.id, card: card.id, cardH: card.height, y: card.y, sub2: 78 };
console.log(JSON.stringify(out));
return out;