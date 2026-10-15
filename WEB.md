# Web roadmap

Goal: the same app, unchanged, runs as a web page that looks and behaves as on the desktop:
same pixels (WebGL draws the same command buffer with the same shader), same layout and
input, on desktop and mobile browsers, with no third-party runtime code and a small bundle.
How it works today is in `ARCHITECTURE.md` ("The web"); this file is what is left. The
alternative, rendering the tree as HTML and CSS (which removes most of P0 and P1 below), is
designed in `WEB2.md`.

Status keys: **done**, **P0** (blocks shipping a real app), **P1** (needed to call the web
target complete), **P2** (expected by some apps), **P3** (nice to have). Each item says where
the work goes and how it is tested (see the TDD rules in `AGENTS.md`).

## Done (2026-10-15, spike on `feat/web-spike`)

- `nodebuilder web <app.tsx> [--serve --minify --out --title --port]` (`cli/web.ts`):
  `Bun.build` for the browser with a virtual entry (`await boot(); await import(app)`),
  `node:*` mapped to `src/web/shims/` (an import without a shim is a build error), splitting
  (`app.js` + shared `nodebuilder-*.js`, the app's chunk preloaded), `index.html`,
  `assets.json`. The `todo` example starts with 41 KB of gzipped script.
- The `Native` interface in the browser (`src/web/native.ts`), installed by `boot()` with
  `useNative()`: canvas sized by a `ResizeObserver` and `devicePixelRatio`, pointer, wheel and
  key events (`web/keys.ts`: DOM keys to xkb names), clipboard (paste event, `readText`
  fallback), cursors, the tab title, a `requestAnimationFrame` as the frame callback.
- Renderer: `render_gles2.c` in TypeScript (`web/renderer.ts`: same vertex format, batching,
  clip stack, gradient cutting) against a WebGL device (`web/gl.ts`, same GLSL).
- Text: Canvas2D measures and rasterizes whole runs into an RGBA atlas (browser shaping,
  fallback and color emoji).
- Files: the app's imported files fetched before it starts (`node:fs` reads from memory).
- Images: every imported image decoded by the browser ahead of time (color profile applied);
  bytes made at runtime load the TypeScript decoders, a chunk fetched on demand, and the image
  source decodes again when it arrives (`error.retry` in `image/source.ts`). AVIF and HEIC
  wherever the browser supports them. No window icon on a page (`web/icon.ts`).
- The page is the window (`setWindowFrame(false)`): `<Window>` draws no title bar, border or
  corners, and `<WindowControls>` draws nothing.
- Checked in headless Chromium (SwiftShader), with screenshots and input driven through the
  DevTools protocol: every showcase example, typing with accents and emoji, clicks,
  Select/Dialog overlays, wheel scrolling on both axes, DPR 2.

## P0: before shipping a real app

- **WebGL context loss.** Browsers drop the context (mobile, background tabs, GPU resets);
  today the canvas stays blank. Handle `webglcontextlost` (`preventDefault`, stop rendering)
  and `webglcontextrestored` (recreate program, buffers, atlas; images keep their pixels or
  are decoded again, so `createImage` must keep the bytes or the source must re-upload).
  Test: `WEBGL_lose_context` in the browser e2e.
- **Real browsers.** Only headless Chromium on SwiftShader has been tried. Check Chrome and
  Firefox on a real GPU, Safari (macOS and iOS), Chrome on Android; fractional DPR (1.25,
  1.5). Write down what differs.
- **Browser zoom.** Ctrl + / Ctrl − change `devicePixelRatio`; `open()` listens to one
  `matchMedia` for the initial ratio only. Listen again after each change.
- **Performance, measured.** Nothing has been measured. Run `bench:dashboard` (table, logs) in
  a real browser and compare with the desktop (fps, ms per frame by phase). Suspects:
  - each new text run does `getImageData` + `texSubImage2D` (scrolling a long table rasterizes
    every new row);
  - a full atlas is cleared at once, so a screen with more text than fits re-rasterizes
    every frame (evict least recently used shelves instead, or grow to a second page);
  - runs are cached per color: one string in several colors takes several entries.
  No optimization without before and after numbers (`AGENTS.md`, "Performance").

## P1: needed to call the web target complete

### Input

- **IME and the virtual keyboard.** A hidden `<textarea>` placed at the caret of the focused
  text input receives `compositionstart/update/end` and `input`, so CJK input, dead keys and
  the mobile keyboard work (a canvas never opens a keyboard). Check dead keys on a real ABNT2
  and US-international layout (`keydown` with `key === "Dead"` is ignored today).
- **Touch.** Pointer events already arrive, but dragging does not scroll a `Scroll` and there
  is no inertia. Drag to scroll (with a threshold so taps still click), fling, and no
  hover state stuck after a tap.
- **Browser shortcuts.** Decide which keys the app gets and which the browser keeps
  (`browserShortcut()` in `web/native.ts`: reload, zoom, dev tools today).

### Accessibility

- **A semantics tree.** Without it screen readers see an empty canvas. Mirror the UI tree into
  hidden DOM elements with ARIA roles, names (`ariaLabel`, text), states (checked, disabled,
  expanded) and positions, kept in sync after `layout()`; focus follows the framework's focus.
  This is the largest item. It also gives the browser's find (Ctrl+F), translation and
  part of SEO. The same tree is what AT-SPI on Linux needs, so design it once.

### Text

- **Fidelity.** Metrics come from Canvas2D, not HarfBuzz, so line breaks can land a few pixels
  apart from the desktop. Measure the difference on the `text` example; `fontBoundingBox*`
  ascent and descent are used today.
- **Font loading.** Registered fonts load asynchronously: the app first shows the fallback font,
  then lays out again (FOUT). `boot()` should await `document.fonts.ready` for fonts the app
  registers at startup.
- **`registerFont` without `family`.** Read the family from the font's `name` table (TTF/OTF);
  WOFF2 would need decompression, so require `family` there.
- **Runs wider than the atlas** (4096 px) are cut off: split long runs.

### Developer experience

- **Live reload** in `--serve` (server-sent events, the page reloads after a rebuild), then
  hot reload of the app's chunk.
- **Template:** a `web` script in `create-nodebuilderjs`, and the web target and its limits in
  the template's `AGENTS.md` and skills.
- **Cache busting:** `app.js` has no hash; name it by hash and let `index.html` point to it.
- **CI:** a browser e2e job. Download `chrome-headless-shell` in CI, build the examples and run
  the DevTools protocol scripts (screenshots, input), comparing pixels with the native
  `nodebuilder screenshot` at chosen points, like the pixel tests do.

## P2: expected by some apps

- **Display P3.** WebGL is fixed to sRGB; Chrome and Safari take
  `drawingBufferColorSpace = "display-p3"`, and `open()` would return it.
- **Dark theme from the system:** `prefers-color-scheme` (easy here, unlike the desktop).
- **`fontFeatures` and `fontVariations`:** only partly possible (`FontFace` descriptors,
  `fontVariantCaps`, `fontStretch` on the context).
- **Images without blocking start:** `boot()` fetches and decodes every imported image before
  the app runs. Large apps need a progress indicator, or images loaded on first use.
- **Embedding:** mount into an element of an existing page instead of the whole page. Several
  apps per page need the module-level state (theme, frame clock, image backend) per instance.
- **Native browser features:** text selection with the browser's own handles, password
  autofill, right-click menus over text.
- **Files the app did not import:** `fetch` + `File` input instead of `fs`; document that
  `readFileSync` only reads imported files.

## P3: nice to have

- **One renderer for both targets:** compile `native/core/` (with FreeType and HarfBuzz) to
  WASM, so text matches the desktop exactly; costs a few hundred KB of WASM.
- **WebGPU** device behind the same `RenderDevice` interface.
- **Offscreen screenshots in the browser** (`screenshot()` with an `OffscreenCanvas`).
- **Favicon** from the `<Window icon>`.

## Maintenance rules (while the spike becomes the real thing)

- The command buffer format now lives in four places: `native/include/nb.h`,
  `src/render/paint.ts`, `native/core/render_gles2.c` and `src/web/renderer.ts` (plus its
  shader copy in `web/gl.ts`). A new op or shader change goes into all of them, with a test
  in `test/web/renderer.test.ts`.
- `cli/web.ts` swaps `image/decode.ts` and `image/icon.ts` for their `src/web/` versions
  (`WEB_MODULES`). A module that gets a web version says so in its header comment.
- A new `node:*` import in `src/` needs a shim in `src/web/shims/`, or the web build fails.

## Order of work

1. P0: context loss, real browsers and zoom, then measure and fix performance.
2. Input: IME and touch.
3. Accessibility tree (shared design with AT-SPI).
4. Text fidelity and font loading; live reload, template, cache busting, CI e2e.
5. P2 as apps ask for them.

Rough size: P0 and live reload, one to two weeks (enough for internal desktop-browser apps);
everything through P1, months, most of it the accessibility tree and IME.
