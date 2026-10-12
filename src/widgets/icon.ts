import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Bitmap, type ImageSource, acquireImage, releaseImage } from "../image/source.js";
import { edges } from "../render/layout.js";
import { type Color, type Handlers, UINode, displayScale, invalidate } from "../render/node.js";
import { parseColor } from "../render/paint.js";
import { type MaybeAccessor, createEffect, onCleanup, read } from "../reactive/signals.js";
import { type IconNode, type Rgba, type Svg, parseSvg, renderSvg } from "../svg/index.js";
import { theme } from "../theme.js";
import { FULL_UV } from "./image.js";
import { type StyleProps, applyProps, inherited } from "./props.js";

/** SVG markup, a path to an .svg file, or Lucide's icon data. */
export type IconInput = string | IconNode;

/** `true` fills with the icon's color (currentColor); a color fills with that color. */
export type IconFill = boolean | Color;

const parsedSvgs = new Map<string, Svg>();
const parsedIconNodes = new WeakMap<IconNode, Svg>();
const svgIds = new WeakMap<Svg, number>();
let nextSvgId = 1;

function loadSvg(input: IconInput): Svg {
  if (typeof input !== "string") {
    let svg = parsedIconNodes.get(input);
    if (!svg) parsedIconNodes.set(input, (svg = parseSvg(input)));
    return svg;
  }
  const markup = input.trimStart().startsWith("<");
  const key = markup ? input : resolve(input);
  let svg = parsedSvgs.get(key);
  if (!svg) parsedSvgs.set(key, (svg = parseSvg(markup ? input : readFileSync(key, "utf8"))));
  return svg;
}

// Rasterized icons by (svg, pixel size, stroke width, fill[, color]); a few hundred are tiny.
const iconBitmaps = new Map<string, Bitmap>();
function iconBitmap(key: string, render: () => Bitmap): Bitmap {
  let bitmap = iconBitmaps.get(key);
  if (bitmap) iconBitmaps.delete(key); // re-insert: most recently used last
  else bitmap = render();
  iconBitmaps.set(key, bitmap);
  if (iconBitmaps.size > 512) iconBitmaps.delete(iconBitmaps.keys().next().value!);
  return bitmap;
}

/**
 * An SVG icon, sized `size` (height; width follows the viewBox) and colored like text:
 * `color` is inherited, so it follows its Button or Text parent. Icons drawn only with
 * currentColor are rasterized once in white and tinted on the GPU, so changing the color
 * is free. Works with Lucide (`lucide-static` files or `lucide` data) and Phosphor.
 * `fill` replaces the root <svg>'s fill, as Lucide's prop does: outline icons become solid.
 */
export function Icon(props: StyleProps & Handlers & { svg: MaybeAccessor<IconInput>; size?: MaybeAccessor<number>; strokeWidth?: MaybeAccessor<number>; fill?: MaybeAccessor<IconFill> }) {
  const node = new UINode("Icon");
  applyProps(node, props);
  let svg: Svg | null = null;
  let size = theme.icon.size;
  let strokeWidth: number | undefined;
  let fill: IconFill = false;
  let source: ImageSource | null = null;
  let sourceKey = "";
  createEffect(() => {
    const input = read(props.svg);
    try {
      svg = loadSvg(input);
    } catch (err) {
      svg = null;
      console.warn(`nodebuilder: could not load icon ${typeof input === "string" && !input.trimStart().startsWith("<") ? input : ""}: ${(err as Error).message}`);
    }
    invalidate();
  });
  createEffect(() => {
    size = read(props.size ?? theme.icon.size);
    strokeWidth = props.strokeWidth === undefined ? undefined : read(props.strokeWidth);
    fill = read(props.fill) ?? false;
    invalidate();
  });
  onCleanup(() => source && releaseImage(source));

  node.measure = () => {
    const [, , vw, vh] = svg?.viewBox ?? [0, 0, 1, 1];
    return { width: (size * vw) / vh, height: size };
  };
  node.paint = (p, n) => {
    if (!svg) return;
    const [pt, pr, pb, pl] = edges(n.style.padding);
    const w = n.width - pl - pr, h = n.height - pt - pb;
    if (w <= 0 || h <= 0) return;
    // Rasterize at the device size and snap to device pixels, so 1 texel = 1 pixel (crisp).
    const scale = displayScale();
    const pw = Math.max(1, Math.round(w * scale)), ph = Math.max(1, Math.round(h * scale));
    const x = Math.round((n.x + pl) * scale) / scale, y = Math.round((n.y + pt) * scale) / scale;
    const color = inherited(n, "color") ?? theme.text.primary;
    const current = svg;
    let id = svgIds.get(current);
    if (!id) svgIds.set(current, (id = nextSvgId++));
    // A fill color is painted in, so the icon is no longer drawn in white and tinted.
    const monochrome = current.monochrome && typeof fill !== "string";
    const key = `${id}|${pw}x${ph}|${strokeWidth ?? ""}|${fill}${monochrome ? "" : `|${color}`}`;
    if (key !== sourceKey) {
      const fillPaint = fill === true ? "current" : fill ? (parseColor(fill) as Rgba) : undefined;
      const bitmap = iconBitmap(key, () =>
        renderSvg(current, pw, ph, { color: monochrome ? undefined : (parseColor(color) as Rgba), strokeWidth, fill: fillPaint }),
      );
      const next = acquireImage(bitmap);
      if (source) releaseImage(source);
      source = next;
      sourceKey = key;
    }
    p.image(x, y, pw / scale, ph / scale, source!, FULL_UV, 0, 1, monochrome ? color : "#ffffff");
  };
  return node;
}
