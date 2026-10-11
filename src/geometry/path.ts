// Path geometry shared by the SVG renderer and drawing primitives: SVG path data, curves
// and arcs flattened to polylines within a tolerance (in the same units as the input).

/** A polyline as x, y pairs; `closed` joins the last point back to the first. */
export interface Subpath {
  pts: number[]; // x, y pairs
  closed: boolean;
}

export function segmentsFor(radius: number, sweep: number, tol: number) {
  const step = 2 * Math.acos(Math.max(-1, 1 - tol / Math.max(radius, tol)));
  return Math.min(512, Math.max(2, Math.ceil(Math.abs(sweep) / Math.max(step, 1e-3))));
}

export function ellipse(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, tol: number, closedCircle: boolean): number[] {
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
export function pathData(d: string, tol: number): Subpath[] {
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

export function cubic(out: number[], x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, tol: number) {
  const dd = Math.max(Math.hypot(x0 - 2 * x1 + x2, y0 - 2 * y1 + y2), Math.hypot(x1 - 2 * x2 + x3, y1 - 2 * y2 + y3));
  const n = Math.min(200, Math.max(1, Math.ceil(Math.sqrt((0.75 * dd) / tol))));
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push(a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3);
  }
}

export function quadratic(out: number[], x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, tol: number) {
  const dd = Math.hypot(x0 - 2 * x1 + x2, y0 - 2 * y1 + y2);
  const n = Math.min(200, Math.max(1, Math.ceil(Math.sqrt(dd / (4 * tol)))));
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push(u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2);
  }
}

/** Elliptical arc from endpoint parameters (SVG spec, appendix B.2.4). */
export function arc(out: number[], x1: number, y1: number, rx: number, ry: number, rotation: number, large: boolean, sweep: boolean, x2: number, y2: number, tol: number) {
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
