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

/** A system library the native core links to, with the package that ships it per distro family. */
export interface SystemLib {
  soname: string;
  /** Debian 12+ / Ubuntu 22.04+. */
  deb: string;
  /** Arch. */
  pacman: string;
}

// Keep in sync with native/platform/linux/build.sh (PKGS).
export const SYSTEM_LIBS: SystemLib[] = [
  { soname: "libwayland-client.so.0", deb: "libwayland-client0", pacman: "wayland" },
  { soname: "libwayland-egl.so.1", deb: "libwayland-egl1", pacman: "wayland" },
  { soname: "libwayland-cursor.so.0", deb: "libwayland-cursor0", pacman: "wayland" },
  { soname: "libX11.so.6", deb: "libx11-6", pacman: "libx11" },
  { soname: "libXcursor.so.1", deb: "libxcursor1", pacman: "libxcursor" },
  { soname: "libXrandr.so.2", deb: "libxrandr2", pacman: "libxrandr" },
  { soname: "libEGL.so.1", deb: "libegl1", pacman: "libglvnd" },
  { soname: "libGLESv2.so.2", deb: "libgles2", pacman: "libglvnd" },
  { soname: "libxkbcommon.so.0", deb: "libxkbcommon0", pacman: "libxkbcommon" },
  { soname: "libfreetype.so.6", deb: "libfreetype6", pacman: "freetype2" },
  { soname: "libharfbuzz.so.0", deb: "libharfbuzz0b", pacman: "harfbuzz" },
  { soname: "libfontconfig.so.1", deb: "libfontconfig1", pacman: "fontconfig" },
];

// Loaded with dlopen only to show AVIF/HEIC images (native/platform/linux/codecs.c). Suggested,
// not recommended: apt installs recommendations by default, and libheif pulls in many codecs.
export const HEIF_LIB: SystemLib = { soname: "libheif.so.1", deb: "libheif1", pacman: "libheif" };

export const DEB_DEPENDS = SYSTEM_LIBS.map((l) => l.deb);
// RPM resolves sonames, so these work on any rpm distro (Fedora, RHEL, openSUSE).
export const RPM_SONAMES = SYSTEM_LIBS.map((l) => l.soname);
export const DEB_SUGGESTS = [HEIF_LIB.deb];
export const RPM_SUGGESTS = [HEIF_LIB.soname];

/** xz-compresses with the system `xz` (multithreaded). */
export async function xz(data: Uint8Array): Promise<Uint8Array> {
  const proc = Bun.spawn(["xz", "-c", "-6", "-T0"], { stdin: data, stdout: "pipe" });
  const out = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
  if ((await proc.exited) !== 0) throw new Error("xz falhou");
  return out;
}
