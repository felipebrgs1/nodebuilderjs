// Starts an app in the browser: Node shims, the app's files in memory (images decoded by the
// browser ahead of time), the web native core.
// `nodebuilder web` builds an entry that awaits boot() and then imports the app.

import "./globals.js";
import { setWindowFrame } from "../runtime/app.js";
import { useNative } from "../runtime/native.js";
import { browserDecoded, predecode } from "./images.js";
import { createWebNative } from "./native.js";
import { fileKey, files } from "./shims/fs.js";

/** Fetches the files listed in `assets.json` (written by `nodebuilder web`) and installs the native core on the page's canvas. */
export async function boot(manifest = "./assets.json") {
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
  let canvas = document.querySelector<HTMLCanvasElement>("canvas#nodebuilder");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "nodebuilder";
    Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100%", height: "100%" });
    document.body.append(canvas);
  }
  useNative(createWebNative(canvas));
  setWindowFrame(false); // the browser's tab and window are the frame
}
