import { UINode } from "./render/node.js";
export interface ElementDesc {
    readonly $element: true;
    readonly type: Component<any>;
    readonly props: Record<string, unknown>;
}
export type Child = UINode | ElementDesc | string | number | boolean | null | undefined | readonly Child[] | (() => Child);
export type Component<P = {}> = (props: P) => Child;
export declare function jsx(type: Component<any>, props: Record<string, unknown>): ElementDesc;
export { jsx as jsxs, jsx as jsxDEV };
export declare function Fragment(props: {
    children?: Child;
}): Child;
export declare function isElement(v: unknown): v is ElementDesc;
/** Runs a component. Its body is untracked: only explicit accessors are reactive. */
export declare function instantiate(el: ElementDesc): Child;
/** Turns any child into nodes. Accessors are called (and tracked by the caller). */
export declare function resolve(child: Child, out?: UINode[]): UINode[];
/** Inserts children into `parent`; every accessor becomes its own reactive slot. */
export declare function insert(parent: UINode, child: Child): void;
/** Lets widgets.ts decide how bare strings render. */
export declare function setTextFactory(fn: (text: string) => UINode): void;
export declare namespace JSX {
    type Element = ElementDesc;
    type ElementType = Component<any>;
    interface ElementChildrenAttribute {
        children: {};
    }
    interface IntrinsicElements {
    }
}
