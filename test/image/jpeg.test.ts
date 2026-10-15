import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { decodeJpeg } from "../../src/image/jpeg.js";

const read = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/jpeg/${name}`, import.meta.url)));

/** Binary PGM/PPM (what djpeg -pnm writes) as RGBA. */
function pnm(name: string) {
  const b = read(name);
  const fields: string[] = [];
  let p = 0;
  while (fields.length < 4) {
    while (b[p] === 0x20 || b[p] === 0x0a) p++;
    let t = "";
    while (b[p] !== 0x20 && b[p] !== 0x0a) t += String.fromCharCode(b[p++]!);
    fields.push(t);
  }
  const channels = fields[0] === "P5" ? 1 : 3;
  const [width, height] = [Number(fields[1]), Number(fields[2])];
  const src = b.subarray(p + 1);
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) data[i * 4 + c] = src[i * channels + (channels === 1 ? 0 : c)]!;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

// References: djpeg (libjpeg-turbo 3.2, default settings) and, for CMYK and EXIF
// orientation, ImageMagick (-colorspace sRGB / -auto-orient). The decoder is byte-exact.
test.each([
  ["s420", "4:2:0"], ["s422", "4:2:2"], ["s440", "4:4:0"], ["s411", "4:1:1"], ["s444", "4:4:4"],
  ["prog420", "progressive"], ["prog-restart", "progressive with restarts"], ["restart", "restart markers"],
  ["gray", "grayscale"], ["rgb", "RGB (Adobe, no transform)"], ["cmyk", "Adobe YCCK/CMYK"],
  ["exif6", "EXIF orientation 6, big endian"], ["exif8", "EXIF orientation 8, little endian"],
])("JPEG decoder: %s (%s)", (name) => {
  const img = decodeJpeg(read(`jpeg-${name}.jpg`));
  const ref = pnm(`jpeg-${name}.pnm`);
  expect([img.width, img.height]).toEqual([ref.width, ref.height]);
  expect(Buffer.from(img.data).equals(Buffer.from(ref.data))).toBe(true);
});

test("JPEG decoder rejects what it does not support", () => {
  const sof3 = new Uint8Array([0xff, 0xd8, 0xff, 0xc3, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0]);
  expect(() => decodeJpeg(sof3)).toThrow(/lossless|arithmetic/);
  const truncated = read("jpeg-s420.jpg").subarray(0, 100);
  expect(() => decodeJpeg(truncated)).toThrow(/truncated|without a frame/);
});
