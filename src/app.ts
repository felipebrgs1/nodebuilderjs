// App runtime: owns the window, turns native events into UI events
// (hover, click, focus, keys, scroll) and renders a frame whenever the tree changes.

import { type Child, insert } from "./jsx-runtime.js";
import { setImageBackend } from "./image.js";
import { layout } from "./layout.js";
import { type Native, type NativeEvent, type NativeKeyEvent, loadNative } from "./native.js";
import { type KeyEvent, type PointerEvent, UINode, invalidate, setDisplayScale, setFrameScheduler, setTextMeasurer, textMetricsChanged } from "./node.js";
import { CommandBuffer, paintTree } from "./paint.js";
import { batch, createRoot, createSignal } from "./reactive.js";

export interface WindowOptions {
  title: string;
  appId?: string;
  width?: number;
  height?: number;
  /** Return false to keep the window open. */
  onClose?: () => boolean | void;
}

export interface RunOptions {
  /** Frame rate cap; frames stay vsync-aligned (240 Hz display -> every other vblank). Default 120, env NB_MAX_FPS. */
  maxFps?: number;
}

/** Nodes created by <Window> carry their options here. */
export const windowOptionsKey = Symbol("window");

const [width, setWidth] = createSignal(0);
const [height, setHeight] = createSignal(0);
const [maximized, setMaximized] = createSignal(false);
const [activated, setActivated] = createSignal(true);
const [transparent, setTransparent] = createSignal(true);

let native: Native | null = null;
let closeRequest: () => void = () => {};

/** `transparent` is false when corners can't be see-through (e.g. X11 without a compositor). */
export const windowState = { width, height, maximized, activated, transparent };

export const windowControls = {
  close: () => closeRequest(),
  minimize: () => native?.minimize(),
  toggleMaximize: () => native?.setMaximized(!maximized()),
  setTitle: (title: string) => native?.setTitle(title),
};

let frameCallbacks: ((time: number) => void)[] = [];

/** Runs `cb` right before the next frame is laid out (paced by the compositor). */
export function requestAnimationFrame(cb: (time: number) => void) {
  frameCallbacks.push(cb);
  invalidate();
}

const RESIZE_BORDER = 6;
const CLICK_INTERVAL = 400;

export function run(app: () => Child, runOptions: RunOptions = {}) {
  native = loadNative();
  const nat = native;

  const metrics = new Map<string, { width: number; ascent: number; descent: number }>();
  setTextMeasurer((text, size, bold) => {
    const key = `${bold ? 1 : 0}|${size}|${text}`;
    let m = metrics.get(key);
    if (!m) {
      if (metrics.size > 20_000) metrics.clear();
      const [w, ascent, descent] = nat.measureText(text, size, bold ? 1 : 0);
      m = { width: w, ascent, descent };
      metrics.set(key, m);
    }
    return m;
  });

  setImageBackend({ create: (w, h, rgba) => nat.createImage(w, h, rgba), destroy: (id) => nat.destroyImage(id) });

  const root = new UINode("root");
  root.isRoot = true;
  let dispose = () => {};
  createRoot((d) => {
    dispose = d;
    insert(root, app);
  });
  const windowNode = root.children[0];
  const options: WindowOptions = (windowNode as any)?.[windowOptionsKey] ?? { title: "nodebuilder" };
  if (windowNode) windowNode.style.grow = 1;

  // ---- frame scheduling ----------------------------------------------------
  const buffer = new CommandBuffer();
  let dirty = true;
  let framePending = false;
  let scheduled = false;
  let configured = false;
  let open = true;
  let rendering = false;

  const maxFps = Number(process.env.NB_MAX_FPS) || runOptions.maxFps || 120;
  // Tolerance keeps e.g. 144 Hz at full rate instead of halving it to 72.
  const minInterval = 1000 / maxFps - 1.5;
  let lastRender = -Infinity;

  const schedule = () => {
    dirty = true;
    if (!open || !configured || framePending || scheduled || rendering) return;
    if (performance.now() - lastRender < minInterval) {
      // Too soon for the cap: skip this vblank and decide again on the next one.
      framePending = true;
      nat.requestFrame();
      return;
    }
    scheduled = true;
    setImmediate(renderFrame);
  };
  setFrameScheduler(schedule);

  // NB_STATS=1 prints one line per second with where frame time goes.
  const stats = process.env.NB_STATS
    ? { frames: 0, state: 0, layout: 0, paint: 0, native: 0, since: performance.now() }
    : null;
  const countNodes = (n: UINode): number => n.children.reduce((a, c) => a + countNodes(c), 1);

  function renderFrame() {
    scheduled = false;
    if (!dirty || !open) return;
    const t0 = performance.now();
    lastRender = t0;
    rendering = true;
    if (frameCallbacks.length) {
      const callbacks = frameCallbacks;
      frameCallbacks = [];
      batch(() => callbacks.forEach((cb) => cb(t0)));
    }
    dirty = false; // everything changed so far is in this frame
    const tState = performance.now();
    layout(root, width(), height());
    refreshHover();
    const t1 = performance.now();
    buffer.reset();
    paintTree(root, buffer);
    const t2 = performance.now();
    nat.render(buffer.commands, buffer.texts);
    const t3 = performance.now();
    framePending = true;
    rendering = false;
    if (frameCallbacks.length) dirty = true; // next frame is wanted; sent when the compositor is ready

    if (stats) {
      stats.frames++;
      stats.state += tState - t0;
      stats.layout += t1 - tState;
      stats.paint += t2 - t1;
      stats.native += t3 - t2;
      const elapsed = t3 - stats.since;
      if (elapsed >= 1000) {
        const f = stats.frames;
        const ms = (v: number) => (v / f).toFixed(2).padStart(6);
        const mem = process.memoryUsage();
        console.log(
          `fps ${String(Math.round((f * 1000) / elapsed)).padStart(3)} | ms/frame: state ${ms(stats.state)}  layout ${ms(stats.layout)}  paint ${ms(stats.paint)}  native ${ms(stats.native)}` +
            ` | nodes ${countNodes(root)} cmds ${(buffer.length * 4 / 1024).toFixed(0)}KB texts ${buffer.texts.length}` +
            ` | heap ${(mem.heapUsed / 2 ** 20).toFixed(1)}MB rss ${(mem.rss / 2 ** 20).toFixed(0)}MB`,
        );
        Object.assign(stats, { frames: 0, state: 0, layout: 0, paint: 0, native: 0, since: t3 });
      }
    }
  }

  // ---- pointer -------------------------------------------------------------
  let pointer: { x: number; y: number } | null = null;
  let hoverPath: UINode[] = [];
  let pressed: UINode | null = null;
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

  function pathTo(node: UINode | null): UINode[] {
    const path: UINode[] = [];
    for (let n = node; n; n = n.parent) path.push(n);
    return path; // innermost first
  }

  function resizeEdges(x: number, y: number): number {
    if (maximized() || !windowNode) return 0;
    let edges = 0;
    if (y < RESIZE_BORDER) edges |= 1;
    if (y >= height() - RESIZE_BORDER) edges |= 2;
    if (x < RESIZE_BORDER) edges |= 4;
    if (x >= width() - RESIZE_BORDER) edges |= 8;
    return edges;
  }

  const edgeCursors: Record<number, string> = {
    1: "n-resize", 2: "s-resize", 4: "w-resize", 8: "e-resize",
    5: "nw-resize", 9: "ne-resize", 6: "sw-resize", 10: "se-resize",
  };

  function setCursor(name: string) {
    if (name === cursor) return;
    cursor = name;
    nat.setCursor(name);
  }

  function refreshHover() {
    const next = pointer ? pathTo(hitTest(root, pointer.x, pointer.y)) : [];
    const prev = hoverPath;
    hoverPath = next;
    batch(() => {
      for (const n of prev) if (!next.includes(n)) n.handlers.onPointerLeave?.();
      for (let i = next.length - 1; i >= 0; i--) if (!prev.includes(next[i]!)) next[i]!.handlers.onPointerEnter?.();
    });
    if (!pointer) return;
    const edges = resizeEdges(pointer.x, pointer.y);
    setCursor(edges ? edgeCursors[edges]! : (next.find((n) => n.style.cursor)?.style.cursor ?? "default"));
  }

  function pointerEvent(x: number, y: number, button: number, clicks = 1) {
    let stopped = false;
    const e: PointerEvent & { stopped: () => boolean } = { x, y, button, clicks, stop: () => (stopped = true), stopped: () => stopped };
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

  function focusables(node: UINode, out: UINode[] = []) {
    if (node.focusable) out.push(node);
    for (const c of node.children) focusables(c, out);
    return out;
  }

  function onPointerDown(x: number, y: number, button: number) {
    const edges = button === 0 ? resizeEdges(x, y) : 0;
    if (edges) return nat.resize(edges);

    const now = Date.now();
    const repeat = now - lastClick.time < CLICK_INTERVAL && Math.abs(x - lastClick.x) < 4 && Math.abs(y - lastClick.y) < 4;
    lastClick = { time: now, x, y, clicks: repeat ? lastClick.clicks + 1 : 1 };

    const path = pathTo(hitTest(root, x, y));
    pressed = path[0] ?? null;
    setFocus(path.find((n) => n.focusable) ?? null);

    const e = pointerEvent(x, y, button, lastClick.clicks);
    for (const n of path) {
      n.handlers.onPointerDown?.(e);
      if (e.stopped()) return;
      if (n.handlers.onClick) return; // clickable things never start a window move
      if (n.dragRegion && button === 0) return nat.move();
    }
  }

  function onPointerUp(x: number, y: number, button: number) {
    const path = pathTo(hitTest(root, x, y));
    const e = pointerEvent(x, y, button, lastClick.clicks);
    for (const n of path) {
      n.handlers.onPointerUp?.(e);
      if (e.stopped()) break;
    }
    const target = pathTo(pressed).find((n) => n.handlers.onClick);
    pressed = null;
    if (target && path.includes(target) && button === 0) target.handlers.onClick!(pointerEvent(x, y, button, lastClick.clicks));
  }

  function onScroll(x: number, y: number, dx: number, dy: number) {
    let stopped = false;
    const e = { dx, dy, stop: () => (stopped = true) };
    for (const n of pathTo(hitTest(root, x, y))) {
      n.handlers.onScroll?.(e);
      if (stopped) return;
      if (n.scrollable && n.contentHeight > n.height && dy) {
        n.scrollY = Math.max(0, Math.min(n.contentHeight - n.height, n.scrollY + dy));
        schedule();
        return;
      }
    }
  }

  function onKeyDown(ev: NativeKeyEvent) {
    let stopped = false;
    const text = [...ev.text].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127) || ev.ctrl ? "" : ev.text;
    const e: KeyEvent = { key: ev.key, text, ctrl: ev.ctrl, shift: ev.shift, alt: ev.alt, repeat: ev.repeat, stop: () => (stopped = true) };
    if (focused && !focused.attached) setFocus(null);
    for (let n = focused; n && !stopped; n = n.parent) n.handlers.onKeyDown?.(e);
    if (stopped) return;
    if (ev.key === "Tab" || ev.key === "ISO_Left_Tab") {
      const list = focusables(root);
      if (!list.length) return;
      const i = focused ? list.indexOf(focused) : -1;
      const step = ev.shift ? -1 : 1;
      setFocus(list[(i + step + list.length) % list.length]!);
    }
  }

  // ---- native events -------------------------------------------------------
  function handle(ev: NativeEvent) {
    switch (ev.type) {
      case "configure":
        setWidth(ev.width);
        setHeight(ev.height);
        setMaximized(ev.maximized);
        setActivated(ev.activated);
        setTransparent(ev.transparent);
        if (ev.scale !== currentScale) {
          currentScale = ev.scale;
          metrics.clear();
          textMetricsChanged();
          setDisplayScale(ev.scale);
        }
        configured = true;
        schedule();
        break;
      case "frame":
        framePending = false;
        if (dirty) schedule();
        break;
      case "close":
        closeRequest();
        break;
      case "pointermove":
        pointer = { x: ev.x, y: ev.y };
        refreshHover();
        break;
      case "pointerleave":
        pointer = null;
        refreshHover();
        cursor = "";
        break;
      case "pointerdown":
        pointer = { x: ev.x, y: ev.y };
        onPointerDown(ev.x, ev.y, ev.button);
        break;
      case "pointerup":
        onPointerUp(ev.x, ev.y, ev.button);
        break;
      case "scroll":
        onScroll(ev.x, ev.y, ev.dx, ev.dy);
        break;
      case "keydown":
        onKeyDown(ev);
        break;
    }
  }

  let currentScale = 1;
  closeRequest = () => {
    if (!open || options.onClose?.() === false) return;
    open = false;
    nat.close();
    dispose();
  };

  nat.open(
    { title: options.title, appId: options.appId ?? process.env.NB_APP_ID ?? "dev.nodebuilder.app", width: options.width ?? 800, height: options.height ?? 600 },
    (events) => batch(() => events.forEach(handle)),
  );
}
