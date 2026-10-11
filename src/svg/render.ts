// Renders a parsed SVG to a bitmap: shapes are flattened (geometry/path.ts), strokes turned
// into polygons (geometry/stroke.ts) and both rasterized (geometry/raster.ts).

import { pathData, ellipse, type Subpath } from "../geometry/path.js";
import { rasterize } from "../geometry/raster.js";
import { strokePolygons } from "../geometry/stroke.js";
import type { Bitmap } from "../image/png.js";
import { type Matrix, type Paint, type Rgba, type Svg, type SvgNode, rootStyle, walk } from "./parse.js";

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
      const polys = strokePolygons(geometry, { width: style.strokeWidth, cap: style.cap, join: style.join, miterLimit: style.miterLimit }, tol).map(toDevice);
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
