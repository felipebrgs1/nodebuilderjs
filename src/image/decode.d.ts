import { type Bitmap } from "./png.js";
/** Decodes PNG, JPEG and WebP (in TypeScript) or AVIF/HEIC (system libheif) to RGBA. Throws on failure. */
export declare function decodeImage(bytes: Uint8Array): Bitmap;
