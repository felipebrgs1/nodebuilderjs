// Loads the native core (native/build/nodebuilder.node).

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export type NativeKeyEvent = { type: "keydown" | "keyup"; key: string; text: string; repeat: boolean; ctrl: boolean; shift: boolean; alt: boolean; super: boolean };

export type NativeEvent =
  | { type: "configure"; width: number; height: number; scale: number; maximized: boolean; activated: boolean }
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
}

let native: Native | null = null;

export function loadNative(): Native {
  if (native) return native;
  const path = fileURLToPath(new URL("../native/build/nodebuilder.node", import.meta.url));
  try {
    native = createRequire(import.meta.url)(path) as Native;
  } catch (err) {
    throw new Error(`nodebuilder: native core not found at ${path}. Run "bun run build:native" first.`, { cause: err });
  }
  return native;
}
