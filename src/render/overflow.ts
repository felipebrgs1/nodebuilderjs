// Overflow warnings: children that need more room than their container gives them, where the
// excess ends up hidden (clipped by an ancestor or by the window). Layout calls checkOverflow()
// for every placed container; the common case is two comparisons. layout() also reports here
// onResize handlers that keep changing sizes. Warnings are only collected here: run() prints
// them in development, tests read them with layoutWarnings().

import { type UINode, scrolls } from "./node.js";
import { type Rect, margins } from "./layout.js";

export interface LayoutWarning {
  /** The container whose children do not fit. */
  container: UINode;
  /** Its first child that reaches past what is visible. */
  child: UINode;
  axis: "x" | "y";
  /** Stable across frames (names from the root down): run() prints each one once. */
  key: string;
  message: string;
}

const EPSILON = 0.5;
let pass: LayoutWarning[] = [];
const byRoot = new WeakMap<UINode, LayoutWarning[]>();

/** Starts collecting for a layout of `root` (the previous layout's warnings are dropped). */
export function resetOverflow(root: UINode) {
  pass = [];
  byRoot.set(root, pass);
}

/** Warnings from the last layout of `root`. */
export function overflowWarnings(root: UINode): readonly LayoutWarning[] {
  return byRoot.get(root) ?? [];
}

/**
 * Called by layout once `node`'s in-flow children are placed. `content` is what they need along
 * the node's direction (after shrinking what can shrink), `widest` the largest size across it.
 */
export function checkOverflow(node: UINode, kids: UINode[], row: boolean, content: number, innerMain: number, widest: number, innerCross: number, view: Rect) {
  const mainAxis = row ? "x" : "y";
  const crossAxis = row ? "y" : "x";
  if (content > innerMain + EPSILON && !scrollsOn(node, mainAxis)) {
    const child = kids.find((c) => end(c, mainAxis) > viewEnd(view, mainAxis) + EPSILON);
    if (child) report(node, child, mainAxis, content - innerMain, `children need ${Math.round(content)}px, ${Math.round(innerMain)}px available`);
  }
  if (widest > innerCross + EPSILON && !scrollsOn(node, crossAxis)) {
    // Margins included: a box that fits can still be pushed past the edge by them.
    const size = (c: UINode) => {
      const [mt, mr, mb, ml] = margins(c);
      return crossAxis === "x" ? c.width + ml + mr : c.height + mt + mb;
    };
    const child = kids.find((c) => size(c) > innerCross + EPSILON && (end(c, crossAxis) > viewEnd(view, crossAxis) + EPSILON || start(c, crossAxis) < viewStart(view, crossAxis) - EPSILON));
    if (child) {
      const need = size(child);
      report(node, child, crossAxis, need - innerCross, `it is ${Math.round(need)}px ${crossAxis === "x" ? "wide" : "tall"}, ${Math.round(innerCross)}px available`);
    }
  }
}

function report(container: UINode, child: UINode, axis: "x" | "y", excess: number, numbers: string) {
  const by = cutBy(container, child, axis);
  if (by === null) return;
  const amount = Math.round(excess);
  container.overflow = Math.max(container.overflow, amount);
  const message = `layout: ${nodeName(container)} > ${nodeName(child)} overflows ${by} by ${amount}px (${numbers})`;
  pass.push({ container, child, axis, key: `${path(container)} > ${nodeName(child)} ${axis}`, message });
}

/** onResize handlers still changing the layout after layout's extra passes (a resize loop). */
export function reportResizeLoop(nodes: UINode[]) {
  const names = nodes.map(nodeName).join(", ");
  pass.push({
    container: nodes[0]!,
    child: nodes[0]!,
    axis: "x",
    key: `onResize ${nodes.map(path).join(" | ")}`,
    message: `layout: onResize keeps changing the layout (${names}): each handler call changes the size it reports`,
  });
}

const scrollsOn = (n: UINode, axis: "x" | "y") => (axis === "x" ? n.scrollableX : n.scrollable);
const start = (n: UINode, axis: "x" | "y") => (axis === "x" ? n.x : n.y);
const end = (n: UINode, axis: "x" | "y") => (axis === "x" ? n.x + n.width : n.y + n.height);
const viewStart = (v: Rect, axis: "x" | "y") => (axis === "x" ? v.x0 : v.y0);
const viewEnd = (v: Rect, axis: "x" | "y") => (axis === "x" ? v.x1 : v.y1);

/** How warnings name a node: `Text("Artists")`, `Box(panel)` (its ariaLabel), `Row`. */
function nodeName(n: UINode): string {
  const label = n.label.startsWith("Text ") ? `Text(${n.label.slice(5)})` : n.label;
  return n.ariaLabel === undefined ? label : `${label}(${n.ariaLabel})`;
}

/**
 * Names what cuts `child` off: the nearest clipping node (the container itself or an ancestor)
 * it reaches past, else the window. Null when that is a Scroll along the axis: scrolling shows it.
 */
function cutBy(container: UINode, child: UINode, axis: "x" | "y"): string | null {
  for (let n: UINode | null = container; n && !n.isRoot; n = n.overlay ? null : n.parent) {
    if (!n.style.clip && !scrolls(n)) continue;
    const b = n.style.borderWidth ?? 0;
    if (end(child, axis) > end(n, axis) - b + EPSILON || start(child, axis) < start(n, axis) + b - EPSILON) {
      return scrollsOn(n, axis) ? null : nodeName(n);
    }
  }
  return "the window";
}

function path(n: UINode): string {
  const names: string[] = [];
  for (let p: UINode | null = n; p; p = p.parent) names.push(nodeName(p));
  return names.reverse().join(" > ");
}
