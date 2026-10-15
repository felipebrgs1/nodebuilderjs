import { describe, expect, test } from "bun:test";
import { deflateRawSync, deflateSync } from "node:zlib";
import { inflate } from "../../src/web/inflate.js";

// Deterministic bytes that compress somewhat (runs, repeats, noise).
function sample(n: number, seed = 1) {
  const out = new Uint8Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    out[i] = i % 97 < 40 ? (i >> 3) & 0xff : (s >>> 24) % 16;
  }
  return out;
}

describe("inflate (zlib streams, as PNG stores them)", () => {
  test("matches node:zlib at every level, including stored and fixed Huffman blocks", () => {
    const data = sample(200_000);
    for (const level of [0, 1, 6, 9]) expect(inflate(deflateSync(data, { level }))).toEqual(data);
    expect(inflate(deflateSync(data, { strategy: 4 /* Z_FIXED */ }))).toEqual(data);
  });

  test("empty and tiny inputs", () => {
    expect(inflate(deflateSync(new Uint8Array(0)))).toEqual(new Uint8Array(0));
    expect(inflate(deflateSync(new Uint8Array([7])))).toEqual(new Uint8Array([7]));
  });

  test("raw deflate without the zlib header", () => {
    const data = sample(5000, 7);
    expect(inflate(deflateRawSync(data), { raw: true })).toEqual(data);
  });

  test("corrupt and truncated streams throw a deflate error", () => {
    const z = deflateSync(sample(5000));
    expect(() => inflate(z.subarray(0, z.length >> 1))).toThrow(/deflate/);
    expect(() => inflate(new Uint8Array([0x78, 0x9c, 0xff, 0xff, 0xff]))).toThrow(/deflate/);
    expect(() => inflate(new Uint8Array([0x12, 0x34]))).toThrow(/zlib header/);
  });
});
