// <Overlay>: content drawn above the whole window, outside the clip of its container
// (dialogs, dropdowns, tooltips, toasts). Like Flutter's Overlay or React's portal.
//
// The component leaves a zero-size placeholder where it is declared; the layer hangs from
// it (layer.parent = placeholder) without being one of its children. So it keeps context,
// ownership and inherited text style from that spot, while layout, paint and hit testing
// treat it as a separate layer of the root (root.layers).

import { type Child, insert } from "../jsx-runtime.js";
import { type Edges, type ElementRef, type Handlers, type Placement, type Point, UINode, invalidate, overlayLayers } from "../render/node.js";
import { type MaybeAccessor, onCleanup, read } from "../reactive/signals.js";
import { type StyleProps, applyProps } from "./props.js";

export function Overlay(
  props: StyleProps & Handlers & {
    /** Element to place the overlay next to (pass `() => el` when the ref is set in the same JSX). Without it, the overlay covers the window. */
    anchor?: MaybeAccessor<ElementRef | undefined>;
    /** A point to open at instead of an anchor, in window coordinates (a context menu: the pointer's `x`/`y`). */
    at?: MaybeAccessor<Point | undefined>;
    /** Side of the anchor (default "bottom"); flips to the opposite side when it does not fit. */
    placement?: Placement;
    /** Distance from the anchor (default 4; 0 with `at`). */
    offset?: number;
    /** Same width as the anchor (dropdowns). */
    matchWidth?: boolean;
    /** Covers the window and blocks the pointer and Tab below it (dialogs); `background` dims what is behind. */
    modal?: boolean;
    /**
     * Without an anchor (or modal): space left uncovered at the window's edges, like padding
     * (`[top, right, bottom, left]`). What it leaves out keeps working under a modal, e.g. the
     * title bar: `inset={[theme.window.titlebarHeight + 1, 0, 0, 0]}`.
     */
    inset?: Edges;
    /** A press outside the overlay (on a modal: its backdrop; never on the anchor) or Escape: close it here. */
    onDismiss?: () => void;
    children?: Child;
  },
) {
  const placeholder = new UINode("Overlay");
  placeholder.style.position = "absolute";
  const layer = new UINode("OverlayLayer");
  layer.parent = placeholder;
  layer.overlay = {
    anchor: props.anchor === undefined ? undefined : () => read(props.anchor),
    at: props.at === undefined ? undefined : () => read(props.at),
    placement: props.placement ?? "bottom",
    offset: props.offset ?? (props.at !== undefined ? 0 : 4),
    matchWidth: !!props.matchWidth,
    modal: !!props.modal,
    inset: props.inset,
    onDismiss: props.onDismiss,
  };
  applyProps(layer, props);
  // Registered before the children run, so overlays nested inside come later (above it).
  overlayLayers.add(layer);
  onCleanup(() => {
    overlayLayers.delete(layer);
    invalidate();
  });
  insert(layer, props.children);
  invalidate();
  return placeholder;
}
