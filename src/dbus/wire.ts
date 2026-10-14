// The D-Bus wire format: values marshalled by signature, and messages (fixed header, header
// fields, body). We write little endian and read either. Spec:
// https://dbus.freedesktop.org/doc/dbus-specification.html#message-protocol-marshaling
//
// JS values by type: y n q i u d -> number, x t -> bigint (numbers accepted), b -> boolean,
// s o g -> string, ay -> Uint8Array (arrays accepted), a{..} -> [key, value][], other arrays and
// structs -> arrays, v -> Variant ({ signature, value }).

export interface Variant {
  signature: string;
  value: unknown;
}

export const variant = (signature: string, value: unknown): Variant => ({ signature, value });

export enum MessageType {
  MethodCall = 1,
  MethodReturn = 2,
  Error = 3,
  Signal = 4,
}

/** Flags: no reply expected. */
export const NO_REPLY_EXPECTED = 1;

export interface Message {
  type: MessageType;
  flags?: number;
  serial: number;
  path?: string;
  interface?: string;
  member?: string;
  errorName?: string;
  replySerial?: number;
  destination?: string;
  sender?: string;
  signature?: string;
  body?: unknown[];
}

const MAX_MESSAGE = 128 << 20; // the spec's limit
const MAX_ARRAY = 64 << 20;

const fail = (what: string): never => {
  throw new Error(`D-Bus: ${what}`);
};

function alignOf(code: string): number {
  switch (code) {
    case "y": case "g": case "v": return 1;
    case "n": case "q": return 2;
    case "b": case "i": case "u": case "s": case "o": case "a": return 4;
    case "x": case "t": case "d": case "(": case "{": return 8;
  }
  return fail(`unknown type '${code}' in signature`);
}

/** End (exclusive) of the complete type starting at `i`. */
function typeEnd(sig: string, i: number): number {
  const c = sig[i];
  if (c === undefined) return fail(`incomplete signature "${sig}"`);
  if (c === "a") return typeEnd(sig, i + 1);
  if (c === "(" || c === "{") {
    const close = c === "(" ? ")" : "}";
    let j = i + 1;
    while (sig[j] !== close) {
      if (j >= sig.length) fail(`unclosed ${c} in signature "${sig}"`);
      j = typeEnd(sig, j);
    }
    return j + 1;
  }
  alignOf(c);
  return i + 1;
}

/** "sa{sv}(ii)" -> ["s", "a{sv}", "(ii)"]. */
export function splitSignature(sig: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < sig.length; ) {
    const end = typeEnd(sig, i);
    out.push(sig.slice(i, end));
    i = end;
  }
  return out;
}

// ---- writing ------------------------------------------------------------------

class Writer {
  bytes = new Uint8Array(256);
  view = new DataView(this.bytes.buffer);
  length = 0;

  private reserve(n: number) {
    if (this.length + n <= this.bytes.length) return;
    let size = this.bytes.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.bytes.subarray(0, this.length));
    this.bytes = next;
    this.view = new DataView(next.buffer);
  }
  align(n: number) {
    const pad = (n - (this.length % n)) % n;
    this.reserve(pad);
    this.bytes.fill(0, this.length, this.length + pad);
    this.length += pad;
  }
  u8(v: number) {
    this.reserve(1);
    this.bytes[this.length++] = v;
  }
  u32(v: number) {
    this.align(4);
    this.reserve(4);
    this.view.setUint32(this.length, v, true);
    this.length += 4;
  }
  raw(b: Uint8Array) {
    this.reserve(b.length);
    this.bytes.set(b, this.length);
    this.length += b.length;
  }
  result() {
    return this.bytes.slice(0, this.length);
  }
}

const utf8 = new TextEncoder();

function writeValue(w: Writer, type: string, value: unknown) {
  const c = type[0]!;
  w.align(alignOf(c));
  const n = Number(value);
  switch (c) {
    case "y": return w.u8(n & 0xff);
    case "b": return w.u32(value ? 1 : 0);
    case "n": w.view.setInt16(reserve(w, 2), n, true); return;
    case "q": w.view.setUint16(reserve(w, 2), n, true); return;
    case "i": w.view.setInt32(reserve(w, 4), n, true); return;
    case "u": w.view.setUint32(reserve(w, 4), n, true); return;
    case "x": w.view.setBigInt64(reserve(w, 8), BigInt(value as bigint | number), true); return;
    case "t": w.view.setBigUint64(reserve(w, 8), BigInt(value as bigint | number), true); return;
    case "d": w.view.setFloat64(reserve(w, 8), n, true); return;
    case "s": case "o": {
      const b = utf8.encode(String(value));
      w.u32(b.length);
      w.raw(b);
      return w.u8(0);
    }
    case "g": {
      const b = utf8.encode(String(value));
      w.u8(b.length);
      w.raw(b);
      return w.u8(0);
    }
    case "v": {
      const v = value as Variant;
      writeValue(w, "g", v.signature);
      const [inner, ...rest] = splitSignature(v.signature);
      if (!inner || rest.length) fail(`a variant holds exactly one type, not "${v.signature}"`);
      return writeValue(w, inner, v.value);
    }
    case "(": {
      const fields = splitSignature(type.slice(1, -1));
      const items = value as unknown[];
      fields.forEach((f, i) => writeValue(w, f, items[i]));
      return;
    }
    case "a": {
      const elem = type.slice(1);
      w.u32(0);
      const lengthAt = w.length - 4;
      w.align(alignOf(elem[0]!));
      const start = w.length;
      if (elem === "y" && value instanceof Uint8Array) w.raw(value);
      else if (elem[0] === "{") {
        const [k, v] = splitSignature(elem.slice(1, -1)) as [string, string];
        const entries = value instanceof Map ? [...value] : Array.isArray(value) ? value : Object.entries(value as object);
        for (const [key, val] of entries as [unknown, unknown][]) {
          w.align(8);
          writeValue(w, k, key);
          writeValue(w, v, val);
        }
      } else for (const item of value as Iterable<unknown>) writeValue(w, elem, item);
      w.view.setUint32(lengthAt, w.length - start, true);
      return;
    }
  }
  fail(`cannot write type '${c}'`);
}

function reserve(w: Writer, n: number): number {
  w.raw(new Uint8Array(n));
  return w.length - n;
}

/** Marshals `values` by `signature`, as a body starting at offset 0. */
export function encodeBody(signature: string, values: unknown[]): Uint8Array {
  const w = new Writer();
  splitSignature(signature).forEach((t, i) => writeValue(w, t, values[i]));
  return w.result();
}

// Header field codes, with the type of their value.
const FIELDS: [keyof Message, number, string][] = [
  ["path", 1, "o"], ["interface", 2, "s"], ["member", 3, "s"], ["errorName", 4, "s"],
  ["replySerial", 5, "u"], ["destination", 6, "s"], ["sender", 7, "s"], ["signature", 8, "g"],
];

export function encodeMessage(msg: Message): Uint8Array {
  const body = msg.signature ? encodeBody(msg.signature, msg.body ?? []) : new Uint8Array(0);
  const w = new Writer();
  w.raw(new Uint8Array([0x6c, msg.type, msg.flags ?? 0, 1]));
  w.u32(body.length);
  w.u32(msg.serial);
  const fields = FIELDS.filter(([key]) => msg[key] !== undefined && msg[key] !== "").map(([key, code, sig]) => [code, variant(sig, msg[key])]);
  writeValue(w, "a(yv)", fields);
  w.align(8);
  w.raw(body);
  return w.result();
}

// ---- reading ------------------------------------------------------------------

const utf8Decoder = new TextDecoder();

class Reader {
  view: DataView;
  constructor(public bytes: Uint8Array, public pos: number, public le: boolean, public base = 0) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  need(n: number) {
    if (this.pos + n > this.bytes.length) fail("message truncated");
  }
  align(n: number) {
    this.pos += (n - ((this.pos - this.base) % n)) % n;
  }
}

function readValue(r: Reader, type: string): unknown {
  const c = type[0]!;
  r.align(alignOf(c));
  const size = c === "y" || c === "g" || c === "v" ? 1 : c === "n" || c === "q" ? 2 : c === "x" || c === "t" || c === "d" ? 8 : c === "(" || c === "{" ? 0 : 4;
  r.need(size);
  const p = r.pos;
  r.pos += size;
  const { view, le } = r;
  switch (c) {
    case "y": return view.getUint8(p);
    case "b": return view.getUint32(p, le) !== 0;
    case "n": return view.getInt16(p, le);
    case "q": return view.getUint16(p, le);
    case "i": return view.getInt32(p, le);
    case "u": return view.getUint32(p, le);
    case "x": return view.getBigInt64(p, le);
    case "t": return view.getBigUint64(p, le);
    case "d": return view.getFloat64(p, le);
    case "s": case "o": case "g": {
      const len = c === "g" ? view.getUint8(p) : view.getUint32(p, le);
      r.need(len + 1);
      const s = utf8Decoder.decode(r.bytes.subarray(r.pos, r.pos + len));
      r.pos += len + 1;
      return s;
    }
    case "v": {
      r.pos = p;
      const signature = readValue(r, "g") as string;
      const [inner, ...rest] = splitSignature(signature);
      if (!inner || rest.length) fail(`bad variant signature "${signature}"`);
      return variant(signature, readValue(r, inner));
    }
    case "(": case "{":
      return splitSignature(type.slice(1, -1)).map((f) => readValue(r, f));
    case "a": {
      const len = view.getUint32(p, le);
      if (len > MAX_ARRAY) fail("array too long");
      const elem = type.slice(1);
      r.align(alignOf(elem[0]!));
      r.need(len);
      const end = r.pos + len;
      if (elem === "y") {
        const out = r.bytes.slice(r.pos, end);
        r.pos = end;
        return out;
      }
      const out: unknown[] = [];
      while (r.pos < end) out.push(readValue(r, elem));
      if (r.pos !== end) fail("array elements overrun its length");
      return out;
    }
  }
  return fail(`cannot read type '${c}'`);
}

/** Reads a body marshalled by `signature` (little endian unless `le` is false). */
export function decodeBody(signature: string, bytes: Uint8Array, le = true): unknown[] {
  const r = new Reader(bytes, 0, le);
  return splitSignature(signature).map((t) => readValue(r, t));
}

/** Splits a byte stream into messages (chunks may cut them anywhere). */
export class MessageReader {
  private buffer = new Uint8Array(0);

  push(chunk: Uint8Array): Message[] {
    const joined = new Uint8Array(this.buffer.length + chunk.length);
    joined.set(this.buffer);
    joined.set(chunk, this.buffer.length);
    this.buffer = joined;
    const out: Message[] = [];
    while (this.buffer.length >= 16) {
      const le = this.buffer[0] === 0x6c;
      if (!le && this.buffer[0] !== 0x42) fail("bad endianness byte");
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, 16);
      const bodyLength = view.getUint32(4, le);
      const fieldsLength = view.getUint32(12, le);
      const headerEnd = 16 + fieldsLength + ((8 - ((16 + fieldsLength) % 8)) % 8);
      const total = headerEnd + bodyLength;
      if (total > MAX_MESSAGE) fail("message too long");
      if (this.buffer.length < total) break;
      out.push(parseMessage(this.buffer.subarray(0, total), le, headerEnd));
      this.buffer = this.buffer.slice(total);
    }
    return out;
  }
}

function parseMessage(bytes: Uint8Array, le: boolean, headerEnd: number): Message {
  const r = new Reader(bytes, 12, le);
  const msg: Message = { type: bytes[1]!, flags: bytes[2]!, serial: r.view.getUint32(8, le) };
  for (const [code, value] of readValue(r, "a(yv)") as [number, Variant][]) {
    const field = FIELDS.find(([, c]) => c === code);
    if (field) (msg as unknown as Record<string, unknown>)[field[0]] = value.value;
  }
  if (msg.signature) msg.body = readValue(new Reader(bytes, headerEnd, le, headerEnd), `(${msg.signature})`) as unknown[];
  else msg.body = [];
  return msg;
}
