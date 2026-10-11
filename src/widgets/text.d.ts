import { type Child } from "../jsx-runtime.js";
import { type Handlers, UINode } from "../render/node.js";
import { type MaybeAccessor } from "../reactive/signals.js";
import { type StyleProps } from "./props.js";
export declare function Text(props: StyleProps & Handlers & {
    text?: MaybeAccessor<string | number>;
    children?: Child;
}): UINode;
