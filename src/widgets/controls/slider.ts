// <Slider>: a number in [min, max] picked by dragging a thumb along a track, or with the keys.

import { type Handlers, type Style, UINode, invalidate } from "../../render/node.js";
import { type Accessor, type MaybeAccessor, createEffect, untrack } from "../../reactive/signals.js";
import { theme } from "../../theme.js";
import { type StyleProps, applyProps, disableable, interaction, ownColors, ownHandler } from "../props.js";

const THUMB = 16;
const TRACK = 4;

export function Slider(
  props: StyleProps & Handlers & {
    value: Accessor<number>;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    disabled?: MaybeAccessor<boolean>;
  },
) {
  const min = props.min ?? 0;
  const max = props.max ?? 100;
  const step = props.step ?? 1;
  const node = new UINode("Slider");
  Object.assign(node.style, { height: 20, minWidth: 80, width: 200 } satisfies Style);
  const { rest, fill, track } = ownColors(props, () => theme.accent.base, () => theme.control.pressed);
  applyProps(node, rest);
  const disabled = disableable(node, props);
  const state = interaction(node);

  const fraction = () => (max > min ? Math.max(0, Math.min(1, (untrack(props.value) - min) / (max - min))) : 0);
  const set = (raw: number) => {
    const snapped = Math.round((raw - min) / step) * step + min;
    const v = Math.max(min, Math.min(max, Number(snapped.toFixed(10))));
    if (v !== untrack(props.value)) props.onChange(v);
  };
  /** Value under a pointer position local to the node (the thumb's center travels inside it). */
  const valueAt = (localX: number) => min + Math.max(0, Math.min(1, (localX - THUMB / 2) / Math.max(1, node.width - THUMB))) * (max - min);

  node.paint = (p, n) => {
    const travel = n.width - THUMB;
    const cx = n.x + THUMB / 2 + fraction() * travel;
    const cy = n.y + n.height / 2;
    p.rect(n.x + THUMB / 2, cy - TRACK / 2, travel, TRACK, track(), TRACK / 2);
    p.rect(n.x + THUMB / 2, cy - TRACK / 2, cx - n.x - THUMB / 2, TRACK, fill(), TRACK / 2);
    const focused = untrack(state.focused);
    const hovered = untrack(state.hovered) || untrack(state.pressed);
    p.rect(cx - THUMB / 2, cy - THUMB / 2, THUMB, THUMB, "#ffffff", THUMB / 2, focused ? 3 : hovered ? 2 : 1.5, focused ? theme.focusRing : hovered ? fill() : theme.field.border);
  };
  createEffect(() => {
    props.value();
    state.focused();
    state.hovered();
    state.pressed();
    invalidate();
  });

  let dragging = false;
  // Chained: the press state (pressStyle) and the app's own handlers still run.
  ownHandler(node, "onPointerDown", (e) => {
    if (disabled() || e.button !== 0) return;
    dragging = true;
    set(valueAt(e.localX));
    e.stop(); // not a window drag
  });
  ownHandler(node, "onPointerMove", (e) => {
    if (dragging && e.button === 0) set(valueAt(e.localX));
  });
  ownHandler(node, "onPointerUp", () => {
    dragging = false;
  });
  ownHandler(node, "onKeyDown", (e) => {
    const v = untrack(props.value);
    const page = Math.max(step, (max - min) / 10);
    switch (e.key) {
      case "Right": case "Up": set(v + step); break;
      case "Left": case "Down": set(v - step); break;
      case "Page_Up": set(v + page); break;
      case "Page_Down": set(v - page); break;
      case "Home": set(min); break;
      case "End": set(max); break;
      default: return;
    }
    e.stop(); // the keys belong to the slider, not to a Scroll around it
  });
  return node;
}
