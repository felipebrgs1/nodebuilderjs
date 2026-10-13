# Changelog

## Unreleased

### New
- **Fonts:**
  - `fontFamily` on every widget, inherited: a CSS family list (`"Inter, 'Noto Sans',
    sans-serif"`) of app fonts, installed families and generic ones (`serif`, `monospace`,
    `system-ui`...). Each character uses the first family that has it, then the system's
    fallback; missing families are skipped.
  - `registerFont(pathOrBytes, { family?, weight?, italic? })` adds a font file (TTF,
    OTF/CFF, TTC collections, WOFF, WOFF2, variable fonts) like CSS `@font-face`; an import
    `with { type: "file" }` works in packaged executables. Faces are picked with the CSS
    matching rules; a missing bold is synthesized (thicker outlines), like a missing italic.
  - `fontFeatures` (`"tnum, smcp, -liga"`) and `fontVariations` (`"wdth 75"`), inherited.
  - `fontFamilies()`: installed and registered families, for font pickers.
  - `<Canvas>` text takes `{ family, features, variations }` and otherwise follows the
    `fontFamily`/`fontFeatures`/`fontVariations` around it, so charts use the app's font.
  - Font files (`*.ttf`, `*.otf`, `*.ttc`, `*.woff`, `*.woff2`) can be imported as paths in
    TypeScript.

### Changed
- Command buffer: TEXT has one more float, the index in `texts[]` of the font spec (family,
  features, variations; -1 for none). `FontStyle` has `family`, `features` and `variations`
  (`""` for none); a custom `TextMeasurer` receives them. `Native.measureText` takes the spec
  as a sixth argument.

## 0.3.0 (2026-10-12)

### New
- **Seeing the UI:** `nodebuilder screenshot <app.tsx> <out.png>` (`--width`, `--height`,
  `--scale`, `--theme`, `--wait-frames`) renders the app to a PNG with the GPU and no display
  server (EGL surfaceless), after its animations finish. Generated apps get
  `bun run screenshot`, and their skills tell agents to look at the UI they build.
- **Layout:**
  - `<Grid columns={4} gap={8} rowGap={12}>`: rows of equal-width cells, each row as tall as
    its tallest cell. Laid out by the layout engine itself, so `<For>` inside stays keyed.
  - `aspectRatio` (width / height) on every widget, like CSS `aspect-ratio`;
    `aspectRatio={1}` in a `Grid` gives square covers.
  - `<Row wrap>` (CSS `flex-wrap: wrap`): `gap` between items, `rowGap` between lines,
    `grow`/`justify`/`alignSelf` per line; its height follows its width. `<Column wrap>`
    breaks into columns at its height.
  - `margin` (`8`, `[v, h]` or `[top, right, bottom, left]`; negative allowed), kept free by
    the parent's layout (sizes, `grow`, shrinking, `Grid` cells, `wrap` lines). No collapsing.
  - `alignSelf`; `right`/`bottom` on absolute children (`left={0} right={0}` stretches).
  - `zIndex`: paint and hit-test order among siblings (ties keep child order; no global
    stacking contexts, overlays stay on top).
  - **Overflow warnings:** in development, `run()` prints once per node when children need
    more room than their container gives and a `clip` ancestor or the window hides the excess
    (`layout: Row > Text("Artists") overflows Box(panel) by 42px (...)`); `debugTree()` marks
    the container `[overflow +42]`. Silent with `NODE_ENV=production` and in packaged
    executables.
- **Styling:**
  - Linear gradients: `background={{ linear: ["#1db954", ["#121212", 0.6]], angle: 180 }}`
    (CSS angles), with rounded corners, borders, `opacity` and reactive values; in `<Canvas>`,
    `g.linearGradient(x0, y0, x1, y1, stops)` fills `rect`, `polygon`, `circle`, `arc`,
    `line` and `polyline`. Interpolated in premultiplied space, like CSS.
  - `hoverStyle`/`pressStyle` on every widget, and `createInteraction()`
    (`hovered`/`pressed`/`focused` + `props` to spread) for a child that follows its parent.
  - `underline` (inherited).
  - `fontWeight` (1..1000; `bold` is 700), `italic` and `letterSpacing` on every widget,
    inherited like `fontSize`: the closest face the system has (fontconfig), any weight of a
    variable font, a slanted upright face when there is no italic. Canvas `g.text` and
    `g.measureText` take `{ weight, italic, letterSpacing }`; `g.text` also `{ maxWidth,
    ellipsis }`. `TextField` follows them.
- **Text:** font fallback and color emoji. Characters the UI font lacks (`▲`, `↑`, CJK...)
  come from the system's fallback fonts (fontconfig order, following weight and slant);
  emoji are drawn in color (Noto Color Emoji and other CBDT/sbix/COLRv0 fonts), including
  ZWJ sequences, skin tones and flags. `color` does not tint an emoji; `opacity` fades it.
- **Window:** `<Window decorations={false}>` for a custom title bar, `dragRegion` on any
  widget (double click maximizes; clickable, focusable or `onPointerDown` children inside keep
  the press) and `<WindowControls />`. The built-in buttons are labelled ("Minimize",
  "Maximize"/"Restore", "Close").
- **Icons:** `<Icon fill>` (`true` or a color) replaces the root `<svg>` fill, so outline
  icons become solid. `nodebuilder icons add <names...>` (`--from lucide-static |
  @phosphor-icons/core`, `--out src/icons.ts`) writes the imports into one module: sorted,
  deduplicated, checked in `node_modules`, unknown names fail with close matches;
  `nodebuilder icons list [filter]` prints the names. Generated apps get `bun run icons:add`.
- **Testing** (`@nodebuilderjs/core/testing`):
  - `click(node)` and `interact()`'s node helpers throw when the node can't be reached
    (culled, clipped, detached, overlay not shown).
  - `findAllByText`, `findByLabel`, `findAllByLabel`, and `ariaLabel` on every widget (a name
    for icon-only buttons; a `Tooltip` labels its trigger; `debugTree()` shows it).
  - `layoutWarnings()` (from `mount`, or `layoutWarnings(root)`) lists the overflow warnings.
  - `useRealTextMetrics()` measures text with the installed fonts (no window) until the
    returned function restores the fake metrics; `canUseRealTextMetrics()` for `skipIf`;
    `useFakeTextMetrics({ charWidth, lineHeight })`.
  - `screenshot(root | view)`, `savePNG` and `canScreenshot` give the real pixels.
- **Tooling:** `NB_STATS` shows why frames were drawn (`why: inv ev raf`); `NB_TRACE=frames`
  prints the stack that asked for each frame; in development a warning names code that
  invalidates inside every frame. Frame callbacks receive `frameNow()`. In the repository,
  `bun run check:snippets` typechecks the README and skill snippets.
- **Apps created with `bun create nodebuilderjs`:** `screenshot` and `icons:add` scripts, and
  skills covering everything above.

### Changes that may affect your code
- **`click(node)`** in tests uses the node's center (it pressed 1 px inside the top-left corner), and
  `localX/localY` are relative to the node that handles the click. It throws on a hidden target
  instead of silently missing.
- **Absolute children of a `Scroll`** now scroll with the content (they stayed fixed).
- **Handlers are chained:** a handler passed to a widget runs together with the widget's own
  instead of replacing it.
- **`onPointerDown` bubbles past clickable nodes** until `e.stop()`, as documented: it ended at
  the first node with an `onClick`. `onClick` still runs only on the innermost clickable. A
  parent's `pressStyle` now shows while a child is pressed (CSS `:active`); `e.stop()` in the
  child's `onPointerDown` keeps the press to it.
- **Hit testing reaches children that stick out** of a parent that does not `clip` or scroll
  (an absolute badge); presses there used to go to what was behind.
- **Text measurers:** the third argument of a `setTextMeasurer` function is now a `FontStyle`
  (`{ weight, italic, letterSpacing }`) instead of `bold`, and the returned width must include
  `letterSpacing` after every character. A custom `Painter.text` gets a `FontInput` (that
  object, or `true` for bold).
- **Command buffer** (only for a custom native build): `TEXT` has 10 floats (a font id,
  `weight * 2 + italic`, instead of bold, and `letterSpacing` at the end); new op `GRADIENT`
  (10); colors are premultiplied in the vertex shader. The addon and the core must have the
  same version, as before.
- **Closing the window** drops the frame scheduler and pending `requestAnimationFrame`
  callbacks, so unfinished animations stop there.
- **`mixColor`** mixes in premultiplied space, like CSS: mixing toward a translucent color
  gives a different (correct) result.
- **Icon modules:** don't write `export { default as x } from "./x.svg" with { type: "text" }`:
  Bun drops the attribute on re-exports, and `x` becomes the file's path. Use
  `import x from "./x.svg" with { type: "text" }; export { x };`, or let
  `nodebuilder icons add` write (and rewrite) the module.

### Fixes
- **Idle redraw:** since the interactive scrollbars (0.2.5), an idle window redrew at the fps
  cap, because the per-frame hover refresh invalidated even with no scrollbar to highlight.
  Idle is back to 0 frames.
- `Slider` and `TextField` dropped a user's `onPointerDown` (handlers are now chained).
- A child with a fixed `width` and a smaller `minWidth` (such as `Slider`) let its container
  shrink below that width.
- `mixColor(color, "transparent", t)` passed through translucent gray; now
  `mixColor("#ff0000", "transparent", 0.5)` is red at 50% alpha.

### Performance
- Idle CPU after the redraw fix: empty window 9.8% → 0%, dashboard 25.6% → 0.6%.
- `margin` and `wrap` keep the 500-row table's layout at ~2.8 ms/frame (same as before,
  within noise).

## 0.2.5 (2026-10-12)

### New
- **Widgets:** `Toggle` (on/off switch), `RadioGroup`, `Slider`, `Select`, `Tabs`,
  `Tooltip`, `Dialog`, `ProgressBar` (determinate or indeterminate) and `Spinner`. Every
  control takes `disabled`: dimmed, out of the Tab order and the focus, ignores clicks and keys.
- **Overlays:** `<Overlay>` draws above the whole window, outside the clip of its container:
  covering the window (`modal` blocks the pointer and Tab behind it) or anchored to an element
  (`anchor`, `placement`, `matchWidth`), with `onDismiss` on an outside press or Escape.
- **Text:** `<Text>` wraps at spaces to fit its width; `\n` always breaks. New props
  `wrap`, `maxLines` (cuts with "…"), `textAlign` and `lineHeight`; selection works across
  lines.
- **Scrolling:** draggable scrollbars (a press on the track pages), `<Scroll horizontal>`
  (and both axes), Shift+wheel, PageUp/PageDown/Home/End/arrows, `scrollTo({ x, y })` and
  `scrollIntoView()`.
- **Control flow:** `<Switch>`/`<Match>`, `<Index>` and `<ErrorBoundary fallback={(error,
  reset) => ...}>`; `<Show>` and `<Match>` take a function child that receives the value.
- **Context and refs:** `createContext`/`useContext`; `ref={(el) => ...}` on every widget
  (`focus()`, `blur()`, `scrollTo()`, `scrollIntoView()`, the laid-out box); `onResize`.
- **Style:** `opacity` and `translateX`/`translateY` on any widget.
- **Theme:** `setTheme("dark" | "light" | yourTheme)`, `darkTheme`, `lightTheme`,
  `colorScheme()`. Widgets, `<Canvas>` and charts follow a switch at runtime.
- **Animation:** `animate`, `createTween`, `createPresence`, `easing`, `mixColor`. `Dialog`,
  `Select`, `Tooltip` and `Toggle` animate. Without a window (tests) animations finish at
  once; `frames()` in `@nodebuilderjs/core/testing` drives the clock.
- **Clipboard:** `clipboard.writeText`/`readText` (system clipboard on Wayland and X11),
  paste in `TextField`, and `<Text selectable>` to select and copy fixed text.
- **Testing:** `interact()` gains `down(x, y)`, `up(x, y)`, scroll with `dx`/`shift` and
  `cursor`; `findByText` also searches overlays.
- **Apps created with `bun create nodebuilderjs`** are in English (code, UI, `AGENTS.md` and
  skills, now named `nodebuilder-ui`, `-from-react`, `-testing`, `-charts`, `-drawing`,
  `-icons`, `-images`, `-packaging`, `-performance`) and show the dark theme toggle, a
  `Tooltip` and a confirmation `Dialog`.

### Changes that may affect your code
- **Text wraps by default.** Text that used to overflow its box now breaks into lines
  (a word longer than the line still overflows). Use `wrap={false}` for one line, or
  `maxLines={1}` to cut it with "…".
- **Row shrinking:** when a row has no room, children with `grow` shrink first, then the
  others. A wrapping text can shrink down to its longest word.
- **Scroll containers:** the content of what scrolls or clips no longer counts toward its
  parent's minimum size, so `<Scroll grow={1}>` inside a column no longer needs
  `minHeight={0}`.
- **Effects:** a signal written inside an effect now runs the effects it triggers after the
  current one finishes (as in SolidJS), instead of in the middle of it. Update loops are
  reported instead of overflowing the stack.
- **Theme colors:** `theme` values read inside functions follow `setTheme`; a value read once
  (`color={theme.text.secondary}`) keeps the color of that moment. Use
  `color={() => theme.text.secondary}` to follow the theme. Assigning `theme.x = ...` still
  works, at any time.
- **Disabled buttons** are now dimmed and leave the Tab order.
- `Image`'s `opacity` is now the general `opacity` style (same usage).
- The native addon and the core must have the same version (the scroll event carries the
  modifier keys); installing `@nodebuilderjs/core` brings the matching addon.

### Fixes
- A `<For>` directly under a context provider, inside `<Show>` content or at the root
  recreated all its rows on every list change; a component inside `<Show>` was rebuilt when
  a `<Show>` inside it toggled.
- The mouse wheel reached what was behind a modal overlay.
- `ref` on a `Scroll` that scrolled during creation did nothing.

### Performance
- Same frame time as 0.2.1 in the benchmark scenes (1000 changing texts, 500-row table),
  measured before and after each change; mounting and disposing a 500-row `<For>` is ~20%
  faster.

## 0.2.1 (2026-10-11)

- **Apps created with `bun create nodebuilderjs`** come with a bigger example: counter,
  task list, live chart, icons, the state in a module and tests that click and type with
  `interact()`. 0.2.0 was published before this change.
- No changes in the core since 0.2.0.

## 0.2.0 (2026-10-11)

### New
- **Images:** `<Image>` widget with `fit` (`contain`, `cover`, `fill`), corners and opacity.
  PNG, JPEG and WebP decoded in TypeScript (identical to libpng, libjpeg-turbo and libwebp);
  AVIF and HEIC through the system's `libheif`, optional.
- **Icons:** `<Icon>` widget with its own SVG renderer, for Lucide (`lucide-static` or
  `lucide`) and Phosphor (`@phosphor-icons/core`). The color is inherited like text color
  and applied on the GPU.
- **Freehand drawing:** `<Canvas draw={(g) => ...}>` widget with lines, polygons, circles,
  arcs and text, drawn by the GPU with antialiasing.
- **Charts:** `@nodebuilderjs/core/charts`, with a Recharts-shaped API: `LineChart`,
  `AreaChart`, `BarChart`, `ComposedChart` and `PieChart`, with axes, grid, legend, tooltip,
  stacking, dashed lines and labels. Costs nothing in apps that don't import it.
- **Events:** `onPointerMove`; pointer events gain `localX`/`localY` (relative to the
  node), and a drag keeps reaching the node where the press started.
- **App tests:** `interact(root)` in `@nodebuilderjs/core/testing` simulates mouse and
  keyboard without a window (`hover`, `press`, `drag`, `scroll`, `key`, `type`).
- **Apps created with `bun create nodebuilderjs`** come with skills for agents
  (`.agents/skills/`, linked from `.claude/skills/`).

### Performance
- Culling: what is outside the visible area of a `Scroll` is not laid out, painted or
  hit-tested. 500-row table: from 78 to 104 fps with a 120 cap.
- Text measurements kept per node: "1 text changes among 1000" went from 39% to 23% CPU.

### Changes that may affect your code
- `PointerEvent` has the new fields `localX` and `localY`, and the `Painter` interface has
  the new methods `image`, `line`, `triangles` and `arc`. Only affects code that creates
  these objects by hand.
- The files in `src/` were organized into folders (`render/`, `widgets/`...). The public
  entry points (`@nodebuilderjs/core`, `/jsx-runtime`, `/testing`) did not change; internal
  paths such as `@nodebuilderjs/core/src/...` did.

### Fixes
- `click()` from `@nodebuilderjs/core/testing` sent the middle button; it now sends the left one.

## 0.1.1 (2026-10-11)

First published version: SolidJS-style reactivity, flexbox layout, basic widgets, a native
Wayland/X11 core with OpenGL ES 2, `bun create nodebuilderjs` and `nodebuilder package`
(AppImage, `.deb`, `.rpm`, `.tar.gz`).
