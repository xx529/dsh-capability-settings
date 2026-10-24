// 05-config.js — v11 帧 05：Jev 模型配置页（「能力决策」区 · 默认关闭 + 三个数值字段）
// 前置：先执行 00-init.js；幂等：清 v11/ 节点 → 隐藏 header/search 与旧 tabs → 覆盖 body 重绘
const PAGE_NAME = 'Capability Panel · 能力决策 v11';
const FRAME_NAME = '05 · Jev 模型 · 配置（含能力决策）';
await figma.loadAllPagesAsync();

const F = {
  r: { family: 'PingFang SC', style: 'Regular' },
  m: { family: 'PingFang SC', style: 'Medium' },
  sb: { family: 'PingFang SC', style: 'Semibold' },
  code: { family: 'Menlo', style: 'Regular' },
};
for (const k of ['r', 'm', 'sb', 'code']) await figma.loadFontAsync(F[k]);

const C = { bg: '#1E222B', card: '#1F232B', input: '#23272F', rail: '#1B1F27', tabOn: '#2E3540', blue: '#61AFEF', blueLt: '#8FBCFF', green: '#98C379', t1: '#E3E6EA', t2: '#9DA5B4', t3: '#7F8794', ink: '#0F1115' };
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
const hline = (p, name, x, y, w, op) => box(p, name, x, y, w, 1, { fill: '#FFFFFF', fillOp: op == null ? 0.08 : op, clip: false });
function btn(p, name, x, y, w, h, label, o) {
  o = o || {}; const n = box(p, name, x, y, w, h, { fill: o.fill, fillOp: o.fillOp, r: 8, stroke: o.stroke, strokeOp: o.strokeOp });
  text(n, name + '/t', 0, 0, w, h, label, { size: o.size || 12, font: o.font || F.m, color: o.color || C.t2, align: 'CENTER', lh: h });
  return n;
}
function eye(p, x, y) {
  const e = figma.createEllipse(); p.appendChild(e); e.name = 'eye'; e.x = x; e.y = y; e.resize(18, 12);
  e.fills = []; e.strokes = [paint(C.t3)]; e.strokeWeight = 1.3; e.effects = [];
  const d = figma.createEllipse(); p.appendChild(d); d.name = 'eye-dot'; d.x = x + 7; d.y = y + 4; d.resize(4, 4);
  d.fills = [paint(C.t3)]; d.strokes = []; d.effects = [];
}
function sw(p, name, x, y, on) {
  const t = box(p, name, x, y, 30, 18, { r: 999, fill: on ? C.blue : '#FFFFFF', fillOp: on ? 1 : 0.13 });
  box(t, name + '/knob', on ? 14 : 2, 2, 14, 14, { fill: on ? '#FFFFFF' : '#C9CED8', r: 7, clip: false });
  return t;
}

// ---------- 定位 + 清理 ----------
const page = figma.root.children.find((p) => p.type === 'PAGE' && p.name === PAGE_NAME);
if (!page) throw new Error('页面不存在：先执行 00-init.js');
await figma.setCurrentPageAsync(page);
const fr = page.children.find((n) => n.type === 'FRAME' && n.name === FRAME_NAME);
if (!fr) throw new Error('画框不存在：先执行 00-init.js');
for (const n of [...fr.findAll((n) => String(n.name || '').indexOf('v11/') === 0)]) { if (!n.removed) n.remove(); }

// ---------- 头部：隐藏搜索与旧两 Tab，改三项 Tab（技能 / MCP / Jev 模型） ----------
const search = fr.findOne((n) => n.name === 'header/search'); if (search) search.visible = false;
const oldTabs = fr.findOne((n) => n.name === 'header/tabs'); if (oldTabs) oldTabs.visible = false;
const track = box(fr, 'v11/tabs', 276, 60, 420, 36, { fill: C.rail, r: 8 });
text(track, 'v11/tabs/skills', 3, 3, 138, 30, '技能', { size: 13, color: C.t3, align: 'CENTER', lh: 30 });
text(track, 'v11/tabs/mcp', 141, 3, 138, 30, 'MCP', { size: 13, color: C.t3, align: 'CENTER', lh: 30 });
const on = box(track, 'v11/tabs/jev-on', 279, 3, 138, 30, { fill: C.tabOn, r: 6 });
text(on, 'v11/tabs/jev-t', 0, 0, 138, 30, 'Jev 模型', { size: 13, font: F.sb, align: 'CENTER', lh: 30 });

// ---------- body 覆盖层 + 居中配置卡 ----------
const body = box(fr, 'v11/body', 256, 104, 1184, 796, { fill: C.bg, clip: true });
const card = box(body, 'v11/card', 182, 36, 820, 740, { fill: C.card, r: 14, stroke: '#FFFFFF', strokeOp: 0.06 }); // body 内居中：(1184-820)/2

// 标题区
text(card, 'v11/c/title', 28, 24, 400, 28, 'Jev 模型', { size: 20, font: F.sb, lh: 28 });
text(card, 'v11/c/sub', 28, 56, 640, 20, '用 Jev 模型给全部能力打分，自动选出与本轮草稿最相关的技能与 MCP', { size: 12, color: C.t2, lh: 20 });
const info = box(card, 'v11/c/info', 28, 92, 764, 48, { fill: C.blue, fillOp: 0.08, r: 8, stroke: C.blue, strokeOp: 0.18 });
text(info, 'v11/c/info-t1', 12, 7, 740, 16, '一次请求给全部能力打分', { size: 11.5, font: F.m, color: C.blueLt, lh: 16 });
text(info, 'v11/c/info-t2', 12, 25, 740, 14, '仅发送能力名称与描述 · 草稿内容不落盘 · 结果只写当前会话', { size: 10.5, color: C.t3, lh: 14 });

// Base URL
text(card, 'v11/c/base-label', 28, 156, 200, 16, 'Base URL', { size: 10.5, color: C.t3, lh: 16 });
const baseIn = box(card, 'v11/c/base-input', 28, 176, 764, 38, { fill: C.input, r: 8, stroke: '#FFFFFF', strokeOp: 0.08 });
text(baseIn, 'v11/c/base-t', 12, 0, 700, 38, 'https://api.typesafe.ai', { size: 12, font: F.code, lh: 38 });
text(card, 'v11/c/base-hint', 28, 220, 640, 14, '路径固定为 /v1/systemone · 仅支持 HTTPS', { size: 10.5, color: C.t3, lh: 14 });

// 模型
text(card, 'v11/c/model-label', 28, 246, 200, 16, '模型', { size: 10.5, color: C.t3, lh: 16 });
const modelIn = box(card, 'v11/c/model-input', 28, 266, 764, 38, { fill: C.input, r: 8, stroke: '#FFFFFF', strokeOp: 0.08 });
text(modelIn, 'v11/c/model-t', 12, 0, 700, 38, 'jev-latest', { size: 12, font: F.code, lh: 38 });
text(card, 'v11/c/model-hint', 28, 310, 640, 14, '类型安全 Jev 模型 · 批量打分返回 0–1 置信度', { size: 10.5, color: C.t3, lh: 14 });

// 密钥模式分段
text(card, 'v11/c/kmode-label', 28, 336, 120, 16, '密钥模式', { size: 10.5, color: C.t3, lh: 16 });
const seg = box(card, 'v11/c/seg', 500, 330, 292, 30, { fill: C.rail, r: 8 });
const segOn = box(seg, 'v11/c/seg-on', 3, 3, 140, 24, { fill: C.tabOn, r: 6 });
text(segOn, 'v11/c/seg-on-t', 0, 0, 140, 24, '直接填写', { size: 11, font: F.m, align: 'CENTER', lh: 24 });
text(seg, 'v11/c/seg-off-t', 145, 3, 144, 24, '环境变量', { size: 11, color: C.t3, align: 'CENTER', lh: 24 });

// API Key（脱敏 + 眼睛）
text(card, 'v11/c/key-label', 28, 372, 200, 16, 'API Key', { size: 10.5, color: C.t3, lh: 16 });
const keyIn = box(card, 'v11/c/key-input', 28, 392, 764, 38, { fill: C.input, r: 8, stroke: '#FFFFFF', strokeOp: 0.08 });
text(keyIn, 'v11/c/key-t', 12, 0, 640, 38, 'sk-••••••••3f9a', { size: 11.5, font: F.code, lh: 38 });
eye(keyIn, 730, 13);
text(card, 'v11/c/key-hint', 28, 436, 764, 14, '密钥仅存宿主 ~/.dsh/dsh-capability-settings/jev.json（目录 700 / 文件 600），不下发浏览器', { size: 10.5, color: C.t3, lh: 14 });

// ---------- 能力决策（默认关闭 + 三个数值字段） ----------
hline(card, 'v11/c/auto-line', 28, 458, 764, 0.08);
text(card, 'v11/c/auto-title', 28, 466, 260, 20, '能力决策', { size: 13, font: F.sb, lh: 20 });
const autoPill = box(card, 'v11/c/auto-pill', 700, 466, 92, 20, { fill: '#FFFFFF', fillOp: 0.06, r: 999 });
text(autoPill, 'v11/c/auto-pill-t', 0, 0, 92, 20, '默认关闭', { size: 10, font: F.m, color: C.t2, align: 'CENTER', lh: 20 });
text(card, 'v11/c/auto-toggle-label', 28, 494, 260, 24, '输入停顿后自动评分', { size: 12, color: C.t1, lh: 24 });
text(card, 'v11/c/auto-state', 712, 494, 44, 24, '已关闭', { size: 10.5, color: C.t3, align: 'RIGHT', lh: 24 });
sw(card, 'v11/c/auto-switch', 762, 497, false);

// 三个数值字段（同一行三组：标签 / 输入 / 范围提示）
text(card, 'v11/c/thr-label', 28, 528, 140, 14, '停顿阈值', { size: 10.5, color: C.t3, lh: 14 });
const thrIn = box(card, 'v11/c/thr-input', 28, 546, 140, 34, { fill: C.input, r: 8, stroke: '#FFFFFF', strokeOp: 0.08 });
text(thrIn, 'v11/c/thr-value', 12, 0, 70, 34, '1000', { size: 12, font: F.code, lh: 34 });
text(thrIn, 'v11/c/thr-unit', 96, 0, 32, 34, 'ms', { size: 10.5, color: C.t3, lh: 34 });
text(card, 'v11/c/thr-hint', 28, 584, 200, 14, '300–3000 ms · 步长 100', { size: 10, color: C.t3, lh: 14 });

text(card, 'v11/c/minlen-label', 248, 528, 150, 14, '最少触发字数', { size: 10.5, color: C.t3, lh: 14 });
const minIn = box(card, 'v11/c/minlen-input', 248, 546, 130, 34, { fill: C.input, r: 8, stroke: '#FFFFFF', strokeOp: 0.08 });
text(minIn, 'v11/c/minlen-value', 12, 0, 70, 34, '10', { size: 12, font: F.code, lh: 34 });
text(minIn, 'v11/c/minlen-unit', 96, 0, 30, 34, '字', { size: 10.5, color: C.t3, lh: 34 });
text(card, 'v11/c/minlen-hint', 248, 584, 160, 14, '1–200 字', { size: 10, color: C.t3, lh: 14 });

text(card, 'v11/c/mindelta-label', 448, 528, 220, 14, '最少修改间隔字符数', { size: 10.5, color: C.t3, lh: 14 });
const deltaIn = box(card, 'v11/c/mindelta-input', 448, 546, 150, 34, { fill: C.input, r: 8, stroke: '#FFFFFF', strokeOp: 0.08 });
text(deltaIn, 'v11/c/mindelta-value', 12, 0, 80, 34, '4', { size: 12, font: F.code, lh: 34 });
text(deltaIn, 'v11/c/mindelta-unit', 106, 0, 30, 34, '字', { size: 10.5, color: C.t3, lh: 34 });
text(card, 'v11/c/mindelta-hint', 448, 584, 240, 14, '1–100 字 · 与上次决策相比', { size: 10, color: C.t3, lh: 14 });

// 说明 + 成本
text(card, 'v11/c/auto-desc', 28, 606, 500, 16, '自动触发默认关闭 · 开启后按上述规则自动触发', { size: 10.5, color: C.t3, lh: 16 });
text(card, 'v11/c/auto-cost', 560, 606, 232, 16, '每次约 1 次请求（$0.0003–0.001）', { size: 10.5, color: C.t3, align: 'RIGHT', lh: 16 });

// 测试连接 + 成功 pill
btn(card, 'v11/c/test', 28, 630, 88, 30, '测试连接', { stroke: C.blue, strokeOp: 0.4, color: C.blueLt, size: 11.5 });
const okText = '✓ 连接成功 · jev-1.13.0 · 32ms';
const okW = txtw(okText, 11) + 20;
const pill = box(card, 'v11/c/ok-pill', 136, 630, okW, 30, { fill: C.green, fillOp: 0.12, r: 999, stroke: C.green, strokeOp: 0.25 });
text(pill, 'v11/c/ok-t', 0, 0, okW, 30, okText, { size: 11, font: F.m, color: C.green, align: 'CENTER', lh: 30 });

// 底栏
hline(card, 'v11/c/line', 28, 672, 764);
btn(card, 'v11/c/reset', 28, 684, 96, 34, '恢复默认', { stroke: '#FFFFFF', strokeOp: 0.14 });
text(card, 'v11/c/scope-note', 140, 684, 320, 34, '全局生效 · 保存后立即使用', { size: 10.5, color: C.t3, lh: 34 });
btn(card, 'v11/c/save', 672, 684, 120, 34, '保存配置', { fill: C.blue, color: C.ink });

// ---------- 帧底注释 ----------
text(fr, 'v11/note', 276, 884, 860, 14, '※ 能力决策：默认关闭 · 可配置停顿/字数/修改量', { size: 10, color: C.t3, lh: 14 });

const out = { frame: fr.id, body: body.id, card: card.id, tabs: track.id, cardHeight: 740, autoTrigger: false, okWidth: okW };
console.log(JSON.stringify(out));
return out;
