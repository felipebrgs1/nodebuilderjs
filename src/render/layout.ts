// A small flexbox: row/column, gap, padding, grow, shrink-to-fit, align,
// justify, min/max sizes, absolute children and scrolling (vertical, horizontal or both);
// plus a grid of equal columns and `aspectRatio`.
//
// Wrapping text and `aspectRatio` make a height depend on the width given, so sizes come in
// two steps: the natural (max-content) size of every node, cached per layout, and
// `heightAt(node, width)`, which only does real work in subtrees that contain them.

import { type Edges, type Size, type UINode, overlayLayers, revealRequests, scrolls } from "./node.js";
import { scrollRange } from "./scrollbar.js";
import { checkOverflow, resetOverflow } from "./overflow.js";
import { batch } from "../reactive/signals.js";

let cache = new Map<UINode, Natural>();
let heights = new Map<UINode, { width: number; height: number }>();
let mins = new Map<UINode, number>();
let shrinkable = new Map<UINode, number>();
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
  shrinkable = new Map();
  resized = [];
  placeAll(root, width, height);
  // scrollIntoView() needs current boxes, so it runs after placing, which is then redone
  // with the new scroll positions.
  if (revealRequests.size && reveal(root)) placeAll(root, width, height);
  // After the whole tree is placed: handlers may change state (and the tree) freely.
  const nodes = resized;
  resized = [];
  if (nodes.length) batch(() => nodes.forEach((n) => n.handlers.onResize?.(n.reportedSize!)));
}

function placeAll(root: UINode, width: number, height: number) {
  const view = { x0: 0, y0: 0, x1: width, y1: height };
  resetOverflow(root);
  place(root, 0, 0, width, height, view);
  // Overlays after the tree, so anchors are already placed; nested ones come after their
  // parent layer (they were created inside it).
  root.layers = [];
  for (const layer of overlayLayers) if (rootOf(layer) === root && placeLayer(layer, width, height, view)) root.layers.push(layer);
}

/** Ancestors whose layout affects where `node` is: up to its overlay layer or the root. */
function* containers(node: UINode) {
  for (let n = node.parent; n; n = n.overlay ? null : n.parent) yield n;
}

/** Handles this root's scrollIntoView() requests; true if anything moved. */
function reveal(root: UINode): boolean {
  let moved = false;
  for (const target of revealRequests) {
    const top = rootOf(target);
    if (top !== root) {
      if (!top.isRoot) revealRequests.delete(target); // removed from the tree
      continue;
    }
    revealRequests.delete(target);
    moved = freshen(target) || moved;
    moved = scrollToShow(target) || moved;
  }
  return moved;
}

const everywhere: Rect = { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity };

/**
 * A node inside a culled subtree has a stale box. Places the outermost culled container
 * again with nothing hidden, repeating for clipping containers inside it, until the node's
 * box is current.
 */
function freshen(node: UINode): boolean {
  let placed = false;
  for (;;) {
    let culled: UINode | null = null;
    for (const n of containers(node)) if (n.culled) culled = n;
    if (!culled) return placed;
    place(culled, culled.x - (culled.style.translateX ?? 0), culled.y - (culled.style.translateY ?? 0), culled.width, culled.height, everywhere);
    placed = true;
  }
}

/** How far to move a view [viewStart, viewEnd] so [start, end] is inside it (its start, if it is bigger). */
function revealDelta(start: number, end: number, viewStart: number, viewEnd: number): number {
  if (start < viewStart) return start - viewStart;
  if (end > viewEnd) return Math.min(end - viewEnd, start - viewStart);
  return 0;
}

/** Scrolls each Scroll around `node`, innermost first, as little as needed to show it. */
function scrollToShow(node: UINode): boolean {
  let { x, y } = node;
  let moved = false;
  for (const n of containers(node)) {
    const b = n.style.borderWidth ?? 0;
    if (n.scrollable) {
      const before = n.scrollY;
      n.scrollY = clamp(before + revealDelta(y, y + node.height, n.y + b, n.y + n.height - b), 0, scrollRange(n, "y"));
      y -= n.scrollY - before;
      moved ||= n.scrollY !== before;
    }
    if (n.scrollableX) {
      const before = n.scrollX;
      n.scrollX = clamp(before + revealDelta(x, x + node.width, n.x + b, n.x + n.width - b), 0, scrollRange(n, "x"));
      x -= n.scrollX - before;
      moved ||= n.scrollX !== before;
    }
  }
  return moved;
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

/** Natural size plus whether the height changes with the width given (wrapping text or `aspectRatio` inside). */
interface Natural extends Size {
  wraps: boolean;
  /** Width the content wants before `width`/`min`/`max` apply: from there on nothing wraps. */
  content: number;
  /** An `aspectRatio` inside: the height keeps following the width past `content`. */
  fluid: boolean;
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
  let fluid = false;

  if (node.measure) {
    const m = node.measure(Infinity);
    width = m.width + pl + pr;
    height = m.height + pt + pb;
    wraps = node.minContentWidth !== undefined;
  } else if (s.direction === "grid") {
    const kids = node.children.filter(inFlow);
    let cell = 0;
    for (const c of kids) {
      const k = intrinsic(c);
      cell = Math.max(cell, k.width);
      wraps ||= k.wraps;
      fluid ||= k.fluid;
    }
    const cols = columnsOf(node);
    width = cols * cell + (cols - 1) * (s.gap ?? 0) + pl + pr;
    height = gridHeight(node, kids, cell, heightAt) + pt + pb;
  } else {
    const row = s.direction === "row";
    // A row of fixed height already knows how wide its stretched aspectRatio children are.
    const innerH = row && s.height !== undefined ? clamp(s.height, s.minHeight, s.maxHeight) - pt - pb : undefined;
    const kids = node.children.filter(inFlow);
    let main = 0;
    let cross = 0;
    for (const c of kids) {
      const k = intrinsic(c);
      main += row ? rowBasis(node, c, innerH) : k.height;
      cross = Math.max(cross, row ? k.height : k.width);
      wraps ||= k.wraps;
      fluid ||= k.fluid;
    }
    const gaps = Math.max(0, kids.length - 1) * (s.gap ?? 0);
    main += gaps;
    width = (row ? main : cross) + pl + pr;
    height = (row ? cross : main) + pt + pb;
  }

  const ratio = s.aspectRatio;
  if (ratio && s.width === undefined && s.height !== undefined) width = clamp(s.height, s.minHeight, s.maxHeight) * ratio;
  else if (ratio && s.height === undefined) {
    height = byRatio(node, height, clamp(s.width ?? width, s.minWidth, s.maxWidth) / ratio);
    if (s.width === undefined) wraps = fluid = true;
  }

  const size: Natural = {
    width: clamp(s.width ?? width, s.minWidth, s.maxWidth),
    height: clamp(s.height ?? height, s.minHeight, s.maxHeight),
    wraps: wraps && s.height === undefined,
    content: width,
    fluid: fluid && s.height === undefined,
  };
  cache.set(node, size);
  return size;
}

const SHRINKS_X = 1;
const SHRINKS_Y = 2;

/**
 * Whether a node can get narrower (SHRINKS_X) or shorter (SHRINKS_Y) than its natural size
 * without overflowing: wrapping text, or something inside that scrolls, clips or sets a
 * minimum. Asked only when a row or column has to shrink, so the common frame never walks it.
 */
function shrinks(node: UINode): number {
  const hit = shrinkable.get(node);
  if (hit !== undefined) return hit;
  let flags = 0;
  if (node.measure) flags = node.minContentWidth ? SHRINKS_X : 0;
  else {
    for (const c of node.children) {
      if (!inFlow(c)) continue;
      const cs = c.style;
      if (cs.minWidth !== undefined || scrolls(c) || cs.clip) flags |= SHRINKS_X;
      if (cs.minHeight !== undefined || c.scrollable || cs.clip) flags |= SHRINKS_Y;
      if (flags !== (SHRINKS_X | SHRINKS_Y)) flags |= shrinks(c);
      if (flags === (SHRINKS_X | SHRINKS_Y)) break;
    }
  }
  if (node.style.width !== undefined) flags &= ~SHRINKS_X;
  if (node.style.height !== undefined) flags &= ~SHRINKS_Y;
  shrinkable.set(node, flags);
  return flags;
}

/** How narrow a child may get when its row shrinks (like CSS `min-width: auto`). */
function minFloor(c: UINode): number {
  return c.style.minWidth ?? (scrolls(c) || c.style.clip ? 0 : minWidth(c));
}

/**
 * Narrowest width without overflowing: wrapping text down to its longest word, what scrolls or
 * clips down to nothing; the natural width otherwise. Only asked when a row shrinks.
 */
function minWidth(node: UINode): number {
  const k = intrinsic(node);
  if (!(shrinks(node) & SHRINKS_X)) return k.width;
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
      const cols = columnsOf(node);
      content = s.direction === "row"
        ? floors.reduce((a, b) => a + b, 0) + Math.max(0, kids.length - 1) * (s.gap ?? 0)
        : s.direction === "grid"
          ? cols * Math.max(0, ...floors) + (cols - 1) * (s.gap ?? 0)
          : Math.max(0, ...floors);
    }
    min = clamp(Math.min(k.width, content + pl + pr), s.minWidth, s.maxWidth);
  }
  mins.set(node, min);
  return min;
}

/** How short a child may get when its column shrinks (like CSS `min-height: auto`). */
function heightFloor(c: UINode, width: number): number {
  return c.style.minHeight ?? (c.scrollable || c.style.clip ? 0 : minHeightAt(c, width));
}

/**
 * Shortest height at `width` without overflowing: what scrolls vertically or clips gives up its
 * height; the rest keeps the height it has at that width. Only asked when a column shrinks.
 */
function minHeightAt(node: UINode, width: number): number {
  if (!(shrinks(node) & SHRINKS_Y)) return heightAt(node, width);
  const s = node.style;
  const [pt, pr, pb, pl] = edges(s.padding);
  const inner = Math.max(0, width - pl - pr);
  const kids = node.children.filter(inFlow);
  let content: number;
  if (s.direction === "row") {
    const widths = mainSizes(node, kids, inner, true);
    content = kids.reduce((h, c, i) => Math.max(h, heightFloor(c, widths[i]!)), 0);
  } else if (s.direction === "grid") {
    content = gridHeight(node, kids, cellWidth(node, inner), heightFloor);
  } else {
    content = kids.reduce((h, c) => h + heightFloor(c, columnChildWidth(node, c, inner)), 0);
    content += Math.max(0, kids.length - 1) * (s.gap ?? 0);
  }
  return clamp(content + pt + pb, s.minHeight, s.maxHeight);
}

/** Height of `node` laid out `width` wide. */
function heightAt(node: UINode, width: number): number {
  const k = intrinsic(node);
  // At its natural width nothing wraps, and more room never adds lines (an aspectRatio does).
  if (!k.wraps || (!k.fluid && width >= k.content)) return k.height;
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
  } else if (s.direction === "grid") {
    content = gridHeight(node, kids, cellWidth(node, inner), heightAt);
  } else {
    content = kids.reduce((h, c) => h + heightAt(c, columnChildWidth(node, c, inner)), 0);
    content += Math.max(0, kids.length - 1) * (s.gap ?? 0);
  }
  let height = content + pt + pb;
  if (s.aspectRatio && s.height === undefined) height = byRatio(node, height, width / s.aspectRatio);
  height = clamp(height, s.minHeight, s.maxHeight);
  heights.set(node, { width, height });
  return height;
}

/**
 * A child's size across its parent's direction. `floor` is set when the parent scrolls that
 * way: the child then takes at least the visible size, but is never squeezed below `floor`
 * (its content), like CSS shrink-to-fit.
 */
function crossSize(align: string, c: UINode, row: boolean, innerCross: number, natural: number, floor?: number): number {
  const fixed = row ? c.style.height : (c.style.width ?? ratioWidth(c));
  const room = floor === undefined ? innerCross : Math.max(innerCross, floor);
  return clamp(
    fixed ?? (align === "stretch" ? room : Math.min(natural, room)),
    row ? c.style.minHeight : c.style.minWidth,
    row ? c.style.maxHeight : c.style.maxWidth,
  );
}

/** How a child lines up across its parent's direction: its own `alignSelf`, else the parent's `align`. */
function alignOf(parent: UINode, c: UINode): string {
  return c.style.alignSelf ?? parent.style.align ?? "stretch";
}

/**
 * Height of an `aspectRatio` box whose content is `content` tall: children taller than the
 * ratio allows make it taller (like CSS min-height: auto); a measured node (an image) is
 * replaced content and takes the ratio as is.
 */
function byRatio(node: UINode, content: number, ratioHeight: number): number {
  return node.measure ? ratioHeight : Math.max(content, ratioHeight);
}

/** Width an `aspectRatio` gets from a fixed height (and no width of its own). */
function ratioWidth(c: UINode): number | undefined {
  const s = c.style;
  return s.aspectRatio && s.width === undefined && s.height !== undefined ? intrinsic(c).width : undefined;
}

/**
 * Width of a child of a row before grow/shrink. A stretched `aspectRatio` with no size of
 * its own takes it from the row's inner height, when that is known (as in CSS).
 */
function rowBasis(node: UINode, c: UINode, innerH?: number): number {
  const s = c.style;
  if (s.width === undefined && s.height === undefined && s.aspectRatio && innerH !== undefined && alignOf(node, c) === "stretch") {
    return clamp(clamp(innerH, s.minHeight, s.maxHeight) * s.aspectRatio, s.minWidth, s.maxWidth);
  }
  return intrinsic(c).width;
}

function columnsOf(node: UINode): number {
  return Math.max(1, Math.floor(node.style.columns ?? 1));
}

/** Width of each cell of a grid `inner` wide: equal columns, whatever the content. */
function cellWidth(node: UINode, inner: number): number {
  const cols = columnsOf(node);
  return Math.max(0, (inner - (cols - 1) * (node.style.gap ?? 0)) / cols);
}

/** A grid child's width in a `cell`-wide cell: the cell, unless it sets its own. */
function cellChildWidth(c: UINode, cell: number): number {
  const s = c.style;
  return clamp(s.width ?? ratioWidth(c) ?? cell, s.minWidth, s.maxWidth);
}

/** Height of each row of a grid: its tallest cell, measured with `measure` (heightAt or a floor). */
function gridRows(node: UINode, kids: UINode[], cell: number, measure: (c: UINode, width: number) => number): number[] {
  const cols = columnsOf(node);
  const rows: number[] = [];
  for (let i = 0; i < kids.length; i += cols) {
    let h = 0;
    for (const c of kids.slice(i, i + cols)) h = Math.max(h, measure(c, cellChildWidth(c, cell)));
    rows.push(h);
  }
  return rows;
}

function gridHeight(node: UINode, kids: UINode[], cell: number, measure: (c: UINode, width: number) => number): number {
  const rows = gridRows(node, kids, cell, measure);
  return rows.reduce((a, b) => a + b, 0) + Math.max(0, rows.length - 1) * (node.style.rowGap ?? node.style.gap ?? 0);
}

/** Width of a child of a column: in a horizontal scroll, wide content keeps its width. */
function columnChildWidth(node: UINode, c: UINode, innerW: number): number {
  return crossSize(alignOf(node, c), c, false, innerW, intrinsic(c).width, node.scrollableX ? minWidth(c) : undefined);
}

/**
 * Children's sizes along the parent's direction: natural size, then the free space shared by
 * `grow`, or the missing space taken in proportion to size. In a column, `crosses` are the
 * children's widths (their heights may depend on them).
 */
function mainSizes(node: UINode, kids: UINode[], innerMain: number, row: boolean, crosses?: number[], innerCross?: number): number[] {
  const gap = node.style.gap ?? 0;
  const mainMin = (c: UINode) => (row ? c.style.minWidth : c.style.minHeight) ?? 0;
  const mainMax = (c: UINode) => (row ? c.style.maxWidth : c.style.maxHeight) ?? Infinity;
  const fixedMain = (c: UINode) => (row ? c.style.width : c.style.height);

  const sizes = kids.map((c, i) => fixedMain(c) ?? (row ? rowBasis(node, c, innerCross) : heightAt(c, crosses![i]!)));
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
  } else if (free < 0 && !(row ? node.scrollableX : node.scrollable)) {
    // Shrink proportionally to natural size, but (like CSS min-size: auto) never below a
    // child's content (wrapping text: its longest word) unless it scrolls/clips or sets an
    // explicit min.
    const floor = kids.map((c, i) => (row ? minFloor(c) : heightFloor(c, crosses![i]!)));
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
  node.overflow = 0;
  if (node.handlers.onResize && (node.reportedSize?.width !== width || node.reportedSize.height !== height)) {
    node.reportedSize = { width, height };
    resized.push(node);
  }
  // Culling: an invisible node keeps its box (scroll extents and hit tests stay right),
  // but its subtree is not placed, painted nor hit-tested until it comes back into view.
  node.culled = outside(node, view);
  if (node.culled) return;
  if (scrolls(node) || node.style.clip) view = clipView(node, view);

  const s = node.style;
  const [pt, pr, pb, pl] = edges(s.padding);
  const innerX = node.x + pl;
  const innerY = node.y + pt;
  const innerW = Math.max(0, width - pl - pr);
  const innerH = Math.max(0, height - pt - pb);
  const row = s.direction === "row";
  const gap = s.gap ?? 0;
  const kids = node.children.filter(inFlow);
  if (s.direction === "grid") {
    const offsetY = placeGrid(node, kids, innerX, innerY, innerW, view);
    placeAbsolute(node, innerX, innerY - offsetY, innerW, innerH, view);
    return;
  }

  // A row knows widths first and heights from them; a column the other way around.
  let sizes: number[];
  let crosses: number[];
  if (row) {
    sizes = mainSizes(node, kids, innerW, true, undefined, innerH);
    crosses = kids.map((c, i) => {
      const h = heightAt(c, sizes[i]!);
      return crossSize(alignOf(node, c), c, true, innerH, h, node.scrollable ? h : undefined);
    });
  } else {
    crosses = kids.map((c) => columnChildWidth(node, c, innerW));
    sizes = mainSizes(node, kids, innerH, false, crosses);
  }

  const innerMain = row ? innerW : innerH;
  const innerCross = row ? innerH : innerW;
  const content = sizes.reduce((a, b) => a + b, 0) + Math.max(0, kids.length - 1) * gap;
  let widest = 0;
  for (const c of crosses) if (c > widest) widest = c;
  node.contentWidth = (row ? content : widest) + pl + pr;
  node.contentHeight = (row ? widest : content) + pt + pb;
  const scrollsCross = row ? node.scrollable : node.scrollableX;
  if (node.scrollable) node.scrollY = clamp(node.scrollY, 0, Math.max(0, node.contentHeight - height));
  if (node.scrollableX) node.scrollX = clamp(node.scrollX, 0, Math.max(0, node.contentWidth - width));
  const offsetX = node.scrollableX ? node.scrollX : 0;
  const offsetY = node.scrollable ? node.scrollY : 0;

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
    const align = alignOf(node, c);
    let crossOffset = align === "center" ? (innerCross - crossSize) / 2 : align === "end" ? innerCross - crossSize : 0;
    if (scrollsCross) crossOffset = Math.max(0, crossOffset); // what overflows stays reachable
    const main = sizes[i]!;
    if (row) place(c, innerX + cursor - offsetX, innerY + crossOffset - offsetY, main, crossSize, view);
    else place(c, innerX + crossOffset - offsetX, innerY + cursor - offsetY, crossSize, main, view);
    cursor += main + spacing;
  });
  if (kids.length) checkOverflow(node, kids, row, content, innerMain, widest, innerCross, view);

  placeAbsolute(node, innerX - offsetX, innerY - offsetY, innerW, innerH, view);
}

/** Absolute children are measured from the content box (at x, y once scrolled) and scroll with the content. */
function placeAbsolute(node: UINode, x: number, y: number, innerW: number, innerH: number, view: Rect) {
  for (const c of node.children) {
    if (inFlow(c)) continue;
    const cs = c.style;
    const [x0, w] = absoluteSpan(cs.left, cs.right, cs.width, intrinsic(c).width, innerW, cs.minWidth, cs.maxWidth);
    const [y0, h] = absoluteSpan(cs.top, cs.bottom, cs.height, heightAt(c, w), innerH, cs.minHeight, cs.maxHeight);
    place(c, x + x0, y + y0, w, h, view);
  }
}

/**
 * Places a grid's cells row by row: equal columns, each row as tall as its tallest cell.
 * Cells stretch to their row (or follow `align`/`alignSelf`), except an `aspectRatio`, which
 * keeps its shape (like CSS grid). Cells outside `view` are culled by place(). Returns the
 * vertical scroll offset.
 */
function placeGrid(node: UINode, kids: UINode[], innerX: number, innerY: number, innerW: number, view: Rect): number {
  const s = node.style;
  const [pt, pr, pb, pl] = edges(s.padding);
  const cols = columnsOf(node);
  const gap = s.gap ?? 0;
  const rowGap = s.rowGap ?? gap;
  const cell = cellWidth(node, innerW);
  const rows = gridRows(node, kids, cell, heightAt);
  node.contentWidth = innerW + pl + pr;
  node.contentHeight = rows.reduce((a, b) => a + b, 0) + Math.max(0, rows.length - 1) * rowGap + pt + pb;
  if (node.scrollable) node.scrollY = clamp(node.scrollY, 0, Math.max(0, node.contentHeight - node.height));
  const offsetY = node.scrollable ? node.scrollY : 0;

  let top = innerY - offsetY;
  rows.forEach((rowHeight, r) => {
    kids.slice(r * cols, (r + 1) * cols).forEach((c, i) => {
      const w = cellChildWidth(c, cell);
      let align = alignOf(node, c);
      if (align === "stretch" && c.style.aspectRatio && c.style.height === undefined) align = "start";
      const h = crossSize(align, c, true, rowHeight, heightAt(c, w));
      const dy = align === "center" ? (rowHeight - h) / 2 : align === "end" ? rowHeight - h : 0;
      place(c, innerX + i * (cell + gap), top + dy, w, h, view);
    });
    top += rowHeight + rowGap;
  });
  return offsetY;
}

/**
 * Offset and size of an absolute child along one axis of a `room`-long content box, as in CSS:
 * both edges and no fixed size stretch it (within min/max); otherwise it keeps `natural` and
 * sits at `start`, or `end` away from the far edge when only that is set.
 */
function absoluteSpan(start: number | undefined, end: number | undefined, fixed: number | undefined, natural: number, room: number, min?: number, max?: number): [offset: number, size: number] {
  if (start !== undefined && end !== undefined && fixed === undefined) return [start, clamp(room - start - end, min, max)];
  if (start === undefined && end !== undefined) return [room - end - natural, natural];
  return [start ?? 0, natural];
}
