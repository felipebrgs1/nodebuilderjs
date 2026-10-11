import type { Bitmap } from "../image/png.js";
import { type Rgba, type Svg } from "./parse.js";
export interface RenderOptions {
    /** What currentColor paints with; omitted = white (to be tinted later, see Svg.monochrome). */
    color?: Rgba;
    /** Overrides the root stroke-width (in viewBox units), like Lucide's strokeWidth prop. */
    strokeWidth?: number;
}
/** Rasterizes into a width x height bitmap (straight alpha), scaled to fit like xMidYMid meet. */
export declare function renderSvg(svg: Svg, width: number, height: number, options?: RenderOptions): Bitmap;
