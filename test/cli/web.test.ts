// `nodebuilder web`: the browser build. buildWeb is called directly (no spawn); the page itself
// runs only in a browser (see ARCHITECTURE.md, "Web").
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWeb } from "../../cli/web.js";

const repo = join(import.meta.dir, "../..");
const dir = mkdtempSync(join(tmpdir(), "nb-web-"));
afterAll(() => rmSync(dir, { recursive: true }));

test("bundles an app for the browser: page, script, and its files in assets.json", async () => {
  writeFileSync(join(dir, "logo.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>`);
  writeFileSync(
    join(dir, "app.ts"),
    `import { jsx } from ${JSON.stringify(join(repo, "src/jsx-runtime.ts"))};
     import { Column, Icon, Window, run } from ${JSON.stringify(join(repo, "src/index.ts"))};
     import logo from "./logo.svg" with { type: "file" };
     run(() => jsx(Window, { title: "Web test", children: jsx(Column, { children: jsx(Icon, { svg: logo, size: 16 }) }) }));`,
  );
  const out = join(dir, "dist");
  const result = await buildWeb(join(dir, "app.ts"), { out, title: "Web test" });
  expect(result.errors).toEqual([]);

  const html = readFileSync(join(out, "index.html"), "utf8");
  expect(html).toContain("<title>Web test</title>");
  expect(html).toContain(`<script type="module" src="./app.js">`);
  const js = allScripts(out);
  // Node built-ins are replaced by the web shims, and the addon is never bundled.
  expect(js).not.toMatch(/from\s*["']node:|require\(["']node:/);
  expect(js).not.toContain("createConnection(path");
  const assets: string[] = JSON.parse(readFileSync(join(out, "assets.json"), "utf8"));
  expect(assets).toHaveLength(1);
  expect(readFileSync(join(out, assets[0]!), "utf8")).toContain("<svg");
  // The import resolves to the same path the page fetches.
  expect(js).toContain(JSON.stringify(assets[0]));
});

/** Every script of the build (the app and its chunks). */
const allScripts = (out: string) =>
  readdirSync(out, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".js")).map((f) => readFileSync(join(out, f), "utf8")).join("\n");

/** What the page runs before anything is imported on demand: app.js and its static imports. */
function startupScripts(out: string, file = "app.js", seen = new Set<string>()): string {
  if (seen.has(file)) return "";
  seen.add(file);
  const code = readFileSync(join(out, file), "utf8");
  const statics = [...code.matchAll(/(?:^|\n)\s*(?:import|export)\s*(?:[^"'();]*?from\s*)?["'](\.\/[^"']+)["']/g)].map((m) => join(file, "..", m[1]!));
  return code + statics.map((f) => startupScripts(out, f, seen)).join("\n");
}

test("image decoders: none without images; with images, only in a chunk fetched on demand; never the window icon", async () => {
  writeFileSync(
    join(dir, "plain.ts"),
    `import { jsx } from ${JSON.stringify(join(repo, "src/jsx-runtime.ts"))};
     import { Text, Window, run } from ${JSON.stringify(join(repo, "src/index.ts"))};
     run(() => jsx(Window, { title: "Plain", children: jsx(Text, { text: "hi" }) }));`,
  );
  writeFileSync(join(dir, "photo.png"), readFileSync(join(repo, "test/fixtures/png/rgb8.png")));
  writeFileSync(
    join(dir, "photos.ts"),
    `import { jsx } from ${JSON.stringify(join(repo, "src/jsx-runtime.ts"))};
     import { Image, Window, run } from ${JSON.stringify(join(repo, "src/index.ts"))};
     import photo from "./photo.png" with { type: "file" };
     run(() => jsx(Window, { title: "Photos", children: jsx(Image, { src: photo }) }));`,
  );
  const decoders = ["decodeWebp", "decodeJpeg", "decodePng"].map((name) => `function ${name}(`);
  for (const app of ["plain", "photos"]) {
    const out = join(dir, app);
    expect((await buildWeb(join(dir, `${app}.ts`), { out })).errors).toEqual([]);
    const startup = startupScripts(out);
    expect(startup).toContain("useNative");
    for (const fn of [...decoders, "function renderSvg("]) expect(startup).not.toContain(fn);
    for (const fn of decoders) expect(allScripts(out).includes(fn)).toBe(app === "photos");
  }
});

test("a Node module with no web version is a build error naming it", async () => {
  writeFileSync(join(dir, "bad.ts"), `import { spawn } from "node:child_process"; spawn("ls");`);
  const result = await buildWeb(join(dir, "bad.ts"), { out: join(dir, "bad") });
  expect(result.errors.join("\n")).toContain("node:child_process");
});

test("the page is a root element the tree renders into, with no canvas or WebGL", async () => {
  writeFileSync(
    join(dir, "dom.ts"),
    `import { jsx } from ${JSON.stringify(join(repo, "src/jsx-runtime.ts"))};
     import { Text, Window, run } from ${JSON.stringify(join(repo, "src/index.ts"))};
     run(() => jsx(Window, { title: "DOM", children: jsx(Text, { text: "hi" }) }));`,
  );
  const out = join(dir, "dom");
  expect((await buildWeb(join(dir, "dom.ts"), { out })).errors).toEqual([]);
  const html = readFileSync(join(out, "index.html"), "utf8");
  expect(html).toContain(`<div id="nodebuilder"></div>`);
  expect(html).not.toContain("<canvas");
  const js = allScripts(out);
  expect(js).toContain("renderTree");
  expect(js).not.toContain("getContext(\"webgl\"");
});
