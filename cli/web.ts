// `nodebuilder web <app.tsx>`: the app as a web page. The framework runs unchanged in the browser
// with the web native core (src/web/): a <canvas>, WebGL and Canvas2D text. Node built-ins are
// replaced by the shims in src/web/shims/; the app's files are listed in assets.json, which the
// page fetches before starting the app so that synchronous reads keep working.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { BunPlugin } from "bun";

const src = resolve(import.meta.dir, "../src");
const ENTRY = "nodebuilder"; // a virtual module (the plugin below), which names the shared chunk

// Modules with a browser version: the window icon (none on a page) and image decoding (the
// browser's, the TypeScript decoders only on demand). The web versions import the originals.
const WEB_MODULES = new Map([
  [join(src, "image/decode.ts"), join(src, "web/decode.ts")],
  [join(src, "image/icon.ts"), join(src, "web/icon.ts")],
]);

export interface WebOptions {
  out?: string;
  title?: string;
  minify?: boolean;
}

function webPlugin(app: string): BunPlugin {
  return {
    name: "nodebuilder-web",
    setup(build) {
      build.onResolve({ filter: /^nodebuilder$/ }, () => ({ path: "nodebuilder", namespace: "nodebuilder-web" }));
      build.onLoad({ filter: /.*/, namespace: "nodebuilder-web" }, () => ({
        loader: "ts",
        // The app is imported after boot(): its top level may already read files and fonts.
        contents: `import { boot } from ${JSON.stringify(join(src, "web/boot.ts"))};\nawait boot();\nawait import(${JSON.stringify(app)});\n`,
      }));
      build.onResolve({ filter: /^node:/ }, (args) => {
        const shim = join(src, "web/shims", `${args.path.slice(5)}.ts`);
        if (existsSync(shim)) return { path: shim };
        throw new Error(`${args.path} is not available on the web (imported by ${args.importer})`);
      });
      build.onResolve({ filter: /\/(decode|icon)\.js$/ }, (args) => {
        const target = WEB_MODULES.get(resolve(dirname(args.importer), args.path.replace(/\.js$/, ".ts")));
        return target && target !== args.importer ? { path: target } : undefined;
      });
      // The addon's literal requires: never called in the browser.
      build.onResolve({ filter: /\.node$/ }, (args) => ({ path: args.path, external: true }));
    },
  };
}

// Node globals (process, setImmediate) before any module runs: with splitting, a shared chunk
// is evaluated before the entry's own code.
const globals = () => new Bun.Transpiler({ loader: "ts" }).transformSync(readFileSync(join(src, "web/globals.ts"), "utf8"));

const page = (title: string, preload: string[]) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"))}</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #fff; }
  @media (prefers-color-scheme: dark) { html, body { background: #111; } }
  canvas#nodebuilder { display: block; width: 100vw; height: 100vh; }
</style>
</head>
<body>
<canvas id="nodebuilder" tabindex="0"></canvas>
<script>${globals()}</script>
${preload.map((p) => `<link rel="modulepreload" href="${p}">`).join("\n")}
<script type="module" src="./app.js"></script>
</body>
</html>
`;

/** Builds `entry` into `out` (default dist/web): index.html, app.js, assets.json and the app's files. */
export async function buildWeb(entry: string, options: WebOptions = {}): Promise<{ errors: string[]; out: string }> {
  const out = resolve(options.out ?? "dist/web");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  let result;
  try {
    result = await Bun.build({
      entrypoints: [ENTRY],
      outdir: out,
      target: "browser",
      format: "esm",
      // Resolve @nodebuilderjs/core to src/, as Bun does (lib/ only exists in the npm package).
      conditions: ["bun"],
      // Split: what is only imported on demand (the TS image decoders, the app) loads apart.
      splitting: true,
      // Chunks next to app.js: publicPath "./" prefixes imports between chunks as well.
      naming: { entry: "app.js", chunk: "[name]-[hash].[ext]", asset: "assets/[name]-[hash].[ext]" },
      publicPath: "./",
      minify: options.minify ?? false,
      sourcemap: "linked",
      define: { "process.env.NODE_ENV": JSON.stringify(options.minify ? "production" : "development") },
      plugins: [webPlugin(resolve(entry))],
      throw: false,
    });
  } catch (err) {
    return { errors: [String((err as Error).message ?? err)], out };
  }
  if (!result.success) return { errors: result.logs.map((l) => String(l.message ?? l)), out };
  const assets = result.outputs.filter((o) => o.kind === "asset").map((o) => `./${relative(out, o.path)}`);
  writeFileSync(join(out, "assets.json"), JSON.stringify(assets));
  const name = basename(entry).replace(/\.[jt]sx?$/, "");
  // The app's chunk is imported after boot(): fetch it meanwhile. Chunks only imported on demand
  // (the TS image decoders) are not preloaded.
  const preload = result.outputs
    .filter((o) => o.kind === "chunk" && new RegExp(`^(${name}|nodebuilder)-[a-z0-9]+\\.js$`).test(basename(o.path)))
    .map((o) => `./${relative(out, o.path)}`);
  writeFileSync(join(out, "index.html"), page(options.title ?? name, preload));
  return { errors: [], out };
}

const HELP = `nodebuilder web <app.tsx> [options]

  Builds the app as a web page (index.html, app.js and its files) in dist/web.

  --out <dir>      output folder (default dist/web)
  --title <text>   page title (default: the entry's name)
  --minify         minify app.js
  --serve          serve the page after building, rebuilding when a file changes
  --port <n>       port for --serve (default 3000)`;

export async function webCommand(args: string[]) {
  const value = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const entry = args.find((a, i) => !a.startsWith("--") && !["--out", "--title", "--port"].includes(args[i - 1]!));
  if (!entry || args.includes("--help")) {
    console.log(HELP);
    process.exit(entry || args.includes("--help") ? 0 : 1);
  }
  const options: WebOptions = { out: value("--out"), title: value("--title"), minify: args.includes("--minify") };
  const build = async () => {
    const t0 = performance.now();
    const { errors, out } = await buildWeb(entry, options);
    if (errors.length) console.error(`nodebuilder web: build failed\n${errors.join("\n")}`);
    else console.log(`nodebuilder web: built ${relative(process.cwd(), out) || "."} in ${Math.round(performance.now() - t0)} ms`);
    return { ok: !errors.length, out };
  };
  const first = await build();
  if (!args.includes("--serve")) process.exit(first.ok ? 0 : 1);

  const out = first.out;
  const port = Number(value("--port") ?? 3000);
  const server = Bun.serve({
    port,
    async fetch(req) {
      const path = decodeURIComponent(new URL(req.url).pathname);
      const file = Bun.file(join(out, path.endsWith("/") ? `${path}index.html` : path));
      return (await file.exists()) ? new Response(file, { headers: { "cache-control": "no-store" } }) : new Response("not found", { status: 404 });
    },
  });
  console.log(`nodebuilder web: serving on ${server.url}`);
  // Rebuild on change (reload the page to see it).
  const { watch } = await import("node:fs");
  let timer: ReturnType<typeof setTimeout> | null = null;
  watch(resolve(entry, ".."), { recursive: true }, (_, file) => {
    if (!file || resolve(entry, "..", file).startsWith(out)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(build, 100);
  });
}
