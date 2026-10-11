import { type Handlers, UINode } from "../render/node.js";
import { type MaybeAccessor } from "../reactive/signals.js";
import { type IconNode } from "../svg/index.js";
import { type StyleProps } from "./props.js";
/** SVG markup, a path to an .svg file, or Lucide's icon data. */
export type IconInput = string | IconNode;
/**
 * An SVG icon, sized `size` (height; width follows the viewBox) and colored like text:
 * `color` is inherited, so it follows its Button or Text parent. Icons drawn only with
 * currentColor are rasterized once in white and tinted on the GPU, so changing the color
 * is free. Works with Lucide (`lucide-static` files or `lucide` data) and Phosphor.
 */
export declare function Icon(props: StyleProps & Handlers & {
    svg: MaybeAccessor<IconInput>;
    size?: MaybeAccessor<number>;
    strokeWidth?: MaybeAccessor<number>;
}): UINode;
