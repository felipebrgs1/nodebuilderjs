// node:zlib in the browser build: only what the PNG decoder needs.
import { inflate } from "../inflate.js";

export const inflateSync = (data: Uint8Array) => inflate(data);

export function deflateSync(): never {
  throw new Error("deflateSync is not available on the web");
}
