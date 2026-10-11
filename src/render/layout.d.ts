import type { Edges, Size, UINode } from "./node.js";
/** Visible region in absolute logical pixels; narrowed by every clipping node. */
export interface Rect {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}
export declare function layout(root: UINode, width: number, height: number): void;
/** How far a node's own drawing reaches outside its box (shadows). */
export declare function overhang(n: UINode): number;
/** Inner region a clipping node lets its children draw into, intersected with `view`. */
export declare function clipView(n: UINode, view: Rect): Rect;
export declare function outside(n: UINode, view: Rect): boolean;
export declare function edges(e: Edges | undefined): [top: number, right: number, bottom: number, left: number];
/** Natural size of a node, ignoring the space its parent offers. */
export declare function intrinsic(node: UINode): Size;
