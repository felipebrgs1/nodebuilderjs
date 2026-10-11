/** A polyline as x, y pairs; `closed` joins the last point back to the first. */
export interface Subpath {
    pts: number[];
    closed: boolean;
}
export declare function segmentsFor(radius: number, sweep: number, tol: number): number;
export declare function ellipse(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, tol: number, closedCircle: boolean): number[];
/** Parses path data; like browsers, it renders everything up to the first error. */
export declare function pathData(d: string, tol: number): Subpath[];
export declare function cubic(out: number[], x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, tol: number): void;
export declare function quadratic(out: number[], x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, tol: number): void;
/** Elliptical arc from endpoint parameters (SVG spec, appendix B.2.4). */
export declare function arc(out: number[], x1: number, y1: number, rx: number, ry: number, rotation: number, large: boolean, sweep: boolean, x2: number, y2: number, tol: number): void;
