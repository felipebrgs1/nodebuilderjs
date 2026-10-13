// App fonts: font files added to the families `fontFamily` can name, and the list of families.

import { readFileSync } from "node:fs";
import { invalidate, textMetricsChanged } from "../render/node.js";
import { loadNative } from "./native.js";

export interface FontOptions {
  /** The family name to register the faces under (default: the one in the file). */
  family?: string;
  /** The weight the faces cover, or a range for a variable font (default: from the file). */
  weight?: number | [min: number, max: number];
  /** Whether the faces are italic (default: from the file). */
  italic?: boolean;
}

/** A face added by `registerFont`. */
export interface RegisteredFont {
  family: string;
  /** The weights it covers: one weight, or a variable font's `wght` range. */
  weight: [min: number, max: number];
  italic: boolean;
  /** Has a `wght` axis: any weight in the range is drawn as is. */
  variable: boolean;
}

/**
 * Adds a font file to the families `fontFamily` (and Canvas text) can name, like CSS
 * `@font-face`. `source` is a path (an import `with { type: "file" }` works in packaged apps
 * too) or the file's bytes. TrueType, OpenType/CFF, collections (every face), WOFF and WOFF2;
 * variable fonts cover their whole `wght` range. Register every weight and slant of a family
 * under the same name; text picks among them like a browser, and synthesizes the bold and
 * italic the family lacks. Text already on screen is measured and drawn again.
 */
export function registerFont(source: string | Uint8Array | ArrayBuffer, options: FontOptions = {}): RegisteredFont[] {
  const bytes = typeof source === "string" ? readFileSync(source) : source instanceof Uint8Array ? source : new Uint8Array(source);
  const [min, max] = options.weight === undefined ? [0, 0] : typeof options.weight === "number" ? [options.weight, options.weight] : options.weight;
  const clamp = (w: number) => Math.min(1000, Math.max(1, Math.round(w)));
  let faces;
  try {
    faces = loadNative().registerFont(
      bytes, options.family ?? null, min ? clamp(min) : 0, max ? clamp(max) : 0,
      options.italic === undefined ? -1 : options.italic ? 1 : 0,
    );
  } catch (err) {
    const name = typeof source === "string" ? source : "the font bytes";
    throw new Error(`registerFont: ${name}: ${(err as Error).message}`, { cause: err });
  }
  textMetricsChanged();
  invalidate();
  return faces.map((f) => ({ family: f.family, weight: [f.weightMin, f.weightMax], italic: f.italic, variable: f.variable }));
}

/** Every family `fontFamily` can name: the installed ones and the registered ones, sorted, no duplicates. */
export function fontFamilies(): string[] {
  return [...new Set(loadNative().fontFamilies())].sort((a, b) => a.localeCompare(b));
}
