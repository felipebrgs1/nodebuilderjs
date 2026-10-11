import { type Color, type Handlers, UINode } from "../render/node.js";
import { type PolylineOptions } from "../render/shapes.js";
import { type StyleProps } from "./props.js";
/** What `<Canvas draw>` draws with. Coordinates are local to the canvas (inside its padding). */
export interface DrawContext {
    readonly width: number;
    readonly height: number;
    rect(x: number, y: number, w: number, h: number, color: Color, radius?: number): void;
    line(x0: number, y0: number, x1: number, y1: number, color: Color, width?: number, cap?: "round" | "butt" | "square"): void;
    polyline(points: ArrayLike<number>, color: Color, width?: number, options?: PolylineOptions): void;
    /** Filled simple polygon (concave allowed; self-intersecting draws nothing). */
    polygon(points: ArrayLike<number>, color: Color): void;
    circle(cx: number, cy: number, radius: number, color: Color): void;
    /** Ring sector; angles in radians, 0 = up, positive = clockwise. innerRadius 0 = pie slice. */
    arc(cx: number, cy: number, outerRadius: number, innerRadius: number, start: number, sweep: number, color: Color): void;
    /** `y` is the top of the line box. */
    text(text: string, x: number, y: number, color: Color, size?: number, bold?: boolean): void;
    measureText(text: string, size?: number, bold?: boolean): {
        width: number;
        height: number;
    };
}
export declare function Canvas(props: StyleProps & Handlers & {
    draw: (g: DrawContext) => void;
}): UINode;
