// The retained UI tree. Nodes are created once by components and then mutated
// in place by reactive bindings; any mutation schedules a new frame.

import type { ImageSource } from "../image/source.js";

export type Color = string;
export type Edges = number | [vertical: number, horizontal: number] | [top: number, right: number, bottom: number, left: number];

export interface Style {
  // layout
  direction?: "row" | "column";
  gap?: number;
  padding?: Edges;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  grow?: number;
  /** Cross-axis alignment of children. Default: "stretch". */
  align?: "start" | "center" | "end" | "stretch";
  /** Main-axis distribution of children. Default: "start". */
  justify?: "start" | "center" | "end" | "space-between";
  /** Taken out of the flow and placed at left/top inside the parent's padding box. */
  position?: "flow" | "absolute";
  left?: number;
  top?: number;
  /** Clip children to this node's box. */
  clip?: boolean;
  // paint
  background?: Color;
  radius?: number;
  borderWidth?: number;
  borderColor?: Color;
  shadow?: { color: Color; blur: number; y?: number };
  // text
  color?: Color;
  fontSize?: number;
  bold?: boolean;
  // interaction
  cursor?: string;
}

export interface PointerEvent {
  /** Window coordinates (logical px). */
  x: number;
  y: number;
  /** Position relative to the node handling the event (its top-left corner). */
  localX: number;
  localY: number;
  /** 0 left, 1 middle, 2 right; on moves, the held button or -1. */
  button: number;
  /** Number of quick successive clicks (2 = double click). */
  clicks: number;
  stop(): void;
}

export interface KeyEvent {
  key: string;
  text: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  repeat: boolean;
  stop(): void;
}

export interface ScrollEvent {
  dx: number;
  dy: number;
  stop(): void;
}

export interface Handlers {
  onClick?: (e: PointerEvent) => void;
  onPointerDown?: (e: PointerEvent) => void;
  onPointerUp?: (e: PointerEvent) => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  /** The pointer moved over this node, or anywhere while a press that started here is held. */
  onPointerMove?: (e: PointerEvent) => void;
  onScroll?: (e: ScrollEvent) => void;
  onKeyDown?: (e: KeyEvent) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

export interface Size {
  width: number;
  height: number;
}

/** What custom-painted nodes draw with (implemented by paint.ts). */
export interface Painter {
  rect(x: number, y: number, w: number, h: number, color: Color, radius?: number, borderWidth?: number, borderColor?: Color): void;
  shadow(x: number, y: number, w: number, h: number, color: Color, radius: number, blur: number): void;
  text(x: number, y: number, text: string, size: number, color: Color, bold?: boolean): void;
  /** Draws `uv` (a sub-rectangle of the image, 0..1) stretched over the box, multiplied by `tint` (default white). */
  image(x: number, y: number, w: number, h: number, source: ImageSource, uv: readonly [number, number, number, number], radius?: number, opacity?: number, tint?: Color): void;
  /** A thick segment with antialiased edges; each end is round or butt (flat at the point). */
  line(x0: number, y0: number, x1: number, y1: number, width: number, color: Color, capStart?: LineCap, capEnd?: LineCap): void;
  /** Filled triangles (x, y pairs, 3 vertices each); `coverage` (0..1 per vertex, default 1) fades edges. */
  triangles(points: ArrayLike<number>, coverage: ArrayLike<number> | null, color: Color): void;
  /** Ring sector (pie slice with innerRadius 0). Angles in radians, 0 = up, positive = clockwise. */
  arc(cx: number, cy: number, outerRadius: number, innerRadius: number, start: number, sweep: number, color: Color): void;
  /** Clips to a (optionally rounded) rect until the matching unclip(). */
  clip(x: number, y: number, w: number, h: number, radius?: number): void;
  unclip(): void;
}

export type LineCap = "butt" | "round";

export interface TextMetrics {
  width: number;
  ascent: number;
  descent: number;
}

export type TextMeasurer = (text: string, size: number, bold: boolean) => TextMetrics;

let scheduleFrame: () => void = () => {};
let measurer: TextMeasurer = (text, size) => ({ width: text.length * size * 0.55, ascent: size * 0.9, descent: size * 0.25 });
let generation = 0;

/** Wired by the app runtime; tests can install a fake measurer. */
export function setFrameScheduler(fn: () => void) {
  scheduleFrame = fn;
}
export function setTextMeasurer(fn: TextMeasurer) {
  measurer = fn;
  generation++;
}
/** Bumped whenever earlier measurements may be wrong (new measurer, new scale); per-node caches compare it. */
export function metricsGeneration() {
  return generation;
}
export function textMetricsChanged() {
  generation++;
}

let scale = 1;
/** Integer device scale of the window (2 on HiDPI); widgets that rasterize use it to stay sharp. */
export function displayScale() {
  return scale;
}
export function setDisplayScale(value: number) {
  scale = value;
}
export function measureText(text: string, size: number, bold = false): TextMetrics {
  return measurer(text, size, bold);
}
export function invalidate() {
  scheduleFrame();
}

export class UINode {
  readonly style: Style = {};
  readonly handlers: Handlers = {};
  parent: UINode | null = null;
  /** Children are grouped in slots: static ones, or reactive regions that swap their nodes. */
  private slots: UINode[][] = [];
  private flat: UINode[] | null = [];

  focusable = false;
  /** Children may overflow vertically and are scrolled by `scrollY`. */
  scrollable = false;
  /** Pressing here (outside clickable children) moves the window. */
  dragRegion = false;
  /** Optional intrinsic size (text, custom widgets). */
  measure?: (maxWidth: number) => Size;
  /** Optional custom drawing, called after background and before children. */
  paint?: (p: Painter, node: UINode) => void;
  /** Debug label shown by `debugTree`. */
  label: string;

  // Layout results (absolute, logical pixels).
  x = 0;
  y = 0;
  width = 0;
  height = 0;
  /** Content extent, used by scroll containers. */
  contentHeight = 0;
  scrollY = 0;
  /** Outside the visible area in the last layout: its box is set, its subtree is stale and skipped. */
  culled = false;

  constructor(label = "box") {
    this.label = label;
  }

  set<K extends keyof Style>(key: K, value: Style[K]) {
    if (this.style[key] === value) return;
    this.style[key] = value;
    invalidate();
  }

  addSlot(): number {
    this.slots.push([]);
    return this.slots.length - 1;
  }

  setSlot(index: number, nodes: UINode[]) {
    for (const old of this.slots[index]!) if (old.parent === this && !nodes.includes(old)) old.parent = null;
    for (const n of nodes) n.parent = this;
    this.slots[index] = nodes;
    this.flat = null;
    invalidate();
  }

  get children(): readonly UINode[] {
    return (this.flat ??= this.slots.flat());
  }

  /** True when the node is still connected to a root (window). */
  get attached(): boolean {
    let n: UINode = this;
    while (n.parent) n = n.parent;
    return n.isRoot;
  }

  isRoot = false;
}

export function debugTree(node: UINode, indent = ""): string {
  const box = `${Math.round(node.x)},${Math.round(node.y)} ${Math.round(node.width)}x${Math.round(node.height)}`;
  let out = `${indent}${node.label} [${box}]\n`;
  for (const c of node.children) out += debugTree(c, indent + "  ");
  return out;
}
