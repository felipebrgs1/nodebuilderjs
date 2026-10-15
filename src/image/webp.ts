// WebP decoder: lossless (VP8L), lossy (VP8 key frames, RFC 6386) with its ALPH alpha
// plane, the extended (VP8X) container and the first frame of animations. Output is
// 8-bit RGBA with straight alpha. Lossy output follows libwebp's choices (fancy chroma
// upsampling, fixed-point YUV->RGB) so pixels match what other tools show.

import type { Bitmap } from "./png.js";
import type { ColorProfile } from "./icc.js";

export function isWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && fourcc(bytes, 0) === "RIFF" && fourcc(bytes, 8) === "WEBP";
}

export function decodeWebp(bytes: Uint8Array): Bitmap & { profile?: ColorProfile } {
  if (!isWebp(bytes)) throw new Error("not a WebP file");
  const end = Math.min(bytes.length, 8 + u32(bytes, 4));
  const list = chunks(bytes, 12, end);
  const icc = list.find((c) => c.type === "ICCP")?.data;
  return { ...decodeChunks(list), profile: icc ? { icc } : undefined };
}

function decodeChunks(list: Chunk[]): Bitmap {
  const first = list[0];
  if (!first) throw new Error("truncated WebP");
  if (first.type === "VP8 " || first.type === "VP8L") return decodeFrame(list);
  if (first.type !== "VP8X") throw new Error(`unsupported WebP chunk "${first.type}"`);

  const canvasW = u24(first.data, 4) + 1;
  const canvasH = u24(first.data, 7) + 1;
  // Larger than any GPU texture; also stops a corrupt header from allocating gigabytes.
  if (canvasW * canvasH > 1 << 28) throw new Error(`WebP too large (${canvasW}x${canvasH})`);
  const frame = list.find((c) => c.type === "ANMF");
  if (!frame) return decodeFrame(list);

  // Animation: only the first frame, placed on a transparent canvas.
  const d = frame.data;
  if (d.length < 16) throw new Error("truncated WebP");
  const x0 = u24(d, 0) * 2, y0 = u24(d, 3) * 2;
  const image = decodeFrame(chunks(d, 16, d.length));
  if (x0 === 0 && y0 === 0 && image.width === canvasW && image.height === canvasH) return image;
  const out = new Uint8Array(canvasW * canvasH * 4);
  for (let y = 0; y < image.height && y0 + y < canvasH; y++) {
    const w = Math.min(image.width, canvasW - x0) * 4;
    if (w > 0) out.set(image.data.subarray(y * image.width * 4, y * image.width * 4 + w), ((y0 + y) * canvasW + x0) * 4);
  }
  return { width: canvasW, height: canvasH, data: out };
}

// ---- container -----------------------------------------------------------------------

interface Chunk {
  type: string;
  data: Uint8Array;
}

function fourcc(b: Uint8Array, at: number) {
  return String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
}
function u24(b: Uint8Array, at: number) {
  return b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16);
}
function u32(b: Uint8Array, at: number) {
  return u24(b, at) + b[at + 3]! * 0x1000000;
}

function chunks(b: Uint8Array, start: number, end: number): Chunk[] {
  const out: Chunk[] = [];
  for (let pos = start; pos + 8 <= end; ) {
    const size = u32(b, pos + 4);
    if (pos + 8 + size > end) throw new Error("truncated WebP");
    out.push({ type: fourcc(b, pos), data: b.subarray(pos + 8, pos + 8 + size) });
    pos += 8 + size + (size & 1); // chunks are padded to an even size
  }
  return out;
}

/** One still image: VP8L, or VP8 plus an optional ALPH chunk. */
function decodeFrame(list: Chunk[]): Bitmap {
  const lossless = list.find((c) => c.type === "VP8L");
  if (lossless) return decodeVp8l(lossless.data);
  const lossy = list.find((c) => c.type === "VP8 ");
  if (!lossy) throw new Error("WebP image data missing");
  const image = decodeVp8(lossy.data);
  const alpha = list.find((c) => c.type === "ALPH");
  if (alpha) {
    const a = decodeAlpha(alpha.data, image.width, image.height);
    for (let i = 0, n = image.width * image.height; i < n; i++) image.data[i * 4 + 3] = a[i]!;
  }
  return image;
}

// ---- alpha (ALPH) ----------------------------------------------------------------------

function decodeAlpha(d: Uint8Array, width: number, height: number): Uint8Array {
  if (d.length < 2) throw new Error("truncated WebP alpha");
  const method = d[0]! & 3, filter = (d[0]! >> 2) & 3;
  if (method > 1 || d[0]! >> 6) throw new Error("unsupported WebP alpha encoding");
  const n = width * height;
  let a: Uint8Array;
  if (method === 0) {
    if (d.length - 1 < n) throw new Error("truncated WebP alpha");
    a = d.slice(1, 1 + n);
  } else {
    // A headerless VP8L stream whose green channel is the alpha value.
    const argb = decodeStream(new LBits(d.subarray(1)), width, height, true);
    a = new Uint8Array(n);
    for (let i = 0; i < n; i++) a[i] = (argb[i]! >> 8) & 255;
  }
  if (filter) unfilterAlpha(a, width, height, filter);
  return a;
}

// Inverse of the ALPH prediction filters (horizontal, vertical, gradient), in place.
function unfilterAlpha(a: Uint8Array, w: number, h: number, filter: number) {
  for (let y = 0; y < h; y++) {
    const row = y * w, up = row - w;
    if (y === 0) {
      for (let x = 1; x < w; x++) a[x] = (a[x]! + a[x - 1]!) & 255;
      continue;
    }
    if (filter === 1) {
      a[row] = (a[row]! + a[up]!) & 255;
      for (let x = 1; x < w; x++) a[row + x] = (a[row + x]! + a[row + x - 1]!) & 255;
    } else if (filter === 2) {
      for (let x = 0; x < w; x++) a[row + x] = (a[row + x]! + a[up + x]!) & 255;
    } else {
      a[row] = (a[row]! + a[up]!) & 255;
      for (let x = 1; x < w; x++) {
        const g = a[row + x - 1]! + a[up + x]! - a[up + x - 1]!;
        a[row + x] = (a[row + x]! + (g < 0 ? 0 : g > 255 ? 255 : g)) & 255;
      }
    }
  }
}

// ---- VP8L (lossless) -------------------------------------------------------------------

function decodeVp8l(d: Uint8Array): Bitmap {
  if (d.length < 5 || d[0] !== 0x2f) throw new Error("invalid WebP lossless signature");
  const br = new LBits(d.subarray(1));
  const width = br.read(14) + 1;
  const height = br.read(14) + 1;
  br.read(1); // alpha_is_used: only a hint
  if (br.read(3) !== 0) throw new Error("unsupported WebP lossless version");
  const argb = decodeStream(br, width, height, true);
  const out = new Uint8Array(width * height * 4);
  for (let i = 0, o = 0; i < argb.length; i++, o += 4) {
    const p = argb[i]!;
    out[o] = (p >>> 16) & 255;
    out[o + 1] = (p >>> 8) & 255;
    out[o + 2] = p & 255;
    out[o + 3] = p >>> 24;
  }
  return { width, height, data: out };
}

/** LSB-first bit reader. */
class LBits {
  pos = 0;
  readonly limit: number;
  constructor(readonly d: Uint8Array) {
    this.limit = d.length * 8;
  }
  /** At least 25 upcoming bits, without consuming them. Reads past the end yield zeros. */
  peek(): number {
    const p = this.pos >>> 3, d = this.d;
    return ((d[p]! | (d[p + 1]! << 8) | (d[p + 2]! << 16) | (d[p + 3]! << 24)) >>> (this.pos & 7)) >>> 0;
  }
  read(n: number): number {
    const v = n ? this.peek() & ((1 << n) - 1) : 0;
    this.pos += n;
    return v;
  }
  check() {
    if (this.pos > this.limit) throw new Error("truncated WebP lossless data");
  }
}

// Two-level canonical Huffman tables: 8 root bits, then a sub-table per long-code prefix.
// Leaf entry: (length << 16) | symbol. Root pointer: -1 - ((offset << 4) | sub-table bits).
const ROOT_BITS = 8;

function reverseBits(code: number, len: number) {
  let r = 0;
  for (let i = 0; i < len; i++) r = (r << 1) | ((code >> i) & 1);
  return r;
}

function buildHuffman(lengths: Uint8Array): Int32Array {
  const count = new Int32Array(16);
  let used = 0, only = 0;
  for (let s = 0; s < lengths.length; s++) {
    if (lengths[s]) {
      count[lengths[s]!]++;
      used++;
      only = s;
    }
  }
  if (used === 0) throw new Error("invalid WebP Huffman code");
  // A single symbol takes no bits at all.
  if (used === 1) return new Int32Array(1 << ROOT_BITS).fill(only);
  let left = 1;
  for (let l = 1; l < 16; l++) {
    left = (left << 1) - count[l]!;
    if (left < 0) throw new Error("invalid WebP Huffman code");
  }
  if (left !== 0) throw new Error("invalid WebP Huffman code");

  const next = new Int32Array(16);
  for (let l = 1, code = 0; l < 16; l++) {
    code = (code + count[l - 1]!) << 1;
    next[l] = code;
  }
  const codes = new Int32Array(lengths.length);
  const subLen = new Uint8Array(1 << ROOT_BITS); // longest code per root prefix
  for (let s = 0; s < lengths.length; s++) {
    const l = lengths[s]!;
    if (!l) continue;
    codes[s] = reverseBits(next[l]!++, l);
    if (l > ROOT_BITS) {
      const prefix = codes[s]! & ((1 << ROOT_BITS) - 1);
      if (l > subLen[prefix]!) subLen[prefix] = l;
    }
  }
  let size = 1 << ROOT_BITS;
  const offset = new Int32Array(1 << ROOT_BITS);
  for (let p = 0; p < 1 << ROOT_BITS; p++) {
    if (!subLen[p]) continue;
    offset[p] = size;
    size += 1 << (subLen[p]! - ROOT_BITS);
  }
  const table = new Int32Array(size);
  for (let p = 0; p < 1 << ROOT_BITS; p++) if (subLen[p]) table[p] = -1 - ((offset[p]! << 4) | (subLen[p]! - ROOT_BITS));
  for (let s = 0; s < lengths.length; s++) {
    const l = lengths[s]!;
    if (!l) continue;
    const code = codes[s]!;
    if (l <= ROOT_BITS) {
      for (let i = code; i < 1 << ROOT_BITS; i += 1 << l) table[i] = (l << 16) | s;
    } else {
      const prefix = code & ((1 << ROOT_BITS) - 1);
      const sub = subLen[prefix]! - ROOT_BITS;
      for (let i = code >>> ROOT_BITS; i < 1 << sub; i += 1 << (l - ROOT_BITS)) table[offset[prefix]! + i] = ((l - ROOT_BITS) << 16) | s;
    }
  }
  return table;
}

function readSymbol(t: Int32Array, br: LBits): number {
  const bits = br.peek();
  let e = t[bits & 255]!;
  if (e >= 0) {
    br.pos += e >>> 16;
    return e & 0xffff;
  }
  e = -1 - e;
  const e2 = t[(e >>> 4) + ((bits >>> ROOT_BITS) & ((1 << (e & 15)) - 1))]!;
  br.pos += ROOT_BITS + (e2 >>> 16);
  return e2 & 0xffff;
}

const CODE_LENGTH_ORDER = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

function readCode(br: LBits, size: number): Int32Array {
  const lengths = new Uint8Array(size);
  if (br.read(1)) {
    // "Simple" code: one or two symbols spelled out.
    const two = br.read(1);
    const first = br.read(br.read(1) ? 8 : 1);
    if (first >= size) throw new Error("invalid WebP Huffman code");
    lengths[first] = 1;
    if (two) {
      const second = br.read(8);
      if (second >= size) throw new Error("invalid WebP Huffman code");
      lengths[second] = 1;
    }
  } else {
    const cl = new Uint8Array(19);
    const n = br.read(4) + 4;
    for (let i = 0; i < n; i++) cl[CODE_LENGTH_ORDER[i]!] = br.read(3);
    const lengthsCode = buildHuffman(cl);
    let max = size;
    if (br.read(1)) {
      max = 2 + br.read(2 + 2 * br.read(3));
      if (max > size) throw new Error("invalid WebP Huffman code");
    }
    let prev = 8;
    for (let s = 0; s < size; ) {
      if (max-- === 0) break;
      const len = readSymbol(lengthsCode, br);
      if (len < 16) {
        lengths[s++] = len;
        if (len) prev = len;
      } else {
        const extra = [2, 3, 7][len - 16]!;
        let repeat = br.read(extra) + [3, 3, 11][len - 16]!;
        if (s + repeat > size) throw new Error("invalid WebP Huffman code");
        const v = len === 16 ? prev : 0;
        while (repeat-- > 0) lengths[s++] = v;
      }
    }
  }
  br.check();
  return buildHuffman(lengths);
}

const subSample = (size: number, bits: number) => (size + (1 << bits) - 1) >> bits;

interface Transform {
  type: number;
  xsize: number;
  bits: number;
  data: Uint32Array;
}

/** An entropy-coded image; at level 0 (the main image) also its transforms and meta codes. */
function decodeStream(br: LBits, xsize: number, ysize: number, level0: boolean): Uint32Array {
  const transforms: Transform[] = [];
  let w = xsize;
  if (level0) {
    let seen = 0;
    while (br.read(1)) {
      const type = br.read(2);
      if (seen & (1 << type)) throw new Error("invalid WebP lossless transform");
      seen |= 1 << type;
      if (type === 0 || type === 1) {
        const bits = br.read(3) + 2;
        transforms.push({ type, xsize: w, bits, data: decodeStream(br, subSample(w, bits), subSample(ysize, bits), false) });
      } else if (type === 2) {
        transforms.push({ type, xsize: w, bits: 0, data: new Uint32Array(0) });
      } else {
        const colors = br.read(8) + 1;
        const bits = colors > 16 ? 0 : colors > 4 ? 1 : colors > 2 ? 2 : 3;
        const raw = decodeStream(br, colors, 1, false);
        // Palette entries are stored as deltas from the previous one; unused slots are black.
        const palette = new Uint32Array(1 << (8 >> bits));
        palette[0] = raw[0]!;
        for (let i = 1; i < colors; i++) palette[i] = addPixels(raw[i]!, palette[i - 1]!);
        transforms.push({ type, xsize: w, bits, data: palette });
        w = subSample(w, bits);
      }
    }
  }

  let cacheBits = 0;
  if (br.read(1)) {
    cacheBits = br.read(4);
    if (cacheBits < 1 || cacheBits > 11) throw new Error("invalid WebP color cache");
  }

  let metaBits = 0;
  let meta: Uint32Array | null = null;
  let groupCount = 1;
  if (level0 && br.read(1)) {
    metaBits = br.read(3) + 2;
    meta = decodeStream(br, subSample(w, metaBits), subSample(ysize, metaBits), false);
    groupCount = 0;
    for (let i = 0; i < meta.length; i++) {
      const g = (meta[i]! >> 8) & 0xffff;
      meta[i] = g;
      if (g >= groupCount) groupCount = g + 1;
    }
  }

  const greenSize = 256 + 24 + (cacheBits ? 1 << cacheBits : 0);
  const groups: Int32Array[][] = [];
  for (let g = 0; g < groupCount; g++) {
    groups.push([readCode(br, greenSize), readCode(br, 256), readCode(br, 256), readCode(br, 256), readCode(br, 40)]);
  }

  let data = decodePixels(br, w, ysize, groups, meta, metaBits, cacheBits);
  for (let i = transforms.length - 1; i >= 0; i--) {
    const t = transforms[i]!;
    if (t.type === 0) inversePredictor(data, t.xsize, ysize, t.bits, t.data);
    else if (t.type === 1) inverseCrossColor(data, t.xsize, ysize, t.bits, t.data);
    else if (t.type === 2) inverseSubtractGreen(data);
    else data = inverseColorIndexing(data, t.xsize, ysize, t.bits, t.data);
  }
  return data;
}

// Distances 1..120 are short 2D offsets around the current pixel.
const CODE_TO_PLANE = [
  0x18, 0x07, 0x17, 0x19, 0x28, 0x06, 0x27, 0x29, 0x16, 0x1a, 0x26, 0x2a, 0x38, 0x05, 0x37, 0x39, 0x15, 0x1b, 0x36, 0x3a,
  0x25, 0x2b, 0x48, 0x04, 0x47, 0x49, 0x14, 0x1c, 0x35, 0x3b, 0x46, 0x4a, 0x24, 0x2c, 0x58, 0x45, 0x4b, 0x34, 0x3c, 0x03,
  0x57, 0x59, 0x13, 0x1d, 0x56, 0x5a, 0x23, 0x2d, 0x44, 0x4c, 0x55, 0x5b, 0x33, 0x3d, 0x68, 0x02, 0x67, 0x69, 0x12, 0x1e,
  0x66, 0x6a, 0x22, 0x2e, 0x54, 0x5c, 0x43, 0x4d, 0x65, 0x6b, 0x32, 0x3e, 0x78, 0x01, 0x77, 0x79, 0x53, 0x5d, 0x11, 0x1f,
  0x64, 0x6c, 0x42, 0x4e, 0x76, 0x7a, 0x21, 0x2f, 0x75, 0x7b, 0x31, 0x3f, 0x63, 0x6d, 0x52, 0x5e, 0x00, 0x74, 0x7c, 0x41,
  0x4f, 0x10, 0x20, 0x62, 0x6e, 0x30, 0x73, 0x7d, 0x51, 0x5f, 0x40, 0x72, 0x7e, 0x61, 0x6f, 0x50, 0x71, 0x7f, 0x60, 0x70,
];

function prefixValue(symbol: number, br: LBits): number {
  if (symbol < 4) return symbol + 1;
  const extra = (symbol - 2) >> 1;
  return ((2 + (symbol & 1)) << extra) + br.read(extra) + 1;
}

function decodePixels(
  br: LBits, w: number, h: number, groups: Int32Array[][], meta: Uint32Array | null, metaBits: number, cacheBits: number,
): Uint32Array {
  const total = w * h;
  const out = new Uint32Array(total);
  const cache = cacheBits ? new Uint32Array(1 << cacheBits) : null;
  const shift = 32 - cacheBits;
  const mask = meta ? (1 << metaBits) - 1 : -1;
  const metaW = subSample(w, metaBits);
  let cached = 0;
  let x = 0, y = 0, pos = 0;
  let g = groups[0]!;
  const fill = () => {
    for (; cached < pos; cached++) cache![Math.imul(0x1e35a7bd, out[cached]!) >>> shift] = out[cached]!;
  };

  while (pos < total) {
    if (meta && (x & mask) === 0) g = groups[meta[(y >> metaBits) * metaW + (x >> metaBits)]!]!;
    const code = readSymbol(g[0]!, br);
    if (code < 280 && code >= 256) {
      // Backward reference: copy `length` pixels from `dist` pixels back.
      const length = prefixValue(code - 256, br);
      const distCode = prefixValue(readSymbol(g[4]!, br), br);
      let dist: number;
      if (distCode > 120) dist = distCode - 120;
      else {
        const c = CODE_TO_PLANE[distCode - 1]!;
        dist = Math.max(1, (c >> 4) * w + 8 - (c & 15));
      }
      if (dist > pos || length > total - pos) throw new Error("invalid WebP backward reference");
      for (let i = 0; i < length; i++, pos++) out[pos] = out[pos - dist]!;
      x += length;
      while (x >= w) {
        x -= w;
        y++;
      }
      if (meta && x & mask) g = groups[meta[(y >> metaBits) * metaW + (x >> metaBits)]!]!;
      if (cache) fill();
      br.check();
      continue;
    }
    if (code < 256) {
      const r = readSymbol(g[1]!, br), b = readSymbol(g[2]!, br), a = readSymbol(g[3]!, br);
      out[pos] = (a << 24) | (r << 16) | (code << 8) | b;
    } else {
      if (!cache) throw new Error("invalid WebP color cache code");
      fill();
      out[pos] = cache[code - 280]!;
    }
    pos++;
    if (++x >= w) {
      x = 0;
      y++;
      if (cache) fill();
      br.check();
    }
  }
  br.check();
  return out;
}

function addPixels(a: number, b: number) {
  return (((a & 0xff00ff00) + (b & 0xff00ff00)) & 0xff00ff00) | (((a & 0x00ff00ff) + (b & 0x00ff00ff)) & 0x00ff00ff);
}
function average2(a: number, b: number) {
  return (((a ^ b) & 0xfefefefe) >>> 1) + (a & b);
}
function clamp255(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
function select(t: number, l: number, tl: number) {
  // Picks top or left, whichever is closer (Manhattan, per channel) to l + t - tl.
  let d = 0;
  for (let s = 0; s < 32; s += 8) {
    const tc = (t >>> s) & 255, lc = (l >>> s) & 255, tlc = (tl >>> s) & 255;
    d += Math.abs(lc - tlc) - Math.abs(tc - tlc);
  }
  return d <= 0 ? t : l;
}
function clampAddSubtractFull(a: number, b: number, c: number) {
  let out = 0;
  for (let s = 0; s < 32; s += 8) out |= clamp255(((a >>> s) & 255) + ((b >>> s) & 255) - ((c >>> s) & 255)) << s;
  return out;
}
function clampAddSubtractHalf(a: number, b: number, c: number) {
  const avg = average2(a, b);
  let out = 0;
  for (let s = 0; s < 32; s += 8) {
    const x = (avg >>> s) & 255;
    out |= clamp255(x + (((x - ((c >>> s) & 255)) / 2) | 0)) << s; // C division truncates toward zero
  }
  return out;
}

function inversePredictor(d: Uint32Array, w: number, h: number, bits: number, modes: Uint32Array) {
  d[0] = addPixels(d[0]!, 0xff000000);
  for (let x = 1; x < w; x++) d[x] = addPixels(d[x]!, d[x - 1]!);
  const tilesW = subSample(w, bits);
  for (let y = 1; y < h; y++) {
    const row = y * w;
    const modeRow = (y >> bits) * tilesW;
    d[row] = addPixels(d[row]!, d[row - w]!);
    for (let x = 1; x < w; x++) {
      const i = row + x;
      const L = d[i - 1]!, T = d[i - w]!;
      let pred: number;
      // TR of the last column is the first pixel of the current row (contiguous memory).
      switch ((modes[modeRow + (x >> bits)]! >> 8) & 15) {
        case 1: pred = L; break;
        case 2: pred = T; break;
        case 3: pred = d[i - w + 1]!; break;
        case 4: pred = d[i - w - 1]!; break;
        case 5: pred = average2(average2(L, d[i - w + 1]!), T); break;
        case 6: pred = average2(L, d[i - w - 1]!); break;
        case 7: pred = average2(L, T); break;
        case 8: pred = average2(d[i - w - 1]!, T); break;
        case 9: pred = average2(T, d[i - w + 1]!); break;
        case 10: pred = average2(average2(L, d[i - w - 1]!), average2(T, d[i - w + 1]!)); break;
        case 11: pred = select(T, L, d[i - w - 1]!); break;
        case 12: pred = clampAddSubtractFull(L, T, d[i - w - 1]!); break;
        case 13: pred = clampAddSubtractHalf(L, T, d[i - w - 1]!); break;
        default: pred = 0xff000000; // 0, and the unused 14/15
      }
      d[i] = addPixels(d[i]!, pred);
    }
  }
}

const int8 = (v: number) => (v << 24) >> 24;

function inverseCrossColor(d: Uint32Array, w: number, h: number, bits: number, codes: Uint32Array) {
  const tilesW = subSample(w, bits);
  for (let y = 0; y < h; y++) {
    const codeRow = (y >> bits) * tilesW;
    for (let x = 0; x < w; x++) {
      const c = codes[codeRow + (x >> bits)]!;
      const greenToRed = int8(c), greenToBlue = int8(c >> 8), redToBlue = int8(c >> 16);
      const i = y * w + x, p = d[i]!;
      const green = int8(p >> 8);
      const red = ((p >> 16) + ((greenToRed * green) >> 5)) & 255;
      const blue = ((p & 255) + ((greenToBlue * green) >> 5) + ((redToBlue * int8(red)) >> 5)) & 255;
      d[i] = (p & 0xff00ff00) | (red << 16) | blue;
    }
  }
}

function inverseSubtractGreen(d: Uint32Array) {
  for (let i = 0; i < d.length; i++) {
    const p = d[i]!, g = (p >> 8) & 255;
    d[i] = (p & 0xff00ff00) | ((((p >> 16) + g) & 255) << 16) | (((p & 255) + g) & 255);
  }
}

function inverseColorIndexing(d: Uint32Array, w: number, h: number, bits: number, palette: Uint32Array): Uint32Array {
  const out = new Uint32Array(w * h);
  const packedW = subSample(w, bits);
  const perByte = 1 << bits, bitsPer = 8 >> bits, valueMask = (1 << bitsPer) - 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const packed = (d[y * packedW + (x >> bits)]! >> 8) & 255;
      out[y * w + x] = palette[(packed >> ((x & (perByte - 1)) * bitsPer)) & valueMask]!;
    }
  }
  return out;
}

// ---- VP8 (lossy) ---------------------------------------------------------------------

/** VP8 boolean entropy decoder (RFC 6386, section 7), reading lazily like libwebp. */
class BoolDecoder {
  private value = 0;
  private count = -8; // bits loaded below the 8-bit window
  private range = 255;
  eof = false;
  constructor(private readonly d: Uint8Array, private pos: number, private readonly end: number) {
    this.load();
  }
  private load() {
    if (this.pos < this.end) this.value = (this.value << 8) | this.d[this.pos++]!;
    else {
      this.value <<= 8;
      this.eof = true;
    }
    this.count += 8;
  }
  bit(prob: number): number {
    if (this.count < 0) this.load();
    const split = 1 + (((this.range - 1) * prob) >> 8);
    const big = split << this.count;
    let bit: number;
    if (this.value >= big) {
      this.range -= split;
      this.value -= big;
      bit = 1;
    } else {
      this.range = split;
      bit = 0;
    }
    if (this.range < 128) {
      const s = Math.clz32(this.range) - 24;
      this.range <<= s;
      this.count -= s;
    }
    return bit;
  }
  literal(bits: number): number {
    let v = 0;
    while (bits-- > 0) v = (v << 1) | this.bit(128);
    return v;
  }
  signed(bits: number): number {
    const v = this.literal(bits);
    return this.bit(128) ? -v : v;
  }
}

// Default token probabilities, their update probabilities (RFC 6386 13.5 / 13.4) and the
// key-frame 4x4 mode probabilities indexed [top][left] (RFC 6386 11.5), in libwebp's mode order.
const b64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));
const COEFFS_PROBA0 = b64(
  "gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/Yj+/+TbgICAgIC9gfL/49X/24CAgGp+4/zW0f//gICAAWL4/+zi//+AgIC1he7+3er/moCAgE6GyvfGtP/bgICAAbn5//P/gICAgIC4lvf/7OCAgICAgE1u2P/s5oCAgICAAWX7//H/gICAgICqi/H87NH//4CAgCV0xPPk////gICAAcz+//X/gICAgIDPoPr/7oCAgICAgGZn5//Tq4CAgICAAZj8//D/gICAgICxh/P/6uGAgICAgFCB0//C4ICAgICAAQH/gICAgICAgID2Af+AgICAgICAgP+AgICAgICAgICAxiPt38G7oqCRmz6DLcbdrLDcnfzdAUQvktCVp92i/9+AAZXx/93g//+AgIC4jer93tz/x4CAgFFjtfKwvvnK//+AAYHo/dbF8sT//4BjedL6ycb/yoCAgBdbo/Kqu/fS//+AAcj2/+r/gICAgIBtsvH/5/X//4CAgCyCyf3NwP//gICAAYTv+9vR/6WAgIBeiOH72r7//4CAgBZkrvW6of/HgICAAbb5/+jrgICAgIB8j/H/4+qAgICAgCNNtfvB0//NgICAAZ33/+zn//+AgIB5jev/4eP//4CAgC1jvPvD2f/ggICAAQH7/9X/gICAgIDLAfj//4CAgICAgIkBsf/g/4CAgICA/Qn4+8/Q/8CAgICvDeDzwbn5xv//gEkRq92hs+yn/+qAAV/3/dS3//+AgIDvWvT609H//4CAgJtNw/i8w///gICAARjv+9rb/82AgIDJM9v/xLqAgICAgEUuvu/J2v/kgICAAb/7//+AgICAgIDfpfn/1f+AgICAgI18+P//gICAgICAARD4//+AgICAgIC+JOb/7P+AgICAgJUB/4CAgICAgICAAeL/gICAgICAgID3wP+AgICAgICAgPCA/4CAgICAgICAAYb8//+AgICAgIDVPvr//4CAgICAgDdd/4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAyhjV67q/3KDwr/9+Jrboqbjkrv+7gD0uituXsvCq/9iAAXDm+se/95///4CmbeT809f/roCAgCdNouistPWy//+AATTc9sbH+dz//4B8Sr/zt8H63f//gBhHgtuaqvO2//+AAbbh+dvw/+CAgICVluL82M3/q4CAgBxsqvK3wv7f//+AAVHm/MzL/8CAgIB7ZtH3vMT/6YCAgBRfmfOkrf/LgICAAd74/9jVgICAgICor/b8683//4CAgC901//T1P//gICAAXns/dTW//+AgICNVNX8ycr/24CAgCpQoPCiuf/NgICAAQH/gICAgICAgID0Af+AgICAgICAgO4B/4CAgICAgICA",
);
const COEFFS_UPDATE_PROBA = b64(
  "////////////////////////////////////////////sPb////////////f8fz///////////n9/f////////////T8///////////q/v7///////////3///////////////b+///////////v/f7///////////7//v////////////j+///////////7//7///////////////////////////3+///////////7/v7///////////7//v////////////79//7////////6//7//v////////7/////////////////////////////////////////////////////////2f/////////////h/PH9///+/////+r68fr9//3+//////7////////////f/v7//////////+79/v7///////////j+///////////5/v////////////////////////////3////////////3/v////////////////////////////3+///////////8//////////////////////////////7+///////////9//////////////////////////////79///////////6//////////////7/////////////////////////////////////////////////////////uvv6///////////q+/T+//////////v78/3+//7///////3+///////////s/f7///////////v9/f7+//////////7+///////////+/v7///////////////////////////7////////////+/v////////////7////////////////////////////+////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////+P/////////////6/vz+//////////j++f3///////////39///////////2/f3///////////z++/7+//////////78///////////4/v3///////////3//v7///////////v+///////////1+/7///////////39/v////////////v9///////////8/f7////////////+//////////////z////////////5//7//////////////v/////////////9///////////6///////////////////////////////////////////+////////////////////////////",
);
const BMODES_PROBA = b64(
  "53gwWXNxeJhwmLNAfqp2LkZfr0WPUFVSSJtnODoKq9q9EQ2YchoRoyzDFQqteRhQwxo+LEBVkEcKJqvVkCIaqi43E4igIc5HPxQIcnLQDAniUSgLYLZUHRAkhrdZiWJlaqWUSLtkgp1vIEtQQmanY0o+KOqAKTUJsvGNGghrSisakkmmMRedQSZpoDM0H3OAaE8MG9n/VxEHV0RHLHIzD7oXLykObra3FRHCQi0ZZsW9FxIWWFiTliouLcTNK2G3dVUmI7M9JzXIVxoVK+irOCIzaHJmHV1NJxxVqzqlWmJAIhZ0zhciK6ZJazYgGjMBUSsfRBlqFkCrJOFyIhMVZoS8EEx8PhJOX1U5MjAzwWUjn9dvWS5vPJQfrNvkFRJvcHFNVbP/JnhyKCoBxPXRChltWCsdjKbVJSuaPT8em0MtRAHRZFAIK5oBMxpHjk5OEP+AIsWrKSgFZtO3BAHdMzIRqNHAFxlSih8kqxumJizlQ1c6qVJzGjuzPztatDumXUmaKCgVdI/RIievLw8QtyLfMS23LhEhtwZiDyC3OS4WGIABNhElQSBJcxyAF4DNKAMJczPAEgbfVyUJcztNQBUvaDcs2gk2NYLiQFpGzSgpFxo5NjlwuAUpJqbVHiIahZh0CiCGJxM13RpyIEn/HwlB6gIPAXZJSyAMM8D/oCszWB8jQ2ZVN7pVOBUXbzvNLSXANyZGfElmASJifWIqWGhVda9SX1Q1WYBkcWUtS097LzOAUasBOREFR2Y5NSkxJiENeTlJGgFVKQpDik1uWi9ycxUCCmb/phcGZR0QClWAZcQaORIKZmbVIhQrdRQPJKOARAEaZj1HJSI1H/PARTxHJkl3HN4lRC2AIgEvC/WrPhETRpJVNz5GJSslmmSjVaABPwlciBxAIMlVSw8JCUD/uHcQVgYcBUD/GfgBOAgRhIn/N3SAOg8UUoc5GnkopDIfiZqFGSPaM2csg4N7HwaeVihAh5TgLbeAFhoRg/CaDgHRLRAVW0DeBwHFOBUnmzyKF2bVUwwNNsD/RC8cVRpVVYCAIJKrEgsHP5CrBAT2IxsKkq6rDBqAvlAjY7RQfjYtVX4vV7AzKRQgZUuAi3aSdIBVOCkPsOxVJQk+Rx4Rd3b/ERKKZSY8ijdGKxqOkiQTHqv/YRsUii09PtsBUbxAICkUdZeOFBWjcBMMPcOAMAQY",
);

// Quantizer step sizes (RFC 6386 14.1).
const DC_TABLE = [
  4, 5, 6, 7, 8, 9, 10, 10, 11, 12, 13, 14, 15, 16, 17, 17, 18, 19, 20, 20, 21, 21, 22, 22, 23, 23, 24, 25, 25, 26, 27, 28,
  29, 30, 31, 32, 33, 34, 35, 36, 37, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58,
  59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 93, 95, 96, 98, 100, 101, 102, 104, 106, 108, 110, 112, 114, 116, 118, 122, 124, 126, 128, 130, 132, 134, 136, 138, 140, 143, 145, 148, 151, 154, 157,
];
const AC_TABLE = [
  4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35,
  36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 60, 62, 64, 66, 68, 70, 72, 74, 76,
  78, 80, 82, 84, 86, 88, 90, 92, 94, 96, 98, 100, 102, 104, 106, 108, 110, 112, 114, 116, 119, 122, 125, 128, 131, 134, 137, 140, 143, 146, 149, 152,
  155, 158, 161, 164, 167, 170, 173, 177, 181, 185, 189, 193, 197, 201, 205, 209, 213, 217, 221, 225, 229, 234, 239, 245, 249, 254, 259, 264, 269, 274, 279, 284,
];

const ZIGZAG = [0, 1, 4, 8, 5, 2, 3, 6, 9, 12, 13, 10, 7, 11, 14, 15];
const BANDS = [0, 1, 2, 3, 6, 4, 5, 6, 6, 6, 6, 6, 6, 6, 6, 7, 0]; // + sentinel
const CAT3456 = [[173, 148, 140], [176, 155, 140, 135], [180, 157, 141, 134, 130], [254, 254, 243, 230, 196, 177, 153, 140, 133, 130, 129]];

const clip = (v: number, max: number) => (v < 0 ? 0 : v > max ? max : v);

interface Quant {
  y1dc: number; y1ac: number; y2dc: number; y2ac: number; uvdc: number; uvac: number;
}

/** Reads the next coefficients of one 4x4 block; returns the index after the last non-zero one. */
function getCoeffs(br: BoolDecoder, proba: Uint8Array, type: number, ctx: number, dc: number, ac: number, n: number, out: Int16Array, o: number): number {
  const base = type * 8 * 33;
  let p = base + BANDS[n]! * 33 + ctx * 11;
  for (; n < 16; n++) {
    if (!br.bit(proba[p]!)) return n; // end of block
    while (!br.bit(proba[p + 1]!)) {
      if (++n === 16) return 16;
      p = base + BANDS[n]! * 33; // zero run: context 0
    }
    let v: number;
    const next = base + BANDS[n + 1]! * 33;
    if (!br.bit(proba[p + 2]!)) {
      v = 1;
      p = next + 11;
    } else {
      v = largeValue(br, proba, p);
      p = next + 22;
    }
    out[o + ZIGZAG[n]!] = (br.bit(128) ? -v : v) * (n > 0 ? ac : dc);
  }
  return 16;
}

function largeValue(br: BoolDecoder, proba: Uint8Array, p: number): number {
  if (!br.bit(proba[p + 3]!)) {
    if (!br.bit(proba[p + 4]!)) return 2;
    return 3 + br.bit(proba[p + 5]!);
  }
  if (!br.bit(proba[p + 6]!)) {
    if (!br.bit(proba[p + 7]!)) return 5 + br.bit(159);
    return 7 + 2 * br.bit(165) + br.bit(145);
  }
  const bit1 = br.bit(proba[p + 8]!);
  const bit0 = br.bit(proba[p + 9 + bit1]!);
  const cat = 2 * bit1 + bit0;
  let v = 0;
  for (const prob of CAT3456[cat]!) v = v + v + br.bit(prob);
  return v + 3 + (8 << cat);
}

// Work buffer for one macroblock with its borders, laid out like libwebp's (stride BPS).
const BPS = 32;
const Y_OFF = BPS + 8;
const U_OFF = Y_OFF + BPS * 16 + BPS;
const V_OFF = U_OFF + 16;
const SCAN = Array.from({ length: 16 }, (_, n) => (n & 3) * 4 + (n >> 2) * 4 * BPS);

const avg3 = (a: number, b: number, c: number) => (a + 2 * b + c + 2) >> 2;
const avg2 = (a: number, b: number) => (a + b + 1) >> 1;
const clip8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

function fill(b: Uint8Array, d: number, size: number, v: number) {
  for (let y = 0; y < size; y++) b.fill(v, d + y * BPS, d + y * BPS + size);
}

function trueMotion(b: Uint8Array, d: number, size: number) {
  const top = d - BPS, tl = b[top - 1]!;
  for (let y = 0; y < size; y++) {
    const row = d + y * BPS, left = b[row - 1]! - tl;
    for (let x = 0; x < size; x++) b[row + x] = clip8(b[top + x]! + left);
  }
}

/** 16x16 luma (size 16) or 8x8 chroma (size 8) prediction; mode 4..6 = DC without top/left/both. */
function predictBlock(b: Uint8Array, d: number, size: number, mode: number) {
  const shift = size === 16 ? 4 : 3;
  let dc = 0;
  switch (mode) {
    case 0:
      for (let i = 0; i < size; i++) dc += b[d - 1 + i * BPS]! + b[d + i - BPS]!;
      return fill(b, d, size, (dc + size) >> (shift + 1));
    case 1: return trueMotion(b, d, size);
    case 2:
      for (let y = 0; y < size; y++) b.copyWithin(d + y * BPS, d - BPS, d - BPS + size);
      return;
    case 3:
      for (let y = 0; y < size; y++) b.fill(b[d + y * BPS - 1]!, d + y * BPS, d + y * BPS + size);
      return;
    case 4: // no top
      for (let i = 0; i < size; i++) dc += b[d - 1 + i * BPS]!;
      return fill(b, d, size, (dc + (size >> 1)) >> shift);
    case 5: // no left
      for (let i = 0; i < size; i++) dc += b[d + i - BPS]!;
      return fill(b, d, size, (dc + (size >> 1)) >> shift);
    default:
      return fill(b, d, size, 0x80);
  }
}

function predictLuma4(b: Uint8Array, d: number, mode: number) {
  const T = d - BPS;
  const set = (x: number, y: number, v: number) => (b[d + x + y * BPS] = v);
  switch (mode) {
    case 0: { // DC
      let dc = 4;
      for (let i = 0; i < 4; i++) dc += b[T + i]! + b[d - 1 + i * BPS]!;
      return fill(b, d, 4, dc >> 3);
    }
    case 1: return trueMotion(b, d, 4);
    case 2: { // VE: smoothed top row
      const v0 = avg3(b[T - 1]!, b[T]!, b[T + 1]!), v1 = avg3(b[T]!, b[T + 1]!, b[T + 2]!);
      const v2 = avg3(b[T + 1]!, b[T + 2]!, b[T + 3]!), v3 = avg3(b[T + 2]!, b[T + 3]!, b[T + 4]!);
      for (let y = 0; y < 4; y++) {
        set(0, y, v0); set(1, y, v1); set(2, y, v2); set(3, y, v3);
      }
      return;
    }
    case 3: { // HE: smoothed left column
      const A = b[d - 1 - BPS]!, B = b[d - 1]!, C = b[d - 1 + BPS]!, D = b[d - 1 + 2 * BPS]!, E = b[d - 1 + 3 * BPS]!;
      b.fill(avg3(A, B, C), d, d + 4);
      b.fill(avg3(B, C, D), d + BPS, d + BPS + 4);
      b.fill(avg3(C, D, E), d + 2 * BPS, d + 2 * BPS + 4);
      b.fill(avg3(D, E, E), d + 3 * BPS, d + 3 * BPS + 4);
      return;
    }
  }
  const I = b[d - 1]!, J = b[d - 1 + BPS]!, K = b[d - 1 + 2 * BPS]!, L = b[d - 1 + 3 * BPS]!, X = b[T - 1]!;
  const A = b[T]!, B = b[T + 1]!, C = b[T + 2]!, D = b[T + 3]!, E = b[T + 4]!, F = b[T + 5]!, G = b[T + 6]!, H = b[T + 7]!;
  switch (mode) {
    case 4: // RD: down-right
      set(0, 3, avg3(J, K, L));
      set(1, 3, avg3(I, J, K)); set(0, 2, avg3(I, J, K));
      set(2, 3, avg3(X, I, J)); set(1, 2, avg3(X, I, J)); set(0, 1, avg3(X, I, J));
      set(3, 3, avg3(A, X, I)); set(2, 2, avg3(A, X, I)); set(1, 1, avg3(A, X, I)); set(0, 0, avg3(A, X, I));
      set(3, 2, avg3(B, A, X)); set(2, 1, avg3(B, A, X)); set(1, 0, avg3(B, A, X));
      set(3, 1, avg3(C, B, A)); set(2, 0, avg3(C, B, A));
      set(3, 0, avg3(D, C, B));
      return;
    case 5: // VR: vertical-right
      set(0, 0, avg2(X, A)); set(1, 2, avg2(X, A));
      set(1, 0, avg2(A, B)); set(2, 2, avg2(A, B));
      set(2, 0, avg2(B, C)); set(3, 2, avg2(B, C));
      set(3, 0, avg2(C, D));
      set(0, 3, avg3(K, J, I));
      set(0, 2, avg3(J, I, X));
      set(0, 1, avg3(I, X, A)); set(1, 3, avg3(I, X, A));
      set(1, 1, avg3(X, A, B)); set(2, 3, avg3(X, A, B));
      set(2, 1, avg3(A, B, C)); set(3, 3, avg3(A, B, C));
      set(3, 1, avg3(B, C, D));
      return;
    case 6: // LD: down-left
      set(0, 0, avg3(A, B, C));
      set(1, 0, avg3(B, C, D)); set(0, 1, avg3(B, C, D));
      set(2, 0, avg3(C, D, E)); set(1, 1, avg3(C, D, E)); set(0, 2, avg3(C, D, E));
      set(3, 0, avg3(D, E, F)); set(2, 1, avg3(D, E, F)); set(1, 2, avg3(D, E, F)); set(0, 3, avg3(D, E, F));
      set(3, 1, avg3(E, F, G)); set(2, 2, avg3(E, F, G)); set(1, 3, avg3(E, F, G));
      set(3, 2, avg3(F, G, H)); set(2, 3, avg3(F, G, H));
      set(3, 3, avg3(G, H, H));
      return;
    case 7: // VL: vertical-left
      set(0, 0, avg2(A, B));
      set(1, 0, avg2(B, C)); set(0, 2, avg2(B, C));
      set(2, 0, avg2(C, D)); set(1, 2, avg2(C, D));
      set(3, 0, avg2(D, E)); set(2, 2, avg2(D, E));
      set(0, 1, avg3(A, B, C));
      set(1, 1, avg3(B, C, D)); set(0, 3, avg3(B, C, D));
      set(2, 1, avg3(C, D, E)); set(1, 3, avg3(C, D, E));
      set(3, 1, avg3(D, E, F)); set(2, 3, avg3(D, E, F));
      set(3, 2, avg3(E, F, G));
      set(3, 3, avg3(F, G, H));
      return;
    case 8: // HD: horizontal-down
      set(0, 0, avg2(I, X)); set(2, 1, avg2(I, X));
      set(0, 1, avg2(J, I)); set(2, 2, avg2(J, I));
      set(0, 2, avg2(K, J)); set(2, 3, avg2(K, J));
      set(0, 3, avg2(L, K));
      set(3, 0, avg3(A, B, C));
      set(2, 0, avg3(X, A, B));
      set(1, 0, avg3(I, X, A)); set(3, 1, avg3(I, X, A));
      set(1, 1, avg3(J, I, X)); set(3, 2, avg3(J, I, X));
      set(1, 2, avg3(K, J, I)); set(3, 3, avg3(K, J, I));
      set(1, 3, avg3(L, K, J));
      return;
    default: // 9, HU: horizontal-up
      set(0, 0, avg2(I, J));
      set(2, 0, avg2(J, K)); set(0, 1, avg2(J, K));
      set(2, 1, avg2(K, L)); set(0, 2, avg2(K, L));
      set(1, 0, avg3(I, J, K));
      set(3, 0, avg3(J, K, L)); set(1, 1, avg3(J, K, L));
      set(3, 1, avg3(K, L, L)); set(1, 2, avg3(K, L, L));
      set(3, 2, L); set(2, 2, L); set(0, 3, L); set(1, 3, L); set(2, 3, L); set(3, 3, L);
  }
}

const mul1 = (a: number) => ((a * 20091) >> 16) + a;
const mul2 = (a: number) => (a * 35468) >> 16;
const tmp = new Int32Array(16);

/** Inverse DCT of one 4x4 block, added to the prediction in `b` at `d`. */
function inverseTransform(c: Int16Array, o: number, b: Uint8Array, d: number) {
  let nonzero = false;
  for (let i = 1; i < 16; i++) if (c[o + i]) { nonzero = true; break; }
  if (!nonzero) {
    if (!c[o]) return;
    const v = (c[o]! + 4) >> 3; // DC only
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) b[d + x + y * BPS] = clip8(b[d + x + y * BPS]! + v);
    return;
  }
  for (let i = 0; i < 4; i++) { // vertical pass
    const a = c[o + i]! + c[o + 8 + i]!, bb = c[o + i]! - c[o + 8 + i]!;
    const cc = mul2(c[o + 4 + i]!) - mul1(c[o + 12 + i]!), dd = mul1(c[o + 4 + i]!) + mul2(c[o + 12 + i]!);
    tmp[i * 4] = a + dd;
    tmp[i * 4 + 1] = bb + cc;
    tmp[i * 4 + 2] = bb - cc;
    tmp[i * 4 + 3] = a - dd;
  }
  for (let i = 0; i < 4; i++) { // horizontal pass
    const dc = tmp[i]! + 4;
    const a = dc + tmp[8 + i]!, bb = dc - tmp[8 + i]!;
    const cc = mul2(tmp[4 + i]!) - mul1(tmp[12 + i]!), dd = mul1(tmp[4 + i]!) + mul2(tmp[12 + i]!);
    const row = d + i * BPS;
    b[row] = clip8(b[row]! + ((a + dd) >> 3));
    b[row + 1] = clip8(b[row + 1]! + ((bb + cc) >> 3));
    b[row + 2] = clip8(b[row + 2]! + ((bb - cc) >> 3));
    b[row + 3] = clip8(b[row + 3]! + ((a - dd) >> 3));
  }
}

/** Inverse Walsh-Hadamard transform of the luma DC block into each block's coefficient 0. */
function inverseWht(input: Int16Array, out: Int16Array) {
  for (let i = 0; i < 4; i++) {
    const a0 = input[i]! + input[12 + i]!, a1 = input[4 + i]! + input[8 + i]!;
    const a2 = input[4 + i]! - input[8 + i]!, a3 = input[i]! - input[12 + i]!;
    tmp[i] = a0 + a1;
    tmp[8 + i] = a0 - a1;
    tmp[4 + i] = a3 + a2;
    tmp[12 + i] = a3 - a2;
  }
  for (let i = 0; i < 4; i++) {
    const dc = tmp[i * 4]! + 3;
    const a0 = dc + tmp[i * 4 + 3]!, a1 = tmp[i * 4 + 1]! + tmp[i * 4 + 2]!;
    const a2 = tmp[i * 4 + 1]! - tmp[i * 4 + 2]!, a3 = dc - tmp[i * 4 + 3]!;
    out[i * 64] = (a0 + a1) >> 3;
    out[i * 64 + 16] = (a3 + a2) >> 3;
    out[i * 64 + 32] = (a0 - a1) >> 3;
    out[i * 64 + 48] = (a3 - a2) >> 3;
  }
}

// ---- loop filter (on the full planes, after reconstruction) ----

const sclip1 = (v: number) => (v < -128 ? -128 : v > 127 ? 127 : v);
const sclip2 = (v: number) => (v < -16 ? -16 : v > 15 ? 15 : v);

function filter2(P: Uint8Array, p: number, s: number) {
  const p1 = P[p - 2 * s]!, p0 = P[p - s]!, q0 = P[p]!, q1 = P[p + s]!;
  const a = 3 * (q0 - p0) + sclip1(p1 - q1);
  const a1 = sclip2((a + 4) >> 3), a2 = sclip2((a + 3) >> 3);
  P[p - s] = clip8(p0 + a2);
  P[p] = clip8(q0 - a1);
}
function filter4(P: Uint8Array, p: number, s: number) {
  const p1 = P[p - 2 * s]!, p0 = P[p - s]!, q0 = P[p]!, q1 = P[p + s]!;
  const a = 3 * (q0 - p0);
  const a1 = sclip2((a + 4) >> 3), a2 = sclip2((a + 3) >> 3), a3 = (a1 + 1) >> 1;
  P[p - 2 * s] = clip8(p1 + a3);
  P[p - s] = clip8(p0 + a2);
  P[p] = clip8(q0 - a1);
  P[p + s] = clip8(q1 - a3);
}
function filter6(P: Uint8Array, p: number, s: number) {
  const p2 = P[p - 3 * s]!, p1 = P[p - 2 * s]!, p0 = P[p - s]!, q0 = P[p]!, q1 = P[p + s]!, q2 = P[p + 2 * s]!;
  const a = sclip1(3 * (q0 - p0) + sclip1(p1 - q1));
  const a1 = (27 * a + 63) >> 7, a2 = (18 * a + 63) >> 7, a3 = (9 * a + 63) >> 7;
  P[p - 3 * s] = clip8(p2 + a3);
  P[p - 2 * s] = clip8(p1 + a2);
  P[p - s] = clip8(p0 + a1);
  P[p] = clip8(q0 - a1);
  P[p + s] = clip8(q1 - a2);
  P[p + 2 * s] = clip8(q2 - a3);
}
function hev(P: Uint8Array, p: number, s: number, t: number) {
  return Math.abs(P[p - 2 * s]! - P[p - s]!) > t || Math.abs(P[p + s]! - P[p]!) > t;
}
function needsFilter(P: Uint8Array, p: number, s: number, t: number) {
  return 4 * Math.abs(P[p - s]! - P[p]!) + Math.abs(P[p - 2 * s]! - P[p + s]!) <= t;
}
function needsFilter2(P: Uint8Array, p: number, s: number, t: number, it: number) {
  const p3 = P[p - 4 * s]!, p2 = P[p - 3 * s]!, p1 = P[p - 2 * s]!, p0 = P[p - s]!;
  const q0 = P[p]!, q1 = P[p + s]!, q2 = P[p + 2 * s]!, q3 = P[p + 3 * s]!;
  if (4 * Math.abs(p0 - q0) + Math.abs(p1 - q1) > t) return false;
  return Math.abs(p3 - p2) <= it && Math.abs(p2 - p1) <= it && Math.abs(p1 - p0) <= it &&
    Math.abs(q3 - q2) <= it && Math.abs(q2 - q1) <= it && Math.abs(q1 - q0) <= it;
}
/** Simple filter on a 16-pixel edge: `s` steps across the edge, `step` walks along it. */
function simpleEdge(P: Uint8Array, p: number, s: number, step: number, thresh: number) {
  const t = 2 * thresh + 1;
  for (let i = 0; i < 16; i++, p += step) if (needsFilter(P, p, s, t)) filter2(P, p, s);
}
function complexEdge(P: Uint8Array, p: number, s: number, step: number, size: number, thresh: number, ithresh: number, hevT: number, inner: boolean) {
  const t = 2 * thresh + 1;
  for (let i = 0; i < size; i++, p += step) {
    if (!needsFilter2(P, p, s, t, ithresh)) continue;
    if (hev(P, p, s, hevT)) filter2(P, p, s);
    else if (inner) filter4(P, p, s);
    else filter6(P, p, s);
  }
}

// ---- YUV -> RGB (libwebp's fixed point, 14-bit) ----

const mulHi = (v: number, c: number) => (v * c) >> 8;
const clipRgb = (v: number) => ((v & ~16383) === 0 ? v >> 6 : v < 0 ? 0 : 255);

function putRgb(out: Uint8Array, o: number, y: number, u: number, v: number) {
  const yy = mulHi(y, 19077);
  out[o] = clipRgb(yy + mulHi(v, 26149) - 14234);
  out[o + 1] = clipRgb(yy - mulHi(u, 6419) - mulHi(v, 13320) + 8708);
  out[o + 2] = clipRgb(yy + mulHi(u, 33050) - 17685);
  out[o + 3] = 255;
}

/**
 * libwebp's "fancy" upsampler: chroma interpolated 9-3-3-1 between the two nearest chroma
 * rows. Converts output row `top` (and `bottom` if >= 0) using chroma rows `tu` (above) and
 * `cu` (below); u and v travel packed in one number (16 bits each).
 */
function upsampleRows(
  Y: Uint8Array, U: Uint8Array, V: Uint8Array, yStride: number, uvStride: number,
  top: number, bottom: number, tu: number, cu: number, out: Uint8Array, width: number,
) {
  const ty = top * yStride, by = bottom * yStride, to = top * width * 4, bo = bottom * width * 4;
  const tuo = tu * uvStride, cuo = cu * uvStride;
  const last = (width - 1) >> 1;
  let tl = U[tuo]! | (V[tuo]! << 16);
  let l = U[cuo]! | (V[cuo]! << 16);
  let uv = (3 * tl + l + 0x00020002) >> 2;
  putRgb(out, to, Y[ty]!, uv & 0xff, uv >>> 16);
  if (bottom >= 0) {
    uv = (3 * l + tl + 0x00020002) >> 2;
    putRgb(out, bo, Y[by]!, uv & 0xff, uv >>> 16);
  }
  for (let x = 1; x <= last; x++) {
    const t = U[tuo + x]! | (V[tuo + x]! << 16);
    const c = U[cuo + x]! | (V[cuo + x]! << 16);
    const avg = tl + t + l + c + 0x00080008;
    const diag12 = (avg + 2 * (t + l)) >>> 3;
    const diag03 = (avg + 2 * (tl + c)) >>> 3;
    let uv0 = (diag12 + tl) >>> 1, uv1 = (diag03 + t) >>> 1;
    putRgb(out, to + (2 * x - 1) * 4, Y[ty + 2 * x - 1]!, uv0 & 0xff, uv0 >>> 16);
    putRgb(out, to + 2 * x * 4, Y[ty + 2 * x]!, uv1 & 0xff, uv1 >>> 16);
    if (bottom >= 0) {
      uv0 = (diag03 + l) >>> 1;
      uv1 = (diag12 + c) >>> 1;
      putRgb(out, bo + (2 * x - 1) * 4, Y[by + 2 * x - 1]!, uv0 & 0xff, uv0 >>> 16);
      putRgb(out, bo + 2 * x * 4, Y[by + 2 * x]!, uv1 & 0xff, uv1 >>> 16);
    }
    tl = t;
    l = c;
  }
  if (!(width & 1)) {
    uv = (3 * tl + l + 0x00020002) >> 2;
    putRgb(out, to + (width - 1) * 4, Y[ty + width - 1]!, uv & 0xff, uv >>> 16);
    if (bottom >= 0) {
      uv = (3 * l + tl + 0x00020002) >> 2;
      putRgb(out, bo + (width - 1) * 4, Y[by + width - 1]!, uv & 0xff, uv >>> 16);
    }
  }
}

function decodeVp8(d: Uint8Array): Bitmap {
  if (d.length < 10) throw new Error("truncated WebP lossy data");
  const tag = u24(d, 0);
  if (tag & 1) throw new Error("WebP lossy data is not a key frame");
  if (((tag >> 1) & 7) > 3) throw new Error("unsupported WebP lossy profile");
  if (!((tag >> 4) & 1)) throw new Error("WebP frame is not displayable");
  const partLen = tag >>> 5;
  if (d[3] !== 0x9d || d[4] !== 0x01 || d[5] !== 0x2a) throw new Error("invalid WebP lossy signature");
  const width = (d[6]! | (d[7]! << 8)) & 0x3fff;
  const height = (d[8]! | (d[9]! << 8)) & 0x3fff;
  if (!width || !height) throw new Error("invalid WebP size");
  if (10 + partLen > d.length) throw new Error("truncated WebP lossy data");
  const mbW = (width + 15) >> 4, mbH = (height + 15) >> 4;

  // ---- frame header (first partition) ----
  const br = new BoolDecoder(d, 10, 10 + partLen);
  br.bit(128); // color space
  br.bit(128); // clamping type: decoders always clamp
  const useSegment = br.bit(128);
  let updateMap = 0, absoluteDelta = 1;
  const segQuant = [0, 0, 0, 0], segFilter = [0, 0, 0, 0], segProba = [255, 255, 255];
  if (useSegment) {
    updateMap = br.bit(128);
    if (br.bit(128)) {
      absoluteDelta = br.bit(128);
      for (let s = 0; s < 4; s++) segQuant[s] = br.bit(128) ? br.signed(7) : 0;
      for (let s = 0; s < 4; s++) segFilter[s] = br.bit(128) ? br.signed(6) : 0;
    }
    if (updateMap) for (let s = 0; s < 3; s++) segProba[s] = br.bit(128) ? br.literal(8) : 255;
  }
  const simple = br.bit(128);
  const level = br.literal(6);
  const sharpness = br.literal(3);
  const refDelta = [0, 0, 0, 0], modeDelta = [0, 0, 0, 0];
  const useDelta = br.bit(128);
  if (useDelta && br.bit(128)) {
    for (let i = 0; i < 4; i++) if (br.bit(128)) refDelta[i] = br.signed(6);
    for (let i = 0; i < 4; i++) if (br.bit(128)) modeDelta[i] = br.signed(6);
  }
  const filterType = level === 0 ? 0 : simple ? 1 : 2;

  // Token partitions follow the first one, prefixed by their 3-byte sizes (except the last).
  const numParts = 1 << br.literal(2);
  let at = 10 + partLen + 3 * (numParts - 1);
  if (at > d.length) throw new Error("truncated WebP lossy data");
  const parts: BoolDecoder[] = [];
  for (let p = 0; p < numParts; p++) {
    let size = p < numParts - 1 ? u24(d, 10 + partLen + 3 * p) : d.length - at;
    if (size > d.length - at) size = d.length - at;
    parts.push(new BoolDecoder(d, at, at + size));
    at += size;
  }

  // Dequantization per segment.
  const base = br.literal(7);
  const dqY1dc = br.bit(128) ? br.signed(4) : 0;
  const dqY2dc = br.bit(128) ? br.signed(4) : 0;
  const dqY2ac = br.bit(128) ? br.signed(4) : 0;
  const dqUVdc = br.bit(128) ? br.signed(4) : 0;
  const dqUVac = br.bit(128) ? br.signed(4) : 0;
  const quant: Quant[] = [];
  for (let s = 0; s < 4; s++) {
    const q = useSegment ? segQuant[s]! + (absoluteDelta ? 0 : base) : base;
    quant.push({
      y1dc: DC_TABLE[clip(q + dqY1dc, 127)]!,
      y1ac: AC_TABLE[clip(q, 127)]!,
      y2dc: DC_TABLE[clip(q + dqY2dc, 127)]! * 2,
      y2ac: Math.max(8, (AC_TABLE[clip(q + dqY2ac, 127)]! * 101581) >> 16), // x * 155 / 100
      uvdc: DC_TABLE[clip(q + dqUVdc, 117)]!,
      uvac: AC_TABLE[clip(q + dqUVac, 127)]!,
    });
  }

  br.bit(128); // refresh entropy probabilities: irrelevant for a single frame
  const proba = new Uint8Array(COEFFS_PROBA0);
  for (let i = 0; i < proba.length; i++) if (br.bit(COEFFS_UPDATE_PROBA[i]!)) proba[i] = br.literal(8);
  const useSkip = br.bit(128);
  const skipProba = useSkip ? br.literal(8) : 0;
  if (br.eof) throw new Error("truncated WebP lossy header");

  // Filter strength per segment and per "is 4x4" (RFC 6386 15.1, as libwebp computes it).
  const strengths: { limit: number; ilevel: number; hev: number }[] = [];
  for (let s = 0; s < 4; s++) {
    for (let i4 = 0; i4 <= 1; i4++) {
      let lvl = useSegment ? segFilter[s]! + (absoluteDelta ? 0 : level) : level;
      if (useDelta) lvl += refDelta[0]! + (i4 ? modeDelta[0]! : 0);
      lvl = clip(lvl, 63);
      let ilevel = lvl;
      if (sharpness > 0) {
        ilevel >>= sharpness > 4 ? 2 : 1;
        if (ilevel > 9 - sharpness) ilevel = 9 - sharpness;
      }
      if (ilevel < 1) ilevel = 1;
      strengths.push(lvl > 0 ? { limit: 2 * lvl + ilevel, ilevel, hev: lvl >= 40 ? 2 : lvl >= 15 ? 1 : 0 } : { limit: 0, ilevel: 0, hev: 0 });
    }
  }

  // ---- macroblocks ----
  const yStride = mbW * 16, uvStride = mbW * 8;
  const Y = new Uint8Array(yStride * mbH * 16);
  const U = new Uint8Array(uvStride * mbH * 8);
  const V = new Uint8Array(uvStride * mbH * 8);
  const mbFilter = new Int32Array(mbW * mbH); // strength index * 2 + inner, -1 when none
  const topY = new Uint8Array(yStride), topU = new Uint8Array(uvStride), topV = new Uint8Array(uvStride);
  const intraTop = new Uint8Array(mbW * 4); // 4x4 modes along the bottom of the row above
  const intraLeft = new Uint8Array(4);
  const nzTopY = new Uint8Array(mbW * 4), nzTopU = new Uint8Array(mbW * 2), nzTopV = new Uint8Array(mbW * 2), nzTopDc = new Uint8Array(mbW);
  const nzLeftY = new Uint8Array(4), nzLeftU = new Uint8Array(2), nzLeftV = new Uint8Array(2);
  let nzLeftDc = 0;
  const work = new Uint8Array(BPS * 17 + BPS * 9);
  const coeffs = new Int16Array(384);
  const dcCoeffs = new Int16Array(16);
  const modes = new Uint8Array(16);
  const segments = new Uint8Array(mbW), is4x4 = new Uint8Array(mbW), uvModes = new Uint8Array(mbW), skips = new Uint8Array(mbW);
  const rowModes = new Uint8Array(mbW * 16);

  for (let mbY = 0; mbY < mbH; mbY++) {
    // Modes of the whole row come first, from the first partition.
    intraLeft.fill(0);
    for (let mbX = 0; mbX < mbW; mbX++) {
      segments[mbX] = updateMap ? (!br.bit(segProba[0]!) ? br.bit(segProba[1]!) : 2 + br.bit(segProba[2]!)) : 0;
      skips[mbX] = useSkip ? br.bit(skipProba) : 0;
      const i4 = !br.bit(145);
      is4x4[mbX] = i4 ? 1 : 0;
      const m = rowModes.subarray(mbX * 16, mbX * 16 + 16);
      if (!i4) {
        const ymode = br.bit(156) ? (br.bit(128) ? 1 : 3) : br.bit(163) ? 2 : 0; // TM, H, V, DC
        m[0] = ymode;
        intraTop.fill(ymode, mbX * 4, mbX * 4 + 4);
        intraLeft.fill(ymode);
      } else {
        for (let y = 0; y < 4; y++) {
          let ymode = intraLeft[y]!;
          for (let x = 0; x < 4; x++) {
            const p = (intraTop[mbX * 4 + x]! * 10 + ymode) * 9;
            const P = BMODES_PROBA;
            ymode = !br.bit(P[p]!) ? 0
              : !br.bit(P[p + 1]!) ? 1
              : !br.bit(P[p + 2]!) ? 2
              : !br.bit(P[p + 3]!)
                ? (!br.bit(P[p + 4]!) ? 3 : !br.bit(P[p + 5]!) ? 4 : 5)
                : !br.bit(P[p + 6]!) ? 6
                : !br.bit(P[p + 7]!) ? 7
                : !br.bit(P[p + 8]!) ? 8 : 9;
            intraTop[mbX * 4 + x] = ymode;
            m[y * 4 + x] = ymode;
          }
          intraLeft[y] = ymode;
        }
      }
      uvModes[mbX] = !br.bit(142) ? 0 : !br.bit(114) ? 2 : br.bit(183) ? 1 : 3;
    }
    if (br.eof) throw new Error("truncated WebP lossy data");

    const tokens = parts[mbY & (numParts - 1)]!;
    nzLeftY.fill(0); nzLeftU.fill(0); nzLeftV.fill(0);
    nzLeftDc = 0;
    // Left border of the work buffer: 129, top-left corner: 129 below the first row, 127 on it.
    for (let j = 0; j < 16; j++) work[Y_OFF + j * BPS - 1] = 129;
    for (let j = 0; j < 8; j++) work[U_OFF + j * BPS - 1] = work[V_OFF + j * BPS - 1] = 129;
    if (mbY > 0) work[Y_OFF - BPS - 1] = work[U_OFF - BPS - 1] = work[V_OFF - BPS - 1] = 129;
    else {
      work.fill(127, Y_OFF - BPS - 1, Y_OFF - BPS + 20);
      work.fill(127, U_OFF - BPS - 1, U_OFF - BPS + 8);
      work.fill(127, V_OFF - BPS - 1, V_OFF - BPS + 8);
    }

    for (let mbX = 0; mbX < mbW; mbX++) {
      const q = quant[segments[mbX]!]!;
      const i4 = is4x4[mbX] === 1;

      // ---- residuals ----
      coeffs.fill(0);
      let nonZero = 0;
      if (!skips[mbX]) {
        let first = 0, type = 3;
        if (!i4) {
          dcCoeffs.fill(0);
          const nz = getCoeffs(tokens, proba, 1, nzTopDc[mbX]! + nzLeftDc, q.y2dc, q.y2ac, 0, dcCoeffs, 0);
          nzTopDc[mbX] = nzLeftDc = nz > 0 ? 1 : 0;
          if (nz > 1) inverseWht(dcCoeffs, coeffs);
          else {
            const dc0 = (dcCoeffs[0]! + 3) >> 3;
            for (let i = 0; i < 256; i += 16) coeffs[i] = dc0;
          }
          first = 1;
          type = 0;
        }
        for (let y = 0; y < 4; y++) {
          let l = nzLeftY[y]!;
          for (let x = 0; x < 4; x++) {
            const o = (y * 4 + x) * 16;
            const nz = getCoeffs(tokens, proba, type, l + nzTopY[mbX * 4 + x]!, q.y1dc, q.y1ac, first, coeffs, o);
            l = nz > first ? 1 : 0;
            nzTopY[mbX * 4 + x] = l;
            nonZero |= nz > 1 || coeffs[o] !== 0 ? 1 : 0;
          }
          nzLeftY[y] = l;
        }
        for (let ch = 0; ch < 2; ch++) {
          const top = ch ? nzTopV : nzTopU, left = ch ? nzLeftV : nzLeftU;
          for (let y = 0; y < 2; y++) {
            let l = left[y]!;
            for (let x = 0; x < 2; x++) {
              const o = 256 + ch * 64 + (y * 2 + x) * 16;
              const nz = getCoeffs(tokens, proba, 2, l + top[mbX * 2 + x]!, q.uvdc, q.uvac, 0, coeffs, o);
              l = nz > 0 ? 1 : 0;
              top[mbX * 2 + x] = l;
              nonZero |= nz > 1 || coeffs[o] !== 0 ? 1 : 0;
            }
            left[y] = l;
          }
        }
      } else {
        nzTopY.fill(0, mbX * 4, mbX * 4 + 4); nzLeftY.fill(0);
        nzTopU.fill(0, mbX * 2, mbX * 2 + 2); nzLeftU.fill(0);
        nzTopV.fill(0, mbX * 2, mbX * 2 + 2); nzLeftV.fill(0);
        if (!i4) nzTopDc[mbX] = nzLeftDc = 0;
      }
      if (tokens.eof) throw new Error("truncated WebP lossy data");
      if (filterType) {
        const f = segments[mbX]! * 2 + (i4 ? 1 : 0);
        mbFilter[mbY * mbW + mbX] = strengths[f]!.limit ? f * 2 + (i4 || nonZero ? 1 : 0) : -1;
      }

      // ---- prediction + inverse transforms in the work buffer ----
      if (mbX > 0) {
        for (let j = -1; j < 16; j++) work.copyWithin(Y_OFF + j * BPS - 4, Y_OFF + j * BPS + 12, Y_OFF + j * BPS + 16);
        for (let j = -1; j < 8; j++) {
          work.copyWithin(U_OFF + j * BPS - 4, U_OFF + j * BPS + 4, U_OFF + j * BPS + 8);
          work.copyWithin(V_OFF + j * BPS - 4, V_OFF + j * BPS + 4, V_OFF + j * BPS + 8);
        }
      }
      if (mbY > 0) {
        work.set(topY.subarray(mbX * 16, mbX * 16 + 16), Y_OFF - BPS);
        work.set(topU.subarray(mbX * 8, mbX * 8 + 8), U_OFF - BPS);
        work.set(topV.subarray(mbX * 8, mbX * 8 + 8), V_OFF - BPS);
      }
      modes.set(rowModes.subarray(mbX * 16, mbX * 16 + 16));
      if (i4) {
        // Pixels above-right of the macroblock serve every 4x4 block on its right column.
        const tr = Y_OFF - BPS + 16;
        if (mbY > 0) {
          if (mbX >= mbW - 1) work.fill(topY[mbX * 16 + 15]!, tr, tr + 4);
          else work.set(topY.subarray(mbX * 16 + 16, mbX * 16 + 20), tr);
        }
        for (let k = 1; k <= 3; k++) work.copyWithin(tr + k * 4 * BPS, tr, tr + 4);
        for (let n = 0; n < 16; n++) {
          const dst = Y_OFF + SCAN[n]!;
          predictLuma4(work, dst, modes[n]!);
          inverseTransform(coeffs, n * 16, work, dst);
        }
      } else {
        let mode = modes[0]!;
        if (mode === 0) mode = mbX === 0 ? (mbY === 0 ? 6 : 5) : mbY === 0 ? 4 : 0;
        predictBlock(work, Y_OFF, 16, mode);
        for (let n = 0; n < 16; n++) inverseTransform(coeffs, n * 16, work, Y_OFF + SCAN[n]!);
      }
      let uvMode = uvModes[mbX]!;
      if (uvMode === 0) uvMode = mbX === 0 ? (mbY === 0 ? 6 : 5) : mbY === 0 ? 4 : 0;
      predictBlock(work, U_OFF, 8, uvMode);
      predictBlock(work, V_OFF, 8, uvMode);
      for (let n = 0; n < 4; n++) {
        const at4 = (n & 1) * 4 + (n >> 1) * 4 * BPS;
        inverseTransform(coeffs, 256 + n * 16, work, U_OFF + at4);
        inverseTransform(coeffs, 320 + n * 16, work, V_OFF + at4);
      }

      // Unfiltered bottom rows feed the prediction of the next macroblock row.
      if (mbY < mbH - 1) {
        topY.set(work.subarray(Y_OFF + 15 * BPS, Y_OFF + 15 * BPS + 16), mbX * 16);
        topU.set(work.subarray(U_OFF + 7 * BPS, U_OFF + 7 * BPS + 8), mbX * 8);
        topV.set(work.subarray(V_OFF + 7 * BPS, V_OFF + 7 * BPS + 8), mbX * 8);
      }
      for (let j = 0; j < 16; j++) Y.set(work.subarray(Y_OFF + j * BPS, Y_OFF + j * BPS + 16), (mbY * 16 + j) * yStride + mbX * 16);
      for (let j = 0; j < 8; j++) {
        U.set(work.subarray(U_OFF + j * BPS, U_OFF + j * BPS + 8), (mbY * 8 + j) * uvStride + mbX * 8);
        V.set(work.subarray(V_OFF + j * BPS, V_OFF + j * BPS + 8), (mbY * 8 + j) * uvStride + mbX * 8);
      }
    }
  }

  // ---- loop filter, in macroblock order ----
  if (filterType) {
    for (let mbY = 0; mbY < mbH; mbY++) {
      for (let mbX = 0; mbX < mbW; mbX++) {
        const f = mbFilter[mbY * mbW + mbX]!;
        if (f < 0) continue;
        const { limit, ilevel, hev: hevT } = strengths[f >> 1]!;
        const inner = (f & 1) === 1;
        const y0 = mbY * 16 * yStride + mbX * 16;
        if (filterType === 1) {
          if (mbX > 0) simpleEdge(Y, y0, 1, yStride, limit + 4);
          if (inner) for (let k = 4; k < 16; k += 4) simpleEdge(Y, y0 + k, 1, yStride, limit);
          if (mbY > 0) simpleEdge(Y, y0, yStride, 1, limit + 4);
          if (inner) for (let k = 4; k < 16; k += 4) simpleEdge(Y, y0 + k * yStride, yStride, 1, limit);
          continue;
        }
        const c0 = mbY * 8 * uvStride + mbX * 8;
        if (mbX > 0) {
          complexEdge(Y, y0, 1, yStride, 16, limit + 4, ilevel, hevT, false);
          complexEdge(U, c0, 1, uvStride, 8, limit + 4, ilevel, hevT, false);
          complexEdge(V, c0, 1, uvStride, 8, limit + 4, ilevel, hevT, false);
        }
        if (inner) {
          for (let k = 4; k < 16; k += 4) complexEdge(Y, y0 + k, 1, yStride, 16, limit, ilevel, hevT, true);
          complexEdge(U, c0 + 4, 1, uvStride, 8, limit, ilevel, hevT, true);
          complexEdge(V, c0 + 4, 1, uvStride, 8, limit, ilevel, hevT, true);
        }
        if (mbY > 0) {
          complexEdge(Y, y0, yStride, 1, 16, limit + 4, ilevel, hevT, false);
          complexEdge(U, c0, uvStride, 1, 8, limit + 4, ilevel, hevT, false);
          complexEdge(V, c0, uvStride, 1, 8, limit + 4, ilevel, hevT, false);
        }
        if (inner) {
          for (let k = 4; k < 16; k += 4) complexEdge(Y, y0 + k * yStride, yStride, 1, 16, limit, ilevel, hevT, true);
          complexEdge(U, c0 + 4 * uvStride, uvStride, 1, 8, limit, ilevel, hevT, true);
          complexEdge(V, c0 + 4 * uvStride, uvStride, 1, 8, limit, ilevel, hevT, true);
        }
      }
    }
  }

  // ---- YUV 4:2:0 -> RGBA ----
  const out = new Uint8Array(width * height * 4);
  upsampleRows(Y, U, V, yStride, uvStride, 0, -1, 0, 0, out, width);
  for (let y = 1; y + 1 < height; y += 2) upsampleRows(Y, U, V, yStride, uvStride, y, y + 1, (y - 1) >> 1, (y + 1) >> 1, out, width);
  if (!(height & 1)) {
    const c = (height >> 1) - 1;
    upsampleRows(Y, U, V, yStride, uvStride, height - 1, -1, c, c, out, width);
  }
  return { width, height, data: out };
}
