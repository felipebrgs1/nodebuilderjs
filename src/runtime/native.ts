// Loads the native core for the current OS/arch.

import { createRequire } from "node:module";
import type { ImageBackend } from "../image/source.js";
import type { ColorSpace } from "../render/color.js";
import { type TextMeasurer, type UINode, fontId, fontSpec, metricsGeneration } from "../render/node.js";

export { fontId };

/** Modifier keys held during an input event, as the addon reports them. */
export type NativeModifiers = { ctrl: boolean; shift: boolean; alt: boolean; super: boolean };

export type NativeKeyEvent = {
  type: "keydown" | "keyup";
  key: string;
  text: string;
  repeat: boolean;
  /** Set by run() on a keydown: the app took the key (a native core in a browser then cancels the default action). */
  handled?: boolean;
} & NativeModifiers;

export type NativeEvent =
  | { type: "configure"; width: number; height: number; scale: number; maximized: boolean; activated: boolean; transparent: boolean }
  | { type: "close" | "frame" | "pointerleave" }
  | ({ type: "pointermove" | "pointerdown" | "pointerup"; x: number; y: number; button: number } & NativeModifiers)
  | ({ type: "scroll"; x: number; y: number; dx: number; dy: number } & NativeModifiers)
  | NativeKeyEvent
  | { type: "focus"; focused: boolean }
  | { type: "clipboard"; text: string };

export interface Native {
  /**
   * Opens the window; returns the color space its surface took: `colorSpace` when the compositor can
   * take it, "srgb" otherwise (undefined from an addon that predates color spaces: sRGB).
   */
  open(
    options: { title: string; appId: string; width: number; height: number; colorSpace?: ColorSpace; deepColor?: boolean },
    onEvents: (events: NativeEvent[]) => void,
  ): ColorSpace | void;
  close(): void;
  render(commands: Float32Array, texts: string[]): void;
  /**
   * Instead of layout() and render(): the core shows the tree itself (the DOM renderer lays it
   * out with CSS) and writes every node's box (x, y, width, height, scroll and content sizes) and
   * the root's overlay layers, which input hit-tests. The frame callback follows, as for render().
   */
  renderTree?(root: UINode): void;
  /** With renderTree: the node under a window point, as the core laid it out (input asks it instead of walking the boxes). */
  hitTest?(x: number, y: number): UINode | null;
  /**
   * Logical px. `font` is a font id (`fontId(weight, italic)`); `scale` (default: the window's) is the
   * device scale the text is hinted for; `letterSpacing` (logical px) goes after every character;
   * `spec` (`fontSpec()`) the family list, features and variations.
   */
  measureText(text: string, size: number, font: number, scale?: number, letterSpacing?: number, spec?: string): [width: number, ascent: number, descent: number];
  /**
   * Adds the faces of a font file (any format FreeType reads; every face of a collection) to the
   * app's families. `family` null: the file's own; weight 0: the file's (a variable font, its wght
   * range); italic -1: the file's. Throws when the bytes are not a font. Copies the bytes.
   */
  registerFont(bytes: Uint8Array, family: string | null, weightMin: number, weightMax: number, italic: number): { family: string; weightMin: number; weightMax: number; italic: boolean; variable: boolean }[];
  /** The registered font families and the installed ones, unsorted, possibly with duplicates. */
  fontFamilies(): string[];
  /**
   * What `nodebuilder doctor` reports: library versions; the display server a window would use
   * (connected to and closed, without a window; `error` says why none, `compose` whether the
   * keyboard's compose table loaded for `locale`); the UI font and the fallback files for a
   * color emoji and a CJK character; the current GL context's strings (null without one: call
   * after `renderOffscreen` or while a window is open).
   */
  diagnostics(): {
    freetype: string;
    harfbuzz: string;
    display: { backend: string | null; error: string; compose: boolean; locale: string };
    fonts: { ui: { path: string; family: string } | null; emoji: string | null; cjk: string | null };
    gl: { vendor: string; renderer: string; version: string } | null;
  };
  /** Live entries of the font tables (debugging and tests: they must stay bounded). */
  fontStats(): { faces: number; variations: number; specs: number; styles: number; sizes: number };
  /**
   * Draws `commands` without a window (no display needed) into a `width*scale` x `height*scale`
   * target and returns its pixels: RGBA8, straight alpha, rows top to bottom. `colorSpace` (default
   * "srgb") is the one the commands' colors are encoded in; textures are converted to it. Throws
   * "offscreen rendering is unavailable: ..." without a usable EGL driver, and while a window is open.
   */
  renderOffscreen(width: number, height: number, scale: number, commands: Float32Array, texts: string[], colorSpace?: ColorSpace): Uint8Array;
  /**
   * Copies straight-alpha RGBA pixels; returns an id (> 0) for draw commands. `colorSpace`: what
   * the pixels mean (default "srgb"); the renderer converts them to the target's.
   */
  createImage(width: number, height: number, rgba: Uint8Array, colorSpace?: ColorSpace): number;
  destroyImage(id: number): void;
  /**
   * Decodes formats only the OS can (AVIF, HEIC); throws with the reason. Works without a window.
   * `icc`/`cicp`: the file's color profile (decodeImage applies it).
   */
  decodeImage(bytes: Uint8Array): { width: number; height: number; data: Uint8Array; icc?: Uint8Array; cicp?: [number, number] };
  setCursor(name: string): void;
  setTitle(title: string): void;
  /** Unmaps (false) or maps again (true) the window; a configure event follows a map. */
  setVisible(visible: boolean): void;
  /** Square straight-alpha RGBA images of one icon at several sizes (taskbar, switcher). */
  setIcon(images: { size: number; rgba: Uint8Array }[]): void;
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

/** Installs a native core other than the addon (the web one; null: the addon again); loadNative() returns it from then on. */
export function useNative(core: Native | null) {
  native = core;
}

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

/**
 * Real text metrics from the addon (FreeType + HarfBuzz) at device `scale`, cached by text, size and
 * font; the cache is dropped when the metrics generation changes (e.g. a font was registered).
 */
export function nativeTextMeasurer(nat: Native, scale: number): TextMeasurer {
  const metrics = new Map<string, { width: number; ascent: number; descent: number }>();
  let generation = metricsGeneration();
  return (text, size, font) => {
    if (generation !== metricsGeneration()) {
      metrics.clear();
      generation = metricsGeneration();
    }
    const id = fontId(font.weight, font.italic);
    const spec = fontSpec(font);
    const key = `${id}|${font.letterSpacing}|${size}|${spec}|${text}`;
    let m = metrics.get(key);
    if (!m) {
      if (metrics.size > 20_000) metrics.clear();
      const [width, ascent, descent] = nat.measureText(text, size, id, scale, font.letterSpacing, spec);
      m = { width, ascent, descent };
      metrics.set(key, m);
    }
    return m;
  };
}

/** Images uploaded to the addon as textures. */
export function nativeImageBackend(nat: Native): ImageBackend {
  return { create: (w, h, rgba, space) => nat.createImage(w, h, rgba, space), destroy: (id) => nat.destroyImage(id) };
}
