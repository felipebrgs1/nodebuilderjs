// Font families: app fonts (registerFont), system families by name, generic families, CSS-style
// weight/slant matching, per-character fallback through the family list, variations and
// OpenType features. The fonts in fixtures/fonts are boxes with known advances (build.py):
// at size 100 one font unit is 0.1 px, so NB Test's "x" is 50 px wide, its bold "x" 70 px.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Box, Canvas, Column, Text, TextField, createSignal, fontFamilies, registerFont } from "@nodebuilderjs/core";
import { canScreenshot, canUseRealTextMetrics, mount, screenshot, useRealTextMetrics } from "@nodebuilderjs/core/testing";
import { type FontInput, fontStyle } from "../src/render/node.js";
import { loadNative, nativeTextMeasurer } from "../src/runtime/native.js";
import { commandsOf } from "./helpers.js";

const fixture = (name: string) => join(import.meta.dir, "fixtures/fonts", name);
const real = canUseRealTextMetrics();
const shots = real && canScreenshot();

let registered = false;
function setup() {
  if (registered) return;
  registered = true;
  registerFont(fixture("NBTest-Regular.ttf"));
  registerFont(fixture("NBTest-Bold.ttf"));
  registerFont(readFileSync(fixture("NBTest-Italic.ttf"))); // bytes work too
  registerFont(fixture("NBFallback-Regular.ttf"));
  registerFont(fixture("NBVar.ttf"));
}

/** Width in logical px of `text` at `size` with the real (addon) metrics. */
function width(text: string, font: FontInput, size = 100) {
  setup();
  return nativeTextMeasurer(loadNative(), 1)(text, size, fontStyle(font)).width;
}

// ---- registering ------------------------------------------------------------------

test.skipIf(!real)("registerFont reads the family, weight and slant from the file", () => {
  expect(registerFont(fixture("NBTest-Bold.ttf"))).toEqual([{ family: "NB Test", weight: [700, 700], italic: false, variable: false }]);
  expect(registerFont(fixture("NBTest-Italic.ttf"))).toEqual([{ family: "NB Test", weight: [400, 400], italic: true, variable: false }]);
  expect(registerFont(fixture("NBVar.ttf"))).toEqual([{ family: "NB Var", weight: [100, 900], italic: false, variable: true }]);
});

test.skipIf(!real)("registerFont: a collection registers every face in it", () => {
  const faces = registerFont(fixture("NBCollection.ttc"), { family: "NB Collection" });
  expect(faces.map((f) => f.family)).toEqual(["NB Collection", "NB Collection"]);
  // Both faces are regular: the first one wins, and the second fills in what it lacks ("z").
  expect(width("xz", { family: "NB Collection" })).toBeCloseTo(50 + 90, 1);
});

test.skipIf(!real)("registerFont: TrueType, CFF (.otf), WOFF and WOFF2 files", () => {
  for (const ext of ["ttf", "otf", "woff", "woff2"]) {
    const family = `NB Format ${ext}`;
    expect(registerFont(fixture(`NBFallback-Regular.${ext}`), { family })[0]!.family).toBe(family);
    expect(width("z", { family })).toBeCloseTo(90, 1);
  }
});

test.skipIf(!real)("registerFont: options override the family, weight and slant of the file", () => {
  registerFont(fixture("NBFallback-Regular.ttf"), { family: "NB Override", weight: 700, italic: true });
  // The only face is now bold italic, so a regular request still gets it (closest match).
  expect(width("z", { family: "NB Override" })).toBeCloseTo(90, 1);
  expect(registerFont(fixture("NBVar.ttf"), { family: "NB Var Range", weight: [300, 500] })[0]!.weight).toEqual([300, 500]);
});

test.skipIf(!real)("registerFont: errors say what is wrong", () => {
  expect(() => registerFont(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/not a font file this system can read/);
  expect(() => registerFont(fixture("missing.ttf"))).toThrow(/missing\.ttf/);
});

test.skipIf(!real)("a family registered after it was first measured takes effect (caches are dropped)", () => {
  const measure = nativeTextMeasurer(loadNative(), 1);
  const before = measure("zz", 100, fontStyle({ family: "NB Late" })).width; // unknown: the UI font
  registerFont(fixture("NBFallback-Regular.ttf"), { family: "NB Late" });
  expect(before).not.toBeCloseTo(180, 0);
  expect(measure("zz", 100, fontStyle({ family: "NB Late" })).width).toBeCloseTo(180, 1);
});

test.skipIf(!real)("fontFamilies lists the registered families and the system's", () => {
  setup();
  const families = fontFamilies();
  expect(families).toContain("NB Test");
  expect(families).toContain("NB Var");
  expect(families.length).toBeGreaterThan(5);
  expect([...families].sort((a, b) => a.localeCompare(b))).toEqual(families);
});

// ---- matching ---------------------------------------------------------------------

test.skipIf(!real)("fontFamily picks the registered family; names match without case or quotes", () => {
  expect(width("x", { family: "NB Test" })).toBeCloseTo(50, 1);
  expect(width("x", { family: "'nb test'" })).toBeCloseTo(50, 1);
  expect(width("x", { family: '"NB TEST", sans-serif' })).toBeCloseTo(50, 1);
});

test.skipIf(!real)("weights follow the CSS matching rules", () => {
  const x = (weight: number) => width("x", { family: "NB Test", weight });
  expect(x(400)).toBeCloseTo(50, 1);
  expect(x(700)).toBeCloseTo(70, 1);
  expect(x(600)).toBeCloseTo(70, 1); // > 500: heavier first
  expect(x(900)).toBeCloseTo(70, 1); // none heavier: the closest lighter
  expect(x(500)).toBeCloseTo(50, 1); // 400..500: up to 500, then lighter
  expect(x(300)).toBeCloseTo(50, 1); // < 400: lighter first, then heavier
});

test.skipIf(!real)("italic picks the italic face; without a bold italic, the italic one is emboldened", () => {
  expect(width("x", { family: "NB Test", italic: true })).toBeCloseTo(60, 1);
  expect(width("x", { family: "NB Test", italic: true, weight: 700 })).toBeCloseTo(60, 1);
});

test.skipIf(!real)("each character falls back through the family list, in order", () => {
  expect(width("xz", { family: "NB Test, NB Fallback" })).toBeCloseTo(50 + 90, 1);
  expect(width("xz", { family: "NB Fallback, NB Test" })).toBeCloseTo(10 + 90, 1);
  // Missing families are skipped.
  expect(width("x", { family: "No Such Font, NB Test" })).toBeCloseTo(50, 1);
  // Not in any family of the list: the system's fallback (the UI font has "q").
  expect(width("q", { family: "NB Test" })).toBeCloseTo(width("q", {}), 1);
});

test.skipIf(!real)("an unknown family alone is the UI font", () => {
  expect(width("Hello", { family: "No Such Font" })).toBeCloseTo(width("Hello", {}), 3);
});

test.skipIf(!real)("generic families come from the system: monospace has equal advances", () => {
  expect(width("iiii", { family: "monospace" }, 20)).toBeCloseTo(width("MMMM", { family: "monospace" }, 20), 1);
  expect(width("iiii", { family: "sans-serif" }, 20)).toBeCloseTo(width("iiii", {}, 20), 3);
});

test.skipIf(!real)("installed families are found by name", () => {
  const installed = fontFamilies().find((f) => /^(DejaVu Sans Mono|Liberation Mono|Noto Sans Mono)$/.test(f));
  if (!installed) return;
  expect(width("iiii", { family: installed }, 20)).toBeCloseTo(width("MMMM", { family: installed }, 20), 1);
});

// ---- variable fonts and features ---------------------------------------------------

test.skipIf(!real)("a variable family covers every weight on its wght axis", () => {
  expect(width("x", { family: "NB Var", weight: 400 })).toBeCloseTo(50, 1);
  expect(width("x", { family: "NB Var", weight: 900 })).toBeCloseTo(90, 1);
  expect(width("x", { family: "NB Var", weight: 100 })).toBeCloseTo(30, 1);
  expect(width("x", { family: "NB Var", weight: 650 })).toBeCloseTo(70, 1);
});

test.skipIf(!real)("fontVariations sets other axes, and wins over the weight", () => {
  expect(width("x", { family: "NB Var", variations: "wdth 50" })).toBeCloseTo(25, 1);
  expect(width("x", { family: "NB Var", variations: '"wght" 900' })).toBeCloseTo(90, 1);
  expect(width("x", { family: "NB Var", weight: 100, variations: "wght=900, wdth=50" })).toBeCloseTo(65, 1);
});

/** NB Var's "x" in px at size 100 for a wght coordinate (the axis is linear on each side of 400). */
const varX = (wght: number) => (wght >= 400 ? 50 + ((wght - 400) * 40) / 500 : 30 + ((wght - 100) * 20) / 300);
/** 300 distinct weights over NB Var's axis: each one a face, more than the face table holds. */
const manyWeights = Array.from({ length: 300 }, (_, i) => 100 + Math.round(i * 2.67));

test.skipIf(!real)("animating a variable axis keeps every width exact and the font tables bounded", () => {
  setup();
  const native = loadNative();
  // Each distinct weight and variation string is a face of its own: far more than the table holds.
  // Advances are whole pixels (hinted), hence a pixel of tolerance; a wrong face is tens off.
  // ~150 ms: every new weight asks fontconfig for the UI font once (see FONTS.md).
  for (const w of manyWeights) {
    if (Math.abs(width("x", { family: "NB Var", weight: w }) - varX(w)) > 1) throw new Error(`weight ${w}`);
  }
  for (let i = 0; i < 400; i++) { // more than the 256 variation lists
    const wght = 100 + i * 2;
    if (Math.abs(width("x", { family: "NB Var", variations: `wght ${wght}` }) - varX(wght)) > 1) throw new Error(`wght ${wght}`);
  }
  expect(width("x", { family: "NB Var", weight: 650 })).toBeCloseTo(70, 1);
  expect(width("x", { family: "NB Var", variations: "wdth 50" })).toBeCloseTo(25, 1);
  expect(width("x", { family: "NB Test" })).toBeCloseTo(50, 1);
  const stats = native.fontStats();
  expect(stats.faces).toBeLessThan(255);
  expect(stats.variations).toBeLessThan(256);
});

test.skipIf(!real)("fontFeatures turns OpenType features on and off", () => {
  expect(width("1", { family: "NB Test" })).toBeCloseTo(30, 1);
  expect(width("1", { family: "NB Test", features: "tnum" })).toBeCloseTo(60, 1);
  expect(width("1", { family: "NB Test", features: '"tnum" 1' })).toBeCloseTo(60, 1);
  expect(width("ff", { family: "NB Test" })).toBeCloseTo(40, 1); // the "liga" ligature
  expect(width("ff", { family: "NB Test", features: "-liga" })).toBeCloseTo(60, 1);
  expect(width("ff", { family: "NB Test", features: '"liga" 0, tnum' })).toBeCloseTo(60, 1);
});

// ---- widgets ------------------------------------------------------------------------

test("fontFamily, fontFeatures and fontVariations are inherited and reach the text command", () => {
  const { root } = mount(() => (
    <Column fontFamily="Inter, sans-serif" fontFeatures="tnum">
      <Text>inherited</Text>
      <Text fontFamily="Mono" fontVariations="wdth 75">own</Text>
      <Text>{"plain"}</Text>
    </Column>
  ));
  expect(commandsOf(root, "text").map((t) => [t.text, t.family, t.features, t.variations])).toEqual([
    ["inherited", "Inter, sans-serif", "tnum", ""],
    ["own", "Mono", "tnum", "wdth 75"],
    ["plain", "Inter, sans-serif", "tnum", ""],
  ]);
});

test("a text without family, features or variations sends none", () => {
  const { root } = mount(() => <Text>abc</Text>);
  expect(commandsOf(root, "text")[0]).toMatchObject({ family: "", features: "", variations: "" });
});

test("Canvas text takes family, features and variations options", () => {
  const { root } = mount(() => (
    <Canvas width={100} height={40} draw={(g) => g.text("1", 0, 0, "#000", 12, false, { family: "NB Test", features: "tnum", variations: "wdth 50" })} />
  ));
  expect(commandsOf(root, "text")[0]).toMatchObject({ family: "NB Test", features: "tnum", variations: "wdth 50" });
});

test("Canvas text inherits the family, features and variations around it (so charts follow the app's font)", () => {
  const [family, setFamily] = createSignal("NB Test");
  const { root, relayout } = mount(() => (
    <Column fontFamily={family} fontFeatures="tnum" fontVariations="wdth 50">
      <Canvas width={100} height={40} draw={(g) => {
        g.text("a", 0, 0, "#000");
        g.text("b", 0, 20, "#000", 12, false, { family: "Other", features: "" });
      }} />
    </Column>
  ));
  const fonts = () => commandsOf(root, "text").map((t) => [t.text, t.family, t.features, t.variations]);
  expect(fonts()).toEqual([["a", "NB Test", "tnum", "wdth 50"], ["b", "Other", "", "wdth 50"]]);
  setFamily("NB Fallback");
  relayout();
  expect(fonts()[0]).toEqual(["a", "NB Fallback", "tnum", "wdth 50"]);
});

test("TextField draws its text and placeholder with the inherited family", () => {
  const { root } = mount(() => (
    <Column fontFamily="NB Test" fontFeatures="tnum">
      <TextField value={() => "typed"} onInput={() => {}} />
      <TextField value={() => ""} onInput={() => {}} placeholder="hint" />
    </Column>
  ));
  expect(commandsOf(root, "text").map((t) => [t.text, t.family, t.features])).toEqual([["typed", "NB Test", "tnum"], ["hint", "NB Test", "tnum"]]);
});

test.skipIf(!real)("Text lays out with the registered family's metrics", () => {
  setup();
  const restore = useRealTextMetrics();
  try {
    const { root } = mount(() => (
      <Column align="start">
        <Text fontFamily="NB Test" fontSize={20}>xx</Text>
        <Text fontFamily="NB Test" fontSize={20} bold>xx</Text>
      </Column>
    ));
    const [plain, bold] = root.children[0]!.children;
    expect(plain!.width).toBeCloseTo(20, 1);
    expect(bold!.width).toBeCloseTo(28, 1);
  } finally {
    restore();
  }
});

// ---- pixels ---------------------------------------------------------------------------

/** Columns with ink (alpha > 128) on row `y`. */
function inkColumns(shot: ReturnType<typeof screenshot>, y: number): number[] {
  const xs: number[] = [];
  for (let x = 0; x < shot.width; x++) if (shot.pixel(x, y)[3]! > 128) xs.push(x);
  return xs;
}

test.skipIf(!shots)("pixels: the registered font's glyphs are drawn (the box of 'x')", () => {
  setup();
  const shot = screenshot(() => (
    <Column align="start" padding={10}>
      <Text fontFamily="NB Test" fontSize={100} color="#000000">x</Text>
    </Column>
  ), { width: 120, height: 120 });
  // The box spans 50 px from the left padding, 50 px up from the baseline (80 px below the top).
  const row = inkColumns(shot, 10 + 80 - 25);
  expect(row[0]).toBe(10);
  expect(row.at(-1)).toBe(59);
});

test.skipIf(!shots)("pixels: a missing bold is synthesized (thicker), a missing italic slanted", () => {
  setup();
  const shoot = (props: { bold?: boolean; italic?: boolean }) => screenshot(() => (
    <Column align="start" padding={20}>
      <Text fontFamily="NB Fallback" fontSize={100} color="#000000" {...props}>x</Text>
    </Column>
  ), { width: 80, height: 140 });
  // NB Fallback's "x" is a 10 x 50 px box with only a regular face.
  const plain = shoot({}), bold = shoot({ bold: true }), italic = shoot({ italic: true });
  const mid = 20 + 80 - 25;
  expect(inkColumns(plain, mid).length).toBe(10);
  expect(inkColumns(bold, mid).length).toBeGreaterThan(11);
  const top = inkColumns(italic, 20 + 80 - 48), bottom = inkColumns(italic, 20 + 80 - 2);
  expect(top[0]! - bottom[0]!).toBeGreaterThan(5); // the top leans right
});

test.skipIf(!shots)("pixels: a glyph larger than the atlas is still drawn (downscaled in it), without crashing", () => {
  setup();
  // NB Fallback's "x" at 2400 is a 240 x 1200 px box: taller than the 1024 px atlas.
  expect(width("x", { family: "NB Fallback" }, 2400)).toBeCloseTo(240, 0);
  const shot = screenshot(() => (
    <Column align="start" padding={10}>
      <Text fontFamily="NB Fallback" fontSize={2400} color="#000000">x</Text>
    </Column>
  ), { width: 280, height: 2440 });
  const baseline = 10 + 1920; // ascent: 800 units
  for (const y of [baseline - 1100, baseline - 600, baseline - 100]) {
    const row = inkColumns(shot, y);
    expect(row[0]).toBeLessThanOrEqual(11);
    expect(row.at(-1)).toBeGreaterThanOrEqual(248);
    expect(row.length).toBeGreaterThan(236);
  }
  expect(inkColumns(shot, baseline + 20)).toEqual([]);
});

test.skipIf(!shots)("pixels: more weights in one frame than the face table holds are all drawn with their own face", () => {
  setup();
  // 300 "x" boxes of NB Var at size 20, weights 100..898: each one a face, evicted as the frame goes.
  const weights = manyWeights;
  const shot = screenshot(() => (
    <Box width={600} height={300}>
      {weights.map((w, i) => (
        <Text position="absolute" left={(i % 20) * 30} top={Math.floor(i / 20) * 20} fontFamily="NB Var" fontWeight={w}
          fontSize={20} color="#000000">x</Text>
      ))}
    </Box>
  ), { width: 600, height: 300 });
  for (const i of [0, 150, 299]) {
    const left = (i % 20) * 30, y = Math.floor(i / 20) * 20 + 16 - 3; // baseline 16 px below the top
    const ink = inkColumns(shot, y).filter((x) => x >= left && x < left + 30);
    expect(ink[0]).toBe(left);
    expect(Math.abs(ink.length - varX(weights[i]!) / 5)).toBeLessThanOrEqual(1);
  }
});
