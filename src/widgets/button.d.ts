import { type Child } from "../jsx-runtime.js";
import { UINode } from "../render/node.js";
import { type MaybeAccessor } from "../reactive/signals.js";
import { type StyleProps } from "./props.js";
type Variant = "default" | "primary" | "danger" | "flat";
export declare function Button(props: StyleProps & {
    label?: MaybeAccessor<string>;
    children?: Child;
    variant?: Variant;
    disabled?: MaybeAccessor<boolean>;
    onClick?: () => void;
}): UINode;
export {};
