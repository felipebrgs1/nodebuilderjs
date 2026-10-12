# Changelog

## Unreleased

### New
- **`zIndex`:** paint and hit-test order among siblings (default 0; ties keep child order).
  Siblings only, no global stacking contexts; overlays stay above everything. The part of a
  child that sticks out of a parent that does not `clip` (an absolute badge) is now clickable.
- **`<Grid columns={4} gap={8} rowGap={12}>`:** children flow into rows of equal-width cells
  (the last row keeps empty cells); each row is as tall as its tallest cell. Laid out by the
  layout engine itself, so `<For>` inside stays keyed and adding an item only reflows.
- **`aspectRatio`** (width / height) on every widget, like CSS `aspect-ratio`: the height
  follows the width in columns and `Grid` cells, the width follows a fixed height or a row's
  height; `min/max` clamp. `aspectRatio={1}` in a `Grid` gives square covers.
- **Overflow warnings:** in development, `run()` prints once per node when children need more
  room than their container gives them and a `clip` ancestor or the window hides the excess
  (`layout: Row > Text("Artists") overflows Box(panel) by 42px (children need 342px, 300px
  available)`); `debugTree()` marks the container `[overflow +42]`, and tests read them with
  `layoutWarnings()` (from `mount`, or `layoutWarnings(root)` in `@nodebuilderjs/core/testing`).
  Silent with `NODE_ENV=production` and in packaged executables (which also silences the frame
  loop warning there).
- **Font fallback and color emoji:** characters the UI font lacks (`▲`, `↑`, CJK...) come from
  the system's fallback fonts (fontconfig order), and emoji are drawn in color (Noto Color
  Emoji and other CBDT/sbix/COLRv0 fonts), including ZWJ sequences, skin tones and flags.
  `color` does not tint an emoji; `opacity` does fade it. Works in screenshots too.
- **Screenshots without a window:** `nodebuilder screenshot <app.tsx> <out.png>` (`--width`,
  `--height`, `--scale`, `--theme`, `--wait-frames`) renders the app to a PNG with the GPU and
  no display server (EGL surfaceless), after its animations finish; `screenshot(root | view)`,
  `savePNG` and `canScreenshot` in `@nodebuilderjs/core/testing` give the real pixels in tests.
  Generated apps get `bun run screenshot`, and their skills tell agents to look at the UI.
- **`<Icon fill>`:** `true` fills with the icon color, a color fills with that color; replaces
  the root `<svg>` fill (as Lucide's prop does), so outline icons become solid. Reactive.
- **`ariaLabel`** on every widget: a name for elements without text (icon-only buttons). The
  window's title-bar buttons are labelled ("Minimize", "Maximize"/"Restore", "Close") and a
  `Tooltip` labels its trigger with the tip. `debugTree()` shows it.
- **Testing:** `findAllByText`, `findByLabel`, `findAllByLabel`.
- **Hover and press:** `hoverStyle`/`pressStyle` on every widget and `createInteraction()`
  (`hovered`/`pressed`/`focused` + `props` to spread), for a child that follows its parent's hover.
- **Custom title bar:** `<Window decorations={false}>`, `dragRegion` on any widget (double click
  maximizes; controls inside keep the press) and `<WindowControls />`.
- **Layout:** `alignSelf`; `right`/`bottom` on absolute children (`left={0} right={0}` stretches).
- **Text:** `underline` (inherited). Canvas `g.text(..., { maxWidth, ellipsis })`.
- **Frame tracing:** `NB_STATS` shows why frames were drawn (`why: inv ev raf`);
  `NB_TRACE=frames` prints the stack that asked for each frame; in development a warning names
  code that invalidates inside every frame.

### Changed
- **Testing:** `click(node)` and the node helpers of `interact()` throw when the node can't be
  reached (culled, clipped by an ancestor or the window, not in the tree, overlay not shown)
  instead of silently missing. `click(node)` uses the node's center, and `localX/localY` are
  relative to the node that handles the click.
- **Absolute children** of a `Scroll` now scroll with the content (they stayed fixed).
- Handlers passed to a widget are chained with the widget's own instead of replacing them
  (`Slider` and `TextField` dropped a user's `onPointerDown`).

### Docs
- `bun run check:snippets` typechecks the README and skill snippets; the ones that failed are fixed.
- Skills and README: equal columns (`width={0} grow={1}`), absolute children, `clip` with
  `radius`, `shadow` without `background`, reactive Canvas `draw` and fitting text with
  `measureText`, animation options (`createTween` `duration`/`easing`, `mixColor`), events.

### Fixed
- **Idle redraw:** since the interactive scrollbars (0.2.5), an idle window redrew at the fps cap
  (~10% CPU for an empty window, ~25% for the dashboard) because the per-frame hover refresh
  invalidated even with no scrollbar to highlight. Idle is back to 0 frames and 0% CPU.
- **`mixColor` toward a transparent color** passed through translucent gray: it now mixes in
  premultiplied space like CSS, so `mixColor("#ff0000", "transparent", 0.5)` is red at 50% alpha.

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
