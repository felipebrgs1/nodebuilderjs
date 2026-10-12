// Props shared by every widget: style keys, event handlers, inheritance and interaction state.

import type { Child } from "../jsx-runtime.js";
import { type ElementRef, type Handlers, type Style, UINode } from "../render/node.js";
import { type Accessor, type MaybeAccessor, createEffect, createSignal, read } from "../reactive/signals.js";
import { theme } from "../theme.js";

/** Style values as props: each one static or an accessor. */
export type StyleValues = { [K in keyof Style]?: MaybeAccessor<NonNullable<Style[K]>> };

export type StyleProps = StyleValues & {
  /** Called with the widget's element when it is created: focus(), scrollTo(), its laid-out box. */
  ref?: (el: ElementRef) => void;
  /** Accessible name, for elements without text (an icon-only button); tests find it with `findByLabel`. */
  ariaLabel?: MaybeAccessor<string>;
  /**
   * Shown over the base style while the pointer is over the widget (any style key; values
   * may be accessors). It wins over the widget's own hover colors; a disabled widget ignores it.
   */
  hoverStyle?: StyleValues;
  /** Like `hoverStyle`, while the widget is pressed; it wins over `hoverStyle`. */
  pressStyle?: StyleValues;
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

/** Binds style props (static or reactive), event handlers, `hoverStyle`/`pressStyle` and `ref` onto a node. */
export function applyProps(node: UINode, props: Record<string | symbol, any>) {
  for (const key of STYLE_KEYS) {
    if (!(key in props)) continue;
    const value = props[key];
    if (typeof value === "function") createEffect(() => node.set(key, value()));
    else node.set(key, value);
  }
  // Spread createInteraction() props first, so the app's handlers already see the new state.
  for (const key of Object.getOwnPropertySymbols(props)) {
    if (props[key] instanceof Tracker) addHandlers(node, props[key].handlers);
  }
  const own: Handlers = {};
  for (const key of HANDLER_KEYS) if (props[key]) own[key] = props[key];
  addHandlers(node, own);
  if (props.hoverStyle || props.pressStyle) stateStyles(node, props);
  const aria = props.ariaLabel;
  if (typeof aria === "function") createEffect(() => (node.ariaLabel = aria()));
  else if (aria !== undefined) node.ariaLabel = aria;
  props.ref?.(node);
}

type AnyHandler = (e?: unknown) => void;

/** Chains `handlers` after (or, with `first`, before) the ones the node has: nothing is replaced. */
function addHandlers(node: UINode, handlers: Handlers, first = false) {
  const all = node.handlers as Record<string, AnyHandler | undefined>;
  for (const [key, added] of Object.entries(handlers) as [string, AnyHandler][]) {
    const had = all[key];
    if (!had) all[key] = added;
    else if (first) all[key] = (e) => (added(e), had(e));
    else all[key] = (e) => (had(e), added(e));
  }
}

/** hoverStyle/pressStyle: per key, an override on top of whatever set() gives the node. */
function stateStyles(node: UINode, props: { hoverStyle?: StyleValues; pressStyle?: StyleValues; disabled?: MaybeAccessor<boolean> }) {
  const hover = props.hoverStyle ?? {};
  const press = props.pressStyle ?? {};
  // Only pressStyle tracks the press: an onPointerDown would make the node claim the press
  // (e.g. a hover-styled child of a window drag region would stop moving the window).
  const state = props.pressStyle ? interaction(node) : hoverOf(node);
  const keys = new Set([...Object.keys(hover), ...Object.keys(press)] as (keyof Style)[]);
  for (const key of keys) {
    createEffect(() => {
      const on = !read(props.disabled ?? false);
      const from = on && state.pressed() && key in press ? press : on && state.hovered() && key in hover ? hover : null;
      node.override(key, from ? read(from[key]) : undefined);
    });
  }
}

export function inherited<K extends "color" | "fontSize" | "bold">(node: UINode, key: K): Style[K] | undefined {
  for (let n: UINode | null = node; n; n = n.parent) if (n.style[key] !== undefined) return n.style[key];
  return undefined;
}

/** Hover, press and focus state, and the handlers that keep it. */
function track() {
  const [hovered, setHovered] = createSignal(false);
  const [pressed, setPressed] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  const handlers = {
    onPointerEnter: () => setHovered(true),
    onPointerLeave: () => (setHovered(false), setPressed(false)),
    onPointerDown: () => setPressed(true),
    onPointerUp: () => setPressed(false),
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  } satisfies Handlers;
  return { state: { hovered, pressed, focused }, handlers };
}

/** What `createInteraction().props` carries; applyProps recognises it by class. */
class Tracker {
  constructor(readonly handlers: Handlers) {}
}

export interface InteractionState {
  hovered: Accessor<boolean>;
  /** Between pointer down and up (or leaving) on the element. */
  pressed: Accessor<boolean>;
  /** Only focusable widgets (Button, TextField...) get focus. */
  focused: Accessor<boolean>;
}

/**
 * Spread on any widget: `<Box {...card.props}>`. It adds to the widget's own handlers and to
 * handlers written next to it (`onPointerEnter={...}` works before or after the spread), and
 * several interactions can be spread on the same widget.
 */
export type InteractionProps = { readonly [key: symbol]: unknown };

export interface Interaction extends InteractionState {
  readonly props: InteractionProps;
}

/**
 * Hover/press/focus state of whatever widget its `props` are spread on, readable anywhere,
 * e.g. by a child that only shows while its card is hovered:
 * `const card = createInteraction(); <Box {...card.props}><Show when={card.hovered}>...`.
 */
export function createInteraction(): Interaction {
  const { state, handlers } = track();
  // A key of its own, so spreading two interactions on one widget keeps both.
  return { ...state, props: { [Symbol("interaction")]: new Tracker(handlers) } };
}

/** Hover alone, with enter/leave handlers only; reuses the full tracking if the node has it. */
function hoverOf(node: UINode): Pick<InteractionState, "hovered" | "pressed"> {
  const full = tracked.get(node);
  if (full) return full;
  const [hovered, setHovered] = createSignal(false);
  addHandlers(node, { onPointerEnter: () => setHovered(true), onPointerLeave: () => setHovered(false) }, true);
  return { hovered, pressed: () => false };
}

const tracked = new WeakMap<UINode, InteractionState>();

/** Tracks hover/press/focus of a node (once per node: widgets and hoverStyle share it). */
export function interaction(node: UINode): InteractionState {
  let state = tracked.get(node);
  if (!state) {
    const t = track();
    addHandlers(node, t.handlers, true);
    tracked.set(node, (state = t.state));
  }
  return state;
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

