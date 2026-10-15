# Web roadmap

Goal: the same app, unchanged, runs as a web page. `nodebuilder web` renders the `UINode` tree
as real DOM elements styled with CSS, the way react-native-web renders React Native: the
widgets and the apps do not change, and the browser does what it is good at (accessibility,
text input, selection, find, translation, scrolling, zoom). How it works is in
`ARCHITECTURE.md` ("The web"); this file is what was decided, what was measured and what is
left.

Status keys: **done**, **P0** (blocks shipping a real app), **P1** (needed to call the web
target complete), **P2** (expected by some apps), **P3** (nice to have). Every item follows the
TDD rules in `AGENTS.md`; pages themselves are checked in headless Chromium.

## Next steps, in order

1. **Dirty tracking** (P0): walk only the nodes that changed instead of the whole tree every
   frame; the cost left in long lists (8 ms per frame in a 500-row table).
2. **Real browsers and a screen reader** (P0): Firefox, Safari (macOS, iOS), Chrome on Android
   and on a real GPU, browser zoom; Orca or NVDA reading `todo` and `widgets`.
3. **Responsive examples:** `widgets` stacks its cards on a phone (`<Row wrap>` + base width,
   content in a `Scroll`); do the same for the other examples, which still assume a desktop
   window, and say how in the template's docs (a page can be 360 px wide).
4. **Missing adapters** (P1): `RichText` as text with `<a href>` links, `Image` as `<img alt>`,
   `Icon` as inline `<svg>`, headings from text variants.
5. **Our measurer agrees with the browser** (P1): measure with a DOM span (features,
   variations) so widgets that measure themselves match the page's text.
6. **Developer experience** (P1): `--serve` rebuilds when the framework changes too (today only
   the app's folder is watched) and reloads the page; a CI job that builds the examples and
   checks them in `chrome-headless-shell` (screenshots, input, accessibility tree, layout
   parity); the web target in the template's `AGENTS.md` and skills.
7. **Bundle** (P1): keep `layout.ts` and `paint.ts` out of the web build.
8. **Font loading, IME and touch checks** (P1), then P2 (prerendering, system dark theme,
   embedding) as apps ask for them.

## Why the DOM (and not a canvas, and not Solid)

- **Not a canvas.** The first spike drew the desktop's command buffer with WebGL: same pixels,
  but everything a browser gives a page for free (screen readers, IME, autofill, touch
  scrolling, text selection, find) would have to be rebuilt on top as a hidden DOM, and WebGL
  brings context loss and a text atlas. It was removed (2026-10-15).
- **Not Solid DOM components.** That would be a second widget library. Swapping one level
  lower, at the `UINode` tree, keeps every widget working on both targets.
- **It fits** because our primitives are already CSS: the layout follows CSS semantics on
  purpose (flexbox, `min-size: auto`, margins outside the box, `absolute` from the padding box,
  percentages), boxes have background, border, radius and shadow, and text is text.
- **The cost:** close, not identical. The browser lays out and breaks lines, so the page looks
  like the desktop app, not pixel for pixel; text fields edit with the browser's selection,
  undo and shortcuts, not `EditSession`'s.

## Done (2026-10-15)

- `nodebuilder web <app.tsx> [--serve --minify --out --title --port]` (`cli/web.ts`):
  `Bun.build` for the browser with a virtual entry (`await boot(); await import(app)`),
  `node:*` mapped to `src/web/shims/` (an import without a shim is a build error), splitting
  (`app.js` + shared `nodebuilder-*.js`, the app's chunk preloaded), `index.html` with a
  `<div id="nodebuilder">`, `assets.json`.
- The `Native` interface in the browser (`src/web/native.ts`) with `renderTree(root)` and
  `hitTest(x, y)` instead of draw commands; `run()` calls them instead of layout, paint and
  render. Page events become the desktop's `NativeEvent`s, so the input system (hover, press,
  focus, Tab, roving focus, overlay dismissal, modal scopes) is the desktop's.
- The DOM renderer (`src/dom/`): one element per node, CSS and attributes diffed per frame,
  `<For>` moves elements; boxes read back lazily; `<Text>` as DOM text, `TextField`/`TextArea`
  as `<input>`/`<textarea>`; nodes that draw themselves into a `<canvas>` (Canvas2D painter);
  overlays placed with the desktop's `layerPosition()`.
- Semantics: widgets set platform-neutral `role` and `states` (button, checkbox, switch, radio,
  slider, progressbar, tab, combobox, listbox, option, dialog), written as ARIA.
- The browser's context menu (inspect, copy) everywhere except where the app has
  `onContextMenu` (`hasContextMenu` in `runtime/input.ts`).
- Text the browser handles (`setNativeText`): fields only submit on Return and stop the keys the
  browser edits with; `<Text selectable>` uses the browser's selection and copy.
- Files: the app's imported files are fetched before it starts (`node:fs` reads from memory);
  imported images are decoded by the browser ahead of time, other bytes load the TypeScript
  decoders on demand. No window icon on a page.
- The page is the window (`setWindowFrame(false)`): `<Window>` draws no title bar, border or
  corners, its `title` goes to the tab, `<WindowControls>` draws nothing.

### Decisions

- **Who lays out: CSS**, with boxes read back lazily (a getter per node that asks its element,
  once per frame and only when something reads it), so overlays, refs, `onResize` and painters
  work unchanged. Hit testing is the browser's (`elementFromPoint`).
- **Events go through our input system**, not per-element handlers. The browser keeps its
  defaults only where it does better (fields, selection, scrolling) or where the app did not
  take the key (`NativeKeyEvent.handled`).
- **Our look, ARIA semantics** on our own boxes; native `<button>`/`<input type=checkbox>` were
  not needed.
- **CSS rules that keep our layout's semantics:** the border is an inset `box-shadow` (it takes
  no room), a fixed size along the parent's axis and the siblings of a growing child do not
  shrink, what holds a scroller may shrink below its content, and a `Scroll` that grows along
  its axis gets `flex-basis: 0` (it differs from the desktop only next to other growing
  children, with less content than room).

### Measured (headless Chromium, chrome-headless-shell 1243)

**Layout parity** (our `layout()` run in the page against the browser's boxes, overlay
scrollbars, nodes on screen): `scroll`, `images`, `charts`, `drawing` 100 % within 1 px;
`todo` 96 %, `icons` 97 %, `widgets` 91 % within 1 px and 100 % within 4 px. `text` 9 %: there
our measurer is wrong (Canvas2D applies no `font-feature-settings`), the browser's text is
right. With classic scrollbars (Linux Chrome) a scrolling page is narrower by the scrollbar.

**Semantics:** the accessibility tree of `todo` and `overlays` has the text box named by its
placeholder, buttons, checkboxes with `checked`, and the texts.

**Bundle:** `todo`, minified: 43.7 KB of gzipped script (`run()` still imports `layout.ts` and
`paint.ts`).

**Frame time** (`bench:dashboard`, 1280x800, live data, inside `renderTree`):

| Tab | Elements | First version | Now |
|---|---|---|---|
| overview | 300 | 2.8 ms | 2.1 ms |
| table (500 rows) | 9,150 | 24.5 ms (34 fps) | 8.3 ms (60 fps) |
| logs | 3,400 | 15.5 ms | 11.6 ms |
| settings | 220 | 1.6 ms | 1.3 ms |

The first version read every box back each frame (6,079 `getBoundingClientRect` per table
frame) and let the browser lay out a growing `Scroll`'s whole content for its flex basis (10 ms
per text change; 0.5 ms with `flex-basis: 0`). What is left in `table` is our own walk of the
9,150 nodes each frame.

## P0: before shipping a real app

- **Dirty tracking.** Walk only what changed: `UINode.set`/`setSlot` and widget content mark the
  node and its ancestors; nodes that repaint every frame (canvases) kept apart. The walk is the
  cost left in long lists, and the same marks would help the desktop's "full layout every frame".
- **Real browsers.** Firefox and Safari (macOS and iOS), Chrome on a real GPU and on Android;
  fractional DPR and browser zoom. Write down what differs.
- **A screen reader.** Orca or NVDA reading `todo` and `widgets`; fix names and states that
  come out wrong.

## P1: needed to call the web target complete

- **Adapters still missing:** `RichText` as `<p>` + `<span>`s with `<a href>` links (today a
  canvas: not selectable, not read), `Image` as `<img alt>`, `Icon` as inline `<svg>`, headings
  from text variants.
- **Our measurer on the web:** features and variations (measure with a DOM span instead of
  Canvas2D, cached), so widgets that measure themselves (`RichText`, `TextArea`, Canvas text)
  agree with the browser's text.
- **IME and touch, checked:** CJK input and dead keys in a field, a mobile keyboard, touch
  scrolling inside `Scroll`, no hover left after a tap.
- **Font loading.** Registered fonts load asynchronously (the fallback shows first); `boot()`
  should await `document.fonts.ready` for fonts registered at startup. `registerFont` without
  `family` needs the family from the font's `name` table.
- **Bundle:** keep `layout.ts` and `paint.ts` out of the web build.
- **Developer experience:** live reload in `--serve`, a `web` script and the web target in the
  template's `AGENTS.md` and skills, `app.js` named by hash, a CI job that builds the examples
  and checks them in `chrome-headless-shell` (screenshots, input, the accessibility tree, the
  layout parity report).

## P2: expected by some apps

- **Prerendering** for search engines and link previews without JS: run the app once at build
  time against a small server-side DOM writer (our own) and put the first screen's HTML in
  `index.html`; the app adopts those elements when it starts.
- **Dark theme from the system:** `prefers-color-scheme`.
- **Images without blocking start:** `boot()` decodes every imported image before the app runs;
  large apps need a progress indicator, or images loaded on first use.
- **Embedding:** mount into an element of an existing page. Several apps per page need the
  module-level state (theme, frame clock, image backend) per instance.
- **Files the app did not import:** `fetch` and a `File` input instead of `fs`; document that
  `readFileSync` only reads imported files.

## P3: nice to have

- **Offscreen screenshots in the browser** (`screenshot()`).
- **Favicon** from the `<Window icon>`.

## Maintenance rules

- A new `Style` key gets a CSS mapping in `src/dom/style.ts` (the typed table fails to compile
  without it); a test checks every `STYLE_KEYS` key.
- A widget with a meaning for assistive technology sets `role` and `states`; one that lays out
  text itself describes it (`node.text()`, `node.field`) and respects `hasNativeText()`.
- `cli/web.ts` swaps `image/decode.ts` and `image/icon.ts` for their `src/web/` versions
  (`WEB_MODULES`). A module that gets a web version says so in its header comment.
- A new `node:*` import in `src/` needs a shim in `src/web/shims/`, or the web build fails.
