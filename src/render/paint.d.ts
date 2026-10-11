import { type ImageSource } from "../image/source.js";
import type { Color, LineCap, Painter, UINode } from "./node.js";
export declare function parseColor(c: Color): [number, number, number, number];
export declare class CommandBuffer implements Painter {
    data: Float32Array<ArrayBuffer>;
    length: number;
    texts: string[];
    reset(): void;
    /** Makes room for `n` more floats. */
    private reserve;
    private push;
    rect(x: number, y: number, w: number, h: number, color: Color, radius?: number, borderWidth?: number, borderColor?: Color): void;
    shadow(x: number, y: number, w: number, h: number, color: Color, radius: number, blur: number): void;
    text(x: number, y: number, text: string, size: number, color: Color, bold?: boolean): void;
    image(x: number, y: number, w: number, h: number, source: ImageSource, uv: readonly [number, number, number, number], radius?: number, opacity?: number, tint?: Color): void;
    line(x0: number, y0: number, x1: number, y1: number, width: number, color: Color, capStart?: LineCap, capEnd?: LineCap): void;
    triangles(points: ArrayLike<number>, coverage: ArrayLike<number> | null, color: Color): void;
    arc(cx: number, cy: number, outerRadius: number, innerRadius: number, start: number, sweep: number, color: Color): void;
    clip(x: number, y: number, w: number, h: number, radius?: number): void;
    unclip(): void;
    get commands(): Float32Array<ArrayBuffer>;
}
export declare function paintTree(node: UINode, p: Painter): void;
