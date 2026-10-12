# FIX.md: follow-ups from the Spotify-style dashboard report (v0.2.5)

A user built a Spotify-like dashboard with 0.2.5 and reported 13 problems. All of them are
done on `developer` (details in CHANGELOG "Unreleased"):

| Report item | What shipped |
|---|---|
| 1. Seeing the UI | `nodebuilder screenshot` and `screenshot()` in testing (EGL offscreen) |
| 2. Silent overflow | hidden click targets throw in tests; dev overflow warnings + `layoutWarnings()`; `wrap` on Row/Column |
| 3. Equal columns | documented `width={0} grow={1}`; `<Grid>`; `aspectRatio` |
| 4. Gradients | `background={{ linear, angle }}`, Canvas `g.linearGradient`; absolute `right`/`bottom`, absolute children scroll with the content |
| 5. Hover boilerplate | `hoverStyle`/`pressStyle`, `createInteraction()` |
| 6. Finding elements | `findAllByText`, `ariaLabel` + `findByLabel`; `useRealTextMetrics()` |
| 7. Filled icons | `<Icon fill>` |
| 8. Layout/text props | `alignSelf`, `margin`, `underline`, `fontWeight`, `italic`, `letterSpacing` |
| 9. Title bar | `<Window decorations={false}>`, `dragRegion`, `<WindowControls>` |
| 10. Visual behaviors | documented and pinned by tests; Canvas text `maxWidth`; `zIndex` |
| 11. Hidden APIs | skills list `mixColor`, tween options, reactive Canvas `draw` |
| 12. Icon imports | `nodebuilder icons add` (and the Bun re-export pitfall) |
| 13. Idle redraw | fixed; `NB_TRACE=frames`, frame reasons in `NB_STATS`, frame-loop warning |

Also found and fixed along the way: font fallback and color emoji, premultiplied `mixColor`,
`onPointerDown` bubbling past clickable nodes, handlers chained instead of replaced, fixed
`width` with a smaller `minWidth` no longer shrinks, `bun run check:snippets`.

## Left for later

- Server-side window decorations (`xdg-decoration`) on KDE.
- Radial gradients (not affine: need a shader mode).
- Synthetic bold; choosing a font family.
- Grid spans / named areas; `align-content` for wrapped lines.
- Overflow warning for a single text wider than its own box (a long word).
