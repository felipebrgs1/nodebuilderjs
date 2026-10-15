// <ProgressBar> (a share done, or indeterminate) and <Spinner> (busy, no measure).

import { type Handlers, type Style, UINode, invalidate } from "../../render/node.js";
import { type MaybeAccessor, createEffect, onCleanup, read } from "../../reactive/signals.js";
import { requestAnimationFrame } from "../../runtime/frames.js";
import { theme } from "../../theme.js";
import { type StyleProps, applyProps, ownColors } from "../props.js";

/** Calls `frame(time)` every frame while the component is mounted. */
function everyFrame(frame: (time: number) => void) {
  let alive = true;
  const loop = (time: number) => {
    if (!alive) return;
    frame(time);
    invalidate();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  onCleanup(() => (alive = false));
}

/** `value` from 0 to 1; without it, a segment keeps sliding (work of unknown length). */
export function ProgressBar(props: StyleProps & Handlers & { value?: MaybeAccessor<number> }) {
  const node = new UINode("ProgressBar");
  node.role = "progressbar";
  node.states = () => (props.value === undefined ? {} : { value: Math.round(Math.max(0, Math.min(1, read(props.value))) * 100), min: 0, max: 100 });
  Object.assign(node.style, { height: 6, minWidth: 40 } satisfies Style);
  const { rest, fill, track } = ownColors(props, () => theme.accent.base, () => theme.control.pressed);
  applyProps(node, rest);
  let phase = 0.4; // the segment starts in view
  if (props.value === undefined) everyFrame((time) => (phase = (time % 1400) / 1400));
  else createEffect(() => (read(props.value), invalidate()));
  node.paint = (p, n) => {
    const r = n.height / 2;
    p.rect(n.x, n.y, n.width, n.height, track(), r);
    if (props.value === undefined) {
      const w = n.width * 0.3;
      const x = -w + phase * (n.width + w);
      const left = Math.max(0, x);
      const right = Math.min(n.width, x + w);
      if (right > left) p.rect(n.x + left, n.y, right - left, n.height, fill(), r);
    } else {
      const share = Math.max(0, Math.min(1, read(props.value)));
      if (share > 0) p.rect(n.x, n.y, n.width * share, n.height, fill(), r);
    }
  };
  return node;
}

export function Spinner(props: StyleProps & Handlers & { size?: number; color?: string }) {
  const size = props.size ?? 20;
  const node = new UINode("Spinner");
  node.role = "progressbar";
  Object.assign(node.style, { width: size, height: size } satisfies Style);
  applyProps(node, props);
  let angle = 0;
  everyFrame((time) => (angle = ((time % 900) / 900) * 2 * Math.PI));
  node.paint = (p, n) => {
    const outer = Math.min(n.width, n.height) / 2;
    const inner = outer * 0.75;
    const cx = n.x + n.width / 2;
    const cy = n.y + n.height / 2;
    p.arc(cx, cy, outer, inner, 0, 2 * Math.PI, theme.control.pressed);
    p.arc(cx, cy, outer, inner, angle, Math.PI / 2, props.color ?? theme.accent.base);
  };
  return node;
}
