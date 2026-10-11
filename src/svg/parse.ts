// A small SVG renderer for icons: shapes and paths (arcs and curves included), fill and
// stroke with caps, joins and fill rules, transforms, opacity and currentColor. Enough for
// icon sets like Lucide and Phosphor. Not supported: gradients, patterns, text, filters,
// masks, clip paths, <use>, dashes and CSS stylesheets (inline style="" is).
//
// This file reads the document (XML, presentation attributes, inline styles, transforms);
// render.ts draws it.

export interface SvgNode {
  tag: string;
  attrs: Record<string, string>;
  children: SvgNode[];
}

/** Lucide's icon data (`import Camera from "lucide/dist/esm/icons/camera.mjs"`): [tag, attributes][]. */
export type IconNode = readonly (readonly [tag: string, attrs: Readonly<Record<string, string | number | undefined>>, children?: IconNode])[];

export interface Svg {
  root: SvgNode;
  viewBox: readonly [x: number, y: number, width: number, height: number];
  /** Every paint is currentColor (or none): it can be drawn once in white and tinted. */
  monochrome: boolean;
}

/** Straight-alpha color, channels 0..1. */
export type Rgba = readonly [number, number, number, number];

// What lucide's createIcons() puts on the <svg> around the icon data.
const LUCIDE_ROOT = {
  viewBox: "0 0 24 24", width: "24", height: "24", fill: "none", stroke: "currentColor",
  "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round",
};

export function parseSvg(input: string | IconNode): Svg {
  let root: SvgNode | undefined;
  if (typeof input === "string") root = findSvg(parseXml(input));
  else root = { tag: "svg", attrs: { ...LUCIDE_ROOT }, children: fromIconNode(input) };
  if (!root) throw new Error("no <svg> element found");
  const nums = (root.attrs.viewBox ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
  const w = parseFloat(root.attrs.width ?? "") || 0, h = parseFloat(root.attrs.height ?? "") || 0;
  const viewBox: [number, number, number, number] =
    nums.length === 4 && nums[2]! > 0 && nums[3]! > 0 ? [nums[0]!, nums[1]!, nums[2]!, nums[3]!] : [0, 0, w || 24, h || 24];
  let monochrome = true;
  walk(root, rootStyle(), IDENTITY, (_node, style) => {
    for (const paint of [style.fill, style.stroke]) {
      if (paint === "current") {
        if (style.current !== "current") monochrome = false;
      } else if (paint) monochrome = false;
    }
  });
  return { root, viewBox, monochrome };
}

function fromIconNode(nodes: IconNode): SvgNode[] {
  return nodes.map(([tag, attrs, children]) => ({
    tag,
    attrs: Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])),
    children: children ? fromIconNode(children) : [],
  }));
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e] ?? m));

function parseXml(text: string): SvgNode {
  const doc: SvgNode = { tag: "#document", attrs: {}, children: [] };
  const stack = [doc];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<\/\s*([^\s>]+)\s*>|<([^\s/>!?]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  for (const m of text.matchAll(re)) {
    if (m[1]) {
      const tag = local(m[1]);
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i]!.tag === tag) {
          stack.length = i;
          break;
        }
      }
    } else if (m[2]) {
      const attrs: Record<string, string> = {};
      for (const a of m[3]!.matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[local(a[1]!)] = decode(a[2] ?? a[3] ?? "");
      const node: SvgNode = { tag: local(m[2]), attrs, children: [] };
      stack[stack.length - 1]!.children.push(node);
      if (!m[4]) stack.push(node);
    }
  }
  return doc;
}

const local = (name: string) => name.slice(name.indexOf(":") + 1);

function findSvg(node: SvgNode): SvgNode | undefined {
  if (node.tag === "svg") return node;
  for (const c of node.children) {
    const found = findSvg(c);
    if (found) return found;
  }
  return undefined;
}


export type Paint = null | "current" | Rgba;

export interface Style {
  fill: Paint;
  stroke: Paint;
  /** What currentColor means here: the caller's color, or a fixed one from a `color` attribute. */
  current: "current" | Rgba;
  strokeWidth: number;
  cap: "butt" | "round" | "square";
  join: "miter" | "round" | "bevel";
  miterLimit: number;
  evenOdd: boolean;
  fillOpacity: number;
  strokeOpacity: number;
  opacity: number;
  visible: boolean;
}

export const rootStyle = (): Style => ({
  fill: [0, 0, 0, 1], stroke: null, current: "current", strokeWidth: 1, cap: "butt", join: "miter",
  miterLimit: 4, evenOdd: false, fillOpacity: 1, strokeOpacity: 1, opacity: 1, visible: true,
});

const SKIP = new Set([
  "defs", "clipPath", "mask", "linearGradient", "radialGradient", "pattern", "symbol", "marker", "style",
  "title", "desc", "metadata", "text", "use", "image", "filter", "foreignObject", "script",
]);

const NAMED: Record<string, string> = {
  black: "#000", white: "#fff", red: "#f00", lime: "#0f0", green: "#008000", blue: "#00f", yellow: "#ff0",
  cyan: "#0ff", aqua: "#0ff", magenta: "#f0f", fuchsia: "#f0f", gray: "#808080", grey: "#808080",
  silver: "#c0c0c0", maroon: "#800000", olive: "#808000", navy: "#000080", purple: "#800080", teal: "#008080",
  orange: "#ffa500", transparent: "#0000",
};

let warned = false;
function parsePaint(value: string): Paint | undefined {
  const v = value.trim();
  if (v === "none") return null;
  if (v === "currentColor") return "current";
  if (v === "inherit") return undefined;
  const c = parseColorValue(v);
  if (c) return c;
  if (v.startsWith("url(") && !warned) {
    warned = true;
    console.warn("nodebuilder: SVG gradients and patterns are not supported (drawn as no paint)");
  }
  return null;
}

function parseColorValue(v: string): Rgba | null {
  v = (NAMED[v.toLowerCase()] ?? v).trim();
  if (v[0] === "#") {
    let hex = v.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((h) => h + h).join("");
    if (hex.length === 6) hex += "ff";
    if (hex.length !== 8 || !/^[0-9a-f]+$/i.test(hex)) return null;
    const n = parseInt(hex, 16);
    return [((n >>> 24) & 255) / 255, ((n >>> 16) & 255) / 255, ((n >>> 8) & 255) / 255, (n & 255) / 255];
  }
  const m = /^rgba?\(([^)]*)\)$/i.exec(v);
  if (m) {
    const parts = m[1]!.split(/[\s,/]+/).filter(Boolean);
    const ch = (p: string | undefined, max: number) => (p === undefined ? 1 : p.endsWith("%") ? parseFloat(p) / 100 : parseFloat(p) / max);
    return [ch(parts[0], 255), ch(parts[1], 255), ch(parts[2], 255), parts[3] === undefined ? 1 : ch(parts[3], 1)];
  }
  return null;
}

/** Applies an element's presentation attributes and inline style on top of its parent's style. */
function styleOf(node: SvgNode, parent: Style): Style {
  const s: Style = { ...parent, opacity: parent.opacity, visible: parent.visible };
  const props: Record<string, string> = { ...node.attrs };
  for (const decl of (node.attrs.style ?? "").split(";")) {
    const i = decl.indexOf(":");
    if (i > 0) props[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
  }
  if (props.color) {
    const c = parseColorValue(props.color);
    if (c) s.current = c;
  }
  for (const [key, value] of Object.entries(props)) {
    switch (key) {
      case "fill": { const p = parsePaint(value); if (p !== undefined) s.fill = p; break; }
      case "stroke": { const p = parsePaint(value); if (p !== undefined) s.stroke = p; break; }
      case "stroke-width": s.strokeWidth = Math.max(0, parseFloat(value) || 0); break;
      case "stroke-linecap": if (value === "butt" || value === "round" || value === "square") s.cap = value; break;
      case "stroke-linejoin": if (value === "miter" || value === "round" || value === "bevel") s.join = value; else if (value === "miter-clip" || value === "arcs") s.join = "miter"; break;
      case "stroke-miterlimit": s.miterLimit = Math.max(1, parseFloat(value) || 4); break;
      case "fill-rule": s.evenOdd = value === "evenodd"; break;
      case "fill-opacity": s.fillOpacity = clamp01(parseFloat(value)); break;
      case "stroke-opacity": s.strokeOpacity = clamp01(parseFloat(value)); break;
      // Group opacity is applied to each shape: exact unless shapes of one group overlap.
      case "opacity": s.opacity = parent.opacity * clamp01(parseFloat(value)); break;
      case "visibility": s.visible = value === "visible"; break;
    }
  }
  return s;
}

const clamp01 = (v: number) => (Number.isNaN(v) ? 1 : Math.min(1, Math.max(0, v)));


export type Matrix = readonly [a: number, b: number, c: number, d: number, e: number, f: number];
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

function parseTransform(value: string): Matrix {
  let m = IDENTITY;
  for (const [, name, args] of value.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = args!.split(/[\s,]+/).filter(Boolean).map(Number);
    let t: Matrix = IDENTITY;
    switch (name) {
      case "matrix": if (a.length === 6) t = a as unknown as Matrix; break;
      case "translate": t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]; break;
      case "scale": t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]; break;
      case "rotate": {
        const r = ((a[0] ?? 0) * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
        const [cx, cy] = [a[1] ?? 0, a[2] ?? 0];
        t = multiply(multiply([1, 0, 0, 1, cx, cy], [cos, sin, -sin, cos, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
        break;
      }
      case "skewX": t = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0]; break;
      case "skewY": t = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]; break;
    }
    m = multiply(m, t);
  }
  return m;
}

export function walk(node: SvgNode, parent: Style, ctm: Matrix, visit: (node: SvgNode, style: Style, ctm: Matrix) => void) {
  if (SKIP.has(node.tag) || node.attrs.display === "none" || /display\s*:\s*none/.test(node.attrs.style ?? "")) return;
  const style = styleOf(node, parent);
  const m = node.attrs.transform ? multiply(ctm, parseTransform(node.attrs.transform)) : ctm;
  if (node.tag === "svg" || node.tag === "g" || node.tag === "a" || node.tag === "switch") {
    for (const c of node.children) walk(c, style, m, visit);
  } else if (SHAPES.has(node.tag)) visit(node, style, m);
}


export const SHAPES = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);
