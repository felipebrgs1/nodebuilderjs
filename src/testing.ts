// Headless helpers for app tests (bun test): no window, fake text metrics.
//   const { root } = mount(() => <App />);
//   click(findByText(root, "Save")!);

import { type Child, insert } from "./jsx-runtime.js";
import { layout } from "./render/layout.js";
import { UINode, setTextMeasurer } from "./render/node.js";
import { createRoot } from "./reactive/signals.js";
import { runFrameCallbacks, setAnimating, setFrameClock } from "./runtime/frames.js";
import { createInput } from "./runtime/input.js";

/** 8 px per character, 20 px lines: layout is deterministic without fonts. */
export function useFakeTextMetrics() {
  setTextMeasurer((text) => ({ width: text.length * 8, ascent: 15, descent: 5 }));
}

/** Renders `view` into a detached root and lays it out at `width`x`height`. */
export function mount(view: () => Child, size = { width: 800, height: 600 }) {
  useFakeTextMetrics();
  setAnimating(false); // animations finish at once unless the test calls frames()
  setFrameClock(null);
  const root = new UINode("root");
  root.isRoot = true;
  const dispose = createRoot((d) => {
    insert(root, view);
    return d;
  });
  layout(root, size.width, size.height);
  return { root, dispose, relayout: () => layout(root, size.width, size.height) };
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

/** Every Text node whose whole content equals `text` (or matches the RegExp), in tree order. */
export function findAllByText(node: UINode, text: string | RegExp): UINode[] {
  return findAll(node, (n) => {
    const value = textOf(n);
    return value !== undefined && matches(value, text);
  });
}

/** First Text node whose whole content equals `text` (or matches the RegExp). */
export function findByText(node: UINode, text: string | RegExp): UINode | undefined {
  return findAllByText(node, text)[0];
}

/** Every node whose `ariaLabel` equals `text` (or matches the RegExp), in tree order. */
export function findAllByLabel(node: UINode, text: string | RegExp): UINode[] {
  return findAll(node, (n) => n.ariaLabel !== undefined && matches(n.ariaLabel, text));
}

/** First node whose `ariaLabel` equals `text` (or matches the RegExp): icon-only buttons and the like. */
export function findByLabel(node: UINode, text: string | RegExp): UINode | undefined {
  return findAllByLabel(node, text)[0];
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
      n.handlers.onClick({ x, y, localX: x - n.x, localY: y - n.y, button: 0, clicks: 1, stop() {} });
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
  let cursor = "default";
  const input = createInput(root, {
    size: () => ({ width: root.width, height: root.height }),
    resizable: () => false,
    setCursor: (name) => (cursor = name),
    move() {},
    toggleMaximize() {},
    resize() {},
    invalidate() {},
    now: () => Date.now(),
  });
  /** The node's center, once it is known to be reachable there. */
  const at = (n: UINode): [number, number] => {
    const point = center(n);
    assertReachable(n, ...point);
    return point;
  };
  const key = (name: string, text: string, options: { shift?: boolean; ctrl?: boolean } = {}) =>
    input.keyDown({ key: name, text, shift: !!options.shift, ctrl: !!options.ctrl, alt: false, repeat: false });
  return {
    move: (x: number, y: number) => input.pointerMove(x, y),
    /** Presses the left button at a window position (e.g. on a scrollbar). */
    down: (x: number, y: number) => input.pointerDown(x, y, 0),
    up: (x: number, y: number) => input.pointerUp(x, y, 0),
    hover: (node: UINode) => input.pointerMove(...at(node)),
    press: (node: UINode) => input.pointerDown(...at(node), 0),
    release: (node: UINode) => input.pointerUp(...at(node), 0),
    /** Presses at the node's center, moves by (dx, dy) in steps, releases there. */
    drag(node: UINode, dx: number, dy: number, steps = 5) {
      const [x, y] = at(node);
      input.pointerMove(x, y);
      input.pointerDown(x, y, 0);
      for (let i = 1; i <= steps; i++) input.pointerMove(x + (dx * i) / steps, y + (dy * i) / steps);
      input.pointerUp(x + dx, y + dy, 0);
    },
    /** Turns the wheel over the node's center: `dy` down, `dx` right; with `shift`, a vertical turn scrolls sideways. */
    scroll: (node: UINode, dy: number, options: { dx?: number; shift?: boolean } = {}) =>
      input.scroll(...at(node), options.dx ?? 0, dy, !!options.shift),
    /** A key by its name ("Return", "BackSpace", "Tab", "a"...), producing no text. */
    key: (name: string, options?: { shift?: boolean; ctrl?: boolean }) => key(name, "", options),
    /** Types text into the focused node, one key per character. */
    type: (text: string) => {
      for (const ch of text) key(ch, ch);
    },
    get focused() {
      return input.focused;
    },
    /** Pointer shape the window would show ("default", "pointer", "text"...). */
    get cursor() {
      return cursor;
    },
  };
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
