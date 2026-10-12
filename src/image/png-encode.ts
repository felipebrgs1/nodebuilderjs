// PNG encoder for screenshots: 8-bit RGBA (straight alpha), compressed with the runtime's zlib.
// Each row uses the Sub or the Up filter, whichever leaves smaller residuals: UI pixels repeat
// along rows (flat fills) and down columns (vertical edges), and both make long zero runs.

import { deflateSync } from "node:zlib";
import type { Bitmap } from "./png.js";

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Encodes RGBA pixels (straight alpha, rows top to bottom) as a PNG file. */
export function encodePng(bitmap: Bitmap): Uint8Array {
  const { width, height, data } = bitmap;
  if (!(width > 0 && height > 0) || data.length < width * height * 4) throw new Error("encodePng: data must hold width*height*4 bytes");
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * stride, out = y * (stride + 1) + 1;
    // Sum of residuals (as signed bytes) for each filter; the smaller usually compresses better.
    let sub = 0, up = 0;
    for (let i = 0; i < stride; i++) {
      const v = data[row + i]!;
      const s = (v - (i >= 4 ? data[row + i - 4]! : 0)) & 255;
      const u = (v - (y > 0 ? data[row - stride + i]! : 0)) & 255;
      sub += s < 128 ? s : 256 - s;
      up += u < 128 ? u : 256 - u;
    }
    if (y > 0 && up < sub) {
      raw[out - 1] = 2;
      for (let i = 0; i < stride; i++) raw[out + i] = data[row + i]! - data[row - stride + i]!;
    } else {
      raw[out - 1] = 1;
      for (let i = 0; i < stride; i++) raw[out + i] = data[row + i]! - (i >= 4 ? data[row + i - 4]! : 0);
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA, deflate, adaptive filtering, no interlace
  const parts = [new Uint8Array(SIGNATURE), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    png.set(p, offset);
    offset += p.length;
  }
  return png;
}
