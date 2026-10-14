// `nodebuilder doctor`: checks that this machine can run a nodebuilder app (runtime, native core,
// system libraries, display, GL, fonts) and says how to fix what is missing. Each check reads
// injected probes, so the tests run without depending on the machine. The checks that need the
// addon are skipped (not crashed) when it does not load: that is when the report matters most.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { type Native, loadNative } from "../src/runtime/native.js";
import { type Change, planAgents, readAgentDocs } from "./agents.js";
import { HEIF_LIB, SYSTEM_LIBS, type SystemLib } from "./package/common.js";
import { atLeast, elfGlibc } from "./package/native.js";

export type Status = "ok" | "warn" | "fail" | "off" | "skip";

export interface Check {
  id: string;
  status: Status;
  /** One line: what was found. */
  title: string;
  /** More about it (an error message, a path). */
  detail?: string;
  /** What to do about it: a command when there is one. */
  fix?: string;
}

/** What the addon reports about the machine (see `Native.diagnostics()`). */
export type NativeDiagnostics = ReturnType<Native["diagnostics"]>;
export type GLInfo = NonNullable<NativeDiagnostics["gl"]>;

export type DoctorNative = Pick<Native, "diagnostics" | "renderOffscreen">;

export type Installer = "apt" | "dnf" | "pacman";

export interface DoctorProbes {
  env: Record<string, string | undefined>;
  /** `${process.platform}-${process.arch}` */
  target: string;
  bun: string | undefined;
  /** The Bun version the framework needs (`engines.bun`). */
  minBun: string;
  /** @nodebuilderjs/core's version: the addon package must have the same. */
  coreVersion: string;
  /** The system's glibc. */
  glibc: string | undefined;
  installer: Installer | undefined;
  /** The addon file loadNative() would load, where it comes from and its package's version. */
  addon: { path: string; from: string; version?: string } | undefined;
  /** The glibc the addon needs. */
  addonGlibc(path: string): string | undefined;
  /** Sonames the addon (or what it links to) needs and the system lacks. */
  missingLibs(path: string): string[];
  hasLib(soname: string): boolean;
  loadNative(): DoctorNative;
  /**
   * What `nodebuilder agents update` would do to the app in the current folder (undefined when
   * it is not an app that depends on @nodebuilderjs/core), and the docs' version.
   */
  agents(): { version: string; changes: Change[] } | undefined;
  /** Opens a small window, draws a frame and closes it (`--window`). */
  openWindow?(): Promise<{ gl: GLInfo | null }>;
}

const SUPPORTED = ["linux-x64", "linux-arm64"];
const NATIVE_IDS = ["display", "keyboard", "gl", "fonts", "emoji", "cjk"];

type Packages = Record<Installer, string>;

function installCommand(installer: Installer | undefined, packages: Packages[]): string {
  const unique = (list: string[]) => [...new Set(list)].join(" ");
  if (installer === "apt") return `sudo apt install ${unique(packages.map((p) => p.apt))}`;
  if (installer === "dnf") return `sudo dnf install ${unique(packages.map((p) => p.dnf))}`;
  if (installer === "pacman") return `sudo pacman -S ${unique(packages.map((p) => p.pacman))}`;
  return `install ${unique(packages.map((p) => p.apt))} (apt) or ${unique(packages.map((p) => p.dnf))} (dnf)`;
}

function libPackages(lib: SystemLib, target: string): Packages {
  const suffix = target.endsWith("64") ? "()(64bit)" : "";
  return { apt: lib.deb, dnf: `'${lib.soname}${suffix}'`, pacman: lib.pacman };
}

const FONT_PACKAGES = {
  ui: { apt: "fonts-noto-core", dnf: "google-noto-sans-fonts", pacman: "noto-fonts" },
  emoji: { apt: "fonts-noto-color-emoji", dnf: "google-noto-color-emoji-fonts", pacman: "noto-fonts-emoji" },
  cjk: { apt: "fonts-noto-cjk", dnf: "google-noto-sans-cjk-ttc-fonts", pacman: "noto-fonts-cjk" },
};
const MESA = { apt: "libgl1-mesa-dri libegl-mesa0", dnf: "mesa-dri-drivers mesa-libEGL", pacman: "mesa" };
const X11_LOCALES = { apt: "libx11-data", dnf: "libX11-common", pacman: "libx11" };

function runtimeCheck(p: DoctorProbes): Check {
  if (!p.bun) return { id: "runtime", status: "fail", title: "Bun not found: the nodebuilder command runs on Bun", fix: "curl -fsSL https://bun.sh/install | bash" };
  if (!atLeast(p.bun, p.minBun)) return { id: "runtime", status: "fail", title: `Bun ${p.bun} (needs ${p.minBun} or newer)`, fix: "bun upgrade" };
  return { id: "runtime", status: "ok", title: `Bun ${p.bun}` };
}

/** The addon check, and the loaded addon when it loads. */
function addonCheck(p: DoctorProbes): { check: Check; native?: DoctorNative; diagnostics?: NativeDiagnostics } {
  const fail = (title: string, extra: Partial<Check> = {}) => ({ check: { id: "addon", status: "fail" as const, title, ...extra } });
  if (!SUPPORTED.includes(p.target)) return fail(`native core: ${p.target} is not supported yet (Linux x64 and arm64 only)`);
  if (!p.addon) {
    return fail(`native core not found (@nodebuilderjs/${p.target})`, {
      fix: "bun install (it brings @nodebuilderjs/" + p.target + "); in the framework repo: bun run build:native",
    });
  }
  const { path, from } = p.addon;
  const reinstall = `bun install (core pins its native package to the same version)`;
  if (p.addon.version && p.addon.version !== p.coreVersion) {
    return fail(`native core ${from} ${p.addon.version} does not match @nodebuilderjs/core ${p.coreVersion}`, { detail: path, fix: reinstall });
  }
  const required = p.addonGlibc(path);
  if (required && p.glibc && !atLeast(p.glibc, required)) {
    return fail(`native core needs glibc ${required}, the system has ${p.glibc}`, {
      detail: path,
      // A local build needs the glibc of the machine that built it; the published one, 2.34.
      fix: from === "local build" ? "rebuild it on this machine: bun run build:native" : `use a distro with glibc ${required} or newer`,
    });
  }
  const missing = p.missingLibs(path);
  if (missing.length) {
    const known = missing.map((soname) => SYSTEM_LIBS.find((l) => l.soname === soname));
    const packages = known.filter((l): l is SystemLib => !!l).map((l) => libPackages(l, p.target));
    const unknown = missing.filter((_, i) => !known[i]);
    const fixes = [packages.length ? installCommand(p.installer, packages) : "", unknown.length ? `install the package that provides ${unknown.join(", ")}` : ""];
    return fail(`missing system libraries: ${missing.join(", ")}`, { detail: path, fix: fixes.filter(Boolean).join("; ") });
  }
  let native: DoctorNative;
  let diagnostics: NativeDiagnostics;
  try {
    native = p.loadNative();
    if (typeof native.diagnostics !== "function") {
      return fail(`native core ${from} is older than @nodebuilderjs/core ${p.coreVersion}`, { detail: path, fix: from === "local build" ? "bun run build:native" : reinstall });
    }
    diagnostics = native.diagnostics();
  } catch (err) {
    return fail("native core failed to load", { detail: (err as Error).message });
  }
  const glibc = required && p.glibc ? ` (glibc ${required} required, system ${p.glibc})` : "";
  const title = `native core: ${from}${glibc} · FreeType ${diagnostics.freetype} · HarfBuzz ${diagnostics.harfbuzz}`;
  return { check: { id: "addon", status: "ok", title, detail: path }, native, diagnostics };
}

function displayCheck(p: DoctorProbes, d: NativeDiagnostics): Check {
  const { backend, error } = d.display;
  const forced = p.env.NB_BACKEND ? ", forced by NB_BACKEND" : "";
  if (backend === "wayland") {
    const where = p.env.WAYLAND_DISPLAY ? `WAYLAND_DISPLAY=${p.env.WAYLAND_DISPLAY}` : "default socket";
    return { id: "display", status: "ok", title: `Wayland (${where}${forced})` };
  }
  if (backend) return { id: "display", status: "ok", title: `${backend === "x11" ? "X11" : backend} (DISPLAY=${p.env.DISPLAY ?? "?"}${forced})` };
  if (!p.env.WAYLAND_DISPLAY && !p.env.DISPLAY && !p.env.NB_BACKEND) {
    return { id: "display", status: "warn", title: "no display server: windows will not open (screenshots still work)", detail: error };
  }
  return {
    id: "display",
    status: "fail",
    title: "cannot reach the display server",
    detail: error,
    fix: "check that the compositor is running and WAYLAND_DISPLAY/DISPLAY point to it (NB_BACKEND=x11 tries XWayland)",
  };
}

function keyboardCheck(p: DoctorProbes, d: NativeDiagnostics): Check {
  if (!d.display.backend) return { id: "keyboard", status: "skip", title: "keyboard: skipped, no display server" };
  if (d.display.compose) return { id: "keyboard", status: "ok", title: `compose table for ${d.display.locale} (dead keys, accents)` };
  return {
    id: "keyboard",
    status: "warn",
    title: `no compose table for ${d.display.locale}: dead keys and accents may not work`,
    fix: `use a UTF-8 locale (LANG=en_US.UTF-8; locale -a lists them) and ${installCommand(p.installer, [X11_LOCALES])}`,
  };
}

async function glCheck(p: DoctorProbes, native: DoctorNative, d: NativeDiagnostics, window: boolean): Promise<Check> {
  const describe = (gl: GLInfo | null) => (gl ? `${gl.renderer} (${gl.version})` : "OK");
  if (window) {
    if (!d.display.backend) return { id: "gl", status: "skip", title: "GLES window: skipped, no display server" };
    if (!p.openWindow) return { id: "gl", status: "skip", title: "GLES window: not available" };
    try {
      const { gl } = await p.openWindow();
      return { id: "gl", status: "ok", title: `GLES window: ${describe(gl)}`, detail: gl?.vendor };
    } catch (err) {
      return {
        id: "gl",
        status: "fail",
        title: "GLES window: could not open and draw a window",
        detail: (err as Error).message,
        fix: `run with NB_DEBUG=1 for the backend's reason; ${installCommand(p.installer, [MESA])}`,
      };
    }
  }
  try {
    native.renderOffscreen(1, 1, 1, new Float32Array(0), []);
    const gl = native.diagnostics().gl;
    return { id: "gl", status: "ok", title: `GLES offscreen: ${describe(gl)}`, detail: gl?.vendor };
  } catch (err) {
    return { id: "gl", status: "fail", title: "GLES offscreen: no usable EGL driver", detail: (err as Error).message, fix: installCommand(p.installer, [MESA]) };
  }
}

function fontChecks(p: DoctorProbes, d: NativeDiagnostics): Check[] {
  const { ui, emoji, cjk } = d.fonts;
  return [
    ui
      ? { id: "fonts", status: "ok", title: `UI font: ${ui.family}`, detail: ui.path }
      : { id: "fonts", status: "fail", title: "no fonts found: text will not render", fix: installCommand(p.installer, [FONT_PACKAGES.ui]) },
    emoji
      ? { id: "emoji", status: "ok", title: `color emoji: ${basename(emoji)}`, detail: emoji }
      : { id: "emoji", status: "warn", title: "no color emoji font: emoji draw as boxes or in monochrome", fix: installCommand(p.installer, [FONT_PACKAGES.emoji]) },
    cjk
      ? { id: "cjk", status: "ok", title: `CJK: ${basename(cjk)}`, detail: cjk }
      : { id: "cjk", status: "warn", title: "no CJK font: Chinese, Japanese and Korean text draw as boxes", fix: installCommand(p.installer, [FONT_PACKAGES.cjk]) },
  ];
}

function heifCheck(p: DoctorProbes): Check {
  if (p.hasLib(HEIF_LIB.soname)) return { id: "heif", status: "ok", title: "libheif: AVIF/HEIC images enabled" };
  return { id: "heif", status: "off", title: "libheif not found: AVIF/HEIC images disabled", fix: installCommand(p.installer, [libPackages(HEIF_LIB, p.target)]) };
}

function agentsCheck(p: DoctorProbes): Check {
  const docs = p.agents();
  if (!docs) return { id: "agents", status: "skip", title: "agent docs: not in an app folder" };
  const behind = docs.changes.filter((c) => c.action === "add" || c.action === "update" || c.action === "remove").length;
  const kept = docs.changes.filter((c) => c.action === "keep").length;
  const edited = kept ? ` (${kept} edited in this app, kept)` : "";
  if (behind) {
    return {
      id: "agents",
      status: "warn",
      title: `agent docs (AGENTS.md, skills): ${behind} behind @nodebuilderjs/core ${docs.version}`,
      detail: edited.trim() || undefined,
      fix: "bun run agents:update (or bunx nodebuilder agents update)",
    };
  }
  return { id: "agents", status: "ok", title: `agent docs match @nodebuilderjs/core ${docs.version}${edited}` };
}

export async function diagnose(p: DoctorProbes, options: { window?: boolean } = {}): Promise<Check[]> {
  const checks = [runtimeCheck(p)];
  const addon = addonCheck(p);
  checks.push(addon.check);
  if (addon.native && addon.diagnostics) {
    const d = addon.diagnostics;
    checks.push(displayCheck(p, d), keyboardCheck(p, d), await glCheck(p, addon.native, d, !!options.window), ...fontChecks(p, d));
  } else {
    for (const id of NATIVE_IDS) checks.push({ id, status: "skip", title: `${id}: skipped, the native core did not load` });
  }
  checks.push(heifCheck(p), agentsCheck(p));
  return checks;
}

export const exitCode = (checks: Check[]) => (checks.some((c) => c.status === "fail") ? 1 : 0);

const SYMBOLS: Record<Status, [string, string]> = {
  ok: ["✓", "32"],
  warn: ["!", "33"],
  fail: ["✗", "31"],
  off: ["-", "2"],
  skip: ["·", "2"],
};

export function formatReport(checks: Check[], options: { color: boolean }): string {
  const paint = (code: string, text: string) => (options.color ? `\x1b[${code}m${text}\x1b[0m` : text);
  const lines: string[] = [];
  for (const c of checks) {
    const [symbol, code] = SYMBOLS[c.status];
    lines.push(`${paint(code, symbol)} ${c.title}`);
    if (c.detail && (c.status === "fail" || c.status === "warn")) lines.push(paint("2", `    ${c.detail}`));
    if (c.fix && c.status !== "ok") lines.push(`    → ${c.fix}`);
  }
  const count = (status: Status, word: string) => {
    const n = checks.filter((c) => c.status === status).length;
    return n ? `${n} ${word}${n > 1 ? "s" : ""}` : "";
  };
  const summary = [count("fail", "problem"), count("warn", "warning")].filter(Boolean).join(", ");
  lines.push("", summary ? `${summary}.` : "No problems found.");
  return lines.join("\n");
}

// ---- binary readers ---------------------------------------------------------------------

/** The sonames `ldd` printed as "not found". */
export function missingFromLdd(output: string): string[] {
  return [...output.matchAll(/^\s*(\S+) => not found/gm)].map((m) => m[1]!);
}

// ---- the command -------------------------------------------------------------------------

function installerOf(osRelease: string): Installer | undefined {
  const ids = [/^ID=(.*)$/m, /^ID_LIKE=(.*)$/m].flatMap((re) => (re.exec(osRelease)?.[1] ?? "").replaceAll('"', "").split(/\s+/));
  if (ids.some((id) => id === "debian" || id === "ubuntu")) return "apt";
  if (ids.some((id) => id === "fedora" || id === "rhel" || id === "centos")) return "dnf";
  if (ids.some((id) => id === "arch")) return "pacman";
  return undefined;
}

const read = (path: string) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};

/** The same candidates as loadNative(), in the same order. */
function findAddon(target: string): DoctorProbes["addon"] {
  const local = join(import.meta.dir, "../native/build", target, "nodebuilder.node");
  if (existsSync(local)) return { path: local, from: "local build" };
  try {
    const path = createRequire(join(import.meta.dir, "../src/runtime/native.ts")).resolve(`@nodebuilderjs/${target}/nodebuilder.node`);
    const version = JSON.parse(read(join(dirname(path), "package.json")) || "{}").version;
    return { path, from: `@nodebuilderjs/${target}`, version };
  } catch {
    return undefined;
  }
}

function run(cmd: string[]): string {
  try {
    const p = Bun.spawnSync(cmd, { stderr: "ignore" });
    return p.exitCode === 0 ? p.stdout.toString() : "";
  } catch {
    return ""; // not installed
  }
}

const LIB_DIRS = ["/usr/lib64", "/usr/lib", "/lib64", "/lib", "/usr/lib/x86_64-linux-gnu", "/usr/lib/aarch64-linux-gnu"];
let ldconfigCache: string | undefined;

function openWindow(native: Native): Promise<{ gl: GLInfo | null }> {
  return new Promise((resolve, reject) => {
    let done = false, drawn = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const gl = native.diagnostics().gl;
      native.close();
      err ? reject(err) : resolve({ gl });
    };
    const timer = setTimeout(() => finish(new Error("the window opened but no frame came back within 5 s")), 5000);
    try {
      native.open({ title: "nodebuilder doctor", appId: "dev.nodebuilder.doctor", width: 240, height: 160 }, (events) => {
        for (const e of events) {
          if (e.type === "configure" && !drawn) {
            drawn = true;
            native.render(new Float32Array(0), []);
          } else if (e.type === "frame" && drawn) finish();
          else if (e.type === "close") finish(new Error("the window was closed"));
        }
      });
    } catch (err) {
      done = true;
      clearTimeout(timer);
      reject(err);
    }
  });
}

export function systemProbes(): DoctorProbes {
  const pkg = JSON.parse(read(join(import.meta.dir, "../package.json")) || "{}");
  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined;
  return {
    env: process.env,
    target: `${process.platform}-${process.arch}`,
    bun: process.versions.bun,
    minBun: String(pkg.engines?.bun ?? "0").replace(/^[^\d]*/, ""),
    coreVersion: String(pkg.version),
    glibc: report?.header?.glibcVersionRuntime,
    installer: installerOf(read("/etc/os-release")),
    addon: findAddon(`${process.platform}-${process.arch}`),
    addonGlibc: (path) => elfGlibc(new Uint8Array(readFileSync(path))),
    missingLibs: (path) => missingFromLdd(run(["ldd", path])),
    hasLib: (soname) => {
      if (LIB_DIRS.some((dir) => existsSync(join(dir, soname)))) return true;
      ldconfigCache ??= run(["ldconfig", "-p"]) || run(["/sbin/ldconfig", "-p"]);
      return ldconfigCache.includes(soname);
    },
    loadNative,
    agents: () => {
      const pkg = JSON.parse(read(join(process.cwd(), "package.json")) || "{}");
      if (!pkg.dependencies?.["@nodebuilderjs/core"] && !pkg.devDependencies?.["@nodebuilderjs/core"]) return undefined;
      const docs = readAgentDocs();
      return { version: docs.version, changes: planAgents(process.cwd(), docs, {}) };
    },
    openWindow: () => openWindow(loadNative()),
  };
}

export const DOCTOR_USAGE = `usage: nodebuilder doctor [--json] [--window]

  Checks that this machine can run a nodebuilder app: Bun, the native core and the system
  libraries it needs, the display server, GL, fonts and optional codecs, with the command
  that fixes each problem. Exits 1 when something is broken (warnings do not count).

  --json     machine-readable output: { version, checks: [{ id, status, title, detail?, fix? }] }
  --window   opens a small window for a moment to test GL on the display server (by default
             GL is tested offscreen, without a window)`;

export async function doctorCommand(args: string[], version: string): Promise<void> {
  const { values: opts } = parseArgs({
    args,
    options: { json: { type: "boolean" }, window: { type: "boolean" }, help: { type: "boolean", short: "h" } },
  });
  if (opts.help) {
    console.log(DOCTOR_USAGE);
    return;
  }
  const checks = await diagnose(systemProbes(), { window: opts.window });
  if (opts.json) console.log(JSON.stringify({ version, checks }, null, 2));
  else console.log(`nodebuilder ${version} doctor\n\n${formatReport(checks, { color: !!process.stdout.isTTY && !process.env.NO_COLOR })}`);
  process.exitCode = exitCode(checks);
}
