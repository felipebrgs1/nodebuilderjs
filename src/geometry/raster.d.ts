/**
 * Coverage (0..1 per pixel) of closed polygons. Horizontal coverage is exact; vertically
 * each pixel row is sampled `sub` times.
 */
export declare function rasterize(polys: number[][], w: number, h: number, evenOdd: boolean): Float32Array;
