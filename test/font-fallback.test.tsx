// Font fallback and color emoji, with the real fonts of this machine (addon measurements and
// offscreen pixels). Each test is skipped when the fonts it needs are not installed.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { Column, Text } from "@nodebuilderjs/core";
import { type Screenshot, canScreenshot, screenshot } from "@nodebuilderjs/core/testing";
import { fontId, loadNative } from "../src/runtime/native.js";

/** Whether some installed font has `codepoint` (and is a color font, if asked), per fontconfig. */
function fontHas(codepoint: number, color = false): boolean {
  const pattern = `:charset=${codepoint.toString(16)}${color ? ":color=true" : ""}`;
  const out = spawnSync("fc-list", [pattern, "file"], { encoding: "utf8" });
  return out.status === 0 && out.stdout.trim().length > 0;
}

const symbols = fontHas(0x25b2) && fontHas(0x2191);
const emoji = fontHas(0x1f389, true);
const shots = canScreenshot();

const width = (text: string, size = 16, bold = false) => loadNative().measureText(text, size, fontId(bold ? 700 : 400, false), 1)[0];
/** Advance of a character no font has: the primary font's .notdef (tofu). */
const tofu = () => width("\u{10FFFD}");

test.skipIf(!symbols)("measure: a symbol the UI font lacks takes the fallback font's advance, not the tofu's", () => {
  for (const s of ["▲", "▼", "↑", "↓"]) {
    expect(width(s)).toBeGreaterThan(0);
    expect(width(s)).not.toBeCloseTo(tofu(), 1);
  }
  expect(width("▲", 16, true)).toBeGreaterThan(0);
});

test.skipIf(!symbols || !emoji)("measure: a mixed string is the sum of its runs; fallback does not change ASCII", () => {
  const parts = ["Revenue ", "▲", " 12% ", "🎉", " done"];
  const sum = parts.reduce((w, p) => w + width(p), 0);
  expect(width(parts.join(""))).toBeCloseTo(sum, 0);
  expect(width("Revenue 12%")).toBeCloseTo(width("Revenue ") + width("12%"), 0);
});

test.skipIf(!emoji)("measure: an emoji ZWJ sequence, skin tone or flag is one emoji wide, not several", () => {
  const one = width("👨");
  expect(one).toBeGreaterThan(8);
  expect(one).not.toBeCloseTo(tofu(), 1);
  for (const seq of ["👨‍👩‍👧", "👍🏽", "🇧🇷", "❤️"]) {
    expect(width(seq)).toBeGreaterThan(one * 0.8);
    expect(width(seq)).toBeLessThan(one * 1.3);
  }
});

/** Pixels of `shot` with some ink. */
function inked(shot: Screenshot) {
  const out: { x: number; y: number; p: number[] }[] = [];
  for (let y = 0; y < shot.height; y++)
    for (let x = 0; x < shot.width; x++) {
      const p = shot.pixel(x, y);
      if (p[3]! > 0) out.push({ x, y, p });
    }
  return out;
}
const colorful = (p: number[]) => p[3]! > 200 && Math.max(p[0]!, p[1]!, p[2]!) - Math.min(p[0]!, p[1]!, p[2]!) > 80;

test.skipIf(!shots || !symbols)("pixels: ▲ is drawn by a fallback font (a filled triangle, not a hollow tofu box)", () => {
  const shot = screenshot(() => (
    <Column align="start">
      <Text fontSize={40} color="#000000">▲</Text>
    </Column>
  ), { width: 80, height: 60 });
  const ink = inked(shot);
  expect(ink.length).toBeGreaterThan(50);
  const xs = ink.map((i) => i.x), ys = ink.map((i) => i.y);
  const cx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2), cy = Math.round((Math.min(...ys) + Math.max(...ys)) / 2);
  expect(shot.pixel(cx, cy)[3]).toBeGreaterThan(200);
});

test.skipIf(!shots || !emoji)("pixels: 🎉 is drawn in color, ignoring the text color, at both scales", () => {
  for (const scale of [1, 2]) {
    const shot = screenshot(() => (
      <Column align="start">
        <Text fontSize={32} color="#000000">🎉</Text>
      </Column>
    ), { width: 60, height: 50, scale });
    const ink = inked(shot);
    expect(ink.filter((i) => colorful(i.p)).length).toBeGreaterThan(30 * scale * scale);
    // It stays inside its line box (32 px font: the emoji is ~40 px wide, ~45 px line).
    for (const i of ink) expect(i.x / scale).toBeLessThan(48);
  }
});

test.skipIf(!shots || !emoji)("pixels: a color emoji larger than the atlas cap is drawn at its full size", () => {
  // At 800 px the emoji is ~1000 px wide: over the 512 px cap, so it is stretched from a smaller copy.
  const shot = screenshot(() => (
    <Column align="start">
      <Text fontSize={800} color="#000000">🎉</Text>
    </Column>
  ), { width: 1100, height: 1150 });
  let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1, colored = 0;
  for (let y = 0; y < shot.height; y += 4)
    for (let x = 0; x < shot.width; x += 4) {
      const p = shot.pixel(x, y);
      if (p[3]! === 0) continue;
      x0 = Math.min(x0, x), x1 = Math.max(x1, x), y0 = Math.min(y0, y), y1 = Math.max(y1, y);
      if (colorful(p)) colored++;
    }
  expect(x1 - x0).toBeGreaterThan(600);
  expect(y1 - y0).toBeGreaterThan(600);
  expect(colored).toBeGreaterThan(100_000 / 16); // sampled every 4 px
});

test.skipIf(!shots || !emoji)("pixels: opacity applies to color emoji", () => {
  const shot = screenshot(() => (
    <Column align="start" opacity={0.5}>
      <Text fontSize={32}>🎉</Text>
    </Column>
  ), { width: 60, height: 50 });
  const ink = inked(shot);
  expect(ink.filter((i) => colorful({ ...i.p, 3: 255 } as number[])).length).toBeGreaterThan(30);
  expect(Math.max(...ink.map((i) => i.p[3]!))).toBeLessThanOrEqual(130);
});

test.skipIf(!shots || !emoji)("pixels: text after an emoji keeps going (shared baseline, one run per font)", () => {
  const shot = screenshot(() => (
    <Column align="start">
      <Text fontSize={20} color="#000000">a🎉b</Text>
    </Column>
  ), { width: 100, height: 40 });
  const ink = inked(shot);
  const right = Math.max(...ink.map((i) => i.x));
  expect(right).toBeGreaterThan(width("a🎉", 20));
  expect(ink.some((i) => colorful(i.p))).toBe(true);
});
