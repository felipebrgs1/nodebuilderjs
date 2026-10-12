#!/usr/bin/env bun
// `nodebuilder` command (bin of @nodebuilderjs/core). Needs Bun: packaging uses `bun build --compile`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { iconsCommand } from "./icons.js";
import { packageCommand } from "./package.js";
import { screenshotCommand } from "./screenshot.js";

const [command, ...args] = process.argv.slice(2);
const version = JSON.parse(readFileSync(join(import.meta.dir, "../package.json"), "utf8")).version;

switch (command) {
  case "package":
    await packageCommand(args);
    break;
  case "screenshot":
    screenshotCommand(args);
    break;
  case "icons":
    iconsCommand(args);
    break;
  case "version":
  case "--version":
  case "-v":
    console.log(version);
    break;
  default:
    console.log(`nodebuilder ${version}

  nodebuilder package <entry.tsx> [options]     builds an AppImage, .deb, .rpm and .tar.gz in dist/
  nodebuilder screenshot <app.tsx> <out.png>    renders the app to a PNG without a window (--help for options)
  nodebuilder icons add <names...>              adds icon imports to src/icons.ts (--help for options)
  nodebuilder version

New project: bun create nodebuilderjs my-app`);
    process.exit(command && command !== "help" && command !== "--help" ? 1 : 0);
}
