// <TextArea>: multi-line text input. Wraps at the width it gets (a word longer than the line is
// split), is as tall as its lines (at least `rows`), and scrolls to the caret: a Scroll around it
// follows (scrollIntoView of the caret's region), and with a height that cuts its content it
// scrolls by itself (wheel, caret). Editing, selection and undo come from text-edit.ts.

import { edges, visibleRegion } from "../../render/layout.js";
import { type FontStyle, UINode, invalidate, measureText, metricsGeneration } from "../../render/node.js";
import { type TextLine, wrapText } from "../../render/text-wrap.js";
import { type MaybeAccessor, createEffect, read, untrack } from "../../reactive/signals.js";
import { theme } from "../../theme.js";
import { inherited, inheritedFont, ownHandler } from "../props.js";
import { type EditableProps, editKey, editable } from "./text-edit.js";
import { boundaryAt, charAt, charEdges } from "./text-selection.js";

export function TextArea(
  props: EditableProps & {
    /** Lines it is at least as tall as (default 3); it grows with its content. */
    rows?: MaybeAccessor<number>;
    /** Ctrl+Return (Return inserts a newline). */
    onSubmit?: () => void;
  },
) {
  const node = new UINode("TextArea");
  node.style.minWidth = 80;
  let revealPending = false;
  const { state, session, blinkOn, version } = editable(node, props, (s) => {
    if (untrack(s.focused)) reveal();
  });
  node.field = {
    value: () => props.value(),
    shown: () => props.value(),
    placeholder: () => (props.placeholder === undefined ? undefined : read(props.placeholder)),
  };
  let scrollY = 0;
  /** x the caret keeps while moving up and down (null: its own x). */
  let goalX: number | null = null;
  createEffect(() => {
    blinkOn();
    version();
    read(props.rows);
    invalidate();
  });

  const size = () => inherited(node, "fontSize") ?? theme.font.size;
  let lastFont: FontStyle | undefined;
  const face = () => (lastFont = inheritedFont(node, lastFont));
  const widthOf = (s: string) => measureText(s, size(), face()).width;
  const lineHeight = () => {
    const m = measureText("Ag", size(), face());
    return Math.ceil(m.ascent + m.descent);
  };

  // Lines at a content width, kept until the text, the width or the font changes.
  let wrapped = { value: "", width: -1, size: 0, face: undefined as FontStyle | undefined, generation: -1, lines: [] as TextLine[] };
  const linesAt = (width: number): TextLine[] => {
    const value = props.value();
    const w = wrapped;
    if (w.value !== value || w.width !== width || w.size !== size() || w.face !== face() || w.generation !== metricsGeneration()) {
      wrapped = { value, width, size: size(), face: face(), generation: metricsGeneration(), lines: wrapText(value, width, widthOf, { breakWords: true }) };
    }
    return wrapped.lines;
  };
  const inner = () => {
    const [pt, pr, pb, pl] = edges(node.style.padding);
    return { pt, pl, width: Math.max(1, node.width - pl - pr), height: Math.max(0, node.height - pt - pb) };
  };
  const lines = () => linesAt(inner().width);

  node.measure = (maxWidth) => {
    const width = maxWidth === Infinity ? 296 : maxWidth;
    const rows = Math.max(read(props.rows ?? 3), linesAt(Math.max(1, width)).length);
    return { width, height: rows * lineHeight() };
  };
  node.minContentWidth = () => 40;
  node.fluidMeasure = true;

  /** Index of the line holding position `i` (the last one starting at or before it). */
  const lineOf = (ls: TextLine[], i: number) => {
    let lo = 0;
    let hi = ls.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ls[mid]!.start <= i) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  // Character boundaries of a line (its newline left out), for the caret, clicks and selection.
  const edgeCache = new WeakMap<TextLine, number[]>();
  const lineEdges = (line: TextLine) => {
    let xs = edgeCache.get(line);
    if (!xs) {
      const own = session.chars.slice(line.start, line.end);
      if (own[own.length - 1] === "\n") own.pop();
      xs = charEdges(own, widthOf);
      edgeCache.set(line, xs);
    }
    return xs;
  };
  /** Where the caret can go on a line: its start, and its end before a newline (or before the space a soft wrap broke at). */
  const bounds = (ls: TextLine[], i: number): [number, number] => {
    const line = ls[i]!;
    const last = session.chars[line.end - 1];
    const soft = i < ls.length - 1 && last !== "\n";
    return [line.start, last === "\n" || (soft && last === " ") ? line.end - 1 : line.end];
  };
  const caretX = (ls: TextLine[], i: number) => {
    const line = ls[lineOf(ls, i)]!;
    const xs = lineEdges(line);
    return xs[Math.min(i - line.start, xs.length - 1)]!;
  };
  /** The position at x (content px) on line `i`. */
  const positionOn = (ls: TextLine[], i: number, x: number) => {
    const [start, end] = bounds(ls, i);
    return Math.min(end, start + boundaryAt(lineEdges(ls[i]!), x));
  };

  const navigation = {
    lineBounds: (i: number) => bounds(lines(), lineOf(lines(), i)),
    vertical: (i: number, dir: -1 | 1, count: number) => {
      const ls = lines();
      const from = lineOf(ls, i);
      const to = from + dir * count;
      goalX ??= caretX(ls, i);
      if (to < 0) return 0;
      if (to >= ls.length) return session.chars.length;
      return positionOn(ls, to, goalX);
    },
    pageLines: () => Math.max(1, Math.floor(inner().height / lineHeight()) - 1),
  };

  /** Scrolls to the caret: its own content now (paint finishes it), the Scrolls around on the next layout. */
  function reveal() {
    revealPending = true;
    if (node.width <= 0) return;
    const { pt, pl, height } = inner();
    const ls = lines();
    const lh = lineHeight();
    const top = lineOf(ls, session.focus) * lh;
    // Growing with its content, the last layout's height is stale (a line was just added): only
    // a height of its own cuts the content.
    if (node.style.height !== undefined || node.style.maxHeight !== undefined) {
      scrollY = clampScroll(scrollY + (top < scrollY ? top - scrollY : top + lh > scrollY + height ? top + lh - scrollY - height : 0), ls.length * lh, height);
    }
    // On the first or the last line, the padding there shows too.
    const line = lineOf(ls, session.focus);
    const above = line === 0 ? pt : 0;
    const below = line === ls.length - 1 ? edges(node.style.padding)[2] : 0;
    node.scrollIntoView({ x: pl + caretX(ls, session.focus), y: pt + top - scrollY - above, width: 2, height: lh + above + below });
  }
  const clampScroll = (y: number, content: number, view: number) => Math.max(0, Math.min(y, Math.max(0, content - view)));

  node.paint = (p, n) => {
    const { pt, pl, width, height } = inner();
    const ls = lines();
    const lh = lineHeight();
    const x0 = n.x + pl;
    const y0 = n.y + pt;
    // A height that cuts the content: this scrolls itself (to the caret after it moved).
    if (revealPending) {
      const top = lineOf(ls, session.focus) * lh;
      if (top < scrollY) scrollY = top;
      else if (top + lh > scrollY + height) scrollY = top + lh - height;
      revealPending = false;
    }
    scrollY = clampScroll(scrollY, ls.length * lh, height);

    const view = visibleRegion(n, x0, y0, width, height);
    const first = Math.max(0, Math.floor((view.y + scrollY) / lh));
    const last = Math.min(ls.length - 1, Math.floor((view.y + view.height + scrollY - 1) / lh));
    const [a, b] = session.range();
    const color = inherited(n, "color") ?? theme.text.primary;
    p.clip(x0 - 1, y0, width + 2, height);
    if (!props.value() && props.placeholder) p.text(x0, y0, read(props.placeholder), size(), theme.field.placeholder, face());
    for (let i = first; i <= last && view.height > 0; i++) {
      const line = ls[i]!;
      const y = y0 + i * lh - scrollY;
      if (a !== b && state.focused() && a < line.end && b > line.start) {
        const xs = lineEdges(line);
        const from = xs[Math.max(0, a - line.start)]!;
        const to = xs[Math.min(xs.length - 1, b - line.start)]!;
        if (to > from) p.rect(x0 + from, y, to - from, lh, theme.selection);
      }
      if (line.text) p.text(x0, y, line.text, size(), color, face());
    }
    if (state.focused() && blinkOn() && a === b) {
      const line = lineOf(ls, session.focus);
      p.rect(Math.round(x0 + caretX(ls, session.focus)), y0 + line * lh - scrollY, 1.5, lh, theme.field.focus);
    }
    p.unclip();
  };

  /** Position under a window point. */
  const hit = (x: number, y: number) => {
    const { pt, pl } = inner();
    const ls = lines();
    const i = Math.max(0, Math.min(ls.length - 1, Math.floor((y - node.y - pt + scrollY) / lineHeight())));
    return { ls, line: i, x: x - node.x - pl };
  };
  let dragging = false;
  ownHandler(node, "onPointerDown", (e) => {
    if (e.button !== 0) return;
    goalX = null;
    const { ls, line, x } = hit(e.x, e.y);
    dragging = e.clicks === 1;
    if (e.clicks >= 3) session.select(...bounds(ls, line));
    else if (e.clicks === 2) session.selectWord(ls[line]!.start + charAt(lineEdges(ls[line]!), x));
    else session.moveTo(positionOn(ls, line, x), e.shift);
  });
  ownHandler(node, "onPointerMove", (e) => {
    if (!dragging || e.button !== 0) return;
    const { ls, line, x } = hit(e.x, e.y);
    session.moveTo(positionOn(ls, line, x), true);
  });
  ownHandler(node, "onPointerUp", () => {
    dragging = false;
  });
  ownHandler(node, "onScroll", (e) => {
    const { height } = inner();
    const next = clampScroll(scrollY + e.dy, lines().length * lineHeight(), height);
    if (next === scrollY) return; // nothing to scroll here: the Scroll around takes it
    scrollY = next;
    invalidate();
    e.stop();
  });
  ownHandler(node, "onKeyDown", (e) => {
    const vertical = e.key === "Up" || e.key === "Down" || e.key === "Page_Up" || e.key === "Page_Down";
    if (!vertical) goalX = null;
    if (editKey(session, e, { multiline: true, lines: navigation, onSubmit: props.onSubmit })) e.stop();
  });
  return node;
}
