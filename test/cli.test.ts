// The `nodebuilder` command, spawned as a user would run it (each spawn costs ~100-300 ms).
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeImage } from "../src/image/decode.js";
import { canScreenshot } from "../src/testing.js";

const repo = join(import.meta.dir, "..");
const cli = join(repo, "cli/nodebuilder.ts");
const dir = mkdtempSync(join(tmpdir(), "nb-cli-"));
afterAll(() => rmSync(dir, { recursive: true }));

/** Runs the CLI with no display server, as in CI or a container. */
function nodebuilder(...args: string[]) {
  const env = { ...process.env };
  delete env.WAYLAND_DISPLAY;
  delete env.DISPLAY;
  const p = Bun.spawnSync([process.execPath, cli, ...args], { cwd: dir, env });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}

test.skipIf(!canScreenshot())("screenshot: runs the app without a window and writes its PNG", () => {
  writeFileSync(
    join(dir, "app.ts"),
    `import { jsx } from ${JSON.stringify(join(repo, "src/jsx-runtime.ts"))};
     import { Box, Column, run } from ${JSON.stringify(join(repo, "src/index.ts"))};
     run(() => jsx(Column, { background: "#ffffff", children: jsx(Box, { height: 20, background: "#ff0000" }) }));`,
  );
  const r = nodebuilder("screenshot", "app.ts", "shot.png", "--width", "60", "--height", "40", "--scale", "2");
  expect(r.err).toBe("");
  expect(r.code).toBe(0);
  expect(r.out).toContain("shot.png");
  const png = decodeImage(new Uint8Array(readFileSync(join(dir, "shot.png"))));
  expect([png.width, png.height]).toEqual([120, 80]);
  const px = (x: number, y: number) => Array.from(png.data.subarray((y * 120 + x) * 4, (y * 120 + x) * 4 + 4));
  expect(px(10, 10)).toEqual([255, 0, 0, 255]);
  expect(px(10, 60)).toEqual([255, 255, 255, 255]);
});

test("screenshot: an app that never calls run() is an error, and so are missing arguments", () => {
  writeFileSync(join(dir, "norun.ts"), "export {};\n");
  const r = nodebuilder("screenshot", "norun.ts", "never.png");
  expect(r.code).toBe(1);
  expect(r.err).toContain("run()");
  expect(existsSync(join(dir, "never.png"))).toBe(false);
  const usage = nodebuilder("screenshot");
  expect(usage.code).toBe(1);
  expect(usage.err).toContain("nodebuilder screenshot <app.tsx> <out.png>");
});
