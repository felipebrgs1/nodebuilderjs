// .deb = ar archive of: debian-binary, control.tar.xz, data.tar.xz.
// Written by hand (ar is trivial) so it also builds on non-Debian hosts; only `tar` and `xz` are needed.
import { $ } from "bun";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEB_DEPENDS, type PackageContext } from "./common.js";

export async function buildDeb({ app, files, tree, work, out }: PackageContext): Promise<string> {
  const dir = join(work, "deb");
  mkdirSync(join(dir, "control"), { recursive: true });

  const installedKb = Math.ceil(files.reduce((a, f) => a + statSync(f.source).size, 0) / 1024);
  const md5sums = files.map(
    (f) => `${new Bun.CryptoHasher("md5").update(readFileSync(f.source)).digest("hex")}  ${f.path.slice(1)}`,
  );
  const control = [
    `Package: ${app.name}`,
    `Version: ${app.version}`,
    `Architecture: ${app.arch.deb}`,
    `Maintainer: ${app.maintainer}`,
    `Installed-Size: ${installedKb}`,
    `Depends: ${DEB_DEPENDS.join(", ")}`,
    // GPU drivers: always there on a desktop, missing on minimal installs/containers.
    `Recommends: libgl1-mesa-dri`,
    `Section: misc`,
    `Priority: optional`,
    ...(app.homepage ? [`Homepage: ${app.homepage}`] : []),
    `Description: ${app.summary}`,
    ...app.description.split("\n").map((l) => ` ${l.trim() || "."}`),
  ].join("\n");
  writeFileSync(join(dir, "control/control"), `${control}\n`);
  writeFileSync(join(dir, "control/md5sums"), `${md5sums.join("\n")}\n`);

  const tarOpts = ["--owner=0", "--group=0", "--numeric-owner", "--sort=name", "-cJf"];
  await $`tar -C ${join(dir, "control")} ${tarOpts} ${join(dir, "control.tar.xz")} .`;
  await $`tar -C ${tree} ${tarOpts} ${join(dir, "data.tar.xz")} ./usr`.env({ ...process.env, XZ_OPT: "-6 -T0" });

  const file = join(out, `${app.name}_${app.version}_${app.arch.deb}.deb`);
  writeFileSync(
    file,
    ar([
      ["debian-binary", new TextEncoder().encode("2.0\n")],
      ["control.tar.xz", readFileSync(join(dir, "control.tar.xz"))],
      ["data.tar.xz", readFileSync(join(dir, "data.tar.xz"))],
    ]),
  );
  return file;
}

function ar(members: [name: string, data: Uint8Array][]): Uint8Array {
  const parts: Uint8Array[] = [new TextEncoder().encode("!<arch>\n")];
  const mtime = Math.floor(Date.now() / 1000);
  for (const [name, data] of members) {
    const field = (v: string | number, width: number) => String(v).padEnd(width, " ");
    const header =
      field(name, 16) + field(mtime, 12) + field(0, 6) + field(0, 6) + field("100644", 8) + field(data.length, 10) + "`\n";
    parts.push(new TextEncoder().encode(header), data);
    if (data.length % 2) parts.push(new TextEncoder().encode("\n"));
  }
  return Buffer.concat(parts);
}
