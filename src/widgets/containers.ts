// Layout containers: Box, Column, Row, Scroll, Spacer, Divider and Card.

import { insert } from "../jsx-runtime.js";
import { UINode } from "../render/node.js";
import { createEffect } from "../reactive/signals.js";
import { theme } from "../theme.js";
import { type BoxProps, applyProps } from "./props.js";

export function Box(props: BoxProps) {
  const node = new UINode("Box");
  applyProps(node, props);
  insert(node, props.children);
  return node;
}

export function Column(props: BoxProps) {
  const node = Box(props);
  node.label = "Column";
  node.style.direction ??= "column";
  return node;
}

export function Row(props: BoxProps) {
  const node = Box(props);
  node.label = "Row";
  node.style.direction ??= "row";
  return node;
}

export function Spacer(props: { size?: number }) {
  const node = new UINode("Spacer");
  if (props.size !== undefined) node.style.width = node.style.height = props.size;
  else node.style.grow = 1;
  return node;
}

export type ScrollProps = BoxProps & {
  /** Scrolls sideways. Alone, the Scroll is a row whose children keep their width. */
  horizontal?: boolean;
  /** Scrolls up and down (the default; with `horizontal`, both ways in a column). */
  vertical?: boolean;
};

/**
 * Scrolling container: a column that scrolls vertically, a row that scrolls horizontally
 * (`horizontal`) or a column that scrolls both ways (`horizontal vertical`). Give it `grow`
 * or a fixed size.
 */
export function Scroll(props: ScrollProps) {
  const x = !!props.horizontal;
  const y = props.vertical ?? !x;
  const node = new UINode("Scroll");
  // Before applyProps: a `ref` that scrolls right away needs the node to be scrollable.
  node.scrollable = y;
  node.scrollableX = x;
  node.style.direction = x && !y ? "row" : "column";
  if (y) node.style.minHeight = 0;
  if (x) node.style.minWidth = 0;
  applyProps(node, props);
  insert(node, props.children);
  return node;
}

export function Divider() {
  const node = new UINode("Divider");
  node.style.height = 1;
  createEffect(() => node.set("background", theme.divider));
  return node;
}

/** A raised surface for grouping content. */
export function Card(props: BoxProps) {
  const node = Column(props);
  node.label = "Card";
  node.style.radius ??= 12;
  node.style.padding ??= 16;
  node.style.gap ??= 8;
  node.style.borderWidth ??= 1;
  // Theme colors in effects, so they follow setTheme(); the app's own colors win.
  if (props.background === undefined) createEffect(() => node.set("background", theme.card.background));
  if (props.borderColor === undefined) createEffect(() => node.set("borderColor", theme.card.border));
  return node;
}
