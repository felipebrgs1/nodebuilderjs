// <Toggle>: an on/off switch (named so because <Switch> is control flow).

import { createTween, mixColor } from "../animation/index.js";
import { insert, jsx } from "../jsx-runtime.js";
import { type Handlers, type Style, UINode, invalidate } from "../render/node.js";
import { type Accessor, type MaybeAccessor, createEffect, untrack } from "../reactive/signals.js";
import { theme } from "../theme.js";
import { type StyleProps, applyProps, disableable, interaction, ownHandler } from "./props.js";
import { Text } from "./text.js";

const TRACK_W = 36;
const TRACK_H = 20;
const THUMB = 16;

export function Toggle(
  props: StyleProps & Handlers & {
    checked: Accessor<boolean>;
    onChange: (checked: boolean) => void;
    label?: MaybeAccessor<string>;
    disabled?: MaybeAccessor<boolean>;
  },
) {
  const row = new UINode("Toggle");
  Object.assign(row.style, { direction: "row", align: "center", gap: 10 } satisfies Style);
  applyProps(row, props);
  const disabled = disableable(row, props);
  const state = interaction(row);

  const track = new UINode("ToggleTrack");
  Object.assign(track.style, { width: TRACK_W, height: TRACK_H } satisfies Style);
  // 0 = off, 1 = on; the thumb slides and the track color blends between them.
  const position = createTween(() => (props.checked() ? 1 : 0), { duration: 150 });
  track.paint = (p, n) => {
    const t = untrack(position);
    const hovered = untrack(state.hovered);
    const off = hovered ? mixColor(theme.control.pressed, theme.text.primary, 0.12) : theme.control.pressed;
    const on = hovered ? theme.accent.hover : theme.accent.base;
    const focused = untrack(state.focused);
    p.rect(n.x, n.y, n.width, n.height, mixColor(off, on, t), TRACK_H / 2, focused ? 2 : 0, theme.focusRing);
    const inset = (TRACK_H - THUMB) / 2;
    p.rect(n.x + inset + t * (TRACK_W - THUMB - 2 * inset), n.y + inset, THUMB, THUMB, "#ffffff", THUMB / 2);
  };
  row.setSlot(row.addSlot(), [track]);
  createEffect(() => {
    position();
    state.hovered();
    state.focused();
    invalidate();
  });

  const toggle = () => !disabled() && props.onChange(!untrack(props.checked));
  ownHandler(row, "onClick", toggle);
  ownHandler(row, "onKeyDown", (e) => {
    if (e.key === "space" || e.key === "Return" || e.key === "KP_Enter") {
      toggle();
      e.stop();
    }
  });
  if (props.label !== undefined) insert(row, jsx(Text, { text: props.label }));
  return row;
}
