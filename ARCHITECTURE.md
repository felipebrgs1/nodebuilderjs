# Architecture

How nodebuilder works under the hood. To use the framework, the [README](README.md) is enough;
for the rules and conventions for anyone changing the code, see [AGENTS.md](AGENTS.md).

## Overview

```
 your app (.tsx)
     │  components, signals
┌────▼──────────────────────────────── TypeScript (src/) ──────────────────────┐
│ reactive/     signals, effects, memos, ownership; control flow, errors       │
│ jsx-runtime   JSX -> lazy descriptions                                       │
│ widgets/      Window, Column, Text, Image, Icon, Button... create UINodes    │
│ image/        image sources; PNG, JPEG, WebP decoders                        │
│ svg/          SVG for icons, on top of geometry/ (paths, strokes, raster)    │
│ render/       node: retained tree · layout: flexbox · paint: command buffer  │
│ runtime/      frame loop, events, focus, hover, NB_STATS; native addon       │
└────┬─────────────────────────────────────────────────────────────────────────┘
     │  N-API: render(commands, texts), measureText, registerFont, createImage, events
┌────▼──────────────────────────── portable core (native/core/) ───────────────┐
│ addon.c         N-API surface, event queue, threadsafe function              │
│ render_gles2.c  one shader, one vertex format, one batch per frame           │
│ text.c          HarfBuzz + FreeType shaping, runs, alpha and color atlases   │
│ faces.c         font faces, app fonts, family lists, CSS matching, fallback  │
└────┬─────────────────────────────────────────────────────────────────────────┘
     │  nb_platform.h contract (window, events, fonts)
┌────▼──────────────────────── OS backend (native/platform/linux/) ────────────┐
│ linux.c      picks Wayland or X11 at runtime                                 │
│ wayland.c    xdg-shell, EGL, pointer, keyboard (xkb + compose), cursor       │
│ x11.c        Xlib + EWMH, EGL, XIM, Xcursor, XRandR                          │
│ pump.c       poll() thread that signals when there are events                │
│ fonts.c      fontconfig: families by name, fallback order, installed list    │
│ codecs.c     AVIF/HEIC via libheif (dlopen, optional)                        │
└──────────────────────────────────────────────────────────────────────────────┘
```

The idea is to keep as much as possible in TypeScript (easy to read, change and, on purpose,
easy for LLMs to write) and to keep the C small and stable: all it knows is how to open a
window, deliver events, measure text and draw a list of rectangles, text, images and clips.

## Reactivity

The model is SolidJS's, implemented from scratch in `src/reactive/signals.ts`:

- `createSignal` holds a value and knows who read it. When it changes, it reruns only those readers.
- `createEffect` and `createMemo` record the reads made while they run.
- **Update queue:** a write outside `batch` runs the affected effects right away
  (`flushPending`). While that queue is running, new writes only join it: the effect that
  wrote finishes before the ones it triggered (it never runs reentrantly, in the middle of
  itself), and an update cycle is detected by the 100 000-run limit instead of blowing the
  stack (it throws "reactive update loop detected"). An error that no scope handles does not stall the queue: the remaining pending
  effects run (in a `finally`) and the first error goes on to whoever wrote the signal.
- **Ownership:** everything created inside an effect or `createRoot` is disposed of along
  with it (`onCleanup`). That is how switching tabs, for example, releases everything from the old tab.
- **Context** (`reactive/context.ts`) also lives in the owner tree: the `Provider` creates a
  scope holding the value and resolves the children inside it (`jsx()` is lazy; if they were
  resolved elsewhere, the components would run outside the scope). `useContext` walks up the
  owners. A `createRoot` is not disposed of by the surrounding owner, but it keeps a reference
  to it just for this lookup: that way the rows of `<For>`, which are roots, see the outer context.
- **Errors** also travel up the owner tree. `catchError(fn, onError)` creates a scope with
  a handler (`Owner.onError`); `execute`, which runs every effect and memo, catches whatever the
  run throws and hands it to the nearest handler up the owners (passing through the roots of
  `<For>`/`<Index>`, like context). With no handler up the owners, `execute` does not catch at
  all (`try`/`finally`): `bun test` and Bun's error printer show the frames of the last `throw`,
  so catching and rethrowing would put the framework's frame on top instead of the app's. The handler runs
  with writes deferred until the end of the current update, so that the failing scope is not
  disposed of in the middle of a computation that is still running.
  `<ErrorBoundary>` (`reactive/error-boundary.ts`) creates the children inside a `catchError`:
  an error during creation is seen right after it; a later error (an effect rerun by a
  signal) schedules a new run of the boundary. In both cases the children's scope is
  disposed of entirely (effects, `onCleanup`, overlays) and the `fallback` appears; `reset()`
  creates the children again. Event handlers do not go through `execute`: whatever they throw
  reaches their caller (the input), as in React and Solid.

There is no custom JSX compiler: TypeScript/Bun turns JSX into `jsx()` calls, which only
create **descriptions** (`ElementDesc`). The component runs when the description is inserted
into the tree. This lets `<Show>`, `<Switch>` and `<For>` decide when (and whether) to
instantiate their children; `<Switch>` reads the props of each `<Match>` straight from the
description, without running anything.

`run(app)` and `mount(view)` call the callback with `untrack` before inserting what it
returns, so it behaves like a component body: reading a signal there and then setting it does
not make the whole app a reactive slot that reruns (and loops) on every write.

**`onMount`** queues a callback with the current owner. The queue is held while an `insert`
is in progress (`holdMounts`, counted, so nested inserts wait for the outermost one) and while
an update queue is running; it is drained when both end, which is after the nodes created by
that insert (or by the update: a `<Show>` turning on) have been placed in their slots, before
the next layout. Each callback runs untracked under its owner (effects created there belong to
the component); a cleanup on the owner cancels a callback whose component was disposed or
rerun before that. `UINode.focus()` uses the same queue for a `ref` that focuses during
creation: it lands when the node is attached (or, on a root without input yet, as
`root.pendingFocus`, which `createInput` takes), not a microtask later.

Since there is no compiler, the rule is explicit: **only functions are reactive**. A prop
`text={() => ...}` or a child `{count}` becomes an effect that updates the node directly; a
plain value is read once. Components run exactly once; there is no re-render.

Children live in **slots** (`UINode.addSlot/setSlot`). Each function child is a slot with its
own effect: when it reruns, it replaces only the nodes of that section. `<For>` is keyed by
reference and creates one `createRoot` per item, disposed of when the item leaves the list;
`<Index>` creates one root per position, with the value in a signal, and only creates or
disposes of rows when the length changes.

**Build and collect** (`build`/`render` in `jsx-runtime.ts`): whatever mounts children inside
a computation (the slot, the `Provider`, the rows of `<For>`/`<Index>`, the `<ErrorBoundary>`)
first runs the components once (`build`), turning each function child into a memo of its own
content, and only then collects the nodes (`resolve`). So when an inner reactive section
changes (a `<Show>` inside a row, the list of a `<For>` right below a `Provider`), only that
memo reruns and whatever surrounds it just recollects the nodes, without recreating
components or losing their state. Content without any function gets no memo.
Measured without a window (2026-10-12, median of 4 alternating runs): mounting and disposing
of a 500-row `<For>` 100 times went from ~123 to ~100 ms (static rows no longer allocate a
memo); the `try/catch` in `execute` and the non-reentrant queue did not change the cost of
updates (1000 effects × 1000 updates in `batch`: ~264 and ~267 ms, within the noise).

## Theme and animations

`theme.ts` holds two presets (`lightTheme`, `darkTheme`) and the theme in use. The `theme`
object has the shape of the presets, but each leaf is a getter that reads a version signal
before returning the value: an effect (or the `draw` of a `<Canvas>`) that read
`theme.text.primary` reruns when `setTheme()` or an assignment (`theme.divider = ...`) bumps
the version, and painting, which reads the theme every frame, only needs the `invalidate()`.
Widgets do not copy theme colors into the style at creation: they put them in an effect, and
only when the app did not pass its own color. The cost is one function call per read; when
painting 1000 texts, within the noise (measured on 2026-10-12).

Apps can skip the effect altogether: a color prop may be a token name (`"text.secondary"`,
`"sidebar"`). The style keeps the name; `parseColor` resolves it at paint time through
`resolveColor` (`render/color.ts`), which asks the registered sources, app tokens from
`createThemeTokens` first and then the theme (paths into the current theme object), and follows
a token that names another. CSS colors (hex, functions, the named ones) are never looked up.
`setTheme` already invalidates everything, so the next paint picks the new values. The check is
a few string tests per color; `bun run bench` MODE=all N=2000 painted in 0.15–0.16 ms/frame
before and after (2026-10-14). `<Text variant>` is a static merge of a named style set under
the Text's own props.

`runtime/frames.ts` is the frame clock: the `requestAnimationFrame` queue, run by `run()`
before each layout, and `frameNow()`. `animation/` (`animate`, `createTween`,
`createPresence`) uses this clock; an animation starts counting at the call, not at the first
frame. Without a window nothing runs the queue, so `animate` jumps straight to the end when
`animating()` is false: tests of code that uses `Dialog` or `Select` do not need to know about
the transitions. `frames()` from `@nodebuilderjs/core/testing` turns on the fake clock and runs
the queue in 16 ms steps; `mount()` goes back to windowless mode.

## A frame

```
signal changes
  -> effect updates UINode.set(...) / setSlot(...)
  -> invalidate() -> schedule()
       respects the compositor's pending frame and the fps cap (120 by default)
  -> renderFrame()
       requestAnimationFrame callbacks
       layout()        positions and sizes of the visible part of the tree
       refreshHover()  the node under the pointer may have changed
       paintTree()     tree -> command buffer
       native.render() C draws and calls eglSwapBuffers
  -> the compositor signals (frame callback) that the next one can be sent
```

On Wayland the pacing comes from the compositor's frame callback (aligned to vsync). To honor
the fps cap on fast monitors, frames are skipped with `native.requestFrame()`, which commits
without drawing. X11 has no frame callback: the pacing comes from a timer at the monitor's
refresh rate (XRandR).

Every frame request carries a reason: `inv` (`invalidate()`, i.e. the tree changed), `ev` (a
native event: `configure`, or input changing hover/scroll state) or `raf` (frame callbacks
still pending after a frame). The first request since the last frame is the frame's reason;
`NB_STATS` counts them and `NB_TRACE=frames` prints them with the requesting stack. A request
made while a frame is laid out or painted (after the `requestAnimationFrame` callbacks) is
marked `[in frame]`: if that keeps happening for 30 frames with no other request, nothing is
changing and the app is stuck redrawing; outside production (`NODE_ENV`), `run()` warns once
with the top of that stack.

`run()` is `runWith(loadNative(), ...)`; `runWith` takes the native core and hooks (`env`,
`now`, `log`, `warn`) so `test/runtime/app.test.tsx` drives the whole loop with a fake core: it
counts `render` calls while sending `configure`, `frame` and pointer events.

## Layout

`src/render/layout.ts` is a simplified flexbox: `direction`, `gap`, `padding`, `grow`, `align`
(default `stretch`, overridden per child by `alignSelf`), `justify`, `min/max`, and
`position: "absolute"` with `left/top/right/bottom`.

**Percentages** (`width="50%"`, also `height` and the `min`/`max` sizes) are kept on the node
(`UINode.percents`, set by `applyProps`); `Style` stays numeric. `place()` resolves a node's
children against its content box before it lays them out (`resolvePercents`), writing the px
value into the child's style and dropping that child's cached measurements. Before that (the
parent's own natural size, measured earlier in the same pass), a percentage child counts with
its last value, or its content the first time, as CSS does for percentages in intrinsic sizes.

**Auto-fill grids** (`minColumnWidth`): `columnsOf(node, inner)` fits as many columns of at
least that width as the inner width allows (capped by `columns`); without a width (the natural
size) every cell goes in one row, so the grid "wraps" (height depends on width) and can shrink
down to one column. Absolute children are placed after the
in-flow ones, from the padding box (inside the border, ignoring the padding, as in CSS; their
percentages too) and minus the scroll offset (they scroll with the content);
both edges of an axis without a size stretch them (`absoluteSpan`), and a wrapping child gets
its height at that width (`heightAt`).

Shrinking follows CSS's `min-size: auto`: a child does not get smaller than its own content,
unless it is scrollable, clips its content (`clip`) or has an explicit `minWidth`/
`minHeight`. For wrapping text, "its own content" along the width is the longest word (with
`maxLines`, the "…"). In a row that is out of space, the children with `grow` shrink first
and only then the others, proportionally; this differs from CSS, which shrinks them all
together and makes a short label next to a long text wrap.

Whatever scrolls does not hold back its surroundings: a node's minimum (`minWidth` for rows,
`minHeightAt` for columns) ignores the content of descendants that scroll or clip, so a
column with a `Scroll grow={1}` inside shrinks without `minHeight={0}` (in CSS this calls
for `min-height: 0`). In height, only what scrolls vertically (or clips) gives way; a `Scroll
horizontal` keeps its height. Whether a subtree can shrink (`shrinks()`) is only asked when a
row or column needs to shrink, with a per-layout cache, so the ordinary frame does not pay
for it.

**Height that depends on width.** Wrapping text changes height with the width, so the size
comes in two steps. `intrinsic(node)` gives the natural size (text in the fewest lines) and
sets `wraps` when there is wrapping text in the subtree. `heightAt(node, width)` gives the
height at that width: in a column, each child's width is known beforehand (`align`) and the
height comes from it; in a row, the widths come from flex (`mainSizes`) and the heights from
them. To avoid paying for this across the whole tree, `heightAt` returns the natural height
when there is nothing that wraps or when the given width covers the natural one (with more
space, nothing wraps). A `Text` only declares itself "wrappable" (`minContentWidth`) if it has
a space or `maxLines`. The minimum width (`minWidth`) is computed only when a row needs to
shrink. Measured on 2026-10-12 in the same session: layout of `bench` (1000 changing texts)
2.5 → 2.7 ms and of the 500-row table 2.5 → 2.7 ms per frame; the first version, without
these shortcuts, cost 7.9 and 4.4 ms.

**`aspectRatio`** joins the same machinery: a box with a ratio and no fixed size sets `wraps`
and also `fluid` (propagated up like `wraps`), because past its natural width its height
keeps growing, so `heightAt` must not take the "wide enough" shortcut. `heightAt` returns
`width / ratio` (or the content's height, if taller; a measured node such as `Image` takes the
ratio as is). The other direction is resolved where the height is known: a fixed `height`
gives the width (`ratioWidth`, used by `crossSize` and grid cells), and a child stretched in a
row whose inner height is known takes `height * ratio` as its flex basis (`rowBasis`).

**Grid** (`direction: "grid"`, the `Grid` widget) is laid out by `layout.ts` itself, not by
chunking children into rows: `<For>` keeps inserting into one parent and a change only
reflows. Cells are `(inner - gaps) / columns` wide (`cellWidth`); each row is as tall as the
tallest `heightAt(cell, cellWidth)` (`gridRows`), the same function serving `intrinsic`,
`heightAt` and `minHeightAt` (with `heightFloor`). `placeGrid` stretches cells to their row
(`align`/`alignSelf` otherwise; an `aspectRatio` cell keeps its shape, as CSS grid does) and
culls through `place()` like any child; absolute children go through the shared
`placeAbsolute`.

**`wrap`** on a Row/Column reuses the flex code per line: `wrapLines` breaks the children at
the inner main size by their natural size (a line always takes at least one child), then calls
`mainSizes` for each line, so `grow` and shrinking stay inside it, and measures the line's
thickness (its thickest child). The same function serves `heightAt`, `minHeightAt` (with
`heightFloor`) and `placeWrapped`, which applies `justify` and `alignSelf` inside each line and
stacks lines from the start, `rowGap` apart (no `align-content`). A wrapping Row is one more
"height depends on width" node: naturally a single line (`wraps` set, so `heightAt` keeps its
"wide enough" shortcut), shrinkable down to its widest child (`shrinks()` reports SHRINKS_X).
A wrapping Column breaks at the height it is placed with; its natural width is only known for
a fixed `height`. Overflow is checked per line along it (only a child longer than the line
overflows) and once across, for the stacked lines. Nodes without `wrap` take none of these
paths (dashboard table, 500 rows: layout 2.77 → 2.79 ms/frame, within noise).

**`margin`** lives only in the parent's arithmetic: a node's box (`x`, `y`, `width`,
`height`) stays its border box, so painting and hit testing never see it. Every function that
sums or compares children adds their margins (`intrinsic`, `heightAt`, the floors of
`minWidth`/`minHeightAt`, `gridRows`, `wrapLines`); `mainSizes` runs flex on outer sizes
(basis, `grow` clamps and shrink floors include the margin, as in CSS) and returns the box
sizes; `crossSize` takes the cross margins out of the room, so a stretched child fits inside
them; placement adds the start margin before a child and the end margin after it. Absolute
children add theirs to the edge distances (`absoluteSpan`). Without a margin, the helpers
return shared zeros and `mainSizes` skips its extra array (dashboard table, 500 rows: layout
2.73 → 2.78 ms/frame, within noise).

The wrapping itself lives in `render/text-wrap.ts`: greedy, at spaces, like CSS's
`overflow-wrap: normal` (a word longer than the line overflows). Word widths are summed
instead of measuring the whole line again; a line that fits whole is measured only once.
Its "…" truncation is also exported as `truncate()`, which `<Canvas>`'s `g.text(..., { maxWidth })`
uses. `underline` needs no opcode: `Text` paints a RECT under each line it drew, as wide as
that line, a third of the descent below the baseline (ascent from the font metrics), with a
thickness of `max(1, fontSize / 14)` and both snapped to device pixels so it stays sharp.

**Fonts: weights, italics, families, features, letter spacing.** `inheritedFont()`
(`widgets/props.ts`) resolves a node's `FontStyle` (`{ weight, italic, letterSpacing, family,
features, variations }`; the nearest `fontWeight` or `bold` up the tree gives the weight) and
keeps the same object while nothing changed, so the per-node layout caches compare it by
identity. The measurer receives it, and the TEXT command carries it as a font id (`weight * 2
+ italic`, `fontId()`), the spacing, and a *spec*: family list, features and variations
joined by U+001F (`fontSpec()`, "" when all are empty), sent once per frame in `texts[]`.

`core/faces.c` turns (spec, font id) into a *style*: specs are interned and parsed once (the
CSS family list, with quotes and generic names; features and variations with HarfBuzz's
parsers, which take CSS syntax), and each style resolves, the first time it is used, to a
stack of faces: for each family of the list, the app's faces registered under that name (CSS
font matching: slant first, then the weight rules; faces with the same descriptors all join,
in registration order) or else the installed family (`nb_platform_font_path(family, ...)`,
NULL when not installed; generic names always resolve), then the UI font. A cluster's face
is the first of the stack that has its base, else the platform's fallback after the list's
first system family (cached per codepoint and style). A style whose first face has all of
printable ASCII keeps the ASCII fast path. Registering a font drops styles and fallbacks
(and TS bumps the metrics generation, which empties the measurer cache and re-wraps text).
What the platform answers for an installed family at a weight and slant is remembered (256
lookups), since fontconfig costs far more than the rest of resolving a style.

**Eviction.** Every distinct weight of a variable font and every distinct `fontVariations`
string is a face of its own, so animating either makes one per frame. At the start of each
measure or draw call (the only point where nothing holds a face), when fewer than 32 of the 255
face slots are free, the least recently used faces of variable files are evicted down to half
the table (never face 0, the UI font; the faces of static files are bounded by the files): text.c
closes their sized fonts, styles that used one resolve again on their next use and fallback
slots that pointed at one are looked up again. A reused slot gets a new generation, which is
part of the glyph cache key, so glyphs of the old face just stop matching (their atlas pixels
stay until the next reset, so quads already emitted in the frame are still right). Variation
lists (256) are referenced by specs too: when they run low, every spec and style is dropped,
faces are evicted and the lists no face uses are freed. `fontStats()` in the addon reports the
live entries for tests.

A face is a file (a path, or the bytes of a registered font, copied once and shared by all
its faces) drawn one way: `oblique` (italic asked, none in the family: a FreeType shear),
`embolden` (600+ asked of a lighter face: `FT_Outline_Embolden` by 1/24 em before rendering,
advances unchanged; for system fonts fontconfig's `embolden` says so), and, for a file with
variation axes, its coordinates: the named instance's, then `wght` = the weight, then the
spec's variations. A variable font is opened at its base index (HarfBuzz ignores the
coordinates FreeType gives a named instance) and gets one face per weight and variation list;
a static file is shared by every weight that maps to it. Letter spacing is added in `layout_runs` after the
last glyph of every HarfBuzz cluster, the last one included, so `width(a + b) = width(a) +
width(b)` keeps holding: wrapping sums word widths and selection measures prefixes, and both
stay exact. A nonzero spacing turns `liga`/`clig` off, as CSS does.

**Culling:** each node that clips (`Scroll`, `clip`, the `Window`) narrows the visible region
passed to its children. A child entirely outside it (counting its shadow) gets its own box,
so that the content height and the scrollbars stay correct, but is marked `culled`: its
descendants are not positioned, painted or hit-tested. In a 500-row table, only the ~15
visible ones reach painting and HarfBuzz. Limitation: a descendant that overflows the box of
a culled node (e.g., an absolute popup) disappears along with it.

The natural size of all children is still computed every frame, because the content height
depends on them; each `Text` keeps its last measurement (text, size, font) so this does not
cost a trip to the global cache. Incremental layout is on the
[roadmap](ROADMAP.md).

### Scrolling

A node scrolls vertically (`scrollable`), horizontally (`scrollableX`) or both. `<Scroll>`
is a column that scrolls vertically; `<Scroll horizontal>`, a row that scrolls horizontally;
`<Scroll horizontal vertical>`, a column that scrolls both ways. Along the axis it scrolls on,
the node does not shrink its children (main axis) and, on the cross axis, it gives each child
at least the visible space without squeezing it below its content (`floor` in `crossSize`,
like CSS shrink-to-fit): in a grid that scrolls on both axes, a table row keeps its natural
width and a paragraph wraps at the visible width. `place()` measures
`contentWidth`/`contentHeight` (children + padding), clamps `scrollX`/`scrollY` to the content
and offsets the children; culling already worked on both axes.

`render/scrollbar.ts` is the scrollbar geometry, used by painting and by input:
`overflows`, `scrollTo`/`scrollBy` (clamped) and `scrollbar(n, axis)` with the band that
catches the pointer plus the track and the thumb. The bars are drawn on top of the content
(as in GTK and macOS) and take no space in the layout; with both, each one stops before the
corner. Under the pointer, or while dragged, the bar thickens and shows the track
(`UINode.activeScrollbar`, which input sets and painting reads; colors and sizes in
`theme.scrollbar`).

In input, the hit test returns the scrollable node itself when the point is in the band of a
bar that has something to scroll (14 px at the edge): the content underneath gets neither
hover nor click, but with nothing to scroll there is no band. Pressing the thumb starts a
drag with capture (the position follows the pointer in the content/track ratio, even outside
the bar); pressing the track advances one page (87.5% of the visible area). Pressing the bar
does not change focus. The wheel delivers each axis to the nearest ancestor that scrolls on
that axis and has something to scroll (the touchpad scrolls both at once); with Shift, the
vertical wheel becomes horizontal (the C sends the modifiers in the scroll event). Keys that
no `onKeyDown` stopped scroll the `Scroll` around the focus, or under the pointer: arrows
40 px, PageUp/PageDown one page, Home/End to the end. The chain of what can scroll stops at a
modal layer, so neither the wheel nor the keys reach what is behind an `<Overlay modal>`,
even if the focus was left back there.

`scrollIntoView()` only marks the node (`revealRequests`); the next `layout()` resolves it,
after positioning the tree. A descendant of a `culled` node has a stale box, so first the
layout repositions the outermost `culled` ancestor with no visible region (and repeats for
whatever clips inside it) until the node's box is valid. Then it scrolls each surrounding
`Scroll`, from the inside out, by the minimum needed to show it (its start, if it does not
fit), and positions everything again with the new positions. This costs a second `place()`
only in frames with a pending request. The walk up stops at the overlay: an element in an
`<Overlay>` does not scroll what is behind the layer.

Measured on 2026-10-12, without a window (500-row table with fake metrics, `layout()` and
`paintTree()` 3000 times while scrolling, 5 runs alternating with the previous version):
layout 0.544–0.585 → 0.558–0.613 ms (median 0.560 → 0.572, within the noise), painting
0.032–0.037 → 0.033–0.037 ms, `pointerMove` 0.94–1.06 → 0.80–0.94 µs. The hit test got faster
because it tests each child's box before descending (a list has many children off screen).
Computing every frame whether each subtree can shrink cost ~7% of the layout; that is why
`shrinks()` only runs when something needs to shrink.

### Overflow warnings

After placing a container's in-flow children, `place()` calls `checkOverflow()`
(`src/render/overflow.ts`). It compares what the children need along the container's
direction (their sizes after shrinking, so wrapping text and `grow` children have already
given up what they can) with the inner size, and across it the widest child with the inner
cross size; an axis the container scrolls on is skipped. That is two comparisons per
container in the ordinary frame, and culled subtrees are never visited. Only when something
overflows does it look for the first child that reaches past the visible region `place()`
was given (narrowed by every clipping ancestor and the window), then for the nearest
clipping node that cuts it off: a `Scroll` along that axis means the excess is reachable by
scrolling, so nothing is reported; otherwise a warning names the container, the child, the
clip (or "the window") and the numbers, and `UINode.overflow` holds the excess for
`debugTree()` (`[overflow +42]`). Spilling content that stays visible is not reported.

Warnings are collected per root for the last layout (`overflowWarnings(root)`), never
printed by layout itself: tests read them with `layoutWarnings()`, and `run()` prints each
one once per session (keyed by the container's path from the root, the child and the axis)
when not in production (`NODE_ENV=production` or a packaged executable, detected by Bun's
`/$bunfs/` in `import.meta.url`). Measured on 2026-10-12 without a window (sidebar + 1000-row
table, 400 layouts x 5 runs alternating with the check disabled): 1.10–1.17 ms both ways,
within the noise. With a window (`NB_STATS`, alternating runs): `bun run bench` layout
1.67–1.68 → 1.60–1.65 ms; `bench:dashboard` (500-row table) 2.52–2.70 → 2.61–2.75 ms (means
2.60 → 2.69), overlapping ranges.

### Overlays

`<Overlay>` leaves a zero-size marker (`position: "absolute"`) where it was declared and
creates the layer separately: `layer.parent` is the marker, but the layer is not its child.
That way it inherits context, ownership and text style from that point, and events bubble up
through the marker's ancestors (like React's portal). Live layers are kept in a global set
(`overlayLayers`, in creation order); on each `layout()`, the root takes its own
(`root.layers`) and positions them after the tree, when the anchors already have a box. An
anchored layer disappears if the anchor left the tree or is in a `culled` subtree (the box
would be stale). Painting draws the layers after the tree, clipped by the root's first child
if it clips (the `Window`'s corners). The hit test starts with the layers, top to bottom; a
layer that covers the window is only a target if it is `modal`. Registration happens before
the children run, so an overlay opened from inside another one sits on top of it. A layer
without an anchor may take an `inset` from the window's edges: what it leaves uncovered (a
title bar) is hit-tested in the tree below even under a modal, and a press there does not
dismiss it.

`translateX`/`translateY` are added to the node's position in `place()`, after flex: the
children are positioned from it, and hit testing, culling and `ref` see the offset position
with nothing special. `opacity` is a multiplier in the `CommandBuffer` (`opacity`),
accumulated by `paintTree` on the way down and applied to the alpha of every emitted color.
It is cheap and does not need the C, but it is not group opacity: that would require drawing
the subtree into a separate texture.

## Command buffer

Painting does not call the C node by node: `render/paint.ts` writes everything into a single
`Float32Array`, which crosses the N-API boundary once per frame, along with an array of texts.

| Op | Code | Following floats |
|---|---|---|
| RECT | 1 | x y w h · r g b a · tl tr br bl (corner radii) · borderWidth · br bg bb ba |
| TEXT | 2 | x y(line top) size font id (weight * 2 + italic) · r g b a · index into `texts[]` · letterSpacing · spec index into `texts[]` (-1: none) |
| CLIP | 3 | x y w h · tl tr br bl (scissor + innermost rounded mask) |
| UNCLIP | 4 | (none) |
| SHADOW | 5 | x y w h · r g b a · tl tr br bl · blur |
| IMAGE | 6 | x y w h · u0 v0 u1 v1 · r g b a (tint; a = opacity) · radius · image id |
| LINE | 7 | x0 y0 x1 y1 · width · r g b a · start cap, end cap (0 butt, 1 round) |
| TRIANGLES | 8 | n · r g b a · n × (x y coverage) |
| ARC | 9 | cx cy · outer radius, inner radius · start, sweep (radians; 0 = up, clockwise) · r g b a |
| GRADIENT | 10 | x0 y0 x1 y1 · n · n × (offset r g b a): fills the next op (see below) |

The format exists in three places that must stay in sync: `native/include/nb.h`,
`src/render/paint.ts` and `native/core/render_gles2.c`.

## Rendering

`render_gles2.c` uses a single shader and a single vertex format. Rectangles with borders and
rounded corners, shadows and glyphs all become triangles in a single batch. Corners and
shadows are computed in the fragment shader with distance functions. A rect or shadow carries
one radius per corner: the top left one in the radius slot, the other three in the `uv`
attribute (unused by those modes; a vec3, so the vertex is 20 floats), and the shader picks the
radius of the quadrant the fragment is in. The rounded clip mask is a `vec4` uniform the same
way. One more float per vertex cost nothing measurable (`bun run bench` MODE=all N=2000,
2026-10-14: native 0.43–0.48 → 0.44–0.45 ms/frame; commands 21 → 23 KB). An `Image` keeps one
radius; with different corners the widget draws it inside a rounded clip.

Colors are composited in **premultiplied alpha** (`GL_ONE, GL_ONE_MINUS_SRC_ALPHA`), and the
border is drawn over the background, as in CSS. Blending in "straight" alpha produces dark
artifacts at the corners. The vertex shader premultiplies each vertex color, so anything that
varies across a shape (gradients, antialiasing coverage) is interpolated in premultiplied space.

**Color spaces.** `run()` asks the addon for a Display P3 surface. On Wayland, `wayland.c` binds
`wp_color_manager_v1`; when the compositor supports parametric descriptions, the `display_p3`
primaries, the gamma 2.2 transfer function (sRGB's also works) and the perceptual intent, it builds
that image description, waits for `ready` and sets it on the surface before the first commit.
Gamma 2.2 is what compositors assume for untagged surfaces, so an sRGB color converted to P3 looks
the same as in every other window. `open()` returns the space the surface took (X11: always
sRGB) and `run()` hands it to `setOutputColorSpace` (`render/color.ts`). From there on
`parseColor` encodes every command color for that space (hex is sRGB, converted through linear
light; `color(display-p3 ...)`/`oklch()` past the target are clipped), so the renderer draws
command colors as they come. Textures are the exception: each image carries its own space
(`nb_image_create`), the color emoji atlas and SVG icon bitmaps are sRGB, and when a texture's
space differs from the target's the fragment shader converts each texel (`texel()`: unpremultiply,
decode, 3×3 matrix, encode, premultiply), told which way by the vertex's free `params.y`, so
mixing spaces does not split the batch. One-color icons are white bitmaps tinted by the command
color, so they get P3 tints for free. Blending stays in the encoded values, as browsers do.

Images get their space from the file (`image/icc.ts`): PNG cICP/iCCP, JPEG APP2 (reassembled
across segments), WebP ICCP, and libheif's nclx or ICC for AVIF/HEIC. CICP codes and ICC
matrix/TRC profiles that are sRGB or Display P3 (colorants within 0.004 after s15Fixed16
rounding, sRGB curve) tag the pixels as they are; any other RGB matrix/TRC profile is converted
to Display P3 on the CPU while decoding (256-entry linearization per channel, one 3×3 matrix
through XYZ D50, a 4096-entry encode table). Values checked against LittleCMS.

Screenshots render to an sRGB target by default; `colorSpace: "display-p3"` paints and renders
for P3 and `encodePng` tags the file with cICP and a v4 Display P3 ICC profile that `writeIcc`
builds (ImageMagick and LittleCMS read it back as Display P3).

`deepColor` asks `wayland.c` for a 16-bit float RGBA config (`EGL_EXT_pixel_format_float`). The
10-10-10-2 configs are skipped: a 2-bit alpha would band the window's shadow and rounded corners.
The buffers are GPU memory (process RSS/PSS did not move: dashboard bench, 2026-10-14, 8-bit
170/111 MB vs float 169/109 MB, fps 107–110 both), twice the 8-bit size, so it is opt-in.

**Gradients.** A `GRADIENT` op is a prefix: it fills the op right after it (RECT, LINE,
TRIANGLES, ARC; paint.ts sends that op in white, which multiplies the gradient). While it is
active, `push_vertex` collects each triangle and cuts it along the stop lines
(Sutherland-Hodgman on `t`, the position projected on the gradient line, interpolating all 20
vertex floats); each piece's vertices are colored from the two stops around it. Between two
stops a linear gradient is affine in position, so per-vertex colors are exact, at any angle and
with any number of stops, and the shape keeps its own distance function: rounded corners,
borders, line caps and arc edges work unchanged. Beyond the ends the end colors continue. The
style form (`{ linear, angle }`) becomes a line in `render/gradient.ts` with the CSS length
(`|w sin a| + |h cos a|`), so the far corners land on 0 and 1. Radial gradients are not
affine and would need a shader mode; they are not implemented.

Text: HarfBuzz does the shaping (accents, ligatures, kerning), FreeType rasterizes each glyph
once and stores it in a texture atlas. Each face is one `FT_Face`, opened while some size uses
it; each pixel size is an `FT_Size` on it with its own HarfBuzz font (64 kept, least recently
used out), activated before shaping or loading glyphs, so a new size (an animated `fontSize`)
does not read and parse the file again. The atlas is one 2048 px A8 texture cut into four
1024 px pages, each filled shelf by shelf; when all are full, the least recently used page is
wiped (its generation bumps, so glyph slots that pointed into it rasterize again), never one a
glyph of the current frame came from unless every page did, so quads already emitted in the
frame keep their pixels (`nb_text_begin_frame`, called by `nb_render_frame`, counts frames).
Only the rows that changed are uploaded (`glTexSubImage2D`), the whole texture once per GL
context. A bitmap larger than 512 px on a side (display sizes: `fontSize` around 700 at scale 1)
is box-filtered down to 512 px and the quad stretches it back, so one glyph never fills or
overflows a page; the atlas is sampled with `GL_LINEAR`, which at the usual 1:1, pixel-aligned
quads equals `NEAREST`. The measurements the layout asks of the C are cached on the TypeScript
side.

**Font fallback.** A string the first face of its style cannot fully draw is cut into clusters (a base
codepoint plus its combining marks, variation selectors, skin-tone modifiers, ZWJ-joined
parts, tag sequences; regional indicators in pairs), so an emoji sequence never splits across
fonts. Each cluster picks a face by its base: one with emoji presentation (emoji planes, the
BMP `Emoji_Presentation` list, or a U+FE0F, ZWJ or skin tone in the cluster; U+FE0E forces
text) asks for a color font first (one of the style's, then the system's); otherwise the
first face of the style that has the glyph (`FT_Get_Char_Index`), then the platform's
fallback, `nb_platform_font_fallback`. On Linux that is fontconfig's `FcFontSort` of the
list's first system family (the UI font's pattern without one, or `emoji` with
`color=true`), computed once and walked for the first font whose charset has the codepoint.
The answer is cached per codepoint and style, so fontconfig is asked once per character the
fonts lack, and up to 255 faces stay loaded (variable instances are evicted, see above; past
that, the closest face of the same file, or the UI font). Consecutive clusters
with the same face become a run, each run is shaped with its own font and the pens
concatenate. `measure` and `draw` walk the same runs, so layout and painting agree. Strings
that are pure ASCII skip all of it when the first face has every ASCII glyph (one run, no
decoding). Ascent and descent always come from the style's first face, so a fallback glyph
never changes the line height.

**Color emoji.** Noto Color Emoji is a CBDT font: bitmaps at fixed strikes (109 px), no
outlines. For such a face the closest strike is selected with `FT_Select_Size`, HarfBuzz scales
the advances from the font's own tables (`hb_font_set_scale` to the requested size) and each
glyph is loaded with `FT_LOAD_COLOR` as premultiplied BGRA, box-filtered down to its final
pixel size once, and stored in a second atlas, RGBA, allocated on the first color glyph.
COLRv0 and sbix fonts go through the same path (FreeType renders them to BGRA); COLRv1
(gradients) is not rendered by FreeType, so such fonts show their monochrome fallback glyphs.
The renderer draws those quads with their own mode: the shader samples the color atlas
(texture unit 2) and multiplies by the text color's alpha only, so `color` does not tint an
emoji but `opacity` fades it. The color atlas is 1024 px with four 512 px pages and a 256 px
cap (emoji strikes are 109 to 136 px, so little is lost), paged like the alpha one; both are
reset together only when the glyph slot table (8192) fills.

Images: PNG, JPEG and WebP are decoded in TypeScript to RGBA (`src/image/png.ts` with the
runtime's zlib, `jpeg.ts`, `webp.ts`). All three reproduce the output of the reference
libraries exactly: JPEG uses libjpeg-turbo's integer IDCT, "fancy" upsampling and color
tables; WebP, libwebp's upsampling and fixed-point formulas. AVIF and HEIC would need an
AV1/HEVC decoder, so they go to the OS: `nb_platform_decode_image` (platform contract) uses,
on Linux, `libheif` loaded with `dlopen`. Its API has only handles and functions, so the few
declarations in `codecs.c` work for any version with the soname `libheif.so.1`, and the
header is not needed to compile. `createImage` copies the pixels to the C, which
premultiplies them and creates the texture on the first frame that draws it (there may be no
GL context before that). Each image switch within a frame closes the batch, so many different
images cost one draw call each. `src/image/source.ts` shares one decode among all `<Image>`s
of the same file (by path) and releases the texture when the last one leaves the tree. An
image that fails to load prints a warning to the console and draws nothing.

Icons (`src/svg/`, on top of `src/geometry/`): the SVG becomes polygons in user space. Curves
and arcs are flattened with an error of 0.1 screen pixel, and each stroke becomes one polygon
per segment, join and cap, all with the same winding, so that a "nonzero" fill computes the
union without drawing twice where they overlap. A scanline rasterizer computes the exact
coverage horizontally, with 16 samples per pixel vertically. `<Icon>` rasterizes at the
physical size (logical size × scale), aligned to pixels. If all of the SVG's colors are
`currentColor`, it rasterizes in white once, and the color enters as a tint in the IMAGE
command: the shader multiplies the texels by it, and changing the color does not redo the
icon. The `fill` prop overrides the root `<svg>`'s fill in the style that `walk()` computes for
it (attribute and `style=""` alike), so only shapes that inherit it change; a `fill` color
makes the icon multicolor (rasterized with its colors, no tint). Rasterized bitmaps are cached
by SVG, pixel size, stroke width, fill and, for multicolor icons, color.

Drawing primitives (`<Canvas>`): each line segment is a rectangle oriented along the
segment; the shader receives the position in that frame of reference and computes the
distance to the segment (round or butt caps), from which the antialiasing comes. Arcs do the
same with the distance to an annular sector. Polygons are triangulated in TypeScript
(`src/geometry/triangulate.ts`, ear clipping) and get a 1-screen-pixel fringe whose coverage
goes from 1 to 0 (NanoVG's technique); the GPU interpolates the coverage and the result is a
smooth edge. All of this goes into the same batch as rectangles and text. `<Canvas>` records
the `draw` calls when a signal it read changes (or the size and scale change), already
converted into segments and triangles; painting only offsets that recording.

Charts (`src/charts`, imported from `@nodebuilderjs/core/charts`): `<LineChart>` and the
others are a `<Canvas>`. The children (`<Line>`, `<XAxis>`...) render nothing: since `jsx()`
only creates descriptions (`ElementDesc`), the chart reads the type and props of each child
to know what to draw, without instantiating them. Axis ticks follow d3's algorithm (1, 2 or
5 times a power of 10). They live in a subpath so that names like `Tooltip` and `Line` do not
collide with interface widgets; apps that do not import it ship nothing extra in the bundle,
and those that use it pay ~15 KB.

Coordinates: TypeScript works in logical pixels; the C multiplies by the screen's integer
scale (Wayland: `preferred_buffer_scale`; X11: `Xft.dpi / 96`).

### Offscreen rendering (screenshots)

`renderOffscreen(width, height, scale, commands, texts)` runs the same `nb_render_frame` as a
window, into a framebuffer object instead of a window surface, and reads it back. The
platform contract has `nb_platform_offscreen_begin(w, h)`: on Linux (`offscreen.c`) an EGL
display that needs no display server (`EGL_PLATFORM_SURFACELESS_MESA`, else the first
`EGL_EXT_platform_device`), a GLES2 context with no surface (`EGL_KHR_surfaceless_context`;
a 1x1 pbuffer otherwise) and an RGBA8 texture attached to an FBO (RGBA8 renderbuffers are an
extension in GLES2). The context is created on the first shot (~30-140 ms, driver dependent)
and kept; each shot after that costs a few ms plus layout and paint. `nb_render_read_pixels`
flips the rows (GL reads bottom-up) and un-premultiplies: the output has **straight alpha**,
like `decodeImage` and PNG. Uncovered pixels stay transparent, as in the window.

The renderer's GL objects (program, glyph atlas, image textures) live in whichever context
created them, so a process uses either a window or the offscreen renderer: `open()` after a
shot and a shot with a window open both throw.

On the TypeScript side, `captureTree` (`src/runtime/screenshot.ts`) swaps in, for the shot,
real text metrics at the shot's scale (`measureText(..., scale)`), the display scale and the
native image backend, lays out, paints, renders, and then puts the previous ones back (and
lays the tree out again with them). The headless image backend of tests keeps the decoded
pixels (`keepsPixels`), and a source painted earlier by another backend is uploaded again,
so an icon a test already painted still shows up. `screenshot()` (testing) wraps it;
`run()` checks `NB_SCREENSHOT` and calls `screenshotApp` instead of opening a window: it
mounts the app as `run()` does, at the `<Window>`'s size (or `NB_SCREENSHOT_WIDTH/HEIGHT`),
applies `NB_SCREENSHOT_THEME`, runs frames on a simulated 16 ms clock until no
`requestAnimationFrame` callback is pending (at most 120, or exactly `NB_SCREENSHOT_FRAMES`),
waiting one `setImmediate` per frame for the app's promises, renders at `NB_SCREENSHOT_SCALE`,
writes the PNG (`src/image/png-encode.ts`: Sub/Up filter per row, zlib) and exits.
`nodebuilder screenshot` (`cli/screenshot.ts`) only sets those variables and spawns the app.

## Events and threads

Bun does not implement libuv, so the addon cannot use it. Instead:

1. A backend thread only waits: on Linux, a `poll()` on the display socket, the key-repeat
   timer, the clipboard pipes and a control eventfd. The fd list is handed over by the JS
   thread on every iteration (`backend->fds()`); when it changes outside of it (a paste
   started), `nb_linux_pump_refresh()` wakes `poll()` through the eventfd to pick up the new
   list.
2. When something is ready, it calls `wake()`, and the core wakes the JS through a
   `napi_threadsafe_function`.
3. Back on the JS thread, `nb_platform_pump_process()` reads and dispatches everything (on
   Wayland, without blocking), and the events reach `runtime/app.ts` in a batch.

All reading, all dispatching and every GL call happen on the JS thread. The extra thread
never touches shared state beyond waking the JS.

On the TypeScript side, `runtime/input.ts` turns raw events into interface events: hit
testing (ignoring `culled` nodes), hover with enter and leave, cursor, resize edges, focus,
click and double click, pointer capture while a button is held, scrolling (wheel, bars and
keys; see "Scrolling") and keyboard with Tab. Whatever belongs to the window (move, resize,
cursor, clock) goes through an `InputHost` interface; `run()` wires it to the addon, and the
tests (and `interact()` from `@nodebuilderjs/core/testing`) use a windowless host.
The hit test walks siblings in paint order (`stacked()`: by `zIndex`, then child order, the
same order `paintTree` draws them), top first. Like CSS overflow, it also descends into
children outside the parent's box when the parent does not clip or scroll, so the part of an
absolute badge that sticks out is clickable; the price is that a miss walks the visible,
non-clipped subtrees instead of only the child that contains the point (`pointerMove` in the
500-row table: ~1.1 → ~3.9 µs, still far below a frame).
The testing helpers that target a node (`click`, `interact().press`...) first check what the
hit test would see: the node and its ancestors are not `culled`, and its center lies inside
every clipping or scrolling ancestor and the window. Otherwise they throw instead of letting
the event miss silently.

`createInput` registers focus on the root (`root.focusHost`); that is how a `ref`'s
`focus()` and `blur()` reach the input. A `focus()` made while the widget is being created
(still outside the tree) lands when the insert that creates it ends (the `onMount` queue, see
Reactivity). Keys bubble from the focused node; with nothing focused they start at the
topmost modal layer, or else at the root's top nodes (the `Window`), so a window-level
`onKeyDown` sees everything nothing below took. A control's own key handler is chained after
the app's (`ownHandler`), and the app's `stop()` skips it. Key releases (`onKeyUp`) take the same
path. Key names are normalized once, in `createInput` (`normalizeKey`): xkb aliases
(`ISO_Left_Tab`, `Prior`/`Next`, the keypad's navigation keys) become one name, and with Ctrl
or Alt a letter is lowercase; widgets compare only the plain names. Every input event carries the
modifiers (the addon reads xkb's state on Wayland, the event's `state` on X11); a right press
ends with the innermost `onContextMenu`, and the Menu key or Shift+F10 opens the focused node's
at its bottom-left corner.

`onResize` is collected during `layout()` and delivered in a batch after the whole tree has
been positioned, so that the handler can change state (and the tree) without disrupting the
layout in progress. If the handlers invalidated anything, `layout()` places the tree again
(at most two extra passes), so nodes they create have boxes before the frame is painted (and
in a test, right after `relayout()`); a handler still changing sizes after that is reported
among the layout warnings as an `onResize` loop.

### Rich text

`RichText` measures each span's words and spaces once per text and font (the same
`measureText` as `Text`), then breaks lines greedily over those pieces, so a line may change
font mid-way; consecutive pieces of one span become one TEXT command. A line is as tall as its
tallest span, and each run is drawn at `line ascent - its ascent`, so they share a baseline.
Links are spans with `onClick`: the node takes `onClick` only when one exists, runs the span's
under the pointer and hands any other click to the nearest ancestor with an `onClick`.

### Text editing

`TextField` and `TextArea` share `widgets/text/text-edit.ts`. The value belongs to the app (`value`
+ `onInput`); an `EditSession` keeps what lives around it: the selection (`anchor`/`focus`, in
code points), an undo stack of `{ value, anchor, focus }` snapshots (consecutive typing or
deleting pushes one; a caret move, a space or a paste starts a new step) and the last value it
emitted, so a different value means the app set it (the history is dropped, the selection
clamped). `editKey` handles the keys every text input shares and asks the widget only for line
navigation (`LineNavigation`: line bounds, the position above or below at an x, a page), which
`TextArea` answers from its wrapped lines; a single-line field leaves it out. `TextArea` wraps
with `wrapText(..., { breakWords: true })` at its content width, measures as height-for-width
at any width (`fluidMeasure`), draws only the lines in `visibleRegion`, and after a change
asks `scrollIntoView` for the caret's region, so a `Scroll` around it follows on the next
layout; a height of its own that cuts the content makes it scroll itself in paint.

## Wayland and X11

The backend is chosen at runtime: Wayland if `WAYLAND_DISPLAY` is set, otherwise X11 if
`DISPLAY` is set (`NB_BACKEND=wayland|x11` forces one). Both implement the same vtable
(`native/platform/linux/linux.h`), so any new window feature goes into both.

The window always draws its own decoration (title bar, buttons, resize edges). The title bar
is a node with `dragRegion`: `runtime/input.ts` turns a left press on it into an interactive
move (`InputHost.move`) and a double click into `toggleMaximize`, unless a node between it and
the pointer took the press (clickable, focusable or with `onPointerDown`). Custom title bars
(`decorations={false}`) use the same path. On X11, the
window manager's decoration is turned off and move/maximize use EWMH messages; without a
compositor, the window loses transparency and rounded corners.

**Window icon.** `src/image/icon.ts` turns `<Window icon>` (or the default, the same SVG
`nodebuilder package` installs) into square straight-alpha images at 16–256 px: an SVG is
rasterized at each size, a raster image is centered and area-averaged in premultiplied alpha,
never scaled up. `run()` sends them once after `open()` (`nb_platform_set_icon`). Wayland uses
`xdg-toplevel-icon-v1` (vendored in `protocols/`): one memfd `wl_shm` pool, premultiplied
ARGB8888 buffers kept alive until the icon is replaced or the window closes, then a surface
commit (`set_icon` is double-buffered). Without the protocol nothing is sent and the compositor
falls back to the `.desktop` that matches the app id. X11 writes `_NET_WM_ICON`.

**Hiding** (`windowControls.hide/show`, `nb_platform_set_visible`): Wayland attaches a null
buffer, which unmaps the toplevel and discards its attributes, so `wayland.c` keeps the title,
app id and icon and sends them again before the map's first commit; the compositor's configure
then makes JS draw. A pending frame callback is dropped (none comes while unmapped) and
`end_frame` refuses to swap while hidden (a buffer would map it without a configure). X11
withdraws the window (`XWithdrawWindow`, so it leaves the taskbar) and maps it again; MapNotify
sends the configure. In JS, hiding clears `configured`, so nothing renders until that configure.

## D-Bus and the system tray

`src/dbus/` is a D-Bus client in TypeScript, on `node:net` (no libdbus, nothing in C, no fd in
the pump): `wire.ts` marshals values by signature and frames messages (writes little endian,
reads both), `connection.ts` does the EXTERNAL auth, `Hello`, calls with replies, signal matches
and exported objects (methods, read-only properties with `PropertiesChanged`, introspection).
Tests run against `test/desktop/fake-bus.ts`, a bus in the test process on a temp unix socket.

`src/tray/` serves a StatusNotifierItem at `/StatusNotifierItem` and its menu
(`com.canonical.dbusmenu`) at `/MenuBar`, under the name `org.kde.StatusNotifierItem-<pid>-<n>`,
and registers it with `org.kde.StatusNotifierWatcher`; a `NameOwnerChanged` of the watcher (the
panel restarting) registers it again. `createTray`'s options are read in effects: a change
updates the state and emits `NewIcon`/`NewToolTip`/`NewTitle` or `LayoutUpdated` (with a new
revision; the menu is renumbered depth-first on each change). Handlers run in a microtask,
batched, outside the D-Bus dispatch, so their errors surface like any event handler's. Only
`run()` points trays at the session bus (`setTrayBus`): in tests and screenshots `createTray`
connects to nothing and `available()` stays false.

### Clipboard

Text only, through the `nb_platform_clipboard_write/read` contract. Reading is asynchronous on
every OS (the content belongs to another program): `readClipboard()` requests it, and the
answer arrives as a `clipboard` event, which `runtime/clipboard.ts` delivers to all pending
reads. When the content is ours, the answer comes back immediately, without going through the
server.

- **Wayland:** copying creates a `wl_data_source` (`text/plain;charset=utf-8`, `UTF8_STRING`...)
  and calls `set_selection` with the serial of the last key press or click; each paste in
  another app sends a pipe, which we write to without blocking (POLLOUT on the pump thread).
  Pasting asks the selection owner to write into a pipe of ours, read in chunks until EOF (up
  to 64 MB). The compositor only reports the selection while we have keyboard focus. Writing
  to a closed pipe raises SIGPIPE: if nobody handles it, the backend starts ignoring it (Node
  already does this).
- **X11:** `CLIPBOARD` selection. Copying means becoming the owner and answering
  `SelectionRequest` (`TARGETS`, `UTF8_STRING`, `TEXT`, `STRING`), with a temporary error
  handler because the other program may vanish midway (Xlib's default handler exits the
  process). Pasting is `XConvertSelection` + `SelectionNotify`, with the INCR protocol for
  large texts (chunks via `PropertyNotify`). Sending with INCR is not implemented: texts above
  the maximum request size (~16 MB with BIG-REQUESTS) are refused.

## Diagnostics (`nodebuilder doctor`)

`cli/doctor.ts` runs a list of checks over injected probes (`DoctorProbes`), so every check is
tested with fakes; `systemProbes()` is the real machine. The order matters because the report
is most useful when things are broken:

1. **Without the addon** (plain TypeScript): Bun against `engines.bun`; which addon file
   `loadNative()` would pick (the same candidates) and, for the npm package, that its version
   matches core's; the glibc the addon needs, read from its ELF `.gnu.version_r` section
   (`elfGlibc` in `cli/package/native.ts`, also used by packaging and `npm:build`, so `objdump`
   is not needed), against the system's (`process.report`); the sonames `ldd` cannot find,
   mapped to their package through `SYSTEM_LIBS` (`cli/package/common.ts`, the same table the
   `.deb`/`.rpm` dependencies come from); libheif via the library directories or `ldconfig -p`.
   A failure here skips the native checks instead of loading an addon that would throw.
2. **With the addon:** `diagnostics()` (`addon.c`) returns the FreeType and HarfBuzz versions
   (`nb_fonts_versions`; both diagnostics functions in `faces.c` borrow a FreeType instance, since
   `nb_fonts_init` fails on a machine without fonts), `nb_platform_probe_display` (contract:
   connect to the display server `open()` would pick, in the same order, check what a window
   needs, load the keyboard's compose data for the locale, disconnect; Wayland checks for
   `wl_compositor` and `xdg_wm_base` and loads the xkb compose table, X11 opens XIM, which is
   what handles dead keys there), the UI font through `nb_platform_font_path` (its family read
   by FreeType) and the fallbacks for U+1F600 (emoji) and U+4E2D (CJK) through
   `nb_platform_font_fallback`, and the current GL context's strings. GL is tested by one 1x1
   `renderOffscreen`, or with `--window` by opening a window, drawing one frame and waiting for
   its frame callback (5 s timeout). The two can differ: on a hybrid laptop surfaceless EGL may
   pick the discrete GPU while the compositor's window uses the integrated one.

Each check has an id, a status (`ok`, `warn`, `fail`, `off` for an optional feature, `skip`), a
title, an optional detail and a fix (a command for the detected package manager, from
`/etc/os-release`). `--json` prints them as they are.

## Agent docs in apps (`nodebuilder agents update`)

`bun create` copies the template's `AGENTS.md` and `.agents/skills` into the app, where they
describe that version of the framework. Core ships the same files (`package.json#files`
includes them), and `cli/agents.ts` brings an app's copies to the installed version. It has
to tell a stale doc (replace it) from one the app's authors edited (keep it) with no record in
the app, since apps made before 0.4.1 have none: `cli/agents-history.json` holds the SHA-256 of
every version of every template doc ever committed (`scripts/agents-history.ts`, from
`git log --all -m --raw`; `-m` because a version can come out of a merge resolution, and the
old side of each change counts too), regenerated by `npm:build`. Content in the history is the
framework's; anything else is the app's. Docs at paths that left the template (skills renamed
from Portuguese) are removed when unedited, with their `.claude/skills` links. In `AGENTS.md`
the framework owns only the block between the `nodebuilder:begin`/`end` markers (its hash is
the block's); an `AGENTS.md` from before the markers that starts with a released version keeps
whatever follows it (the app's appended notes) after the new block. The doctor runs the same
plan in a folder that depends on `@nodebuilderjs/core` and warns when docs are behind.

## Porting to other systems

Everything OS-specific sits behind `native/include/nb_platform.h`: opening a window, pumping
events, cursor, font discovery, offscreen GL context. The core (`native/core/`) only includes Node-API, GLES2,
FreeType, HarfBuzz and libc. A new OS is a `native/platform/<os>/` folder with the
implementation of this contract and a `build.sh`. On Windows and macOS the planned path is
ANGLE (GLES on top of Direct3D/Metal) or a new `render_<api>.c` with the same interface.

## The web (`src/web/`, `nodebuilder web`)

The browser is one more implementation of the `Native` interface (`src/runtime/native.ts`);
nothing above it changes. `boot()` installs it with `useNative()` before the app is imported,
and calls `setWindowFrame(false)`: the page is the window, so `<Window>` builds no title bar,
border or corners and `<WindowControls>` no buttons (`hasWindowFrame()` in `runtime/app.ts`).

- **Rendering:** `web/renderer.ts` is `render_gles2.c` in TypeScript: the same vertex
  format, batching, clip stack and gradient cutting, against a `RenderDevice` that
  `web/gl.ts` implements with WebGL and the same GLSL (GLES2 shaders run unchanged in WebGL 1).
  The split keeps the command interpretation testable without a browser.
- **Text:** Canvas2D measures (`fontBoundingBox*`, so line heights match the font) and
  rasterizes whole runs, in their color, into an RGBA atlas drawn as color glyphs. Runs are
  cached by text, font, size, spacing and color; a full atlas is flushed and started again.
  The browser shapes, falls back and draws emoji.
- **Events:** DOM pointer, wheel and key events become `NativeEvent`s (`web/keys.ts` maps
  `KeyboardEvent.key` to the xkb names). `configure` comes from a `ResizeObserver` and
  `devicePixelRatio`, which may be fractional. After each render, a `requestAnimationFrame`
  plays the compositor's frame callback.
- **Node built-ins:** the build maps `node:*` to `web/shims/` (an import without a shim is a
  build error); `process` and `setImmediate` are inlined in `index.html`, before any module.
  `node:fs` reads from memory: the build lists the app's files in `assets.json` and `boot()`
  fetches them first, so synchronous reads (images, icons, fonts) keep working.
- **Images:** `boot()` has the browser decode every imported image (`createImageBitmap`,
  which applies the file's color profile); `image/decode.ts` is swapped for `web/decode.ts`,
  which returns those. Other bytes (made or fetched at runtime) load the TypeScript decoders,
  a chunk fetched on demand: until it arrives `decodeImage` throws an error carrying `retry`
  (a promise), and the image source decodes again when it settles (`image/source.ts`).
  `image/icon.ts` is swapped for `web/icon.ts`: a page has no window icon to rasterize.
- **Build:** `cli/web.ts` bundles a virtual entry (`await boot(); await import(app)`) with
  `Bun.build({ target: "browser", conditions: ["bun"], splitting: true })`: `app.js` and the
  shared `nodebuilder-*.js` start the page, the app's own chunk is preloaded while `boot()`
  fetches the files, and the decoders chunk only comes when something needs it. Tree-shaking
  leaves out whatever the app does not reach (an app without images has no decoders at all).
  The addon's `.node` requires stay external and are never called. The `todo` example starts
  with 41 KB of gzipped script.

## Loading the native core

`src/runtime/native.ts` looks for the addon in this order:

1. `native/build/<platform>-<arch>/nodebuilder.node`, which only exists in a checkout of the
   framework after `bun run build:native`;
2. the npm package `@nodebuilderjs/<platform>-<arch>`, installed as an optional dependency
   of `@nodebuilderjs/core` (only the one for your platform is downloaded).

"Not found" moves on to the next one; an addon that is found but fails to load (missing
system library, old glibc) is the error shown. Each path is a literal `require("...")`,
because that is what `bun build --compile` recognizes and embeds in the executable.

## Distribution

### npm packages

| Package | Contents |
|---|---|
| `@nodebuilderjs/core` | `src/` (Bun reads TypeScript directly), `lib/` (JS and types for Node), `cli/` (`nodebuilder` command) |
| `@nodebuilderjs/linux-x64` | only `nodebuilder.node`, built against glibc 2.34 |
| `create-nodebuilderjs` | `bun create nodebuilderjs` and the project template |

The binaries follow esbuild's pattern (one package per platform, with `os`/`cpu`), with no
install script, which Bun blocks by default. `bun run npm:build` generates everything in
`dist/npm/`.

### Packaged apps

`nodebuilder package` (in `cli/`):

1. takes the prebuilt addon (or, in the repository, builds a portable one in an Ubuntu 22.04
   container, to run on glibc 2.34+);
2. generates a **single executable** with `bun build --compile`: Bun runtime, app code and
   addon embedded (~91 MB, ~31 MB compressed);
3. assembles the install tree (`/usr/bin`, `.desktop`, icon);
4. writes the `.deb` and the `.rpm` directly in TypeScript (no `dpkg` or `rpmbuild`), and the
   AppImage with `appimagetool`.

The system libraries (Wayland, X11, EGL, FreeType...) are declared as package dependencies
and never embedded: every Linux desktop already has them.

## Measuring performance

```sh
NB_STATS=1 bun examples/bench/bench.tsx        # N=1000 MODE=one|all|static
NB_STATS=1 bun examples/bench/dashboard.tsx    # TAB=overview|table|logs|settings ROWS=500 CYCLE=30
```

`NB_STATS=1` prints every second: fps, time per frame (state, layout, paint, native), why the
frames happened (`why: inv 3 ev 2 raf 0`, see "A frame"), node count, command buffer size,
heap and RSS. An idle app prints nothing (no frames). If it does not go idle, `NB_TRACE=frames`
shows, per frame, the reason and the top 6 stack frames of whoever asked:

```
frame 2: inv [in frame]
    at invalidatesWhilePainting (src/app.tsx:9:5)
    at paintTree (src/render/paint.ts:140:8) x4
    at renderFrame (src/runtime/app.ts:234:5)
```

The comparisons use the same scene built in plain HTML and JavaScript, running in Electron
(`compare/electron/`) and in a Tauri 2 shell (`compare/tauri/`, which loads the same files).
`scripts/compare.sh` measures the whole process tree (Electron opens 8 processes and Tauri
3):

```sh
scripts/compare.sh "nodebuilder" 3 5 -- bun examples/bench/dashboard.tsx
SCENE=dashboard scripts/compare.sh "electron" 3 5 -- \
  compare/electron/node_modules/.bin/electron --ozone-platform=wayland compare/electron
(cd compare/tauri && cargo build --release)
SCENE=dashboard scripts/compare.sh "tauri" 3 5 -- compare/tauri/target/release/nodebuilder-tauri-baseline
```

Flutter (`compare/flutter/`), egui (`compare/egui/`) and GPUI (`compare/gpui/`, Zed's
framework) have ports of both scenes, with the same data and the same per-frame updates:

```sh
(cd compare/flutter && /opt/flutter/bin/flutter build linux --release)
scripts/compare.sh "flutter" 3 5 -- compare/flutter/build/linux/x64/release/bundle/nodebuilder_flutter_baseline
(cd compare/egui && cargo build --release)
scripts/compare.sh "egui" 3 5 -- compare/egui/target/release/nodebuilder-egui-baseline
(cd compare/gpui && cargo build --release)
scripts/compare.sh "gpui" 3 5 -- compare/gpui/target/release/nodebuilder-gpui-baseline
```

On Linux, Tauri and Flutter do not go above 60 fps; to compare the same work, run the others
with `NB_MAX_FPS=60`. The table with a 60 cap is in the [README](README.md#benchmarks).
With a 120 cap, only Electron, egui and nodebuilder go above 60 (2026-10-11, same session as
the README, before culling; fps · CPU · PSS in MB):

| Scene (120 cap) | Electron | egui | nodebuilder |
|---|---|---|---|
| Dashboard: overview | 117 · 84% · 365 | 119 · 21% · 105 | 111 · 39% · 90 |
| Dashboard: table | 116 · 80% · 382 | 102 · 71% · 113 | 80 · 83% · 152 |
| Dashboard: logs | 107 · 155% · 446 | 117 · 42% · 108 | 118 · 71% · 172 |
| Dashboard: settings | 116 · 67% · 311 | 118 · 23% · 105 | 104 · 22% · 89 |
| Dashboard: `CYCLE=30` | 111 · 99% · 413 | 112 · 38% · 114 | 100 · 62% · 152 |
| 1000 cells, 1 text changes | 117 · 71% · 312 | 117 · 47% · 107 | 103 · 44% · 109 |
| 1000 cells, all change | 112 · 237% · 414 | 116 · 72% · 113 | 117 · 69% · 147 |
| 3000 cells, all change | 50 · 173% · 427 | 45 · 81% · 128 | 51 · 96% · 190 |

After culling, in the same session: table from 78 to 104 fps (CPU 82% → 51%).

GPUI 0.2.2 (Zed's framework; Blade/Vulkan on Linux) against nodebuilder only, same session
(2026-10-14; fps · CPU · PSS in MB). GPUI has no text input, so the dashboard's inputs are
static boxes; every row is built, as in the other ports (Zed itself uses `uniform_list`, which
only builds the visible rows):

| Scene | GPUI (60 cap) | nodebuilder (60 cap) | GPUI (120 cap) | nodebuilder (120 cap) |
|---|---|---|---|---|
| Dashboard: overview | 60 · 31% · 74 | 58 · 38% · 147 | 114 · 37% · 73 | 109 · 47% · 146 |
| Dashboard: table | 27 · 91% · 131 | 56 · 50% · 199 | 27 · 92% · 131 | 108 · 55% · 215 |
| Dashboard: logs | 59 · 64% · 92 | 56 · 40% · 169 | 70 · 71% · 92 | 110 · 50% · 174 |
| Dashboard: settings | 59 · 24% · 73 | 59 · 27% · 137 | 116 · 34% · 72 | 112 · 36% · 140 |
| Dashboard: `CYCLE=30` | 43 · 65% · 134 | 57 · 44% · 231 | 57 · 76% · 134 | 106 · 49% · 220 |
| 1000 static cells | 3% · 85 | 0.4% · 132 | | |
| 1000 cells, 1 text changes | 59 · 42% · 85 | 59 · 36% · 165 | 103 · 67% · 85 | 106 · 45% · 154 |
| 1000 cells, all change | 25 · 91% · 87 | 57 · 49% · 170 | 26 · 91% · 86 | 110 · 58% · 193 |
| 3000 cells, all change | 9 · 97% · 114 | 51 · 75% · 242 | 9 · 98% · 115 | 74 · 99% · 266 |

GPUI is single-threaded on the UI side: where it falls behind it sits at one full core.
Building the view is cheap (1.3 ms/frame on the table); the rest is its own layout, text and
paint over ~3500 text elements per frame. It uses about half of nodebuilder's memory.

Things to watch when measuring:
- Tauri took more than 3 s to become idle after opening: use a warm-up of ≥ 8 s for static
  scenes.
- Why Tauri stays close to Electron: the page process (WebKitWebProcess) costs almost as much
  as Chromium's renderer, and WebKitGTK rasterizes on the CPU (`SkiaCPUWorker` threads).
  `WEBKIT_SKIA_ENABLE_CPU_RENDERING=0` and `WEBKIT_SKIA_CPU_PAINTING_THREADS=0` did not change
  that in WebKitGTK 2.54.1.
- Still unexplained: with a 60 cap, nodebuilder stays at 51–58 fps even in light scenes (the
  scheduling misses vblanks; roadmap item 4), and with a 120 cap the fps fluctuates between
  runs.

nodebuilder's memory breakdown: empty Bun ~15 MB, text (FreeType/HarfBuzz) ~26 MB, GL window
~108 MB (almost all of it the graphics driver), framework ~15 MB.
