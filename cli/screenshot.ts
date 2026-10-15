// `nodebuilder screenshot <app.tsx> <out.png>`: runs the app with NB_SCREENSHOT set, so its
// run() renders one frame offscreen to a PNG instead of opening a window (src/runtime/app.ts),
// then exits. Needs no display server: works in CI, containers and agent sandboxes.
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

export const SCREENSHOT_USAGE = `usage: nodebuilder screenshot <app.tsx> <out.png> [options] [-- app arguments]

  --width <px>        logical width (default: the <Window>'s width, or 800)
  --height <px>       logical height (default: the <Window>'s height, or 600)
  --scale <n>         device scale; 2 renders a HiDPI image twice the size (default 1)
  --theme <name>      light or dark (default: whatever the app sets)
  --color-space <cs>  srgb or display-p3: P3 keeps colors past sRGB and tags the PNG (default srgb)
  --wait-frames <n>   frames (16 ms of simulated time each) to run before the shot
                      (default: until animations finish, at most 120)
  --props <json>      render the component the file exports (default export) with these
                      props, e.g. '{"page":"settings"}'; the file must not call run() itself.
                      A file that does not call run() gets its default export rendered anyway
  --export <name>     render this named export instead of the default one

Arguments after -- go to the app (process.argv.slice(2)), e.g. -- --vault ./notes.
Inside, isScreenshot() from @nodebuilderjs/core is true (the app can skip real files or
the network and show sample data).`;

export function screenshotCommand(argv: string[]) {
  const dashes = argv.indexOf("--");
  const appArgs = dashes < 0 ? [] : argv.slice(dashes + 1);
  const { values: opts, positionals } = parseArgs({
    args: dashes < 0 ? argv : argv.slice(0, dashes),
    allowPositionals: true,
    options: {
      width: { type: "string" },
      height: { type: "string" },
      scale: { type: "string" },
      theme: { type: "string" },
      "color-space": { type: "string" },
      "wait-frames": { type: "string" },
      props: { type: "string" },
      export: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (opts.help) {
    console.log(SCREENSHOT_USAGE);
    return;
  }
  const [app, out] = positionals;
  if (!app || !out) {
    console.error(SCREENSHOT_USAGE);
    process.exit(1);
  }
  if (opts.props !== undefined) {
    try {
      const props = JSON.parse(opts.props);
      if (typeof props !== "object" || props === null || Array.isArray(props)) throw new Error("not an object");
    } catch (err) {
      console.error(`nodebuilder screenshot: --props must be a JSON object (${(err as Error).message})`);
      process.exit(1);
    }
  }
  const path = resolve(out);
  rmSync(path, { force: true }); // so a stale file is never taken for this run's output
  const env: Record<string, string | undefined> = { ...process.env, NB_SCREENSHOT: path };
  const pass = { WIDTH: opts.width, HEIGHT: opts.height, SCALE: opts.scale, THEME: opts.theme, FRAMES: opts["wait-frames"], COLOR_SPACE: opts["color-space"] };
  for (const [name, value] of Object.entries(pass)) if (value !== undefined) env[`NB_SCREENSHOT_${name}`] = value;
  // With --props/--export, a runner imports the file and renders the component it exports.
  const component = opts.props !== undefined || opts.export !== undefined;
  const runner = { NB_SCREENSHOT_ENTRY: resolve(app), NB_SCREENSHOT_PROPS: opts.props ?? "{}", NB_SCREENSHOT_EXPORT: opts.export ?? "" };
  const spawn = (script: string, extra: Record<string, string> = {}) => {
    const child = spawnSync(process.execPath, [script, ...appArgs], { env: { ...env, ...extra }, stdio: "inherit", timeout: 60_000 });
    if (child.error) {
      console.error(`nodebuilder screenshot: ${child.error.message}`);
      process.exit(1);
    }
    if (child.status !== 0) process.exit(child.status ?? 1);
  };
  const entry = join(import.meta.dir, "screenshot-entry.ts");
  spawn(component ? entry : resolve(app), component ? runner : {});
  // A file that only exports a component (a page in a given state, made for the shot): its
  // default export, as with --props '{}'.
  if (!component && !existsSync(path)) spawn(entry, { ...runner, NB_SCREENSHOT_FALLBACK: "1" });
  if (!existsSync(path)) {
    console.error(`nodebuilder screenshot: ${app} exited without calling run(), so nothing was rendered`);
    process.exit(1);
  }
}
