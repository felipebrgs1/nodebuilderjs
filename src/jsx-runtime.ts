// TSX runtime. `tsc` turns <X a={1}>..</X> into jsx(X, { a: 1, children }).
// jsx() only records a lightweight description; the component runs once when the
// description is inserted into the tree (so <Show>/<For> can decide lazily).

import { createEffect, untrack } from "./reactive.js";
import { UINode } from "./node.js";

export interface ElementDesc {
  readonly $element: true;
  readonly type: Component<any>;
  readonly props: Record<string, unknown>;
}

export type Child =
  | UINode
  | ElementDesc
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly Child[]
  | (() => Child);

export type Component<P = {}> = (props: P) => Child;

export function jsx(type: Component<any>, props: Record<string, unknown>): ElementDesc {
  return { $element: true, type, props };
}
export { jsx as jsxs, jsx as jsxDEV };

export function Fragment(props: { children?: Child }): Child {
  return props.children;
}

export function isElement(v: unknown): v is ElementDesc {
  return typeof v === "object" && v !== null && (v as ElementDesc).$element === true;
}

/** Runs a component. Its body is untracked: only explicit accessors are reactive. */
export function instantiate(el: ElementDesc): Child {
  return untrack(() => el.type(el.props));
}

/** Turns any child into nodes. Accessors are called (and tracked by the caller). */
export function resolve(child: Child, out: UINode[] = []): UINode[] {
  if (child == null || typeof child === "boolean") return out;
  if (child instanceof UINode) out.push(child);
  else if (isElement(child)) resolve(instantiate(child), out);
  else if (typeof child === "function") resolve(child(), out);
  else if (Array.isArray(child)) for (const c of child) resolve(c, out);
  else out.push(textNode(String(child)));
  return out;
}

/** Inserts children into `parent`; every accessor becomes its own reactive slot. */
export function insert(parent: UINode, child: Child) {
  if (child == null || typeof child === "boolean") return;
  if (Array.isArray(child)) {
    for (const c of child) insert(parent, c);
  } else if (isElement(child)) {
    insert(parent, instantiate(child));
  } else if (typeof child === "function") {
    const slot = parent.addSlot();
    createEffect(() => parent.setSlot(slot, resolve((child as () => Child)())));
  } else {
    parent.setSlot(parent.addSlot(), resolve(child));
  }
}

let textFactory: (text: string) => UINode = (text) => {
  const n = new UINode("text");
  n.label = JSON.stringify(text);
  return n;
};

/** Lets widgets.ts decide how bare strings render. */
export function setTextFactory(fn: (text: string) => UINode) {
  textFactory = fn;
}

function textNode(text: string) {
  return textFactory(text);
}

export namespace JSX {
  export type Element = ElementDesc;
  export type ElementType = Component<any>;
  export interface ElementChildrenAttribute {
    children: {};
  }
  export interface IntrinsicElements {}
}
