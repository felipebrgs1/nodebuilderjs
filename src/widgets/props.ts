// Props shared by every widget: style keys, event handlers, inheritance and interaction state.

import type { Child } from "../jsx-runtime.js";
import { type Color, type ElementRef, type FontStyle, type Handlers, type KeyEvent, type Percent, REGULAR, type SizeKey, type Style, UINode, invalidate } from "../render/node.js";
import { type Accessor, type MaybeAccessor, createEffect, createSignal, read } from "../reactive/signals.js";
import { theme } from "../theme.js";

/** Style values as props: each one static or an accessor. */
export type StyleValues = { [K in keyof Style]?: MaybeAccessor<NonNullable<Style[K]>> };

/** Sizes as props: px, or a percentage of the parent's content box (`"50%"`). */
export type SizeValues = { [K in SizeKey]?: MaybeAccessor<number | Percent> };

export type StyleProps = Omit<StyleValues, SizeKey> & SizeValues & {
  /** Called with the widget's element when it is created: focus(), scrollTo(), its laid-out box. */
  ref?: (el: ElementRef) => void;
  /** Accessible name, for elements without text (an icon-only button); tests find it with `findByLabel`. */
  ariaLabel?: MaybeAccessor<string>;
  /** Pressing here moves the window and a double click toggles maximize (a custom title bar). Children that handle the press keep it. */
  dragRegion?: MaybeAccessor<boolean>;
  /**
   * Shown over the base style while the pointer is over the widget (any style key; values
   * may be accessors). It wins over the widget's own hover colors; a disabled widget ignores it.
   */
  hoverStyle?: StyleValues;
  /** Like `hoverStyle`, while the widget is pressed; it wins over `hoverStyle`. */
  pressStyle?: StyleValues;
  /** Like `hoverStyle`, while the widget has the keyboard focus (a custom focus ring); hover and press win over it. */
  focusStyle?: StyleValues;
};
export type BoxProps = StyleProps & Handlers & {
  /**
   * Takes the keyboard focus when clicked (its `onKeyDown` then gets the keys), without
   * looking like a control: a page or a menu that handles Escape. Out of the Tab order
   * unless `tabStop`.
   */
  focusable?: MaybeAccessor<boolean>;
  /** With `focusable`: also reached with Tab. */
  tabStop?: boolean;
  children?: Child;
};

const STYLE_KEYS: (keyof Style)[] = [
  "direction", "gap", "padding", "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight", "grow",
  "align", "justify", "position", "left", "top", "clip", "background", "radius", "borderWidth", "borderColor",
  "shadow", "color", "fontSize", "bold", "underline", "cursor", "opacity", "translateX", "translateY",
  "alignSelf", "right", "bottom", "zIndex", "columns", "rowGap", "aspectRatio", "wrap", "margin",
  "fontWeight", "italic", "letterSpacing", "fontFamily", "fontFeatures", "fontVariations", "minColumnWidth",
];
const HANDLER_KEYS: (keyof Handlers)[] = [
  "onClick", "onPointerDown", "onPointerUp", "onPointerEnter", "onPointerLeave", "onPointerMove", "onScroll", "onKeyDown", "onFocus", "onBlur", "onResize",
];

/**
 * For widgets that paint `color` and `background` themselves (a bar's fill and track): the
 * props without them, for applyProps, and accessors of the two (theme defaults), which also
 * repaint when they change.
 */
export function ownColors<P extends StyleProps>(props: P, color: () => Color, background: () => Color) {
  const { color: c, background: bg, ...rest } = props;
  const fill = () => (c === undefined ? color() : read(c));
  // A gradient track would need the box; a bar takes plain colors.
  const track = () => {
    const v = bg === undefined ? undefined : read(bg);
    return typeof v === "string" ? v : background();
  };
  createEffect(() => (fill(), track(), invalidate()));
  return { rest, fill, track };
}

/** Binds style props (static or reactive), event handlers, `hoverStyle`/`pressStyle` and `ref` onto a node. */
export function applyProps(node: UINode, props: Record<string | symbol, any>) {
  for (const key of STYLE_KEYS) {
    if (!(key in props)) continue;
    const value = props[key];
    const apply = SIZE_KEYS.has(key) ? (v: unknown) => setSize(node, key as SizeKey, v) : (v: unknown) => node.set(key, v as never);
    if (typeof value === "function") createEffect(() => apply(value()));
    else apply(value);
  }
  // Spread createInteraction() props first, so the app's handlers already see the new state.
  for (const key of Object.getOwnPropertySymbols(props)) {
    if (props[key] instanceof Tracker) addHandlers(node, props[key].handlers);
  }
  const own: Handlers = {};
  for (const key of HANDLER_KEYS) if (props[key]) own[key] = props[key];
  addHandlers(node, own);
  if (props.hoverStyle || props.pressStyle || props.focusStyle) stateStyles(node, props);
  const aria = props.ariaLabel;
  if (typeof aria === "function") createEffect(() => (node.ariaLabel = aria()));
  else if (aria !== undefined) node.ariaLabel = aria;
  const focusable = props.focusable;
  if (focusable !== undefined) {
    node.tabStop = !!props.tabStop;
    if (typeof focusable === "function") createEffect(() => (node.focusable = !!focusable()) || node.blur());
    else node.focusable = !!focusable;
  }
  const drag = props.dragRegion;
  if (typeof drag === "function") createEffect(() => (node.dragRegion = !!drag()));
  else if (drag !== undefined) node.dragRegion = !!drag;
  props.ref?.(node);
}

type AnyHandler = (e?: unknown) => void;

const SIZE_KEYS = new Set<keyof Style>(["width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight"]);

/** A size prop: px into the style, `"50%"` for layout to resolve against the parent. */
function setSize(node: UINode, key: SizeKey, value: unknown) {
  if (typeof value === "string" && value.endsWith("%")) {
    const n = Number(value.slice(0, -1));
    if (!Number.isFinite(n)) throw new Error(`nodebuilder: bad ${key} "${value}" (use a number or a percentage like "50%")`);
    node.setPercent(key, n);
    return;
  }
  node.setPercent(key, undefined);
  node.set(key, value as number | undefined);
}

/**
 * Sets a widget's own handler after applyProps without dropping the ones the node has (the
 * app's, press state): those run first. For keys, a stop() there skips the widget's handler,
 * so an app can take a key from a control.
 */
export function ownHandler<K extends keyof Handlers>(node: UINode, key: K, handler: NonNullable<Handlers[K]>) {
  const all = node.handlers as Record<string, AnyHandler | undefined>;
  const prev = all[key];
  const own = handler as AnyHandler;
  if (!prev) all[key] = own;
  else if (key === "onKeyDown") {
    all[key] = (e) => {
      const ev = e as KeyEvent;
      let stopped = false;
      prev({ ...ev, stop: () => ((stopped = true), ev.stop()) } satisfies KeyEvent);
      if (!stopped) own(ev);
    };
  } else all[key] = (e) => (prev(e), own(e));
}

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

/** hoverStyle/pressStyle/focusStyle: per key, an override on top of whatever set() gives the node. */
function stateStyles(node: UINode, props: { hoverStyle?: StyleValues; pressStyle?: StyleValues; focusStyle?: StyleValues; disabled?: MaybeAccessor<boolean> }) {
  const hover = props.hoverStyle ?? {};
  const press = props.pressStyle ?? {};
  const focus = props.focusStyle ?? {};
  // Only pressStyle and focusStyle track the press: an onPointerDown would make the node claim
  // the press (e.g. a hover-styled child of a window drag region would stop moving the window).
  const state: InteractionState = props.pressStyle || props.focusStyle ? interaction(node) : { ...hoverOf(node), focused: () => false };
  const keys = new Set([...Object.keys(hover), ...Object.keys(press), ...Object.keys(focus)] as (keyof Style)[]);
  for (const key of keys) {
    createEffect(() => {
      const on = !read(props.disabled ?? false);
      const from = on && state.pressed() && key in press ? press
        : on && state.hovered() && key in hover ? hover
        : on && state.focused() && key in focus ? focus
        : null;
      node.override(key, from ? read(from[key]) : undefined);
    });
  }
}

export function inherited<K extends "color" | "fontSize" | "bold" | "underline" | "fontWeight" | "italic" | "letterSpacing" | "fontFamily" | "fontFeatures" | "fontVariations">(node: UINode, key: K): Style[K] | undefined {
  for (let n: UINode | null = node; n; n = n.parent) if (n.style[key] !== undefined) return n.style[key];
  return undefined;
}

/**
 * The font of the node's text (size, weight, italic, letter spacing, family...), inherited, in
 * one walk up the tree: it runs for every text measurement, many per node and frame. The
 * nearest `fontWeight` or `bold` (700/400) gives the weight; on the same node `fontWeight` wins.
 * `last` is returned while nothing changed.
 */
export function inheritedText(node: UINode, last?: FontStyle): { size: number | undefined; face: FontStyle } {
  let size: number | undefined, weight: number | undefined, italic: boolean | undefined, letterSpacing: number | undefined;
  let family: string | undefined, features: string | undefined, variations: string | undefined;
  for (let n: UINode | null = node; n; n = n.parent) {
    const s = n.style;
    size ??= s.fontSize;
    weight ??= s.fontWeight ?? (s.bold === undefined ? undefined : s.bold ? 700 : 400);
    italic ??= s.italic;
    letterSpacing ??= s.letterSpacing;
    family ??= s.fontFamily;
    features ??= s.fontFeatures;
    variations ??= s.fontVariations;
  }
  return { size, face: fontOf(weight ?? 400, italic ?? false, letterSpacing ?? 0, family ?? "", features ?? "", variations ?? "", last) };
}

function fontOf(weight: number, italic: boolean, letterSpacing: number, family: string, features: string, variations: string, last?: FontStyle): FontStyle {
  if (
    last && last.weight === weight && last.italic === italic && last.letterSpacing === letterSpacing &&
    last.family === family && last.features === features && last.variations === variations
  ) return last;
  if (weight === 400 && !italic && !letterSpacing && !family && !features && !variations) return REGULAR;
  return { weight, italic, letterSpacing, family, features, variations };
}

/** The font of the node's text, inherited (`inheritedText` without the size). */
export function inheritedFont(node: UINode, last?: FontStyle): FontStyle {
  return inheritedText(node, last).face;
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

