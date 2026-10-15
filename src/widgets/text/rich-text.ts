// <RichText>: one paragraph made of spans, each with its own font, color, background, underline
// and onClick (bold and italic words, inline code, links), wrapping at spaces across spans.
// Spans of different sizes share a baseline. Positions and widths come from the same
// measureText as <Text>, per word, so a line's runs line up with what layout measured.

import { edges } from "../render/layout.js";
import { type Color, type FontStyle, type PointerEvent, REGULAR, UINode, displayScale, invalidate, measureText, metricsGeneration } from "../render/node.js";
import { type MaybeAccessor, createEffect, read } from "../reactive/signals.js";
import { theme } from "../theme.js";
import { type StyleProps, applyProps, inherited, inheritedText, ownHandler } from "./props.js";
import type { Handlers } from "../render/node.js";
import type { TextAlign } from "./text.js";

export interface TextSpan {
  text: string;
  color?: Color;
  /** Font size in px (default: the inherited one). */
  size?: number;
  bold?: boolean;
  /** 1..1000; wins over `bold`. */
  weight?: number;
  italic?: boolean;
  /** A CSS family list (`"monospace"` for code). */
  family?: string;
  letterSpacing?: number;
  underline?: boolean;
  /** Painted behind the span's text (inline code, highlights). */
  background?: Color;
  /** Makes the span a link: the pointer cursor shows over it and a click runs this. */
  onClick?: (e: PointerEvent) => void;
}

interface Word {
  span: number;
  text: string;
  width: number;
  space: boolean;
  newline: boolean;
}

interface Run {
  span: number;
  text: string;
  x: number;
  width: number;
}

interface Line {
  runs: Run[];
  /** Without trailing spaces. */
  width: number;
  ascent: number;
  descent: number;
  y: number;
  height: number;
}

export function RichText(
  props: StyleProps & Handlers & {
    spans: MaybeAccessor<readonly (TextSpan | string)[]>;
    /** Line spacing as a multiple of the font's (default 1). */
    lineHeight?: MaybeAccessor<number>;
    /** Where each line goes inside the box (default "start"). */
    textAlign?: MaybeAccessor<TextAlign>;
  },
) {
  const node = new UINode("RichText");
  applyProps(node, props);
  let spans: TextSpan[] = [];
  let cache: { width: number; lines: Line[]; box: { width: number; height: number } } | null = null;
  let options = { lineHeight: 1, align: "start" as TextAlign };
  createEffect(() => {
    spans = read(props.spans).map((s) => (typeof s === "string" ? { text: s } : s));
    options = { lineHeight: read(props.lineHeight ?? 1), align: read(props.textAlign ?? "start") };
    node.label = `RichText ${JSON.stringify(spans.map((s) => s.text).join(""))}`;
    cache = null;
    invalidate();
  });

  // The font of each span: the inherited one with the span's own fields over it.
  let base = { size: 0, face: REGULAR };
  const fontOf = (s: TextSpan): { size: number; face: FontStyle } => ({
    size: s.size ?? base.size,
    face: {
      ...base.face,
      weight: s.weight ?? (s.bold === undefined ? base.face.weight : s.bold ? 700 : 400),
      italic: s.italic ?? base.face.italic,
      family: s.family ?? base.face.family,
      letterSpacing: s.letterSpacing ?? base.face.letterSpacing,
    },
  });

  // Words and spaces of every span, measured once per text and font.
  let words: Word[] = [];
  let fonts: { size: number; face: FontStyle; ascent: number; descent: number }[] = [];
  let measuredFor: unknown = null;
  const measureWords = () => {
    const { size, face } = inheritedText(node, base.face);
    base = { size: size ?? theme.font.size, face };
    const key = [spans, base.size, base.face, metricsGeneration()];
    if (measuredFor && (measuredFor as unknown[]).every((v, i) => v === key[i])) return;
    measuredFor = key;
    words = [];
    fonts = spans.map((s) => {
      const f = fontOf(s);
      const m = measureText("Ag", f.size, f.face);
      return { ...f, ascent: m.ascent, descent: m.descent };
    });
    spans.forEach((s, i) => {
      const f = fonts[i]!;
      for (const part of s.text.match(/\n| +|[^ \n]+/g) ?? []) {
        const newline = part === "\n";
        words.push({ span: i, text: part, width: newline ? 0 : measureText(part, f.size, f.face).width, space: part[0] === " ", newline });
      }
    });
    cache = null;
  };

  /** Greedy lines at `width`: a word goes to the next line when it does not fit; spaces may hang past the end. */
  const layoutAt = (width: number) => {
    measureWords();
    if (cache && cache.width === width) return cache;
    const lines: Line[] = [];
    let runs: Run[] = [];
    let x = 0;
    let trimmed = 0;
    const used = new Set<number>();
    const endLine = () => {
      // An empty line (two newlines) is as tall as the paragraph's base font.
      const ms = used.size ? [...used].map((i) => fonts[i]!) : [{ ascent: measureText("Ag", base.size, base.face).ascent, descent: measureText("Ag", base.size, base.face).descent }];
      const ascent = Math.max(...ms.map((m) => m.ascent));
      const descent = Math.max(...ms.map((m) => m.descent));
      const y = lines.length ? lines.at(-1)!.y + lines.at(-1)!.height : 0;
      lines.push({ runs, width: trimmed, ascent, descent, y, height: Math.ceil((ascent + descent) * options.lineHeight) });
      runs = [];
      x = 0;
      trimmed = 0;
      used.clear();
    };
    const add = (w: Word) => {
      const last = runs.at(-1);
      if (last && last.span === w.span) {
        last.text += w.text;
        last.width += w.width;
      } else runs.push({ span: w.span, text: w.text, x, width: w.width });
      used.add(w.span);
      x += w.width;
      if (!w.space) trimmed = x;
    };
    for (const w of words) {
      if (w.newline) {
        used.add(w.span);
        endLine();
        continue;
      }
      if (w.space) {
        if (runs.length || lines.length === 0 || x > 0) add(w); // spaces after a wrap are dropped
        continue;
      }
      if (runs.length && x + w.width > width && trimmed > 0) endLine();
      add(w);
    }
    endLine();
    const box = { width: Math.ceil(Math.max(...lines.map((l) => l.width))), height: lines.reduce((h, l) => h + l.height, 0) };
    cache = { width, lines, box };
    return cache;
  };

  node.measure = (maxWidth) => layoutAt(maxWidth).box;
  node.minContentWidth = () => {
    measureWords();
    return Math.ceil(Math.max(0, ...words.filter((w) => !w.space && !w.newline).map((w) => w.width)));
  };

  const contentBox = (n: UINode) => {
    const [pt, pr, , pl] = edges(n.style.padding);
    return { x: n.x + pl, y: n.y + pt, width: Math.max(0, n.width - pl - pr) };
  };
  const lineX = (line: Line, box: { x: number; width: number }) => {
    const free = box.width - line.width;
    return box.x + (options.align === "center" ? free / 2 : options.align === "end" ? free : 0);
  };

  node.paint = (p, n) => {
    const box = contentBox(n);
    const { lines } = layoutAt(box.width);
    const color = inherited(n, "color") ?? theme.text.primary;
    const scale = displayScale();
    const snap = (v: number) => Math.round(v * scale) / scale;
    for (const line of lines) {
      const x0 = lineX(line, box);
      const top = box.y + line.y + (line.height - line.ascent - line.descent) / 2;
      for (const run of line.runs) {
        const s = spans[run.span]!;
        const f = fonts[run.span]!;
        const y = top + line.ascent - f.ascent; // shared baseline
        if (s.background) p.rect(x0 + run.x, box.y + line.y, run.width, line.height, s.background);
        p.text(x0 + run.x, y, run.text, f.size, s.color ?? color, f.face);
        if (s.underline) {
          const ink = run.text.trimEnd();
          const w = ink === run.text ? run.width : measureText(ink, f.size, f.face).width;
          p.rect(x0 + run.x, snap(y + f.ascent + f.descent / 3), w, Math.max(1, snap(f.size / 14)), s.color ?? color);
        }
      }
    }
  };

  /** The span under a window point, if any. */
  const spanAt = (x: number, y: number): TextSpan | undefined => {
    const box = contentBox(node);
    const { lines } = layoutAt(box.width);
    const line = lines.find((l) => y >= box.y + l.y && y < box.y + l.y + l.height);
    if (!line) return undefined;
    const lx = x - lineX(line, box);
    const run = line.runs.find((r) => lx >= r.x && lx < r.x + r.width);
    return run && spans[run.span];
  };

  // Links: a click on one runs it; anywhere else the click is the parent's, as if this had no onClick.
  createEffect(() => {
    read(props.spans);
    if (!spans.some((s) => s.onClick) || node.handlers.onClick) return;
    ownHandler(node, "onClick", (e) => {
      const span = spanAt(e.x, e.y);
      if (span?.onClick) return span.onClick(e);
      for (let a = node.parent; a; a = a.parent) {
        if (!a.handlers.onClick) continue;
        a.handlers.onClick({ ...e, localX: e.x - a.x, localY: e.y - a.y });
        return;
      }
    });
    ownHandler(node, "onPointerMove", (e) => node.override("cursor", spanAt(e.x, e.y)?.onClick ? "pointer" : undefined));
    ownHandler(node, "onPointerLeave", () => node.override("cursor", undefined));
  });
  return node;
}
