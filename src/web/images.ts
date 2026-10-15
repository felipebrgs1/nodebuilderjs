// Images on the web: the browser decodes them (faster than our decoders, with the file's color
// profile applied) but only asynchronously. boot() decodes the app's files ahead of time, so
// the synchronous decodeImage() finds them here by their bytes.

import type { Bitmap } from "../image/png.js";

const decoded = new WeakMap<Uint8Array, Bitmap>();

/** Files boot() has the browser decode. */
export const browserDecoded = (path: string) => /\.(png|apng|jpe?g|webp|gif|bmp|avif|heic|heif)$/i.test(path);

export function rememberDecoded(bytes: Uint8Array, bitmap: Bitmap) {
  decoded.set(bytes, bitmap);
}

export const decodedByBrowser = (bytes: Uint8Array): Bitmap | undefined => decoded.get(bytes);

export async function predecode(bytes: Uint8Array): Promise<void> {
  try {
    const bitmap = await createImageBitmap(new Blob([bytes.slice()]), { premultiplyAlpha: "none", colorSpaceConversion: "default" });
    const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    rememberDecoded(bytes, { width: bitmap.width, height: bitmap.height, data: new Uint8Array(data.buffer) });
    bitmap.close();
  } catch {
    // Left to decodeImage: the TypeScript decoders, or its error.
  }
}

/** native.decodeImage (AVIF/HEIC): only what the browser decoded ahead of time. */
export function decodedImage(bytes: Uint8Array) {
  const image = decoded.get(bytes);
  if (!image) throw new Error("this browser could not decode the image (or it was not loaded ahead: only imported files are)");
  return image;
}
