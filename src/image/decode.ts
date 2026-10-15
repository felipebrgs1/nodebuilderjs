// Picks the decoder from the file's signature: PNG, JPEG and WebP in TypeScript, AVIF and
// HEIC through the platform (libheif on Linux).

import { loadNative } from "../runtime/native.js";
import { type ColorProfile, applyColorProfile } from "./icc.js";
import { decodeJpeg, isJpeg } from "./jpeg.js";
import { type Bitmap, decodePng, isPng } from "./png.js";
import { decodeWebp, isWebp } from "./webp.js";

// ISO base media files ("ftyp" box) whose brand says AVIF or HEIC.
const HEIF_BRANDS = new Set(["avif", "avis", "heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1"]);

function isHeif(bytes: Uint8Array): boolean {
  if (bytes.length < 12 || String.fromCharCode(...bytes.subarray(4, 8)) !== "ftyp") return false;
  return HEIF_BRANDS.has(String.fromCharCode(...bytes.subarray(8, 12)));
}

/**
 * Decodes PNG, JPEG and WebP (in TypeScript) or AVIF/HEIC (system libheif) to RGBA. Throws on
 * failure. The file's color profile is applied: `colorSpace` is "display-p3" for P3 images and
 * for other wide-gamut RGB profiles (converted to P3), unset (sRGB) otherwise.
 */
export function decodeImage(bytes: Uint8Array): Bitmap {
  const { profile, ...bitmap } = decodeWithProfile(bytes);
  return applyColorProfile(bitmap, profile);
}

function decodeWithProfile(bytes: Uint8Array): Bitmap & { profile?: ColorProfile } {
  if (isPng(bytes)) return decodePng(bytes);
  if (isJpeg(bytes)) return decodeJpeg(bytes);
  if (isWebp(bytes)) return decodeWebp(bytes);
  if (isHeif(bytes)) {
    const { icc, cicp, ...bitmap } = loadNative().decodeImage(bytes);
    return { ...bitmap, profile: { icc, cicp } };
  }
  throw new Error("unknown image format (supported: PNG, JPEG, WebP, AVIF, HEIC)");
}

