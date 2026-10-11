import { UINode } from "../render/node.js";
import { type BoxProps } from "./props.js";
export declare function Box(props: BoxProps): UINode;
export declare function Column(props: BoxProps): UINode;
export declare function Row(props: BoxProps): UINode;
export declare function Spacer(props: {
    size?: number;
}): UINode;
/** Vertically scrolling column. Give it `grow` or a fixed height. */
export declare function Scroll(props: BoxProps): UINode;
export declare function Divider(): UINode;
/** A raised surface for grouping content. */
export declare function Card(props: BoxProps): UINode;
