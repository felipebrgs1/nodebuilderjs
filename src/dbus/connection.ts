// A D-Bus client connection: unix socket, EXTERNAL auth, Hello, method calls with replies,
// signals, and exported objects (methods, properties, introspection) for services like the
// tray's StatusNotifierItem. Runs on the JS event loop (node:net), no native code.

import { type Socket, createConnection } from "node:net";
import { type Message, MessageReader, MessageType, NO_REPLY_EXPECTED, type Variant, encodeMessage, splitSignature as splitTypes, variant } from "./wire.js";

export class DBusError extends Error {
  constructor(public readonly name: string, message: string) {
    super(message);
  }
}

export interface CallOptions {
  destination: string;
  path: string;
  interface?: string;
  member: string;
  signature?: string;
  body?: unknown[];
}

export interface SignalMatch {
  sender?: string;
  path?: string;
  interface: string;
  member: string;
}

/** One exported method: argument and result signatures, and what it does. */
export interface MethodSpec {
  in?: string;
  out?: string;
  /** Returns the results (an array matching `out`), or throws a DBusError. */
  call(args: unknown[], msg: Message): unknown[] | void;
}

export interface InterfaceSpec {
  methods?: Record<string, MethodSpec>;
  /** Read-only properties: signature and current value. */
  properties?: Record<string, { signature: string; get(): unknown }>;
  /** Signal name -> signature (for introspection). */
  signals?: Record<string, string>;
}

const BUS = "org.freedesktop.DBus";
const PROPERTIES = "org.freedesktop.DBus.Properties";
const INTROSPECTABLE = "org.freedesktop.DBus.Introspectable";

/** The socket path of a bus address ("unix:path=..." or "unix:abstract=..."), null if none is usable. */
export function socketPath(address: string): string | null {
  for (const entry of address.split(";")) {
    if (!entry.startsWith("unix:")) continue;
    const params = new Map(entry.slice(5).split(",").map((kv) => kv.split("=") as [string, string]));
    const unescape = (v: string) => v.replace(/%([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    if (params.has("path")) return unescape(params.get("path")!);
    if (params.has("abstract")) return "\0" + unescape(params.get("abstract")!);
  }
  return null;
}

/** The session bus address from the environment (DBUS_SESSION_BUS_ADDRESS, else $XDG_RUNTIME_DIR/bus). */
export function sessionBusAddress(env: Record<string, string | undefined> = process.env): string | null {
  if (env.DBUS_SESSION_BUS_ADDRESS) return env.DBUS_SESSION_BUS_ADDRESS;
  return env.XDG_RUNTIME_DIR ? `unix:path=${env.XDG_RUNTIME_DIR}/bus` : null;
}

export class DBusConnection {
  /** Our unique name on the bus (":1.42"). */
  uniqueName = "";
  private serial = 0;
  private pending = new Map<number, { resolve: (body: unknown[]) => void; reject: (e: Error) => void }>();
  private matches: { match: SignalMatch; handler: (body: unknown[], msg: Message) => void }[] = [];
  private objects = new Map<string, Record<string, InterfaceSpec>>();
  private reader = new MessageReader();
  private closed = false;
  /** Called once when the connection ends (closed by us, the bus going away or an error). */
  onClose: (error?: Error) => void = () => {};

  private constructor(private socket: Socket) {}

  /** Connects to `address`, authenticates and says Hello. */
  static connect(address: string, uid = process.getuid?.() ?? 0): Promise<DBusConnection> {
    const path = socketPath(address);
    if (!path) return Promise.reject(new Error(`D-Bus: no usable unix socket in "${address}"`));
    return new Promise((resolve, reject) => {
      const socket = createConnection({ path });
      const conn = new DBusConnection(socket);
      let authed = false;
      let text = "";
      const failEarly = (err: Error) => {
        if (!authed) reject(err);
      };
      socket.once("error", failEarly);
      socket.on("connect", () => {
        const hexUid = Buffer.from(String(uid)).toString("hex");
        socket.write(`\0AUTH EXTERNAL ${hexUid}\r\n`);
      });
      socket.on("data", (chunk: Buffer) => {
        if (authed) return conn.receive(chunk);
        text += chunk.toString("latin1");
        const end = text.indexOf("\r\n");
        if (end < 0) return;
        const line = text.slice(0, end);
        if (!line.startsWith("OK ")) {
          socket.destroy();
          return reject(new Error(`D-Bus: authentication rejected (${line})`));
        }
        authed = true;
        socket.write("BEGIN\r\n");
        socket.off("error", failEarly);
        socket.on("error", (err) => conn.shutdown(err));
        socket.on("close", () => conn.shutdown());
        const rest = Buffer.from(text.slice(end + 2), "latin1");
        if (rest.length) conn.receive(rest);
        conn
          .call({ destination: BUS, path: "/org/freedesktop/DBus", interface: BUS, member: "Hello" })
          .then(([name]) => {
            conn.uniqueName = name as string;
            resolve(conn);
          }, reject);
      });
    });
  }

  call(options: CallOptions): Promise<unknown[]> {
    if (this.closed) return Promise.reject(new Error("D-Bus: connection closed"));
    const serial = this.send({ type: MessageType.MethodCall, ...options });
    return new Promise((resolve, reject) => this.pending.set(serial, { resolve, reject }));
  }

  emit(path: string, iface: string, member: string, signature?: string, body?: unknown[]) {
    if (!this.closed) this.send({ type: MessageType.Signal, path, interface: iface, member, signature, body });
  }

  /** Runs `handler` for matching signals (asks the bus to route them to us). Returns an unsubscribe. */
  onSignal(match: SignalMatch, handler: (body: unknown[], msg: Message) => void): () => void {
    const entry = { match, handler };
    this.matches.push(entry);
    const rule = matchRule(match);
    this.call({ destination: BUS, path: "/org/freedesktop/DBus", interface: BUS, member: "AddMatch", signature: "s", body: [rule] }).catch(() => {});
    return () => {
      this.matches = this.matches.filter((m) => m !== entry);
      if (!this.closed) this.send({ type: MessageType.MethodCall, flags: NO_REPLY_EXPECTED, destination: BUS, path: "/org/freedesktop/DBus", interface: BUS, member: "RemoveMatch", signature: "s", body: [rule] });
    };
  }

  /** Serves `interfaces` at `path` (plus Properties and Introspectable). Returns an unexport. */
  exportObject(path: string, interfaces: Record<string, InterfaceSpec>): () => void {
    this.objects.set(path, interfaces);
    return () => void this.objects.delete(path);
  }

  /** Emits PropertiesChanged for `names` of `iface` at `path`, with their current values. */
  propertiesChanged(path: string, iface: string, names: string[]) {
    const props = this.objects.get(path)?.[iface]?.properties ?? {};
    const changed = names.filter((n) => props[n]).map((n) => [n, variant(props[n]!.signature, props[n]!.get())]);
    this.emit(path, PROPERTIES, "PropertiesChanged", "sa{sv}as", [iface, changed, []]);
  }

  close() {
    if (this.closed) return;
    this.socket.end();
    this.shutdown();
  }

  private send(msg: Omit<Message, "serial">): number {
    const serial = ++this.serial;
    this.socket.write(encodeMessage({ ...msg, serial } as Message));
    return serial;
  }

  private shutdown(error?: Error) {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) p.reject(error ?? new Error("D-Bus: connection closed"));
    this.pending.clear();
    this.onClose(error);
  }

  private receive(chunk: Uint8Array) {
    let messages: Message[];
    try {
      messages = this.reader.push(chunk);
    } catch (err) {
      this.socket.destroy();
      return this.shutdown(err as Error);
    }
    for (const msg of messages) this.dispatch(msg);
  }

  private dispatch(msg: Message) {
    switch (msg.type) {
      case MessageType.MethodReturn:
      case MessageType.Error: {
        const p = this.pending.get(msg.replySerial ?? -1);
        if (!p) return;
        this.pending.delete(msg.replySerial!);
        if (msg.type === MessageType.MethodReturn) p.resolve(msg.body ?? []);
        else p.reject(new DBusError(msg.errorName ?? "", String(msg.body?.[0] ?? msg.errorName)));
        return;
      }
      case MessageType.Signal:
        for (const { match, handler } of this.matches)
          if (match.interface === msg.interface && match.member === msg.member && (!match.path || match.path === msg.path) && (!match.sender || match.sender === msg.sender))
            handler(msg.body ?? [], msg);
        return;
      case MessageType.MethodCall:
        return this.serve(msg);
    }
  }

  private serve(msg: Message) {
    const reply = (signature: string | undefined, body: unknown[] = []) => {
      if (!(msg.flags! & NO_REPLY_EXPECTED)) this.send({ type: MessageType.MethodReturn, destination: msg.sender, replySerial: msg.serial, signature, body });
    };
    const error = (name: string, text: string) => {
      if (!(msg.flags! & NO_REPLY_EXPECTED)) this.send({ type: MessageType.Error, destination: msg.sender, replySerial: msg.serial, errorName: name, signature: "s", body: [text] });
    };
    const object = this.objects.get(msg.path ?? "");
    try {
      if (msg.interface === "org.freedesktop.DBus.Peer") {
        if (msg.member === "Ping") return reply(undefined);
      } else if (msg.interface === INTROSPECTABLE && msg.member === "Introspect") {
        return reply("s", [introspect(object, [...this.objects.keys()], msg.path ?? "/")]);
      } else if (object && msg.interface === PROPERTIES) {
        const [ifaceName, name] = msg.body as [string, string];
        const props = object[ifaceName]?.properties ?? {};
        if (msg.member === "GetAll") return reply("a{sv}", [Object.entries(props).map(([k, p]) => [k, variant(p.signature, p.get())])]);
        if (msg.member === "Get") {
          const p = props[name];
          if (!p) return error("org.freedesktop.DBus.Error.UnknownProperty", `no property ${name}`);
          return reply("v", [variant(p.signature, p.get())]);
        }
        if (msg.member === "Set") return error("org.freedesktop.DBus.Error.PropertyReadOnly", `${name} is read-only`);
      } else if (object) {
        const candidates = msg.interface ? [object[msg.interface]] : Object.values(object);
        const method = candidates.map((i) => i?.methods?.[msg.member ?? ""]).find(Boolean);
        if (method) return reply(method.out || undefined, (method.call(msg.body ?? [], msg) as unknown[] | undefined) ?? []);
      }
      error(object ? "org.freedesktop.DBus.Error.UnknownMethod" : "org.freedesktop.DBus.Error.UnknownObject", `no ${msg.interface}.${msg.member} at ${msg.path}`);
    } catch (err) {
      if (err instanceof DBusError) error(err.name, err.message);
      else error("org.freedesktop.DBus.Error.Failed", (err as Error).message);
    }
  }
}

function matchRule(m: SignalMatch): string {
  const parts = [`type='signal'`, `interface='${m.interface}'`, `member='${m.member}'`];
  if (m.sender) parts.push(`sender='${m.sender}'`);
  if (m.path) parts.push(`path='${m.path}'`);
  return parts.join(",");
}

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

function introspect(object: Record<string, InterfaceSpec> | undefined, paths: string[], path: string): string {
  const args = (sig: string | undefined, dir: string) => (sig ? splitTypes(sig).map((t) => `<arg type="${xmlEscape(t)}" direction="${dir}"/>`).join("") : "");
  let xml = `<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd">\n<node>`;
  if (object) {
    xml += `<interface name="${PROPERTIES}"><method name="Get"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="out"/></method><method name="GetAll"><arg type="s" direction="in"/><arg type="a{sv}" direction="out"/></method><signal name="PropertiesChanged"><arg type="s"/><arg type="a{sv}"/><arg type="as"/></signal></interface>`;
    for (const [name, spec] of Object.entries(object)) {
      xml += `<interface name="${name}">`;
      for (const [m, s] of Object.entries(spec.methods ?? {})) xml += `<method name="${m}">${args(s.in, "in")}${args(s.out, "out")}</method>`;
      for (const [p, s] of Object.entries(spec.properties ?? {})) xml += `<property name="${p}" type="${xmlEscape(s.signature)}" access="read"/>`;
      for (const [sname, sig] of Object.entries(spec.signals ?? {})) xml += `<signal name="${sname}">${sig ? splitTypes(sig).map((t) => `<arg type="${xmlEscape(t)}"/>`).join("") : ""}</signal>`;
      xml += `</interface>`;
    }
  }
  // Child nodes, so tools can walk the tree from "/".
  const prefix = path === "/" ? "/" : path + "/";
  const children = new Set(paths.filter((p) => p.startsWith(prefix) && p !== path).map((p) => p.slice(prefix.length).split("/")[0]!));
  for (const c of children) xml += `<node name="${c}"/>`;
  return xml + `</node>`;
}

export type { Message, Variant };
