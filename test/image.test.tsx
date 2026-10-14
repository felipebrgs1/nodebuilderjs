import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Column, Image, Show, UINode, createRoot, createSignal, decodeImage, layout, setTextMeasurer } from "@nodebuilderjs/core";
import { insert } from "@nodebuilderjs/core/jsx-runtime";
import { setImageBackend } from "../src/image/source.js";
import { loadNative } from "../src/runtime/native.js";
import { commandsOf } from "./helpers.js";

setTextMeasurer((text) => ({ width: text.length * 8, ascent: 15, descent: 5 }));

const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url);
const read = (name: string) => new Uint8Array(readFileSync(fixture(name)));

// Expected pixels (13x9) were written as raw files; the PNGs were encoded by ImageMagick.
function expected(raw: string, channels: number): Uint8Array {
  const src = read(raw);
  const out = new Uint8Array(13 * 9 * 4);
  for (let i = 0; i < 13 * 9; i++) {
    const p = src.subarray(i * channels, i * channels + channels);
    const [r, g, b, a] = channels === 4 ? p : channels === 3 ? [p[0], p[1], p[2], 255] : channels === 2 ? [p[0], p[0], p[0], p[1]] : [p[0], p[0], p[0], 255];
    out.set([r!, g!, b!, a!], i * 4);
  }
  return out;
}

/** Fully transparent pixels may carry any color; compare only their alpha. */
function same(actual: Uint8Array, wanted: Uint8Array) {
  const norm = (d: Uint8Array) => d.map((v, i) => (d[i - (i % 4) + 3] === 0 && i % 4 !== 3 ? 0 : v));
  expect(Array.from(norm(actual))).toEqual(Array.from(norm(wanted)));
}

test.each([
  ["rgba8.png", "rgba.raw", 4],
  ["rgba8-interlaced.png", "rgba.raw", 4],
  ["rgba16.png", "rgba.raw", 4],
  ["palette.png", "rgba.raw", 4],
  ["palette2.png", "rgba.raw", 4],
  ["rgb8.png", "rgb.raw", 3],
  ["rgb16-interlaced.png", "rgb.raw", 3],
  ["gray1.png", "gray.raw", 1],
  ["gray-alpha.png", "ga.raw", 2],
] as const)("PNG decoder: %s", (png, raw, channels) => {
  const bitmap = decodeImage(read(png));
  expect([bitmap.width, bitmap.height]).toEqual([13, 9]);
  same(bitmap.data, expected(raw, channels));
});

test("decodeImage picks the decoder from the file's signature", () => {
  expect(decodeImage(read("jpeg-s420.jpg")).width).toBe(37);
  expect(decodeImage(read("webp-lossy.webp")).width).toBe(37);
  expect(() => decodeImage(new Uint8Array([1, 2, 3]))).toThrow(/unknown image format/);
});

// AVIF/HEIC go through the system's libheif via the addon; each is skipped where libheif or
// its decoder plugin for that format (dav1d/aom, libde265) is missing.
const decodes = (file: string) => {
  try {
    loadNative().decodeImage(read(file));
    return true;
  } catch {
    return false;
  }
};

for (const file of ["avif-lossless.avif", "heic-lossless.heic"]) {
  test.skipIf(!decodes(file))(`${file.split(".")[1]!.toUpperCase()} (libheif), lossless round trip`, () => {
    const bitmap = decodeImage(read(file));
    expect([bitmap.width, bitmap.height]).toEqual([13, 9]);
    same(bitmap.data, expected("rgba.raw", 4));
  });
}

function mount(view: () => any, width = 400, height = 300) {
  const root = new UINode("root");
  root.isRoot = true;
  const dispose = createRoot((d) => {
    insert(root, view);
    return d;
  });
  const node = root.children[0]!;
  layout(node, width, height);
  return { node, dispose };
}

test("Image sizes itself from the file and keeps the aspect ratio", () => {
  const { node } = mount(() => (
    <Column align="start">
      <Image src={fixture("rgba8.png")} />
      <Image src={fixture("rgba8.png")} width={26} />
      <Image src={fixture("rgba8.png")} height={36} />
    </Column>
  ));
  expect(node.children.map((c) => [c.width, c.height])).toEqual([[13, 9], [26, 18], [52, 36]]);
});

test("Image fit: contain centers, cover crops, fill stretches", () => {
  const { node } = mount(() => (
    <Column align="start">
      <Image src={fixture("rgba8.png")} width={26} height={36} />
      <Image src={fixture("rgba8.png")} width={26} height={36} fit="cover" radius={4} opacity={0.5} />
      <Image src={fixture("rgba8.png")} width={26} height={36} fit="fill" />
    </Column>
  ));
  const [contain, cover, fill] = commandsOf(node, "image");
  expect(contain).toMatchObject({ x: 0, y: 9, w: 26, h: 18, uv: [0, 0, 1, 1] });
  // 13x9 scaled by 4 to cover 26x36 -> 52x36, half the width shows.
  expect(cover).toMatchObject({ x: 0, y: 36, w: 26, h: 36, uv: [0.25, 0, 0.75, 1], tint: [1, 1, 1, 0.5], radius: 4 });
  expect(fill).toMatchObject({ x: 0, y: 72, w: 26, h: 36, uv: [0, 0, 1, 1] });
  expect(new Set([contain!.id, cover!.id, fill!.id]).size).toBe(1); // one texture for one file
});

test("Image textures are shared and freed with the last user", () => {
  const created: number[] = [];
  const destroyed: number[] = [];
  let next = 100;
  setImageBackend({ create: () => (created.push(next), next++), destroy: (id) => destroyed.push(id) });
  const [show, setShow] = createSignal(true);
  const [src, setSrc] = createSignal(fixture("rgb8.png"));
  const { node, dispose } = mount(() => (
    <Column>
      <Image src={src} />
      <Show when={show}>
        <Image src={fixture("rgb8.png")} />
      </Show>
    </Column>
  ));
  commandsOf(node, "image");
  expect(created).toEqual([100]);
  setShow(false);
  expect(destroyed).toEqual([]); // still shown by the first Image
  setSrc(fixture("gray1.png"));
  expect(destroyed).toEqual([100]);
  layout(node, 400, 300);
  commandsOf(node, "image");
  expect(created).toEqual([100, 101]);
  dispose();
  expect(destroyed).toEqual([100, 101]);
});

test("a missing image draws nothing and does not throw", () => {
  const warn = console.warn;
  const warnings: string[] = [];
  console.warn = (msg: string) => warnings.push(msg);
  try {
    const { node } = mount(() => <Column><Image src="does-not-exist.png" width={20} height={20} /></Column>);
    expect(commandsOf(node, "image")).toEqual([]);
    expect(node.children[0]!.height).toBe(20);
    expect(warnings[0]).toMatch(/could not load .*does-not-exist\.png/);
  } finally {
    console.warn = warn;
  }
});
