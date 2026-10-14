// Writes cli/agents-history.json: for every agent doc the app template ever had (AGENTS.md,
// .agents/**), the hash of each committed version. `nodebuilder agents update` replaces an app's
// doc only when its hash is there (a released version, not one the app's authors edited).
// Run by `bun run npm:build` before packing; `bun scripts/agents-history.ts` by hand.
import { $ } from "bun";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { docHash } from "../cli/agents.js";

const ROOT = join(import.meta.dir, "..");
const PREFIX = "packages/create-nodebuilderjs/template/";
const PATHS = [`${PREFIX}AGENTS.md`, `${PREFIX}.agents`];

// Every blob these paths pointed to, in any commit: "<blob> <path>" pairs. -m: a version made
// while resolving a merge only shows in the merge's diff; both sides of each change count.
const log = await $`git log --all -m --raw --no-abbrev --format= -- ${PATHS}`.cwd(ROOT).text();
const blobs = new Map<string, string>();
for (const line of log.split("\n")) {
  const m = /^:\d+ \d+ ([0-9a-f]+) ([0-9a-f]+) [AMRCD]\d*\t(\S+)(?:\t(\S+))?$/.exec(line);
  if (!m) continue;
  const [, before, after, from, to] = m;
  if (!/^0+$/.test(before!)) blobs.set(`${before} ${from}`, from!);
  if (!/^0+$/.test(after!)) blobs.set(`${after} ${to ?? from}`, to ?? from!);
}
const history: Record<string, Set<string>> = {};
for (const key of blobs.keys()) {
  const [blob, path] = key.split(" ") as [string, string];
  const text = await $`git cat-file blob ${blob}`.cwd(ROOT).text();
  (history[path.slice(PREFIX.length)] ??= new Set()).add(docHash(path.slice(PREFIX.length), text));
}
const sorted = Object.fromEntries(Object.keys(history).sort().map((p) => [p, [...history[p]!].sort()]));
writeFileSync(join(ROOT, "cli/agents-history.json"), `${JSON.stringify(sorted, null, 1)}\n`);
console.log(`• agents history: ${Object.keys(sorted).length} docs, ${Object.values(sorted).flat().length} versions`);
