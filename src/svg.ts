// A small SVG renderer for icons: shapes and paths (arcs and curves included), fill and
// stroke with caps, joins and fill rules, transforms, opacity and currentColor. Enough for
// icon sets like Lucide and Phosphor. Not supported: gradients, patterns, text, filters,
// masks, clip paths, <use>, dashes and CSS stylesheets (inline style="" is).
//
// Geometry is flattened to polygons in user space, strokes become polygons too (one per
// segment, join and cap, all wound the same way so a nonzero fill unions them), and a
// scanline rasterizer computes coverage with exact horizontal antialiasing.

import type { Bitmap } from "./png.js";

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

// ---- XML -----------------------------------------------------------------------------

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

// ---- styles ----------------------------------------------------------------------------

type Paint = null | "current" | Rgba;

interface Style {
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

const rootStyle = (): Style => ({
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

// ---- transforms ------------------------------------------------------------------------

type Matrix = readonly [a: number, b: number, c: number, d: number, e: number, f: number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const multiply = (m: Matrix, n: Matrix): Matrix => [
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

function walk(node: SvgNode, parent: Style, ctm: Matrix, visit: (node: SvgNode, style: Style, ctm: Matrix) => void) {
  if (SKIP.has(node.tag) || node.attrs.display === "none" || /display\s*:\s*none/.test(node.attrs.style ?? "")) return;
  const style = styleOf(node, parent);
  const m = node.attrs.transform ? multiply(ctm, parseTransform(node.attrs.transform)) : ctm;
  if (node.tag === "svg" || node.tag === "g" || node.tag === "a" || node.tag === "switch") {
    for (const c of node.children) walk(c, style, m, visit);
  } else if (SHAPES.has(node.tag)) visit(node, style, m);
}

// ---- geometry --------------------------------------------------------------------------

interface Subpath {
  pts: number[]; // x, y pairs
  closed: boolean;
}

const SHAPES = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);
const num = (v: string | undefined, fallback = 0) => {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : fallback;
};

/** Flattens a shape into polylines; `tol` is the allowed deviation in user units. */
function shapeGeometry(node: SvgNode, tol: number): Subpath[] {
  const a = node.attrs;
  switch (node.tag) {
    case "path":
      return pathData(a.d ?? "", tol);
    case "line":
      return [{ pts: [num(a.x1), num(a.y1), num(a.x2), num(a.y2)], closed: false }];
    case "polyline":
    case "polygon": {
      const p = (a.points ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
      if (p.length % 2) p.pop();
      return p.length >= 2 ? [{ pts: p, closed: node.tag === "polygon" }] : [];
    }
    case "circle":
    case "ellipse": {
      const rx = node.tag === "circle" ? num(a.r) : num(a.rx, num(a.ry));
      const ry = node.tag === "circle" ? num(a.r) : num(a.ry, num(a.rx));
      if (rx <= 0 || ry <= 0) return [];
      return [{ pts: ellipse(num(a.cx), num(a.cy), rx, ry, 0, 2 * Math.PI, tol, true), closed: true }];
    }
    case "rect": {
      const x = num(a.x), y = num(a.y), w = num(a.width), h = num(a.height);
      if (w <= 0 || h <= 0) return [];
      let rx = a.rx !== undefined ? num(a.rx) : a.ry !== undefined ? num(a.ry) : 0;
      let ry = a.ry !== undefined ? num(a.ry) : rx;
      rx = Math.min(Math.max(0, rx), w / 2);
      ry = Math.min(Math.max(0, ry), h / 2);
      if (!rx || !ry) return [{ pts: [x, y, x + w, y, x + w, y + h, x, y + h], closed: true }];
      const q = Math.PI / 2;
      const pts = [
        ...ellipse(x + w - rx, y + ry, rx, ry, -q, 0, tol, false),
        ...ellipse(x + w - rx, y + h - ry, rx, ry, 0, q, tol, false),
        ...ellipse(x + rx, y + h - ry, rx, ry, q, 2 * q, tol, false),
        ...ellipse(x + rx, y + ry, rx, ry, 2 * q, 3 * q, tol, false),
      ];
      return [{ pts, closed: true }];
    }
  }
  return [];
}

function segmentsFor(radius: number, sweep: number, tol: number) {
  const step = 2 * Math.acos(Math.max(-1, 1 - tol / Math.max(radius, tol)));
  return Math.min(512, Math.max(2, Math.ceil(Math.abs(sweep) / Math.max(step, 1e-3))));
}

function ellipse(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, tol: number, closedCircle: boolean): number[] {
  const n = segmentsFor(Math.max(rx, ry), a1 - a0, tol);
  const out: number[] = [];
  for (let i = 0; i < (closedCircle ? n : n + 1); i++) {
    const t = a0 + ((a1 - a0) * i) / n;
    out.push(cx + rx * Math.cos(t), cy + ry * Math.sin(t));
  }
  return out;
}

class Scanner {
  i = 0;
  constructor(private s: string) {}
  private skip() {
    while (this.i < this.s.length && /[\s,]/.test(this.s[this.i]!)) this.i++;
  }
  command(): string | null {
    this.skip();
    const c = this.s[this.i];
    if (c && /[MmLlHhVvCcSsQqTtAaZz]/.test(c)) {
      this.i++;
      return c;
    }
    return null;
  }
  hasNumber(): boolean {
    this.skip();
    return this.i < this.s.length && /[-+.\d]/.test(this.s[this.i]!);
  }
  number(): number {
    this.skip();
    const re = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
    re.lastIndex = this.i;
    const m = re.exec(this.s);
    if (!m) throw new Error("bad path data");
    this.i = re.lastIndex;
    return parseFloat(m[0]);
  }
  flag(): boolean {
    this.skip();
    const c = this.s[this.i];
    if (c !== "0" && c !== "1") throw new Error("bad arc flag");
    this.i++;
    return c === "1";
  }
}

/** Parses path data; like browsers, it renders everything up to the first error. */
function pathData(d: string, tol: number): Subpath[] {
  const out: Subpath[] = [];
  const sc = new Scanner(d);
  let cur: Subpath | null = null;
  let x = 0, y = 0, sx = 0, sy = 0; // current point, subpath start
  let cx = 0, cy = 0; // last control point (for S/T)
  let prev = "";
  const start = () => {
    if (!cur) {
      cur = { pts: [x, y], closed: false };
      out.push(cur);
    }
    return cur;
  };
  const lineTo = (nx: number, ny: number) => {
    start().pts.push(nx, ny);
    x = nx;
    y = ny;
  };
  try {
    for (;;) {
      let cmd = sc.command();
      if (!cmd) {
        if (!prev || !sc.hasNumber() || prev === "z" || prev === "Z") break;
        cmd = prev === "M" ? "L" : prev === "m" ? "l" : prev;
      }
      const rel = cmd === cmd.toLowerCase();
      const ox = rel ? x : 0, oy = rel ? y : 0;
      switch (cmd.toUpperCase()) {
        case "M": {
          x = sc.number() + ox;
          y = sc.number() + oy;
          sx = x;
          sy = y;
          cur = null;
          start();
          break;
        }
        case "L": lineTo(sc.number() + ox, sc.number() + oy); break;
        case "H": lineTo(sc.number() + ox, y); break;
        case "V": lineTo(x, sc.number() + oy); break;
        case "C":
        case "S": {
          let x1: number, y1: number;
          if (cmd.toUpperCase() === "C") {
            x1 = sc.number() + ox;
            y1 = sc.number() + oy;
          } else {
            const smooth = /[CcSs]/.test(prev);
            x1 = smooth ? 2 * x - cx : x;
            y1 = smooth ? 2 * y - cy : y;
          }
          const x2 = sc.number() + ox, y2 = sc.number() + oy, x3 = sc.number() + ox, y3 = sc.number() + oy;
          cubic(start().pts, x, y, x1, y1, x2, y2, x3, y3, tol);
          [cx, cy, x, y] = [x2, y2, x3, y3];
          break;
        }
        case "Q":
        case "T": {
          let x1: number, y1: number;
          if (cmd.toUpperCase() === "Q") {
            x1 = sc.number() + ox;
            y1 = sc.number() + oy;
          } else {
            const smooth = /[QqTt]/.test(prev);
            x1 = smooth ? 2 * x - cx : x;
            y1 = smooth ? 2 * y - cy : y;
          }
          const x2 = sc.number() + ox, y2 = sc.number() + oy;
          quadratic(start().pts, x, y, x1, y1, x2, y2, tol);
          [cx, cy, x, y] = [x1, y1, x2, y2];
          break;
        }
        case "A": {
          const rx = sc.number(), ry = sc.number(), rot = sc.number(), large = sc.flag(), sweep = sc.flag();
          const x2 = sc.number() + ox, y2 = sc.number() + oy;
          arc(start().pts, x, y, rx, ry, rot, large, sweep, x2, y2, tol);
          x = x2;
          y = y2;
          break;
        }
        case "Z": {
          if (cur) (cur as Subpath).closed = true;
          x = sx;
          y = sy;
          cur = null; // a drawing command after Z starts a new subpath at the same point
          break;
        }
      }
      if (cmd.toUpperCase() !== "C" && cmd.toUpperCase() !== "S" && cmd.toUpperCase() !== "Q" && cmd.toUpperCase() !== "T") {
        cx = x;
        cy = y;
      }
      prev = cmd;
    }
  } catch {
    // keep what was parsed before the error
  }
  return out;
}

function cubic(out: number[], x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, tol: number) {
  const dd = Math.max(Math.hypot(x0 - 2 * x1 + x2, y0 - 2 * y1 + y2), Math.hypot(x1 - 2 * x2 + x3, y1 - 2 * y2 + y3));
  const n = Math.min(200, Math.max(1, Math.ceil(Math.sqrt((0.75 * dd) / tol))));
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push(a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3);
  }
}

function quadratic(out: number[], x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, tol: number) {
  const dd = Math.hypot(x0 - 2 * x1 + x2, y0 - 2 * y1 + y2);
  const n = Math.min(200, Math.max(1, Math.ceil(Math.sqrt(dd / (4 * tol)))));
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push(u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2);
  }
}

/** Elliptical arc from endpoint parameters (SVG spec, appendix B.2.4). */
function arc(out: number[], x1: number, y1: number, rx: number, ry: number, rotation: number, large: boolean, sweep: boolean, x2: number, y2: number, tol: number) {
  if (x1 === x2 && y1 === y2) return;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (!rx || !ry) {
    out.push(x2, y2);
    return;
  }
  const phi = (rotation * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy;
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  const coef = (large !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * yp) / ry, cyp = (-coef * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = angle(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = angle((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  else if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = segmentsFor(Math.max(rx, ry), dt, tol);
  for (let i = 1; i < n; i++) {
    const t = t1 + (dt * i) / n, ct = Math.cos(t), st = Math.sin(t);
    out.push(cx + rx * ct * cos - ry * st * sin, cy + rx * ct * sin + ry * st * cos);
  }
  out.push(x2, y2);
}

// ---- strokes -----------------------------------------------------------------------------

/** Outline of a stroke as polygons, all wound the same way (so a nonzero fill unions them). */
function strokePolygons(subpaths: Subpath[], style: Style, tol: number): number[][] {
  const hw = style.strokeWidth / 2;
  const polys: number[][] = [];
  const add = (p: number[]) => polys.push(signedArea(p) < 0 ? reverse(p) : p);
  const disc = (x: number, y: number) => add(ellipse(x, y, hw, hw, 0, 2 * Math.PI, tol, true));

  for (const sub of subpaths) {
    // Drop repeated points; they have no direction.
    const p: number[] = [];
    for (let i = 0; i < sub.pts.length; i += 2) {
      const x = sub.pts[i]!, y = sub.pts[i + 1]!;
      if (!p.length || Math.hypot(x - p[p.length - 2]!, y - p[p.length - 1]!) > 1e-9) p.push(x, y);
    }
    let closed = sub.closed;
    if (closed && p.length > 4 && Math.hypot(p[0]! - p[p.length - 2]!, p[1]! - p[p.length - 1]!) < 1e-9) p.length -= 2;
    const n = p.length / 2;
    if (n === 1) {
      // Zero-length subpath: only round and square caps draw something (a dot).
      if (style.cap === "round") disc(p[0]!, p[1]!);
      else if (style.cap === "square") add([p[0]! - hw, p[1]! - hw, p[0]! + hw, p[1]! - hw, p[0]! + hw, p[1]! + hw, p[0]! - hw, p[1]! + hw]);
      continue;
    }
    if (n === 2) closed = false;
    const segs = closed ? n : n - 1;
    const dir = (i: number) => {
      const j = (i + 1) % n;
      const dx = p[j * 2]! - p[i * 2]!, dy = p[j * 2 + 1]! - p[i * 2 + 1]!, len = Math.hypot(dx, dy);
      return [dx / len, dy / len] as const;
    };
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % n;
      const [dx, dy] = dir(i);
      const nx = -dy * hw, ny = dx * hw;
      const ax = p[i * 2]!, ay = p[i * 2 + 1]!, bx = p[j * 2]!, by = p[j * 2 + 1]!;
      add([ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny]);
    }
    // Joins at every vertex between two segments.
    for (let v = closed ? 0 : 1; v < (closed ? n : n - 1); v++) {
      const [d1x, d1y] = dir((v - 1 + n) % n);
      const [d2x, d2y] = dir(v);
      const x = p[v * 2]!, y = p[v * 2 + 1]!;
      const cross = d1x * d2y - d1y * d2x, dot = d1x * d2x + d1y * d2y;
      if (Math.abs(cross) < 1e-9 && dot > 0) continue; // straight
      if (style.join === "round") {
        disc(x, y);
        continue;
      }
      const s = cross > 0 ? 1 : -1; // the outer side is opposite to the turn
      const o1x = s * d1y * hw, o1y = -s * d1x * hw, o2x = s * d2y * hw, o2y = -s * d2x * hw;
      const ratio = 1 / Math.sqrt(Math.max(1e-12, (1 + dot) / 2)); // miter length / stroke width
      if (style.join === "miter" && ratio <= style.miterLimit) {
        const mx = o1x + o2x, my = o1y + o2y, ml = Math.hypot(mx, my) || 1;
        add([x, y, x + o1x, y + o1y, x + (mx / ml) * hw * ratio, y + (my / ml) * hw * ratio, x + o2x, y + o2y]);
      } else add([x, y, x + o1x, y + o1y, x + o2x, y + o2y]);
    }
    if (!closed) {
      for (const end of [0, n - 1]) {
        const x = p[end * 2]!, y = p[end * 2 + 1]!;
        if (style.cap === "round") disc(x, y);
        else if (style.cap === "square") {
          const [dx, dy] = end === 0 ? dir(0) : dir(n - 2);
          const k = end === 0 ? -hw : hw; // extend outwards
          const nx = -dy * hw, ny = dx * hw;
          add([x + nx, y + ny, x + nx + dx * k, y + ny + dy * k, x - nx + dx * k, y - ny + dy * k, x - nx, y - ny]);
        }
      }
    }
  }
  return polys;
}

function signedArea(p: number[]) {
  let a = 0;
  for (let i = 0, n = p.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += p[i]! * p[j + 1]! - p[j]! * p[i + 1]!;
  }
  return a / 2;
}

function reverse(p: number[]) {
  const out: number[] = [];
  for (let i = p.length - 2; i >= 0; i -= 2) out.push(p[i]!, p[i + 1]!);
  return out;
}

// ---- rasterization -------------------------------------------------------------------------

/**
 * Coverage (0..1 per pixel) of closed polygons. Horizontal coverage is exact; vertically
 * each pixel row is sampled `sub` times.
 */
function rasterize(polys: number[][], w: number, h: number, evenOdd: boolean): Float32Array {
  const cov = new Float32Array(w * h);
  // Edges as [x0, y0, x1, y1, winding] with y0 < y1.
  const edges: number[][] = [];
  for (const p of polys) {
    for (let i = 0, n = p.length; i < n; i += 2) {
      const j = (i + 2) % n;
      const ax = p[i]!, ay = p[i + 1]!, bx = p[j]!, by = p[j + 1]!;
      if (ay === by) continue;
      edges.push(ay < by ? [ax, ay, bx, by, 1] : [bx, by, ax, ay, -1]);
    }
  }
  if (!edges.length) return cov;
  edges.sort((a, b) => a[1]! - b[1]!);
  const sub = h <= 256 ? 16 : 5;
  const weight = 1 / sub;
  const partial = new Float32Array(w + 1);
  const diff = new Float32Array(w + 2);
  let active: number[][] = [];
  let next = 0;
  const xs: number[] = [];
  const ws: number[] = [];

  for (let row = 0; row < h; row++) {
    partial.fill(0);
    diff.fill(0);
    let any = false;
    for (let k = 0; k < sub; k++) {
      const y = row + (k + 0.5) * weight;
      while (next < edges.length && edges[next]![1]! <= y) active.push(edges[next++]!);
      active = active.filter((e) => e[3]! > y);
      if (!active.length) continue;
      xs.length = 0;
      ws.length = 0;
      for (const e of active) {
        if (e[1]! > y) continue;
        const t = (y - e[1]!) / (e[3]! - e[1]!);
        const x = e[0]! + (e[2]! - e[0]!) * t;
        // insertion sort: few crossings per line
        let i = xs.length;
        xs.push(x);
        ws.push(e[4]!);
        while (i > 0 && xs[i - 1]! > x) {
          xs[i] = xs[i - 1]!;
          ws[i] = ws[i - 1]!;
          i--;
        }
        xs[i] = x;
        ws[i] = e[4]!;
      }
      let winding = 0;
      for (let i = 0; i < xs.length - 1; i++) {
        winding += ws[i]!;
        const inside = evenOdd ? (winding & 1) !== 0 : winding !== 0;
        if (!inside) continue;
        any = true;
        // span [xs[i], xs[i+1]) clipped to the canvas
        const xa = Math.max(0, xs[i]!), xb = Math.min(w, xs[i + 1]!);
        if (xb <= xa) continue;
        const ia = Math.floor(xa), ib = Math.floor(xb);
        if (ia === ib) partial[ia]! += (xb - xa) * weight;
        else {
          partial[ia]! += (ia + 1 - xa) * weight;
          diff[ia + 1]! += weight;
          diff[ib]! -= weight;
          if (ib < w) partial[ib]! += (xb - ib) * weight;
        }
      }
    }
    if (!any) continue;
    let run = 0;
    const o = row * w;
    for (let x = 0; x < w; x++) {
      run += diff[x]!;
      cov[o + x] = Math.min(1, partial[x]! + run);
    }
  }
  return cov;
}

// ---- rendering ---------------------------------------------------------------------------

export interface RenderOptions {
  /** What currentColor paints with; omitted = white (to be tinted later, see Svg.monochrome). */
  color?: Rgba;
  /** Overrides the root stroke-width (in viewBox units), like Lucide's strokeWidth prop. */
  strokeWidth?: number;
}

/** Rasterizes into a width x height bitmap (straight alpha), scaled to fit like xMidYMid meet. */
export function renderSvg(svg: Svg, width: number, height: number, options: RenderOptions = {}): Bitmap {
  const [vx, vy, vw, vh] = svg.viewBox;
  const s = Math.min(width / vw, height / vh);
  const base: Matrix = [s, 0, 0, s, (width - vw * s) / 2 - vx * s, (height - vh * s) / 2 - vy * s];
  const canvas = new Float32Array(width * height * 4); // premultiplied
  const current: Rgba = options.color ?? [1, 1, 1, 1];
  const root = rootStyle();
  const top = options.strokeWidth !== undefined ? { ...svg.root, attrs: { ...svg.root.attrs, "stroke-width": String(options.strokeWidth) } } : svg.root;

  walk(top, root, base, (node, style, ctm) => {
    if (!style.visible || style.opacity <= 0) return;
    const scale = Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])) || 1;
    const tol = 0.1 / scale; // 0.1 device pixel
    const geometry = shapeGeometry(node, tol);
    if (!geometry.length) return;
    const toDevice = (p: number[]) => {
      const out = new Array<number>(p.length);
      for (let i = 0; i < p.length; i += 2) {
        out[i] = ctm[0] * p[i]! + ctm[2] * p[i + 1]! + ctm[4];
        out[i + 1] = ctm[1] * p[i]! + ctm[3] * p[i + 1]! + ctm[5];
      }
      return out;
    };
    const resolve = (paint: Paint): Rgba | null => (paint === "current" ? (style.current === "current" ? current : style.current) : paint);
    const fill = resolve(style.fill);
    if (fill && node.tag !== "line") { // open subpaths are filled as if closed; lines have no area
      const polys = geometry.filter((g) => g.pts.length >= 6).map((g) => toDevice(g.pts));
      composite(canvas, rasterize(polys, width, height, style.evenOdd), fill, style.fillOpacity * style.opacity);
    }
    const stroke = resolve(style.stroke);
    if (stroke && style.strokeWidth > 0) {
      const polys = strokePolygons(geometry, style, tol).map(toDevice);
      composite(canvas, rasterize(polys, width, height, false), stroke, style.strokeOpacity * style.opacity);
    }
  });

  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const a = canvas[i * 4 + 3]!;
    if (a <= 0) continue;
    data[i * 4] = Math.round(Math.min(1, canvas[i * 4]! / a) * 255);
    data[i * 4 + 1] = Math.round(Math.min(1, canvas[i * 4 + 1]! / a) * 255);
    data[i * 4 + 2] = Math.round(Math.min(1, canvas[i * 4 + 2]! / a) * 255);
    data[i * 4 + 3] = Math.round(Math.min(1, a) * 255);
  }
  return { width, height, data };
}

function composite(canvas: Float32Array, cov: Float32Array, color: Rgba, opacity: number) {
  const [r, g, b] = color;
  const alpha = color[3] * opacity;
  if (alpha <= 0) return;
  for (let i = 0; i < cov.length; i++) {
    const c = cov[i]!;
    if (!c) continue;
    const a = c * alpha, keep = 1 - a, o = i * 4;
    canvas[o] = r * a + canvas[o]! * keep;
    canvas[o + 1] = g * a + canvas[o + 1]! * keep;
    canvas[o + 2] = b * a + canvas[o + 2]! * keep;
    canvas[o + 3] = a + canvas[o + 3]! * keep;
  }
}
