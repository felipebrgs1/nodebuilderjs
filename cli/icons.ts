// `nodebuilder icons add <names...>`: writes `import x from "<pkg>/<file>.svg" with { type:
// "text" }; export { x };` lines into the app's icons module, so icons are imported as text
// (embedded by `nodebuilder package`) without hand-written import lists. The icon packages
// stay the app's own dependencies: nothing third-party ships in the framework.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

export const ICONS_USAGE = `usage: nodebuilder icons add <names...> [--from <package>] [--out <file>]
       nodebuilder icons list [filter] [--from <package>]

  add    adds icons to the module (default src/icons.ts) as
         import arrowLeft from "lucide-static/icons/arrow-left.svg" with { type: "text" }; export { arrowLeft };
         sorted and deduplicated; the rest of the file is kept. Each file must exist in
         node_modules; an unknown name fails with close matches and writes nothing.
  list   prints the icon names of the package (those containing [filter])

  --from <package>   lucide-static (default) or @phosphor-icons/core; install it first
                     (bun add lucide-static). Phosphor weights by suffix: heart (regular),
                     heart-fill, heart-bold, heart-light, heart-thin, heart-duotone
  --out <file>       the icons module, relative to the current folder (default src/icons.ts)

  Then: import { arrowLeft } from "./icons.js"; <Icon svg={arrowLeft} />`;

interface IconPackage {
  /** The file of `name` inside the package (no check that it exists). */
  file(name: string): string;
  /** Every icon name, for `list` and suggestions. */
  names(root: string): string[];
}

const PHOSPHOR_WEIGHTS = ["thin", "light", "bold", "fill", "duotone"];
const svgNames = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".svg")).map((f) => f.slice(0, -4)) : []);

const PACKAGES: Record<string, IconPackage> = {
  "lucide-static": {
    file: (name) => `icons/${name}.svg`,
    names: (root) => svgNames(join(root, "icons")),
  },
  "@phosphor-icons/core": {
    // assets/regular/heart.svg; the other weights carry the suffix: assets/fill/heart-fill.svg
    file: (name) => {
      const weight = PHOSPHOR_WEIGHTS.find((w) => name.endsWith(`-${w}`));
      return weight ? `assets/${weight}/${name}.svg` : `assets/regular/${name}.svg`;
    },
    names: (root) => ["regular", ...PHOSPHOR_WEIGHTS].flatMap((w) => svgNames(join(root, "assets", w))),
  },
};

export interface AddIconsOptions {
  /** Where node_modules is looked up from (walking up) and `out` is relative to. */
  cwd: string;
  /** Package name (a key of the supported packages). */
  from: string;
  /** The icons module, relative to `cwd`. */
  out: string;
  names: string[];
}

// One generated line. Not `export { default as x } from "..." with { type: "text" }`: Bun
// drops the import attribute on a re-export and gives the file's path instead of its text.
const ID = "[A-Za-z_$][\\w$]*";
const ICON_LINE = new RegExp(`^import (${ID}) from "([^"]+)" with \\{ type: "text" \\};(?: export \\{ \\1 \\};)?$`);
const REEXPORT_LINE = new RegExp(`^export \\{ default as (${ID}) \\} from "([^"]+)" with \\{ type: "text" \\};$`);
const iconLine = (name: string, specifier: string) => `import ${name} from "${specifier}" with { type: "text" }; export { ${name} };`;

/**
 * The icon lines of a module: the generated form, the same split in two by a formatter
 * (`import x ...;` then `export { x };`) and the re-export form (rewritten, see above).
 * A text import that is not exported right there is the app's own code.
 */
function parseIcons(lines: string[]) {
  const icons = new Map<string, string>(); // export name -> import specifier
  const managed = new Set<number>(); // line indexes
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = ICON_LINE.exec(line) ?? REEXPORT_LINE.exec(line);
    if (!m) continue;
    const exportedHere = line.startsWith("export") || line.endsWith(`export { ${m[1]} };`);
    if (exportedHere) managed.add(i);
    else if (lines[i + 1]?.trim() === `export { ${m[1]} };`) managed.add(i).add(++i);
    else continue;
    icons.set(m[1]!, m[2]!);
  }
  return { icons, managed };
}

const RESERVED = new Set(
  ("break case catch class const continue debugger default delete do else enum export extends false finally for function " +
    "if import in instanceof new null return super switch this throw true try typeof var void while with yield let static " +
    "implements interface package private protected public await").split(" "),
);

/** `arrow-left` -> `arrowLeft`; a reserved word or a leading digit gets an `icon` affix. */
export function iconExportName(name: string): string {
  const camel = name.replace(/[-_ ]+([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase());
  if (/^\d/.test(camel)) return `icon${camel[0]!.toUpperCase()}${camel.slice(1)}`;
  return RESERVED.has(camel) ? `${camel}Icon` : camel;
}

function iconPackage(from: string): IconPackage {
  const pkg = PACKAGES[from];
  if (!pkg) throw new Error(`unsupported icon package "${from}": use one of ${Object.keys(PACKAGES).join(", ")}`);
  return pkg;
}

/** The installed package's folder, looking in node_modules from `cwd` up (as Bun and Node resolve). */
function packageRoot(from: string, cwd: string): string {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const root = join(dir, "node_modules", from);
    if (existsSync(join(root, "package.json"))) return root;
    if (dirname(dir) === dir) throw new Error(`${from} is not installed here: run \`bun add ${from}\` first`);
  }
}

function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length]!;
}

/** Up to 5 names close to `name`: small edit distance, or containing it. */
function suggestions(name: string, all: string[]): string[] {
  const limit = Math.max(2, Math.floor(name.length / 3));
  return all
    .map((n) => ({ n, d: n.includes(name) ? 0.5 + (n.length - name.length) / 100 : distance(name, n) }))
    .filter((s) => s.d <= limit)
    .sort((a, b) => a.d - b.d || a.n.localeCompare(b.n))
    .slice(0, 5)
    .map((s) => s.n);
}

/** Names the app's own code in the module declares or exports (they would clash with an icon's). */
function otherNames(code: string): Set<string> {
  const names = new Set<string>();
  for (const m of code.matchAll(/\b(?:export\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]!);
  for (const m of code.matchAll(/\bimport\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]!);
  for (const m of code.matchAll(/\b(?:export|import)\s*(?:type\s*)?\{([^}]*)\}/g))
    for (const part of m[1]!.split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  return names;
}

/**
 * Adds icons to the module at `out`: one sorted block of generated lines where the first one
 * was (or at the end), everything else in the file kept as it was. Throws (writing nothing)
 * on an unknown icon, a missing package or a name the file already exports differently.
 */
export function addIcons({ cwd, from, out, names }: AddIconsOptions): { added: string[]; existing: string[]; path: string } {
  const pkg = iconPackage(from);
  const root = packageRoot(from, cwd);
  const path = resolve(cwd, out);
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
  const { icons: generated, managed } = parseIcons(lines);
  const taken = otherNames(lines.filter((_, i) => !managed.has(i)).join("\n"));

  const errors: string[] = [];
  const added: string[] = [], existing: string[] = [];
  let all: string[] | undefined;
  for (const name of new Set(names)) {
    const file = pkg.file(name);
    if (!existsSync(join(root, file))) {
      all ??= pkg.names(root);
      const close = suggestions(name, all);
      errors.push(`unknown icon "${name}" in ${from}${close.length ? ` (did you mean ${close.join(", ")}?)` : ""}`);
      continue;
    }
    const exportName = iconExportName(name);
    const specifier = `${from}/${file}`;
    const current = generated.get(exportName);
    if (current === specifier) existing.push(exportName);
    else if (current !== undefined) errors.push(`"${exportName}" is already exported from "${current}"; remove that line or rename one of them`);
    else if (taken.has(exportName)) errors.push(`"${exportName}" is already exported (or declared) by other code in ${out}`);
    else {
      generated.set(exportName, specifier);
      added.push(exportName);
    }
  }
  if (errors.length > 0) throw new Error(errors.join("\n"));

  const block = [...generated].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([n, s]) => iconLine(n, s));
  let result: string[];
  if (managed.size > 0) {
    result = [];
    lines.forEach((line, i) => {
      if (!managed.has(i)) result.push(line);
      else if (i === Math.min(...managed)) result.push(...block);
    });
  } else if (lines.length > 0) result = [...lines, ...(lines.at(-1) === "" ? [] : [""]), ...block];
  else result = ["// Icons for <Icon svg={...} />. `nodebuilder icons add <names...>` adds lines here (sorted); other code is kept.", "", ...block];
  const updated = `${result.join("\n")}\n`;
  if (block.length > 0 && updated !== text) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, updated);
  }
  added.sort();
  existing.sort();
  return { added, existing, path };
}

/** Icon names of the installed package containing `filter`, sorted. */
export function listIcons(from: string, cwd: string, filter = ""): string[] {
  const pkg = iconPackage(from);
  return pkg.names(packageRoot(from, cwd)).filter((n) => n.includes(filter)).sort();
}

export function iconsCommand(argv: string[]) {
  const { values: opts, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      from: { type: "string", default: "lucide-static" },
      out: { type: "string", default: "src/icons.ts" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [sub, ...rest] = positionals;
  if (opts.help || !sub) {
    (opts.help ? console.log : console.error)(ICONS_USAGE);
    if (!opts.help) process.exit(1);
    return;
  }
  try {
    if (sub === "add") {
      if (rest.length === 0) throw new Error("no icon names given: nodebuilder icons add play pause");
      const r = addIcons({ cwd: process.cwd(), from: opts.from, out: opts.out, names: rest });
      if (r.added.length) console.log(`${opts.out}: added ${r.added.join(", ")}`);
      if (r.existing.length) console.log(`${opts.out}: already there: ${r.existing.join(", ")}`);
    } else if (sub === "list") {
      for (const n of listIcons(opts.from, process.cwd(), rest[0])) console.log(n);
    } else throw new Error(`unknown subcommand "${sub}"\n\n${ICONS_USAGE}`);
  } catch (err) {
    console.error(`nodebuilder icons: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
