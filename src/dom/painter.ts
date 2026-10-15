// The Painter interface on a Canvas2D context, for nodes that draw themselves (Canvas, charts,
// Slider, Icon, Image...) in the DOM renderer. Coordinates are the window's, as in paint.ts;
// begin() moves the origin to the canvas's corner.

import { type ImageSource, imageHandle } from "../image/source.js";
import { isGradient, resolveStops } from "../render/gradient.js";
import { type Color, type FontInput, type LineCap, type Paint, type Radius, corners, fontId, fontSpec, fontStyle, insetRadius } from "../render/node.js";
import { cssFont, setFont } from "../web/text.js";
import { cssColor } from "./style.js";
import type { CanvasPainter } from "./sync.js";

type Context = CanvasRenderingContext2D;

type Image = CanvasImageSource & { width: number; height: number };

/** `image` times `color` (white stays the color): the GPU's tint, done once per image and color. */
export function tintImage(image: Image, color: string): Image {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const c = canvas.getContext("2d")!;
  c.drawImage(image, 0, 0);
  c.globalCompositeOperation = "multiply";
  c.fillStyle = color;
  c.fillRect(0, 0, image.width, image.height);
  c.globalCompositeOperation = "destination-in"; // the image's alpha again
  c.drawImage(image, 0, 0);
  return canvas;
}

/**
 * `images(id)`: what an image handle (from the native's createImage) draws. `tint` makes an
 * image times a color (icons are rasterized white and tinted); its results are kept per color.
 */
export function createCanvasPainter(images: (id: number) => Image | undefined, tint: (image: Image, color: string) => Image = tintImage): CanvasPainter {
  let ctx: Context | null = null;
  let depth = 0;
  const tinted = new WeakMap<Image, Map<string, Image>>();
  const tintedOf = (image: Image, color: string) => {
    let byColor = tinted.get(image);
    if (!byColor) tinted.set(image, (byColor = new Map()));
    let out = byColor.get(color);
    if (!out) {
      if (byColor.size > 16) byColor.clear();
      byColor.set(color, (out = tint(image, color)));
    }
    return out;
  };

  const fill = (paint: Paint): string | CanvasGradient => {
    if (!isGradient(paint)) return cssColor(paint);
    const g = ctx!.createLinearGradient(paint.x0, paint.y0, paint.x1, paint.y1);
    for (const s of resolveStops(paint.stops)) g.addColorStop(Math.min(1, Math.max(0, s.offset)), cssColor(s.color));
    return g;
  };
  const roundRect = (x: number, y: number, w: number, h: number, radius: Radius | undefined) => {
    const c = ctx!;
    const r = corners(radius);
    c.beginPath();
    if (r.every((v) => v === 0)) c.rect(x, y, w, h);
    else c.roundRect(x, y, w, h, [...r]);
  };

  const painter: CanvasPainter = {
    opacity: 1,

    begin(canvas, x, y, scale) {
      while (depth > 0) (ctx?.restore(), depth--);
      ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(scale, 0, 0, scale, -x * scale, -y * scale);
    },

    rect(x, y, w, h, color, radius = 0, borderWidth = 0, borderColor = "transparent") {
      const c = ctx;
      if (!c) return;
      c.globalAlpha = painter.opacity;
      roundRect(x, y, w, h, radius);
      c.fillStyle = fill(color);
      c.fill();
      if (borderWidth > 0) {
        // Inside the box, over the fill, as the native renderer does.
        const half = borderWidth / 2;
        roundRect(x + half, y + half, Math.max(0, w - borderWidth), Math.max(0, h - borderWidth), insetRadius(radius, half));
        c.lineWidth = borderWidth;
        c.strokeStyle = cssColor(borderColor);
        c.stroke();
      }
    },

    shadow(x, y, w, h, color, radius, blur, dy = 0) {
      const c = ctx;
      if (!c) return;
      // Not under the box itself (as in CSS): clipped to what is outside it. The shape is drawn
      // far away and only its shadow is moved back.
      const far = 100000;
      c.save();
      c.beginPath();
      c.rect(x - far / 2, y - far / 2, far, far);
      roundRect(x, y, w, h, radius);
      c.clip("evenodd");
      c.globalAlpha = painter.opacity;
      c.shadowColor = cssColor(color);
      c.shadowBlur = blur;
      c.shadowOffsetX = far;
      c.shadowOffsetY = dy;
      roundRect(x - far, y, w, h, radius);
      c.fillStyle = "#000";
      c.fill();
      c.restore();
    },

    text(x, y, text, size, color, font?: FontInput) {
      const c = ctx;
      if (!c || !text) return;
      const f = fontStyle(font);
      setFont(c, cssFont(fontId(f.weight, f.italic), fontSpec(f), size), f.letterSpacing);
      c.globalAlpha = painter.opacity;
      c.fillStyle = cssColor(color);
      c.textBaseline = "alphabetic";
      const ascent = c.measureText(text).fontBoundingBoxAscent ?? size * 0.9;
      c.fillText(text, x, y + ascent); // y is the line's top
    },

    image(x, y, w, h, source: ImageSource, uv, radius = 0, opacity = 1, tintColor: Color = "#ffffff") {
      const c = ctx;
      if (!c) return;
      let img = images(imageHandle(source));
      if (!img || !source.width) return;
      const color = cssColor(tintColor);
      if (!/^(#fff(fff)?(ff)?|white)$/i.test(color)) img = tintedOf(img, color);
      c.save();
      if (radius > 0) {
        roundRect(x, y, w, h, radius);
        c.clip();
      }
      c.globalAlpha = painter.opacity * opacity;
      const [u0, v0, u1, v1] = uv;
      c.drawImage(img, u0 * source.width, v0 * source.height, (u1 - u0) * source.width, (v1 - v0) * source.height, x, y, w, h);
      c.restore();
    },

    line(x0, y0, x1, y1, width, color, capStart: LineCap = "round", capEnd: LineCap = "round") {
      const c = ctx;
      if (!c) return;
      c.globalAlpha = painter.opacity;
      const style = fill(color);
      c.lineWidth = width;
      c.strokeStyle = style;
      c.lineCap = capStart === capEnd ? capStart : "butt";
      c.beginPath();
      c.moveTo(x0, y0);
      c.lineTo(x1, y1);
      c.stroke();
      if (capStart !== capEnd) {
        // One round end: a dot there.
        const [cx, cy] = capStart === "round" ? [x0, y0] : [x1, y1];
        c.beginPath();
        c.arc(cx, cy, width / 2, 0, Math.PI * 2);
        c.fillStyle = style;
        c.fill();
      }
    },

    triangles(points, _coverage, color) {
      const c = ctx;
      if (!c) return;
      const count = (points.length >> 1) - ((points.length >> 1) % 3);
      if (!count) return;
      c.globalAlpha = painter.opacity;
      c.beginPath();
      for (let v = 0; v < count; v += 3) {
        c.moveTo(points[v * 2]!, points[v * 2 + 1]!);
        c.lineTo(points[v * 2 + 2]!, points[v * 2 + 3]!);
        c.lineTo(points[v * 2 + 4]!, points[v * 2 + 5]!);
        c.closePath();
      }
      c.fillStyle = fill(color);
      c.fill();
    },

    arc(cx, cy, outer, inner, start, sweep, color) {
      const c = ctx;
      if (!c) return;
      // Ours: 0 is up and positive is clockwise; Canvas: 0 is right, also clockwise.
      const a0 = start - Math.PI / 2, a1 = a0 + sweep;
      c.globalAlpha = painter.opacity;
      c.beginPath();
      c.arc(cx, cy, outer, a0, a1, sweep < 0);
      if (inner > 0) c.arc(cx, cy, inner, a1, a0, sweep >= 0);
      else c.lineTo(cx, cy);
      c.closePath();
      c.fillStyle = fill(color);
      c.fill();
    },

    clip(x, y, w, h, radius = 0) {
      const c = ctx;
      if (!c) return;
      c.save();
      depth++;
      roundRect(x, y, w, h, radius);
      c.clip();
    },

    unclip() {
      if (!ctx || depth === 0) return;
      ctx.restore();
      depth--;
    },
  };
  return painter;
}
