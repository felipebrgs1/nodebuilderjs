// `nodebuilder agents update`: an app's agent docs (AGENTS.md and .agents/skills, copied by
// `bun create nodebuilderjs`) brought up to the installed @nodebuilderjs/core, which ships them.
// A file is replaced only when its content is one the framework released (its hash is in
// agents-history.json, made from git by scripts/agents-history.ts): anything else was written
// by the app's authors and is kept. In AGENTS.md only the block between the markers is ours.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, rmdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { parseArgs } from "node:util";

export const AGENTS_BEGIN = "<!-- nodebuilder:begin (the framework's guide, kept current by `nodebuilder agents update`; write your notes after the end marker) -->";
export const AGENTS_END = "<!-- nodebuilder:end -->";
const BEGIN_PREFIX = "<!-- nodebuilder:begin";

/** Where the docs live in the template (and in the published core package). */
export const TEMPLATE = join(import.meta.dir, "../packages/create-nodebuilderjs/template");
const HISTORY = join(import.meta.dir, "agents-history.json");

export interface AgentDocs {
  version: string;
  /** App-relative path ("AGENTS.md", ".agents/skills/<name>/SKILL.md"...) -> current content. */
  files: Map<string, string>;
  /** App-relative path -> docHash of every released version (paths of renamed skills too). */
  history: Record<string, string[]>;
}

export type Action = "add" | "update" | "remove" | "keep" | "same";
export interface Change {
  path: string;
  action: Action;
}

/** The framework's part of AGENTS.md: between the markers, or the whole file without them. */
function block(text: string): { start: number; end: number; inner: string } | null {
  const start = text.indexOf(BEGIN_PREFIX);
  if (start < 0) return null;
  const open = text.indexOf("-->", start);
  const end = open < 0 ? -1 : text.indexOf(AGENTS_END, open);
  if (end < 0) return null;
  return { start, end: end + AGENTS_END.length, inner: text.slice(open + 3, end).trim() };
}

/** Hash of what the framework owns in a doc: AGENTS.md's marked block, any other file whole. */
export function docHash(path: string, text: string): string {
  const owned = path === "AGENTS.md" ? (block(text)?.inner ?? text) : text;
  return createHash("sha256").update(owned).digest("hex");
}

function walk(root: string, sub: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(root, sub), { withFileTypes: true })) {
    const path = join(sub, entry.name);
    if (entry.isDirectory()) walk(root, path, out);
    else out.push(path);
  }
  return out;
}

/** The docs of this @nodebuilderjs/core (the template it ships) and the release history. */
export function readAgentDocs(template = TEMPLATE): AgentDocs {
  const files = new Map<string, string>();
  files.set("AGENTS.md", readFileSync(join(template, "AGENTS.md"), "utf8"));
  for (const path of walk(template, ".agents")) files.set(path, readFileSync(join(template, path), "utf8"));
  const version = JSON.parse(readFileSync(join(import.meta.dir, "../package.json"), "utf8")).version as string;
  const history = existsSync(HISTORY) ? (JSON.parse(readFileSync(HISTORY, "utf8")) as Record<string, string[]>) : {};
  return { version, files, history };
}

const read = (root: string, path: string) => {
  try {
    return readFileSync(join(root, path), "utf8");
  } catch {
    return undefined;
  }
};

/**
 * An AGENTS.md from before the markers that starts with a released version, followed by the
 * app's own notes: the length of that released part (0: none).
 */
function releasedPrefix(text: string, docs: AgentDocs): number {
  if (block(text)) return 0;
  const known = new Set(docs.history["AGENTS.md"] ?? []);
  let best = 0;
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) if (known.has(docHash("AGENTS.md", text.slice(0, i + 1)))) best = i + 1;
  return best;
}

/** What an update would do to each framework doc of the app at `root`. */
export function planAgents(root: string, docs: AgentDocs, options: { force?: boolean }): Change[] {
  const changes: Change[] = [];
  const released = (path: string, text: string) =>
    (docs.history[path]?.includes(docHash(path, text)) ?? false) || (path === "AGENTS.md" && releasedPrefix(text, docs) > 0);
  for (const [path, text] of docs.files) {
    const current = read(root, path);
    let action: Action;
    if (current === undefined) action = "add";
    else if (docHash(path, current) === docHash(path, text)) action = "same";
    else action = options.force || released(path, current) ? "update" : "keep";
    changes.push({ path, action });
  }
  // Docs of earlier releases that are gone now (renamed or dropped skills).
  for (const path of Object.keys(docs.history)) {
    if (docs.files.has(path)) continue;
    const current = read(root, path);
    if (current !== undefined) changes.push({ path, action: options.force || released(path, current) ? "remove" : "keep" });
  }
  return changes;
}

const SKILL = /^\.agents\/skills\/([^/]+)\//;
const linkTarget = (skill: string) => join("..", "..", ".agents", "skills", skill);

/** The new guide in an app's AGENTS.md, keeping the app's notes around it. */
function mergeAgentsMd(current: string, text: string, docs: AgentDocs): string {
  const fresh = block(text);
  if (!fresh) return text;
  const guide = text.slice(fresh.start, fresh.end);
  // Inside the markers only.
  const ours = block(current);
  if (ours) return current.slice(0, ours.start) + guide + current.slice(ours.end);
  // From before the markers: a released guide, then the app's notes, kept after the new one.
  const prefix = releasedPrefix(current, docs);
  return prefix > 0 && prefix < current.length ? `${guide}\n${current.slice(prefix)}` : text;
}

export function applyAgents(root: string, docs: AgentDocs, changes: Change[]) {
  for (const { path, action } of changes) {
    const file = join(root, path);
    if (action === "add" || action === "update") {
      mkdirSync(dirname(file), { recursive: true });
      const text = docs.files.get(path)!;
      const current = read(root, path);
      writeFileSync(file, path === "AGENTS.md" && current !== undefined ? mergeAgentsMd(current, text, docs) : text);
    } else if (action === "remove") {
      rmSync(file);
      // Empty folders up to .agents/skills go too.
      for (let d = dirname(file); relative(join(root, ".agents", "skills"), d) && existsSync(d) && !readdirSync(d).length; d = dirname(d)) rmdirSync(d);
    }
  }
  linkSkills(root, docs);
}

/** Claude Code reads .claude/skills: one link per skill folder, as `bun create` makes them. */
function linkSkills(root: string, docs: AgentDocs) {
  const links = join(root, ".claude", "skills");
  const skills = new Set([...docs.files.keys()].map((p) => SKILL.exec(p)?.[1]).filter((s): s is string => !!s));
  mkdirSync(links, { recursive: true });
  for (const skill of skills) if (!existsSync(join(links, skill)) && !isLink(join(links, skill))) symlinkSync(linkTarget(skill), join(links, skill), "dir");
  // Links to skills that are gone (ours only: they point into .agents/skills).
  for (const name of readdirSync(links)) {
    const link = join(links, name);
    if (isLink(link) && readlinkSync(link) === linkTarget(name) && !existsSync(join(root, ".agents", "skills", name))) rmSync(link);
  }
}

function isLink(path: string) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

export function summarize(changes: Change[], version: string): string {
  const of = (action: Action) => changes.filter((c) => c.action === action).map((c) => c.path);
  const lines: string[] = [];
  const list = (label: string, paths: string[]) => paths.length && lines.push(`${label}:`, ...paths.map((p) => `  ${p}`));
  list("added", of("add"));
  list("updated", of("update"));
  list("removed (renamed or dropped upstream)", of("remove"));
  const kept = of("keep");
  if (kept.length) {
    list("kept (edited in this app, so not replaced)", kept);
    lines.push("Compare them with the framework's version and merge by hand, or replace them with --force.");
  }
  return lines.length ? lines.join("\n") : `Agent docs already match @nodebuilderjs/core ${version}.`;
}

export const AGENTS_USAGE = `usage: nodebuilder agents update [--dry-run] [--force]

  Brings the app's agent docs (AGENTS.md, .agents/skills, the .claude/skills links) up to the
  installed @nodebuilderjs/core. Run it after updating the framework. A doc is replaced only
  when it is one the framework released; one edited in this app is kept and listed. In
  AGENTS.md only the block between the nodebuilder markers is replaced: notes after it stay.

  --dry-run   only prints what would change
  --force     also replaces (and removes) docs edited in this app`;

export function agentsCommand(args: string[]) {
  const { values: opts, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { "dry-run": { type: "boolean" }, force: { type: "boolean" }, help: { type: "boolean", short: "h" } },
  });
  if (opts.help || positionals[0] !== "update") {
    console.log(AGENTS_USAGE);
    if (!opts.help) process.exitCode = 1;
    return;
  }
  const root = process.cwd();
  if (!existsSync(join(root, "package.json"))) {
    console.error("nodebuilder agents: run it in the app's folder (where package.json is)");
    process.exit(1);
  }
  const docs = readAgentDocs();
  const changes = planAgents(root, docs, { force: opts.force });
  if (!opts["dry-run"]) applyAgents(root, docs, changes);
  console.log(`${opts["dry-run"] ? "(dry run) " : ""}${summarize(changes, docs.version)}`);
}
