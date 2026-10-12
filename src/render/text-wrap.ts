// Line breaking for <Text>: greedy, at spaces, like CSS `overflow-wrap: normal` (a word
// longer than the line overflows instead of being split). Newlines always break.
// Positions are code point indices into the text.

export interface TextLine {
  /** Code point range of the text this line covers (its trailing spaces and newline included). */
  start: number;
  end: number;
  /** What is drawn: without trailing spaces, with "…" when cut. */
  text: string;
  width: number;
}

export interface WrapOptions {
  /** Break at spaces to fit `maxWidth` (default true); newlines break either way. */
  wrap?: boolean;
  /** Lines kept; the last one (and any that overflows) ends in "…". */
  maxLines?: number;
}

const ELLIPSIS = "…";

/** Word plus the spaces after it: the units a line is built from. */
function tokens(chars: string[], start: number, end: number): [number, number][] {
  const out: [number, number][] = [];
  for (let t = start; t < end; ) {
    let e = t;
    while (e < end && chars[e] !== " ") e++;
    while (e < end && chars[e] === " ") e++;
    out.push([t, e]);
    t = e;
  }
  return out;
}

const trimEnd = (s: string) => s.replace(/ +$/, "");

/** Code points in `s` (what positions count), without splitting it. */
function codePoints(s: string): number {
  let n = s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) n--; // high surrogate: the pair is one code point
  }
  return n;
}

export function wrapText(value: string, maxWidth: number, widthOf: (s: string) => number, options: WrapOptions = {}): TextLine[] {
  const wrap = options.wrap ?? true;
  // Most text is a single line that fits: one measurement, no splitting.
  if (!value.includes("\n")) {
    const shown = value.endsWith(" ") ? trimEnd(value) : value;
    const width = widthOf(shown);
    if (width <= maxWidth || (!wrap && options.maxLines === undefined)) return [{ start: 0, end: codePoints(value), text: shown, width }];
  }
  const chars = Array.from(value);
  const text = (a: number, b: number) => chars.slice(a, b).join("");
  const lines: TextLine[] = [];

  let start = 0;
  for (let k = 0; k <= chars.length; k++) {
    if (k < chars.length && chars[k] !== "\n") continue;
    const next = Math.min(k + 1, chars.length); // the newline belongs to the line it ends
    // Common case first: the whole paragraph fits (or nothing wraps), measured in one go.
    const whole = trimEnd(text(start, k));
    const wholeWidth = widthOf(whole);
    if (!wrap || wholeWidth <= maxWidth) {
      lines.push({ start, end: next, text: whole, width: wholeWidth });
      start = k + 1;
      continue;
    }
    const words = tokens(chars, start, k);
    let lineStart = start;
    let full = 0; // width with every token's trailing spaces
    let lastEnd = start;
    let lastTrimmed = 0;
    let lastFull = 0;
    words.forEach(([a, b], i) => {
      const t = text(a, b);
      const fw = widthOf(t);
      const tw = t.endsWith(" ") ? widthOf(trimEnd(t)) : fw;
      if (wrap && i > 0 && full + tw > maxWidth) {
        lines.push({ start: lineStart, end: a, text: trimEnd(text(lineStart, lastEnd)), width: full - lastFull + lastTrimmed });
        lineStart = a;
        full = 0;
      }
      full += fw;
      lastEnd = b;
      lastFull = fw;
      lastTrimmed = tw;
    });
    if (words.length) lines.push({ start: lineStart, end: next, text: trimEnd(text(lineStart, lastEnd)), width: full - lastFull + lastTrimmed });
    start = k + 1;
  }

  const max = options.maxLines;
  if (max === undefined) return lines;
  const kept = lines.slice(0, Math.max(1, max));
  const cut = lines.length > kept.length;
  kept.forEach((line, i) => {
    const last = i === kept.length - 1;
    if (last && cut) {
      // Everything left goes on the last line, as far as it fits.
      kept[i] = { ...line, end: chars.length, ...fit(chars.slice(line.start).map((c) => (c === "\n" ? " " : c)), maxWidth, widthOf) };
    } else if (line.width > maxWidth) {
      kept[i] = { ...line, ...fit(chars.slice(line.start, line.end), maxWidth, widthOf) };
    }
  });
  return kept;
}

/** The longest start of `chars` that fits in `maxWidth` followed by "…". */
function fit(chars: string[], maxWidth: number, widthOf: (s: string) => number): { text: string; width: number } {
  const candidate = (n: number) => trimEnd(chars.slice(0, n).join("")) + ELLIPSIS;
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (widthOf(candidate(mid)) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  const t = candidate(lo);
  return { text: t, width: widthOf(t) };
}

/** Narrowest width the text can wrap to: its widest word. */
export function minContentWidth(value: string, widthOf: (s: string) => number): number {
  let widest = 0;
  for (const line of value.split("\n")) for (const word of line.split(" ")) if (word) widest = Math.max(widest, widthOf(word));
  return widest;
}
