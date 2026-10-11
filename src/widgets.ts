// Built-in widgets. Each is a plain function component that creates UINodes and
// binds props to them; there is no special widget base class.

import { windowControls, windowOptionsKey, windowState } from "./app.js";
import { type Bitmap, type ImageInput, type ImageSource, acquireImage, releaseImage } from "./image.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseColor } from "./paint.js";
import { type IconNode, type Rgba, type Svg, parseSvg, renderSvg } from "./svg.js";
import { type Child, insert, jsx, setTextFactory } from "./jsx-runtime.js";
import { edges } from "./layout.js";
import { type Handlers, type Style, UINode, displayScale, invalidate, measureText, metricsGeneration } from "./node.js";
import { type Accessor, type MaybeAccessor, createEffect, createSignal, onCleanup, read, untrack } from "./reactive.js";
import { theme } from "./theme.js";

export type StyleProps = { [K in keyof Style]?: MaybeAccessor<NonNullable<Style[K]>> };
export type BoxProps = StyleProps & Handlers & { children?: Child };

const STYLE_KEYS: (keyof Style)[] = [
  "direction", "gap", "padding", "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight", "grow",
  "align", "justify", "position", "left", "top", "clip", "background", "radius", "borderWidth", "borderColor",
  "shadow", "color", "fontSize", "bold", "cursor",
];
const HANDLER_KEYS: (keyof Handlers)[] = [
  "onClick", "onPointerDown", "onPointerUp", "onPointerEnter", "onPointerLeave", "onScroll", "onKeyDown", "onFocus", "onBlur",
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
}

function inherited<K extends "color" | "fontSize" | "bold">(node: UINode, key: K): Style[K] | undefined {
  for (let n: UINode | null = node; n; n = n.parent) if (n.style[key] !== undefined) return n.style[key];
  return undefined;
}

// ---- layout containers -----------------------------------------------------

export function Box(props: BoxProps) {
  const node = new UINode("Box");
  applyProps(node, props);
  insert(node, props.children);
  return node;
}

export function Column(props: BoxProps) {
  const node = Box(props);
  node.label = "Column";
  node.style.direction ??= "column";
  return node;
}

export function Row(props: BoxProps) {
  const node = Box(props);
  node.label = "Row";
  node.style.direction ??= "row";
  return node;
}

export function Spacer(props: { size?: number }) {
  const node = new UINode("Spacer");
  if (props.size !== undefined) node.style.width = node.style.height = props.size;
  else node.style.grow = 1;
  return node;
}

/** Vertically scrolling column. Give it `grow` or a fixed height. */
export function Scroll(props: BoxProps) {
  const node = Column(props);
  node.label = "Scroll";
  node.scrollable = true;
  node.style.minHeight ??= 0;
  return node;
}

export function Divider() {
  const node = new UINode("Divider");
  node.style.height = 1;
  node.style.background = theme.divider;
  return node;
}

// ---- text ------------------------------------------------------------------

function textOf(child: Child): string {
  if (child == null || typeof child === "boolean") return "";
  if (typeof child === "function") return textOf((child as () => Child)());
  if (Array.isArray(child)) return child.map(textOf).join("");
  if (typeof child === "string" || typeof child === "number") return String(child);
  return "";
}

export function Text(props: StyleProps & Handlers & { text?: MaybeAccessor<string | number>; children?: Child }) {
  const node = new UINode("Text");
  applyProps(node, props);
  let value = "";
  createEffect(() => {
    value = props.text !== undefined ? String(read(props.text)) : textOf(props.children);
    node.label = `Text ${JSON.stringify(value)}`;
    invalidate();
  });
  const font = () => ({ size: inherited(node, "fontSize") ?? theme.font.size, bold: inherited(node, "bold") ?? false });
  // Every row of a long list is measured each frame (scroll extent), so skip the shared cache's key building.
  let last = { value: "", size: 0, bold: false, generation: -1, result: { width: 0, height: 0 } };
  node.measure = () => {
    const { size, bold } = font();
    if (value === last.value && size === last.size && bold === last.bold && last.generation === metricsGeneration()) return last.result;
    const m = measureText(value, size, bold);
    last = { value, size, bold, generation: metricsGeneration(), result: { width: Math.ceil(m.width), height: Math.ceil(m.ascent + m.descent) } };
    return last.result;
  };
  node.paint = (p, n) => {
    const { size, bold } = font();
    const [pt, , , pl] = edges(n.style.padding);
    p.text(n.x + pl, n.y + pt, value, size, inherited(n, "color") ?? theme.text.primary, bold);
  };
  return node;
}

setTextFactory((text) => Text({ text }));

// ---- images ----------------------------------------------------------------

/** How the image fills its box: whole and centered, cropped to fill, or stretched. */
export type ImageFit = "contain" | "cover" | "fill";

const FULL_UV = [0, 0, 1, 1] as const;

/**
 * Shows a PNG. Without width/height it takes the image's size (1 image pixel = 1 logical
 * pixel); with only one of them, the other follows the aspect ratio. Files showing in
 * several places are decoded once and freed when the last one unmounts.
 */
export function Image(props: StyleProps & Handlers & { src: MaybeAccessor<ImageInput>; fit?: MaybeAccessor<ImageFit>; opacity?: MaybeAccessor<number> }) {
  const node = new UINode("Image");
  applyProps(node, props);
  let source: ImageSource | null = null;
  let fit: ImageFit = "contain";
  let opacity = 1;
  createEffect(() => {
    const s = acquireImage(read(props.src));
    source = s;
    node.label = s.error ? "Image (error)" : `Image ${s.width}x${s.height}`;
    invalidate();
    onCleanup(() => releaseImage(s));
  });
  createEffect(() => {
    fit = read(props.fit ?? "contain");
    opacity = read(props.opacity ?? 1);
    invalidate();
  });

  node.measure = () => {
    if (!source?.width) return { width: 0, height: 0 };
    const [pt, pr, pb, pl] = edges(node.style.padding);
    const { width: w, height: h } = node.style;
    const ratio = source.width / source.height;
    if (w !== undefined && h === undefined) {
      const inner = Math.max(0, w - pl - pr);
      return { width: inner, height: inner / ratio };
    }
    if (h !== undefined && w === undefined) {
      const inner = Math.max(0, h - pt - pb);
      return { width: inner * ratio, height: inner };
    }
    return { width: source.width, height: source.height };
  };
  node.paint = (p, n) => {
    if (!source?.width || opacity <= 0) return;
    const [pt, pr, pb, pl] = edges(n.style.padding);
    let x = n.x + pl, y = n.y + pt;
    let w = Math.max(0, n.width - pl - pr), h = Math.max(0, n.height - pt - pb);
    let uv: readonly [number, number, number, number] = FULL_UV;
    const { width: iw, height: ih } = source;
    if (fit === "contain") {
      const k = Math.min(w / iw, h / ih);
      x += (w - iw * k) / 2;
      y += (h - ih * k) / 2;
      w = iw * k;
      h = ih * k;
    } else if (fit === "cover") {
      const k = Math.max(w / iw, h / ih);
      const fu = w / (iw * k), fv = h / (ih * k); // visible fraction of the image
      uv = [(1 - fu) / 2, (1 - fv) / 2, (1 + fu) / 2, (1 + fv) / 2];
    }
    // Like CSS, the content's corners follow the box's radius minus the padding.
    const radius = Math.max(0, (n.style.radius ?? 0) - Math.min(pt, pr, pb, pl));
    p.image(x, y, w, h, source, uv, radius, opacity);
  };
  return node;
}

// ---- icons -----------------------------------------------------------------

/** SVG markup, a path to an .svg file, or Lucide's icon data. */
export type IconInput = string | IconNode;

const parsedSvgs = new Map<string, Svg>();
const parsedIconNodes = new WeakMap<IconNode, Svg>();
const svgIds = new WeakMap<Svg, number>();
let nextSvgId = 1;

function loadSvg(input: IconInput): Svg {
  if (typeof input !== "string") {
    let svg = parsedIconNodes.get(input);
    if (!svg) parsedIconNodes.set(input, (svg = parseSvg(input)));
    return svg;
  }
  const markup = input.trimStart().startsWith("<");
  const key = markup ? input : resolve(input);
  let svg = parsedSvgs.get(key);
  if (!svg) parsedSvgs.set(key, (svg = parseSvg(markup ? input : readFileSync(key, "utf8"))));
  return svg;
}

// Rasterized icons by (svg, pixel size, stroke width[, color]); a few hundred are tiny.
const iconBitmaps = new Map<string, Bitmap>();
function iconBitmap(key: string, render: () => Bitmap): Bitmap {
  let bitmap = iconBitmaps.get(key);
  if (bitmap) iconBitmaps.delete(key); // re-insert: most recently used last
  else bitmap = render();
  iconBitmaps.set(key, bitmap);
  if (iconBitmaps.size > 512) iconBitmaps.delete(iconBitmaps.keys().next().value!);
  return bitmap;
}

/**
 * An SVG icon, sized `size` (height; width follows the viewBox) and colored like text:
 * `color` is inherited, so it follows its Button or Text parent. Icons drawn only with
 * currentColor are rasterized once in white and tinted on the GPU, so changing the color
 * is free. Works with Lucide (`lucide-static` files or `lucide` data) and Phosphor.
 */
export function Icon(props: StyleProps & Handlers & { svg: MaybeAccessor<IconInput>; size?: MaybeAccessor<number>; strokeWidth?: MaybeAccessor<number> }) {
  const node = new UINode("Icon");
  applyProps(node, props);
  let svg: Svg | null = null;
  let size = theme.icon.size;
  let strokeWidth: number | undefined;
  let source: ImageSource | null = null;
  let sourceKey = "";
  createEffect(() => {
    const input = read(props.svg);
    try {
      svg = loadSvg(input);
    } catch (err) {
      svg = null;
      console.warn(`nodebuilder: could not load icon ${typeof input === "string" && !input.trimStart().startsWith("<") ? input : ""}: ${(err as Error).message}`);
    }
    invalidate();
  });
  createEffect(() => {
    size = read(props.size ?? theme.icon.size);
    strokeWidth = props.strokeWidth === undefined ? undefined : read(props.strokeWidth);
    invalidate();
  });
  onCleanup(() => source && releaseImage(source));

  node.measure = () => {
    const [, , vw, vh] = svg?.viewBox ?? [0, 0, 1, 1];
    return { width: (size * vw) / vh, height: size };
  };
  node.paint = (p, n) => {
    if (!svg) return;
    const [pt, pr, pb, pl] = edges(n.style.padding);
    const w = n.width - pl - pr, h = n.height - pt - pb;
    if (w <= 0 || h <= 0) return;
    // Rasterize at the device size and snap to device pixels, so 1 texel = 1 pixel (crisp).
    const scale = displayScale();
    const pw = Math.max(1, Math.round(w * scale)), ph = Math.max(1, Math.round(h * scale));
    const x = Math.round((n.x + pl) * scale) / scale, y = Math.round((n.y + pt) * scale) / scale;
    const color = inherited(n, "color") ?? theme.text.primary;
    const current = svg;
    let id = svgIds.get(current);
    if (!id) svgIds.set(current, (id = nextSvgId++));
    const key = `${id}|${pw}x${ph}|${strokeWidth ?? ""}${current.monochrome ? "" : `|${color}`}`;
    if (key !== sourceKey) {
      const bitmap = iconBitmap(key, () =>
        renderSvg(current, pw, ph, { color: current.monochrome ? undefined : (parseColor(color) as Rgba), strokeWidth }),
      );
      const next = acquireImage(bitmap);
      if (source) releaseImage(source);
      source = next;
      sourceKey = key;
    }
    p.image(x, y, pw / scale, ph / scale, source!, FULL_UV, 0, 1, current.monochrome ? color : "#ffffff");
  };
  return node;
}

// ---- interactive -----------------------------------------------------------

type Variant = "default" | "primary" | "danger" | "flat";

function palette(variant: Variant) {
  if (variant === "primary") return theme.accent;
  if (variant === "danger") return theme.danger;
  if (variant === "flat") return { ...theme.control, base: "#00000000" };
  return theme.control;
}

/** Tracks hover/press/focus for any interactive node. */
function interaction(node: UINode) {
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

export function Button(
  props: StyleProps & {
    label?: MaybeAccessor<string>;
    children?: Child;
    variant?: Variant;
    disabled?: MaybeAccessor<boolean>;
    onClick?: () => void;
  },
) {
  const node = new UINode("Button");
  const colors = palette(props.variant ?? "default");
  const disabled = () => !!read(props.disabled ?? false);
  Object.assign(node.style, {
    direction: "row", align: "center", justify: "center", gap: 6, padding: [8, 16], radius: theme.radius, cursor: "pointer",
    color: colors.text, bold: props.variant === "primary" || props.variant === "danger",
  } satisfies Style);
  node.focusable = true;
  applyProps(node, props);

  const state = interaction(node);
  const activate = () => !disabled() && props.onClick?.();
  node.handlers.onClick = activate;
  node.handlers.onKeyDown = (e) => {
    if (e.key === "Return" || e.key === "space" || e.key === "KP_Enter") {
      activate();
      e.stop();
    }
  };
  if (props.background === undefined) {
    createEffect(() =>
      node.set("background", disabled() ? colors.base : state.pressed() ? colors.pressed : state.hovered() ? colors.hover : colors.base),
    );
  }
  createEffect(() => {
    node.set("borderWidth", state.focused() ? 2 : 0);
    node.set("borderColor", theme.focusRing);
  });
  createEffect(() => node.set("cursor", disabled() ? "default" : "pointer"));

  if (props.label !== undefined) insert(node, jsx(Text, { text: props.label }));
  insert(node, props.children);
  return node;
}

export function Checkbox(props: { checked: Accessor<boolean>; onChange: (checked: boolean) => void; label?: MaybeAccessor<string> }) {
  const row = new UINode("Checkbox");
  Object.assign(row.style, { direction: "row", align: "center", gap: 10, cursor: "pointer" } satisfies Style);
  row.focusable = true;
  const box = new UINode("CheckboxBox");
  Object.assign(box.style, { width: 20, height: 20, radius: 6 } satisfies Style);
  const mark = new UINode("CheckboxMark");
  Object.assign(mark.style, { position: "absolute", left: 5, top: 5, width: 10, height: 10, radius: 3 } satisfies Style);
  row.setSlot(row.addSlot(), [box]);
  box.setSlot(box.addSlot(), [mark]);

  const state = interaction(row);
  const toggle = () => props.onChange(!untrack(props.checked));
  row.handlers.onClick = toggle;
  row.handlers.onKeyDown = (e) => {
    if (e.key === "space" || e.key === "Return") {
      toggle();
      e.stop();
    }
  };
  createEffect(() => {
    const on = props.checked();
    box.set("background", on ? (state.hovered() ? theme.accent.hover : theme.accent.base) : theme.field.background);
    box.set("borderWidth", on ? 0 : state.focused() ? 2 : 1.5);
    box.set("borderColor", state.focused() ? theme.field.focus : theme.field.border);
    mark.set("background", on ? "#ffffff" : "#00000000");
  });
  if (props.label !== undefined) insert(row, jsx(Text, { text: props.label }));
  return row;
}

export function TextField(
  props: StyleProps & {
    value: Accessor<string>;
    onInput: (value: string) => void;
    onSubmit?: () => void;
    placeholder?: MaybeAccessor<string>;
  },
) {
  const node = new UINode("TextField");
  Object.assign(node.style, {
    padding: [9, 12], radius: theme.radius, background: theme.field.background, cursor: "text", minWidth: 80,
  } satisfies Style);
  node.focusable = true;
  applyProps(node, props);
  const state = interaction(node);

  const chars = () => Array.from(props.value());
  const [caret, setCaret] = createSignal(chars().length);
  const [blinkOn, setBlinkOn] = createSignal(true);
  let scrollX = 0;

  // Keep the caret inside the text when the value changes from outside.
  createEffect(() => {
    const len = chars().length;
    if (untrack(caret) > len) setCaret(len);
    invalidate();
  });
  createEffect(() => {
    const focused = state.focused();
    node.set("borderWidth", focused ? 2 : 1);
    node.set("borderColor", focused ? theme.field.focus : theme.field.border);
  });

  // Caret blink while focused.
  let blink: ReturnType<typeof setInterval> | undefined;
  const restartBlink = () => {
    clearInterval(blink);
    setBlinkOn(true);
    if (untrack(state.focused)) blink = setInterval(() => setBlinkOn((v) => !v), 530);
  };
  createEffect(() => {
    state.focused();
    restartBlink();
  });
  createEffect(() => {
    blinkOn();
    caret();
    invalidate();
  });
  onCleanup(() => clearInterval(blink));

  const size = () => inherited(node, "fontSize") ?? theme.font.size;
  const widthOf = (s: string) => measureText(s, size()).width;

  node.measure = () => {
    const m = measureText("Ag", size());
    return { width: 160, height: Math.ceil(m.ascent + m.descent) };
  };

  node.paint = (p, n) => {
    const [pt, pr, pb, pl] = edges(n.style.padding);
    const innerX = n.x + pl;
    const innerW = n.width - pl - pr;
    const value = props.value();
    const before = chars().slice(0, caret()).join("");
    const caretX = widthOf(before);
    if (caretX - scrollX > innerW - 2) scrollX = caretX - innerW + 2;
    if (caretX - scrollX < 0) scrollX = caretX;
    if (widthOf(value) - scrollX < innerW) scrollX = Math.max(0, widthOf(value) - innerW + 2);

    p.clip(innerX - 1, n.y, innerW + 2, n.height);
    if (value) p.text(innerX - scrollX, n.y + pt, value, size(), inherited(n, "color") ?? theme.text.primary);
    else if (props.placeholder) p.text(innerX, n.y + pt, read(props.placeholder), size(), theme.field.placeholder);
    if (state.focused() && blinkOn()) {
      p.rect(Math.round(innerX + caretX - scrollX), n.y + pt, 1.5, n.height - pt - pb, theme.field.focus);
    }
    p.unclip();
  };

  const edit = (next: string[], at: number) => {
    props.onInput(next.join(""));
    setCaret(at);
    restartBlink();
  };

  node.handlers.onPointerDown = (e) => {
    const [, , , pl] = edges(node.style.padding);
    const x = e.x - node.x - pl + scrollX;
    const cs = chars();
    let best = 0;
    for (let i = 1; i <= cs.length; i++) {
      const w = widthOf(cs.slice(0, i).join(""));
      const prevW = widthOf(cs.slice(0, i - 1).join(""));
      if (x > (prevW + w) / 2) best = i;
      else break;
    }
    setCaret(best);
    restartBlink();
  };

  node.handlers.onKeyDown = (e) => {
    const cs = chars();
    const at = Math.min(caret(), cs.length);
    switch (e.key) {
      case "BackSpace":
        if (at > 0) edit([...cs.slice(0, at - 1), ...cs.slice(at)], at - 1);
        break;
      case "Delete":
      case "KP_Delete":
        if (at < cs.length) edit([...cs.slice(0, at), ...cs.slice(at + 1)], at);
        break;
      case "Left":
        setCaret(Math.max(0, at - 1));
        restartBlink();
        break;
      case "Right":
        setCaret(Math.min(cs.length, at + 1));
        restartBlink();
        break;
      case "Home":
        setCaret(0);
        break;
      case "End":
        setCaret(cs.length);
        break;
      case "Return":
      case "KP_Enter":
        props.onSubmit?.();
        break;
      default: {
        if (!e.text) return;
        const typed = Array.from(e.text);
        edit([...cs.slice(0, at), ...typed, ...cs.slice(at)], at + typed.length);
      }
    }
    e.stop();
  };
  return node;
}

/** A raised surface for grouping content. */
export function Card(props: BoxProps) {
  const node = Column(props);
  node.label = "Card";
  node.style.background ??= theme.card.background;
  node.style.radius ??= 12;
  node.style.padding ??= 16;
  node.style.gap ??= 8;
  node.style.borderWidth ??= 1;
  node.style.borderColor ??= theme.card.border;
  return node;
}

// ---- window ----------------------------------------------------------------

function WindowButton(props: { kind: "minimize" | "maximize" | "close"; onClick: () => void }) {
  const node = new UINode(`WindowButton(${props.kind})`);
  Object.assign(node.style, { width: 26, height: 26, radius: 13, cursor: "default" } satisfies Style);
  const state = interaction(node);
  node.handlers.onClick = props.onClick;
  createEffect(() =>
    node.set("background", state.pressed() ? "#00000033" : state.hovered() ? "#00000024" : "#00000012"),
  );
  node.paint = (p, n) => {
    const cx = n.x + n.width / 2;
    const cy = n.y + n.height / 2;
    const ink = theme.text.primary;
    if (props.kind === "minimize") p.rect(cx - 5, cy + 3, 10, 1.5, ink, 0.75);
    else if (props.kind === "maximize") p.rect(cx - 5, cy - 5, 10, 10, "#00000000", 1.5, 1.5, ink);
    else {
      // "×" drawn as a glyph keeps the core free of line primitives for now.
      const m = measureText("×", 18);
      p.text(cx - m.width / 2, cy - (m.ascent + m.descent) / 2, "×", 18, ink);
    }
  };
  return node;
}

export function Window(
  props: StyleProps & {
    title: string;
    width?: number;
    height?: number;
    appId?: string;
    onClose?: () => boolean | void;
    children?: Child;
  },
) {
  const node = new UINode("Window");
  (node as any)[windowOptionsKey] = props;
  Object.assign(node.style, {
    direction: "column", background: theme.window.background, borderWidth: 1, borderColor: theme.window.border, clip: true,
    padding: 1, // keep children (e.g. the titlebar divider) off the border
  } satisfies Style);
  createEffect(() => node.set("radius", windowState.maximized() || !windowState.transparent() ? 0 : theme.window.radius));

  const bar = new UINode("Titlebar");
  Object.assign(bar.style, {
    direction: "row", align: "center", height: theme.window.titlebarHeight, padding: [0, 10], gap: 8,
  } satisfies Style);
  bar.dragRegion = true;
  bar.handlers.onPointerDown = (e) => {
    if (e.clicks === 2) {
      windowControls.toggleMaximize();
      e.stop();
    }
  };
  const title = Text({ text: props.title, bold: true });
  createEffect(() => title.set("color", windowState.activated() ? theme.text.primary : theme.text.secondary));
  const left = Spacer({});
  const right = Row({ grow: 1, justify: "end", gap: 10, align: "center" });
  right.setSlot(right.addSlot(), [
    WindowButton({ kind: "minimize", onClick: windowControls.minimize }),
    WindowButton({ kind: "maximize", onClick: windowControls.toggleMaximize }),
    WindowButton({ kind: "close", onClick: windowControls.close }),
  ]);
  // Balance the left side so the title stays centred.
  left.style.grow = 1;
  bar.setSlot(bar.addSlot(), [left, title, right]);

  const content = Column({ grow: 1, minHeight: 0 });
  insert(content, props.children);

  node.setSlot(node.addSlot(), [bar, Divider(), content]);
  // width/height are the window's initial size, not a style.
  const { width: _w, height: _h, ...style } = props;
  applyProps(node, style);
  return node;
}
