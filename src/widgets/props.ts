// Props shared by every widget: style keys, event handlers, inheritance and interaction state.

import type { Child } from "../jsx-runtime.js";
import { type ElementRef, type Handlers, type Style, UINode } from "../render/node.js";
import { type Accessor, type MaybeAccessor, createEffect, createSignal, read } from "../reactive/signals.js";
import { theme } from "../theme.js";

export type StyleProps = { [K in keyof Style]?: MaybeAccessor<NonNullable<Style[K]>> } & {
  /** Called with the widget's element when it is created: focus(), scrollTo(), its laid-out box. */
  ref?: (el: ElementRef) => void;
  /** Accessible name, for elements without text (an icon-only button); tests find it with `findByLabel`. */
  ariaLabel?: MaybeAccessor<string>;
  /** Pressing here moves the window and a double click toggles maximize (a custom title bar). Children that handle the press keep it. */
  dragRegion?: MaybeAccessor<boolean>;
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
  const aria = props.ariaLabel;
  if (typeof aria === "function") createEffect(() => (node.ariaLabel = aria()));
  else if (aria !== undefined) node.ariaLabel = aria;
  const drag = props.dragRegion;
  if (typeof drag === "function") createEffect(() => (node.dragRegion = !!drag()));
  else if (drag !== undefined) node.dragRegion = !!drag;
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

/**
 * `disabled` for a control: dimmed, out of focus and of the Tab order, default cursor
 * (`cursor` when enabled). Returns the accessor; the control's own handlers check it.
 */
export function disableable(node: UINode, props: { disabled?: MaybeAccessor<boolean>; opacity?: unknown }, cursor = "pointer"): Accessor<boolean> {
  const disabled = () => !!read(props.disabled ?? false);
  createEffect(() => {
    const off = disabled();
    node.focusable = !off;
    if (props.opacity === undefined) node.set("opacity", off ? theme.disabledOpacity : 1);
    node.set("cursor", off ? "default" : cursor);
    if (off) node.blur();
  });
  return disabled;
}
