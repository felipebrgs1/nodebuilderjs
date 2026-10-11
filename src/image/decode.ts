// Picks the decoder from the file's signature: PNG, JPEG and WebP in TypeScript, AVIF and
// HEIC through the platform (libheif on Linux).

import { loadNative } from "../runtime/native.js";
import { decodeJpeg, isJpeg } from "./jpeg.js";
import { type Bitmap, decodePng, isPng } from "./png.js";
import { decodeWebp, isWebp } from "./webp.js";

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

