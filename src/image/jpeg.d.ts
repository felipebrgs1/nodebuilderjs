import type { Bitmap } from "./png.js";
export declare function isJpeg(bytes: Uint8Array): boolean;
export declare function decodeJpeg(bytes: Uint8Array): Bitmap;
