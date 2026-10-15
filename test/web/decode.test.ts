// image/decode.ts in the browser build (web/decode.ts): the browser's decodes first, the
// TypeScript decoders in a chunk loaded on demand.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { decodeImage } from "../../src/web/decode.js";
import { rememberDecoded } from "../../src/web/images.js";

const png = () => new Uint8Array(readFileSync(new URL("../fixtures/png/rgb8.png", import.meta.url)));

test("bytes the browser decoded ahead of time come back as they are", () => {
  const bytes = png();
  const bitmap = { width: 1, height: 1, data: new Uint8Array([1, 2, 3, 4]) };
  rememberDecoded(bytes, bitmap);
  expect(decodeImage(bytes)).toBe(bitmap);
});

test("other bytes load the TypeScript decoders: retry when they are ready", async () => {
  const bytes = png();
  let error: (Error & { retry?: Promise<unknown> }) | undefined;
  try {
    decodeImage(bytes);
  } catch (err) {
    error = err as Error;
  }
  expect(error?.retry).toBeInstanceOf(Promise);
  await error!.retry;
  expect(decodeImage(bytes)).toMatchObject({ width: 13, height: 9 });
});
