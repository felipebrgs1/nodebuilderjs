// System tray icon: a StatusNotifierItem (KDE, and GNOME with the AppIndicator extension) with
// a com.canonical.dbusmenu menu, both served over the session bus by our own D-Bus client.
// Spec: https://www.freedesktop.org/wiki/Specifications/StatusNotifierItem/

import { DBusConnection, DBusError } from "../dbus/connection.js";
import { type IconImage, type IconInput, iconImages } from "../image/icon.js";
import { type Accessor, type MaybeAccessor, batch, createEffect, createSignal, onCleanup, read } from "../reactive/signals.js";
import { type MenuNode, type TrayMenuEntry, buildMenu, layoutOf, propsOf } from "./menu.js";

export type { TrayMenuEntry, TrayMenuItem } from "./menu.js";

export interface TrayOptions {
  /** SVG markup or an image file, like `<Window icon>`. Default: the framework's icon. */
  icon?: MaybeAccessor<IconInput | undefined>;
  /** Shown on hover. */
  tooltip?: MaybeAccessor<string>;
  /** The item's name (lists of tray items, accessibility). */
  title?: MaybeAccessor<string>;
  /** Right click (and left click without `onClick`) opens it. */
  menu?: MaybeAccessor<readonly TrayMenuEntry[]>;
  /** Left click. Without it, a left click opens the menu. */
  onClick?: () => void;
  onMiddleClick?: () => void;
  /** Stable id for the desktop (e.g. to remember the item's position). Default: the app id. */
  id?: string;
}

export interface Tray {
  /** True while a tray host (the panel) shows the item. False without one (GNOME without the AppIndicator extension), in tests and after disposal. */
  available: Accessor<boolean>;
}

const BUS = "org.freedesktop.DBus";
const WATCHER = "org.kde.StatusNotifierWatcher";
const SNI = "org.kde.StatusNotifierItem";
const DBUSMENU = "com.canonical.dbusmenu";
const ITEM_PATH = "/StatusNotifierItem";
const MENU_PATH = "/MenuBar";
/** Trays draw at 16–48 px (x2 on HiDPI); 256 px would only make every NewIcon bigger. */
const MAX_TRAY_ICON = 128;

let busAddress: string | null = null;
let items = 0;
let warned = false;

/** run() points trays at the session bus; without it (tests, screenshots) they stay unavailable. Internal. */
export function setTrayBus(address: string | null) {
  busAddress = address;
}

type Pixmap = [number, number, Uint8Array];

/** SNI pixmaps: ARGB32 in network byte order (A R G B bytes), straight alpha. */
function pixmaps(images: IconImage[]): Pixmap[] {
  return images
    .filter((i) => i.size <= MAX_TRAY_ICON)
    .map(({ size, rgba }) => {
      const argb = new Uint8Array(rgba.length);
      for (let p = 0; p < rgba.length; p += 4) {
        argb[p] = rgba[p + 3]!;
        argb[p + 1] = rgba[p]!;
        argb[p + 2] = rgba[p + 1]!;
        argb[p + 3] = rgba[p + 2]!;
      }
      return [size, size, argb];
    });
}

function trayIcon(icon: IconInput | undefined): IconImage[] {
  try {
    return iconImages(icon);
  } catch (err) {
    console.warn(`nodebuilder: could not load the tray icon, using the default (${(err as Error).message})`);
    return iconImages();
  }
}

/** Run a handler outside the D-Bus dispatch, so its errors surface like any event handler's. */
const later = (fn: (() => void) | undefined) => fn && queueMicrotask(() => batch(fn));

/**
 * Shows an icon in the system tray while the calling scope lives (dispose the owner, e.g.
 * close the window, and it goes away). Options may be accessors: the item updates when they
 * change.
 */
export function createTray(options: TrayOptions): Tray {
  const [available, setAvailable] = createSignal(false);
  const address = busAddress;
  if (!address) return { available };

  let conn: DBusConnection | null = null;
  let disposed = false;
  let icon: Pixmap[] = [];
  let tooltip = "";
  let title = "";
  let menu = buildMenu([]);
  let revision = 0;

  createEffect(() => {
    icon = pixmaps(trayIcon(read(options.icon)));
    conn?.emit(ITEM_PATH, SNI, "NewIcon");
  });
  createEffect(() => {
    tooltip = read(options.tooltip) ?? "";
    conn?.emit(ITEM_PATH, SNI, "NewToolTip");
  });
  createEffect(() => {
    title = read(options.title) ?? "";
    conn?.emit(ITEM_PATH, SNI, "NewTitle");
  });
  createEffect(() => {
    menu = buildMenu(read(options.menu) ?? []);
    revision++;
    conn?.emit(MENU_PATH, DBUSMENU, "LayoutUpdated", "ui", [revision, 0]);
  });

  onCleanup(() => {
    disposed = true;
    setAvailable(false);
    conn?.close();
    conn = null;
  });

  const item = (id: number): MenuNode => {
    const node = menu.byId.get(id);
    if (!node) throw new DBusError("org.freedesktop.DBus.Error.InvalidArgs", `no menu item ${id}`);
    return node;
  };
  const clicked = (id: number, event: string): boolean => {
    const node = menu.byId.get(id);
    if (node && event === "clicked") later(node.onClick);
    return !!node;
  };

  DBusConnection.connect(address)
    .then(async (c) => {
      if (disposed) return c.close();
      conn = c;
      c.onClose = () => setAvailable(false);
      const name = `org.kde.StatusNotifierItem-${process.pid}-${++items}`;
      c.exportObject(ITEM_PATH, {
        [SNI]: {
          methods: {
            Activate: { in: "ii", call: () => void later(options.onClick) },
            SecondaryActivate: { in: "ii", call: () => void later(options.onMiddleClick) },
            ContextMenu: { in: "ii", call: () => {} },
            Scroll: { in: "is", call: () => {} },
          },
          properties: {
            Category: { signature: "s", get: () => "ApplicationStatus" },
            Id: { signature: "s", get: () => options.id ?? process.env.NB_APP_ID ?? "nodebuilder" },
            Title: { signature: "s", get: () => title },
            Status: { signature: "s", get: () => "Active" },
            WindowId: { signature: "i", get: () => 0 },
            IconName: { signature: "s", get: () => "" },
            IconPixmap: { signature: "a(iiay)", get: () => icon },
            OverlayIconName: { signature: "s", get: () => "" },
            OverlayIconPixmap: { signature: "a(iiay)", get: () => [] },
            AttentionIconName: { signature: "s", get: () => "" },
            AttentionIconPixmap: { signature: "a(iiay)", get: () => [] },
            AttentionMovieName: { signature: "s", get: () => "" },
            ToolTip: { signature: "(sa(iiay)ss)", get: () => ["", [], tooltip, ""] },
            ItemIsMenu: { signature: "b", get: () => !options.onClick },
            Menu: { signature: "o", get: () => MENU_PATH },
          },
          signals: { NewTitle: "", NewIcon: "", NewAttentionIcon: "", NewOverlayIcon: "", NewToolTip: "", NewStatus: "s" },
        },
      });
      c.exportObject(MENU_PATH, {
        [DBUSMENU]: {
          methods: {
            GetLayout: {
              in: "iias",
              out: "u(ia{sv}av)",
              call: ([parent, depth, names]) => [revision, layoutOf(item(parent as number), depth as number, names as string[])],
            },
            GetGroupProperties: {
              in: "aias",
              out: "a(ia{sv})",
              call: ([ids, names]) => [(ids as number[]).filter((id) => menu.byId.has(id)).map((id) => [id, propsOf(item(id), names as string[])])],
            },
            GetProperty: {
              in: "is",
              out: "v",
              call: ([id, name]) => {
                const prop = item(id as number).props.find(([k]) => k === name);
                if (!prop) throw new DBusError("org.freedesktop.DBus.Error.InvalidArgs", `no property ${name}`);
                return [prop[1]];
              },
            },
            Event: { in: "isvu", call: ([id, event]) => void clicked(id as number, event as string) },
            EventGroup: {
              in: "a(isvu)",
              out: "ai",
              call: ([events]) => [(events as [number, string][]).filter(([id, event]) => !clicked(id, event)).map(([id]) => id)],
            },
            AboutToShow: { in: "i", out: "b", call: () => [false] },
            AboutToShowGroup: { in: "ai", out: "aiai", call: () => [[], []] },
          },
          properties: {
            Version: { signature: "u", get: () => 3 },
            TextDirection: { signature: "s", get: () => "ltr" },
            Status: { signature: "s", get: () => "normal" },
            IconThemePath: { signature: "as", get: () => [] },
          },
          signals: { ItemsPropertiesUpdated: "a(ia{sv})a(ias)", LayoutUpdated: "ui", ItemActivationRequested: "iu" },
        },
      });

      const register = () =>
        c
          .call({ destination: WATCHER, path: "/StatusNotifierWatcher", interface: WATCHER, member: "RegisterStatusNotifierItem", signature: "s", body: [name] })
          .then(() => !disposed && setAvailable(true), () => setAvailable(false));
      // The panel restarting (or appearing later) means registering again.
      c.onSignal({ sender: BUS, interface: BUS, member: "NameOwnerChanged" }, ([owned, , owner]) => {
        if (owned !== WATCHER) return;
        if (owner) register();
        else setAvailable(false);
      });
      await c.call({ destination: BUS, path: "/org/freedesktop/DBus", interface: BUS, member: "RequestName", signature: "su", body: [name, 4] });
      await register();
    })
    .catch((err: Error) => {
      if (warned) return;
      warned = true;
      console.warn(`nodebuilder: no system tray (${err.message})`);
    });
  return { available };
}
