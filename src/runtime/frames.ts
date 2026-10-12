// The frame clock: requestAnimationFrame callbacks, run by the app before each frame (or by
// `frames()` in tests). Without a window, nothing runs them, so animations finish at once
// instead (see `animating()`).

import { batch } from "../reactive/signals.js";
import { invalidate } from "../render/node.js";

let callbacks: ((time: number) => void)[] = [];
let live = false;
let clock: () => number = () => performance.now();

/** Current time on the frame clock (ms): the one frame callbacks receive. */
export function frameNow() {
  return clock();
}

/** Tests drive time themselves; null goes back to the real clock. */
export function setFrameClock(next: (() => number) | null) {
  clock = next ?? (() => performance.now());
}

/** Runs `cb` right before the next frame is laid out (paced by the compositor). */
export function requestAnimationFrame(cb: (time: number) => void) {
  callbacks.push(cb);
  invalidate();
}

export function hasFrameCallbacks() {
  return callbacks.length > 0;
}

export function runFrameCallbacks(time: number) {
  if (!callbacks.length) return;
  const due = callbacks;
  callbacks = [];
  batch(() => due.forEach((cb) => cb(time)));
}

/** True while something runs the frames: a window, or a test that called `frames()`. */
export function animating() {
  return live;
}

export function setAnimating(on: boolean) {
  live = on;
  if (!on) callbacks = [];
}
