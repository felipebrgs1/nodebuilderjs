// Walks the laid-out tree and encodes draw commands into a Float32Array that the
// native renderer executes in one go (format: native/include/nb.h, consumer: native/core/render_gles2.c).

import { type ImageSource, imageHandle } from "../image/source.js";
import { boxGradient, isGradient, isLinearGradient, resolveStops } from "./gradient.js";
import { type Color, type FontInput, type LineCap, type Paint, type Painter, type Radius, type UINode, corners, fontId, fontSpec, fontStyle, insetRadius, scrolls, stacked } from "./node.js";
import { scrollbar } from "./scrollbar.js";
import { theme } from "../theme.js";

const OP_RECT = 1;
const OP_TEXT = 2;
const OP_CLIP = 3;
const OP_UNCLIP = 4;
const OP_SHADOW = 5;
const OP_IMAGE = 6;
const OP_LINE = 7;
const OP_TRIANGLES = 8;
const OP_ARC = 9;
const OP_GRADIENT = 10;

const WHITE: readonly number[] = [1, 1, 1, 1];

const colorCache = new Map<string, [number, number, number, number]>();
const named: Record<string, string> = { transparent: "#0000", white: "#fff", black: "#000" };

export function parseColor(c: Color): [number, number, number, number] {
  if (typeof c !== "string") throw new TypeError(`expected a color string, got ${JSON.stringify(c)} (gradients only fill backgrounds and Canvas shapes)`);
  let rgba = colorCache.get(c);
  if (rgba) return rgba;
  let hex = (named[c] ?? c).replace("#", "");
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map((h) => h + h).join("");
  if (hex.length === 6) hex += "ff";
  const n = parseInt(hex, 16);
  rgba = Number.isNaN(n) || hex.length !== 8 ? [1, 0, 1, 1] : [((n >>> 24) & 255) / 255, ((n >>> 16) & 255) / 255, ((n >>> 8) & 255) / 255, (n & 255) / 255];
  colorCache.set(c, rgba);
  return rgba;
}

/**
 * `a` blended toward `b` by `t`, in premultiplied space like CSS (a fully transparent end
 * contributes no color, so fading to "transparent" never passes through gray). Straight rgba out.
 */
export function mixRgba(a: readonly number[], b: readonly number[], t: number): [number, number, number, number] {
  const alpha = a[3]! + (b[3]! - a[3]!) * t;
  if (alpha <= 0) return [0, 0, 0, 0];
  const ch = (i: number) => (a[i]! * a[3]! + (b[i]! * b[3]! - a[i]! * a[3]!) * t) / alpha;
  return [ch(0), ch(1), ch(2), alpha];
}

export class CommandBuffer implements Painter {
  data = new Float32Array(4096);
  length = 0;
  texts: string[] = [];
  opacity = 1;
  /** Font spec -> its index in `texts`, so a frame sends each spec once. */
  private specs = new Map<string, number>();

  reset() {
    this.length = 0;
    this.texts = [];
    this.specs.clear();
  }

  /** Makes room for `n` more floats. */
  private reserve(n: number) {
    if (this.length + n <= this.data.length) return;
    let size = this.data.length * 2;
    while (size < this.length + n) size *= 2;
    const bigger = new Float32Array(size);
    bigger.set(this.data.subarray(0, this.length));
    this.data = bigger;
  }

  /** Color with the current opacity applied. */
  private rgba(c: Color): readonly number[] {
    const v = parseColor(c);
    return this.opacity === 1 ? v : [v[0], v[1], v[2], v[3] * this.opacity];
  }

  /**
   * The color of the next shape: a plain color as is, or white after a GRADIENT op, which
   * makes the renderer color that shape's vertices along the gradient line.
   */
  private fill(paint: Paint): readonly number[] {
    if (!isGradient(paint)) return this.rgba(paint);
    const stops = resolveStops(paint.stops);
    this.reserve(6 + stops.length * 5);
    const d = this.data;
    let o = this.length;
    d[o++] = OP_GRADIENT;
    d[o++] = paint.x0; d[o++] = paint.y0; d[o++] = paint.x1; d[o++] = paint.y1;
    d[o++] = stops.length;
    for (const s of stops) {
      const [r, g, b, a] = this.rgba(s.color);
      d[o++] = s.offset; d[o++] = r!; d[o++] = g!; d[o++] = b!; d[o++] = a!;
    }
    this.length = o;
    return WHITE;
  }

  private push(...values: number[]) {
    this.reserve(values.length);
    for (const v of values) this.data[this.length++] = v;
  }

  rect(x: number, y: number, w: number, h: number, color: Paint, radius: Radius = 0, borderWidth = 0, borderColor: Color = "transparent") {
    const border = this.rgba(borderColor);
    this.push(OP_RECT, x, y, w, h, ...this.fill(color), ...corners(radius), borderWidth, ...border);
  }

  /** The shadow of the box at (x, y), moved down by `dy`; not drawn under the box itself (CSS). */
  shadow(x: number, y: number, w: number, h: number, color: Color, radius: Radius, blur: number, dy = 0) {
    this.push(OP_SHADOW, x, y + dy, w, h, ...this.rgba(color), ...corners(radius), blur, dy);
  }

  text(x: number, y: number, text: string, size: number, color: Color, font?: FontInput) {
    if (!text) return;
    this.texts.push(text);
    const index = this.texts.length - 1;
    const f = fontStyle(font);
    this.push(OP_TEXT, x, y, size, fontId(f.weight, f.italic), ...this.rgba(color), index, f.letterSpacing, this.spec(fontSpec(f)));
  }

  /** The index in `texts` of a font spec, or -1 for none. */
  private spec(spec: string): number {
    if (!spec) return -1;
    let index = this.specs.get(spec);
    if (index === undefined) {
      index = this.texts.push(spec) - 1;
      this.specs.set(spec, index);
    }
    return index;
  }

  image(x: number, y: number, w: number, h: number, source: ImageSource, uv: readonly [number, number, number, number], radius = 0, opacity = 1, tint: Color = "#ffffff") {
    const id = imageHandle(source);
    if (!id) return;
    const [r, g, b, a] = parseColor(tint);
    this.push(OP_IMAGE, x, y, w, h, ...uv, r, g, b, a * opacity * this.opacity, radius, id);
  }

  line(x0: number, y0: number, x1: number, y1: number, width: number, color: Paint, capStart: LineCap = "round", capEnd: LineCap = "round") {
    this.push(OP_LINE, x0, y0, x1, y1, width, ...this.fill(color), capStart === "round" ? 1 : 0, capEnd === "round" ? 1 : 0);
  }

  triangles(points: ArrayLike<number>, coverage: ArrayLike<number> | null, color: Paint) {
    const count = (points.length >> 1) - ((points.length >> 1) % 3);
    if (!count) return;
    const [r, g, b, a] = this.fill(color);
    this.reserve(6 + count * 3);
    const d = this.data;
    let o = this.length;
    d[o++] = OP_TRIANGLES;
    d[o++] = count;
    d[o++] = r!; d[o++] = g!; d[o++] = b!; d[o++] = a!;
    for (let v = 0; v < count; v++) {
      d[o++] = points[v * 2]!;
      d[o++] = points[v * 2 + 1]!;
      d[o++] = coverage ? coverage[v]! : 1;
    }
    this.length = o;
  }

  arc(cx: number, cy: number, outerRadius: number, innerRadius: number, start: number, sweep: number, color: Paint) {
    this.push(OP_ARC, cx, cy, outerRadius, innerRadius, start, sweep, ...this.fill(color));
  }

  clip(x: number, y: number, w: number, h: number, radius: Radius = 0) {
    this.push(OP_CLIP, x, y, w, h, ...corners(radius));
  }

  unclip() {
    this.push(OP_UNCLIP);
  }

  get commands() {
    return this.data.subarray(0, this.length);
  }
}

export function paintTree(node: UINode, p: Painter) {
  if (node.culled) return; // outside the visible area (see layout.ts)
  const s = node.style;
  const opacity = s.opacity ?? 1;
  if (opacity <= 0) return;
  const outer = p.opacity;
  p.opacity = outer * opacity;
  if (s.shadow) {
    const blur = s.shadow.blur;
    p.shadow(node.x, node.y, node.width, node.height, s.shadow.color, s.radius ?? 0, blur, s.shadow.y ?? 0);
  }
  if (s.background || s.borderWidth) {
    const bg = s.background ?? "transparent";
    const fill = isLinearGradient(bg) ? boxGradient(bg, node.x, node.y, node.width, node.height) : bg;
    p.rect(node.x, node.y, node.width, node.height, fill, s.radius ?? 0, s.borderWidth ?? 0, s.borderColor);
  }
  node.paint?.(p, node);

  // Like CSS overflow: children are clipped to the inside of the border.
  const scroller = scrolls(node);
  const clip = s.clip || scroller;
  if (clip) {
    const b = s.borderWidth ?? 0;
    p.clip(node.x + b, node.y + b, node.width - 2 * b, node.height - 2 * b, insetRadius(s.radius, b));
  }
  for (const c of stacked(node)) paintTree(c, p);
  if (clip) p.unclip();

  if (scroller) {
    paintScrollbar(node, "y", p);
    paintScrollbar(node, "x", p);
  }
  p.opacity = outer;
  if (node.isRoot && node.layers.length) paintLayers(node, p);
}

/** A rounded thumb along the far edge; under the pointer it widens and shows its track. */
function paintScrollbar(node: UINode, axis: "x" | "y", p: Painter) {
  const bar = scrollbar(node, axis);
  if (!bar) return;
  const t = theme.scrollbar;
  const active = node.activeScrollbar?.axis === axis ? node.activeScrollbar : null;
  const thickness = active ? t.hoverSize : t.size;
  const color = active ? (active.pressed ? t.pressed : t.hover) : t.thumb;
  const r = thickness / 2;
  if (axis === "y") {
    const x = bar.x + bar.w - t.margin - thickness;
    if (active) p.rect(x, bar.trackStart, thickness, bar.trackLength, t.track, r);
    p.rect(x, bar.thumbStart, thickness, bar.thumbLength, color, r);
  } else {
    const y = bar.y + bar.h - t.margin - thickness;
    if (active) p.rect(bar.trackStart, y, bar.trackLength, thickness, t.track, r);
    p.rect(bar.thumbStart, y, bar.thumbLength, thickness, color, r);
  }
}

function paintLayers(root: UINode, p: Painter) {
  // Keep overlays inside a clipping frame (the <Window>'s rounded corners).
  const frame = root.children[0];
  const clip = frame?.style.clip;
  if (clip) {
    const b = frame.style.borderWidth ?? 0;
    p.clip(frame.x + b, frame.y + b, frame.width - 2 * b, frame.height - 2 * b, insetRadius(frame.style.radius, b));
  }
  for (const layer of root.layers) paintTree(layer, p);
  if (clip) p.unclip();
}
