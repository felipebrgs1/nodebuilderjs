import type { Bitmap } from "./png.js";
export declare function isWebp(bytes: Uint8Array): boolean;
export declare function decodeWebp(bytes: Uint8Array): Bitmap;
