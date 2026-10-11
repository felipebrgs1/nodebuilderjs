// Image sources: decoding, a cache shared by every <Image> showing the same file, and
// the GPU handle lifecycle (created at first paint, freed when the last user unmounts).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeJpeg, isJpeg } from "./jpeg.js";
import { loadNative } from "./native.js";
import { type Bitmap, decodePng, isPng } from "./png.js";
import { decodeWebp, isWebp } from "./webp.js";

export type { Bitmap } from "./png.js";

/** A file path (relative to the working directory), a file: URL, encoded bytes or decoded pixels. */
export type ImageInput = string | URL | Uint8Array | Bitmap;

export interface ImageSource {
  readonly width: number;
  readonly height: number;
  /** Set when the file could not be read or decoded; the image then draws nothing. */
  readonly error?: string;
  /** GPU handle; 0 until first painted. */
  handle: number;
  pixels: Uint8Array | null;
  refs: number;
  key: unknown;
}

/** Where pixels go: the native core in an app, a counter in headless tests. */
export interface ImageBackend {
  create(width: number, height: number, rgba: Uint8Array): number;
  destroy(handle: number): void;
}

let nextHandle = 1;
let backend: ImageBackend = { create: () => nextHandle++, destroy: () => {} };

export function setImageBackend(b: ImageBackend) {
  backend = b;
}

const cache = new Map<unknown, ImageSource>();

// ISO base media files ("ftyp" box) whose brand says AVIF or HEIC.
const HEIF_BRANDS = new Set(["avif", "avis", "heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1"]);

function isHeif(bytes: Uint8Array): boolean {
  if (bytes.length < 12 || String.fromCharCode(...bytes.subarray(4, 8)) !== "ftyp") return false;
  return HEIF_BRANDS.has(String.fromCharCode(...bytes.subarray(8, 12)));
}

/** Decodes PNG, JPEG and WebP (in TypeScript) or AVIF/HEIC (system libheif) to RGBA. Throws on failure. */
export function decodeImage(bytes: Uint8Array): Bitmap {
  if (isPng(bytes)) return decodePng(bytes);
  if (isJpeg(bytes)) return decodeJpeg(bytes);
  if (isWebp(bytes)) return decodeWebp(bytes);
  if (isHeif(bytes)) return loadNative().decodeImage(bytes);
  throw new Error("unknown image format (supported: PNG, JPEG, WebP, AVIF, HEIC)");
}

function cacheKey(input: ImageInput): unknown {
  if (typeof input === "string") return resolve(input);
  if (input instanceof URL) return input.protocol === "file:" ? fileURLToPath(input) : input.href;
  return input; // bytes and bitmaps: by identity
}

function load(input: ImageInput, key: unknown): ImageSource {
  const source: ImageSource = { width: 0, height: 0, handle: 0, pixels: null, refs: 0, key };
  try {
    let bitmap: Bitmap;
    if (input instanceof Uint8Array) bitmap = decodeImage(input);
    else if (typeof input === "string" || input instanceof URL) {
      if (typeof key !== "string") throw new Error(`only file paths and file: URLs can be loaded (${String(input)})`);
      bitmap = decodeImage(readFileSync(key));
    } else bitmap = input;
    if (bitmap.data.length < bitmap.width * bitmap.height * 4) throw new Error("bitmap data is smaller than width*height*4");
    return Object.assign(source, { width: bitmap.width, height: bitmap.height, pixels: bitmap.data });
  } catch (err) {
    const error = `${typeof key === "string" ? key : "image"}: ${(err as Error).message}`;
    console.warn(`nodebuilder: could not load ${error}`);
    return Object.assign(source, { error });
  }
}

/** Takes a reference to the (shared) source for `input`; pair with releaseImage. */
export function acquireImage(input: ImageInput): ImageSource {
  const key = cacheKey(input);
  let source = cache.get(key);
  if (!source) cache.set(key, (source = load(input, key)));
  source.refs++;
  return source;
}

export function releaseImage(source: ImageSource) {
  if (--source.refs > 0) return;
  if (source.handle) backend.destroy(source.handle);
  source.handle = 0;
  cache.delete(source.key);
}

/** GPU handle for painting, uploading on first use. The decoded pixels are dropped after upload. */
export function imageHandle(source: ImageSource): number {
  if (!source.handle && source.pixels) {
    source.handle = backend.create(source.width, source.height, source.pixels);
    source.pixels = null;
  }
  return source.handle;
}
