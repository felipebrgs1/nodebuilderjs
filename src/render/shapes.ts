// Shapes built from the drawing primitives: polylines (one LINE per segment, joined by
// their round caps) and filled polygons (triangulated, with a fringe for antialiasing).

import { triangulate } from "../geometry/triangulate.js";
import type { Color, LineCap, Painter } from "./node.js";

export interface PolylineOptions {
  /** Ends of an open polyline. Default "round". */
  cap?: LineCap | "square";
  /** Joins the last point back to the first. */
  closed?: boolean;
}

/** Points without consecutive repeats (and without a closing repeat of the first). */
function distinct(points: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = points[i]!, y = points[i + 1]!;
    if (!out.length || x !== out[out.length - 2] || y !== out[out.length - 1]) out.push(x, y);
  }
  if (out.length > 2 && out[0] === out[out.length - 2] && out[1] === out[out.length - 1]) out.length -= 2;
  return out;
}

/**
 * A stroked polyline. Segments meet with round joins (each segment's round caps overlap),
 * which is exact for opaque colors; with a translucent color the joints look darker.
 */
export function polyline(p: Pick<Painter, "line">, points: ArrayLike<number>, width: number, color: Color, options: PolylineOptions = {}) {
  const cap = options.cap ?? "round";
  const pts = distinct(points);
  const n = pts.length / 2;
  const half = width / 2;
  if (n === 1) {
    const [x, y] = pts as [number, number];
    if (cap === "round") p.line(x, y, x, y, width, color, "round", "round");
    else if (cap === "square") p.line(x - half, y, x + half, y, width, color, "butt", "butt");
    return;
  }
  const closed = options.closed && n >= 3;
  const segments = closed ? n : n - 1;
  for (let s = 0; s < segments; s++) {
    const t = (s + 1) % n;
    let x0 = pts[s * 2]!, y0 = pts[s * 2 + 1]!, x1 = pts[t * 2]!, y1 = pts[t * 2 + 1]!;
    const first = !closed && s === 0, last = !closed && s === segments - 1;
    if (cap === "square" && (first || last)) {
      const len = Math.hypot(x1 - x0, y1 - y0), dx = ((x1 - x0) / len) * half, dy = ((y1 - y0) / len) * half;
      if (first) [x0, y0] = [x0 - dx, y0 - dy];
      if (last) [x1, y1] = [x1 + dx, y1 + dy];
    }
    const end = cap === "round" ? "round" : "butt";
    p.line(x0, y0, x1, y1, width, color, first ? end : "round", last ? end : "round");
  }
}

/**
 * A filled simple polygon (concave allowed, any winding). The edge gets a fringe one device
 * pixel wide whose coverage goes from 1 inside to 0 outside, so the GPU blends it into an
 * antialiased edge. Self-intersecting polygons draw nothing.
 */
export function fillPolygon(p: Pick<Painter, "triangles">, points: ArrayLike<number>, color: Color, scale = 1) {
  const pts = distinct(points);
  const n = pts.length / 2;
  const tris = n >= 3 ? triangulate(pts) : null;
  if (!tris?.length) return;
  let signed = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    signed += pts[i * 2]! * pts[j * 2 + 1]! - pts[j * 2]! * pts[i * 2 + 1]!;
  }
  const side = signed > 0 ? 1 : -1;
  const half = 0.5 / scale;

  // Outward normal of each edge i -> i+1, then a miter offset per vertex.
  const nx = new Float64Array(n), ny = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = pts[j * 2]! - pts[i * 2]!, dy = pts[j * 2 + 1]! - pts[i * 2 + 1]!, len = Math.hypot(dx, dy) || 1;
    nx[i] = (side * dy) / len;
    ny[i] = (-side * dx) / len;
  }
  const inner = new Float64Array(n * 2), outer = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    const e0 = (i - 1 + n) % n;
    let mx = nx[e0]! + nx[i]!, my = ny[e0]! + ny[i]!;
    const k = 1 + nx[e0]! * nx[i]! + ny[e0]! * ny[i]!;
    if (k < 1e-6) [mx, my] = [nx[i]!, ny[i]!];
    else [mx, my] = [mx / k, my / k];
    const len = Math.hypot(mx, my);
    if (len > 4) [mx, my] = [(mx / len) * 4, (my / len) * 4]; // sharp corners: limit the spike
    inner[i * 2] = pts[i * 2]! - mx * half;
    inner[i * 2 + 1] = pts[i * 2 + 1]! - my * half;
    outer[i * 2] = pts[i * 2]! + mx * half;
    outer[i * 2 + 1] = pts[i * 2 + 1]! + my * half;
  }

  const verts: number[] = [], cover: number[] = [];
  const add = (from: Float64Array, i: number, c: number) => {
    verts.push(from[i * 2]!, from[i * 2 + 1]!);
    cover.push(c);
  };
  for (const v of tris) add(inner, v, 1);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    add(inner, i, 1); add(inner, j, 1); add(outer, j, 0);
    add(inner, i, 1); add(outer, j, 0); add(outer, i, 0);
  }
  p.triangles(verts, cover, color);
}
