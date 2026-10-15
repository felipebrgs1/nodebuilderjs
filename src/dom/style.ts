// Style -> CSS for the DOM renderer. Each element is a flexbox with the base stylesheet's
// defaults (`BASE_CSS`: a column, `position: relative`, border-box); nodeCss() returns only the
// declarations that differ, which the sync diffs against what it wrote last.

import { resolveColor } from "../render/color.js";
import { isLinearGradient, resolveStops } from "../render/gradient.js";
import type { Background, Edges, Style, UINode } from "../render/node.js";
import { scrolls } from "../render/node.js";

type Css = Record<string, string>;

const px = (v: number) => `${v}px`;

function edgesCss(e: Edges): string {
  return typeof e === "number" ? px(e) : e.map(px).join(" ");
}

const FLEX_ALIGN = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" } as const;
const JUSTIFY = { start: "flex-start", center: "center", end: "flex-end", "space-between": "space-between" } as const;

/** What the UI font falls back to when none of a family list is there (the browser's default is serif). */
export const UI_FONT = "system-ui, sans-serif";

export function cssColor(c: string): string {
  return resolveColor(c);
}

function backgroundCss(bg: Background): string {
  if (!isLinearGradient(bg)) return cssColor(bg);
  const stops = resolveStops(bg.linear).map((s) => `${cssColor(s.color)} ${Math.round(s.offset * 1e4) / 100}%`);
  return `linear-gradient(${bg.angle ?? 180}deg, ${stops.join(", ")})`;
}

/** HarfBuzz/CSS feature list ("tnum, -liga, cv01=2") as CSS `font-feature-settings`. */
export function cssFeatures(spec: string): string {
  return spec
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      if (/^["']/.test(item)) return item; // already CSS
      const m = /^([+-]?)([A-Za-z0-9]{4})(?:\s*=\s*(\d+))?$/.exec(item);
      if (!m) return item;
      const [, sign, tag, value] = m;
      return sign === "-" ? `"${tag}" 0` : value !== undefined ? `"${tag}" ${value}` : `"${tag}"`;
    })
    .join(", ");
}

/** HarfBuzz/CSS axis list ("wdth 75, opsz=12") as CSS `font-variation-settings`. */
export function cssVariations(spec: string): string {
  return spec
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      if (/^["']/.test(item)) return item;
      const m = /^([A-Za-z0-9]{4})\s*(?:=|\s)\s*(-?[\d.]+)$/.exec(item);
      return m ? `"${m[1]}" ${m[2]}` : item;
    })
    .join(", ");
}

type Writer<K extends keyof Style> = (value: NonNullable<Style[K]>, out: Css, node: UINode) => void;

/**
 * One writer per Style key (the type makes a new key a compile error here). Keys that only make
 * sense together (gap and rowGap, columns and minColumnWidth, the shadows) are written by
 * `nodeCss` after the loop; their writers do nothing.
 */
const WRITERS: { [K in keyof Style]-?: Writer<K> } = {
  direction: (v, out) => {
    if (v === "row") out["flex-direction"] = "row";
    else if (v === "grid") out.display = "grid";
  },
  gap: () => {},
  rowGap: () => {},
  columns: () => {},
  minColumnWidth: () => {},
  wrap: (v, out, n) => {
    if (!v || n.style.direction === "grid") return;
    out["flex-wrap"] = "wrap";
    out["align-content"] = "flex-start"; // lines packed at the start, not stretched
  },
  padding: (v, out) => void (out.padding = edgesCss(v)),
  margin: (v, out) => void (out.margin = edgesCss(v)),
  width: (v, out) => void (out.width = px(v)),
  height: (v, out) => void (out.height = px(v)),
  minWidth: (v, out) => void (out["min-width"] = px(v)),
  minHeight: (v, out) => void (out["min-height"] = px(v)),
  maxWidth: (v, out) => void (out["max-width"] = px(v)),
  maxHeight: (v, out) => void (out["max-height"] = px(v)),
  grow: (v, out) => void (v && (out["flex-grow"] = String(v))),
  aspectRatio: (v, out) => void (out["aspect-ratio"] = String(v)),
  align: (v, out) => void (v !== "stretch" && (out["align-items"] = FLEX_ALIGN[v])),
  alignSelf: (v, out) => void (out["align-self"] = FLEX_ALIGN[v]),
  justify: (v, out) => void (v !== "start" && (out["justify-content"] = JUSTIFY[v])),
  position: (v, out) => void (v === "absolute" && (out.position = "absolute")),
  left: (v, out, n) => void (n.style.position === "absolute" && (out.left = px(v))),
  top: (v, out, n) => void (n.style.position === "absolute" && (out.top = px(v))),
  right: (v, out, n) => void (n.style.position === "absolute" && (out.right = px(v))),
  bottom: (v, out, n) => void (n.style.position === "absolute" && (out.bottom = px(v))),
  clip: (v, out) => void (v && (out.overflow = "hidden")),
  zIndex: (v, out) => void (out["z-index"] = String(v)),
  background: (v, out) => void (out.background = backgroundCss(v)),
  radius: (v, out) => void (out["border-radius"] = typeof v === "number" ? px(v) : v.map(px).join(" ")),
  borderWidth: () => {},
  borderColor: () => {},
  shadow: () => {},
  color: (v, out) => void (out.color = cssColor(v)),
  fontSize: (v, out) => void (out["font-size"] = px(v)),
  bold: (v, out, n) => void (n.style.fontWeight === undefined && (out["font-weight"] = v ? "700" : "400")),
  fontWeight: (v, out) => void (out["font-weight"] = String(v)),
  italic: (v, out) => void (out["font-style"] = v ? "italic" : "normal"),
  letterSpacing: (v, out) => void (out["letter-spacing"] = px(v)),
  fontFamily: (v, out) => void (out["font-family"] = `${v}, ${UI_FONT}`),
  fontFeatures: (v, out) => void (out["font-feature-settings"] = cssFeatures(v)),
  fontVariations: (v, out) => void (out["font-variation-settings"] = cssVariations(v)),
  underline: (v, out) => void (out["text-decoration"] = v ? "underline" : "none"),
  cursor: () => {}, // the input system sets the cursor of the page (the node under the pointer)
  opacity: (v, out) => void (v !== 1 && (out.opacity = String(v))),
  translateX: () => {},
  translateY: () => {},
};

/** Style keys with a CSS mapping (a test checks they are all of them). */
export const CSS_KEYS = Object.keys(WRITERS) as (keyof Style)[];

const SIZE_CSS = { width: "width", height: "height", minWidth: "min-width", minHeight: "min-height", maxWidth: "max-width", maxHeight: "max-height" } as const;

/**
 * The declarations of `node`'s element that differ from the base stylesheet. `siblingGrows`: a
 * child of its parent has `grow` (the sync knows it per parent; computed when left out).
 */
export function nodeCss(node: UINode, siblingGrows?: boolean): Css {
  const s = node.style;
  const out: Css = {};
  for (const key in s) {
    const value = s[key as keyof Style];
    if (value !== undefined) (WRITERS[key as keyof Style] as Writer<keyof Style>)(value as never, out, node);
  }
  if (node.percents) {
    for (const [key, value] of Object.entries(node.percents)) out[SIZE_CSS[key as keyof typeof SIZE_CSS]] = `${value}%`;
  }

  // Gaps: `gap` along the main axis; `rowGap` (default gap) between the rows of a grid or the
  // lines of a wrap, which for a wrapping column are side by side.
  const grid = s.direction === "grid";
  if (s.gap !== undefined || s.rowGap !== undefined) {
    const gap = s.gap ?? 0, rowGap = s.rowGap ?? gap;
    const lines = grid || s.wrap;
    if (!lines || rowGap === gap) out.gap = px(gap);
    else if (grid || s.direction === "row") Object.assign(out, { "row-gap": px(rowGap), "column-gap": px(gap) });
    else Object.assign(out, { "row-gap": px(gap), "column-gap": px(rowGap) });
  }
  if (grid) {
    const gap = s.gap ?? 0;
    if (s.minColumnWidth !== undefined) {
      // auto-fill with at most `columns`: a cell is never narrower than an n-th of the row.
      const min = s.columns ? `max(${px(s.minColumnWidth)}, calc((100% - ${px(gap * (s.columns - 1))}) / ${s.columns}))` : px(s.minColumnWidth);
      out["grid-template-columns"] = `repeat(auto-fill, minmax(min(100%, ${min}), 1fr))`;
    } else out["grid-template-columns"] = `repeat(${s.columns ?? 1}, minmax(0, 1fr))`;
  }

  // The border is painted over the background inside the box and takes no room (children
  // overlap it, as in paint.ts), so it is an inset shadow, under the drop shadow's list.
  const shadows: string[] = [];
  if (s.borderWidth) shadows.push(`inset 0 0 0 ${px(s.borderWidth)} ${cssColor(s.borderColor ?? "transparent")}`);
  if (s.shadow) shadows.push(`0 ${px(s.shadow.y ?? 0)} ${px(s.shadow.blur)} ${cssColor(s.shadow.color)}`);
  if (shadows.length) out["box-shadow"] = shadows.join(", ");

  if (s.translateX || s.translateY) out.transform = `translate(${px(s.translateX ?? 0)}, ${px(s.translateY ?? 0)})`;

  // Scrolling: on the axes it scrolls (the other one clips, as the native Scroll does).
  if (scrolls(node)) {
    out["overflow-x"] = node.scrollableX ? "auto" : "hidden";
    out["overflow-y"] = node.scrollable ? "auto" : "hidden";
    delete out.overflow;
  }
  const parent = node.parent;
  if (parent && !node.overlay && parent.style.direction !== "grid" && s.position !== "absolute") {
    const row = parent.style.direction === "row";
    // What the native layout never shrinks: a fixed size along the axis, anything along a
    // Scroll's axis, and (since children that grow give up their room first) the siblings of
    // one that grows. CSS shrinks them all in proportion.
    const fixed = row ? s.width !== undefined || node.percents?.width !== undefined : s.height !== undefined || node.percents?.height !== undefined;
    const scrolled = row ? parent.scrollableX : parent.scrollable;
    if (fixed || scrolled || (!s.grow && (siblingGrows ?? parent.children.some((c) => c.style.grow)))) out["flex-shrink"] = "0";
    // A Scroll that grows along the axis it scrolls: sized by its room, not by its content, which
    // the browser would otherwise lay out whole on every change to find the flex basis (a long
    // list). It differs from the native layout only next to other growing children, with less
    // content than room.
    if (s.grow && (row ? node.scrollableX : node.scrollable)) out["flex-basis"] = "0px";
    // Across a two-way Scroll, a child is at least as wide as its content.
    if (!row && parent.scrollableX && parent.scrollable) out["min-width"] ??= "max-content";
  }
  return out;
}
