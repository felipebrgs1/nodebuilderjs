import { edges } from "../render/layout.js";
import { type FontStyle, UINode, invalidate, measureText } from "../render/node.js";
import { type MaybeAccessor, createEffect, read } from "../reactive/signals.js";
import { theme } from "../theme.js";
import { inherited, inheritedFont, ownHandler } from "./props.js";
import { type EditableProps, editKey, editable } from "./text-edit.js";
import { boundaryAt, charAt, charEdges } from "./text-selection.js";

export function TextField(
  props: EditableProps & {
    /** Return. */
    onSubmit?: () => void;
    /** Draws every character as "•" (the value itself stays real). Reactive, for a "show password" toggle. */
    password?: MaybeAccessor<boolean>;
  },
) {
  const node = new UINode("TextField");
  node.style.minWidth = 80;
  const { state, session, blinkOn, version } = editable(node, props);
  /** Value or masked; what is drawn and what positions on screen refer to. */
  const secret = () => read(props.password ?? false);
  const shownChars = () => (secret() ? session.chars.map(() => "•") : session.chars);
  node.field = {
    value: () => props.value(),
    shown: () => shownChars().join(""),
    placeholder: () => (props.placeholder === undefined ? undefined : read(props.placeholder)),
  };
  let scrollX = 0;
  createEffect(() => {
    blinkOn();
    version();
    invalidate();
  });

  const size = () => inherited(node, "fontSize") ?? theme.font.size;
  let lastFont: FontStyle | undefined;
  const face = () => (lastFont = inheritedFont(node, lastFont));
  const widthOf = (s: string) => measureText(s, size(), face()).width;
  /** x of every boundary between the shown characters, kept until the text or the font changes. */
  let edgesFor = { shown: "", size: 0, face: undefined as FontStyle | undefined, xs: [0] };
  const xs = () => {
    const shown = shownChars().join("");
    if (edgesFor.shown !== shown || edgesFor.size !== size() || edgesFor.face !== face()) {
      edgesFor = { shown, size: size(), face: face(), xs: charEdges(shownChars(), widthOf) };
    }
    return edgesFor.xs;
  };

  node.measure = () => {
    const m = measureText("Ag", size(), face());
    return { width: 160, height: Math.ceil(m.ascent + m.descent) };
  };

  node.paint = (p, n) => {
    const [pt, pr, pb, pl] = edges(n.style.padding);
    const innerX = n.x + pl;
    const innerW = n.width - pl - pr;
    const value = shownChars().join("");
    const edgeXs = xs();
    const total = edgeXs[edgeXs.length - 1]!;
    const caretX = edgeXs[session.focus] ?? total;
    if (caretX - scrollX > innerW - 2) scrollX = caretX - innerW + 2;
    if (caretX - scrollX < 0) scrollX = caretX;
    if (total - scrollX < innerW) scrollX = Math.max(0, total - innerW + 2);

    p.clip(innerX - 1, n.y, innerW + 2, n.height);
    const [a, b] = session.range();
    if (a !== b && state.focused()) p.rect(innerX + edgeXs[a]! - scrollX, n.y + pt, edgeXs[b]! - edgeXs[a]!, n.height - pt - pb, theme.selection);
    if (value) p.text(innerX - scrollX, n.y + pt, value, size(), inherited(n, "color") ?? theme.text.primary, face());
    else if (props.placeholder) p.text(innerX, n.y + pt, read(props.placeholder), size(), theme.field.placeholder, face());
    if (state.focused() && blinkOn() && a === b) {
      p.rect(Math.round(innerX + caretX - scrollX), n.y + pt, 1.5, n.height - pt - pb, theme.field.focus);
    }
    p.unclip();
  };

  /** The boundary under a window x. */
  const boundary = (x: number) => boundaryAt(xs(), x - node.x - edges(node.style.padding)[3] + scrollX);
  let dragging = false;
  ownHandler(node, "onPointerDown", (e) => {
    if (e.button !== 0) return;
    const at = boundary(e.x);
    dragging = e.clicks === 1;
    if (e.clicks >= 3) session.select(0, session.chars.length);
    else if (e.clicks === 2) session.selectWord(charAt(xs(), e.x - node.x - edges(node.style.padding)[3] + scrollX));
    else session.moveTo(at, e.shift);
  });
  ownHandler(node, "onPointerMove", (e) => {
    if (dragging && e.button === 0) session.moveTo(boundary(e.x), true);
  });
  ownHandler(node, "onPointerUp", () => {
    dragging = false;
  });

  ownHandler(node, "onKeyDown", (e) => {
    if (editKey(session, e, { secret: secret(), onSubmit: props.onSubmit })) e.stop();
  });
  return node;
}
