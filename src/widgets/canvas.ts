// <Canvas>: custom drawing with the GPU primitives, like Flutter's CustomPaint.
//
// `draw` runs inside an effect, so the signals it reads are tracked: when one changes,
// the drawing is recorded again and a frame is scheduled. The size is a signal too, set by
// painting, so `draw` never sees a canvas that was not laid out yet. Painting replays the
// recording, offset to where the canvas is.

import { edges } from "../render/layout.js";
import { type CanvasGradient, type GradientStop, isGradient, offsetGradient } from "../render/gradient.js";
import { type Color, type FontStyle, type Handlers, type LineCap, type Paint, type Painter, UINode, fontStyle, invalidate, measureText } from "../render/node.js";
import { type PolylineOptions, fillPolygon, polyline } from "../render/shapes.js";
import { truncate } from "../render/text-wrap.js";
import { createEffect, createSignal } from "../reactive/signals.js";
import { displayScale } from "../render/node.js";
import { theme } from "../theme.js";
import { type StyleProps, applyProps, inherited } from "./props.js";

/**
 * What `<Canvas draw>` draws with. Coordinates are local to the canvas (inside its padding).
 * Shapes take a `Paint`: a color, or a gradient from `linearGradient()`.
 */
export interface DrawContext {
  readonly width: number;
  readonly height: number;
  rect(x: number, y: number, w: number, h: number, color: Paint, radius?: number): void;
  /** `dash`: dash and gap lengths, like SVG's stroke-dasharray. */
  line(x0: number, y0: number, x1: number, y1: number, color: Paint, width?: number, cap?: "round" | "butt" | "square", dash?: readonly number[]): void;
  polyline(points: ArrayLike<number>, color: Paint, width?: number, options?: PolylineOptions): void;
  /** Filled simple polygon (concave allowed; self-intersecting draws nothing). */
  polygon(points: ArrayLike<number>, color: Paint): void;
  circle(cx: number, cy: number, radius: number, color: Paint): void;
  /** Ring sector; angles in radians, 0 = up, positive = clockwise. innerRadius 0 = pie slice. */
  arc(cx: number, cy: number, outerRadius: number, innerRadius: number, start: number, sweep: number, color: Paint): void;
  /**
   * A gradient from (x0, y0) (offset 0) to (x1, y1) (offset 1), usable wherever a shape takes a
   * color; before and after the line it keeps the end colors. Stops: colors or `[color, offset]`.
   */
  linearGradient(x0: number, y0: number, x1: number, y1: number, stops: readonly GradientStop[]): CanvasGradient;
  /** `y` is the top of the line box. With `maxWidth`, text that does not fit is cut and ends in "…". */
  text(text: string, x: number, y: number, color: Color, size?: number, bold?: boolean, options?: CanvasTextOptions): void;
  measureText(text: string, size?: number, bold?: boolean, options?: CanvasFontOptions): { width: number; height: number };
}

/** Like the <Text> props of the same names. */
export interface CanvasFontOptions {
  /** 1..1000 (400 regular, 700 bold); wins over the `bold` argument. */
  weight?: number;
  italic?: boolean;
  /** Extra px after every character, the last one too; may be negative. */
  letterSpacing?: number;
  /** A CSS font family list (`"Inter, sans-serif"`), like `fontFamily`. */
  family?: string;
  /** OpenType features (`"tnum, -liga"`), like `fontFeatures`. */
  features?: string;
  /** Variable font axes (`"wdth 75"`), like `fontVariations`. */
  variations?: string;
}

export interface CanvasTextOptions extends CanvasFontOptions {
  /** Cut the text to this width; nothing is drawn when not even the "…" fits. */
  maxWidth?: number;
  /** End cut text with "…" (default true); false just cuts it. */
  ellipsis?: boolean;
}

type Op = (p: Painter, ox: number, oy: number) => void;

/** A paint moved with the canvas (gradients are in canvas coordinates). */
const at = (paint: Paint, ox: number, oy: number): Paint => (isGradient(paint) ? offsetGradient(paint, ox, oy) : paint);

/** The family, features and variations the canvas inherits from the tree (text options win). */
type InheritedFont = Pick<FontStyle, "family" | "features" | "variations">;

function canvasFont(bold: boolean, options: CanvasFontOptions | undefined, base: InheritedFont): FontStyle {
  if (!options && !base.family && !base.features && !base.variations) return fontStyle(bold);
  return fontStyle({
    weight: options?.weight ?? (bold ? 700 : 400), italic: options?.italic ?? false, letterSpacing: options?.letterSpacing ?? 0,
    family: options?.family ?? base.family, features: options?.features ?? base.features, variations: options?.variations ?? base.variations,
  });
}

/**
 * Shapes are turned into primitives (segments, triangles) once, when recorded, in local
 * coordinates: repainting (a hover elsewhere in the window) only offsets them.
 */
function geometry(build: (p: Pick<Painter, "line" | "triangles">) => void): Op {
  const lines: [number, number, number, number, number, Paint, LineCap, LineCap][] = [];
  const meshes: { points: Float32Array; coverage: Float32Array | null; color: Paint }[] = [];
  build({
    line: (x0: number, y0: number, x1: number, y1: number, width: number, color: Paint, capStart: LineCap = "round", capEnd: LineCap = "round") =>
      lines.push([x0, y0, x1, y1, width, color, capStart, capEnd]),
    triangles: (points: ArrayLike<number>, coverage: ArrayLike<number> | null, color: Paint) =>
      meshes.push({ points: Float32Array.from(points), coverage: coverage && Float32Array.from(coverage), color }),
  });
  return (p, ox, oy) => {
    for (const [x0, y0, x1, y1, width, color, a, b] of lines) p.line(x0 + ox, y0 + oy, x1 + ox, y1 + oy, width, at(color, ox, oy), a, b);
    for (const m of meshes) {
      const shifted = new Float32Array(m.points.length);
      for (let i = 0; i < shifted.length; i += 2) {
        shifted[i] = m.points[i]! + ox;
        shifted[i + 1] = m.points[i + 1]! + oy;
      }
      p.triangles(shifted, m.coverage, at(m.color, ox, oy));
    }
  };
}

function record(width: number, height: number, scale: number, base: InheritedFont, ops: Op[]): DrawContext {
  return {
    width,
    height,
    rect: (x, y, w, h, color, radius = 0) => ops.push((p, ox, oy) => p.rect(x + ox, y + oy, w, h, at(color, ox, oy), radius)),
    line: (x0, y0, x1, y1, color, width = 1, cap, dash) =>
      ops.push(geometry((p) => polyline(p, [x0, y0, x1, y1], width, color, { cap: cap ?? (dash ? "butt" : "round"), dash }))),
    polyline: (points, color, width = 1, options) => ops.push(geometry((p) => polyline(p, points, width, color, options))),
    polygon: (points, color) => ops.push(geometry((p) => fillPolygon(p, points, color, scale))),
    circle: (cx, cy, radius, color) => ops.push((p, ox, oy) => p.arc(cx + ox, cy + oy, radius, 0, 0, 2 * Math.PI, at(color, ox, oy))),
    arc: (cx, cy, outer, inner, start, sweep, color) => ops.push((p, ox, oy) => p.arc(cx + ox, cy + oy, outer, inner, start, sweep, at(color, ox, oy))),
    text: (text, x, y, color, size = theme.font.size, bold = false, options) => {
      const face = canvasFont(bold, options, base);
      const shown = options?.maxWidth === undefined ? text : truncate(text, options.maxWidth, (s) => measureText(s, size, face).width, options.ellipsis ?? true).text;
      if (shown) ops.push((p, ox, oy) => p.text(x + ox, y + oy, shown, size, color, face));
    },
    linearGradient: (x0, y0, x1, y1, stops) => ({ x0, y0, x1, y1, stops: [...stops] }),
    measureText: (text, size = theme.font.size, bold = false, options) => {
      const m = measureText(text, size, canvasFont(bold, options, base));
      return { width: m.width, height: m.ascent + m.descent };
    },
  };
}

export function Canvas(props: StyleProps & Handlers & { draw: (g: DrawContext) => void }) {
  const node = new UINode("Canvas");
  applyProps(node, props);
  let ops: Op[] = [];
  let painting = false;
  // The scale is part of it: polygon edges are antialiased over one device pixel; so is the
  // inherited font, read when painting (style is not reactive), so text follows the app's font.
  const [size, setSize] = createSignal(
    { width: 0, height: 0, scale: 1, family: "", features: "", variations: "" },
    { equals: (a, b) => a.width === b.width && a.height === b.height && a.scale === b.scale && a.family === b.family && a.features === b.features && a.variations === b.variations },
  );
  createEffect(() => {
    const { width, height, scale, ...base } = size();
    const next: Op[] = [];
    if (width > 0 && height > 0) props.draw(record(width, height, scale, base, next));
    ops = next;
    if (!painting) invalidate(); // a resize during paint is drawn in this same frame
  });
  node.paint = (p, n) => {
    const [pt, pr, pb, pl] = edges(n.style.padding);
    painting = true;
    setSize({
      width: Math.max(0, n.width - pl - pr), height: Math.max(0, n.height - pt - pb), scale: displayScale(),
      family: inherited(n, "fontFamily") ?? "", features: inherited(n, "fontFeatures") ?? "", variations: inherited(n, "fontVariations") ?? "",
    });
    painting = false;
    for (const op of ops) op(p, n.x + pl, n.y + pt);
  };
  return node;
}
