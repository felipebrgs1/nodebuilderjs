// image/decode.ts in the browser build (cli/web.ts swaps it in): what the browser decoded
// ahead of time, else the TypeScript decoders, which stay in a chunk fetched the first time
// they are needed (bytes made at runtime). Until then the error carries `retry`, and the
// image source decodes again when it settles.

import type { Bitmap } from "../image/png.js";
import { decodedByBrowser } from "./images.js";

type Decoders = typeof import("../image/decode.js");
let decoders: Decoders | null = null;
let loading: Promise<Decoders> | null = null;

const loadDecoders = () => (loading ??= import("../image/decode.js").then((m) => (decoders = m)));

export function decodeImage(bytes: Uint8Array): Bitmap {
  const bitmap = decodedByBrowser(bytes);
  if (bitmap) return bitmap;
  if (decoders) return decoders.decodeImage(bytes);
  throw Object.assign(new Error("loading the image decoders"), { retry: loadDecoders() });
}
