import { insert, jsx } from "../jsx-runtime.js";
import { type Style, UINode } from "../render/node.js";
import { type Accessor, type MaybeAccessor, createEffect, untrack } from "../reactive/signals.js";
import { theme } from "../theme.js";
import { type StyleProps, applyProps, disableable, interaction } from "./props.js";
import { Text } from "./text.js";

export function Checkbox(
  props: StyleProps & { checked: Accessor<boolean>; onChange: (checked: boolean) => void; label?: MaybeAccessor<string>; disabled?: MaybeAccessor<boolean> },
) {
  const row = new UINode("Checkbox");
  Object.assign(row.style, { direction: "row", align: "center", gap: 10, cursor: "pointer" } satisfies Style);
  applyProps(row, props);
  const disabled = disableable(row, props);
  const box = new UINode("CheckboxBox");
  Object.assign(box.style, { width: 20, height: 20, radius: 6 } satisfies Style);
  const mark = new UINode("CheckboxMark");
  Object.assign(mark.style, { position: "absolute", left: 5, top: 5, width: 10, height: 10, radius: 3 } satisfies Style);
  row.setSlot(row.addSlot(), [box]);
  box.setSlot(box.addSlot(), [mark]);

  const state = interaction(row);
  const toggle = () => !disabled() && props.onChange(!untrack(props.checked));
  row.handlers.onClick = toggle;
  row.handlers.onKeyDown = (e) => {
    if (e.key === "space" || e.key === "Return") {
      toggle();
      e.stop();
    }
  };
  createEffect(() => {
    const on = props.checked();
    box.set("background", on ? (state.hovered() ? theme.accent.hover : theme.accent.base) : theme.field.background);
    box.set("borderWidth", on ? 0 : state.focused() ? 2 : 1.5);
    box.set("borderColor", state.focused() ? theme.field.focus : theme.field.border);
    mark.set("background", on ? "#ffffff" : "#00000000");
  });
  if (props.label !== undefined) insert(row, jsx(Text, { text: props.label }));
  return row;
}
