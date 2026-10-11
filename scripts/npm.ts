// Builds (and with --publish, publishes) the npm packages:
//   @nodebuilderjs/linux-x64   prebuilt portable addon (packages/linux-x64)
//   @nodebuilderjs/core        this repo: src/ for Bun, lib/ (JS + .d.ts) for Node, cli/
//   create-nodebuilderjs       `bun create nodebuilderjs` (packages/create-nodebuilderjs)
// Every package gets the root version. Tarballs land in dist/npm/.
//   bun run npm:build                 # build + pack, nothing leaves the machine
//   bun run npm:publish [--tag next]  # also `bun publish` each tarball (needs `bunx npm login`)
//   bun run npm:publish --skip-build --otp 123456   # publish dist/npm as is (2FA codes last ~30 s)
import { $ } from "bun";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildNative, minGlibc } from "../cli/package/native.js";

const ROOT = resolve(import.meta.dir, "..");
const { values: opts } = parseArgs({
  options: {
    publish: { type: "boolean" },
    tag: { type: "string", default: "latest" },
    native: { type: "string", default: "docker" },
    otp: { type: "string" },
    "skip-build": { type: "boolean" },
  },
});

const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const writeJson = (p: string, v: unknown) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);
const version: string = readJson(join(ROOT, "package.json")).version;
const target = `${process.platform}-${process.arch}`;
const platformDir = join(ROOT, "packages", target);

const out = join(ROOT, "dist/npm");
// Order matters for publishing: core's optional dependency before core, core before charts.
const packages = [platformDir, ROOT, join(ROOT, "packages/charts"), join(ROOT, "packages/create-nodebuilderjs")];

/**
 * JS (Bun.Transpiler) and declarations (tsc) of a TypeScript source folder, mirroring its
 * subfolders. Hand-written .d.ts (src/assets.d.ts) stay in src/, which is published.
 * `@nodebuilderjs/core` resolves to the core's generated declarations (`coreLib`), as for
 * someone who installed it, so charts' declarations do not pull core sources in.
 */
async function buildLib(srcDir: string, libDir: string, coreLib = join(ROOT, "lib")): Promise<number> {
  rmSync(libDir, { recursive: true, force: true });
  mkdirSync(libDir, { recursive: true });
  const transpiler = new Bun.Transpiler({ loader: "ts", target: "node" });
  const sources = (readdirSync(srcDir, { recursive: true }) as string[]).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"));
  for (const file of sources) {
    mkdirSync(dirname(join(libDir, file)), { recursive: true });
    writeFileSync(join(libDir, file.replace(/\.ts$/, ".js")), transpiler.transformSync(readFileSync(join(srcDir, file), "utf8")));
  }
  const config = join(libDir, "tsconfig.lib.json");
  writeJson(config, {
    compilerOptions: {
      declaration: true, emitDeclarationOnly: true, rootDir: srcDir, outDir: libDir, target: "esnext", module: "preserve",
      moduleResolution: "bundler", strict: true, skipLibCheck: true, types: ["bun"],
      typeRoots: [join(ROOT, "node_modules/@types")],
      paths: { "@nodebuilderjs/core": [join(coreLib, "index.d.ts")], "@nodebuilderjs/core/*": [join(coreLib, "*.d.ts")] },
    },
    files: sources.map((f) => join(srcDir, f)),
  });
  await $`${join(ROOT, "node_modules/.bin/tsc")} -p ${config}`;
  rmSync(config);
  return sources.length;
}
const tarballOf = (dir: string) => {
  const name = readJson(join(dir, "package.json")).name as string;
  return join(out, `${name.replace("@", "").replace("/", "-")}-${version}.tgz`);
};
const tarballs = packages.map(tarballOf);

if (opts["skip-build"]) {
  for (const t of tarballs) if (!existsSync(t)) throw new Error(`${t} não existe; rode sem --skip-build`);
} else {
  // ---- versions ------------------------------------------------------------------
  for (const dir of readdirSync(join(ROOT, "packages"))) {
    const p = join(ROOT, "packages", dir, "package.json");
    const pkg = readJson(p);
    if (pkg.version !== version) writeJson(p, { ...pkg, version });
  }
  // bun pm pack resolves workspace:* from bun.lock, so refresh it after a version change.
  await $`bun install --silent`.cwd(ROOT);
  console.log(`• versão ${version} em todos os pacotes`);

  // ---- lib/: JS + declarations for Node (Bun uses src/ through the "bun" export condition) ----
  for (const [pkg, src] of [[ROOT, "src"], [join(ROOT, "packages/charts"), "src"]] as const) {
    const count = await buildLib(join(pkg, src), join(pkg, "lib"));
    console.log(`• ${relative(ROOT, join(pkg, "lib")) || "lib"}/: ${count} módulos (JS + .d.ts)`);
  }

  // ---- prebuilt addon --------------------------------------------------------------
  const addon = await buildNative(ROOT, opts.native as "docker" | "local");
  copyFileSync(addon, join(platformDir, "nodebuilder.node"));
  console.log(`• addon ${target} (${opts.native}), glibc mínima ${await minGlibc(addon)}`);

  // ---- pack --------------------------------------------------------------------------
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const dir of packages) await $`bun pm pack --destination ${out} --quiet`.cwd(dir).quiet();
}
console.log("• pacotes:");
for (const t of tarballs) console.log(`  ${t}`);

if (opts.publish) {
  const otp = opts.otp ? ["--otp", opts.otp] : [];
  for (const t of tarballs) await $`bun publish ${t} --access public --tag ${opts.tag} ${otp}`.cwd(ROOT);
  console.log(`\nPublicado ${version} (tag ${opts.tag}).`);
} else {
  console.log(`\nNada publicado. Para publicar: bun run npm:publish`);
}
