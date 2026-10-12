# AGENTS.md

nodebuilder app: native Linux UI in TSX, **no DOM and no React**. Read this before changing code.

## Commands
- `bun run dev` opens the app; `bun test` runs the tests without a window; `bun run typecheck` checks types.
- Before finishing: `bun run typecheck && bun test`.

## Model (like SolidJS, not React)
- **Components run once.** There is no re-render and there are no hooks. State is `createSignal`;
  derived values are `createMemo`; effects are `createEffect` (+ `onCleanup`).
- **Only functions are reactive.** `<Text>{count}</Text>` or `text={() => ...}` update;
  `<Text>{count()}</Text>` is read once and never changes. The same goes for styles:
  `background={() => (active() ? "#3584e4" : "#0000")}`, and for theme colors:
  `color={() => theme.text.secondary}` follows a switch to the dark theme.
- Lists: `<For each={list}>{(item) => ...}</For>` (keyed by reference) or
  `<Index each={list}>{(item) => ...}</Index>` (by position; `item` is an accessor).
  Conditions: `<Show when={() => ...} fallback={...}>`; several cases: `<Switch>` with
  `<Match when={...}>`. Errors: `<ErrorBoundary fallback={(error, reset) => ...}>`.
- Styles are flat props (`padding`, `gap`, `grow`, `background`...), not CSS. There is no
  `className`, `style={{}}`, `div` or `useState`, and React libraries (e.g. `lucide-react`) don't work.

## Skills (details by topic)
In `.agents/skills/<name>/SKILL.md` (linked from `.claude/skills/` for Claude Code). Agents
that support skills load them on their own; others should read the topic's skill before starting:

| Skill | When |
|---|---|
| `nodebuilder-ui` | screens, widgets (incl. `Toggle`, `RadioGroup`, `Slider`, `Select`, `Tabs`, `Tooltip`, `Dialog`, `ProgressBar`, `disabled`), style props, layout (equal columns with `width={0} grow={1}`, `position="absolute"`, `clip`, `shadow`), events, own components, `For`/`Index`/`Show`/`Switch`, `ErrorBoundary`, scrolling (horizontal, scrollbars, keyboard, `scrollIntoView`), context, `ref` (focus, scroll), `onResize`, `Overlay` (dialog, menu, tooltip), `opacity`/`translate`, theme (light/dark, `setTheme`), animations (`createTween`, `animate`, `easing`, `mixColor`), selectable text, copy/paste |
| `nodebuilder-from-react` | before installing libraries or porting React/web code |
| `nodebuilder-images` | images (PNG, JPEG, WebP, AVIF), files in the app |
| `nodebuilder-icons` | icons (Lucide, Phosphor) and SVG with `Icon` |
| `nodebuilder-charts` | ready-made charts (`@nodebuilderjs/core/charts`, Recharts API) |
| `nodebuilder-drawing` | freehand drawing with `Canvas` (reactive `draw`, dashed lines, fitting text with `measureText`) |
| `nodebuilder-testing` | tests without a window (`mount`, `findByText`/`findAllByText`, `findByLabel` (`ariaLabel`), `click`, `interact`, hidden targets that throw, `frames`, clipboard) |
| `nodebuilder-packaging` | AppImage/.deb/.rpm, embedded files, icon and app id |
| `nodebuilder-performance` | slowness, long lists, live data, animation |
