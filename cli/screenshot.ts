// `nodebuilder screenshot <app.tsx> <out.png>`: runs the app with NB_SCREENSHOT set, so its
// run() renders one frame offscreen to a PNG instead of opening a window (src/runtime/app.ts),
// then exits. Needs no display server: works in CI, containers and agent sandboxes.
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

export const SCREENSHOT_USAGE = `usage: nodebuilder screenshot <app.tsx> <out.png> [options]

  --width <px>        logical width (default: the <Window>'s width, or 800)
  --height <px>       logical height (default: the <Window>'s height, or 600)
  --scale <n>         device scale; 2 renders a HiDPI image twice the size (default 1)
  --theme <name>      light or dark (default: whatever the app sets)
  --wait-frames <n>   frames (16 ms of simulated time each) to run before the shot
                      (default: until animations finish, at most 120)`;

export function screenshotCommand(argv: string[]) {
  const { values: opts, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      width: { type: "string" },
      height: { type: "string" },
      scale: { type: "string" },
      theme: { type: "string" },
      "wait-frames": { type: "string" },
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
  const path = resolve(out);
  rmSync(path, { force: true }); // so a stale file is never taken for this run's output
  const env: Record<string, string | undefined> = { ...process.env, NB_SCREENSHOT: path };
  const pass = { WIDTH: opts.width, HEIGHT: opts.height, SCALE: opts.scale, THEME: opts.theme, FRAMES: opts["wait-frames"] };
  for (const [name, value] of Object.entries(pass)) if (value !== undefined) env[`NB_SCREENSHOT_${name}`] = value;
  const child = spawnSync(process.execPath, [resolve(app)], { env, stdio: "inherit", timeout: 60_000 });
  if (child.error) {
    console.error(`nodebuilder screenshot: ${child.error.message}`);
    process.exit(1);
  }
  if (child.status !== 0) process.exit(child.status ?? 1);
  if (!existsSync(path)) {
    console.error(`nodebuilder screenshot: ${app} exited without calling run(), so nothing was rendered`);
    process.exit(1);
  }
}
