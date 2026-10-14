// Screenshots without a window: the offscreen renderer of the addon (EGL surfaceless), the
// PNG encoder, `screenshot()` from testing and run() taking a screenshot instead of opening
// a window (NB_SCREENSHOT, used by `nodebuilder screenshot`).
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Box, Column, Icon, Text, Window, animate, colorScheme, createSignal, decodeImage, setTheme } from "@nodebuilderjs/core";
import { canScreenshot, findByText, mount, savePNG, screenshot } from "@nodebuilderjs/core/testing";
import { setImageBackend } from "../src/image/source.js";
import { drawCommands } from "./helpers.js";
import { encodePng } from "../src/image/png-encode.js";
import { CommandBuffer } from "../src/render/paint.js";
import { screenshotApp } from "../src/runtime/app.js";
import { type Native, loadNative } from "../src/runtime/native.js";

/** Whether this machine can render offscreen (an EGL driver, no display needed); probed once. */
const offscreen = (() => {
  try {
    loadNative().renderOffscreen(1, 1, 1, new Float32Array(0), []);
    return true;
  } catch (err) {
    if (!/offscreen rendering is unavailable/.test(String(err))) throw err;
    return false;
  }
})();

/** Pixel (x, y) of a straight-alpha RGBA buffer `width` px wide. */
const at = (rgba: Uint8Array, width: number, x: number, y: number) => Array.from(rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));

function shot(width: number, height: number, scale: number, draw: (b: CommandBuffer) => void) {
  const b = new CommandBuffer();
  draw(b);
  return loadNative().renderOffscreen(width, height, scale, b.commands, b.texts);
}

test.skipIf(!offscreen)("addon: a red RECT gives red pixels, rows top to bottom, transparent around it", () => {
  const rgba = shot(20, 10, 1, (b) => b.rect(0, 0, 10, 5, "#ff0000"));
  expect(rgba.length).toBe(20 * 10 * 4);
  expect(at(rgba, 20, 2, 2)).toEqual([255, 0, 0, 255]);
  expect(at(rgba, 20, 15, 2)).toEqual([0, 0, 0, 0]);
  expect(at(rgba, 20, 2, 8)).toEqual([0, 0, 0, 0]);
});

test.skipIf(!offscreen)("addon: pixels have straight alpha (a half transparent color keeps its RGB)", () => {
  const rgba = shot(4, 4, 1, (b) => b.rect(0, 0, 4, 4, "#3366cc80"));
  const [r, g, bl, a] = at(rgba, 4, 1, 1);
  expect(a).toBe(128);
  for (const [got, want] of [[r, 0x33], [g, 0x66], [bl, 0xcc]]) expect(Math.abs(got! - want!)).toBeLessThanOrEqual(2);
});

test.skipIf(!offscreen)("addon: rounded corners are antialiased; scale multiplies the size", () => {
  const rgba = shot(20, 20, 2, (b) => b.rect(0, 0, 20, 20, "#0000ff", 8));
  expect(rgba.length).toBe(40 * 40 * 4);
  expect(at(rgba, 40, 0, 0)[3]).toBe(0); // outside the corner
  expect(at(rgba, 40, 20, 20)).toEqual([0, 0, 255, 255]);
  // Along the diagonal of the corner, some pixel is partly covered.
  const partial = [...Array(16).keys()].map((i) => at(rgba, 40, i, i)[3]!).filter((a) => a > 0 && a < 255);
  expect(partial.length).toBeGreaterThan(0);
});

test.skipIf(!offscreen)("addon: TEXT draws glyphs inside its box with real fonts", () => {
  const rgba = shot(80, 30, 1, (b) => b.text(4, 4, "Hello", 16, "#000000", false));
  let inked = 0, outside = 0;
  for (let y = 0; y < 30; y++)
    for (let x = 0; x < 80; x++) {
      const a = at(rgba, 80, x, y)[3]!;
      if (a === 0) continue;
      if (x >= 4 && x < 60 && y >= 4 && y < 26) inked++;
      else outside++;
    }
  expect(inked).toBeGreaterThan(20);
  expect(outside).toBe(0);
});

test.skipIf(!offscreen)("addon: an image created with createImage is drawn", () => {
  const nat = loadNative();
  const green = new Uint8Array(4 * 4 * 4).map((_, i) => (i % 4 === 1 || i % 4 === 3 ? 255 : 0));
  const id = nat.createImage(4, 4, green);
  const b = new CommandBuffer();
  b.data.set([6, 2, 2, 8, 8, 0, 0, 1, 1, 1, 1, 1, 1, 0, id]);
  b.length = 15;
  const rgba = nat.renderOffscreen(12, 12, 1, b.commands, b.texts);
  expect(at(rgba, 12, 6, 6)).toEqual([0, 255, 0, 255]);
  expect(at(rgba, 12, 0, 0)[3]).toBe(0);
  nat.destroyImage(id);
});

test("PNG encoder: round trip through decodeImage keeps every pixel, alpha included", () => {
  const width = 7, height = 5;
  const data = new Uint8Array(width * height * 4).map((_, i) => (i * 37 + (i >> 2)) & 255);
  const png = encodePng({ width, height, data });
  expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const back = decodeImage(png);
  expect([back.width, back.height]).toEqual([width, height]);
  expect(Array.from(back.data)).toEqual(Array.from(data));
});

test("PNG encoder: a flat screenshot compresses, and a bad bitmap is rejected", () => {
  const data = new Uint8Array(400 * 300 * 4).fill(200);
  expect(encodePng({ width: 400, height: 300, data }).length).toBeLessThan(5000);
  expect(() => encodePng({ width: 4, height: 4, data: new Uint8Array(10) })).toThrow(/width\*height\*4/);
});

test.skipIf(!offscreen)("addon: after an offscreen render, opening a window is refused with a clear error", () => {
  expect(() => loadNative().open({ title: "x", appId: "x", width: 10, height: 10 }, () => {})).toThrow(/after renderOffscreen/);
});

const redSquare = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#ff0000"/></svg>';

test("canScreenshot() agrees with the addon probe", () => {
  expect(canScreenshot()).toBe(offscreen);
});

test.skipIf(!offscreen)("screenshot(root): the mounted size, real colors, and pixel()", () => {
  const { root, dispose } = mount(
    () => (
      <Column align="start">
        <Box width={50} height={30} background="#123456" />
      </Column>
    ),
    { width: 100, height: 60 },
  );
  const shot = screenshot(root);
  expect([shot.width, shot.height, shot.scale]).toEqual([100, 60, 1]);
  expect(shot.rgba.length).toBe(100 * 60 * 4);
  expect(shot.pixel(10, 10)).toEqual([0x12, 0x34, 0x56, 255]);
  expect(shot.pixel(80, 50)).toEqual([0, 0, 0, 0]);
  dispose();
});

test.skipIf(!offscreen)("radius per corner: square corners stay filled, rounded ones are cut, for the box and for its clip", () => {
  const shot = screenshot(
    () => (
      <Column align="start" gap={0}>
        <Box width={100} height={100} background="#ff0000" radius={[0, 30, 30, 0]} />
        <Box width={100} height={100} clip radius={[30, 0, 0, 30]}>
          <Box grow={1} background="#00ff00" />
        </Box>
      </Column>
    ),
    { width: 100, height: 200 },
  );
  expect(shot.pixel(1, 1)).toEqual([255, 0, 0, 255]); // top left: square
  expect(shot.pixel(98, 1)[3]).toBe(0); // top right: rounded
  expect(shot.pixel(98, 98)[3]).toBe(0); // bottom right: rounded
  expect(shot.pixel(1, 98)).toEqual([255, 0, 0, 255]); // bottom left: square
  expect(shot.pixel(1, 101)[3]).toBe(0); // clip: top left rounded
  expect(shot.pixel(98, 101)).toEqual([0, 255, 0, 255]); // clip: top right square
  expect(shot.pixel(1, 198)[3]).toBe(0);
  expect(shot.pixel(98, 198)).toEqual([0, 255, 0, 255]);
});

test.skipIf(!offscreen)("screenshot(view) mounts, shoots at the given size and scale, with a background", () => {
  const shot = screenshot(() => <Box width={10} height={10} background="#00ff00" />, { width: 40, height: 20, scale: 2, background: "#ffffff" });
  expect([shot.width, shot.height]).toEqual([80, 40]);
  expect(shot.pixel(4, 4)).toEqual([0, 255, 0, 255]);
  expect(shot.pixel(70, 30)).toEqual([255, 255, 255, 255]);
});

test.skipIf(!offscreen)("screenshot lays out with real text metrics, then restores the fake ones", () => {
  const { root, dispose } = mount(() => (
    <Column align="start">
      <Text>iiiiiiii</Text>
    </Column>
  ));
  const text = findByText(root, "iiiiiiii")!;
  expect(text.width).toBe(64); // 8 px per character
  const shot = screenshot(root, { width: 200, height: 40 });
  let right = 0; // the rightmost inked column: real "i"s are much narrower than 8 px
  for (let y = 0; y < shot.height; y++) for (let x = 0; x < shot.width; x++) if (shot.pixel(x, y)[3]! > 0) right = Math.max(right, x);
  expect(right).toBeGreaterThan(5);
  expect(right).toBeLessThan(50);
  expect(text.width).toBe(64);
  dispose();
});

test.skipIf(!offscreen)("an icon already painted by a test (fake image handle) still shows in the screenshot", () => {
  setImageBackend(null); // the headless default, as in an app's tests (other files install their own)
  const { root, dispose } = mount(() => (
    <Column align="start">
      <Icon svg={redSquare} size={20} />
    </Column>
  ));
  expect(drawCommands(root).some((c) => c.op === "image")).toBe(true);
  const shot = screenshot(root, { width: 40, height: 40 });
  expect(shot.pixel(10, 10)).toEqual([255, 0, 0, 255]);
  dispose();
});

test.skipIf(!offscreen)("toPNG() and savePNG() write a PNG that decodes to the same pixels", () => {
  const shot = screenshot(() => <Box width={6} height={4} background="#336699" />, { width: 6, height: 4 });
  expect(Array.from(decodeImage(shot.toPNG()).data)).toEqual(Array.from(shot.rgba));
  const dir = mkdtempSync(join(tmpdir(), "nb-shot-"));
  try {
    savePNG(shot, join(dir, "x.png"));
    expect(decodeImage(new Uint8Array(readFileSync(join(dir, "x.png")))).width).toBe(6);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

/** A native core that only renders offscreen: records each call and returns grey pixels. */
function offscreenOnly() {
  const calls: { width: number; height: number; scale: number; texts: string[] }[] = [];
  const unused = () => {
    throw new Error("a screenshot must not open a window");
  };
  const native = {
    open: unused,
    render: unused,
    measureText: (text: string) => [text.length * 8, 15, 5],
    createImage: () => 1,
    destroyImage: () => {},
    renderOffscreen(width: number, height: number, scale: number, _commands: Float32Array, texts: string[]) {
      calls.push({ width, height, scale, texts });
      return new Uint8Array(width * scale * height * scale * 4).fill(128);
    },
  } as unknown as Native;
  return { native, calls };
}

describe("run() under NB_SCREENSHOT", () => {
  const dir = mkdtempSync(join(tmpdir(), "nb-run-shot-"));
  afterAll(() => rmSync(dir, { recursive: true }));

  function AnimatedApp() {
    const [w, setW] = createSignal(0);
    animate(0, 100, setW, { duration: 200 });
    return (
      <Window title="Shot" width={300} height={200}>
        <Text>{() => `w=${Math.round(w())} ${colorScheme()}`}</Text>
      </Window>
    );
  }

  test("renders one frame offscreen at the window's size, after animations settle, and writes the PNG", async () => {
    const { native, calls } = offscreenOnly();
    const path = join(dir, "a.png");
    try {
      const shot = await screenshotApp(native, AnimatedApp, { NB_SCREENSHOT: path, NB_SCREENSHOT_SCALE: "2", NB_SCREENSHOT_THEME: "dark" });
      expect(calls.length).toBe(1);
      expect(calls[0]).toMatchObject({ width: 300, height: 200, scale: 2 });
      expect(calls[0]!.texts).toContain("w=100 dark");
      expect([shot.width, shot.height]).toEqual([600, 400]);
      const png = decodeImage(new Uint8Array(readFileSync(path)));
      expect([png.width, png.height]).toEqual([600, 400]);
    } finally {
      setTheme("light");
    }
  });

  test("NB_SCREENSHOT_WIDTH/HEIGHT override the window's size; NB_SCREENSHOT_FRAMES=0 shoots before any frame", async () => {
    const { native, calls } = offscreenOnly();
    await screenshotApp(native, AnimatedApp, { NB_SCREENSHOT: join(dir, "b.png"), NB_SCREENSHOT_WIDTH: "120", NB_SCREENSHOT_HEIGHT: "90", NB_SCREENSHOT_FRAMES: "0" });
    expect(calls[0]).toMatchObject({ width: 120, height: 90, scale: 1 });
    expect(calls[0]!.texts).toContain("w=0 light");
  });

  test("a bad option is an error naming it", async () => {
    const { native } = offscreenOnly();
    await expect(screenshotApp(native, AnimatedApp, { NB_SCREENSHOT: join(dir, "c.png"), NB_SCREENSHOT_THEME: "blue" })).rejects.toThrow(/theme.*blue/);
    await expect(screenshotApp(native, AnimatedApp, { NB_SCREENSHOT: join(dir, "c.png"), NB_SCREENSHOT_SCALE: "0" })).rejects.toThrow(/scale/);
  });
});
