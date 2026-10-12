// Loads the native core for the current OS/arch.

import { createRequire } from "node:module";
import type { ImageBackend } from "../image/source.js";
import type { TextMeasurer } from "../render/node.js";

export type NativeKeyEvent = { type: "keydown" | "keyup"; key: string; text: string; repeat: boolean; ctrl: boolean; shift: boolean; alt: boolean; super: boolean };

export type NativeEvent =
  | { type: "configure"; width: number; height: number; scale: number; maximized: boolean; activated: boolean; transparent: boolean }
  | { type: "close" | "frame" | "pointerleave" }
  | { type: "pointermove" | "pointerdown" | "pointerup"; x: number; y: number; button: number }
  | { type: "scroll"; x: number; y: number; dx: number; dy: number; shift: boolean }
  | NativeKeyEvent
  | { type: "focus"; focused: boolean }
  | { type: "clipboard"; text: string };

export interface Native {
  open(options: { title: string; appId: string; width: number; height: number }, onEvents: (events: NativeEvent[]) => void): void;
  close(): void;
  render(commands: Float32Array, texts: string[]): void;
  /** Logical px. `scale` (default: the window's) is the device scale the text is hinted for. */
  measureText(text: string, size: number, font: number, scale?: number): [width: number, ascent: number, descent: number];
  /**
   * Draws `commands` without a window (no display needed) into a `width*scale` x `height*scale`
   * target and returns its pixels: RGBA8, straight alpha, rows top to bottom. Throws
   * "offscreen rendering is unavailable: ..." without a usable EGL driver, and while a window is open.
   */
  renderOffscreen(width: number, height: number, scale: number, commands: Float32Array, texts: string[]): Uint8Array;
  /** Copies straight-alpha RGBA pixels; returns an id (> 0) for draw commands. */
  createImage(width: number, height: number, rgba: Uint8Array): number;
  destroyImage(id: number): void;
  /** Decodes formats only the OS can (AVIF, HEIC); throws with the reason. Works without a window. */
  decodeImage(bytes: Uint8Array): { width: number; height: number; data: Uint8Array };
  setCursor(name: string): void;
  setTitle(title: string): void;
  move(): void;
  /** xdg_toplevel resize edges bitmask: top 1, bottom 2, left 4, right 8. */
  resize(edges: number): void;
  setMaximized(maximized: boolean): void;
  minimize(): void;
  /** Requests a frame callback (next vblank) without drawing anything. */
  requestFrame(): void;
  /** Offers `text` as the system clipboard's content (needs a recent key or button press on Wayland). */
  writeClipboard(text: string): void;
  /** Asks for the clipboard's text; the answer comes as a "clipboard" event ("" if there is no text). */
  readClipboard(): void;
}

let native: Native | null = null;

// Where the addon can come from, in order: a local build (framework checkout, see
// scripts/build-native.sh), then the prebuilt @nodebuilderjs/<platform>-<arch> package from npm.
// Every path is a literal require() because that is what `bun build --compile` embeds
// (createRequire is not followed); Node's ESM has no global require, hence the fallback.
function candidates(target: string): (() => Native)[] {
  // Not `typeof require`: transpilers fold that to a constant. In Bun, require exists in ESM.
  const r = process.versions.bun ? null : createRequire(import.meta.url);
  switch (target) {
    case "linux-x64":
      return [
        () => (r ? r("../../native/build/linux-x64/nodebuilder.node") : require("../../native/build/linux-x64/nodebuilder.node")),
        () => (r ? r("@nodebuilderjs/linux-x64/nodebuilder.node") : require("@nodebuilderjs/linux-x64/nodebuilder.node")),
      ];
    case "linux-arm64":
      return [
        () => (r ? r("../../native/build/linux-arm64/nodebuilder.node") : require("../../native/build/linux-arm64/nodebuilder.node")),
        () => (r ? r("@nodebuilderjs/linux-arm64/nodebuilder.node") : require("@nodebuilderjs/linux-arm64/nodebuilder.node")),
      ];
    default:
      return [];
  }
}

const isNotFound = (err: unknown) =>
  (err as { code?: string })?.code === "MODULE_NOT_FOUND" || /Cannot find (module|package)/.test(String((err as Error)?.message));

export function loadNative(): Native {
  if (native) return native;
  const target = `${process.platform}-${process.arch}`;
  const list = candidates(target);
  if (!list.length) throw new Error(`nodebuilder: ${target} is not supported yet`);
  for (const load of list) {
    try {
      return (native = load());
    } catch (err) {
      // Found but unloadable (missing system lib, too old glibc...): that is the real error.
      if (!isNotFound(err)) {
        throw new Error(`nodebuilder: could not load the native core for ${target}: ${(err as Error).message}`, { cause: err });
      }
    }
  }
  throw new Error(
    `nodebuilder: native core for ${target} not found. Install @nodebuilderjs/${target} ` +
      `(normally pulled in by @nodebuilderjs/core) or, in the framework repo, run "bun run build:native".`,
  );
}

/** Real text metrics from the addon (FreeType + HarfBuzz) at device `scale`, cached by text, size and weight. */
export function nativeTextMeasurer(nat: Native, scale: number): TextMeasurer {
  const metrics = new Map<string, { width: number; ascent: number; descent: number }>();
  return (text, size, bold) => {
    const key = `${bold ? 1 : 0}|${size}|${text}`;
    let m = metrics.get(key);
    if (!m) {
      if (metrics.size > 20_000) metrics.clear();
      const [width, ascent, descent] = nat.measureText(text, size, bold ? 1 : 0, scale);
      m = { width, ascent, descent };
      metrics.set(key, m);
    }
    return m;
  };
}

/** Images uploaded to the addon as textures. */
export function nativeImageBackend(nat: Native): ImageBackend {
  return { create: (w, h, rgba) => nat.createImage(w, h, rgba), destroy: (id) => nat.destroyImage(id) };
}
