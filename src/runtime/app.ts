// App runtime: owns the window, turns native events into UI events
// (hover, click, focus, keys, scroll) and renders a frame whenever the tree changes.

import { writeFileSync } from "node:fs";
import { type Child, insert } from "../jsx-runtime.js";
import { type IconImage, type IconInput, iconImages } from "../image/icon.js";
import { setImageBackend } from "../image/source.js";
import { sessionBusAddress } from "../dbus/connection.js";
import { setTrayBus } from "../tray/tray.js";
import { layout } from "../render/layout.js";
import { overflowWarnings } from "../render/overflow.js";
import { nativeClipboard, setClipboardBackend } from "./clipboard.js";
import { createInput } from "./input.js";
import { frameNow, hasFrameCallbacks, runFrameCallbacks, setAnimating, setFrameClock } from "./frames.js";
import { type Native, type NativeEvent, type NativeModifiers, loadNative, nativeImageBackend, nativeTextMeasurer } from "./native.js";
import { type Modifiers, UINode, invalidate, setDisplayScale, setFrameScheduler, setTextMeasurer } from "../render/node.js";
import { CommandBuffer, paintTree } from "../render/paint.js";
import { type MaybeAccessor, batch, createRoot, createSignal, read, untrack } from "../reactive/signals.js";
import { setTheme } from "../theme.js";
import { type Screenshot, captureTree } from "./screenshot.js";

export interface WindowOptions {
  /** An accessor follows changes (e.g. the open document's name). */
  title: MaybeAccessor<string>;
  appId?: string;
  /** Taskbar and switcher icon: SVG markup, or an .svg/PNG/JPEG/WebP file (`import icon from "./icon.svg" with { type: "file" }`). Default: the framework's. */
  icon?: IconInput;
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

/**
 * The root's first node, which run() makes fill the window, and its <Window> options (undefined
 * when it is not a <Window>). run(), screenshots and mount() in testing share it.
 */
export function windowOf(root: UINode): { node: UINode | undefined; options: WindowOptions | undefined } {
  const node = root.children[0];
  return { node, options: (node as any)?.[windowOptionsKey] };
}

const [width, setWidth] = createSignal(0);
const [height, setHeight] = createSignal(0);
const [maximized, setMaximized] = createSignal(false);
const [activated, setActivated] = createSignal(true);
const [transparent, setTransparent] = createSignal(true);
const [visible, setVisible] = createSignal(true);

let native: Native | null = null;
let closeRequest: () => void = () => {};
let visibilityRequest: (visible: boolean) => void = () => {};

/**
 * `transparent` is false when corners can't be see-through (e.g. X11 without a compositor).
 * `visible` is false after `windowControls.hide()`.
 */
export const windowState = { width, height, maximized, activated, transparent, visible };

export const windowControls = {
  close: () => closeRequest(),
  minimize: () => native?.minimize(),
  toggleMaximize: () => native?.setMaximized(!maximized()),
  setTitle: (title: string) => native?.setTitle(title),
  /** Unmaps the window (it leaves the taskbar; the app keeps running, e.g. in the tray). */
  hide: () => visibilityRequest(false),
  /** Maps a hidden window again. */
  show: () => visibilityRequest(true),
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

/** Inside an executable from `nodebuilder package` (Bun's embedded file system): no dev warnings. */
const packaged = import.meta.url.includes("/$bunfs/");

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
  if (process.env.NB_SCREENSHOT) {
    // `nodebuilder screenshot`: one PNG instead of a window, then exit.
    screenshotApp(loadNative(), app, process.env).then(
      (shot) => {
        console.log(`nodebuilder: wrote ${process.env.NB_SCREENSHOT} (${shot.width}x${shot.height})`);
        process.exit(0);
      },
      (err) => {
        console.error(`nodebuilder screenshot: ${(err as Error).message}`);
        process.exit(1);
      },
    );
    return;
  }
  setTrayBus(sessionBusAddress());
  runWith(loadNative(), app, runOptions);
}

const modifiers = (ev: NativeModifiers): Modifiers => ({ ctrl: !!ev.ctrl, shift: !!ev.shift, alt: !!ev.alt, meta: !!ev.super });

/** Frames simulated (16 ms each) waiting for animations to finish, unless NB_SCREENSHOT_FRAMES says how many. */
const SETTLE_FRAMES = 120;

/**
 * run() without a window: mounts `app` like run() does, at the window's size (or
 * NB_SCREENSHOT_WIDTH/HEIGHT), runs frames on a simulated clock until animations finish
 * (or NB_SCREENSHOT_FRAMES frames), renders offscreen at NB_SCREENSHOT_SCALE and writes the
 * PNG to NB_SCREENSHOT. NB_SCREENSHOT_THEME=light|dark switches the theme first. Internal.
 */
export async function screenshotApp(nat: Native, app: () => Child, env: Record<string, string | undefined>): Promise<Screenshot> {
  const option = (name: string, valid: (n: number) => boolean) => {
    const raw = env[`NB_SCREENSHOT_${name}`];
    if (raw === undefined || raw === "") return undefined;
    const n = Number(raw);
    if (!valid(n)) throw new Error(`bad ${name.toLowerCase()} "${raw}"`);
    return n;
  };
  const scale = option("SCALE", (n) => n > 0 && n <= 8) ?? 1;
  const fixedFrames = option("FRAMES", (n) => Number.isInteger(n) && n >= 0);
  const forcedWidth = option("WIDTH", (n) => n >= 1);
  const forcedHeight = option("HEIGHT", (n) => n >= 1);
  const scheme = env.NB_SCREENSHOT_THEME;
  if (scheme === "light" || scheme === "dark") setTheme(scheme);
  else if (scheme) throw new Error(`bad theme "${scheme}" (use light or dark)`);

  native = nat;
  let time = 0;
  setAnimating(true);
  setFrameClock(() => time);
  setTextMeasurer(nativeTextMeasurer(nat, scale));
  setDisplayScale(scale);
  setImageBackend(nativeImageBackend(nat));

  const root = new UINode("root");
  root.isRoot = true;
  let dispose = () => {};
  try {
    createRoot((d) => {
      dispose = d;
      insert(root, untrack(app));
    });
    const { node: windowNode, options = { title: "nodebuilder" } } = windowOf(root);
    if (windowNode) windowNode.style.grow = 1;
    const w = forcedWidth ?? options.width ?? 800, h = forcedHeight ?? options.height ?? 600;
    setWidth(w);
    setHeight(h);
    const buffer = new CommandBuffer();
    for (let frame = 0; frame < (fixedFrames ?? SETTLE_FRAMES); frame++) {
      await new Promise((resolve) => setImmediate(resolve)); // the app's promises and immediates
      if (fixedFrames === undefined && frame > 0 && !hasFrameCallbacks()) break;
      time += 16;
      runFrameCallbacks(time);
      layout(root, w, h); // painting can start work too (Canvas sizes, icons)
      buffer.reset();
      paintTree(root, buffer);
    }
    const shot = captureTree(nat, root, w, h, scale);
    writeFileSync(env.NB_SCREENSHOT!, shot.toPNG());
    return shot;
  } finally {
    dispose();
    setAnimating(false);
    setFrameClock(null);
    native = null;
  }
}

/** run() with an explicit native core (tests pass a fake one). Internal: not exported from the package. */
export function runWith(nat: Native, app: () => Child, runOptions: RunOptions = {}, hooks: RunHooks = {}) {
  native = nat;
  setAnimating(true);

  setTextMeasurer(nativeTextMeasurer(nat, 1));

  setImageBackend(nativeImageBackend(nat));

  const root = new UINode("root");
  root.isRoot = true;
  let dispose = () => {};
  createRoot((d) => {
    dispose = d;
    insert(root, untrack(app));
  });
  const { node: windowNode, options = { title: "nodebuilder" } } = windowOf(root);
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
  const dev = env.NODE_ENV !== "production" && !packaged;
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

  // Overflow warnings (dev): each container/child pair once per session, however many frames show it.
  const overflowReported = new Set<string>();
  function reportOverflow() {
    for (const w of overflowWarnings(root)) {
      if (overflowReported.has(w.key)) continue;
      overflowReported.add(w.key);
      warn(w.message);
    }
  }

  function renderFrame() {
    scheduled = false;
    if (!dirty || !open || !configured) return; // hidden since it was scheduled
    recordReason();
    const t0 = now();
    lastRender = t0;
    phase = "callbacks";
    runFrameCallbacks(frameNow());
    phase = "building";
    dirty = false; // everything changed so far is in this frame
    const tState = now();
    layout(root, width(), height());
    if (dev) reportOverflow();
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
    toggleMaximize: windowControls.toggleMaximize,
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
          setTextMeasurer(nativeTextMeasurer(nat, ev.scale)); // metrics are hinted per scale
          setDisplayScale(ev.scale);
        }
        if (!visible()) break; // drawn once shown and configured again
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
        input.pointerMove(ev.x, ev.y, modifiers(ev));
        break;
      case "pointerleave":
        input.pointerLeave();
        break;
      case "pointerdown":
        input.pointerDown(ev.x, ev.y, ev.button, modifiers(ev));
        break;
      case "pointerup":
        input.pointerUp(ev.x, ev.y, ev.button, modifiers(ev));
        break;
      case "scroll":
        input.scroll(ev.x, ev.y, ev.dx, ev.dy, modifiers(ev));
        break;
      case "keydown":
        input.keyDown({ ...ev, meta: ev.super });
        break;
      case "keyup":
        input.keyUp({ ...ev, meta: ev.super });
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

  setVisible(true);
  visibilityRequest = (show) => {
    if (!open || show === visible()) return;
    nat.setVisible(show);
    setVisible(show);
    // Hidden: no frames until the window is mapped and configured again (no frame callbacks
    // come for an unmapped surface).
    configured = false;
    framePending = false;
  };

  nat.open(
    { title: untrack(() => read(options.title)), appId: options.appId ?? process.env.NB_APP_ID ?? "dev.nodebuilder.app", width: options.width ?? 800, height: options.height ?? 600 },
    (events) => batch(() => events.forEach(handle)),
  );
  setClipboardBackend(clip);
  nat.setIcon(windowIcon(options.icon, warn));
}

function windowIcon(icon: IconInput | undefined, warn: (message: string) => void): IconImage[] {
  try {
    return iconImages(icon);
  } catch (err) {
    warn(`nodebuilder: could not load the window icon, using the default (${(err as Error).message})`);
    return iconImages();
  }
}
