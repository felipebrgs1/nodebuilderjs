import { type Subpath } from "./path.js";
export interface StrokeStyle {
    width: number;
    cap: "butt" | "round" | "square";
    join: "miter" | "round" | "bevel";
    miterLimit: number;
}
/** Outline of a stroke as polygons, all wound the same way (so a nonzero fill unions them). */
export declare function strokePolygons(subpaths: Subpath[], stroke: StrokeStyle, tol: number): number[][];
export declare function signedArea(p: number[]): number;
