import { type Child } from "../jsx-runtime.js";
import { UINode } from "../render/node.js";
import { type StyleProps } from "./props.js";
export declare function Window(props: StyleProps & {
    title: string;
    width?: number;
    height?: number;
    appId?: string;
    onClose?: () => boolean | void;
    children?: Child;
}): UINode;
