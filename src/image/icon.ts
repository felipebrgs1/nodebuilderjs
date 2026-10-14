// App icons (window, tray): an SVG or raster image rasterized into the square sizes desktops
// ask for. Pixels stay straight-alpha RGBA; each backend converts to its own format.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseSvg, renderSvg } from "../svg/index.js";
import { decodeImage } from "./decode.js";
import type { Bitmap } from "./png.js";

/** SVG markup, a file path or file: URL (.svg, PNG, JPEG, WebP...), or encoded bytes. */
export type IconInput = string | URL | Uint8Array;

export interface IconImage {
  size: number;
  /** size x size RGBA, straight alpha, rows top to bottom. */
  rgba: Uint8Array;
}

/** What taskbars, switchers and trays pick from (scaled up by 2 on HiDPI, hence 256). */
export const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;

/** The framework's icon, used when an app sets none (the same file `nodebuilder package` installs). */
export const DEFAULT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect x="16" y="16" width="224" height="224" rx="52" fill="#3584e4"/>
  <rect x="56" y="64" width="144" height="28" rx="10" fill="#ffffff"/>
  <rect x="56" y="108" width="64" height="84" rx="10" fill="#ffffff" fill-opacity="0.85"/>
  <rect x="136" y="108" width="64" height="84" rx="10" fill="#ffffff" fill-opacity="0.6"/>
</svg>
`;

const isMarkup = (text: string) => text.trimStart().startsWith("<");

function startsWithMarkup(bytes: Uint8Array): boolean {
  let i = 0;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0xef || bytes[i] === 0xbb || bytes[i] === 0xbf)) i++;
  return bytes[i] === 0x3c; // "<" (after whitespace and a UTF-8 BOM)
}

/** The icon at every size in ICON_SIZES (a raster image: only the sizes it does not have to be scaled up for). Throws when it cannot be read. */
export function iconImages(input: IconInput = DEFAULT_ICON_SVG): IconImage[] {
  if (typeof input === "string" && isMarkup(input)) return fromSvg(input);
  const path = typeof input === "string" ? input : input instanceof URL ? fileURLToPath(input) : null;
  try {
    const bytes = path === null ? (input as Uint8Array) : readFileSync(path);
    if (startsWithMarkup(bytes)) return fromSvg(new TextDecoder().decode(bytes));
    return fromBitmap(decodeImage(bytes));
  } catch (err) {
    if (path === null) throw err;
    throw new Error(`${path}: ${(err as Error).message}`);
  }
}

function fromSvg(markup: string): IconImage[] {
  const svg = parseSvg(markup);
  return ICON_SIZES.map((size) => ({ size, rgba: renderSvg(svg, size, size).data }));
}

function fromBitmap(bitmap: Bitmap): IconImage[] {
  const side = Math.max(bitmap.width, bitmap.height);
  const sizes = ICON_SIZES.filter((s) => s <= side);
  return (sizes.length ? sizes : [side]).map((size) => ({ size, rgba: fit(bitmap, size) }));
}

/** For each output pixel along an axis: the source pixels it covers and how much of each. */
function coverage(srcLen: number, scale: number, offset: number, outLen: number): { from: number; weights: number[] }[] {
  const out = [];
  for (let o = 0; o < outLen; o++) {
    const start = Math.max(0, (o - offset) / scale), end = Math.min(srcLen, (o + 1 - offset) / scale);
    const from = Math.floor(start), weights: number[] = [];
    for (let i = from; i < end; i++) weights.push((Math.min(end, i + 1) - Math.max(start, i)) * scale);
    out.push({ from, weights });
  }
  return out;
}

/** Scales `bitmap` to fit a size x size square, centered; area-averaged in premultiplied alpha. */
function fit(bitmap: Bitmap, size: number): Uint8Array {
  const { width: w, height: h, data } = bitmap;
  const scale = size / Math.max(w, h);
  const cols = coverage(w, scale, Math.round((size - w * scale) / 2), size);
  const rows = coverage(h, scale, Math.round((size - h * scale) / 2), size);
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const row = rows[y]!;
    for (let x = 0; x < size; x++) {
      const col = cols[x]!;
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < row.weights.length; j++)
        for (let i = 0; i < col.weights.length; i++) {
          const k = ((row.from + j) * w + col.from + i) * 4, wt = row.weights[j]! * col.weights[i]! * data[k + 3]!;
          r += data[k]! * wt;
          g += data[k + 1]! * wt;
          b += data[k + 2]! * wt;
          a += wt;
        }
      if (a <= 0) continue;
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / a);
      out[o + 1] = Math.round(g / a);
      out[o + 2] = Math.round(b / a);
      out[o + 3] = Math.round(a);
    }
  }
  return out;
}
