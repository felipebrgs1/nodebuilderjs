// Text in the browser: Canvas2D measures and rasterizes, with the browser's shaping, font
// fallback and color emoji, instead of FreeType + HarfBuzz.

const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded", "emoji", "math", "fangsong"]);
const DEFAULT_FAMILY = "system-ui, sans-serif";

/** A CSS `font` for a font id (weight * 2 + italic) and spec (family list \x1f features \x1f variations) at `px`. */
export function cssFont(font: number, spec: string, px: number): string {
  const weight = font >> 1, italic = font & 1;
  const families = (spec.split("\x1f")[0] ?? "")
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => (GENERIC.has(f) || /^["']/.test(f) ? f : `"${f.replace(/"/g, "")}"`));
  families.push(DEFAULT_FAMILY);
  return `${italic ? "italic " : ""}${weight} ${px}px ${families.join(", ")}`;
}

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function context2d(): Context2D {
  const ctx = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1).getContext("2d") : document.createElement("canvas").getContext("2d");
  if (!ctx) throw new Error("nodebuilder: no 2D canvas context for text");
  return ctx;
}

/** Sets font and letter spacing only when they change (assigning `font` reparses it). */
export function setFont(ctx: Context2D, font: string, spacing: number) {
  if (ctx.font !== font) ctx.font = font;
  const ls = `${spacing}px`;
  if ("letterSpacing" in ctx && ctx.letterSpacing !== ls) ctx.letterSpacing = ls;
}

/** measureText for the Native interface: width with the spacing after every character, font ascent and descent. */
export function createMeasurer() {
  const ctx = context2d();
  return (text: string, size: number, font: number, spacing: number, spec: string): [number, number, number] => {
    setFont(ctx, cssFont(font, spec, size), spacing);
    const m = ctx.measureText(text);
    return [m.width, m.fontBoundingBoxAscent ?? size * 0.9, m.fontBoundingBoxDescent ?? size * 0.25];
  };
}
