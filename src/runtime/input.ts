// Turns raw pointer and key events into UI events on the tree: hit testing, hover,
// cursor, focus, clicks, scrolling and keyboard. Window side effects go through `InputHost`,
// so this runs (and is tested) without a window.

import { type Axis, type KeyEvent, type PointerEvent, type UINode, scrolls, stacked } from "../render/node.js";
import { batch } from "../reactive/signals.js";
import { LINE_STEP, type Scrollbar, overflows, pageStep, scrollBy, scrollPosition, scrollRange, scrollTo, scrollbarAt } from "../render/scrollbar.js";

export interface InputHost {
  /** Window size in logical px, for the resize borders. */
  size(): { width: number; height: number };
  /** Borders resize the window (false when maximized or without a <Window>). */
  resizable(): boolean;
  setCursor(name: string): void;
  move(): void;
  /** A double click on a drag region. */
  toggleMaximize(): void;
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

/** Keys that scroll when no handler took them: axis, how far and which way. Page keys and Home/End fall back to x. */
type ScrollKey = { axis: Axis; step: "line" | "page" | "edge"; dir: -1 | 1 };
const SCROLL_KEYS: Record<string, ScrollKey> = {};
for (const [names, key] of [
  [["Up"], { axis: "y", step: "line", dir: -1 }],
  [["Down"], { axis: "y", step: "line", dir: 1 }],
  [["Left"], { axis: "x", step: "line", dir: -1 }],
  [["Right"], { axis: "x", step: "line", dir: 1 }],
  [["Prior", "Page_Up"], { axis: "y", step: "page", dir: -1 }],
  [["Next", "Page_Down"], { axis: "y", step: "page", dir: 1 }],
  [["Home"], { axis: "y", step: "edge", dir: -1 }],
  [["End"], { axis: "y", step: "edge", dir: 1 }],
] as const) {
  for (const name of names) SCROLL_KEYS[name] = SCROLL_KEYS[`KP_${name}`] = key;
}

export type Input = ReturnType<typeof createInput>;

export function createInput(root: UINode, host: InputHost) {
  let pointer: { x: number; y: number } | null = null;
  let hoverPath: UINode[] = [];
  let pressed: UINode | null = null; // where the held press started: it captures moves
  let pressedButton = -1;
  let focused: UINode | null = null;
  let cursor = "";
  let lastClick = { time: 0, x: 0, y: 0, clicks: 0 };
  /** A press on a scrollbar (until its release); `drag` while it holds the thumb. */
  let barPress: { node: UINode; axis: Axis; drag: { from: number; start: number; ratio: number } | null } | null = null;
  /** The scrollbar drawn as active (hovered or pressed). */
  let activeBar: UINode | null = null;

  function contains(node: UINode, x: number, y: number) {
    return !node.culled && x >= node.x && y >= node.y && x < node.x + node.width && y < node.y + node.height;
  }

  /**
   * The topmost node at (x, y) in `node`'s subtree, siblings in paint order (zIndex). Like
   * CSS, what sticks out of a node that does not clip (an absolute badge) is still hit there.
   */
  function hitTest(node: UINode, x: number, y: number): UINode | null {
    if (node.culled) return null;
    const inside = contains(node, x, y);
    if (!inside && (node.style.clip || scrolls(node))) return null;
    // A scrollbar is above the content it scrolls.
    if (inside && scrolls(node) && scrollbarAt(node, x, y)) return node;
    const kids = stacked(node);
    for (let i = kids.length - 1; i >= 0; i--) {
      const hit = hitTest(kids[i]!, x, y);
      if (hit) return hit;
    }
    return inside ? node : null;
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

  /**
   * A press that should close `layer`: outside it, or on a modal's backdrop, but never on its
   * anchor, nor (for a modal with an inset) on what it leaves uncovered.
   */
  function pressOutside(layer: UINode, path: UINode[]) {
    const o = layer.overlay!;
    if (o.modal && !path.includes(layer)) return false;
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

  /** Nodes that may scroll for something at `node`: its ancestors, but nothing behind a modal layer. */
  function scrollChain(node: UINode | null): UINode[] {
    const chain: UINode[] = [];
    for (let n = node; n; n = n.overlay?.modal ? null : n.parent) chain.push(n);
    return chain;
  }

  /** False for nodes under the topmost modal layer (they still may hold the focus). */
  function reachable(node: UINode): boolean {
    const modal = root.layers.findLastIndex((l) => l.overlay!.modal);
    if (modal < 0) return true;
    for (let n: UINode | null = node; n; n = n.parent) if (n.overlay) return root.layers.indexOf(n) >= modal;
    return false;
  }

  /** A scroll key: the nearest Scroll around the focus, or else under the pointer, that can move that way. */
  function scrollByKey(key: ScrollKey) {
    const starts = [focused && reachable(focused) ? focused : null, pointer ? hitTop(pointer.x, pointer.y) : null];
    const axes: Axis[] = key.step === "line" ? [key.axis] : [key.axis, "x"];
    for (const start of starts) {
      const chain = scrollChain(start);
      for (const axis of axes) {
        const n = chain.find((c) => overflows(c, axis));
        if (!n) continue;
        const to = key.step === "edge" ? (key.dir < 0 ? 0 : scrollRange(n, axis))
          : scrollPosition(n, axis) + key.dir * (key.step === "page" ? pageStep(n, axis) : LINE_STEP);
        if (scrollTo(n, axis, to)) host.invalidate();
        return;
      }
    }
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

  function barUnder(node: UINode | undefined, x: number, y: number): Scrollbar | null {
    return node && scrolls(node) ? scrollbarAt(node, x, y) : null;
  }

  /** Highlights the scrollbar being pressed, or else the one under the pointer. */
  function setActiveBar(node: UINode | null, axis: Axis | null, pressed: boolean) {
    const prev = activeBar?.activeScrollbar;
    if (activeBar === node && (prev?.axis ?? null) === axis && (prev?.pressed ?? false) === pressed) return;
    if (activeBar) activeBar.activeScrollbar = null;
    activeBar = node;
    if (node) node.activeScrollbar = { axis: axis!, pressed };
    host.invalidate();
  }

  function refreshHover() {
    const next = pointer ? pathTo(hitTop(pointer.x, pointer.y)) : [];
    const prev = hoverPath;
    hoverPath = next;
    batch(() => {
      for (const n of prev) if (!next.includes(n)) n.handlers.onPointerLeave?.();
      for (let i = next.length - 1; i >= 0; i--) if (!prev.includes(next[i]!)) next[i]!.handlers.onPointerEnter?.();
    });
    const bar = pointer ? barUnder(next[0], pointer.x, pointer.y) : null;
    if (barPress) setActiveBar(barPress.node, barPress.axis, !!barPress.drag);
    else setActiveBar(bar ? next[0]! : null, bar?.axis ?? null, false);
    if (!pointer) return;
    const edges = resizeEdges(pointer.x, pointer.y);
    const shape = bar || barPress ? "default" : next.find((n) => n.style.cursor)?.style.cursor;
    setCursor(edges ? EDGE_CURSORS[edges]! : (shape ?? "default"));
  }

  /** Thumb: starts dragging it. Track: moves a page toward the press. */
  function pressBar(node: UINode, bar: Scrollbar, x: number, y: number) {
    const along = bar.axis === "y" ? y : x;
    let drag = null;
    if (along >= bar.thumbStart && along < bar.thumbStart + bar.thumbLength) {
      const travel = bar.trackLength - bar.thumbLength;
      drag = { from: along, start: scrollPosition(node, bar.axis), ratio: travel > 0 ? scrollRange(node, bar.axis) / travel : 0 };
    } else {
      const step = pageStep(node, bar.axis);
      if (scrollBy(node, bar.axis, along < bar.thumbStart ? -step : step)) host.invalidate();
    }
    barPress = { node, axis: bar.axis, drag };
    refreshHover();
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
  // focus() asked for before there was input (mount() and then interact() in a test).
  const early = root.pendingFocus;
  root.pendingFocus = null;
  if (early?.focusable && early.attached) setFocus(early);

  /**
   * Where a key starts bubbling: the focused node; with nothing focused, the topmost modal
   * layer (its parents lead to the Window), or else the root's top nodes (the Window).
   */
  function keyTargets(): readonly UINode[] {
    if (focused) return [focused];
    const modal = root.layers.findLast((l) => l.overlay!.modal);
    if (modal) return [modal];
    return root.children.length ? root.children : [root];
  }

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
      const drag = barPress?.drag;
      if (drag) {
        const along = barPress!.axis === "y" ? y : x;
        if (scrollTo(barPress!.node, barPress!.axis, drag.start + (along - drag.from) * drag.ratio)) host.invalidate();
        refreshHover();
        return;
      }
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
      // On a scrollbar: no focus change and nothing for the content below it.
      const bar = barUnder(path[0], x, y);
      if (bar) {
        pressed = null;
        if (button === 0) pressBar(path[0]!, bar, x, y);
        return;
      }
      pressed = path[0] ?? null;
      pressedButton = button;
      setFocus(path.find((n) => n.focusable) ?? null);

      const e = pointerEvent(x, y, button, lastClick.clicks);
      // The press bubbles to every ancestor until stop() (a list's context menu sees a press on
      // a clickable row). Controls inside a drag region (clickables, fields, sliders,
      // focusables) take the press: an ancestor drag region does not move the window.
      let taken = false;
      for (const n of path) {
        n.handlers.onPointerDown?.(at(n, e));
        if (e.stopped()) return;
        if (n.dragRegion && button === 0 && !taken) {
          if (e.clicks === 2) return host.toggleMaximize();
          pressed = null; // the compositor takes the pointer; the release may never come
          return host.move();
        }
        if (n.handlers.onClick || n.handlers.onPointerDown || n.focusable) taken = true;
      }
    },

    pointerUp(x: number, y: number, button: number) {
      if (barPress) {
        if (button === 0) {
          barPress = null;
          refreshHover();
        }
        return;
      }
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

    /** A wheel or touchpad turn; with Shift, a vertical turn scrolls sideways. */
    scroll(x: number, y: number, dx: number, dy: number, shift = false) {
      if (shift && !dx) [dx, dy] = [dy, 0];
      let stopped = false;
      const e = { dx, dy, stop: () => (stopped = true) };
      // Each axis goes to the nearest node that scrolls that way and has something to scroll.
      let wantX = dx !== 0;
      let wantY = dy !== 0;
      for (const n of scrollChain(hitTop(x, y))) {
        n.handlers.onScroll?.(e);
        if (stopped) return;
        if (wantY && overflows(n, "y")) {
          if (scrollBy(n, "y", dy)) host.invalidate();
          wantY = false;
        }
        if (wantX && overflows(n, "x")) {
          if (scrollBy(n, "x", dx)) host.invalidate();
          wantX = false;
        }
        if (!wantX && !wantY) return;
      }
    },

    keyDown(ev: KeyInput) {
      let stopped = false;
      const text = [...ev.text].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127) || ev.ctrl ? "" : ev.text;
      const e: KeyEvent = { key: ev.key, text, ctrl: ev.ctrl, shift: ev.shift, alt: ev.alt, repeat: ev.repeat, stop: () => (stopped = true) };
      if (focused && !focused.attached) setFocus(null);
      for (const start of keyTargets()) {
        for (let n: UINode | null = start; n && !stopped; n = n.parent) n.handlers.onKeyDown?.(e);
      }
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
        return;
      }
      const scroll = SCROLL_KEYS[ev.key];
      if (scroll && !ev.alt) scrollByKey(scroll);
    },
  };
}
