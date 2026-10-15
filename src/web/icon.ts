// image/icon.ts in the browser build (cli/web.ts swaps it in): a page has no window icon to
// set, so nothing is rasterized and the SVG renderer and decoders stay out of the bundle.

export type { IconImage, IconInput } from "../image/icon.js";
import type { IconImage, IconInput } from "../image/icon.js";

export function iconImages(_input?: IconInput): IconImage[] {
  return [];
}
