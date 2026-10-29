// 00-init.js — v13「全局开关与派生」原型：建页 + 7 帧（1440×900）+ 克隆底座
// 执行顺序：00-init → 01-hero-skills → 02-hero-mcp → 03-hero-tools → 04-hero-closed
//           → 05-session-tab → 06-panel-tools → 07-jev-config
// 底座：01/02/04 克隆 v12-02（88:8797）、03 同、05 克隆 v12-04（88:9375）、
//       06 克隆 v8-02（42:3433）、07 克隆 v11-05（56:7890）。
// 纪律：不修改 v8/v11/v12 页面任何节点；本页新增节点统一 `v13/` 前缀；本脚本幂等（清空整页重建）。
const PAGE_NAME = 'Capability Panel · 全局开关与派生 v13';
await figma.loadAllPagesAsync();

const F = {
  r: { family: 'PingFang SC', style: 'Regular' },
  m: { family: 'PingFang SC', style: 'Medium' },
  sb: { family: 'PingFang SC', style: 'Semibold' },
  code: { family: 'Menlo', style: 'Regular' },
};
for (const k of ['r', 'm', 'sb', 'code']) await figma.loadFontAsync(F[k]);

const C = { bg: '#1E222B', t3: '#7F8794' };
const rgb = (h) => { h = h.replace('#', ''); return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 }; };
const paint = (h, o) => ({ type: 'SOLID', color: rgb(h), opacity: o == null ? 1 : o });
function text(p, name, x, y, w, h, chars, o) {
  o = o || {}; const n = figma.createText(); p.appendChild(n); n.name = name;
  n.fontName = o.font || F.r; n.fontSize = o.size || 13.5;
  n.lineHeight = { value: o.lh || Math.round((o.size || 13.5) * 1.55), unit: 'PIXELS' };
  n.fills = [paint(o.color || '#E3E6EA')]; n.textAutoResize = 'NONE'; n.characters = chars;
  n.resize(w, h); n.x = x; n.y = y;
  n.textAlignHorizontal = o.align || 'LEFT'; n.textAlignVertical = o.valign || 'CENTER';
  return n;
}
function frame(p, name, x, y, w, h, o) {
  o = o || {}; const n = figma.createFrame(); p.appendChild(n); n.name = name;
  n.x = x; n.y = y; n.resize(w, h); n.clipsContent = o.clip !== false;
  n.fills = o.fill ? [paint(o.fill)] : []; n.cornerRadius = o.r || 0;
  n.strokes = []; n.effects = [];
  return n;
}

// ---------- 页面 ----------
let page = figma.root.children.find((p) => p.type === 'PAGE' && p.name === PAGE_NAME);
if (!page) { page = figma.createPage(); page.name = PAGE_NAME; }
await figma.setCurrentPageAsync(page);
for (const c of [...page.children]) c.remove();

text(page, 'page-title', 0, 0, 1200, 40, '能力面板 · 全局开关与派生 v13', { size: 30, font: F.sb, color: '#E8EAF0', lh: 40 });
text(page, 'page-subtitle', 0, 48, 1360, 24,
  '三域 Skills / MCP / Tools · 全局一键开/关（整体作用三域）· 派生继承（subagent / teammate 整体）· MCP「插件 + 插件名」来源 · Tools 插件级开关 · Jev 说明并入副标题 · 7 帧 1440×900',
  { size: 14, color: '#99A1B0', lh: 24 });

// ---------- 7 帧 + 克隆底座 ----------
const DEFS = [
  { name: '01 · 首屏 hero · 本会话能力（Skills）', x: 0, y: 150, base: '88:8797' },
  { name: '02 · 首屏 hero · MCP（插件来源）', x: 1520, y: 150, base: '88:8797' },
  { name: '03 · 首屏 hero · Tools（插件级）', x: 0, y: 1200, base: '88:8797' },
  { name: '04 · 首屏 hero · 全部关闭后状态', x: 1520, y: 1200, base: '88:8797' },
  { name: '05 · 会话「能力」Tab 整页（宽屏）', x: 0, y: 2250, base: '88:9375' },
  { name: '06 · 能力面板 · Tools（全局）', x: 1520, y: 2250, base: '42:3433' },
  { name: '07 · 能力面板 · Jev 模型 · 配置（说明并入副标题）', x: 0, y: 3300, base: '56:7890' },
  { name: '08 · 能力决策 · 结果（含 Tools）', x: 1520, y: 3300, base: '56:7679' },
];
const frames = [];
const warnings = [];
for (const d of DEFS) {
  const fr = frame(page, d.name, d.x, d.y, 1440, 900, { fill: C.bg, clip: true });
  text(page, d.name + ' · 帧标题', d.x, d.y - 34, 1200, 22, d.name, { size: 17, font: F.sb, color: '#DEE3EC', lh: 22 });
  try {
    const src = await figma.getNodeByIdAsync(d.base);
    if (!src) throw new Error('节点不存在 ' + d.base);
    const base = src.clone();
    base.name = 'base-' + d.base.replace(/:/g, '-');
    fr.appendChild(base); base.x = 0; base.y = 0;
  } catch (e) {
    warnings.push(d.name + ': ' + e.message);
    text(fr, 'base-missing', 24, 24, 900, 40, '底稿克隆失败：' + d.base + ' · ' + e.message, { size: 12, color: '#E06C75' });
  }
  frames.push({ name: d.name, id: fr.id, base: d.base });
}

const out = { pageId: page.id, frames, warnings };
console.log(JSON.stringify(out));
return out;