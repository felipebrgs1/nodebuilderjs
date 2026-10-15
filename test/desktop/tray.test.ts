// System tray: a StatusNotifierItem (+ com.canonical.dbusmenu menu) served over D-Bus, checked
// against an in-process fake bus: registration, properties, clicks, menu layout and events,
// reactive updates, the watcher coming and going, disposal.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createRoot, createSignal } from "@nodebuilderjs/core";
import { type Message, MessageType, type Variant, variant } from "../../src/dbus/wire.js";
import { iconImages } from "../../src/image/icon.js";
import { type Tray, type TrayOptions, createTray, setTrayBus } from "../../src/tray/tray.js";
import { type FakeBus, startFakeBus } from "./fake-bus.js";

const ITEM = "/StatusNotifierItem";
const MENU = "/MenuBar";
const SNI = "org.kde.StatusNotifierItem";
const DBUSMENU = "com.canonical.dbusmenu";

let bus: FakeBus;
const disposers: (() => void)[] = [];

beforeEach(async () => {
  bus = await startFakeBus();
  setTrayBus(bus.address);
});

afterEach(() => {
  disposers.splice(0).forEach((d) => d());
  setTrayBus(null);
  bus.close();
});

const tick = () => new Promise<void>((r) => setImmediate(r));
async function until(cond: () => boolean, what: string) {
  for (let i = 0; i < 200 && !cond(); i++) await tick();
  if (!cond()) throw new Error(`timed out waiting for ${what}`);
}

/** Creates the tray in its own root and waits until it registered with the watcher. */
async function tray(options: TrayOptions): Promise<Tray> {
  const t = createRoot((dispose) => {
    disposers.push(dispose);
    return createTray(options);
  });
  await until(() => t.available(), "registration");
  return t;
}

const props = async (path: string, iface: string) => {
  const reply = await bus.call({ path, interface: "org.freedesktop.DBus.Properties", member: "GetAll", signature: "s", body: [iface] });
  return Object.fromEntries((reply.body![0] as [string, Variant][]).map(([k, v]) => [k, v.value]));
};

type Layout = [number, [string, Variant][], Variant[]];
const layoutOf = async () => {
  const reply = await bus.call({ path: MENU, interface: DBUSMENU, member: "GetLayout", signature: "iias", body: [0, -1, []] });
  return reply.body as [number, Layout];
};
/** The menu as { id, props, children }, easier to assert on. */
const tree = (node: Layout): { id: number; props: Record<string, unknown>; children: unknown[] } => ({
  id: node[0],
  props: Object.fromEntries(node[1].map(([k, v]) => [k, v.value])),
  children: node[2].map((c) => tree(c.value as Layout)),
});

describe("tray", () => {
  test("registers a StatusNotifierItem with the watcher", async () => {
    const t = await tray({ tooltip: "Hello" });
    const name = (await bus.waitFor("RequestName")).body![0];
    expect(name).toBe(`org.kde.StatusNotifierItem-${process.pid}-1`);
    const register = await bus.waitFor("RegisterStatusNotifierItem");
    expect(register).toMatchObject({ destination: "org.kde.StatusNotifierWatcher", path: "/StatusNotifierWatcher", body: [name] });
    expect(t.available()).toBe(true);
  });

  test("serves the item's properties, with the icon as big-endian ARGB pixmaps", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="#ff8000"/></svg>`;
    await tray({ icon: svg, title: "Notes", tooltip: "3 unread", id: "com.example.notes" });
    const p = await props(ITEM, SNI);
    expect(p).toMatchObject({ Id: "com.example.notes", Title: "Notes", Status: "Active", Category: "ApplicationStatus", Menu: MENU, ItemIsMenu: true });
    const pixmaps = p.IconPixmap as [number, number, Uint8Array][];
    expect(pixmaps.map(([w, h]) => [w, h])).toEqual(iconImages(svg).filter((i) => i.size <= 128).map((i) => [i.size, i.size]));
    expect([...pixmaps[0]![2].subarray(0, 4)]).toEqual([255, 255, 128, 0]); // A R G B
    expect(p.ToolTip).toEqual(["", [], "3 unread", ""]);
  });

  test("without an icon, the tray uses the framework's", async () => {
    await tray({});
    const pixmaps = (await props(ITEM, SNI)).IconPixmap as [number, number, Uint8Array][];
    const big = iconImages().find((i) => i.size === 128)!.rgba;
    const argb = pixmaps.at(-1)![2];
    expect([argb[(64 * 128 + 40) * 4 + 1], argb[(64 * 128 + 40) * 4 + 2]]).toEqual([big[(64 * 128 + 40) * 4], big[(64 * 128 + 40) * 4 + 1]]);
  });

  test("clicks: Activate runs onClick (left click no longer opens the menu), SecondaryActivate onMiddleClick", async () => {
    const clicks: string[] = [];
    await tray({ onClick: () => clicks.push("left"), onMiddleClick: () => clicks.push("middle") });
    expect((await props(ITEM, SNI)).ItemIsMenu).toBe(false);
    await bus.call({ path: ITEM, interface: SNI, member: "Activate", signature: "ii", body: [10, 20] });
    await bus.call({ path: ITEM, interface: SNI, member: "SecondaryActivate", signature: "ii", body: [10, 20] });
    await tick();
    expect(clicks).toEqual(["left", "middle"]);
  });

  test("the menu: labels, separators, checkmarks, radios, disabled items and submenus", async () => {
    await tray({
      menu: [
        { label: "Open_file", onClick: () => {} },
        "separator",
        { label: "Mute", checked: true },
        { label: "Dark", checked: false, radio: true },
        { label: "Sync", enabled: false },
        { label: "More", children: [{ label: "About" }] },
      ],
    });
    const [revision, root] = await layoutOf();
    expect(revision).toBeGreaterThan(0);
    const t = tree(root);
    expect(t.props).toEqual({ "children-display": "submenu" });
    expect(t.children).toEqual([
      { id: 1, props: { label: "Open__file" }, children: [] },
      { id: 2, props: { type: "separator" }, children: [] },
      { id: 3, props: { label: "Mute", "toggle-type": "checkmark", "toggle-state": 1 }, children: [] },
      { id: 4, props: { label: "Dark", "toggle-type": "radio", "toggle-state": 0 }, children: [] },
      { id: 5, props: { label: "Sync", enabled: false }, children: [] },
      { id: 6, props: { label: "More", "children-display": "submenu" }, children: [{ id: 7, props: { label: "About" }, children: [] }] },
    ]);
    // A subtree, one level deep.
    const sub = await bus.call({ path: MENU, interface: DBUSMENU, member: "GetLayout", signature: "iias", body: [6, 0, []] });
    expect(tree((sub.body as [number, Layout])[1])).toEqual({ id: 6, props: { label: "More", "children-display": "submenu" }, children: [] });
    const group = await bus.call({ path: MENU, interface: DBUSMENU, member: "GetGroupProperties", signature: "aias", body: [[1, 3], ["label"]] });
    expect(group.body).toEqual([[[1, [["label", variant("s", "Open__file")]]], [3, [["label", variant("s", "Mute")]]]]]);
    expect(await props(MENU, DBUSMENU)).toMatchObject({ Version: 3, Status: "normal" });
  });

  test("a clicked menu item runs its onClick; other events and unknown ids do nothing", async () => {
    const clicked: string[] = [];
    await tray({ menu: [{ label: "A", onClick: () => clicked.push("A") }, { label: "B", children: [{ label: "C", onClick: () => clicked.push("C") }] }] });
    const event = (id: number, kind: string) => bus.call({ path: MENU, interface: DBUSMENU, member: "Event", signature: "isvu", body: [id, kind, variant("i", 0), 0] });
    await event(1, "clicked");
    await event(3, "clicked");
    await event(1, "hovered");
    await event(99, "clicked");
    const grouped = await bus.call({ path: MENU, interface: DBUSMENU, member: "EventGroup", signature: "a(isvu)", body: [[[1, "clicked", variant("i", 0), 0], [42, "clicked", variant("i", 0), 0]]] });
    expect(grouped.body).toEqual([[42]]); // ids not found
    await tick();
    expect(clicked).toEqual(["A", "C", "A"]);
    const shown = await bus.call({ path: MENU, interface: DBUSMENU, member: "AboutToShow", signature: "i", body: [0] });
    expect(shown.body).toEqual([false]);
  });

  test("reactive options update the item and signal the host", async () => {
    const [tooltip, setTooltip] = createSignal("idle");
    const [muted, setMuted] = createSignal(false);
    const [icon, setIcon] = createSignal<string | undefined>(undefined);
    await tray({ tooltip, icon, menu: () => [{ label: "Mute", checked: muted() }] });
    const [rev] = await layoutOf();

    setTooltip("busy");
    setMuted(true);
    setIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="#000"/></svg>`);
    await until(() => bus.signals.some((s) => s.member === "LayoutUpdated") && bus.signals.some((s) => s.member === "NewIcon"), "signals");
    await until(() => bus.signals.some((s) => s.member === "NewToolTip"), "tooltip signal");
    expect((await props(ITEM, SNI)).ToolTip).toEqual(["", [], "busy", ""]);
    const [rev2, root] = await layoutOf();
    expect(rev2).toBeGreaterThan(rev);
    expect(tree(root).children[0]).toMatchObject({ props: { "toggle-state": 1 } });
    const updated = bus.signals.find((s) => s.member === "LayoutUpdated")!;
    expect(updated).toMatchObject({ path: MENU, body: [rev2, 0] });
  });

  test("registers again when the watcher (the panel) restarts; unavailable without one", async () => {
    let watcher = false;
    bus.answer = (msg: Message) => {
      if (msg.member === "RegisterStatusNotifierItem" && !watcher) throw ["org.freedesktop.DBus.Error.ServiceUnknown", "no watcher"];
    };
    const t = createRoot((dispose) => {
      disposers.push(dispose);
      return createTray({});
    });
    await bus.waitFor("RegisterStatusNotifierItem");
    await until(() => bus.calls.some((c) => c.member === "AddMatch"), "match");
    await tick();
    expect(t.available()).toBe(false);

    watcher = true;
    bus.signal({ sender: "org.freedesktop.DBus", path: "/org/freedesktop/DBus", interface: "org.freedesktop.DBus", member: "NameOwnerChanged", signature: "sss", body: ["org.kde.StatusNotifierWatcher", "", ":1.50"] });
    await until(() => t.available(), "registration after the watcher appeared");
    expect(bus.calls.filter((c) => c.member === "RegisterStatusNotifierItem")).toHaveLength(2);
  });

  test("disposing the owner closes the connection", async () => {
    const [on, setOn] = createSignal(true);
    let t!: Tray;
    createRoot((dispose) => {
      disposers.push(dispose);
      // Inside an effect-like scope: the tray goes when its owner is disposed.
      t = createTray({ tooltip: () => (on() ? "on" : "off") });
    });
    await until(() => t.available(), "registration");
    disposers.pop()!();
    expect(t.available()).toBe(false);
    setOn(false); // no update after disposal
    await tick();
    expect(bus.signals.some((s) => s.member === "NewToolTip")).toBe(false);
  });

  test("without a session bus (tests, no run()), nothing connects", async () => {
    setTrayBus(null);
    const t = createRoot((dispose) => {
      disposers.push(dispose);
      return createTray({ tooltip: "x" });
    });
    await tick();
    expect(t.available()).toBe(false);
    expect(bus.calls).toHaveLength(0);
  });

  test("method calls on the item are answered with the right message type", async () => {
    await tray({});
    const reply = await bus.call({ path: ITEM, interface: SNI, member: "ContextMenu", signature: "ii", body: [0, 0] });
    expect(reply.type).toBe(MessageType.MethodReturn);
  });
});
