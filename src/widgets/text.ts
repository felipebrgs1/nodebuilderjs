import { type Child, setTextFactory } from "../jsx-runtime.js";
import { edges } from "../render/layout.js";
import { type Handlers, UINode, invalidate, measureText, metricsGeneration } from "../render/node.js";
import { type MaybeAccessor, createEffect, read } from "../reactive/signals.js";
import { theme } from "../theme.js";
import { type StyleProps, applyProps, inherited } from "./props.js";

function textOf(child: Child): string {
  if (child == null || typeof child === "boolean") return "";
  if (typeof child === "function") return textOf((child as () => Child)());
  if (Array.isArray(child)) return child.map(textOf).join("");
  if (typeof child === "string" || typeof child === "number") return String(child);
  return "";
}

export function Text(props: StyleProps & Handlers & { text?: MaybeAccessor<string | number>; children?: Child }) {
  const node = new UINode("Text");
  applyProps(node, props);
  let value = "";
  createEffect(() => {
    value = props.text !== undefined ? String(read(props.text)) : textOf(props.children);
    node.label = `Text ${JSON.stringify(value)}`;
    invalidate();
  });
  const font = () => ({ size: inherited(node, "fontSize") ?? theme.font.size, bold: inherited(node, "bold") ?? false });
  // Every row of a long list is measured each frame (scroll extent), so skip the shared cache's key building.
  let last = { value: "", size: 0, bold: false, generation: -1, result: { width: 0, height: 0 } };
  node.measure = () => {
    const { size, bold } = font();
    if (value === last.value && size === last.size && bold === last.bold && last.generation === metricsGeneration()) return last.result;
    const m = measureText(value, size, bold);
    last = { value, size, bold, generation: metricsGeneration(), result: { width: Math.ceil(m.width), height: Math.ceil(m.ascent + m.descent) } };
    return last.result;
  };
  node.paint = (p, n) => {
    const { size, bold } = font();
    const [pt, , , pl] = edges(n.style.padding);
    p.text(n.x + pl, n.y + pt, value, size, inherited(n, "color") ?? theme.text.primary, bold);
  };
  return node;
}

setTextFactory((text) => Text({ text }));
