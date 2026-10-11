// Loads the native core for the current OS/arch.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export type NativeKeyEvent = { type: "keydown" | "keyup"; key: string; text: string; repeat: boolean; ctrl: boolean; shift: boolean; alt: boolean; super: boolean };

export type NativeEvent =
  | { type: "configure"; width: number; height: number; scale: number; maximized: boolean; activated: boolean; transparent: boolean }
  | { type: "close" | "frame" | "pointerleave" }
  | { type: "pointermove" | "pointerdown" | "pointerup"; x: number; y: number; button: number }
  | { type: "scroll"; x: number; y: number; dx: number; dy: number }
  | NativeKeyEvent
  | { type: "focus"; focused: boolean };

export interface Native {
  open(options: { title: string; appId: string; width: number; height: number }, onEvents: (events: NativeEvent[]) => void): void;
  close(): void;
  render(commands: Float32Array, texts: string[]): void;
  measureText(text: string, size: number, font: number): [width: number, ascent: number, descent: number];
  setCursor(name: string): void;
  setTitle(title: string): void;
  move(): void;
  /** xdg_toplevel resize edges bitmask: top 1, bottom 2, left 4, right 8. */
  resize(edges: number): void;
  setMaximized(maximized: boolean): void;
  minimize(): void;
  /** Requests a frame callback (next vblank) without drawing anything. */
  requestFrame(): void;
}

let native: Native | null = null;

export function loadNative(): Native {
  if (native) return native;
  // One binary per OS/arch: native/build/<platform>-<arch>/ (see scripts/build-native.sh).
  const target = `${process.platform}-${process.arch}`;
  const path = fileURLToPath(new URL(`../native/build/${target}/nodebuilder.node`, import.meta.url));
  try {
    native = createRequire(import.meta.url)(path) as Native;
  } catch (err) {
    throw new Error(`nodebuilder: native core for ${target} not found at ${path}. Run "bun run build:native" first.`, { cause: err });
  }
  return native;
}
