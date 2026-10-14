// Headless helpers for app tests (bun test): no window, fake text metrics (real ones on request).
//   const { root } = mount(() => <App />);
//   click(findByText(root, "Save")!);
//   savePNG(screenshot(root), "app.png"); // real pixels, still without a window

import { writeFileSync } from "node:fs";
import { type Child, insert } from "./jsx-runtime.js";
import { layout } from "./render/layout.js";
import { overflowWarnings } from "./render/overflow.js";
import { CommandBuffer, paintTree } from "./render/paint.js";
import { type Modifiers, type TextMeasurer, UINode, setTextMeasurer } from "./render/node.js";
import { createRoot, untrack } from "./reactive/signals.js";
import { runFrameCallbacks, setAnimating, setFrameClock } from "./runtime/frames.js";
import { NO_MODIFIERS, createInput } from "./runtime/input.js";
import { windowOf } from "./runtime/app.js";
import { loadNative, nativeTextMeasurer } from "./runtime/native.js";
import { type Screenshot, type ScreenshotOptions, captureTree } from "./runtime/screenshot.js";

export type { Screenshot, ScreenshotOptions } from "./runtime/screenshot.js";

export interface FakeTextMetrics {
  /** Width of every character, in px (default 8). */
  charWidth?: number;
  /** Line height in px (default 20): ascent 3/4, descent 1/4. */
  lineHeight?: number;
}

// What mount() installs: fake metrics (the default) or the addon's real ones.
let metrics: TextMeasurer = fakeMeasurer({});

function fakeMeasurer({ charWidth = 8, lineHeight = 20 }: FakeTextMetrics): TextMeasurer {
  return (text, _size, font) => ({
    width: text.length * charWidth + (font?.letterSpacing ? Array.from(text).length * font.letterSpacing : 0),
    ascent: lineHeight * 0.75,
    descent: lineHeight * 0.25,
  });
}

/**
 * Fake text metrics, the default: 8 px per character (plus `letterSpacing` after each) and 20 px lines unless given, so
 * layout is deterministic without fonts. Also restores them after useRealTextMetrics().
 */
export function useFakeTextMetrics(options: FakeTextMetrics = {}) {
  metrics = fakeMeasurer(options);
  setTextMeasurer(metrics);
}

let realMetrics: boolean | undefined;

/** Whether useRealTextMetrics() works here (the native core loads). For `test.skipIf(!canUseRealTextMetrics())`. */
export function canUseRealTextMetrics(): boolean {
  if (realMetrics === undefined) {
    try {
      loadNative().measureText("x", 14, 0, 1);
      realMetrics = true;
    } catch {
      realMetrics = false;
    }
  }
  return realMetrics;
}

/**
 * Measures text with the installed fonts (FreeType + HarfBuzz from the native core, no
 * window) in this and every later mount(), until the returned function (or
 * useFakeTextMetrics()) puts the previous metrics back. Catches overflow that 8 px per
 * character hides, but the numbers depend on the machine's fonts: assert relations
 * ("fits", "narrower than"), not exact pixels. Throws when the native core is missing.
 */
export function useRealTextMetrics(): () => void {
  const previous = metrics;
  metrics = nativeTextMeasurer(loadNative(), 1);
  setTextMeasurer(metrics);
  return () => {
    metrics = previous;
    setTextMeasurer(previous);
  };
}

export interface MountOptions {
  /** Window size (default: the `<Window>`'s, else 800x600); either one may be given alone. */
  width?: number;
  height?: number;
  /** Also paint after every layout (into a buffer nobody draws), so `Canvas` draw callbacks run as in the app. */
  paint?: boolean;
}

/**
 * Renders `view` into a detached root and lays it out at `width`x`height`: by default a
 * `<Window>`'s own size (which it fills, as in run()), else 800x600. With `paint`, every
 * layout (and `relayout()`) also paints.
 */
export function mount(view: () => Child, options: MountOptions = {}) {
  setTextMeasurer(metrics);
  setAnimating(false); // animations finish at once unless the test calls frames()
  setFrameClock(null);
  const root = new UINode("root");
  root.isRoot = true;
  const dispose = createRoot((d) => {
    insert(root, untrack(view));
    return d;
  });
  // A <Window> fills the root as in run(); other content keeps its own size.
  const { node, options: windowOptions } = windowOf(root);
  if (node && windowOptions) node.style.grow = 1;
  const width = options.width ?? windowOptions?.width ?? 800;
  const height = options.height ?? windowOptions?.height ?? 600;
  const relayout = () => {
    layout(root, width, height);
    if (options.paint) paintTree(root, new CommandBuffer());
  };
  relayout();
  return { root, dispose, relayout, layoutWarnings: () => layoutWarnings(root) };
}

/**
 * Overflow warnings from the last layout of `root`: children that need more room than their
 * container gives them, with the excess hidden by a clip or the window (what run() prints in
 * development). `expect(layoutWarnings(root)).toEqual([])` catches a silently hidden child.
 */
export function layoutWarnings(root: UINode): string[] {
  return overflowWarnings(root).map((w) => w.message);
}

/** Searches the subtree; from a root, also its overlay layers (as of the last layout). */
export function findAll(node: UINode, match: (n: UINode) => boolean, found: UINode[] = []): UINode[] {
  if (match(node)) found.push(node);
  for (const c of node.children) findAll(c, match, found);
  if (node.isRoot) for (const layer of node.layers) findAll(layer, match, found);
  return found;
}

const matches = (value: string, text: string | RegExp) => (typeof text === "string" ? value === text : text.test(value));

/** The content of a Text node (undefined for other nodes). */
function textOf(n: UINode): string | undefined {
  return n.label.startsWith("Text ") ? (JSON.parse(n.label.slice(5)) as string) : undefined;
}

export interface TextQuery {
  /**
   * Only text inside a widget of this kind (its debug label: "Button", "Checkbox", "Tab",
   * "Select"...), e.g. the "Quit" button rather than the "Quit" dialog title.
   */
  in?: string;
}

/** Inside a node labelled `kind`, up to the root (overlay layers included, through their anchor spot). */
function inside(n: UINode, kind: string): boolean {
  for (let p = n.parent; p; p = p.parent) if (p.label === kind) return true;
  return false;
}

/**
 * Every Text node whose whole content equals `text` (or matches the RegExp), in tree order
 * (overlay layers, like dialogs, come after the tree).
 */
export function findAllByText(node: UINode, text: string | RegExp, query: TextQuery = {}): UINode[] {
  return findAll(node, (n) => {
    const value = textOf(n);
    return value !== undefined && matches(value, text) && (query.in === undefined || inside(n, query.in));
  });
}

/** First Text node whose whole content equals `text` (or matches the RegExp); `{ in: "Button" }` narrows it. */
export function findByText(node: UINode, text: string | RegExp, query: TextQuery = {}): UINode | undefined {
  return findAllByText(node, text, query)[0];
}

/** Every node whose `ariaLabel` equals `text` (or matches the RegExp), in tree order. */
export function findAllByLabel(node: UINode, text: string | RegExp): UINode[] {
  return findAll(node, (n) => n.ariaLabel !== undefined && matches(n.ariaLabel, text));
}

/** First node whose `ariaLabel` equals `text` (or matches the RegExp): icon-only buttons and the like. */
export function findByLabel(node: UINode, text: string | RegExp): UINode | undefined {
  return findAllByLabel(node, text)[0];
}

/** Every text field (TextField) whose value equals `value` (or matches the RegExp), in tree order. */
export function findAllByValue(node: UINode, value: string | RegExp): UINode[] {
  return findAll(node, (n) => n.field !== undefined && matches(n.field.value(), value));
}

/** First text field whose value equals `value` (or matches the RegExp): what the user typed. */
export function findByValue(node: UINode, value: string | RegExp): UINode | undefined {
  return findAllByValue(node, value)[0];
}

/** First text field whose placeholder equals `text` (or matches the RegExp), whatever it holds. */
export function findByPlaceholder(node: UINode, text: string | RegExp): UINode | undefined {
  return findAll(node, (n) => {
    const placeholder = n.field?.placeholder();
    return placeholder !== undefined && matches(placeholder, text);
  })[0];
}

/** The text a node shows: a field's drawn value ("•••" for a password), a Text node's content; else undefined. */
export function shownText(node: UINode): string | undefined {
  return node.field ? node.field.shown() : textOf(node);
}

/** How errors name a node: its debug label (with the text, for Text nodes), plus its ariaLabel. */
function describe(n: UINode): string {
  return n.ariaLabel === undefined ? n.label : `${n.label} (ariaLabel ${JSON.stringify(n.ariaLabel)})`;
}

const box = (n: UINode) => `[${Math.round(n.x)},${Math.round(n.y)} ${Math.round(n.width)}x${Math.round(n.height)}]`;

const center = (n: UINode): [number, number] => [n.x + n.width / 2, n.y + n.height / 2];

/**
 * Throws unless a user could reach `node` at window point (x, y): it must be in the tree,
 * not culled (nor inside something culled), and the point must show through every clipping
 * or scrolling ancestor and the window. Missing it silently would fail the test much later.
 */
function assertReachable(node: UINode, x: number, y: number) {
  const fail = (why: string, fix: string): never => {
    throw new Error(`${describe(node)} cannot be reached: ${why}. ${fix}`);
  };
  // The node and its ancestors, up to its overlay layer (placed on its own) or the root.
  const chain: UINode[] = [];
  for (let n: UINode | null = node; n; n = n.overlay ? null : n.parent) chain.push(n);
  const top = chain[chain.length - 1]!;
  let root = top;
  while (root.parent) root = root.parent;
  if (!root.isRoot) fail("it is not in the tree (removed?)", "Find it again after the change.");
  if (top.overlay && !root.layers.includes(top)) {
    fail("its overlay layer is not shown", "Call relayout() after opening it: layout places the layers.");
  }
  // The outermost culled one: everything inside it has a stale box.
  const culled = chain.findLast((n) => n.culled);
  if (culled) {
    fail(
      `${culled === node ? "it is" : `its ancestor ${describe(culled)} is`} culled (outside the visible area in the last layout, e.g. overflowing a clip, a Scroll or the window)`,
      "Bring it into view with scrollIntoView() and relayout(), make room for it, or relayout() if the tree changed since the last layout.",
    );
  }
  for (const n of chain) {
    if (n === node) continue; // its own clip does not hide its box
    const window = n === root;
    if (!window && !n.style.clip && !n.scrollable && !n.scrollableX) continue;
    const b = window ? 0 : (n.style.borderWidth ?? 0);
    if (x >= n.x + b && y >= n.y + b && x < n.x + n.width - b && y < n.y + n.height - b) continue;
    fail(
      `the point it would use (${Math.round(x)}, ${Math.round(y)}; its box is ${box(node)}) is clipped by ${window ? "the window" : `${describe(n)} ${box(n)}`}`,
      "Bring it into view with scrollIntoView() and relayout(), or make room for it.",
    );
  }
}

/**
 * Clicks the center of `node`, bubbling to the nearest ancestor with an onClick (e.g. a
 * Button around its label). Throws if a user could not click it there (culled or clipped).
 */
export function click(node: UINode) {
  const [x, y] = center(node);
  assertReachable(node, x, y);
  for (let n: UINode | null = node; n; n = n.parent) {
    if (n.handlers.onClick) {
      n.handlers.onClick({ x, y, localX: x - n.x, localY: y - n.y, button: 0, clicks: 1, ...NO_MODIFIERS, stop() {} });
      return;
    }
  }
  throw new Error(`nothing clickable at ${describe(node)}`);
}

/**
 * Pointer and keyboard on a mounted tree, delivered like in a real app (hit testing, hover,
 * focus, capture while pressed, Tab), without a window. Positions are window coordinates;
 * the node helpers use the node's center and throw if a user could not reach it there
 * (culled, or clipped by a Scroll, a `clip` or the window). Call `relayout()` after changes
 * that move nodes.
 */
export function interact(root: UINode) {
  const host = hosts.get(root) ?? newHost(root);
  const { input } = host;
  /** The node's center, once it is known to be reachable there. */
  const at = (n: UINode): [number, number] => {
    const point = center(n);
    assertReachable(n, ...point);
    return point;
  };
  const mods = (o: Partial<Modifiers> = {}): Modifiers => ({ ctrl: !!o.ctrl, shift: !!o.shift, alt: !!o.alt, meta: !!o.meta });
  const keyInput = (name: string, text: string, o: Partial<Modifiers> = {}) => ({ key: name, text, ...mods(o), repeat: false });
  return {
    move: (x: number, y: number, modifiers?: Partial<Modifiers>) => input.pointerMove(x, y, mods(modifiers)),
    /** Presses the left button at a window position (e.g. on a scrollbar). */
    down: (x: number, y: number, modifiers?: Partial<Modifiers>) => input.pointerDown(x, y, 0, mods(modifiers)),
    up: (x: number, y: number, modifiers?: Partial<Modifiers>) => input.pointerUp(x, y, 0, mods(modifiers)),
    hover: (node: UINode) => input.pointerMove(...at(node)),
    press: (node: UINode, modifiers?: Partial<Modifiers>) => input.pointerDown(...at(node), 0, mods(modifiers)),
    release: (node: UINode, modifiers?: Partial<Modifiers>) => input.pointerUp(...at(node), 0, mods(modifiers)),
    /** Presses and releases the left button on the node's center (Ctrl+click: `{ ctrl: true }`). */
    click(node: UINode, modifiers?: Partial<Modifiers>) {
      const [x, y] = at(node);
      input.pointerMove(x, y, mods(modifiers));
      input.pointerDown(x, y, 0, mods(modifiers));
      input.pointerUp(x, y, 0, mods(modifiers));
    },
    /** A right press and release on the node's center (opens its onContextMenu). */
    contextMenu(node: UINode, modifiers?: Partial<Modifiers>) {
      const [x, y] = at(node);
      input.pointerDown(x, y, 2, mods(modifiers));
      input.pointerUp(x, y, 2, mods(modifiers));
    },
    /** Presses at the node's center, moves by (dx, dy) in steps, releases there. */
    drag(node: UINode, dx: number, dy: number, steps = 5) {
      const [x, y] = at(node);
      input.pointerMove(x, y);
      input.pointerDown(x, y, 0);
      for (let i = 1; i <= steps; i++) input.pointerMove(x + (dx * i) / steps, y + (dy * i) / steps);
      input.pointerUp(x + dx, y + dy, 0);
    },
    /** Turns the wheel over the node's center: `dy` down, `dx` right; with `shift`, a vertical turn scrolls sideways. */
    scroll: (node: UINode, dy: number, options: { dx?: number } & Partial<Modifiers> = {}) =>
      input.scroll(...at(node), options.dx ?? 0, dy, mods(options)),
    /** A key press by its name ("Return", "BackSpace", "Tab", "a"...), producing no text. */
    key: (name: string, modifiers?: Partial<Modifiers>) => input.keyDown(keyInput(name, "", modifiers)),
    /** A key release (onKeyUp). */
    keyUp: (name: string, modifiers?: Partial<Modifiers>) => input.keyUp(keyInput(name, "", modifiers)),
    /** Types text into the focused node, one key per character. */
    type: (text: string) => {
      for (const ch of text) input.keyDown(keyInput(ch, ch));
    },
    get focused() {
      return input.focused;
    },
    /** Pointer shape the window would show ("default", "pointer", "text"...). */
    get cursor() {
      return host.cursor;
    },
  };
}

/**
 * One input per root, shared by every interact() on it: a press from one call and the release
 * from another make a click, and focus stays where it was, as with the one real pointer.
 */
const hosts = new WeakMap<UINode, { input: ReturnType<typeof createInput>; cursor: string }>();

function newHost(root: UINode) {
  const host = { input: null as unknown as ReturnType<typeof createInput>, cursor: "default" };
  host.input = createInput(root, {
    size: () => ({ width: root.width, height: root.height }),
    resizable: () => false,
    setCursor: (name) => (host.cursor = name),
    move() {},
    toggleMaximize() {},
    resize() {},
    invalidate() {},
    now: () => Date.now(),
  });
  hosts.set(root, host);
  return host;
}

/**
 * Takes over the frame clock: animations (and requestAnimationFrame) run only as
 * `advance(ms)` moves time, in 16 ms frames. Call it after mount(), which resets the clock.
 */
export function frames() {
  setAnimating(true);
  let time = 0;
  setFrameClock(() => time);
  return {
    advance(ms: number) {
      const end = time + ms;
      while (time < end) {
        time = Math.min(end, time + 16);
        runFrameCallbacks(time);
      }
    },
  };
}

let offscreen: boolean | undefined;

/**
 * Whether `screenshot()` works here: the native core loads and the GPU driver can render
 * without a window (EGL; no display server needed). For `test.skipIf(!canScreenshot())`.
 */
export function canScreenshot(): boolean {
  if (offscreen === undefined) {
    try {
      loadNative().renderOffscreen(1, 1, 1, new Float32Array(0), []);
      offscreen = true;
    } catch {
      offscreen = false;
    }
  }
  return offscreen;
}

/**
 * Renders a mounted root (at the size of its last layout, unless given) or a view (mounted
 * for the shot, then disposed) into real pixels, without a window: real fonts and text
 * metrics, images, icons, shadows. The tree's fake metrics are put back afterwards.
 * Throws when the machine cannot render offscreen (see canScreenshot()).
 */
export function screenshot(target: UINode | (() => Child), options: ScreenshotOptions = {}): Screenshot {
  const nat = loadNative();
  const scale = options.scale ?? 1;
  if (typeof target === "function") {
    const { root, dispose } = mount(target);
    const width = options.width ?? root.width, height = options.height ?? root.height;
    try {
      return captureTree(nat, root, width, height, scale, options.background);
    } finally {
      dispose();
    }
  }
  const width = options.width ?? (target.width || 800), height = options.height ?? (target.height || 600);
  return captureTree(nat, target, width, height, scale, options.background);
}

/** Writes a screenshot to `path` as PNG (then look at it, e.g. with an image viewer or an agent's file reader). */
export function savePNG(shot: Screenshot, path: string) {
  writeFileSync(path, shot.toPNG());
}
