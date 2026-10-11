// Writes an RPM v4 package directly (no rpmbuild needed):
//   lead (96 B) | signature header (padded to 8) | main header | xz-compressed cpio (newc) payload
// Headers carry an immutable region (tags 62/63) and SHA-256 digests, as rpm >= 4.16 expects.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type PackageContext, RPM_SONAMES, RPM_SUGGESTS, xz } from "./common.js";

const T = { CHAR: 1, INT16: 3, INT32: 4, STRING: 6, BIN: 7, STRING_ARRAY: 8, I18NSTRING: 9 } as const;
type TagType = (typeof T)[keyof typeof T];
type Entry = { tag: number; type: TagType; value: string | string[] | number[] | Uint8Array };

// RPMSENSE flags
const EQUAL = 0x08;
const LESS = 0x02;
const RPMLIB = 0x1000000;

export async function buildRpm({ app, files, out }: PackageContext): Promise<string> {
  const release = "1";
  const mtime = Math.floor(Date.now() / 1000);
  const data = files.map((f) => readFileSync(f.source));
  const cpio = cpioNewc(files.map((f, i) => ({ name: `.${f.path}`, mode: 0o100000 | f.mode, mtime, data: data[i]! })));
  const payload = await xz(cpio);

  const dirs: string[] = [];
  const dirIndexes = files.map((f) => {
    const d = f.path.slice(0, f.path.lastIndexOf("/") + 1);
    if (!dirs.includes(d)) dirs.push(d);
    return dirs.indexOf(d);
  });
  const evr = `${app.version}-${release}`;
  const archTag = `${app.name}(${app.arch.rpm === "x86_64" ? "x86-64" : app.arch.rpm})`;
  const lib64 = app.arch.rpm === "x86_64" || app.arch.rpm === "aarch64" ? "(64bit)" : "";
  const requires: [string, number, string][] = [
    ...RPM_SONAMES.map((s): [string, number, string] => [`${s}()${lib64}`, 0, ""]),
    ["rpmlib(CompressedFileNames)", RPMLIB | LESS | EQUAL, "3.0.4-1"],
    ["rpmlib(FileDigests)", RPMLIB | LESS | EQUAL, "4.6.0-1"],
    ["rpmlib(PayloadFilesHavePrefix)", RPMLIB | LESS | EQUAL, "4.0-1"],
    ["rpmlib(PayloadIsXz)", RPMLIB | LESS | EQUAL, "5.2-1"],
  ].sort((a, b) => (a[0] < b[0] ? -1 : 1)) as [string, number, string][];

  const header = buildHeader(63, [
    { tag: 100, type: T.STRING_ARRAY, value: ["C"] }, // HEADERI18NTABLE
    { tag: 1000, type: T.STRING, value: app.name },
    { tag: 1001, type: T.STRING, value: app.version },
    { tag: 1002, type: T.STRING, value: release },
    { tag: 1004, type: T.I18NSTRING, value: app.summary },
    { tag: 1005, type: T.I18NSTRING, value: app.description },
    { tag: 1006, type: T.INT32, value: [mtime] }, // BUILDTIME
    { tag: 1007, type: T.STRING, value: "nodebuilder" }, // BUILDHOST
    { tag: 1009, type: T.INT32, value: [data.reduce((a, d) => a + d.length, 0)] }, // SIZE
    { tag: 1014, type: T.STRING, value: app.license },
    { tag: 1015, type: T.STRING, value: app.maintainer }, // PACKAGER
    { tag: 1016, type: T.I18NSTRING, value: "Unspecified" }, // GROUP
    ...(app.homepage ? [{ tag: 1020, type: T.STRING, value: app.homepage } as Entry] : []),
    { tag: 1021, type: T.STRING, value: "linux" },
    { tag: 1022, type: T.STRING, value: app.arch.rpm },
    { tag: 1028, type: T.INT32, value: data.map((d) => d.length) }, // FILESIZES
    { tag: 1030, type: T.INT16, value: files.map((f) => 0o100000 | f.mode) }, // FILEMODES
    { tag: 1033, type: T.INT16, value: files.map(() => 0) }, // FILERDEVS
    { tag: 1034, type: T.INT32, value: files.map(() => mtime) }, // FILEMTIMES
    { tag: 1035, type: T.STRING_ARRAY, value: data.map((d) => sha256(d)) }, // FILEDIGESTS
    { tag: 1036, type: T.STRING_ARRAY, value: files.map(() => "") }, // FILELINKTOS
    { tag: 1037, type: T.INT32, value: files.map(() => 0) }, // FILEFLAGS
    { tag: 1039, type: T.STRING_ARRAY, value: files.map(() => "root") }, // FILEUSERNAME
    { tag: 1040, type: T.STRING_ARRAY, value: files.map(() => "root") }, // FILEGROUPNAME
    { tag: 1044, type: T.STRING, value: `${app.name}-${evr}.src.rpm` }, // SOURCERPM (marks a binary package)
    { tag: 1047, type: T.STRING_ARRAY, value: [app.name, archTag] }, // PROVIDENAME
    { tag: 1048, type: T.INT32, value: requires.map((r) => r[1]) }, // REQUIREFLAGS
    { tag: 1049, type: T.STRING_ARRAY, value: requires.map((r) => r[0]) }, // REQUIRENAME
    { tag: 1050, type: T.STRING_ARRAY, value: requires.map((r) => r[2]) }, // REQUIREVERSION
    { tag: 1064, type: T.STRING, value: "4.18.0" }, // RPMVERSION
    { tag: 1095, type: T.INT32, value: files.map(() => 1) }, // FILEDEVICES
    { tag: 1096, type: T.INT32, value: files.map((_, i) => i + 1) }, // FILEINODES
    { tag: 1097, type: T.STRING_ARRAY, value: files.map(() => "") }, // FILELANGS
    { tag: 1112, type: T.INT32, value: [EQUAL, EQUAL] }, // PROVIDEFLAGS
    { tag: 5049, type: T.STRING_ARRAY, value: RPM_SUGGESTS.map((s) => `${s}()${lib64}`) }, // SUGGESTNAME
    { tag: 5050, type: T.STRING_ARRAY, value: RPM_SUGGESTS.map(() => "") }, // SUGGESTVERSION
    { tag: 5051, type: T.INT32, value: RPM_SUGGESTS.map(() => 0) }, // SUGGESTFLAGS
    { tag: 1113, type: T.STRING_ARRAY, value: [evr, evr] }, // PROVIDEVERSION
    { tag: 1116, type: T.INT32, value: dirIndexes }, // DIRINDEXES
    { tag: 1117, type: T.STRING_ARRAY, value: files.map((f) => f.path.slice(f.path.lastIndexOf("/") + 1)) }, // BASENAMES
    { tag: 1118, type: T.STRING_ARRAY, value: dirs }, // DIRNAMES
    { tag: 1124, type: T.STRING, value: "cpio" }, // PAYLOADFORMAT
    { tag: 1125, type: T.STRING, value: "xz" }, // PAYLOADCOMPRESSOR
    { tag: 1126, type: T.STRING, value: "6" }, // PAYLOADFLAGS
    { tag: 5011, type: T.INT32, value: [8] }, // FILEDIGESTALGO = SHA-256
    { tag: 5092, type: T.STRING_ARRAY, value: [sha256(payload)] }, // PAYLOADDIGEST
    { tag: 5093, type: T.INT32, value: [8] }, // PAYLOADDIGESTALGO
  ]);

  const md5 = new Bun.CryptoHasher("md5").update(header).update(payload).digest() as Uint8Array;
  const signature = buildHeader(62, [
    { tag: 269, type: T.STRING, value: sha1(header) }, // SHA1 of header
    { tag: 273, type: T.STRING, value: sha256(header) }, // SHA256 of header
    { tag: 1000, type: T.INT32, value: [header.length + payload.length] }, // SIZE
    { tag: 1004, type: T.BIN, value: new Uint8Array(md5) }, // MD5 of header+payload
    { tag: 1007, type: T.INT32, value: [cpio.length] }, // PAYLOADSIZE (uncompressed)
  ]);
  const sigPad = new Uint8Array((8 - (signature.length % 8)) % 8);

  const file = join(out, `${app.name}-${evr}.${app.arch.rpm}.rpm`);
  writeFileSync(file, Buffer.concat([lead(`${app.name}-${evr}`, app.arch.rpmNum), signature, sigPad, header, payload]));
  return file;
}

function lead(nvr: string, archnum: number): Uint8Array {
  const b = Buffer.alloc(96);
  b.set([0xed, 0xab, 0xee, 0xdb, 3, 0], 0); // magic, v3.0
  b.writeUInt16BE(0, 6); // binary
  b.writeUInt16BE(archnum, 8);
  b.write(nvr.slice(0, 65), 10, "latin1");
  b.writeUInt16BE(1, 76); // os: Linux
  b.writeUInt16BE(5, 78); // signature type: header-style
  return b;
}

/** Serializes a header whose first entry is the immutable region `regionTag` (62 signature, 63 main). */
function buildHeader(regionTag: number, entries: Entry[]): Uint8Array {
  entries = [...entries].sort((a, b) => a.tag - b.tag);
  const store: number[] = [];
  const index: [number, number, number, number][] = [];
  const align = (n: number) => {
    while (store.length % n) store.push(0);
  };
  const str = (s: string) => store.push(...Buffer.from(s, "utf8"), 0);
  for (const e of entries) {
    let count = 1;
    if (e.type === T.INT16) align(2);
    if (e.type === T.INT32) align(4);
    const offset = store.length;
    if (e.type === T.STRING || e.type === T.I18NSTRING) str(e.value as string);
    else if (e.type === T.STRING_ARRAY) {
      const list = e.value as string[];
      list.forEach(str);
      count = list.length;
    } else if (e.type === T.BIN) {
      const bytes = e.value as Uint8Array;
      store.push(...bytes);
      count = bytes.length;
    } else {
      const nums = e.value as number[];
      const size = e.type === T.INT16 ? 2 : 4;
      for (const v of nums) for (let k = size - 1; k >= 0; k--) store.push((v >>> (8 * k)) & 0xff);
      count = nums.length;
    }
    index.push([e.tag, e.type, offset, count]);
  }
  // Region trailer: an index entry stored in the data, pointing back over the whole index.
  const nindex = index.length + 1;
  const trailerOffset = store.length;
  const trailer = Buffer.alloc(16);
  trailer.writeUInt32BE(regionTag, 0);
  trailer.writeUInt32BE(T.BIN, 4);
  trailer.writeInt32BE(-nindex * 16, 8);
  trailer.writeUInt32BE(16, 12);
  store.push(...trailer);
  index.unshift([regionTag, T.BIN, trailerOffset, 16]);

  const head = Buffer.alloc(16 + nindex * 16);
  head.set([0x8e, 0xad, 0xe8, 0x01], 0);
  head.writeUInt32BE(nindex, 8);
  head.writeUInt32BE(store.length, 12);
  index.forEach(([tag, type, offset, count], i) => {
    head.writeUInt32BE(tag, 16 + i * 16);
    head.writeUInt32BE(type, 20 + i * 16);
    head.writeUInt32BE(offset, 24 + i * 16);
    head.writeUInt32BE(count, 28 + i * 16);
  });
  return Buffer.concat([head, Buffer.from(store)]);
}

function cpioNewc(entries: { name: string; mode: number; mtime: number; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  let size = 0;
  const push = (b: Uint8Array) => (parts.push(b), (size += b.length));
  const pad4 = () => size % 4 && push(new Uint8Array(4 - (size % 4)));
  const hex = (v: number) => v.toString(16).padStart(8, "0");
  const add = (name: string, mode: number, mtime: number, data: Uint8Array, ino: number) => {
    const fields = [ino, mode, 0, 0, 1, mtime, data.length, 0, 0, 0, 0, Buffer.byteLength(name) + 1, 0];
    push(Buffer.from(`070701${fields.map(hex).join("")}${name}\0`, "utf8"));
    pad4();
    push(data);
    pad4();
  };
  entries.forEach((e, i) => add(e.name, e.mode, e.mtime, e.data, i + 1));
  add("TRAILER!!!", 0, 0, new Uint8Array(), 0);
  return Buffer.concat(parts);
}

const sha256 = (d: Uint8Array) => new Bun.CryptoHasher("sha256").update(d).digest("hex");
const sha1 = (d: Uint8Array) => new Bun.CryptoHasher("sha1").update(d).digest("hex");
