// Linear gradients: `background={{ linear: [...], angle }}` and Canvas `g.linearGradient()`.
// The command buffer gets a GRADIENT op right before the shape it fills; the renderer colors
// that shape's vertices along the gradient line (pixels checked with screenshot()).
import { afterEach, expect, test } from "bun:test";
import { Box, Canvas, Column, createSignal, setTheme, theme } from "@nodebuilderjs/core";
import { canScreenshot, interact, mount, screenshot } from "@nodebuilderjs/core/testing";
import { parseColor } from "../src/render/paint.js";
import { drawCommands } from "./helpers.js";

afterEach(() => setTheme("light"));

const BLACK: [number, number, number, number] = [0, 0, 0, 1];
const WHITE: [number, number, number, number] = [1, 1, 1, 1];

test("a gradient background emits GRADIENT (line + stops) and then a white RECT with the box's shape", () => {
  const { root } = mount(() => (
    <Column align="start">
      <Box width={100} height={40} radius={8} background={{ linear: ["#000000", "#ffffff"], angle: 180 }} />
    </Column>
  ));
  const [gradient, rect] = drawCommands(root);
  expect(gradient).toEqual({ op: "gradient", x0: 50, y0: 0, x1: 50, y1: 40, stops: [{ offset: 0, color: BLACK }, { offset: 1, color: WHITE }] });
  expect(rect).toMatchObject({ op: "rect", x: 0, y: 0, w: 100, h: 40, color: WHITE, radius: 8 });
});

test("angle follows CSS: 0 points up, 90 right, 180 (default) down; corners land on 0 and 1", () => {
  const line = (angle: number | undefined, w: number, h: number) => {
    const { root } = mount(() => (
      <Column align="start">
        <Box width={w} height={h} background={{ linear: ["#000", "#fff"], angle }} />
      </Column>
    ));
    const g = drawCommands(root)[0]!;
    if (g.op !== "gradient") throw new Error("expected a gradient");
    return [g.x0, g.y0, g.x1, g.y1];
  };
  expect(line(undefined, 100, 40)).toEqual([50, 0, 50, 40]);
  expect(line(0, 100, 40)).toEqual([50, 40, 50, 0]);
  expect(line(90, 100, 40)).toEqual([0, 20, 100, 20]);
  expect(line(270, 100, 40)).toEqual([100, 20, 0, 20]);
  // 45deg on a square: the line is the diagonal, so the corners are exactly 0 and 1.
  expect(line(45, 100, 100)).toEqual([0, 100, 100, 0]);
  // On a rectangle the CSS length is |w sin| + |h cos|: the perpendicular through a corner hits 0.
  const [x0, y0, x1, y1] = line(45, 200, 100);
  const half = (200 + 100) * Math.SQRT1_2 / 2;
  expect([x0, y0, x1, y1].map((v) => Math.round(v))).toEqual([Math.round(100 - half * Math.SQRT1_2), Math.round(50 + half * Math.SQRT1_2), Math.round(100 + half * Math.SQRT1_2), Math.round(50 - half * Math.SQRT1_2)]);
});

test("stops without an offset are spread evenly between their neighbours, like CSS; offsets never go back", () => {
  const offsets = (stops: any[]) => {
    const { root } = mount(() => (
      <Column align="start">
        <Box width={10} height={10} background={{ linear: stops }} />
      </Column>
    ));
    const g = drawCommands(root)[0]!;
    if (g.op !== "gradient") throw new Error("expected a gradient");
    return g.stops.map((s) => s.offset);
  };
  expect(offsets(["#f00", "#0f0", "#00f"])).toEqual([0, 0.5, 1]);
  expect(offsets(["#f00", ["#0f0", 0.3], "#00f", "#fff"])).toEqual([0, 0.3, 0.65, 1]);
  expect(offsets([["#f00", 0.2], ["#0f0", 0.1], ["#00f", 0.8]])).toEqual([0.2, 0.2, 0.8]);
  expect(offsets(["#f00"])).toEqual([0]);
});

test("opacity fades the stops; the border stays a solid color over the gradient; the shadow stays solid", () => {
  const { root } = mount(() => (
    <Column align="start">
      <Box width={20} height={20} opacity={0.5} borderWidth={2} borderColor="#00ff00" shadow={{ color: "#000000", blur: 4 }}
        background={{ linear: ["#ff0000", "#0000ff"], angle: 90 }} />
    </Column>
  ));
  const cmds = drawCommands(root);
  expect(cmds.map((c) => c.op)).toEqual(["shadow", "gradient", "rect"]);
  const [shadow, gradient, rect] = cmds;
  expect(shadow).toMatchObject({ color: [0, 0, 0, 0.5] });
  expect(gradient).toMatchObject({ stops: [{ color: [1, 0, 0, 0.5] }, { color: [0, 0, 1, 0.5] }] });
  expect(rect).toMatchObject({ color: [1, 1, 1, 1], borderWidth: 2, borderColor: [0, 1, 0, 0.5] });
});

test("a gradient background is reactive like any style value, and theme colors inside follow setTheme", () => {
  const [fancy, setFancy] = createSignal(false);
  const { root } = mount(() => (
    <Column align="start">
      <Box width={10} height={10} background={() => (fancy() ? { linear: [theme.accent.base, theme.window.background] } : "#123456")} />
    </Column>
  ));
  expect(drawCommands(root).map((c) => c.op)).toEqual(["rect"]);
  setFancy(true);
  const light = drawCommands(root)[0]!;
  expect(light).toMatchObject({ op: "gradient", stops: [{ color: parseColor(theme.accent.base).map(r3) }, { color: parseColor(theme.window.background).map(r3) }] });
  setTheme("dark");
  const dark = drawCommands(root)[0]!;
  expect(dark).toMatchObject({ op: "gradient", stops: [{ color: parseColor(theme.accent.base).map(r3) }, { color: parseColor(theme.window.background).map(r3) }] });
  expect(dark).not.toEqual(light);
});

test("hoverStyle can switch a color background to a gradient and back", () => {
  const { root } = mount(() => (
    <Column align="start">
      <Box width={40} height={20} background="#123456" hoverStyle={{ background: { linear: ["#000", "#fff"], angle: 90 } }} />
    </Column>
  ));
  const ui = interact(root);
  const box = root.children[0]!.children[0]!;
  expect(drawCommands(root).map((c) => c.op)).toEqual(["rect"]);
  ui.hover(box);
  expect(drawCommands(root)[0]).toMatchObject({ op: "gradient", x0: 0, y0: 10, x1: 40, y1: 10 });
  ui.move(790, 590);
  expect(drawCommands(root).map((c) => c.op)).toEqual(["rect"]);
});

const r3 = (v: number) => Math.round(v * 1000) / 1000;

test("a gradient is not a plain color: parseColor rejects it, and so do color props' types", () => {
  expect(() => parseColor({ linear: ["#000", "#fff"] } as any)).toThrow(/gradient/);
  mount(() => (
    <Column>
      {/* @ts-expect-error borders are solid colors */}
      <Box borderColor={{ linear: ["#000", "#fff"] }} />
      {/* @ts-expect-error text color is a solid color */}
      <Box color={{ linear: ["#000", "#fff"] }} />
    </Column>
  ), { width: 10, height: 10 });
});

test("Canvas: g.linearGradient() fills rect, polygon, circle, arc and lines, in canvas coordinates", () => {
  const { root } = mount(() => (
    <Column align="start" padding={10}>
      <Canvas width={100} height={50} draw={(g) => {
        const fill = g.linearGradient(0, 0, 100, 0, ["#ff0000", ["#0000ff", 1]]);
        g.rect(0, 0, 100, 50, fill, 4);
        g.polygon([0, 0, 10, 0, 0, 10], fill);
        g.circle(50, 25, 10, fill);
        g.arc(50, 25, 10, 5, 0, 1, fill);
        g.line(0, 40, 100, 40, fill, 2);
        g.rect(0, 0, 5, 5, "#00ff00");
      }} />
    </Column>
  ));
  const cmds = drawCommands(root);
  expect(cmds.map((c) => c.op)).toEqual(["gradient", "rect", "gradient", "triangles", "gradient", "arc", "gradient", "arc", "gradient", "line", "rect"]);
  for (const c of cmds) {
    if (c.op === "gradient") expect(c).toMatchObject({ x0: 10, y0: 10, x1: 110, y1: 10, stops: [{ offset: 0, color: [1, 0, 0, 1] }, { offset: 1, color: [0, 0, 1, 1] }] });
  }
  // The gradient replaces the color: the shapes it fills are white (triangles keep their AA coverage).
  expect(cmds[1]).toMatchObject({ color: WHITE });
  expect(cmds[3]).toMatchObject({ color: WHITE });
  expect(cmds[10]).toMatchObject({ color: [0, 1, 0, 1] });
});

// ---- pixels (real renderer, offscreen) ----

test.skipIf(!canScreenshot())("pixels: a 180deg black to white gradient is mid gray in the middle and exact at the ends", () => {
  const shot = screenshot(() => (
    <Column align="start">
      <Box width={20} height={100} background={{ linear: ["#000000", "#ffffff"], angle: 180 }} />
    </Column>
  ), { width: 20, height: 100 });
  const near = (got: number[], want: number[], tol = 4) => got.forEach((v, i) => expect(Math.abs(v - want[i]!)).toBeLessThanOrEqual(tol));
  near(shot.pixel(10, 0), [1, 1, 1, 255]);
  near(shot.pixel(10, 99), [254, 254, 254, 255]);
  near(shot.pixel(10, 50), [129, 129, 129, 255]);
  near(shot.pixel(10, 25), [65, 65, 65, 255]);
});

test.skipIf(!canScreenshot())("pixels: a multi-stop gradient passes through every stop", () => {
  const shot = screenshot(() => (
    <Column align="start">
      <Box width={100} height={10} background={{ linear: ["#ff0000", "#00ff00", "#0000ff"], angle: 90 }} />
    </Column>
  ), { width: 100, height: 10 });
  const [r, g, b] = shot.pixel(50, 5);
  expect(g).toBeGreaterThan(245);
  expect(r).toBeLessThan(10);
  expect(b).toBeLessThan(10);
  expect(shot.pixel(25, 5)[0]).toBeGreaterThan(120);
  expect(shot.pixel(25, 5)[1]).toBeGreaterThan(120);
  expect(shot.pixel(75, 5)[2]).toBeGreaterThan(120);
});

test.skipIf(!canScreenshot())("pixels: a rounded gradient box keeps transparent corners and its border", () => {
  const shot = screenshot(() => (
    <Column align="start">
      <Box width={60} height={60} radius={20} borderWidth={3} borderColor="#00ff00" background={{ linear: ["#ff0000", "#0000ff"] }} />
    </Column>
  ), { width: 60, height: 60 });
  expect(shot.pixel(1, 1)[3]).toBe(0);
  expect(shot.pixel(58, 58)[3]).toBe(0);
  expect(shot.pixel(30, 1)).toEqual([0, 255, 0, 255]); // border on the top edge
  const top = shot.pixel(30, 10), bottom = shot.pixel(30, 50);
  expect(top[0]).toBeGreaterThan(top[2]!);
  expect(bottom[2]).toBeGreaterThan(bottom[0]!);
});

test.skipIf(!canScreenshot())("pixels: red to transparent fades through translucent red, never gray (premultiplied)", () => {
  const shot = screenshot(() => (
    <Column align="start">
      <Box width={10} height={100} background={{ linear: ["#ff0000", "transparent"] }} />
    </Column>
  ), { width: 10, height: 100 });
  const [r, g, b, a] = shot.pixel(5, 50);
  expect(Math.abs(a! - 128)).toBeLessThanOrEqual(4);
  expect(r).toBeGreaterThan(250);
  expect(g).toBeLessThan(4);
  expect(b).toBeLessThan(4);
  // A quarter of the way down: still pure red, three quarters opaque.
  const q = shot.pixel(5, 25);
  expect(q[0]).toBeGreaterThan(250);
  expect(Math.abs(q[3]! - 191)).toBeLessThanOrEqual(4);
});

test.skipIf(!canScreenshot())("pixels: a Canvas polygon filled with a horizontal gradient", () => {
  const shot = screenshot(() => (
    <Column align="start">
      <Canvas width={100} height={20} draw={(g) => g.polygon([0, 0, 100, 0, 100, 20, 0, 20], g.linearGradient(0, 0, 100, 0, ["#000000", "#ffffff"]))} />
    </Column>
  ), { width: 100, height: 20 });
  expect(Math.abs(shot.pixel(50, 10)[0]! - 128)).toBeLessThanOrEqual(5);
  expect(shot.pixel(2, 10)[0]).toBeLessThan(12);
  expect(shot.pixel(97, 10)[0]).toBeGreaterThan(243);
});
