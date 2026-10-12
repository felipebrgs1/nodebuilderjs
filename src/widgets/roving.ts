// Groups that are a single Tab stop (radio buttons, tabs): Tab lands on the selected item,
// and the arrow keys move the selection to the next enabled item, wrapping around.

import type { UINode } from "../render/node.js";
import { type Accessor, createEffect } from "../reactive/signals.js";

export interface RovingItem {
  node: UINode;
  disabled: Accessor<boolean>;
  select: () => void;
}

export function rovingFocus(items: RovingItem[], selected: Accessor<number>, keys: { next: string[]; prev: string[] }) {
  createEffect(() => {
    const i = selected();
    const current = items[i] && !items[i].disabled() ? items[i] : items.find((it) => !it.disabled());
    for (const it of items) it.node.tabStop = it === current;
  });
  items.forEach((item, index) => {
    const own = item.node.handlers.onKeyDown;
    item.node.handlers.onKeyDown = (e) => {
      const step = keys.next.includes(e.key) ? 1 : keys.prev.includes(e.key) ? -1 : 0;
      if (!step) return own?.(e);
      e.stop();
      for (let k = 1; k < items.length; k++) {
        const next = items[(index + step * k + items.length * k) % items.length]!;
        if (next.disabled()) continue;
        next.select();
        next.node.focus();
        return;
      }
    };
  });
}
