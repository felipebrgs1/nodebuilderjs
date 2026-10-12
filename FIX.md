# FIX.md: follow-ups from the Spotify-style dashboard report (v0.2.5)

A user built a Spotify-like dashboard with 0.2.5 and reported 13 problems. Already done on
`develop`:

- **13. Idle redraw**: fixed (`setActiveBar` invalidated every frame; idle CPU 9.8% -> 0%).
- **2 (part). Clicking a hidden node in tests**: `click()` and `interact()`'s node helpers
  throw when the node is culled, clipped, detached or in a hidden overlay.
- **6. Finding elements in tests**: `findAllByText`, `ariaLabel` on every widget +
  `findByLabel`/`findAllByLabel` (window buttons and Tooltip triggers labelled by default).
- **7. Filled icons**: `<Icon fill>` (`true` or a color, reactive).
- **3, 4, 10, 11 (docs)**: equal columns, absolute children, clip radius, shadow without
  background, reactive Canvas `draw`, fitting text with `measureText`, animation options,
  `mixColor`, events. All pinned by tests in `core`/`style`.

This file is the plan for the rest. Each item: the problem, the proposed API, how to
implement it (files), how to test it (TDD, see AGENTS.md), and docs. Ordered by value per
effort inside each group. Delete an item from here when it ships (and add it to CHANGELOG).

---

## A. Agents and debugging

### A1. Headless screenshot (report item 1) - large, highest value

**Problem:** an agent finishes a UI without ever seeing it. Tests check boxes and draw
commands, not colors, shadows, Canvas output or visual alignment.

**API:**
- CLI: `nodebuilder screenshot <app.tsx> <out.png> [--width 1200 --height 800 --scale 1
  --theme dark --wait-frames 2]`.
- Tests: `const shot = await screenshot(root, { width, height, scale })` in
  `@nodebuilderjs/core/testing` returning `{ width, height, rgba }` plus `toPNG()`; and
  `savePNG(shot, path)`.

**Implementation:**
1. Platform contract (`native/include/nb_platform.h`): `bool nb_platform_offscreen_open(int w,
   int h, int scale)` / `nb_platform_offscreen_close()`. Runs on the JS thread, no event pump.
2. Linux (`native/platform/linux/offscreen.c`): `eglGetPlatformDisplay(EGL_PLATFORM_SURFACELESS_MESA,
   EGL_DEFAULT_DISPLAY, NULL)`; fallback `EGL_EXT_platform_device` (first device). GLES2
   context with no surface (`EGL_KHR_surfaceless_context`) rendering into an FBO
   (RGBA8 renderbuffer). Must work with no `WAYLAND_DISPLAY`/`DISPLAY` (CI, containers).
3. Core (`render_gles2.c`): `nb_render_*` already draws into the bound framebuffer; add
   `nb_render_read_pixels(uint8_t *out)` (`glReadPixels`, flip Y, un-premultiply or keep
   premultiplied and document it).
4. Addon (`core/addon.c`): `renderOffscreen(w, h, scale, commands, texts) -> Uint8Array`,
   typed in `src/runtime/native.ts`. Text uses the same FreeType atlas, so real fonts.
5. TS: `src/testing.ts` lays out with **real** text metrics (`nat.measureText`) for the
   screenshot, paints with `paintTree`, calls the addon. PNG encoder in `src/image/png-encode.ts`
   (stored or deflate via `node:zlib`, which png.ts already uses).
6. CLI (`cli/nodebuilder.ts`): imports the app module with a fake `run()` that captures the
   view instead of opening a window (add a `NB_HEADLESS=<out.png>` path in `run()` instead
   of opening a window: layout, `frames()` until animations settle, screenshot, exit).

**Tests:** addon test with `test.skipIf(!offscreenAvailable)`: a red 10x10 RECT gives red
pixels; rounded corners have AA alpha; TEXT draws non-transparent pixels in its box. PNG
encoder: round trip through `decodeImage`. CLI: smoke test in `test/cli.test.ts` skipped
without EGL.

**Docs:** README (Testing), `nodebuilder-testing` skill ("look at your UI: `nodebuilder
screenshot` then read the PNG"), template AGENTS.md ("after visual changes, take a
screenshot"), ARCHITECTURE (offscreen path).

### A2. Frame tracing (report item 13 suggestions) - small

**Problem:** with the idle bug there was no way to see who asked for frames.

**API:** `NB_STATS=1` adds a column with frame reasons per second: `why: inv 3 ev 2 raf 0`.
`NB_TRACE=frames` logs, per frame, the first stack of `invalidate()` (top 6 frames) and
flags `[in frame]` when it came from inside `renderFrame` (layout/paint/refreshHover).

**Implementation:** `src/runtime/app.ts`: `schedule(reason)`; `setFrameScheduler` passes
"invalidate", the `handle()` cases pass the event type, `runFrameCallbacks` "raf". Capture
`new Error().stack` only when `NB_TRACE` is set (cost). In dev, warn once if an invalidate
from inside the frame happens N frames in a row with no state change ("frame loop:
invalidated by X every frame").

**Tests:** make `run()` testable with an injected native (a fake `{ open, render,
requestFrame, ... }` that records `render` calls and lets the test emit `configure`/`frame`):
- idle window: after `configure` + 5 `frame` events, exactly 1 `render`;
- a signal change: one more render; an animation: renders until it ends, then stops.
This is the automated "idle renders 0 frames" test the report asked for.

### A3. Overflow warnings (report item 2) - medium

**Problem:** a Row of chips wider than its clipped 300 px panel hid the last chip silently.

**API:** in development (`NODE_ENV !== "production"` and not in the packaged executable),
print once per node: `layout: Row > Text("Artists") overflows its clipping ancestor
Box(panel) by 42px (children need 342px, 300px available)`. `debugTree()` marks
`[overflow +42]`. In tests, `mount()` exposes `warnings()` so a test can assert none.

**Implementation:** `src/render/layout.ts`: where a flex line's sum of min-content sizes
exceeds the inner size on the main axis and the container is not scrollable on that axis
(`clip` or an ancestor with clip). Collect into a module-level list, not `console.warn`
inside layout (tests stay quiet); `run()` drains and prints it, deduped by node.

**Tests:** `test/core.test.tsx`: a 300px clipped Row with children of 342px reports one
warning naming the overflowing child; a Scroll horizontal does not warn; fixing the width
clears it.

### A4. Realistic text metrics in tests (report item 6) - small

**Problem:** fake metrics (8 px/char) make overflow tests unrepresentative.

**API:** `useRealTextMetrics()` in `@nodebuilderjs/core/testing` (loads the addon,
`measureText` works without a window); `useFakeTextMetrics({ charWidth, lineHeight })`
keeps being the default. Document the trade-off (real metrics depend on installed fonts).

**Implementation:** check that `nat.measureText` initializes FreeType lazily without
`open()` (it should: `text.c` + `nb_platform_font_path`). If not, add the lazy init.

**Tests:** `test/testing.test.tsx`: with real metrics "iiii" is narrower than "MMMM";
`skipIf` no addon.

---

## B. Layout

### B1. `alignSelf` (report item 8) - small

**API:** `alignSelf?: "start" | "center" | "end" | "stretch"` on any child; overrides the
parent's `align` for that child.

**Implementation:** `Style` (`src/render/node.ts`) + `STYLE_KEYS` (`widgets/props.ts`);
in `layout.ts` the cross size/offset computation per child (`crossSize`, `crossOffset`)
reads `c.style.alignSelf ?? node.style.align ?? "stretch"`. Careful with `heightAt` in
rows: a non-stretched child uses its intrinsic cross size.

**Tests:** `test/core.test.tsx`: a Column `align="stretch"` with a child `alignSelf="center"`
keeps its intrinsic width, centered; the sibling still stretches. Same in a Row.

### B2. `Grid` and equal columns (report item 3) - small

**API:** `<Grid columns={4} gap={8} rowGap={8}>{items}</Grid>`: children flow into rows
of `columns` equal-width cells (each cell `width={0} grow={1}`); last row keeps empty
cells so widths stay equal. Reactive children (`<For>`) supported.

**Implementation:** `src/widgets/grid.ts` on top of Column/Row: collects resolved children
(`render(child)`, see "Build, then collect" in AGENTS.md) and chunks them in a memo; or,
better for `<For>`, a layout-level `direction: "grid"` with `columns` in `layout.ts`
(place children in cells; height of a row = max of its cells' `heightAt(cellWidth)`).
Prefer the layout version: no re-chunking on list changes, and `<For>` stays keyed.

**Tests:** 4 columns in 400px with gap 8 -> each 94px; 5 children -> 2 rows, the fifth at
x=0; wrapping text in one cell grows only its row; `<For>` adding an item reflows.

### B3. `aspectRatio` (report item 3) - small/medium

**API:** `aspectRatio?: number` (width / height). Square covers that follow the width:
`<Box aspectRatio={1}>`.

**Implementation:** `Style` + `STYLE_KEYS`; in `layout.ts`, `heightAt(node, w)` returns
`w / aspectRatio` when height is not fixed; mark the node as width-dependent (like wrapping
text, via `minContentWidth` or an equivalent flag) so the column path computes widths first.
In a row with fixed height and no width, `intrinsic().width = height * aspectRatio`.

**Tests:** in a 300px column (stretch) -> 300x300; with `grow` in a row of fixed height ->
width follows; min/max still clamp; inside `Grid` cells -> square cells.

### B4. `wrap` on Row (report item 2) - medium

**API:** `wrap?: boolean` on Row (and Column): children that don't fit start a new line;
`gap` between items, `rowGap` between lines (default = gap). Chips and tags.

**Implementation:** `layout.ts`: split children into lines by their main-axis basis
(intrinsic or width), each line laid out with the existing flex code (grow/justify per
line), lines stacked on the cross axis. Height depends on width (like wrapping text): the
node needs `minContentWidth` = widest child, and `heightAt(node, w)` computes the lines.
Culling per line as today.

**Tests:** 5 chips of 80px in 300px with gap 8 -> 3 on the first line, 2 on the second;
`grow` stretches within a line; `justify="center"` per line; inside a Column the Row's
height is the sum of lines; changing the parent width reflows.

### B5. `margin` (report item 8) - medium

**API:** `margin?: Edges` (CSS order, negative allowed). Space outside the border, not
painted, not hit-tested.

**Implementation:** `Style` + `STYLE_KEYS`; in `layout.ts` every child's outer size =
box + margin (intrinsic, `heightAt`, flex basis, min-content) and its placement offsets by
`margin.left/top`. Negative margins shrink the outer size (can overlap a sibling). This
touches every size function: write the tests first and keep `gap` semantics unchanged.

**Tests:** margin adds to the parent's intrinsic size; with `grow` the box shrinks by the
margin; negative margin pulls the next sibling over; absolute children use margin as an
offset; `align="stretch"` subtracts cross margins.

### B6. Absolute children: `right`/`bottom` and stretch - small

**Problem (report item 4):** an absolute background layer can't fill its parent without
`onResize`.

**API:** `right`, `bottom` (as in CSS: `left={0} right={0}` stretches). Optionally
`position="absolute"` with `inset={0}`.

**Implementation:** `layout.ts` (~line 500): width = parent inner width - left - right
when both are set; height likewise; `right` alone places from the right edge. Keep
"doesn't scroll with the content" (document it), or add `scrolls: true`.

**Tests:** `left={0} right={0}` in a 300px parent -> width 300; `right={10}` alone with
width 50 -> x = 240; inside a Scroll it stays fixed when scrollY changes.

---

## C. Styling and painting

### C1. Hover/pressed styling without boilerplate (report item 5) - small/medium

**Problem:** almost every Spotify element changes on hover; the user wrote `createHover()`
and repeated `onPointerEnter/onPointerLeave` in 15+ places.

**API (both):**
- `createHover()` / `createInteraction()` in core: `const card = createInteraction();
  <Box {...card.props} background={() => card.hovered() ? a : b}>` with `hovered`,
  `pressed`, `focused` accessors. Works when a child depends on the parent's hover (the
  play button that appears on a card).
- Shorthand props for the common case: `hoverStyle={{ background, color, opacity }}` and
  `pressStyle={...}` on every widget, applied over the base style while hovered/pressed.

**Implementation:** `widgets/props.ts` already has `interaction(node)` (internal, wraps
handlers). Export a node-independent version that returns `props` (handlers merged with
the user's own handlers in `applyProps`, not overwritten). `hoverStyle`: in `applyProps`,
when present, call `interaction(node)` once and an effect that sets each key to the hover
value or the base (`props[key]` read reactively) value.

**Tests:** `test/style.test.tsx` with `interact()`: hover changes background, leave
restores it; base value reactive while not hovered; user's own `onPointerEnter` still
runs; `pressStyle` wins over `hoverStyle` while pressed; disabled widgets ignore it.

### C2. Underline, font weights, letter spacing (report item 8) - small to large

- **Underline (small):** `underline?: boolean` (or `textDecoration: "underline"`) on
  `Text` (inherited like `bold`). Paint only, in TS: `text.ts` paint emits a RECT of 1 px
  (scaled with font size) at baseline + descent/3 for each line, width = line width. No
  opcode change. Tests: `drawCommands` has one rect per wrapped line.
- **Letter spacing (medium):** `letterSpacing?: number` (px). Measure: width + spacing *
  (graphemes - 1); TEXT opcode gains a float (update `nb.h`, `paint.ts`,
  `render_gles2.c`, `decode()` in `test/helpers.ts`); `text.c` adds the spacing to each
  HarfBuzz cluster advance. The measure cache key in `app.ts` includes it. Wrapping
  (`text-wrap.ts`) and selection (`text-selection.ts`) positions must include it.
- **Weights (large):** `fontWeight?: 100..900` (`bold` = 700) and `italic`. Today fonts are
  `NB_FONT_REGULAR/BOLD` (`nb_platform_font_path(int)`). Change the contract to
  `nb_platform_font_path(int weight, bool italic)` (fontconfig `FC_WEIGHT`/`FC_SLANT`,
  closest match), and the TEXT opcode `font` field to a font id `(weight/100)*2 + italic`;
  `text.c` keeps an atlas per loaded face (lazy). Test: `measureText` with weight 900 is
  wider than 400 (addon test, `skipIf` fonts missing).

### C3. Gradients (report item 4) - medium

**API:** `background={{ linear: ["#1db954", "#121212"], angle: 180 }}` (stops as colors, or
`[color, offset][]`); in Canvas, `g.linearGradient(...)` as a fill for `rect`/`polygon`.

**Implementation:** the renderer interpolates `v_color` per vertex; a 2-stop linear
gradient is affine in position, so setting each vertex's color to `mix(c0, c1, t(vertex))`
is exact for any angle (CSS: gradient line length so corners hit 0 and 1). Multi-stop =
split the quad into bands at the stop positions. New op `GRADIENT_RECT` (x y w h radius
angle n stops...) so rounded corners and borders keep using the SDF path; the C side builds
the vertices. Interpolate in premultiplied space (CSS) by premultiplying on the C side
before the shader, or accept straight interpolation and document it. Keep `nb.h`,
`paint.ts`, `render_gles2.c` and `decode()` in sync. `parseColor` keeps rejecting objects
where a plain color is required.

**Tests:** `test/draw.test.ts`: the op is emitted with the stops; theme switch re-emits;
visual check with an example + `spectacle` capture (or A1 once it exists).

### C4. Canvas text with max width (report item 10) - small

**API:** `g.text(text, x, y, color, size?, bold?, { maxWidth, ellipsis: true })` or a new
`g.textFit(...)`. Reuse the "…" truncation from `render/text-wrap.ts` (`maxLines`).

**Tests:** `test/canvas.test.tsx`: a long title in maxWidth 50 draws text ending in "…"
whose measured width ≤ 50; short text unchanged.

---

## D. Window

### D1. Custom title bar (report item 9) - small/medium

**Problem:** Spotify merges the navigation bar with the title bar; `<Window>` always draws
its own ~53 px bar. `dragRegion` exists on `UINode` but is not a prop.

**API:**
- `<Window decorations={false}>`: no title bar/divider; border, radius and edge resizing
  stay (CSD still needed on Wayland without xdg-decoration).
- `dragRegion` prop on any widget (double click maximizes, as the built-in bar does).
- `<WindowControls />` widget: the three buttons (same look, `ariaLabel`s), to place in a
  custom header. `windowControls`/`windowState` are already exported: document them.

**Implementation:** `src/widgets/window.ts`: build `bar` + `Divider` only when
`decorations !== false`; move `WindowButton`s into an exported `WindowControls`. Add
`dragRegion` to `applyProps` (not a Style field: a node flag, like `ref`). Move the
double-click-to-maximize handler into the generic drag-region path in `runtime/input.ts`
(line ~319) so custom regions get it too. Children of a drag region that handle
`onPointerDown` (buttons, search field) must not start a move: check that `input.ts`
only moves when no descendant handled the press.

**Tests:** `test/input.test.tsx` (fake host records `move`): press on a custom
`dragRegion` Row calls `move`; press on a Button inside it does not; double click calls
maximize. `decorations={false}` tree has no Titlebar (`debugTree`).

---

## E. Ecosystem

### E1. Icon imports (report item 12) - small

**Problem:** 32 lines of `export { default as x } from "lucide-static/icons/x.svg" with {
type: "text" }`.

**Not** bundling Lucide in core (zero third-party content in the package, size). Instead,
a code generator: `nodebuilder icons add play pause heart --from lucide-static` writes/updates
`src/icons.ts` (sorted, deduped, camelCase names), validating that each file exists in
`node_modules`. Supports `--from @phosphor-icons/core` (`-fill` variants). Works in the
packaged executable (static imports with `type: "text"`).

**Tests:** `test/cli.test.ts` with a fake `node_modules/lucide-static/icons/` in a temp dir:
adds, dedupes, errors on an unknown icon.

**Docs:** `nodebuilder-icons` skill.

---

---

## F. Found while fixing the above

### F1. Absolute child inside a `Scroll` doesn't scroll - small, bug

`layout.ts` (~line 503) places absolute children at `innerX/innerY + left/top` without
subtracting the scroll offset, so a direct absolute child of a `Scroll` stays fixed in the
viewport (CSS scrolls it with the content). Documented today with the workaround (wrap it in
an in-flow child). Fix: subtract `offsetX/offsetY` like in-flow children; if a "sticky/fixed"
layer is wanted, make it opt-in. Test: the existing "absolute child in a Scroll" test in
`test/core.test.tsx` flips. Update the `nodebuilder-ui` skill and README "Layout".

### F2. `position` doc comment - trivial

`Style.position` in `src/render/node.ts` says "inside the parent's padding box"; the code
measures `left/top` from the content corner (inside the padding). Fix the comment.

### F3. Stacking: `zIndex` - small/medium

Children paint and hit-test in child order; an absolute child declared first ends up under
its in-flow siblings, and the part of an absolute child outside its parent is drawn but not
clickable (hit testing requires every ancestor to contain the point). Add `zIndex` (paint
and hit-test order among siblings) and make hit testing descend into absolute children
outside the parent box when the parent doesn't clip. Tests in `test/style.test.tsx`
(draw order) and `test/input.test.tsx` (hits).

### F4. `onPointerDown` bubbling stops at a node with `onClick` - check

Bubbling of `onPointerDown` ends at the first node with an `onClick`, even without
`stop()`. Decide whether it is intended (buttons own their press) and document it, or make
it bubble until `stop()`. Test either way in `test/input.test.tsx`.

### F5. Snippets are not typechecked automatically - small

AGENTS.md says skill/README snippets must typecheck, but there is no script. Add
`scripts/check-snippets.ts` (extract ```tsx blocks with imports from README and the template
skills, write them to a temp dir with a tsconfig extending the repo's, `bun x tsc --noEmit`;
blocks marked `<!-- no-check -->` skipped) and a `bun run check:snippets` script; run it in
"Before finishing a task". Two blocks fail today (adjacent JSX siblings without a wrapper):
the first block of `nodebuilder-icons` and one in `nodebuilder-images`.

### F6. `mixColor` interpolates straight alpha - small

Mixing toward `"transparent"` (`#00000000`) passes through translucent gray. Interpolate in
premultiplied space (as CSS does) and un-premultiply; test that
`mixColor("#ff0000", "transparent", 0.5)` is `rgba(255,0,0,0.5)`. Same rule for C3 gradients.

## Suggested order

1. A2 (tracing + testable `run()` with the idle test: protects the fix just made), F1, F2, F5
2. B1, C1, D1, C2-underline, C4, B6 (small, visible wins for apps like this one)
3. A1 (screenshot), then B2/B3, B4, A3
4. C3 + F6, F3, B5, C2 (weights, spacing), A4, E1, F4
