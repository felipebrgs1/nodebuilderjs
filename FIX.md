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

## B. Layout

Done (B4 `wrap`, B5 `margin`).

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

---

## D. Window

Done (D1). Left for later: server-side decorations via `xdg-decoration` on KDE.

---

## E. Ecosystem

Done (E1).

---

## F. Found while fixing the above

All done (F1-F6).

---

## Suggested order

1. C2 (weights, spacing)
