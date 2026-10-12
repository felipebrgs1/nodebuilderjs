// Typechecks the ```ts/```tsx snippets of the README and of the template's AGENTS.md and
// skills, with one tsc run over all of them:  bun run check:snippets
//
// A block is checked when it has an `import` (blocks without one are illustrative
// fragments). `<!-- no-check -->` on the line before the fence skips a block that has
// imports; `<!-- check -->` checks one that has none. Each block becomes its own module in
// a temp dir next to a copy of the template's src/ (so `../src/App.js` resolves as in a
// generated app), with a tsconfig that extends the repo's: `@nodebuilderjs/core` is src/.
// Errors are reported as `file.md:line:col`.
import { $, Glob } from "bun";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

export interface Snippet {
  lang: "ts" | "tsx";
  /** 1-based line, in the markdown, of the block's first line of code. */
  line: number;
  code: string;
  check: boolean;
}

const OPEN = /^( {0,3})(`{3,}|~{3,})\s*([\w-]*)/;
const HAS_IMPORT = /^\s*import[\s{*"']/m;

/** Every fenced ts/tsx block of a markdown text, and whether it should be typechecked. */
export function extractSnippets(markdown: string): Snippet[] {
  const lines = markdown.split("\n");
  const snippets: Snippet[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = OPEN.exec(lines[i]!);
    if (!open) continue;
    const [, indent, fence, lang] = open as unknown as [string, string, string, string];
    const close = new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`);
    let end = i + 1;
    while (end < lines.length && !close.test(lines[end]!)) end++;
    if (lang === "ts" || lang === "tsx") {
      const code = lines
        .slice(i + 1, end)
        .map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l.trimStart()))
        .join("\n");
      let prev = i - 1;
      while (prev >= 0 && lines[prev]!.trim() === "") prev--;
      const marker = prev >= 0 ? lines[prev]!.trim() : "";
      const check = marker === "<!-- no-check -->" ? false : marker === "<!-- check -->" || HAS_IMPORT.test(code);
      snippets.push({ lang, line: i + 2, code, check });
    }
    i = end;
  }
  return snippets;
}

// Packages the docs suggest installing (not dev dependencies here). `*.svg` imports are
// already declared by src/assets.d.ts; lucide's icons are IconNode data.
function stubs(sources: string[]): string {
  const lucide = new Set<string>();
  for (const src of sources)
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']lucide["']/g))
      for (const name of m[1]!.split(",")) {
        const local = name.trim().split(/\s+as\s+/)[0]!.trim();
        if (local) lucide.add(local);
      }
  return [
    `declare module "lucide" {`,
    `  import type { IconNode } from "@nodebuilderjs/core";`,
    `  export const icons: Record<string, IconNode>;`,
    ...[...lucide].map((n) => `  export const ${n}: IconNode;`),
    `}`,
    "",
  ].join("\n");
}

async function main(): Promise<number> {
  const root = resolve(import.meta.dir, "..");
  const template = join(root, "packages/create-nodebuilderjs/template");
  const docs = [
    join(root, "README.md"),
    join(template, "AGENTS.md"),
    ...[...new Glob(".agents/skills/*/SKILL.md").scanSync({ cwd: template, dot: true })].sort().map((p) => join(template, p)),
  ];

  const dir = mkdtempSync(join(tmpdir(), "nb-snippets-"));
  try {
    cpSync(join(template, "src"), join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "snippets"));
    const origin = new Map<string, { doc: string; line: number }>();
    const sources: string[] = [];
    let skipped = 0;
    for (const doc of docs) {
      const name = relative(root, doc);
      const slug = name.replace(/[^\w]+/g, "_");
      for (const s of extractSnippets(readFileSync(doc, "utf8"))) {
        if (!s.check) {
          skipped++;
          continue;
        }
        const file = join(dir, "snippets", `${slug}_L${s.line}.${s.lang}`);
        // `export {}` keeps import-less blocks from sharing one global scope.
        writeFileSync(file, `${s.code}\nexport {};\n`);
        origin.set(file, { doc: name, line: s.line });
        sources.push(s.code);
      }
    }
    writeFileSync(join(dir, "stubs.d.ts"), stubs(sources));
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        extends: join(root, "tsconfig.json"),
        compilerOptions: { typeRoots: [join(root, "node_modules/@types")] },
        include: ["snippets", "src", "stubs.d.ts"],
      }),
    );

    const tsc = join(root, "node_modules/.bin/tsc");
    const out = await $`${tsc} --noEmit --pretty false -p tsconfig.json`.cwd(dir).nothrow().quiet();
    const text = out.stdout.toString() + out.stderr.toString();
    const errors: string[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const m = /^(.+?)\((\d+),(\d+)\): (.*)$/.exec(line);
      const file = m && resolve(dir, m[1]!);
      const from = file && origin.get(file);
      if (m && from) errors.push(`${from.doc}:${from.line + Number(m[2]) - 1}:${m[3]} ${m[4]}`);
      else if (m && file) {
        // The copy of the template's src/ or a file of the repo.
        const real = file.startsWith(join(dir, "src")) ? join(template, relative(dir, file)) : file;
        errors.push(`${relative(root, real)}:${m[2]}:${m[3]} ${m[4]}`);
      } else if (/^\s/.test(line) && errors.length) errors[errors.length - 1] += `\n${line}`;
      else errors.push(line);
    }
    if (errors.length || out.exitCode !== 0) {
      console.error(errors.join("\n"));
      console.error(`\n${origin.size} snippets checked, tsc failed.`);
      return 1;
    }
    console.log(`${origin.size} snippets checked (${skipped} skipped), no errors.`);
    return 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) process.exitCode = await main();
