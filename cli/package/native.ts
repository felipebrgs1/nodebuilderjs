// Builds the native addon from the framework checkout (needs native/ sources).
import { $ } from "bun";
import { join } from "node:path";

/**
 * docker: Ubuntu 22.04 container -> runs on glibc 2.34+ / libwayland 1.20+ (what we ship).
 * local:  this machine's toolchain -> needs this glibc or newer.
 */
export async function buildNative(root: string, mode: "docker" | "local"): Promise<string> {
  if (mode === "docker") {
    if ((await $`docker info`.quiet().nothrow()).exitCode !== 0) throw new Error("the portable build needs Docker running");
    const image = "nodebuilder-native-build:22.04";
    await $`docker build -q -t ${image} ${join(root, "cli/package")}`.quiet();
    const user = `${process.getuid!()}:${process.getgid!()}`;
    await $`docker run --rm --user ${user} -v ${root}:/src -w /src ${image} sh scripts/build-native.sh`;
  } else {
    await $`sh ${join(root, "scripts/build-native.sh")}`;
  }
  return join(root, `native/build/${process.platform}-${process.arch}/nodebuilder.node`);
}

const version = (v: string) => v.split(".").map(Number);

/** a >= b, by numeric parts ("1.10" > "1.4"). */
export function atLeast(a: string, b: string): boolean {
  const x = version(a), y = version(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d > 0;
  }
  return true;
}

const SHT_GNU_VERNEED = 0x6ffffffe;

/**
 * The newest GLIBC_x.y version a 64-bit little-endian ELF file needs (its .gnu.version_r
 * section), which is the oldest glibc it runs on; undefined for anything else.
 */
export function elfGlibc(bytes: Uint8Array): string | undefined {
  if (bytes.length < 64 || bytes[0] !== 0x7f || bytes[1] !== 0x45 || bytes[2] !== 0x4c || bytes[3] !== 0x46) return undefined;
  if (bytes[4] !== 2 || bytes[5] !== 1) return undefined; // ELFCLASS64, little-endian
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o: number) => view.getUint16(o, true);
  const u32 = (o: number) => view.getUint32(o, true);
  const u64 = (o: number) => Number(view.getBigUint64(o, true));
  const inside = (o: number, n: number) => o >= 0 && o + n <= bytes.length;
  const shoff = u64(0x28), shentsize = u16(0x3a), shnum = u16(0x3c);
  if (!shoff || shentsize < 64 || !inside(shoff, shentsize * shnum)) return undefined;
  const section = (i: number) => {
    const o = shoff + i * shentsize;
    return { type: u32(o + 4), offset: u64(o + 24), size: u64(o + 32), link: u32(o + 40), info: u32(o + 44) };
  };
  let best: number[] | undefined;
  for (let i = 0; i < shnum; i++) {
    const s = section(i);
    if (s.type !== SHT_GNU_VERNEED || !inside(s.offset, s.size) || s.link >= shnum) continue;
    const strings = section(s.link);
    const name = (o: number) => {
      let end = strings.offset + o;
      while (end < bytes.length && bytes[end]) end++;
      return new TextDecoder().decode(bytes.subarray(strings.offset + o, end));
    };
    // vn_info entries: Verneed { version u16, cnt u16, file u32, aux u32, next u32 }, each with
    // cnt Vernaux { hash u32, flags u16, other u16, name u32, next u32 }.
    let need = s.offset;
    for (let n = 0; n < s.info && inside(need, 16); n++) {
      let aux = need + u32(need + 8);
      for (let a = 0; a < u16(need + 2) && inside(aux, 16); a++) {
        const match = /^GLIBC_(\d+(?:\.\d+)*)$/.exec(name(u32(aux + 8)));
        if (match) {
          const v = version(match[1]!);
          if (!best || !atLeast(best.join("."), v.join("."))) best = v;
        }
        if (!u32(aux + 12)) break;
        aux += u32(aux + 12);
      }
      if (!u32(need + 12)) break;
      need += u32(need + 12);
    }
  }
  return best?.join(".");
}
