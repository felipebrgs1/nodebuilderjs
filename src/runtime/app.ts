// App runtime: owns the window, turns native events into UI events
// (hover, click, focus, keys, scroll) and renders a frame whenever the tree changes.

import { type Child, insert } from "../jsx-runtime.js";
import { setImageBackend } from "../image/source.js";
import { layout } from "../render/layout.js";
import { nativeClipboard, setClipboardBackend } from "./clipboard.js";
import { createInput } from "./input.js";
import { type Native, type NativeEvent, loadNative } from "./native.js";
import { UINode, invalidate, setDisplayScale, setFrameScheduler, setTextMeasurer, textMetricsChanged } from "../render/node.js";
import { CommandBuffer, paintTree } from "../render/paint.js";
import { batch, createRoot, createSignal } from "../reactive/signals.js";

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
    input.refreshHover();
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

  // ---- input -------------------------------------------------------------------
  const input = createInput(root, {
    size: () => ({ width: width(), height: height() }),
    resizable: () => !maximized() && !!windowNode,
    setCursor: (name) => nat.setCursor(name),
    move: () => nat.move(),
    resize: (edges) => nat.resize(edges),
    invalidate: () => schedule(),
    now: () => Date.now(),
  });

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
        input.pointerMove(ev.x, ev.y);
        break;
      case "pointerleave":
        input.pointerLeave();
        break;
      case "pointerdown":
        input.pointerDown(ev.x, ev.y, ev.button);
        break;
      case "pointerup":
        input.pointerUp(ev.x, ev.y, ev.button);
        break;
      case "scroll":
        input.scroll(ev.x, ev.y, ev.dx, ev.dy, ev.shift);
        break;
      case "keydown":
        input.keyDown(ev);
        break;
      case "clipboard":
        clip.received(ev.text);
        break;
    }
  }

  let currentScale = 1;
  const clip = nativeClipboard(nat);
  closeRequest = () => {
    if (!open || options.onClose?.() === false) return;
    open = false;
    nat.close();
    setClipboardBackend(null);
    clip.close();
    dispose();
  };

  nat.open(
    { title: options.title, appId: options.appId ?? process.env.NB_APP_ID ?? "dev.nodebuilder.app", width: options.width ?? 800, height: options.height ?? 600 },
    (events) => batch(() => events.forEach(handle)),
  );
  setClipboardBackend(clip);
}
