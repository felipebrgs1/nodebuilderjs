import { UINode } from "../render/node.js";
import { type Accessor, type MaybeAccessor } from "../reactive/signals.js";
export declare function Checkbox(props: {
    checked: Accessor<boolean>;
    onChange: (checked: boolean) => void;
    label?: MaybeAccessor<string>;
}): UINode;
