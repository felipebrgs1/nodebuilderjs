// <Dialog>: a modal card over the window (title, body, actions). It focuses its first
// control when it opens and gives the focus back when it closes.

import { type Child, jsx } from "../../jsx-runtime.js";
import { type Edges, type ElementRef, UINode, focusedElement } from "../../render/node.js";
import { createPresence } from "../../animation/index.js";
import { Show } from "../../reactive/control.js";
import { type Accessor, type MaybeAccessor, onCleanup, untrack } from "../../reactive/signals.js";
import { theme } from "../../theme.js";
import { Card, Row } from "../layout/containers.js";
import { Overlay } from "./overlay.js";
import { Text } from "../text/text.js";

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
  /** Space the backdrop leaves uncovered at the window's edges (the title bar: `[theme.window.titlebarHeight + 1, 0, 0, 0]`). */
  inset?: Edges;
  children?: Child;
}): Child {
  // In the tree where the Dialog is declared, so the focus to give back can be found.
  const marker = new UINode("Dialog");
  marker.style.position = "absolute";

  // Fades in and slides up; on close it fades out before leaving the tree.
  const presence = createPresence(props.open, { enter: 180, exit: 120 });
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
        translateY: () => (1 - presence.progress()) * 16,
        children: [
          props.title !== undefined && jsx(Text, { text: props.title, fontSize: 18, bold: true }),
          props.children,
          props.actions !== undefined && jsx(Row, { gap: 8, justify: "end", children: props.actions }),
        ],
      });
      queueMicrotask(() => firstFocusable(card)?.focus());
      return jsx(Overlay, {
        modal: true,
        inset: props.inset,
        opacity: presence.progress,
        background: () => theme.backdrop,
        align: "center",
        justify: "center",
        padding: 24,
        onDismiss: props.dismissible === false ? undefined : props.onClose,
        ref: (r: ElementRef) => {
          const layer = r as UINode;
          layer.role = "dialog";
          layer.states = () => ({ modal: true });
        },
        children: card,
      });
    });
  return [marker, jsx(Show, { when: presence.mounted, children: content })];
}
