#!/usr/bin/env node
// bun create nodebuilderjs [dir] [--title "Meu App"] [--no-install] [--no-git]
// Plain JS (not TS) so it runs under both `bun create` and `npm create`.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    title: { type: "string" },
    "no-install": { type: "boolean" },
    "no-git": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

if (opts.help) {
  console.log(`uso: bun create nodebuilderjs [pasta] [--title "Meu App"] [--no-install] [--no-git]`);
  process.exit(0);
}

let dir = positionals[0];
if (!dir) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  dir = (await rl.question("Nome do projeto: (meu-app) ")).trim() || "meu-app";
  rl.close();
}
const target = resolve(dir);
if (existsSync(target) && readdirSync(target).length) {
  console.error(`A pasta ${dir} já existe e não está vazia.`);
  process.exit(1);
}

const name = basename(target).toLowerCase().replace(/[^a-z0-9._-]/g, "-");
const title = opts.title ?? basename(target).replace(/[-_.]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const appId = `dev.nodebuilder.${name.replace(/[^a-z0-9]/g, "_")}`;

cpSync(join(here, "template"), target, { recursive: true });
// npm drops .gitignore from published packages, so the template ships it as _gitignore.
renameSync(join(target, "_gitignore"), join(target, ".gitignore"));

const fill = (file) => {
  const path = join(target, file);
  writeFileSync(path, readFileSync(path, "utf8").replaceAll("{{title}}", title).replaceAll("{{appId}}", appId));
};
["src/App.tsx", "README.md"].forEach(fill);

const pkg = {
  name,
  version: "0.1.0",
  private: true,
  type: "module",
  scripts: {
    start: "bun src/main.tsx",
    dev: "bun --watch src/main.tsx",
    test: "bun test",
    typecheck: "tsc --noEmit",
    package: `nodebuilder package src/main.tsx --title "${title}" --app-id ${appId}`,
  },
  dependencies: { "@nodebuilderjs/core": `^${version}` },
  devDependencies: { "@types/bun": "^1.4.2", typescript: "7.0.2" },
};
writeFileSync(join(target, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

const run = (cmd, args) => spawnSync(cmd, args, { cwd: target, stdio: "inherit" }).status === 0;
const hasBun = spawnSync("bun", ["--version"], { stdio: "ignore" }).status === 0;

if (!opts["no-install"]) {
  if (!hasBun) console.warn("Bun não encontrado: instale em https://bun.sh e rode `bun install`.");
  else if (!run("bun", ["install"])) console.warn("`bun install` falhou; rode de novo dentro da pasta.");
}
if (!opts["no-git"] && spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0) {
  run("git", ["init", "-q"]);
}

const cd = relative(process.cwd(), target) || ".";
console.log(`
Pronto! ${title} criado em ${cd}

  cd ${cd}
  bun run dev        # abre a janela e recarrega ao salvar
  bun test           # testes sem janela
  bun run package    # AppImage, .deb, .rpm e .tar.gz em dist/
`);
