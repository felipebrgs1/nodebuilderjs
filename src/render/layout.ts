// A small flexbox: row/column, gap, padding, grow, shrink-to-fit, align,
// justify, min/max sizes, absolute children and vertical scrolling.

import { type Edges, type Size, type UINode, overlayLayers } from "./node.js";
import { batch } from "../reactive/signals.js";

let cache = new Map<UINode, Size>();
let resized: UINode[] = [];

/** Visible region in absolute logical pixels; narrowed by every clipping node. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function layout(root: UINode, width: number, height: number) {
  cache = new Map();
  resized = [];
  const view = { x0: 0, y0: 0, x1: width, y1: height };
  place(root, 0, 0, width, height, view);
  // Overlays after the tree, so anchors are already placed; nested ones come after their
  // parent layer (they were created inside it).
  root.layers = [];
  for (const layer of overlayLayers) if (rootOf(layer) === root && placeLayer(layer, width, height, view)) root.layers.push(layer);
  // After the whole tree is placed: handlers may change state (and the tree) freely.
  const nodes = resized;
  resized = [];
  if (nodes.length) batch(() => nodes.forEach((n) => n.handlers.onResize?.(n.reportedSize!)));
}

function rootOf(node: UINode): UINode {
  let n = node;
  while (n.parent) n = n.parent;
  return n;
}

/** False when an anchored layer has nowhere to go (anchor gone, or its box is stale from culling). */
function placeLayer(layer: UINode, width: number, height: number, view: Rect): boolean {
  const o = layer.overlay!;
  if (!o.anchor || o.modal) {
    place(layer, 0, 0, width, height, view);
    return true;
  }
  const a = o.anchor() as UINode | undefined;
  if (!a || rootOf(a) !== rootOf(layer)) return false;
  for (let n: UINode | null = a; n; n = n.parent) if (n.culled) return false;

  const k = intrinsic(layer);
  const w = o.matchWidth ? a.width : k.width;
  const h = k.height;
  const gap = o.offset;
  const below = a.y + a.height + gap, above = a.y - gap - h;
  const after = a.x + a.width + gap, before = a.x - gap - w;
  let x = a.x;
  let y = a.y;
  // Preferred side, or the opposite one when only that fits.
  switch (o.placement) {
    case "bottom": y = below + h > height && above >= 0 ? above : below; break;
    case "top": y = above < 0 && below + h <= height ? below : above; break;
    case "right": x = after + w > width && before >= 0 ? before : after; break;
    case "left": x = before < 0 && after + w <= width ? after : before; break;
  }
  place(layer, clamp(x, 0, Math.max(0, width - w)), clamp(y, 0, Math.max(0, height - h)), w, h, view);
  return true;
}

/** How far a node's own drawing reaches outside its box (shadows). */
export function overhang(n: UINode): number {
  const sh = n.style.shadow;
  return sh ? sh.blur + Math.abs(sh.y ?? 0) : 0;
}

/** Inner region a clipping node lets its children draw into, intersected with `view`. */
export function clipView(n: UINode, view: Rect): Rect {
  const b = n.style.borderWidth ?? 0;
  return {
    x0: Math.max(view.x0, n.x + b),
    y0: Math.max(view.y0, n.y + b),
    x1: Math.min(view.x1, n.x + n.width - b),
    y1: Math.min(view.y1, n.y + n.height - b),
  };
}

export function outside(n: UINode, view: Rect): boolean {
  const m = overhang(n);
  // Strict, so zero-size nodes on an edge (e.g. holders of absolute children) are kept.
  return n.x - m > view.x1 || n.y - m > view.y1 || n.x + n.width + m < view.x0 || n.y + n.height + m < view.y0;
}

export function edges(e: Edges | undefined): [top: number, right: number, bottom: number, left: number] {
  if (e === undefined) return [0, 0, 0, 0];
  if (typeof e === "number") return [e, e, e, e];
  if (e.length === 2) return [e[0], e[1], e[0], e[1]];
  return e;
}

function clamp(v: number, min = 0, max = Infinity) {
  return Math.max(min, Math.min(max, v));
}

function inFlow(n: UINode) {
  return n.style.position !== "absolute";
}

/** Natural size of a node, ignoring the space its parent offers. */
export function intrinsic(node: UINode): Size {
  const hit = cache.get(node);
  if (hit) return hit;
  const s = node.style;
  const [pt, pr, pb, pl] = edges(s.padding);
  let width: number;
  let height: number;

  if (node.measure) {
    const m = node.measure(Infinity);
    width = m.width + pl + pr;
    height = m.height + pt + pb;
  } else {
    const row = s.direction === "row";
    const kids = node.children.filter(inFlow);
    let main = 0;
    let cross = 0;
    for (const c of kids) {
      const k = intrinsic(c);
      main += row ? k.width : k.height;
      cross = Math.max(cross, row ? k.height : k.width);
    }
    main += Math.max(0, kids.length - 1) * (s.gap ?? 0);
    width = (row ? main : cross) + pl + pr;
    height = (row ? cross : main) + pt + pb;
  }

  const size = {
    width: clamp(s.width ?? width, s.minWidth, s.maxWidth),
    height: clamp(s.height ?? height, s.minHeight, s.maxHeight),
  };
  cache.set(node, size);
  return size;
}

function place(node: UINode, x: number, y: number, width: number, height: number, view: Rect) {
  node.x = x + (node.style.translateX ?? 0);
  node.y = y + (node.style.translateY ?? 0);
  node.width = width;
  node.height = height;
  if (node.handlers.onResize && (node.reportedSize?.width !== width || node.reportedSize.height !== height)) {
    node.reportedSize = { width, height };
    resized.push(node);
  }
  // Culling: an invisible node keeps its box (scroll extents and hit tests stay right),
  // but its subtree is not placed, painted nor hit-tested until it comes back into view.
  node.culled = outside(node, view);
  if (node.culled) return;
  if (node.scrollable || node.style.clip) view = clipView(node, view);

  const s = node.style;
  const [pt, pr, pb, pl] = edges(s.padding);
  const innerX = node.x + pl;
  const innerY = node.y + pt;
  const innerW = Math.max(0, width - pl - pr);
  const innerH = Math.max(0, height - pt - pb);
  const row = s.direction === "row";
  const gap = s.gap ?? 0;
  const kids = node.children.filter(inFlow);

  const innerMain = row ? innerW : innerH;
  const innerCross = row ? innerH : innerW;
  const mainMin = (c: UINode) => (row ? c.style.minWidth : c.style.minHeight) ?? 0;
  const mainMax = (c: UINode) => (row ? c.style.maxWidth : c.style.maxHeight) ?? Infinity;
  const fixedMain = (c: UINode) => (row ? c.style.width : c.style.height);

  const sizes = kids.map((c) => fixedMain(c) ?? (row ? intrinsic(c).width : intrinsic(c).height));
  const used = sizes.reduce((a, b) => a + b, 0) + Math.max(0, kids.length - 1) * gap;
  let free = innerMain - used;

  if (free > 0) {
    const totalGrow = kids.reduce((a, c) => a + (c.style.grow ?? 0), 0);
    if (totalGrow > 0) {
      kids.forEach((c, i) => {
        const g = c.style.grow ?? 0;
        if (g > 0) sizes[i] = clamp(sizes[i]! + (free * g) / totalGrow, mainMin(c), mainMax(c));
      });
      free = 0;
    }
  } else if (free < 0 && !node.scrollable) {
    // Shrink proportionally to natural size, but (like CSS min-size: auto) never
    // below a child's content unless it scrolls/clips or sets an explicit min.
    const floor = kids.map((c, i) => {
      const explicit = row ? c.style.minWidth : c.style.minHeight;
      if (explicit !== undefined) return explicit;
      return c.scrollable || c.style.clip ? 0 : sizes[i]!;
    });
    let overflow = -free;
    for (let pass = 0; pass < kids.length && overflow > 0.01; pass++) {
      const open = kids.map((c, i) => fixedMain(c) === undefined && sizes[i]! > floor[i]!);
      const total = sizes.reduce((a, v, i) => a + (open[i] ? v : 0), 0);
      if (total <= 0) break;
      let taken = 0;
      kids.forEach((c, i) => {
        if (!open[i]) return;
        const next = clamp(sizes[i]! - (overflow * sizes[i]!) / total, floor[i]!, mainMax(c));
        taken += sizes[i]! - next;
        sizes[i] = next;
      });
      overflow -= taken;
    }
    free = 0;
  }

  const content = sizes.reduce((a, b) => a + b, 0) + Math.max(0, kids.length - 1) * gap;
  node.contentHeight = (row ? innerH : content) + pt + pb;
  if (node.scrollable) node.scrollY = clamp(node.scrollY, 0, Math.max(0, node.contentHeight - height));

  let cursor = 0;
  let spacing = gap;
  const leftover = Math.max(0, innerMain - content);
  switch (s.justify) {
    case "center": cursor = leftover / 2; break;
    case "end": cursor = leftover; break;
    case "space-between": if (kids.length > 1) spacing = gap + leftover / (kids.length - 1); break;
  }

  const align = s.align ?? "stretch";
  kids.forEach((c, i) => {
    const natural = row ? intrinsic(c).height : intrinsic(c).width;
    const fixedCross = row ? c.style.height : c.style.width;
    const crossSize = clamp(
      fixedCross ?? (align === "stretch" ? innerCross : Math.min(natural, innerCross)),
      row ? c.style.minHeight : c.style.minWidth,
      row ? c.style.maxHeight : c.style.maxWidth,
    );
    const crossOffset = align === "center" ? (innerCross - crossSize) / 2 : align === "end" ? innerCross - crossSize : 0;
    const main = sizes[i]!;
    const scroll = node.scrollable ? node.scrollY : 0;
    if (row) place(c, innerX + cursor, innerY + crossOffset, main, crossSize, view);
    else place(c, innerX + crossOffset, innerY + cursor - scroll, crossSize, main, view);
    cursor += main + spacing;
  });

  for (const c of node.children) {
    if (inFlow(c)) continue;
    const k = intrinsic(c);
    place(c, innerX + (c.style.left ?? 0), innerY + (c.style.top ?? 0), c.style.width ?? k.width, c.style.height ?? k.height, view);
  }
}
