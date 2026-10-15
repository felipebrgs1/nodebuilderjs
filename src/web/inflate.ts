// DEFLATE decoder (RFC 1950/1951) for where node:zlib does not exist (the browser build's
// `inflateSync`). Huffman codes are decoded through a lookup table of FAST_BITS bits, falling
// back to the canonical walk for longer codes.

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
const FAST_BITS = 9;

interface Huffman {
  counts: Uint16Array; // codes per length
  symbols: Uint16Array; // by code
  /** By the next FAST_BITS bits (LSB first): symbol << 4 | length, 0 when the code is longer. */
  fast: Uint16Array;
}

const fail = (why: string): never => {
  throw new Error(`invalid deflate data: ${why}`);
};

function huffman(lengths: ArrayLike<number>): Huffman {
  const counts = new Uint16Array(16);
  for (let i = 0; i < lengths.length; i++) counts[lengths[i]!]++;
  counts[0] = 0;
  const offsets = new Uint16Array(16);
  for (let len = 1; len < 15; len++) offsets[len + 1] = offsets[len]! + counts[len]!;
  const symbols = new Uint16Array(lengths.length);
  for (let i = 0; i < lengths.length; i++) if (lengths[i]) symbols[offsets[lengths[i]!]!++] = i;
  // Canonical codes, MSB first; the table is indexed by the reversed (stream order) bits.
  const fast = new Uint16Array(1 << FAST_BITS);
  let code = 0, index = 0;
  for (let len = 1; len <= FAST_BITS; len++) {
    for (let k = 0; k < counts[len]!; k++, code++, index++) {
      let rev = 0;
      for (let b = 0; b < len; b++) rev |= ((code >> b) & 1) << (len - 1 - b);
      for (let fill = rev; fill < 1 << FAST_BITS; fill += 1 << len) fast[fill] = (symbols[index]! << 4) | len;
    }
    code <<= 1;
  }
  return { counts, symbols, fast };
}

const FIXED_LIT = huffman(Array.from({ length: 288 }, (_, i) => (i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8)));
const FIXED_DIST = huffman(new Array(30).fill(5));

/** Decodes a zlib stream (`raw`: a bare deflate stream). Throws "invalid deflate data: ..." on bad input. */
export function inflate(input: Uint8Array, options: { raw?: boolean } = {}): Uint8Array {
  let pos = 0;
  if (!options.raw) {
    if (input.length < 2 || (input[0]! & 0x0f) !== 8 || ((input[0]! << 8) | input[1]!) % 31 !== 0) throw new Error("invalid zlib header");
    if (input[1]! & 0x20) throw new Error("zlib preset dictionaries are not supported");
    pos = 2;
  }
  let bitBuf = 0, bitCount = 0;
  let out = new Uint8Array(Math.max(1024, input.length * 4));
  let o = 0;

  const need = (n: number) => {
    while (bitCount < n) {
      if (pos >= input.length) fail("unexpected end of stream");
      bitBuf |= input[pos++]! << bitCount;
      bitCount += 8;
    }
  };
  const bits = (n: number) => {
    need(n);
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCount -= n;
    return v;
  };
  const room = (n: number) => {
    if (o + n <= out.length) return;
    const grown = new Uint8Array(Math.max(out.length * 2, o + n));
    grown.set(out.subarray(0, o));
    out = grown;
  };
  const decode = (h: Huffman) => {
    // Peek without failing at the end: a short code may be the stream's last bits.
    while (bitCount < FAST_BITS && pos < input.length) {
      bitBuf |= input[pos++]! << bitCount;
      bitCount += 8;
    }
    const entry = h.fast[bitBuf & ((1 << FAST_BITS) - 1)]!;
    if (entry && (entry & 15) <= bitCount) {
      bitBuf >>>= entry & 15;
      bitCount -= entry & 15;
      return entry >> 4;
    }
    let code = 0, first = 0, index = 0;
    for (let len = 1; len <= 15; len++) {
      code |= bits(1);
      const count = h.counts[len]!;
      if (code - count < first) return h.symbols[index + (code - first)]!;
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    return fail("bad Huffman code");
  };

  let last = 0;
  while (!last) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = bitCount = 0; // stored: byte aligned
      if (pos + 4 > input.length) fail("unexpected end of stream");
      const len = input[pos]! | (input[pos + 1]! << 8);
      if ((len ^ (input[pos + 2]! | (input[pos + 3]! << 8))) !== 0xffff) fail("stored block length");
      pos += 4;
      if (pos + len > input.length) fail("unexpected end of stream");
      room(len);
      out.set(input.subarray(pos, pos + len), o);
      o += len;
      pos += len;
      continue;
    }
    let lit = FIXED_LIT, dist = FIXED_DIST;
    if (type === 2) {
      const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
      const clen = new Uint8Array(19);
      for (let i = 0; i < ncode; i++) clen[CL_ORDER[i]!] = bits(3);
      const cl = huffman(clen);
      const lengths = new Uint8Array(nlen + ndist);
      for (let i = 0; i < nlen + ndist; ) {
        const sym = decode(cl);
        if (sym < 16) lengths[i++] = sym;
        else {
          const [repeat, value] = sym === 16 ? [3 + bits(2), i ? lengths[i - 1]! : fail("repeat with no length")] : sym === 17 ? [3 + bits(3), 0] : [11 + bits(7), 0];
          if (i + repeat > lengths.length) fail("too many code lengths");
          lengths.fill(value, i, i + repeat);
          i += repeat;
        }
      }
      if (!lengths[256]) fail("no end-of-block code");
      lit = huffman(lengths.subarray(0, nlen));
      dist = huffman(lengths.subarray(nlen));
    } else if (type === 3) fail("reserved block type");

    for (;;) {
      const sym = decode(lit);
      if (sym < 256) {
        room(1);
        out[o++] = sym;
      } else if (sym === 256) break;
      else {
        const l = sym - 257;
        if (l >= 29) fail("bad length code");
        const len = LEN_BASE[l]! + bits(LEN_EXTRA[l]!);
        const d = decode(dist);
        if (d >= 30) fail("bad distance code");
        const back = DIST_BASE[d]! + bits(DIST_EXTRA[d]!);
        if (back > o) fail("distance too far back");
        room(len);
        for (let k = 0; k < len; k++, o++) out[o] = out[o - back]!;
      }
    }
  }
  return out.slice(0, o);
}
