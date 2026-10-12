# FIX.md: follow-ups from the Spotify-style dashboard report (v0.2.5)

A user built a Spotify-like dashboard with 0.2.5 and reported 13 problems. Already done on
`develop`:

- **13. Idle redraw**: fixed (`setActiveBar` invalidated every frame; idle CPU 9.8% -> 0%).
- **2 (part). Clicking a hidden node in tests**: `click()` and `interact()`'s node helpers
  throw when the node is culled, clipped, detached or in a hidden overlay.
- **6. Finding elements in tests**: `findAllByText`, `ariaLabel` on every widget +
  `findByLabel`/`findAllByLabel` (window buttons and Tooltip triggers labelled by default).
- **7. Filled icons**: `<Icon fill>` (`true` or a color, reactive).
- **Second round:** frame tracing (`NB_TRACE=frames`, frame reasons in `NB_STATS`, frame-loop
  warning) and app-level frame tests via `runWith` (A2); `alignSelf` (B1); absolute
  `right`/`bottom` (B6) and absolute children scroll with the content (F1, F2);
  `hoverStyle`/`pressStyle`/`createInteraction` (C1); `underline` (C2 part); Canvas
  `text` `maxWidth` (C4); `<Window decorations={false}>`, `dragRegion`, `<WindowControls>`
  (D1); `bun run check:snippets` (F5).
- **1. Seeing the UI**: `nodebuilder screenshot` and `screenshot()` in testing render real
  pixels with no window or display server (A1).
- **3, 4, 10, 11 (docs)**: equal columns, absolute children, clip radius, shadow without
  background, reactive Canvas `draw`, fitting text with `measureText`, animation options,
  `mixColor`, events. All pinned by tests in `core`/`style`.

This file is the plan for the rest. Each item: the problem, the proposed API, how to
implement it (files), how to test it (TDD, see AGENTS.md), and docs. Ordered by value per
effort inside each group. Delete an item from here when it ships (and add it to CHANGELOG).

---

## A. Agents and debugging

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

**Implementation:** `nat.measureText` already works without `open()`, and
`nativeTextMeasurer(nat, scale)` (`src/runtime/native.ts`) is what screenshots use: install it.

**Tests:** `test/testing.test.tsx`: with real metrics "iiii" is narrower than "MMMM";
`skipIf` no addon.

---

## B. Layout

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

---

## C. Styling and painting

### C2. Font weights, letter spacing (report item 8) - medium to large

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
visual check with `nodebuilder screenshot` of an example.

---

## D. Window

Done (D1). Left for later: server-side decorations via `xdg-decoration` on KDE.

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

### F6. `mixColor` interpolates straight alpha - small

Mixing toward `"transparent"` (`#00000000`) passes through translucent gray. Interpolate in
premultiplied space (as CSS does) and un-premultiply; test that
`mixColor("#ff0000", "transparent", 0.5)` is `rgba(255,0,0,0.5)`. Same rule for C3 gradients.

## Suggested order

1. B2/B3 (Grid, aspectRatio), A3 (overflow warnings), B4 (wrap)
2. C3 + F6 (gradients, premultiplied mixColor), F3 (zIndex), B5 (margin)
3. C2 (weights, spacing), A4, E1, F4
