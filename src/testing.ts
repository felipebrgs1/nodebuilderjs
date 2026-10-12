// Headless helpers for app tests (bun test): no window, fake text metrics.
//   const { root } = mount(() => <App />);
//   click(findByText(root, "Salvar")!);

import { type Child, insert } from "./jsx-runtime.js";
import { layout } from "./render/layout.js";
import { type PointerEvent, UINode, setTextMeasurer } from "./render/node.js";
import { createRoot } from "./reactive/signals.js";
import { createInput } from "./runtime/input.js";

/** 8 px per character, 20 px lines: layout is deterministic without fonts. */
export function useFakeTextMetrics() {
  setTextMeasurer((text) => ({ width: text.length * 8, ascent: 15, descent: 5 }));
}

/** Renders `view` into a detached root and lays it out at `width`x`height`. */
export function mount(view: () => Child, size = { width: 800, height: 600 }) {
  useFakeTextMetrics();
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

/** First Text node whose whole content equals `text` (or matches the RegExp). */
export function findByText(node: UINode, text: string | RegExp): UINode | undefined {
  return findAll(node, (n) => {
    if (!n.label.startsWith("Text ")) return false;
    const value = JSON.parse(n.label.slice(5)) as string;
    return typeof text === "string" ? value === text : text.test(value);
  })[0];
}

/** Clicks `node`, bubbling to the nearest ancestor with an onClick (e.g. a Button around its label). */
export function click(node: UINode) {
  const event: PointerEvent = { x: node.x + 1, y: node.y + 1, localX: 1, localY: 1, button: 0, clicks: 1, stop() {} };
  for (let n: UINode | null = node; n; n = n.parent) {
    if (n.handlers.onClick) {
      n.handlers.onClick(event);
      return;
    }
  }
  throw new Error(`nothing clickable at ${node.label}`);
}

/**
 * Pointer and keyboard on a mounted tree, delivered like in a real app (hit testing, hover,
 * focus, capture while pressed, Tab), without a window. Positions are window coordinates;
 * the node helpers use the node's center. Call `relayout()` after changes that move nodes.
 */
export function interact(root: UINode) {
  const input = createInput(root, {
    size: () => ({ width: root.width, height: root.height }),
    resizable: () => false,
    setCursor() {},
    move() {},
    resize() {},
    invalidate() {},
    now: () => Date.now(),
  });
  const center = (n: UINode): [number, number] => [n.x + n.width / 2, n.y + n.height / 2];
  const key = (name: string, text: string, options: { shift?: boolean; ctrl?: boolean } = {}) =>
    input.keyDown({ key: name, text, shift: !!options.shift, ctrl: !!options.ctrl, alt: false, repeat: false });
  return {
    move: (x: number, y: number) => input.pointerMove(x, y),
    hover: (node: UINode) => input.pointerMove(...center(node)),
    press: (node: UINode) => input.pointerDown(...center(node), 0),
    release: (node: UINode) => input.pointerUp(...center(node), 0),
    /** Presses at the node's center, moves by (dx, dy) in steps, releases there. */
    drag(node: UINode, dx: number, dy: number, steps = 5) {
      const [x, y] = center(node);
      input.pointerMove(x, y);
      input.pointerDown(x, y, 0);
      for (let i = 1; i <= steps; i++) input.pointerMove(x + (dx * i) / steps, y + (dy * i) / steps);
      input.pointerUp(x + dx, y + dy, 0);
    },
    scroll: (node: UINode, dy: number) => input.scroll(...center(node), 0, dy),
    /** A key by its name ("Return", "BackSpace", "Tab", "a"...), producing no text. */
    key: (name: string, options?: { shift?: boolean; ctrl?: boolean }) => key(name, "", options),
    /** Types text into the focused node, one key per character. */
    type: (text: string) => {
      for (const ch of text) key(ch, ch);
    },
    get focused() {
      return input.focused;
    },
  };
}
