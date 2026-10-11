#!/usr/bin/env bun
// `nodebuilder` command (bin of @nodebuilderjs/core). Needs Bun: packaging uses `bun build --compile`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { packageCommand } from "./package.js";

const [command, ...args] = process.argv.slice(2);
const version = JSON.parse(readFileSync(join(import.meta.dir, "../package.json"), "utf8")).version;

switch (command) {
  case "package":
    await packageCommand(args);
    break;
  case "version":
  case "--version":
  case "-v":
    console.log(version);
    break;
  default:
    console.log(`nodebuilder ${version}

  nodebuilder package <entrada.tsx> [opções]   gera AppImage, .deb, .rpm e .tar.gz em dist/
  nodebuilder version

Projeto novo: bun create nodebuilderjs meu-app`);
    process.exit(command && command !== "help" && command !== "--help" ? 1 : 0);
}
