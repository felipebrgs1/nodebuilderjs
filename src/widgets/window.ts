import { type Child, insert } from "../jsx-runtime.js";
import { windowControls, windowOptionsKey, windowState } from "../runtime/app.js";
import { type Style, UINode, measureText } from "../render/node.js";
import { createEffect } from "../reactive/signals.js";
import { theme } from "../theme.js";
import { Column, Divider, Row, Spacer } from "./containers.js";
import { type StyleProps, applyProps, interaction } from "./props.js";
import { Text } from "./text.js";

function WindowButton(props: { kind: "minimize" | "maximize" | "close"; onClick: () => void }) {
  const node = new UINode(`WindowButton(${props.kind})`);
  Object.assign(node.style, { width: 26, height: 26, radius: 13, cursor: "default" } satisfies Style);
  const state = interaction(node);
  node.handlers.onClick = props.onClick;
  createEffect(() =>
    node.set("background", state.pressed() ? theme.control.pressed : state.hovered() ? theme.control.hover : theme.control.base),
  );
  node.paint = (p, n) => {
    const cx = n.x + n.width / 2;
    const cy = n.y + n.height / 2;
    const ink = theme.text.primary;
    if (props.kind === "minimize") p.rect(cx - 5, cy + 3, 10, 1.5, ink, 0.75);
    else if (props.kind === "maximize") p.rect(cx - 5, cy - 5, 10, 10, "#00000000", 1.5, 1.5, ink);
    else {
      // "×" drawn as a glyph keeps the core free of line primitives for now.
      const m = measureText("×", 18);
      p.text(cx - m.width / 2, cy - (m.ascent + m.descent) / 2, "×", 18, ink);
    }
  };
  return node;
}

export function Window(
  props: StyleProps & {
    title: string;
    width?: number;
    height?: number;
    appId?: string;
    onClose?: () => boolean | void;
    children?: Child;
  },
) {
  const node = new UINode("Window");
  (node as any)[windowOptionsKey] = props;
  Object.assign(node.style, {
    direction: "column", borderWidth: 1, clip: true,
    padding: 1, // keep children (e.g. the titlebar divider) off the border
  } satisfies Style);
  if (props.background === undefined) createEffect(() => node.set("background", theme.window.background));
  if (props.borderColor === undefined) createEffect(() => node.set("borderColor", theme.window.border));
  createEffect(() => node.set("radius", windowState.maximized() || !windowState.transparent() ? 0 : theme.window.radius));

  const bar = new UINode("Titlebar");
  Object.assign(bar.style, {
    direction: "row", align: "center", height: theme.window.titlebarHeight, padding: [0, 10], gap: 8,
  } satisfies Style);
  bar.dragRegion = true;
  bar.handlers.onPointerDown = (e) => {
    if (e.clicks === 2) {
      windowControls.toggleMaximize();
      e.stop();
    }
  };
  const title = Text({ text: props.title, bold: true });
  createEffect(() => title.set("color", windowState.activated() ? theme.text.primary : theme.text.secondary));
  const left = Spacer({});
  const right = Row({ grow: 1, justify: "end", gap: 10, align: "center" });
  right.setSlot(right.addSlot(), [
    WindowButton({ kind: "minimize", onClick: windowControls.minimize }),
    WindowButton({ kind: "maximize", onClick: windowControls.toggleMaximize }),
    WindowButton({ kind: "close", onClick: windowControls.close }),
  ]);
  // Balance the left side so the title stays centred.
  left.style.grow = 1;
  bar.setSlot(bar.addSlot(), [left, title, right]);

  const content = Column({ grow: 1, minHeight: 0 });
  insert(content, props.children);

  node.setSlot(node.addSlot(), [bar, Divider(), content]);
  // width/height are the window's initial size, not a style.
  const { width: _w, height: _h, ...style } = props;
  applyProps(node, style);
  return node;
}
