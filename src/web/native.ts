// The Native interface in a browser: the page is the window, the tree is rendered as
// elements (dom/sync.ts) instead of draw commands, and page events become the same native events the
// desktop sends, so run()'s input system (hit testing on the boxes read back, focus, keys,
// overlays) behaves as it does there. The browser keeps what it does better: text editing in
// <input>, text selection, scrolling (wheel, touch, scrollbars).

import { layout } from "../render/layout.js";
import { invalidate } from "../render/node.js";
import { hasContextMenu } from "../runtime/input.js";
import type { Native, NativeEvent } from "../runtime/native.js";
import { decodedImage } from "./images.js";
import { keyEvent } from "./keys.js";
import { browserShortcut, fontRegistry, pageClipboard, webDiagnostics } from "./page.js";
import { createMeasurer } from "./text.js";
import { createCanvasPainter } from "../dom/painter.js";
import { BASE_CSS, type DomRenderer, createDomRenderer } from "../dom/sync.js";

const unsupported = (what: string) => () => {
  throw new Error(`nodebuilder: ${what} is not available on the web`);
};

/** The browser edits here: an <input>/<textarea> of a text field. */
const editable = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
/** Text the browser selects: a <Text selectable>. */
const selectable = (t: EventTarget | null) => t instanceof Element && !!t.closest(".nb-selectable");

export function createWebNative(container: HTMLElement): Native {
  const measure = createMeasurer();
  const images = new Map<number, HTMLCanvasElement>();
  let nextImage = 1;
  let renderer: DomRenderer | null = null;
  let emit: (ev: NativeEvent) => void = () => {};
  let detach = () => {};
  let clipboard: ReturnType<typeof pageClipboard> | null = null;
  const frame = () => requestAnimationFrame(() => emit({ type: "frame" }));

  return {
    open(options, onEvents) {
      if (!document.getElementById("nodebuilder-css")) {
        const style = document.createElement("style");
        style.id = "nodebuilder-css";
        style.textContent = BASE_CSS;
        document.head.append(style);
      }
      renderer = createDomRenderer(container, { painter: createCanvasPainter((id) => images.get(id)), scale: () => window.devicePixelRatio || 1 });
      emit = (ev) => onEvents([ev]);
      document.title = options.title;

      const configure = () => {
        const width = container.clientWidth, height = container.clientHeight;
        // "Maximized": the page is the window, so no resize edges or rounded corners.
        emit({ type: "configure", width, height, scale: window.devicePixelRatio || 1, maximized: true, activated: document.hasFocus(), transparent: false });
      };
      const resize = new ResizeObserver(configure);
      resize.observe(container);

      const pos = (e: MouseEvent) => {
        const r = container.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
      };
      const mods = (e: MouseEvent | KeyboardEvent) => ({ ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, super: e.metaKey });
      const listeners: [EventTarget, string, (e: any) => void, AddEventListenerOptions?][] = [
        // Moves and releases from the whole page, so a drag that leaves the root keeps going.
        [window, "pointermove", (e: PointerEvent) => emit({ type: "pointermove", ...pos(e), button: 0, ...mods(e) })],
        [container, "pointerdown", (e: PointerEvent) => emit({ type: "pointerdown", ...pos(e), button: e.button, ...mods(e) })],
        [window, "pointerup", (e: PointerEvent) => emit({ type: "pointerup", ...pos(e), button: e.button, ...mods(e) })],
        // A touch that turned into a scroll: no click, no hover left behind.
        [window, "pointercancel", () => emit({ type: "pointerleave" })],
        [container, "pointerleave", (e: PointerEvent) => e.buttons === 0 && emit({ type: "pointerleave" })],
        // The input system decides focus; the browser keeps it only for its text (fields, selection).
        [container, "mousedown", (e: MouseEvent) => !editable(e.target) && !selectable(e.target) && e.preventDefault()],
        // The browser's menu, unless the app opens its own there.
        [container, "contextmenu", (e: Event) => hasContextMenu(renderer?.nodeAt(e.target as Node) ?? null) && e.preventDefault()],
        // Activation without a pointer (a screen reader's click): the node's onClick.
        [container, "click", (e: MouseEvent) => {
          if (e.detail !== 0) return;
          const node = renderer?.nodeAt(e.target as Node);
          for (let n = node; n; n = n.parent) {
            if (n.handlers.onClick) {
              const at = { x: n.x, y: n.y, localX: 0, localY: 0, button: 0, clicks: 1, ctrl: false, shift: false, alt: false, meta: false, stop() {} };
              n.handlers.onClick(at);
              return;
            }
          }
        }],
        [window, "keydown", (e: KeyboardEvent) => {
          if (e.isComposing || e.key === "Dead" || e.key === "Unidentified" || browserShortcut(e)) return;
          const ev = keyEvent("keydown", e);
          emit(ev);
          if (editable(e.target)) {
            // The browser edits; only what moves the focus (Tab) or submits stays ours.
            if (e.key === "Tab" || (e.key === "Enter" && e.target instanceof HTMLInputElement && ev.handled)) e.preventDefault();
            return;
          }
          // Ctrl+V keeps its default: the paste event that follows brings the text.
          if (ev.handled && !((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v")) e.preventDefault();
        }],
        [window, "keyup", (e: KeyboardEvent) => emit(keyEvent("keyup", e))],
        // The browser focused something itself (a click in a field, a screen reader): tell the input system.
        [container, "focusin", (e: FocusEvent) => {
          const node = renderer?.nodeAt(e.target as Node);
          let root = node;
          while (root?.parent) root = root.parent;
          if (node?.focusable && root?.focusHost && root.focusHost.focused !== node) root.focusHost.setFocus(node);
        }],
        // A Scroll moved (wheel, touch, its scrollbar): read the boxes again.
        [container, "scroll", () => invalidate(), { capture: true, passive: true }],
        [window, "focus", configure],
        [window, "blur", configure],
      ];
      for (const [target, type, fn, opts] of listeners) target.addEventListener(type, fn, opts);
      clipboard = pageClipboard(emit);
      detach = () => {
        clipboard?.close();
        resize.disconnect();
        for (const [target, type, fn, opts] of listeners) target.removeEventListener(type, fn, opts);
      };
      configure();
      return "srgb";
    },
    close() {
      detach();
      renderer = null;
    },
    render() {
      throw new Error("nodebuilder: the DOM renderer draws trees (renderTree), not draw commands");
    },
    renderTree(root) {
      // For tools that inspect the page (layout parity checks, debugging).
      (window as { __nodebuilder?: unknown }).__nodebuilder = { root, renderer, layout };
      renderer?.render(root);
      frame();
    },
    hitTest: (x, y) => renderer?.hitTest(x, y) ?? null,
    measureText(text, size, font, _scale, letterSpacing = 0, spec = "") {
      return measure(text, size, font, letterSpacing, spec);
    },
    ...fontRegistry(),
    diagnostics: webDiagnostics,
    fontStats: () => ({ faces: 0, variations: 0, specs: 0, styles: 0, sizes: 0 }),
    renderOffscreen: unsupported("offscreen rendering"),
    createImage(width, height, rgba, space = "srgb") {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { colorSpace: space });
      const data = new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, width * height * 4).slice(), width, height, { colorSpace: space });
      ctx?.putImageData(data, 0, 0);
      const id = nextImage++;
      images.set(id, canvas);
      return id;
    },
    destroyImage: (id) => void images.delete(id),
    decodeImage: decodedImage,
    setCursor: (name) => void (container.style.cursor = name),
    setTitle: (title) => void (document.title = title),
    setVisible() {},
    setIcon() {},
    move() {},
    resize() {},
    setMaximized() {},
    minimize() {},
    requestFrame: frame,
    writeClipboard: (text) => clipboard?.write(text),
    readClipboard: () => (clipboard ? clipboard.read() : emit({ type: "clipboard", text: "" })),
  };
}
