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
     │  N-API: render(commands, texts), measureText, createImage, decodeImage, events
┌────▼──────────────────────────── portable core (native/core/) ───────────────┐
│ addon.c         N-API surface, event queue, threadsafe function              │
│ render_gles2.c  one shader, one vertex format, one batch per frame           │
│ text.c          HarfBuzz + FreeType, font fallback, alpha and color atlases  │
└────┬─────────────────────────────────────────────────────────────────────────┘
     │  nb_platform.h contract (window, events, fonts)
┌────▼──────────────────────── OS backend (native/platform/linux/) ────────────┐
│ linux.c      picks Wayland or X11 at runtime                                 │
│ wayland.c    xdg-shell, EGL, pointer, keyboard (xkb + compose), cursor       │
│ x11.c        Xlib + EWMH, EGL, XIM, Xcursor, XRandR                          │
│ pump.c       poll() thread that signals when there are events                │
│ fonts.c      fontconfig: UI font, fallback order per codepoint               │
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
  stack. An error that no scope handles does not stall the queue: the remaining pending
  effects run and the first error is rethrown at the end, to whoever wrote the signal.
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
  `<For>`/`<Index>`, like context). With no handler, it rethrows as before. The handler runs
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
`now`, `log`, `warn`) so `test/app.test.tsx` drives the whole loop with a fake core: it
counts `render` calls while sending `configure`, `frame` and pointer events.

## Layout

`src/render/layout.ts` is a simplified flexbox: `direction`, `gap`, `padding`, `grow`, `align`
(default `stretch`, overridden per child by `alignSelf`), `justify`, `min/max`, and
`position: "absolute"` with `left/top/right/bottom`. Absolute children are placed after the
in-flow ones, from the content box and minus the scroll offset (they scroll with the content);
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

The wrapping itself lives in `render/text-wrap.ts`: greedy, at spaces, like CSS's
`overflow-wrap: normal` (a word longer than the line overflows). Word widths are summed
instead of measuring the whole line again; a line that fits whole is measured only once.
Its "…" truncation is also exported as `truncate()`, which `<Canvas>`'s `g.text(..., { maxWidth })`
uses. `underline` needs no opcode: `Text` paints a RECT under each line it drew, as wide as
that line, a third of the descent below the baseline (ascent from the font metrics), with a
thickness of `max(1, fontSize / 14)` and both snapped to device pixels so it stays sharp.

**Culling:** each node that clips (`Scroll`, `clip`, the `Window`) narrows the visible region
passed to its children. A child entirely outside it (counting its shadow) gets its own box,
so that the content height and the scrollbars stay correct, but is marked `culled`: its
descendants are not positioned, painted or hit-tested. In a 500-row table, only the ~15
visible ones reach painting and HarfBuzz. Limitation: a descendant that overflows the box of
a culled node (e.g., an absolute popup) disappears along with it.

The natural size of all children is still computed every frame, because the content height
depends on them; each `Text` keeps its last measurement (text, size, bold) so this does not
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
the children run, so an overlay opened from inside another one sits on top of it.

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
| RECT | 1 | x y w h · r g b a · radius borderWidth · br bg bb ba |
| TEXT | 2 | x y(line top) size font(0/1 bold) · r g b a · index into `texts[]` |
| CLIP | 3 | x y w h radius (scissor + innermost rounded mask) |
| UNCLIP | 4 | (none) |
| SHADOW | 5 | x y w h · r g b a · radius blur |
| IMAGE | 6 | x y w h · u0 v0 u1 v1 · r g b a (tint; a = opacity) · radius · image id |
| LINE | 7 | x0 y0 x1 y1 · width · r g b a · start cap, end cap (0 butt, 1 round) |
| TRIANGLES | 8 | n · r g b a · n × (x y coverage) |
| ARC | 9 | cx cy · outer radius, inner radius · start, sweep (radians; 0 = up, clockwise) · r g b a |

The format exists in three places that must stay in sync: `native/include/nb.h`,
`src/render/paint.ts` and `native/core/render_gles2.c`.

## Rendering

`render_gles2.c` uses a single shader and a single vertex format. Rectangles with borders and
rounded corners, shadows and glyphs all become triangles in a single batch. Corners and
shadows are computed in the fragment shader with distance functions.

Colors are composited in **premultiplied alpha** (`GL_ONE, GL_ONE_MINUS_SRC_ALPHA`), and the
border is drawn over the background, as in CSS. Blending in "straight" alpha produces dark
artifacts at the corners.

Text: HarfBuzz does the shaping (accents, ligatures, kerning), FreeType rasterizes each glyph
once and stores it in a texture atlas. The measurements the layout asks of the C are cached
on the TypeScript side.

**Font fallback.** A string the UI font cannot fully draw is cut into clusters (a base
codepoint plus its combining marks, variation selectors, skin-tone modifiers, ZWJ-joined
parts, tag sequences; regional indicators in pairs), so an emoji sequence never splits across
fonts. Each cluster picks a face by its base: one with emoji presentation (emoji planes, the
BMP `Emoji_Presentation` list, or a U+FE0F, ZWJ or skin tone in the cluster; U+FE0E forces
text) asks for a color font first; otherwise the UI font if it has the glyph
(`FT_Get_Char_Index`), then the platform's fallback, `nb_platform_font_fallback`. On Linux
that is fontconfig's `FcFontSort` of the UI font's pattern (or of `emoji` with `color=true`),
computed once and walked for the first font whose charset has the codepoint. The answer is
cached per codepoint, so fontconfig is asked once per character the UI font lacks, and up to
32 faces stay loaded (UI fonts included; past that, the UI font's tofu). Consecutive clusters
with the same face become a run, each run is shaped with its own font and the pens
concatenate. `measure` and `draw` walk the same runs, so layout and painting agree. Strings
that are pure ASCII skip all of it (one run, no decoding). Ascent and descent always come from
the UI font, so a fallback glyph never changes the line height.

**Color emoji.** Noto Color Emoji is a CBDT font: bitmaps at fixed strikes (109 px), no
outlines. For such a face the closest strike is selected with `FT_Select_Size`, HarfBuzz scales
the advances from the font's own tables (`hb_font_set_scale` to the requested size) and each
glyph is loaded with `FT_LOAD_COLOR` as premultiplied BGRA, box-filtered down to its final
pixel size once, and stored in a second atlas, RGBA, allocated on the first color glyph.
COLRv0 and sbix fonts go through the same path (FreeType renders them to BGRA); COLRv1
(gradients) is not rendered by FreeType, so such fonts show their monochrome fallback glyphs.
The renderer draws those quads with their own mode: the shader samples the color atlas
(texture unit 2) and multiplies by the text color's alpha only, so `color` does not tint an
emoji but `opacity` fades it. Both atlases are reset together when either fills up.

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
(still outside the tree) is repeated in a microtask, once the tree is mounted. `onResize` is
collected during `layout()` and delivered in a batch after the whole tree has been
positioned, so that the handler can change state (and the tree) without disrupting the layout
in progress; the change lands in the next frame.

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

## Porting to other systems

Everything OS-specific sits behind `native/include/nb_platform.h`: opening a window, pumping
events, cursor, font discovery, offscreen GL context. The core (`native/core/`) only includes Node-API, GLES2,
FreeType, HarfBuzz and libc. A new OS is a `native/platform/<os>/` folder with the
implementation of this contract and a `build.sh`. On Windows and macOS the planned path is
ANGLE (GLES on top of Direct3D/Metal) or a new `render_<api>.c` with the same interface.

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
NB_STATS=1 bun examples/bench.tsx        # N=1000 MODE=one|all|static
NB_STATS=1 bun examples/dashboard.tsx    # TAB=overview|table|logs|settings ROWS=500 CYCLE=30
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
scripts/compare.sh "nodebuilder" 3 5 -- bun examples/dashboard.tsx
SCENE=dashboard scripts/compare.sh "electron" 3 5 -- \
  compare/electron/node_modules/.bin/electron --ozone-platform=wayland compare/electron
(cd compare/tauri && cargo build --release)
SCENE=dashboard scripts/compare.sh "tauri" 3 5 -- compare/tauri/target/release/nodebuilder-tauri-baseline
```

Flutter (`compare/flutter/`) and egui (`compare/egui/`) have ports of both scenes, with the
same data and the same per-frame updates:

```sh
(cd compare/flutter && /opt/flutter/bin/flutter build linux --release)
scripts/compare.sh "flutter" 3 5 -- compare/flutter/build/linux/x64/release/bundle/nodebuilder_flutter_baseline
(cd compare/egui && cargo build --release)
scripts/compare.sh "egui" 3 5 -- compare/egui/target/release/nodebuilder-egui-baseline
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
