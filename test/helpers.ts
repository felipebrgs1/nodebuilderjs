// Shared helpers for tests: decode the command buffer into named commands.

import type { UINode } from "../src/render/node.js";
import { CommandBuffer, paintTree } from "../src/render/paint.js";

type Rgba = [number, number, number, number];

export type DrawCommand =
  | { op: "rect"; x: number; y: number; w: number; h: number; color: Rgba; radius: number; borderWidth: number; borderColor: Rgba }
  | { op: "text"; x: number; y: number; size: number; weight: number; italic: boolean; bold: boolean; letterSpacing: number; color: Rgba; text: string }
  | { op: "clip"; x: number; y: number; w: number; h: number; radius: number }
  | { op: "unclip" }
  | { op: "shadow"; x: number; y: number; w: number; h: number; color: Rgba; radius: number; blur: number }
  | { op: "image"; x: number; y: number; w: number; h: number; uv: [number, number, number, number]; tint: Rgba; radius: number; id: number }
  | { op: "line"; x0: number; y0: number; x1: number; y1: number; width: number; color: Rgba; capStart: "butt" | "round"; capEnd: "butt" | "round" }
  | { op: "triangles"; color: Rgba; points: number[]; coverage: number[] }
  | { op: "arc"; cx: number; cy: number; outer: number; inner: number; start: number; sweep: number; color: Rgba }
  | { op: "gradient"; x0: number; y0: number; x1: number; y1: number; stops: { offset: number; color: Rgba }[] };

const round = (v: number) => Math.round(v * 1000) / 1000;

/** Decodes a command buffer (format: native/include/nb.h) into named commands, numbers rounded to 1e-3. */
export function decode(buffer: CommandBuffer): DrawCommand[] {
  const d = Array.from(buffer.commands, round);
  const out: DrawCommand[] = [];
  const rgba = (i: number): Rgba => [d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!];
  for (let i = 0; i < d.length; ) {
    const op = d[i++]!;
    switch (op) {
      case 1:
        out.push({ op: "rect", x: d[i]!, y: d[i + 1]!, w: d[i + 2]!, h: d[i + 3]!, color: rgba(i + 4), radius: d[i + 8]!, borderWidth: d[i + 9]!, borderColor: rgba(i + 10) });
        i += 14;
        break;
      case 2: {
        const weight = Math.floor(d[i + 3]! / 2); // font id = weight * 2 + italic
        out.push({ op: "text", x: d[i]!, y: d[i + 1]!, size: d[i + 2]!, weight, italic: d[i + 3]! % 2 === 1, bold: weight >= 600, letterSpacing: d[i + 9]!, color: rgba(i + 4), text: buffer.texts[d[i + 8]!]! });
        i += 10;
        break;
      }
      case 3:
        out.push({ op: "clip", x: d[i]!, y: d[i + 1]!, w: d[i + 2]!, h: d[i + 3]!, radius: d[i + 4]! });
        i += 5;
        break;
      case 4:
        out.push({ op: "unclip" });
        break;
      case 5:
        out.push({ op: "shadow", x: d[i]!, y: d[i + 1]!, w: d[i + 2]!, h: d[i + 3]!, color: rgba(i + 4), radius: d[i + 8]!, blur: d[i + 9]! });
        i += 10;
        break;
      case 6:
        out.push({ op: "image", x: d[i]!, y: d[i + 1]!, w: d[i + 2]!, h: d[i + 3]!, uv: [d[i + 4]!, d[i + 5]!, d[i + 6]!, d[i + 7]!], tint: rgba(i + 8), radius: d[i + 12]!, id: d[i + 13]! });
        i += 14;
        break;
      case 7:
        out.push({ op: "line", x0: d[i]!, y0: d[i + 1]!, x1: d[i + 2]!, y1: d[i + 3]!, width: d[i + 4]!, color: rgba(i + 5), capStart: d[i + 9] ? "round" : "butt", capEnd: d[i + 10] ? "round" : "butt" });
        i += 11;
        break;
      case 8: {
        const count = d[i]!;
        const points: number[] = [], coverage: number[] = [];
        for (let v = 0; v < count; v++) {
          const o = i + 5 + v * 3;
          points.push(d[o]!, d[o + 1]!);
          coverage.push(d[o + 2]!);
        }
        out.push({ op: "triangles", color: rgba(i + 1), points, coverage });
        i += 5 + count * 3;
        break;
      }
      case 9:
        out.push({ op: "arc", cx: d[i]!, cy: d[i + 1]!, outer: d[i + 2]!, inner: d[i + 3]!, start: d[i + 4]!, sweep: d[i + 5]!, color: rgba(i + 6) });
        i += 10;
        break;
      case 10: {
        const count = d[i + 4]!;
        const stops: { offset: number; color: Rgba }[] = [];
        for (let k = 0; k < count; k++) stops.push({ offset: d[i + 5 + k * 5]!, color: rgba(i + 6 + k * 5) });
        out.push({ op: "gradient", x0: d[i]!, y0: d[i + 1]!, x1: d[i + 2]!, y1: d[i + 3]!, stops });
        i += 5 + count * 5;
        break;
      }
      default:
        throw new Error(`unknown op ${op} at ${i - 1}`);
    }
  }
  return out;
}

/** Paints `node` and returns its commands. */
export function drawCommands(node: UINode): DrawCommand[] {
  const buffer = new CommandBuffer();
  paintTree(node, buffer);
  return decode(buffer);
}

/** Only the commands of one kind. */
export function commandsOf<K extends DrawCommand["op"]>(node: UINode, op: K): Extract<DrawCommand, { op: K }>[] {
  return drawCommands(node).filter((c): c is Extract<DrawCommand, { op: K }> => c.op === op);
}
