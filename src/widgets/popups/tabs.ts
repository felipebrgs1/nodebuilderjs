// <Tabs>: the bar of tabs; the app shows the content of the selected one (e.g. with <Switch>).
// One Tab stop; Left/Right move the selection, skipping disabled tabs.

import { type Handlers, type Style, UINode } from "../../render/node.js";
import { type Accessor, type MaybeAccessor, createEffect, read } from "../../reactive/signals.js";
import { theme } from "../../theme.js";
import { type StyleProps, applyProps, disableable, interaction } from "../props.js";
import type { Choice } from "../controls/radio.js";
import { rovingFocus } from "../roving.js";
import { Text } from "../text/text.js";

const UNDERLINE = 2;

export function Tabs<T>(
  props: StyleProps & Handlers & {
    value: Accessor<T>;
    onChange: (value: T) => void;
    tabs: readonly Choice<T>[];
    disabled?: MaybeAccessor<boolean>;
  },
) {
  const bar = new UINode("Tabs");
  bar.role = "tablist";
  Object.assign(bar.style, { direction: "row", gap: 4 } satisfies Style);
  applyProps(bar, props);
  bar.paint = (p, n) => p.rect(n.x, n.y + n.height - 1, n.width, 1, theme.divider);
  const barDisabled = () => !!read(props.disabled ?? false);

  const items = props.tabs.map((tab) => {
    const node = new UINode("Tab");
    Object.assign(node.style, { padding: [8, 12, 10, 12] } satisfies Style);
    const disabled = disableable(node, { disabled: () => barDisabled() || !!tab.disabled });
    const state = interaction(node);
    const selected = () => Object.is(props.value(), tab.value);
    node.role = "tab";
    node.states = () => ({ selected: selected() });
    node.paint = (p, n) => {
      if (selected()) p.rect(n.x, n.y + n.height - UNDERLINE, n.width, UNDERLINE, theme.accent.base, 1);
    };
    const label = Text({ text: tab.label });
    createEffect(() => {
      label.set("color", selected() ? theme.accent.pressed : state.hovered() ? theme.text.primary : theme.text.secondary);
      label.set("bold", selected());
      node.set("background", state.focused() ? theme.control.base : "transparent");
      node.set("radius", 6);
    });
    node.setSlot(node.addSlot(), [label]);
    const select = () => !disabled() && !selected() && props.onChange(tab.value);
    node.handlers.onClick = select;
    node.handlers.onKeyDown = (e) => {
      if (e.key !== "space" && e.key !== "Return") return;
      select();
      e.stop();
    };
    return { node, disabled, select };
  });
  rovingFocus(items, () => props.tabs.findIndex((t) => Object.is(t.value, props.value())), { next: ["Right"], prev: ["Left"] });
  bar.setSlot(bar.addSlot(), items.map((i) => i.node));
  return bar;
}
