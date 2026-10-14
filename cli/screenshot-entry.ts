// Run by `nodebuilder screenshot --props/--export`, and for a file that neither calls run() nor
// is given those flags (NB_SCREENSHOT_FALLBACK): renders a component the entry module
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
  if (process.env.NB_SCREENSHOT_FALLBACK) {
    console.error(
      `nodebuilder screenshot: ${entry} exited without calling run() and has no default export to render: ` +
        `call run(), export a component as default${found.length ? `, or pick one with --export <name> (it exports: ${found.join(", ")})` : ", or pick one with --export <name>"}`,
    );
    process.exit(1);
  }
  console.error(`nodebuilder screenshot: ${entry} has no exported component "${name}"${found.length ? ` (it exports: ${found.join(", ")})` : ""}`);
  process.exit(1);
}
run(() => jsx(component as (p: Record<string, unknown>) => never, props));
