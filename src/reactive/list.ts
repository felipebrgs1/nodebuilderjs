// List components, mirroring SolidJS: <For> (keyed by reference) and <Index> (by position).

import { type Child, render } from "../jsx-runtime.js";
import type { UINode } from "../render/node.js";
import { type Accessor, type MaybeAccessor, createMemo, createRoot, createSignal, onCleanup, read, untrack } from "./signals.js";

interface Entry<T> {
  item: T;
  nodes: Accessor<UINode[]>;
  setIndex: (i: number) => void;
  dispose: () => void;
}

/**
 * Keyed list: each item is rendered once and kept while it stays in the array
 * (matched by reference), so state inside rows survives reordering.
 */
export function For<T>(props: {
  each: MaybeAccessor<readonly T[] | undefined | null>;
  fallback?: Child;
  children: (item: T, index: Accessor<number>) => Child;
}): Child {
  let entries: Entry<T>[] = [];
  onCleanup(() => entries.forEach((e) => e.dispose()));

  const mapped = createMemo(() => {
    const items = read(props.each) ?? [];
    return untrack(() => {
      const pool = new Map<T, Entry<T>[]>();
      for (const e of entries) {
        const list = pool.get(e.item);
        if (list) list.push(e);
        else pool.set(e.item, [e]);
      }
      const next = items.map((item, i) => {
        const reused = pool.get(item)?.shift();
        if (reused) {
          reused.setIndex(i);
          return reused;
        }
        return createRoot((dispose) => {
          const [index, setIndex] = createSignal(i);
          const child = props.children(item, index);
          const nodes = render(child);
          return { item, nodes, setIndex, dispose };
        });
      });
      for (const left of pool.values()) left.forEach((e) => e.dispose());
      entries = next;
      return next;
    });
  });

  return () => {
    const list = mapped();
    return list.length ? list.map((e) => e.nodes()) : props.fallback;
  };
}

interface Row<T> {
  setItem: (value: T) => void;
  nodes: Accessor<UINode[]>;
  dispose: () => void;
}

/**
 * List by position: row `i` is created once and its `item` accessor follows the value at
 * position `i`. Rows are only created or disposed when the length changes. For lists of
 * primitives, or values recreated on every update, where <For> would rebuild rows.
 */
export function Index<T>(props: {
  each: MaybeAccessor<readonly T[] | undefined | null>;
  fallback?: Child;
  children: (item: Accessor<T>, index: number) => Child;
}): Child {
  let rows: Row<T>[] = [];
  onCleanup(() => rows.forEach((r) => r.dispose()));

  // Returns the same array while the length holds, so the list slot only re-runs on resize.
  const mapped = createMemo(() => {
    const items = read(props.each) ?? [];
    return untrack(() => {
      const kept = Math.min(rows.length, items.length);
      for (let i = 0; i < kept; i++) rows[i]!.setItem(items[i] as T);
      if (items.length === rows.length) return rows;
      for (let i = kept; i < rows.length; i++) rows[i]!.dispose();
      const next = rows.slice(0, kept);
      for (let i = kept; i < items.length; i++) {
        next.push(
          createRoot((dispose) => {
            const [item, write] = createSignal<T>(items[i] as T);
            const child = props.children(item, i);
            const nodes = render(child);
            // The updater form, so a function stored in the list is a value, not an updater.
            return { setItem: (value: T) => write(() => value), nodes, dispose };
          }),
        );
      }
      rows = next;
      return next;
    });
  });

  return () => {
    const list = mapped();
    return list.length ? list.map((r) => r.nodes()) : props.fallback;
  };
}
