// CSS colors beyond hex: `color(display-p3 ...)`, `color(srgb ...)`, `oklch()`, `oklab()`, and the
// output color space: paint sends every color encoded for the window's surface (sRGB, or Display
// P3 when the compositor takes a P3 surface), with colors outside it clipped.
import { afterEach, expect, test } from "bun:test";
import { Box, Column, mixColor } from "@nodebuilderjs/core";
import { mount } from "@nodebuilderjs/core/testing";
import { colorIn, extendedSrgb, setOutputColorSpace } from "../../src/render/color.js";
import { parseColor } from "../../src/render/paint.js";
import { drawCommands } from "../helpers.js";

afterEach(() => setOutputColorSpace("srgb"));

const r3 = (c: readonly number[]) => c.map((v) => Math.round(v * 1000) / 1000);

test("hex and named colors are sRGB, as in CSS", () => {
  expect(r3(colorIn("#ff8000", "srgb"))).toEqual([1, 0.502, 0, 1]);
  expect(r3(colorIn("#f008", "srgb"))).toEqual([1, 0, 0, 0.533]);
  expect(colorIn("transparent", "srgb")).toEqual([0, 0, 0, 0]);
});

test("an sRGB color in Display P3 has the same look with smaller numbers (sRGB fits inside P3)", () => {
  // Reference values: CSS Color 4 sample code (colorjs.io).
  expect(r3(colorIn("#ff0000", "display-p3"))).toEqual([0.917, 0.2, 0.139, 1]);
  expect(r3(colorIn("#00ff00", "display-p3"))).toEqual([0.458, 0.985, 0.298, 1]);
  expect(r3(colorIn("#ffffff", "display-p3"))).toEqual([1, 1, 1, 1]);
  expect(r3(colorIn("#808080", "display-p3"))).toEqual([0.502, 0.502, 0.502, 1]);
});

test("color(display-p3 ...) keeps its numbers on a P3 surface and is clipped to sRGB elsewhere", () => {
  expect(r3(colorIn("color(display-p3 1 0 0)", "display-p3"))).toEqual([1, 0, 0, 1]);
  expect(r3(colorIn("color(display-p3 1 0 0)", "srgb"))).toEqual([1, 0, 0, 1]);
  expect(r3(colorIn("color(display-p3 0.5 0.5 0.5 / 0.25)", "srgb"))).toEqual([0.5, 0.5, 0.5, 0.25]);
  // Inside sRGB: converted back, not clipped.
  const red = colorIn("color(display-p3 0.9175 0.2003 0.1386)", "srgb");
  expect(red[0]).toBeCloseTo(1, 2);
  expect(red[1]).toBeCloseTo(0, 2);
  expect(red[2]).toBeCloseTo(0, 2);
});

test("color(srgb ...) and percentages", () => {
  expect(r3(colorIn("color(srgb 1 0.5 0)", "srgb"))).toEqual([1, 0.5, 0, 1]);
  expect(r3(colorIn("color(srgb 100% 50% 0% / 50%)", "srgb"))).toEqual([1, 0.5, 0, 0.5]);
  expect(r3(colorIn("color(display-p3 100% 0% 0%)", "display-p3"))).toEqual([1, 0, 0, 1]);
});

test("oklch() and oklab(): the CSS reference values", () => {
  // sRGB red is oklch(62.8% 0.2577 29.23); blue is oklab(0.452 -0.0325 -0.3115) (Ottosson's tables).
  const red = colorIn("oklch(62.8% 0.2577 29.23)", "srgb");
  expect(red[0]).toBeCloseTo(1, 2);
  expect(red[1]).toBeCloseTo(0, 2);
  expect(red[2]).toBeCloseTo(0, 2);
  const blue = colorIn("oklab(0.452 -0.0325 -0.3115 / 50%)", "srgb");
  expect(blue[0]).toBeCloseTo(0, 2);
  expect(blue[1]).toBeCloseTo(0, 2);
  expect(blue[2]).toBeCloseTo(1, 2);
  expect(blue[3]).toBe(0.5);
  expect(r3(colorIn("oklch(0.628 0.2577 0.0812turn)", "srgb"))).toEqual(r3(colorIn("oklch(62.8% 0.2577 29.23deg)", "srgb")));
  expect(r3(colorIn("oklab(1 0 0)", "srgb"))).toEqual([1, 1, 1, 1]);
  expect(r3(colorIn("oklab(0 0 0)", "srgb"))).toEqual([0, 0, 0, 1]);
  // A chroma sRGB cannot show: clipped there, kept (inside P3) on a P3 surface.
  const vivid = "oklch(0.7 0.25 145)"; // a green past sRGB (its red would be -0.229) but inside P3
  expect(r3(colorIn(vivid, "srgb"))).toEqual([0, 0.764, 0.042, 1]);
  expect(r3(colorIn(vivid, "display-p3"))).toEqual([0.275, 0.751, 0.225, 1]);
});

test("extendedSrgb keeps what sRGB cannot show, for mixing", () => {
  expect(r3(extendedSrgb("oklch(0.7 0.25 145)")!)).toEqual([-0.229, 0.764, 0.042, 1]);
  expect(extendedSrgb("nope")).toBeNull();
});

test("a malformed color is magenta, as before", () => {
  for (const bad of ["color(display-p3 1 0)", "color(rec2020 1 0 0)", "oklch(0.5 0.1)", "oklch(a b c)", "#12345", "rgb"])
    expect(colorIn(bad, "srgb")).toEqual([1, 0, 1, 1]);
});

test("paint encodes colors for the output space", () => {
  const app = () => (
    <Column align="start">
      <Box width={10} height={10} background="#ff0000" />
      <Box width={10} height={10} background="color(display-p3 1 0 0)" />
    </Column>
  );
  const rects = (cmds: any[]) => cmds.filter((c) => c.op === "rect").map((c) => r3(c.color));
  expect(rects(drawCommands(mount(app).root))).toEqual([[1, 0, 0, 1], [1, 0, 0, 1]]);
  setOutputColorSpace("display-p3");
  expect(r3(parseColor("#ff0000"))).toEqual([0.917, 0.2, 0.139, 1]);
  expect(rects(drawCommands(mount(app).root))).toEqual([[0.917, 0.2, 0.139, 1], [1, 0, 0, 1]]);
});

test("mixColor keeps hex for sRGB colors and returns color(display-p3) outside sRGB", () => {
  expect(mixColor("#000000", "#ffffff", 0.5)).toBe("#808080ff");
  const mixed = mixColor("color(display-p3 0 1 0)", "color(display-p3 0 1 0)", 0.5);
  expect(mixed).toMatch(/^color\(display-p3 /);
  expect(r3(colorIn(mixed, "display-p3"))).toEqual([0, 1, 0, 1]);
});
