import type { Child } from "../jsx-runtime.js";
import { type Handlers, type Style, UINode } from "../render/node.js";
import { type MaybeAccessor } from "../reactive/signals.js";
export type StyleProps = {
    [K in keyof Style]?: MaybeAccessor<NonNullable<Style[K]>>;
};
export type BoxProps = StyleProps & Handlers & {
    children?: Child;
};
/** Binds style props (static or reactive) and event handlers onto a node. */
export declare function applyProps(node: UINode, props: Record<string, any>): void;
export declare function inherited<K extends "color" | "fontSize" | "bold">(node: UINode, key: K): Style[K] | undefined;
/** Tracks hover/press/focus for any interactive node. */
export declare function interaction(node: UINode): {
    hovered: import("../index.js").Accessor<boolean>;
    pressed: import("../index.js").Accessor<boolean>;
    focused: import("../index.js").Accessor<boolean>;
};
