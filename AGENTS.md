# AGENTS.md — nodebuilder

Guide for agents (and humans) working in this repository. Read it before changing code.

## What it is

A **native Linux** UI framework in TypeScript: TSX components with **SolidJS**-style
reactivity, rendered by **its own native core** (Wayland/X11 + GLES2 + FreeType/HarfBuzz,
in C via N-API). No DOM, no Electron, no GTK/Qt.

Motivation: a "Flutter for the JS ecosystem". TypeScript because LLMs write TS/JSX very
well, so as much of the framework as possible lives in TS, and the C stays small and stable.

| Document | Audience |
|---|---|
| `README.md` | framework users (it is also the npm package README) and the benchmarks |
| `ARCHITECTURE.md` | how it works inside and how to measure performance |
| `ROADMAP.md` | priorities and what has been done (still in Portuguese) |
| `FONTS.md` | the fonts roadmap: what is done and everything left to make fonts complete |
| `packages/create-nodebuilderjs/template/` | `AGENTS.md` and skills (`.agents/skills/`) shipped to generated apps, and inside core for `nodebuilder agents update` (only the block between the `nodebuilder:begin/end` markers of `AGENTS.md` is the framework's) |

## Non-negotiable rules

1. **Zero third-party runtime dependencies.** Only our own code + system libraries
   (libwayland, X11, EGL/GLES, xkbcommon, FreeType, HarfBuzz, fontconfig; libheif is
   optional, via `dlopen`). Development dependencies are acceptable (currently:
   `typescript`, `@types/bun`, `node-api-headers`). React, Solid, Yoga, Skia etc. serve
   only as reference.
2. **Bun is the runtime and the package manager.** Use `bun`, `bun add`, `bun test`; never
   npm/yarn/pnpm, `node:test` or building with `tsc`. The code must **keep running on
   Node** (the addon is runtime-agnostic): publishing generates `lib/` (JS via
   `Bun.Transpiler`, `.d.ts` via tsc) for Node only; Bun always reads `src/`.
3. **Never use libuv (`uv_*`) in the addon.** Bun does not implement libuv and aborts with
   `unsupported_uv_function`. Native async work (fds, timers) goes into the `poll()` of the
   pump thread (see "Threading model" under C).
4. **Linux first, architecture ready for other OSes.** Portable core (`native/core/`) and
   one backend per OS (`native/platform/<os>/`), connected only through the
   `native/include/nb_platform.h` contract. On Linux, **Wayland and X11**, chosen at runtime.
5. **TypeScript 7** (native compiler in Go) for type checking only: `bun run typecheck`.
6. **120 fps cap** by default. Anything above that is unnecessary (project decision).
7. **TDD:** new behavior and bug fixes start with a failing test (see "Workflow").

## Commands

```sh
bun install                 # development deps
bun run build:native        # builds native/build/<platform>-<arch>/nodebuilder.node
bun run typecheck           # tsc 7 --noEmit (~0.1 s)
bun test                    # all tests, no window (~0.1 s)
bun test test/svg.test.tsx  # one file; -t "pattern" filters by test name
bun run check:snippets      # typechecks the ts/tsx snippets of README.md and the template docs
bun run counter | todo | images | icons | drawing | charts | overlays | text | scroll | widgets | tray   # examples
bun run dev                 # todo with --watch
bun run bench               # stress test with NB_STATS=1 (env: N=1000 MODE=one|all|static)
bun run bench:dashboard     # realistic app (env: TAB=overview|table|logs|settings ROWS=500
                            #   LIVE=0 CYCLE=<frames per tab switch>)
bun run package <app.tsx> --name x --title X [--targets appimage,deb,rpm,tar]
bun cli/nodebuilder.ts screenshot <app.tsx> <out.png> [--width --height --scale 2 --theme dark --wait-frames N
                            --props <json> --export <name>]
                            # PNG of the app without a window or display server (EGL offscreen)
bun cli/nodebuilder.ts icons add <names...> [--from lucide-static|@phosphor-icons/core] [--out src/icons.ts]
                            # icon imports for an app (validated in its node_modules); `icons list [filter]`
bun cli/nodebuilder.ts agents update [--dry-run] [--force]
                            # in an app: AGENTS.md and .agents/skills up to this version (keeps edited ones)
bun scripts/agents-history.ts   # cli/agents-history.json (hashes of every committed template doc; npm:build runs it)
bun cli/nodebuilder.ts doctor [--json] [--window]
                            # checks the machine (addon, system libs, display, keyboard, GL, fonts,
                            #   libheif) with the command that fixes each problem; exit 1 on failure
bun run npm:build           # npm packages in dist/npm/ (does not publish)
scripts/compare.sh <label> <warmup-s> <sample-s> -- <command...>  # CPU/RAM of the process tree
```

## Workflow (TDD)

Every new behavior and every bug fix follows the cycle:

1. **Red:** write the test that describes the expected behavior and run it
   (`bun test <file> -t <name>`). It must **fail, and for the right reason** (the
   assertion, not a broken import or a typo). Bug: first a test that reproduces the bug.
2. **Green:** write the minimum code to make the test pass.
3. **Refactor** with the suite green: names, duplication, the right place in the module.
4. **Close:** `bun run typecheck && bun test` (and `bun run build:native` if you touched C).

Write tests from visible behavior (public API, tree, layout, draw commands, pixels), not
from internal details, so that refactoring does not break tests for no reason.

### Where and how to test each layer

| Layer | How to test without a window |
|---|---|
| Reactivity, control flow (`For`/`Index`/`Show`/`Switch`) | signals and effects directly; count runs and disposals (a `Probe` with a counter in the body and in `onCleanup`) |
| Errors (`ErrorBoundary`, `catchError`) | a component or effect that throws; check the `fallback`, that the scope was disposed (the effect no longer runs, `onCleanup` ran) and that, without a boundary, the error reaches the caller and the queue keeps going |
| Widgets and layout | mount with `mount` (`@nodebuilderjs/core/testing`) or `insert` into a root `UINode`, run `layout()` and check `x`/`y`/`width`/`height` or `debugTree()`. Fake metrics: 8 px per character, 20 px line (`useRealTextMetrics()` for the installed fonts, `skipIf(!canUseRealTextMetrics())`) |
| Painting and command buffer | `drawCommands(node)` / `decode(buffer)` from `test/helpers.ts` return named commands (`{ op: "line", x0, ... }`). A new draw primitive starts here |
| Frame loop (when frames render) | `runWith(fakeNative, app, { maxFps: 1000 }, hooks)` from `runtime/app.ts` (see `test/app.test.tsx`): the fake records `render`/`requestFrame` and the test sends `configure`/`frame`/pointer events through `open`'s callback, then awaits a `setImmediate` tick. `hooks` inject `env`, `now`, `log`, `warn`. Close with `windowControls.close()` and reset the globals `run()` sets (text measurer, image backend, frame clock) |
| Events (mouse, keyboard, focus) | `interact(root)` from `@nodebuilderjs/core/testing`, or `createInput(root, host)` from `runtime/input.ts` with a fake host that records move/resize/cursor and controls the clock |
| Images and textures | `setImageBackend({ create, destroy })` records texture creation and release |
| Decoders and rasterizers | "golden" tests: the reference output (libjpeg-turbo, libwebp, librsvg, ImageMagick) lives in `test/fixtures/`, generated once; compare byte for byte or with an explicit tolerance. Then fuzzing with flipped bytes and truncated files: every error is a format message (never a TypeError), and absurd dimensions are rejected before allocating (2^28 pixel limit) |
| Addon (what runs without a window) | call the native function through `loadNative()` in a test; use `test.skipIf` when it depends on something optional in the system (e.g. libheif) |
| Pixels (the C drawing: shaders, corners, AA, text, images) | `renderOffscreen()` in the addon or `screenshot(root)` from testing, behind `test.skipIf(!canScreenshot())`; assert colors at chosen points (fonts and drivers vary), not whole images |

What cannot be tested automatically is documented when closing the task:

- **Visual** (how it looks): `bun cli/nodebuilder.ts screenshot examples/x.tsx <scratch>/x.png`
  (no window; `--scale 2`, `--theme dark`) and look at the PNG; inspect pixels with `magick`
  (crop + `-filter point -resize 800%`). Pixel assertions go in tests via `screenshot()`
  (see the table above). What the offscreen path cannot show (the window itself: CSD
  resize edges, compositor transparency, X11 vs Wayland) still needs the example opened in
  the background and `spectacle -b -n -a -o <scratch>/x.png`.
- **System keyboard** (accents, dead keys, compose): the xkb -> text path is in C and can
  only be tested by actually typing; ask the user. From the key event onward (focus, Tab,
  TextField), use `interact().key/type`.
- **Performance:** the "test" is the measurement. Measure before changing (`NB_STATS=1` and
  `scripts/compare.sh` on the same scene), change, measure again in the same session and
  record both numbers. No optimization goes in without before and after numbers.

### Test organization

- One file per subject: `core` (reactivity, tree, layout, culling), `grid` (`Grid`, `aspectRatio`), `wrap` (`wrap` rows/columns), `margin`, `app` (`run()` with a
  fake native: idle renders nothing, frame reasons, `NB_TRACE`, frame loop and overflow
  warnings), `overflow` (overflow detection, `layoutWarnings()`), `control-flow`
  (`Show`, `Switch`/`Match`, `Index`, nesting without recreating components),
  `error-boundary` (errors, effect queue), `context`, `ref`
  (`ref`, programmatic focus and scrolling, `onResize`), `overlay`, `style` (`opacity`, `translate`),
  `text` (line wrapping, alignment, `maxLines`, multi-line selection), `font-fallback`
  (fallback fonts and color emoji with real fonts, `skipIf` they are missing), `font-style`
  (weights, italics and letter spacing with real fonts and pixels), `fonts` (`registerFont`,
  `fontFamily` lists, CSS weight/slant matching, synthetic bold/italic, features, variations,
  with the box fonts of `fixtures/fonts/` whose advances are known), `controls`
  (`disabled`, `Toggle`, `RadioGroup`, `Slider`, `ProgressBar`, `Spinner`), `popups`
  (`Select`, `Tabs`, `Tooltip`, `Dialog`), `theme` (`setTheme`, widgets following the switch),
  `animation` (`animate`, tween, presence, widget transitions with `frames()`), `scroll`
  (horizontal and both axes, bars, wheel, keyboard, minimums of whoever contains a `Scroll`),
  `input` (events, keys with nothing focused, `focusable`), `text-field` (password, borders, focus
  ring), `handlers` (event props on every widget, chained with the widget's own), `percent`
  (percentage sizes), `screenshot` (offscreen addon, PNG encoder, `screenshot()`, `NB_SCREENSHOT`),
  `cli` (the `nodebuilder` command, spawned; `addIcons` called directly on a fake `node_modules`),
  `doctor` (each check on fake probes, the ELF and `ldd` readers, `diagnostics()` and one spawn),
  `agents` (`agents update` on temp apps: stale, edited, renamed docs, AGENTS.md markers),
  `clipboard`, `window-icon` (`iconImages`: sizes, fitting, the default; `run()` covers the
  prop and `hide`/`show` in `app`), `dbus` (wire format, connection against `fake-bus.ts`),
  `tray` (`createTray` against `fake-bus.ts`), `text-selection`, `testing` (public helpers), `gradient` (backgrounds, Canvas,
  pixels), `image`, `jpeg`, `webp`, `svg` (+ `<Icon>`), `geometry`
  (triangulation), `draw` (primitives and `shapes.ts`), `canvas` and `charts/`. A new subject gets a new file; when `core` grows, split it.
- Fast, deterministic tests: no network, no clock, no window. The whole suite runs in
  ~0.5 s (most of it: the EGL context of `screenshot` and the spawns of `cli`); a test that
  needs more than a few ms must have a reason.
- Small fixtures (a few KB). Record where they came from (tool and version, as in
  `svg-LICENSES.md`) and the license of third-party files.
- Code snippets in skills, the template's AGENTS.md or the README are tested too:
  `bun run check:snippets` typechecks every fenced `ts`/`tsx` block that has an `import` (one
  tsc run, kept out of `bun test`; `check-snippets.test.ts` covers only the extraction). A
  fragment without imports is illustrative and skipped; `<!-- no-check -->` on the line before
  the fence skips a block, `<!-- check -->` checks one without imports. Third-party packages
  the docs suggest (`lucide`) are stubbed in the script.

### Before finishing a task

- `bun run typecheck && bun test` green; `bun run build:native` if you touched C;
  `bun run check:snippets` if you touched a snippet in the README or the template docs.
- **When closing a block, reread the tests of every modified area** (not just the new ones)
  and check that they are still correct and up to date: names and comments that describe
  today's behavior, cases that became trivial or redundant, and what is missing in the
  interaction with what changed (e.g. an old widget with the new prop). Fix in the same commit.
- Visual change: a screenshot of the example looked at (`nodebuilder screenshot`).
  Performance change: before and after numbers.
- Docs alongside, in English: README (public API, limitations), ARCHITECTURE (how it
  works), ROADMAP (item done), this file (structure, conventions) and the template skills
  (public API, new widget, resolved limitation, plus the table in `template/AGENTS.md`).
  In the files still in Portuguese, translate the parts you touch.

## Structure

```
src/                   one module per folder; relative imports with `.js`
  index.ts             public API (re-exports the modules)
  jsx-runtime.ts       own JSX runtime; jsx() only creates descriptions (ElementDesc)
  testing.ts           @nodebuilderjs/core/testing: mount, findBy/AllByText, findBy/AllByLabel, click, interact,
                       layoutWarnings, screenshot/savePNG/canScreenshot, use{Fake,Real}TextMetrics
  theme.ts             lightTheme/darkTheme, `theme` (reactive getters), setTheme, colorScheme
  animation/index.ts   animate, createTween, createPresence, easing, mixColor
  assets.d.ts          `declare module "*.png" | "*.svg"...` (index.ts references it with preserve="true")
  reactive/
    signals.ts         createSignal/Effect/Memo/Root, onCleanup, batch, untrack, read, catchError
    control.ts         <Show>, <Switch>/<Match> (conditions)
    list.ts            <For> (keyed by reference), <Index> (by position)
    error-boundary.ts  <ErrorBoundary> (on top of catchError)
    context.ts         createContext/useContext (value stored in the owner scope)
  render/              tree -> layout -> command buffer
    node.ts            UINode (retained tree), Style, handlers, invalidate(), measureText(), displayScale()
    layout.ts          simplified flexbox (+ wrap) + grid (equal columns) + aspectRatio + culling
    overflow.ts        overflow warnings: children cut off by a clip or the window (layoutWarnings, run() in dev)
    paint.ts           tree -> CommandBuffer (Float32Array) + parseColor
    shapes.ts          polyline (LINE segments) and fillPolygon (triangulation + AA fringe)
    gradient.ts        linear gradients: stop offsets (CSS rules), the CSS gradient line of a box
    scrollbar.ts       clamped scroll position and scrollbar geometry (painting and input)
    text-wrap.ts       <Text> line wrapping (greedy, at spaces), maxLines with "…", truncate()
  runtime/
    app.ts             run()/runWith(): window, frame scheduling, NB_STATS/NB_TRACE; wires input to the addon
    input.ts           events -> UI: hit test, hover, cursor, focus, clicks, capture, scrolling, keyboard
    native.ts          loads native/build/<platform>-<arch>/nodebuilder.node (literal requires)
    frames.ts          frame clock: requestAnimationFrame queue, frameNow, animating()
    clipboard.ts       clipboard (text): in memory without a window, native with run(); read via event
    fonts.ts           registerFont (app font files -> addon), fontFamilies
    screenshot.ts      captureTree: real metrics + native images, layout, paint, renderOffscreen
  widgets/             one file per widget; index.ts re-exports
    props.ts           StyleProps, STYLE_KEYS, HANDLER_KEYS, applyProps (+ hoverStyle/pressStyle), inherited, interaction, createInteraction
    containers.ts      Box, Column, Row, Grid, Scroll, Spacer, Divider, Card
    text.ts image.ts icon.ts canvas.ts button.ts checkbox.ts text-field.ts window.ts
    toggle.ts radio.ts slider.ts progress.ts   controls (Toggle, RadioGroup, Slider, ProgressBar/Spinner)
    select.ts tabs.ts tooltip.ts dialog.ts     on top of Overlay (Tabs opens nothing, but uses roving.ts)
    roving.ts          group with a single Tab stop and arrow keys (RadioGroup, Tabs)
    overlay.ts         <Overlay>: layer above the window (marker in the tree + root.layers)
    text-selection.ts  character positions, word under the click (Text selectable; TextField)
  image/
    source.ts          image sources: cache by path, usage count, GPU handle
    decode.ts          decodeImage: picks the decoder by the file signature
    png.ts             PNG (all color types, tRNS, Adam7) via node:zlib
    jpeg.ts            baseline/progressive JPEG, CMYK/YCCK, EXIF; identical to libjpeg-turbo
    webp.ts            WebP VP8 (lossy), VP8L, alpha, first animation frame; identical to libwebp
    png-encode.ts      PNG encoder (RGBA, Sub/Up filters, node:zlib) for screenshots
    icon.ts            app icons: SVG/raster -> square sizes (window and tray icons; DEFAULT_ICON_SVG)
  dbus/                D-Bus client in TS over node:net (no libdbus)
    wire.ts            marshalling by signature, message framing (MessageReader)
    connection.ts      auth, Hello, calls, signal matches, exported objects (properties, introspection)
  tray/
    tray.ts            createTray: StatusNotifierItem + menu; setTrayBus (run() only)
    menu.ts            TrayMenuEntry -> com.canonical.dbusmenu layout
  svg/                 SVG for icons (<Icon>)
    parse.ts           XML, presentation attributes, style="", transform
    render.ts          shapes -> geometry -> bitmap
  geometry/            no SVG dependencies; base for the draw primitives
    path.ts            path data, curves and arcs flattened into polylines
    stroke.ts          stroke -> polygons (caps, joins, miter)
    raster.ts          scanline rasterization with AA (nonzero/evenodd)
    triangulate.ts     ear clipping of simple polygons (null if self-intersecting)
  charts/              @nodebuilderjs/core/charts: Recharts-style charts, on top of <Canvas>
    scale.ts           axis ticks (d3's algorithm)
    components.ts      configuration children (Line, XAxis...): render nothing
    cartesian.ts pie.ts shared.ts
native/
  include/nb.h          portable API: events, text, renderer, images, opcodes
  include/nb_platform.h CONTRACT each OS implements (window, event pump, fonts, codecs)
  core/                 portable, nothing OS-specific
    addon.c             N-API surface, event queue, threadsafe function
    text.c              HarfBuzz + FreeType; runs by cluster, features, alpha atlas + RGBA color-emoji atlas
    faces.c             font faces (files, variations, synthetic bold/italic), app fonts, specs
                        (CSS family lists, features, variations), styles, CSS matching, fallback
    render_gles2.c      GLES2 renderer: one shader, one vertex format, single batch; textures
  platform/linux/       Linux backend
    linux.h             nb_linux_backend vtable (internal to Linux)
    linux.c             implements nb_platform_* choosing Wayland or X11 at runtime
    wayland.c           Wayland (xdg-shell), EGL, pointer, keyboard (xkb + compose), cursor
    x11.c               X11 (Xlib + EWMH), EGL, XIM (dead keys), Xcursor, XRandR
    pump.c              poll() thread over the active backend's fds + exit eventfd
    fonts.c             font discovery via fontconfig: families by name, UI font, fallback (FcFontSort), list
    codecs.c            AVIF/HEIC via libheif (dlopen; own declarations, no header)
    offscreen.c         EGL context with no display server (surfaceless/device) + FBO, for screenshots
    build.sh            backend build (called by scripts/build-native.sh)
    protocols/          xdg-shell.xml, xdg-toplevel-icon-v1.xml (vendored; wayland-protocols is not installed)
  build/<platform>-<arch>/  output (names from process.platform/arch: linux-x64, ...)
test/            one file per module (bun:test; bunfig.toml limits bun test to test/)
  helpers.ts     decode()/drawCommands()/commandsOf(): command buffer -> named commands
  charts/        tests for src/charts (scales and each chart type)
  fixtures/      reference inputs and outputs (.raw, .pnm from djpeg, PNG from librsvg...)
examples/        counter, todo, images, icons, drawing, charts, overlays, text, scroll, widgets, tray, bench, dashboard (.tsx) + assets/
cli/             `nodebuilder` command (package bin): nodebuilder.ts, package.ts, screenshot.ts
                 (+ screenshot-entry.ts: renders an exported component for `--props`/`--export`),
                 icons.ts (`icons add/list`: writes an app's icon imports), doctor.ts (checks
                 over injected probes; `systemProbes()` is the real machine), agents.ts
                 (`agents update`) + agents-history.json (generated: released doc hashes)
  package/       common.ts (SYSTEM_LIBS: soname -> deb/pacman package, for packaging and doctor),
                 deb.ts, rpm.ts, appimage.ts, native.ts (addon build, `elfGlibc`), Dockerfile, icon.svg
packages/        workspaces published together with core (see "Publishing to npm")
  linux-x64/     @nodebuilderjs/linux-x64: only the prebuilt addon (generated, not in git)
  create-nodebuilderjs/  `bun create nodebuilderjs`: index.js + template/ (AGENTS.md and
                         .agents/skills/; index.js creates the links in .claude/skills/)
lib/             JS + .d.ts for Node (generated by scripts/npm.ts, not in git)
compare/         the same scenes in Electron, Tauri, Flutter, egui and GPUI (benchmarks)
scripts/         build-native.sh, measure.sh, compare.sh, npm.ts, check-snippets.ts
```

## Mental model (flow of a frame)

```
signal changes -> effect updates UINode.set(...) / setSlot(...) -> invalidate()
  -> schedule(): respects pending frame and fps cap
  -> renderFrame(): requestAnimationFrame callbacks -> layout() -> refreshHover()
     -> paintTree() -> native.render(commands, texts) -> compositor frame callback
```

- **Components run once.** There is no virtual DOM and no re-render. The component body
  is `untrack`ed; only **functions** are reactive.
- **Reactive props are functions:** `text={() => ...}`, `{count}` (accessor as a child),
  `background={() => hovered() ? a : b}`. Static value = not reactive. There is no
  Solid-style compiler; this is intentional (only `tsc`/Bun transform the JSX).
- **`jsx()` is lazy:** it returns `ElementDesc`; the component runs when inserted
  (`insert`/`render`). This lets `<Show>`/`<Switch>`/`<For>` decide when to instantiate.
- **Children live in slots** (`UINode.addSlot/setSlot`). Each function child becomes a
  reactive slot with its own effect; on re-run, the owner disposes the old children.
- **Build, then collect:** code that mounts children inside a computation uses
  `render(child)` (`jsx-runtime.ts`), not `createMemo(() => resolve(child))`: `build` runs
  the components once and turns each function child into its own memo, and `resolve` only
  collects the nodes. Resolving descriptions inside a memo would make an inner change
  recreate everything around it.
- **Ownership:** everything created inside an effect/root is disposed with it (`onCleanup`).
  `<For>` creates one `createRoot` per item and disposes it when the item leaves the list;
  `<Index>`, one per position.
- **Effect queue:** writes made during the queue (`flushPending`) are only enqueued; the
  effect finishes before the ones it triggered. An unhandled error does not stall the queue
  (the others run; the first error is rethrown at the end).
- **Errors propagate up through owners:** `execute` catches the error of an effect/memo and
  hands it to the `onError` of the nearest scope (`catchError`, used by `<ErrorBoundary>`);
  without a handler, it rethrows. Event handlers do not go through this.

## Code conventions

### TypeScript
- ESM, `strict`, relative imports with the `.js` suffix (`./node.js`); Bun resolves to `.ts`.
- `package.json#exports`: the `bun` condition points to `src/*.ts`, `default` to `lib/*.js`
  (generated for Node). The public entry points are `.`, `./jsx-runtime`, `./testing` and
  `./charts`. A new entry point also goes into the `paths` of `tsconfig.json`, before the
  wildcard.
- Widgets are **functions** that create `UINode`s; there is no widget base class.
- **New widget:** its own file in `src/widgets/`, exported from `widgets/index.ts`.
  Code reusable by other modules (geometry, decoding) lives in the subject's module,
  outside `widgets/`.
- Style props are flat (`padding`, `gap`, `background`...), typed as `StyleProps`
  (`MaybeAccessor` of each `Style` field).
- **When adding a field to `Style`**, also add it to `STYLE_KEYS` (`widgets/props.ts`);
  new handlers go in `Handlers` (`render/node.ts`) and `HANDLER_KEYS`.
- Inherited through the tree: `color`, `fontSize`, `bold`, `fontWeight`, `italic`,
  `letterSpacing`, `fontFamily`, `fontFeatures`, `fontVariations`, `underline` (the `inherited` function; `inheritedFont()` resolves the
  weight, where the nearest `fontWeight` or `bold` wins and `fontWeight` beats `bold` on the
  same node). Text widgets measure and paint with that `FontStyle`.
- A widget that opens something on top returns `[node, <Show><Overlay>]` (the `Overlay` stays
  outside the node, so the list's events do not bubble up through the trigger); the trigger
  keeps focus and handles keys while it is open.
- A new control accepts `disabled` via `disableable(node, props)` (`widgets/props.ts`): it
  fades, leaves focus and the Tab order and changes the cursor; the control's handlers check
  the returned accessor. Keys the control uses (arrows in `Slider`) call `e.stop()`,
  otherwise they scroll the surrounding `Scroll`.
- Every widget passes its props through `applyProps`: it is what wires style, handlers,
  `ariaLabel` (into `UINode.ariaLabel`; `UINode.label` is the debug label), `dragRegion`
  (a node flag, not a `Style` field) and the `ref` (the `ref` receives the `UINode`, typed
  as `ElementRef`). New widgets too.
- A control inside a drag region keeps the press because it is clickable, focusable or has
  `onPointerDown` (`pointerDown` in `runtime/input.ts`); a new pressable widget needs one of
  those, otherwise pressing it in a custom title bar moves the window. Taking the press only
  blocks the window move: `onPointerDown` keeps bubbling to every ancestor until `stop()`,
  past clickable nodes too (a parent's `pressStyle` shows like CSS `:active`); only `onClick`
  stops at the innermost node that has one.
- Key names reach handlers normalized (`normalizeKey` in `runtime/input.ts`): compare only the
  plain names (`"Tab"`, `"Return"`, `"Page_Up"`, `"Delete"`), never `ISO_Left_Tab`, `Prior` or
  `KP_*`.
- Handlers are **chained, never replaced**: `applyProps` adds the app's handlers (and the
  ones from spread `createInteraction().props`, carried under a unique symbol key so a later
  `onPointerEnter={...}` cannot drop them) after the node's; a widget sets its own handlers
  after `applyProps`/`interaction(node)` with `ownHandler(node, key, fn)` (`widgets/props.ts`),
  which runs the previous ones first and, for `onKeyDown`, skips the widget's when the app
  called `stop()`. Every widget's props type includes `Handlers` (a `Button` omits `onClick`,
  which it wires itself through `disabled`).
  `interaction(node)` is one tracker per node (widgets and `hoverStyle` share it).
- `hoverStyle`/`pressStyle`/`focusStyle` use `UINode.override(key, value)`: while it is active, `set()`
  only updates the base underneath, so theme effects and reactive props do not fight it and
  the latest base comes back on leave. `hoverStyle` alone attaches only enter/leave (an
  `onPointerDown` would make the node claim the press and break window drag regions).
- Focus by click only (e.g. `<Text selectable>`, which needs focus for Ctrl+C):
  `focusable = true` and `tabStop = false`, so it stays out of the Tab order. Containers get
  the same through the `focusable` prop (`tabStop` opts into Tab). With nothing focused, keys
  start at the topmost modal layer or the root's top nodes (`keyTargets()` in `input.ts`).
- A widget that paints `color`/`background` itself (a bar's fill and track) takes them out of
  `applyProps` with `ownColors()` (`ProgressBar`, `Slider`), so the box does not paint them too.
- Sizes (`width`, `height`, `min*`, `max*`) may be `` `${number}%` `` in props only
  (`SizeValues`): `applyProps` keeps them in `UINode.percents` and layout writes the px value
  into `style` (`Style` stays numeric, so `hoverStyle` sizes are px).
- Code in a component that needs its refs or its nodes in the tree goes in `onMount`
  (`reactive/signals.ts`; drained when the outermost `insert` or update queue ends).
- Color/size defaults come from `theme.ts`, not hard-coded in widgets. Theme colors go
  in an effect (or in painting), never copied into the style at creation, otherwise they do
  not follow `setTheme`; respect the color the app passed (`if (props.background === undefined) ...`).
- Transitions use `createPresence`/`createTween` (`animation/`): without a window they
  finish immediately.
- Everything new is written in **English**: code comments, identifiers, docs (README,
  ARCHITECTURE, this file), commit messages and user-facing strings in examples and
  widgets. Some files are still in Portuguese pending translation: `ROADMAP.md` and the UI
  strings in `examples/`; when editing them, translate the parts you touch instead of
  adding more Portuguese. Comments are short and explain why, not what.
- Use `ReturnType<typeof setInterval>`, not `NodeJS.Timeout`.

### C (native/)
- `gnu11`, no dependencies beyond the system libs.
- **Core/platform boundary:** `core/` may only include `nb.h` (which includes
  `nb_platform.h`), Node-API, GLES2, FreeType, HarfBuzz and libc. Anything OS-specific
  (Wayland, poll/eventfd/pthread, fontconfig, dlopen...) goes in `platform/<os>/` and
  reaches the core only through `nb_platform_*` functions. Need something new from the OS?
  Add it to the contract in `nb_platform.h`, document the thread it runs on and implement
  it in every backend.
- **Linux has two window backends** behind the `nb_linux_backend` vtable (`linux.h`):
  `nb_wayland_backend` (wayland.c) and `nb_x11_backend` (x11.c). Backend functions are
  `static`; only the vtable is exported. `linux.c` chooses: `NB_BACKEND=wayland|x11` forces;
  otherwise Wayland if `WAYLAND_DISPLAY`, then X11 if `DISPLAY`. An `open()` that fails
  must not leave anything open (the selector calls `close()` and tries the next one).
- New window functionality on Linux = implement it in **both** backends.
- Each backend uses `eglGetPlatformDisplay` with the explicit platform
  (`EGL_PLATFORM_WAYLAND_KHR` / `EGL_PLATFORM_X11_KHR`); never `eglGetDisplay`, which
  forces Mesa to guess the pointer type.
- **Threading model:** the backend may have a thread that only waits (on Linux, `poll()` on
  the display fd, the key-repeat timerfd and an exit eventfd) and calls `wake()`; the core
  wakes JS via `napi_threadsafe_function` and calls `nb_platform_pump_process()`, where
  all reading/dispatch happens. The Linux pump does `poll()` on the fds that
  `backend->fds()` returns (`struct pollfd`, with POLLIN/POLLOUT) and calls
  `backend->process(ready, n)` on the JS thread with the ones that became ready. The list is
  requested again on every round, on the JS thread; did it change outside `process` (e.g. a
  paste started)? Call `nb_linux_pump_refresh()`. A ready fd may have been closed and its
  number reused: every backend fd is non-blocking. `nb_wl_dispatch()` never blocks
  (prepare_read/read_events/cancel_read).
- Events to JS: fill an `nb_event` and call `nb_push_event()` **on the JS thread**.
- **Offscreen** (`nb_platform_offscreen_begin`, JS thread, no pump): its own EGL display and
  context, outside the window backends' vtable; the target is a texture FBO left bound for
  `nb_render_frame`, and `nb_render_read_pixels` returns straight alpha, top row first. The
  renderer's GL objects belong to one context, so `addon.c` refuses a window after a shot and
  a shot while a window is open.
- **Fonts:** `nb_platform_font_path(family, generic, weight, italic, &match)` gives the file
  of an installed family (NULL: the UI font; a named family that is not installed: NULL)
  closest to a CSS weight and slant (`match.oblique`/`match.embolden`: the core slants or
  thickens it), `nb_platform_font_fallback(cp, family, generic, weight, italic, emoji, &index)`
  a file (and face index) that has `cp`, color fonts only when `emoji`, and
  `nb_platform_font_families` the installed names (JS thread, may be slow: `faces.c` asks once
  per style, caches fallbacks per codepoint and style). App fonts (`nb_fonts_register`) are
  portable: FreeType reads them from memory in `faces.c`, which also does the CSS matching.
  A TEXT command's font is a font id (`weight * 2 + italic`) plus a spec (family list,
  features, variations joined by U+001F); `faces.c` resolves the pair to a style (a stack of
  faces) and drops all styles when a font is registered. Faces of variable files are evicted
  (LRU) at the start of `nb_font_style` only, when the table runs low; a reused face id bumps
  its generation (`nb_face_gen`, part of the glyph cache key). Variable fonts
  get their axes set in the core (FreeType). Letter spacing is added per HarfBuzz cluster in
  `layout_runs`, shared by measure and draw. `text.c` keeps `measure` and `draw` on the same run itemization; color
  glyphs go to the RGBA atlas and are drawn with `MODE_COLOR_GLYPH` (texture unit 2, only the
  alpha of the text color applies).
- **Diagnostics** (`diagnostics()` in `addon.c`, for `nodebuilder doctor`): must work when the
  rest does not (no fonts, no display server), so it never calls `nb_text_init`;
  `nb_platform_probe_display` connects with the same choice and order as `nb_platform_open` and
  disconnects (each backend's `probe` in the vtable). glGetString only with a context of ours
  current (`g_open || g_offscreen`).
- After calls that may receive events (e.g. `eglSwapBuffers`), the core calls
  `nb_platform_flush()` and requests a delivery (`request_delivery()`).
- Coordinates: JS works in **logical px**; C multiplies by the integer `scale`
  (Wayland: `wl_surface.preferred_buffer_scale`; X11: `Xft.dpi / 96`, or `NB_SCALE`).
- X11 specifics: no WM decoration (`_MOTIF_WM_HINTS`), move/resize via
  `_NET_WM_MOVERESIZE`, maximize via `_NET_WM_STATE`, 32-bit ARGB visual only when
  there is a compositor (`_NET_WM_CM_Sn`); without a compositor, `transparent=false` and the
  `Window` uses radius 0. X11 has no frame callback: pacing comes from a timerfd at the
  XRandR rate.
- Renderer in **premultiplied alpha** (`GL_ONE, GL_ONE_MINUS_SRC_ALPHA`). The border is
  composited *over* the background (CSS semantics). Blending in "straight" alpha produces
  dark artifacts in the corners (bug already fixed; do not regress). Image textures are
  premultiplied on upload.
- **New OS:** create `native/platform/<os>/` with the full implementation of
  `nb_platform.h` + `build.sh`, and add the `case` in `scripts/build-native.sh`.
  The renderer is GLES2 (on Windows/macOS: ANGLE, or a new `core/render_<api>.c` with the
  same `nb_render_*` interface).
- Changed the native API? Update `core/addon.c` (export), `src/runtime/native.ts` (type) and,
  if it needs something from the OS, `nb_platform.h` + backends. If it is an opcode, the
  three places of the format below.

### Command buffer format (render/paint.ts -> render_gles2.c)
Keep **`native/include/nb.h`, `src/render/paint.ts` and `native/core/render_gles2.c` in sync**.

| Op | Code | Following floats |
|---|---|---|
| RECT | 1 | x y w h · r g b a · tl tr br bl (corner radii) · borderWidth · br bg bb ba |
| TEXT | 2 | x y(line top) size font id (weight * 2 + italic, `fontId()`) · r g b a · index into `texts[]` · letterSpacing · font spec index into `texts[]` (`fontSpec()`; -1: none) |
| CLIP | 3 | x y w h · tl tr br bl (scissor + innermost rounded mask) |
| UNCLIP | 4 | (none) |
| SHADOW | 5 | x y w h · r g b a · tl tr br bl · blur · dy (the casting box is at y - dy: cut out, as in CSS) |
| IMAGE | 6 | x y w h · u0 v0 u1 v1 · r g b a (tint; a = opacity) · radius · id (from `createImage`) |
| LINE | 7 | x0 y0 x1 y1 · width · r g b a · capStart capEnd (0 butt, 1 round) |
| TRIANGLES | 8 | n · r g b a · n × (x y coverage) |
| ARC | 9 | cx cy · outer inner · start sweep (radians; 0 = up, clockwise) · r g b a |
| GRADIENT | 10 | x0 y0 x1 y1 · n · n × (offset r g b a): a linear gradient that fills the next op only (that op's color multiplies it; paint.ts sends white) |

Colors in 0..1, not premultiplied (the vertex shader premultiplies, so per-vertex colors
interpolate premultiplied, like CSS). The renderer cuts the triangles of a gradient-filled op at
the stop lines and colors their vertices: exact for linear gradients, any shape. A new op also goes into
`decode()` in `test/helpers.ts`, which the tests use to read the buffer.

### Layout (render/layout.ts)
- Flex: `direction` (column by default in `Column`/`Box`), `gap`, `padding`, `grow`,
  `align` (**stretch** by default; `alignSelf` overrides it per child, read through `alignOf()`),
  `justify`, `min/max`, `position: "absolute"` (`left/top/right/bottom` from the content box;
  both edges without a size stretch, as in CSS; it scrolls with a `Scroll`'s content).
- **Stacking:** `zIndex` orders siblings only (no global stacking contexts): `stacked(node)`
  (`render/node.ts`) gives the children by zIndex, then child order (stable sort, and the
  children array itself when none has a zIndex, so no allocation per frame). `paintTree`
  and `hitTest` (`runtime/input.ts`) both use it; overlays stay above the tree. The hit test
  descends into children outside the parent's box unless the parent clips or scrolls (CSS
  overflow: an absolute badge sticking out is clickable there).
- **Shrinking follows CSS `min-size: auto`:** a child does not shrink below its own
  content, unless it is `scrollable`/`clip` or has an explicit `minWidth/minHeight`.
  Wrapping text shrinks down to its longest word. Children with `grow` shrink first.
- **Height depends on width** (wrapping text): `intrinsic()` is the natural size and
  `heightAt(node, width)` the height at a given width. A column computes its children's
  widths before their heights; a row, the opposite. A widget with its own measurement whose
  height changes with width defines `minContentWidth` (without it, layout assumes a fixed
  height and takes the shortcut).
- **`aspectRatio`** (width / height) is "height depends on width" too: `intrinsic()` sets
  `wraps` and `fluid` (no "wide enough" shortcut in `heightAt`, which returns `width / ratio`,
  or the content if taller; measured nodes take the ratio as is). A fixed `height` gives the
  width (`ratioWidth`); a child stretched in a row of known inner height gets
  `height * ratio` as its flex basis (`rowBasis`).
- **Grid** (`direction: "grid"` + `columns` or `minColumnWidth`, `rowGap`; the `Grid` widget;
  `columnsOf(node, inner)` gives the column count, auto-fill with `minColumnWidth`): equal cells
  (`cellWidth`), rows as tall as their tallest cell (`gridRows`, shared by `intrinsic`,
  `heightAt` and `minHeightAt`), placed by `placeGrid`; cells stretch to the row unless
  `align`/`alignSelf` says otherwise or they have an `aspectRatio`. Children stay in one
  parent, so `<For>` stays keyed. Every `direction === "row"` check has a grid branch next
  to it: a new layout function needs one too.
- **`margin`** is outside the box: every size function adds the child's margins to it
  (`intrinsic`, `heightAt`, `minWidth`/`minHeightAt` floors, `gridRows`, `wrapLines`), flex
  (`mainSizes`) works on outer sizes and returns the box, `crossSize` subtracts the cross
  margins from the room, and placement offsets by the start margins (`absoluteSpan` adds them to
  the edges). `margins()`/`marginX()`/`marginY()` return shared zeros without a margin, and
  `mainSizes` only allocates when a child has one. Overflow math counts them. Hit test and
  paint use the box, so they ignore it.
- **`wrap`** (Row/Column, not grid): `wrapLines` breaks the in-flow children into lines by
  their natural main size and runs `mainSizes` per line (grow/shrink stay inside it);
  `placeWrapped` places line by line (`justify`/`alignSelf` per line, lines packed at the
  start, `rowGap` apart). A wrapping Row is "height depends on width": `intrinsic` = one line
  (`wraps` set), `heightAt`/`minHeightAt` sum the lines, `shrinks()` reports SHRINKS_X and
  `minWidth` is the widest child. A wrapping Column breaks at the height it is placed with; only
  a fixed `height` gives it a natural width. Overflow is checked per line along it, and for the
  lines stacked across.
- `Scroll` = column with `scrollable = true` (vertical); `horizontal` = row with
  `scrollableX = true`; both = column with both flags. On the scrolling axis, it does not
  shrink its children; on the cross axis, each child gets at least the visible space without
  being squeezed below its content (`floor` in `crossSize`).
- **The content of a scroller does not count toward the minimum of its container**
  (`shrinks()`, asked only when something needs to shrink): a column with a `Scroll grow={1}`
  inside shrinks without `minHeight={0}`. In height, only what scrolls vertically (or clips)
  gives way.
- Scrollbars: drawn over the content, in a 14 px strip that only takes the pointer when
  there is something to scroll; the hit test returns the scrollable node in that strip.
  Geometry in `render/scrollbar.ts`, hover/drag state in `UINode.activeScrollbar`.
- `scrollIntoView()` is resolved in the next `layout()` (`revealRequests`): it repositions
  `culled` ancestors before using the node's box, scrolls and positions everything again.
- **Culling:** `place()` receives the visible region (narrowed by each node with clip/scroll).
  A child outside it gets its box but is marked `culled`: its subtree is not positioned,
  painted (`paintTree`) or hit-tested on click (`hitTest`). Coordinates of descendants of a
  `culled` node are stale; never use them without checking the flag. A non-clipping parent
  does not narrow the region, so a child sticking out of it is not culled; but a child
  sticking out of a culled parent disappears with it.
- Clip (`clip`/scroll) clips inside the border, with radius `radius - borderWidth`.
- **Overflow warnings:** `place()` ends with `checkOverflow()` (`render/overflow.ts`): children
  that need more than the inner size on an axis the node does not scroll, cut off by a clip or
  the window (a `Scroll` on that axis does not count). Collected per root for the last layout,
  never printed by layout: `run()` prints each once in dev, tests read `layoutWarnings()`. Keep
  the ordinary path at two comparisons per container; anything costlier runs only when
  something overflows.

- **Percentages:** `place()` calls `resolvePercents(node, innerW, innerH)` before laying out the
  children, writing their px sizes and dropping their cached measurements.
- **onResize:** handlers run after the tree is placed; if they invalidated anything, `layout()`
  places again (`RESIZE_PASSES` = 2 extra), then reports an `onResize` loop as a layout warning.
- `translateX/Y` add to the position in `place()` (after flex); everything else sees the
  shifted position. Overlays: `root.layers` is recomputed on every `layout()`; a test that
  opens or closes an overlay needs `relayout()` before looking at `root.layers` or the commands.

## Performance

- `NB_STATS=1` prints every second: fps, ms/frame (state, layout, paint, native), why the
  frames happened (`why: inv 3 ev 2 raf 0`: `invalidate()`, native/input events,
  `requestAnimationFrame`), nodes, command buffer size, heap and RSS.
- `NB_TRACE=frames` logs one line per frame with its reason and the top 6 stack frames of the
  request (reactive plumbing removed); `[in frame]` = asked while that frame was being laid
  out or painted. Stacks are only taken when tracing (and, in dev, for in-frame requests).
- fps cap: `run(app, { maxFps })` or `NB_MAX_FPS`; default 120. On Wayland the frame stays
  aligned to vsync: we skip vblanks with `native.requestFrame()` (commit without drawing).
  On X11 pacing is timer-based (not aligned to vsync). 1.5 ms tolerance so 144 Hz does not
  drop to 72.
- `requestAnimationFrame(cb)` exists (`runtime/app.ts`) and is paced by the compositor.
- Numbers and method: tables in the README, the 120 cap and measurement caveats in
  ARCHITECTURE ("Measuring performance"). Use `scripts/compare.sh` with the same warmup and
  sample on both sides of the comparison.
- RAM breakdown: empty Bun 15 MB, + text 26 MB, + GL window 108 MB (almost all driver);
  the framework itself ~15 MB.
- **Known bottlenecks (in priority order):**
  1. full layout every frame: the natural size of all children of a `Scroll` is computed
     every frame (~2.5 ms in the 500-row table), with no dirty flags;
  2. HarfBuzz reshapes all *visible* text every frame (no cache in C);
  3. scheduling: with a 60 cap, fps sits at 51–58 even in light scenes (misses vblanks);
     latency frame callback -> thread -> `setImmediate` before rendering;
  4. hybrid GPU: glvnd loads NVIDIA libs without using them (+38 MB). Forcing Mesa only
     requires detecting the compositor's GPU, otherwise it breaks NVIDIA-only machines;
  5. redrawing the whole window (no `EGL_KHR_partial_update`/damage);
  6. `CommandBuffer.push(...values)` allocates per call.

## Packaging

`nodebuilder package <app.tsx>` (in the repo: `bun run package`) generates in `dist/` an
AppImage, `.deb`, `.rpm` and `.tar.gz` (`--targets` chooses; `--help` lists the options).
Steps:

1. **Addon** (`--native`): in an app, `prebuilt` embeds the binary from
   `@nodebuilderjs/<platform>` (already portable, nothing to compile). In the framework
   repository, `docker` compiles in an Ubuntu 22.04 (`cli/package/Dockerfile`), requiring
   only glibc ≥ 2.34 and libwayland ≥ 1.20, and replaces the local build in `native/build/`
   (works the same for development); `local` compiles here and only runs with this
   machine's glibc or newer. A `Bun.build` plugin embeds only the chosen addon and leaves
   the other candidates as externals.
2. **Single executable:** `Bun.build({ compile })` embeds the runtime, code, files
   imported with `with { type: "file" | "text" }` and the addon (~91 MB, ~31 MB compressed).
   `process.env.NB_APP_ID` is defined at build time and becomes the Wayland app id /
   WM_CLASS, which matches the `.desktop` (`StartupWMClass`).
3. **Install tree:** `/usr/bin/<name>`, `.desktop` and icon (hicolor) in `/usr/share`.
   System libraries are **declared dependencies, never bundled** (`SYSTEM_LIBS` in
   `cli/package/common.ts`, which `DEB_DEPENDS`/`RPM_SONAMES` and `nodebuilder doctor` read; keep
   in sync with `PKGS` in `native/platform/linux/build.sh`).
   libheif is only suggested (`DEB_SUGGESTS`/`RPM_SUGGESTS`).
4. **Formats**, all without distro tools (only `tar`/`xz`):
   - `.deb`: hand-written `ar` (control.tar.xz + data.tar.xz);
   - `.rpm`: hand-written RPM v4 (`cli/package/rpm.ts`), with immutable region and SHA-256
     digests; requires by soname, so it works for Fedora, RHEL and openSUSE;
   - AppImage: `appimagetool` downloaded into `~/.cache/nodebuilder` (build time only).

Verified (2026-10-11) with a real install in a container and a window on the host's Wayland
(`--device /dev/dri`, socket in `XDG_RUNTIME_DIR`): `.deb` on Ubuntu 22.04/24.04 and
Debian 12; `.rpm` on Fedora 43 (rpm 6.0, `rpm -K` OK) and AlmaLinux 9; AppImage on the host
and on Ubuntu 22.04 without FUSE. Minimal containers need `libgl1-mesa-dri` /
`mesa-dri-drivers` and some font; desktops already have them. To test an executable, run
it outside the repository (`cd /`): that exposes anything that only existed on disk.

## Publishing to npm

Scope `@nodebuilderjs` (the `nodebuilder` name on npm belongs to another project). Three
packages, all with the version from the root `package.json`:

| Package | Contents |
|---|---|
| `@nodebuilderjs/core` | this repo: `src/` (Bun, `bun` condition), `lib/` (Node + types), `cli/` (`nodebuilder` bin) |
| `@nodebuilderjs/linux-x64` | only the portable `nodebuilder.node`, with `os`/`cpu`/`libc` |
| `create-nodebuilderjs` | `bun create nodebuilderjs my-app` (`npm create` also works) |

- The binary ships as an `optionalDependencies` of core (`workspace:*` in the repo; pack
  replaces it with the version), esbuild pattern: **no install script**, which Bun blocks.
- `src/runtime/native.ts` tries, in this order: the local build (`../../native/build/...`,
  only exists in the repo) and the `@nodebuilderjs/<platform>` package. "Not found" moves
  on to the next; an addon that is found but fails to load (system lib, glibc) is the error.
- `bun run npm:build`: syncs versions, generates `lib/` (mirroring the folders of `src/`),
  compiles the portable addon (Docker) into `packages/linux-x64/` and packs into `dist/npm/`.
  `bun run npm:publish` does the same and runs `bun publish` on each tarball (binary before
  core). Requires an npm login and the `@nodebuilderjs` org to exist.
- Before publishing, test end to end without the registry: create an app with
  `node dist/npm/…create…/index.js` (extracted from the tarball), point `@nodebuilderjs/core`
  at `file:<tarball>` and use `overrides` for `@nodebuilderjs/linux-x64`; run `bun test`,
  `bun start`, `nodebuilder package` and install the `.deb` in a container (no `node_modules`).
- arm64: the loader and the packager already know `linux-arm64`, but there is no package yet
  (needs a build on an arm64 machine/CI).

## Current limitations

- TextField: no selection, copy, undo (paste exists; `password` masks the drawing only); Text: a word longer than the line
  overflows (selection only with `selectable`, no Shift+click or keyboard); a family without a
  weight or slant gets the closest face, emboldened or slanted (synthetic); app fonts are
  registered synchronously (no `unicode-range`, no async loading); `underline` is painted in
  TS and `TextField` ignores it. Font fallback and color emoji work (CBDT/sbix/COLRv0), but COLRv1
  fonts are not drawn in color and there is no bidi reordering.
- `<Canvas>`: a self-intersecting polygon is not drawn; translucent lines get darker at the
  joins (each segment is drawn separately); adjacent pie slices show a thin light seam
  (both edges antialiased, as in browsers); triangulating radial shapes with thousands of
  points is slow (~80 ms for 2000 points).
- SVG for icons only: no gradients, patterns, text, filters, masks, `<use>`, dashing
  or CSS in `<style>`; group opacity applied per shape.
- Images: AVIF/HEIC only with the system `libheif`; synchronous decoding on the JS thread
  (4 megapixels: PNG 80–130 ms, JPEG 140–170 ms, WebP 105–180 ms); no mipmaps (downscaling
  an image a lot makes it jagged) and no @2x variant.
- `opacity` multiplies the alpha of each command (it is not group opacity); no `scale`/`rotate`.
- Percentage sizes resolve against the parent's content box when the parent is placed; the
  parent's own natural size counts a percentage child at its last value (its content the first
  time). An `Image` with different corner radii is drawn inside a rounded clip.
- Gradients: linear only (backgrounds and Canvas fills); no radial/conic; borders, text and
  shadows are solid.
- `<ErrorBoundary>` does not cover the event handler's own code (only the effects its
  writes trigger); `<Switch>` does not accept a function child that returns `<Match>`
  (the `Match`es must be in the JSX, so they can be read without running anything).
- Scrolling without inertia or animation; no auto-scroll when dragging a selection to the
  edge; holding a click on the scrollbar track advances only one page (no repeat).
  Shift+wheel depends on the event's modifiers: on Wayland they only apply while the window
  has keyboard focus.
- Dark theme does not follow the system (the XDG portal is reachable now with `src/dbus/`, not read yet); a theme color
  copied as a fixed value (`color={theme.x}`) does not follow the switch. Animations without
  `scale`/`rotate` or declarative `transition`.
- Screenshots need EGL (Mesa surfaceless or an EGL device); a process that took one cannot
  open a window afterwards (and vice versa).
- No accessibility (AT-SPI), multi-window, IME
  (text-input-v3), DnD, real fractional scaling (KDE 125% renders at 2x and downscales).
- Window icon on Wayland only with `xdg-toplevel-icon-v1` (KDE 6.1+; GNOME uses the `.desktop`
  matching the app id). Tray only with a StatusNotifierItem host (GNOME needs the AppIndicator
  extension; no XEmbed tray). The tray's menu is drawn by the panel (no icons in items yet).
- Window always uses its own decoration (CSD): title bar, move, maximize,
  resize from the edges (6 px); `decorations={false}` swaps the bar for the app's own
  (`dragRegion` + `<WindowControls />`). `xdg-decoration` (SSD on KDE) not yet.
- X11: timer-based frames (no Present extension, so there may be tearing without a
  compositor and ~5–10% lower fps than on Wayland); integer scale only; tested only via
  XWayland (KDE). A pure X11 session and the no-compositor path have not been tested yet.

## Pitfalls found so far

### Environment
- The user's shell is **zsh**: `set -- $var` does not split words, and globs with no
  match (`--include=*.md`) become an error; in scripts use `#!/usr/bin/env sh|bash`
  or quotes. `ls` is aliased with colors: in scripts use `command ls`.
- With `set -o pipefail`, a `grep` with no result kills the script (use `|| true`).
- The `bun` in PATH is a shim (vite-plus); to measure the real process use
  `bun -e 'console.log(process.execPath)'`.
- Bun blocks install scripts: the Electron binary in `compare/electron` was
  downloaded with `node node_modules/electron/install.js`.
- KWin sometimes misses vblanks even in trivial scenes (p90 ~7.6 ms at 240 Hz); fps
  slightly below the cap is not necessarily our bug.
- To test X11 in a Wayland session: `NB_BACKEND=x11` (uses XWayland, `DISPLAY=:0`);
  `NB_SCALE=2` simulates HiDPI. `NB_DEBUG=1` shows the backend, scale, Hz, visual and the
  `GL_RENDERER`.
- A screenshot taken with the mouse over the window may catch a stray scroll: if the
  result looks odd, capture again before investigating.

### Bun, packaging and publishing
- `bun build --compile` only embeds a `.node` loaded by `require("literal")`. With
  `createRequire(...)(path)` the binary looks for the file on disk (and appears to work on
  the build machine). That is why `src/runtime/native.ts` has one literal `require` per
  platform, relative to its folder: moving the file requires adjusting the `../`.
- An app's files only get into the executable if they are imported with
  `with { type: "file" }` (the import becomes the path, `/$bunfs/...` in the executable) or
  `with { type: "text" }`. `new URL("./x.png", import.meta.url)` works in
  development and breaks in the package.
- `Bun.Transpiler` (and the bundler) replaces `typeof require === "function"` with `true`.
  To know whether you are on Bun use `process.versions.bun`, which is not evaluated at build time.
- tsc 5.5+ drops `/// <reference path>` from generated `.d.ts` files; without
  `preserve="true"`, the `declare module "*.png"` would not reach users of the package via `lib/`.
- npm removes `.gitignore` from published packages: the template keeps `_gitignore` and
  `create-nodebuilderjs` renames it when copying. Relative symlinks also do not survive
  pack/`cpSync`: that is why the `.claude/skills/` links are created by `index.js`.
- `Object.keys(native)` returns `[]` (non-enumerable properties); it is not an error.
- Bun drops import attributes on re-exports: `export { default as x } from "x.svg" with
  { type: "text" }` gives the file's path, not its text. Import, then export
  (`import x from "x.svg" with { type: "text" }; export { x };`), as `nodebuilder icons add` writes.

### Frame loop
- Code that runs inside `renderFrame` (`layout()`, `refreshHover()`, paint) must only call
  `invalidate()` when something really changed: an unconditional invalidate there redraws
  at the fps cap forever while idle (this happened with the scrollbar highlight). To find
  who asks for frames, run with `NB_TRACE=frames` (look for `[in frame]`); in dev, `run()`
  warns once after 30 frames in a row that request themselves with nothing else changing.
  `test/app.test.tsx` pins "an idle window renders once".

### Native
- libwayland headers < 1.22 lack the v6 fields of `wl_surface_listener`, and an old
  libwayland at runtime aborts if the compositor sends v6 events. The `wl_compositor` bind
  is capped by `wl_surface_interface.version` (from the loaded lib) and the listener is a
  table.
- Optional libraries (libheif) are loaded with `dlopen` and our own declarations of the
  few functions used: that way they do not become a build or install dependency. This only
  works for handle-and-function APIs; if the API exposes structs that change between
  versions, the layout breaks across distros.

- A workspace with a required peer dependency on core makes `bun install` download the
  published core from npm, creating a second copy in the repository (this happened with
  charts when it was a separate package). New functionality goes into core, as a subpath
  if it needs its own names (`@nodebuilderjs/core/charts`), and tree-shaking removes what
  is not used.
- In the end-to-end test with Node, install copies of the packages in `node_modules`, not
  symlinks: Node follows the link to the real path and does not find the dependencies.

### Fixtures
- ImageMagick's `PNG8:` reduces palette alpha to 0/255; that is why the palette fixtures
  with partial alpha are hand-written (and checked with `magick` itself).
- When the reference tool does not produce a case (VP8 partitions, VP8L transforms),
  write the file by hand or with a small program in the scratch dir, and check that the
  reference library reads it the same way.
