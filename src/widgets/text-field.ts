import { edges } from "../render/layout.js";
import { type Style, UINode, invalidate, measureText } from "../render/node.js";
import { type Accessor, type MaybeAccessor, createEffect, createSignal, onCleanup, read, untrack } from "../reactive/signals.js";
import { theme } from "../theme.js";
import { type StyleProps, applyProps, inherited, interaction } from "./props.js";

export function TextField(
  props: StyleProps & {
    value: Accessor<string>;
    onInput: (value: string) => void;
    onSubmit?: () => void;
    placeholder?: MaybeAccessor<string>;
  },
) {
  const node = new UINode("TextField");
  Object.assign(node.style, {
    padding: [9, 12], radius: theme.radius, background: theme.field.background, cursor: "text", minWidth: 80,
  } satisfies Style);
  node.focusable = true;
  applyProps(node, props);
  const state = interaction(node);

  const chars = () => Array.from(props.value());
  const [caret, setCaret] = createSignal(chars().length);
  const [blinkOn, setBlinkOn] = createSignal(true);
  let scrollX = 0;

  // Keep the caret inside the text when the value changes from outside.
  createEffect(() => {
    const len = chars().length;
    if (untrack(caret) > len) setCaret(len);
    invalidate();
  });
  createEffect(() => {
    const focused = state.focused();
    node.set("borderWidth", focused ? 2 : 1);
    node.set("borderColor", focused ? theme.field.focus : theme.field.border);
  });

  // Caret blink while focused.
  let blink: ReturnType<typeof setInterval> | undefined;
  const restartBlink = () => {
    clearInterval(blink);
    setBlinkOn(true);
    if (untrack(state.focused)) blink = setInterval(() => setBlinkOn((v) => !v), 530);
  };
  createEffect(() => {
    state.focused();
    restartBlink();
  });
  createEffect(() => {
    blinkOn();
    caret();
    invalidate();
  });
  onCleanup(() => clearInterval(blink));

  const size = () => inherited(node, "fontSize") ?? theme.font.size;
  const widthOf = (s: string) => measureText(s, size()).width;

  node.measure = () => {
    const m = measureText("Ag", size());
    return { width: 160, height: Math.ceil(m.ascent + m.descent) };
  };

  node.paint = (p, n) => {
    const [pt, pr, pb, pl] = edges(n.style.padding);
    const innerX = n.x + pl;
    const innerW = n.width - pl - pr;
    const value = props.value();
    const before = chars().slice(0, caret()).join("");
    const caretX = widthOf(before);
    if (caretX - scrollX > innerW - 2) scrollX = caretX - innerW + 2;
    if (caretX - scrollX < 0) scrollX = caretX;
    if (widthOf(value) - scrollX < innerW) scrollX = Math.max(0, widthOf(value) - innerW + 2);

    p.clip(innerX - 1, n.y, innerW + 2, n.height);
    if (value) p.text(innerX - scrollX, n.y + pt, value, size(), inherited(n, "color") ?? theme.text.primary);
    else if (props.placeholder) p.text(innerX, n.y + pt, read(props.placeholder), size(), theme.field.placeholder);
    if (state.focused() && blinkOn()) {
      p.rect(Math.round(innerX + caretX - scrollX), n.y + pt, 1.5, n.height - pt - pb, theme.field.focus);
    }
    p.unclip();
  };

  const edit = (next: string[], at: number) => {
    props.onInput(next.join(""));
    setCaret(at);
    restartBlink();
  };

  node.handlers.onPointerDown = (e) => {
    const [, , , pl] = edges(node.style.padding);
    const x = e.x - node.x - pl + scrollX;
    const cs = chars();
    let best = 0;
    for (let i = 1; i <= cs.length; i++) {
      const w = widthOf(cs.slice(0, i).join(""));
      const prevW = widthOf(cs.slice(0, i - 1).join(""));
      if (x > (prevW + w) / 2) best = i;
      else break;
    }
    setCaret(best);
    restartBlink();
  };

  node.handlers.onKeyDown = (e) => {
    const cs = chars();
    const at = Math.min(caret(), cs.length);
    switch (e.key) {
      case "BackSpace":
        if (at > 0) edit([...cs.slice(0, at - 1), ...cs.slice(at)], at - 1);
        break;
      case "Delete":
      case "KP_Delete":
        if (at < cs.length) edit([...cs.slice(0, at), ...cs.slice(at + 1)], at);
        break;
      case "Left":
        setCaret(Math.max(0, at - 1));
        restartBlink();
        break;
      case "Right":
        setCaret(Math.min(cs.length, at + 1));
        restartBlink();
        break;
      case "Home":
        setCaret(0);
        break;
      case "End":
        setCaret(cs.length);
        break;
      case "Return":
      case "KP_Enter":
        props.onSubmit?.();
        break;
      default: {
        if (!e.text) return;
        const typed = Array.from(e.text);
        edit([...cs.slice(0, at), ...typed, ...cs.slice(at)], at + typed.length);
      }
    }
    e.stop();
  };
  return node;
}
