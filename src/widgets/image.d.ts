import { type ImageInput } from "../image/source.js";
import { type Handlers, UINode } from "../render/node.js";
import { type MaybeAccessor } from "../reactive/signals.js";
import { type StyleProps } from "./props.js";
/** How the image fills its box: whole and centered, cropped to fill, or stretched. */
export type ImageFit = "contain" | "cover" | "fill";
export declare const FULL_UV: readonly [0, 0, 1, 1];
/**
 * Shows a PNG. Without width/height it takes the image's size (1 image pixel = 1 logical
 * pixel); with only one of them, the other follows the aspect ratio. Files showing in
 * several places are decoded once and freed when the last one unmounts.
 */
export declare function Image(props: StyleProps & Handlers & {
    src: MaybeAccessor<ImageInput>;
    fit?: MaybeAccessor<ImageFit>;
    opacity?: MaybeAccessor<number>;
}): UINode;
