---
name: nodebuilder-testing
description: Write and debug tests for nodebuilder apps with bun test, without opening a window (mount, findByText with { in } for repeated texts, findByLabel, findByValue/findByPlaceholder for text fields, shownText, click, interact for mouse and keyboard, layout, debugTree, layoutWarnings for hidden overflow, real text metrics), and look at the UI with screenshots (nodebuilder screenshot, --props for a given page, screenshot()). Use when creating tests, when verifying a behavior, layout or visual change, or when a component test fails.
---

# Tests without a window

`bun test` runs the files in `test/`. Nothing opens a window: `mount` builds the tree with
fake text metrics (**8 px per character, 20 px line**), so layout is deterministic (real
fonts on request: `useRealTextMetrics()`, below).

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

- `mount(view, { width?, height?, paint? })` → `{ root, relayout, dispose, layoutWarnings }`.
  Layout runs once in `mount`; call `relayout()` before checking `x`, `y`, `width`, `height` after
  changing state. Without a size: a `<Window>`'s `width`/`height` (the window fills it, as in the
  app), else 800x600. `paint: true` also paints after every layout, so `Canvas` draw callbacks run.
- A custom widget (a `Canvas` editor) is found by `ariaLabel`: `<Canvas ariaLabel="Editor">`
  and `findByLabel(root, "Editor")`.
- `layoutWarnings()` (from `mount`, or `layoutWarnings(root)`): overflow warnings of the last
  layout, e.g. `layout: Row > Text("Artists") overflows Box(panel) by 42px (children need
  342px, 300px available)`: children that need more room than they get, cut off by a `clip`
  ancestor or the window (past a `Scroll` on its scrolling axis does not count). `mount` does
  not fail on them; assert `expect(layoutWarnings()).toEqual([])` in screen tests so a hidden
  chip fails right away instead of when a click finds it.
- `findByText(root, "text" | /regex/)`: first `Text` whose entire content matches;
  `findAllByText` returns every match (e.g. a title repeated in a list and in a player bar),
  in tree order with overlay layers (dialogs, menus) last. When the same text is in several
  places, narrow it by the widget it is in: `findByText(root, "Quit", { in: "Button" })`
  (the button, not the dialog title or the menu item), or search inside a container:
  `findByText(dialogNode, "Quit")`.
- `findByValue(root, "typed" | /regex/)` / `findAllByValue`: text fields (`TextField`) by
  their value; `findByPlaceholder(root, "Email")` finds an empty field. `shownText(node)` is
  what a node draws: a field's value, `"••••"` for a `password` field, a `Text`'s content.
- `findByLabel(root, "label" | /regex/)` / `findAllByLabel`: by `ariaLabel`, for elements
  without text (`<Button ariaLabel="Play">` with only an icon). Built-in labels: the window's
  title-bar buttons (`"Minimize"`, `"Maximize"` or `"Restore"`, `"Close"`), and a `Tooltip`'s
  trigger gets the tip text when it has no `ariaLabel` of its own.
- `findAll(root, (n) => ...)`: free-form search; `n.label` is `"Text \"...\""`, `"Button"`, `"Row"`...
- `click(node)`: fires the `onClick` of the node or of its nearest ancestor (quick shortcut),
  at the node's center.
- `interact(root)`: mouse and keyboard delivered as in the real app (hover, focus, capture
  while dragging, Tab): `hover(n)`, `press(n)`, `release(n)`, `click(n, { ctrl: true })`,
  `contextMenu(n)` (right press), `drag(n, dx, dy)`, `move(x, y)`,
  `down(x, y)`/`up(x, y)` (button at a window position, e.g. on the scrollbar),
  `scroll(n, dy, { dx, shift, ctrl })`, `key("Return")`, `key("c", { ctrl: true })`,
  `keyUp("Control_L")`, `type("text")`, `focused` and `cursor` (the cursor the window would
  show). Modifiers are `{ ctrl, shift, alt, meta }`. Every
  `interact(root)` on the same root shares one pointer and one focus, like the real window:
  a `press` from one call and a `release` from another still click.

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
- **Real text metrics:** `useRealTextMetrics()` makes this and every later `mount` measure
  text with the installed fonts (no window) and returns a function that restores the previous
  metrics; `useFakeTextMetrics({ charWidth, lineHeight })` sets fake ones (the default is 8
  and 20). Use real metrics to check that a label really fits (`layoutWarnings()` empty with
  a `clip` panel); numbers depend on the machine's fonts, so assert relations, not exact
  pixels. Guard with `test.skipIf(!canUseRealTextMetrics())` and restore in `afterEach`.

```tsx
import { afterEach, expect, test } from "bun:test";
import { Row, Text } from "@nodebuilderjs/core";
import { canUseRealTextMetrics, layoutWarnings, mount, useFakeTextMetrics, useRealTextMetrics } from "@nodebuilderjs/core/testing";

afterEach(() => useFakeTextMetrics());

test.skipIf(!canUseRealTextMetrics())("the header fits with real fonts", () => {
  useRealTextMetrics();
  const { root } = mount(() => <Row width={240} clip><Text>Recently played</Text></Row>);
  expect(layoutWarnings(root)).toEqual([]);
});
```
- `debugTree(node)` (from `@nodebuilderjs/core`): tree with positions, great for inspecting
  layout; a container whose children overflow a clip is marked `[overflow +42]`.
- Animations finish immediately in tests (there is no window): a closed `Dialog` leaves the
  tree at once. To test the animation, `const clock = frames()` after `mount()` and
  `clock.advance(ms)` (16 ms frames).
- `ref={(el) => el.focus()}` (focus on creation) lands as soon as the element is in the
  tree: `interact(root).type(...)` right after `mount` reaches it, no `await`. `onResize`
  fires on every `relayout()` in which the size changed, and what it changes (children built
  from the width) is placed by that same layout: clickable right away.
- With nothing focused (a click on empty space), keys go to the top node (the `Window`'s
  `onKeyDown`): `interact(root).key("Escape")` tests a window-wide shortcut.
- **A click inside a `Scroll` focuses the `Scroll`** (so the arrow and page keys scroll it),
  and keys bubble up from there. "Empty space" inside a scrolling page is not empty: a test
  of "Escape after clicking on empty space" that clicks inside a `Scroll` passes even
  without the page's `focusable`. Click outside every `Scroll`, and check where focus went
  with `interact(root).focused`.
- **Test that a prop is reactive on the same node.** Mount the component alone (not the
  whole `App`), keep the node, change the state, and check that node again. Through the
  whole app, a screen switch can recreate the node, and a new node already reads the new
  value, so the test passes even when the prop is not reactive. Check that the test fails
  without the fix.
- Scrolling: `n.scrollY`/`n.scrollX` give the position; `ui.scroll(n, 60)` uses the wheel,
  `ui.key("Next")` (PageDown; PageUp is `"Prior"`) the keyboard. `scrollTo` and `scrollIntoView()`
  apply on the next layout: call `relayout()` before checking.
- Overlays are positioned during layout: after opening or closing one, call `relayout()`.
  Their content lives in `root.layers` (not in `root.children`); `findByText(root, ...)` searches
  both.

## Look at the UI: screenshots

Tests check boxes, not looks. **After a visual change, take a screenshot and look at it**
(read the PNG): wrong colors, clipped text, misalignment and missing icons show up at once.
No window or display server is needed (it renders with the GPU through EGL):

```sh
bun run screenshot                      # screenshot.png: src/main.tsx at the <Window>'s size
nodebuilder screenshot src/main.tsx dark.png --theme dark --scale 2 --width 1024 --height 700
nodebuilder screenshot src/main.tsx p3.png --color-space display-p3   # wide-gamut colors kept, PNG tagged P3
```

Animations run to their end on a simulated clock (`--wait-frames <n>` stops earlier).

**A given page or state:** let the top component take its initial state as props
(`<App page="settings" />`; `src/main.tsx` passes the real one), then shoot the component
the file exports with `--props` (the file must not call `run()` itself, so point it at
`src/App.tsx`, not `src/main.tsx`); `--export Name` picks a named export:

```sh
nodebuilder screenshot src/App.tsx settings.png --props '{"page":"settings"}' --export App
```

**An app that reads arguments or the user's files:** arguments after `--` reach it
(`nodebuilder screenshot src/main.tsx out.png -- --vault ./sample`), and `isScreenshot()` from
`@nodebuilderjs/core` is true during a shot: use sample data then, so the shot never reads or
creates the user's real files.

Or keep small shot files in the repo (they double as visual fixtures):
`src/shots/settings.tsx` = `run(() => <App page="settings" />)`, then
`nodebuilder screenshot src/shots/settings.tsx settings.png`. A file that does not call
`run()` gets its default export rendered: `export default function Shot() { ... }` with
whatever state the shot needs (a server already added, a dialog open). Keep shot files under
`src/` so the JSX settings of `tsconfig.json` and the `@nodebuilderjs/core` import apply.

In a test, `screenshot()` gives the real pixels of a mounted tree, with real fonts:

```tsx
import { expect, test } from "bun:test";
import { Box } from "@nodebuilderjs/core";
import { canScreenshot, mount, savePNG, screenshot } from "@nodebuilderjs/core/testing";

test.skipIf(!canScreenshot())("the banner is red", () => {
  const { root } = mount(() => <Box height={40} background="#e01b24" />, { width: 200, height: 40 });
  const shot = screenshot(root, { scale: 2 });         // 400x80 pixels
  expect(shot.pixel(10, 10)).toEqual([0xe0, 0x1b, 0x24, 255]); // [r, g, b, a], straight alpha
  savePNG(shot, "banner.png");                         // to look at it
});
```

- `screenshot(root | () => view, { width, height, scale, background, colorSpace })` →
  `{ width, height, scale, colorSpace, rgba, pixel(x, y), toPNG() }`; size in device pixels.
  `colorSpace: "display-p3"` gives P3 pixel values (sRGB `#ff0000` is `[234, 51, 35]`) and a
  P3-tagged PNG; default sRGB, where colors past it are clipped. A view
  that is a `<Window>` is shot at the window's size, filled by it (as `nodebuilder screenshot`
  does). Uncovered areas stay transparent. The test's text metrics (fake by default) come back after the shot.
- Pixels depend on the machine's fonts and GPU: assert colors at chosen points, not whole
  images. `canScreenshot()` is false without a GPU driver (e.g. some CI runners).

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
- Before finishing a task: `bun run typecheck && bun test`, and a screenshot if anything visual changed.
