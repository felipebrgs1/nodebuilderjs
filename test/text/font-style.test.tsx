// Font weights, italic and letter spacing with the real fonts of this machine (addon
// measurements and offscreen pixels). Each test is skipped when the fonts it needs are missing.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { Column, Text } from "@nodebuilderjs/core";
import { type Screenshot, canScreenshot, screenshot } from "@nodebuilderjs/core/testing";
import { fontId, loadNative } from "../../src/runtime/native.js";

/** The file fontconfig picks for the UI font with this pattern suffix (fontconfig weights: 50 light, 80 regular, 210 black). */
function fileFor(suffix: string): string {
  const out = spawnSync("fc-match", [`sans-serif${suffix}`, "--format=%{file}:%{index}"], { encoding: "utf8" });
  return out.status === 0 ? out.stdout.trim() : "";
}
/** A variable font gives every weight from one file; fc-list reports it. */
function variableUiFont(): boolean {
  const out = spawnSync("fc-match", ["sans-serif", "--format=%{variable}"], { encoding: "utf8" });
  return out.status === 0 && out.stdout.trim() === "True";
}

const regular = fileFor("");
const weights = !!regular && (variableUiFont() || (fileFor(":weight=210") !== regular && fileFor(":weight=50") !== regular));
const italics = !!regular && (variableUiFont() || fileFor(":slant=100") !== regular);
const shots = canScreenshot();

const width = (text: string, options: { weight?: number; italic?: boolean; spacing?: number; size?: number } = {}) =>
  loadNative().measureText(text, options.size ?? 16, fontId(options.weight ?? 400, options.italic ?? false), 1, options.spacing ?? 0)[0];

const sample = "Weights and spacing";

test.skipIf(!regular)("measure: weight 400 is the regular font, 700 the bold one (the old bold flag)", () => {
  expect(width(sample, { weight: 400 })).toBeGreaterThan(0);
  expect(width(sample, { weight: 700 })).toBeGreaterThan(width(sample, { weight: 400 }));
});

test.skipIf(!weights)("measure: weight 900 is wider than 400, and 400 wider than 300", () => {
  expect(width(sample, { weight: 900 })).toBeGreaterThan(width(sample, { weight: 400 }));
  expect(width(sample, { weight: 400 })).toBeGreaterThan(width(sample, { weight: 300 }));
});

test.skipIf(!italics)("measure: italic uses the italic face (different advances)", () => {
  expect(width(sample, { italic: true })).not.toBeCloseTo(width(sample), 1);
});

test.skipIf(!regular)("measure: letterSpacing adds the spacing after every character, the last one too", () => {
  for (const text of ["abc", "Hello world", "Ação"]) {
    const n = Array.from(text).length;
    expect(width(text, { spacing: 2 })).toBeCloseTo(width(text) + 2 * n, 1);
    expect(width(text, { spacing: -0.5 })).toBeCloseTo(width(text) - 0.5 * n, 1);
  }
  // Ligatures are off with spacing (as in CSS): "ffi" is three letters, three spacings.
  const letters = width("f") * 2 + width("i");
  expect(width("ffi", { spacing: 2 })).toBeCloseTo(letters + 6, 0);
  // A combining mark belongs to its letter: one spacing for "é" written as e + U+0301.
  expect(width("éx", { spacing: 3 })).toBeCloseTo(width("éx") + 6, 1);
  // Device scale: logical px in, logical px out.
  const [atTwo] = loadNative().measureText("abc", 16, fontId(400, false), 2, 2);
  const [plainAtTwo] = loadNative().measureText("abc", 16, fontId(400, false), 2, 0);
  expect(atTwo! - plainAtTwo!).toBeCloseTo(6, 1);
});

/** Sum of the darkness of every pixel: more and thicker strokes, more ink. */
function ink(shot: Screenshot): number {
  let total = 0;
  for (let y = 0; y < shot.height; y++) for (let x = 0; x < shot.width; x++) total += shot.pixel(x, y)[3]!;
  return total;
}

test.skipIf(!shots || !weights)("pixels: weight 900 lays down more ink than 300", () => {
  const shoot = (weight: number) =>
    screenshot(() => (
      <Column align="start">
        <Text fontSize={24} fontWeight={weight} color="#000000">Hamburgefonstiv</Text>
      </Column>
    ), { width: 320, height: 40 });
  expect(ink(shoot(900))).toBeGreaterThan(ink(shoot(300)) * 1.5);
});

test.skipIf(!shots || !regular)("pixels: italic slants the glyphs (a real italic face, or an oblique one)", () => {
  const columns = (italic: boolean) => {
    const shot = screenshot(() => (
      <Column align="start">
        <Text fontSize={40} italic={italic} color="#000000">l</Text>
      </Column>
    ), { width: 60, height: 60 });
    // Mean ink x of the top and bottom quarters of the stroke.
    const rows: number[][] = [];
    for (let y = 0; y < shot.height; y++) {
      const xs: number[] = [];
      for (let x = 0; x < shot.width; x++) if (shot.pixel(x, y)[3]! > 128) xs.push(x);
      if (xs.length) rows.push(xs);
    }
    const mean = (r: number[][]) => r.flat().reduce((a, b) => a + b, 0) / r.flat().length;
    const q = Math.max(1, Math.floor(rows.length / 4));
    return mean(rows.slice(0, q)) - mean(rows.slice(-q));
  };
  expect(columns(false)).toBeLessThan(1);
  expect(columns(true)).toBeGreaterThan(3); // the top leans right
});

test.skipIf(!shots || !regular)("pixels: letterSpacing pushes the glyphs apart", () => {
  const right = (spacing: number) => {
    const shot = screenshot(() => (
      <Column align="start">
        <Text fontSize={20} letterSpacing={spacing} color="#000000">iiii</Text>
      </Column>
    ), { width: 200, height: 40 });
    let max = 0;
    for (let y = 0; y < shot.height; y++) for (let x = 0; x < shot.width; x++) if (shot.pixel(x, y)[3]! > 0) max = Math.max(max, x);
    return max;
  };
  // Four glyphs: the last one moves by three spacings.
  expect(right(10) - right(0)).toBeGreaterThanOrEqual(29);
  expect(right(10) - right(0)).toBeLessThanOrEqual(31);
});
