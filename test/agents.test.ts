// `nodebuilder agents update`: brings an app's agent docs (AGENTS.md, .agents/skills) up to the
// installed @nodebuilderjs/core, using the hashes of every released version to tell a stale file
// (replaced) from one the app's authors edited (kept).
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type AgentDocs, AGENTS_BEGIN, AGENTS_END, applyAgents, docHash, planAgents, readAgentDocs, summarize } from "../cli/agents.js";

const dir = mkdtempSync(join(tmpdir(), "nb-agents-"));
afterAll(() => rmSync(dir, { recursive: true }));
let apps = 0;

const agentsMd = (body: string) => `${AGENTS_BEGIN}\n${body}\n${AGENTS_END}\n\n## This app\n\n`;
const NEW = {
  "AGENTS.md": agentsMd("# AGENTS.md\nnew guide"),
  ".agents/skills/nodebuilder-ui/SKILL.md": "ui v2",
  ".agents/skills/nodebuilder-testing/SKILL.md": "testing v2",
};
const OLD = {
  "AGENTS.md": "# AGENTS.md\nold guide, no markers\n",
  ".agents/skills/nodebuilder-ui/SKILL.md": "ui v1",
  ".agents/skills/nodebuilder-testes/SKILL.md": "testes (Portuguese name, renamed since)",
};

/** Source docs: the NEW files, with OLD and NEW in the history. */
function docs(): AgentDocs {
  const history: Record<string, string[]> = {};
  for (const [path, text] of [...Object.entries(OLD), ...Object.entries(NEW)]) (history[path] ??= []).push(docHash(path, text));
  return { version: "0.4.1", files: new Map(Object.entries(NEW)), history };
}

function app(files: Record<string, string>) {
  const root = join(dir, `app${++apps}`);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}
const read = (root: string, path: string) => (existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : undefined);
const actions = (root: string, force = false) => Object.fromEntries(planAgents(root, docs(), { force }).map((c) => [c.path, c.action]));

describe("planAgents / applyAgents", () => {
  test("an app of an older version: stale files updated, new ones added, a renamed skill removed", () => {
    const root = app(OLD);
    mkdirSync(join(root, ".claude/skills"), { recursive: true });
    symlinkSync("../../.agents/skills/nodebuilder-testes", join(root, ".claude/skills/nodebuilder-testes"), "dir");
    expect(actions(root)).toEqual({
      "AGENTS.md": "update",
      ".agents/skills/nodebuilder-ui/SKILL.md": "update",
      ".agents/skills/nodebuilder-testing/SKILL.md": "add",
      ".agents/skills/nodebuilder-testes/SKILL.md": "remove",
    });
    applyAgents(root, docs(), planAgents(root, docs(), {}));
    for (const [path, text] of Object.entries(NEW)) expect(read(root, path)).toBe(text);
    expect(existsSync(join(root, ".agents/skills/nodebuilder-testes"))).toBe(false);
    // Claude Code reads .claude/skills: links follow the skills.
    expect(existsSync(join(root, ".claude/skills/nodebuilder-testes"))).toBe(false);
    expect(lstatSync(join(root, ".claude/skills/nodebuilder-testing")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(root, ".claude/skills/nodebuilder-testing"))).toBe("../../.agents/skills/nodebuilder-testing");
    // Run again: nothing left to do.
    expect(new Set(Object.values(actions(root)))).toEqual(new Set(["same"]));
  });

  test("files the app's authors edited are kept (and reported), unless forced", () => {
    const root = app({ ...OLD, ".agents/skills/nodebuilder-ui/SKILL.md": "ui v1 plus our own notes" });
    expect(actions(root)[".agents/skills/nodebuilder-ui/SKILL.md"]).toBe("keep");
    applyAgents(root, docs(), planAgents(root, docs(), {}));
    expect(read(root, ".agents/skills/nodebuilder-ui/SKILL.md")).toBe("ui v1 plus our own notes");
    expect(actions(root, true)[".agents/skills/nodebuilder-ui/SKILL.md"]).toBe("update");
    // An edited skill that was renamed upstream stays too.
    const renamed = app({ ".agents/skills/nodebuilder-testes/SKILL.md": "edited" });
    expect(actions(renamed)[".agents/skills/nodebuilder-testes/SKILL.md"]).toBe("keep");
    // A skill of the app's own (never in the history) is not ours: not even listed.
    const own = app({ ".agents/skills/our-api/SKILL.md": "x" });
    expect(actions(own)[".agents/skills/our-api/SKILL.md"]).toBeUndefined();
  });

  test("AGENTS.md: only the block between the markers is the framework's; notes outside it stay", () => {
    const notes = "\n## This app\n\nUse pnpm? No: bun. The API lives in src/api.\n";
    const root = app({ "AGENTS.md": `Intro written by us.\n\n${AGENTS_BEGIN}\n# AGENTS.md\nnew guide\n${AGENTS_END}\n${notes}` });
    expect(actions(root)["AGENTS.md"]).toBe("same");
    // The block of an older release (with markers) is replaced, and the rest kept.
    const older = `${AGENTS_BEGIN}\n# AGENTS.md\nguide of 0.4.1-pre\n${AGENTS_END}`;
    const d = docs();
    d.history["AGENTS.md"]!.push(docHash("AGENTS.md", older));
    writeFileSync(join(root, "AGENTS.md"), `Intro written by us.\n\n${older}\n${notes}`);
    applyAgents(root, d, planAgents(root, d, {}));
    expect(read(root, "AGENTS.md")).toBe(`Intro written by us.\n\n${AGENTS_BEGIN}\n# AGENTS.md\nnew guide\n${AGENTS_END}\n${notes}`);
    // Edited inside the block: kept; forced, the block is replaced and the notes still stay.
    writeFileSync(join(root, "AGENTS.md"), `${AGENTS_BEGIN}\n# AGENTS.md\nnew guide, edited\n${AGENTS_END}\n${notes}`);
    expect(actions(root)["AGENTS.md"]).toBe("keep");
    applyAgents(root, docs(), planAgents(root, docs(), { force: true }));
    expect(read(root, "AGENTS.md")).toBe(`${AGENTS_BEGIN}\n# AGENTS.md\nnew guide\n${AGENTS_END}\n${notes}`);
    // An old AGENTS.md (no markers yet) with the app's notes appended: the released part is
    // replaced by the marked block and the notes stay after it.
    writeFileSync(join(root, "AGENTS.md"), `${OLD["AGENTS.md"]}\n## Our notes\nkeep me\n`);
    expect(actions(root)["AGENTS.md"]).toBe("update");
    applyAgents(root, docs(), planAgents(root, docs(), {}));
    expect(read(root, "AGENTS.md")).toBe(`${AGENTS_BEGIN}\n# AGENTS.md\nnew guide\n${AGENTS_END}\n\n## Our notes\nkeep me\n`);
    // No markers and unknown content (written by hand): kept.
    writeFileSync(join(root, "AGENTS.md"), "# Our own AGENTS.md\n");
    expect(actions(root)["AGENTS.md"]).toBe("keep");
  });

  test("summarize: what changed, what was kept and why, in a few lines", () => {
    const root = app({ ...OLD, ".agents/skills/nodebuilder-ui/SKILL.md": "edited" });
    const text = summarize(planAgents(root, docs(), {}), "0.4.1");
    expect(text).toContain("AGENTS.md");
    expect(text).toContain("nodebuilder-testing");
    expect(text).toContain("kept");
    expect(text).toContain("--force");
    expect(summarize(planAgents(app(NEW), docs(), {}), "0.4.1")).toBe("Agent docs already match @nodebuilderjs/core 0.4.1.");
  });
});

describe("the docs shipped with core", () => {
  test("readAgentDocs: the template's AGENTS.md (with markers) and skills, and a history that covers them", () => {
    const real = readAgentDocs();
    expect(real.files.get("AGENTS.md")).toContain(AGENTS_BEGIN);
    expect([...real.files.keys()].filter((p) => p.endsWith("SKILL.md")).length).toBeGreaterThanOrEqual(9);
    // Old Portuguese skill names are in the history, so apps from 0.2 lose them on update.
    expect(Object.keys(real.history)).toContain(".agents/skills/nodebuilder-testes/SKILL.md");
  });
});
