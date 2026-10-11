import type { ImageSource } from "../image/source.js";
export type Color = string;
export type Edges = number | [vertical: number, horizontal: number] | [top: number, right: number, bottom: number, left: number];
export interface Style {
    direction?: "row" | "column";
    gap?: number;
    padding?: Edges;
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    grow?: number;
    /** Cross-axis alignment of children. Default: "stretch". */
    align?: "start" | "center" | "end" | "stretch";
    /** Main-axis distribution of children. Default: "start". */
    justify?: "start" | "center" | "end" | "space-between";
    /** Taken out of the flow and placed at left/top inside the parent's padding box. */
    position?: "flow" | "absolute";
    left?: number;
    top?: number;
    /** Clip children to this node's box. */
    clip?: boolean;
    background?: Color;
    radius?: number;
    borderWidth?: number;
    borderColor?: Color;
    shadow?: {
        color: Color;
        blur: number;
        y?: number;
    };
    color?: Color;
    fontSize?: number;
    bold?: boolean;
    cursor?: string;
}
export interface PointerEvent {
    x: number;
    y: number;
    button: number;
    /** Number of quick successive clicks (2 = double click). */
    clicks: number;
    stop(): void;
}
export interface KeyEvent {
    key: string;
    text: string;
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
    repeat: boolean;
    stop(): void;
}
export interface ScrollEvent {
    dx: number;
    dy: number;
    stop(): void;
}
export interface Handlers {
    onClick?: (e: PointerEvent) => void;
    onPointerDown?: (e: PointerEvent) => void;
    onPointerUp?: (e: PointerEvent) => void;
    onPointerEnter?: () => void;
    onPointerLeave?: () => void;
    onScroll?: (e: ScrollEvent) => void;
    onKeyDown?: (e: KeyEvent) => void;
    onFocus?: () => void;
    onBlur?: () => void;
}
export interface Size {
    width: number;
    height: number;
}
/** What custom-painted nodes draw with (implemented by paint.ts). */
export interface Painter {
    rect(x: number, y: number, w: number, h: number, color: Color, radius?: number, borderWidth?: number, borderColor?: Color): void;
    shadow(x: number, y: number, w: number, h: number, color: Color, radius: number, blur: number): void;
    text(x: number, y: number, text: string, size: number, color: Color, bold?: boolean): void;
    /** Draws `uv` (a sub-rectangle of the image, 0..1) stretched over the box, multiplied by `tint` (default white). */
    image(x: number, y: number, w: number, h: number, source: ImageSource, uv: readonly [number, number, number, number], radius?: number, opacity?: number, tint?: Color): void;
    /** A thick segment with antialiased edges; each end is round or butt (flat at the point). */
    line(x0: number, y0: number, x1: number, y1: number, width: number, color: Color, capStart?: LineCap, capEnd?: LineCap): void;
    /** Filled triangles (x, y pairs, 3 vertices each); `coverage` (0..1 per vertex, default 1) fades edges. */
    triangles(points: ArrayLike<number>, coverage: ArrayLike<number> | null, color: Color): void;
    /** Ring sector (pie slice with innerRadius 0). Angles in radians, 0 = up, positive = clockwise. */
    arc(cx: number, cy: number, outerRadius: number, innerRadius: number, start: number, sweep: number, color: Color): void;
    /** Clips to a (optionally rounded) rect until the matching unclip(). */
    clip(x: number, y: number, w: number, h: number, radius?: number): void;
    unclip(): void;
}
export type LineCap = "butt" | "round";
export interface TextMetrics {
    width: number;
    ascent: number;
    descent: number;
}
export type TextMeasurer = (text: string, size: number, bold: boolean) => TextMetrics;
/** Wired by the app runtime; tests can install a fake measurer. */
export declare function setFrameScheduler(fn: () => void): void;
export declare function setTextMeasurer(fn: TextMeasurer): void;
/** Bumped whenever earlier measurements may be wrong (new measurer, new scale); per-node caches compare it. */
export declare function metricsGeneration(): number;
export declare function textMetricsChanged(): void;
/** Integer device scale of the window (2 on HiDPI); widgets that rasterize use it to stay sharp. */
export declare function displayScale(): number;
export declare function setDisplayScale(value: number): void;
export declare function measureText(text: string, size: number, bold?: boolean): TextMetrics;
export declare function invalidate(): void;
export declare class UINode {
    readonly style: Style;
    readonly handlers: Handlers;
    parent: UINode | null;
    /** Children are grouped in slots: static ones, or reactive regions that swap their nodes. */
    private slots;
    private flat;
    focusable: boolean;
    /** Children may overflow vertically and are scrolled by `scrollY`. */
    scrollable: boolean;
    /** Pressing here (outside clickable children) moves the window. */
    dragRegion: boolean;
    /** Optional intrinsic size (text, custom widgets). */
    measure?: (maxWidth: number) => Size;
    /** Optional custom drawing, called after background and before children. */
    paint?: (p: Painter, node: UINode) => void;
    /** Debug label shown by `debugTree`. */
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
    /** Content extent, used by scroll containers. */
    contentHeight: number;
    scrollY: number;
    /** Outside the visible area in the last layout: its box is set, its subtree is stale and skipped. */
    culled: boolean;
    constructor(label?: string);
    set<K extends keyof Style>(key: K, value: Style[K]): void;
    addSlot(): number;
    setSlot(index: number, nodes: UINode[]): void;
    get children(): readonly UINode[];
    /** True when the node is still connected to a root (window). */
    get attached(): boolean;
    isRoot: boolean;
}
export declare function debugTree(node: UINode, indent?: string): string;
