// Props shared by every widget: style keys, event handlers, inheritance and interaction state.

import type { Child } from "../jsx-runtime.js";
import { type ElementRef, type Handlers, type Style, UINode } from "../render/node.js";
import { type MaybeAccessor, createEffect, createSignal } from "../reactive/signals.js";

export type StyleProps = { [K in keyof Style]?: MaybeAccessor<NonNullable<Style[K]>> } & {
  /** Called with the widget's element when it is created: focus(), scrollTo(), its laid-out box. */
  ref?: (el: ElementRef) => void;
};
export type BoxProps = StyleProps & Handlers & { children?: Child };

const STYLE_KEYS: (keyof Style)[] = [
  "direction", "gap", "padding", "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight", "grow",
  "align", "justify", "position", "left", "top", "clip", "background", "radius", "borderWidth", "borderColor",
  "shadow", "color", "fontSize", "bold", "cursor", "opacity", "translateX", "translateY",
];
const HANDLER_KEYS: (keyof Handlers)[] = [
  "onClick", "onPointerDown", "onPointerUp", "onPointerEnter", "onPointerLeave", "onPointerMove", "onScroll", "onKeyDown", "onFocus", "onBlur", "onResize",
];

/** Binds style props (static or reactive) and event handlers onto a node. */
export function applyProps(node: UINode, props: Record<string, any>) {
  for (const key of STYLE_KEYS) {
    if (!(key in props)) continue;
    const value = props[key];
    if (typeof value === "function") createEffect(() => node.set(key, value()));
    else node.set(key, value);
  }
  for (const key of HANDLER_KEYS) if (props[key]) node.handlers[key] = props[key];
  props.ref?.(node);
}

export function inherited<K extends "color" | "fontSize" | "bold">(node: UINode, key: K): Style[K] | undefined {
  for (let n: UINode | null = node; n; n = n.parent) if (n.style[key] !== undefined) return n.style[key];
  return undefined;
}

/** Tracks hover/press/focus for any interactive node. */
export function interaction(node: UINode) {
  const [hovered, setHovered] = createSignal(false);
  const [pressed, setPressed] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  const prev = { ...node.handlers };
  Object.assign(node.handlers, {
    onPointerEnter: () => (setHovered(true), prev.onPointerEnter?.()),
    onPointerLeave: () => (setHovered(false), setPressed(false), prev.onPointerLeave?.()),
    onPointerDown: (e) => (setPressed(true), prev.onPointerDown?.(e)),
    onPointerUp: (e) => (setPressed(false), prev.onPointerUp?.(e)),
    onFocus: () => (setFocused(true), prev.onFocus?.()),
    onBlur: () => (setFocused(false), prev.onBlur?.()),
  } satisfies Handlers);
  return { hovered, pressed, focused };
}
