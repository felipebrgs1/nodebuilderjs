// Scroll positions and scrollbars of scrolling nodes. The geometry is shared by paint (drawing
// the bars) and input (wheel, keys, dragging the thumb, paging on the track).
//
// Bars are drawn over the content (overlay scrollbars, like GTK and macOS) and take no room in
// the layout. Where a bar is, a strip along the edge takes the pointer, but only while there
// is something to scroll that way.

import type { Axis, UINode } from "./node.js";
import { theme } from "../theme.js";

/** Arrow keys and the wheel's notches on X11 move about this much. */
export const LINE_STEP = 40;

export function overflows(n: UINode, axis: Axis): boolean {
  return axis === "y" ? n.scrollable && n.contentHeight > n.height : n.scrollableX && n.contentWidth > n.width;
}

/** How far the content can move along `axis`. */
export function scrollRange(n: UINode, axis: Axis): number {
  return Math.max(0, axis === "y" ? n.contentHeight - n.height : n.contentWidth - n.width);
}

export function scrollPosition(n: UINode, axis: Axis): number {
  return axis === "y" ? n.scrollY : n.scrollX;
}

/** Moves the content to `value` (clamped to what can scroll); false when nothing moved. */
export function scrollTo(n: UINode, axis: Axis, value: number): boolean {
  const v = Math.max(0, Math.min(scrollRange(n, axis), value));
  if (v === scrollPosition(n, axis)) return false;
  if (axis === "y") n.scrollY = v;
  else n.scrollX = v;
  return true;
}

export function scrollBy(n: UINode, axis: Axis, delta: number): boolean {
  return scrollTo(n, axis, scrollPosition(n, axis) + delta);
}

/** One "page" (PageDown, a press on the track): most of the visible size, keeping a bit of context. */
export function pageStep(n: UINode, axis: Axis): number {
  return Math.round((axis === "y" ? n.height : n.width) * 0.875);
}

export interface Scrollbar {
  axis: Axis;
  /** The strip along the edge that takes the pointer (window coordinates). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Where the thumb can travel, along the axis. */
  trackStart: number;
  trackLength: number;
  thumbStart: number;
  thumbLength: number;
}

/** The bar of `n` along `axis`, or null when there is nothing to scroll that way. */
export function scrollbar(n: UINode, axis: Axis): Scrollbar | null {
  if (!overflows(n, axis)) return null;
  const t = theme.scrollbar;
  const b = n.style.borderWidth ?? 0;
  const strip = t.hoverSize + 2 * t.margin;
  // With both bars, each stops before the corner where the other one runs.
  const corner = overflows(n, axis === "y" ? "x" : "y") ? strip : 0;
  const vertical = axis === "y";
  const x = vertical ? n.x + n.width - b - strip : n.x + b;
  const y = vertical ? n.y + b : n.y + n.height - b - strip;
  const w = vertical ? strip : n.width - 2 * b - corner;
  const h = vertical ? n.height - 2 * b - corner : strip;
  const trackStart = (vertical ? y : x) + t.margin;
  const trackLength = Math.max(0, (vertical ? h : w) - 2 * t.margin);
  const visible = vertical ? n.height : n.width;
  const content = vertical ? n.contentHeight : n.contentWidth;
  const thumbLength = Math.min(trackLength, Math.max(t.minThumb, (visible / content) * trackLength));
  const thumbStart = trackStart + (scrollPosition(n, axis) / scrollRange(n, axis)) * (trackLength - thumbLength);
  return { axis, x, y, w, h, trackStart, trackLength, thumbStart, thumbLength };
}

/** The bar of `n` under (x, y), if any. */
export function scrollbarAt(n: UINode, x: number, y: number): Scrollbar | null {
  // Cheap test first: hit testing asks this of every Scroll under the pointer.
  const t = theme.scrollbar;
  const edge = t.hoverSize + 2 * t.margin + (n.style.borderWidth ?? 0);
  if (x < n.x + n.width - edge && y < n.y + n.height - edge) return null;
  const v = scrollbar(n, "y");
  if (v && contains(v, x, y)) return v;
  const h = scrollbar(n, "x");
  return h && contains(h, x, y) ? h : null;
}

function contains(bar: Scrollbar, x: number, y: number) {
  return x >= bar.x && x < bar.x + bar.w && y >= bar.y && y < bar.y + bar.h;
}
