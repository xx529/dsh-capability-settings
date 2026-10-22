/**
 * Figma → scene JSON 导出器（复制整段到 `use_figma` 里执行）。
 *
 * 用途：把「Capability Dock · 终稿 v5」页里的某个画框序列化成
 * `import_scene` 能直接消费的 scene 契约（FRAME / TEXT / RECTANGLE 等
 * 公共 Plugin API props），保存在 `docs/figma/scenes/*.scene.json`。
 *
 * 已知限制：
 *   - VECTOR / 图标路径不在 scene 契约支持列表里，会被跳过（导入后图标缺失，
 *     可再用 `upload_assets` 导入 SVG 或 `use_figma` 补画）；
 *   - 只保留 SOLID 填充/描边与像素行高，渐变、效果、混合模式不导出。
 *
 * 分片导出：大画框 JSON 可能超过单次工具输出上限。把下方
 * `SERIALIZE_RANGE = [start, end]` 改成不同区间，分 2–3 次调用，把各次返回的
 * `part` 依次拼接后再 JSON.parse，即为完整 scene。
 */

// ===== 可调参数 =====
const TARGET_NODE_ID = "4:7"; // 01 hero = 4:7；02 能力 Tab = 4:223
const SERIALIZE_RANGE = [0, 20000]; // end = null / Infinity 表示到结尾

// ===== 实现 =====
const SUPPORTED = new Set(["FRAME", "TEXT", "RECTANGLE", "ELLIPSE", "COMPONENT", "SECTION", "STICKY", "SHAPE_WITH_TEXT"]);
function solidFills(node) {
  const fills = [];
  for (const f of node.fills ?? []) {
    if (f.type === "SOLID" && f.visible !== false) {
      fills.push({ type: "SOLID", color: { r: f.color.r, g: f.color.g, b: f.color.b }, opacity: f.opacity === undefined ? 1 : f.opacity });
    }
  }
  return fills;
}
function solidStrokes(node) {
  const strokes = [];
  for (const s of node.strokes ?? []) {
    if (s.type === "SOLID" && s.visible !== false) {
      strokes.push({ type: "SOLID", color: { r: s.color.r, g: s.color.g, b: s.color.b }, opacity: s.opacity === undefined ? 1 : s.opacity });
    }
  }
  return strokes;
}
function serialize(node) {
  if (node.visible === false) return null;
  if (!SUPPORTED.has(node.type)) return null;
  const props = { name: node.name };
  if (node.layoutMode && node.layoutMode !== "NONE") {
    props.layoutMode = node.layoutMode;
    props.primaryAxisSizingMode = node.primaryAxisSizingMode;
    props.counterAxisSizingMode = node.counterAxisSizingMode;
    props.itemSpacing = node.itemSpacing;
    props.paddingTop = node.paddingTop;
    props.paddingBottom = node.paddingBottom;
    props.paddingLeft = node.paddingLeft;
    props.paddingRight = node.paddingRight;
    props.primaryAxisAlignItems = node.primaryAxisAlignItems;
    props.counterAxisAlignItems = node.counterAxisAlignItems;
  } else {
    props.x = Math.round(node.x * 100) / 100;
    props.y = Math.round(node.y * 100) / 100;
  }
  props.width = Math.round(node.width * 100) / 100;
  props.height = Math.round(node.height * 100) / 100;
  const fills = solidFills(node);
  if (fills.length > 0) props.fills = fills;
  const strokes = solidStrokes(node);
  if (strokes.length > 0) {
    props.strokes = strokes;
    props.strokeWeight = node.strokeWeight;
    props.strokeAlign = node.strokeAlign;
  }
  if (node.cornerRadius !== undefined && node.cornerRadius !== 0 && node.cornerRadius !== figma.mixed) props.cornerRadius = node.cornerRadius;
  if (node.clipsContent === true) props.clipsContent = true;
  if (node.type === "TEXT") {
    props.characters = node.characters;
    props.fontName = node.fontName;
    props.fontSize = node.fontSize;
    props.textAutoResize = node.textAutoResize;
    if (node.lineHeight && node.lineHeight.unit === "PIXELS") props.lineHeight = { unit: "PIXELS", value: node.lineHeight.value };
    if (node.letterSpacing && node.letterSpacing.unit === "PIXELS") props.letterSpacing = { unit: "PIXELS", value: node.letterSpacing.value };
    if (node.textAlignHorizontal) props.textAlignHorizontal = node.textAlignHorizontal;
    if (node.textAlignVertical) props.textAlignVertical = node.textAlignVertical;
  }
  const kids = [];
  for (const child of node.children ?? []) {
    const serialized = serialize(child);
    if (serialized !== null) kids.push(serialized);
  }
  if (kids.length > 0) props.children = kids;
  return { type: node.type, props };
}

const target = await figma.getNodeByIdAsync(TARGET_NODE_ID);
const scene = { nodes: [serialize(target)] };
const out = JSON.stringify(scene);
const [start, end] = SERIALIZE_RANGE;
return { total: out.length, part: out.slice(start, end ?? out.length) };
