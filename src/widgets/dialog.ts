// <Dialog>: a modal card over the window (title, body, actions). It focuses its first
// control when it opens and gives the focus back when it closes.

import { type Child, jsx } from "../jsx-runtime.js";
import { UINode, focusedElement } from "../render/node.js";
import { Show } from "../reactive/control.js";
import { type Accessor, type MaybeAccessor, onCleanup, untrack } from "../reactive/signals.js";
import { theme } from "../theme.js";
import { Card, Row } from "./containers.js";
import { Overlay } from "./overlay.js";
import { Text } from "./text.js";

function firstFocusable(node: UINode): UINode | null {
  if (node.focusable && node.tabStop) return node;
  for (const c of node.children) {
    const found = firstFocusable(c);
    if (found) return found;
  }
  return null;
}

export function Dialog(props: {
  open: Accessor<boolean>;
  /** Escape or a press outside the card (unless `dismissible` is false). Close it here. */
  onClose: () => void;
  title?: MaybeAccessor<string>;
  /** Buttons at the bottom right. */
  actions?: Child;
  /** Escape and the backdrop close it (default true). */
  dismissible?: boolean;
  width?: number;
  children?: Child;
}): Child {
  // In the tree where the Dialog is declared, so the focus to give back can be found.
  const marker = new UINode("Dialog");
  marker.style.position = "absolute";

  const content = () =>
    untrack(() => {
      const previous = focusedElement(marker);
      onCleanup(() => {
        if (previous?.attached) previous.focus();
      });
      const card = Card({
        width: props.width ?? 420,
        gap: 12,
        padding: 20,
        shadow: { color: "#00000040", blur: 24, y: 8 },
        children: [
          props.title !== undefined && jsx(Text, { text: props.title, fontSize: 18, bold: true }),
          props.children,
          props.actions !== undefined && jsx(Row, { gap: 8, justify: "end", children: props.actions }),
        ],
      });
      queueMicrotask(() => firstFocusable(card)?.focus());
      return jsx(Overlay, {
        modal: true,
        background: theme.backdrop,
        align: "center",
        justify: "center",
        padding: 24,
        onDismiss: props.dismissible === false ? undefined : props.onClose,
        children: card,
      });
    });
  return [marker, jsx(Show, { when: props.open, children: content })];
}
