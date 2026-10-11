// Walks the laid-out tree and encodes draw commands into a Float32Array that the
// native renderer executes in one go (format: native/include/nb.h, consumer: native/core/render_gles2.c).

import type { Color, Painter, UINode } from "./node.js";

const OP_RECT = 1;
const OP_TEXT = 2;
const OP_CLIP = 3;
const OP_UNCLIP = 4;
const OP_SHADOW = 5;

const colorCache = new Map<string, [number, number, number, number]>();
const named: Record<string, string> = { transparent: "#0000", white: "#fff", black: "#000" };

export function parseColor(c: Color): [number, number, number, number] {
  let rgba = colorCache.get(c);
  if (rgba) return rgba;
  let hex = (named[c] ?? c).replace("#", "");
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map((h) => h + h).join("");
  if (hex.length === 6) hex += "ff";
  const n = parseInt(hex, 16);
  rgba = Number.isNaN(n) || hex.length !== 8 ? [1, 0, 1, 1] : [((n >>> 24) & 255) / 255, ((n >>> 16) & 255) / 255, ((n >>> 8) & 255) / 255, (n & 255) / 255];
  colorCache.set(c, rgba);
  return rgba;
}

export class CommandBuffer implements Painter {
  data = new Float32Array(4096);
  length = 0;
  texts: string[] = [];

  reset() {
    this.length = 0;
    this.texts = [];
  }

  private push(...values: number[]) {
    if (this.length + values.length > this.data.length) {
      const bigger = new Float32Array(this.data.length * 2);
      bigger.set(this.data);
      this.data = bigger;
    }
    for (const v of values) this.data[this.length++] = v;
  }

  rect(x: number, y: number, w: number, h: number, color: Color, radius = 0, borderWidth = 0, borderColor: Color = "transparent") {
    this.push(OP_RECT, x, y, w, h, ...parseColor(color), radius, borderWidth, ...parseColor(borderColor));
  }

  shadow(x: number, y: number, w: number, h: number, color: Color, radius: number, blur: number) {
    this.push(OP_SHADOW, x, y, w, h, ...parseColor(color), radius, blur);
  }

  text(x: number, y: number, text: string, size: number, color: Color, bold = false) {
    if (!text) return;
    this.texts.push(text);
    this.push(OP_TEXT, x, y, size, bold ? 1 : 0, ...parseColor(color), this.texts.length - 1);
  }

  clip(x: number, y: number, w: number, h: number, radius = 0) {
    this.push(OP_CLIP, x, y, w, h, radius);
  }

  unclip() {
    this.push(OP_UNCLIP);
  }

  get commands() {
    return this.data.subarray(0, this.length);
  }
}

export function paintTree(node: UINode, p: Painter) {
  const s = node.style;
  if (s.shadow) {
    const blur = s.shadow.blur;
    p.shadow(node.x, node.y + (s.shadow.y ?? 0), node.width, node.height, s.shadow.color, s.radius ?? 0, blur);
  }
  if (s.background || s.borderWidth) {
    p.rect(node.x, node.y, node.width, node.height, s.background ?? "transparent", s.radius ?? 0, s.borderWidth ?? 0, s.borderColor);
  }
  node.paint?.(p, node);

  // Like CSS overflow: children are clipped to the inside of the border.
  const clip = s.clip || node.scrollable;
  if (clip) {
    const b = s.borderWidth ?? 0;
    p.clip(node.x + b, node.y + b, node.width - 2 * b, node.height - 2 * b, Math.max(0, (s.radius ?? 0) - b));
  }
  for (const c of node.children) paintTree(c, p);
  if (clip) p.unclip();

  if (node.scrollable && node.contentHeight > node.height) {
    const track = node.height - 8;
    const thumb = Math.max(24, (node.height / node.contentHeight) * track);
    const top = node.y + 4 + (node.scrollY / (node.contentHeight - node.height)) * (track - thumb);
    p.rect(node.x + node.width - 7, top, 4, thumb, "#00000040", 2);
  }
}
