export type NativeKeyEvent = {
    type: "keydown" | "keyup";
    key: string;
    text: string;
    repeat: boolean;
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
    super: boolean;
};
export type NativeEvent = {
    type: "configure";
    width: number;
    height: number;
    scale: number;
    maximized: boolean;
    activated: boolean;
    transparent: boolean;
} | {
    type: "close" | "frame" | "pointerleave";
} | {
    type: "pointermove" | "pointerdown" | "pointerup";
    x: number;
    y: number;
    button: number;
} | {
    type: "scroll";
    x: number;
    y: number;
    dx: number;
    dy: number;
} | NativeKeyEvent | {
    type: "focus";
    focused: boolean;
};
export interface Native {
    open(options: {
        title: string;
        appId: string;
        width: number;
        height: number;
    }, onEvents: (events: NativeEvent[]) => void): void;
    close(): void;
    render(commands: Float32Array, texts: string[]): void;
    measureText(text: string, size: number, font: number): [width: number, ascent: number, descent: number];
    /** Copies straight-alpha RGBA pixels; returns an id (> 0) for draw commands. */
    createImage(width: number, height: number, rgba: Uint8Array): number;
    destroyImage(id: number): void;
    /** Decodes formats only the OS can (AVIF, HEIC); throws with the reason. Works without a window. */
    decodeImage(bytes: Uint8Array): {
        width: number;
        height: number;
        data: Uint8Array;
    };
    setCursor(name: string): void;
    setTitle(title: string): void;
    move(): void;
    /** xdg_toplevel resize edges bitmask: top 1, bottom 2, left 4, right 8. */
    resize(edges: number): void;
    setMaximized(maximized: boolean): void;
    minimize(): void;
    /** Requests a frame callback (next vblank) without drawing anything. */
    requestFrame(): void;
}
export declare function loadNative(): Native;
