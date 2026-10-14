#!/usr/bin/env node
// bun create nodebuilderjs [dir] [--title "My App"] [--no-install] [--no-git]
// Plain JS (not TS) so it runs under both `bun create` and `npm create`.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
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
  console.log(`usage: bun create nodebuilderjs [folder] [--title "My App"] [--no-install] [--no-git]`);
  process.exit(0);
}

let dir = positionals[0];
if (!dir) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  dir = (await rl.question("Project name: (my-app) ")).trim() || "my-app";
  rl.close();
}
const target = resolve(dir);
if (existsSync(target) && readdirSync(target).length) {
  console.error(`The folder ${dir} already exists and is not empty.`);
  process.exit(1);
}

const name = basename(target).toLowerCase().replace(/[^a-z0-9._-]/g, "-");
const title = opts.title ?? basename(target).replace(/[-_.]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const appId = `dev.nodebuilder.${name.replace(/[^a-z0-9]/g, "_")}`;

cpSync(join(here, "template"), target, { recursive: true });
// npm drops .gitignore from published packages, so the template ships it as _gitignore.
renameSync(join(target, "_gitignore"), join(target, ".gitignore"));

// Skills live in .agents/skills (read by Codex, Cursor, OpenCode, Gemini CLI, Copilot). Claude
// Code only reads .claude/skills, where each skill may be a symlink. Made here, relative,
// because npm packs and cpSync don't keep relative symlinks.
const skills = join(target, ".agents", "skills");
if (existsSync(skills)) {
  mkdirSync(join(target, ".claude", "skills"), { recursive: true });
  for (const skill of readdirSync(skills)) {
    symlinkSync(join("..", "..", ".agents", "skills", skill), join(target, ".claude", "skills", skill), "dir");
  }
}

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
    screenshot: "nodebuilder screenshot src/main.tsx screenshot.png",
    doctor: "nodebuilder doctor",
    "agents:update": "nodebuilder agents update",
    "icons:add": "nodebuilder icons add --out src/icons.ts",
    package: `nodebuilder package src/main.tsx --title "${title}" --app-id ${appId}`,
  },
  dependencies: { "@nodebuilderjs/core": `^${version}` },
  devDependencies: { "@types/bun": "^1.4.2", typescript: "7.0.2" },
};
writeFileSync(join(target, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

const run = (cmd, args) => spawnSync(cmd, args, { cwd: target, stdio: "inherit" }).status === 0;
const hasBun = spawnSync("bun", ["--version"], { stdio: "ignore" }).status === 0;

if (!opts["no-install"]) {
  if (!hasBun) console.warn("Bun not found: install it from https://bun.sh and run `bun install`.");
  else if (!run("bun", ["install"])) console.warn("`bun install` failed; run it again inside the folder.");
}
if (!opts["no-git"] && spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0) {
  run("git", ["init", "-q"]);
}

const cd = relative(process.cwd(), target) || ".";
console.log(`
Done! ${title} created in ${cd}

  cd ${cd}
  bun run dev        # opens the window and reloads on save
  bun test           # tests without a window
  bun run package    # AppImage, .deb, .rpm and .tar.gz in dist/
`);
