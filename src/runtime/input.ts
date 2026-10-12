// Turns raw pointer and key events into UI events on the tree: hit testing, hover,
// cursor, focus, clicks, scrolling and keyboard. Window side effects go through `InputHost`,
// so this runs (and is tested) without a window.

import type { KeyEvent, PointerEvent, UINode } from "../render/node.js";
import { batch } from "../reactive/signals.js";

export interface InputHost {
  /** Window size in logical px, for the resize borders. */
  size(): { width: number; height: number };
  /** Borders resize the window (false when maximized or without a <Window>). */
  resizable(): boolean;
  setCursor(name: string): void;
  move(): void;
  resize(edges: number): void;
  /** Something changed that needs a new frame (e.g. scrolling). */
  invalidate(): void;
  now(): number;
}

export interface KeyInput {
  key: string;
  text: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  repeat: boolean;
}

const RESIZE_BORDER = 6;
const CLICK_INTERVAL = 400;
const EDGE_CURSORS: Record<number, string> = {
  1: "n-resize", 2: "s-resize", 4: "w-resize", 8: "e-resize",
  5: "nw-resize", 9: "ne-resize", 6: "sw-resize", 10: "se-resize",
};

export type Input = ReturnType<typeof createInput>;

export function createInput(root: UINode, host: InputHost) {
  let pointer: { x: number; y: number } | null = null;
  let hoverPath: UINode[] = [];
  let pressed: UINode | null = null; // where the held press started: it captures moves
  let pressedButton = -1;
  let focused: UINode | null = null;
  let cursor = "";
  let lastClick = { time: 0, x: 0, y: 0, clicks: 0 };

  function hitTest(node: UINode, x: number, y: number): UINode | null {
    if (node.culled || x < node.x || y < node.y || x >= node.x + node.width || y >= node.y + node.height) return null;
    const kids = node.children;
    for (let i = kids.length - 1; i >= 0; i--) {
      const hit = hitTest(kids[i]!, x, y);
      if (hit) return hit;
    }
    return node;
  }

  /**
   * Overlay layers first (top to bottom). A layer covering the window is not a target itself
   * (the pointer goes through its empty space), unless it is modal.
   */
  function hitTop(x: number, y: number): UINode | null {
    for (let i = root.layers.length - 1; i >= 0; i--) {
      const layer = root.layers[i]!;
      const hit = hitTest(layer, x, y);
      if (hit && (hit !== layer || layer.overlay!.anchor || layer.overlay!.modal)) return hit;
    }
    return hitTest(root, x, y);
  }

  /** A press that should close `layer`: outside it, or on a modal's backdrop, but never on its anchor. */
  function pressOutside(layer: UINode, path: UINode[]) {
    const o = layer.overlay!;
    if (path.includes(layer) && !(o.modal && path[0] === layer)) return false;
    const anchor = o.anchor?.() as UINode | undefined;
    return !(anchor && path.includes(anchor));
  }

  /** The topmost overlay that closes on an outside press or Escape. */
  function dismissible(): UINode | undefined {
    return root.layers.findLast((l) => l.overlay?.onDismiss);
  }

  function pathTo(node: UINode | null): UINode[] {
    const path: UINode[] = [];
    for (let n = node; n; n = n.parent) path.push(n);
    return path; // innermost first
  }

  function resizeEdges(x: number, y: number): number {
    if (!host.resizable()) return 0;
    const { width, height } = host.size();
    let edges = 0;
    if (y < RESIZE_BORDER) edges |= 1;
    if (y >= height - RESIZE_BORDER) edges |= 2;
    if (x < RESIZE_BORDER) edges |= 4;
    if (x >= width - RESIZE_BORDER) edges |= 8;
    return edges;
  }

  function setCursor(name: string) {
    if (name === cursor) return;
    cursor = name;
    host.setCursor(name);
  }

  function refreshHover() {
    const next = pointer ? pathTo(hitTop(pointer.x, pointer.y)) : [];
    const prev = hoverPath;
    hoverPath = next;
    batch(() => {
      for (const n of prev) if (!next.includes(n)) n.handlers.onPointerLeave?.();
      for (let i = next.length - 1; i >= 0; i--) if (!prev.includes(next[i]!)) next[i]!.handlers.onPointerEnter?.();
    });
    if (!pointer) return;
    const edges = resizeEdges(pointer.x, pointer.y);
    setCursor(edges ? EDGE_CURSORS[edges]! : (next.find((n) => n.style.cursor)?.style.cursor ?? "default"));
  }

  function pointerEvent(x: number, y: number, button: number, clicks = 1) {
    let stopped = false;
    const e: PointerEvent & { stopped: () => boolean } = {
      x, y, localX: 0, localY: 0, button, clicks, stop: () => (stopped = true), stopped: () => stopped,
    };
    return e;
  }

  /** Sets the local position for `node`, which is about to handle `e`. */
  function at<E extends PointerEvent>(node: UINode, e: E): E {
    e.localX = e.x - node.x;
    e.localY = e.y - node.y;
    return e;
  }

  function setFocus(node: UINode | null) {
    if (node === focused) return;
    const prev = focused;
    focused = node;
    batch(() => {
      prev?.handlers.onBlur?.();
      node?.handlers.onFocus?.();
    });
  }

  root.focusHost = {
    get focused() {
      return focused;
    },
    setFocus,
  };

  function focusables(node: UINode, out: UINode[] = []) {
    if (node.focusable && node.tabStop) out.push(node);
    for (const c of node.children) focusables(c, out);
    return out;
  }

  return {
    hitTest: (x: number, y: number) => hitTop(x, y),

    get focused() {
      return focused;
    },

    /** After a layout: the node under a still pointer may have changed. */
    refreshHover,

    pointerMove(x: number, y: number) {
      pointer = { x, y };
      refreshHover();
      const e = pointerEvent(x, y, pressed ? pressedButton : -1, 0);
      for (const n of pressed ? pathTo(pressed) : hoverPath) {
        n.handlers.onPointerMove?.(at(n, e));
        if (e.stopped()) break;
      }
    },

    pointerLeave() {
      pointer = null;
      refreshHover();
      cursor = "";
    },

    pointerDown(x: number, y: number, button: number) {
      pointer = { x, y };
      const edges = button === 0 ? resizeEdges(x, y) : 0;
      if (edges) {
        pressed = null; // the compositor takes the pointer; the release may never come
        return host.resize(edges);
      }

      const now = host.now();
      const repeat = now - lastClick.time < CLICK_INTERVAL && Math.abs(x - lastClick.x) < 4 && Math.abs(y - lastClick.y) < 4;
      lastClick = { time: now, x, y, clicks: repeat ? lastClick.clicks + 1 : 1 };

      const path = pathTo(hitTop(x, y));
      const outside = dismissible();
      if (outside && pressOutside(outside, path)) outside.overlay!.onDismiss!();
      pressed = path[0] ?? null;
      pressedButton = button;
      setFocus(path.find((n) => n.focusable) ?? null);

      const e = pointerEvent(x, y, button, lastClick.clicks);
      for (const n of path) {
        n.handlers.onPointerDown?.(at(n, e));
        if (e.stopped()) return;
        if (n.handlers.onClick) return; // clickable things never start a window move
        if (n.dragRegion && button === 0) {
          pressed = null;
          return host.move();
        }
      }
    },

    pointerUp(x: number, y: number, button: number) {
      const path = pathTo(hitTop(x, y));
      const e = pointerEvent(x, y, button, lastClick.clicks);
      for (const n of path) {
        n.handlers.onPointerUp?.(at(n, e));
        if (e.stopped()) break;
      }
      const target = pathTo(pressed).find((n) => n.handlers.onClick);
      pressed = null;
      if (target && path.includes(target) && button === 0) target.handlers.onClick!(at(target, pointerEvent(x, y, button, lastClick.clicks)));
    },

    scroll(x: number, y: number, dx: number, dy: number) {
      let stopped = false;
      const e = { dx, dy, stop: () => (stopped = true) };
      for (const n of pathTo(hitTop(x, y))) {
        n.handlers.onScroll?.(e);
        if (stopped) return;
        if (n.scrollable && n.contentHeight > n.height && dy) {
          n.scrollY = Math.max(0, Math.min(n.contentHeight - n.height, n.scrollY + dy));
          host.invalidate();
          return;
        }
      }
    },

    keyDown(ev: KeyInput) {
      let stopped = false;
      const text = [...ev.text].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127) || ev.ctrl ? "" : ev.text;
      const e: KeyEvent = { key: ev.key, text, ctrl: ev.ctrl, shift: ev.shift, alt: ev.alt, repeat: ev.repeat, stop: () => (stopped = true) };
      if (focused && !focused.attached) setFocus(null);
      for (let n = focused; n && !stopped; n = n.parent) n.handlers.onKeyDown?.(e);
      if (stopped) return;
      const layer = dismissible();
      if (ev.key === "Escape" && layer) return layer.overlay!.onDismiss!();
      if (ev.key === "Tab" || ev.key === "ISO_Left_Tab") {
        const modal = root.layers.findLastIndex((l) => l.overlay!.modal);
        const scope = modal >= 0 ? root.layers.slice(modal) : [root, ...root.layers];
        const list = scope.flatMap((n) => focusables(n));
        if (!list.length) return;
        const i = focused ? list.indexOf(focused) : -1;
        const step = ev.shift ? -1 : 1;
        setFocus(list[(i + step + list.length) % list.length]!);
      }
    },
  };
}
