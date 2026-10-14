// A tray menu as com.canonical.dbusmenu sees it: numbered items with properties, laid out as
// (id, props, children) tuples. Spec: libdbusmenu's com.canonical.dbusmenu.xml.

import { type Variant, variant } from "../dbus/wire.js";

export interface TrayMenuItem {
  label: string;
  onClick?: () => void;
  /** false: shown greyed out. */
  enabled?: boolean;
  /** false: not shown. */
  visible?: boolean;
  /** Shows a checkmark (or a radio dot with `radio`), on or off. */
  checked?: boolean;
  radio?: boolean;
  /** A submenu. */
  children?: TrayMenuEntry[];
}

export type TrayMenuEntry = TrayMenuItem | "separator";

export interface MenuNode {
  id: number;
  props: [string, Variant][];
  children: MenuNode[];
  onClick?: () => void;
}

/** (id, properties, children as variants): the dbusmenu layout type "(ia{sv}av)". */
export type MenuLayout = [number, [string, Variant][], Variant[]];

export const LAYOUT_SIGNATURE = "(ia{sv}av)";

/** Numbers the entries depth-first from 1 (0 is the root). */
export function buildMenu(entries: readonly TrayMenuEntry[]): { root: MenuNode; byId: Map<number, MenuNode> } {
  const byId = new Map<number, MenuNode>();
  let next = 0;
  const node = (props: [string, Variant][], onClick?: () => void): MenuNode => {
    const n: MenuNode = { id: next++, props, children: [], onClick };
    byId.set(n.id, n);
    return n;
  };
  const build = (entry: TrayMenuEntry): MenuNode => {
    if (entry === "separator") return node([["type", variant("s", "separator")]]);
    // "_" marks a mnemonic in dbusmenu labels; "__" is a literal underscore.
    const props: [string, Variant][] = [["label", variant("s", entry.label.replace(/_/g, "__"))]];
    if (entry.enabled === false) props.push(["enabled", variant("b", false)]);
    if (entry.visible === false) props.push(["visible", variant("b", false)]);
    if (entry.checked !== undefined) {
      props.push(["toggle-type", variant("s", entry.radio ? "radio" : "checkmark")]);
      props.push(["toggle-state", variant("i", entry.checked ? 1 : 0)]);
    }
    if (entry.children) props.push(["children-display", variant("s", "submenu")]);
    const n = node(props, entry.onClick);
    n.children = (entry.children ?? []).map(build);
    return n;
  };
  const root = node([["children-display", variant("s", "submenu")]]);
  root.children = entries.map(build);
  return { root, byId };
}

/** Only the properties asked for (all when `names` is empty). */
export function propsOf(node: MenuNode, names: readonly string[]): [string, Variant][] {
  return names.length ? node.props.filter(([k]) => names.includes(k)) : node.props;
}

/** `node` with `depth` levels of children (-1: all). */
export function layoutOf(node: MenuNode, depth: number, names: readonly string[]): MenuLayout {
  const children = depth === 0 ? [] : node.children.map((c) => variant(LAYOUT_SIGNATURE, layoutOf(c, depth - 1, names)));
  return [node.id, propsOf(node, names), children];
}
