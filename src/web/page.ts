// The page's side of the web native core: browser shortcuts, the clipboard, app fonts and the
// app's files.

import { invalidate, textMetricsChanged } from "../render/node.js";
import type { Native, NativeEvent } from "../runtime/native.js";
import { browserDecoded, predecode } from "./images.js";
import { fileKey, files } from "./shims/fs.js";

/** Keys the browser keeps: reload, zoom, dev tools. */
export const browserShortcut = (e: KeyboardEvent) =>
  e.key === "F5" || e.key === "F12" || ((e.ctrlKey || e.metaKey) && (/^[rR0=+-]$/.test(e.key) || (e.shiftKey && /^[iIjJ]$/.test(e.key))));

/**
 * The clipboard for `emit`: Ctrl+V keeps its default, so the paste event that follows brings the
 * text (no permission prompt); readText() (which may prompt) only when none comes.
 */
export function pageClipboard(emit: (ev: NativeEvent) => void) {
  let pending: ReturnType<typeof setTimeout> | null = null;
  const onPaste = (e: ClipboardEvent) => {
    if (pending === null) return;
    clearTimeout(pending);
    pending = null;
    emit({ type: "clipboard", text: e.clipboardData?.getData("text/plain") ?? "" });
  };
  window.addEventListener("paste", onPaste);
  return {
    read() {
      pending = setTimeout(() => {
        pending = null;
        navigator.clipboard?.readText().then(
          (text) => emit({ type: "clipboard", text }),
          () => emit({ type: "clipboard", text: "" }),
        );
      }, 50);
    },
    write: (text: string) => void navigator.clipboard?.writeText(text).catch(() => {}),
    close: () => window.removeEventListener("paste", onPaste),
  };
}

/** registerFont on a page: a FontFace; text is measured and drawn again once it has loaded. */
export function fontRegistry(): Pick<Native, "registerFont" | "fontFamilies"> {
  const registered = new Set<string>();
  return {
    registerFont(bytes, family, weightMin, weightMax, italic) {
      if (!family) throw new Error("on the web, registerFont needs a family name ({ family })");
      const weight = weightMin ? (weightMax && weightMax !== weightMin ? `${weightMin} ${weightMax}` : `${weightMin}`) : "100 900";
      const face = new FontFace(family, bytes.slice().buffer, { weight, style: italic === 1 ? "italic" : "normal" });
      document.fonts.add(face);
      registered.add(family);
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
  };
}

/** Fetches the files listed in `assets.json` (written by `nodebuilder web`) into memory; images are decoded by the browser ahead of time. */
export async function loadAssets(manifest: string) {
  const list: string[] = await fetch(manifest).then((r) => (r.ok ? r.json() : []), () => []);
  await Promise.all(
    list.map(async (path) => {
      const res = await fetch(path);
      if (!res.ok) return;
      const bytes = new Uint8Array(await res.arrayBuffer());
      files.set(fileKey(path), bytes);
      if (browserDecoded(path)) await predecode(bytes);
    }),
  );
}

export const webDiagnostics = (): ReturnType<Native["diagnostics"]> => ({
  freetype: "", harfbuzz: "",
  display: { backend: "web", error: "", compose: false, locale: navigator.language },
  fonts: { ui: null, emoji: null, cjk: null },
  gl: null,
});
