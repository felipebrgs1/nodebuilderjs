// CSS colors -> RGBA numbers in a color space. Hex and named colors are sRGB, as in CSS;
// `color(display-p3 ...)`, `color(srgb ...)`, `oklch()` and `oklab()` reach past sRGB. Paint
// encodes every color for the output space (the window's surface): Display P3 when the compositor
// takes a P3 surface, sRGB otherwise, where colors it cannot show are clipped.

import { createSignal } from "../reactive/signals.js";

export type ColorSpace = "srgb" | "display-p3";
export type Rgba = [number, number, number, number];

const MAGENTA: Rgba = [1, 0, 1, 1];
const named: Record<string, string> = { transparent: "#0000", white: "#fff", black: "#000" };

let output: ColorSpace = "srgb"; // read by paint without tracking
const [space, setSpace] = createSignal<ColorSpace>("srgb");
const caches: Record<ColorSpace, Map<string, Rgba>> = { srgb: new Map(), "display-p3": new Map() };

/** The space paint encodes colors in: what the window's surface took (run() sets it). Reactive. */
export function outputColorSpace(): ColorSpace {
  return space();
}

export function setOutputColorSpace(next: ColorSpace) {
  output = next;
  setSpace(next);
}

/** `css` in `space`, clipped to it (0..1); magenta when malformed. Cached. */
export function colorIn(css: string, space: ColorSpace = output): Rgba {
  const cache = caches[space];
  let rgba = cache.get(css);
  if (rgba) return rgba;
  const parsed = parse(css);
  if (!parsed) rgba = MAGENTA;
  else {
    const [r, g, b] = space === parsed.space ? parsed.rgb : convert(parsed.rgb, parsed.space, space);
    rgba = [clip(r), clip(g), clip(b), clip(parsed.alpha)];
  }
  cache.set(css, rgba);
  return rgba;
}

/** `css` as extended sRGB (channels may leave 0..1 for colors sRGB cannot show), or null. */
export function extendedSrgb(css: string): Rgba | null {
  const parsed = parse(css);
  if (!parsed) return null;
  const [r, g, b] = parsed.space === "srgb" ? parsed.rgb : convert(parsed.rgb, parsed.space, "srgb");
  return [r, g, b, clip(parsed.alpha)];
}

/** An extended sRGB color as CSS: hex when sRGB can show it, `color(display-p3 ...)` otherwise. */
export function formatColor(rgba: readonly number[]): string {
  const [r, g, b] = rgba as Rgba;
  const a = clip(rgba[3]!);
  const inside = [r, g, b].every((v) => v >= -0.5 / 255 && v <= 1 + 0.5 / 255);
  if (inside) {
    const hex = (v: number) => Math.round(clip(v) * 255).toString(16).padStart(2, "0");
    return `#${hex(r)}${hex(g)}${hex(b)}${hex(a)}`;
  }
  const p3 = convert([r, g, b], "srgb", "display-p3").map((v) => +clip(v).toFixed(4));
  return `color(display-p3 ${p3.join(" ")}${a < 1 ? ` / ${+a.toFixed(4)}` : ""})`;
}

// ---- parsing ------------------------------------------------------------------

type Parsed = { space: ColorSpace; rgb: [number, number, number]; alpha: number };

function parse(css: string): Parsed | null {
  const c = (named[css] ?? css).trim();
  if (c.startsWith("#")) return parseHex(c.slice(1));
  const fn = /^([a-z-]+)\(\s*(.*?)\s*\)$/i.exec(c);
  if (!fn) return null;
  const name = fn[1]!.toLowerCase();
  const [main, alphaPart, extra] = fn[2]!.split("/");
  if (extra !== undefined) return null;
  const parts = main!.trim().split(/\s+/);
  const alpha = alphaPart === undefined ? 1 : number(alphaPart.trim(), 1);
  if (alpha === null) return null;
  if (name === "color") {
    const space = parts.shift();
    if ((space !== "srgb" && space !== "display-p3") || parts.length !== 3) return null;
    const rgb = parts.map((p) => number(p, 1));
    if (rgb.some((v) => v === null)) return null;
    return { space, rgb: rgb as [number, number, number], alpha };
  }
  if ((name === "oklch" || name === "oklab") && parts.length === 3) {
    const l = number(parts[0]!, 1);
    let a: number | null, b: number | null;
    if (name === "oklab") {
      a = number(parts[1]!, 0.4);
      b = number(parts[2]!, 0.4);
    } else {
      const chroma = number(parts[1]!, 0.4);
      const hue = angle(parts[2]!);
      if (chroma === null || hue === null) return null;
      a = chroma * Math.cos(hue);
      b = chroma * Math.sin(hue);
    }
    if (l === null || a === null || b === null) return null;
    return { space: "srgb", rgb: oklabToLinearSrgb(l, a, b).map(encode) as [number, number, number], alpha };
  }
  return null;
}

function parseHex(hex: string): Parsed | null {
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map((h) => h + h).join("");
  if (hex.length === 6) hex += "ff";
  if (hex.length !== 8 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const n = parseInt(hex, 16);
  return { space: "srgb", rgb: [((n >>> 24) & 255) / 255, ((n >>> 16) & 255) / 255, ((n >>> 8) & 255) / 255], alpha: (n & 255) / 255 };
}

/** A number, or a percentage of `full`. */
function number(s: string, full: number): number | null {
  const pct = s.endsWith("%");
  const v = Number(pct ? s.slice(0, -1) : s);
  if (!s || !Number.isFinite(v)) return null;
  return pct ? (v / 100) * full : v;
}

/** Hue in radians: degrees by default, or deg/rad/turn/grad. */
function angle(s: string): number | null {
  const m = /^(-?[\d.]+(?:e-?\d+)?)(deg|rad|turn|grad)?$/i.exec(s);
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return null;
  const unit = (m[2] ?? "deg").toLowerCase();
  return unit === "rad" ? v : unit === "turn" ? v * 2 * Math.PI : unit === "grad" ? (v * Math.PI) / 200 : (v * Math.PI) / 180;
}

// ---- conversion -----------------------------------------------------------------

const clip = (v: number) => Math.min(1, Math.max(0, v));

// sRGB and Display P3 share the sRGB transfer function; extended to negatives by symmetry (CSS).
function decode(v: number): number {
  const a = Math.abs(v);
  return Math.sign(v) * (a <= 0.04045 ? a / 12.92 : ((a + 0.055) / 1.055) ** 2.4);
}

function encode(v: number): number {
  const a = Math.abs(v);
  return Math.sign(v) * (a <= 0.0031308 ? a * 12.92 : 1.055 * a ** (1 / 2.4) - 0.055);
}

// Linear-light matrices through XYZ (D65), from the CSS Color 4 sample code.
const SRGB_TO_P3 = [
  [0.8224619687143623, 0.17753803128563775, 0],
  [0.0331941989445893, 0.9668058010554107, 0],
  [0.017082630989143, 0.0723974407005512, 0.9105199282911694],
];
const P3_TO_SRGB = [
  [1.2249401762805598, -0.22494017628055996, 0],
  [-0.04205695470968816, 1.0420569547096882, 0],
  [-0.019637554590334432, -0.07863604555063188, 1.0982736001409577],
];

function convert(rgb: readonly number[], from: ColorSpace, to: ColorSpace): [number, number, number] {
  if (from === to) return rgb as [number, number, number];
  const m = from === "srgb" ? SRGB_TO_P3 : P3_TO_SRGB;
  const lin = rgb.map(decode);
  return m.map((row) => encode(row[0]! * lin[0]! + row[1]! * lin[1]! + row[2]! * lin[2]!)) as [number, number, number];
}

// Björn Ottosson's OKLab -> linear sRGB.
function oklabToLinearSrgb(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
