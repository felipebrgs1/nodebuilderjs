// Layout containers: Box, Column, Row, Scroll, Spacer, Divider and Card.

import { insert } from "../jsx-runtime.js";
import { UINode } from "../render/node.js";
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

/** Vertically scrolling column. Give it `grow` or a fixed height. */
export function Scroll(props: BoxProps) {
  const node = Column(props);
  node.label = "Scroll";
  node.scrollable = true;
  node.style.minHeight ??= 0;
  return node;
}

export function Divider() {
  const node = new UINode("Divider");
  node.style.height = 1;
  node.style.background = theme.divider;
  return node;
}

/** A raised surface for grouping content. */
export function Card(props: BoxProps) {
  const node = Column(props);
  node.label = "Card";
  node.style.background ??= theme.card.background;
  node.style.radius ??= 12;
  node.style.padding ??= 16;
  node.style.gap ??= 8;
  node.style.borderWidth ??= 1;
  node.style.borderColor ??= theme.card.border;
  return node;
}
