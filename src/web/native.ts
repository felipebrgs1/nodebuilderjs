// The Native interface in a browser: a <canvas> instead of a window, WebGL instead of GLES2,
// Canvas2D text instead of FreeType + HarfBuzz, DOM events instead of Wayland/X11.

import { invalidate, textMetricsChanged } from "../render/node.js";
import type { Native, NativeEvent } from "../runtime/native.js";
import { createWebGLRenderer } from "./gl.js";
import { decodedImage } from "./images.js";
import { keyEvent } from "./keys.js";
import { createMeasurer } from "./text.js";

const unsupported = (what: string) => () => {
  throw new Error(`nodebuilder: ${what} is not available on the web`);
};

/** Keys the browser keeps: reload, zoom, dev tools. */
const browserShortcut = (e: KeyboardEvent) =>
  e.key === "F5" || e.key === "F12" || ((e.ctrlKey || e.metaKey) && (/^[rR0=+-]$/.test(e.key) || (e.shiftKey && /^[iIjJ]$/.test(e.key))));

/** DOM wheel deltas in px (lines and pages scaled like a browser would). */
function wheelDelta(e: WheelEvent, height: number): [number, number] {
  const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1;
  return [e.deltaX * k, e.deltaY * k];
}

export function createWebNative(canvas: HTMLCanvasElement): Native {
  const measure = createMeasurer();
  const registered = new Set<string>();
  let gl: ReturnType<typeof createWebGLRenderer> | null = null;
  let emit: (ev: NativeEvent) => void = () => {};
  let scale = 1;
  let detach = () => {};
  let readClipboard = () => emit({ type: "clipboard", text: "" }); // replaced by open()
  const frame = () => requestAnimationFrame(() => emit({ type: "frame" }));

  return {
    open(options, onEvents) {
      const ctx = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
      if (!ctx) throw new Error("nodebuilder: WebGL is not available");
      gl = createWebGLRenderer(ctx);
      emit = (ev) => onEvents([ev]);
      document.title = options.title; // the tab shows the <Window> title
      if (canvas.tabIndex < 0) canvas.tabIndex = 0;
      canvas.style.outline = "none";
      canvas.style.touchAction = "none";

      const configure = () => {
        scale = window.devicePixelRatio || 1;
        const width = canvas.clientWidth, height = canvas.clientHeight;
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        // "Maximized": the page is the window, so no resize edges or rounded corners.
        emit({ type: "configure", width, height, scale, maximized: true, activated: document.hasFocus(), transparent: false });
      };
      const resize = new ResizeObserver(configure);
      resize.observe(canvas);
      const dpr = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      dpr.addEventListener("change", configure);

      const pos = (e: MouseEvent) => {
        const r = canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
      };
      const mods = (e: MouseEvent | KeyboardEvent) => ({ ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, super: e.metaKey });
      const listeners: [EventTarget, string, (e: any) => void, AddEventListenerOptions?][] = [
        [canvas, "pointermove", (e: PointerEvent) => emit({ type: "pointermove", ...pos(e), button: 0, ...mods(e) })],
        [canvas, "pointerdown", (e: PointerEvent) => {
          canvas.focus();
          canvas.setPointerCapture(e.pointerId);
          emit({ type: "pointerdown", ...pos(e), button: e.button, ...mods(e) });
        }],
        [canvas, "pointerup", (e: PointerEvent) => emit({ type: "pointerup", ...pos(e), button: e.button, ...mods(e) })],
        [canvas, "pointerleave", () => emit({ type: "pointerleave" })],
        [canvas, "contextmenu", (e: Event) => e.preventDefault()],
        [canvas, "wheel", (e: WheelEvent) => {
          e.preventDefault();
          const [dx, dy] = wheelDelta(e, canvas.clientHeight);
          emit({ type: "scroll", ...pos(e), dx, dy, ...mods(e) });
        }, { passive: false }],
        [canvas, "keydown", (e: KeyboardEvent) => {
          if (e.isComposing || e.key === "Dead" || e.key === "Unidentified" || browserShortcut(e)) return;
          // Ctrl+V keeps its default: the browser follows it with a paste event (no permission prompt).
          if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v")) e.preventDefault();
          emit(keyEvent("keydown", e));
        }],
        [canvas, "keyup", (e: KeyboardEvent) => emit(keyEvent("keyup", e))],
        [window, "paste", (e: ClipboardEvent) => pasted(e.clipboardData?.getData("text/plain") ?? "")],
        [window, "focus", configure],
        [window, "blur", configure],
      ];
      for (const [target, type, fn, opts] of listeners) target.addEventListener(type, fn, opts);
      detach = () => {
        resize.disconnect();
        dpr.removeEventListener("change", configure);
        for (const [target, type, fn] of listeners) target.removeEventListener(type, fn);
      };

      // Ctrl+V: the app asks for the clipboard right after the key; the text comes with the paste
      // event that follows, or from readText() (which may prompt) when none comes.
      let pendingRead: ReturnType<typeof setTimeout> | null = null;
      const pasted = (text: string) => {
        if (pendingRead === null) return;
        clearTimeout(pendingRead);
        pendingRead = null;
        emit({ type: "clipboard", text });
      };
      readClipboard = () => {
        pendingRead = setTimeout(() => {
          pendingRead = null;
          navigator.clipboard?.readText().then(
            (text) => emit({ type: "clipboard", text }),
            () => emit({ type: "clipboard", text: "" }),
          );
        }, 50);
      };

      configure();
      return "srgb";
    },
    close() {
      detach();
      gl = null;
    },
    render(commands, texts) {
      if (!gl) return;
      gl.renderer.frame(canvas.width, canvas.height, scale, commands, texts);
      frame(); // the "frame callback": the browser shows this frame at the next vblank
    },
    measureText(text, size, font, _scale, letterSpacing = 0, spec = "") {
      return measure(text, size, font, letterSpacing, spec);
    },
    registerFont(bytes, family, weightMin, weightMax, italic) {
      if (!family) throw new Error("on the web, registerFont needs a family name ({ family })");
      const weight = weightMin ? (weightMax && weightMax !== weightMin ? `${weightMin} ${weightMax}` : `${weightMin}`) : "100 900";
      const face = new FontFace(family, bytes.slice().buffer, { weight, style: italic === 1 ? "italic" : "normal" });
      document.fonts.add(face);
      registered.add(family);
      // Loads asynchronously: measure and draw the text again once it can be used.
      face.load().then(
        () => {
          textMetricsChanged();
          invalidate();
        },
        (err) => console.error(`nodebuilder: registerFont ${family}: ${err}`),
      );
      return [{ family, weightMin: weightMin || 100, weightMax: weightMax || weightMin || 900, italic: italic === 1, variable: false }];
    },
    fontFamilies: () => [...registered, "system-ui", "sans-serif", "serif", "monospace"],
    diagnostics: () => ({
      freetype: "", harfbuzz: "",
      display: { backend: "web", error: "", compose: false, locale: navigator.language },
      fonts: { ui: null, emoji: null, cjk: null },
      gl: null,
    }),
    fontStats: () => ({ faces: 0, variations: 0, specs: 0, styles: 0, sizes: 0 }),
    renderOffscreen: unsupported("offscreen rendering"),
    createImage(width, height, rgba, space = "srgb") {
      if (!gl) throw new Error("nodebuilder: createImage before open");
      return gl.createImage(width, height, rgba, space);
    },
    destroyImage: (id) => gl?.destroyImage(id),
    decodeImage: decodedImage,
    setCursor: (name) => void (canvas.style.cursor = name),
    setTitle: (title) => void (document.title = title),
    setVisible() {},
    setIcon() {},
    move() {},
    resize() {},
    setMaximized() {},
    minimize() {},
    requestFrame: frame,
    writeClipboard: (text) => void navigator.clipboard?.writeText(text).catch(() => {}),
    readClipboard: () => readClipboard(),
  };
}
