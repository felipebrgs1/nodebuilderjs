import { type Subpath, ellipse } from "./path.js";

export interface StrokeStyle {
  width: number;
  cap: "butt" | "round" | "square";
  join: "miter" | "round" | "bevel";
  miterLimit: number;
}

/** Outline of a stroke as polygons, all wound the same way (so a nonzero fill unions them). */
export function strokePolygons(subpaths: Subpath[], stroke: StrokeStyle, tol: number): number[][] {
  const hw = stroke.width / 2;
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
      if (stroke.cap === "round") disc(p[0]!, p[1]!);
      else if (stroke.cap === "square") add([p[0]! - hw, p[1]! - hw, p[0]! + hw, p[1]! - hw, p[0]! + hw, p[1]! + hw, p[0]! - hw, p[1]! + hw]);
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
      if (stroke.join === "round") {
        disc(x, y);
        continue;
      }
      const s = cross > 0 ? 1 : -1; // the outer side is opposite to the turn
      const o1x = s * d1y * hw, o1y = -s * d1x * hw, o2x = s * d2y * hw, o2y = -s * d2x * hw;
      const ratio = 1 / Math.sqrt(Math.max(1e-12, (1 + dot) / 2)); // miter length / stroke width
      if (stroke.join === "miter" && ratio <= stroke.miterLimit) {
        const mx = o1x + o2x, my = o1y + o2y, ml = Math.hypot(mx, my) || 1;
        add([x, y, x + o1x, y + o1y, x + (mx / ml) * hw * ratio, y + (my / ml) * hw * ratio, x + o2x, y + o2y]);
      } else add([x, y, x + o1x, y + o1y, x + o2x, y + o2y]);
    }
    if (!closed) {
      for (const end of [0, n - 1]) {
        const x = p[end * 2]!, y = p[end * 2 + 1]!;
        if (stroke.cap === "round") disc(x, y);
        else if (stroke.cap === "square") {
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

export function signedArea(p: number[]) {
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

