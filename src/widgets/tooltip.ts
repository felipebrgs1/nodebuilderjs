// <Tooltip>: a short hint shown next to its child after the pointer rests on it.

import { type Child, insert, jsx } from "../jsx-runtime.js";
import { type Handlers, type Placement, UINode } from "../render/node.js";
import { createPresence } from "../animation/index.js";
import { Show } from "../reactive/control.js";
import { type MaybeAccessor, createEffect, createSignal, onCleanup, read } from "../reactive/signals.js";
import { theme } from "../theme.js";
import { Box } from "./containers.js";
import { Overlay } from "./overlay.js";
import { type StyleProps, applyProps } from "./props.js";
import { Text } from "./text.js";

export function Tooltip(
  props: StyleProps & {
    text: MaybeAccessor<string>;
    /** Side of the child (default "top"); flips when it does not fit. */
    placement?: Placement;
    /** Milliseconds the pointer rests before it shows (default 500). */
    delay?: number;
    children?: Child;
  },
): Child {
  const wrap = new UINode("Tooltip");
  applyProps(wrap, props);
  insert(wrap, props.children);
  // The tip names an icon-only trigger (findByLabel), unless it is labelled already.
  const kids = wrap.children;
  const trigger = kids.length === 1 ? kids[0]! : wrap;
  if (trigger.ariaLabel === undefined && props.ariaLabel === undefined) createEffect(() => (trigger.ariaLabel = read(props.text)));
  const [open, setOpen] = createSignal(false);
  const delay = props.delay ?? 500;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hide = () => {
    clearTimeout(timer);
    setOpen(false);
  };
  onCleanup(() => clearTimeout(timer));
  const own = { ...wrap.handlers };
  Object.assign(wrap.handlers, {
    onPointerEnter: () => {
      own.onPointerEnter?.();
      clearTimeout(timer);
      if (delay <= 0) setOpen(true);
      else timer = setTimeout(() => setOpen(true), delay);
    },
    onPointerLeave: () => (own.onPointerLeave?.(), hide()),
    // A press or release anywhere inside (both bubble up, a child's stop() aside) hides it.
    onPointerDown: (e) => (own.onPointerDown?.(e), hide()),
    onPointerUp: (e) => (own.onPointerUp?.(e), hide()),
  } satisfies Handlers);

  const presence = createPresence(open, { enter: 100, exit: 80 });
  const bubble = () =>
    jsx(Overlay, {
      anchor: () => wrap,
      placement: props.placement ?? "top",
      offset: 6,
      opacity: presence.progress,
      children: jsx(Box, {
        padding: [6, 10],
        radius: 6,
        maxWidth: 280,
        background: () => theme.tooltip.background,
        children: jsx(Text, { text: props.text, color: () => theme.tooltip.text, fontSize: 12 }),
      }),
    });
  return [wrap, jsx(Show, { when: presence.mounted, children: bubble })];
}
