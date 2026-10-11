export interface Bitmap {
    width: number;
    height: number;
    /** RGBA, 8 bits per channel, straight (not premultiplied) alpha, rows top to bottom. */
    data: Uint8Array;
}
export declare function isPng(bytes: Uint8Array): boolean;
export declare function decodePng(bytes: Uint8Array): Bitmap;
