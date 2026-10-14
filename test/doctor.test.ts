// `nodebuilder doctor`: each check runs on injected probes (no machine dependency), plus the
// ELF/ldd readers on real files and one spawn of the command on this machine.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Check,
  type DoctorNative,
  type DoctorProbes,
  type NativeDiagnostics,
  diagnose,
  exitCode,
  formatReport,
  missingFromLdd,
} from "../cli/doctor.js";
import { elfGlibc } from "../cli/package/native.js";
import { loadNative } from "../src/runtime/native.js";
import { canScreenshot } from "../src/testing.js";

const healthy: NativeDiagnostics = {
  freetype: "2.14.1",
  harfbuzz: "12.1.0",
  display: { backend: "wayland", error: "", compose: true, locale: "pt_BR.UTF-8" },
  fonts: { ui: { path: "/usr/share/fonts/inter/Inter.ttf", family: "Inter" }, emoji: "/usr/share/fonts/noto/NotoColorEmoji.ttf", cjk: "/usr/share/fonts/noto-cjk/NotoSansCJK.ttc" },
  gl: null,
};

const gl = { vendor: "Intel", renderer: "Mesa Intel(R) Xe Graphics", version: "OpenGL ES 3.2 Mesa 25.2" };

function fakeNative(over: Partial<NativeDiagnostics> = {}, offscreen?: () => void): DoctorNative & { offscreenCalls: number } {
  let rendered = false;
  const native = {
    offscreenCalls: 0,
    diagnostics: () => ({ ...healthy, ...over, gl: over.gl !== undefined ? over.gl : rendered ? gl : null }),
    renderOffscreen: () => {
      native.offscreenCalls++;
      offscreen?.();
      rendered = true;
      return new Uint8Array(4);
    },
  };
  return native;
}

function probes(over: Partial<DoctorProbes> = {}): DoctorProbes {
  const native = fakeNative();
  return {
    env: { WAYLAND_DISPLAY: "wayland-0", DISPLAY: ":0" },
    target: "linux-x64",
    bun: "1.4.3",
    minBun: "1.4",
    coreVersion: "0.3.0",
    glibc: "2.39",
    installer: "apt",
    addon: { path: "/app/node_modules/@nodebuilderjs/linux-x64/nodebuilder.node", from: "@nodebuilderjs/linux-x64" },
    addonGlibc: () => "2.34",
    missingLibs: () => [],
    hasLib: () => true,
    loadNative: () => native,
    agents: () => ({ version: "0.3.0", changes: [{ path: "AGENTS.md", action: "same" }] }),
    ...over,
  };
}

const byId = (checks: Check[], id: string) => {
  const check = checks.find((c) => c.id === id);
  if (!check) throw new Error(`no check ${id}: ${checks.map((c) => c.id).join(", ")}`);
  return check;
};

describe("diagnose", () => {
  test("a healthy machine: every check passes and the report names what was found", async () => {
    const checks = await diagnose(probes());
    expect(checks.map((c) => [c.id, c.status])).toEqual([
      ["runtime", "ok"],
      ["addon", "ok"],
      ["display", "ok"],
      ["keyboard", "ok"],
      ["gl", "ok"],
      ["fonts", "ok"],
      ["emoji", "ok"],
      ["cjk", "ok"],
      ["heif", "ok"],
      ["agents", "ok"],
    ]);
    expect(exitCode(checks)).toBe(0);
    const report = formatReport(checks, { color: false });
    expect(report).toContain("✓ Bun 1.4.3");
    expect(report).toContain("@nodebuilderjs/linux-x64");
    expect(report).toContain("glibc 2.34 required, system 2.39");
    expect(report).toContain("FreeType 2.14.1");
    expect(report).toContain("Wayland (WAYLAND_DISPLAY=wayland-0)");
    expect(report).toContain("Mesa Intel(R) Xe Graphics");
    expect(report).toContain("UI font: Inter");
    expect(report).toContain("No problems found");
  });

  test("Bun older than the framework needs is a failure with the fix", async () => {
    const checks = await diagnose(probes({ bun: "1.3.9" }));
    expect(byId(checks, "runtime")).toMatchObject({ status: "fail", fix: "bun upgrade" });
    expect(byId(checks, "runtime").title).toContain("1.4");
    expect(exitCode(checks)).toBe(1);
    expect((await diagnose(probes({ bun: "1.10.0" })))[0]!.status).toBe("ok");
    expect((await diagnose(probes({ bun: undefined })))[0]!.status).toBe("fail");
  });

  test("an unsupported OS or architecture fails, and nothing native is tried", async () => {
    let loaded = false;
    const checks = await diagnose(probes({ target: "darwin-arm64", loadNative: () => ((loaded = true), fakeNative()) }));
    expect(byId(checks, "addon")).toMatchObject({ status: "fail" });
    expect(byId(checks, "addon").title).toContain("darwin-arm64");
    expect(loaded).toBe(false);
  });

  test("no addon installed: a failure with the install command; the native checks are skipped", async () => {
    const checks = await diagnose(probes({ addon: undefined, loadNative: () => { throw new Error("must not load"); } }));
    expect(byId(checks, "addon").status).toBe("fail");
    expect(byId(checks, "addon").fix).toContain("bun install");
    for (const id of ["display", "keyboard", "gl", "fonts", "emoji", "cjk"]) expect(byId(checks, id).status).toBe("skip");
    // libheif is looked up without the addon.
    expect(byId(checks, "heif").status).toBe("ok");
  });

  test("the addon needs a newer glibc than the system's", async () => {
    const checks = await diagnose(probes({ glibc: "2.31", loadNative: () => { throw new Error("GLIBC_2.34 not found"); } }));
    const addon = byId(checks, "addon");
    expect(addon.status).toBe("fail");
    expect(addon.title).toContain("glibc 2.34");
    expect(addon.title).toContain("2.31");
    expect(addon.fix).toBe("use a distro with glibc 2.34 or newer");
    expect(byId(checks, "gl").status).toBe("skip");
    // A local build needs the glibc of the machine that built it: rebuilding is the fix.
    const local = await diagnose(probes({ glibc: "2.31", addon: { path: "/repo/native/build/linux-x64/nodebuilder.node", from: "local build" } }));
    expect(byId(local, "addon").fix).toBe("rebuild it on this machine: bun run build:native");
  });

  test("missing system libraries are named with the package that has them", async () => {
    const missing = () => ["libharfbuzz.so.0", "libEGL.so.1"];
    const apt = byId(await diagnose(probes({ missingLibs: missing, loadNative: () => { throw new Error("x"); } })), "addon");
    expect(apt.status).toBe("fail");
    expect(apt.title).toContain("libharfbuzz.so.0");
    expect(apt.title).toContain("libEGL.so.1");
    expect(apt.fix).toBe("sudo apt install libharfbuzz0b libegl1");
    const dnf = byId(await diagnose(probes({ installer: "dnf", missingLibs: missing })), "addon");
    expect(dnf.fix).toBe("sudo dnf install 'libharfbuzz.so.0()(64bit)' 'libEGL.so.1()(64bit)'");
    const pacman = byId(await diagnose(probes({ installer: "pacman", missingLibs: missing })), "addon");
    expect(pacman.fix).toBe("sudo pacman -S harfbuzz libglvnd");
    // A library the table does not know (a dependency of a dependency): named, no guess.
    const other = byId(await diagnose(probes({ installer: undefined, missingLibs: () => ["libgraphite2.so.3"] })), "addon");
    expect(other.title).toContain("libgraphite2.so.3");
    expect(other.fix).toContain("libgraphite2.so.3");
  });

  test("an addon that is found but does not load reports the loader's error", async () => {
    const checks = await diagnose(probes({ addonGlibc: () => undefined, loadNative: () => { throw new Error("undefined symbol: hb_foo"); } }));
    expect(byId(checks, "addon").status).toBe("fail");
    expect(byId(checks, "addon").detail).toContain("undefined symbol: hb_foo");
  });

  test("an addon package of another version than core, or one without diagnostics, says to reinstall", async () => {
    const pkg = "/app/node_modules/@nodebuilderjs/linux-x64/nodebuilder.node";
    const other = byId(await diagnose(probes({ addon: { path: pkg, from: "@nodebuilderjs/linux-x64", version: "0.2.0" } })), "addon");
    expect(other.status).toBe("fail");
    expect(other.title).toBe("native core @nodebuilderjs/linux-x64 0.2.0 does not match @nodebuilderjs/core 0.3.0");
    expect(other.fix).toContain("bun install");
    expect(byId(await diagnose(probes({ addon: { path: pkg, from: "@nodebuilderjs/linux-x64", version: "0.3.0" } })), "addon").status).toBe("ok");

    const old = { renderOffscreen: () => new Uint8Array(4) } as unknown as DoctorNative;
    const stale = byId(await diagnose(probes({ loadNative: () => old })), "addon");
    expect(stale.status).toBe("fail");
    expect(stale.title).toContain("older than @nodebuilderjs/core");
  });

  test("display: none configured warns (screenshots still work); a configured one that refuses fails", async () => {
    const none = fakeNative({ display: { backend: null, error: "no display server", compose: false, locale: "C" } });
    const headless = await diagnose(probes({ env: {}, loadNative: () => none }));
    expect(byId(headless, "display").status).toBe("warn");
    expect(byId(headless, "display").title).toContain("screenshot");
    expect(byId(headless, "keyboard").status).toBe("skip");
    expect(exitCode(headless)).toBe(0);

    const refused = fakeNative({ display: { backend: null, error: "cannot connect to Wayland", compose: false, locale: "C" } });
    const broken = await diagnose(probes({ env: { WAYLAND_DISPLAY: "wayland-9" }, loadNative: () => refused }));
    expect(byId(broken, "display")).toMatchObject({ status: "fail", detail: "cannot connect to Wayland" });

    const x11 = fakeNative({ display: { backend: "x11", error: "", compose: true, locale: "C.UTF-8" } });
    const forced = await diagnose(probes({ env: { NB_BACKEND: "x11", DISPLAY: ":0" }, loadNative: () => x11 }));
    expect(byId(forced, "display").title).toBe("X11 (DISPLAY=:0, forced by NB_BACKEND)");
  });

  test("keyboard: no compose table for the locale warns that accents may not work", async () => {
    const native = fakeNative({ display: { backend: "wayland", error: "", compose: false, locale: "xx_YY" } });
    const keyboard = byId(await diagnose(probes({ loadNative: () => native })), "keyboard");
    expect(keyboard.status).toBe("warn");
    expect(keyboard.title).toContain("xx_YY");
    expect(keyboard.fix).toContain("UTF-8");
  });

  test("GL: rendered offscreen; a failure names the error and the driver package", async () => {
    const native = fakeNative();
    expect(byId(await diagnose(probes({ loadNative: () => native })), "gl").title).toContain("Mesa Intel(R) Xe Graphics");
    expect(native.offscreenCalls).toBe(1);

    const failing = fakeNative({}, () => { throw new Error("offscreen rendering is unavailable: no EGL device"); });
    const check = byId(await diagnose(probes({ loadNative: () => failing })), "gl");
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("no EGL device");
    expect(check.fix).toContain("libgl1-mesa-dri");
  });

  test("--window opens a real window instead of the offscreen context", async () => {
    const native = fakeNative();
    let opened = 0;
    const checks = await diagnose(
      probes({ loadNative: () => native, openWindow: async () => (opened++, { gl: { ...gl, renderer: "Window GPU" } }) }),
      { window: true },
    );
    expect(opened).toBe(1);
    expect(native.offscreenCalls).toBe(0);
    expect(byId(checks, "gl")).toMatchObject({ status: "ok" });
    expect(byId(checks, "gl").title).toContain("window");
    expect(byId(checks, "gl").title).toContain("Window GPU");

    const failed = await diagnose(probes({ openWindow: async () => { throw new Error("could not open window"); } }), { window: true });
    expect(byId(failed, "gl")).toMatchObject({ status: "fail", detail: "could not open window" });
    // No display at all: nothing to open.
    const none = fakeNative({ display: { backend: null, error: "none", compose: false, locale: "C" } });
    const headless = await diagnose(probes({ env: {}, loadNative: () => none, openWindow: async () => ({ gl }) }), { window: true });
    expect(byId(headless, "gl").status).toBe("skip");
  });

  test("fonts: no UI font fails; missing emoji or CJK fallback only warns, with the package", async () => {
    const empty = fakeNative({ fonts: { ui: null, emoji: null, cjk: null } });
    const checks = await diagnose(probes({ loadNative: () => empty }));
    expect(byId(checks, "fonts").status).toBe("fail");
    expect(byId(checks, "emoji")).toMatchObject({ status: "warn", fix: "sudo apt install fonts-noto-color-emoji" });
    expect(byId(checks, "cjk")).toMatchObject({ status: "warn", fix: "sudo apt install fonts-noto-cjk" });
    const dnf = await diagnose(probes({ installer: "dnf", loadNative: () => empty }));
    expect(byId(dnf, "emoji").fix).toBe("sudo dnf install google-noto-color-emoji-fonts");
  });

  test("libheif missing turns AVIF/HEIC off without failing", async () => {
    const checks = await diagnose(probes({ hasLib: (soname) => soname !== "libheif.so.1" }));
    expect(byId(checks, "heif")).toMatchObject({ status: "off", fix: "sudo apt install libheif1" });
    expect(exitCode(checks)).toBe(0);
    expect(formatReport(checks, { color: false })).toContain("- libheif not found: AVIF/HEIC images disabled");
  });

  test("agent docs behind the installed core warn with the update command; edited ones only count as kept", async () => {
    const stale = await diagnose(probes({
      agents: () => ({ version: "0.4.1", changes: [
        { path: "AGENTS.md", action: "update" },
        { path: ".agents/skills/nodebuilder-testing/SKILL.md", action: "add" },
        { path: ".agents/skills/nodebuilder-ui/SKILL.md", action: "keep" },
      ] }),
    }));
    expect(byId(stale, "agents")).toMatchObject({ status: "warn", fix: "bun run agents:update (or bunx nodebuilder agents update)" });
    expect(byId(stale, "agents").title).toBe("agent docs (AGENTS.md, skills): 2 behind @nodebuilderjs/core 0.4.1");
    expect(exitCode(stale)).toBe(0);
    const edited = byId(await diagnose(probes({ agents: () => ({ version: "0.4.1", changes: [{ path: "AGENTS.md", action: "keep" }] }) })), "agents");
    expect(edited.status).toBe("ok");
    expect(edited.title).toContain("1 edited in this app");
    expect(byId(await diagnose(probes({ agents: () => undefined })), "agents").status).toBe("skip");
  });

  test("the report: fixes under their check, a summary line, ANSI colors only when asked", async () => {
    const checks = await diagnose(probes({ bun: "1.0.0", hasLib: () => false }));
    const plain = formatReport(checks, { color: false });
    expect(plain).toContain("✗ Bun 1.0.0");
    expect(plain).toMatch(/✗ Bun 1\.0\.0[^\n]*\n\s+→ bun upgrade/);
    expect(plain).toContain("1 problem");
    expect(plain).not.toContain("\x1b[");
    expect(formatReport(checks, { color: true })).toContain("\x1b[");
  });
});

describe("binary readers", () => {
  test("elfGlibc: the newest GLIBC_x.y a binary needs, same as objdump", () => {
    const bin = process.execPath;
    const fromElf = elfGlibc(new Uint8Array(readFileSync(bin)));
    expect(fromElf).toMatch(/^2\.\d+$/);
    const objdump = Bun.spawnSync(["objdump", "-T", bin]);
    if (objdump.exitCode === 0) {
      const versions = objdump.stdout.toString().match(/GLIBC_2\.\d+/g)!.map((v) => Number(v.split(".")[1]));
      expect(fromElf).toBe(`2.${Math.max(...versions)}`);
    }
    expect(elfGlibc(new TextEncoder().encode("#!/bin/sh\n"))).toBeUndefined();
    expect(elfGlibc(new Uint8Array(70).fill(0x7f))).toBeUndefined();
  });

  test("missingFromLdd: the sonames ldd could not find", () => {
    const out = `\tlinux-vdso.so.1 (0x00007ffc)
\tlibharfbuzz.so.0 => not found
\tlibEGL.so.1 => /usr/lib/libEGL.so.1 (0x00007f57)
\tlibgraphite2.so.3 => not found
\t/lib64/ld-linux-x86-64.so.2 (0x00007f57)`;
    expect(missingFromLdd(out)).toEqual(["libharfbuzz.so.0", "libgraphite2.so.3"]);
    expect(missingFromLdd("")).toEqual([]);
  });
});

describe("on this machine", () => {
  const built = existsSync(join(import.meta.dir, "../native/build/linux-x64/nodebuilder.node"));

  test.skipIf(!built)("native diagnostics: versions, display probe and fonts in the documented shape", () => {
    const d = loadNative().diagnostics();
    expect(d.freetype).toMatch(/^\d+\.\d+\.\d+$/);
    expect(d.harfbuzz).toMatch(/^\d+\.\d+\.\d+$/);
    expect(typeof d.display.compose).toBe("boolean");
    expect(d.display.backend === null ? d.display.error.length > 0 : ["wayland", "x11"].includes(d.display.backend)).toBe(true);
    expect(d.fonts.ui?.family.length).toBeGreaterThan(0);
  });

  test.skipIf(!built || !canScreenshot())("native diagnostics: the GL strings of the current context", () => {
    const native = loadNative();
    native.renderOffscreen(1, 1, 1, new Float32Array(0), []);
    expect(native.diagnostics().gl?.renderer.length).toBeGreaterThan(0);
  });

  test("nodebuilder doctor --json: every check, parseable, exit code matching the failures", () => {
    const p = Bun.spawnSync([process.execPath, join(import.meta.dir, "../cli/nodebuilder.ts"), "doctor", "--json"]);
    const report = JSON.parse(p.stdout.toString()) as { version: string; checks: Check[] };
    expect(report.checks.map((c) => c.id)).toEqual(["runtime", "addon", "display", "keyboard", "gl", "fonts", "emoji", "cjk", "heif", "agents"]);
    // The framework's own repo is not an app: no agent docs to compare.
    expect(report.checks.at(-1)!.status).toBe("skip");
    expect(p.exitCode).toBe(report.checks.some((c) => c.status === "fail") ? 1 : 0);
    if (built) expect(report.checks[1]!.status).toBe("ok");
  });
});
