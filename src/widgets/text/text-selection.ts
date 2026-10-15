// Positions and selection ranges in one line of text, for the widgets that select
// (Text with `selectable`; the TextField will share them). Indices count code points.

/** x of every boundary between characters: edges[i] = width of the first i characters. */
export function charEdges(chars: string[], widthOf: (s: string) => number): number[] {
  const edges = [0];
  for (let i = 1; i <= chars.length; i++) edges.push(widthOf(chars.slice(0, i).join("")));
  return edges;
}

/** The boundary closest to `x` (px from the start of the text): where a caret would go. */
export function boundaryAt(edges: number[], x: number): number {
  let i = 0;
  while (i < edges.length - 1 && x > (edges[i]! + edges[i + 1]!) / 2) i++;
  return i;
}

/** The character under `x`, clamped to the text. */
export function charAt(edges: number[], x: number): number {
  let i = 0;
  while (i < edges.length - 2 && x >= edges[i + 1]!) i++;
  return i;
}

const isWordChar = (ch: string) => /[\p{L}\p{N}\p{M}_]/u.test(ch);

/** The word around character `i` (or the run of spaces/punctuation there), as [start, end). */
export function wordAt(chars: string[], i: number): [number, number] {
  if (!chars.length) return [0, 0];
  const word = isWordChar(chars[i]!);
  let start = i;
  let end = i + 1;
  while (start > 0 && isWordChar(chars[start - 1]!) === word) start--;
  while (end < chars.length && isWordChar(chars[end]!) === word) end++;
  return [start, end];
}
