// The `nodebuilder` command, spawned as a user would run it (each spawn costs ~100-300 ms),
// and its building blocks called directly where a spawn per case would be slow.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addIcons } from "../cli/icons.js";
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

test.skipIf(!canScreenshot())("screenshot --props: renders the entry's exported component with those props", () => {
  writeFileSync(
    join(dir, "page.ts"),
    `import { jsx } from ${JSON.stringify(join(repo, "src/jsx-runtime.ts"))};
     import { Box, Column } from ${JSON.stringify(join(repo, "src/index.ts"))};
     export default function App(props: { color: string }) {
       return jsx(Column, { background: "#ffffff", children: jsx(Box, { height: 20, background: props.color }) });
     }
     export function Other() {
       return jsx(Box, { grow: 1, background: "#0000ff" });
     }`,
  );
  const r = nodebuilder("screenshot", "page.ts", "props.png", "--width", "30", "--height", "30", "--props", '{"color":"#00ff00"}');
  expect(r.err).toBe("");
  expect(r.code).toBe(0);
  const png = decodeImage(new Uint8Array(readFileSync(join(dir, "props.png"))));
  expect(Array.from(png.data.subarray((5 * 30 + 5) * 4, (5 * 30 + 5) * 4 + 4))).toEqual([0, 255, 0, 255]);
  const named = nodebuilder("screenshot", "page.ts", "named.png", "--width", "10", "--height", "10", "--export", "Other");
  expect(named.code).toBe(0);
  const blue = decodeImage(new Uint8Array(readFileSync(join(dir, "named.png"))));
  expect(Array.from(blue.data.subarray(0, 4))).toEqual([0, 0, 255, 255]);
  const bad = nodebuilder("screenshot", "page.ts", "bad.png", "--props", "{nope");
  expect(bad.code).toBe(1);
  expect(bad.err).toContain("--props");
  const missing = nodebuilder("screenshot", "page.ts", "bad.png", "--export", "Nope");
  expect(missing.code).toBe(1);
  expect(missing.err).toContain("Nope");
});

test.skipIf(!canScreenshot())("screenshot: arguments after -- reach the app's process.argv, and isScreenshot() is true there", () => {
  const seen = join(dir, "argv.json");
  const app = (name: string, body: string) =>
    writeFileSync(
      join(dir, name),
      `import { writeFileSync } from "node:fs";
       import { jsx } from ${JSON.stringify(join(repo, "src/jsx-runtime.ts"))};
       import { Box, isScreenshot, run } from ${JSON.stringify(join(repo, "src/index.ts"))};
       const record = () => writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ args: process.argv.slice(2), shot: isScreenshot() }));
       ${body}`,
    );
  app("argv-app.ts", `record(); run(() => jsx(Box, { grow: 1 }));`);
  const r = nodebuilder("screenshot", "argv-app.ts", "argv.png", "--width", "10", "--height", "10", "--", "--vault", "/tmp/notes");
  expect(r.err).toBe("");
  expect(JSON.parse(readFileSync(seen, "utf8"))).toEqual({ args: ["--vault", "/tmp/notes"], shot: true });
  // A component rendered with --props sees them too.
  app("argv-page.ts", `export default function Page() { record(); return jsx(Box, { grow: 1 }); }`);
  const p = nodebuilder("screenshot", "argv-page.ts", "argv-page.png", "--props", "{}", "--width", "10", "--height", "10", "--", "x");
  expect(p.err).toBe("");
  expect(JSON.parse(readFileSync(seen, "utf8"))).toEqual({ args: ["x"], shot: true });
});

test("isScreenshot() is false outside `nodebuilder screenshot`", async () => {
  const { isScreenshot } = await import("../src/index.js");
  expect(isScreenshot()).toBe(!!process.env.NB_SCREENSHOT);
});

test("screenshot: a file that only exports a component (no run()) renders its default export", () => {
  writeFileSync(
    join(dir, "shot-only.ts"),
    `import { jsx } from ${JSON.stringify(join(repo, "src/jsx-runtime.ts"))};
     import { Box } from ${JSON.stringify(join(repo, "src/index.ts"))};
     export default function Shot() {
       return jsx(Box, { grow: 1, background: "#0000ff" });
     }`,
  );
  const r = nodebuilder("screenshot", "shot-only.ts", "shot-only.png", "--width", "10", "--height", "10");
  expect(r.err).toBe("");
  expect(r.code).toBe(0);
  const png = decodeImage(new Uint8Array(readFileSync(join(dir, "shot-only.png"))));
  expect(Array.from(png.data.subarray(0, 4))).toEqual([0, 0, 255, 255]);
});

test("screenshot: an app that never calls run() is an error, and so are missing arguments", () => {
  writeFileSync(join(dir, "norun.ts"), "export {};\n");
  const r = nodebuilder("screenshot", "norun.ts", "never.png");
  expect(r.code).toBe(1);
  expect(r.err).toContain("run()");
  // Neither run() nor a default export: the message says how to pick a component.
  expect(r.err).toContain("--export");
  expect(existsSync(join(dir, "never.png"))).toBe(false);
  const usage = nodebuilder("screenshot");
  expect(usage.code).toBe(1);
  expect(usage.err).toContain("nodebuilder screenshot <app.tsx> <out.png>");
});

// `nodebuilder icons add`: a fake app with a fake node_modules (the icon packages are not
// dependencies of the framework). The layouts mirror lucide-static and @phosphor-icons/core.
describe("icons", () => {
  const app = join(dir, "icons-app");
  const svg = '<svg viewBox="0 0 24 24"><path d="M0 0h1"/></svg>';
  const fake = (path: string) => {
    mkdirSync(join(app, "node_modules", path, ".."), { recursive: true });
    writeFileSync(join(app, "node_modules", path), path.endsWith(".json") ? "{}" : svg);
  };
  for (const name of ["play", "pause", "heart", "heart-crack", "arrow-left", "list"]) fake(`lucide-static/icons/${name}.svg`);
  fake("lucide-static/package.json");
  for (const p of ["regular/heart.svg", "fill/heart-fill.svg", "bold/heart-bold.svg", "regular/arrow-left.svg"]) fake(`@phosphor-icons/core/assets/${p}`);
  fake("@phosphor-icons/core/package.json");
  const out = join(app, "src/icons.ts");
  const read = () => readFileSync(out, "utf8");
  // Not `export { default as x } from "..." with { type: "text" }`: Bun drops the attribute on
  // a re-export and gives the file's path instead of its text.
  const line = (name: string, path: string) => `import ${name} from "${path}" with { type: "text" }; export { ${name} };`;

  test("add creates the module with sorted, camelCased exports and validates each file", () => {
    rmSync(join(app, "src"), { recursive: true, force: true });
    const r = addIcons({ cwd: app, from: "lucide-static", out: "src/icons.ts", names: ["play", "arrow-left", "heart"] });
    expect(r.added).toEqual(["arrowLeft", "heart", "play"]);
    expect(read()).toContain(
      [line("arrowLeft", "lucide-static/icons/arrow-left.svg"), line("heart", "lucide-static/icons/heart.svg"), line("play", "lucide-static/icons/play.svg")].join("\n"),
    );
  });

  test("add again: dedupes, keeps sorting and keeps the rest of the file", () => {
    writeFileSync(out, `// my icons\nexport const logo = "<svg/>";\n\n${line("play", "lucide-static/icons/play.svg")}\n\nexport const size = 20;\n`);
    const r = addIcons({ cwd: app, from: "lucide-static", out: "src/icons.ts", names: ["pause", "play", "heart-crack", "pause"] });
    expect(r.added).toEqual(["heartCrack", "pause"]);
    expect(r.existing).toEqual(["play"]);
    expect(read()).toBe(
      `// my icons\nexport const logo = "<svg/>";\n\n${line("heartCrack", "lucide-static/icons/heart-crack.svg")}\n${line("pause", "lucide-static/icons/pause.svg")}\n${line("play", "lucide-static/icons/play.svg")}\n\nexport const size = 20;\n`,
    );
  });

  test("the module really exports the SVG text", async () => {
    rmSync(out, { force: true });
    addIcons({ cwd: app, from: "lucide-static", out: "src/icons.ts", names: ["play"] });
    const icons = await import(out);
    expect(icons.play).toBe(svg);
  });

  test("re-exports (which give a path in Bun) and lines a formatter split are taken over", () => {
    writeFileSync(
      out,
      'export { default as play } from "lucide-static/icons/play.svg" with { type: "text" };\n' +
        'import heart from "lucide-static/icons/heart.svg" with { type: "text" };\nexport { heart };\n',
    );
    const r = addIcons({ cwd: app, from: "lucide-static", out: "src/icons.ts", names: ["pause", "heart"] });
    expect(r.added).toEqual(["pause"]);
    expect(r.existing).toEqual(["heart"]);
    expect(read()).toBe(
      `${line("heart", "lucide-static/icons/heart.svg")}\n${line("pause", "lucide-static/icons/pause.svg")}\n${line("play", "lucide-static/icons/play.svg")}\n`,
    );
  });

  test("an unknown name fails with close matches and writes nothing", () => {
    writeFileSync(out, "export {};\n");
    expect(() => addIcons({ cwd: app, from: "lucide-static", out: "src/icons.ts", names: ["play", "hart", "zzzzzz"] })).toThrow(
      /unknown icon "hart" in lucide-static \(did you mean heart\b.*\)[\s\S]*unknown icon "zzzzzz"/,
    );
    expect(read()).toBe("export {};\n");
  });

  test("a name already exported by other code in the file, or from another file, is an error", () => {
    writeFileSync(out, 'export const list = "<svg/>";\n');
    expect(() => addIcons({ cwd: app, from: "lucide-static", out: "src/icons.ts", names: ["list"] })).toThrow(/"list" is already exported/);
    writeFileSync(out, `${line("heart", "lucide-static/icons/heart.svg")}\n`);
    expect(() => addIcons({ cwd: app, from: "@phosphor-icons/core", out: "src/icons.ts", names: ["heart"] })).toThrow(/"heart" is already exported/);
  });

  test("Phosphor: regular by default, weights by suffix, from any folder inside the app", () => {
    rmSync(out, { force: true });
    mkdirSync(join(app, "src/deep"), { recursive: true });
    const r = addIcons({ cwd: join(app, "src/deep"), from: "@phosphor-icons/core", out: "../icons.ts", names: ["heart", "heart-fill", "heart-bold"] });
    expect(r.added).toEqual(["heart", "heartBold", "heartFill"]);
    expect(read()).toContain(line("heartFill", "@phosphor-icons/core/assets/fill/heart-fill.svg"));
    expect(read()).toContain(line("heart", "@phosphor-icons/core/assets/regular/heart.svg"));
    expect(read()).toContain(line("heartBold", "@phosphor-icons/core/assets/bold/heart-bold.svg"));
  });

  test("a package that is not installed or not supported is a clear error", () => {
    expect(() => addIcons({ cwd: dir, from: "lucide-static", out: "icons.ts", names: ["play"] })).toThrow(/bun add lucide-static/);
    expect(() => addIcons({ cwd: app, from: "heroicons", out: "icons.ts", names: ["play"] })).toThrow(/lucide-static, @phosphor-icons\/core/);
  });

  test("the command: add prints what changed, list filters names, errors exit 1", () => {
    rmSync(out, { force: true });
    const run = (...args: string[]) => {
      const p = Bun.spawnSync([process.execPath, cli, "icons", ...args], { cwd: app });
      return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
    };
    const added = run("add", "play", "pause");
    expect(added.err).toBe("");
    expect(added.out).toContain("src/icons.ts");
    expect(read()).toContain(line("pause", "lucide-static/icons/pause.svg"));
    expect(run("list", "heart").out.trim().split("\n")).toEqual(["heart", "heart-crack"]);
    const bad = run("add", "hart");
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("did you mean heart");
    expect(run("--help").out).toContain("nodebuilder icons add <names...>");
  });
});
