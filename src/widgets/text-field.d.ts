import { UINode } from "../render/node.js";
import { type Accessor, type MaybeAccessor } from "../reactive/signals.js";
import { type StyleProps } from "./props.js";
export declare function TextField(props: StyleProps & {
    value: Accessor<string>;
    onInput: (value: string) => void;
    onSubmit?: () => void;
    placeholder?: MaybeAccessor<string>;
}): UINode;
