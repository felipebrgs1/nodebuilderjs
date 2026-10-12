// Linear gradients: the style form (`{ linear, angle }`, relative to the box, like CSS) and the
// painter form (an absolute line from (x0, y0) to (x1, y1), as Canvas's linearGradient()).
// The renderer colors vertices along that line, interpolating in premultiplied space.

/** A color string, or `[color, offset]` with offset 0..1 along the gradient line. */
export type GradientStop = string | readonly [string, number];

/** `background={{ linear: ["#1db954", "#121212"], angle: 180 }}`; angle in degrees like CSS (0 = to top, 90 = to right, default 180 = to bottom). */
export interface LinearGradient {
  readonly linear: readonly GradientStop[];
  readonly angle?: number;
}

/** A gradient along an absolute line, in the painter's coordinates (what `g.linearGradient()` returns). */
export interface CanvasGradient {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly stops: readonly GradientStop[];
}

export function isGradient(v: unknown): v is CanvasGradient {
  return typeof v === "object" && v !== null && "stops" in v;
}

export function isLinearGradient(v: unknown): v is LinearGradient {
  return typeof v === "object" && v !== null && "linear" in v;
}

/** Offsets as CSS resolves them: first 0, last 1, missing ones spread between known neighbours, never decreasing. */
export function resolveStops(stops: readonly GradientStop[]): { offset: number; color: string }[] {
  const out = stops.map((s) => (typeof s === "string" ? { offset: NaN, color: s } : { offset: s[1], color: s[0] }));
  if (!out.length) return out;
  if (Number.isNaN(out[0]!.offset)) out[0]!.offset = 0;
  if (Number.isNaN(out[out.length - 1]!.offset)) out[out.length - 1]!.offset = 1;
  let last = 0;
  for (const s of out) if (!Number.isNaN(s.offset)) last = s.offset = Math.max(s.offset, last);
  for (let i = 1; i < out.length; i++) {
    if (!Number.isNaN(out[i]!.offset)) continue;
    let j = i;
    while (Number.isNaN(out[j]!.offset)) j++;
    const from = out[i - 1]!.offset, to = out[j]!.offset;
    for (let k = i; k < j; k++) out[k]!.offset = from + ((to - from) * (k - i + 1)) / (j - i + 1);
  }
  return out;
}

/** The CSS gradient line of a box: through its center, long enough that the far corners hit 0 and 1. */
export function boxGradient(g: LinearGradient, x: number, y: number, w: number, h: number): CanvasGradient {
  const rad = (((g.angle ?? 180) % 360) * Math.PI) / 180;
  const dx = Math.sin(rad), dy = -Math.cos(rad);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  const cx = x + w / 2, cy = y + h / 2;
  const snap = (v: number) => Math.round(v * 1e6) / 1e6 + 0; // + 0: no -0
  return { x0: snap(cx - dx * half), y0: snap(cy - dy * half), x1: snap(cx + dx * half), y1: snap(cy + dy * half), stops: g.linear };
}

/** The same gradient moved by (dx, dy). */
export function offsetGradient(g: CanvasGradient, dx: number, dy: number): CanvasGradient {
  return { x0: g.x0 + dx, y0: g.y0 + dy, x1: g.x1 + dx, y1: g.y1 + dy, stops: g.stops };
}
