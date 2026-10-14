// Run by `nodebuilder screenshot --props/--export`: renders a component the entry module
// exports (default unless NB_SCREENSHOT_EXPORT names another) with the props in
// NB_SCREENSHOT_PROPS (JSON), through run(), which takes the shot (NB_SCREENSHOT).
import { pathToFileURL } from "node:url";
import { run } from "../src/index.js";
import { jsx } from "../src/jsx-runtime.js";

const entry = process.env.NB_SCREENSHOT_ENTRY!;
const name = process.env.NB_SCREENSHOT_EXPORT || "default";
const props = JSON.parse(process.env.NB_SCREENSHOT_PROPS || "{}") as Record<string, unknown>;
const mod = (await import(pathToFileURL(entry).href)) as Record<string, unknown>;
const component = mod[name];
if (typeof component !== "function") {
  const found = Object.keys(mod).filter((k) => typeof mod[k] === "function");
  console.error(`nodebuilder screenshot: ${entry} has no exported component "${name}"${found.length ? ` (it exports: ${found.join(", ")})` : ""}`);
  process.exit(1);
}
run(() => jsx(component as (p: Record<string, unknown>) => never, props));
