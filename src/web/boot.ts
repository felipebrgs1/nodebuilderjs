// Starts an app in the browser: Node shims, the app's files in memory (images decoded by the
// browser ahead of time), and the web native core, which renders the tree as elements and CSS.
// `nodebuilder web` builds an entry that awaits boot() and then imports the app.

import "./globals.js";
import { setWindowFrame } from "../runtime/app.js";
import { useNative } from "../runtime/native.js";
import { setNativeText } from "../runtime/platform.js";
import { loadAssets } from "./page.js";
import { createWebNative } from "./native.js";

/** Fetches the app's files (`assets.json`, written by `nodebuilder web`) and installs the DOM native core on the page's root element. */
export async function boot(manifest = "./assets.json") {
  await loadAssets(manifest);
  let root = document.getElementById("nodebuilder");
  if (!root) {
    root = document.createElement("div");
    root.id = "nodebuilder";
    Object.assign(root.style, { position: "fixed", inset: "0" });
    document.body.append(root);
  }
  useNative(createWebNative(root));
  setWindowFrame(false); // the browser's tab and window are the frame
  setNativeText(true); // <input>, <textarea> and DOM selection
}
