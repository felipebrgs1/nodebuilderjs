// App runtime: owns the window, turns native events into UI events
// (hover, click, focus, keys, scroll) and renders a frame whenever the tree changes.

import { type Child, insert } from "../jsx-runtime.js";
import { setImageBackend } from "../image/source.js";
import { layout } from "../render/layout.js";
import { nativeClipboard, setClipboardBackend } from "./clipboard.js";
import { createInput } from "./input.js";
import { frameNow, hasFrameCallbacks, runFrameCallbacks, setAnimating } from "./frames.js";
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

export { requestAnimationFrame } from "./frames.js";

/** What asked for a frame: invalidate() (state changed), a native event, or requestAnimationFrame. */
interface FrameReason {
  kind: "inv" | "ev" | "raf";
  /** The event type for "ev". */
  detail: string;
  /** Top of the requesting stack; only taken when it will be shown. */
  stack: string;
  /** Requested while a frame was being laid out or painted. */
  inFrame: boolean;
}

/** Frames in a row that request themselves, with nothing else changing, before the dev warning. */
const LOOP_FRAMES = 30;
const STACK_FRAMES = 6;
const reactiveDir = new URL("../reactive/", import.meta.url).pathname;

/** The caller's stack (top frames, without `skip` and above), minus the reactive plumbing in between. */
function callerStack(skip: Function) {
  const holder: { stack?: string } = {};
  Error.captureStackTrace(holder, skip);
  const cwd = `${process.cwd()}/`;
  const frames: { name: string; line: string; times: number }[] = [];
  for (const line of (holder.stack ?? "").split("\n")) {
    if (!/^\s+at /.test(line) || line.includes(reactiveDir)) continue;
    const name = line.trim().split(" ")[1]!;
    const last = frames[frames.length - 1];
    if (last?.name === name) last.times++; // recursion (paintTree, layout) shows once
    else frames.push({ name, line: line.replace("file://", "").replaceAll(cwd, ""), times: 1 });
    if (frames.length > STACK_FRAMES) break;
  }
  return frames
    .slice(0, STACK_FRAMES)
    .map((f) => (f.times > 1 ? `${f.line} x${f.times}` : f.line))
    .join("\n");
}

/** Where run() reads its environment and writes its diagnostics; tests pass their own. */
export interface RunHooks {
  env?: Record<string, string | undefined>;
  now?: () => number;
  log?: (line: string) => void;
  warn?: (message: string) => void;
}

export function run(app: () => Child, runOptions: RunOptions = {}) {
  runWith(loadNative(), app, runOptions);
}

/** run() with an explicit native core (tests pass a fake one). Internal: not exported from the package. */
export function runWith(nat: Native, app: () => Child, runOptions: RunOptions = {}, hooks: RunHooks = {}) {
  native = nat;
  setAnimating(true);

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
  const env = hooks.env ?? process.env;
  const now = hooks.now ?? (() => performance.now());
  const log = hooks.log ?? ((line: string) => console.log(line));
  const warn = hooks.warn ?? ((message: string) => console.warn(message));
  const buffer = new CommandBuffer();
  let dirty = true;
  let framePending = false;
  let scheduled = false;
  let configured = false;
  let open = true;
  // Where renderFrame is: running requestAnimationFrame callbacks, or laying out and painting.
  let phase: "idle" | "callbacks" | "building" = "idle";

  const maxFps = Number(env.NB_MAX_FPS) || runOptions.maxFps || 120;
  // Tolerance keeps e.g. 144 Hz at full rate instead of halving it to 72.
  const minInterval = 1000 / maxFps - 1.5;
  let lastRender = -Infinity;

  const schedule = () => {
    dirty = true;
    if (!open || !configured || framePending || scheduled || phase !== "idle") return;
    if (now() - lastRender < minInterval) {
      // Too soon for the cap: skip this vblank and decide again on the next one.
      framePending = true;
      nat.requestFrame();
      return;
    }
    scheduled = true;
    setImmediate(renderFrame);
  };

  // Why frames happen (NB_STATS, NB_TRACE=frames, the frame loop warning). Stacks cost
  // microseconds, so they are taken only when tracing, or for the rare request made while
  // a frame is being built (dev only).
  const trace = (env.NB_TRACE ?? "").split(",").includes("frames");
  const dev = env.NODE_ENV !== "production";
  let why: FrameReason | null = null; // the first request since the last frame
  let selfRequest: string | null = null; // stack of a request made while building the last frame
  let outsideRequest = false; // anything else asked since then (state changed)
  let loopFrames = 0;
  let loopReported = false;
  let currentEvent: string | null = null; // the native event being handled, for "ev" requests

  const request = (kind: FrameReason["kind"], detail: string, caller: Function | null) => {
    if (phase !== "callbacks") {
      // During requestAnimationFrame callbacks the change lands in the frame being built.
      const inFrame = phase === "building";
      const wanted = (trace && !why) || (dev && inFrame && selfRequest === null && !loopReported);
      const stack = wanted && caller ? callerStack(caller) : "";
      if (inFrame) selfRequest ??= stack;
      else outsideRequest = true;
      why ??= { kind, detail, stack, inFrame };
    }
    schedule();
  };
  setFrameScheduler(() => request("inv", "", invalidate));

  // NB_STATS=1 prints one line per second with where frame time goes.
  const stats = env.NB_STATS
    ? { frames: 0, state: 0, layout: 0, paint: 0, native: 0, since: now(), why: { inv: 0, ev: 0, raf: 0 } }
    : null;
  const countNodes = (n: UINode): number => n.children.reduce((a, c) => a + countNodes(c), 1);
  let frameNumber = 0;

  function recordReason() {
    const reason = why ?? { kind: "inv", detail: "", stack: "", inFrame: false };
    why = null;
    frameNumber++;
    if (stats) stats.why[reason.kind]++;
    if (trace) {
      const head = `frame ${frameNumber}: ${reason.kind}${reason.detail ? ` ${reason.detail}` : ""}${reason.inFrame ? " [in frame]" : ""}`;
      log(reason.stack ? `${head}\n${reason.stack}` : head);
    }
    loopFrames = selfRequest !== null && !outsideRequest ? loopFrames + 1 : 0;
    if (dev && loopFrames >= LOOP_FRAMES && !loopReported) {
      loopReported = true;
      const top = selfRequest?.split("\n")[0]?.trim().replace(/^at /, "") || "unknown caller";
      warn(
        `nodebuilder: frame loop: something requests a new frame while each frame is built, with no state change ` +
          `(${LOOP_FRAMES} frames in a row), so the app never goes idle. Invalidated by ${top}. ` +
          `Run with NB_TRACE=frames to see the stacks.`,
      );
    }
    selfRequest = null;
    outsideRequest = false;
  }

  function renderFrame() {
    scheduled = false;
    if (!dirty || !open) return;
    recordReason();
    const t0 = now();
    lastRender = t0;
    phase = "callbacks";
    runFrameCallbacks(frameNow());
    phase = "building";
    dirty = false; // everything changed so far is in this frame
    const tState = now();
    layout(root, width(), height());
    input.refreshHover();
    const t1 = now();
    buffer.reset();
    paintTree(root, buffer);
    const t2 = now();
    nat.render(buffer.commands, buffer.texts);
    const t3 = now();
    phase = "idle";
    framePending = true;
    if (hasFrameCallbacks()) {
      // Next frame is wanted; sent when the compositor is ready.
      dirty = true;
      outsideRequest = true;
      why ??= { kind: "raf", detail: "", stack: "", inFrame: false };
    }

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
        const r = stats.why;
        log(
          `fps ${String(Math.round((f * 1000) / elapsed)).padStart(3)} | ms/frame: state ${ms(stats.state)}  layout ${ms(stats.layout)}  paint ${ms(stats.paint)}  native ${ms(stats.native)}` +
            ` | why: inv ${r.inv} ev ${r.ev} raf ${r.raf}` +
            ` | nodes ${countNodes(root)} cmds ${(buffer.length * 4 / 1024).toFixed(0)}KB texts ${buffer.texts.length}` +
            ` | heap ${(mem.heapUsed / 2 ** 20).toFixed(1)}MB rss ${(mem.rss / 2 ** 20).toFixed(0)}MB`,
        );
        Object.assign(stats, { frames: 0, state: 0, layout: 0, paint: 0, native: 0, since: t3, why: { inv: 0, ev: 0, raf: 0 } });
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
    invalidate: function inputChanged() {
      request("ev", currentEvent ?? "input", inputChanged);
    },
    now: () => Date.now(),
  });

  // ---- native events -------------------------------------------------------
  function handle(ev: NativeEvent) {
    currentEvent = ev.type;
    try {
      dispatch(ev);
    } finally {
      currentEvent = null;
    }
  }
  function dispatch(ev: NativeEvent) {
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
        request("ev", "configure", null); // its stack is just the event loop
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
    setFrameScheduler(() => {});
    setAnimating(false); // drops pending frame callbacks: nothing runs them any more
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
