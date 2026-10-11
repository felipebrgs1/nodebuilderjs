// A small flexbox: row/column, gap, padding, grow, shrink-to-fit, align,
// justify, min/max sizes, absolute children and vertical scrolling.

import type { Edges, Size, UINode } from "./node.js";

let cache = new Map<UINode, Size>();

export function layout(root: UINode, width: number, height: number) {
  cache = new Map();
  place(root, 0, 0, width, height);
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

function place(node: UINode, x: number, y: number, width: number, height: number) {
  node.x = x;
  node.y = y;
  node.width = width;
  node.height = height;

  const s = node.style;
  const [pt, pr, pb, pl] = edges(s.padding);
  const innerX = x + pl;
  const innerY = y + pt;
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
    // Shrink children without a fixed size, proportionally to their natural size.
    const shrinkable = kids.map((c) => fixedMain(c) === undefined);
    const total = sizes.reduce((a, v, i) => a + (shrinkable[i] ? v : 0), 0);
    if (total > 0) {
      const overflow = -free;
      kids.forEach((c, i) => {
        if (shrinkable[i]) sizes[i] = clamp(sizes[i]! - (overflow * sizes[i]!) / total, mainMin(c), mainMax(c));
      });
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
    if (row) place(c, innerX + cursor, innerY + crossOffset, main, crossSize);
    else place(c, innerX + crossOffset, innerY + cursor - scroll, crossSize, main);
    cursor += main + spacing;
  });

  for (const c of node.children) {
    if (inFlow(c)) continue;
    const k = intrinsic(c);
    place(c, innerX + (c.style.left ?? 0), innerY + (c.style.top ?? 0), c.style.width ?? k.width, c.style.height ?? k.height);
  }
}
