// Headless helpers for app tests (bun test): no window, fake text metrics.
//   const { root } = mount(() => <App />);
//   click(findByText(root, "Salvar")!);

import { type Child, insert } from "./jsx-runtime.js";
import { layout } from "./render/layout.js";
import { type PointerEvent, UINode, setTextMeasurer } from "./render/node.js";
import { createRoot } from "./reactive/signals.js";

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

export function findAll(node: UINode, match: (n: UINode) => boolean, found: UINode[] = []): UINode[] {
  if (match(node)) found.push(node);
  for (const c of node.children) findAll(c, match, found);
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
  const event: PointerEvent = { x: node.x + 1, y: node.y + 1, button: 1, clicks: 1, stop() {} };
  for (let n: UINode | null = node; n; n = n.parent) {
    if (n.handlers.onClick) {
      n.handlers.onClick(event);
      return;
    }
  }
  throw new Error(`nothing clickable at ${node.label}`);
}
