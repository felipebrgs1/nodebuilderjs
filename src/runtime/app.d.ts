import { type Child } from "../jsx-runtime.js";
export interface WindowOptions {
    title: string;
    appId?: string;
    width?: number;
    height?: number;
    /** Return false to keep the window open. */
    onClose?: () => boolean | void;
}
export interface RunOptions {
    /** Frame rate cap; frames stay vsync-aligned (240 Hz display -> every other vblank). Default 120, env NB_MAX_FPS. */
    maxFps?: number;
}
/** Nodes created by <Window> carry their options here. */
export declare const windowOptionsKey: unique symbol;
/** `transparent` is false when corners can't be see-through (e.g. X11 without a compositor). */
export declare const windowState: {
    width: import("../index.js").Accessor<number>;
    height: import("../index.js").Accessor<number>;
    maximized: import("../index.js").Accessor<boolean>;
    activated: import("../index.js").Accessor<boolean>;
    transparent: import("../index.js").Accessor<boolean>;
};
export declare const windowControls: {
    close: () => void;
    minimize: () => void | undefined;
    toggleMaximize: () => void | undefined;
    setTitle: (title: string) => void | undefined;
};
/** Runs `cb` right before the next frame is laid out (paced by the compositor). */
export declare function requestAnimationFrame(cb: (time: number) => void): void;
export declare function run(app: () => Child, runOptions?: RunOptions): void;
