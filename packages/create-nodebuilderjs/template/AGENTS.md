<!-- nodebuilder:begin (the framework's guide, kept current by `nodebuilder agents update`; write your notes after the end marker) -->
# AGENTS.md

nodebuilder app: native Linux UI in TSX, **no DOM and no React**. Read this before changing code.

## Commands
- `bun run dev` opens the app; `bun test` runs the tests without a window; `bun run typecheck` checks types.
- `bun run icons:add play pause` adds icon imports to `src/icons.ts` (after `bun add lucide-static`).
- `bun run screenshot` renders the app to `screenshot.png` without a window (also with no
  display server); add `-- --theme dark` or `-- --scale 2`.
- `bun run doctor` checks the machine: native core and system libraries, display server,
  keyboard, GL, fonts (emoji, CJK). **Run it first when a window does not open, the native core
  fails to load, text shows boxes or a screenshot fails**, before changing code: the problem is
  often a missing package, and each failure comes with the command that installs it.
  `bun run doctor -- --json` for a machine-readable report.
- After updating `@nodebuilderjs/core` (`bun update`), `bun run agents:update` brings this guide
  and the skills to the new version (the doctor warns when they are behind). Docs edited in
  this app are kept and listed, not overwritten.
- Before finishing: `bun run typecheck && bun test`. **After a visual change, take a screenshot
  and look at it** (open the PNG): tests check boxes, not colors, alignment or clipping.
- A screen other than the first: `nodebuilder screenshot src/App.tsx shot.png --export App
  --props '{"page":"settings"}'` when `App` takes its initial state as props (testing skill).
- Never stop an app with `pkill -f <pattern>`: the pattern also matches the shell running the
  command (an agent kills its own shell). Use the PID of the job you started (`kill %1`,
  `kill $PID`) or an exact name (`pkill -x`). Better: screenshots need no running app at all.

## Model (like SolidJS, not React)
- **Components run once.** There is no re-render and there are no hooks. State is `createSignal`;
  derived values are `createMemo`; effects are `createEffect` (+ `onCleanup`); code that needs
  the component's `ref`s goes in `onMount`. The `run(() => ...)` callback runs once too.
- `requestAnimationFrame` is imported from `@nodebuilderjs/core` (there is no global one).
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
| `nodebuilder-ui` | screens, widgets (incl. custom title bar with `dragRegion`/`WindowControls`, window `icon`, system tray (`createTray`, `windowControls.hide/show`), `TextArea` and text selection/undo, `Toggle`, `RadioGroup`, `Slider`, `Select`, `Tabs`, `Tooltip`, `Dialog`, `ProgressBar`, `disabled`), style props (incl. gradient `background={{ linear, angle }}`), fonts (`fontFamily`, `registerFont`, `fontFeatures`, `fontVariations`, `fontFamilies()`), hover/press/focus (`hoverStyle`, `pressStyle`, `focusStyle`, `createInteraction`), layout (`Grid` of equal columns or `minColumnWidth`, percentages `width="50%"`, `radius={[tl, tr, br, bl]}`, `wrap` rows of chips, `margin`, `aspectRatio`, equal columns in a row with `width={0} grow={1}`, `position="absolute"`, `zIndex`, `clip`, `shadow`, overflow warnings), events, own components, `For`/`Index`/`Show`/`Switch`, `ErrorBoundary`, scrolling (horizontal, scrollbars, keyboard, `scrollIntoView`), context, `ref` (focus, scroll), `onMount`, `onResize`, window-wide keys (`<Window onKeyDown>`, `focusable`), `TextField password`, `Overlay` (dialog, menu, tooltip, `inset`), `opacity`/`translate`, theme (light/dark, `setTheme`), animations (`createTween`, `animate`, `easing`, `mixColor`), selectable text, copy/paste |
| `nodebuilder-from-react` | before installing libraries or porting React/web code |
| `nodebuilder-images` | images (PNG, JPEG, WebP, AVIF), files in the app |
| `nodebuilder-icons` | icons (Lucide, Phosphor) and SVG with `Icon`; `bun run icons:add <names...>` writes their imports into `src/icons.ts` |
| `nodebuilder-charts` | ready-made charts (`@nodebuilderjs/core/charts`, Recharts API) |
| `nodebuilder-drawing` | freehand drawing with `Canvas` (reactive `draw`, dashed lines, gradient fills with `g.linearGradient`, text cut to a width with "…") |
| `nodebuilder-testing` | tests without a window (`mount`, `findByText`/`findAllByText` (`{ in: "Button" }`), `findByLabel` (`ariaLabel`), `findByValue`/`findByPlaceholder`/`shownText` (fields), `click`, `interact`, hidden targets that throw, `layoutWarnings()`, real text metrics (`useRealTextMetrics`), `frames`, clipboard), screenshots (`nodebuilder screenshot`, `--props` for a given page, `screenshot()`) |
| `nodebuilder-packaging` | AppImage/.deb/.rpm, embedded files, icon and app id |
| `nodebuilder-performance` | slowness, long lists, live data, animation, CPU use while idle (`NB_STATS`, `NB_TRACE=frames`) |
<!-- nodebuilder:end -->

## This app

Notes for agents about this app (conventions, commands, decisions) go here, after the marker
above: `nodebuilder agents update` replaces only the framework guide between the markers.
