// Control flow components, mirroring SolidJS.

import { type Child, resolve } from "../jsx-runtime.js";
import type { UINode } from "../render/node.js";
import { type Accessor, type MaybeAccessor, createMemo, createRoot, createSignal, onCleanup, read, untrack } from "./signals.js";

export function Show(props: { when: MaybeAccessor<unknown>; fallback?: Child; children?: Child }): Child {
  const visible = createMemo(() => !!read(props.when));
  return () => (visible() ? props.children : props.fallback);
}

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
          const nodes = createMemo(() => resolve(child), { equals: false });
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
