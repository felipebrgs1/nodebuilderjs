import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Column, Icon, UINode, createRoot, createSignal, layout, parseSvg, renderSvg, setTextMeasurer } from "@nodebuilderjs/core";
import { insert } from "@nodebuilderjs/core/jsx-runtime";
import { setImageBackend } from "../../src/image/source.js";
import { setOutputColorSpace } from "../../src/render/color.js";
import { decodePng } from "../../src/image/png.js";
import { commandsOf } from "../helpers.js";

setTextMeasurer((text) => ({ width: text.length * 8, ascent: 15, descent: 5 }));

const fixture = (name: string) => readFileSync(new URL(`../fixtures/svg/${name}`, import.meta.url));
const BLACK = [0, 0, 0, 1] as const;
const alpha = (svg: string, w = 4, h = 4) => Array.from(renderSvg(parseSvg(svg), w, h, { color: BLACK }).data.filter((_, i) => i % 4 === 3));
const wrap = (body: string, box = "0 0 4 4") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}">${body}</svg>`;

// Real Lucide and Phosphor icons against librsvg's rendering of the same files.
test.each([
  "lucide-camera", "lucide-circle-power", "lucide-qr-code", "lucide-search",
  "phosphor-heart", "phosphor-heart-duotone", "phosphor-star-fill", "phosphor-gear-thin",
])("SVG icon matches librsvg: %s", (name) => {
  const svg = parseSvg(fixture(`svg-${name}.svg`).toString());
  expect(svg.monochrome).toBe(true);
  for (const px of [24, 48]) {
    const ours = renderSvg(svg, px, px, { color: BLACK });
    const ref = decodePng(new Uint8Array(fixture(`svg-${name}-${px}.png`)));
    let sum = 0, max = 0;
    for (let i = 3; i < ours.data.length; i += 4) {
      const d = Math.abs(ours.data[i]! - ref.data[i]!);
      sum += d;
      max = Math.max(max, d);
    }
    expect(sum / (px * px)).toBeLessThan(4); // mean alpha difference out of 255: antialiasing only
    expect(max).toBeLessThan(64);
  }
});

test("SVG fill coverage is exact on pixel edges and halves", () => {
  expect(alpha(wrap('<rect x="1" y="1" width="2" height="2" />'))).toEqual([
    0, 0, 0, 0,
    0, 255, 255, 0,
    0, 255, 255, 0,
    0, 0, 0, 0,
  ]);
  const half = alpha(wrap('<rect x="0.5" y="0" width="1" height="4" />'));
  expect(half.slice(0, 4)).toEqual([128, 128, 0, 0]);
});

test("SVG fill rules, opacity and colors", () => {
  // Two squares wound the same way: nonzero fills the middle, evenodd leaves a hole.
  const squares = "M0 0H4V4H0Z M1 1H3V3H1Z";
  expect(alpha(wrap(`<path d="${squares}" />`))[5]).toBe(255);
  expect(alpha(wrap(`<path d="${squares}" fill-rule="evenodd" />`))[5]).toBe(0);
  expect(alpha(wrap('<rect width="4" height="4" opacity="0.5" />'))[0]).toBe(128);
  expect(alpha(wrap('<rect width="4" height="4" style="fill-opacity:.25" />'))[0]).toBe(64);
  const red = renderSvg(parseSvg(wrap('<rect width="4" height="4" fill="#ff0000" />')), 1, 1);
  expect(Array.from(red.data)).toEqual([255, 0, 0, 255]);
  expect(parseSvg(wrap('<rect width="4" height="4" fill="#ff0000" />')).monochrome).toBe(false);
  expect(parseSvg(wrap('<g color="red"><rect width="4" height="4" fill="currentColor" /></g>')).monochrome).toBe(false);
  expect(parseSvg(wrap('<rect width="4" height="4" fill="currentColor" />')).monochrome).toBe(true);
});

test("SVG paths: arcs, curves, transforms and errors", () => {
  const area = (svg: string, size = 100) => renderSvg(parseSvg(svg), size, size, { color: BLACK }).data.reduce((a, v, i) => (i % 4 === 3 ? a + v / 255 : a), 0);
  const box = "0 0 100 100";
  // A circle drawn as two arcs covers pi*r^2.
  expect(area(wrap('<path d="M10 50a40 40 0 1 0 80 0a40 40 0 1 0-80 0" />', box)) / (Math.PI * 1600)).toBeCloseTo(1, 2);
  expect(area(wrap('<circle cx="50" cy="50" r="40" />', box)) / (Math.PI * 1600)).toBeCloseTo(1, 2);
  // Compact arc flags ("011") and implicit commands parse like browsers.
  expect(area(wrap('<path d="M10 50a40 40 0 1 0 80 0a40,40,0,1,0-80,0z" />', box))).toBeCloseTo(area(wrap('<circle cx="50" cy="50" r="40" />', box)), -1);
  // A cubic approximating a quarter circle (kappa 0.5523) closes a quadrant.
  expect(area(wrap('<path d="M0 0L100 0C100 55.23 55.23 100 0 100Z" />', box)) / (Math.PI * 2500)).toBeCloseTo(1, 2);
  expect(area(wrap('<g transform="translate(50 0) scale(0.5)"><rect width="100" height="100" /></g>', box))).toBeCloseTo(2500, -1);
  // Everything before a syntax error is drawn.
  expect(area(wrap('<path d="M0 0H50V50H0Z M60 60 L foo" />', box))).toBeCloseTo(2500, -1);
});

test("SVG strokes: caps and joins", () => {
  const box = "0 0 100 100";
  const area = (body: string) => renderSvg(parseSvg(wrap(body, box)), 100, 100, { color: BLACK }).data.reduce((a, v, i) => (i % 4 === 3 ? a + v / 255 : a), 0);
  const line = (cap: string) => area(`<line x1="20" y1="50" x2="80" y2="50" stroke="#000" stroke-width="10" stroke-linecap="${cap}" />`);
  expect(line("butt")).toBeCloseTo(600, -1);
  expect(line("square")).toBeCloseTo(700, -1);
  expect(line("round")).toBeCloseTo(600 + Math.PI * 25, -1);
  // Overlapping stroke pieces are unioned, not drawn twice (no darker joints with opacity).
  const corner = (join: string) => area(`<polyline points="20,80 50,20 80,80" fill="none" stroke="#000" stroke-width="10" stroke-linejoin="${join}" />`);
  expect(corner("miter")).toBeGreaterThan(corner("round"));
  expect(corner("round")).toBeGreaterThan(corner("bevel"));
  // A zero-length subpath with round caps is a dot (Lucide draws dots like this).
  expect(area('<path d="M50 50h0" stroke="#000" stroke-width="10" stroke-linecap="round" />')).toBeCloseTo(Math.PI * 25, -1);
});

test("Lucide icon data renders like the SVG file", () => {
  const data = [
    ["path", { d: "M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z" }],
    ["circle", { cx: "12", cy: "13", r: "3" }],
  ] as const;
  const fromData = renderSvg(parseSvg(data), 24, 24, { color: BLACK });
  const fromFile = renderSvg(parseSvg(fixture("svg-lucide-camera.svg").toString()), 24, 24, { color: BLACK });
  expect(Buffer.from(fromData.data).equals(Buffer.from(fromFile.data))).toBe(true);
});

// ---- the widget ------------------------------------------------------------------------

function mount(view: () => any) {
  const root = new UINode("root");
  root.isRoot = true;
  const dispose = createRoot((d) => {
    insert(root, view);
    return d;
  });
  const node = root.children[0]!;
  layout(node, 400, 300);
  return { node, dispose };
}

test("Icon: sized like the viewBox, tinted with the inherited color", () => {
  const camera = fixture("svg-lucide-camera.svg").toString();
  const wide = wrap('<rect width="8" height="4" fill="currentColor" />', "0 0 8 4");
  const { node } = mount(() => (
    <Column align="start" color="#ff0000">
      <Icon svg={camera} />
      <Icon svg={camera} size={32} color="#0000ff" />
      <Icon svg={wide} size={10} />
    </Column>
  ));
  expect(node.children.map((c) => [c.width, c.height])).toEqual([[20, 20], [32, 32], [20, 10]]);
  const [a, b] = commandsOf(node, "image");
  expect(a!.tint).toEqual([1, 0, 0, 1]); // red from the Column
  expect(b!.tint).toEqual([0, 0, 1, 1]);
});

test("Icon: changing the color reuses the texture, resizing re-rasterizes, unmounting frees it", () => {
  let created = 0;
  const destroyed: number[] = [];
  setImageBackend({ create: () => ++created, destroy: (id) => destroyed.push(id) });
  const [color, setColor] = createSignal("#ff0000");
  const [size, setSize] = createSignal(20);
  const { node, dispose } = mount(() => (
    <Column align="start">
      <Icon svg={fixture("svg-lucide-search.svg").toString()} size={size} color={color} />
    </Column>
  ));
  const first = commandsOf(node, "image")[0]!;
  setColor("#00ff00");
  const recolored = commandsOf(node, "image")[0]!;
  expect(recolored.id).toBe(first.id); // same texture
  expect(recolored.tint).toEqual([0, 1, 0, 1]);
  expect(created).toBe(1);
  setSize(24);
  layout(node, 400, 300);
  const resized = commandsOf(node, "image")[0]!;
  expect(resized.w).toBe(24);
  expect(created).toBe(2);
  expect(destroyed).toEqual([first.id]);
  dispose();
  expect(destroyed).toEqual([first.id, resized.id]);
});

test("Icon: a broken SVG warns and draws nothing", () => {
  const warn = console.warn;
  const warnings: string[] = [];
  console.warn = (m: string) => warnings.push(m);
  try {
    const { node } = mount(() => <Column><Icon svg="no-such-icon.svg" /></Column>);
    expect(commandsOf(node, "image")).toEqual([]);
    expect(warnings[0]).toMatch(/could not load icon no-such-icon\.svg/);
  } finally {
    console.warn = warn;
  }
});

// Lucide draws outlines: fill="none" on the root, strokes in currentColor.
const lucide = (body: string, root = 'fill="none"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${root} stroke="currentColor" stroke-width="2">${body}</svg>`;
const PLAY = '<path d="M6 3 20 12 6 21 6 3z" />';
const pixel = (bitmap: { width: number; data: Uint8Array }, x: number, y: number) =>
  Array.from(bitmap.data.slice((y * bitmap.width + x) * 4, (y * bitmap.width + x) * 4 + 4));

test("SVG fill option fills what the root left unfilled and keeps the stroke", () => {
  const play = parseSvg(lucide(PLAY));
  const outline = renderSvg(play, 24, 24, { color: BLACK });
  expect(pixel(outline, 10, 12)[3]).toBe(0); // inside the triangle: empty
  expect(pixel(outline, 5, 12)).toEqual([0, 0, 0, 255]); // the stroke
  const solid = renderSvg(play, 24, 24, { color: BLACK, fill: "current" });
  expect(pixel(solid, 10, 12)).toEqual([0, 0, 0, 255]);
  expect(pixel(solid, 5, 12)).toEqual([0, 0, 0, 255]);
  expect(pixel(solid, 2, 2)[3]).toBe(0); // outside stays empty
  const red = renderSvg(play, 24, 24, { color: BLACK, fill: [1, 0, 0, 1] });
  expect(pixel(red, 10, 12)).toEqual([255, 0, 0, 255]);
  expect(pixel(red, 5, 12)).toEqual([0, 0, 0, 255]); // stroke drawn over the fill
  // Also when the root says it in style="".
  const styled = parseSvg(lucide(PLAY, 'style="fill: none"'));
  expect(pixel(renderSvg(styled, 24, 24, { color: BLACK, fill: "current" }), 10, 12)[3]).toBe(255);
});

test("SVG fill option keeps fills a shape sets itself, none included", () => {
  const own = parseSvg(lucide('<path d="M6 3 20 12 6 21 6 3z" fill="#00ff00" /><rect x="0" y="0" width="4" height="4" fill="none" stroke="none" />'));
  const solid = renderSvg(own, 24, 24, { color: BLACK, fill: "current" });
  expect(pixel(solid, 10, 12)).toEqual([0, 255, 0, 255]);
  expect(pixel(solid, 2, 2)[3]).toBe(0);
});

test("Icon fill: reactive, re-rasterizes, keeps tinting; a color fill is painted in", () => {
  const created: Uint8Array[] = [];
  setImageBackend({ create: (_w, _h, rgba) => (created.push(rgba), created.length), destroy: () => {} });
  const [fill, setFill] = createSignal<boolean | string>(false);
  const { node } = mount(() => (
    <Column align="start" color="#0000ff">
      <Icon svg={lucide(PLAY)} size={24} fill={fill} />
    </Column>
  ));
  const interior = (i: number) => pixel({ width: 24, data: created[i]! }, 10, 12);
  commandsOf(node, "image"); // textures are made when painting
  expect(created.length).toBe(1);
  expect(interior(0)[3]).toBe(0);
  setFill(true);
  const image = commandsOf(node, "image")[0]!;
  expect(created.length).toBe(2);
  expect(interior(1)).toEqual([255, 255, 255, 255]); // white, tinted on the GPU
  expect(image.tint).toEqual([0, 0, 1, 1]);
  setFill("#ff0000");
  expect(commandsOf(node, "image")[0]!.tint).toEqual([1, 1, 1, 1]);
  expect(created.length).toBe(3);
  expect(interior(2)).toEqual([255, 0, 0, 255]);
  expect(pixel({ width: 24, data: created[2]! }, 5, 12)).toEqual([0, 0, 255, 255]); // stroke in the icon color
  setFill(false);
  commandsOf(node, "image");
  expect(created.length).toBe(4);
  expect(interior(3)[3]).toBe(0);
});

test("Icon colors painted into the bitmap stay sRGB on a P3 surface (the renderer converts textures)", () => {
  const created: Uint8Array[] = [];
  setImageBackend({ create: (_w, _h, rgba) => (created.push(rgba), created.length), destroy: () => {} });
  setOutputColorSpace("display-p3");
  try {
    const { node } = mount(() => (
      <Column align="start" color="#0000ff">
        <Icon svg={lucide(PLAY)} size={24} fill="#ff0000" />
      </Column>
    ));
    commandsOf(node, "image");
    expect(pixel({ width: 24, data: created[0]! }, 10, 12)).toEqual([255, 0, 0, 255]);
    expect(pixel({ width: 24, data: created[0]! }, 5, 12)).toEqual([0, 0, 255, 255]);
  } finally {
    setOutputColorSpace("srgb");
  }
});
