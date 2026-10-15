// Image sources: decoding, a cache shared by every <Image> showing the same file, and
// the GPU handle lifecycle (created at first paint, freed when the last user unmounts).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeImage } from "./decode.js";
import type { Bitmap } from "./png.js";
import type { ColorSpace } from "../render/color.js";
import { invalidate } from "../render/node.js";

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
  /** The backend that made `handle`. */
  owner: ImageBackend | null;
  pixels: Uint8Array | null;
  /** What the pixels mean (the decoded file's profile; sRGB by default). */
  colorSpace: ColorSpace;
  refs: number;
  key: unknown;
}

/** Where pixels go: the native core in an app, a counter in headless tests. */
export interface ImageBackend {
  create(width: number, height: number, rgba: Uint8Array, colorSpace: ColorSpace): number;
  destroy(handle: number): void;
  /** Keep the decoded pixels after `create`, so another backend can upload them later. */
  keepsPixels?: boolean;
}

let nextHandle = 1;
// Headless default: keeps the pixels, so a screenshot taken after a test painted the tree
// can still upload them to the native core.
const headless: ImageBackend = { create: () => nextHandle++, destroy: () => {}, keepsPixels: true };
let backend = headless;

/** null goes back to the headless default. */
export function setImageBackend(b: ImageBackend | null) {
  backend = b ?? headless;
}

export function imageBackend(): ImageBackend {
  return backend;
}

const cache = new Map<unknown, ImageSource>();

function cacheKey(input: ImageInput): unknown {
  if (typeof input === "string") return resolve(input);
  if (input instanceof URL) return input.protocol === "file:" ? fileURLToPath(input) : input.href;
  return input; // bytes and bitmaps: by identity
}

function load(input: ImageInput, key: unknown): ImageSource {
  const source: ImageSource = { width: 0, height: 0, handle: 0, owner: null, pixels: null, colorSpace: "srgb", refs: 0, key };
  return decodeInto(source, input, key);
}

function decodeInto(source: ImageSource, input: ImageInput, key: unknown): ImageSource {
  try {
    let bitmap: Bitmap;
    if (input instanceof Uint8Array) bitmap = decodeImage(input);
    else if (typeof input === "string" || input instanceof URL) {
      if (typeof key !== "string") throw new Error(`only file paths and file: URLs can be loaded (${String(input)})`);
      bitmap = decodeImage(readFileSync(key));
    } else bitmap = input;
    if (bitmap.data.length < bitmap.width * bitmap.height * 4) throw new Error("bitmap data is smaller than width*height*4");
    return Object.assign(source, { width: bitmap.width, height: bitmap.height, pixels: bitmap.data, colorSpace: bitmap.colorSpace ?? "srgb", error: undefined });
  } catch (err) {
    const error = `${typeof key === "string" ? key : "image"}: ${(err as Error).message}`;
    // A decoder still loading (the web's, fetched on demand): decode again when it is ready.
    const retry = (err as { retry?: Promise<unknown> }).retry;
    if (retry) {
      retry.then(() => {
        if (cache.get(key) !== source) return; // released meanwhile
        decodeInto(source, input, key);
        invalidate();
      });
    } else console.warn(`nodebuilder: could not load ${error}`);
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
  if (source.handle) source.owner?.destroy(source.handle);
  source.handle = 0;
  cache.delete(source.key);
}

/**
 * GPU handle for painting, uploading on first use. The decoded pixels are dropped after
 * upload, unless the backend keeps them; then a later backend (a screenshot's) uploads them again.
 */
export function imageHandle(source: ImageSource): number {
  if (source.handle && source.owner !== backend && source.pixels) {
    source.owner?.destroy(source.handle);
    source.handle = 0;
  }
  if (!source.handle && source.pixels) {
    source.handle = backend.create(source.width, source.height, source.pixels, source.colorSpace);
    source.owner = backend;
    if (!backend.keepsPixels) source.pixels = null;
  }
  return source.handle;
}
