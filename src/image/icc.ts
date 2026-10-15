// ICC color profiles of images: RGB matrix/TRC profiles (what cameras, phones and editors
// embed: sRGB, Display P3, Adobe RGB, ProPhoto) are read; LUT-based profiles (print, CMYK) are
// not and leave the image as sRGB. An image whose profile is sRGB or Display P3 keeps its
// pixels and is tagged; any other RGB profile is converted to Display P3 (wide enough for
// photos; past it, clipped). The writer makes the profile screenshots embed.

import type { ColorSpace } from "../render/color.js";
import type { Bitmap } from "./png.js";

type Vec3 = [number, number, number];
type Mat3 = [Vec3, Vec3, Vec3]; // rows
type Curve = (x: number) => number;

// ---- colorimetry -------------------------------------------------------------------

const D50: Vec3 = [0.9642, 1, 0.8249]; // the ICC profile connection space's white
const D65_XY: [number, number] = [0.3127, 0.329];

type Primaries = { r: [number, number]; g: [number, number]; b: [number, number]; white: [number, number] };
const SRGB: Primaries = { r: [0.64, 0.33], g: [0.3, 0.6], b: [0.15, 0.06], white: D65_XY };
const P3: Primaries = { r: [0.68, 0.32], g: [0.265, 0.69], b: [0.15, 0.06], white: D65_XY };
/** Adobe RGB (1998); fixtures and tests use it as "some other RGB profile". */
export const ADOBE_RGB: Primaries = { r: [0.64, 0.33], g: [0.21, 0.71], b: [0.15, 0.06], white: D65_XY };

const xyz = ([x, y]: [number, number]): Vec3 => [x / y, 1, (1 - x - y) / y];

function mul(a: Mat3, b: Mat3): Mat3 {
  return a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j]! + row[1] * b[1][j]! + row[2] * b[2][j]!)) as Mat3;
}

function apply(m: Mat3, v: Vec3): Vec3 {
  return m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]) as Vec3;
}

function invert(m: Mat3): Mat3 | null {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return [
    [A / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [C / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

const diag = (v: Vec3): Mat3 => [[v[0], 0, 0], [0, v[1], 0], [0, 0, v[2]]];

const BRADFORD: Mat3 = [
  [0.8951, 0.2664, -0.1614],
  [-0.7502, 1.7135, 0.0367],
  [0.0389, -0.0685, 1.0296],
];

/** Bradford chromatic adaptation from white `from` to white `to` (XYZ). */
function adaptation(from: Vec3, to: Vec3): Mat3 {
  const s = apply(BRADFORD, from), d = apply(BRADFORD, to);
  return mul(mul(invert(BRADFORD)!, diag([d[0] / s[0], d[1] / s[1], d[2] / s[2]])), BRADFORD);
}

/** Linear RGB -> XYZ adapted to D50 (the matrix an ICC profile stores as its colorants). */
function toXyzD50(p: Primaries): Mat3 {
  const cols = [xyz(p.r), xyz(p.g), xyz(p.b)];
  const m: Mat3 = [0, 1, 2].map((i) => cols.map((c) => c[i]!)) as Mat3;
  const white = xyz(p.white);
  const s = apply(invert(m)!, white);
  const scaled = m.map((row) => [row[0] * s[0], row[1] * s[1], row[2] * s[2]]) as Mat3;
  return mul(adaptation(white, D50), scaled);
}

const SRGB_D50 = toXyzD50(SRGB);
const P3_D50 = toXyzD50(P3);
const XYZ_D50_TO_P3 = invert(P3_D50)!;

const srgbDecode: Curve = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const srgbEncode: Curve = (x) => (x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055);

// ---- reading -----------------------------------------------------------------------

export interface IccProfile {
  /** Linear RGB -> XYZ (D50). */
  matrix: Mat3;
  /** Encoded value (0..1) -> linear light, per channel. */
  curves: [Curve, Curve, Curve];
}

/** The matrix/TRC part of an RGB profile, or null for anything else (or a broken file). */
export function parseIcc(bytes: Uint8Array): IccProfile | null {
  try {
    return read(bytes);
  } catch {
    return null;
  }
}

function read(b: Uint8Array): IccProfile | null {
  if (b.length < 132) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag4 = (at: number) => String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
  if (tag4(36) !== "acsp" || tag4(16) !== "RGB " || tag4(20) !== "XYZ ") return null;
  const count = view.getUint32(128);
  if (count > 1000 || 132 + count * 12 > b.length) return null;
  const tags = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    const at = 132 + i * 12;
    const offset = view.getUint32(at + 4), size = view.getUint32(at + 8);
    if (offset + size > b.length || size < 8) continue;
    tags.set(tag4(at), b.subarray(offset, offset + size));
  }
  const colorant = (name: string): Vec3 | null => {
    const t = tags.get(name);
    if (!t || t.length < 20 || tag4At(t, 0) !== "XYZ ") return null;
    const v = new DataView(t.buffer, t.byteOffset, t.byteLength);
    return [s15(v, 8), s15(v, 12), s15(v, 16)];
  };
  const r = colorant("rXYZ"), g = colorant("gXYZ"), bl = colorant("bXYZ");
  if (!r || !g || !bl) return null;
  const curves = ["rTRC", "gTRC", "bTRC"].map((n) => {
    const t = tags.get(n);
    return t ? curve(t) : null;
  });
  if (curves.some((c) => !c)) return null;
  const matrix: Mat3 = [
    [r[0], g[0], bl[0]],
    [r[1], g[1], bl[1]],
    [r[2], g[2], bl[2]],
  ];
  if (!invert(matrix)) return null;
  return { matrix, curves: curves as [Curve, Curve, Curve] };
}

function tag4At(b: Uint8Array, at: number) {
  return String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
}

const s15 = (v: DataView, at: number) => v.getInt32(at) / 65536;

/** A `curv` or `para` tag as a function on 0..1. */
function curve(t: Uint8Array): Curve | null {
  const v = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const type = tag4At(t, 0);
  if (type === "curv") {
    const n = v.getUint32(8);
    if (12 + n * 2 > t.length) return null;
    if (n === 0) return (x) => x;
    if (n === 1) {
      const gamma = v.getUint16(12) / 256;
      return (x) => x ** gamma;
    }
    const table = Float64Array.from({ length: n }, (_, i) => v.getUint16(12 + i * 2) / 65535);
    return (x) => {
      const p = Math.min(1, Math.max(0, x)) * (n - 1);
      const i = Math.min(n - 2, Math.floor(p));
      return table[i]! + (table[i + 1]! - table[i]!) * (p - i);
    };
  }
  if (type === "para") {
    const fn = v.getUint16(8);
    const counts = [1, 3, 4, 5, 7];
    if (fn > 4 || 12 + counts[fn]! * 4 > t.length) return null;
    const [g, a = 1, b = 0, c = 0, d = 0, e = 0, f = 0] = Array.from({ length: counts[fn]! }, (_, i) => s15(v, 12 + i * 4));
    const pow = (x: number) => (x > 0 ? x ** g! : 0);
    switch (fn) {
      case 0:
        return pow;
      case 1:
        return (x) => (x >= -b / a ? pow(a * x + b) : 0);
      case 2:
        return (x) => (x >= -b / a ? pow(a * x + b) + c : c);
      case 3:
        return (x) => (x >= d ? pow(a * x + b) : c * x);
      default:
        return (x) => (x >= d ? pow(a * x + b) + e : c * x + f);
    }
  }
  return null;
}

// ---- applying ----------------------------------------------------------------------

const near = (a: Mat3, b: Mat3, tolerance: number) => a.every((row, i) => row.every((v, j) => Math.abs(v - b[i]![j]!) <= tolerance));

function srgbCurves(p: IccProfile): boolean {
  for (let i = 0; i <= 16; i++) {
    const x = i / 16;
    if (p.curves.some((c) => Math.abs(c(x) - srgbDecode(x)) > 0.002)) return false;
  }
  return true;
}

/** What the profile's pixels are: one of ours as is, or "other" (to convert). */
export function profileSpace(p: IccProfile): ColorSpace | "other" {
  if (!srgbCurves(p)) return "other";
  // Profiles round the colorants to s15Fixed16 and adapt them with slightly different
  // matrices: a few thousandths apart is the same space.
  if (near(p.matrix, SRGB_D50, 0.004)) return "srgb";
  if (near(p.matrix, P3_D50, 0.004)) return "display-p3";
  return "other";
}

/**
 * `bitmap` with its ICC profile applied: tagged "display-p3" (pixels as they are, or converted
 * from another RGB profile to Display P3), or unchanged (sRGB, or a profile we cannot read).
 */
export function applyIccProfile(bitmap: Bitmap, icc: Uint8Array): Bitmap {
  const profile = parseIcc(icc);
  if (!profile) return bitmap;
  const space = profileSpace(profile);
  if (space === "srgb") return bitmap;
  if (space === "display-p3") return { ...bitmap, colorSpace: "display-p3" };
  convertToP3(bitmap.data, bitmap.width * bitmap.height, profile);
  return { ...bitmap, colorSpace: "display-p3" };
}

/** In place: `count` RGBA pixels from the profile's RGB to Display P3 (alpha kept). */
function convertToP3(data: Uint8Array, count: number, p: IccProfile) {
  const m = mul(XYZ_D50_TO_P3, p.matrix);
  const lin = p.curves.map((c) => Float64Array.from({ length: 256 }, (_, i) => c(i / 255)));
  const ENC = 4096;
  const enc = Uint8Array.from({ length: ENC + 1 }, (_, i) => Math.round(srgbEncode(i / ENC) * 255));
  const [lr, lg, lb] = lin as [Float64Array, Float64Array, Float64Array];
  const [m0, m1, m2] = m;
  const out = (v: number) => enc[Math.round(Math.min(1, Math.max(0, v)) * ENC)]!;
  for (let i = 0, o = 0; i < count; i++, o += 4) {
    const r = lr[data[o]!]!, g = lg[data[o + 1]!]!, b = lb[data[o + 2]!]!;
    data[o] = out(m0[0] * r + m0[1] * g + m0[2] * b);
    data[o + 1] = out(m1[0] * r + m1[1] * g + m1[2] * b);
    data[o + 2] = out(m2[0] * r + m2[1] * g + m2[2] * b);
  }
}

/** A decoded file's color information, for decodeImage to apply. */
export interface ColorProfile {
  icc?: Uint8Array;
  /** ITU-T H.273 color primaries and transfer characteristics. */
  cicp?: [number, number];
}

/** `bitmap` with `profile` applied (CICP wins over ICC, as PNG specifies). */
export function applyColorProfile(bitmap: Bitmap, profile: ColorProfile | undefined): Bitmap {
  if (profile?.cicp) {
    const space = cicpSpace(profile.cicp[0], profile.cicp[1]);
    return space === "display-p3" ? { ...bitmap, colorSpace: space } : bitmap;
  }
  return profile?.icc ? applyIccProfile(bitmap, profile.icc) : bitmap;
}

/**
 * The color space a CICP code (ITU-T H.273: PNG cICP, AVIF/HEIF nclx) gives an RGB image, or
 * null when it is neither of ours (wide gamut HDR: left as is).
 */
export function cicpSpace(primaries: number, transfer: number): ColorSpace | null {
  // Transfer 13 is sRGB's; 1, 6 and 14/15 (BT.709 family) are close enough for SDR images,
  // and 2 means "unspecified".
  if (![1, 2, 6, 13, 14, 15].includes(transfer)) return null;
  if (primaries === 1 || primaries === 2) return "srgb";
  if (primaries === 12) return "display-p3";
  return null;
}

// ---- writing -----------------------------------------------------------------------

export interface IccOptions {
  primaries: Primaries;
  description: string;
  /**
   * Default: the sRGB curve (a `para` type 3). A number: a pure gamma; an array: a `curv` table
   * (0..1); three arrays: one table per channel.
   */
  curve?: number | number[] | [number[], number[], number[]];
}

/** A v4 matrix/TRC display profile. */
export function writeIcc(options: IccOptions): Uint8Array {
  const tags: [string, Uint8Array][] = [];
  const mluc = (text: string) => {
    const t = new Uint8Array(28 + text.length * 2);
    const v = new DataView(t.buffer);
    t.set([0x6d, 0x6c, 0x75, 0x63]); // "mluc"
    v.setUint32(8, 1);
    v.setUint32(12, 12);
    t.set([0x65, 0x6e, 0x55, 0x53], 16); // en US
    v.setUint32(20, text.length * 2);
    v.setUint32(24, 28);
    for (let i = 0; i < text.length; i++) v.setUint16(28 + i * 2, text.charCodeAt(i));
    return t;
  };
  const xyzTag = (x: Vec3) => {
    const t = new Uint8Array(20);
    const v = new DataView(t.buffer);
    t.set([0x58, 0x59, 0x5a, 0x20]); // "XYZ "
    x.forEach((n, i) => v.setInt32(8 + i * 4, Math.round(n * 65536)));
    return t;
  };
  const m = toXyzD50(options.primaries);
  const chad = adaptation(xyz(options.primaries.white), D50);
  const sf32 = new Uint8Array(8 + 36);
  sf32.set([0x73, 0x66, 0x33, 0x32]); // "sf32"
  chad.flat().forEach((n, i) => new DataView(sf32.buffer).setInt32(8 + i * 4, Math.round(n * 65536)));
  const trcTag = (c: number | number[] | undefined): Uint8Array => {
    if (Array.isArray(c)) {
      const t = new Uint8Array(12 + c.length * 2);
      const v = new DataView(t.buffer);
      t.set([0x63, 0x75, 0x72, 0x76]); // "curv"
      v.setUint32(8, c.length);
      c.forEach((n, i) => v.setUint16(12 + i * 2, Math.round(Math.min(1, Math.max(0, n)) * 65535)));
      return t;
    }
    if (typeof c === "number") {
      const t = new Uint8Array(16);
      const v = new DataView(t.buffer);
      t.set([0x63, 0x75, 0x72, 0x76]);
      v.setUint32(8, 1);
      v.setUint16(12, Math.round(c * 256));
      return t;
    }
    const t = new Uint8Array(12 + 5 * 4);
    const v = new DataView(t.buffer);
    t.set([0x70, 0x61, 0x72, 0x61]); // "para"
    v.setUint16(8, 3);
    [2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045].forEach((n, i) => v.setInt32(12 + i * 4, Math.round(n * 65536)));
    return t;
  };
  const c = options.curve;
  const perChannel = Array.isArray(c) && Array.isArray(c[0]);
  const shared = perChannel ? null : trcTag(c as number | number[] | undefined);
  const trcs = [0, 1, 2].map((i) => shared ?? trcTag((c as number[][])[i]));
  tags.push(["desc", mluc(options.description)], ["cprt", mluc("No copyright, use freely")], ["wtpt", xyzTag(D50)], ["chad", sf32]);
  tags.push(["rXYZ", xyzTag([m[0][0], m[1][0], m[2][0]])], ["gXYZ", xyzTag([m[0][1], m[1][1], m[2][1]])], ["bXYZ", xyzTag([m[0][2], m[1][2], m[2][2]])]);
  tags.push(["rTRC", trcs[0]!], ["gTRC", trcs[1]!], ["bTRC", trcs[2]!]); // shared bytes are written once

  const table = 4 + tags.length * 12;
  const offsets = new Map<Uint8Array, number>();
  let size = 128 + table;
  for (const [, data] of tags) {
    if (offsets.has(data)) continue;
    offsets.set(data, size);
    size += (data.length + 3) & ~3;
  }
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  const ascii = (at: number, s: string) => [...s].forEach((ch, i) => (out[at + i] = ch.charCodeAt(0)));
  v.setUint32(0, size);
  v.setUint32(8, 0x04300000); // v4.3
  ascii(12, "mntr");
  ascii(16, "RGB ");
  ascii(20, "XYZ ");
  ascii(36, "acsp");
  D50.forEach((n, i) => v.setInt32(68 + i * 4, Math.round(n * 65536)));
  v.setUint32(128, tags.length);
  tags.forEach(([name, data], i) => {
    ascii(132 + i * 12, name);
    v.setUint32(136 + i * 12, offsets.get(data)!);
    v.setUint32(140 + i * 12, data.length);
  });
  for (const [data, at] of offsets) out.set(data, at);
  return out;
}

let p3Profile: Uint8Array | undefined;

/** The Display P3 profile (sRGB curve) that P3 screenshots embed. */
export function displayP3Profile(): Uint8Array {
  return (p3Profile ??= writeIcc({ primaries: P3, description: "Display P3" }));
}

export const PRIMARIES = { srgb: SRGB, "display-p3": P3 } as const;
