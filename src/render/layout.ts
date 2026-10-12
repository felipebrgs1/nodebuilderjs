// A small flexbox: row/column, gap, padding, grow, shrink-to-fit, align,
// justify, min/max sizes, absolute children and vertical scrolling.
//
// Wrapping text makes a height depend on the width given, so sizes come in two steps: the
// natural (max-content) size of every node, cached per layout, and `heightAt(node, width)`,
// which only does real work in subtrees that contain wrapping text.

import { type Edges, type Size, type UINode, overlayLayers } from "./node.js";
import { batch } from "../reactive/signals.js";

let cache = new Map<UINode, Natural>();
let heights = new Map<UINode, { width: number; height: number }>();
let mins = new Map<UINode, number>();
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
  heights = new Map();
  mins = new Map();
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

  const w = o.matchWidth ? a.width : intrinsic(layer).width;
  const h = heightAt(layer, w);
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

/** Natural size plus whether the height changes with the width given (wrapping text inside). */
interface Natural extends Size {
  wraps: boolean;
  /** Width the content wants before `width`/`min`/`max` apply: from there on nothing wraps. */
  content: number;
}

/** Natural size of a node, ignoring the space its parent offers (text on as few lines as it can). */
export function intrinsic(node: UINode): Natural {
  const hit = cache.get(node);
  if (hit) return hit;
  const s = node.style;
  const [pt, pr, pb, pl] = edges(s.padding);
  let width: number;
  let height: number;
  let wraps = false;

  if (node.measure) {
    const m = node.measure(Infinity);
    width = m.width + pl + pr;
    height = m.height + pt + pb;
    wraps = node.minContentWidth !== undefined;
  } else {
    const row = s.direction === "row";
    const kids = node.children.filter(inFlow);
    let main = 0;
    let cross = 0;
    for (const c of kids) {
      const k = intrinsic(c);
      main += row ? k.width : k.height;
      cross = Math.max(cross, row ? k.height : k.width);
      wraps ||= k.wraps;
    }
    const gaps = Math.max(0, kids.length - 1) * (s.gap ?? 0);
    main += gaps;
    width = (row ? main : cross) + pl + pr;
    height = (row ? cross : main) + pt + pb;
  }

  const size: Natural = {
    width: clamp(s.width ?? width, s.minWidth, s.maxWidth),
    height: clamp(s.height ?? height, s.minHeight, s.maxHeight),
    wraps: wraps && s.height === undefined,
    content: width,
  };
  cache.set(node, size);
  return size;
}

/** How narrow a child may get when its row shrinks (like CSS `min-width: auto`). */
function minFloor(c: UINode): number {
  return c.style.minWidth ?? (c.scrollable || c.style.clip ? 0 : minWidth(c));
}

/** Narrowest width without overflowing: wrapping text down to its longest word; the natural width otherwise. Only asked when a row shrinks. */
function minWidth(node: UINode): number {
  const k = intrinsic(node);
  if (!k.wraps) return k.width;
  const hit = mins.get(node);
  if (hit !== undefined) return hit;
  const s = node.style;
  const [, pr, , pl] = edges(s.padding);
  let min: number;
  if (s.width !== undefined) min = k.width;
  else {
    let content: number;
    if (node.measure) content = node.minContentWidth!();
    else {
      const kids = node.children.filter(inFlow);
      const floors = kids.map(minFloor);
      content = s.direction === "row"
        ? floors.reduce((a, b) => a + b, 0) + Math.max(0, kids.length - 1) * (s.gap ?? 0)
        : Math.max(0, ...floors);
    }
    min = clamp(Math.min(k.width, content + pl + pr), s.minWidth, s.maxWidth);
  }
  mins.set(node, min);
  return min;
}

/** Height of `node` laid out `width` wide. */
function heightAt(node: UINode, width: number): number {
  const k = intrinsic(node);
  // At its natural width nothing wraps, and more room never adds lines.
  if (!k.wraps || width >= k.content) return k.height;
  const hit = heights.get(node);
  if (hit && hit.width === width) return hit.height;
  const s = node.style;
  const [pt, pr, pb, pl] = edges(s.padding);
  const inner = Math.max(0, width - pl - pr);
  const kids = node.children.filter(inFlow);
  let content: number;
  if (node.measure) {
    content = node.measure(inner).height;
  } else if (s.direction === "row") {
    const widths = mainSizes(node, kids, inner, true);
    content = kids.reduce((h, c, i) => Math.max(h, heightAt(c, widths[i]!)), 0);
  } else {
    const align = s.align ?? "stretch";
    content = kids.reduce((h, c) => h + heightAt(c, crossSize(align, c, false, inner, intrinsic(c).width)), 0);
    content += Math.max(0, kids.length - 1) * (s.gap ?? 0);
  }
  const height = clamp(content + pt + pb, s.minHeight, s.maxHeight);
  heights.set(node, { width, height });
  return height;
}

/** A child's size across its parent's direction. */
function crossSize(align: string, c: UINode, row: boolean, innerCross: number, natural: number): number {
  const fixed = row ? c.style.height : c.style.width;
  return clamp(
    fixed ?? (align === "stretch" ? innerCross : Math.min(natural, innerCross)),
    row ? c.style.minHeight : c.style.minWidth,
    row ? c.style.maxHeight : c.style.maxWidth,
  );
}

/**
 * Children's sizes along the parent's direction: natural size, then the free space shared by
 * `grow`, or the missing space taken in proportion to size. In a column, `crosses` are the
 * children's widths (their heights may depend on them).
 */
function mainSizes(node: UINode, kids: UINode[], innerMain: number, row: boolean, crosses?: number[]): number[] {
  const gap = node.style.gap ?? 0;
  const mainMin = (c: UINode) => (row ? c.style.minWidth : c.style.minHeight) ?? 0;
  const mainMax = (c: UINode) => (row ? c.style.maxWidth : c.style.maxHeight) ?? Infinity;
  const fixedMain = (c: UINode) => (row ? c.style.width : c.style.height);

  const sizes = kids.map((c, i) => fixedMain(c) ?? (row ? intrinsic(c).width : heightAt(c, crosses![i]!)));
  const used = sizes.reduce((a, b) => a + b, 0) + Math.max(0, kids.length - 1) * gap;
  const free = innerMain - used;

  if (free > 0) {
    const totalGrow = kids.reduce((a, c) => a + (c.style.grow ?? 0), 0);
    if (totalGrow > 0) {
      kids.forEach((c, i) => {
        const g = c.style.grow ?? 0;
        if (g > 0) sizes[i] = clamp(sizes[i]! + (free * g) / totalGrow, mainMin(c), mainMax(c));
      });
    }
  } else if (free < 0 && !node.scrollable) {
    // Shrink proportionally to natural size, but (like CSS min-size: auto) never below a
    // child's content (wrapping text: its longest word) unless it scrolls/clips or sets an
    // explicit min.
    const floor = kids.map((c, i) => {
      if (row) return minFloor(c);
      return c.style.minHeight ?? (c.scrollable || c.style.clip ? 0 : sizes[i]!);
    });
    // Children that grow give up their room first (like Flutter's Expanded), so a label
    // next to them keeps its size; then everyone, as in CSS.
    let overflow = -free;
    for (const growingOnly of [true, false]) {
      for (let pass = 0; pass < kids.length && overflow > 0.01; pass++) {
        const open = kids.map((c, i) => fixedMain(c) === undefined && sizes[i]! > floor[i]! && (!growingOnly || (c.style.grow ?? 0) > 0));
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
    }
  }
  return sizes;
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
  const align = s.align ?? "stretch";

  // A row knows widths first and heights from them; a column the other way around.
  let sizes: number[];
  let crosses: number[];
  if (row) {
    sizes = mainSizes(node, kids, innerW, true);
    crosses = kids.map((c, i) => crossSize(align, c, true, innerH, heightAt(c, sizes[i]!)));
  } else {
    crosses = kids.map((c) => crossSize(align, c, false, innerW, intrinsic(c).width));
    sizes = mainSizes(node, kids, innerH, false, crosses);
  }

  const innerMain = row ? innerW : innerH;
  const innerCross = row ? innerH : innerW;
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

  kids.forEach((c, i) => {
    const crossSize = crosses[i]!;
    const crossOffset = align === "center" ? (innerCross - crossSize) / 2 : align === "end" ? innerCross - crossSize : 0;
    const main = sizes[i]!;
    const scroll = node.scrollable ? node.scrollY : 0;
    if (row) place(c, innerX + cursor, innerY + crossOffset, main, crossSize, view);
    else place(c, innerX + crossOffset, innerY + cursor - scroll, crossSize, main, view);
    cursor += main + spacing;
  });

  for (const c of node.children) {
    if (inFlow(c)) continue;
    const w = intrinsic(c).width;
    place(c, innerX + (c.style.left ?? 0), innerY + (c.style.top ?? 0), w, heightAt(c, w), view);
  }
}
