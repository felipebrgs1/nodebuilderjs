# Web, take 2: a DOM renderer

`WEB.md` is the canvas target: the browser draws the same command buffer as the desktop, so
pixels match, but everything a browser gives a page for free (accessibility, search engines,
find, translation, IME, autofill, touch scrolling, text selection) has to be rebuilt on top,
mostly as a hidden DOM kept in sync with the canvas. This file is the other way: **render the
`UINode` tree as real DOM elements styled with CSS**, the way react-native-web renders React
Native. One tree, and the browser does what it is good at.

Status: **design, not started.** A one-week spike (end of this file) decides whether it
becomes the default web target, with the canvas renderer kept for apps that need the desktop's
exact pixels (`nodebuilder web --renderer dom|canvas`).

## Why the DOM, and why not Solid

The apps and the widgets do not change. Apps already use Solid-style reactivity and our own
`jsx()`; what draws the screen are our widgets (`Button`, `TextField`, `Select`...), which build
`UINode`s with a flat `Style`. Rewriting the widgets as Solid DOM components would be a second
widget library to maintain. Swapping one level lower, at the `UINode` tree, keeps every widget
and every app working on both targets.

It fits because our primitives are already CSS. The layout follows CSS semantics on purpose
(`AGENTS.md`, "Layout": flexbox, `min-size: auto`, margins outside the box, `absolute` from the
padding box, percentages), boxes have background, border, radius and shadow, and text is text.
Flutter tried an HTML renderer and dropped it in 2024: it paints everything at the pixel level,
so its HTML mode was an approximation of a canvas. We are closer to React Native.

## What comes for free

| Feature | How |
|---|---|
| Screen readers | real elements with roles (`<button>`, `<input type=checkbox>`, `<h1>`...) and `aria-*` from `ariaLabel` |
| Search engines and link previews | text in the DOM, links as `<a href>`; with prerendering (below), even without JS |
| Find (Ctrl+F), translation, browser zoom | the page is HTML |
| IME, dead keys, the mobile keyboard, autofill | `TextField` is an `<input>`, `TextArea` a `<textarea>` |
| Touch scrolling with inertia, native scrollbars | `Scroll` is `overflow: auto` |
| Text selection, copy | DOM text (`selectable`), the browser's own handles on mobile |
| Wide gamut | CSS takes `color(display-p3 ...)` and `oklch()` as written |
| No WebGL context loss, no text atlas | nothing to lose or to rasterize |

Most of `WEB.md` P0/P1 goes away: context loss, IME, touch, the accessibility tree, text
fidelity against the browser (the browser is the reference now), font loading (CSS
`@font-face`).

## The cost

- **Close, not identical.** CSS lays out and the browser breaks lines, so the page looks like
  the desktop app, not pixel for pixel. Line breaks match other web pages, not the desktop.
- **Two renderers.** A new `Style` field goes to `paint.ts`, to the canvas renderers and to
  the CSS mapping. A test checks that every key of `STYLE_KEYS` has a CSS mapping.
- **Layout is read back.** What reads our computed boxes (`node.x/y/width/height`) needs the
  DOM's instead: `onResize`, `ref` sizes, `scrollIntoView`, overlay anchoring, overflow
  warnings, widgets that paint relative to their box.
- **Text editing is the browser's.** `<input>` has its own selection, undo and shortcuts, not
  `EditSession`'s. Better for web users, different from the desktop.

## Architecture

### Where it plugs in

`runWith()` (`runtime/app.ts`) renders a frame as `layout()` -> `paintTree()` ->
`native.render()`. The DOM renderer replaces those three steps, not the `Native` interface
(which takes draw commands, not a tree):

```
signal changes -> UINode.set / setSlot -> invalidate()
  -> renderFrame(): requestAnimationFrame callbacks -> dom.sync(root)
```

`runtime/app.ts` gets a small seam (a frame host with `frame(root)` and the event source),
and `src/dom/` implements it: `boot()` installs it instead of the web native. Everything above
(reactivity, `jsx`, `UINode`, widgets, theme, animations, the frame clock) stays as it is.

### Sync: UINode tree -> DOM

- One element per `UINode` (a `WeakMap<UINode, HTMLElement>`); children follow `node.children`
  in order, so `<For>` moves elements instead of recreating them (keyed already).
- First version: on each frame, walk the tree and compare each node's `Style` with the last one
  written (a cached copy per node); only changed properties touch the DOM. Later, if the walk
  costs too much: `UINode.set()`/`setSlot()` mark nodes dirty (this also helps the canvas
  target's "full layout every frame" bottleneck).
- Overlays (`root.layers`) render into a fixed top-level container (a portal), anchored with the
  trigger's `getBoundingClientRect()` (CSS anchor positioning where available).
- Culling is not needed: the browser skips what is off screen.

### Style -> CSS

| `Style` | CSS |
|---|---|
| `direction` row/column | `display: flex; flex-direction` |
| `direction: "grid"`, `columns`, `minColumnWidth`, `rowGap` | `display: grid; grid-template-columns: repeat(n, 1fr)` or `repeat(auto-fill, minmax(min, 1fr))`; `row-gap` |
| `gap`, `padding`, `margin` | same names (arrays -> CSS shorthand order) |
| `width`, `height`, `min*`, `max*` (px or `%`) | same; `box-sizing: border-box` everywhere |
| `grow` | `flex-grow` (`flex-basis: auto`, `flex-shrink: 1`, like our shrinking) |
| `align`, `justify`, `alignSelf` | `align-items`, `justify-content`, `align-self` (`start` -> `flex-start`...) |
| `wrap` | `flex-wrap: wrap` |
| `aspectRatio` | `aspect-ratio` |
| `position`, `left/top/right/bottom`, `zIndex` | same (`position: relative` on every node, so offsets and z-index work like ours: siblings only) |
| `translateX/Y` | `transform: translate()` |
| `clip` | `overflow: hidden` (rounded by `border-radius`) |
| `background` (color, token, gradient) | `background` (`resolveColor` for tokens; `linear-gradient(<angle>, stops)`) |
| `radius` (one or four) | `border-radius` |
| `borderWidth`, `borderColor` | `border: solid` |
| `shadow` | `box-shadow` |
| `opacity` | `opacity` (real group opacity, unlike the canvas) |
| `color`, `fontSize`, `bold`, `fontWeight`, `italic`, `letterSpacing`, `fontFamily`, `underline` | the CSS font properties, inherited by CSS itself |
| `fontFeatures`, `fontVariations` | `font-feature-settings`, `font-variation-settings` (fully supported here) |
| `cursor` | `cursor` |

Theme colors stay live: effects that call `node.set("background", theme.x)` already run on
`setTheme`, so the next sync writes the new value. Token names resolve through `resolveColor`.

### Widgets that need more than a box

Nodes with `measure` or `paint` draw themselves on the desktop. Each gets a DOM adapter in
`src/dom/adapters/` (looked up by widget, so widgets keep no DOM code):

| Widget | DOM |
|---|---|
| `Text` | `<span>`/`<p>`, `white-space: pre-wrap`; `maxLines` -> `-webkit-line-clamp`; `selectable` -> `user-select: text`; heading variants -> `<h1>`..`<h6>` |
| `RichText` | `<p>` with a `<span>` per span; links -> `<a href>` (with `onClick` kept) |
| `TextField`, `TextArea` | `<input>` (`type=password` for `password`), `<textarea>`; `value`/`onInput` two-way |
| `Button`, `Checkbox`, `Toggle`, `RadioGroup` | `<button>`, `<input type=checkbox|radio>` (or `role` + `aria-checked` on our own box, to keep the look) |
| `Image` | `<img>` (`src` from the imported file's URL; bytes -> object URL); `objectFit` -> `object-fit` |
| `Icon` | inline `<svg>` (the markup we already have, `currentColor` for the tint) |
| `Canvas` and charts, `Slider`, `ProgressBar`, `Spinner`, other custom `paint` | a `<canvas>` sized to the node, drawn by a **Canvas2D `Painter`** (the `Painter` interface of `render/node.ts`: rect, shadow, text, image, line, triangles, arc, clip map almost one to one onto Canvas2D) |
| `Scroll` | `overflow: auto` (x, y or both); `scrollIntoView`, `scrollTo` native |
| `Select`, `Tabs`, `Dialog`, `Tooltip` | as built (boxes + overlays); roles `combobox`/`listbox`, `tablist`/`tab`, `dialog` + `aria-modal` |
| `Window` | the page (no frame, as on the canvas target); `title` -> `document.title` |

The generic `<canvas>` + Canvas2D painter is the safety net: any node whose look comes from
`paint` works without an adapter, just without semantics.

### Events, focus and readback

- DOM events on each element call the node's handlers (`onClick`, pointer, keys, `onScroll`,
  focus) with our event objects; `stop()` -> `stopPropagation()`. The `interaction()` trackers
  (hover, press, focus styles) are fed by the same events.
- Focus: `tabindex` from `focusable`/`tabStop`, DOM focus order; `roving.ts` keeps its arrow keys.
- Keys: `KeyboardEvent.key` mapped to our names (`web/keys.ts` already does it).
- Readback: a `ResizeObserver` per node with `onResize` (and per `<canvas>`), writing
  `width/height` before handlers run; `x/y` from `getBoundingClientRect()` when asked.
- `hoverStyle`/`pressStyle`/`focusStyle` keep using `UINode.override`, as today; CSS `:hover`
  is not needed.

### Prerendering (search engines without JS)

Because the output is HTML, `nodebuilder web` can run the app once at build time against a
small server-side DOM writer (our own, no dependency) and put the first screen's HTML in
`index.html`. Crawlers and link previews that do not run JS see the content; the app takes
over the same elements when it starts (hydration: adopt existing elements in tree order
instead of creating them). Not in the spike.

## Testing

- **Style -> CSS:** pure functions, in `bun test` (`test/dom/style.test.ts`), one case per key;
  a test that every key of `STYLE_KEYS` is mapped.
- **Sync:** against a minimal fake document of our own (create, insert, move, set attributes),
  enough to check that `<For>` reorders without recreating, that only changed properties are
  written, and that disposed nodes leave the DOM.
- **Layout parity, automated:** in headless Chromium (as in `WEB.md`), for each example: run our
  `layout()` at the viewport size and compare every node's box with the element's
  `getBoundingClientRect()`. The report (how many nodes differ, by how much) is the main
  measure of how faithful the DOM target is, and a regression test once the numbers settle.
- **Semantics:** `Accessibility.getFullAXTree` over the DevTools protocol: the `todo` exposes
  "Adicionar, button", checkboxes with their labels and states.
- **Visual:** screenshots of the DOM and canvas targets of each example, side by side.

## Spike plan (one week)

1. Seam in `runtime/app.ts`; `src/dom/` with the sync and the `Style` -> CSS mapping.
2. Adapters for `Text`, `TextField`, `Button`, `Checkbox`, `Scroll`, `Image`; the Canvas2D
   painter fallback for the rest.
3. `nodebuilder web --renderer dom`; run `todo` and `widgets`.
4. Measure: layout parity per example, widgets that needed an adapter, bundle size (no WebGL
   renderer, no text atlas, no image decoders: expected smaller than 41 KB gzip), frame time of
   `bench:dashboard`.
5. Decide: DOM as the default web target (canvas kept as `--renderer canvas`), or not.

Success: `todo` and `widgets` usable with keyboard, mouse, touch and a screen reader; layout
parity within a few px on most nodes; no widget rewritten.

## Open questions

- **Who lays out:** CSS (responsive, native, but our readback-dependent features change) or our
  `layout()` with absolutely positioned elements (exact boxes, but text wrapped by the browser
  may disagree with our measurement, and the page no longer reflows by itself). The spike starts
  with CSS.
- **Native controls or our look:** `<input type=checkbox>` gives semantics and behavior for
  free but needs `appearance: none` styling to keep our theme; a `<div role=checkbox>` keeps the
  look but needs the keyboard handled by us (it already is).
- **Text inputs and `EditSession`:** keep its undo/redo on top of `<input>`, or the browser's.
- **One package, two targets:** `src/dom/` and `src/web/` share the boot, the shims and the
  build; the renderer is chosen at build time so the other one is not bundled.
