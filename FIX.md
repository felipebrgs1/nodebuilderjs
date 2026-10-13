# Fixes from the Discord clone report

A user built a Discord clone with `@nodebuilderjs/core` 0.2.5 and reported 21 problems. This
file checks each one against the current code (0.3.0 plus the unreleased fonts work) and
says what is left: the fix, where it goes and the test that proves it (TDD, see `AGENTS.md`).

Status: **fixed** (nothing to do but tell users), **open** (framework change), **docs** (the
behavior is right or acceptable; the docs/skills must say it), **partial**.

## Summary

| # | Problem | Status | Priority |
|---|---|---|---|
| 1 | No way to choose the font; only regular and bold | fixed | - |
| 2 | Emoji drawn as boxes | fixed | - |
| 3 | `TextField` has no password mode | open | P1 |
| 4 | `TextField` overrides `borderWidth`/`borderColor` | open | P1 |
| 5 | No window-level keys (Esc with nothing focused) | open | P1 |
| 6 | `Button` rejects pointer handlers; `background` kills its hover | partial | P1 |
| 7 | `Button` `variant` not reactive | open | P2 |
| 8 | `clip` lets a card shrink below its content, the cut-off button stops getting clicks | partial | P2 |
| 9 | No `flex-wrap`, grid or percentages | partial | P2 |
| 10 | No `margin`, no per-corner radius; unknown props pass silently | partial | P2 |
| 11 | The `run()` callback is reactive: reading and writing signals there loops forever | open | P0 |
| 12 | An effect in the component body runs before the `ref` exists | open | P1 |
| 13 | The global `requestAnimationFrame` does not exist in tests | docs | P2 |
| 14 | `findByText` does not see a `TextField`'s value | open | P1 |
| 15 | Nodes created in `onResize` have no position until another layout | open | P1 |
| 16 | `ref.focus()` during creation lands one microtask later | open | P2 |
| 17 | No way to find icon-only buttons in tests | fixed | - |
| 18 | Repeated texts: `findByText` returns the first | partial | P2 |
| 19 | `pkill -f` killed the agent's own shell | docs | P3 |
| 20 | Screenshots of the wrong window | fixed | - |
| 21 | No way to open the app on a given page to look at it | docs | P2 |

## Framework limitations

### 1. Choosing the font (fixed)
0.3.0 added `fontWeight` 1..1000 (semibold and the rest; the closest face or a variable font's
`wght` axis). The unreleased fonts work adds `fontFamily` (CSS lists), `registerFont` (TTF,
OTF, TTC, WOFF, WOFF2, variable), synthetic bold/italic, `fontFeatures`, `fontVariations` and
`fontFamilies()`. The `fonts.conf` + `FONTCONFIG_FILE` workaround is no longer needed: with the
gg sans files, `registerFont` each weight and set `fontFamily="gg sans, 'Noto Sans',
sans-serif"` on the `Window`. What is left for fonts is in `FONTS.md`.

### 2. Emoji as boxes (fixed)
0.3.0 has font fallback by cluster and color emoji (CBDT/sbix/COLRv0, Noto Color Emoji
included). The emoji removed from the clone's sample data can come back.

### 3. Password field (open, P1)
- **Fix:** `<TextField password>` (also `MaybeAccessor<boolean>`, for a "show password" toggle).
  The value stays real; only painting and measuring use `"•".repeat(chars().length)`, so the
  caret, typing in the middle, Backspace/Delete and paste all keep working on the real value.
  Copy (when selection exists) must refuse to copy a password, like browsers.
- **Where:** `src/widgets/text-field.ts` (a `shown()` accessor used by paint, `widthOf` and the
  caret position).
- **Test (`controls` or a new `text-field` file):** type "abc", move left twice, type "X": the
  value is "aXbc" and the text command draws "••••"; toggling `password` off draws "aXbc".

### 4. `TextField` border props ignored (open, P1)
- **Problem:** an effect always sets `borderWidth` 1/2 and `theme.field.border`/`focus`,
  overwriting the app's props (`background` is already respected).
- **Fix:** follow the convention in `AGENTS.md` ("respect the color the app passed"): when the
  app passes `borderColor` or `borderWidth`, the effect does not touch it. Add
  `focusBorderColor` (and maybe `focusBorderWidth`) so an app can restyle the focus ring
  instead of losing it; `hoverStyle`-like `focusStyle` is the general version (P2).
- **Test:** `<TextField borderWidth={0} borderColor="#000000" />` keeps both before and after
  focus; with `focusBorderColor`, focusing shows that color; without props, today's behavior.

### 5. Window-level keys (open, P1)
- **Problem:** keys only travel up from the focused node. With nothing focused (a click on
  empty space blurs everything), nobody gets Esc. The clone made menu items `Button`s just to
  hold focus, which also shows a focus ring.
- **Fix, two parts:**
  1. Keys with no focused node go to the `Window` (and its `onKeyDown`), so
     `<Window onKeyDown={...}>` receives everything that nothing below handled (`stop()` keeps
     working). Today the walk starts at `focused` and stops at null.
  2. `focusable` (and `tabStop`) props on any container, so a page can hold focus without
     pretending to be a button; a click on a focusable container focuses it, with no focus
     ring unless it is reached with Tab (`:focus-visible` behavior).
  Optionally, `useKeyboardShortcut("Escape", handler)` scoped to the owner (removed on cleanup)
  for global shortcuts like Ctrl+K.
- **Where:** `src/runtime/input.ts` (`keyDown`), `src/widgets/props.ts` (`focusable` prop),
  `src/widgets/window.ts`.
- **Test (`input`):** with nothing focused, `interact(root).key("Escape")` reaches the Window's
  `onKeyDown`; a focused child that calls `stop()` keeps it from the Window; clicking a
  `<Column focusable>` focuses it and its `onKeyDown` gets Esc afterwards.
- **Also:** `<Overlay modal>` covering the title bar is a separate issue: a full-window
  overlay should leave the title bar (CSD) usable, or take an `inset` so the app can.

### 6. `Button` and pointer handlers (partial, P1)
- **Done in 0.3.0:** `hoverStyle`/`pressStyle` and `createInteraction()` work on `Button`, so
  a custom `background` can have its own hover without a wrapping `Box`.
- **Open:** `Button`'s props type is `StyleProps & {...}` without `Handlers`, so
  `onPointerEnter`/`onPointerLeave`/`onPointerDown`/`onKeyDown` are type errors (at runtime
  `applyProps` would wire them). Accept `Handlers` (minus `onClick`, whose signature it already
  has) on every widget that is a node: `Button`, `Toggle`, `Card`, `Icon`... Check every widget
  props type against `HANDLER_KEYS`.
- **Test:** a type-level test (a `.tsx` in `test/` that must typecheck) plus a runtime one:
  `onPointerEnter` on a `Button` runs on hover and the button's own hover color still applies
  (handlers are chained).

### 7. Reactive `Button` `variant` (open, P2)
- **Fix:** `variant?: MaybeAccessor<Variant>`; the palette and `bold` effects read it.
- **Test (`controls`):** switching a signal from "default" to "primary" changes the background
  and the text weight in the commands, and hover colors follow the new variant.

### 8. `clip` and shrinking (partial, P2)
- **Behavior:** a `clip` node may shrink below its content, as CSS `overflow: hidden` does
  (`min-size: auto` becomes 0), and a clipped-away child is not clickable, as on the web. That
  is correct; the surprise was that it happened silently.
- **Done in 0.3.0:** overflow warnings: `run()` prints, in development, `... overflows
  Card(...) by 36px`, and tests can read `layoutWarnings()`. That catches this exact case.
- **Open:** say it in the `nodebuilder-ui` skill where `clip` is described ("a clipping card
  can be squeezed; give it `minHeight` or let it grow"), and make sure the warning names the
  clipping node.

### 9. Wrapping and grid (partial, P2)
- **Done in 0.3.0:** `<Row wrap>` (with `rowGap`) and `<Grid columns>`; the clone's manual
  grid with `onResize` can go.
- **Open:** percentages (`width="50%"`). Proposal: `width`/`height`/`min*`/`max*` accept
  `` `${number}%` `` of the parent's content box (as CSS), resolved in `layout.ts`;
  `grow` covers most uses, so P3 unless more reports ask for it. A `Grid` with `minColumnWidth`
  (CSS `repeat(auto-fill, minmax(...))`) is the more useful addition: P2.

### 10. Style props (partial, P2)
- **Done in 0.3.0:** `margin`. `padding` on `Text` works now.
- **Open:**
  - Per-corner radius: `radius={[tl, tr, br, bl]}`. Needs the RECT op to carry four radii
    (opcode change in `nb.h`, `paint.ts`, `render_gles2.c`, `decode()`), and `clip` too.
    Test: pixels at each corner of a `[0, 12, 12, 0]` box.
  - Unknown props: TSX already rejects attributes not in a widget's props type; the silent
    cases were props that exist in `StyleProps` but do nothing on that widget. Audit each
    widget for style keys it ignores and either honor them or leave them out of its type.
  - Overlapping layouts (avatar over a banner): `translateY` leaves a gap; a negative
    `margin` (0.3.0) does it without the gap. Document the pattern in the ui skill.

## Reactivity and lifecycle

### 11. The `run()` callback is reactive (open, P0)
- **Problem:** `run(app)` does `insert(root, app)`; a function child is a reactive slot, so
  every signal `app` reads before returning JSX is tracked, and writing it re-runs the whole
  app. With read + write in the callback, it loops forever, before any window shows, with
  nothing printed. `mount()` in testing has the same shape.
- **Fix:** run the callback untracked, like a component body: `insert(root, () =>
  untrack(app))`, or treat `app` as a component (`jsx(app, {})`). Same in `runWith`,
  `captureTree`/`screenshot` and `mount`. Also, in dev, the "frames in a row that request
  themselves" warning should have a cousin for effect loops: an effect that re-runs itself
  more than N times in one flush throws "effect loop: <stack>" instead of hanging.
- **Where:** `src/runtime/app.ts`, `src/testing.ts`, `src/runtime/screenshot.ts`,
  `src/reactive/signals.ts` (loop guard).
- **Test (`app`, `core`):** a `run` callback that reads a signal and then sets it renders once
  and the callback runs once; an effect that writes what it reads throws the loop error after
  the limit instead of spinning.

### 12. Effects before `ref` (open, P1)
- **Problem:** components run once, top to bottom; an effect created in the body runs
  immediately, before the JSX below it exists, so the `ref` is still undefined.
- **Fix:** `onMount(fn)`: runs once after the component's nodes are in the tree (after the
  first insert, before the first layout), untracked, like Solid's. Then "scroll to the end
  when messages change" is `createEffect` + `ref`, with the first run in `onMount`.
- **Test (`ref`):** `onMount` sees the `ref` set and the node attached; it runs once per
  mount, and not for a component that is disposed before insertion.

### 13. `requestAnimationFrame` in tests (docs, P2)
- **Behavior:** `requestAnimationFrame` is exported by `@nodebuilderjs/core` and works in
  tests (`frames()` runs the queue); only the *global* of the same name does not exist (this is
  not a browser). The clone used the global.
- **Fix:** document it in the from-react skill ("import `requestAnimationFrame` from core; the
  global does not exist"). Optionally define the global in `run()`; not in tests.

## Testing without a window

### 14. `TextField` values in tests (open, P1)
- **Fix:** testing helpers that see fields: `findByText` (or a `findByValue`) also matches a
  `TextField`'s value, and `ariaLabel`/`placeholder` find the field (`findByLabel` already
  covers `ariaLabel`). Expose what is drawn (masked for `password`, see 3) so a test can assert
  "the password shows as •••".
- **Where:** `src/testing.ts`; `TextField` keeps its value readable on the node (as `Text`
  keeps its label).
- **Test (`testing`):** `findByValue(root, "hello")` finds the field after `interact().type`;
  a password field is found by value and reports its drawn text as "•••••".

### 15. Nodes created in `onResize` (open, P1)
- **Problem:** `layout()` calls `onResize` handlers after placing; a handler that changes the
  tree leaves new nodes unplaced until the next layout. In an app the next frame fixes it; in
  tests, a `click` right after `relayout()` hits nothing.
- **Fix:** `layout()` places again when an `onResize` handler changed the tree (or invalidated
  layout), up to a small bound (2 extra passes), and warns in dev when sizes keep changing
  (a resize loop).
- **Test (`ref`):** a component that renders N children from its `onResize` width has them
  placed after a single `relayout()`; a handler that always changes its own size stops after
  the bound with a warning.

### 16. Focus requested during creation (open, P2)
- **Problem:** `focus()` before the node is attached waits for a microtask, so
  `ui.key("Escape")` right after mounting goes nowhere.
- **Fix:** apply pending focus when the node is attached (the insert that puts it in a rooted
  tree) instead of a microtask; or have `interact()`'s helpers flush pending focus before
  sending keys.
- **Test (`ref`):** `mount` a component whose `ref` calls `focus()`; `interact(root).key(...)`
  immediately afterwards reaches it, no `await`.

### 17. Finding icon-only buttons (fixed)
0.3.0 has `ariaLabel` on every widget and `findByLabel`/`findAllByLabel` in testing.

### 18. Repeated texts (partial, P2)
- **Done:** `findAllByText` returns all matches in tree order (overlay layers last).
- **Open:** a scoped query: `within(node).findByText(...)` (or `findByText(container, ...)`,
  which already works by passing the container), and documenting that dialogs live in overlay
  layers, after the tree. A `findByRole`-like filter (`{ widget: "Button" }`) would remove the
  "last match" heuristic: `findByText(root, "Sair", { in: "Button" })`.
- **Test (`testing`):** the same text in a menu item, a dialog title and a dialog button; the
  button is found by text plus widget kind.

## Environment and tooling

### 19. `pkill -f` killing the agent's shell (docs, P3)
Not a framework bug. Add to the template `AGENTS.md` pitfalls: to stop a running app use the
PID of the background job, or `pkill -x bun`-style exact names; `pkill -f "<pattern>"`
matches the shell that runs it. Better: nothing needs to be killed, since
`nodebuilder screenshot` (below) never opens a window.

### 20. Screenshots of the wrong window (fixed)
0.3.0 has `nodebuilder screenshot <app.tsx> <out.png>` (no window, no display server,
waits for animations) and `screenshot()` in tests. `spectacle` is only needed for what the
offscreen path cannot show (CSD edges, compositor transparency).

### 21. Opening the app on a given page (docs, P2)
- **Pattern to document** (template skills): the `App` component takes its initial state as
  props (`page`, selected server), `src/main.tsx` passes the real one, and a screenshot file
  passes another: `bun run screenshot src/shots/settings.tsx shot.png`, where the file is a
  three-line `run(() => <App page="settings" />)`. Kept in the repo (not deleted), they double
  as visual fixtures.
- **Optional (P3):** `nodebuilder screenshot --props '{"page":"settings"}'` when the entry
  exports a component instead of calling `run()`.

## Order of work

1. P0: #11 (`run()` untracked + effect loop guard).
2. P1 framework: #5 (window keys, `focusable`), #3 (password), #4 (field borders),
   #6 (handlers on every widget), #12 (`onMount`), #15 (layout after `onResize`), #14 (field
   values in tests).
3. P2: #7, #16, #18, per-corner radius (#10), `Grid minColumnWidth` (#9), docs for #8, #13, #21.
4. P3: percentages, `--props` for screenshots, #19 docs.
