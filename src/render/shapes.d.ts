import type { Color, LineCap, Painter } from "./node.js";
export interface PolylineOptions {
    /** Ends of an open polyline. Default "round". */
    cap?: LineCap | "square";
    /** Joins the last point back to the first. */
    closed?: boolean;
}
/**
 * A stroked polyline. Segments meet with round joins (each segment's round caps overlap),
 * which is exact for opaque colors; with a translucent color the joints look darker.
 */
export declare function polyline(p: Pick<Painter, "line">, points: ArrayLike<number>, width: number, color: Color, options?: PolylineOptions): void;
/**
 * A filled simple polygon (concave allowed, any winding). The edge gets a fringe one device
 * pixel wide whose coverage goes from 1 inside to 0 outside, so the GPU blends it into an
 * antialiased edge. Self-intersecting polygons draw nothing.
 */
export declare function fillPolygon(p: Pick<Painter, "triangles">, points: ArrayLike<number>, color: Color, scale?: number): void;
