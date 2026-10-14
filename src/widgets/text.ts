import { type Child, setTextFactory } from "../jsx-runtime.js";
import { edges } from "../render/layout.js";
import { type FontStyle, type Handlers, REGULAR, UINode, displayScale, invalidate, invalidationCount, measureText, metricsGeneration } from "../render/node.js";
import { type TextLine, minContentWidth, wrapText } from "../render/text-wrap.js";
import { type MaybeAccessor, createEffect, read } from "../reactive/signals.js";
import { clipboard } from "../runtime/clipboard.js";
import { theme } from "../theme.js";
import { type StyleProps, applyProps, inherited, inheritedText } from "./props.js";
import { boundaryAt, charAt, charEdges, wordAt } from "./text-selection.js";

function textOf(child: Child): string {
  if (child == null || typeof child === "boolean") return "";
  if (typeof child === "function") return textOf((child as () => Child)());
  if (Array.isArray(child)) return child.map(textOf).join("");
  if (typeof child === "string" || typeof child === "number") return String(child);
  return "";
}

export type TextAlign = "start" | "center" | "end";

export function Text(
  props: StyleProps & Handlers & {
    text?: MaybeAccessor<string | number>;
    children?: Child;
    /** Breaks lines at spaces to fit the width (default true); newlines always break. */
    wrap?: MaybeAccessor<boolean>;
    /** At most this many lines; the last one ends in "…". `maxLines={1}` truncates a single line. */
    maxLines?: MaybeAccessor<number>;
    /** Where each line goes inside the box (default "start"). */
    textAlign?: MaybeAccessor<TextAlign>;
    /** Line spacing as a multiple of the font's (default 1); the extra is split above and below. */
    lineHeight?: MaybeAccessor<number>;
    /** Lets the user select it with the mouse and copy it (Ctrl+C). Off by default, so labels and buttons don't select. */
    selectable?: boolean;
  },
) {
  const node = new UINode("Text");
  applyProps(node, props);
  let value = "";
  let charList: string[] | null = null;
  let hasSpace = false;
  /** Code points of the text, for selection (made only when asked). */
  const chars = () => (charList ??= Array.from(value));
  let selection = { anchor: 0, focus: 0 }; // in characters; empty when equal
  let options = { wrap: true, maxLines: undefined as number | undefined, align: "start" as TextAlign, lineHeight: 1 };
  let lastFont: FontStyle | undefined;
  // Asked for by every measurement (several per frame): walked up the tree again only after
  // an invalidate(), which every style, tree or theme change makes.
  let fontAt = -1;
  let current = { size: 0, face: REGULAR };
  const font = () => {
    if (fontAt !== invalidationCount()) {
      const { size, face } = inheritedText(node, lastFont);
      lastFont = face;
      current = { size: size ?? theme.font.size, face };
      fontAt = invalidationCount();
    }
    return current;
  };
  const narrowest = () => {
    const { size, face } = font();
    const widthOf = (s: string) => measureText(s, size, face).width;
    return Math.ceil(options.maxLines !== undefined ? widthOf("…") : minContentWidth(value, widthOf));
  };
  // Only text that can wrap tells layout its narrowest width (its height then depends on the width).
  const updateWrapping = () => {
    const canWrap = options.maxLines !== undefined || (options.wrap && hasSpace);
    node.minContentWidth = canWrap ? narrowest : undefined;
  };
  createEffect(() => {
    value = props.text !== undefined ? String(read(props.text)) : textOf(props.children);
    charList = null;
    hasSpace = value.includes(" ");
    node.label = `Text ${JSON.stringify(value)}`;
    selection = { anchor: 0, focus: 0 };
    updateWrapping();
    invalidate();
  });
  createEffect(() => {
    options = {
      wrap: read(props.wrap ?? true),
      maxLines: props.maxLines === undefined ? undefined : read(props.maxLines),
      align: read(props.textAlign ?? "start"),
      lineHeight: read(props.lineHeight ?? 1),
    };
    updateWrapping();
    invalidate();
  });

  // Lines for a width. Every row of a long list is measured each frame (scroll extent), so
  // results are kept per node: one for the natural size, one for the last width given.
  interface Layout {
    value: string; size: number; face: FontStyle; options: typeof options; generation: number; width: number;
    lines: TextLine[]; lineHeight: number; glyphHeight: number;
    /** What measure() returns. */
    box: { width: number; height: number };
  }
  let metrics = { size: 0, face: REGULAR, generation: -1, height: 0, ascent: 0, descent: 0 };
  /** Vertical metrics of this font (they do not depend on the text); `height` is a line's. */
  const fontMetrics = (size: number, face: FontStyle) => {
    if (metrics.size !== size || metrics.face !== face || metrics.generation !== metricsGeneration()) {
      const m = measureText(value, size, face);
      metrics = { size, face, generation: metricsGeneration(), height: Math.ceil(m.ascent + m.descent), ascent: m.ascent, descent: m.descent };
    }
    return metrics;
  };
  let natural: Layout | null = null;
  let sized: Layout | null = null;
  const layoutFor = (width: number): Layout => {
    const { size, face } = font();
    // Without spaces or a line limit, the lines are the same at any width.
    const fixed = options.maxLines === undefined && (!options.wrap || !hasSpace);
    const w = fixed ? Infinity : width;
    if (w !== Infinity && options.maxLines === undefined) {
      // Already fits: same lines as the natural size.
      const n = layoutFor(Infinity);
      if (n.lines.every((line) => line.width <= width)) return n;
    }
    const slot = w === Infinity ? natural : sized;
    if (slot && slot.width === w && slot.value === value && slot.size === size && slot.face === face && slot.options === options && slot.generation === metricsGeneration()) return slot;
    const widthOf = (s: string) => measureText(s, size, face).width;
    const glyphHeight = fontMetrics(size, face).height;
    const lines = wrapText(value, w, widthOf, options);
    const lineHeight = Math.ceil(glyphHeight * options.lineHeight);
    const box = { width: Math.ceil(lines.reduce((m, line) => Math.max(m, line.width), 0)), height: lines.length * lineHeight };
    const result = { value, size, face, options, generation: metricsGeneration(), width: w, lines, lineHeight, glyphHeight, box };
    if (w === Infinity) natural = result;
    else sized = result;
    return result;
  };
  node.measure = (maxWidth) => layoutFor(maxWidth).box;

  /** Lines laid out in the node's box; `lineX(i)`/`lineY(i)` say where each starts. */
  const placed = (n: UINode) => {
    const [pt, pr, , pl] = edges(n.style.padding);
    const inner = Math.max(0, n.width - pl - pr);
    const l = layoutFor(inner);
    const align = options.align;
    const lineX = (i: number) => {
      const free = inner - l.lines[i]!.width;
      return n.x + pl + (align === "center" ? free / 2 : align === "end" ? free : 0);
    };
    const lineY = (i: number) => n.y + pt + i * l.lineHeight;
    return { lines: l.lines, lineHeight: l.lineHeight, glyphHeight: l.glyphHeight, lineX, lineY };
  };

  // Character boundaries of a line, only for selectable text.
  const edgeCache = new WeakMap<TextLine, number[]>();
  const lineEdges = (line: TextLine) => {
    let xs = edgeCache.get(line);
    if (!xs) {
      const { size, face } = font();
      const own = chars().slice(line.start, line.end);
      if (own[own.length - 1] === "\n") own.pop();
      xs = charEdges(own, (s) => measureText(s, size, face).width);
      edgeCache.set(line, xs);
    }
    return xs;
  };
  const range = () => [Math.min(selection.anchor, selection.focus), Math.max(selection.anchor, selection.focus)] as const;

  node.paint = (p, n) => {
    const { size, face } = font();
    const l = placed(n);
    const [from, to] = range();
    const color = inherited(n, "color") ?? theme.text.primary;
    const leading = (l.lineHeight - l.glyphHeight) / 2;
    const underline = inherited(n, "underline") ? underlineOf(size, face) : null;
    for (let i = 0; i < l.lines.length; i++) {
      const line = l.lines[i]!;
      const x = l.lineX(i);
      const y = l.lineY(i);
      const a = Math.max(from, line.start) - line.start;
      const b = Math.min(to, line.end) - line.start;
      if (from !== to && a < b) {
        const xs = lineEdges(line);
        const right = xs[Math.min(b, xs.length - 1)]!;
        p.rect(x + xs[a]!, y, right - xs[a]!, l.lineHeight, theme.selection);
      }
      p.text(x, y + leading, line.text, size, color, face);
      if (underline && line.width > 0) p.rect(x, underline.snap(y + leading + underline.offset), line.width, underline.thickness, color);
    }
  };
  /** Below the baseline, a third into the descent; snapped to device pixels so it stays crisp. */
  const underlineOf = (size: number, face: FontStyle) => {
    const { ascent, descent } = fontMetrics(size, face);
    const scale = displayScale();
    const snap = (v: number) => Math.round(v * scale) / scale;
    return { offset: ascent + descent / 3, thickness: Math.max(1, snap(size / 14)), snap };
  };

  if (props.selectable) {
    node.focusable = true; // to receive Ctrl+C, but only by clicking: not a Tab stop
    node.tabStop = false;
    if (node.style.cursor === undefined) node.set("cursor", "text");
    const select = (anchor: number, focus: number) => {
      selection = { anchor, focus };
      invalidate();
    };
    /** The line under a pointer position (local to the node) and x inside that line. */
    const hit = (localX: number, localY: number) => {
      const l = placed(node);
      const i = Math.max(0, Math.min(l.lines.length - 1, Math.floor((localY - edges(node.style.padding)[0]) / l.lineHeight)));
      return { line: l.lines[i]!, x: localX + node.x - l.lineX(i) };
    };
    const boundary = (localX: number, localY: number) => {
      const { line, x } = hit(localX, localY);
      return line.start + boundaryAt(lineEdges(line), x);
    };
    let dragging = false;
    const prev = { ...node.handlers };
    Object.assign(node.handlers, {
      onPointerDown: (e) => {
        prev.onPointerDown?.(e);
        e.stop(); // selecting, not dragging the window or pressing what's around
        if (e.button !== 0) return;
        dragging = e.clicks === 1;
        const { line, x } = hit(e.localX, e.localY);
        const xs = lineEdges(line);
        if (e.clicks >= 3) select(line.start, line.start + xs.length - 1);
        else if (e.clicks === 2) select(...wordAt(chars(), line.start + charAt(xs, x)));
        else select(boundary(e.localX, e.localY), boundary(e.localX, e.localY));
      },
      onPointerMove: (e) => {
        prev.onPointerMove?.(e);
        if (dragging && e.button === 0) select(selection.anchor, boundary(e.localX, e.localY));
      },
      onBlur: () => {
        prev.onBlur?.();
        select(0, 0);
      },
      onKeyDown: (e) => {
        const key = e.key.toLowerCase();
        if (e.ctrl && (key === "c" || key === "insert")) {
          const [from, to] = range();
          if (from !== to) clipboard.writeText(chars().slice(from, to).join(""));
          return e.stop();
        }
        if (e.ctrl && key === "a") {
          select(0, chars().length);
          return e.stop();
        }
        prev.onKeyDown?.(e);
      },
    } satisfies Handlers);
  }
  return node;
}

setTextFactory((text) => Text({ text }));
