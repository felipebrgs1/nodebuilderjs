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
import { join, resolve } from "node:path";
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
// Order matters for publishing: core's optional dependency must exist before core.
const packages = [platformDir, ROOT, join(ROOT, "packages/create-nodebuilderjs")];
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
  rmSync(join(ROOT, "lib"), { recursive: true, force: true });
  mkdirSync(join(ROOT, "lib"));
  const transpiler = new Bun.Transpiler({ loader: "ts", target: "node" });
  const sources = readdirSync(join(ROOT, "src")).filter((f) => f.endsWith(".ts"));
  for (const file of sources) {
    const code = transpiler.transformSync(readFileSync(join(ROOT, "src", file), "utf8"));
    writeFileSync(join(ROOT, "lib", file.replace(/\.ts$/, ".js")), code);
  }
  await $`${join(ROOT, "node_modules/.bin/tsc")} ${sources.map((f) => join(ROOT, "src", f))} --ignoreConfig --declaration --emitDeclarationOnly --outDir ${join(ROOT, "lib")} --target esnext --module preserve --moduleResolution bundler --strict --skipLibCheck --types bun`;
  console.log(`• lib/: ${sources.length} módulos (JS + .d.ts)`);

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
