// AppImage: the staging tree becomes the AppDir (+ AppRun, .desktop and icon at the root),
// squashed by appimagetool. The tool is a dev-time download cached in ~/.cache/nodebuilder.
import { $ } from "bun";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { PackageContext } from "./common.js";

const TOOL_URL = "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-";

async function appimagetool(arch: string): Promise<string> {
  const dir = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "nodebuilder");
  const tool = join(dir, `appimagetool-${arch}.AppImage`);
  if (!existsSync(tool)) {
    mkdirSync(dir, { recursive: true });
    console.log(`  baixando appimagetool (${arch}) para ${dir}`);
    const res = await fetch(`${TOOL_URL}${arch}.AppImage`);
    if (!res.ok) throw new Error(`download do appimagetool falhou: ${res.status}`);
    await Bun.write(tool, res);
    chmodSync(tool, 0o755);
  }
  return tool;
}

export async function buildAppImage({ app, files, tree, work, out }: PackageContext): Promise<string> {
  const appDir = join(work, "AppDir");
  cpSync(tree, appDir, { recursive: true });
  symlinkSync(`usr/bin/${app.name}`, join(appDir, "AppRun"));
  copyFileSync(join(tree, files[1]!.path), join(appDir, `${app.appId}.desktop`));
  const icon = files[2]!.path;
  copyFileSync(join(tree, icon), join(appDir, basename(icon)));
  symlinkSync(basename(icon), join(appDir, `.DirIcon`));

  const file = join(out, `${app.name}-${app.version}-${app.arch.appimage}.AppImage`);
  const tool = await appimagetool(app.arch.appimage);
  // Extract-and-run: works without FUSE (containers, CI).
  await $`${tool} --no-appstream ${appDir} ${file}`
    .env({ ...process.env, ARCH: app.arch.appimage, APPIMAGE_EXTRACT_AND_RUN: "1" })
    .quiet();
  return file;
}
