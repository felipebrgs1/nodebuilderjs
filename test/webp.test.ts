import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { decodeWebp, isWebp } from "../src/image/webp.js";

// Fixtures were encoded by libwebp (ImageMagick, or a small C program using libwebp's
// low_memory mode, which is needed for several token partitions and skipped macroblocks),
// except webp-crafted-* (a minimal VP8L writer forcing every predictor mode, all four
// transforms and an unbundled palette), webp-alpha-filter* (the raw ALPH plane of
// webp-lossy-alpha re-filtered) and webp-anim-offset (a frame placed inside a larger canvas).
// Expected pixels are libwebp's own decode (`magick x.webp -depth 8 rgba:-`), as SHA-256.
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const expected: Record<string, { width: number; height: number; sha256: string }> = JSON.parse(
  new TextDecoder().decode(fixture("webp-expected.json")),
);
const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

test.each(Object.keys(expected))("WebP decoder matches libwebp: %s", (name) => {
  const image = decodeWebp(fixture(name));
  const want = expected[name]!;
  expect([image.width, image.height]).toEqual([want.width, want.height]);
  expect(sha256(image.data)).toBe(want.sha256);
});

test("lossless WebP gives back the source pixels", () => {
  const source = fixture("webp-source.raw"); // 37x23 RGBA
  for (const name of ["webp-lossless.webp", "webp-crafted-transforms.webp"]) {
    expect(Buffer.compare(decodeWebp(fixture(name)).data, source)).toBe(0);
  }
});

test("animated WebP: the first frame, placed on a transparent canvas", () => {
  const source = fixture("webp-source.raw");
  const image = decodeWebp(fixture("webp-anim-offset.webp")); // 37x23 frame at (6, 4) on 51x35
  expect([image.width, image.height]).toEqual([51, 35]);
  for (let y = 0; y < 35; y++) {
    for (let x = 0; x < 51; x++) {
      const px = Array.from(image.data.subarray((y * 51 + x) * 4, (y * 51 + x) * 4 + 4));
      const inside = x >= 6 && x < 43 && y >= 4 && y < 27;
      const src = inside ? Array.from(source.subarray(((y - 4) * 37 + x - 6) * 4, ((y - 4) * 37 + x - 6) * 4 + 4)) : [0, 0, 0, 0];
      if (px.join() !== src.join()) throw new Error(`pixel ${x},${y}: ${px} != ${src}`);
    }
  }
});

test("isWebp checks the RIFF/WEBP signature", () => {
  expect(isWebp(fixture("webp-lossy.webp"))).toBe(true);
  expect(isWebp(fixture("rgba8.png"))).toBe(false);
  expect(isWebp(new TextEncoder().encode("RIFF\0\0\0\0WAVEfmt "))).toBe(false);
});

/** Replaces the first chunk's payload, fixing the chunk and RIFF sizes. */
function withPayload(file: Uint8Array, edit: (payload: Uint8Array) => Uint8Array): Uint8Array {
  const size = new DataView(file.buffer, file.byteOffset).getUint32(16, true);
  const payload = edit(file.slice(20, 20 + size));
  const out = new Uint8Array(20 + payload.length + (payload.length & 1));
  out.set(file.subarray(0, 20));
  out.set(payload, 20);
  const view = new DataView(out.buffer);
  view.setUint32(16, payload.length, true);
  view.setUint32(4, out.length - 8, true);
  return out;
}

test("malformed WebP files throw clear errors", () => {
  const lossy = fixture("webp-lossy.webp");
  const lossless = fixture("webp-lossless-meta.webp");
  expect(() => decodeWebp(new Uint8Array([1, 2, 3]))).toThrow("not a WebP file");
  expect(() => decodeWebp(lossy.subarray(0, lossy.length - 40))).toThrow("truncated WebP");
  expect(() => decodeWebp(withPayload(lossy, (p) => p.subarray(0, p.length - 60)))).toThrow("truncated WebP lossy data");
  expect(() => decodeWebp(withPayload(lossy, (p) => (p[0]! |= 1, p)))).toThrow("not a key frame");
  expect(() => decodeWebp(withPayload(lossy, (p) => (p[3] = 0, p)))).toThrow("invalid WebP lossy signature");
  expect(() => decodeWebp(withPayload(lossless, (p) => p.subarray(0, p.length >> 1)))).toThrow(/WebP/);
  expect(() => decodeWebp(withPayload(lossless, (p) => (p[0] = 0x2e, p)))).toThrow("invalid WebP lossless signature");
  // Garbage after a valid header must fail (or decode) without hanging or reading out of bounds.
  for (let seed = 1; seed <= 20; seed++) {
    const broken = withPayload(lossless, (p) => {
      for (let i = 5 + seed; i < p.length; i += 7) p[i] = (p[i]! * 31 + seed) & 255;
      return p;
    });
    try {
      const image = decodeWebp(broken);
      expect(image.data.length).toBe(image.width * image.height * 4);
    } catch (err) {
      expect((err as Error).message).toMatch(/WebP/);
    }
  }
});
