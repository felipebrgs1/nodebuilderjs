// Window icons: an SVG or raster image (or the framework's default) rasterized into the square
// sizes the native core hands to the compositor (xdg-toplevel-icon on Wayland, _NET_WM_ICON on X11).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DEFAULT_ICON_SVG, ICON_SIZES, iconImages } from "../src/image/icon.js";
import { encodePng } from "../src/image/png-encode.js";

const pixel = (img: { size: number; rgba: Uint8Array }, x: number, y: number) => [...img.rgba.subarray((y * img.size + x) * 4, (y * img.size + x) * 4 + 4)];

describe("iconImages", () => {
  test("the default icon is the packager's default, at every icon size", () => {
    expect(DEFAULT_ICON_SVG).toBe(readFileSync(new URL("../cli/package/icon.svg", import.meta.url), "utf8"));
    const images = iconImages();
    expect(images.map((i) => i.size)).toEqual([...ICON_SIZES]);
    for (const img of images) expect(img.rgba.length).toBe(img.size * img.size * 4);
    const big = images.at(-1)!;
    expect(pixel(big, 40, 128)).toEqual([0x35, 0x84, 0xe4, 255]); // the blue tile
    expect(pixel(big, 2, 2)[3]).toBe(0); // outside its rounded corner
  });

  test("SVG markup and .svg paths are rasterized at every size", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#ff0000"/></svg>`;
    const images = iconImages(svg);
    expect(images.map((i) => i.size)).toEqual([...ICON_SIZES]);
    expect(pixel(images[0]!, 8, 8)).toEqual([255, 0, 0, 255]);
    expect(iconImages(new URL("../cli/package/icon.svg", import.meta.url).pathname).at(-1)!.rgba).toEqual(iconImages().at(-1)!.rgba);
  });

  test("a raster image is centered in a square, never scaled up past its size", () => {
    const data = new Uint8Array(64 * 32 * 4);
    for (let i = 0; i < 64 * 32; i++) data.set([0, 255, 0, 255], i * 4);
    const images = iconImages(encodePng({ width: 64, height: 32, data }));
    expect(images.map((i) => i.size)).toEqual([16, 24, 32, 48, 64]);
    const img = images.at(-1)!;
    expect(pixel(img, 32, 4)[3]).toBe(0); // padding above
    expect(pixel(img, 32, 32)).toEqual([0, 255, 0, 255]);
    expect(pixel(img, 32, 60)[3]).toBe(0); // and below
  });

  test("an image smaller than every icon size is still sent once, at its own size", () => {
    const images = iconImages(encodePng({ width: 8, height: 8, data: new Uint8Array(8 * 8 * 4).fill(255) }));
    expect(images.map((i) => i.size)).toEqual([8]);
  });

  test("downscaling averages premultiplied: half-covered red stays red, half transparent", () => {
    const data = new Uint8Array(32 * 32 * 4);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if ((x + y) % 2 === 0) data.set([255, 0, 0, 255], (y * 32 + x) * 4);
    const img = iconImages(encodePng({ width: 32, height: 32, data })).find((i) => i.size === 16)!;
    expect(pixel(img, 5, 5)).toEqual([255, 0, 0, 128]);
  });

  test("an unreadable icon throws with the file in the message", () => {
    expect(() => iconImages("/nonexistent/icon.png")).toThrow("/nonexistent/icon.png");
    expect(() => iconImages(new Uint8Array([1, 2, 3]))).toThrow("unknown image format");
  });
});
