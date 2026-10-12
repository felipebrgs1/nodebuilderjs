// <Toggle>: an on/off switch (named so because <Switch> is control flow).

import { insert, jsx } from "../jsx-runtime.js";
import { type Style, UINode, invalidate } from "../render/node.js";
import { type Accessor, type MaybeAccessor, createEffect, untrack } from "../reactive/signals.js";
import { theme } from "../theme.js";
import { type StyleProps, applyProps, disableable, interaction } from "./props.js";
import { Text } from "./text.js";

const TRACK_W = 36;
const TRACK_H = 20;
const THUMB = 16;

export function Toggle(
  props: StyleProps & {
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
  track.paint = (p, n) => {
    const on = untrack(props.checked);
    const color = on ? (untrack(state.hovered) ? theme.accent.hover : theme.accent.base) : untrack(state.hovered) ? theme.control.pressed : "#00000033";
    const focused = untrack(state.focused);
    p.rect(n.x, n.y, n.width, n.height, color, TRACK_H / 2, focused ? 2 : 0, theme.focusRing);
    const inset = (TRACK_H - THUMB) / 2;
    p.rect(n.x + (on ? TRACK_W - THUMB - inset : inset), n.y + inset, THUMB, THUMB, "#ffffff", THUMB / 2);
  };
  row.setSlot(row.addSlot(), [track]);
  createEffect(() => {
    props.checked();
    state.hovered();
    state.focused();
    invalidate();
  });

  const toggle = () => !disabled() && props.onChange(!untrack(props.checked));
  row.handlers.onClick = toggle;
  row.handlers.onKeyDown = (e) => {
    if (e.key === "space" || e.key === "Return" || e.key === "KP_Enter") {
      toggle();
      e.stop();
    }
  };
  if (props.label !== undefined) insert(row, jsx(Text, { text: props.label }));
  return row;
}
