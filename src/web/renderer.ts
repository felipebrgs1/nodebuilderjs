// The command buffer -> vertices, as native/core/render_gles2.c does it (same vertex format,
// same shader in ./gl.ts), in TypeScript for the browser. Kept apart from WebGL so it can be
// tested: the device draws batches, sets clips and binds images; the text painter places
// rasterized runs in its atlas.

import type { ColorSpace } from "../render/color.js";

export const VERTEX_FLOATS = 20;
const MODE_RECT = 0, MODE_SHADOW = 2, MODE_IMAGE = 3, MODE_LINE = 4, MODE_SOLID = 5, MODE_ARC = 6, MODE_COLOR_GLYPH = 7;
const OP_RECT = 1, OP_TEXT = 2, OP_CLIP = 3, OP_UNCLIP = 4, OP_SHADOW = 5, OP_IMAGE = 6, OP_LINE = 7, OP_TRIANGLES = 8, OP_ARC = 9, OP_GRADIENT = 10;
const MAX_STOPS = 32;
const NONE: readonly number[] = [0, 0, 0, 0];

/** Device px: the scissor (intersection of every clip) and the innermost rounded clip (all radii 0 = none). */
export interface ClipState {
  scissor: [x0: number, y0: number, x1: number, y1: number];
  mask: [x0: number, y0: number, x1: number, y1: number];
  radii: [tl: number, tr: number, br: number, bl: number];
}

export interface RenderDevice {
  /** Starts a frame: viewport and clear. */
  begin(width: number, height: number): void;
  /** Draws `count` vertices of VERTEX_FLOATS floats as triangles. */
  draw(vertices: Float32Array, count: number): void;
  clip(state: ClipState | null): void;
  /** Binds the image for the quads that follow; its color space, or null when it can't be drawn. */
  bindImage(id: number): ColorSpace | null;
}

/** Where a text run landed: its box relative to (x, line top) in device px, and its atlas uv. */
export interface TextQuad {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface TextPainter {
  /**
   * Rasterizes a run (cached) in `color` (0..1, alpha ignored); null when there's nothing to
   * draw, "full" when the atlas has no room left: the renderer flushes, calls reset() and asks again.
   */
  place(text: string, font: number, spec: string, px: number, spacing: number, color: ArrayLike<number>): TextQuad | null | "full";
  reset(): void;
}

export class Renderer {
  /** The target's color space: textures in another one are converted by the shader. */
  space: ColorSpace = "srgb";
  private verts = new Float32Array(4096 * VERTEX_FLOATS);
  private count = 0;
  private clips: ClipState[] = [];
  private boundImage = 0;
  private boundSpace: ColorSpace | null = null;
  // A GRADIENT op fills the next op: its triangles are cut at the stop lines.
  private grad = { active: false, x0: 0, y0: 0, dx: 0, dy: 0, n: 0, offset: new Float32Array(MAX_STOPS), color: new Float32Array(MAX_STOPS * 4) };
  private tri = [new Float32Array(VERTEX_FLOATS), new Float32Array(VERTEX_FLOATS), new Float32Array(VERTEX_FLOATS)];
  private triN = 0;

  constructor(private device: RenderDevice, private text: TextPainter) {}

  frame(width: number, height: number, scale: number, cmd: Float32Array, texts: readonly string[]) {
    this.clips = [];
    this.boundImage = 0;
    this.grad.active = false;
    this.device.begin(width, height);
    const count = cmd.length;
    let i = 0;
    while (i < count) {
      const op = cmd[i++]!;
      switch (op) {
        case OP_GRADIENT: {
          const used = this.readGradient(cmd, i, scale);
          if (!used) i = count;
          else i += used;
          continue; // stays active for the next op
        }
        case OP_RECT: {
          const x = cmd[i]! * scale, y = cmd[i + 1]! * scale, w = cmd[i + 2]! * scale, h = cmd[i + 3]! * scale;
          const hw = w / 2, hh = h / 2;
          const r = this.radii(cmd, i + 8, scale, Math.min(hw, hh));
          this.quad(x - 1, y - 1, x + w + 1, y + h + 1, x + hw, y + hh, hw, hh, cmd.subarray(i + 4, i + 8), cmd.subarray(i + 13, i + 17),
            r[0], cmd[i + 12]! * scale, MODE_RECT, r[1], r[2], r[1], r[2], r[3]);
          i += 17;
          break;
        }
        case OP_SHADOW: {
          const x = cmd[i]! * scale, y = cmd[i + 1]! * scale, w = cmd[i + 2]! * scale, h = cmd[i + 3]! * scale;
          const hw = w / 2, hh = h / 2, blur = Math.max(cmd[i + 12]! * scale, 0.5);
          const r = this.radii(cmd, i + 8, scale, Math.min(hw, hh));
          // The casting box's offset rides in the border color: the shader cuts it out.
          this.quad(x - blur, y - blur, x + w + blur, y + h + blur, x + hw, y + hh, hw, hh, cmd.subarray(i + 4, i + 8), [cmd[i + 13]! * scale, 0, 0, 0],
            r[0], blur, MODE_SHADOW, r[1], r[2], r[1], r[2], r[3]);
          i += 14;
          break;
        }
        case OP_TEXT: {
          const idx = cmd[i + 8]!, specIdx = cmd[i + 10]!;
          const text = texts[idx];
          if (text) {
            const spec = specIdx >= 0 ? (texts[specIdx] ?? "") : "";
            const color = cmd.subarray(i + 4, i + 8);
            const args = [text, cmd[i + 3]!, spec, Math.round(cmd[i + 2]! * scale), cmd[i + 9]! * scale, color] as const;
            let q = this.text.place(...args);
            if (q === "full") {
              this.flush(); // the pending quads sample the atlas as it is
              this.text.reset();
              q = this.text.place(...args);
            }
            if (q && q !== "full") {
              const x = Math.round(cmd[i]! * scale), y = Math.round(cmd[i + 1]! * scale);
              this.quad(x + q.x0, y + q.y0, x + q.x1, y + q.y1, 0, 0, 0, 0, color, NONE, 0, 0, MODE_COLOR_GLYPH, q.u0, q.v0, q.u1, q.v1, 0);
            }
          }
          i += 11;
          break;
        }
        case OP_IMAGE: {
          const id = cmd[i + 13]!;
          let space = this.boundSpace;
          if (id !== this.boundImage) {
            this.flush(); // the pending quads use the previous image
            space = this.device.bindImage(id);
            this.boundImage = space ? id : 0;
            this.boundSpace = space;
          }
          if (space) {
            const convert = space === this.space ? 0 : space === "srgb" ? 1 : 2;
            const x = cmd[i]! * scale, y = cmd[i + 1]! * scale, w = cmd[i + 2]! * scale, h = cmd[i + 3]! * scale;
            const hw = w / 2, hh = h / 2, r = Math.min(cmd[i + 12]! * scale, Math.min(hw, hh));
            this.quad(x, y, x + w, y + h, x + hw, y + hh, hw, hh, cmd.subarray(i + 8, i + 12), NONE, r, convert, MODE_IMAGE,
              cmd[i + 4]!, cmd[i + 5]!, cmd[i + 6]!, cmd[i + 7]!, 0);
          }
          i += 14;
          break;
        }
        case OP_LINE: {
          const x0 = cmd[i]! * scale, y0 = cmd[i + 1]! * scale, x1 = cmd[i + 2]! * scale, y1 = cmd[i + 3]! * scale;
          const hw = (cmd[i + 4]! * scale) / 2, len = Math.hypot(x1 - x0, y1 - y0);
          const dx = len > 0 ? (x1 - x0) / len : 1, dy = len > 0 ? (y1 - y0) / len : 0;
          const pad = hw + 1;
          this.localQuad(x0, y0, dx, dy, -dy, dx, -pad, -pad, len + pad, pad, cmd[i + 9]!, cmd[i + 10]!, cmd.subarray(i + 5, i + 9), hw, len, MODE_LINE);
          i += 11;
          break;
        }
        case OP_TRIANGLES: {
          const n = cmd[i]!;
          if (i + 5 + n * 3 > count) {
            i = count;
            break;
          }
          const color = [0, 0, 0, 0];
          for (let k = 0; k < n; k++) {
            const v = i + 5 + k * 3;
            color[0] = cmd[i + 1]!; color[1] = cmd[i + 2]!; color[2] = cmd[i + 3]!; color[3] = cmd[i + 4]! * cmd[v + 2]!;
            this.vertex(cmd[v]! * scale, cmd[v + 1]! * scale, 0, 0, 0, 0, color, NONE, 0, 0, MODE_SOLID, 0, 0, 0);
          }
          i += 5 + n * 3;
          break;
        }
        case OP_ARC: {
          const cx = cmd[i]! * scale, cy = cmd[i + 1]! * scale, outer = cmd[i + 2]! * scale, inner = cmd[i + 3]! * scale;
          const half = Math.min(Math.abs(cmd[i + 5]!) / 2, Math.PI), mid = cmd[i + 4]! + cmd[i + 5]! / 2;
          // Local +y points at the middle of the sector (0 = up, clockwise on screen).
          const yx = Math.sin(mid), yy = -Math.cos(mid), xx = -yy, xy = yx;
          const r = outer + 1;
          this.localQuad(cx, cy, xx, xy, yx, yy, -r, -r, r, r, Math.sin(half), half >= Math.PI - 1e-4 ? -1 : Math.cos(half),
            cmd.subarray(i + 6, i + 10), outer, inner, MODE_ARC);
          i += 10;
          break;
        }
        case OP_CLIP: {
          const x0 = cmd[i]! * scale, y0 = cmd[i + 1]! * scale, x1 = (cmd[i]! + cmd[i + 2]!) * scale, y1 = (cmd[i + 1]! + cmd[i + 3]!) * scale;
          const parent = this.clips[this.clips.length - 1];
          const c: ClipState = {
            scissor: [Math.floor(x0), Math.floor(y0), Math.ceil(x1), Math.ceil(y1)],
            mask: parent ? [...parent.mask] : [0, 0, 0, 0],
            radii: parent ? [...parent.radii] : [0, 0, 0, 0],
          };
          if (parent) {
            const s = c.scissor, p = parent.scissor;
            s[0] = Math.max(s[0], p[0]); s[1] = Math.max(s[1], p[1]); s[2] = Math.min(s[2], p[2]); s[3] = Math.min(s[3], p[3]);
          }
          if (cmd[i + 4]! > 0 || cmd[i + 5]! > 0 || cmd[i + 6]! > 0 || cmd[i + 7]! > 0) {
            c.mask = [x0, y0, x1, y1];
            c.radii = this.radii(cmd, i + 4, scale, Math.min(x1 - x0, y1 - y0) / 2);
          }
          this.flush();
          this.clips.push(c);
          this.device.clip(c);
          i += 8;
          break;
        }
        case OP_UNCLIP:
          this.flush();
          this.clips.pop();
          this.device.clip(this.clips[this.clips.length - 1] ?? null);
          break;
        default:
          console.error(`nodebuilder: unknown draw op ${op}`);
          i = count;
      }
      this.grad.active = false; // a gradient fills only the op right after it
    }
    this.flush();
  }

  private flush() {
    if (!this.count) return;
    this.device.draw(this.verts, this.count);
    this.count = 0;
  }

  private alloc(): Float32Array {
    if ((this.count + 1) * VERTEX_FLOATS > this.verts.length) {
      const bigger = new Float32Array(this.verts.length * 2);
      bigger.set(this.verts);
      this.verts = bigger;
    }
    return this.verts.subarray(this.count * VERTEX_FLOATS, ++this.count * VERTEX_FLOATS);
  }

  /** Four corner radii at `at` (logical px), scaled and capped at `max`. */
  private radii(cmd: Float32Array, at: number, scale: number, max: number): [number, number, number, number] {
    const r = (k: number) => Math.max(0, Math.min(cmd[at + k]! * scale, max));
    return [r(0), r(1), r(2), r(3)];
  }

  private vertex(x: number, y: number, lx: number, ly: number, hw: number, hh: number, color: ArrayLike<number>, bcolor: ArrayLike<number>,
    radius: number, extra: number, mode: number, u: number, v: number, w: number) {
    const g = this.grad;
    const p = g.active ? this.tri[this.triN]! : this.alloc();
    p[0] = x; p[1] = y; p[2] = lx; p[3] = ly; p[4] = hw; p[5] = hh;
    p[6] = color[0]!; p[7] = color[1]!; p[8] = color[2]!; p[9] = color[3]!;
    p[10] = bcolor[0]!; p[11] = bcolor[1]!; p[12] = bcolor[2]!; p[13] = bcolor[3]!;
    p[14] = radius; p[15] = extra; p[16] = mode; p[17] = u; p[18] = v; p[19] = w;
    if (g.active && ++this.triN === 3) {
      this.triN = 0;
      this.gradientTriangle();
    }
  }

  /** Quad covering [x0,x1]x[y0,y1]; local coords relative to (cx,cy). */
  private quad(x0: number, y0: number, x1: number, y1: number, cx: number, cy: number, hw: number, hh: number, color: ArrayLike<number>,
    bcolor: ArrayLike<number>, radius: number, extra: number, mode: number, u0: number, v0: number, u1: number, v1: number, w: number) {
    const V = (x: number, y: number, u: number, v: number) => this.vertex(x, y, x - cx, y - cy, hw, hh, color, bcolor, radius, extra, mode, u, v, w);
    V(x0, y0, u0, v0); V(x1, y0, u1, v0); V(x1, y1, u1, v1);
    V(x0, y0, u0, v0); V(x1, y1, u1, v1); V(x0, y1, u0, v1);
  }

  /** Quad given in a local frame (origin o, axes ux/uy): lines and arcs are evaluated along their axis. */
  private localQuad(ox: number, oy: number, uxx: number, uxy: number, uyx: number, uyy: number, u0: number, v0: number, u1: number, v1: number,
    hx: number, hy: number, color: ArrayLike<number>, p0: number, p1: number, mode: number) {
    const L = (u: number, v: number) => this.vertex(ox + uxx * u + uyx * v, oy + uxy * u + uyy * v, u, v, hx, hy, color, NONE, p0, p1, mode, 0, 0, 0);
    L(u0, v0); L(u1, v0); L(u1, v1);
    L(u0, v0); L(u1, v1); L(u0, v1);
  }

  // ---- gradients ----------------------------------------------------------------

  private readGradient(cmd: Float32Array, at: number, scale: number): number {
    const left = cmd.length - at;
    if (left < 5) return 0;
    const n = cmd[at + 4]!;
    if (left < 5 + n * 5) return 0;
    const g = this.grad;
    const x0 = cmd[at]! * scale, y0 = cmd[at + 1]! * scale, dx = cmd[at + 2]! * scale - x0, dy = cmd[at + 3]! * scale - y0;
    const len2 = dx * dx + dy * dy;
    g.x0 = x0;
    g.y0 = y0;
    g.dx = len2 > 0 ? dx / len2 : 0;
    g.dy = len2 > 0 ? dy / len2 : 0;
    g.n = Math.min(n, MAX_STOPS);
    for (let k = 0; k < g.n; k++) {
      const s = at + 5 + k * 5;
      g.offset[k] = k > 0 && cmd[s]! < g.offset[k - 1]! ? g.offset[k - 1]! : cmd[s]!;
      const a = cmd[s + 4]!;
      g.color[k * 4] = cmd[s + 1]! * a; g.color[k * 4 + 1] = cmd[s + 2]! * a; g.color[k * 4 + 2] = cmd[s + 3]! * a; g.color[k * 4 + 3] = a;
    }
    g.active = g.n > 0;
    this.triN = 0;
    return 5 + n * 5;
  }

  private gradT(v: Float32Array) {
    return (v[0]! - this.grad.x0) * this.grad.dx + (v[1]! - this.grad.y0) * this.grad.dy;
  }

  /** Emits `v` colored by band `b` (0 = before the first stop): gradient times its own color. */
  private bandVertex(v: Float32Array, b: number) {
    const g = this.grad;
    const lo = Math.max(b - 1, 0), hi = b < g.n ? b : g.n - 1;
    const span = g.offset[hi]! - g.offset[lo]!;
    const k = Math.min(1, Math.max(0, span > 0 ? (this.gradT(v) - g.offset[lo]!) / span : 0));
    const pm = [0, 1, 2, 3].map((c) => g.color[lo * 4 + c]! + (g.color[hi * 4 + c]! - g.color[lo * 4 + c]!) * k);
    const p = this.alloc();
    p.set(v);
    const a = pm[3]!;
    for (let c = 0; c < 3; c++) p[6 + c] = (a > 0 ? pm[c]! / a : 0) * v[6 + c]!;
    p[9] = a * v[9]!;
  }

  /** Clips a polygon to t >= edge (sign 1) or t <= edge (sign -1). */
  private clipPoly(poly: Float32Array[], edge: number, sign: number): Float32Array[] {
    const out: Float32Array[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
      const da = (this.gradT(a) - edge) * sign, db = (this.gradT(b) - edge) * sign;
      if (da >= 0) out.push(a);
      if (da >= 0 !== db >= 0) {
        const k = da / (da - db);
        out.push(a.map((f, j) => f + (b[j]! - f) * k));
      }
    }
    return out;
  }

  private gradientTriangle() {
    const g = this.grad, tri = this.tri;
    const t = tri.map((v) => this.gradT(v));
    const tmin = Math.min(...t), tmax = Math.max(...t);
    for (let b = 0; b <= g.n; b++) {
      const lo = b === 0 ? -Infinity : g.offset[b - 1]!, hi = b === g.n ? Infinity : g.offset[b]!;
      if (tmin >= lo && tmax <= hi) {
        for (const v of tri) this.bandVertex(v, b);
        return;
      }
      if (hi <= lo || tmax <= lo || tmin >= hi) continue;
      let poly: Float32Array[] = tri.map((v) => v.slice());
      if (b > 0) poly = this.clipPoly(poly, lo, 1);
      if (b < g.n) poly = this.clipPoly(poly, hi, -1);
      for (let k = 1; k + 1 < poly.length; k++) {
        this.bandVertex(poly[0]!, b);
        this.bandVertex(poly[k]!, b);
        this.bandVertex(poly[k + 1]!, b);
      }
    }
  }
}
