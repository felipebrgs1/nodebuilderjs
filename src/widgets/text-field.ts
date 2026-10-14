import { edges } from "../render/layout.js";
import { type Color, type FontStyle, type Handlers, type Style, UINode, invalidate, measureText } from "../render/node.js";
import { type Accessor, type MaybeAccessor, createEffect, createSignal, onCleanup, read, untrack } from "../reactive/signals.js";
import { clipboard } from "../runtime/clipboard.js";
import { theme } from "../theme.js";
import { type StyleProps, applyProps, disableable, inherited, inheritedFont, interaction, ownHandler } from "./props.js";

export function TextField(
  props: StyleProps & Handlers & {
    value: Accessor<string>;
    onInput: (value: string) => void;
    onSubmit?: () => void;
    placeholder?: MaybeAccessor<string>;
    disabled?: MaybeAccessor<boolean>;
    /** Draws every character as "•" (the value itself stays real). Reactive, for a "show password" toggle. */
    password?: MaybeAccessor<boolean>;
    /** Border color while focused. Default: the theme's focus color, unless `borderColor` is given (then it stays). */
    focusBorderColor?: MaybeAccessor<Color>;
    /** Border width while focused. Default: 2, unless `borderWidth` is given (then it stays). */
    focusBorderWidth?: MaybeAccessor<number>;
  },
) {
  const node = new UINode("TextField");
  Object.assign(node.style, {
    padding: [9, 12], radius: theme.radius, minWidth: 80,
  } satisfies Style);
  // The app's border wins; the focus ring is an override on top of whatever the base is.
  if (props.borderWidth === undefined) node.style.borderWidth = 1;
  if (props.borderColor === undefined) createEffect(() => node.set("borderColor", theme.field.border));
  if (props.background === undefined) createEffect(() => node.set("background", theme.field.background));
  applyProps(node, props);
  disableable(node, props, "text");
  const state = interaction(node);

  const chars = () => Array.from(props.value());
  /** The characters drawn: the value, or one "•" per character for a password. */
  const shownChars = () => (read(props.password ?? false) ? chars().map(() => "•") : chars());
  node.field = {
    value: () => props.value(),
    shown: () => shownChars().join(""),
    placeholder: () => (props.placeholder === undefined ? undefined : read(props.placeholder)),
  };
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
    const width = props.focusBorderWidth !== undefined ? read(props.focusBorderWidth) : props.borderWidth === undefined ? 2 : undefined;
    const color = props.focusBorderColor !== undefined ? read(props.focusBorderColor) : props.borderColor === undefined ? theme.field.focus : undefined;
    node.override("borderWidth", focused ? width : undefined);
    node.override("borderColor", focused ? color : undefined);
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
  let lastFont: FontStyle | undefined;
  const face = () => (lastFont = inheritedFont(node, lastFont));
  const widthOf = (s: string) => measureText(s, size(), face()).width;

  node.measure = () => {
    const m = measureText("Ag", size(), face());
    return { width: 160, height: Math.ceil(m.ascent + m.descent) };
  };

  node.paint = (p, n) => {
    const [pt, pr, pb, pl] = edges(n.style.padding);
    const innerX = n.x + pl;
    const innerW = n.width - pl - pr;
    const value = shownChars().join("");
    const before = shownChars().slice(0, caret()).join("");
    const caretX = widthOf(before);
    if (caretX - scrollX > innerW - 2) scrollX = caretX - innerW + 2;
    if (caretX - scrollX < 0) scrollX = caretX;
    if (widthOf(value) - scrollX < innerW) scrollX = Math.max(0, widthOf(value) - innerW + 2);

    p.clip(innerX - 1, n.y, innerW + 2, n.height);
    if (value) p.text(innerX - scrollX, n.y + pt, value, size(), inherited(n, "color") ?? theme.text.primary, face());
    else if (props.placeholder) p.text(innerX, n.y + pt, read(props.placeholder), size(), theme.field.placeholder, face());
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

  ownHandler(node, "onPointerDown", (e) => {
    const [, , , pl] = edges(node.style.padding);
    const x = e.x - node.x - pl + scrollX;
    const cs = shownChars();
    let best = 0;
    for (let i = 1; i <= cs.length; i++) {
      const w = widthOf(cs.slice(0, i).join(""));
      const prevW = widthOf(cs.slice(0, i - 1).join(""));
      if (x > (prevW + w) / 2) best = i;
      else break;
    }
    setCaret(best);
    restartBlink();
  });

  // Single line: breaks and tabs become spaces, other control characters go away.
  const paste = async () => {
    const text = (await clipboard.readText()).replace(/\r\n|[\r\n\t]/g, " ").replace(/[\x00-\x1f\x7f]/g, "");
    if (!text) return;
    const cs = chars(); // the value may have changed while waiting for the clipboard
    const at = Math.min(untrack(caret), cs.length);
    const pasted = Array.from(text);
    edit([...cs.slice(0, at), ...pasted, ...cs.slice(at)], at + pasted.length);
  };

  ownHandler(node, "onKeyDown", (e) => {
    const cs = chars();
    const at = Math.min(caret(), cs.length);
    if ((e.ctrl && (e.key === "v" || e.key === "V")) || (e.shift && e.key === "Insert")) {
      void paste();
      return e.stop();
    }
    switch (e.key) {
      case "BackSpace":
        if (at > 0) edit([...cs.slice(0, at - 1), ...cs.slice(at)], at - 1);
        break;
      case "Delete":
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
        props.onSubmit?.();
        break;
      default: {
        if (!e.text) return;
        const typed = Array.from(e.text);
        edit([...cs.slice(0, at), ...typed, ...cs.slice(at)], at + typed.length);
      }
    }
    e.stop();
  });
  return node;
}
