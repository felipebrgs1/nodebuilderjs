// Animations: a number moving from one value to another over time, paced by the frames.
// Without a window (tests that do not call `frames()`), they jump to the end at once.

import { type Accessor, createEffect, createSignal, onCleanup, untrack } from "../reactive/signals.js";
import { mixRgba, parseColor } from "../render/paint.js";
import { animating, frameNow, requestAnimationFrame } from "../runtime/frames.js";

export type Easing = (t: number) => number;

export const easing = {
  linear: (t: number) => t,
  easeIn: (t: number) => t * t * t,
  easeOut: (t: number) => 1 - (1 - t) ** 3,
  easeInOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
} satisfies Record<string, Easing>;

export interface AnimateOptions {
  /** Milliseconds (default 200). */
  duration?: number;
  /** Default `easing.easeOut`. */
  easing?: Easing;
  onDone?: () => void;
}

/** Calls `onUpdate` with values from `from` to `to`, one per frame; returns a function that stops it. */
export function animate(from: number, to: number, onUpdate: (value: number) => void, options: AnimateOptions = {}): () => void {
  const duration = options.duration ?? 200;
  const ease = options.easing ?? easing.easeOut;
  if (!animating() || duration <= 0 || from === to) {
    onUpdate(to);
    options.onDone?.();
    return () => {};
  }
  let stopped = false;
  const start = frameNow(); // from the call: waiting for the first frame does not shorten it
  onUpdate(from);
  const step = (time: number) => {
    if (stopped) return;
    const t = Math.min(1, (time - start) / duration);
    onUpdate(from + (to - from) * ease(t));
    if (t < 1) requestAnimationFrame(step);
    else options.onDone?.();
  };
  requestAnimationFrame(step);
  return () => (stopped = true);
}

/** A number that follows `source` smoothly: a new value animates from wherever it is now. */
export function createTween(source: Accessor<number>, options: Omit<AnimateOptions, "onDone"> = {}): Accessor<number> {
  const [value, setValue] = createSignal(untrack(source));
  let stop = () => {};
  createEffect(() => {
    const target = source();
    untrack(() => {
      stop();
      stop = animate(value(), target, setValue, options);
    });
  });
  onCleanup(() => stop());
  return value;
}

export interface PresenceOptions {
  /** Milliseconds to appear (default 180) and to go away (default 120). */
  enter?: number;
  exit?: number;
  easing?: Easing;
}

/**
 * For content that animates in and out: `mounted` stays true until the exit animation ends,
 * and `progress` goes 0 -> 1 when `when` turns true and back to 0 when it turns false.
 */
export function createPresence(when: Accessor<unknown>, options: PresenceOptions = {}) {
  const initial = !!untrack(when);
  const [mounted, setMounted] = createSignal(initial);
  const [progress, setProgress] = createSignal(initial ? 1 : 0);
  let stop = () => {};
  createEffect(() => {
    const on = !!when();
    untrack(() => {
      stop();
      if (on) {
        setMounted(true);
        stop = animate(progress(), 1, setProgress, { duration: options.enter ?? 180, easing: options.easing });
      } else if (mounted()) {
        stop = animate(progress(), 0, setProgress, { duration: options.exit ?? 120, easing: options.easing, onDone: () => setMounted(false) });
      }
    });
  });
  onCleanup(() => stop());
  return { mounted, progress };
}

/** `a` blended toward `b` by `t` (0..1), as "#rrggbbaa"; premultiplied like CSS, so mixing toward "transparent" fades without graying. */
export function mixColor(a: string, b: string, t: number): string {
  const m = mixRgba(parseColor(a), parseColor(b), t);
  const hex = (i: number) => Math.round(Math.min(1, Math.max(0, m[i]!)) * 255).toString(16).padStart(2, "0");
  return `#${hex(0)}${hex(1)}${hex(2)}${hex(3)}`;
}
