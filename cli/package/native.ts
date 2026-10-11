// Builds the native addon from the framework checkout (needs native/ sources).
import { $ } from "bun";
import { join } from "node:path";

/**
 * docker: Ubuntu 22.04 container -> runs on glibc 2.34+ / libwayland 1.20+ (what we ship).
 * local:  this machine's toolchain -> needs this glibc or newer.
 */
export async function buildNative(root: string, mode: "docker" | "local"): Promise<string> {
  if (mode === "docker") {
    if ((await $`docker info`.quiet().nothrow()).exitCode !== 0) throw new Error("o build portável precisa do Docker rodando");
    const image = "nodebuilder-native-build:22.04";
    await $`docker build -q -t ${image} ${join(root, "cli/package")}`.quiet();
    const user = `${process.getuid!()}:${process.getgid!()}`;
    await $`docker run --rm --user ${user} -v ${root}:/src -w /src ${image} sh scripts/build-native.sh`;
  } else {
    await $`sh ${join(root, "scripts/build-native.sh")}`;
  }
  return join(root, `native/build/${process.platform}-${process.arch}/nodebuilder.node`);
}

/** Newest GLIBC_x.y symbol version the addon needs (= minimum glibc on the target), if objdump exists. */
export async function minGlibc(addon: string): Promise<string | undefined> {
  const symbols = await $`objdump -T ${addon}`.nothrow().quiet().text();
  const versions = (symbols.match(/GLIBC_[\d.]+/g) ?? []).map((g) => g.slice(6).split(".").map(Number));
  if (!versions.length) return undefined;
  return versions.reduce((a, b) => (b[0]! * 1000 + (b[1] ?? 0) > a[0]! * 1000 + (a[1] ?? 0) ? b : a)).join(".");
}
