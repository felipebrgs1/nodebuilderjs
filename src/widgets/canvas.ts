// <Canvas>: custom drawing with the GPU primitives, like Flutter's CustomPaint.
//
// `draw` runs inside an effect, so the signals it reads are tracked: when one changes,
// the drawing is recorded again and a frame is scheduled. The size is a signal too, set by
// painting, so `draw` never sees a canvas that was not laid out yet. Painting replays the
// recording, offset to where the canvas is.

import { edges } from "../render/layout.js";
import { type Color, type Handlers, type LineCap, type Painter, UINode, invalidate, measureText } from "../render/node.js";
import { type PolylineOptions, fillPolygon, polyline } from "../render/shapes.js";
import { createEffect, createSignal } from "../reactive/signals.js";
import { displayScale } from "../render/node.js";
import { theme } from "../theme.js";
import { type StyleProps, applyProps } from "./props.js";

/** What `<Canvas draw>` draws with. Coordinates are local to the canvas (inside its padding). */
export interface DrawContext {
  readonly width: number;
  readonly height: number;
  rect(x: number, y: number, w: number, h: number, color: Color, radius?: number): void;
  line(x0: number, y0: number, x1: number, y1: number, color: Color, width?: number, cap?: "round" | "butt" | "square"): void;
  polyline(points: ArrayLike<number>, color: Color, width?: number, options?: PolylineOptions): void;
  /** Filled simple polygon (concave allowed; self-intersecting draws nothing). */
  polygon(points: ArrayLike<number>, color: Color): void;
  circle(cx: number, cy: number, radius: number, color: Color): void;
  /** Ring sector; angles in radians, 0 = up, positive = clockwise. innerRadius 0 = pie slice. */
  arc(cx: number, cy: number, outerRadius: number, innerRadius: number, start: number, sweep: number, color: Color): void;
  /** `y` is the top of the line box. */
  text(text: string, x: number, y: number, color: Color, size?: number, bold?: boolean): void;
  measureText(text: string, size?: number, bold?: boolean): { width: number; height: number };
}

type Op = (p: Painter, ox: number, oy: number) => void;

/**
 * Shapes are turned into primitives (segments, triangles) once, when recorded, in local
 * coordinates: repainting (a hover elsewhere in the window) only offsets them.
 */
function geometry(build: (p: Pick<Painter, "line" | "triangles">) => void): Op {
  const lines: [number, number, number, number, number, Color, LineCap, LineCap][] = [];
  const meshes: { points: Float32Array; coverage: Float32Array | null; color: Color }[] = [];
  build({
    line: (x0: number, y0: number, x1: number, y1: number, width: number, color: Color, capStart: LineCap = "round", capEnd: LineCap = "round") =>
      lines.push([x0, y0, x1, y1, width, color, capStart, capEnd]),
    triangles: (points: ArrayLike<number>, coverage: ArrayLike<number> | null, color: Color) =>
      meshes.push({ points: Float32Array.from(points), coverage: coverage && Float32Array.from(coverage), color }),
  });
  return (p, ox, oy) => {
    for (const [x0, y0, x1, y1, width, color, a, b] of lines) p.line(x0 + ox, y0 + oy, x1 + ox, y1 + oy, width, color, a, b);
    for (const m of meshes) {
      const shifted = new Float32Array(m.points.length);
      for (let i = 0; i < shifted.length; i += 2) {
        shifted[i] = m.points[i]! + ox;
        shifted[i + 1] = m.points[i + 1]! + oy;
      }
      p.triangles(shifted, m.coverage, m.color);
    }
  };
}

function record(width: number, height: number, scale: number, ops: Op[]): DrawContext {
  return {
    width,
    height,
    rect: (x, y, w, h, color, radius = 0) => ops.push((p, ox, oy) => p.rect(x + ox, y + oy, w, h, color, radius)),
    line: (x0, y0, x1, y1, color, width = 1, cap = "round") => ops.push(geometry((p) => polyline(p, [x0, y0, x1, y1], width, color, { cap }))),
    polyline: (points, color, width = 1, options) => ops.push(geometry((p) => polyline(p, points, width, color, options))),
    polygon: (points, color) => ops.push(geometry((p) => fillPolygon(p, points, color, scale))),
    circle: (cx, cy, radius, color) => ops.push((p, ox, oy) => p.arc(cx + ox, cy + oy, radius, 0, 0, 2 * Math.PI, color)),
    arc: (cx, cy, outer, inner, start, sweep, color) => ops.push((p, ox, oy) => p.arc(cx + ox, cy + oy, outer, inner, start, sweep, color)),
    text: (text, x, y, color, size = theme.font.size, bold = false) => ops.push((p, ox, oy) => p.text(x + ox, y + oy, text, size, color, bold)),
    measureText: (text, size = theme.font.size, bold = false) => {
      const m = measureText(text, size, bold);
      return { width: m.width, height: m.ascent + m.descent };
    },
  };
}

export function Canvas(props: StyleProps & Handlers & { draw: (g: DrawContext) => void }) {
  const node = new UINode("Canvas");
  applyProps(node, props);
  let ops: Op[] = [];
  let painting = false;
  // The scale is part of it: polygon edges are antialiased over one device pixel.
  const [size, setSize] = createSignal({ width: 0, height: 0, scale: 1 }, { equals: (a, b) => a.width === b.width && a.height === b.height && a.scale === b.scale });
  createEffect(() => {
    const { width, height, scale } = size();
    const next: Op[] = [];
    if (width > 0 && height > 0) props.draw(record(width, height, scale, next));
    ops = next;
    if (!painting) invalidate(); // a resize during paint is drawn in this same frame
  });
  node.paint = (p, n) => {
    const [pt, pr, pb, pl] = edges(n.style.padding);
    painting = true;
    setSize({ width: Math.max(0, n.width - pl - pr), height: Math.max(0, n.height - pt - pb), scale: displayScale() });
    painting = false;
    for (const op of ops) op(p, n.x + pl, n.y + pt);
  };
  return node;
}
