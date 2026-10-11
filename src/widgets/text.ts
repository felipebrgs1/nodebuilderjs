import { type Child, setTextFactory } from "../jsx-runtime.js";
import { edges } from "../render/layout.js";
import { type Handlers, UINode, invalidate, measureText, metricsGeneration } from "../render/node.js";
import { type MaybeAccessor, createEffect, read } from "../reactive/signals.js";
import { clipboard } from "../runtime/clipboard.js";
import { theme } from "../theme.js";
import { type StyleProps, applyProps, inherited } from "./props.js";
import { boundaryAt, charAt, charEdges, wordAt } from "./text-selection.js";

function textOf(child: Child): string {
  if (child == null || typeof child === "boolean") return "";
  if (typeof child === "function") return textOf((child as () => Child)());
  if (Array.isArray(child)) return child.map(textOf).join("");
  if (typeof child === "string" || typeof child === "number") return String(child);
  return "";
}

export function Text(
  props: StyleProps & Handlers & {
    text?: MaybeAccessor<string | number>;
    children?: Child;
    /** Lets the user select it with the mouse and copy it (Ctrl+C). Off by default, so labels and buttons don't select. */
    selectable?: boolean;
  },
) {
  const node = new UINode("Text");
  applyProps(node, props);
  let value = "";
  let selection = { anchor: 0, focus: 0 }; // in characters; empty when equal
  createEffect(() => {
    value = props.text !== undefined ? String(read(props.text)) : textOf(props.children);
    node.label = `Text ${JSON.stringify(value)}`;
    selection = { anchor: 0, focus: 0 };
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

  // Character boundaries, only for selectable text and only when the text or font changes.
  let layoutCache = { value: "", size: 0, bold: false, generation: -1, chars: [] as string[], edges: [0] };
  const charLayout = () => {
    const { size, bold } = font();
    const c = layoutCache;
    if (value !== c.value || size !== c.size || bold !== c.bold || c.generation !== metricsGeneration()) {
      const chars = Array.from(value);
      layoutCache = { value, size, bold, generation: metricsGeneration(), chars, edges: charEdges(chars, (s) => measureText(s, size, bold).width) };
    }
    return layoutCache;
  };
  const range = () => [Math.min(selection.anchor, selection.focus), Math.max(selection.anchor, selection.focus)] as const;

  node.paint = (p, n) => {
    const { size, bold } = font();
    const [pt, , , pl] = edges(n.style.padding);
    const [from, to] = range();
    if (from !== to) {
      const { edges: xs } = charLayout();
      const m = measureText(value, size, bold);
      p.rect(n.x + pl + xs[from]!, n.y + pt, xs[to]! - xs[from]!, Math.ceil(m.ascent + m.descent), theme.selection);
    }
    p.text(n.x + pl, n.y + pt, value, size, inherited(n, "color") ?? theme.text.primary, bold);
  };

  if (props.selectable) {
    node.focusable = true; // to receive Ctrl+C, but only by clicking: not a Tab stop
    node.tabStop = false;
    if (node.style.cursor === undefined) node.set("cursor", "text");
    const select = (anchor: number, focus: number) => {
      selection = { anchor, focus };
      invalidate();
    };
    const textX = (localX: number) => localX - edges(node.style.padding)[3];
    let dragging = false;
    const prev = { ...node.handlers };
    Object.assign(node.handlers, {
      onPointerDown: (e) => {
        prev.onPointerDown?.(e);
        e.stop(); // selecting, not dragging the window or pressing what's around
        if (e.button !== 0) return;
        const { chars, edges: xs } = charLayout();
        const x = textX(e.localX);
        dragging = e.clicks === 1;
        if (e.clicks >= 3) select(0, chars.length);
        else if (e.clicks === 2) select(...wordAt(chars, charAt(xs, x)));
        else select(boundaryAt(xs, x), boundaryAt(xs, x));
      },
      onPointerMove: (e) => {
        prev.onPointerMove?.(e);
        if (dragging && e.button === 0) select(selection.anchor, boundaryAt(charLayout().edges, textX(e.localX)));
      },
      onBlur: () => {
        prev.onBlur?.();
        select(0, 0);
      },
      onKeyDown: (e) => {
        const key = e.key.toLowerCase();
        if (e.ctrl && (key === "c" || key === "insert")) {
          const [from, to] = range();
          if (from !== to) clipboard.writeText(charLayout().chars.slice(from, to).join(""));
          return e.stop();
        }
        if (e.ctrl && key === "a") {
          select(0, charLayout().chars.length);
          return e.stop();
        }
        prev.onKeyDown?.(e);
      },
    } satisfies Handlers);
  }
  return node;
}

setTextFactory((text) => Text({ text }));
