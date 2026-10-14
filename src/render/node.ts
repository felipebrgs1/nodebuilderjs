// The retained UI tree. Nodes are created once by components and then mutated
// in place by reactive bindings; any mutation schedules a new frame.

import type { ImageSource } from "../image/source.js";
import { onMount } from "../reactive/signals.js";
import type { CanvasGradient, LinearGradient } from "./gradient.js";

export type Color = string;
/** What fills a shape: a solid color or a gradient along a line (Canvas's `g.linearGradient()`). */
export type Paint = Color | CanvasGradient;
/** A box background: a solid color or `{ linear: stops, angle }`. */
export type Background = Color | LinearGradient;
export type Axis = "x" | "y";
export type Edges = number | [vertical: number, horizontal: number] | [top: number, right: number, bottom: number, left: number];
/** A size relative to the parent's content box (inside its padding), as in CSS: `"50%"`. */
export type Percent = `${number}%`;
/** Sizes that may be a `Percent`. */
export type SizeKey = "width" | "height" | "minWidth" | "minHeight" | "maxWidth" | "maxHeight";

/** Corner radius: one for all corners, or one per corner (clockwise from the top left, as in CSS). */
export type Radius = number | readonly [topLeft: number, topRight: number, bottomRight: number, bottomLeft: number];

/** The four radii of `r` (top left, top right, bottom right, bottom left). */
export function corners(r: Radius | undefined): readonly [number, number, number, number] {
  return typeof r === "object" ? r : [r ?? 0, r ?? 0, r ?? 0, r ?? 0];
}

/** `r` minus `by` on every corner, never below 0 (the inside of a border, an image inside padding). */
export function insetRadius(r: Radius | undefined, by: number): Radius {
  if (typeof r !== "object") return Math.max(0, (r ?? 0) - by);
  return [Math.max(0, r[0] - by), Math.max(0, r[1] - by), Math.max(0, r[2] - by), Math.max(0, r[3] - by)];
}

export interface Style {
  // layout
  /** "grid" places children in rows of `columns` equal cells (the `Grid` widget). */
  direction?: "row" | "column" | "grid";
  gap?: number;
  /** Number of equal-width columns of a grid (`direction: "grid"`); with `minColumnWidth`, the most there will be. */
  columns?: number;
  /**
   * Grid: as many columns as fit at least this wide (CSS `repeat(auto-fill, minmax(w, 1fr))`);
   * they share the leftover width, so cells grow until one more column fits.
   */
  minColumnWidth?: number;
  /**
   * Row/Column: children that do not fit start a new line (a Row breaks at its width, a
   * Column at its height), each line laid out on its own (grow, justify, alignSelf).
   */
  wrap?: boolean;
  /** Space between the rows of a grid, or between the lines of a wrapping Row/Column. Default: `gap`. */
  rowGap?: number;
  padding?: Edges;
  /**
   * Space outside the border that the parent's layout keeps free (CSS order; negative values
   * pull neighbors closer). Not painted and not hit: the node's box is its border box.
   * On an absolute child, an extra offset from the edges it is placed by.
   */
  margin?: Edges;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  grow?: number;
  /**
   * Width / height. With one side free, it follows the other (a width from the parent, a
   * height from a fixed `height` or a stretching row); min/max still clamp, and content
   * taller than the ratio allows makes the box taller (like CSS `aspect-ratio`).
   */
  aspectRatio?: number;
  /** Cross-axis alignment of children. Default: "stretch". */
  align?: "start" | "center" | "end" | "stretch";
  /** This node's cross-axis alignment, overriding its parent's `align`. */
  alignSelf?: "start" | "center" | "end" | "stretch";
  /** Main-axis distribution of children. Default: "start". */
  justify?: "start" | "center" | "end" | "space-between";
  /**
   * Taken out of the flow and placed by left/top/right/bottom, measured from the parent's
   * content box (inside its padding). It scrolls with the parent's content.
   */
  position?: "flow" | "absolute";
  left?: number;
  top?: number;
  /** With `left` (and no `width`), stretches to this distance from the right edge; alone, places from it. */
  right?: number;
  /** With `top` (and no `height`), stretches to this distance from the bottom edge; alone, places from it. */
  bottom?: number;
  /** Clip children to this node's box. */
  clip?: boolean;
  /**
   * Paint and hit-test order among siblings (default 0): higher is above, ties keep child
   * order. It only orders siblings (no global stacking); overlays stay above everything.
   */
  zIndex?: number;
  // paint
  /** A color, or a linear gradient: `{ linear: ["#1db954", "#121212"], angle: 180 }` (stops are colors or `[color, offset]`). */
  background?: Background;
  /** One radius, or `[topLeft, topRight, bottomRight, bottomLeft]` (e.g. `[0, 12, 12, 0]`). Also rounds the clip and the shadow. */
  radius?: Radius;
  borderWidth?: number;
  borderColor?: Color;
  shadow?: { color: Color; blur: number; y?: number };
  // text
  color?: Color;
  fontSize?: number;
  /** Shorthand for `fontWeight` 700 (true) or 400 (false); a `fontWeight` on the same node wins. Inherited. */
  bold?: boolean;
  /** 1..1000, like CSS (400 regular, 700 bold); the closest the system has, any value with a variable font. Inherited. */
  fontWeight?: number;
  /** The italic face (or, without one, the upright glyphs slanted). Inherited. */
  italic?: boolean;
  /** Extra px after every character (grapheme cluster), the last one too, as in browsers; may be negative. Inherited. */
  letterSpacing?: number;
  /**
   * A CSS font family list, e.g. `"Inter, 'Noto Sans', sans-serif"`: families added with
   * `registerFont`, installed ones by name, or generic ones (`sans-serif`, `serif`, `monospace`,
   * `system-ui`, `emoji`...). Each character uses the first family that has it, then the system's
   * fallback; missing families are skipped. Default: the system UI font. Inherited.
   */
  fontFamily?: string;
  /** OpenType features, CSS `font-feature-settings` or HarfBuzz syntax: `"tnum, ss01, -liga"`, `'"liga" 0'`. Inherited. */
  fontFeatures?: string;
  /** Variable font axes, CSS `font-variation-settings` or HarfBuzz syntax: `"wdth 75, opsz 12"`; `wght` wins over `fontWeight`. Inherited. */
  fontVariations?: string;
  /** A line under the text of <Text> (inherited, like `bold`). */
  underline?: boolean;
  // interaction
  cursor?: string;
  /** 0..1, multiplies the alpha of everything the node and its children draw. */
  opacity?: number;
  /** Moves the node and its children after layout (siblings stay put), like CSS translate. */
  translateX?: number;
  translateY?: number;
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
  /** After a layout that gave the node a new size (and after the first one). */
  onResize?: (size: Size) => void;
}

export interface Size {
  width: number;
  height: number;
}

/** What custom-painted nodes draw with (implemented by paint.ts). */
export interface Painter {
  /** 0..1, multiplies the alpha of everything drawn (set by paintTree from `opacity`). */
  opacity: number;
  rect(x: number, y: number, w: number, h: number, color: Paint, radius?: Radius, borderWidth?: number, borderColor?: Color): void;
  shadow(x: number, y: number, w: number, h: number, color: Color, radius: Radius, blur: number): void;
  /** `font`: true for bold (the old flag), or the weight, italic and letter spacing. */
  text(x: number, y: number, text: string, size: number, color: Color, font?: FontInput): void;
  /** Draws `uv` (a sub-rectangle of the image, 0..1) stretched over the box, multiplied by `tint` (default white). */
  image(x: number, y: number, w: number, h: number, source: ImageSource, uv: readonly [number, number, number, number], radius?: number, opacity?: number, tint?: Color): void;
  /** A thick segment with antialiased edges; each end is round or butt (flat at the point). */
  line(x0: number, y0: number, x1: number, y1: number, width: number, color: Paint, capStart?: LineCap, capEnd?: LineCap): void;
  /** Filled triangles (x, y pairs, 3 vertices each); `coverage` (0..1 per vertex, default 1) fades edges. */
  triangles(points: ArrayLike<number>, coverage: ArrayLike<number> | null, color: Paint): void;
  /** Ring sector (pie slice with innerRadius 0). Angles in radians, 0 = up, positive = clockwise. */
  arc(cx: number, cy: number, outerRadius: number, innerRadius: number, start: number, sweep: number, color: Paint): void;
  /** Clips to a (optionally rounded) rect until the matching unclip(). */
  clip(x: number, y: number, w: number, h: number, radius?: Radius): void;
  unclip(): void;
}

export type LineCap = "butt" | "round";

export interface TextMetrics {
  width: number;
  ascent: number;
  descent: number;
}

/**
 * The face text is drawn with, resolved: weight 1..1000, italic, letterSpacing in px, and the
 * family list, features and variations as written in the style ("" = none).
 */
export interface FontStyle {
  weight: number;
  italic: boolean;
  letterSpacing: number;
  family: string;
  features: string;
  variations: string;
}
/** `true`/`false` = bold or regular (the old flag); an object fills in the rest from regular. */
export type FontInput = boolean | Partial<FontStyle>;

export const REGULAR: FontStyle = Object.freeze({ weight: 400, italic: false, letterSpacing: 0, family: "", features: "", variations: "" });
const BOLD: FontStyle = Object.freeze({ ...REGULAR, weight: 700 });

export function fontStyle(font: FontInput | undefined): FontStyle {
  if (font === undefined || font === false) return REGULAR;
  if (font === true) return BOLD;
  if (font.weight !== undefined && font.italic !== undefined && font.letterSpacing !== undefined && font.family !== undefined && font.features !== undefined && font.variations !== undefined) return font as FontStyle;
  return {
    weight: font.weight ?? 400, italic: font.italic ?? false, letterSpacing: font.letterSpacing ?? 0,
    family: font.family ?? "", features: font.features ?? "", variations: font.variations ?? "",
  };
}

/**
 * The addon's font spec (TEXT command, measureText): family, features and variations joined by
 * U+001F, or "" when all are empty (the UI font, nothing else).
 */
export function fontSpec(font: FontStyle): string {
  return font.family || font.features || font.variations ? `${font.family}\x1f${font.features}\x1f${font.variations}` : "";
}

/** The addon's font id (TEXT command, measureText): the weight, rounded into 1..1000, times 2, plus 1 if italic. */
export function fontId(weight: number, italic: boolean): number {
  const w = Math.min(1000, Math.max(1, Math.round(weight) || 400));
  return w * 2 + (italic ? 1 : 0);
}

/**
 * Text metrics in logical px. The width must include `font.letterSpacing` after every
 * character, as the addon does, so wrapping and selection match what gets drawn.
 */
export type TextMeasurer = (text: string, size: number, font: FontStyle) => TextMetrics;

let scheduleFrame: () => void = () => {};
let measurer: TextMeasurer = (text, size, font) => ({
  width: text.length * size * 0.55 + Array.from(text).length * font.letterSpacing,
  ascent: size * 0.9,
  descent: size * 0.25,
});
let generation = 0;

/** Wired by the app runtime; tests can install a fake measurer. */
export function setFrameScheduler(fn: () => void) {
  scheduleFrame = fn;
}
export function setTextMeasurer(fn: TextMeasurer) {
  measurer = fn;
  generation++;
}
/** The measurer in use (a screenshot swaps in the real one and puts this back). */
export function textMeasurer(): TextMeasurer {
  return measurer;
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
export function measureText(text: string, size: number, font?: FontInput): TextMetrics {
  return measurer(text, size, fontStyle(font));
}
let invalidations = 0;
export function invalidate() {
  invalidations++;
  scheduleFrame();
}
/** Counts invalidate() calls: layout compares it around onResize handlers to know whether they changed anything. */
export function invalidationCount() {
  return invalidations;
}

export type Placement = "bottom" | "top" | "right" | "left";

/** Set on the top node of an <Overlay> layer. */
export interface OverlayOptions {
  /** Absent: the layer covers the window. Present: the layer is sized to its content next to the anchor. */
  anchor?: () => ElementRef | undefined;
  placement: Placement;
  offset: number;
  matchWidth: boolean;
  /** Covers the window (ignoring `anchor`), blocks the pointer and keeps Tab inside. */
  modal: boolean;
  /** Without an anchor (or modal): distance from the window's edges; what it leaves uncovered stays usable. */
  inset?: Edges;
  onDismiss?: () => void;
}

/** Every live overlay layer, in creation order (later ones draw above). Each root picks its own in layout(). */
export const overlayLayers = new Set<UINode>();

/** Nodes waiting for scrollIntoView(); the next layout of their root brings them into view. */
export const revealRequests = new Set<UINode>();

/** The element with the keyboard focus in `node`'s window (null outside a window or without focus). */
export function focusedElement(node: UINode): UINode | null {
  let n = node;
  while (n.parent) n = n.parent;
  return (n.isRoot && n.focusHost?.focused) || null;
}

/** What a `ref` receives: the box from the last layout (window coordinates) and imperative actions. */
export interface ElementRef {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly scrollX: number;
  readonly scrollY: number;
  focus(): void;
  blur(): void;
  /** On a Scroll: moves its content to `y`, or to `{ x, y }` (either may be left out). */
  scrollTo(to: number | { x?: number; y?: number }): void;
  /** Scrolls the Scrolls around the element as little as needed to show it (on the next layout). */
  scrollIntoView(): void;
}

export class UINode implements ElementRef {
  readonly style: Style = {};
  readonly handlers: Handlers = {};
  parent: UINode | null = null;
  /** Children are grouped in slots: static ones, or reactive regions that swap their nodes. */
  private slots: UINode[][] = [];
  private flat: UINode[] | null = [];

  focusable = false;
  /** Reached with Tab (when focusable). False for things focused only by clicking, like selectable text. */
  tabStop = true;
  /** Children may overflow vertically and are scrolled by `scrollY`. */
  scrollable = false;
  /** Children may overflow horizontally and are scrolled by `scrollX`. */
  scrollableX = false;
  /** Pressing here (outside clickable children) moves the window. */
  dragRegion = false;
  /** Optional intrinsic size (text, custom widgets); `maxWidth` is Infinity for the natural size. */
  measure?: (maxWidth: number) => Size;
  /** Content that wraps: the narrowest width it can take (its longest word). Its height then depends on the width given to measure(). */
  minContentWidth?: () => number;
  /** Optional custom drawing, called after background and before children. */
  paint?: (p: Painter, node: UINode) => void;
  /** Debug label shown by `debugTree`. */
  label: string;
  /** Accessible name for nodes without text of their own (icon-only buttons); what `findByLabel` matches. */
  ariaLabel?: string;
  /** On a text field: its value, what it draws (masked for a password) and its placeholder; what `findByValue` reads. */
  field?: { value(): string; shown(): string; placeholder(): string | undefined };

  // Layout results (absolute, logical pixels).
  x = 0;
  y = 0;
  width = 0;
  height = 0;
  /** Content extent (children plus padding), used by scroll containers. */
  contentWidth = 0;
  contentHeight = 0;
  scrollX = 0;
  scrollY = 0;
  /** Outside the visible area in the last layout: its box is set, its subtree is stale and skipped. */
  culled = false;
  /** Px its children overflow by where the excess is hidden, in the last layout (dev warnings, debugTree). */
  overflow = 0;
  /** Scrollbar under the pointer or being dragged (set by input, drawn wider by paint). */
  activeScrollbar: { axis: Axis; pressed: boolean } | null = null;

  constructor(label = "box") {
    this.label = label;
  }

  set<K extends keyof Style>(key: K, value: Style[K]) {
    if (this.covered && key in this.covered) {
      this.covered[key] = value; // shown again when the override ends
      return;
    }
    if (this.style[key] === value) return;
    this.style[key] = value;
    invalidate();
  }

  /** Base values under an override (hoverStyle/pressStyle), kept up to date by set(). */
  private covered: Partial<Style> | null = null;

  /**
   * Shows `value` for `key` over whatever set() gives it (widget defaults, the app's props);
   * `undefined` ends the override and brings the latest base value back.
   */
  override<K extends keyof Style>(key: K, value: Style[K] | undefined) {
    const covered = (this.covered ??= {});
    const active = key in covered;
    if (value === undefined) {
      if (!active) return;
      const base = covered[key];
      delete covered[key];
      this.set(key, base);
      return;
    }
    if (!active) covered[key] = this.style[key];
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
  /** On a root: overlay layers drawn above the tree, bottom to top (filled by layout). */
  layers: UINode[] = [];
  /** On an overlay layer: how it is placed and dismissed. Its `parent` is the <Overlay> placeholder. */
  overlay?: OverlayOptions;
  /** On a root: the input system's focus, set by createInput (what focus()/blur() go through). */
  focusHost?: { readonly focused: UINode | null; setFocus(node: UINode | null): void };
  /** On a root without input yet (a test before interact()): the node focus() asked for, taken by createInput. */
  pendingFocus: UINode | null = null;
  /** Last size given to onResize. */
  reportedSize: Size | null = null;
  /** Sizes given as percentages (0..100 and more); layout writes the px value into `style` from the parent's content box. */
  percents: Partial<Record<SizeKey, number>> | null = null;

  /** Makes `key` a percentage of the parent's content box (`undefined`: no longer one). */
  setPercent(key: SizeKey, value: number | undefined) {
    if (value === undefined) {
      if (this.percents?.[key] === undefined) return;
      delete this.percents[key];
      delete this.style[key];
    } else {
      if (this.percents?.[key] === value) return;
      (this.percents ??= {})[key] = value;
    }
    invalidate();
  }

  private host() {
    let n: UINode = this;
    while (n.parent) n = n.parent;
    return n.isRoot ? n.focusHost : undefined;
  }

  /**
   * Focuses the node if it is focusable. Called while the node is being created (a `ref`), it
   * lands as soon as the insert that creates it puts it in the tree.
   */
  focus() {
    if (!this.focusNow()) {
      // Still being created: widgets may set `focusable` after handing out the ref.
      onMount(() => this.focusNow() || queueMicrotask(() => this.focusNow()));
    }
  }

  /** False while the node is not in a tree yet. */
  private focusNow(): boolean {
    let root: UINode = this;
    while (root.parent) root = root.parent;
    if (!root.isRoot) return false;
    if (!this.focusable) return true;
    if (root.focusHost) root.focusHost.setFocus(this);
    else root.pendingFocus = this;
    return true;
  }

  blur() {
    const host = this.host();
    if (host?.focused === this) host.setFocus(null);
  }

  /** Scrolls a scrollable node; layout clamps the position to the content. */
  scrollTo(to: number | { x?: number; y?: number }) {
    const { x, y } = typeof to === "number" ? { x: undefined, y: to } : to;
    if (y !== undefined && this.scrollable) this.scrollY = Math.max(0, y);
    if (x !== undefined && this.scrollableX) this.scrollX = Math.max(0, x);
    invalidate();
  }

  /**
   * Done by the next layout, where the boxes are current: even when the node is new, or was
   * culled (outside the view, its own coordinates are stale).
   */
  scrollIntoView() {
    revealRequests.add(this);
    invalidate();
  }
}

/** Children in paint order, bottom to top: by zIndex, then child order. Allocates only when a child has a zIndex. */
export function stacked(node: UINode): readonly UINode[] {
  const kids = node.children;
  for (const c of kids) {
    if (c.style.zIndex) return [...kids].sort((a, b) => (a.style.zIndex ?? 0) - (b.style.zIndex ?? 0)); // stable
  }
  return kids;
}

/** Scrolls on some axis (and so clips its children). */
export function scrolls(n: UINode): boolean {
  return n.scrollable || n.scrollableX;
}

export function debugTree(node: UINode, indent = ""): string {
  const box = `${Math.round(node.x)},${Math.round(node.y)} ${Math.round(node.width)}x${Math.round(node.height)}`;
  const aria = node.ariaLabel === undefined ? "" : ` ariaLabel=${JSON.stringify(node.ariaLabel)}`;
  const overflow = node.overflow ? ` [overflow +${node.overflow}]` : "";
  let out = `${indent}${node.label}${aria} [${box}]${overflow}\n`;
  for (const c of node.children) out += debugTree(c, indent + "  ");
  return out;
}
