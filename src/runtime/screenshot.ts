// Screenshots without a window: lay out a tree with real text metrics, paint it and render
// the commands with the addon's offscreen renderer (EGL without a display server). Used by
// `screenshot()` in testing.ts and by run() under NB_SCREENSHOT (`nodebuilder screenshot`).

import { imageBackend, setImageBackend } from "../image/source.js";
import { encodePng } from "../image/png-encode.js";
import { layout } from "../render/layout.js";
import { type Color, type UINode, displayScale, setDisplayScale, setTextMeasurer, textMeasurer } from "../render/node.js";
import { CommandBuffer, paintTree } from "../render/paint.js";
import { type ColorSpace, outputColorSpace, setOutputColorSpace } from "../render/color.js";
import { type Native, nativeImageBackend, nativeTextMeasurer } from "./native.js";

export interface ScreenshotOptions {
  /** Logical size; default: the size of the last layout (a mounted root) or 800x600. */
  width?: number;
  height?: number;
  /** Device scale (2 = HiDPI): the image is width*scale x height*scale pixels. Default 1. */
  scale?: number;
  /** Painted under everything; default transparent (what the window does not cover stays see-through). */
  background?: Color;
  /**
   * "display-p3" renders for a P3 display (colors past sRGB kept; the PNG is tagged P3);
   * default "srgb".
   */
  colorSpace?: ColorSpace;
}

export interface Screenshot {
  /** Size in device pixels (logical size x scale). */
  width: number;
  height: number;
  scale: number;
  /** What the pixel values mean. */
  colorSpace: ColorSpace;
  /** RGBA, 8 bits per channel, straight (not premultiplied) alpha, rows top to bottom. */
  rgba: Uint8Array;
  /** [r, g, b, a] (0..255) at device pixel (x, y). */
  pixel(x: number, y: number): [number, number, number, number];
  /** The image as a PNG file. */
  toPNG(): Uint8Array;
}

function screenshotOf(width: number, height: number, scale: number, rgba: Uint8Array, colorSpace: ColorSpace): Screenshot {
  return {
    width,
    height,
    scale,
    colorSpace,
    rgba,
    pixel(x, y) {
      const i = (Math.floor(y) * width + Math.floor(x)) * 4;
      return [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!, rgba[i + 3]!];
    },
    toPNG: () => encodePng({ width, height, data: rgba, colorSpace }),
  };
}

/**
 * Lays `root` out at `width` x `height` (logical px) with real text metrics, paints it and
 * renders it offscreen. The text measurer, display scale and image backend in use are put
 * back afterwards, and a root laid out before is laid out again at its old size with them.
 */
export function captureTree(nat: Native, root: UINode, width: number, height: number, scale = 1, background?: Color, colorSpace: ColorSpace = "srgb"): Screenshot {
  const before = { measurer: textMeasurer(), scale: displayScale(), images: imageBackend(), space: outputColorSpace(), width: root.width, height: root.height };
  setTextMeasurer(nativeTextMeasurer(nat, scale));
  setDisplayScale(scale);
  setImageBackend(nativeImageBackend(nat));
  setOutputColorSpace(colorSpace);
  try {
    layout(root, width, height);
    const buffer = new CommandBuffer();
    if (background) buffer.rect(0, 0, width, height, background);
    paintTree(root, buffer);
    const rgba = nat.renderOffscreen(width, height, scale, buffer.commands, buffer.texts, colorSpace);
    return screenshotOf(Math.round(width * scale), Math.round(height * scale), scale, rgba, colorSpace);
  } finally {
    setTextMeasurer(before.measurer);
    setDisplayScale(before.scale);
    setImageBackend(before.images);
    setOutputColorSpace(before.space);
    if (before.width > 0 && before.height > 0) layout(root, before.width, before.height);
  }
}
