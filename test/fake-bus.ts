// An in-process D-Bus "daemon" for tests: one unix socket in a temp dir, EXTERNAL auth, Hello,
// and every method call the client makes recorded. Tests answer calls through `answer` and
// call the client's exported objects with `call`.
import { mkdtempSync, rmSync } from "node:fs";
import { type Server, type Socket, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Message, MessageReader, MessageType, encodeMessage } from "../src/dbus/wire.js";

export interface FakeBus {
  address: string;
  /** Method calls the client sent to the bus or other services (not replies). */
  calls: Message[];
  /** Signals the client emitted. */
  signals: Message[];
  /** Answers calls to anything but the bus itself: return the reply body, or throw [name, message] for an error. */
  answer: (msg: Message) => { signature?: string; body?: unknown[] } | void;
  /** Calls a method on the (single) client; resolves with the reply message. */
  call(msg: Omit<Message, "serial" | "type" | "destination">): Promise<Message>;
  /** Sends a signal to the client, as if from `sender`. */
  signal(msg: Omit<Message, "serial" | "type">): void;
  /** Resolves once a call matching `member` arrived (maybe already). */
  waitFor(member: string): Promise<Message>;
  /** Drops the client's connection. */
  disconnect(): void;
  close(): void;
}

export async function startFakeBus(): Promise<FakeBus> {
  const dir = mkdtempSync(join(tmpdir(), "nb-bus-"));
  const path = join(dir, "bus");
  let client: Socket | null = null;
  let serial = 1000;
  const pending = new Map<number, (m: Message) => void>();
  const waiters: { member: string; resolve: (m: Message) => void }[] = [];

  const bus: FakeBus = {
    address: `unix:path=${path},guid=0123`,
    calls: [],
    signals: [],
    answer: () => {},
    call(msg) {
      const s = ++serial;
      client!.write(encodeMessage({ ...msg, type: MessageType.MethodCall, serial: s, sender: ":1.0" } as Message));
      return new Promise((resolve) => pending.set(s, resolve));
    },
    signal(msg) {
      client!.write(encodeMessage({ ...msg, type: MessageType.Signal, serial: ++serial } as Message));
    },
    waitFor(member) {
      const found = bus.calls.find((c) => c.member === member);
      if (found) return Promise.resolve(found);
      return new Promise((resolve) => waiters.push({ member, resolve }));
    },
    disconnect: () => client?.destroy(),
    close() {
      client?.destroy();
      server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };

  const reply = (to: Message, signature?: string, body?: unknown[]) =>
    client!.write(encodeMessage({ type: MessageType.MethodReturn, serial: ++serial, replySerial: to.serial, destination: ":1.1", sender: "org.freedesktop.DBus", signature, body }));

  function onMessage(msg: Message) {
    if (msg.type === MessageType.MethodReturn || msg.type === MessageType.Error) {
      pending.get(msg.replySerial!)?.(msg);
      pending.delete(msg.replySerial!);
      return;
    }
    if (msg.type === MessageType.Signal) return void bus.signals.push(msg);
    bus.calls.push(msg);
    for (const w of waiters.filter((w) => w.member === msg.member)) {
      waiters.splice(waiters.indexOf(w), 1);
      w.resolve(msg);
    }
    if (msg.destination === "org.freedesktop.DBus") {
      if (msg.member === "Hello") return reply(msg, "s", [":1.1"]);
      if (msg.member === "RequestName") return reply(msg, "u", [1]);
      if (msg.member === "NameHasOwner") return reply(msg, "b", [true]);
      return reply(msg);
    }
    try {
      const r = bus.answer(msg);
      reply(msg, r?.signature, r?.body);
    } catch (err) {
      const [name, text] = err as [string, string];
      client!.write(encodeMessage({ type: MessageType.Error, serial: ++serial, replySerial: msg.serial, errorName: name, signature: "s", body: [text] }));
    }
  }

  const server: Server = createServer((socket) => {
    client = socket;
    let authed = false;
    let text = "";
    const reader = new MessageReader();
    socket.on("data", (chunk: Buffer) => {
      if (authed) return reader.push(chunk).forEach(onMessage);
      text += chunk.toString("latin1");
      // Auth is line based: "\0AUTH EXTERNAL <hex uid>", then "BEGIN"; binary messages follow.
      for (let end = text.indexOf("\r\n"); end >= 0 && !authed; end = text.indexOf("\r\n")) {
        const line = text.slice(0, end).replace(/^\0/, "");
        text = text.slice(end + 2);
        if (line.startsWith("AUTH EXTERNAL")) socket.write("OK 0123456789abcdef0123456789abcdef\r\n");
        else if (line === "BEGIN") authed = true;
        else socket.write("ERROR\r\n");
      }
      if (authed && text.length) reader.push(Buffer.from(text, "latin1")).forEach(onMessage);
    });
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  return bus;
}
