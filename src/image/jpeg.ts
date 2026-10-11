// JPEG decoder (baseline and progressive, Huffman coded, 8-bit). It reproduces
// libjpeg-turbo's default output: the accurate integer IDCT (jidctint.c), "fancy"
// chroma upsampling (jdsample.c) and the fixed-point YCbCr tables (jdcolor.c), so a
// decoded image matches what djpeg, browsers on Linux and ImageMagick produce.
// The EXIF orientation is applied, like browsers do. Arithmetic coding, lossless and
// 12-bit JPEGs are rare and rejected.

import type { Bitmap } from "./png.js";

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

const ZIGZAG = new Uint8Array([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21,
  28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61,
  54, 47, 55, 62, 63,
]);

interface Huffman {
  /** Fast path: 9-bit lookahead -> (length << 8) | value, 0 when the code is longer. */
  lookup: Uint16Array;
  maxcode: Int32Array; // per length 1..16 (index 17 = sentinel)
  valptr: Int32Array;
  mincode: Int32Array;
  values: Uint8Array;
}

interface Component {
  id: number;
  h: number;
  v: number;
  tq: number;
  /** Size of this component's plane in samples (before upsampling). */
  width: number;
  height: number;
  blocksPerLine: number; // blocks with data in non-interleaved scans
  blocksPerColumn: number;
  stride: number; // allocated blocks per line (whole MCUs)
  coeffs: Int16Array;
  dc: Huffman | null;
  ac: Huffman | null;
  pred: number;
}

const LOOKAHEAD = 9;

function buildHuffman(counts: Uint8Array, values: Uint8Array): Huffman {
  const maxcode = new Int32Array(18).fill(-1);
  const valptr = new Int32Array(17);
  const mincode = new Int32Array(17);
  const lookup = new Uint16Array(1 << LOOKAHEAD);
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    valptr[len] = k;
    mincode[len] = code;
    const n = counts[len - 1]!;
    for (let i = 0; i < n; i++, k++, code++) {
      if (len <= LOOKAHEAD) {
        const shift = LOOKAHEAD - len;
        const base = code << shift;
        for (let j = 0; j < 1 << shift; j++) lookup[base | j] = (len << 8) | values[k]!;
      }
    }
    maxcode[len] = n ? code - 1 : -1;
    code <<= 1;
  }
  maxcode[17] = 0x7fffffff;
  return { lookup, maxcode, valptr, mincode, values };
}

/** Reads entropy-coded bits; stops (feeding zeros) at a marker, which it leaves unread. */
class BitReader {
  bits = 0;
  count = 0;
  hitMarker = false;
  constructor(public data: Uint8Array, public pos: number) {}

  private fill() {
    while (this.count <= 24) {
      let byte = 0;
      if (!this.hitMarker && this.pos < this.data.length) {
        byte = this.data[this.pos]!;
        if (byte === 0xff) {
          const next = this.data[this.pos + 1];
          if (next === 0x00) this.pos += 2;
          else {
            this.hitMarker = true;
            byte = 0;
          }
        } else this.pos++;
      }
      this.bits = ((this.bits << 8) | byte) >>> 0;
      this.count += 8;
    }
  }

  peek(n: number): number {
    if (this.count < n) this.fill();
    return (this.bits >>> (this.count - n)) & ((1 << n) - 1);
  }

  skip(n: number) {
    this.count -= n;
  }

  bit(): number {
    if (this.count < 1) this.fill();
    this.count--;
    return (this.bits >>> this.count) & 1;
  }

  receive(n: number): number {
    if (n === 0) return 0;
    if (this.count < n) this.fill();
    this.count -= n;
    return (this.bits >>> this.count) & ((1 << n) - 1);
  }

  decode(t: Huffman): number {
    const look = t.lookup[this.peek(LOOKAHEAD)]!;
    if (look) {
      this.count -= look >> 8;
      return look & 255;
    }
    let code = this.receive(LOOKAHEAD);
    let len = LOOKAHEAD;
    while (code > t.maxcode[len]!) {
      code = (code << 1) | this.bit();
      if (++len > 16) throw new Error("corrupt JPEG data (bad Huffman code)");
    }
    return t.values[t.valptr[len]! + code - t.mincode[len]!]!;
  }

  /** Aligns to the next marker (after a scan or before a restart). */
  reset() {
    this.bits = 0;
    this.count = 0;
    this.hitMarker = false;
    const d = this.data;
    while (this.pos < d.length - 1 && !(d[this.pos] === 0xff && d[this.pos + 1] !== 0 && d[this.pos + 1] !== 0xff)) this.pos++;
  }
}

const extend = (v: number, s: number) => (v < 1 << (s - 1) ? v - (1 << s) + 1 : v);

export function decodeJpeg(bytes: Uint8Array): Bitmap {
  if (!isJpeg(bytes)) throw new Error("not a JPEG file");
  const qt: Uint16Array[] = [];
  const dcTables: Huffman[] = [];
  const acTables: Huffman[] = [];
  let frame: { width: number; height: number; progressive: boolean; hmax: number; vmax: number; mcusPerLine: number; mcusPerColumn: number; components: Component[] } | null = null;
  let restartInterval = 0;
  let adobeTransform = -1;
  let jfif = false;
  let orientation = 1;
  let eobrun = 0;

  const u16 = (p: number) => (bytes[p]! << 8) | bytes[p + 1]!;
  let pos = 2;
  for (;;) {
    // Markers may be padded with any number of 0xff bytes.
    while (pos < bytes.length && bytes[pos] !== 0xff) pos++;
    while (pos < bytes.length && bytes[pos] === 0xff) pos++;
    if (pos >= bytes.length) {
      if (frame) break; // missing EOI: decode what we have, like libjpeg
      throw new Error("truncated JPEG");
    }
    const marker = bytes[pos++]!;
    if (marker === 0xd9) break; // EOI
    if (marker >= 0xd0 && marker <= 0xd7) continue; // stray RST
    if (pos + 2 > bytes.length) throw new Error("truncated JPEG");
    const length = u16(pos);
    const seg = pos + 2;
    const end = pos + length;
    if (end > bytes.length) throw new Error("truncated JPEG");

    switch (marker) {
      case 0xdb: { // DQT
        for (let p = seg; p < end; ) {
          const pq = bytes[p]! >> 4, tq = bytes[p]! & 15;
          p++;
          const table = new Uint16Array(64);
          for (let i = 0; i < 64; i++) table[ZIGZAG[i]!] = pq ? u16(p + i * 2) : bytes[p + i]!;
          p += pq ? 128 : 64;
          qt[tq] = table;
        }
        break;
      }
      case 0xc4: { // DHT
        for (let p = seg; p < end; ) {
          const tc = bytes[p]! >> 4, th = bytes[p]! & 15;
          const counts = bytes.subarray(p + 1, p + 17);
          const total = counts.reduce((a, b) => a + b, 0);
          const values = bytes.slice(p + 17, p + 17 + total);
          (tc === 0 ? dcTables : acTables)[th] = buildHuffman(counts, values);
          p += 17 + total;
        }
        break;
      }
      case 0xc0: case 0xc1: case 0xc2: { // SOF0/1/2
        if (bytes[seg] !== 8) throw new Error(`unsupported JPEG precision (${bytes[seg]} bits)`);
        const height = u16(seg + 1), width = u16(seg + 3), n = bytes[seg + 5]!;
        if (!width || !height) throw new Error("JPEG without a size (DNL) is not supported");
        // Larger than any GPU texture; also stops a corrupt header from allocating gigabytes.
        if (width * height > 1 << 28) throw new Error(`JPEG too large (${width}x${height})`);
        const comps: Component[] = [];
        for (let i = 0; i < n; i++) {
          const p = seg + 6 + i * 3;
          comps.push({
            id: bytes[p]!, h: bytes[p + 1]! >> 4 || 1, v: bytes[p + 1]! & 15 || 1, tq: bytes[p + 2]!,
            width: 0, height: 0, blocksPerLine: 0, blocksPerColumn: 0, stride: 0, coeffs: new Int16Array(0), dc: null, ac: null, pred: 0,
          });
        }
        if (!n || comps.some((c) => c.h > 4 || c.v > 4)) throw new Error("invalid JPEG frame header");
        const hmax = Math.max(...comps.map((c) => c.h)), vmax = Math.max(...comps.map((c) => c.v));
        const mcusPerLine = Math.ceil(width / (8 * hmax)), mcusPerColumn = Math.ceil(height / (8 * vmax));
        for (const c of comps) {
          c.width = Math.ceil((width * c.h) / hmax);
          c.height = Math.ceil((height * c.v) / vmax);
          c.blocksPerLine = Math.ceil(c.width / 8);
          c.blocksPerColumn = Math.ceil(c.height / 8);
          c.stride = mcusPerLine * c.h;
          c.coeffs = new Int16Array(c.stride * mcusPerColumn * c.v * 64);
        }
        frame = { width, height, progressive: marker === 0xc2, hmax, vmax, mcusPerLine, mcusPerColumn, components: comps };
        break;
      }
      case 0xc3: case 0xc5: case 0xc6: case 0xc7: case 0xc9: case 0xca: case 0xcb: case 0xcd: case 0xce: case 0xcf:
        throw new Error("unsupported JPEG (lossless, hierarchical or arithmetic coding)");
      case 0xdd: // DRI
        restartInterval = u16(seg);
        break;
      case 0xe0: // APP0: JFIF
        if (bytes[seg] === 0x4a && bytes[seg + 1] === 0x46 && bytes[seg + 2] === 0x49 && bytes[seg + 3] === 0x46) jfif = true;
        break;
      case 0xe1: // APP1: EXIF orientation
        if (String.fromCharCode(...bytes.subarray(seg, seg + 4)) === "Exif") orientation = exifOrientation(bytes, seg + 6, end) ?? orientation;
        break;
      case 0xee: // APP14: Adobe color transform
        if (String.fromCharCode(...bytes.subarray(seg, seg + 5)) === "Adobe") adobeTransform = bytes[seg + 11]!;
        break;
      case 0xda: { // SOS
        if (!frame) throw new Error("JPEG scan before frame header");
        const n = bytes[seg]!;
        const comps: Component[] = [];
        for (let i = 0; i < n; i++) {
          const id = bytes[seg + 1 + i * 2]!, tables = bytes[seg + 2 + i * 2]!;
          const c = frame.components.find((x) => x.id === id);
          if (!c) throw new Error("JPEG scan references an unknown component");
          c.dc = dcTables[tables >> 4] ?? null;
          c.ac = acTables[tables & 15] ?? null;
          comps.push(c);
        }
        const p = seg + 1 + n * 2;
        const ss = bytes[p]!, se = bytes[p + 1]!, ah = bytes[p + 2]! >> 4, al = bytes[p + 2]! & 15;
        const reader = new BitReader(bytes, end);
        decodeScan(frame, comps, reader, restartInterval, frame.progressive, ss, se, ah, al);
        pos = reader.pos;
        continue;
      }
    }
    pos = end;
  }
  if (!frame) throw new Error("JPEG without a frame");

  // ---- scans -> pixels ----------------------------------------------------------
  function decodeScan(f: NonNullable<typeof frame>, comps: Component[], r: BitReader, interval: number, progressive: boolean, ss: number, se: number, ah: number, al: number) {
    for (const c of comps) {
      c.pred = 0;
      // Baseline needs both tables; progressive DC scans only DC, AC scans only AC.
      if ((!progressive || (ss === 0 && ah === 0)) && !c.dc) throw new Error("JPEG Huffman table missing");
      if ((!progressive || ss > 0) && !c.ac) throw new Error("JPEG Huffman table missing");
    }
    eobrun = 0;
    const decodeBlock = !progressive
      ? baseline
      : ss === 0
        ? ah === 0 ? dcFirst : dcRefine
        : ah === 0 ? acFirst : acRefine;

    function baseline(c: Component, o: number) {
      const coef = c.coeffs;
      const t = r.decode(c.dc!);
      c.pred += t ? extend(r.receive(t), t) : 0;
      coef[o] = c.pred;
      const ac = c.ac!;
      for (let k = 1; k < 64; ) {
        const rs = r.decode(ac);
        const s = rs & 15, run = rs >> 4;
        if (!s) {
          if (run < 15) break;
          k += 16;
          continue;
        }
        k += run;
        if (k > 63) break;
        coef[o + ZIGZAG[k]!] = extend(r.receive(s), s);
        k++;
      }
    }
    function dcFirst(c: Component, o: number) {
      const t = r.decode(c.dc!);
      c.pred += t ? extend(r.receive(t), t) : 0;
      c.coeffs[o] = c.pred * (1 << al);
    }
    function dcRefine(c: Component, o: number) {
      if (r.bit()) c.coeffs[o]! |= 1 << al;
    }
    function acFirst(c: Component, o: number) {
      if (eobrun > 0) {
        eobrun--;
        return;
      }
      const coef = c.coeffs, ac = c.ac!;
      for (let k = ss; k <= se; ) {
        const rs = r.decode(ac);
        const s = rs & 15, run = rs >> 4;
        if (!s) {
          if (run < 15) {
            eobrun = (1 << run) - 1;
            if (run) eobrun += r.receive(run);
            break;
          }
          k += 16;
          continue;
        }
        k += run;
        if (k > 63) break;
        coef[o + ZIGZAG[k]!] = extend(r.receive(s), s) * (1 << al);
        k++;
      }
    }
    function acRefine(c: Component, o: number) {
      // Mirrors libjpeg's decode_mcu_AC_refine.
      const coef = c.coeffs, ac = c.ac!;
      const p1 = 1 << al, m1 = -1 << al;
      let k = ss;
      if (eobrun === 0) {
        for (; k <= se; k++) {
          const rs = r.decode(ac);
          let run = rs >> 4;
          let s = rs & 15;
          if (s) s = r.bit() ? p1 : m1;
          else if (run !== 15) {
            eobrun = 1 << run;
            if (run) eobrun += r.receive(run);
            break;
          }
          while (k <= se) {
            const z = o + ZIGZAG[k]!;
            if (coef[z] !== 0) {
              if (r.bit() && (coef[z]! & p1) === 0) coef[z] += coef[z]! >= 0 ? p1 : m1;
            } else if (--run < 0) break;
            k++;
          }
          if (s && k <= se) coef[o + ZIGZAG[k]!] = s;
        }
      }
      if (eobrun > 0) {
        for (; k <= se; k++) {
          const z = o + ZIGZAG[k]!;
          if (coef[z] !== 0 && r.bit() && (coef[z]! & p1) === 0) coef[z] += coef[z]! >= 0 ? p1 : m1;
        }
        eobrun--;
      }
    }

    const single = comps.length === 1;
    const total = single ? comps[0]!.blocksPerLine * comps[0]!.blocksPerColumn : f.mcusPerLine * f.mcusPerColumn;
    for (let m = 0; m < total; m++) {
      if (interval && m > 0 && m % interval === 0) {
        r.reset(); // expects RSTn here
        if (r.data[r.pos] === 0xff && (r.data[r.pos + 1]! & 0xf8) === 0xd0) r.pos += 2;
        for (const c of comps) c.pred = 0;
        eobrun = 0;
      }
      if (single) {
        const c = comps[0]!;
        const row = Math.floor(m / c.blocksPerLine), col = m % c.blocksPerLine;
        decodeBlock(c, (row * c.stride + col) * 64);
      } else {
        const mrow = Math.floor(m / f.mcusPerLine), mcol = m % f.mcusPerLine;
        for (const c of comps) {
          for (let v = 0; v < c.v; v++) {
            for (let h = 0; h < c.h; h++) decodeBlock(c, (((mrow * c.v + v) * c.stride) + mcol * c.h + h) * 64);
          }
        }
      }
    }
    r.reset();
  }

  const { width, height, components } = frame;
  const planes = components.map((c) => {
    const q = qt[c.tq];
    if (!q) throw new Error("JPEG quantization table missing");
    return { plane: idctPlane(c, q), c };
  });

  // Upsample every component to full size (libjpeg-turbo's fancy filters).
  const full = planes.map(({ plane, c }) => upsample(plane, c, frame!.hmax / c.h, frame!.vmax / c.v, width, height));

  const out = new Uint8Array(width * height * 4);
  const n = width * height;
  if (components.length === 1) {
    const y = full[0]!;
    for (let i = 0; i < n; i++) {
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = y[i]!;
      out[i * 4 + 3] = 255;
    }
  } else if (components.length === 3) {
    // RGB when Adobe says "no transform", or (without JFIF) the component ids spell R, G, B.
    const ids = components.map((c) => c.id);
    const rgb = adobeTransform === 0 || (!jfif && adobeTransform < 0 && ids[0] === 82 && ids[1] === 71 && ids[2] === 66);
    const [a, b, c] = full as [Uint8Array, Uint8Array, Uint8Array];
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      if (rgb) {
        out[o] = a[i]!; out[o + 1] = b[i]!; out[o + 2] = c[i]!;
      } else {
        const y = a[i]!, cb = b[i]!, cr = c[i]!;
        out[o] = clamp255(y + CR_R[cr]!);
        out[o + 1] = clamp255(y + ((CB_G[cb]! + CR_G[cr]!) >> 16));
        out[o + 2] = clamp255(y + CB_B[cb]!);
      }
      out[o + 3] = 255;
    }
  } else if (components.length === 4) {
    // Adobe stores CMYK inverted (255 = no ink); YCCK is YCbCr-coded CMY plus K.
    const ycck = adobeTransform === 2;
    const [a, b, c, k] = full as [Uint8Array, Uint8Array, Uint8Array, Uint8Array];
    const inverted = adobeTransform >= 0;
    for (let i = 0; i < n; i++) {
      let cc = a[i]!, mm = b[i]!, yy = c[i]!;
      if (ycck) {
        const y = cc, cb = mm, cr = yy;
        cc = 255 - clamp255(y + CR_R[cr]!);
        mm = 255 - clamp255(y + ((CB_G[cb]! + CR_G[cr]!) >> 16));
        yy = 255 - clamp255(y + CB_B[cb]!);
      }
      let kk = k[i]!;
      if (!inverted) {
        cc = 255 - cc; mm = 255 - mm; yy = 255 - yy; kk = 255 - kk;
      }
      const o = i * 4;
      out[o] = Math.round((cc * kk) / 255);
      out[o + 1] = Math.round((mm * kk) / 255);
      out[o + 2] = Math.round((yy * kk) / 255);
      out[o + 3] = 255;
    }
  } else throw new Error(`unsupported JPEG with ${components.length} components`);

  return orient({ width, height, data: out }, orientation);
}

// ---- color tables (jdcolor.c, 16-bit fixed point) -------------------------------

const CR_R = new Int32Array(256), CB_B = new Int32Array(256), CR_G = new Int32Array(256), CB_G = new Int32Array(256);
for (let i = 0; i < 256; i++) {
  const x = i - 128;
  CR_R[i] = (91881 * x + 32768) >> 16;
  CB_B[i] = (116130 * x + 32768) >> 16;
  CR_G[i] = -46802 * x;
  CB_G[i] = -22554 * x + 32768;
}
const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

// ---- IDCT (jidctint.c, "islow") ---------------------------------------------------

const CONST_BITS = 13, PASS1_BITS = 2;
const F_0_298 = 2446, F_0_390 = 3196, F_0_541 = 4433, F_0_765 = 6270, F_0_899 = 7373, F_1_175 = 9633;
const F_1_501 = 12299, F_1_847 = 15137, F_1_961 = 16069, F_2_053 = 16819, F_2_562 = 20995, F_3_072 = 25172;

function idctPlane(c: Component, q: Uint16Array): Uint8Array {
  const lineW = c.stride * 8;
  const rows = c.coeffs.length / 64 / c.stride;
  const plane = new Uint8Array(lineW * rows * 8);
  const ws = new Int32Array(64);
  const coef = c.coeffs;
  for (let br = 0; br < rows; br++) {
    for (let bc = 0; bc < c.stride; bc++) {
      const o = (br * c.stride + bc) * 64;
      // Pass 1: columns, dequantizing.
      for (let col = 0; col < 8; col++) {
        const i = o + col;
        if (!coef[i + 8] && !coef[i + 16] && !coef[i + 24] && !coef[i + 32] && !coef[i + 40] && !coef[i + 48] && !coef[i + 56]) {
          const dc = (coef[i]! * q[col]!) << PASS1_BITS;
          for (let r = 0; r < 64; r += 8) ws[col + r] = dc;
          continue;
        }
        let z2 = coef[i + 16]! * q[col + 16]!, z3 = coef[i + 48]! * q[col + 48]!;
        let z1 = (z2 + z3) * F_0_541;
        let tmp2 = z1 - z3 * F_1_847;
        let tmp3 = z1 + z2 * F_0_765;
        z2 = coef[i]! * q[col]!;
        z3 = coef[i + 32]! * q[col + 32]!;
        let tmp0 = (z2 + z3) << CONST_BITS;
        let tmp1 = (z2 - z3) << CONST_BITS;
        const tmp10 = tmp0 + tmp3, tmp13 = tmp0 - tmp3, tmp11 = tmp1 + tmp2, tmp12 = tmp1 - tmp2;
        tmp0 = coef[i + 56]! * q[col + 56]!;
        tmp1 = coef[i + 40]! * q[col + 40]!;
        tmp2 = coef[i + 24]! * q[col + 24]!;
        tmp3 = coef[i + 8]! * q[col + 8]!;
        z1 = tmp0 + tmp3;
        z2 = tmp1 + tmp2;
        z3 = tmp0 + tmp2;
        let z4 = tmp1 + tmp3;
        const z5 = (z3 + z4) * F_1_175;
        tmp0 *= F_0_298; tmp1 *= F_2_053; tmp2 *= F_3_072; tmp3 *= F_1_501;
        z1 *= -F_0_899; z2 *= -F_2_562; z3 *= -F_1_961; z4 *= -F_0_390;
        z3 += z5; z4 += z5;
        tmp0 += z1 + z3; tmp1 += z2 + z4; tmp2 += z2 + z3; tmp3 += z1 + z4;
        const sh = CONST_BITS - PASS1_BITS, round = 1 << (sh - 1);
        ws[col] = (tmp10 + tmp3 + round) >> sh;
        ws[col + 56] = (tmp10 - tmp3 + round) >> sh;
        ws[col + 8] = (tmp11 + tmp2 + round) >> sh;
        ws[col + 48] = (tmp11 - tmp2 + round) >> sh;
        ws[col + 16] = (tmp12 + tmp1 + round) >> sh;
        ws[col + 40] = (tmp12 - tmp1 + round) >> sh;
        ws[col + 24] = (tmp13 + tmp0 + round) >> sh;
        ws[col + 32] = (tmp13 - tmp0 + round) >> sh;
      }
      // Pass 2: rows, then +128 and clamp.
      const sh = CONST_BITS + PASS1_BITS + 3, round = 1 << (sh - 1);
      for (let row = 0; row < 8; row++) {
        const w = row * 8;
        const out = (br * 8 + row) * lineW + bc * 8;
        if (!ws[w + 1] && !ws[w + 2] && !ws[w + 3] && !ws[w + 4] && !ws[w + 5] && !ws[w + 6] && !ws[w + 7]) {
          const v = clamp255(((ws[w]! + 16) >> 5) + 128);
          plane.fill(v, out, out + 8);
          continue;
        }
        let z2 = ws[w + 2]!, z3 = ws[w + 6]!;
        let z1 = (z2 + z3) * F_0_541;
        let tmp2 = z1 - z3 * F_1_847;
        let tmp3 = z1 + z2 * F_0_765;
        let tmp0 = (ws[w]! + ws[w + 4]!) << CONST_BITS;
        let tmp1 = (ws[w]! - ws[w + 4]!) << CONST_BITS;
        const tmp10 = tmp0 + tmp3, tmp13 = tmp0 - tmp3, tmp11 = tmp1 + tmp2, tmp12 = tmp1 - tmp2;
        tmp0 = ws[w + 7]!; tmp1 = ws[w + 5]!; tmp2 = ws[w + 3]!; tmp3 = ws[w + 1]!;
        z1 = tmp0 + tmp3; z2 = tmp1 + tmp2; z3 = tmp0 + tmp2;
        let z4 = tmp1 + tmp3;
        const z5 = (z3 + z4) * F_1_175;
        tmp0 *= F_0_298; tmp1 *= F_2_053; tmp2 *= F_3_072; tmp3 *= F_1_501;
        z1 *= -F_0_899; z2 *= -F_2_562; z3 *= -F_1_961; z4 *= -F_0_390;
        z3 += z5; z4 += z5;
        tmp0 += z1 + z3; tmp1 += z2 + z4; tmp2 += z2 + z3; tmp3 += z1 + z4;
        plane[out] = clamp255(((tmp10 + tmp3 + round) >> sh) + 128);
        plane[out + 7] = clamp255(((tmp10 - tmp3 + round) >> sh) + 128);
        plane[out + 1] = clamp255(((tmp11 + tmp2 + round) >> sh) + 128);
        plane[out + 6] = clamp255(((tmp11 - tmp2 + round) >> sh) + 128);
        plane[out + 2] = clamp255(((tmp12 + tmp1 + round) >> sh) + 128);
        plane[out + 5] = clamp255(((tmp12 - tmp1 + round) >> sh) + 128);
        plane[out + 3] = clamp255(((tmp13 + tmp0 + round) >> sh) + 128);
        plane[out + 4] = clamp255(((tmp13 - tmp0 + round) >> sh) + 128);
      }
    }
  }
  return plane;
}

// ---- upsampling (jdsample.c) --------------------------------------------------------

/** Returns a width*height plane. Edge rows/columns are replicated, as libjpeg does. */
function upsample(plane: Uint8Array, c: Component, sx: number, sy: number, width: number, height: number): Uint8Array {
  const lineW = c.stride * 8;
  const cw = c.width, ch = c.height;
  const row = (y: number) => Math.min(Math.max(y, 0), ch - 1) * lineW;
  const out = new Uint8Array(width * height);
  if (sx === 1 && sy === 1) {
    for (let y = 0; y < height; y++) out.set(plane.subarray(y * lineW, y * lineW + width), y * width);
    return out;
  }
  // libjpeg-turbo only uses the fancy 2x horizontal filters when there are more than 2 samples.
  if (sx === 2 && (sy === 1 || sy === 2) && cw > 2) {
    const tmp = new Uint8Array(cw * 2);
    for (let y = 0; y < height; y++) {
      const src = Math.floor(y / sy);
      const p0 = row(src);
      let line: Uint8Array;
      if (sy === 1) {
        line = h2v1(plane, p0, cw, tmp);
      } else {
        // h2v2: blend with the row above (even output rows) or below (odd), 3:1, then horizontally.
        const p1 = row(y % 2 === 0 ? src - 1 : src + 1);
        line = h2v2(plane, p0, p1, cw, tmp);
      }
      out.set(line.subarray(0, width), y * width);
    }
    return out;
  }
  if (sx === 1 && sy === 2) {
    for (let y = 0; y < height; y++) {
      const src = y >> 1;
      const p0 = row(src), p1 = row(y % 2 === 0 ? src - 1 : src + 1);
      const bias = y % 2 === 0 ? 1 : 2;
      for (let x = 0; x < width; x++) out[y * width + x] = (plane[p0 + x]! * 3 + plane[p1 + x]! + bias) >> 2;
    }
    return out;
  }
  // Other factors: plain replication (libjpeg's int_upsample).
  for (let y = 0; y < height; y++) {
    const p = row(Math.floor(y / sy));
    for (let x = 0; x < width; x++) out[y * width + x] = plane[p + Math.min(Math.floor(x / sx), cw - 1)]!;
  }
  return out;
}

function h2v1(plane: Uint8Array, p: number, n: number, out: Uint8Array): Uint8Array {
  if (n === 1) {
    out[0] = out[1] = plane[p]!;
    return out;
  }
  out[0] = plane[p]!;
  out[1] = (plane[p]! * 3 + plane[p + 1]! + 2) >> 2;
  for (let i = 1; i < n - 1; i++) {
    const v = plane[p + i]! * 3;
    out[2 * i] = (v + plane[p + i - 1]! + 1) >> 2;
    out[2 * i + 1] = (v + plane[p + i + 1]! + 2) >> 2;
  }
  out[2 * n - 2] = (plane[p + n - 1]! * 3 + plane[p + n - 2]! + 1) >> 2;
  out[2 * n - 1] = plane[p + n - 1]!;
  return out;
}

function h2v2(plane: Uint8Array, p0: number, p1: number, n: number, out: Uint8Array): Uint8Array {
  let thiscol = plane[p0]! * 3 + plane[p1]!;
  if (n === 1) {
    out[0] = out[1] = (thiscol * 4 + 8) >> 4;
    return out;
  }
  let nextcol = plane[p0 + 1]! * 3 + plane[p1 + 1]!;
  out[0] = (thiscol * 4 + 8) >> 4;
  out[1] = (thiscol * 3 + nextcol + 7) >> 4;
  let lastcol = thiscol;
  thiscol = nextcol;
  for (let i = 1; i < n - 1; i++) {
    nextcol = plane[p0 + i + 1]! * 3 + plane[p1 + i + 1]!;
    out[2 * i] = (thiscol * 3 + lastcol + 8) >> 4;
    out[2 * i + 1] = (thiscol * 3 + nextcol + 7) >> 4;
    lastcol = thiscol;
    thiscol = nextcol;
  }
  out[2 * n - 2] = (thiscol * 3 + lastcol + 8) >> 4;
  out[2 * n - 1] = (thiscol * 4 + 7) >> 4;
  return out;
}

// ---- EXIF orientation -----------------------------------------------------------------

function exifOrientation(b: Uint8Array, tiff: number, end: number): number | null {
  if (tiff + 8 > end) return null;
  const le = b[tiff] === 0x49; // "II" little endian, "MM" big endian
  const u16 = (p: number) => (le ? b[p]! | (b[p + 1]! << 8) : (b[p]! << 8) | b[p + 1]!);
  const u32 = (p: number) => (le ? (u16(p) | (u16(p + 2) << 16)) >>> 0 : ((u16(p) << 16) | u16(p + 2)) >>> 0);
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return null;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > end) break;
    if (u16(e) === 0x0112) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : null;
    }
  }
  return null;
}

/** Applies EXIF orientation 2..8 (mirror and/or rotation). */
function orient(img: Bitmap, o: number): Bitmap {
  if (o <= 1) return img;
  const { width: w, height: h, data } = img;
  const swap = o >= 5;
  const W = swap ? h : w, H = swap ? w : h;
  const out = new Uint8Array(data.length);
  const src = new Uint32Array(data.buffer, data.byteOffset, w * h);
  const dst = new Uint32Array(out.buffer);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sx: number, sy: number;
      switch (o) {
        case 2: sx = w - 1 - x; sy = y; break;
        case 3: sx = w - 1 - x; sy = h - 1 - y; break;
        case 4: sx = x; sy = h - 1 - y; break;
        case 5: sx = y; sy = x; break;
        case 6: sx = y; sy = h - 1 - x; break;
        case 7: sx = w - 1 - y; sy = h - 1 - x; break;
        default: sx = w - 1 - y; sy = x; break; // 8
      }
      dst[y * W + x] = src[sy * w + sx]!;
    }
  }
  return { width: W, height: H, data: out };
}
