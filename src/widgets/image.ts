import { type ImageInput, type ImageSource, acquireImage, releaseImage } from "../image/source.js";
import { edges } from "../render/layout.js";
import { type Handlers, UINode, invalidate } from "../render/node.js";
import { type MaybeAccessor, createEffect, onCleanup, read } from "../reactive/signals.js";
import { type StyleProps, applyProps } from "./props.js";

/** How the image fills its box: whole and centered, cropped to fill, or stretched. */
export type ImageFit = "contain" | "cover" | "fill";

export const FULL_UV = [0, 0, 1, 1] as const;

/**
 * Shows a PNG. Without width/height it takes the image's size (1 image pixel = 1 logical
 * pixel); with only one of them, the other follows the aspect ratio. Files showing in
 * several places are decoded once and freed when the last one unmounts.
 */
export function Image(props: StyleProps & Handlers & { src: MaybeAccessor<ImageInput>; fit?: MaybeAccessor<ImageFit> }) {
  const node = new UINode("Image");
  applyProps(node, props);
  let source: ImageSource | null = null;
  let fit: ImageFit = "contain";
  createEffect(() => {
    const s = acquireImage(read(props.src));
    source = s;
    node.label = s.error ? "Image (error)" : `Image ${s.width}x${s.height}`;
    invalidate();
    onCleanup(() => releaseImage(s));
  });
  createEffect(() => {
    fit = read(props.fit ?? "contain");
    invalidate();
  });

  node.measure = () => {
    if (!source?.width) return { width: 0, height: 0 };
    const [pt, pr, pb, pl] = edges(node.style.padding);
    const { width: w, height: h } = node.style;
    const ratio = source.width / source.height;
    if (w !== undefined && h === undefined) {
      const inner = Math.max(0, w - pl - pr);
      return { width: inner, height: inner / ratio };
    }
    if (h !== undefined && w === undefined) {
      const inner = Math.max(0, h - pt - pb);
      return { width: inner * ratio, height: inner };
    }
    return { width: source.width, height: source.height };
  };
  node.paint = (p, n) => {
    if (!source?.width) return;
    const [pt, pr, pb, pl] = edges(n.style.padding);
    let x = n.x + pl, y = n.y + pt;
    let w = Math.max(0, n.width - pl - pr), h = Math.max(0, n.height - pt - pb);
    let uv: readonly [number, number, number, number] = FULL_UV;
    const { width: iw, height: ih } = source;
    if (fit === "contain") {
      const k = Math.min(w / iw, h / ih);
      x += (w - iw * k) / 2;
      y += (h - ih * k) / 2;
      w = iw * k;
      h = ih * k;
    } else if (fit === "cover") {
      const k = Math.max(w / iw, h / ih);
      const fu = w / (iw * k), fv = h / (ih * k); // visible fraction of the image
      uv = [(1 - fu) / 2, (1 - fv) / 2, (1 + fu) / 2, (1 + fv) / 2];
    }
    // Like CSS, the content's corners follow the box's radius minus the padding.
    const radius = Math.max(0, (n.style.radius ?? 0) - Math.min(pt, pr, pb, pl));
    p.image(x, y, w, h, source, uv, radius);
  };
  return node;
}
