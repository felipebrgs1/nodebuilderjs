// PNG decoder (no dependencies besides the runtime's zlib): every color type and bit
// depth, palette/tRNS transparency and Adam7 interlacing. Output is 8-bit RGBA with
// straight alpha. The color profile (cICP, iCCP, sRGB chunks) is returned for decodeImage to
// apply; gAMA/cHRM alone are ignored, as most UI toolkits do.

import { inflateSync } from "node:zlib";
import { concatBytes } from "./bytes.js";
import type { ColorSpace } from "../render/color.js";
import type { ColorProfile } from "./icc.js";

export interface Bitmap {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, straight (not premultiplied) alpha, rows top to bottom. */
  data: Uint8Array;
  /** What the pixel values mean: sRGB unless set (decoders set it from the file's color profile). */
  colorSpace?: ColorSpace;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
// Adam7 passes: x0, y0, dx, dy.
const ADAM7 = [
  [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2],
] as const;

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && SIGNATURE.every((b, i) => bytes[i] === b);
}

export function decodePng(bytes: Uint8Array): Bitmap & { profile?: ColorProfile } {
  if (!isPng(bytes)) throw new Error("not a PNG file");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  const profile: ColorProfile = {};

  for (let pos = 8; pos + 8 <= bytes.length; ) {
    const length = view.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4]!, bytes[pos + 5]!, bytes[pos + 6]!, bytes[pos + 7]!);
    const body = bytes.subarray(pos + 8, pos + 8 + length);
    if (body.length < length) throw new Error("truncated PNG");
    pos += 12 + length; // length, type, data, crc
    if (type === "IHDR") {
      width = view.getUint32(body.byteOffset - bytes.byteOffset);
      height = view.getUint32(body.byteOffset - bytes.byteOffset + 4);
      [depth, colorType] = [body[8]!, body[9]!];
      interlace = body[12]!;
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") trns = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "cICP" && body.length === 4) profile.cicp = [body[0]!, body[1]!];
    else if (type === "iCCP") profile.icc = iccpProfile(body);
    else if (type === "IEND") break;
  }

  const channels = CHANNELS[colorType];
  if (!width || !height || channels === undefined || ![1, 2, 4, 8, 16].includes(depth)) {
    throw new Error(`unsupported PNG (color type ${colorType}, depth ${depth})`);
  }
  if (colorType === 3 && !palette) throw new Error("PNG palette missing");

  const raw = inflateSync(concatBytes(idat));
  const out = new Uint8Array(width * height * 4);
  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3); // filter distance in bytes
  const max = (1 << Math.min(depth, 8)) - 1;
  const trnsSample = (i: number) => (trns && trns.length >= 2 * i + 2 ? (trns[2 * i]! << 8) | trns[2 * i + 1]! : -1);
  const transparent = colorType === 0 ? [trnsSample(0)] : colorType === 2 ? [trnsSample(0), trnsSample(1), trnsSample(2)] : null;

  const to8 = (v: number) => (depth === 16 ? v >> 8 : depth === 8 ? v : Math.round((v * 255) / max));

  let offset = 0;
  const passes = interlace ? ADAM7 : ([[0, 0, 1, 1]] as const);
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((width - x0) / dx);
    const ph = Math.ceil((height - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = Math.ceil((pw * bitsPerPixel) / 8);
    let prev = new Uint8Array(stride);
    for (let y = 0; y < ph; y++) {
      if (offset + 1 + stride > raw.length) throw new Error("truncated PNG image data");
      const filter = raw[offset]!;
      const line = raw.subarray(offset + 1, offset + 1 + stride);
      offset += 1 + stride;
      unfilter(filter, line, prev, bpp);
      prev = line;
      const row = (y0 + y * dy) * width;
      if (colorType === 6 && depth === 8 && dx === 1) {
        out.set(line, row * 4); // the common case: already RGBA8
        continue;
      }
      for (let x = 0; x < pw; x++) {
        const o = (row + x0 + x * dx) * 4;
        const base = x * channels;
        switch (colorType) {
          case 0: { // gray
            const g = readSample(line, base, depth);
            out[o] = out[o + 1] = out[o + 2] = to8(g);
            out[o + 3] = transparent![0] === g ? 0 : 255;
            break;
          }
          case 2: { // RGB
            const r = readSample(line, base, depth), g = readSample(line, base + 1, depth), b = readSample(line, base + 2, depth);
            out[o] = to8(r); out[o + 1] = to8(g); out[o + 2] = to8(b);
            out[o + 3] = transparent![0] === r && transparent![1] === g && transparent![2] === b ? 0 : 255;
            break;
          }
          case 3: { // palette
            const i = readSample(line, base, depth);
            out[o] = palette![i * 3] ?? 0; out[o + 1] = palette![i * 3 + 1] ?? 0; out[o + 2] = palette![i * 3 + 2] ?? 0;
            out[o + 3] = trns && i < trns.length ? trns[i]! : 255;
            break;
          }
          case 4: // gray + alpha
            out[o] = out[o + 1] = out[o + 2] = to8(readSample(line, base, depth));
            out[o + 3] = to8(readSample(line, base + 1, depth));
            break;
          case 6: // RGBA
            out[o] = to8(readSample(line, base, depth)); out[o + 1] = to8(readSample(line, base + 1, depth)); out[o + 2] = to8(readSample(line, base + 2, depth)); out[o + 3] = to8(readSample(line, base + 3, depth));
            break;
        }
      }
    }
  }
  return { width, height, data: out, profile };
}

/** Sample `index` of a scanline, for depths 1..16 (sub-byte samples are packed MSB first). */
function readSample(line: Uint8Array, index: number, depth: number): number {
  if (depth === 8) return line[index]!;
  if (depth === 16) return (line[index * 2]! << 8) | line[index * 2 + 1]!;
  const bit = index * depth;
  return (line[bit >> 3]! >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
}

function unfilter(filter: number, line: Uint8Array, prev: Uint8Array, bpp: number) {
  const n = line.length;
  switch (filter) {
    case 0: return;
    case 1: for (let i = bpp; i < n; i++) line[i] = (line[i]! + line[i - bpp]!) & 255; return;
    case 2: for (let i = 0; i < n; i++) line[i] = (line[i]! + prev[i]!) & 255; return;
    case 3:
      for (let i = 0; i < n; i++) line[i] = (line[i]! + (((i >= bpp ? line[i - bpp]! : 0) + prev[i]!) >> 1)) & 255;
      return;
    case 4:
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? line[i - bpp]! : 0, b = prev[i]!, c = i >= bpp ? prev[i - bpp]! : 0;
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        line[i] = (line[i]! + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      return;
    default:
      throw new Error(`invalid PNG filter ${filter}`);
  }
}

/** iCCP: name, NUL, compression method (0: zlib), the compressed profile. A broken one is skipped. */
function iccpProfile(body: Uint8Array): Uint8Array | undefined {
  const nul = body.indexOf(0);
  if (nul < 1 || nul > 79 || body[nul + 1] !== 0) return undefined;
  try {
    // Real profiles are a few KB (a sampled one, a few hundred): this stops a zip bomb.
    return new Uint8Array(inflateSync(body.subarray(nul + 2), { maxOutputLength: 4 << 20 }));
  } catch {
    return undefined;
  }
}
