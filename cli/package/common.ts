// Shared types and the runtime dependencies of the native core, per packaging system.

export interface AppInfo {
  name: string;
  title: string;
  appId: string;
  version: string;
  summary: string;
  description: string;
  license: string;
  maintainer: string;
  homepage: string;
  categories: string;
  arch: Arch;
}

export interface Arch {
  deb: string;
  rpm: string;
  /** RPM lead archnum. */
  rpmNum: number;
  appimage: string;
}

export function archOf(nodeArch: string): Arch {
  if (nodeArch === "x64") return { deb: "amd64", rpm: "x86_64", rpmNum: 1, appimage: "x86_64" };
  if (nodeArch === "arm64") return { deb: "arm64", rpm: "aarch64", rpmNum: 19, appimage: "aarch64" };
  throw new Error(`arquitetura sem suporte: ${nodeArch}`);
}

/** A file installed by the package; `path` is absolute on the target system. */
export interface StagedFile {
  path: string;
  source: string;
  mode: number;
}

export interface PackageContext {
  app: AppInfo;
  files: StagedFile[];
  /** Directory holding `files` laid out as on the target system. */
  tree: string;
  work: string;
  out: string;
}

// Keep in sync with native/platform/linux/build.sh (PKGS). Names are valid on Debian 12+ / Ubuntu 22.04+.
export const DEB_DEPENDS = [
  "libwayland-client0", "libwayland-egl1", "libwayland-cursor0", "libx11-6", "libxcursor1", "libxrandr2",
  "libegl1", "libgles2", "libxkbcommon0", "libfreetype6", "libharfbuzz0b", "libfontconfig1",
];

// RPM resolves sonames, so these work on any rpm distro (Fedora, RHEL, openSUSE).
export const RPM_SONAMES = [
  "libwayland-client.so.0", "libwayland-egl.so.1", "libwayland-cursor.so.0", "libX11.so.6", "libXcursor.so.1",
  "libXrandr.so.2", "libEGL.so.1", "libGLESv2.so.2", "libxkbcommon.so.0", "libfreetype.so.6", "libharfbuzz.so.0",
  "libfontconfig.so.1",
];

/** xz-compresses with the system `xz` (multithreaded). */
export async function xz(data: Uint8Array): Promise<Uint8Array> {
  const proc = Bun.spawn(["xz", "-c", "-6", "-T0"], { stdin: data, stdout: "pipe" });
  const out = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
  if ((await proc.exited) !== 0) throw new Error("xz falhou");
  return out;
}
