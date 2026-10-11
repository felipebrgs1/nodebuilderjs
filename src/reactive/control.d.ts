import { type Child } from "../jsx-runtime.js";
import { type Accessor, type MaybeAccessor } from "./signals.js";
export declare function Show(props: {
    when: MaybeAccessor<unknown>;
    fallback?: Child;
    children?: Child;
}): Child;
/**
 * Keyed list: each item is rendered once and kept while it stays in the array
 * (matched by reference), so state inside rows survives reordering.
 */
export declare function For<T>(props: {
    each: MaybeAccessor<readonly T[] | undefined | null>;
    fallback?: Child;
    children: (item: T, index: Accessor<number>) => Child;
}): Child;
