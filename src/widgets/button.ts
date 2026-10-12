import { type Child, insert, jsx } from "../jsx-runtime.js";
import { type Style, UINode } from "../render/node.js";
import { type MaybeAccessor, createEffect } from "../reactive/signals.js";
import { theme } from "../theme.js";
import { type StyleProps, applyProps, disableable, interaction } from "./props.js";
import { Text } from "./text.js";

type Variant = "default" | "primary" | "danger" | "flat";

function palette(variant: Variant) {
  if (variant === "primary") return theme.accent;
  if (variant === "danger") return theme.danger;
  if (variant === "flat") return { ...theme.control, base: "#00000000" };
  return theme.control;
}

export function Button(
  props: StyleProps & {
    label?: MaybeAccessor<string>;
    children?: Child;
    variant?: Variant;
    disabled?: MaybeAccessor<boolean>;
    onClick?: () => void;
  },
) {
  const node = new UINode("Button");
  const colors = palette(props.variant ?? "default");
  Object.assign(node.style, {
    direction: "row", align: "center", justify: "center", gap: 6, padding: [8, 16], radius: theme.radius, cursor: "pointer",
    color: colors.text, bold: props.variant === "primary" || props.variant === "danger",
  } satisfies Style);
  applyProps(node, props);
  const disabled = disableable(node, props);

  const state = interaction(node);
  const activate = () => !disabled() && props.onClick?.();
  node.handlers.onClick = activate;
  node.handlers.onKeyDown = (e) => {
    if (e.key === "Return" || e.key === "space" || e.key === "KP_Enter") {
      activate();
      e.stop();
    }
  };
  if (props.background === undefined) {
    createEffect(() =>
      node.set("background", disabled() ? colors.base : state.pressed() ? colors.pressed : state.hovered() ? colors.hover : colors.base),
    );
  }
  createEffect(() => {
    node.set("borderWidth", state.focused() ? 2 : 0);
    node.set("borderColor", theme.focusRing);
  });

  if (props.label !== undefined) insert(node, jsx(Text, { text: props.label }));
  insert(node, props.children);
  return node;
}
