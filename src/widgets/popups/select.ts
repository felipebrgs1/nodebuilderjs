// <Select>: pick one option from a list that opens below the field (an anchored Overlay).
// The field keeps the keyboard focus while the list is open: the arrows move the highlight,
// Enter picks, Escape closes.

import { type Child, jsx } from "../jsx-runtime.js";
import { type Handlers, type Style, UINode } from "../render/node.js";
import { createPresence } from "../animation/index.js";
import { Show } from "../reactive/control.js";
import { type Accessor, type MaybeAccessor, createEffect, createSignal, read, untrack } from "../reactive/signals.js";
import { theme } from "../theme.js";
import { Box, Card, Scroll } from "./containers.js";
import { Overlay } from "./overlay.js";
import { type StyleProps, applyProps, disableable, interaction, ownHandler } from "./props.js";
import type { Choice } from "./radio.js";
import { Text } from "./text.js";

function chevron(color: () => string) {
  const node = new UINode("SelectChevron");
  Object.assign(node.style, { width: 10, height: 6 } satisfies Style);
  node.paint = (p, n) => {
    p.line(n.x, n.y, n.x + 5, n.y + 5, 1.5, color());
    p.line(n.x + 5, n.y + 5, n.x + 10, n.y, 1.5, color());
  };
  return node;
}

export function Select<T>(
  props: StyleProps & Handlers & {
    value: Accessor<T | undefined>;
    onChange: (value: T) => void;
    options: readonly Choice<T>[];
    placeholder?: MaybeAccessor<string>;
    disabled?: MaybeAccessor<boolean>;
  },
): Child {
  const trigger = new UINode("Select");
  Object.assign(trigger.style, {
    direction: "row", align: "center", gap: 8, padding: [8, 10, 8, 12], radius: theme.radius, minWidth: 120, borderWidth: 1,
  } satisfies Style);
  if (props.background === undefined) createEffect(() => trigger.set("background", theme.field.background));
  applyProps(trigger, props);
  const disabled = disableable(trigger, props);
  const state = interaction(trigger);
  const [open, setOpen] = createSignal(false);
  const [highlight, setHighlight] = createSignal(-1);

  const options = props.options;
  const current = () => options.findIndex((o) => Object.is(o.value, props.value()));
  const enabled = (i: number) => i >= 0 && i < options.length && !options[i]!.disabled;
  const label = Text({
    text: () => (current() >= 0 ? options[current()]!.label : read(props.placeholder ?? "")),
    color: () => (current() >= 0 ? theme.text.primary : theme.field.placeholder),
    grow: 1,
    maxLines: 1,
  });
  trigger.setSlot(trigger.addSlot(), [label, chevron(() => theme.text.secondary)]);
  createEffect(() => {
    const active = state.focused() || open();
    trigger.set("borderWidth", active ? 2 : 1);
    trigger.set("borderColor", active ? theme.field.focus : theme.field.border);
  });

  const show = () => {
    if (disabled()) return;
    const i = untrack(current);
    setHighlight(enabled(i) ? i : options.findIndex((_, k) => enabled(k)));
    setOpen(true);
  };
  const close = () => setOpen(false);
  const pick = (i: number) => {
    if (!enabled(i)) return;
    close();
    const value = options[i]!.value;
    if (!Object.is(value, untrack(props.value))) props.onChange(value);
  };
  /** Next enabled option from `from` in direction `step`, staying put at the ends. */
  const toward = (from: number, step: number) => {
    for (let i = from + step; i >= 0 && i < options.length; i += step) if (enabled(i)) return i;
    return from;
  };

  ownHandler(trigger, "onClick", () => (untrack(open) ? close() : show()));
  ownHandler(trigger, "onKeyDown", (e) => {
    if (!untrack(open)) {
      if (["Down", "Up", "space", "Return"].includes(e.key)) {
        show();
        e.stop();
      }
      return;
    }
    const h = untrack(highlight);
    switch (e.key) {
      case "Down": setHighlight(toward(h, 1)); break;
      case "Up": setHighlight(toward(h, -1)); break;
      case "Home": setHighlight(toward(-1, 1)); break;
      case "End": setHighlight(toward(options.length, -1)); break;
      case "Return": case "space": pick(h); break;
      case "Escape": close(); break;
      case "Tab": close(); return; // and let the focus move on
      default: return;
    }
    e.stop();
  });

  const presence = createPresence(open, { enter: 120, exit: 90 });
  const list = () => {
    const rows = options.map((option, i) => {
      const row = Box({
        padding: [8, 10],
        radius: 6,
        cursor: option.disabled ? "default" : "pointer",
        opacity: option.disabled ? theme.disabledOpacity : 1,
        background: () => (highlight() === i && enabled(i) ? theme.control.hover : "transparent"),
        onPointerEnter: () => enabled(i) && setHighlight(i),
        onClick: () => pick(i),
        children: jsx(Text, { text: option.label, maxLines: 1, bold: () => i === current(), color: () => (i === current() ? theme.accent.pressed : theme.text.primary) }),
      });
      return row;
    });
    createEffect(() => rows[highlight()]?.scrollIntoView());
    return jsx(Overlay, {
      anchor: () => trigger,
      matchWidth: true,
      onDismiss: close,
      opacity: presence.progress,
      translateY: () => (presence.progress() - 1) * 4,
      children: jsx(Card, {
        padding: 4,
        gap: 0,
        shadow: { color: "#00000030", blur: 16, y: 4 },
        children: jsx(Scroll, { maxHeight: 240, children: rows }),
      }),
    });
  };
  return [trigger, jsx(Show, { when: presence.mounted, children: () => untrack(list) })];
}
