// D-Bus in TypeScript: the wire format (marshalling by signature, message framing) and a
// connection that authenticates, says Hello and routes calls, against an in-process fake bus.
import { describe, expect, test } from "bun:test";
import { DBusConnection, DBusError, sessionBusAddress, socketPath } from "../src/dbus/connection.js";
import { MessageReader, MessageType, decodeBody, encodeBody, encodeMessage, splitSignature, variant } from "../src/dbus/wire.js";
import { startFakeBus } from "./fake-bus.js";

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join(" ");

describe("wire format", () => {
  test("splits a signature into complete types", () => {
    expect(splitSignature("sa{sv}(ii)aai")).toEqual(["s", "a{sv}", "(ii)", "aai"]);
    expect(() => splitSignature("a{sv")).toThrow("signature");
  });

  test("aligns each type to its natural boundary", () => {
    // y, then a u32 aligned to 4, then a string (length, bytes, NUL)
    expect(hex(encodeBody("yus", [1, 2, "ab"]))).toBe("01 00 00 00 02 00 00 00 02 00 00 00 61 62 00");
    // a struct starts at 8; a double inside is aligned to 8 too
    expect(hex(encodeBody("y(d)", [1, [1]]))).toBe("01 00 00 00 00 00 00 00 00 00 00 00 00 00 f0 3f");
  });

  test("an array's length excludes the padding before its first element", () => {
    // u32 length 8, padding to 8, one int64
    expect(hex(encodeBody("at", [[5n]]))).toBe("08 00 00 00 00 00 00 00 05 00 00 00 00 00 00 00");
    expect(hex(encodeBody("at", [[]]))).toBe("00 00 00 00 00 00 00 00");
  });

  test("round-trips every type", () => {
    const sig = "ybnqiuxtdsogavva{sv}(sai)ay";
    const values = [
      255, true, -2, 65535, -100000, 4000000000, -(2n ** 40n), 2n ** 63n, 1.5, "olá", "/a/b", "a{sv}",
      [variant("s", "x"), variant("ai", [1, 2])], variant("(ss)", ["a", "b"]),
      [["k", variant("u", 7)]], ["s", [3, 4]], new Uint8Array([9, 8, 7]),
    ];
    expect(decodeBody(sig, encodeBody(sig, values))).toEqual(values);
  });

  test("a message is framed by its header and read back from arbitrary chunks", () => {
    const bytes = encodeMessage({
      type: MessageType.MethodCall, serial: 7, path: "/org/freedesktop/DBus", interface: "org.freedesktop.DBus",
      member: "RequestName", destination: "org.freedesktop.DBus", signature: "su", body: ["com.example.App", 4],
    });
    const reader = new MessageReader();
    const out = [...reader.push(bytes.subarray(0, 5)), ...reader.push(bytes.subarray(5, 40)), ...reader.push(Buffer.concat([bytes.subarray(40), bytes]))];
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ type: MessageType.MethodCall, serial: 7, member: "RequestName", signature: "su", body: ["com.example.App", 4] });
  });

  test("reads big-endian messages", () => {
    // Method return, serial 1, reply serial 9, signature "u", body 0x01020304 (big endian)
    const be = new Uint8Array([
      0x42, 2, 0, 1, 0, 0, 0, 4, 0, 0, 0, 1, 0, 0, 0, 0x0f,
      5, 1, 0x75, 0, 0, 0, 0, 9, 8, 1, 0x67, 0, 1, 0x75, 0, 0, 1, 2, 3, 4,
    ]);
    const [msg] = new MessageReader().push(be);
    expect(msg).toMatchObject({ type: MessageType.MethodReturn, replySerial: 9, body: [0x01020304] });
  });

  test("rejects truncated or oversized bodies with a format error", () => {
    expect(() => decodeBody("s", new Uint8Array([10, 0, 0, 0, 97]))).toThrow("D-Bus");
    expect(() => decodeBody("ai", new Uint8Array([255, 255, 255, 255]))).toThrow("D-Bus");
  });
});

describe("connection", () => {
  test("bus addresses: path, abstract and escapes; the session bus from the environment", () => {
    expect(socketPath("unix:path=/run/user/1000/bus")).toBe("/run/user/1000/bus");
    expect(socketPath("tcp:host=x;unix:abstract=/tmp/dbus-a%2cb,guid=1")).toBe("\0/tmp/dbus-a,b");
    expect(socketPath("tcp:host=x,port=1")).toBeNull();
    expect(sessionBusAddress({ XDG_RUNTIME_DIR: "/run/user/7" })).toBe("unix:path=/run/user/7/bus");
    expect(sessionBusAddress({})).toBeNull();
  });

  test("authenticates with the uid, says Hello and gets replies and errors back", async () => {
    const bus = await startFakeBus();
    try {
      const conn = await DBusConnection.connect(bus.address, 1000);
      expect(conn.uniqueName).toBe(":1.1");
      bus.answer = (msg) => {
        if (msg.member === "Add") return { signature: "i", body: [(msg.body![0] as number) + (msg.body![1] as number)] };
        throw ["com.example.Error.Nope", "no such thing"];
      };
      expect(await conn.call({ destination: "com.example", path: "/", interface: "com.example.Calc", member: "Add", signature: "ii", body: [2, 3] })).toEqual([5]);
      const err = await conn.call({ destination: "com.example", path: "/", member: "Other" }).catch((e) => e);
      expect(err).toBeInstanceOf(DBusError);
      expect(err).toMatchObject({ name: "com.example.Error.Nope", message: "no such thing" });
      conn.close();
    } finally {
      bus.close();
    }
  });

  test("serves exported methods, properties and introspection", async () => {
    const bus = await startFakeBus();
    try {
      const conn = await DBusConnection.connect(bus.address);
      let title = "One";
      conn.exportObject("/Item", {
        "com.example.Item": {
          methods: { Rename: { in: "s", out: "b", call: ([t]) => [(title = t as string) !== ""] } },
          properties: { Title: { signature: "s", get: () => title } },
          signals: { Changed: "" },
        },
      });
      const ok = await bus.call({ path: "/Item", interface: "com.example.Item", member: "Rename", signature: "s", body: ["Two"] });
      expect(ok).toMatchObject({ type: MessageType.MethodReturn, body: [true] });
      const prop = await bus.call({ path: "/Item", interface: "org.freedesktop.DBus.Properties", member: "Get", signature: "ss", body: ["com.example.Item", "Title"] });
      expect(prop.body).toEqual([variant("s", "Two")]);
      const all = await bus.call({ path: "/Item", interface: "org.freedesktop.DBus.Properties", member: "GetAll", signature: "s", body: ["com.example.Item"] });
      expect(all.body).toEqual([[["Title", variant("s", "Two")]]]);
      const xml = await bus.call({ path: "/", interface: "org.freedesktop.DBus.Introspectable", member: "Introspect" });
      expect(xml.body![0]).toContain(`<node name="Item"/>`);
      const own = await bus.call({ path: "/Item", interface: "org.freedesktop.DBus.Introspectable", member: "Introspect" });
      expect(own.body![0]).toContain(`<method name="Rename"><arg type="s" direction="in"/><arg type="b" direction="out"/></method>`);
      const missing = await bus.call({ path: "/Item", interface: "com.example.Item", member: "Nope" });
      expect(missing).toMatchObject({ type: MessageType.Error, errorName: "org.freedesktop.DBus.Error.UnknownMethod" });

      conn.propertiesChanged("/Item", "com.example.Item", ["Title"]);
      conn.emit("/Item", "com.example.Item", "Changed");
      await bus.call({ path: "/", interface: "org.freedesktop.DBus.Peer", member: "Ping" }); // flushes the signals
      expect(bus.signals.map((s) => s.member)).toEqual(["PropertiesChanged", "Changed"]);
      expect(bus.signals[0]!.body).toEqual(["com.example.Item", [["Title", variant("s", "Two")]], []]);
      conn.close();
    } finally {
      bus.close();
    }
  });

  test("delivers matching signals and reports the bus going away", async () => {
    const bus = await startFakeBus();
    try {
      const conn = await DBusConnection.connect(bus.address);
      const seen: unknown[][] = [];
      conn.onSignal({ interface: "org.freedesktop.DBus", member: "NameOwnerChanged" }, (body) => seen.push(body));
      expect((await bus.waitFor("AddMatch")).body).toEqual([`type='signal',interface='org.freedesktop.DBus',member='NameOwnerChanged'`]);
      bus.signal({ path: "/org/freedesktop/DBus", interface: "org.freedesktop.DBus", member: "NameOwnerChanged", signature: "sss", body: ["a", "", ":1.9"] });
      bus.signal({ path: "/org/freedesktop/DBus", interface: "org.freedesktop.DBus", member: "Other", signature: "s", body: ["x"] });
      const closed = new Promise((resolve) => (conn.onClose = resolve));
      bus.disconnect();
      await closed;
      expect(seen).toEqual([["a", "", ":1.9"]]);
      expect(await conn.call({ destination: "x", path: "/", member: "y" }).catch((e) => e.message)).toContain("closed");
    } finally {
      bus.close();
    }
  });
});
