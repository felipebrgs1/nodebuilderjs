import type { Bitmap } from "./png.js";
export type { Bitmap } from "./png.js";
/** A file path (relative to the working directory), a file: URL, encoded bytes or decoded pixels. */
export type ImageInput = string | URL | Uint8Array | Bitmap;
export interface ImageSource {
    readonly width: number;
    readonly height: number;
    /** Set when the file could not be read or decoded; the image then draws nothing. */
    readonly error?: string;
    /** GPU handle; 0 until first painted. */
    handle: number;
    pixels: Uint8Array | null;
    refs: number;
    key: unknown;
}
/** Where pixels go: the native core in an app, a counter in headless tests. */
export interface ImageBackend {
    create(width: number, height: number, rgba: Uint8Array): number;
    destroy(handle: number): void;
}
export declare function setImageBackend(b: ImageBackend): void;
/** Takes a reference to the (shared) source for `input`; pair with releaseImage. */
export declare function acquireImage(input: ImageInput): ImageSource;
export declare function releaseImage(source: ImageSource): void;
/** GPU handle for painting, uploading on first use. The decoded pixels are dropped after upload. */
export declare function imageHandle(source: ImageSource): number;
