// Color profiles of images: ICC matrix/TRC profiles (iCCP, JPEG APP2, WebP ICCP, HEIF) and CICP
// codes (PNG cICP, AVIF nclx). sRGB and Display P3 images are tagged and keep their pixels;
// other RGB profiles are converted to Display P3. Reference values: LittleCMS 2.19 (`transicc
// -t 1 -n`, relative colorimetric) on the same profiles, see fixtures/icc/ICC-SOURCES.md.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { crc32 } from "node:zlib";
import { decodeImage } from "@nodebuilderjs/core";
import { ADOBE_RGB, PRIMARIES, applyIccProfile, cicpSpace, displayP3Profile, parseIcc, profileSpace, writeIcc } from "../../src/image/icc.js";
import { setImageBackend, acquireImage, imageHandle, releaseImage } from "../../src/image/source.js";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/icc/${name}`, import.meta.url)));
const at = (data: Uint8Array, i: number) => Array.from(data.subarray(i * 4, i * 4 + 4));
const close = (got: number[], want: number[], tolerance = 1) => got.forEach((v, i) => expect(Math.abs(v - want[i]!)).toBeLessThanOrEqual(tolerance));

// The pixels every fixture was made from (4x2 RGBA).
const PIXELS = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [128, 64, 32, 255], [10, 200, 90, 255], [255, 255, 255, 255], [0, 0, 0, 255], [200, 100, 50, 128]];
const bitmap = () => ({ width: 4, height: 2, data: Uint8Array.from(PIXELS.flat()) });

const adobe = writeIcc({ primaries: ADOBE_RGB, description: "Adobe RGB", curve: 563 / 256 });
const table = (n: number, g: number) => Array.from({ length: n }, (_, i) => (i / (n - 1)) ** g);
const adobeTables = writeIcc({ primaries: ADOBE_RGB, description: "Adobe RGB, tables", curve: [table(12000, 2.2), table(12001, 2.0), table(12002, 1.8)] });

describe("profiles", () => {
  test("the written profiles read back as what they are", () => {
    expect(profileSpace(parseIcc(displayP3Profile())!)).toBe("display-p3");
    expect(profileSpace(parseIcc(writeIcc({ primaries: PRIMARIES.srgb, description: "sRGB" }))!)).toBe("srgb");
    expect(profileSpace(parseIcc(adobe)!)).toBe("other");
    // The same primaries with another curve are another space.
    expect(profileSpace(parseIcc(writeIcc({ primaries: PRIMARIES["display-p3"], description: "P3 gamma 2.2", curve: 2.2 }))!)).toBe("other");
  });

  test("another RGB profile is converted to Display P3 (LittleCMS values), alpha kept", () => {
    const out = applyIccProfile(bitmap(), adobe);
    expect(out.colorSpace).toBe("display-p3");
    close(at(out.data, 0), [255, 61, 43, 255]); // 271 in LittleCMS: past P3, clipped
    close(at(out.data, 1), [0, 250, 45, 255]);
    close(at(out.data, 2), [0, 0, 249, 255]);
    close(at(out.data, 3), [136, 67, 35, 255]);
    close(at(out.data, 4), [0, 197, 94, 255]);
    close(at(out.data, 5), [255, 255, 255, 255]);
    expect(at(out.data, 7)[3]).toBe(128);
    // Sampled curves, one per channel.
    close(at(applyIccProfile(bitmap(), adobeTables).data, 3), [135, 75, 48, 255]);
  });

  test("sRGB and P3 profiles keep the pixels; an unreadable profile leaves the image sRGB", () => {
    const p3 = applyIccProfile(bitmap(), displayP3Profile());
    expect(p3.colorSpace).toBe("display-p3");
    expect(p3.data).toEqual(bitmap().data);
    const srgb = applyIccProfile(bitmap(), writeIcc({ primaries: PRIMARIES.srgb, description: "sRGB" }));
    expect(srgb.colorSpace).toBeUndefined();
    const broken = applyIccProfile(bitmap(), new Uint8Array(200));
    expect(broken.colorSpace).toBeUndefined();
    expect(broken.data).toEqual(bitmap().data);
  });

  test("fuzzing: truncated and flipped profiles never throw", () => {
    for (const source of [displayP3Profile(), adobe]) {
      for (let len = 0; len < source.length; len += 7) parseIcc(source.subarray(0, len));
      for (let i = 0; i < source.length; i++) {
        const bad = source.slice();
        bad[i] ^= 0xff;
        const p = parseIcc(bad);
        if (p) applyIccProfile(bitmap(), bad);
      }
    }
  });

  test("CICP codes: sRGB and P3 primaries with SDR transfers; anything else is left alone", () => {
    expect(cicpSpace(1, 13)).toBe("srgb");
    expect(cicpSpace(12, 13)).toBe("display-p3");
    expect(cicpSpace(12, 1)).toBe("display-p3");
    expect(cicpSpace(9, 16)).toBeNull(); // Rec. 2020 PQ (HDR)
    expect(cicpSpace(12, 16)).toBeNull();
    expect(cicpSpace(5, 13)).toBeNull();
  });
});

/** A PNG with `chunk` (type + body) inserted after IHDR. */
function withChunk(png: Uint8Array, type: string, body: number[]): Uint8Array {
  const data = new Uint8Array(4 + body.length);
  data.set([...type].map((c) => c.charCodeAt(0)));
  data.set(body, 4);
  const chunk = new Uint8Array(12 + body.length);
  const v = new DataView(chunk.buffer);
  v.setUint32(0, body.length);
  chunk.set(data, 4);
  v.setUint32(8 + body.length, crc32(data));
  const ihdrEnd = 8 + 25;
  return Uint8Array.from([...png.subarray(0, ihdrEnd), ...chunk, ...png.subarray(ihdrEnd)]);
}

/** A JPEG with APP2 ICC_PROFILE segments (`parts`: [sequence number, bytes]) after SOI. */
function withIcc(jpeg: Uint8Array, parts: [number, Uint8Array][], total = parts.length): Uint8Array {
  const segments = parts.map(([seq, bytes]) => {
    const head = [..."ICC_PROFILE"].map((c) => c.charCodeAt(0));
    const len = 2 + head.length + 1 + 2 + bytes.length;
    return [0xff, 0xe2, len >> 8, len & 255, ...head, 0, seq, total, ...bytes];
  });
  return Uint8Array.from([...jpeg.subarray(0, 2), ...segments.flat(), ...jpeg.subarray(2)]);
}

describe("decoders", () => {
  test("PNG: iCCP (P3 kept, Adobe RGB converted), cICP, and cICP over iCCP", () => {
    const p3 = decodeImage(fixture("png-p3-iccp.png"));
    expect(p3.colorSpace).toBe("display-p3");
    expect(p3.data).toEqual(bitmap().data);
    const converted = decodeImage(fixture("png-adobe-iccp.png"));
    expect(converted.colorSpace).toBe("display-p3");
    close(at(converted.data, 3), [136, 67, 35, 255]);
    expect(decodeImage(fixture("png-plain.png")).colorSpace).toBeUndefined();
    expect(decodeImage(withChunk(fixture("png-plain.png"), "cICP", [12, 13, 0, 1])).colorSpace).toBe("display-p3");
    const both = decodeImage(withChunk(fixture("png-adobe-iccp.png"), "cICP", [1, 13, 0, 1]));
    expect(both.colorSpace).toBeUndefined();
    expect(both.data).toEqual(bitmap().data);
  });

  test("JPEG: APP2 profile, also split across segments in any order; a missing part is ignored", () => {
    expect(decodeImage(fixture("jpeg-p3-icc.jpg")).colorSpace).toBe("display-p3");
    const plain = new Uint8Array(readFileSync(new URL("../fixtures/jpeg/jpeg-rgb.jpg", import.meta.url)));
    const expected = applyIccProfile(decodeImage(plain), adobeTables);
    const half = 60000;
    const split = decodeImage(withIcc(plain, [[2, adobeTables.subarray(half)], [1, adobeTables.subarray(0, half)]]));
    expect(split.colorSpace).toBe("display-p3");
    expect(split.data).toEqual(expected.data);
    const missing = decodeImage(withIcc(plain, [[1, adobeTables.subarray(0, half)]], 2));
    expect(missing.colorSpace).toBeUndefined();
    expect(missing.data).toEqual(decodeImage(plain).data);
  });

  test("WebP: ICCP chunk", () => {
    const p3 = decodeImage(fixture("webp-p3-iccp.webp"));
    expect(p3.colorSpace).toBe("display-p3");
    expect(p3.data).toEqual(bitmap().data);
  });

  const heif = (() => {
    try {
      decodeImage(new Uint8Array(readFileSync(new URL("../fixtures/heif/avif-lossless.avif", import.meta.url))));
      return true;
    } catch {
      return false;
    }
  })();

  test.skipIf(!heif)("AVIF nclx and HEIC ICC profiles (libheif)", () => {
    const avif = decodeImage(fixture("avif-p3-nclx.avif"));
    expect(avif.colorSpace).toBe("display-p3");
    close(at(avif.data, 3), [128, 64, 32, 255], 2);
    expect(decodeImage(fixture("heic-p3-icc.heic")).colorSpace).toBe("display-p3");
    expect(decodeImage(new Uint8Array(readFileSync(new URL("../fixtures/heif/avif-lossless.avif", import.meta.url)))).colorSpace).toBeUndefined();
  });
});

test("the GPU texture is made with the image's color space", () => {
  const made: (string | undefined)[] = [];
  setImageBackend({ create: (_w, _h, _rgba, space) => (made.push(space), made.length), destroy: () => {} });
  try {
    for (const name of ["png-p3-iccp.png", "png-plain.png"]) {
      const source = acquireImage(fixture(name));
      imageHandle(source);
      releaseImage(source);
    }
    expect(made).toEqual(["display-p3", "srgb"]);
  } finally {
    setImageBackend(null);
  }
});
