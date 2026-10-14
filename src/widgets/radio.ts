// <RadioGroup>: pick one of several options. The group is one Tab stop (the selected
// option); the arrow keys move the choice, skipping disabled options, like native radios.

import { insert, jsx } from "../jsx-runtime.js";
import { type Handlers, type Style, UINode } from "../render/node.js";
import { type Accessor, type MaybeAccessor, createEffect, read, untrack } from "../reactive/signals.js";
import { theme } from "../theme.js";
import { type StyleProps, applyProps, disableable, interaction } from "./props.js";
import { rovingFocus } from "./roving.js";
import { Text } from "./text.js";

export interface Choice<T> {
  value: T;
  label: string;
  disabled?: boolean;
}

export function RadioGroup<T>(
  props: StyleProps & Handlers & {
    value: Accessor<T>;
    onChange: (value: T) => void;
    options: readonly Choice<T>[];
    disabled?: MaybeAccessor<boolean>;
  },
) {
  const group = new UINode("RadioGroup");
  Object.assign(group.style, { direction: "column", gap: 8 } satisfies Style);
  applyProps(group, props);
  const groupDisabled = () => !!read(props.disabled ?? false);

  const items = props.options.map((option) => {
    const row = new UINode("Radio");
    Object.assign(row.style, { direction: "row", align: "center", gap: 10 } satisfies Style);
    const disabled = disableable(row, { disabled: () => groupDisabled() || !!option.disabled });
    const state = interaction(row);
    const circle = new UINode("RadioCircle");
    Object.assign(circle.style, { width: 20, height: 20, radius: 10 } satisfies Style);
    const dot = new UINode("RadioDot");
    Object.assign(dot.style, { position: "absolute", left: 5, top: 5, width: 10, height: 10, radius: 5 } satisfies Style);
    circle.setSlot(circle.addSlot(), [dot]);
    row.setSlot(row.addSlot(), [circle]);
    insert(row, jsx(Text, { text: option.label }));

    const selected = () => Object.is(props.value(), option.value);
    createEffect(() => {
      const on = selected();
      circle.set("background", on ? (state.hovered() ? theme.accent.hover : theme.accent.base) : theme.field.background);
      circle.set("borderWidth", on ? 0 : state.focused() ? 2 : 1.5);
      circle.set("borderColor", state.focused() ? theme.field.focus : theme.field.border);
      dot.set("background", on ? "#ffffff" : "#00000000");
      if (on && state.focused()) circle.set("borderWidth", 2);
    });
    const pick = () => !disabled() && props.onChange(option.value);
    row.handlers.onClick = pick;
    return { row, option, disabled, pick };
  });

  for (const item of items) {
    item.row.handlers.onKeyDown = (e) => {
      if (e.key !== "space" && e.key !== "Return") return;
      item.pick();
      e.stop();
    };
  }
  rovingFocus(
    items.map((i) => ({ node: i.row, disabled: i.disabled, select: i.pick })),
    () => items.findIndex((i) => Object.is(i.option.value, props.value())),
    { next: ["Down", "Right"], prev: ["Up", "Left"] },
  );
  untrack(() => group.setSlot(group.addSlot(), items.map((i) => i.row)));
  return group;
}
