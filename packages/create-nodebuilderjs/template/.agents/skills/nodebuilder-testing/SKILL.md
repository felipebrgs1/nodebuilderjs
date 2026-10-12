---
name: nodebuilder-testing
description: Write and debug tests for nodebuilder apps with bun test, without opening a window (mount, findByText, findByLabel, click, interact for mouse and keyboard, layout, debugTree). Use when creating tests, when verifying a behavior or layout change, or when a component test fails.
---

# Tests without a window

`bun test` runs the files in `test/`. Nothing opens a window: `mount` builds the tree with
fake text metrics (**8 px per character, 20 px line**), so layout is deterministic.

```tsx
import { expect, test } from "bun:test";
import { click, findAll, findByText, mount } from "@nodebuilderjs/core/testing";
import { debugTree } from "@nodebuilderjs/core";
import { App } from "../src/App.js";

test("adds a task", () => {
  const { root, relayout, dispose } = mount(() => <App />, { width: 800, height: 600 });
  click(findByText(root, "Add")!);                // walks up to the parent with onClick (the Button)
  expect(findByText(root, /1 task/)).toBeDefined();
  relayout();                                     // recomputes positions after changes
  const item = findByText(root, "New task")!;
  expect(item.y).toBeGreaterThan(0);
  dispose();                                      // disposes the app's effects and signals
});
```

## API (`@nodebuilderjs/core/testing`)

- `mount(view, size?)` → `{ root, relayout, dispose }`. Layout runs once in `mount`;
  call `relayout()` before checking `x`, `y`, `width`, `height` after changing state.
- `findByText(root, "text" | /regex/)`: first `Text` whose entire content matches;
  `findAllByText` returns every match (e.g. a title repeated in a list and in a player bar).
- `findByLabel(root, "label" | /regex/)` / `findAllByLabel`: by `ariaLabel`, for elements
  without text (`<Button ariaLabel="Play">` with only an icon). Built-in labels: the window's
  title-bar buttons (`"Minimize"`, `"Maximize"` or `"Restore"`, `"Close"`), and a `Tooltip`'s
  trigger gets the tip text when it has no `ariaLabel` of its own.
- `findAll(root, (n) => ...)`: free-form search; `n.label` is `"Text \"...\""`, `"Button"`, `"Row"`...
- `click(node)`: fires the `onClick` of the node or of its nearest ancestor (quick shortcut),
  at the node's center.
- `interact(root)`: mouse and keyboard delivered as in the real app (hover, focus, capture
  while dragging, Tab): `hover(n)`, `press(n)`, `release(n)`, `drag(n, dx, dy)`, `move(x, y)`,
  `down(x, y)`/`up(x, y)` (button at a window position, e.g. on the scrollbar),
  `scroll(n, dy, { dx, shift })`, `key("Return")`, `key("c", { ctrl: true })`,
  `type("text")`, `focused` and `cursor` (the cursor the window would show).

```tsx
const ui = interact(root);
ui.press(field);            // focuses the TextField
ui.type("Ana");             // types into the focused field
ui.key("Return");           // fires onSubmit
ui.drag(slider, 80, 0);     // drags 80 px to the right
```
- **Hidden targets throw.** `click(n)` and the node helpers of `interact` (`hover`, `press`,
  `release`, `drag`, `scroll`) throw when a user could not reach the node: it is `culled`
  (it, or an ancestor, is outside the visible area of the last layout, e.g. a chip that
  overflowed a `clip` panel or a row far down a `Scroll`), or its center is cut off by a
  clipping/scrolling ancestor or the window. The message names the node and the ancestor.
  Fix the test (or the layout): `n.scrollIntoView()` then `relayout()`, give it room (a
  bigger `mount` size, `width`), or `relayout()` if the tree changed since the last layout.
  `down(x, y)`/`up(x, y)`/`move(x, y)` take window positions and are never checked.

```tsx
import { expect, test } from "bun:test";
import { Button, For, Row, Scroll } from "@nodebuilderjs/core";
import { click, findAllByText, findByLabel, findByText, mount } from "@nodebuilderjs/core/testing";

test("plays a genre that starts off screen", () => {
  const played: string[] = [];
  const genres = ["Rock", "Jazz", "Pop", "Funk", "Soul"];
  const { root, relayout } = mount(() => (
    <Row>
      <Button ariaLabel="Play" label="▶" onClick={() => played.push("all")} />
      <Scroll horizontal width={300}>
        <For each={genres}>{(g) => <Button label={g} width={100} onClick={() => played.push(g)} />}</For>
      </Scroll>
    </Row>
  ));
  click(findByLabel(root, "Play")!);
  const soul = findByText(root, "Soul")!;
  expect(() => click(soul)).toThrow(/culled/); // past the 300 px Scroll
  soul.scrollIntoView();
  relayout();
  click(soul);
  expect(played).toEqual(["all", "Soul"]);
  expect(findAllByText(root, /o/)).toHaveLength(3); // Rock, Pop, Soul
});
```
- `debugTree(node)` (from `@nodebuilderjs/core`): tree with positions, great for inspecting layout.
- Animations finish immediately in tests (there is no window): a closed `Dialog` leaves the
  tree at once. To test the animation, `const clock = frames()` after `mount()` and
  `clock.advance(ms)` (16 ms frames).
- `ref={(el) => el.focus()}` (focus on creation) takes effect in a microtask: create
  `interact(root)` and `await Promise.resolve()` before typing. `onResize` fires on every
  `relayout()` in which the size changed.
- Scrolling: `n.scrollY`/`n.scrollX` give the position; `ui.scroll(n, 60)` uses the wheel,
  `ui.key("Next")` (PageDown; PageUp is `"Prior"`) the keyboard. `scrollTo` and `scrollIntoView()`
  apply on the next layout: call `relayout()` before checking.
- Overlays are positioned during layout: after opening or closing one, call `relayout()`.
  Their content lives in `root.layers` (not in `root.children`); `findByText(root, ...)` searches
  both.

## Clipboard and selection

In tests, `clipboard` is an in-memory area (no window, no system). To check a copy, read it
back; reading is asynchronous, so the test becomes `async`:

```tsx
import { expect, test } from "bun:test";
import { Column, Text, clipboard } from "@nodebuilderjs/core";
import { interact, mount } from "@nodebuilderjs/core/testing";

test("copies the id by selecting the text", async () => {
  const { root } = mount(() => <Column align="start"><Text selectable>id-42</Text></Column>);
  const ui = interact(root);
  const id = root.children[0]!.children[0]!;
  ui.press(id);                 // the click gives focus to the text
  ui.release(id);
  ui.key("a", { ctrl: true });  // Ctrl+A: everything (or ui.drag(id, dx, 0) for a range)
  ui.key("c", { ctrl: true });
  expect(await clipboard.readText()).toBe("id-42");
});
```

To test pasting into a `TextField`, write first with `clipboard.writeText(...)`, focus the
field, `ui.key("v", { ctrl: true })` and wait one loop turn
(`await new Promise((r) => setImmediate(r))`) before checking the value. The in-memory area
is shared within the file: write the expected value at the start of each test.

## Tips

- State changes immediately (signals are synchronous); there is no `await` or `act()` (the
  exception is reading the clipboard, above).
- Prefer `interact` over calling handlers by hand: it also tests focus, hover and propagation.
  After changes that move nodes, call `relayout()` before interacting again.
- Test layout calculations with fixed sizes (`width`, `height`) so they do not depend on the
  fake metrics.
- Before finishing a task: `bun run typecheck && bun test`.
