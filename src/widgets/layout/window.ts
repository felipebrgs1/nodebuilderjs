import type { IconInput } from "../../image/icon.js";
import { type Child, insert } from "../../jsx-runtime.js";
import { windowControls, windowOptionsKey, windowState } from "../../runtime/app.js";
import { type Handlers, type Style, UINode, measureText } from "../../render/node.js";
import { type MaybeAccessor, createEffect } from "../../reactive/signals.js";
import { theme } from "../../theme.js";
import { Column, Divider, Row, Spacer } from "./containers.js";
import { type StyleProps, applyProps, interaction } from "../props.js";
import { Text } from "../text/text.js";

function WindowButton(props: { kind: "minimize" | "maximize" | "close"; onClick: () => void }) {
  const node = new UINode(`WindowButton(${props.kind})`);
  Object.assign(node.style, { width: 26, height: 26, radius: 13, cursor: "default" } satisfies Style);
  const state = interaction(node);
  node.handlers.onClick = props.onClick;
  createEffect(() => {
    node.ariaLabel = props.kind === "minimize" ? "Minimize" : props.kind === "close" ? "Close" : windowState.maximized() ? "Restore" : "Maximize";
  });
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

/** Minimize, maximize/restore and close buttons, for a custom title bar (`<Window decorations={false}>`). */
export function WindowControls(props: StyleProps & Handlers = {}) {
  const node = Row({ align: "center", gap: 10, ...props });
  node.label = "WindowControls";
  node.setSlot(node.addSlot(), [
    WindowButton({ kind: "minimize", onClick: windowControls.minimize }),
    WindowButton({ kind: "maximize", onClick: windowControls.toggleMaximize }),
    WindowButton({ kind: "close", onClick: windowControls.close }),
  ]);
  return node;
}

export function Window(
  props: StyleProps & Handlers & {
    /** Title bar and window list; an accessor follows changes. */
    title: MaybeAccessor<string>;
    width?: number;
    height?: number;
    appId?: string;
    /** Taskbar and switcher icon: SVG markup, or an .svg/PNG/JPEG/WebP file. Default: the framework's. */
    icon?: IconInput;
    onClose?: () => boolean | void;
    /** false: no built-in title bar; build your own with `dragRegion` and `<WindowControls />`. Border, corners and edge resizing stay. */
    decorations?: boolean;
    children?: Child;
  },
) {
  const node = new UINode("Window");
  (node as any)[windowOptionsKey] = props;
  // The window opens with the first value; later ones go to the compositor.
  if (typeof props.title === "function") {
    const title = props.title;
    createEffect<string>((prev) => {
      const next = title();
      if (prev !== undefined && next !== prev) windowControls.setTitle(next);
      return next;
    });
  }
  Object.assign(node.style, {
    direction: "column", borderWidth: 1, clip: true,
    padding: 1, // keep children (e.g. the titlebar divider) off the border
  } satisfies Style);
  if (props.background === undefined) createEffect(() => node.set("background", theme.window.background));
  if (props.borderColor === undefined) createEffect(() => node.set("borderColor", theme.window.border));
  createEffect(() => node.set("radius", windowState.maximized() || !windowState.transparent() ? 0 : theme.window.radius));

  const content = Column({ grow: 1, minHeight: 0 });
  insert(content, props.children);
  node.setSlot(node.addSlot(), props.decorations === false ? [content] : [Titlebar(props.title), Divider(), content]);
  // width/height are the window's initial size, not a style.
  const { width: _w, height: _h, ...style } = props;
  applyProps(node, style);
  return node;
}

function Titlebar(text: MaybeAccessor<string>) {
  const bar = new UINode("Titlebar");
  Object.assign(bar.style, {
    direction: "row", align: "center", height: theme.window.titlebarHeight, padding: [0, 10], gap: 8,
  } satisfies Style);
  bar.dragRegion = true;
  const title = Text({ text, bold: true });
  createEffect(() => title.set("color", windowState.activated() ? theme.text.primary : theme.text.secondary));
  // A growing left side balances the controls, so the title stays centred.
  const left = Spacer({});
  const right = Row({ grow: 1, justify: "end", align: "center" });
  right.setSlot(right.addSlot(), [WindowControls()]);
  bar.setSlot(bar.addSlot(), [left, title, right]);
  return bar;
}
