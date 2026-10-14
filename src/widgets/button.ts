import { type Child, insert, jsx } from "../jsx-runtime.js";
import { type Handlers, type Style, UINode } from "../render/node.js";
import { type MaybeAccessor, createEffect, read } from "../reactive/signals.js";
import { theme } from "../theme.js";
import { type StyleProps, applyProps, disableable, interaction, ownHandler } from "./props.js";
import { Text } from "./text.js";

export type ButtonVariant = "default" | "primary" | "danger" | "flat";

/** Read inside effects, so the colors follow the theme. */
function palette(variant: ButtonVariant) {
  if (variant === "primary") return theme.accent;
  if (variant === "danger") return theme.danger;
  if (variant === "flat") return { base: "#00000000", hover: theme.control.hover, pressed: theme.control.pressed, text: theme.control.text };
  return theme.control;
}

export function Button(
  props: StyleProps & Omit<Handlers, "onClick"> & {
    label?: MaybeAccessor<string>;
    children?: Child;
    /** Static or reactive: the colors, hover and weight follow it. */
    variant?: MaybeAccessor<ButtonVariant>;
    disabled?: MaybeAccessor<boolean>;
    onClick?: () => void;
  },
) {
  const node = new UINode("Button");
  const variant = () => read(props.variant ?? "default");
  Object.assign(node.style, {
    direction: "row", align: "center", justify: "center", gap: 6, padding: [8, 16], radius: theme.radius, cursor: "pointer",
  } satisfies Style);
  if (props.bold === undefined) createEffect(() => node.set("bold", variant() === "primary" || variant() === "danger"));
  if (props.color === undefined) createEffect(() => node.set("color", palette(variant()).text));
  const { onClick: _, ...rest } = props; // onClick goes through activate(), which checks `disabled`
  applyProps(node, rest);
  const disabled = disableable(node, props);

  const state = interaction(node);
  const activate = () => !disabled() && props.onClick?.();
  ownHandler(node, "onClick", activate);
  ownHandler(node, "onKeyDown", (e) => {
    if (e.key === "Return" || e.key === "space" || e.key === "KP_Enter") {
      activate();
      e.stop();
    }
  });
  if (props.background === undefined) {
    createEffect(() => {
      const colors = palette(variant());
      node.set("background", disabled() ? colors.base : state.pressed() ? colors.pressed : state.hovered() ? colors.hover : colors.base);
    });
  }
  // The focus ring, unless the app styles the border (focusStyle restyles the ring).
  if (props.borderWidth === undefined) createEffect(() => node.set("borderWidth", state.focused() ? 2 : 0));
  if (props.borderColor === undefined) createEffect(() => node.set("borderColor", theme.focusRing));

  if (props.label !== undefined) insert(node, jsx(Text, { text: props.label }));
  insert(node, props.children);
  return node;
}
