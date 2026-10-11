export interface SvgNode {
    tag: string;
    attrs: Record<string, string>;
    children: SvgNode[];
}
/** Lucide's icon data (`import Camera from "lucide/dist/esm/icons/camera.mjs"`): [tag, attributes][]. */
export type IconNode = readonly (readonly [tag: string, attrs: Readonly<Record<string, string | number | undefined>>, children?: IconNode])[];
export interface Svg {
    root: SvgNode;
    viewBox: readonly [x: number, y: number, width: number, height: number];
    /** Every paint is currentColor (or none): it can be drawn once in white and tinted. */
    monochrome: boolean;
}
/** Straight-alpha color, channels 0..1. */
export type Rgba = readonly [number, number, number, number];
export declare function parseSvg(input: string | IconNode): Svg;
export type Paint = null | "current" | Rgba;
export interface Style {
    fill: Paint;
    stroke: Paint;
    /** What currentColor means here: the caller's color, or a fixed one from a `color` attribute. */
    current: "current" | Rgba;
    strokeWidth: number;
    cap: "butt" | "round" | "square";
    join: "miter" | "round" | "bevel";
    miterLimit: number;
    evenOdd: boolean;
    fillOpacity: number;
    strokeOpacity: number;
    opacity: number;
    visible: boolean;
}
export declare const rootStyle: () => Style;
export type Matrix = readonly [a: number, b: number, c: number, d: number, e: number, f: number];
export declare const IDENTITY: Matrix;
export declare const multiply: (m: Matrix, n: Matrix) => Matrix;
export declare function walk(node: SvgNode, parent: Style, ctm: Matrix, visit: (node: SvgNode, style: Style, ctm: Matrix) => void): void;
export declare const SHAPES: Set<string>;
